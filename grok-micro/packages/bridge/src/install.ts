import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FALLBACK_EVENTS = Object.freeze([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "StopFailure",
  "SessionEnd",
]);

type Settings = Record<string, unknown>;

export function fallbackCommand(eventScript = fileURLToPath(new URL("./event.js", import.meta.url))): string {
  return `node ${JSON.stringify(path.resolve(eventScript))}`;
}

function isOurHook(value: unknown, command: string): boolean {
  if (!value || typeof value !== "object") return false;
  const hook = value as { type?: unknown; command?: unknown };
  return hook.type === "command" && hook.command === command;
}

export function mergeFallbackHooks(input: Settings, command: string): Settings {
  const settings = structuredClone(input);
  const hooks = settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
    ? settings.hooks as Record<string, unknown>
    : (settings.hooks = {}) as Record<string, unknown>;
  for (const event of FALLBACK_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] as Array<Record<string, unknown>> : [];
    const alreadyInstalled = groups.some((group) => Array.isArray(group.hooks) && group.hooks.some((hook) => isOurHook(hook, command)));
    if (!alreadyInstalled) groups.push({ hooks: [{ type: "command", command, timeout: 10 }] });
    hooks[event] = groups;
  }
  return settings;
}

export function removeFallbackHooks(input: Settings, command: string): Settings {
  const settings = structuredClone(input);
  if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) return settings;
  const hooks = settings.hooks as Record<string, unknown>;
  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue;
    const groups = (hooks[event] as Array<Record<string, unknown>>).flatMap((group) => {
      if (!Array.isArray(group.hooks)) return [group];
      const remaining = group.hooks.filter((hook) => !isOurHook(hook, command));
      return remaining.length ? [{ ...group, hooks: remaining }] : [];
    });
    if (groups.length) hooks[event] = groups;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  return settings;
}

function writeSettings(target: string, settings: Settings): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, target);
}

function main(args: string[]): void {
  const uninstall = args.includes("--uninstall");
  const pathIndex = args.indexOf("--settings");
  const target = pathIndex >= 0 && args[pathIndex + 1]
    ? path.resolve(args[pathIndex + 1])
    : process.env.GROK_SETTINGS_PATH ?? path.join(os.homedir(), ".grok", "user-settings.json");
  let current: Settings = {};
  try {
    current = JSON.parse(fs.readFileSync(target, "utf8")) as Settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const command = fallbackCommand();
  const next = uninstall ? removeFallbackHooks(current, command) : mergeFallbackHooks(current, command);
  writeSettings(target, next);
  console.log(`${uninstall ? "Removed" : "Installed"} grok-micro fallback hooks in ${target}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
