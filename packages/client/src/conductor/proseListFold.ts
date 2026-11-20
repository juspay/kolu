import { createStore } from "solid-js/store";

export const PROSE_LIST_FOLD_OVER = 5;

export const PROSE_LIST_FOLD_SHOWS = 3;

const CONTROL_ATTR = "data-kolu-prose-more";

const [opened, setOpened] = createStore<Record<string, true | undefined>>({});

interface FoldState {
  readonly key: string;
  readonly open: boolean;
  readonly hiddenCount: number;
}

function syncControl(list: HTMLElement, state: FoldState): void {
  const button = controlButton(list);
  button.setAttribute("aria-expanded", state.open ? "true" : "false");
  button.textContent = state.open ? "fewer" : `and ${state.hiddenCount} more`;
  button.onclick = () => setOpened(state.key, state.open ? undefined : true);
}

export function applyProseListFold(host: HTMLElement, rowId: string): void {
  topLevelLists(host).forEach((list, index) => {
    const items = directItems(list);
    if (items.length <= PROSE_LIST_FOLD_OVER) return;

    const key = `${rowId}#${index}`;
    const open = opened[key] === true;

    items.forEach((item, position) => {
      const hide = !open && position >= PROSE_LIST_FOLD_SHOWS;
      if (hide) item.setAttribute("hidden", "");
      else item.removeAttribute("hidden");
    });

    syncControl(list, {
      key,
      open,
      hiddenCount: items.length - PROSE_LIST_FOLD_SHOWS,
    });
  });
}

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

function directItems(list: HTMLElement): HTMLElement[] {
  const items: HTMLElement[] = [];
  for (const child of list.children) {
    if (child.tagName === "LI" && !child.hasAttribute(CONTROL_ATTR))
      items.push(child as HTMLElement);
  }
  return items;
}

function controlButton(list: HTMLElement): HTMLButtonElement {
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
