/**
 * agent-distro on THIS host — padi's half of the Agents setting.
 *
 * kolu-server pushes the user's setting into the memory-only `agentDistro` cell
 * (the `newTerminalPolicy` pattern: re-pushed on every connect, so padi keeps no
 * copy of a preference). padi owns the parts only the host can answer:
 *
 *   - **Which bundle a new terminal gets** ({@link resolveAgentLayer}). The
 *     host's own `current` (a bundle the updater fetched) if it has one, else
 *     the floor this build carries (the local machine), else nothing yet. The
 *     answer is an EXACT store path, which the terminal pins: a later update or
 *     profile switch never touches a running terminal.
 *   - **Getting the bundle onto a host that has none** ({@link onAgentDistroSettingWrite}).
 *     A remote host has no floor, so the first time agents are on there, padi
 *     runs agent-distro's updater once: it fetches the profile's bundle from the
 *     binary cache into the host's store and flips `current`. Nothing is copied
 *     over ssh, and nothing retries on its own — a failure is shown with the
 *     updater's own message, and the next time the setting is turned on (or
 *     switched to another profile) it tries again.
 *   - **Saying where it stands** — the read-only `agentDistroStatus` cell.
 */

import { spawn } from "node:child_process";
import {
  accessSync,
  constants as fsConstants,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  type AgentDistroSetting,
  type AgentDistroStatus,
  DEFAULT_AGENT_DISTRO_SETTING,
} from "@kolu/padi-client/surface";
import { type CellStore, inMemoryStore } from "@kolu/surface/server";
import { log } from "../log.ts";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";
import {
  type AgentDistroBake,
  type AgentDistroProfileBake,
  hostUpdaterConfig,
  readAgentDistroBake,
} from "./bake.ts";
import {
  parseUpdaterProgressLine,
  UPDATER_PROGRESS_ARGS,
  type UpdaterProgress,
} from "./updaterProgress.ts";

/** The backing store of the `agentDistro` cell, shared by the cell declaration
 *  and the spawn path — so a spawn resolves against exactly what the binder
 *  wrote (the `newTerminalPolicyStore` arrangement). */
export const agentDistroSettingStore: CellStore<AgentDistroSetting> =
  inMemoryStore(DEFAULT_AGENT_DISTRO_SETTING);

let bakeMemo: { value: AgentDistroBake | null } | undefined;

/** This process's bake, read once. Called at boot by `servePadi` so a broken
 *  bake crashes the daemon there, not at the first spawn. */
export function agentDistroBake(): AgentDistroBake | null {
  bakeMemo ??= { value: readAgentDistroBake() };
  return bakeMemo.value;
}

/** Test seam: replace (or clear, with `undefined`) the memoized bake. */
export function __setAgentDistroBakeForTest(
  bake: AgentDistroBake | null | undefined,
): void {
  bakeMemo = bake === undefined ? undefined : { value: bake };
}

/** The host's state home, where agent-distro keeps `current` — the same
 *  `$XDG_STATE_HOME` (default `~/.local/state`) its Home Manager module uses. */
function hostStateHome(): string {
  const xdg = process.env.XDG_STATE_HOME;
  return xdg !== undefined && xdg !== ""
    ? xdg
    : join(homedir(), ".local", "state");
}

/** `path` resolved, or `undefined` when it does not exist. ONE `realpathSync`,
 *  never an exists-then-resolve pair: the updater flips `current` atomically, and
 *  a spawn landing between a separate check and the resolve would throw on a link
 *  that is merely mid-flip. Only `ENOENT` is "absent"; anything else is thrown. */
