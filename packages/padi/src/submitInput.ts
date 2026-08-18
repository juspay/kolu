/**
 * `lifecycle.submitInput` — the ONE-CALL dispatch: type a message into a driven
 * TUI, observe that the TUI took it, then press Enter. Server-side, because the
 * observation is the whole point and only padi can make it without a round trip
 * per step.
 *
 * ## What it replaces, and why the old refusal was right at the time
 *
 * `lifecycle.sendInput` writes bytes and nothing else, and `@kolu/terminal-protocol`'s
 * send policy refuses text + Enter in one call — an Enter written in the same
 * breath as the text races the TUI's bracketed-paste debounce and is swallowed.
 * That refusal stands: there is no delay a CALLER can bake in that fixes it,
 * because the caller cannot see when the TUI settled. The three-call ritual (text
 * → `wait_outputSettled` → Enter) existed precisely so the caller could observe
 * the settle from outside.
 *
 * What changed is WHO observes. padi already sees kaval's meaningful-output edge
 * for every PTY and already folds each terminal's detected agent state, so it can
 * do the observing itself, inside one call. This is not the `--submit` flag that
 * was refused: that one was a fixed sleep. This one is a SIGNAL.
 *
 * ## The mid-turn hazard, and the choice this module makes
 *
 * Typing into an agent that is mid-turn is not merely late — it can be
 * DESTRUCTIVE. Several TUIs clear a typed-but-unsubmitted input box when the turn
 * ends (a grok terminal ate exactly such a message on 2026-08-17): the text lands,
 * the turn finishes, the box is wiped, and the Enter that follows submits nothing.
 * The send reported success; the message never existed.
 *
 * Two honest answers were available — wait for the prompt to go idle BEFORE
 * typing, or type and then verify the echo on screen. This module takes the
 * FIRST:
 *
 *   1. wait until the terminal is at an idle prompt ({@link isPromptIdle}),
 *      bounded by `timeoutMs`;
 *   2. type the text;
 *   3. wait for the terminal to go quiet again (the TUI has taken the paste);
 *   4. press Enter.
 *
 * Echo-verification was rejected for two reasons, both structural rather than a
 * matter of effort. It does not close the race it claims to — the wipe can land
 * between the verification read and the Enter, which is the same gap in a smaller
 * costume. And it is not decidable in general: past a handful of lines Claude Code
 * folds a paste into a `[Pasted text #1 +N lines]` placeholder, so the thing you
 * would match against is not on screen at all.
 *
 * **The failure mode this buys, stated plainly.** A submit to a genuinely busy
 * agent does not queue and does not degrade — it REFUSES, loudly, with nothing
 * written ({@link SubmitOutcome}'s `phase: "ready"`). The caller retries or waits;
 * it never discovers, minutes later, that a brief evaporated. The other refusal
 * (`phase: "settle"`) is the one that leaves state behind: the text IS in the
 * input box and was NOT submitted, which the outcome says in as many words so the
 * caller can press Enter itself or Escape and start over.
 *
 * ## Why the readiness predicate has two conjuncts
 *
 * Output quiescence alone is the agent-agnostic signal, and it carries most of
 * the weight: a working agent redraws its spinner, so bytes keep moving. But a
 * recognized agent ALSO publishes its own state, and padi already folds it — so
 * when there is one, "not working" rides as a second conjunct. A silent thinking
 * pause that happens to exceed the quiet window is exactly the case the
 * agent-agnostic half cannot see, and it is the case where a message is lost.
 * When no agent is recognized (a bare shell, a REPL), the predicate is the quiet
 * window alone — the honest answer for a program with no turn to speak of.
 */

import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import { NAMED_KEY_BYTES } from "@kolu/terminal-protocol";
import type { Logger } from "pino";
import { abortableDelay } from "./abortableDelay.ts";
import { isKnownAgentCommand } from "./agentAdapters.ts";
import {
  createActivityTracker,
  type ActivityTracker,
} from "./activity/terminalActivityTracker.ts";
import { ptyHostClient } from "./ptyHost/index.ts";
import { getActiveTerminal, snapshotFor } from "./terminal-registry.ts";
import {
  ACTIVITY_RESUBSCRIBE_DELAY_MS,
  resubscribeStream,
} from "./terminalEndpoint/local.ts";

