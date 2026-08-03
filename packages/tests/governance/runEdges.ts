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
 * site in production source under a package `src` tree is counted, and the result
 * must equal the committed list below — path AND count, so a second run added to
 * an already-listed file is a failure too.
 *
 * **Adding a site is not the fix.** If a new call site is not a process/UI edge,
 * compose the effect into its caller instead. The list below is the argument for
 * each one that is; a new row must carry the same kind of argument.
 *
 * Out of scope, deliberately: tests (`*.test.ts`, `*.testlib.ts`) — a test IS a
 * process edge — and every `example` tree under `packages`, which exists to be
 * read as consumer code and has a `main()` of its own.
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
    path: "packages/client/src/rpc/rootProcedures.ts",
    sites: 1,
    why: "the root-procedure face's Promise edge — a SolidJS leaf awaits it, and it rejects with the squashed tagged error so `_tag` narrowing stays honest",
  },
  {
    path: "packages/padi/src/daemonBoot/daemonMain.ts",
    sites: 1,
    why: "padi's daemon process edge; a Promise rather than `NodeRuntime.runMain` because the exit-code map lives in the spine's `daemonProcessMain`, which kaval rides too",
  },
  {
    path: "packages/padi/src/terminalEndpoint/local.ts",
    sites: 1,
    why: "the tap layer's one edge — the surrounding lifecycle (`TerminalLifecycle.abort`, the reconciler) is AbortController-shaped, and this is where a signal becomes fiber interruption",
  },
  {
    path: "packages/server/src/index.ts",
    sites: 1,
    why: "the reactor's poll dep is `() => Promise<T>` and the reactor is deliberately non-Effect (locked decision 1)",
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
    path: "packages/surface-app/src/server.ts",
    sites: 2,
    why: "the per-connection serve boundary: build the serving layer into a connection-scoped `Scope` when a socket opens, close that scope when it ends — a `ws` callback either side",
  },
  {
    path: "packages/surface-daemon-supervisor/src/promiseFace.ts",
    sites: 1,
    why: "the supervisor's ONE Promise rind — its interior is Effect, but padi/kolu-server/drishti still call the exported verbs as Promises, so every one of them runs through this single function until the face flips with its consumers",
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
    path: "packages/surface/src/client.ts",
    sites: 1,
    why: "the framework's ONE Promise edge for a unary member call — SolidJS leaves stay plain async (locked decision 1)",
  },
  {
    path: "packages/surface/src/firstFrame.ts",
    sites: 1,
    why: "the one-shot snapshot readers' Promise edge, held here once instead of once per plain-async CLI consumer",
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
    path: "packages/surface/src/project.ts",
    sites: 3,
    why: "the projection bridge into the non-Effect reactor: fork the upstream pump on `connect`, and interrupt it from the sync and async disposers the cell machinery calls",
  },
  {
    path: "packages/surface/src/runStream.ts",
    sites: 1,
    why: "THE Solid bridge — the one place a member stream becomes a fiber with a synchronous stopper, which every `createSubscription` rides",
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
];

/** Directories under `packages/` whose `src/` is production code we police. The
 *  scan walks each package's own `src`, plus the `src` of every member of a
 *  grouping directory like `packages/integrations`; an `example` tree anywhere
 *  below is skipped (each has its own `main()`). */
const SKIPPED_DIRS = new Set(["node_modules", "example", "dist", "examples"]);

const RUN_CALL = /\b(?:Effect|Runtime|NodeRuntime)\.run[A-Z][A-Za-z]*\s*\(/g;

/** A named import of a `run*` function straight off an effect module — the one
 *  way a call site could dodge {@link RUN_CALL}'s namespaced shape. */
const BARE_RUN_IMPORT =
  /import\s*\{[^}]*\brun[A-Z][A-Za-z]*\b[^}]*\}\s*from\s*["']effect[^"']*["']/;

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

function isProductionSource(file: string): boolean {
  if (!/\.(ts|tsx)$/.test(file)) return false;
  return !/\.(test|testlib|test-d)\.(ts|tsx)$/.test(file);
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (isProductionSource(entry)) out.push(full);
  }
}

/** Every production source file under a package `src` tree, repo-relative and
 *  POSIX-separated. */
export function productionSources(repoRoot: string): string[] {
  const packagesDir = path.join(repoRoot, "packages");
  const roots: string[] = [];
  for (const pkg of readdirSync(packagesDir)) {
    if (SKIPPED_DIRS.has(pkg)) continue;
    const pkgDir = path.join(packagesDir, pkg);
    if (!statSync(pkgDir).isDirectory()) continue;
    const src = path.join(pkgDir, "src");
    try {
      if (statSync(src).isDirectory()) roots.push(src);
    } catch {
      // No `src/` of its own — a grouping directory (packages/integrations),
      // whose members are scanned one level down.
      for (const nested of readdirSync(pkgDir)) {
        if (SKIPPED_DIRS.has(nested)) continue;
        const nestedSrc = path.join(pkgDir, nested, "src");
        try {
          if (statSync(nestedSrc).isDirectory()) roots.push(nestedSrc);
        } catch {
          // Not a package either — nothing to scan.
        }
      }
    }
  }
  const files: string[] = [];
  for (const root of roots) walk(root, files);
  return files
    .map((f) => path.relative(repoRoot, f).split(path.sep).join("/"))
    .sort();
}

/** Path → number of run calls, for every production file that has at least one. */
export function collectRunEdges(repoRoot: string): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of productionSources(repoRoot)) {
    const source = readFileSync(path.join(repoRoot, file), "utf8");
    if (hasBareRunImport(source)) {
      throw new Error(
        `${file} imports an Effect \`run*\` helper by bare name. Use the namespaced form (\`Effect.runPromise\`) so the run-edge allowlist can see it.`,
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
