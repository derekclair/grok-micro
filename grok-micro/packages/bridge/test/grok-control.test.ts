import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverControlRoutes, sendControlAction, subscribeControlRoute, UnsupportedActionError, wireActionFor } from "../src/grok-control";

test("maps only exact Grok actions and rejects approximations", () => {
  assert.deepEqual(wireActionFor("composer.submit"), { type: "composer.submit" });
  assert.throws(() => wireActionFor("composer.toggleFastMode"), UnsupportedActionError);
  assert.deepEqual(wireActionFor("composer.togglePlanMode"), { type: "composer.togglePlanMode" });
  assert.deepEqual(wireActionFor("approval.approve"), { type: "approval.respond", decision: "approve" });
  assert.deepEqual(wireActionFor("thread.fork"), { type: "thread.fork" });
  assert.deepEqual(wireActionFor("thread.select", "s"), { type: "thread.select", sessionId: "s" });
  assert.deepEqual(wireActionFor("reasoning.increase"), { type: "reasoning.adjust", direction: "increase" });
  assert.deepEqual(wireActionFor("reasoning.decrease"), { type: "reasoning.adjust", direction: "decrease" });
  assert.deepEqual(wireActionFor("conversation.scrollUp"), { type: "conversation.scroll", direction: "up" });
  assert.deepEqual(wireActionFor("conversation.scrollDown"), { type: "conversation.scroll", direction: "down" });
  assert.deepEqual(wireActionFor("conversation.scrollBottom"), { type: "conversation.scroll", direction: "bottom" });
  assert.throws(() => wireActionFor("navigation.forward"), UnsupportedActionError);
});

test("authenticates before routing an action over NDJSON", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grok-control-test-"));
  const socketPath = path.join(directory, "control.sock");
  const token = "0123456789abcdef0123456789abcdef";
  const received: unknown[] = [];
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let body = "";
    socket.on("data", (chunk: string) => {
      body += chunk;
      const lines = body.split("\n");
      body = lines.pop() ?? "";
      for (const line of lines) {
        const message = JSON.parse(line);
        received.push(message);
        if (message.type === "authenticate") socket.write(`${JSON.stringify({ version: 1, type: "ready", sessionId: "s" })}\n`);
        if (message.type === "action") socket.write(`${JSON.stringify({ version: 1, type: "result", id: message.id, ok: true })}\n`);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  context.after(() => { server.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  await sendControlAction({ socketPath, token }, "composer.submit", { requestId: "r1" });
  assert.equal((received[0] as { type: string }).type, "authenticate");
  assert.deepEqual(received[1], { version: 1, type: "action", id: "r1", action: { type: "composer.submit" } });
});

test("discovery fails closed on weak permissions", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grok-discovery-test-"));
  fs.chmodSync(directory, 0o700);
  const socketPath = path.join(directory, "s.sock");
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  fs.chmodSync(socketPath, 0o600);
  context.after(() => { server.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const recordPath = path.join(directory, `${process.pid}.json`);
  fs.writeFileSync(recordPath, JSON.stringify({
    protocolVersion: 1, pid: process.pid, sessionId: "s", cwd: directory, socketPath,
    token: "0123456789abcdef", createdAt: Date.now(),
    sessions: [{ id: "older", updatedAt: 1 }], terminal: { termProgram: "iTerm.app", tmuxPane: "%1", tty: "ttys001" },
  }), { mode: 0o644 });
  assert.equal(discoverControlRoutes(directory).size, 0);
  fs.chmodSync(recordPath, 0o600);
  assert.equal(discoverControlRoutes(directory).get("s")?.socketPath, socketPath);
  assert.equal(discoverControlRoutes(directory).get("older")?.terminal?.tty, "ttys001");
});

test("persistent subscription authenticates once and receives replay/live events", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grok-subscribe-test-"));
  const socketPath = path.join(directory, "control.sock");
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.once("data", () => {
      socket.write(`${JSON.stringify({ version: 1, type: "ready", sessionId: "s" })}\n`);
      socket.write(`${JSON.stringify({ version: 1, type: "event", seq: 1, event: { type: "turn.started", sessionId: "s" } })}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  context.after(() => { server.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const event = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const subscription = subscribeControlRoute({ socketPath, token: "0123456789abcdef" }, (value) => {
      subscription.close();
      resolve(value);
    }, reject);
  });
  assert.deepEqual(event, { type: "turn.started", sessionId: "s" });
});
