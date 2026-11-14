/** LOOK — the agent a create card started, seen from the chat.
 *
 *  A `lifecycle_create` card that names its terminal is the Conductor's line
 *  about an agent: "the planner is up". This is what turns that line into
 *  something a person can check without leaving the conversation. Two parts:
 *
 *  THE STATUS LINE is always there and costs nothing. It reads the terminal
 *  out of the fleet roster the client already mirrors for every host
 *  (`fleetTerminalStanding`, the same per-host streams the switcher and the `@`
 *  menu read), so it opens no stream of its own: the agent's state, how far
 *  through its own task list it is when it keeps one (`7/12`, the fraction
 *  the tile's meta line and the Inspector's card print — the record is
 *  already in hand, so this is the one place the Conductor's rows and its
 *  agent lines both get it from), and what the agent says it is doing. A
 *  terminal no longer in that roster says "terminal gone", and a sleeping one
 *  says "asleep": neither has a live screen, so neither offers Look.
 *
 *  A terminal with NO detected agent is read through its foreground program:
 *  the shell is "no agent · at the shell", and one of kolu's own agent
 *  binaries is "starting <that agent>" — detection has not landed yet, and
 *  saying "no agent · running omp" in one breath contradicts itself.
 *
 *  THE TAIL is what Look opens: the last {@link LOOK_LINES} lines of that
 *  terminal's screen, as read-only text, read with `screen.text { id, tail }`
 *  from the terminal's OWN host and re-read every {@link LOOK_EVERY_MS} ms. It
 *  reads only while somebody can see it — open, on screen, in a visible tab,
 *  and in a conductor pane that is the shown view (`useShown`) —
 *  because a transcript can hold a dozen agent lines and each one left open
 *  would otherwise poll a machine forever for a box scrolled out of view, or
 *  for a conversation the reader left ten minutes ago. Closed, nothing is
 *  fetched: the reader is a child that exists only while the tail is open, so
 *  closing it is what ends the work.
 *
 *  WHETHER IT IS OPEN lives outside the card, keyed by the row's id. The pane
 *  itself is retained across a tab switch now, so this is no longer what
 *  survives that trip — but the transcript still replaces a row OBJECT on
 *  every update and still moves a settled call into its "Details" fold, which
 *  rebuilds the card under the person who opened it. A Look opened on the
 *  planner is expected still open when the card comes back, so the answer
 *  stays keyed by the row rather than held in the card.
 *
 *  A failed read is SHOWN, beside whatever the last good read was — never an
 *  empty box, which would read as an agent with nothing on its screen. */

