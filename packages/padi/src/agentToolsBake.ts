import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  buildsMatch,
  type ConvergenceProbe,
  daemonBuild,
  drainAndAwaitExit,
  drainRejectionSuffix,
} from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";
import { AGENT_TOOLS_BAKE_ENV, readAgentToolsBake } from "kolu-pty";

export const AGENT_TOOLS_BAKE_RECORD_FILE = "agent-tools-bake";

export function writeAgentToolsBakeRecord(
  runtimeDir: string,
  env: Record<string, string | undefined> = process.env,
): void {
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(runtimeDir, AGENT_TOOLS_BAKE_RECORD_FILE),
    `${env[AGENT_TOOLS_BAKE_ENV] ?? ""}\n`,
    { mode: 0o600 },
  );
}

export function readAgentToolsBakeRecord(
  runtimeDir: string,
): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(join(runtimeDir, AGENT_TOOLS_BAKE_RECORD_FILE), "utf8");
  } catch {
    return undefined;
  }
  return raw.split("\n", 1)[0] ?? "";
}

export const AGENT_TOOLS_LINKS_DIRNAME = "tools";

/** Point `link` at `target` through a temp name, so a spawn reading the dir
 *  sees either the old link or the new one — never a missing one. */
function flipLinkAtomically(link: string, target: string): void {
  const tmp = `${link}.kolu-tmp`;
  rmSync(tmp, { force: true });
  symlinkSync(target, tmp);
  renameSync(tmp, link);
}

/** Drop every entry of `dir` that is not one of the first `count` links. */
function pruneLinksBeyond(dir: string, count: number): void {
  const keep = new Set(Array.from({ length: count }, (_, i) => String(i)));
  for (const name of readdirSync(dir)) {
    if (!keep.has(name)) rmSync(join(dir, name), { force: true });
  }
}

export function writeAgentToolsLinks(
  runtimeDir: string,
  bake: readonly string[] = readAgentToolsBake(),
): readonly string[] {
  const dir = join(runtimeDir, AGENT_TOOLS_LINKS_DIRNAME);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const links = bake.map((storeDir, index) => {
    if (!existsSync(storeDir)) {
      throw new Error(
        `agent-tools bake names a directory that does not exist: ${storeDir}`,
      );
    }
    const link = join(dir, String(index));
    flipLinkAtomically(link, storeDir);
    return link;
  });
  pruneLinksBeyond(dir, bake.length);
  return links;
}

let linkDirs: readonly string[] | undefined;

/** Record the link dirs written at boot (`writeAgentToolsLinks`' return). */
export function setAgentToolsLinkDirs(dirs: readonly string[]): void {
  linkDirs = dirs;
}

/** The link dirs to stamp into a terminal. Reading before boot records them is
 *  an ordering bug — crash loud rather than ship a terminal with no tools. */
export function readAgentToolsLinkDirs(): readonly string[] {
  if (linkDirs === undefined) {
    throw new Error(
      "agent-tools link dirs read before the daemon recorded them at boot",
    );
  }
  return linkDirs;
}

/** What the drift pre-check found and did. `in-sync` folds every no-verdict
 *  case (no drift, absent record, unbaked supervisor); `foreign-build` is a
 *  drift the kit's own build axis will handle; the failure arms carry the error
 *  TEXT so the caller logs it loudly — a failed drain is surfaced, never
 *  swallowed, but it must not brick the boot that follows. */
export type AgentToolsBakeDriftOutcome =
  | { readonly kind: "in-sync" }
  | { readonly kind: "foreign-build"; readonly recorded: string }
  | { readonly kind: "no-resident"; readonly recorded: string }
  | {
      readonly kind: "probe-failed";
      readonly recorded: string;
      readonly error: string;
    }
  | { readonly kind: "drained"; readonly recorded: string }
  | {
      readonly kind: "drain-failed";
      readonly recorded: string;
      readonly error: string;
    };

/** The same-machine supervisor pre-check: if the resident daemon's recorded bake
 *  names a different toolchain than `ownBake` (what THIS supervisor's build
 *  would hand terminals), drain the resident so the converge that follows
 *  respawns it with the current toolchain. `null` from `probe` means nothing is
 *  listening. Never fails: every failure mode is a typed outcome arm. */
export function drainResidentOnAgentToolsBakeDrift(opts: {
  /** The resident's runtime rendezvous dir (where the record lives). */
  readonly runtimeDir: string;
  /** The resident's socket — what the probe dials. */
  readonly socketPath: string;
  /** The bake THIS supervisor's build carries (raw env value; `""` = unbaked). */
  readonly ownBake: string;
  readonly ownBuildId: string;
  /** The caller's convergence probe (drainable capability). */
  readonly probe: (
    socketPath: string,
  ) => Effect.Effect<ConvergenceProbe<"drainable"> | null, Error>;
}): Effect.Effect<AgentToolsBakeDriftOutcome> {
  return Effect.gen(function* () {
    const recorded = readAgentToolsBakeRecord(opts.runtimeDir);
    if (
      opts.ownBake === "" ||
      recorded === undefined ||
      recorded === opts.ownBake
    ) {
      return { kind: "in-sync" } as const;
    }
    const probed = yield* opts.probe(opts.socketPath).pipe(
      Effect.map((probe) => ({ kind: "ok" as const, probe })),
      Effect.catch((error) =>
        Effect.succeed({ kind: "err" as const, error: String(error) }),
      ),
    );
    if (probed.kind === "err") {
      return { kind: "probe-failed", recorded, error: probed.error } as const;
    }
    if (probed.probe === null) {
      return { kind: "no-resident", recorded } as const;
    }
    const probe = probed.probe;
    if (!buildsMatch(daemonBuild(opts.ownBuildId), probe.identity.build)) {
      probe.dispose();
      return { kind: "foreign-build", recorded } as const;
    }
    return yield* drainAndAwaitExit(probe.fireDrain, probe.awaitExit, {
      ceilingMs: probe.drainCeilingMs,
    }).pipe(
      Effect.map(({ took, drainRejection }) =>
        took
          ? ({ kind: "drained", recorded } as const)
          : ({
              kind: "drain-failed",
              recorded,
              error:
                `the daemon's socket did not close within ${probe.drainCeilingMs}ms` +
                drainRejectionSuffix(drainRejection),
            } as const),
      ),
      Effect.catch((error) =>
        Effect.succeed({
          kind: "drain-failed",
          recorded,
          error: String(error),
        } as const),
      ),
      Effect.ensuring(Effect.sync(() => probe.dispose())),
    );
  });
}
