import { existsSync } from "node:fs";
import { join } from "node:path";

import { getProcessDir } from "./policy-paths.js";

/**
 * Per-process bypass status tracking.
 *
 * Bypass state is derived from the filesystem state of the per-process directory:
 * - If `pi-permissions.jsonc.yolo-bak` exists in our per-process dir → bypass is ON
 * - If no backup exists → bypass is OFF
 *
 * This is naturally isolated: each process has its own directory, so each process
 * has independent bypass state.
 */

/**
 * Check whether yolo bypass is currently active for this process.
 * Active = backup file exists in our per-process directory.
 */
export function isBypassActive(): boolean {
  return existsSync(join(getProcessDir(), "pi-permissions.jsonc.yolo-bak"));
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
 * Variation Selector-16 (U+FE0F) — forces emoji presentation.
 * Without this, fontconfig on Linux (especially under CJK locales like zh_CN)
 * may resolve lock emoji to Noto Sans Symbols 2 (monochrome, nearly invisible)
 * instead of Noto Color Emoji (clearly visible color glyphs).
 * VTE/gnome-terminal respects VS16 to prefer the color emoji font.
 */
const EMOJI_VS16 = "\uFE0F";

/**
 * Returns a status string for the pi-permission-system status line.
 */
export function formatStatus(): string {
  return isBypassActive() ? `🔓${EMOJI_VS16} BYPASS` : `🔒${EMOJI_VS16}`;
}