import { makeEventListener } from "@solid-primitives/event-listener";
import { LogTail, type LogLine } from "@kolu/solid-logtail";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import { activeArm } from "@kolu/padi-client/surface";
import { decodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import {
  batch,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { createStore } from "solid-js/store";
import { toast } from "solid-sonner";
import { fleetTerminalStanding } from "../palette/fleetTerminals";
import { runOwnedAction } from "../runAction";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import {
  type AgentStateTone,
  agentNameForBinary,
  formatTaskProgress,
  stateLabels,
  stateTones,
  taskProgressTitle,
} from "../ui/agentDisplay";
import { padiRpcOf } from "../wire";
import { useShown } from "../ui/shown";

/** How much of the screen Look shows. */
export const LOOK_LINES = 40;

/** How often an open, visible Look re-reads its terminal. */
export const LOOK_EVERY_MS = 2_000;

/** Which rows have Look open, by row id. Module-level so the answer outlives
 *  the card that drew it — a fold swallowing a settled call, a row object
 *  replaced by an update (see the header). */
const [opened, setOpened] = createStore<Record<string, true | undefined>>({});

/** The dot's paint, per agent tone — the same families the dock pip and the
 *  Inspector's status card use: rust working, violet needs-you, violet at half
 *  strength for an agent that has finished its turn. */
const DOT: Record<AgentStateTone | "none", string> = {
  busy: "bg-busy animate-pulse motion-reduce:animate-none",
  alert: "bg-alert",
  "alert-linger": "bg-alert/50",
  none: "bg-fg-3",
};

/** The status line's words: what the terminal is, how far through its task
 *  list the agent in it says it is, and what it says it is doing (when it
 *  says anything). */
interface Status {
  readonly tone: keyof typeof DOT;
  readonly state: string;
  /** HOW MANY OF ITS OWN TASKS ARE DONE — `7/12` and the sentence that says
   *  what the fraction counts — for an agent that reports a task list, and
   *  `null` for one that does not (most states, and every agent that keeps no
   *  list). The fraction is the formatter the tile's meta line and the
   *  Inspector's card already print, so the Conductor does not spell progress
   *  a second way.
   *
   *  It costs no reading of its own: it is on the record this line is already
   *  holding, which is what makes it drawable on the transcript's agent lines
   *  and on every watched row, in both placements, without a subscription per
   *  row. */
  readonly progress: { readonly text: string; readonly title: string } | null;
  readonly doing: string | null;
}

const ConductorLook: Component<{
  /** The transcript row this line belongs to — the key Look's open state is
   *  remembered under. */
  rowId: string;
  /** The ENCODED host key the terminal lives on (`local`, `remote:…`). */
  host: string;
  id: TerminalId;
  /** What the Look/Hide button is found by. The transcript's agent lines are
   *  `conductor-look-toggle`; the watched panel draws the SAME peek under its
   *  own name, so a test can say which of the two it pressed. */
  toggleTestId?: string;
  /** HOW LONG IT HAS STOOD THIS WAY, drawn between the state and the Look —
   *  the watched panel's clock, which belongs on this line because this line
   *  is what it is a duration OF. Absent on the transcript's agent lines,
   *  which say what a call did and not how long ago.
   *
   *  An element rather than a number: what is honest to count differs by
   *  state (kolu keeps no per-state timestamp — see the watched panel), so
   *  the words are the caller's and this component only gives them their
   *  place. */
  clock?: JSX.Element;
}> = (props) => {
  const standing = createMemo(() =>
    fleetTerminalStanding(props.host, props.id),
  );
  /** The terminal's live arm, when it has one — the ONE read of the standing
   *  both the words and the Look button derive from. Only an ACTIVE terminal
   *  has a screen: a sleeping one is in the roster but `screen.text` cannot
   *  read it, so "asleep" is a status with nothing behind it — like "terminal
   *  gone". */
  const live = createMemo(() => {
    const now = standing();
    return now.kind === "here" ? activeArm(now.meta) : undefined;
  });
  const lookable = () => live() !== undefined;
  const { showTipOnce } = useTips();
  const shown = useShown();
  // The first agent line with something to look at is the moment Look is
  // worth announcing; `showTipOnce` keeps it to once per browser. A pane kept
  // alive behind a host tab must not spend that one announcement on a toast
  // over somebody's terminal, so it waits until the conversation is the view
  // being read.
  createEffect(() => {
    if (shown() && lookable()) showTipOnce(CONTEXTUAL_TIPS.conductorLook);
  });

  const status = createMemo((): Status => {
    const now = standing();
    switch (now.kind) {
      case "gone":
        return {
          tone: "none",
          state: "terminal gone",
          progress: null,
          doing: null,
        };
      case "loading":
        return {
          tone: "none",
          state: "finding the terminal…",
          progress: null,
          doing: null,
        };
      case "unreachable":
        return {
          tone: "none",
          state: "its host is not connected",
          progress: null,
          doing: null,
        };
      case "here": {
        const arm = live();
        if (arm === undefined)
          return {
            tone: "none",
            state: "asleep",
            progress: null,
            doing: null,
          };
        const agent = arm.agent;
        if (agent !== null) {
          const tasks = agent.taskProgress;
          return {
            tone: stateTones[agent.state],
            state: stateLabels[agent.state] ?? agent.state,
            progress:
              tasks === null
                ? null
                : {
                    text: formatTaskProgress(tasks),
                    title: taskProgressTitle(tasks),
                  },
            doing: agent.summary,
          };
        }
        const front = arm.foreground;
        if (front === null || front.shell)
          return {
            tone: "none",
            state: "no agent",
            progress: null,
            doing: "at the shell",
          };
        // THE PROGRAM IN FRONT IS ONE OF OURS, and nothing has been detected
        // in it yet: that is an agent coming up, not a terminal without one.
        // "no agent · running omp" said both halves of that at once and
        // believed neither. The recognition is the agent registry's own
        // `cli.basename` — there is no second list of agent names here.
        const starting = agentNameForBinary(front.name);
        return starting === undefined
          ? {
              tone: "none",
              state: "no agent",
              progress: null,
              doing: `running ${front.name}`,
            }
          : {
              tone: "none",
              state: `starting ${starting}`,
              progress: null,
              doing: null,
            };
      }
    }
  });

  const open = () => opened[props.rowId] === true;

  return (
    <div
      data-testid="conductor-look"
      data-standing={standing().kind}
      class="col-span-full min-w-0"
    >
      <div class="flex min-w-0 items-center gap-2">
        <span class={`h-2 w-2 shrink-0 rounded-full ${DOT[status().tone]}`} />
        <span
          data-testid="conductor-look-status"
          class="min-w-0 flex-1 truncate text-fg-2"
        >
          <span class="font-semibold text-fg">{status().state}</span>
          {/* BESIDE THE STATE, ahead of what it is doing: `working · 7/12 ·
              writing the plan`. The fraction is the one number on this line, so
              it is `tabular-nums` — a row whose count ticks over must not shift
              the words after it. */}
          <Show when={status().progress}>
            {(tasks) => (
              <>
                {" · "}
                <span
                  data-testid="conductor-look-progress"
                  class="tabular-nums"
                  title={tasks().title}
                >
                  {tasks().text}
                </span>
              </>
            )}
          </Show>
          <Show when={status().doing}>{(doing) => <> · {doing()}</>}</Show>
        </span>
        {props.clock}
        <Show when={lookable()}>
          <button
            type="button"
            data-testid={props.toggleTestId ?? "conductor-look-toggle"}
            aria-expanded={open()}
            class="shrink-0 rounded-md border border-edge-bright bg-surface-2 px-2 py-px text-[0.7rem] font-semibold text-accent hover:bg-surface-3 cursor-pointer"
            onClick={() => setOpened(props.rowId, open() ? undefined : true)}
          >
            {open() ? "Hide" : "Look"}
          </button>
        </Show>
      </div>
      <Show when={open() && lookable()}>
        <LookTail host={props.host} id={props.id} />
      </Show>
    </div>
  );
};

/** The open tail, and the reading behind it. Exists only while Look is open on
 *  a terminal the roster still has — so its owner IS the reading's lifetime. */
const LookTail: Component<{ host: string; id: TerminalId }> = (props) => {
  let box!: HTMLDivElement;
  /** On screen — the transcript scrolls, and an agent line an hour up is not
   *  being looked at whatever its toggle says. `false` until the observer has
   *  said otherwise, so nothing is read for a box nobody has seen yet. */
  const [onScreen, setOnScreen] = createSignal(false);
  const [tabVisible, setTabVisible] = createSignal(
    document.visibilityState === "visible",
  );
  makeEventListener(document, "visibilitychange", () =>
    setTabVisible(document.visibilityState === "visible"),
  );
  onMount(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setOnScreen(entry.isIntersecting);
    });
    observer.observe(box);
    onCleanup(() => observer.disconnect());
  });

  /** The last good read, or `null` before the first one lands. */
  const [lines, setLines] = createSignal<readonly LogLine[] | null>(null);
  /** The last read's failure, cleared by the next read that succeeds. */
  const [failure, setFailure] = createSignal<string | null>(null);

  const shown = useShown();
  createEffect(() => {
    // THREE GATES, one of them not about this box at all: the pane may be
    // retained behind a host tab, in which case the whole conversation is off
    // screen however well laid out this tail is. It is asked FIRST and as a
    // contextual fact — never inferred from the element, whose observer and
    // measurements describe layout rather than attention.
    if (!shown() || !onScreen() || !tabVisible()) return;
    const host = decodeHostKey(props.host);
    const id = props.id;
    const readOnce = Effect.suspend(() =>
      padiRpcOf(host).screen.text({ id, tail: LOOK_LINES }),
    ).pipe(
      Effect.matchEffect({
        onSuccess: (text) =>
          Effect.sync(() =>
            batch(() => {
              setLines(
                text === "" ? [] : text.split("\n").map((line) => ({ line })),
              );
              setFailure(null);
            }),
          ),
        onFailure: (err) => Effect.sync(() => setFailure(failureSentence(err))),
      }),
    );
    // Owned by THIS effect run: a re-run (scrolled away, tab hidden) or the
    // tail closing interrupts the loop, mid-read or mid-sleep.
    runOwnedAction(
      "read the terminal's last lines",
      Effect.forever(
        readOnce.pipe(Effect.andThen(() => Effect.sleep(LOOK_EVERY_MS))),
      ),
    );
  });

  return (
    <div ref={box} data-testid="conductor-look-tail" class="mt-1.5 min-w-0">
      <Show when={failure()}>
        {(why) => (
          <p
            data-testid="conductor-look-error"
            class="mb-1 font-mono text-[0.65rem] text-danger"
          >
            Could not read the screen: {why()}
          </p>
        )}
      </Show>
      <Show
        when={lines()}
        fallback={
          <Show when={failure() === null}>
            <p class="font-mono text-[0.65rem] text-fg-3">
              reading the screen…
            </p>
          </Show>
        }
      >
        {(read) => (
          <Show
            when={read().length > 0}
            fallback={
              <p class="font-mono text-[0.65rem] text-fg-3">
                the screen is empty
              </p>
            }
          >
            <LogTail
              testid="conductor-look-lines"
              lines={read()}
              log={read()}
              class="max-h-60 overflow-y-auto px-2.5 py-2 text-[0.65rem] leading-relaxed"
              onCopyError={(message) =>
                toast.error(`Failed to copy the screen: ${message}`)
              }
            />
          </Show>
        )}
      </Show>
      <p class="mt-1 text-[0.62rem] text-fg-3">
        The last {LOOK_LINES} lines of its screen, as text. Read-only; refreshed
        every {LOOK_EVERY_MS / 1000} s while open.
      </p>
    </div>
  );
};

/** A read's failure as the sentence a person reads. A tagged surface error
 *  with no message of its own is named by its tag rather than shown blank. */
function failureSentence(err: unknown): string {
  const error = toError(err);
  if (error.message !== "") return error.message;
  return "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : "unknown error";
}

export default ConductorLook;
