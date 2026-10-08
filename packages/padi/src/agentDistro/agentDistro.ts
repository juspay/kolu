/**
 * agent-distro on THIS host — padi's POLICY for the Agents setting: what it
 * accepts, what it reports, and when it downloads. Its volatility is kolu's own
 * product decisions; the facts it acts on live in their own modules:
 *
 *   - `./bake.ts` — what this build was baked with (profiles, floor, plugins);
 *   - `./onHost.ts` — where agent-distro's bundles are on this host;
 *   - `./layer.ts` — the layer a bundle on disk gives, and its record stamp;
 *   - `./download.ts` — the run state machine (a first download or an update ·
 *     failed, with a typed reason) and its one run of agent-distro's updater
 *     (`./updater.ts`; the line format is `@kolu/agent-distro/progress`);
 *   - `./receipt.ts` — what the updater's own files say about its runs;
 *   - `./scheduler.ts` — when to ask whether an update is due.
 *
 * kolu-server pushes the user's setting into the memory-only `agentDistro` cell
 * (the `newTerminalPolicy` pattern: re-pushed on every connect, so padi keeps no
 * copy of a preference). This module refuses a profile the build does not know,
 * keeps the read-only `agentDistroStatus` cell true, and — on a host with no
 * bundle for the selected profile (a remote host has no floor) — runs the
 * updater once. A first download that fails is published with its typed reason
 * and cause, and the next time the setting turns that profile on, it tries again
 * (the remedy and retry are worded in `@kolu/agent-distro/status`).
 *
 * Once a bundle serves, it keeps the CHOSEN profile current: at each of
 * upstream's schedule boundaries (and after a sleep that missed one) it runs an
 * update when upstream's due rule says so (`last-success` against the
 * boundary), and `checkNow` runs one at once. A scheduled run that FAILS gets
 * upstream's retries — up to three runs a boundary, five minutes after the
 * failed one ended (`@kolu/agent-distro/schedule`); a skip waits for the next
 * boundary. It also runs one update when padi STARTS — a deploy, a restart of
 * kolu, a reboot of the host — whatever the due rule says: the first tick after
 * boot that finds agents on and a bundle serving runs it, forced as `checkNow`
 * is (a deploy of a newer kolu then brings upstream's newer bundle with it). It
 * fires once per process, only for the setting padi is first pushed (pushed
 * off, it is spent), and, like `checkNow`, is no scheduled attempt: it counts
 * toward no boundary's three and a failure of it earns no retry. A first
 * download in flight spends it (that run already fetches upstream's newest).
 * The old bundle keeps serving until the new one has fully landed; a
 * run that skips or fails leaves it serving. Its status stays `ready`: the run
 * shows in the read-only `agentDistroReceipt` cell (which Settings words on the
 * host's own line) and the log.
 */

import {
  type AgentDistroSetting,
  type AgentDistroStatus,
  DEFAULT_AGENT_DISTRO_SETTING,
  EMPTY_AGENT_DISTRO_RECEIPT,
} from "@kolu/agent-distro/schema";
import type { AgentUpdateRun } from "@kolu/agent-distro/history";
import {
  attemptEnded,
  attemptStarted,
  type ScheduledAttempts,
  scheduledAskNow,
  updateDue,
} from "@kolu/agent-distro/schedule";
import { type CellStore, inMemoryStore } from "@kolu/surface/server";
import { log } from "../log.ts";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";
import { agentDistroBake } from "./bake.ts";
import {
  disownedBundleOf,
  downloadOf,
  forgetFailure,
  keptBundleOf,
  runningProfiles,
  startRun,
  unlandedRunOf,
} from "./download.ts";
import { type AgentLayer, layerOnHost } from "./layer.ts";
import { bundleOnHost } from "./onHost.ts";
import { lastSuccessOf, readReceipt } from "./receipt.ts";
import { startUpdateTimer } from "./scheduler.ts";

/** The backing store of the `agentDistro` cell, shared by the cell declaration
 *  and the spawn path — so a spawn resolves against exactly what the binder
 *  wrote (the `newTerminalPolicyStore` arrangement). */
export const agentDistroSettingStore: CellStore<AgentDistroSetting> =
  inMemoryStore(DEFAULT_AGENT_DISTRO_SETTING);

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

function publishStatus(status: AgentDistroStatus): void {
  padiSurfaceCtx.cells.agentDistroStatus.set(status);
}