/** The submit's Enter, read off the shared key table rather than spelled `"\r"`
 *  here — the same byte `kolu send --key Enter` and the mobile key bar write, so
 *  a submit padi performs is byte-identical to one a caller performs. */
const ENTER = NAMED_KEY_BYTES.enter;

/** How often the readiness fold is re-evaluated. Under padi's own ~150 ms
 *  terminal fold and kaval's 200 ms activity-edge throttle, anything finer only
 *  re-reads facts that have not moved. */
const READINESS_POLL_MS = 100;

/** The signal a submit runs under when its caller passed none — a request edge
 *  always does, so this is the unit-test path. Minted ONCE at module scope
 *  rather than per call: a fresh `AbortController` per submit reads like a
 *  cancellation mechanism nobody wired up, when what is meant is "nothing can
 *  abort this". */
const NEVER_ABORTS: AbortSignal = new AbortController().signal;

// ── The predicate ────────────────────────────────────────────────────────────

/** What one readiness evaluation saw. Separated from the fold so the rule below
 *  is pure, and so a test states the world instead of building one. */
export interface PromptObservation {
  /** Is this still a LIVE terminal (an active PTY)? */
  readonly live: boolean;
  /** Has meaningful output landed inside the quiet window? */
  readonly noisy: boolean;
  /** The terminal's detected agent, when one is recognized. `undefined`/`null`
   *  means padi sees no agent here — a bare shell, a REPL, an agent that has not
   *  been identified yet. */
  readonly agent: AgentInfo | null | undefined;
  /** Is padi's own view of output live? A DOWN kaval activity feed means `noisy`
   *  is silence rather than quiet, and reading it as an idle prompt is precisely
   *  how a message would be typed into a working agent. */
  readonly feedLive: boolean;
  /** The pty's FOREGROUND process name (`"claude"`, `"zsh"`, …) — kaval's
   *  `foregroundProcess`, the same string `kolu ls` prints.
   *
   *  Present long before {@link PromptObservation.agent} is: a session, and so an
   *  agent state, exists only once a transcript does, which for Claude Code and
   *  grok means only after the first message is submitted. This is what says an
   *  agent is RUNNING here in the window where nothing can say what it is doing. */
  readonly foreground: string | undefined;
}

/** What counts as proof that a prompt is ready to be typed into.
 *
 *  `"quiet"` — output quiescence decides, and an unrecognized agent is no
 *  obstacle. Right for a terminal the caller has already SEEN: it is live, it
 *  has a prompt, and the only question is whether it is mid-turn.
 *
 *  `"agent"` — an AGENT must be running here: a recognized session that is not
 *  working, or, before any session exists, a foreground process that is a known
 *  agent command. Right for the first message after a `run` line, where the
 *  caller has seen nothing and quiet does not mean what it means later. See
 *  {@link isPromptIdle} for why the session half alone is unsatisfiable. */
export type ReadinessProof = "quiet" | "agent";

