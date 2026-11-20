import { wrapBracketedPaste } from "@kolu/terminal-protocol";

export function planComposeSend(text: string): string | null {
  if (text.trim().length === 0) return null;
  return text.includes("\n") ? wrapBracketedPaste(text) : text;
}
