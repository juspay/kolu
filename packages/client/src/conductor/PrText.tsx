/** WORDS THAT NAME A WORK'S PULL REQUEST, with the number a link — the one
 *  way the card, its timeline and the chip's hover card turn `#2393` into a
 *  way to the PR, a finished work's included.
 *
 *  The address is the one the work's own `pr-opened` recorded
 *  (`kolu-work`'s `prLinks`), never a live reading and never a guess: a PR
 *  recorded before kolu kept addresses stays plain text, and so does any
 *  `#n` the work has no PR of. */

import { prLinks, type Work } from "kolu-work";
import { type Component, createMemo, For } from "solid-js";

const PR_NUMBER = /(#\d+)/;

const PrText: Component<{ work: Work; text: string }> = (props) => {
  const links = createMemo(() => prLinks(props.work));
  const parts = createMemo(() => props.text.split(PR_NUMBER));
  return (
    <For each={parts()}>
      {(part) => {
        const href = () =>
          PR_NUMBER.test(part) ? links().get(Number(part.slice(1))) : undefined;
        return (
          <>
            {href() === undefined ? (
              part
            ) : (
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
                {part}
              </a>
            )}
          </>
        );
      }}
    </For>
  );
};

export default PrText;