/** Is the terminal at an idle prompt — safe to type a message into?
 *
 *  Total over the observation, and deliberately NEGATIVE-biased: every unknown
 *  answers "not idle". A dropped activity feed is not quiet, and a working agent
 *  is never idle however long it has been silent.
 *
 *  ## What `"agent"` asks, and why it is not "is a session recognized"
 *
 *  It asks whether an AGENT IS RUNNING HERE, and takes either answer padi has:
 *  a recognized session that is not working, or — before any session exists —
 *  the pty's foreground process being a known agent command.
 *
 *  The second arm is not a convenience. Keyed on session recognition alone, this
 *  predicate is UNSATISFIABLE for the case it was written for: an adapter
 *  recognizes a conversation, and Claude Code and grok write the transcript it
 *  reads only once the FIRST message has been submitted. So the proof for the
 *  first message waited on something that only the first message could produce.
 *  Shipped that way, every real spawn-and-brief refused after 30 s while the
 *  agent sat plainly visible at its prompt (field report, 2026-08-19 — three
 *  parallel creates, claude and grok both up on screen, `wait_agentState`
 *  reporting no bucket for either).
 *
 *  A bare shell is still refused, which is the property the first arm was
 *  protecting: `bash` is not a known agent command, so a brief still cannot be
 *  typed at a shell prompt where it would be EXECUTED.
 *
 *  ## Why `readiness` exists — the boot gap, measured in the field
 *
 *  Under `"quiet"` an UNRECOGNIZED agent is not an obstacle: the quiet window
 *  decides alone, which is the honest answer for a bare shell or a REPL that has
 *  no turn to speak of. That reading is safe only when something is known to be
 *  at a prompt already.
 *
 *  It is NOT safe for the first message after a `run` line, and this is not
 *  theoretical: on 2026-08-18 a `lifecycle_create { run: "claude …", message }`
 *  reported `briefed` and the brief never reached the agent. Nothing had painted
 *  yet — the shell had not finished exec'ing claude — so the terminal was quiet
 *  for the whole window for reasons that had nothing to do with a prompt. padi
 *  typed into that gap and claude's TUI initialization discarded it. The probe
 *  that followed 3 s later became the session's FIRST message.
 *
 *  Silence before the first paint is indistinguishable from silence at a ready
 *  prompt, so no width of window fixes it — every fixed window is a guess about
 *  boot duration. `"agent"` replaces the guess with evidence: a recognized agent
 *  that is not working. It is the same negative bias applied to the one unknown
 *  that used to answer "idle" — an agent nobody has identified yet. */
export function isPromptIdle(
  observed: PromptObservation,
  readiness: ReadinessProof = "quiet",
): boolean {
  if (!observed.live) return false;
  if (!observed.feedLive) return false;
  if (observed.noisy) return false;
  const state = observed.agent?.state;
  // A recognized agent answers for itself, under either proof: working is never
  // idle however long it has been silent.
  if (state !== undefined) return agentBucket(state) !== "working";
  // Nothing recognized. `"quiet"` accepts that (a bare shell, a REPL — programs
  // with no turn to speak of); `"agent"` falls back to the identity that exists
  // before a session does, and refuses everything else.
  return readiness === "quiet" || isKnownAgentCommand(observed.foreground);
}

// ── The live view ────────────────────────────────────────────────────────────

/** A live readiness view of ONE terminal, held for the duration of a submit.
 *
 *  The seam every impure fact enters through, so {@link submitInput}'s sequence
 *  is testable without a PTY, a kaval, or a clock. */
export interface PromptWatch {
  /** Re-evaluate now. */
  observe(): PromptObservation;
  /** Restamp the quiet window — "bytes just moved". The sequence calls it after
   *  its own write, so the settle wait measures quiet from the moment the
   *  terminal was handed bytes rather than from the quiet it measured a step
   *  earlier. (The window's other start — when the activity feed comes up — is
   *  the watch's own, since only it knows when padi could first see output.) */
  arm(): void;
  close(): void;
}

/** Open a live {@link PromptWatch} on `id`, quiet-window `quietMs`.
 *
 *  The output half rides kaval's host-global meaningful-output edge through the
 *  SAME `createActivityTracker` the live dots and the effective-finish fold use —
 *  one timer machinery, three windows. The subscription is per-CALL and
 *  short-lived, which is `createLiveActivitySource`'s own shape (its source thunk
 *  opens one kaval subscription per subscriber); a submit lasts seconds, so a
 *  daemon-lifetime bus would buy nothing but a shared mutable it must then be
 *  careful with.
 *
 *  The agent half is a plain registry read: `snapshotFor` is the fold's own
 *  published snapshot, so this observes exactly what the `terminals` collection
 *  serves rather than a second opinion about the same terminal. */
