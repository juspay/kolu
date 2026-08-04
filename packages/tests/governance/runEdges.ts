/**
 * The `Effect.run*` edge allowlist — PLAN D10 / review finding #25.
 *
 * The migration's rule is that an Effect is RUN only at a true process or UI
 * edge: a `main()`, a bridge into a non-Effect runtime (SolidJS, the reactor, an
 * SDK's Promise-shaped callback), or a documented synchronous decode. Everywhere
 * else, effects COMPOSE. That rule cannot be enforced by biome — its Promise
 * rules see a `Promise`, and an un-run `Effect` is not one — and it cannot be
 * enforced by review, because a new `Effect.runPromise` reads exactly like the
 * twenty-six that are legitimate.
 *
 * So it is enforced the same way the reactor's signals-engine ban is: by
 * enumeration. Every `Effect.run*(` / `Runtime.run*(` / `NodeRuntime.run*(` call
 * site in the scanned tree (see **Scope** below) is counted, and the result must
 * equal the committed list — path AND count, so a second run added to an
 * already-listed file is a failure too.
 *
 * **Adding a site is not the fix.** If a new call site is not a process/UI edge,
 * compose the effect into its caller instead. The list below is the argument for
 * each one that is; a new row must carry the same kind of argument.
 *
 * **Scope: every `.ts`/`.tsx` file under `packages/`.** Production `src` trees,
 * the `example` trees, the shared test libraries (`*.testlib.ts`) that live
 * inside those `src` trees, and the e2e harness in `packages/tests` alike. An
 * example is consumer code people COPY, and a testlib is a library compiled
 * alongside production source, so a run in either is a run that has to be argued
 * for — the rows below argue for each one.
 *
 * **Except `*.test.ts` / `*.test-d.ts`, and that exclusion is a claim.** A test
 * file IS a process edge: the runner calls it from a Promise, so it must run the
 * effect it is asserting about, and it may do so freely. There are ~600 such
 * runs across ~95 files; enumerating them would budget the HARNESS rather than
 * the product, and the list would rot on every new test. The discipline a test
 * still owes is the twin scan's, not this one's — `awaitedFace.ts` covers test
 * files precisely because a test that silently never dispatches is the bug that
 * hides the others.
 *
 * **The dodges this scan closes.** Counting a NAMESPACED call is honest only if
 * the namespace cannot be dropped, so two shapes fail outright rather than being
 * counted: a bare named import (`import { runPromise } from "effect/Effect"`),
 * and an UNCALLED reference (`const run = Effect.runPromise;`, `{ runFork } =
 * Effect`, `then(Effect.runPromise)`). Aliasing a run function is itself
 * bannable, which closes the alias dodge without needing dataflow.
 *
 * **Residual risk, stated so nobody mistakes this for a proof.** A namespace
 * import under another name (`import * as E from "effect/Effect"; E.runPromise(x)`)
 * reads as an ordinary call and is not seen; nor is a run reached through a
 * re-export of this repo's own making, or through `unsafe`/`Fiber` APIs that run
 * without a `run*` name. Each is an unusual import that review can see, and none
 * has an instance today. This scan raises the cost of a dodge; it does not make
 * one impossible.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface RunEdge {
  /** Repo-relative path, POSIX separators. */
  readonly path: string;
  /** How many run calls this file is allowed. */
  readonly sites: number;
  /** WHY each one is a true edge — one line, the argument, not a restatement. */
  readonly why: string;
}

