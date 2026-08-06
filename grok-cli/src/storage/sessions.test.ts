import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase } from "./db";
import { SessionStore } from "./sessions";

const originalHome = process.env.HOME;

describe("SessionStore recap persistence", () => {
  const tempRoot = path.join(process.cwd(), ".tmp-session-tests");
  let tempHome = "";
  let tempCwd = "";

  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    tempHome = fs.mkdtempSync(path.join(tempRoot, "grok-session-home-"));
    tempCwd = fs.mkdtempSync(path.join(tempRoot, "grok-session-cwd-"));
    process.env.HOME = tempHome;
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);
    closeDatabase();
  });

  afterEach(() => {
    vi.useRealTimers();
    closeDatabase();
    vi.restoreAllMocks();
    process.env.HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(tempCwd, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("stores and reloads the latest recap metadata with the session", () => {
    const store = new SessionStore(tempCwd);
    const session = store.createSession("grok-4.3", "agent", tempCwd);
    const updatedAt = new Date("2026-04-22T15:00:00.000Z");

    store.setRecap(session.id, {
      text: "Migrated billing sessions to the new schema. Next step is wiring the prompt banner.",
      model: "grok-4.20-non-reasoning",
      updatedAt,
    });

    expect(store.getRequiredSession(session.id).recap).toEqual({
      text: "Migrated billing sessions to the new schema. Next step is wiring the prompt banner.",
      model: "grok-4.20-non-reasoning",
      updatedAt,
    });
  });

  it("clears recap metadata when the recap is removed", () => {
    const store = new SessionStore(tempCwd);
    const session = store.createSession("grok-4.3", "agent", tempCwd);

    store.setRecap(session.id, {
      text: "Temporary recap",
      model: "grok-4.20-non-reasoning",
      updatedAt: new Date("2026-04-22T15:00:00.000Z"),
    });
    store.setRecap(session.id, null);

    expect(store.getRequiredSession(session.id).recap).toBeNull();
  });

  it("lists only recent active sessions for the current workspace", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T12:00:00.000Z"));
    const store = new SessionStore(tempCwd);
    const first = store.createSession("grok-4.3", "agent", tempCwd);
    vi.setSystemTime(new Date("2026-08-04T12:00:01.000Z"));
    const second = store.createSession("grok-4.3", "plan", tempCwd);
    store.setTitle(second.id, "Most recent");

    const sessions = store.listRecentSessions(1);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: second.id, title: "Most recent", mode: "plan" });
    expect(sessions[0]?.id).not.toBe(first.id);
  });
});