export function openPromptWatch(
  id: TerminalId,
  quietMs: number,
  log: Logger,
): PromptWatch {
  const tracker: ActivityTracker = createActivityTracker(quietMs);
  const abort = new AbortController();
  let feedLive = false;

  void resubscribeStream({
    signal: abort.signal,
    delayMs: ACTIVITY_RESUBSCRIBE_DELAY_MS,
    getStream: () => ptyHostClient.surface.activity.get({}),
    onFeedLive: (live) => {
      // A feed that just came UP has watched none of the window it is about to be
      // asked about, so restamp: the submit waits a full quiet window from the
      // moment padi could actually see output, never from a gap it slept through.
      // This is ALSO the initial arm — the watch is born feed-down, so no
      // observation can read as idle before this fires, and a second `noteOutput`
      // at construction would be a stamp nothing can see.
      if (live) tracker.noteOutput(id);
      feedLive = live;
    },
    onEvent: (edge) => {
      if ((edge.id as TerminalId) === id) tracker.noteOutput(id);
    },
    onDrop: (err) => {
      feedLive = false;
      log.debug(
        { err, terminal: id },
        "kaval activity subscribe failed (submit)",
      );
    },
  });

  return {
    observe: () => ({
      live: getActiveTerminal(id) !== undefined,
      noisy: tracker.isLive(id),
      agent: snapshotFor(id)?.agent,
      foreground: snapshotFor(id)?.foreground?.name,
      feedLive,
    }),
    arm: () => tracker.noteOutput(id),
    close: () => {
      abort.abort();
      tracker.dispose();
    },
  };
}

// ── The sequence ─────────────────────────────────────────────────────────────

/** How a submit ended.
 *
 *  `phase` on a refusal is the recovery, not a diagnostic: `"ready"` means
 *  NOTHING was written (retry freely), `"settle"` means the text IS sitting in
 *  the input box unsubmitted (press Enter, or Escape and re-send — but do not
 *  simply re-send, or the message lands twice). */
export type SubmitOutcome =
  | {
      readonly kind: "submitted";
      readonly readyAfterMs: number;
      readonly settledAfterMs: number;
    }
  | {
      readonly kind: "refused";
      readonly phase: "ready" | "settle";
      readonly reason: "busy" | "gone" | "unrecognized";
      readonly waitedMs: number;
    };

/** Block until `watch` reports an idle prompt, or the bound expires.
 *
 *  Returns the ms actually waited so the caller can report it — a submit that
 *  waited 12 s for an agent to finish is a fact the driving loop should see, and
 *  it is the number that tells a human whether the bound is set anywhere near
 *  right. A terminal that DIES mid-wait ends the wait at once: waiting out a
 *  60-second bound on a PTY that no longer exists is time spent learning nothing.
 *
 *  An ABORTED request ends the wait as `busy`, and that reading never reaches a
 *  caller: abort means the request edge tore the fiber down, so the value is
 *  discarded on the way out. What matters is what it does NOT do — it stops
 *  polling, and it stops before the next write, so an abandoned submit leaves the
 *  terminal exactly where the last completed step left it. */
async function awaitPromptIdle(
  watch: PromptWatch,
  timeoutMs: number,
  clock: () => number,
  signal: AbortSignal,
  readiness: ReadinessProof,
): Promise<IdleWait> {
  const started = clock();
  for (;;) {
    // ABORT IS READ FIRST, before the world is even looked at. It used to be
    // read on the same branch as the timeout — AFTER the idle check — which
    // meant an aborted request whose target happened to be idle sailed straight
    // through, typed the text, and pressed Enter: a cancelled call delivering
    // the whole message to a terminal nobody was left watching. Pinned by
    // `submitInput.test.ts`'s already-idle abort case.
    if (signal.aborted) return { kind: "busy", waitedMs: clock() - started };
    const observed = watch.observe();
    const waitedMs = clock() - started;
    if (!observed.live) return { kind: "gone", waitedMs };
    if (isPromptIdle(observed, readiness)) return { kind: "idle", waitedMs };
    if (waitedMs >= timeoutMs) {
      // WHY the bound expired, read off the world as it stands rather than
      // assumed — the two answers send the caller to different places. "busy" is
      // an agent mid-turn: wait and retry, it will finish. "unrecognized" is a
      // terminal padi never identified an agent in at all, where retrying the
      // same call waits out the same bound again; what that caller needs to hear
      // is that `message` briefs a RECOGNIZED agent, and that a non-agent
      // command wants a create without `message` instead.
      const unrecognized =
        readiness === "agent" && observed.agent?.state === undefined;
      return { kind: unrecognized ? "unrecognized" : "busy", waitedMs };
    }
    await abortableDelay(READINESS_POLL_MS, signal);
  }
}

