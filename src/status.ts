import { existsSync } from "node:fs";
import { join } from "node:path";

import { getAgentDir } from "./policy-paths.js";

/**
 * We track bypass state by checking for the backup file.
 * If the backup exists, the real policy has been replaced by the all-allow file.
 */
export function isBypassActive(): boolean {
  return existsSync(join(getAgentDir(), "pi-permissions.jsonc.yolo-bak"));
}

/**
 * Compatibility stubs: since bypass state is derived from filesystem state,
 * we don't need explicit in-memory tracking. The backup file IS the state.
 */
export function markBypassActive(): void {
  // No-op: the backup file IS the state marker
}

export function markBypassInactive(): void {
  // No-op: no backup means bypass is inactive
}

/**
 * Returns a status string for the pi-permission-system status line.
 */
export function formatStatus(): string | undefined {
  return isBypassActive() ? "🔓 BYPASS" : undefined;
}
