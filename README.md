# 🔓 pi-yolo-bypass

**Dynamic full-permission bypass toggle for [pi-permission-system](https://github.com/MasuRii/pi-permission-system).**

When you need to temporarily grant the agent free rein — bypassing *all* `deny` rules, including dangerous commands like `rm -rf`, `sudo`, and external directory access restrictions — toggle bypass mode with a single command or keyboard shortcut. When you're done, restore your original granular policy file instantly.

## How it works

Instead of modifying the permission system's internal state, this extension **atomically replaces** the `pi-permissions.jsonc` policy file with an all-allow version. The original is backed up to `pi-permissions.jsonc.yolo-bak`. pi-permission-system's file-stamp cache detects the change on the next permission check — no `/reload` needed.

| Action | What happens |
|--------|-------------|
| `/yolo-bypass on` | Backup → write all-allow policy → 🔓 ACTIVE |
| `/yolo-bypass off` | Remove bypass → restore backup → 🔒 INACTIVE |
| `/yolo-bypass` (toggle) | Switches between on/off |
| `/yolo-bypass status` | Shows state, policy path, and backup status |
| `/yolo-bypass force-off` | Emergency recovery if backup is lost |
| `Ctrl+Shift+Y` | Quick toggle from anywhere |

## Installation

```bash
pi install npm:pi-yolo-bypass
```

Or from git:

```bash
pi install git:github.com/skyscribe/pi-yolo-bypass
```

## Requirements

- [pi-permission-system](https://github.com/MasuRii/pi-permission-system) must be installed and configured
- A `pi-permissions.jsonc` policy file must exist in pi's agent directory

## Recovery

If something goes wrong, your original policy is always at `pi-permissions.jsonc.yolo-bak`. Rename it back manually and run `/reload`:

```bash
mv ~/.pi/agent/pi-permissions.jsonc.yolo-bak ~/.pi/agent/pi-permissions.jsonc
```

Or use the built-in force-restore: `/yolo-bypass force-off`

## License

MIT
