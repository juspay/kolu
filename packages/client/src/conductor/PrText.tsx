import { prLinks, type Work } from "kolu-work";
import { type Component, createMemo, Index, Show } from "solid-js";

const PR_NUMBER = /(#\d+)/;

const PrText: Component<{ work: Work; text: string }> = (props) => {
  const links = createMemo(() => prLinks(props.work));
  const parts = createMemo(() => props.text.split(PR_NUMBER));
  return (
    <Index each={parts()}>
      {(part) => (
        <Show
          when={
            PR_NUMBER.test(part())
              ? links().get(Number(part().slice(1)))
              : undefined
          }
          fallback={part()}
        >
          {(href) => (
            <a
              data-testid="work-pr-link"
              href={href()}
              target="_blank"
              rel="noopener noreferrer"
              class="pointer-events-auto relative text-accent hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {part()}
            </a>
          )}
        </Show>
      )}
    </Index>
  );
};

export default PrText;