/** The sanctioned run edges. Sorted by path; keep it that way. */
export const RUN_EDGE_ALLOWLIST: readonly RunEdge[] = [
  {
    path: "packages/client/src/runAction.ts",
    sites: 2,
    why: "THE SolidJS client's Effect→UI edge, named once so the ~100 DOM handlers above it read as `runAction(label, program)` instead of ~100 forks biome's Promise rules cannot see: a `runFork` for an event handler / owner-scoped launch, and a `runPromise` for the three seams whose Promise contract is not this package's (Solid's `createResource` fetcher, xterm-kit's backfill `fetch`, and `pollOnChange`'s signal-carrying read — the last driving interruption from the caller's AbortSignal)",
  },
  {
    path: "packages/kaval-tui/src/main.ts",
    sites: 1,
    why: "kaval-tui's process edge; a Promise rather than `NodeRuntime.runMain` because that turns SIGINT into fiber interruption, and an interrupted fiber cannot emit the `--json` frame + trailer a `wait` interrupted at 130 must still print",
  },
  {
    path: "packages/kaval/src/contractCorpus.testlib.ts",
    sites: 37,
    why: "the pty-host contract corpus — one run per procedure and stream it asserts on, each inside a vitest `it` body, which IS the harness's Promise boundary; a `.testlib.ts` rather than a `.test.ts` only because vitest's `include` and default.nix's staleKey filter both key on the suffix, so it is scanned like the production tree it sits in and the count moves only when `CONTRACT_COVERAGE` does",
  },
  {
    path: "packages/kaval/src/streamFrame.testlib.ts",
    sites: 1,
    why: "`runScopedSync` — the kaval suite's one scoped-acquire read, synchronous ON PURPOSE: attach's publish-epoch coalescing is observable only when a burst of attaches shares a tick, so a Promise hop between two of them would erase the thing under test",
  },
  {
    path: "packages/kolu-cli/src/main.ts",
    sites: 1,
    why: "the product binary's process edge; `NodeRuntime.runMain` rather than a Promise because kolu-cli's exit-code map is LOCAL — every failure carries its own `Runtime.errorExitCode`, so the default teardown IS the map",
  },
  {
    path: "packages/kolu-cli/src/mcp.ts",
    sites: 1,
    why: "the MCP-SDK's connect callback — `serveSurfaceAsMcp` asks for `() => Promise<Connection>` and OWNS the connection it gets, re-invoking it on its own redial path, so the crossing cannot be composed away without changing kolu-mcp's face",
  },
  {
    path: "packages/padi-tui/src/main.ts",
    sites: 1,
    why: "padi-tui's process edge; a Promise rather than `NodeRuntime.runMain` because that turns SIGINT into fiber interruption, and this CLI's stop semantics are PER COMMAND — a `watch` the user stopped is a clean 0, a `wait` interrupted is a 130 that must still print which terminal was left waiting",
  },
  {
    path: "packages/padi/src/daemonBoot/daemonMain.ts",
    sites: 1,
    why: "padi's daemon process edge; a Promise rather than `NodeRuntime.runMain` because the exit-code map lives in the spine's `daemonProcessMain`, which kaval rides too",
  },
  {
    path: "packages/padi/src/ports/sampler.ts",
    sites: 1,
    why: "the port sampler's reactor-poll edge: the reactor's `read` dep is `() => Promise<T>` by design (a poll source owns its own cadence and is deliberately non-Effect — H1), and `scanSubtreePorts` is Effect-native now that osfacts-client returns Effects, so the two meet in the ONE default `scan` seam instead of at each use inside the read; it is a separate row from `servePadi.ts`'s because this sampler is driven OUTSIDE `derived.cell` (its samples re-enter each terminal's own producer through the sensor channel), so there is no padi surface cell to route it through",
  },
  {
    path: "packages/padi/src/servePadi.ts",
    sites: 1,
    why: "padi's ONE reactor-poll edge, named once for both poll cells: the reactor's `read` dep is `() => Promise<T>` by design (a poll source owns its own cadence and is deliberately non-Effect), and the host-inventory and memory samplers behind it are Effect-native, so this is where they meet — kolu-server carries the twin row for the same reason",
  },
  {
    path: "packages/padi/src/terminalEndpoint/local.ts",
    sites: 1,
    why: "the tap layer's one edge — the surrounding lifecycle (`TerminalLifecycle.abort`, the reconciler) is AbortController-shaped, and this is where a signal becomes fiber interruption",
  },
  {
    path: "packages/server/bench/typingEchoLatency.ts",
    sites: 1,
    why: "the typing-echo latency bench's process edge — the probe is ONE program (a padi member call is a lazy Effect, and awaiting one dispatches nothing, which is how this bench rotted), so the dial, the keystroke loop and the attach subscription all compose into a single run here; it runs the EXIT so a failed measurement prints the wire's own Cause and exits non-zero for `bench/run.sh` instead of reporting numbers it never measured",
  },
  {
    path: "packages/server/src/index.ts",
    sites: 2,
    why: "the two edges of an orderly async boot (locked decision 1): the reactor's poll dep is `() => Promise<T>` — its ENGINE is Effect's Atom, but its FACE is deliberately synchronous and non-Effect; and building the composed HTTP layer into the node `request` callback kolu-server owns (owning the listener is what keeps the ws `upgrade` seam the only one) — a callback node hands no Effect context to",
  },
  {
    path: "packages/server/src/padi/newTerminalPolicy.ts",
    sites: 1,
    why: "the policy pusher's edge: a cell `set` is an Effect, but every caller above it is a SYNCHRONOUS framework callback that hands down no Effect, Scope or Promise slot (`reactiveFamily`'s change edge; `CellHandlerDeps.onWrite: (next: T) => void`), so making the pusher an Effect would only move an un-run description into a `() => void` that discards it — and a discarded description is a policy push that silently stops firing",
  },
  {
    path: "packages/server/src/padi/padiBinding.ts",
    sites: 1,
    why: "the local padi `Connector` plug — `@kolu/surface-remote`'s reconnect loop asks for `(ctx) => Promise<Connection>` and OWNS the connection it gets, re-invoking it on its own redial path, so this is where kolu-server's Effect-native `converge(ep)` joins a Promise-shaped seam it does not own (that session machinery is the campaign's recorded residual)",
  },
  {
    path: "packages/server/src/padi/remotePadiBinding.ts",
    sites: 1,
    why: "the remote padi `Admit` plug — the same surface-remote seam, ssh arm: `makeSession` asks for `(client) => Promise<AdmitVerdict>`, and `convergeAdmit` is an Effect",
  },
  {
    path: "packages/server/src/portForward/hostPorts.ts",
    sites: 1,
    why: "one edge for the whole host-ports reading, because its caller is a reactor poll cell — every subscription the read opens stays inside the one fiber tree",
  },
  {
    path: "packages/server/src/wireCall.ts",
    sites: 1,
    why: "`kolu-rpc`'s process edge — the one-shot harness caller places exactly one call and exits, and it runs the Exit (not the value) because a shell needs the CAUSE on stderr",
  },
  {
    path: "packages/surface-app/example/src/server/main.ts",
    sites: 1,
    why: "the example server's node `request` callback — the same boundary `packages/server/src/index.ts` carries, spelled out for a reader who will copy it",
  },
  {
    path: "packages/surface-app/src/server.ts",
    sites: 2,
    why: "the per-connection serve boundary: build the serving layer into a connection-scoped `Scope` when a socket opens, close that scope when it ends — a `ws` callback either side",
  },
  {
    path: "packages/surface-app/src/solid/index.ts",
    sites: 1,
    why: "the server-lifecycle probe edge: `identity.info` is an Effect, but the lifecycle hangs off `wire.onStatus` (a plain callback) and `createHeartbeat` races a probe against a timer, so the crossing is real — held here once rather than at each of the three consumers, and deliberately NOT folded into `liveSignal`'s edge, which takes no caller-supplied probe target on purpose (#1564)",
  },
  {
    path: "packages/surface-map/src/server.ts",
    sites: 1,
    why: "`decodeCanonicalWireKeyUnsafe` — the documented sync-decode edge: a pure suspend over an already-gated key, inside a handler's snapshot read",
  },
  {
    path: "packages/surface-mcp/src/pusher.ts",
    sites: 1,
    why: "one fiber per subscribed MCP resource URI; the SDK's subscribe/unsubscribe surface is callback-shaped, so the fiber handle IS the subscription",
  },
  {
    path: "packages/surface-mcp/src/server.ts",
    sites: 1,
    why: "`resources/read` — the MCP request edge, with the request's own AbortSignal handed to the run so a cancelled read interrupts every subscription it opened",
  },
  {
    path: "packages/surface-remote/src/session.ts",
    sites: 1,
    why: "THE session's probe edge — the three framework-reserved round-trips are Effects, and the dial/reconnect machinery that consumes them is Promise- and timer-shaped BY CONTRACT (the campaign's recorded residual), so the two meet here once instead of three times; the abort it takes becomes fiber interruption, which is strictly stronger than the signal these probes used to be handed",
  },
  {
    path: "packages/surface/example/fleet-top/part-1/src/client/App.tsx",
    sites: 1,
    why: "part 1's DOM handler — a declared procedure is a description and a click is where the example runs it, which is the lesson that page of the tutorial exists to teach",
  },
  {
    path: "packages/surface/example/fleet-top/part-1/src/inproc.ts",
    sites: 1,
    why: "the in-process demo's snapshot read: a `Promise<T>` face over `Stream.runHead`, because the plain async node script that calls it has no Effect to compose into",
  },
  {
    path: "packages/surface/example/fleet-top/part-1/src/server/main.ts",
    sites: 1,
    why: "part 1's node `request` callback — a callback node hands no Effect context to, so the composed HTTP layer is built into it here",
  },
  {
    path: "packages/surface/example/fleet-top/part-2/src/supervisor/main.ts",
    sites: 1,
    why: "the supervisor example's process edge: one run for `main`, with the failure written to stderr and mapped to a non-zero exit — the shape a reader's own `main` should copy",
  },
  {
    path: "packages/surface/example/fleet-top/part-3/src/client/App.tsx",
    sites: 1,
    why: "part 3's DOM handler, on the ACTIVE host's face — switching hosts changes WHICH surface is called, not where it is run",
  },
  {
    path: "packages/surface/example/fleet-top/part-3/src/server/main.ts",
    sites: 1,
    why: "part 3's node `request` callback, twin of part 1's",
  },
  {
    path: "packages/surface/example/mini-ci/src/tui/main.ts",
    sites: 2,
    why: "the mini-CI TUI's two edges: draining the `nodes` stream until the pipeline settles (an async `main` awaits it) and a stdin keypress re-running a node — a Promise-shaped main on one side, a node callback on the other",
  },
  {
    path: "packages/surface/example/mini-ci/src/tui/members.ts",
    sites: 1,
    why: "one fiber per subscribed member, because the TUI's subscribe face hands back a synchronous `() => void` stopper — the fiber handle IS the subscription",
  },
  {
    path: "packages/surface/example/remote-process-monitor/src/client/App.tsx",
    sites: 1,
    why: "the monitor's kill button — a DOM handler running the `catchCause`-wrapped procedure, so a failed kill prints instead of vanishing",
  },
  {
    path: "packages/surface/example/remote-process-monitor/src/server/main.ts",
    sites: 1,
    why: "the monitor server's node `request` callback",
  },
  {
    path: "packages/surface/example/remote-process-monitor/src/server/serve.ts",
    sites: 1,
    why: "the bridge's kill forwarder: the parent's procedure body is an `Effect.promise` (an undeclared error channel must stay a loud defect), and the remote member it forwards to is Effect-native, so the two meet inside that one Promise",
  },
  {
    path: "packages/surface/example/snippets/consume-cli.ts",
    sites: 1,
    why: "the CLI snippet's ONE process edge, and the whole point of the snippet: everything above is a value, and this is the only line that makes anything happen",
  },
  {
    path: "packages/surface/example/snippets/consume-solid.ts",
    sites: 1,
    why: "the Solid snippet's UI edge, shown inline so a reader copying the four `.use()` lines above it sees WHERE the one run belongs",
  },
  {
    path: "packages/surface/example/snippets/test-a-surface.ts",
    sites: 3,
    why: "the testing snippet's three harness edges — a first-frame read, a procedure call, and a `runForEach` drain to a terminal frame — which is what a reader comes to this snippet to copy; the procedure's run was MISSING until the alias scan caught it, and the page's own prose (\"a test is a process edge\") had been describing code that dispatched nothing",
  },
  {
    path: "packages/surface/example/src/client/App.tsx",
    sites: 3,
    why: "the notes example's three UI edges — create, upsert, delete — each run in the DOM handler that asked for it and nowhere deeper, which is the rule the example is demonstrating",
  },
  {
    path: "packages/surface/example/src/server/main.ts",
    sites: 1,
    why: "the notes example's node `request` callback",
  },
  {
    path: "packages/surface/src/handlerDispatch.testlib.ts",
    sites: 4,
    why: "the zero-transport test dispatcher: a unary call to a Promise, a fork for a stream subscription, that fiber's interrupt-on-stop, and a first-frame read — the Effect plumbing every handler unit test would otherwise repeat, held once and NOT exported from the package",
  },
  {
    path: "packages/surface/src/links/stdio.ts",
    sites: 1,
    why: "constructing the stdio socket from a node `Duplex` — the link factory is a Promise-returning constructor its non-Effect callers await",
  },
  {
    path: "packages/surface/src/links/websocket.ts",
    sites: 1,
    why: "same, for the browser leg's reconnecting WebSocket",
  },
  {
    path: "packages/surface/src/links/wire.ts",
    sites: 2,
    why: "the link's own lifecycle: build the protocol layer into a link-scoped `Scope` at open, close that scope at `dispose()` — the link face is Promise-shaped by contract",
  },
  {
    path: "packages/surface/src/mirrorRemoteSurface.ts",
    sites: 1,
    why: "the mirror's subscription runner — the mirror hands back a `done` Promise and takes an AbortSignal, both non-Effect by public contract",
  },
  {
    path: "packages/surface/src/peer-server.ts",
    sites: 2,
    why: "the stdio serve boundary: build the serving layer into a scope, close it at the end — `serveOverStdio` resolves a classified end and never rejects",
  },
  {
    path: "packages/surface/src/runStream.ts",
    sites: 2,
    why: "THE Solid bridge, and the package's ONE UI-tier fork: a member stream becoming a fiber with a synchronous stopper (which every `createSubscription` rides), plus `runDetached` for a cell write whose only launcher is a coalescing TIMER — there is no caller left to compose it into, and it is deliberately NOT scoped to the queuing owner, because a component unmounting inside the debounce window must still land the write",
  },
  {
    path: "packages/surface/src/server.ts",
    sites: 1,
    why: "one fiber per owned cell connector — a served surface's face is synchronous construction plus a Promise-shaped `done`/`close`, so this is where a connector's scoped Effect becomes a supervised fiber; it replaces `project.ts`'s three, which existed only because the connector seam was Promise/Disposer-shaped",
  },
  {
    path: "packages/surface/src/solid/liveSignal.ts",
    sites: 1,
    why: "the liveness heartbeat is framework-free and Promise-shaped (it races a probe against a timer) and is shared with non-Effect consumers",
  },
  {
    path: "packages/surface/src/unix-socket.ts",
    sites: 2,
    why: "the unix listener's per-peer boundary: serve each accepted connection in its own scope, release that scope on the socket's `close`/`error` — node `net` callbacks either side",
  },
  {
    path: "packages/tests/step_definitions/spawn_detection_steps.ts",
    sites: 4,
    why: "the cucumber steps' four boundaries — a scoped dial of the kaval daemon, the command-rooted spawn under test, and the kill + scope-close an `After` hook must complete before the world is torn down; a step body is a Promise the runner awaits, so there is no Effect above it to compose into",
  },
  {
    path: "packages/tests/support/rpcWire.ts",
    sites: 1,
    why: "the e2e harness's ONE wire edge — every suite call funnels through it, and it runs the EXIT (not the value) with the caller's timeout as an AbortSignal, because the harness classifies on the `Cause`: a padi still warming up is retried, not failed",
  },
];