/** How one readiness wait ended. Its non-`idle` arm carries exactly
 *  {@link SubmitOutcome}'s `reason` vocabulary, so the projection below is a
 *  NARROW rather than a translation table that could drift from it — add a way
 *  for a wait to end and the compiler asks what refusal it becomes. */
type IdleWait =
  | { readonly kind: "idle"; readonly waitedMs: number }
  | {
      readonly kind: Extract<SubmitOutcome, { kind: "refused" }>["reason"];
      readonly waitedMs: number;
    };

/** The refusal a non-idle wait becomes, at the phase it happened in — written
 *  once, because the two call sites differ ONLY in that phase and a second copy
 *  is how one of them would come to report the other's recovery. */
const refusedAt = (
  phase: "ready" | "settle",
  wait: Exclude<IdleWait, { kind: "idle" }>,
): SubmitOutcome => ({
  kind: "refused",
  phase,
  reason: wait.kind,
  waitedMs: wait.waitedMs,
});

/** Type `data`, observe the TUI take it, then press Enter.
 *
 *  Every impure edge is injected — the readiness view, the byte write, the clock
 *  — so the four-step sequence and its two refusal shapes are unit-testable
 *  without a terminal. The production wiring is `servePadi.ts`'s one call site.
 *
 *  `data` arrives ALREADY ENCODED by the caller's send policy (bracketed-paste
 *  wrapped when the payload calls for it). This module adds exactly one byte
 *  sequence of its own — the Enter — and never re-decides how the text is
 *  written: a submitted message must be byte-identical to the same message sent
 *  the manual way. */
export async function submitInput(opts: {
  readonly watch: PromptWatch;
  readonly write: (data: string) => void;
  readonly data: string;
  readonly timeoutMs: number;
  readonly clock?: () => number;
  readonly signal?: AbortSignal;
  /** What proves the prompt is ready. Defaults to `"quiet"` — the rule for a
   *  terminal the caller has already seen. The first message after a `run` line
   *  passes `"agent"`; see {@link isPromptIdle} for the field failure that
   *  distinction exists to stop. */
  readonly readiness?: ReadinessProof;
}): Promise<SubmitOutcome> {
  const clock = opts.clock ?? Date.now;
  const signal = opts.signal ?? NEVER_ABORTS;
  const readiness = opts.readiness ?? "quiet";

  // ── 1. the prompt must be idle BEFORE anything is typed ──────────────────
  // The whole mid-turn doctrine is this one wait: refusing here costs a retry,
  // and typing here costs the message.
  const ready = await awaitPromptIdle(
    opts.watch,
    opts.timeoutMs,
    clock,
    signal,
    readiness,
  );
  if (ready.kind !== "idle") return refusedAt("ready", ready);

  // ── 2. the text ──────────────────────────────────────────────────────────
  opts.write(opts.data);
  // Our own write IS output about to happen, so the settle window starts now
  // rather than from whatever the last observed edge was — otherwise the first
  // poll reads the quiet we just measured in step 1 and submits into a TUI that
  // has not seen a byte yet.
  opts.watch.arm();

  // ── 3. the TUI has taken it ──────────────────────────────────────────────
  // The SAME readiness rule as step 1, deliberately: having required a
  // recognized agent before typing, accepting mere quiet now would let the
  // Enter go to a terminal whose agent had vanished underneath the paste.
  const settled = await awaitPromptIdle(
    opts.watch,
    opts.timeoutMs,
    clock,
    signal,
    readiness,
  );
  if (settled.kind !== "idle") return refusedAt("settle", settled);

  // ── 4. submit ────────────────────────────────────────────────────────────
  opts.write(ENTER);
  return {
    kind: "submitted",
    readyAfterMs: ready.waitedMs,
    settledAfterMs: settled.waitedMs,
  };
}
