// src/install.ts
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
var FALLBACK_EVENTS = Object.freeze([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "StopFailure",
  "SessionEnd"
]);
function fallbackCommand(eventScript = fileURLToPath(new URL("./event.js", import.meta.url))) {
  return `node ${JSON.stringify(path.resolve(eventScript))}`;
}
function isOurHook(value, command) {
  if (!value || typeof value !== "object") return false;
  const hook = value;
  return hook.type === "command" && hook.command === command;
}
function mergeFallbackHooks(input, command) {
  const settings = structuredClone(input);
  const hooks = settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks) ? settings.hooks : settings.hooks = {};
  for (const event of FALLBACK_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    const alreadyInstalled = groups.some((group) => Array.isArray(group.hooks) && group.hooks.some((hook) => isOurHook(hook, command)));
    if (!alreadyInstalled) groups.push({ hooks: [{ type: "command", command, timeout: 10 }] });
    hooks[event] = groups;
  }
  return settings;
}
function removeFallbackHooks(input, command) {
  const settings = structuredClone(input);
  if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) return settings;
  const hooks = settings.hooks;
  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue;
    const groups = hooks[event].flatMap((group) => {
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
function writeSettings(target, settings) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 448 });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}
`, { mode: 384, flag: "wx" });
  fs.renameSync(temporary, target);
}
function main(args) {
  const uninstall = args.includes("--uninstall");
  const pathIndex = args.indexOf("--settings");
  const target = pathIndex >= 0 && args[pathIndex + 1] ? path.resolve(args[pathIndex + 1]) : process.env.GROK_SETTINGS_PATH ?? path.join(os.homedir(), ".grok", "user-settings.json");
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const command = fallbackCommand();
  const next = uninstall ? removeFallbackHooks(current, command) : mergeFallbackHooks(current, command);
  writeSettings(target, next);
  console.log(`${uninstall ? "Removed" : "Installed"} grok-micro fallback hooks in ${target}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
export {
  FALLBACK_EVENTS,
  fallbackCommand,
  mergeFallbackHooks,
  removeFallbackHooks
};