/** Directories with nothing to police — build output and vendored code. There is
 *  no `example` entry: an example tree is consumer code people COPY, so a run
 *  there is argued for on the list like any other. */
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".astro", ".vite"]);

const RUN_CALL = /\b(?:Effect|Runtime|NodeRuntime)\.run[A-Z][A-Za-z]*\s*\(/g;

/** A named import of a `run*` function straight off an effect module — one way a
 *  call site could dodge {@link RUN_CALL}'s namespaced shape. */
const BARE_RUN_IMPORT =
  /import\s*\{[^}]*\brun[A-Z][A-Za-z]*\b[^}]*\}\s*from\s*["']effect[^"']*["']/;

/** `Effect.runPromise` NOT followed by `(` — the alias dodge. `const run =
 *  Effect.runFork; run(program)` makes a run call that {@link RUN_CALL} cannot
 *  see, and so does handing the function to something else (`.then(Effect.runPromise)`).
 *  The `\b` before the lookahead matters: without it `runPromise` would match
 *  inside `runPromiseExit(` and report the call as an alias. */
const UNCALLED_RUN_REFERENCE =
  /\b(?:Effect|Runtime|NodeRuntime)\s*\.\s*run[A-Z][A-Za-z]*\b(?!\s*\()/g;

/** `const { runPromise } = Effect` — the same dodge spelled as a destructure,
 *  which leaves no `Namespace.run*` text for {@link UNCALLED_RUN_REFERENCE}. */
const DESTRUCTURED_RUN =
  /\{[^{}]*\brun[A-Z][A-Za-z]*\b[^{}]*\}\s*=\s*(?:Effect|Runtime|NodeRuntime)\b/g;

/** Blank out comments, and optionally string/template literals, so a `run*` call
 *  NAMED in prose (there are several — the edges are documented where they live)
 *  or quoted in a message is not counted as one.
 *
 *  A character scan rather than a regex: `//` inside a string literal and a
 *  quote inside a comment both defeat the regex version, and both occur in this
 *  repo. Replaced with spaces rather than deleted so any position the caller
 *  reports still lines up with the original source.
 *
 *  `keepStrings` exists for the import check, which has to READ a module
 *  specifier — the one question about this source that a string literal is the
 *  answer to rather than a hiding place. */
function scan(source: string, keepStrings: boolean): string {
  const out = source.split("");
  let i = 0;
  const blankTo = (end: number): void => {
    for (let j = i; j < end && j < out.length; j++)
      if (out[j] !== "\n") out[j] = " ";
    i = end;
  };
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const nl = source.indexOf("\n", i);
      blankTo(nl === -1 ? source.length : nl);
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      blankTo(end === -1 ? source.length : end + 2);
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === ch) {
          j += 1;
          break;
        }
        j += 1;
      }
      // The quote characters themselves are ordinary code; only the contents go.
      i += 1;
      if (!keepStrings) blankTo(j - 1);
      i = j;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/** Comments and string literals blanked — what a `run*` CALL must survive. */
