/**
 * Per-process policy directory management for session-level isolation.
 *
 * Each pi process gets its own policy directory under /tmp (or os.tmpdir()),
 * identified by PID + random token to prevent PID-recycling conflicts.
 *
 * Directory layout:
 *   /tmp/pi-yolo-bypass-{pid}-{token}/
 *   ├── pi-permissions.jsonc          ← active policy (original or all-allow)
 *   ├── pi-permissions.jsonc.yolo-bak ← backup of original policy (yolo ON)
 *   ├── agents/                       ← symlink → original ~/.pi/agent/agents/
 *   ├── settings.json                 ← symlink → original ~/.pi/agent/settings.json
 *   └── mcp.json                      ← symlink → original ~/.pi/agent/mcp.json
 *
 * Subagent inheritance:
 *   Subagent (spawned as child process) inherits PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR
 *   pointing to the parent's per-process directory. The subagent factory detects this
 *   (PID mismatch), copies the parent's current policy into its own per-process directory,
 *   and updates the env var. This way subagents inherit parent's yolo state but can
 *   toggle independently.
 *
 * Crash safety:
 *   On startup, stale directories with the same PID but different token are cleaned up.
 *   This prevents PID-recycling from reading garbage left by a crashed predecessor.
 */

import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Env var that pi-permission-system reads to find its policy directory. */
export const POLICY_AGENT_DIR_ENV = "PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR";

/** Env var we set to communicate our full per-process dir path to subagents. */
export const YOLO_BYPASS_PROCESS_DIR_ENV = "PI_YOLO_BYPASS_PROCESS_DIR";

/** Env var for the pi coding agent dir (not used for source resolution, kept for reference). */
// const PI_CODING_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/** Subagent env hint keys — matches pi-permission-system. */
const SUBAGENT_ENV_HINTS = [
  "PI_IS_SUBAGENT",
  "PI_SUBAGENT_SESSION_ID",
  "PI_AGENT_ROUTER_SUBAGENT",
  "PI_AGENT_ROUTER_PARENT_SESSION_ID",
];

/** Directory name prefix under os.tmpdir(). */
const DIR_PREFIX = "pi-yolo-bypass-";

/** Files to symlink from the original agent dir into per-process dir. */
const SYMLINK_TARGETS = ["agents", "settings.json", "mcp.json"] as const;

// ---------------------------------------------------------------------------
// Original agent dir resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the ORIGINAL (shared) agent directory — NOT the per-process override.
 * This is the real ~/.pi/agent/ that all processes share when yolo-bypass is off.
 */
function resolveOriginalAgentDir(): string {
  const home = homedir();
  return join(home, ".pi", "agent");
}

let cachedOriginalAgentDir: string | null = null;

/** Get the original (shared) agent dir path. */
export function getOriginalAgentDir(): string {
  if (!cachedOriginalAgentDir) {
    cachedOriginalAgentDir = resolveOriginalAgentDir();
  }
  return cachedOriginalAgentDir;
}

// ---------------------------------------------------------------------------
// Per-process directory management
// ---------------------------------------------------------------------------

/** The random token for this process invocation — generated once, never changes. */
const processToken = randomUUID();

/** The PID of this process. */
const processPid = process.pid;

/** The per-process directory path for this process. */
const myProcessDir = join(tmpdir(), `${DIR_PREFIX}${processPid}-${processToken}`);

/** Whether this process is a subagent (detected from env hints at startup). */
const isSubagent = SUBAGENT_ENV_HINTS.some(
  (key) => (process.env[key]?.trim()?.length ?? 0) > 0,
);

/** Whether we've already initialized the per-process directory. */
let initialized = false;

/**
 * Get the per-process policy directory for this process.
 * Must call initProcessDir() first (in extension factory).
 */
export function getProcessDir(): string {
  return myProcessDir;
}

/**
 * Detect whether we should copy policy from a parent process's directory.
 *
 * Three sources:
 *   1. PI_YOLO_BYPASS_PROCESS_DIR — our own env var, set by parent yolo-bypass.
 *      Points to a /tmp/pi-yolo-bypass-{parentPid}-{token}/ directory.
 *   2. PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR — may be set by parent or another extension.
 *      If it's a yolo-bypass dir with different PID, treat as parent.
 *   3. Neither set — fresh process, copy from original ~/.pi/agent/.
 *
 * Returns the source directory path, or null for "use original".
 */
