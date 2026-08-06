import { execFile } from "node:child_process";
import type { ControlRoute } from "./state";

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr.trim() || error.message));
    else resolve(stdout.trim());
  }));
}

export function normalizeTty(value: string): string | null {
  const name = value.trim();
  if (!name || name === "??" || !/^[A-Za-z0-9._/-]{1,64}$/.test(name)) return null;
  return name.startsWith("/dev/") ? name : `/dev/${name}`;
}

/** Deterministic macOS terminal focus by the registered Grok process' tty. */
export async function focusTerminalRoute(route: ControlRoute): Promise<void> {
  if (process.platform !== "darwin") throw Object.assign(new Error("Exact app focus is supported only on macOS."), { code: "unsupported" });
  if (!route.pid && !route.terminal?.tty) throw Object.assign(new Error("Grok control discovery did not publish a process id or tty."), { code: "unavailable" });
  const tty = normalizeTty(route.terminal?.tty ?? await run("/bin/ps", ["-o", "tty=", "-p", String(route.pid)]));
  if (!tty) throw Object.assign(new Error("The Grok process has no identifiable local terminal tty."), { code: "unavailable" });
  const script = `on run argv
  set wantedTTY to item 1 of argv
  if application "iTerm" is running then
    tell application "iTerm"
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if (tty of s) is wantedTTY then
              select w
              select t
              select s
              activate
              return "focused"
            end if
          end repeat
        end repeat
      end repeat
    end tell
  end if
  if application "Terminal" is running then
    tell application "Terminal"
      repeat with w in windows
        repeat with t in tabs of w
          if tty of t is wantedTTY then
            set selected tab of w to t
            set index of w to 1
            activate
            return "focused"
          end if
        end repeat
      end repeat
    end tell
  end if
  error "No Terminal or iTerm tab matched tty " & wantedTTY
end run`;
  const result = await run("/usr/bin/osascript", ["-e", script, tty]);
  if (result !== "focused") throw Object.assign(new Error(`No terminal tab matched ${tty}.`), { code: "unavailable" });
}
