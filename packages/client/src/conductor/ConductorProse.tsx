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
import type { Work, WorkId } from "kolu-work";
import type { NonEmpty } from "nonempty";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
} from "solid-js";
import { OptionMenu } from "../ui/OptionMenu";
import { type FileHolders, fileTarget } from "./namedFiles";
import { applyProseListFold } from "./proseListFold";
import { openReader, readerTarget } from "./reader/useReader";
import { useWorkMap } from "./useWorks";
import WorkChipFace from "./WorkChipFace";

/** A work offered or named by a press, with the record it was read from at
 *  the moment of the press — so the menu and the note never look a work up
 *  again, and cannot find it gone. */
interface Named {
  readonly id: WorkId;
  readonly work: Work;
}

const ConductorProse: Component<{
  /** The transcript row this prose belongs to — what its folds are remembered
   *  under, so an opened list survives the row object being replaced. */
  rowId: string;
  /** The agent's Markdown, as it stands this chunk. */
  text: string;
  /** THE WORKS THIS TURN IS ABOUT (`./turnWorks.ts`) — which work's file a
   *  path it names opens. */
  works: ReadonlyArray<WorkId>;
  /** Which works hold which paths (`./namedFiles.ts`), built once for the
   *  whole transcript per change of the works. */
  holders: FileHolders;
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

  /** The works a press offered to choose between, and the link it was
   *  pressed on — which the menu is anchored to. */
  const [choosing, setChoosing] = createSignal<{
    readonly anchor: HTMLElement;
    readonly path: string;
    readonly works: NonEmpty<Named>;
  } | null>(null);
  /** The path a press found missing from the turn's work — what the note
   *  under the reply is about. */
  const [missingPath, setMissingPath] = createSignal<string | null>(null);

  /** The works named, with their records as they stand now. Every id came
   *  out of the holders index or the turn, both read off this same map in
   *  this same update, so an id it does not hold is a defect, said loudly. */
  const named = (ids: NonEmpty<WorkId>): NonEmpty<Named> => {
    const one = (id: WorkId): Named => {
      const work = works().get(id);
      if (work === undefined)
        throw new Error(`a file link named work ${id}, which is not held`);
      return { id, work };
    };
    const [first, ...rest] = ids;
    return [one(first), ...rest.map(one)];
  };

  /** THE NOTE, read off the live target every time: it says the turn's
   *  work has no such file only for as long as that is true. Once the work
   *  writes it, the note goes and the link opens the file. */
  const missing = createMemo(() => {
    const path = missingPath();
    if (path === null) return undefined;
    const target = fileTarget(props.holders, props.works, path);
    return target.kind === "missing"
      ? { path, works: named(target.works) }
      : undefined;
  });

  /** What a code span is, as a link: none for a path no work holds. Its name
   *  says what a press does — opens the file, offers the works that hold it,
   *  or says the turn's work has none yet. Open ("current") only when it
   *  names one file and the reader is on it. */
  const action = (path: string): InlineCodeAction | undefined => {
    const target = fileTarget(props.holders, props.works, path);
    switch (target.kind) {
      case "plain":
        return undefined;
      case "missing":
        return { label: `${path}: not written yet`, current: false };
      case "choose":
        return { label: `${path}: choose a work`, current: false };
      case "open": {
        const open = readerTarget();
        return {
          label: `Open ${path}`,
          current:
            open !== null && open.work === target.work && open.path === path,
        };
      }
      default:
        return target satisfies never;
    }
  };

  const press = (path: string, anchor: HTMLElement): void => {
    const target = fileTarget(props.holders, props.works, path);
    setMissingPath(null);
    switch (target.kind) {
      case "plain":
        return;
      case "open":
        openReader({ work: target.work, path });
        return;
      case "missing":
        setMissingPath(path);
        return;
      case "choose":
        setChoosing({ anchor, path, works: named(target.works) });
        return;
      default:
        target satisfies never;
    }
  };

  /** The menu's rows, built once per press rather than per read. */
  const choices = createMemo(() => {
    const works = choosing()?.works ?? [];
    return {
      options: works.map((one) => ({ value: one.id, label: one.work.title })),
      byId: new Map(works.map((one) => [one.id, one.work])),
    };
  });

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
          // A rewrite replaces the link a menu was anchored to, so the menu
          // goes with it rather than hanging off a detached node.
          setChoosing(null);
          // The fold is queued first, so a transcript re-pinning on
          // `onRedrawn` measures the folded row.
          setRewrites((n) => n + 1);
          props.onRedrawn?.();
        }}
      />
      <OptionMenu<WorkId>
        triggerRef={() => choosing()?.anchor}
        open={() => choosing() !== null}
        onDismiss={() => setChoosing(null)}
        anchor="bottom-start"
        heading={
          <>
            <code class="font-mono">{choosing()?.path}</code> of which work?
          </>
        }
        options={choices().options}
        renderOption={(option) => (
          <Show when={choices().byId.get(option.value)}>
            {(work) => <WorkChipFace work={work()} />}
          </Show>
        )}
        onSelect={(work) => {
          const path = choosing()?.path;
          setChoosing(null);
          if (path !== undefined) openReader({ work, path });
        }}
        testIdPrefix="named-file"
        maxHeight={320}
        flip
        focusFirst
      />
      {/* THE TURN'S WORK HAS NO SUCH FILE YET — said under the reply that
          named it, and announced: never another work's file in its place. */}
      <Show when={missing()}>
        {(note) => (
          <p
            data-testid="named-file-missing"
            role="status"
            class="m-0 mt-1 flex flex-wrap items-center gap-1 text-[0.72rem] text-fg-2"
          >
            <Show
              when={note().works.length === 1}
              fallback={
                <>
                  <span>None of</span>
                  <For each={note().works}>
                    {(one) => <WorkChipFace work={one.work} />}
                  </For>
                  <span>has</span>
                </>
              }
            >
              <WorkChipFace work={note().works[0].work} />
              <span>has no</span>
            </Show>
            <code class="font-mono">{note().path}</code>
            <span>yet.</span>
          </p>
        )}
      </Show>
    </div>
  );
};

export default ConductorProse;
