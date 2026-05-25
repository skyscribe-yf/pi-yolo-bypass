import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getAgentDir } from "./src/policy-paths.js";
import {
  formatStatus,
  isBypassActive,
  markBypassActive,
  markBypassInactive,
} from "./src/status.js";

// ---------------------------------------------------------------------------
// All-allow policy template — every permission in every category set to allow.
// This is written atomically in place of the real policy file during bypass.
// ---------------------------------------------------------------------------
const ALL_ALLOW_POLICY = JSON.stringify(
  {
    defaultPolicy: {
      tools: "allow",
      bash: "allow",
      mcp: "allow",
      skills: "allow",
      special: "allow",
    },
    tools: { "*": "allow" },
    bash: { "*": "allow" },
    mcp: { "*": "allow" },
    skills: { "*": "allow" },
    special: {
      doom_loop: "allow",
      external_directory: "allow",
    },
  },
  null,
  2,
) + "\n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPolicyPath(): string {
  return join(getAgentDir(), "pi-permissions.jsonc");
}

function getBackupPath(): string {
  return `${getPolicyPath()}.yolo-bak`;
}

function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, path);
}

// ---------------------------------------------------------------------------
// Bypass management
// ---------------------------------------------------------------------------

function enableBypass(): { ok: boolean; error?: string } {
  const policyPath = getPolicyPath();
  const backupPath = getBackupPath();

  if (!existsSync(policyPath)) {
    return { ok: false, error: `Policy file not found: ${policyPath}. Is pi-permission-system installed?` };
  }

  if (existsSync(backupPath)) {
    return { ok: false, error: "Backup already exists. Bypass may already be active (run /yolo-bypass to restore)." };
  }

  try {
    // 1. Back up the original policy
    renameSync(policyPath, backupPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to back up policy: ${msg}` };
  }

  try {
    // 2. Write the all-allow policy in its place
    atomicWrite(policyPath, ALL_ALLOW_POLICY);
  } catch (err) {
    // Best-effort rollback
    try {
      if (existsSync(backupPath)) renameSync(backupPath, policyPath);
    } catch {
      // ignore
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to write bypass policy: ${msg}` };
  }

  markBypassActive();
  return { ok: true };
}

function disableBypass(): { ok: boolean; error?: string } {
  const policyPath = getPolicyPath();
  const backupPath = getBackupPath();

  if (!existsSync(backupPath)) {
    return {
      ok: false,
      error: "No backup found. Bypass may not be active, or the backup was lost (run /yolo-bypass to force restore).",
    };
  }

  try {
    // 1. Remove the all-allow policy
    if (existsSync(policyPath)) {
      unlinkSync(policyPath);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to remove bypass policy: ${msg}` };
  }

  try {
    // 2. Restore backup
    renameSync(backupPath, policyPath);
  } catch (err) {
    // CRITICAL: backup exists but rename failed — leave a clear message
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to restore backup (${msg}). Original policy backed up at ${backupPath}` };
  }

  markBypassInactive();
  return { ok: true };
}

/**
 * Force-disable: removes the all-allow policy even if there's no backup.
 * Used as a recovery path when the backup is lost.
 */
