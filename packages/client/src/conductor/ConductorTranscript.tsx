import { formatBytes } from "@kolu/byte-units";
import type {
  ConductorRow,
  ConductorToolRow,
  ConductorWorkAskRow,
} from "kolu-common/conductor";
import { Key } from "@solid-primitives/keyed";
import type { WorkId } from "kolu-work";
import {
  type Accessor,
  type Component,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  Show,
  Switch,
  useContext,
} from "solid-js";
import ScrollToBottom from "../terminal/ScrollToBottom";
import ConductorAsk from "./ConductorAsk";
import ConductorProse from "./ConductorProse";
import ConductorToolCard from "./ConductorToolCard";
import { useShown } from "../ui/shown";
import { thumbnailOf } from "./thumbnails";
import {
  foldFailureRuns,
  foldNoticeRuns,
  foldToolRuns,
  type TranscriptItem,
} from "./transcript";
import {
  applyTranscriptScroll,
  pinTranscript,
  rememberTranscriptScroll,
  transcriptPinned,
  unpinTranscript,
} from "./transcriptScroll";
import { type FileHolders, fileHolders } from "./namedFiles";
import { chatScope } from "./chatScope";
import { agentNotes, quietChat, type QuietTurn } from "./quietChat";
import type { Turn } from "./turnWorks";
import { useConductor } from "./useConductor";
import { wakeHeadline, wakeWhen } from "./wake";
import { useWorkMap } from "./useWorks";
import WorkChip from "./WorkChip";
import WorkChipFace from "./WorkChipFace";
import WorkQuestion from "./WorkQuestion";

const NO_WORKS: ReadonlyArray<WorkId> = [];

interface Turns {
  readonly turnOf: (rowId: string) => Turn;
  readonly holders: () => FileHolders;
}
const TurnsContext = createContext<Turns>();

const useTurns = (): Turns => {
  const turns = useContext(TurnsContext);
  if (turns === undefined)
    throw new Error("a transcript row was drawn outside its transcript");
  return turns;
};

const sameWorks = (
  a: ReadonlyArray<WorkId>,
  b: ReadonlyArray<WorkId>,
): boolean => a.length === b.length && a.every((one, i) => one === b[i]);

const TurnChips: Component<{ works: ReadonlyArray<WorkId> }> = (props) => {
  const map = useWorkMap();
  return (
    <div
      data-testid="conductor-turn-works"
      class="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      <For each={props.works}>
        {(id) => (
          <Show when={map().get(id)}>
            {(work) => <WorkChip id={id} work={work()} />}
          </Show>
        )}
      </For>
    </div>
  );
};

const TurnHead: Component<{ rows: ReadonlyArray<ConductorRow> }> = (props) => {
  const turns = useTurns();
  const works = createMemo(
    () => {
      const first = props.rows[0];
      if (first === undefined || first.kind === "user" || first.kind === "wake")
        return NO_WORKS;
      const turn = turns.turnOf(first.id);
      return turn.head === first.id ? turn.works : NO_WORKS;
    },
    NO_WORKS,
    { equals: sameWorks },
  );
  return (
    <Show when={works().length > 0}>
      <TurnChips works={works()} />
    </Show>
  );
};

const [pressed, setPressed] = createSignal<Readonly<Record<string, boolean>>>(
  {},
);

const FoldLine: Component<{
  turn: QuietTurn;
  works: ReadonlyArray<WorkId>;
  open: boolean;
}> = (props) => {
  const map = useWorkMap();
  const when = createMemo(() => wakeWhen(props.turn.since));
  const toggle = () =>
    setPressed((was) => ({ ...was, [props.turn.head]: !props.open }));
  return (
    <button
      type="button"
      data-testid="conductor-fold-line"
      data-turn={props.turn.head}
      data-open={props.open ? "" : undefined}
      data-quiet={props.turn.says.kind === "prose" ? undefined : ""}
      aria-expanded={props.open}
      onClick={toggle}
      class="flex w-full min-w-0 cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-sm text-left"
      classList={{ "mt-4": props.open }}
    >
      <span
        class="flex min-w-0 max-w-full items-center gap-1.5"
        classList={{ "basis-full": !props.open && props.works.length > 1 }}
      >
        <span aria-hidden="true" class="w-2 shrink-0 text-fg-3">
          {props.open ? "▾" : "▸"}
        </span>
        <Show when={when()}>
          {(clock) => (
            <span class="shrink-0 font-mono text-[0.68rem] text-fg-3 tabular-nums">
              {clock()}
            </span>
          )}
        </Show>
        <Show when={!props.open}>
          <For each={props.works}>
            {(id) => (
              <Show when={map().get(id)}>
                {(work) => (
                  <span class="inline-flex min-w-0 max-w-[15ch] shrink">
                    <WorkChipFace work={work()} />
                  </span>
                )}
              </Show>
            )}
          </For>
        </Show>
      </span>
      <Show when={!(props.open && props.turn.says.kind === "prose")}>
        <span
          data-testid="conductor-fold-says"
          class="min-w-[16rem] flex-1 basis-0 truncate text-[0.8rem]"
          classList={{
            "text-fg-2": props.turn.says.kind === "prose",
            "text-fg-3": props.turn.says.kind !== "prose",
          }}
        >
          <Show when={props.turn.says.kind === "noted"}>
            <span class="font-mono text-[0.68rem]">noted · </span>
          </Show>
          {props.turn.says.kind === "prose"
            ? props.turn.says.headline
            : props.turn.says.kind === "noted"
              ? props.turn.says.text
              : "no reply"}
        </span>
      </Show>
    </button>
  );
};