function detectPolicySourceDir(): string | null {
  // Check our own env var first — most reliable for subagent inheritance
  const ourEnv = process.env[YOLO_BYPASS_PROCESS_DIR_ENV]?.trim();
  if (ourEnv && isYoloBypassDirForDifferentPid(ourEnv)) {
    return ourEnv;
  }

  // Check pi-permission-system env var — may be set by parent or another extension
  const policyEnv = process.env[POLICY_AGENT_DIR_ENV]?.trim();
  if (policyEnv && isYoloBypassDirForDifferentPid(policyEnv)) {
    return policyEnv;
  }

  // If PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR is set to a non-yolo-bypass dir,
  // respect it as the source but still create our own per-process dir.
  if (policyEnv && policyEnv !== getOriginalAgentDir()) {
    return policyEnv;
  }

  return null;
}

/**
 * Check if a directory path looks like a yolo-bypass per-process dir
 * belonging to a different PID.
 */
function isYoloBypassDirForDifferentPid(dirPath: string): boolean {
  const basename = dirPath.split("/").pop() ?? "";
  const match = basename.match(/^pi-yolo-bypass-(\d+)-([0-9a-f-]+)$/);
  if (!match) return false;

  const dirPid = Number(match[1]);
  return dirPid !== processPid;
}

/**
 * Clean up stale per-process directories from crashed predecessors with the same PID.
 *
 * A stale directory has the same PID but a different token — this means a previous
 * process with this PID crashed and left garbage. We can safely clean it because
 * no running process can have the same PID + different token simultaneously.
 */
function cleanupStaleDirs(): void {
  try {
    const tmpDirEntries = readdirSync(tmpdir());
    for (const entry of tmpDirEntries) {
      if (!entry.startsWith(DIR_PREFIX)) continue;

      const match = entry.match(/^pi-yolo-bypass-(\d+)-([0-9a-f-]+)$/);
      if (!match) continue;

      const dirPid = Number(match[1]);
      const dirToken = match[2];

      // Same PID but different token → stale (from crashed predecessor)
      if (dirPid === processPid && dirToken !== processToken) {
        try {
          rmSync(join(tmpdir(), entry), { recursive: true, force: true });
        } catch {
          // Best-effort cleanup — ignore failures
        }
      }
    }
  } catch {
    // readdirSync may fail on some tmpdir configurations — ignore
  }
}

/**
 * Create a symlink from the per-process dir to the original agent dir.
 * Handles both directories (agents/) and files (settings.json, mcp.json).
 * On Windows, uses junctions for directories if admin privileges are unavailable.
 */
function createSymlinkInProcessDir(originalPath: string, processDirPath: string): void {
  // Remove existing symlink/dir/file if present (from stale state)
  if (existsSync(processDirPath)) {
    try {
      rmSync(processDirPath, { recursive: true, force: true });
    } catch {
      // May fail if it's a symlink target that doesn't exist — try unlink
      try {
        rmSync(processDirPath, { force: true });
      } catch {
        // Ignore — will be overwritten by symlinkSync
      }
    }
  }

  const isDir = existsSync(originalPath) && lstatSync(originalPath).isDirectory();

  try {
    if (isDir) {
      // On Windows, directory symlinks need admin privileges.
      // Use junction (relative) as fallback — works without admin.
      if (process.platform === "win32") {
        symlinkSync(originalPath, processDirPath, "junction");
      } else {
        symlinkSync(originalPath, processDirPath);
      }
    } else {
      // File symlink — works on all platforms
      symlinkSync(originalPath, processDirPath);
    }
  } catch (err) {
    // Symlink creation may fail on Windows without admin privileges for files too.
    // Fallback: skip symlinks for missing files (settings.json, mcp.json may not exist).
    if (!existsSync(originalPath)) {
      // Original file doesn't exist — nothing to symlink, this is fine
      return;
    }
    // For existing files that can't be symlinked, copy as fallback
    if (!isDir) {
      try {
        copyFileSync(originalPath, processDirPath);
      } catch {
        // If even copy fails, just skip — pi-permission-system will handle missing files gracefully
      }
    }
  }
}