function forceDisableBypass(): { ok: boolean; error?: string } {
  const policyPath = getPolicyPath();
  const backupPath = getBackupPath();

  if (!existsSync(policyPath)) {
    markBypassInactive();
    return { ok: true };
  }

  // Verify this is actually our all-allow file
  try {
    const raw = readFileSync(policyPath, "utf-8");
    if (!raw.includes('"tools": "allow"') || !raw.includes('"bash": "allow"')) {
      // Not our bypass file
      return { ok: false, error: "Current policy file does not appear to be a bypass file. Cannot force-restore without a backup." };
    }
  } catch {
    return { ok: false, error: "Cannot read current policy file." };
  }

  // If there IS a backup, use normal restore
  if (existsSync(backupPath)) {
    return disableBypass();
  }

  // No backup — just remove the file so pi-permission-system falls back to defaults
  try {
    unlinkSync(policyPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to remove bypass policy: ${msg}` };
  }

  markBypassInactive();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

async function handleCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const mode = args?.trim().toLowerCase();

  if (mode === "on" || mode === "enable" || mode === "1") {
    if (isBypassActive()) {
      ctx.ui.notify("YOLO Bypass is already active. All permissions are allowed.", "info");
      return;
    }
    const result = enableBypass();
    if (result.ok) {
      ctx.ui.notify("🔓 YOLO Bypass ENABLED — all permissions are now allowed.", "info");
    } else {
      ctx.ui.notify(`Failed to enable bypass: ${result.error}`, "error");
    }
    return;
  }

  if (mode === "off" || mode === "disable" || mode === "0") {
    if (!isBypassActive()) {
      ctx.ui.notify("YOLO Bypass is not active.", "info");
      return;
    }
    const result = disableBypass();
    if (result.ok) {
      ctx.ui.notify("🔒 YOLO Bypass DISABLED — original permissions restored.", "info");
    } else {
      ctx.ui.notify(`Failed to disable bypass: ${result.error}`, "error");
    }
    return;
  }

  if (mode === "force-off" || mode === "force-restore") {
    const result = forceDisableBypass();
    if (result.ok) {
      ctx.ui.notify("🔒 YOLO Bypass force-disabled.", "info");
    } else {
      ctx.ui.notify(`Force-disable failed: ${result.error}`, "error");
    }
    return;
  }

  if (mode === "status" || mode === "") {
    const active = isBypassActive();
    const backupPath = getBackupPath();
    const backupExists = existsSync(backupPath);
    const policyPath = getPolicyPath();

    ctx.ui.notify(
      `YOLO Bypass: ${active ? "🔓 ACTIVE" : "🔒 INACTIVE"} | ` +
      `Policy: ${policyPath} | ` +
      `Backup: ${backupExists ? "exists" : "none"}`,
      "info",
    );
    return;
  }

  // Toggle (default)
  if (isBypassActive()) {
    const result = disableBypass();
    if (result.ok) {
      ctx.ui.notify("🔒 YOLO Bypass DISABLED.", "info");
    } else {
      ctx.ui.notify(`Failed to disable: ${result.error}`, "error");
    }
  } else {
    const result = enableBypass();
    if (result.ok) {
      ctx.ui.notify("🔓 YOLO Bypass ENABLED.", "info");
    } else {
      ctx.ui.notify(`Failed to enable: ${result.error}`, "error");
    }
  }
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function yoloBypassExtension(pi: ExtensionAPI): void {
  // Register command
  pi.registerCommand("yolo-bypass", {
    description: "Toggle full permission bypass (on/off/toggle/status/force-off)",
    handler: handleCommand,
  });

  // Register shortcut
  pi.registerShortcut("ctrl+shift+y", {
    description: "Toggle YOLO bypass mode",
    handler: async (ctx) => {
      if (isBypassActive()) {
        const result = disableBypass();
        if (result.ok) {
          ctx.ui.notify("🔒 YOLO Bypass OFF", "info");
        } else {
          ctx.ui.notify(`Bypass disable failed: ${result.error}`, "error");
        }
      } else {
        const result = enableBypass();
        if (result.ok) {
          ctx.ui.notify("🔓 YOLO Bypass ON", "info");
        } else {
          ctx.ui.notify(`Bypass enable failed: ${result.error}`, "error");
        }
      }
    },
  });

  // Show status in footer
  pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
    if (isBypassActive()) {
      ctx.ui.setStatus("yolo-bypass", formatStatus());
    }
  });

  // Re-check status on every turn start (in case an external tool toggled it)
  pi.on("turn_start", (_event: unknown, ctx: ExtensionContext) => {
    ctx.ui.setStatus("yolo-bypass", formatStatus());
  });

  // Warn on shutdown if bypass is active
  pi.on("session_shutdown", (event, ctx: ExtensionContext) => {
    if ((event as { reason?: string }).reason === "quit" && isBypassActive()) {
      // Can't prompt during shutdown, but can write a notice
      const backupPath = getBackupPath();
      if (existsSync(backupPath)) {
        // Write a marker so next session_start can warn
        try {
          writeFileSync(join(getAgentDir(), ".yolo-bypass-warning"), "active-at-shutdown", "utf-8");
        } catch {
          // best effort
        }
      }
    }
  });

  // On next startup, warn if bypass was left active
  pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
    const warningPath = join(getAgentDir(), ".yolo-bypass-warning");
    if (existsSync(warningPath)) {
      try {
        unlinkSync(warningPath);
      } catch {
        // ignore
      }
      // Check if bypass is still active
      if (isBypassActive()) {
        setTimeout(() => {
          ctx.ui.notify(
            "⚠️  YOLO Bypass is still active from previous session. Run /yolo-bypass off to restore.",
            "warning",
          );
        }, 500);
      }
    }
  });
}
