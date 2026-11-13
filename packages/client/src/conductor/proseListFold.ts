/** LONG LISTS IN THE CONDUCTOR'S PROSE, FOLDED.
 *
 *  An answer that lists eight check names is a wall in a chat column: the
 *  reader has to climb it before reaching the sentence underneath. So a list
 *  of MORE THAN FIVE items shows its first three and one line — "and N more" —
 *  that opens the rest in place.
 *
 *  WHY THIS LIVES IN THE CLIENT AND NOT IN `@kolu/solid-markdown`.
 *  AGENTS.md's volatility rule gives a `@kolu/*` package to a domain-agnostic
 *  capability hiding a HARD volatility — transport, reconnect, persistence,
 *  GPU-context loss. This hides none of those: it is a bounded algorithm (hide
 *  the items past the third, add one control) over DOM that is already
 *  rendered, which the rule names as a leaf. And the POLICY is not Markdown's:
 *  "five items is too long to read mid-conversation" is the Conductor's
 *  reading rule, and the open state is keyed by a TRANSCRIPT ROW ID, a
 *  Conductor fact a Markdown package has no business knowing. The package has
 *  three other consumers — the intent body, the Code tab's README preview, the
 *  fileview appliance — and a document preview that silently dropped the tail
 *  of every list would be a defect there. The seam the package already offers
 *  (sanitized HTML in the host's DOM) is enough; nothing needs to move.
 *
 *  WHY A DOM PASS AND NOT JSX. The prose arrives as one sanitized HTML string
 *  through the package's `innerHTML`: there is no Solid component per list to
 *  hang a button off. So this is a pass over the rendered DOM, re-run by its
 *  caller's effect. It is idempotent — called again it re-derives the same
 *  state and, when nothing changed, writes nothing — and it REUSES the control
 *  element it already made, so opening the list with the keyboard does not
 *  throw away the focus that pressed it.
 *
 *  NESTED LISTS: only a top-level list folds, and only its own direct items
 *  count. A list inside an `<li>` is part of its item's text — folding it
 *  would cut a sentence in half, and counting its items towards the parent
 *  would fold a three-point answer because one point had sub-points. A nested
 *  list under a HIDDEN item is hidden with its item, which is what "and N
 *  more" promises to bring back.
 *
 *  The copy in the ⋯ menu is untouched: it copies the row TEXT, never this
 *  DOM, so a copied transcript always has every item. */

import { createStore } from "solid-js/store";

/** Longer than this, and the list folds. Five fit in a glance; six do not. */
export const PROSE_LIST_FOLD_OVER = 5;

/** How many items a folded list still shows — enough to see what KIND of list
 *  it is before deciding to open it. */
export const PROSE_LIST_FOLD_SHOWS = 3;

/** Marks the `<li>` this module owns, so it is never counted as one of the
 *  list's items nor mistaken for prose. */
const CONTROL_ATTR = "data-kolu-prose-more";

/** Which lists are open, by `${rowId}#${index of the top-level list}`.
 *  Module-level, exactly as `ConductorLook`'s `opened` is: the answer has to
 *  outlive the element that drew it. A streaming chunk rewrites the row's
 *  whole prose, a swapped row object rebuilds the component, and a fold
 *  swallowing the row rebuilds it again — through all of which an opened list
 *  must stay opened. Keyed per list, so opening one leaves its neighbour
 *  closed. */
const [opened, setOpened] = createStore<Record<string, true | undefined>>({});

/** Fold every over-long top-level list in `host`'s rendered prose.
 *
 *  Call this from a reactive effect that also reads the prose text: the read
 *  of `opened[key]` below is tracked, so pressing a control re-runs the effect
 *  and this pass repaints the one list that changed. */
export function applyProseListFold(host: HTMLElement, rowId: string): void {
  topLevelLists(host).forEach((list, index) => {
    const items = directItems(list);
    // Five or fewer: untouched, and nothing to clean up — the only thing that
    // can shorten a list is a fresh render of the whole prose, which takes
    // this module's control element with it.
    if (items.length <= PROSE_LIST_FOLD_OVER) return;

    const key = `${rowId}#${index}`;
    const open = opened[key] === true;
    const hiddenCount = items.length - PROSE_LIST_FOLD_SHOWS;

    items.forEach((item, position) => {
      const hide = !open && position >= PROSE_LIST_FOLD_SHOWS;
      // `hidden` rather than a class: it takes the items out of the
      // accessibility tree and out of tab order too, so "and 3 more" is as
      // true for a screen reader as it is for an eye.
      if (hide) item.setAttribute("hidden", "");
      else item.removeAttribute("hidden");
    });

    const button = controlButton(list);
    button.setAttribute("aria-expanded", open ? "true" : "false");
    // The closed line says how much is behind it; the open one says the way
    // back. Both are the same element, so focus survives the press.
    button.textContent = open ? "fewer" : `and ${hiddenCount} more`;
    // Assigned, not added: a re-run replaces this handler instead of stacking
    // a second one that would toggle the list straight back.
    button.onclick = () => setOpened(key, open ? undefined : true);
  });
}

/** The lists this pass owns: those not inside another list or list item.
 *  A list inside a blockquote is still top-level — the quote is prose, not an
 *  item. */
function topLevelLists(host: HTMLElement): HTMLElement[] {
  const lists: HTMLElement[] = [];
  for (const list of host.querySelectorAll<HTMLElement>("ul,ol")) {
    let parent = list.parentElement;
    let nested = false;
    while (parent !== null && parent !== host) {
      const tag = parent.tagName;
      if (tag === "LI" || tag === "UL" || tag === "OL") {
        nested = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (!nested) lists.push(list);
  }
  return lists;
}

/** A list's own items — direct `<li>` children, minus the control line this
 *  module appends. Direct children only: a nested list's items belong to their
 *  own list, and counting them here would fold a short list because one of its
 *  points had sub-points. */
function directItems(list: HTMLElement): HTMLElement[] {
  const items: HTMLElement[] = [];
  for (const child of list.children) {
    if (child.tagName === "LI" && !child.hasAttribute(CONTROL_ATTR))
      items.push(child as HTMLElement);
  }
  return items;
}

/** The list's "and N more" button, made once and then reused. It is an `<li>`
 *  so it sits on the list's own indent (no second place to keep the measure in
 *  step), with its marker dropped so it reads as a control rather than a
 *  sixth item. */
function controlButton(list: HTMLElement): HTMLButtonElement {
  // Always the list's last child — this module appends it, and a re-render of
  // the prose replaces the list wholesale rather than editing it, so there is
  // never a stale one further up.
  const last = list.lastElementChild;
  const existing = last?.hasAttribute(CONTROL_ATTR)
    ? last.firstElementChild
    : null;
  if (existing instanceof HTMLButtonElement) return existing;

  const line = list.ownerDocument.createElement("li");
  line.setAttribute(CONTROL_ATTR, "");
  line.className = "list-none";
  const button = line.ownerDocument.createElement("button");
  button.type = "button";
  button.dataset.testid = "conductor-prose-more";
  button.className =
    "cursor-pointer font-semibold text-fg-3 hover:text-fg-2 underline-offset-2 hover:underline";
  line.append(button);
  list.append(line);
  return button;
}