export function blankNonCode(source: string): string {
  return scan(source, false);
}

/** How many run calls `source` really makes. */
export function countRunCalls(source: string): number {
  return (blankNonCode(source).match(RUN_CALL) ?? []).length;
}

/** True when `source` imports a `run*` helper by bare name off an effect module
 *  — the dodge the namespaced count cannot see. Comments are blanked (so naming
 *  the dodge in prose is not committing it) but string literals survive, because
 *  the module specifier IS the question. */
export function hasBareRunImport(source: string): boolean {
  return BARE_RUN_IMPORT.test(scan(source, true));
}

/** Every place `source` names a `run*` function WITHOUT calling it. Each is a
 *  violation in its own right rather than a counted edge: an alias travels, so
 *  there is no one file to hang a number on. Comments and string literals are
 *  blanked, so naming the dodge in prose (this file does, twice) is not
 *  committing it. */
export function findRunAliases(source: string): string[] {
  const code = blankNonCode(source);
  return [
    ...(code.match(UNCALLED_RUN_REFERENCE) ?? []),
    ...(code.match(DESTRUCTURED_RUN) ?? []),
  ].map((text) => text.replace(/\s+/g, " ").trim());
}

/** Files whose run calls are enumerated. `*.test.ts` / `*.test-d.ts` is out —
 *  the runner calls a test from a Promise, so a test IS the edge (the header
 *  states that exclusion and why it is the only one). `*.testlib.ts` is IN: it
 *  ships inside a production `src` tree and is compiled with it. */
