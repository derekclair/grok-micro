# Codex Micro native parity contract

Clean-room interoperability contract derived from observable behavior in Codex desktop `26.727.51351` (build `6119`). Do not import or redistribute the bundled proprietary Work Louder packages. The executable examples are in `native-parity-fixtures.json`.

## 1. Device and transport

| Constant | Value |
|---|---:|
| Work Louder VID | `0x303A` (`12346`) |
| Codex Micro PID | `0x8360` (`33632`) |
| Creator Micro V2 compatible PIDs | `33431`, `33432` |
| Vendor usage page | `0xFF00` (`65280`) |
| HID report ID | `6` |
| RPC channel | `2` |
| Report length | `64` bytes |
| Header | `[reportId, channel, chunkLength]` |
| Maximum payload | `61` UTF-8 bytes/report |

On macOS, open asynchronously and non-exclusively. Prefer USB candidates, then Bluetooth; within a transport prefer Codex Micro, then Creator Micro V2. Present transport as `usb`, `bluetooth`, or `unknown`.

Requests are JSON `{method, params, id}` with random integer ID `0..998`; no `jsonrpc` member. Escape non-ASCII as JSON Unicode escapes. Fragment consecutive 61-byte chunks. Serialize requests through one queue, wait 50 ms between jobs, and fail a response after 10 seconds. Retry one timeout immediately.

Notifications accept long or compact fields: `method|m`, `params|p`, `id|i`. The required methods are:

- `device.status` → `{version, profile_index, layer_index, battery, is_charging}`
- `v.oai.thstatus` → agent lighting array
- `v.oai.rgbcfg` → global `keys` and `ambient` zones
- `v.oai.hid` ← `{k, act, ag?}`
- `v.oai.rad` ← `{a, d}`

`act`: release `0`, press `1`, encoder detent `2`.

## 2. Connection state machine

Public state:

```text
not-detected → detected → connected
                    ↘ error
connected → error(transport-unavailable) → connected
connected → not-detected
```

State object fields are `status`, `transport`, `model`, `error`, `battery`. Errors are `discovery-failed`, `connection-failed`, or `transport-unavailable`; models are `codex-micro` and `creator-micro-v2`.

Timings:

- transport/lighting recovery: 1 s, 2 s, 5 s, then 10 s repeatedly;
- topology settle scans: 250 ms, 1 s, 3 s;
- fallback scan without watcher: every 30 s;
- battery refresh: every 60 s;
- input-quiet debounce before lighting/battery writes: 100 ms.

Visible lifecycle transitions are `connected`, `connection-failed`, `connection-lost`, and `reconnected`. During transport handoff, do not emit a disconnect unless handoff fails.

Only the primary window owns the device model and may publish lighting/assignments. Route HID/joystick only to it. Clear ownership and discard hardware input while the OS session is locked.

## 3. Status derivation and precedence

Local task status is the first matching condition:

1. task status `error` → `error`
2. pending chip `approval` → `awaiting-approval`
3. pending chip `response` → `awaiting-response`
4. task status `loading` → `working`
5. unread flag → `unread`
6. otherwise → `idle`

Remote task status:

1. latest turn `failed` → `error`
2. latest turn `pending` or `in_progress` → `working`
3. unread flag → `unread`
4. otherwise → `idle`

When the selected local task is unread and the app window is focused, render it as `idle`; selection itself acknowledges unread visually.

Lighting precedence is independent:

1. `snakingAmbientStatus`, if present, fully owns ambient and turns typing-key lighting off;
2. voice state owns ambient;
3. selected-task accent applies;
4. otherwise both global zones are off.

For agent keys, `off` always wins. Otherwise `selected || pulsing` changes the effect from solid to breath.

## 4. Lighting constants and snapshots

| State | RGB | Decimal |
|---|---:|---:|
| working | `#304FFE` | `3166206` |
| unread | `#00FF4C` | `65356` |
| idle | `#FFFFFF` | `16777215` |
| awaiting approval/response | `#FF6D00` | `16739584` |
| error | `#FF0033` | `16711731` |
| off | `#000000` | `0` |

Effects: off `0`, solid `1`, snake `2`, rainbow `3`, breath `4`, gradient `5`, shallow breath `6`.

Agent entry wire fields are `{id,c,b,e,s,sk,sa}`. Normal assigned keys are solid at speed `0`; selected/pulsing keys breathe at speed `0.4`; `sk=0`, `sa=0`. Global brightness multiplies only through the transmitted `b` value.