function realpathOrUndefined(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** Where `profile`'s bundle is on this host right now: the `current` the updater
 *  maintains, else the floor; `undefined` when neither exists (a remote host
 *  before its first download). Always a resolved store path, so whoever
 *  receives it pins that exact bundle. */
function bundleOnHost(
  bake: AgentDistroBake,
  profile: AgentDistroProfileBake,
): string | undefined {
  const { stateDir } = hostUpdaterConfig(bake, profile, hostStateHome());
  const current = realpathOrUndefined(join(stateDir, "current"));
  if (current !== undefined) return current;
  if (bake.floor === undefined) return undefined;
  const floorDir = realpathOrUndefined(
    join(bake.floor, "profiles", profile.name),
  );
  if (floorDir === undefined) {
    // The floor is a build fact; a profile the listing names but the floor lacks
    // is a broken build, not a state to degrade from.
    throw new Error(
      `agent-distro floor ${bake.floor} has no profiles/${profile.name}, though the updater listing names it`,
    );
  }
  return floorDir;
}

/** What a new terminal gets: the profile, the exact bundle (whose `bin/` goes on
 *  PATH), and the plugin dir (`AGENT_DISTRO_PLUGINS`). */
export interface AgentLayer {
  readonly profile: string;
  readonly bundle: string;
  readonly plugins: string;
}

/** The agent layer for a terminal spawned NOW, or `undefined` when it gets none
 *  (setting off, an unbaked padi, or a host whose bundle has not arrived). */
export function resolveAgentLayer(
  setting: AgentDistroSetting = agentDistroSettingStore.get(),
): AgentLayer | undefined {
  if (!setting.enabled) return undefined;
  const bake = agentDistroBake();
  if (bake === null) return undefined;
  const profile = bake.profiles.get(setting.profile);
  // `checkAgentDistroSetting` refuses an unknown profile at the write, and the
  // bake is fixed for the process, so this is unreachable short of a bug.
  if (profile === undefined)
    throw new Error(
      `agent-distro profile '${setting.profile}' is not in this padi's listing`,
    );
  const bundle = bundleOnHost(bake, profile);
  return bundle === undefined
    ? undefined
    : { profile: profile.name, bundle, plugins: bake.plugins };
}

/** The two record fields a layer stamps. */
interface AgentLayerFields {
  agentProfile?: string;
  agentBundle?: string;
}

/** `record` with its agent fields replaced by `layer`'s — or removed, for no
 *  layer. Never keeps a previous spawn's pair (a woken terminal's). */
export function withAgentLayer<R extends AgentLayerFields>(
  record: R,
  layer: AgentLayer | undefined,
): R {
  const { agentProfile: _profile, agentBundle: _bundle, ...rest } = record;
  return (
    layer === undefined
      ? rest
      : { ...rest, agentProfile: layer.profile, agentBundle: layer.bundle }
  ) as R;
}

/** The layer a record was stamped with, for the spawn that reads its PATH off
 *  the record. `undefined` for an unstamped record. */
export function agentLayerOfRecord(
  record: AgentLayerFields,
): AgentLayer | undefined {
  if (record.agentProfile === undefined || record.agentBundle === undefined)
    return undefined;
  const bake = agentDistroBake();
  if (bake === null)
    throw new Error(
      "a terminal record carries an agent layer, but this padi has no agent-distro bake",
    );
  return {
    profile: record.agentProfile,
    bundle: record.agentBundle,
    plugins: bake.plugins,
  };
}

/** The `agentDistro` cell's write gate (`onMutate`): refuse to turn on a profile
 *  this build does not know. The user's choice is never mapped to another
 *  profile — the push fails loudly and kolu-server logs it. An unbaked padi
 *  takes any value (it gives nothing either way, and says so in its status). */
export function checkAgentDistroSetting(next: AgentDistroSetting): void {
  if (!next.enabled) return;
  const bake = agentDistroBake();
  if (bake === null) return;
  if (!bake.profiles.has(next.profile)) {
    throw new Error(
      `unknown agent-distro profile '${next.profile}'; this host knows ${[...bake.profiles.keys()].join(", ")}`,
    );
  }
}

// ── Download (a host with no bundle for the selected profile) ────────────

/** Profiles whose download is running, with the latest byte counts. */
const downloading = new Map<string, { progress?: UpdaterProgress }>();
/** Profiles whose last download failed, with the updater's message. Cleared
 *  when the setting next turns that profile on — the only retry there is. */
const failed = new Map<string, string>();

function publishStatus(status: AgentDistroStatus): void {
  padiSurfaceCtx.cells.agentDistroStatus.set(status);
}

/** Where `setting` stands on this host, as of now, without side effects.
 *  `needsDownload` is NOT a status anyone sees: it is the one state a caller
 *  must act on (start the download) before there is something true to publish,
 *  so it is kept out of {@link AgentDistroStatus} rather than spelled as a
 *  `downloading` that nothing is doing. */
export function assessAgentDistro(
  setting: AgentDistroSetting,
):
  | AgentDistroStatus
  | { readonly kind: "needsDownload"; readonly profile: string } {
  if (!setting.enabled) return { kind: "off" };
  const bake = agentDistroBake();
  if (bake === null) return { kind: "unavailable" };
  const layer = resolveAgentLayer(setting);
  if (layer !== undefined)
    return { kind: "ready", profile: layer.profile, bundle: layer.bundle };
  const running = downloading.get(setting.profile);
  if (running !== undefined)
    return {
      kind: "downloading",
      profile: setting.profile,
      ...(running.progress !== undefined ? { progress: running.progress } : {}),
    };
  const message = failed.get(setting.profile);
  if (message !== undefined)
    return { kind: "error", profile: setting.profile, message };
  return { kind: "needsDownload", profile: setting.profile };
}

/** Bring this host's status in line with `setting` and publish it: a profile
 *  with no bundle, no running download and no recorded failure gets its one
 *  download started first, so what is published is always something true. */
function settle(setting: AgentDistroSetting): void {
  let assessed = assessAgentDistro(setting);
  if (assessed.kind === "needsDownload") {
    const bake = agentDistroBake();
    const profile = bake?.profiles.get(setting.profile);
    // `assessAgentDistro` only answers `needsDownload` for a baked, known
    // profile (`resolveAgentLayer` throws on an unknown one).
    if (bake === null || profile === undefined)
      throw new Error(`agent-distro: no bake for profile '${setting.profile}'`);
    startDownload(bake, profile);
    assessed = assessAgentDistro(setting);
    if (assessed.kind === "needsDownload")
      throw new Error(
        `agent-distro: starting the '${setting.profile}' download recorded neither a run nor a failure`,
      );
  }
  publishStatus(assessed);
}

/** The `agentDistro` cell's `onWrite`: a CHANGED setting (the cell's `equals`
 *  drops a re-push of the same value, so a reconnect does not land here). Fires
 *  BEFORE the store write, so it reads `next`, never the store. Turning a
 *  profile on forgets its last failure — that is the retry. */
export function onAgentDistroSettingWrite(next: AgentDistroSetting): void {
  if (next.enabled) failed.delete(next.profile);
  settle(next);
}

/** Re-publish for whatever setting is current — after a download settles or
 *  reports bytes. A download for a profile no longer selected changes nothing
 *  visible, but its result is kept for when it is. */
function republish(): void {
  try {
    settle(agentDistroSettingStore.get());
  } catch (err) {
    // Runs from a download's own callbacks, where a throw has nowhere to go but
    // an unhandled rejection; logged loudly instead.
    log.error({ err }, "agent-distro status could not be re-published");
  }
}

/** The host's `nix`, as the updater will find it — on padi's own PATH. A padi
 *  started over a non-login ssh session on a non-NixOS host (or macOS) often
 *  lacks the Nix profile on PATH, and the updater would then die with a bare
 *  spawn error; naming it here gives the host tab the real fix. */
function nixOnPath(): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue;
    const candidate = join(dir, "nix");
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Not in this PATH entry; the next one may have it.
    }
  }
  return undefined;
}