const ChatWorkQuestion: Component<{ row: ConductorWorkAskRow }> = (props) => {
  const works = useWorkMap();
  const work = createMemo(() => works().get(props.row.work));
  return (
    <Show when={work()}>
      {(one) => (
        <WorkQuestion
          work={one()}
          id={props.row.work}
          ask={props.row.id}
          from="chat"
        />
      )}
    </Show>
  );
};

function followTranscriptWhileShown(watch: {
  readonly scroller: () => HTMLDivElement;
  readonly newRows: Accessor<string>;
  readonly proseRedraws: Accessor<number>;
  readonly shown: Accessor<boolean>;
  readonly onNewsBelow: (news: boolean) => void;
}): void {
  let placed = false;
  createEffect(
    on(
      [watch.newRows, watch.proseRedraws, transcriptPinned, watch.shown],
      ([drawn, , pinned, visible], prev) => {
        const el = watch.scroller();
        if (prev === undefined || (visible && !placed)) {
          applyTranscriptScroll(el);
          placed = el.scrollHeight > el.clientHeight;
          return;
        }
        if (!visible) return;
        if (pinned) {
          el.scrollTop = el.scrollHeight;
          watch.onNewsBelow(false);
          return;
        }
        if (prev[0] !== drawn) watch.onNewsBelow(true);
      },
    ),
  );
}