/** Publish what this host keeps of `setting`'s profile's updates — readable
 *  with agents off too (the profile the setting still names) — and which
 *  profiles have a run in flight. Nothing else to say on an unbaked padi or
 *  before the first push (no profile). Published when a run starts and when it
 *  ends, so `running` is never stale. */
function publishReceipt(setting: AgentDistroSetting): void {
  const bake = agentDistroBake();
  const profile = bake?.profiles.get(setting.profile);
  if (bake === null || profile === undefined) {
    padiSurfaceCtx.cells.agentDistroReceipt.set({
      ...EMPTY_AGENT_DISTRO_RECEIPT,
      profile: setting.profile,
      running: [...runningProfiles()],
    });
    return;
  }
  // During a run `current` may already point at the bundle being fetched:
  // the versions are the SERVING bundle's — an update's, or none for a first
  // download.
  const run = downloadOf(profile.name);
  const serving =
    run?.kind === "running" ? run.serving : bundleOnHost(bake, profile);
  padiSurfaceCtx.cells.agentDistroReceipt.set(
    readReceipt(
      profile,
      serving,
      unlandedRunOf(profile.name),
      runningProfiles(),
    ),
  );
}

/** Where `setting` stands on this host, as of now, without side effects — the
 *  ONE answer to "what does a new terminal get here": the published status is
 *  this with the layer reduced to its profile and bundle, and the spawn path
 *  stamps this layer ({@link newTerminalLayer}). So a host never reads one
 *  thing while its new terminals get another.
 *
 *  `needsDownload` is NOT a status anyone sees: it is the one state a caller
 *  must act on (start the download) before there is something true to publish,
 *  so it is kept out of {@link AgentDistroStatus} rather than spelled as a
 *  `downloading` that nothing is doing. */
export function assessAgentDistro(setting: AgentDistroSetting):
  | Exclude<AgentDistroStatus, { kind: "ready" }>
  | {
      readonly kind: "ready";
      readonly layer: AgentLayer;
      /** An update run is going; `layer` (the bundle that served when it
       *  started) keeps serving until it lands. */
      readonly update?: Extract<AgentDistroStatus, { kind: "ready" }>["update"];
    }
  | { readonly kind: "needsDownload"; readonly profile: string } {
  if (!setting.enabled) return { kind: "off" };
  const bake = agentDistroBake();
  if (bake === null) return { kind: "unavailable" };
  // A run's own state comes FIRST: the updater flips `current` before it
  // reports, so while it runs, or after it failed (say, it landed a bundle
  // other than the one it reported), an existing `current` is not a bundle any
  // terminal gets. An update keeps serving the bundle it started from.
  const download = downloadOf(setting.profile);
  if (download?.kind === "running" && download.serving !== undefined)
    return {
      kind: "ready",
      layer: {
        profile: setting.profile,
        bundle: download.serving,
        plugins: bake.plugins,
      },
      update:
        download.progress === undefined ? {} : { progress: download.progress },
    };
  if (download?.kind === "running")
    return {
      kind: "downloading",
      profile: setting.profile,
      ...(download.progress !== undefined
        ? { progress: download.progress }
        : {}),
    };
  if (download?.kind === "failed")
    return {
      kind: "error",
      profile: setting.profile,
      reason: download.failure.reason,
      message: download.failure.message,
    };
  const layer = layerOnHost(setting);
  // A bundle a run disowned is never ready, even once its failure is
  // forgotten: the retry downloads again.
  if (layer !== undefined && layer.bundle !== disownedBundleOf(layer.profile))
    return { kind: "ready", layer };
  // An update that did not land cleanly keeps the bundle that served.
  const kept = keptBundleOf(setting.profile);
  if (kept !== undefined)
    return {
      kind: "ready",
      layer: { profile: setting.profile, bundle: kept, plugins: bake.plugins },
    };
  return { kind: "needsDownload", profile: setting.profile };
}

/** What a terminal spawned NOW gets on this host — the same answer the host's
 *  status gives ({@link assessAgentDistro}): a layer only when it reads ready. */
