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

const [opened, setOpened] = createStore<Record<string, true | undefined>>({});

const DOT: Record<AgentStateTone | "none", string> = {
  busy: "bg-busy animate-pulse motion-reduce:animate-none",
  alert: "bg-alert",
  "alert-linger": "bg-alert/50",
  quiet: "bg-fg-3",
  none: "bg-fg-3",
};

interface Status {
  readonly tone: keyof typeof DOT;
  readonly state: string;
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
  toggleTestId?: string;
  clock?: JSX.Element;
  lead?: JSX.Element;
  trail?: JSX.Element;
}> = (props) => {
  const standing = createMemo(() =>
    fleetTerminalStanding(props.host, props.id),
  );
  const live = createMemo(() => {
    const now = standing();
    return now.kind === "here" ? activeArm(now.meta) : undefined;
  });
  const lookable = () => live() !== undefined;
  const { showTipOnce } = useTips();
  const shown = useShown();
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
        return {
          tone: "none",
          state: "no agent",
          progress: null,
          doing: `running ${front.name}`,
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
        {props.lead}
        <span class={`h-2 w-2 shrink-0 rounded-full ${DOT[status().tone]}`} />
        <span
          data-testid="conductor-look-status"
          class="min-w-0 flex-1 truncate text-fg-2"
        >
          <span class="font-semibold text-fg">{status().state}</span>
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
        {props.trail}
      </div>
      <Show when={open() && lookable()}>
        <LookTail host={props.host} id={props.id} />
      </Show>
    </div>
  );
};

const LookTail: Component<{ host: string; id: TerminalId }> = (props) => {
  let box!: HTMLDivElement;
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

  const [lines, setLines] = createSignal<readonly LogLine[] | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);

  const shown = useShown();
  const readable = (): boolean => shown() && onScreen() && tabVisible();
  createEffect(() => {
    if (!readable()) return;
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

function failureSentence(err: unknown): string {
  const error = toError(err);
  if (error.message !== "") return error.message;
  return "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : "unknown error";
}

export default ConductorLook;