const ConductorTranscript: Component<{
  rows: readonly ConductorRow[];
  turns: ReadonlyMap<string, Turn>;
  pending: boolean;
  error: Error | undefined;
  containerRef: (el: HTMLDivElement) => void;
}> = (props) => {
  let scroller!: HTMLDivElement;
  const items = createMemo(() =>
    foldFailureRuns(foldToolRuns(foldNoticeRuns(props.rows))),
  );
  const workMap = useWorkMap();
  const holders = createMemo(() => fileHolders(workMap()));
  const turns = () => props.turns;
  const turnsContext: Turns = {
    turnOf: (rowId) => {
      const turn = turns().get(rowId);
      if (turn === undefined)
        throw new Error(`transcript row ${rowId} has no turn`);
      return turn;
    },
    holders,
  };

  const notes = createMemo(() => agentNotes(workMap()));
  const quiet = createMemo(() => quietChat(props.rows, notes()));
  const opened = (turn: QuietTurn): boolean =>
    pressed()[turn.head] ?? turn.open;
  const inScope = (rowId: string): boolean => {
    const id = chatScope()?.id;
    return (
      id === undefined || (turns().get(rowId)?.works.includes(id) ?? false)
    );
  };

  const [unseen, setUnseen] = createSignal(false);

  const newRowsSignature = createMemo(() => {
    const rows = props.rows;
    const last = rows[rows.length - 1];
    return `${rows.length}:${last === undefined || last.kind === "plan" ? 0 : last.text.length}`;
  });

  const [proseRedrawTick, setProseRedrawTick] = createSignal(0);

  followTranscriptWhileShown({
    scroller: () => scroller,
    newRows: newRowsSignature,
    proseRedraws: proseRedrawTick,
    shown: useShown(),
    onNewsBelow: setUnseen,
  });

  return (
    <div class="relative flex-1 min-h-0 min-w-0 flex flex-col">
      <div
        data-testid="conductor-transcript"
        ref={(el) => {
          scroller = el;
          props.containerRef(el);
        }}
        onScroll={(event) => rememberTranscriptScroll(event.currentTarget)}
        onWheel={(event) => {
          if (event.deltaY < 0) unpinTranscript(event.currentTarget);
        }}
        class="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden flex flex-col gap-2 px-5 py-3"
      >
        <Show when={props.error}>
          {(err) => (
            <p
              data-testid="conductor-transcript-error"
              class="text-danger text-xs"
            >
              The transcript stopped: {err().message}
            </p>
          )}
        </Show>
        <Show when={props.pending && props.rows.length === 0}>
          <p class="text-fg-3 text-xs">Opening the conversation…</p>
        </Show>
        <TurnsContext.Provider value={turnsContext}>
          <Key each={items()} by={(item) => item.key}>
            {(item) => {
              const first = createMemo(() => rowsOf(item())[0] as ConductorRow);
              const turn = createMemo(() => {
                const one = quiet().of.get(first().id);
                if (one === undefined)
                  throw new Error(`transcript row ${first().id} has no turn`);
                return one;
              });
              const works = createMemo(
                () => turns().get(first().id)?.works ?? NO_WORKS,
                NO_WORKS,
                { equals: sameWorks },
              );
              const asked = createMemo(() => turn().asks.has(first().id));
              const drawn = createMemo(
                () =>
                  inScope(first().id) &&
                  (!turn().folds || opened(turn()) || asked()),
              );
              return (
                <>
                  <Show
                    when={
                      chatScope() === null &&
                      quiet().since?.from === first().id &&
                      quiet().since
                    }
                  >
                    {(run) => (
                      <p
                        data-testid="conductor-since-heading"
                        data-count={run().count}
                        class="mt-5 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-fg-3"
                      >
                        Since your last message · {run().count}{" "}
                        {run().count === 1 ? "update" : "updates"}
                      </p>
                    )}
                  </Show>
                  <Show
                    when={
                      turn().folds &&
                      turn().head === first().id &&
                      inScope(first().id)
                    }
                  >
                    <FoldLine
                      turn={turn()}
                      works={works()}
                      open={opened(turn())}
                    />
                  </Show>
                  <div classList={{ contents: drawn(), hidden: !drawn() }}>
                    <TurnHead rows={rowsOf(item())} />
                    <Switch>
                      <Match when={foldRowsOf(item())}>
                        {(rows) => <TranscriptFold rows={rows()} />}
                      </Match>
                      <Match when={failuresOf(item())}>
                        {(run) => (
                          <TranscriptFailures
                            tool={run().tool}
                            reason={run().reason}
                            rows={run().rows}
                          />
                        )}
                      </Match>
                      <Match when={entryOf(item())}>
                        {(entry) => (
                          <TranscriptRow
                            row={entry().row}
                            repeat={entry().repeat}
                            onRedrawn={() => setProseRedrawTick((n) => n + 1)}
                          />
                        )}
                      </Match>
                    </Switch>
                  </div>
                </>
              );
            }}
          </Key>
        </TurnsContext.Provider>
      </div>
      <ScrollToBottom
        visible={!transcriptPinned()}
        active={unseen()}
        onClick={pinTranscript}
      />
    </div>
  );
};

const foldRowsOf = (item: TranscriptItem) =>
  item.kind === "fold" ? item.rows : undefined;
const failuresOf = (item: TranscriptItem) =>
  item.kind === "failures" ? item : undefined;
const entryOf = (item: TranscriptItem) =>
  item.kind === "entry" ? item.entry : undefined;
const rowsOf = (item: TranscriptItem): ReadonlyArray<ConductorRow> =>
  item.kind === "entry" ? [item.entry.row] : item.rows;

function TranscriptFold(props: { rows: readonly ConductorToolRow[] }) {
  const count = () => props.rows.length;
  return (
    <details
      data-testid="conductor-fold"
      data-count={count()}
      class="group min-w-0"
    >
      <summary class="w-fit cursor-pointer list-none font-mono text-[0.68rem] text-fg-3 hover:text-fg-2 [&::-webkit-details-marker]:hidden">
        Details · {count()} {count() === 1 ? "tool call" : "tool calls"}
        <span class="ml-1 group-open:hidden">›</span>
        <span class="ml-1 hidden group-open:inline">⌄</span>
      </summary>
      <div class="mt-2 flex min-w-0 flex-col gap-2.5 border-l-2 border-edge pl-2.5">
        <Key each={props.rows} by={(row) => row.id}>
          {(row) => <TranscriptRow row={row()} repeat={1} />}
        </Key>
      </div>
    </details>
  );
}