/** Start `profile`'s one download. Every way it can fail — no `nix`, a config
 *  that will not write, the updater's own failure, a skip, a throw while reading
 *  the result — ends as a recorded failure (the host's `error` status) and a
 *  loud log line; none is swallowed and none retries on its own. */
function startDownload(
  bake: AgentDistroBake,
  profile: AgentDistroProfileBake,
): void {
  const plog = log.child({ agentDistroProfile: profile.name });
  const fail = (message: string, err?: unknown) => {
    downloading.delete(profile.name);
    failed.set(profile.name, message);
    plog.error({ err, message }, "agent-distro download failed");
  };
  if (nixOnPath() === undefined) {
    fail(
      `nix is not on padi's PATH on this host, so the agents cannot be downloaded — make \`nix\` reachable for non-login ssh sessions (e.g. add /nix/var/nix/profiles/default/bin to PATH in ~/.bashrc or /etc/environment), then turn Agents off and on`,
    );
    return;
  }
  let dir: string;
  let configPath: string;
  try {
    const { text } = hostUpdaterConfig(bake, profile, hostStateHome());
    dir = mkdtempSync(join(tmpdir(), "kolu-agent-distro-"));
    configPath = join(dir, "update.json");
    writeFileSync(configPath, text, { mode: 0o600 });
  } catch (err) {
    fail(`could not prepare the updater: ${String(err)}`, err);
    return;
  }
  downloading.set(profile.name, {});
  plog.info({}, "downloading agent-distro bundle");
  void runUpdater({
    command: profile.command,
    configPath,
    onProgress: (progress) => {
      downloading.set(profile.name, { progress });
      republish();
    },
  })
    .then((outcome) => {
      if (!outcome.ok) {
        fail(outcome.message);
      } else if (bundleOnHost(bake, profile) === undefined) {
        // The updater exits 0 on a SKIP (cache unusable, bundle not fully
        // cached): nothing landed, and its stderr says why.
        fail(outcome.message);
      } else {
        downloading.delete(profile.name);
        plog.info({}, "agent-distro bundle ready");
      }
    })
    .catch((err: unknown) =>
      fail(`reading the download's result failed: ${String(err)}`, err),
    )
    .finally(() => {
      rmSync(dir, { recursive: true, force: true });
      republish();
    });
}

