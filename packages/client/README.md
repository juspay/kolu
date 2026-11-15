# kolu-client

The browser app: the single-page SolidJS shell a kolu server serves. It dials
one reconnecting websocket, draws the terminals of every host kolu knows, and
holds the Conductor, the Code browser, the dock and the command palette.

Private and not importable. It has no `exports`; it builds to `dist` with Vite,
and the server ships that build. `vite build` needs `KOLU_FONTS_DIR` set, and
`just dev` reads `KOLU_DEV_SERVER_PORT` / `KOLU_DEV_CLIENT_PORT` so a second
instance can run beside a primary one.

Scripts: `dev`, `build`, `typecheck`, `test:unit` (Vitest, with happy-dom where
a test renders).

## What it depends on

The contract comes from `kolu-common` and `@kolu/padi-client`; the wire and the
app shell from `@kolu/surface`, `@kolu/surface-app` and `@kolu/surface-map`.
The drawing comes from `solid-js`, `@xterm/xterm`, the `@kolu/solid-*`
components and `@kolu/theme`. Nothing depends on this package.

## Layout under `src`

`index.tsx` mounts the app, or the Conductor reader window when the hash asks
for it. `App.tsx` is the shell: layout and wiring only. State belongs in a
`useXxx` singleton, and `App.shell.test.ts` holds the shell thin. `wire.ts`
owns the one websocket and the singleton subscriptions.

| Directory | What it owns |
| --- | --- |
| `agents` | The agent chips, the chooser and the per-host agent marks. |
| `attention` | The detect-then-fire engine behind alerts, its diagnostics and its marks. |
| `canvas` | The desktop spatial canvas: tiles, layout, minimap, title-bar actions. |
| `comments` | Selection capture and the comment composer and tray. |
| `conductor` | The Conductor conversation: transcript cards, composer, asks, diffs, and the reader window. |
| `debug`, `dom` | Console hooks; shadow-DOM walking. |
| `forwards` | Forwarded ports: rows, pills and the printed-URL links. |
| `host` | Per-host canvases and sections, including the boot-stalled and connect surfaces. |
| `hostScope` | The retained per-host scope: wire, prefs, camera and session restore, windowed onto the active host. |
| `input` | The action registry, keybinds and the shortcut dispatcher. |
| `intent` | A terminal's intent: editor, markdown body and text helpers. |
| `kaval`, `padi` | The two daemons as the browser sees them: liveness, info dialogs, updates, the degraded canvas. |
| `palette` | The command palette's fleet actions and the create-terminal preview. |
| `recorder` | Screen and mic recording: the button, the popover, the level meter, the webcam overlay. |
| `right-panel` | The Inspector: agent status, the Code browser, diffs and file views. |
| `rpc` | The typed root procedures, declared errors and the transport overlay. |
| `settings` | The settings popover, its rows and tips. |
| `terminal` | The terminal tile itself: xterm wiring, search, agent indicator, scrollback affordances. |
| `tile`, `time` | The tile store and its content; clock and duration formatting. |
| `ui` | Shared presentational pieces: chips, dialogs, menus, links. |

Loose files beside them cover deep links, session import and export, the
diagnostic snapshot, theme and persisted preferences, and the command list.

## What a maintainer must not break

- **`App.tsx` stays layout only.** New domain state goes in a `useXxx`
  singleton, not the shell.
- **One macro layout per form factor**, chosen by `layoutMode`: canvas on
  desktop, one fullscreen tile on a phone, dock rail plus active tile on a
  compact screen. There is no in-app switch.
- **Root procedures come from `rpc/rootProcedures`**, surface members from the
  scoped `app` client, and terminal or git mutations from `activePadiRpc`.
- **Switching back to a host must not resubscribe.** `hostScope` retains each
  host's wire, so a return reads the held value.
- **The test hooks on `window` are typed in `kolu-common/test-hooks`**, and the
  e2e steps read them; do not rename one side alone.