function TranscriptFailures(props: {
  tool: string;
  reason: string;
  rows: readonly ConductorToolRow[];
}) {
  return (
    <details
      data-testid="conductor-failures"
      data-count={props.rows.length}
      class="group/failures min-w-0"
    >
      <summary class="min-w-0 cursor-pointer list-none font-mono text-[0.68rem] text-danger wrap-anywhere [&::-webkit-details-marker]:hidden">
        <span class="group-open/failures:hidden">▸</span>
        <span class="hidden group-open/failures:inline">▾</span> {props.tool}{" "}
        failed {props.rows.length} times: {props.reason}
      </summary>
      <div class="mt-2 flex min-w-0 flex-col gap-2.5 border-l-2 border-danger/40 pl-2.5">
        <Key each={props.rows} by={(row) => row.id}>
          {(row) => <TranscriptRow row={row()} repeat={1} />}
        </Key>
      </div>
    </details>
  );
}

function TranscriptRow(props: {
  row: ConductorRow;
  repeat: number;
  onRedrawn?: () => void;
}) {
  const turns = useTurns();
  const works = createMemo(() => turns.turnOf(props.row.id).works, NO_WORKS, {
    equals: sameWorks,
  });
  return (
    <>
      <div
        data-testid="conductor-row"
        data-row-kind={props.row.kind}
        data-row-id={props.row.id}
        class="min-w-0"
        classList={{
          "self-end max-w-[86%] mt-4": props.row.kind === "user",
        }}
      >
        <Switch>
          <Match when={props.row.kind === "user" && props.row}>
            {(row) => <UserRow row={row()} />}
          </Match>
          <Match when={props.row.kind === "agent" && props.row}>
            {(row) => (
              <div class="text-fg">
                <ConductorProse
                  rowId={row().id}
                  text={row().text}
                  works={works()}
                  holders={turns.holders()}
                  onRedrawn={props.onRedrawn}
                />
              </div>
            )}
          </Match>
          <Match when={props.row.kind === "plan" && props.row}>
            {(row) => (
              <ul class="list-none m-0 pl-2.5 border-l-2 border-edge-bright font-mono text-[0.72rem] text-fg-3">
                <For each={row().steps}>
                  {(step) => (
                    <li
                      data-testid="conductor-plan-step"
                      data-status={step.status}
                      classList={{ "text-fg": step.status === "in_progress" }}
                    >
                      {step.status === "completed"
                        ? "● "
                        : step.status === "in_progress"
                          ? "◐ "
                          : "○ "}
                      {step.content}
                    </li>
                  )}
                </For>
              </ul>
            )}
          </Match>
          <Match when={props.row.kind === "tool" && props.row}>
            {(row) => <ConductorToolCard row={row()} />}
          </Match>
          <Match when={props.row.kind === "work-ask" && props.row}>
            {(row) => <ChatWorkQuestion row={row()} />}
          </Match>
          <Match when={props.row.kind === "ask" && props.row}>
            {(row) => <ConductorAsk row={row()} />}
          </Match>
          <Match when={props.row.kind === "notice" && props.row}>
            {(row) => (
              <p class="font-mono text-[0.68rem] text-fg-3">
                {row().text}
                <Show when={props.repeat > 1}>
                  <span
                    data-testid="conductor-notice-repeat"
                    class="ml-1.5 rounded-sm bg-fg-3/15 px-1 tabular-nums"
                  >
                    ×{props.repeat}
                  </span>
                </Show>
              </p>
            )}
          </Match>
          <Match when={props.row.kind === "wake" && props.row}>
            {(row) => <WakeRow row={row()} works={works()} />}
          </Match>
          <Match when={props.row.kind === "divider" && props.row}>
            {(row) => (
              <div class="flex items-center gap-2 text-fg-3 font-mono text-[0.62rem] uppercase tracking-[0.12em]">
                <span class="flex-1 border-t border-edge" />
                <span>{row().text}</span>
                <span class="flex-1 border-t border-edge" />
              </div>
            )}
          </Match>
        </Switch>
      </div>
      <Show when={props.row.kind === "user" && works().length > 0}>
        <TurnChips works={works()} />
      </Show>
    </>
  );
}

