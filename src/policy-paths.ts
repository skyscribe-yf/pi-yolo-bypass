/**
 * Resolves pi's agent directory (same as pi-permission-system).
 * Policy files live at <agentDir>/pi-permissions.jsonc.
 */

let cachedAgentDir: string | null = null;

function resolveAgentDir(): string {
  // pi-permission-system resolves the policy dir from PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR,
  // falling back to PI_CODING_AGENT_DIR, then ~/.pi/agent.
  // We follow the same resolution order.
  const override = process.env["PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR"]?.trim()
    ?? process.env["PI_CODING_AGENT_DIR"]?.trim();

  if (override) {
    return override;
  }

  const home = process.env["HOME"] || process.env["USERPROFILE"] || "/tmp";
  return `${home}/.pi/agent`;
}

export function getAgentDir(): string {
  if (!cachedAgentDir) {
    cachedAgentDir = resolveAgentDir();
  }
  return cachedAgentDir;
}
