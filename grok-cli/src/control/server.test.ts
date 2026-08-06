import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalControlServer } from "./server";
import { ControlActionError } from "./types";

class JsonLineReader {
  private buffer = "";
  private readonly values: unknown[] = [];
  private readonly waiters: Array<(value: unknown) => void> = [];

  constructor(socket: net.Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (line.trim()) this.push(JSON.parse(line));
        newline = this.buffer.indexOf("\n");
      }
    });
  }

  next(): Promise<unknown> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve(value);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private push(value: unknown): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(value);
    else this.values.push(value);
  }
}

const servers: LocalControlServer[] = [];
const sockets: net.Socket[] = [];
const tempDirectories: string[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) await server.close();
  for (const directory of tempDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function createServer() {
  const tempRoot = process.platform === "darwin" ? "/private/tmp" : os.tmpdir();
  const root = fs.mkdtempSync(path.join(tempRoot, "grok-ctl-"));
  tempDirectories.push(root);
  const server = new LocalControlServer({
    sessionId: "session-one",
    cwd: "/tmp/project",
    pid: 4242,
    token: "a".repeat(64),
    socketDirectory: root,
    registrationDirectory: path.join(root, "registrations"),
    terminal: { termProgram: null, tmuxPane: null, tty: null },
  });
  servers.push(server);
  return server;
}

async function connect(server: LocalControlServer): Promise<{ socket: net.Socket; reader: JsonLineReader }> {
  const socket = net.createConnection(server.socketPath);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  return { socket, reader: new JsonLineReader(socket) };
}

describe("LocalControlServer", () => {
  it("publishes a private discovery record and socket", async () => {
    const server = createServer();
    const registration = await server.start();

    expect(registration.protocolVersion).toBe(1);
    expect(registration.sessionId).toBe("session-one");
    expect(registration.sessions).toEqual([]);
    expect(registration.terminal).toEqual({ termProgram: null, tmuxPane: null, tty: null });
    expect(fs.statSync(server.socketPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(server.registrationPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(server.registrationPath)).mode & 0o777).toBe(0o700);
    expect(JSON.parse(fs.readFileSync(server.registrationPath, "utf8"))).toEqual(registration);
  });

  it("authenticates, replays lifecycle events, and dispatches actions in order", async () => {
    const server = createServer();
    await server.start();
    server.emitEvent({ type: "session.opened", sessionId: "session-one", cwd: "/tmp/project", mode: "agent" });
    server.setActionHandler(async (action) => {
      if (action.type === "thread.fork") throw new ControlActionError("unsupported", "Thread fork is unavailable.");
      return { action: action.type };
    });
    const { socket, reader } = await connect(server);

    socket.write(`${JSON.stringify({ version: 1, type: "authenticate", token: server.token })}\n`);
    expect(await reader.next()).toMatchObject({ type: "ready", sessionId: "session-one" });
    expect(await reader.next()).toMatchObject({ type: "event", seq: 1, event: { type: "session.opened" } });

    socket.write(`${JSON.stringify({ version: 1, type: "action", id: "one", action: { type: "composer.submit" } })}\n`);
    expect(await reader.next()).toEqual({
      version: 1,
      type: "result",
      id: "one",
      ok: true,
      data: { action: "composer.submit" },
    });

    socket.write(`${JSON.stringify({ version: 1, type: "action", id: "two", action: { type: "thread.fork" } })}\n`);
    expect(await reader.next()).toMatchObject({
      type: "result",
      id: "two",
      ok: false,
      error: { code: "unsupported" },
    });
  });

  it("rejects unauthenticated clients and updates session discovery", async () => {
    const server = createServer();
    await server.start();
    const { socket, reader } = await connect(server);

    socket.write(`${JSON.stringify({ version: 1, type: "authenticate", token: "wrong" })}\n`);
    expect(await reader.next()).toMatchObject({ type: "protocol_error", error: { code: "unauthorized" } });

    server.updateSession("session-two", "/tmp/other");
    server.updateSessions([{ id: "session-two", title: "Other", mode: "plan", updatedAt: "2026-08-04T00:00:00.000Z" }]);
    expect(JSON.parse(fs.readFileSync(server.registrationPath, "utf8"))).toMatchObject({
      sessionId: "session-two",
      cwd: "/tmp/other",
      sessions: [{ id: "session-two", title: "Other", mode: "plan" }],
    });
  });
});