export function newTerminalLayer(): AgentLayer | undefined {
  const assessed = assessAgentDistro(agentDistroSettingStore.get());
  return assessed.kind === "ready" ? assessed.layer : undefined;
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
    // profile (`layerOnHost` throws on an unknown one).
    if (bake === null || profile === undefined)
      throw new Error(`agent-distro: no bake for profile '${setting.profile}'`);
    startRun(bake, profile, undefined, RUN_CALLBACKS);
    publishReceiptLoud(setting);
    assessed = assessAgentDistro(setting);
    if (assessed.kind === "needsDownload")
      throw new Error(
        `agent-distro: starting the '${setting.profile}' download recorded neither a run nor a failure`,
      );
  }
  publishStatus(
    assessed.kind === "ready"
      ? {
          kind: "ready",
          profile: assessed.layer.profile,
          bundle: assessed.layer.bundle,
          ...(assessed.update === undefined ? {} : { update: assessed.update }),
        }
      : assessed,
  );
}

/** The `agentDistro` cell's `onWrite`: a CHANGED setting (the cell's `equals`
 *  drops a re-push of the same value, so a reconnect does not land here). Fires
 *  BEFORE the store write, so it reads `next`, never the store. Turning a
 *  profile on forgets its last failure — that is the retry. */
export function onAgentDistroSettingWrite(next: AgentDistroSetting): void {
  if (next.enabled) forgetFailure(next.profile);
  // The boot check is for the setting padi is first pushed: pushed off, it is
  // spent, and turning agents on later goes through the due rule.
  if (!next.enabled) bootCheckPending = false;
  settle(next);
  publishReceiptLoud(next);
  // A new setting starts its own count of scheduled attempts.
  attempts = undefined;
  askAgain = false;
  scheduledInFlight = false;
  // The timer reads the store, which the framework writes right after this
  // hook: ask on the next turn, against the new setting.
  queueMicrotask(() => updateTimer?.poke());
}

/** {@link publishReceipt}, never thrown into a caller that cannot act on it:
 *  a file that will not read (a history line upstream changed the shape of,
 *  say) is logged loudly AND published as the receipt's `error`, so the host's
 *  line in Settings says so instead of keeping the last good receipt. */
