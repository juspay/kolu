import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { intentLeadGlyph } from "../../intent/text";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { ALPHANUM, caseToOneGlyph, repoMonogram } from "../../ui/monogramGlyph";

const ALPHANUM_ANCHORED = /^[\p{L}\p{N}]\p{M}*$/u;

export function chipInitials(
  meta: TerminalMetadata,
  info: TerminalDisplayInfo,
): { repo: string; sub: string; subIsGlyph: boolean } {
  const repo = repoMonogram(info.key.group);
  const branchTail = info.key.label.split("/").pop() ?? "";
  const intentGlyph = meta.intent
    ? intentLeadGlyph(meta.intent).normalize("NFC")
    : "";
  if (intentGlyph) {
    return ALPHANUM_ANCHORED.test(intentGlyph)
      ? { repo, sub: caseToOneGlyph(intentGlyph, "lower"), subIsGlyph: false }
      : { repo, sub: intentGlyph, subIsGlyph: true };
  }
  const subChar = branchTail.match(ALPHANUM)?.[0] ?? "?";
  const sub = caseToOneGlyph(subChar, "lower");
  return { repo, sub, subIsGlyph: false };
}