/** Test seam: forget every download and failure. */
export function __resetAgentDistroDownloadsForTest(): void {
  downloading.clear();
  failed.clear();
}

type UpdaterOutcome =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly message: string };

/** The updater's last word: its final non-empty stderr line, minus the
 *  `agent-distro: ` prefix it puts on every message. */
function lastWord(lines: readonly string[], fallback: string): string {
  const last = lines.findLast((l) => l.trim() !== "");
  return last === undefined
    ? fallback
    : last.trim().replace(/^agent-distro:\s*/, "");
}

/** Run agent-distro's updater once and settle with its outcome. Never rejects:
 *  a spawn error is an outcome too. */
export function runUpdater(opts: {
  readonly command: readonly string[];
  readonly configPath: string;
  readonly onProgress: (progress: UpdaterProgress) => void;
}): Promise<UpdaterOutcome> {
  const [bin, ...args] = opts.command;
  if (bin === undefined)
    return Promise.resolve({ ok: false, message: "empty updater command" });
  return new Promise((resolve) => {
    const child = spawn(
      bin,
      [...args, opts.configPath, ...UPDATER_PROGRESS_ARGS],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const stderr: string[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => {
      const progress = parseUpdaterProgressLine(line);
      if (progress !== null) opts.onProgress(progress);
    });
    createInterface({ input: child.stderr }).on("line", (line) => {
      stderr.push(line);
      // Bounded: a long `nix build` log is noise past its last few lines.
      if (stderr.length > 50) stderr.shift();
    });
    child.on("error", (err) =>
      resolve({ ok: false, message: `cannot run the updater: ${err.message}` }),
    );
    child.on("close", (code, signal) => {
      const message = lastWord(
        stderr,
        code === 0 ? "the updater fetched nothing" : "the updater failed",
      );
      resolve(
        code === 0
          ? { ok: true, message }
          : {
              ok: false,
              message:
                signal !== null
                  ? `the updater was killed (${signal})`
                  : message,
            },
      );
    });
  });
}
