import { formatBytes } from "@kolu/byte-units";
import { Key } from "@solid-primitives/keyed";
import { decodeHostKey } from "kolu-common/hostKey";
import type {
  ConductorMention,
  ConductorState,
  ConductorTerminalMention,
  ConductorWorkMention,
} from "kolu-common/conductor";
import type { WorkId } from "kolu-work";
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import { toast } from "solid-sonner";
import { hostLabel } from "../host/hostChipTone";
import { CONTEXTUAL_TIPS } from "../settings/tips";
import { useTips } from "../settings/useTips";
import { isDesktop } from "../useMobile";
import { useFleetTerminalIndex } from "../palette/fleetTerminals";
import {
  fleetMentionCandidates,
  workMentionCandidates,
} from "./mentionCandidates";
import { attachPastedFiles, reattachComposerFiles } from "./attachFiles";
import {
  completionIntent,
  completionQuestion,
  createCompletionHighlight,
} from "./completion";
import { useShown } from "../ui/shown";
import {
  clearComposerAttachments,
  composerAttachments,
  composerText,
  dropComposerAttachment,
  sendableAttachments,
  setCompletionOpen,
  setComposerText,
} from "./drafts";
import {
  armedMentions,
  completeToken,
  dropMention,
  filterMentions,
  type MentionCandidate,
  type TerminalCandidate,
  type TokenQuery,
  tokenQueryAt,
  withScopeMention,
  type WorkCandidate,
} from "./mentions";
import { chatScope, showAllChat } from "./chatScope";
import WorkChipFace from "./WorkChipFace";
import { useMembership, useNeedsYou, useWorkMap, useWorks } from "./useWorks";
import { sendsAsSteer, steerOnOffer } from "./steer";
import { thumbnailOf } from "./thumbnails";
import { pinTranscript } from "./transcriptScroll";
import { useConductor } from "./useConductor";

const openMenu = (
  trigger: "@" | "/",
  token: TokenQuery | null,
  rows: readonly { readonly name: string }[],
) =>
  token === null || rows.length === 0
    ? null
    : { trigger, token, words: rows.map((row) => row.name) };

const asWork = (mention: ConductorMention): ConductorWorkMention | undefined =>
  mention.kind === "work" ? mention : undefined;
const asTerminal = (
  mention: ConductorMention,
): ConductorTerminalMention | undefined =>
  mention.kind === "terminal" ? mention : undefined;

// NOT MEASURED WHILE THE PANE IS HIDDEN. The pane is retained behind the
// host tabs and a hidden subtree has no layout at all, so `scrollHeight`
// there is 0 — a height written from it would pin the box shut, and it
// would stay shut until the next keystroke. `shown()` is a dependency
// rather than a guard, so coming back re-measures with real boxes.
function autoGrowTextarea(
  boxOf: () => HTMLTextAreaElement,
  text: Accessor<string>,
  shown: Accessor<boolean>,
): void {
  createEffect(() => {
    const value = text();
    if (!shown()) return;
    const box = boxOf();
    if (value === "") {
      box.style.height = "";
      return;
    }
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  });
}