function publishReceiptLoud(setting: AgentDistroSetting): void {
  try {
    publishReceipt(setting);
  } catch (err) {
    log.error({ err }, "agent-distro receipt could not be read");
    padiSurfaceCtx.cells.agentDistroReceipt.set({
      ...EMPTY_AGENT_DISTRO_RECEIPT,
      profile: setting.profile,
      running: [...runningProfiles()],
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Re-publish the status for whatever setting is current — after a run
 *  reports bytes. A run for a profile no longer selected changes nothing
 *  visible, but its result is kept for when it is. */
function republish(): void {
  try {
    settle(agentDistroSettingStore.get());
  } catch (err) {
    // Runs from a run's own callbacks, where a throw has nowhere to go but
    // an unhandled rejection; logged loudly instead.
    log.error({ err }, "agent-distro status could not be re-published");
  }
}

/** Every run's callbacks: bytes re-publish the status; the end re-publishes the
 *  receipt FIRST, then the status — so a client that sees the new bundle can
 *  already read the update's words. */
const RUN_CALLBACKS = {
  onProgress: republish,
  onSettled: () => {
    scheduledRunEnded();
    publishReceiptLoud(agentDistroSettingStore.get());
    republish();
  },
} as const;

/** Why an update check did not start. */
export type UpdateCheckRefusal =
  /** A run of the selected profile is going (a first download or an update). */
  | "running"
  /** Nothing serves to update: agents off, no bake, or no bundle yet / a
   *  failed first download (the setting's own retry handles that). */
  | "notReady";

/** Run one update of the selected profile now — if `force`, whatever the
 *  schedule says (`checkNow`); else only when upstream's due rule says one is
 *  due. Answers `started`, `notDue`, or why it refused. */
export function checkForAgentUpdate(opts: {
  readonly force: boolean;
  /** Runs just before the run starts — the scheduled path counts its attempt. */
  readonly onStart?: () => void;
}): "started" | "notDue" | UpdateCheckRefusal {
  const setting = agentDistroSettingStore.get();
  if (!setting.enabled) return "notReady";
  const bake = agentDistroBake();
  const profile = bake?.profiles.get(setting.profile);
  if (bake === null || profile === undefined) return "notReady";
  const assessed = assessAgentDistro(setting);
  if (downloadOf(profile.name)?.kind === "running") return "running";
  if (assessed.kind !== "ready") return "notReady";
  if (
    !opts.force &&
    !updateDue(
      Math.floor(Date.now() / 1000),
      lastSuccessOf(profile),
      profile.schedule,
    )
  )
    return "notDue";
  opts.onStart?.();
  startRun(bake, profile, assessed.layer.bundle, RUN_CALLBACKS);
  // A run that could not even start (no `nix`) has already ended, without its
  // callbacks: count its end.
  if (downloadOf(profile.name)?.kind !== "running") scheduledRunEnded();
  publishReceiptLoud(setting);
  republish();
  return "started";
}

/** The scheduled runs of the current boundary (upstream's attempts), and
 *  whether the last scheduled ask met a run in flight. Reset by a new setting. */
let attempts: ScheduledAttempts | undefined;
let askAgain = false;
/** The run in flight is a scheduled one, so its end counts as an attempt's:
 *  the profile's unlanded run as it stood when that run started (a new one at
 *  its end is that run's), or `false` when no scheduled run is in flight. */
let scheduledInFlight: { readonly before: AgentUpdateRun | undefined } | false =
  false;
/** padi has started and has not yet run (or spent) its one boot check: armed by
 *  {@link startAgentDistroUpdates}, consumed by the first tick that finds
 *  agents on and a baked profile. */
let bootCheckPending = false;

/** A scheduled run ended, now: note whether it FAILED, which earns a retry
 *  five minutes after this end (a skip does not). */
function scheduledRunEnded(): void {
  if (scheduledInFlight === false || attempts === undefined) return;
  const { before } = scheduledInFlight;
  scheduledInFlight = false;
  const last = unlandedRunOf(agentDistroSettingStore.get().profile);
  attempts = attemptEnded(
    attempts,
    Math.floor(Date.now() / 1000),
    last !== undefined && last !== before && last.outcome === "failed",
  );
}

/** The timer's tick (`./scheduler.ts`): ask "is an update due" at a boundary,
 *  after an ask that met a run in flight, or to retry a failed scheduled run
 *  (`scheduledAskNow`); run one if upstream's rule says so. The first tick after
 *  boot with agents on runs the boot check instead: one update, forced, outside
 *  the scheduled attempts. */
export function onAgentUpdateTick(boundaryPassed: boolean): void {
  const nowMs = Date.now();
  const setting = agentDistroSettingStore.get();
  const schedule = agentDistroBake()?.profiles.get(setting.profile)?.schedule;
  if (!setting.enabled || schedule === undefined) return;
  if (bootCheckPending) {
    bootCheckPending = false;
    // Spent whatever it answers: a first download in flight already fetches
    // upstream's newest, and a failed one has the setting's own retry.
    const boot = checkForAgentUpdate({
      force: true,
      onStart: () =>
        log.info("agent-distro: boot check; running the updater once"),
    });
    if (boot === "started") return;
  }
  const now = Math.floor(nowMs / 1000);
  if (!scheduledAskNow({ now, schedule, boundaryPassed, askAgain, attempts }))
    return;
  const outcome = checkForAgentUpdate({
    force: false,
    onStart: () => {
      attempts = attemptStarted(attempts, now, schedule);
      scheduledInFlight = { before: unlandedRunOf(setting.profile) };
      log.info(
        { attempt: attempts.count },
        "agent-distro update due; running it",
      );
    },
  });
  askAgain = outcome === "running";
}

/** The update timer, once started at boot. */
let updateTimer: ReturnType<typeof startUpdateTimer> | undefined;

/** Start keeping the chosen profile current: the timer asks at each schedule
 *  boundary (and right away whenever the setting changes) and the due rule
 *  decides — after the one boot check, which this arms. Idle while agents are
 *  off or this padi is unbaked. Also publishes the receipt for the setting padi
 *  boots with. Called once, at boot. */
export function startAgentDistroUpdates(): () => void {
  publishReceiptLoud(agentDistroSettingStore.get());
  bootCheckPending = true;
  updateTimer?.stop();
  const timer = startUpdateTimer({
    schedule: () => {
      const setting = agentDistroSettingStore.get();
      if (!setting.enabled) return undefined;
      return agentDistroBake()?.profiles.get(setting.profile)?.schedule;
    },
    onTick: (boundaryPassed) => onAgentUpdateTick(boundaryPassed),
  });
  updateTimer = timer;
  return () => {
    timer.stop();
    if (updateTimer === timer) {
      updateTimer = undefined;
      bootCheckPending = false;
    }
  };
}
