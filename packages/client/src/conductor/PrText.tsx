/** WORDS THAT NAME A WORK'S PULL REQUEST, with the number a link — the one
 *  way the card, its timeline and the chip's hover card turn `#2393` into a
 *  way to the PR, a finished work's included.
 *
 *  The address is the one the work's own `pr-opened` recorded
 *  (`kolu-work`'s `prLinks`), never a live reading and never a guess: a PR
 *  recorded before kolu kept addresses stays plain text, and so does any
 *  `#n` the work has no PR of. */

import { prLinks, type Work } from "kolu-work";
import { type Component, createMemo, For, Show } from "solid-js";
import { sameItems } from "./sameItems";

const PR_NUMBER = /(#\d+)/;

const PrText: Component<{
  /** The work's own record as ONE read (`createWorkRecord`): the addresses
   *  are a walk of the WHOLE timeline, so the proxy would put a node per leaf
   *  of every event on the memo below. */
  work: Work;
  text: string;
}> = (props) => {
  const links = createMemo(() => prLinks(props.work), {
    name: "prText.links",
  });
  // The same words, split again: the list is new and its parts are the
  // strings it had, so without this gate every `<For>` row re-runs on any
  // move of the record around it.
  const parts = createMemo(() => props.text.split(PR_NUMBER), {
    name: "prText.parts",
    equals: sameItems,
  });
  // `keyed={false}`: a part is a string, so its POSITION is its identity.
  return (
    <For each={parts()} keyed={false}>
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
              // Clickable through a face whose own press is a button laid
              // under its text (the card's head), and never that press.
              class="pointer-events-auto relative text-accent hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {part()}
            </a>
          )}
        </Show>
      )}
    </For>
  );
};

export default PrText;
