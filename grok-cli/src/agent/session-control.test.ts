import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase } from "../storage/db";
import { Agent } from "./agent";

const originalHome = process.env.HOME;

describe("Agent session control", () => {
  let tempHome = "";

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "grok-agent-session-"));
    process.env.HOME = tempHome;
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);
    closeDatabase();
  });

  afterEach(() => {
    closeDatabase();
    vi.restoreAllMocks();
    process.env.HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it("forks the current session and can switch back within the workspace", async () => {
    const agent = new Agent(undefined);
    const originalId = agent.getSessionId();
    expect(originalId).toBeTruthy();

    const fork = agent.forkSession();
    expect(fork.session.id).not.toBe(originalId);
    expect(agent.listRecentSessions(6).map((session) => session.id)).toContain(originalId);

    const switched = agent.switchSession(originalId!);
    expect(switched.session.id).toBe(originalId);
    expect(agent.getSessionId()).toBe(originalId);
    await agent.cleanup();
  });
});
