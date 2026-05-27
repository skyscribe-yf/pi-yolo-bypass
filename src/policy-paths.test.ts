import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isYoloBypassDir,
  isYoloBypassDirForDifferentPid,
  resolvePolicySourceDir,
  getOriginalAgentDir,
  POLICY_AGENT_DIR_ENV,
  YOLO_BYPASS_PROCESS_DIR_ENV,
} from "./policy-paths.js";

describe("isYoloBypassDir", () => {
  it("matches yolo-bypass dirs regardless of PID", () => {
    expect(isYoloBypassDir("/tmp/pi-yolo-bypass-1234-abc1-234d-5678")).toBe(true);
    expect(isYoloBypassDir("/tmp/pi-yolo-bypass-99999-dead-beef-1234")).toBe(true);
    expect(isYoloBypassDir("pi-yolo-bypass-1-a1b2-c3d4-e5f6")).toBe(true);
  });

  it("does not match non-yolo dirs", () => {
    expect(isYoloBypassDir("/tmp/pi-other-1234-uuid")).toBe(false);
    expect(isYoloBypassDir("/custom/policy")).toBe(false);
    expect(isYoloBypassDir("/home/user/.pi/agent")).toBe(false);
    expect(isYoloBypassDir("")).toBe(false);
  });

  it("does not match similar-looking names", () => {
    expect(isYoloBypassDir("/tmp/pi-yolo-bypass-123")).toBe(false); // no token
    expect(isYoloBypassDir("/tmp/pi-yolo-bypass-123-")).toBe(false); // empty token
    expect(isYoloBypassDir("/tmp/pi-yolo-bypass--abc")).toBe(false); // no pid
  });
});

describe("isYoloBypassDirForDifferentPid", () => {
  it("matches yolo dir with different PID", () => {
    const differentPid = process.pid + 1;
    expect(
      isYoloBypassDirForDifferentPid(`/tmp/pi-yolo-bypass-${differentPid}-abc1-234d-5678`),
    ).toBe(true);
  });

  it("does not match yolo dir with same PID", () => {
    expect(
      isYoloBypassDirForDifferentPid(`/tmp/pi-yolo-bypass-${process.pid}-uuid`),
    ).toBe(false);
  });

  it("does not match non-yolo dir", () => {
    expect(isYoloBypassDirForDifferentPid("/custom/policy")).toBe(false);
  });
});

describe("resolvePolicySourceDir (main process)", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv[POLICY_AGENT_DIR_ENV] = process.env[POLICY_AGENT_DIR_ENV];
    savedEnv[YOLO_BYPASS_PROCESS_DIR_ENV] = process.env[YOLO_BYPASS_PROCESS_DIR_ENV];
    delete process.env[POLICY_AGENT_DIR_ENV];
    delete process.env[YOLO_BYPASS_PROCESS_DIR_ENV];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("falls back to original agent dir when no env vars are set", () => {
    expect(resolvePolicySourceDir()).toBe(getOriginalAgentDir());
  });

  it("respects custom policy dir when PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR is set", () => {
    process.env[POLICY_AGENT_DIR_ENV] = "/custom/policy";
    expect(resolvePolicySourceDir()).toBe("/custom/policy");
  });

  it("ignores stale yolo dir in PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR (different PID)", () => {
    const stalePid = process.pid + 1;
    process.env[POLICY_AGENT_DIR_ENV] = `/tmp/pi-yolo-bypass-${stalePid}-abc1-234d-5678`;
    expect(resolvePolicySourceDir()).toBe(getOriginalAgentDir());
  });

  it("ignores stale yolo dir in PI_PERMISSION_SYSTEM_POLICY_AGENT_DIR (same PID)", () => {
    process.env[POLICY_AGENT_DIR_ENV] = `/tmp/pi-yolo-bypass-${process.pid}-abc1-234d-5678`;
    expect(resolvePolicySourceDir()).toBe(getOriginalAgentDir());
  });

  it("ignores stale yolo dir in PI_YOLO_BYPASS_PROCESS_DIR_ENV", () => {
    const stalePid = process.pid + 1;
    process.env[YOLO_BYPASS_PROCESS_DIR_ENV] = `/tmp/pi-yolo-bypass-${stalePid}-abc1-234d-5678`;
    expect(resolvePolicySourceDir()).toBe(getOriginalAgentDir());
  });

  it("prefers custom policy dir over stale yolo env var", () => {
    const stalePid = process.pid + 1;
    process.env[YOLO_BYPASS_PROCESS_DIR_ENV] = `/tmp/pi-yolo-bypass-${stalePid}-uuid`;
    process.env[POLICY_AGENT_DIR_ENV] = "/custom/policy";
    expect(resolvePolicySourceDir()).toBe("/custom/policy");
  });
});