/**
 * Initialize the per-process policy directory.
 *
 * This must be called in the extension factory BEFORE pi-permission-system's
 * session_start handler rebuilds PermissionManager. The sequence is:
 *
 * 1. Clean up stale dirs from crashed predecessors (same PID, different token)
 * 2. Create per-process directory
 * 3. Determine policy source:
 *    - Subagent with parent dir → copy from parent's current policy
 *    - Fresh process → copy from original ~/.pi/agent/
 * 4. Copy policy file (and backup if parent has yolo ON)
 * 5. Symlink shared resources (agents/, settings.json, mcp.json)
 * 6. Set PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR env var
 * 7. Set PI_YOLO_BYPASS_PROCESS_DIR env var (for subagent inheritance)
 *
 * Returns the process dir path.
 */
export function initProcessDir(): string {
  if (initialized) return myProcessDir;

  // 1. Clean up stale directories from crashed predecessors
  cleanupStaleDirs();

  // 2. Remove our own directory if it somehow exists (shouldn't after cleanup)
  if (existsSync(myProcessDir)) {
    rmSync(myProcessDir, { recursive: true, force: true });
  }

  // 3. Create per-process directory
  mkdirSync(myProcessDir, { recursive: true });

  // 4. Determine policy source
  const parentDir = detectPolicySourceDir();
  const originalDir = getOriginalAgentDir();

  const policySourceDir = parentDir ?? originalDir;
  const sourcePolicyPath = join(policySourceDir, "pi-permissions.jsonc");

  // 5. Copy policy file
  const destPolicyPath = join(myProcessDir, "pi-permissions.jsonc");
  if (existsSync(sourcePolicyPath)) {
    copyFileSync(sourcePolicyPath, destPolicyPath);
  } else if (!isSubagent) {
    // Fresh process with no existing policy file — write a minimal default
    // so pi-permission-system can find something. Subagents shouldn't create
    // defaults; they should inherit whatever the parent has (even if missing).
    // Actually, if original policy doesn't exist, pi-permission-system will
    // fall back to "ask" defaults — we should not create a file.
  }

  // 6. Copy backup file if parent has yolo ON
  // This is critical for subagent inheritance — if parent is yolo-active,
  // the subagent needs the backup to be able to toggle OFF later.
  const sourceBackupPath = join(policySourceDir, "pi-permissions.jsonc.yolo-bak");
  const destBackupPath = join(myProcessDir, "pi-permissions.jsonc.yolo-bak");
  if (parentDir && existsSync(sourceBackupPath)) {
    copyFileSync(sourceBackupPath, destBackupPath);
  }

  // 7. Symlink shared resources to original agent dir
  for (const target of SYMLINK_TARGETS) {
    const originalPath = join(originalDir, target);
    const processPath = join(myProcessDir, target);
    // Only create symlink if the original exists. For agents/ dir, always create
    // it (even if dangling) because pi-permission-system expects to find it.
    // If originalPath doesn't exist for agents/, we create the dir instead.
    if (target === "agents") {
      if (existsSync(originalPath)) {
        createSymlinkInProcessDir(originalPath, processPath);
      } else {
        // Create agents/ as a real directory (empty) — pi-permission-system
        // may write to it later, and we don't want to pollute the original dir
        mkdirSync(processPath, { recursive: true });
      }
    } else if (existsSync(originalPath)) {
      createSymlinkInProcessDir(originalPath, processPath);
    }
  }

  // 8. Set env vars so pi-permission-system and future subagents find our dir
  process.env[POLICY_AGENT_DIR_ENV] = myProcessDir;
  process.env[YOLO_BYPASS_PROCESS_DIR_ENV] = myProcessDir;

  initialized = true;
  return myProcessDir;
}

/**
 * Clean up the per-process directory.
 *
 * This is ONLY safe to call when the process is about to exit.
 * During session shutdown, call disableBypass() instead to restore policy,
 * but leave the directory intact (pi-permission-system still references it).
 *
 * Called from process exit hooks. For crash scenarios, stale dirs are
 * cleaned by the next process with the same PID (cleanupStaleDirs).
 */
export function cleanupProcessDir(): void {
  if (!initialized || !existsSync(myProcessDir)) return;

  try {
    rmSync(myProcessDir, { recursive: true, force: true });
  } catch {
    // Best-effort — OS /tmp cleanup will handle leftovers
  }

  initialized = false;
}

/**
 * Check whether this process is a subagent.
 */
export function isSubagentProcess(): boolean {
  return isSubagent;
}

/**
 * Get the process token (for diagnostics).
 */
export function getProcessToken(): string {
  return processToken;
}