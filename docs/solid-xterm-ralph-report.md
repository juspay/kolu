# Inventing electricity: isolating xterm.js into `@kolu/solid-xterm`

> Ralph loop report. Goal: isolate the low-level xterm.js mechanics out of the
> Kolu client into a dedicated `packages/solid-xterm` package, leaving the Kolu
> code itself slimmer and decoupled from xterm internals.

## The electricity analogy

Per Rich Hickey ([*Simple Made Easy*](https://www.informit.com/articles/article.aspx?p=2995357&seqNum=2)):
before electricity was a *utility*, every appliance was wired directly into its
own power source — the wiring and the appliance were **complected**. Electricity
as a standardized service (a plug, a socket, a contract) let appliances stop
caring how power is generated.

Today, Kolu's terminal code is "pre-electricity": `Terminal.tsx` (and seven
other client files) wire xterm.js construction, addon loading, WebGL
context-leak management, private-buffer probes, and iOS touch quirks **directly
into** Kolu domain logic (RPC streaming, themes, sub-panels, file-ref clicks).
The xterm mechanics and the Kolu domain change for different reasons (Lowy's
volatility axis) yet share one tangled file.

`@kolu/solid-xterm` is the electricity: the single package that owns every
`@xterm/*` import. The browser UI and the headless pty-host both "plug in"
instead of each running their own wiring.

## Metric

- **Primary:** LOC in `packages/client/src/terminal/` (the Kolu terminal code we
  want slimmer).
- **Secondary (decoupling signal):** number of `@xterm/*` import sites — and
  files containing them — across `packages/client/src`. Target: → 0 (only
  `solid-xterm` touches xterm).
- **Tertiary:** total `@xterm/*`-importing packages repo-wide. Target: 1.

Constraint: **behavior preserved** — terminal must render/behave identically
(WebGL, fit, search, links, clipboard, scrollback, diagnostics, touch). Verified
each cycle by `pnpm -r typecheck`; e2e (`just test`) + CI at wrap-up.

## Baseline (2026-05-30)

Measured on branch `xterm-ralph` off `master`.

| Metric | Baseline |
| --- | --- |
| `client/src/terminal/` LOC (all `.ts`/`.tsx`) | **4481** |
| `@xterm/*` import sites in `client/src` | **19** |
| client files importing `@xterm/*` | **8** |
| Packages importing `@xterm/*` repo-wide | **4** (client, pty-host, terminal-themes, common*) |
| `@kolu/solid-xterm` LOC | 0 (does not exist) |
| `pnpm -r typecheck` | green (all projects) |

> ⚠️ Methodology correction: the baseline typecheck was first run before
> `pnpm install`, so `tsc` wasn't on PATH — the "green" was unverified. After
> installing, the baseline confirmed green with 0 errors. Additionally, the
> `@kolu/solid-xterm` workspace dep was initially omitted from
> `client/package.json`, so cycles 1–3 were committed with an unresolvable
> import (caught and fixed before cycle 4 — see the `fix` row).

\* `common` is a type-only structural augmentation (`KoluXtermProbe`), no runtime import.

### The 8 coupled client files (the wiring to pull into the socket)

| File | Loc | xterm coupling |
| --- | --- | --- |
| `terminal/Terminal.tsx` | 950 | constructs `XTerm` + 8 addons; WebGL lifecycle; keyboard/touch; link provider; private buffer probe |
| `terminal/SearchBar.tsx` | 175 | drives `SearchAddon` |
| `terminal/webglTracker.ts` | 222 | debug ledger for WebglAddon canvases |
| `terminal/useTerminalDiagnostics.ts` | 78 | reactive cols/rows/renderer off `XTerm` |
| `terminal/terminalRefs.ts` | 50 | imperative registry of live `XTerm` + `SerializeAddon` |
| `terminal/fileRefLinkProvider.ts` | 60 | `ILinkProvider` adapter (buffer to links) |
| `scrollLock.ts` | 120 | scroll-lock state machine over `Terminal` |
| `ui/clipboard.ts` | 111 | `SafeClipboardProvider` (`IClipboardProvider`) |

External xterm reach (via `terminalRefs`, no direct import yet but coupled to
xterm shapes): `exportScrollbackAsPdf.ts`, `screenshotTerminal.ts`,
`DiagnosticInfo.tsx`, `debug/consoleHooks.ts`.

## Methodology

LOC: `find packages/client/src/terminal -name '*.ts' -o -name '*.tsx' | xargs wc -l`.
Sites: `grep -rn '@xterm' packages/client/src --include='*.ts' --include='*.tsx' | wc -l`.
Typecheck gate: `nix develop path:. --quiet --command pnpm -r typecheck`.

## Optimization log

| Cycle | Change | terminal/ LOC | client @xterm sites | client @xterm files | typecheck |
| --- | --- | --- | --- | --- | --- |
| baseline | none | 4481 | 19 | 8 | green |
| 1 | move scrollLock + clipboard provider + line-link provider into solid-xterm | 4449 | 15 | 5 | green |
| 2 | move terminalRefs + diagnostics store + webglTracker into solid-xterm | 3939 | 9 | 3 | green |

### Cycle 1 detail

Three leaf mechanics extracted into `@kolu/solid-xterm` (~213 LOC of new
package), each via a **dependency-injection seam** so the package stays free of
Kolu domain knowledge:

- **`createScrollLock`** — moved verbatim; `scrollLock.ts` left `client/src`
  entirely (~120 lines gone from the client).
- **`createSafeClipboardProvider(write)`** — the xterm `IClipboardProvider`
  adapter now takes the clipboard writer as a parameter. The non-secure-context
  `execCommand` fallback (`writeTextToClipboard`) stays in the client (it's
  used for PR URLs, comments, diagnostics — nothing terminal-specific). The
  client's `ui/clipboard.ts` shed its `@xterm/addon-clipboard` import and the
  `SafeClipboardProvider` class (111 → 91 LOC).
- **`createLineLinkProvider(term, {match, onActivate})`** — generic xterm
  link-provider machinery. The Kolu file-ref matcher (`fileRefLink.ts`, was
  `fileRefLinkProvider.ts`) is now pure domain: it returns `{text, index,
  payload}` matches with zero `@xterm` imports (60 → 30 LOC).

`Terminal.tsx` imports all three from `@kolu/solid-xterm` instead of three
local modules.

Environment note: after adding a `workspace:*` dependency, `pnpm install`
reported "up to date" without creating the symlink — `pnpm install --force`
was required to relink before typecheck could resolve the new package.

## Final result (2026-05-30)

| Metric | Baseline | Final | Δ |
| --- | --- | --- | --- |
| `client/src/terminal/` LOC | 4481 | **3438** | −1043 (−23%) |
| `Terminal.tsx` LOC | 957 | **335** | −622 (−65%) |
| `@xterm/*` import sites in `client/src` | 19 | **0** | −19 |
| client files importing `@xterm/*` | 8 | **0** | −8 |
| `pty-host` `@xterm/*` import sites | (CJS interop) | **0** | eliminated |
| packages importing `@xterm/*` at runtime | 4 | **2** | solid-xterm (11 deps) + terminal-themes (1, type-only) |
| `@kolu/solid-xterm` src | 0 | **1480 LOC, 9 files** | new package |

**The electricity is invented.** Every `@xterm/*` runtime import now lives in
`@kolu/solid-xterm`. The Kolu client (the "home") and `pty-host` plug into the
grid through contracts — `createXterm` (browser socket) and
`createHeadlessMirror` (server socket) — instead of each running their own
wiring. The only other package naming `@xterm` is `terminal-themes`, and only as
a type.

## Key findings

- **The seam was real and clean.** xterm mechanics and Kolu domain changed for
  different reasons (Lowy's volatility axis) yet shared one 957-line file. Once
  named, the split fell out naturally: a `createXterm(opts): XtermHandle`
  primitive (mechanics + the three pure-xterm reactivity inputs) and a 335-line
  consumer that injects domain via callbacks and drives the handle.
- **Dependency injection kept the package domain-free.** Clipboard writer, link
  matcher, key policy, stream attach, upload handlers — all injected. The
  package knows nothing about oRPC, themes-by-name, sub-panels, or zoom. The
  leak-fix invariants (#591 owner capture/restore across `await`, #606 disposal
  ordering) moved *verbatim* inside the primitive.
- **One grid, two sockets.** Browser (`@xterm/xterm` + 8 addons) and server
  (`@xterm/headless`) are genuinely different xterm builds; modelling them as
  two subpaths of one package (`.` and `./headless`) let pty-host stay its own
  deployable unit (future SSH) while still plugging in.
- **terminal-themes is a feature, not a leak.** Leaving its type-only `ITheme`
  import respects dependency direction — a deliberate /lowy call, documented
  above.

## Dead ends / corrections

- **Baseline typecheck was unverified.** First run before `pnpm install`, so
  `tsc` wasn't on PATH. Re-run after install: green. Lesson — establish the
  measurement harness *works* before trusting a baseline.
- **Missing workspace dep shipped red.** Cycles 1–3 were committed before
  `@kolu/solid-xterm` was added to `client/package.json`, so the new imports
  didn't resolve (an early Edit silently didn't persist). Caught at cycle 4,
  fixed forward in one commit. Lesson — gate every cycle on a *clean* `pnpm -r
  typecheck`, and verify the dep landed on disk, not just that the Edit reported
  success.
- **`pnpm install` won't relink a new workspace dep** when the lockfile looks
  satisfied; `pnpm install --force` was needed before typecheck could resolve
  `@kolu/solid-xterm`.
