import {
  type Accessor,
  createComputed,
  createMemo,
  createSignal,
  on,
  type Setter,
} from "solid-js";
import type { TokenQuery } from "./mentions";

export type CompletionIntent =
  | { readonly kind: "move"; readonly index: number }
  | { readonly kind: "accept"; readonly index: number }
  | { readonly kind: "close" }
  | { readonly kind: "send" }
  | { readonly kind: "pass" };

export function completionIntent(
  key: string,
  shift: boolean,
  count: number,
  selected: number,
): CompletionIntent {
  if (count <= 0) {
    return key === "Enter" && !shift ? { kind: "send" } : { kind: "pass" };
  }
  const at = Math.min(Math.max(selected, 0), count - 1);
  switch (key) {
    case "ArrowDown":
      return { kind: "move", index: (at + 1) % count };
    case "ArrowUp":
      return { kind: "move", index: (at - 1 + count) % count };
    case "Tab":
      return { kind: "accept", index: at };
    case "Enter":
      return shift ? { kind: "pass" } : { kind: "accept", index: at };
    case "Escape":
      return { kind: "close" };
    default:
      return { kind: "pass" };
  }
}

export function completionQuestion(
  mention: TokenQuery | null,
  command: TokenQuery | null,
): string {
  if (mention !== null) return `@${mention.query}`;
  if (command !== null) return `/${command.query}`;
  return "";
}

export function createCompletionHighlight(
  question: () => string,
): readonly [Accessor<number>, Setter<number>] {
  const asked = createMemo(question);
  const [selected, setSelected] = createSignal(0);
  createComputed(on(asked, () => setSelected(0)));
  return [selected, setSelected];
}