function isScannedSource(file: string): boolean {
  if (!/\.(ts|tsx)$/.test(file)) return false;
  return !/\.(test|test-d)\.(ts|tsx)$/.test(file);
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (isScannedSource(entry)) out.push(full);
  }
}

/** Every scanned source file under `packages/`, repo-relative and
 *  POSIX-separated. The whole tree rather than each package's `src`, because
 *  `packages/tests` has no `src` and an `example` tree lives beside one. */
export function scannedSources(repoRoot: string): string[] {
  const files: string[] = [];
  walk(path.join(repoRoot, "packages"), files);
  return files
    .map((f) => path.relative(repoRoot, f).split(path.sep).join("/"))
    .sort();
}

/** Path → number of run calls, for every scanned file that has at least one. */
export function collectRunEdges(repoRoot: string): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of scannedSources(repoRoot)) {
    const source = readFileSync(path.join(repoRoot, file), "utf8");
    if (hasBareRunImport(source)) {
      throw new Error(
        `${file} imports an Effect \`run*\` helper by bare name. Use the namespaced form (\`Effect.runPromise\`) so the run-edge allowlist can see it.`,
      );
    }
    const aliases = findRunAliases(source);
    if (aliases.length > 0) {
      throw new Error(
        `${file} names an Effect \`run*\` function without calling it (${aliases.join(", ")}). An alias can be invoked anywhere, so the allowlist could never see the edge — call it in place, or compose the effect into its caller.`,
      );
    }
    const count = countRunCalls(source);
    if (count > 0) found.set(file, count);
  }
  return found;
}

/** Throw unless the found edges are EXACTLY the allowlisted ones. */
export function validateRunEdges(
  found: ReadonlyMap<string, number>,
  allowlist: readonly RunEdge[] = RUN_EDGE_ALLOWLIST,
): void {
  const allowed = new Map(allowlist.map((e) => [e.path, e.sites]));
  const problems: string[] = [];
  for (const [file, count] of [...found].sort()) {
    const expected = allowed.get(file);
    if (expected === undefined) {
      problems.push(
        `  + ${file} runs ${count} effect(s) and is NOT on the allowlist. If this is not a process/UI edge, compose the effect into its caller instead of listing it.`,
      );
    } else if (expected !== count) {
      problems.push(
        `  ~ ${file} runs ${count} effect(s); the allowlist says ${expected}.`,
      );
    }
  }
  for (const entry of allowlist) {
    if (!found.has(entry.path)) {
      problems.push(
        `  - ${entry.path} is allowlisted for ${entry.sites} run edge(s) but has none — drop the row.`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Effect.run* edge allowlist is out of date (PLAN D10/#25):\n${problems.join("\n")}`,
    );
  }
}
