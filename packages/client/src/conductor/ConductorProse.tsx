/** THE CONDUCTOR'S PROSE — one agent line, rendered as Markdown, with its
 *  long lists folded and the files it names made into links.
 *
 *  Everything about the rendering itself belongs to `@kolu/solid-markdown`;
 *  this adds the two Conductor rules the package has no business holding:
 *
 *   - A list of more than five items shows its first three and a line that
 *     opens the rest (see ./proseListFold for why it stays here).
 *   - A FILE THE CONDUCTOR NAMES OPENS. An inline code span whose text is
 *     exactly a path of a work kolu holds is a button that opens the reader
 *     on it, as the card's row does, and reads as open while the reader is on
 *     it. WHICH work's file is the turn's to say (./namedFiles): a turn about
 *     one work opens that work's file, and says in place when it has no such
 *     file yet; a turn about several offers, as work chips, only those that
 *     hold it; a turn about none offers every work that does. A path no work
 *     holds stays plain code. Derived from the live works, never stored in
 *     the row, so a file written after the sentence turns its mention into a
 *     link by itself.
 *
 *  THE TRIGGER IS THE PACKAGE'S, not the text's. The prose's DOM is rewritten
 *  whenever the package writes rendered HTML — a streamed chunk, but also a
 *  diagram landing in text that did not change — and every rewrite throws the
 *  fold away. So the fold is re-applied from `<Markdown onRendered>`, which
 *  the package calls after EVERY such write, once the DOM is in place and in
 *  the same update: the DOM it folds is the DOM the reader is about to see.
 *  Nothing is deferred, observed or polled.
 *
 *  The fold effect re-runs for two reasons and both are reads: the rewrite
 *  count `onRendered` bumps (the prose was replaced — a chunk, a diagram
 *  landing, a link appearing or the reader moving — so the fold must be
 *  re-applied, and the lists it must watch may be new ones), and the open
 *  state of the lists `applyProseListFold` touches (somebody pressed "and N
 *  more"). */

import { type InlineCodeAction, Markdown } from "@kolu/solid-markdown";
import type { WorkId } from "kolu-work";
import {
  type Component,
  createEffect,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from "solid-js";
import { Portal } from "solid-js/web";
import { surface } from "../ui/Surface";
import { useAnchoredPopover } from "../ui/useAnchoredPopover";
import { fileTarget } from "./namedFiles";
import { applyProseListFold } from "./proseListFold";
import { openReader, readerTarget } from "./reader/useReader";
import { useWorkMap } from "./useWorks";
import WorkChip from "./WorkChip";

const ConductorProse: Component<{
  /** The transcript row this prose belongs to — what its folds are remembered
   *  under, so an opened list survives the row object being replaced. */
  rowId: string;
  /** The agent's Markdown, as it stands this chunk. */
  text: string;
  /** THE WORKS THIS TURN IS ABOUT (`./turnWorks.ts`) — which work's file a
   *  path it names opens. */
  works: ReadonlyArray<WorkId>;
  /** The prose's DOM was rewritten — a chunk, a diagram landing (which grows
   *  the row with no new text), a named file becoming a link. Whether the text
   *  changed is not asked here: the closing-fence chunk renders the same HTML
   *  as the chunk before it, so the text a rewrite carries cannot tell what
   *  caused it. Never called for a press on "and N more", which writes no
   *  HTML. */
  onRedrawn?: () => void;
}> = (props) => {
  let host!: HTMLDivElement;
  const works = useWorkMap();

  /** What a press on a named path is waiting on — the person's choice
   *  between several works, or the sentence saying the turn's work has no
   *  such file yet — and the link it was pressed on, which it is anchored
   *  to. */
  const [pressed, setPressed] = createSignal<{
    readonly anchor: HTMLElement;
    readonly path: string;
    readonly kind: "choose" | "missing";
    readonly works: ReadonlyArray<WorkId>;
  } | null>(null);
  const dismiss = (): void => {
    setPressed(null);
  };
  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: () => pressed()?.anchor,
    open: () => pressed() !== null,
    onDismiss: dismiss,
    anchor: "bottom-start",
    flip: true,
    panelMinWidth: 220,
  });
  const chrome = surface({ radius: "lg", shadow: "light", portalled: true });

  /** What a code span is, as a link: none for a path no work holds. Open
   *  ("current") only when it names one file and the reader is on it. */
  const action = (path: string): InlineCodeAction | undefined => {
    const target = fileTarget(works(), props.works, path);
    if (target.kind === "plain") return undefined;
    const open = readerTarget();
    return {
      label: `Open ${path}`,
      current:
        target.kind === "open" &&
        open !== null &&
        open.work === target.work &&
        open.path === path,
    };
  };

  const press = (path: string, anchor: HTMLElement): void => {
    const target = fileTarget(works(), props.works, path);
    switch (target.kind) {
      case "plain":
        return;
      case "open":
        openReader({ work: target.work, path });
        return;
      case "missing":
      case "choose":
        setPressed({ anchor, path, kind: target.kind, works: target.works });
        return;
      default:
        target satisfies never;
    }
  };

  /** The title of a work, for the sentence that says it has no such file. */
  const titleOf = (id: WorkId): string => works().get(id)?.title ?? id;

  const [rewrites, setRewrites] = createSignal(0);

  createEffect(() => {
    rewrites();
    applyProseListFold(host, props.rowId);
  });

  // `min-w-0`: this sits inside the transcript's flex column, where a child
  // floors at its content width unless released — one unbroken line in the
  // prose would otherwise widen the whole conversation.
  return (
    <div ref={host} class="min-w-0">
      <Markdown
        markdown={props.text}
        variant="compact"
        inlineCode={{ action, onPress: press }}
        onRendered={() => {
          // The fold is queued first, so a transcript re-pinning on
          // `onRedrawn` measures the folded row.
          setRewrites((n) => n + 1);
          props.onRedrawn?.();
        }}
      />
      <Show when={pressed()}>
        {(now) => (
          <Portal>
            <div
              ref={panelRef}
              data-testid={
                now().kind === "choose"
                  ? "named-file-menu"
                  : "named-file-missing"
              }
              class={`fixed z-50 flex max-w-[min(420px,90vw)] flex-col gap-0.5 p-1.5 ${chrome.class}`}
              style={{ ...panelStyle(), ...chrome.style }}
            >
              <Switch>
                <Match when={now().kind === "choose"}>
                  <p class="m-0 px-1.5 pb-1 pt-0.5 text-[0.7rem] text-fg-3">
                    <code class="font-mono">{now().path}</code> of which work?
                  </p>
                  <For each={now().works}>
                    {(id) => (
                      <Show when={works().get(id)}>
                        {(work) => (
                          <div
                            data-testid={`named-file-option-${id}`}
                            class="px-1 py-0.5"
                          >
                            <WorkChip
                              id={id}
                              work={work()}
                              hover={false}
                              onPress={() => {
                                const path = now().path;
                                dismiss();
                                openReader({ work: id, path });
                              }}
                            />
                          </div>
                        )}
                      </Show>
                    )}
                  </For>
                </Match>
                <Match when={now().kind === "missing"}>
                  <p class="m-0 px-1.5 py-1 text-[0.72rem] text-fg-2">
                    {now().works.length === 1
                      ? `“${titleOf(now().works[0] ?? "")}” has no `
                      : "None of these works has "}
                    <code class="font-mono">{now().path}</code> yet.
                  </p>
                </Match>
              </Switch>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );
};

export default ConductorProse;