const ConductorComposer: Component<{
  state: ConductorState;
}> = (props) => {
  const orch = useConductor();
  const fleet = useFleetTerminalIndex();
  const works = useWorks();
  const needs = useNeedsYou();
  const workMap = useWorkMap();
  const membership = useMembership();
  const [caret, setCaret] = createSignal(0);
  let box!: HTMLTextAreaElement;

  const terminalCandidates = createMemo<TerminalCandidate[]>(() =>
    fleetMentionCandidates(fleet(), membership()),
  );
  const terminalNames = createMemo<ReadonlySet<string>>(
    () => new Set(terminalCandidates().map((one) => one.name)),
    new Set(),
    {
      equals: (a, b) => a.size === b.size && [...a].every((one) => b.has(one)),
    },
  );
  const workCandidates = createMemo<WorkCandidate[]>(() =>
    workMentionCandidates(works(), needs(), terminalNames()),
  );
  const candidates = createMemo<MentionCandidate[]>(() => [
    ...workCandidates(),
    ...terminalCandidates(),
  ]);

  const mentionToken = () => tokenQueryAt(composerText(), caret(), "@");
  const commandToken = () => tokenQueryAt(composerText(), caret(), "/");
  const mentionMatches = createMemo(() => {
    const token = mentionToken();
    return token === null ? [] : filterMentions(candidates(), token.query);
  });
  const commandMatches = createMemo(() => {
    const token = commandToken();
    if (token === null) return [];
    const needle = token.query.toLowerCase();
    return props.state.commands.filter((command) =>
      command.name.toLowerCase().startsWith(needle),
    );
  });
  createEffect(() => {
    setCompletionOpen(
      mentionMatches().length > 0 || commandMatches().length > 0,
    );
  });
  onCleanup(() => setCompletionOpen(false));
  const armed = createMemo(() => armedMentions(composerText(), candidates()));

  const scope = createMemo(chatScope);
  const scopeMention = (): ConductorWorkMention | null => {
    const at = scope();
    return at === null
      ? null
      : { kind: "work", work: at.id, title: at.record.title };
  };
  const workMatches = createMemo(() =>
    mentionMatches().filter((one): one is WorkCandidate => one.kind === "work"),
  );
  const terminalMatches = createMemo(() =>
    mentionMatches().filter(
      (one): one is TerminalCandidate => one.kind === "terminal",
    ),
  );

  const menu = createMemo(
    () =>
      openMenu("@", mentionToken(), mentionMatches()) ??
      openMenu("/", commandToken(), commandMatches()),
  );
  const [selected, setSelected] = createCompletionHighlight(() =>
    completionQuestion(mentionToken(), commandToken()),
  );
  const menuCount = () => menu()?.words.length ?? 0;

  const write = (text: string, position: number): void => {
    setComposerText(text);
    setCaret(position);
    box.value = text;
    box.setSelectionRange(position, position);
    box.focus();
  };

  const accept = (index: number): void => {
    const open = menu();
    const word = open?.words[index];
    if (open === null || word === undefined) return;
    const next = completeToken(composerText(), open.token, open.trigger, word);
    write(next.text, next.caret);
  };

  const revealWhenSelected = (el: HTMLElement, mine: () => boolean): void => {
    createEffect(() => {
      if (mine()) el.scrollIntoView({ block: "nearest" });
    });
  };

  const [sending, setSending] = createSignal(false);

  const offered = createMemo(() => steerOnOffer(props.state));
  const { showTipOnce } = useTips();
  const shown = useShown();
  createEffect(() => {
    if (shown() && offered()) showTipOnce(CONTEXTUAL_TIPS.conductorSteer);
  });

  const send = (alt = false): void => {
    if (sending()) return;
    const text = composerText().trim();
    if (text === "" && composerAttachments().length === 0) return;
    const files = sendableAttachments();
    if (files === null) {
      toast.error(
        "One of those files is still uploading — give it a moment and send again.",
      );
      return;
    }
    setSending(true);
    const steer = sendsAsSteer(alt, offered());
    orch.prompt(
      text,
      withScopeMention(
        armed().map((one) => one.mention),
        scopeMention(),
      ),
      files,
      steer,
      (accepted) => {
        setSending(false);
        if (!accepted) {
          reattachComposerFiles();
          return;
        }
        pinTranscript();
        clearComposerAttachments();
        write("", 0);
      },
    );
  };

  const phone = () => !isDesktop();
  autoGrowTextarea(() => box, composerText, shown);

  const stopButton = () => (
    <button
      type="button"
      data-testid="conductor-stop"
      class="shrink-0 whitespace-nowrap rounded-md border border-danger/50 px-2.5 py-1 font-mono text-[0.65rem] text-danger cursor-pointer"
      onClick={() => orch.cancel()}
    >
      ■ Stop
    </button>
  );
  const sendButton = () => (
    <button
      type="button"
      data-testid="conductor-send"
      class="shrink-0 whitespace-nowrap rounded-md bg-accent px-3 font-mono text-[0.65rem] font-semibold text-surface-0 cursor-pointer"
      classList={{ "py-1": !phone(), "py-2": phone() }}
      onClick={(event) => send(event.altKey)}
    >
      {phone() ? "Send" : "Send ↵"}
    </button>
  );

  return (
    <div
      data-testid="conductor-composer"
      class="relative border-t border-edge px-5 py-2.5"
    >
      <Show when={mentionMatches().length > 0}>
        <div
          data-testid="conductor-mention-menu"
          class="absolute left-5 right-5 bottom-full mb-1 max-h-60 overflow-y-auto rounded-lg border border-edge-bright bg-surface-1 shadow-lg shadow-black/40 p-1.5"
        >
          <Show when={workMatches().length > 0}>
            <div
              data-testid="conductor-mention-heading"
              class="px-2 pb-0.5 pt-1 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-fg-3"
            >
              Works
            </div>
            <Key each={workMatches()} by="work">
              {(candidate, index) => (
                <button
                  ref={(el) =>
                    revealWhenSelected(el, () => index() === selected())
                  }
                  type="button"
                  data-testid="conductor-mention-row"
                  data-kind="work"
                  data-work={candidate().work}
                  data-selected={index() === selected() ? "" : undefined}
                  class="w-full min-w-0 flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-surface-2 cursor-pointer"
                  classList={{ "bg-surface-2": index() === selected() }}
                  onPointerEnter={() => setSelected(index())}
                  onClick={() => accept(index())}
                >
                  <WorkChipFace work={candidate().record} />
                  <span
                    data-testid="conductor-mention-detail"
                    data-kind="work"
                    class="min-w-0 truncate text-fg-2"
                  >
                    {candidate().standing}
                  </span>
                </button>
              )}
            </Key>
          </Show>
          <Show when={terminalMatches().length > 0}>
            <div
              data-testid="conductor-mention-heading"
              class="px-2 pb-0.5 pt-1 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-fg-3"
            >
              Terminals
            </div>
            <Key
              each={terminalMatches()}
              by={(candidate) => `${candidate.host}/${candidate.terminalId}`}
            >
              {(candidate, index) => {
                const at = () => workMatches().length + index();
                return (
                  <button
                    ref={(el) =>
                      revealWhenSelected(el, () => at() === selected())
                    }
                    type="button"
                    data-testid="conductor-mention-row"
                    data-kind="terminal"
                    data-terminal-id={candidate().terminalId}
                    data-host={candidate().host}
                    data-selected={at() === selected() ? "" : undefined}
                    class="w-full min-w-0 flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-surface-2 cursor-pointer"
                    classList={{ "bg-surface-2": at() === selected() }}
                    onPointerEnter={() => setSelected(at())}
                    onClick={() => accept(at())}
                  >
                    <span class="max-w-[45%] shrink-0 truncate font-semibold text-fg">
                      {candidate().name}
                    </span>
                    <span
                      data-testid="conductor-mention-host"
                      class="shrink-0 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-accent"
                    >
                      {hostLabel(decodeHostKey(candidate().host))}
                    </span>
                    <Show when={candidate().repo}>
                      {(repo) => (
                        <span class="shrink-0 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-fg-3">
                          {repo()}
                        </span>
                      )}
                    </Show>
                    <Show when={candidate().detail}>
                      {(detail) => (
                        <span
                          data-testid="conductor-mention-detail"
                          data-kind={detail().kind}
                          class="min-w-0 truncate text-fg-2"
                          classList={{
                            "[direction:rtl] text-left font-mono text-[0.62rem]":
                              detail().kind === "directory",
                          }}
                        >
                          <bdi>{detail().text}</bdi>
                        </span>
                      )}
                    </Show>
                  </button>
                );
              }}
            </Key>
          </Show>
        </div>
      </Show>
      <Show when={commandMatches().length > 0}>
        <div
          data-testid="conductor-command-menu"
          class="absolute left-5 right-5 bottom-full mb-1 max-h-60 overflow-y-auto rounded-lg border border-edge-bright bg-surface-1 shadow-lg shadow-black/40 p-1.5"
        >
          <For each={commandMatches()}>
            {(command, index) => (
              <button
                ref={(el) =>
                  revealWhenSelected(el, () => index() === selected())
                }
                type="button"
                data-testid="conductor-command-row"
                data-command={command.name}
                data-selected={index() === selected() ? "" : undefined}
                class="w-full flex items-baseline gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-surface-2 cursor-pointer"
                classList={{ "bg-surface-2": index() === selected() }}
                onPointerEnter={() => setSelected(index())}
                onClick={() => accept(index())}
              >
                <span class="font-mono font-semibold text-fg">
                  /{command.name}
                </span>
                <Show when={command.description}>
                  {(what) => <span class="truncate text-fg-3">{what()}</span>}
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={scope()}>
        {(at) => (
          <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="conductor-scope-chip"
              data-work={at().id}
              aria-label={`Show the whole chat, not only ${at().record.title}`}
              class="flex items-center gap-1 cursor-pointer"
              onClick={() => showAllChat()}
            >
              <WorkChipFace work={at().record} />
              <span class="font-mono text-[0.68rem] text-fg-3">×</span>
            </button>
          </div>
        )}
      </Show>
      <Show when={armed().length > 0}>
        <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
          <Key each={armed()} by="token">
            {(armedOne) => (
              <>
                <Show when={asWork(armedOne().mention)}>
                  {(work) => (
                    <button
                      type="button"
                      data-testid="conductor-mention-chip"
                      data-kind="work"
                      data-work={work().work}
                      title={work().title}
                      class="flex items-center gap-1 cursor-pointer"
                      onClick={() =>
                        write(dropMention(composerText(), armedOne().token), 0)
                      }
                    >
                      <Show
                        when={workMap().get(work().work as WorkId)}
                        fallback={
                          <span class="text-[0.72rem] font-medium text-fg">
                            {work().title}
                          </span>
                        }
                      >
                        {(record) => <WorkChipFace work={record()} />}
                      </Show>
                      <span class="font-mono text-[0.68rem] text-fg-3">×</span>
                    </button>
                  )}
                </Show>
                <Show when={asTerminal(armedOne().mention)}>
                  {(one) => (
                    <button
                      type="button"
                      data-testid="conductor-mention-chip"
                      data-kind="terminal"
                      data-terminal-id={one().terminalId}
                      data-host={one().host}
                      title={one().intent ?? one().cwd ?? undefined}
                      class="rounded-full bg-accent/15 px-2 py-px font-mono text-[0.68rem] font-semibold text-accent cursor-pointer"
                      onClick={() =>
                        write(dropMention(composerText(), armedOne().token), 0)
                      }
                    >
                      @{one().name}
                      <span class="font-normal text-accent/70">
                        {" "}
                        · {hostLabel(decodeHostKey(one().host))}
                      </span>{" "}
                      ×
                    </button>
                  )}
                </Show>
              </>
            )}
          </Key>
        </div>
      </Show>
      <Show when={composerAttachments().length > 0}>
        <div
          data-testid="conductor-attachments"
          class="mb-1.5 flex flex-wrap gap-1.5"
        >
          <For each={composerAttachments()}>
            {(attachment) => (
              <div
                data-testid="conductor-attachment-chip"
                data-attachment-id={attachment.id}
                data-mime={attachment.mimeType}
                data-uploading={attachment.path === null ? "" : undefined}
                aria-busy={attachment.path === null ? "true" : undefined}
                title={attachment.name}
                class="flex max-w-[12rem] items-center gap-1.5 rounded-md border border-edge-bright bg-surface-1 px-1.5 py-1"
                classList={{ "opacity-60": attachment.path === null }}
              >
                <Show
                  when={thumbnailOf(attachment)}
                  fallback={
                    <span class="truncate text-[0.68rem] text-fg">
                      {attachment.name}
                    </span>
                  }
                >
                  {(src) => (
                    <img
                      data-testid="conductor-attachment-thumb"
                      src={src()}
                      alt={attachment.name}
                      class="h-8 w-8 shrink-0 rounded object-cover"
                    />
                  )}
                </Show>
                <Show
                  when={attachment.path === null}
                  fallback={
                    <span class="shrink-0 font-mono text-[0.62rem] text-fg-3">
                      {formatBytes(attachment.bytes)}
                    </span>
                  }
                >
                  <span
                    data-testid="conductor-attachment-uploading"
                    class="shrink-0 font-mono text-[0.62rem] text-fg-3"
                  >
                    uploading…
                  </span>
                </Show>
                <button
                  type="button"
                  data-testid="conductor-attachment-remove"
                  aria-label={`Remove ${attachment.name}`}
                  class="shrink-0 text-fg-3 hover:text-fg cursor-pointer"
                  onClick={() => dropComposerAttachment(attachment.id)}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <div class="flex items-end gap-2">
        <textarea
          ref={box}
          data-testid="conductor-input"
          rows={1}
          placeholder={
            scope() !== null
              ? "Ask about this work…"
              : phone()
                ? "Ask… @ work or terminal, / command"
                : "Ask the conductor… @ for a work or a terminal, / for a command, ⇧⏎ for a newline"
          }
          class="max-h-[40dvh] min-w-0 flex-1 resize-none overflow-y-auto rounded-[0.6rem] border border-edge-bright bg-surface-0 px-2.5 py-2 text-chat text-fg outline-none focus:border-accent"
          value={composerText()}
          onInput={(event) => {
            setComposerText(event.currentTarget.value);
            setCaret(event.currentTarget.selectionStart);
          }}
          onPaste={(event) => {
            if (attachPastedFiles(event.clipboardData)) event.preventDefault();
          }}
          onClick={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.altKey) {
              event.preventDefault();
              send(true);
              return;
            }
            const intent = completionIntent(
              event.key,
              event.shiftKey,
              menuCount(),
              selected(),
            );
            switch (intent.kind) {
              case "move":
                event.preventDefault();
                setSelected(intent.index);
                return;
              case "accept":
                event.preventDefault();
                accept(intent.index);
                return;
              case "close":
                event.stopPropagation();
                setCaret(-1);
                return;
              case "send":
                event.preventDefault();
                send();
                return;
              case "pass":
                return;
            }
          }}
        />
        <Show when={props.state.phase === "working"}>{stopButton()}</Show>
        {sendButton()}
      </div>
    </div>
  );
};

export default ConductorComposer;
