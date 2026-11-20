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

  const missing = createMemo(() => {
    const path = missingPath();
    if (path === null) return undefined;
    const target = fileTarget(props.holders, props.works, path);
    return target.kind === "missing"
      ? { path, works: named(target.works) }
      : undefined;
  });

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
          setChoosing(null);
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
      />
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