On selection change, show a four-second selection accent: selected color on ambient (snake for working, otherwise solid) and solid typing-key backlight. After four seconds, turn typing keys off; working ambient remains snake, while non-working ambient turns off.

Voice ambient:

- recording: snake `#2E8B57`, speed `0.4`;
- processing: snake white, speed `0.4`;
- completed: solid white;
- idle: no override.

Auto-dim sends both global zones and all six agents off. HID always restores/reschedules; joystick does so only above distance `0.1`; any new lighting model also restores/reschedules. Default brightness is 100%; default auto-dim is 3 minutes. Other choices: off, 30 s, 1/10/30 min, and 1 h.

## 5. Default controls

Agent keys are `AG00..AG05`. Action positions are `ACT06..ACT12`. The wide microphone key reports ACT10 and ACT11; ignore ACT11 and bind ACT10.

| Position | Keycap | Action |
|---|---|---|
| ACT06 | FAST | `composer.toggleFastMode` |
| ACT07 | APPR | `approval.approve` |
| ACT08 | REJ | `approval.decline` |
| ACT09 | SPLIT | `forkThread` |
| ACT10/11 | MIC | push-to-talk |
| ACT12 | CODEX | `composer.submit` |

Agent source is `recent` by default. Alternatives are `pinned`, `priority`, and `custom`. Custom assignments may be a task, command, swappable keycap behavior, or skill. Default `singleTapAgentKeys=false`.

Default analog mapping:

- up → `composer.togglePlanMode`
- right → `navigateForward`
- down → `toggleSidebar`
- left → `navigateBack`

Default encoder mode is `composer-navigation`; alternatives are `reasoning`, `conversation-scroll`, and `custom`. Default custom encoder gestures are all null. Default microphone mode is `push-to-talk`.

## 6. Gesture timelines

### Agent key

- Press emits the assigned navigation/action.
- A second press on the same slot and same displayed thread key within 350 ms brings the primary window forward.
- With `singleTapAgentKeys=true`, the first press also brings it forward.
- Custom action slots execute on the first press.
- Associate a press with the thread key from the last successfully displayed lighting model, not a newer unrendered model.

### Push-to-talk microphone

- `t=0 press` → start.
- Release at or after `350 ms` → stop immediately.
- Release before `350 ms` → wait until 350 ms, then stop.
- Second press before the deadline → latch; releases do nothing.
- Press while latched → stop, then suppress new presses for 350 ms.

Voice Chat mode uses a 500 ms threshold: short press toggles mute or starts Voice Chat; long press ends the call.

### Encoder

- `ENC_CW act=2` → ArrowUp; `ENC_CC act=2` → ArrowDown.
- In composer navigation: CW previous, CC next, click activate.
- In reasoning: CW decrease effort, CC increase effort, click opens slider/options.
- In conversation scrolling: CW scroll up 160 px, CC down 160 px, click bottom.
- Press/release shorter than 500 ms is click. Hold 500 ms is long press; non-custom modes open `/settings/codex-micro`.
- Composer highlight persists 2 s.

### Analog stick

The stick activates at distance `>=0.5`, returns to neutral below `0.5`, and fires only when cardinal direction changes.

| Direction | Angle range |
|---|---|
| down | `[0.125, 0.375)` |
| left | `[0.375, 0.625)` |
| up | `[0.625, 0.875)` |
| right | remaining normalized angles |

Show joystick feedback for 600 ms after activity.

## 7. Acceptance requirements

An implementation passes native parity only when every case in `native-parity-fixtures.json` passes plus real-device smoke tests:

1. device enumeration, USB preference, non-exclusive open, fragmentation/reassembly, compact notification parsing, timeout/retry/queue pacing;
2. every public device state, reconnect/handoff transition, locked-session suppression, owner-window routing;
3. exact status precedence, palette/effects, four-second selection accent, voice precedence, 100 ms quiet window, and auto-dim restore;
4. exact factory controls, ACT11 suppression, 350 ms agent/PTT gestures, 500 ms long presses, encoder modes, and joystick sectors;
5. settings defaults and options, including macOS Input Monitoring and Creator Micro compatibility.

Public clean-room references may be used for implementation patterns, but native behavior and the fixtures in this directory are the acceptance authority.