function WakeRow(props: {
  row: Extract<ConductorRow, { kind: "wake" }>;
  works: ReadonlyArray<WorkId>;
}) {
  const mark = (): "queued" | "refused" | "unanswered" | undefined =>
    props.row.queued === true ? "queued" : props.row.delivery;
  const when = createMemo(() => wakeWhen(props.row.since));

  return (
    <div
      data-testid="conductor-wake"
      data-levels={props.row.events.map((event) => event.level).join(" ")}
      class="min-w-0"
    >
      <details class="min-w-0 rounded-md border border-edge bg-surface-1/60 px-2 py-1">
        <summary
          data-testid="conductor-wake-toggle"
          class="flex min-w-0 cursor-pointer list-none items-baseline gap-1.5 font-mono text-[0.68rem] text-fg-2 marker:content-none [&::-webkit-details-marker]:hidden"
        >
          <span aria-hidden="true" class="shrink-0 text-fg-3">
            ▸
          </span>
          <span class="shrink-0 font-semibold text-busy">{props.row.from}</span>
          <Show when={when()}>
            {(clock) => (
              <span class="shrink-0 text-fg-3 tabular-nums">· {clock()}</span>
            )}
          </Show>
          <span
            data-testid="conductor-wake-headline"
            class="min-w-0 flex-1 truncate text-fg"
          >
            · {wakeHeadline(props.row.events)}
          </span>
        </summary>
        <p
          data-testid="conductor-wake-text"
          class="mt-1 whitespace-pre-wrap break-words text-[0.75rem] text-fg-2"
        >
          {props.row.text}
        </p>
      </details>
      <Show when={props.works.length > 0}>
        <div data-testid="conductor-wake-works" class="mt-1 font-sans">
          <TurnChips works={props.works} />
        </div>
      </Show>
      <Show when={mark()}>
        {(what) => (
          <div class="mt-1 font-mono text-[0.62rem] text-fg-3">
            <span data-testid="conductor-wake-mark" data-mark={what()}>
              {what() === "queued"
                ? "queued"
                : what() === "refused"
                  ? "not sent"
                  : "no answer"}
            </span>
          </div>
        )}
      </Show>
    </div>
  );
}

function UserRow(props: { row: Extract<ConductorRow, { kind: "user" }> }) {
  const orch = useConductor();
  const mark = (): "queued" | "refused" | "unanswered" | undefined =>
    props.row.queued === true ? "queued" : props.row.delivery;

  return (
    <>
      <Show when={props.row.text !== ""}>
        <blockquote class="rounded-[0.75rem_0.75rem_0.2rem_0.75rem] border border-accent/30 bg-accent/15 px-3 py-2 whitespace-pre-wrap m-0">
          {props.row.text}
        </blockquote>
      </Show>
      <Show when={props.row.attachments.length > 0}>
        <div
          data-testid="conductor-row-attachments"
          class="mt-1 flex flex-wrap justify-end gap-1.5"
        >
          <For each={props.row.attachments}>
            {(attachment) => (
              <div
                data-testid="conductor-row-attachment"
                data-attachment-id={attachment.id}
                data-mime={attachment.mimeType}
                title={attachment.name}
                class="flex max-w-[12rem] items-center gap-1.5 rounded-md border border-edge bg-surface-1 px-1.5 py-1"
              >
                <Show
                  when={thumbnailOf(attachment)}
                  fallback={
                    <span class="truncate text-[0.68rem] text-fg-2">
                      {attachment.name}
                    </span>
                  }
                >
                  {(src) => (
                    <img
                      src={src()}
                      alt={attachment.name}
                      class="h-10 w-10 shrink-0 rounded object-cover"
                    />
                  )}
                </Show>
                <span class="shrink-0 font-mono text-[0.62rem] text-fg-3">
                  {formatBytes(attachment.bytes)}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={mark()}>
        {(what) => (
          <div class="mt-1 flex items-center justify-end gap-2 font-mono text-[0.62rem] text-fg-3">
            <span
              data-testid="conductor-user-mark"
              data-mark={what()}
              data-sign-in={what() === "refused" ? props.row.signIn : undefined}
            >
              {what() === "queued"
                ? "queued"
                : what() === "refused"
                  ? props.row.signIn === "signed-out"
                    ? "not sent — nobody is signed in"
                    : props.row.signIn === "account"
                      ? "not sent — this account cannot run it now"
                      : "not sent"
                  : "no answer"}
            </span>
            <Show when={what() === "refused" && props.row.signIn === "account"}>
              <button
                type="button"
                data-testid="conductor-mark-signin"
                class="text-accent hover:underline cursor-pointer"
                onClick={() => orch.askSignIn()}
              >
                sign in again
              </button>
            </Show>
            <Show when={what() === "refused"}>
              <button
                type="button"
                data-testid="conductor-send-again"
                class="text-accent hover:underline cursor-pointer"
                onClick={() =>
                  orch.prompt(
                    props.row.text,
                    props.row.mentions ?? [],
                    props.row.attachments,
                    false,
                  )
                }
              >
                send again
              </button>
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}

export default ConductorTranscript;
