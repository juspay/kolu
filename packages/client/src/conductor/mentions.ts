import type {
  ConductorMention,
  ConductorWorkMention,
} from "kolu-common/conductor";
import type { TerminalId } from "kolu-common/surface";
import type { Work, WorkId } from "kolu-work";

export interface TerminalCandidate {
  readonly kind: "terminal";
  readonly terminalId: TerminalId;
  readonly host: string;
  readonly name: string;
  readonly intent: string | null;
  readonly cwd: string | null;
  readonly repo: string | null;
  readonly detail: MentionDetail | null;
}

export interface WorkCandidate {
  readonly kind: "work";
  readonly work: WorkId;
  readonly title: string;
  readonly name: string;
  readonly record: Work;
  readonly standing: string;
}

export type MentionCandidate = TerminalCandidate | WorkCandidate;

export function workSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "work" : slug;
}

export interface MentionDetail {
  readonly kind: "work" | "intent" | "agent" | "directory";
  readonly text: string;
}

export interface TokenQuery {
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

const BREAKS = /[\s]/;

export function tokenQueryAt(
  text: string,
  caret: number,
  trigger: "@" | "/",
): TokenQuery | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === undefined) return null;
    if (BREAKS.test(ch)) return null;
    if (ch !== trigger) continue;
    const before = i === 0 ? undefined : text[i - 1];
    if (before !== undefined && !BREAKS.test(before)) return null;
    return { start: i, end: caret, query: text.slice(i + 1, caret) };
  }
  return null;
}

function matchRank(candidate: MentionCandidate, needle: string): number | null {
  const name = candidate.name.toLowerCase();
  const title = candidate.kind === "work" ? candidate.title.toLowerCase() : "";
  if (name.startsWith(needle) || title.startsWith(needle)) return 0;
  if (name.includes(needle) || title.includes(needle)) return 1;
  if (candidate.kind === "terminal")
    return (candidate.intent ?? "").toLowerCase().includes(needle) ? 1 : null;
  return null;
}

export function filterMentions(
  candidates: readonly MentionCandidate[],
  query: string,
): readonly MentionCandidate[] {
  const needle = query.toLowerCase();
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      group: candidate.kind === "work" ? 0 : 1,
      rank: needle === "" ? 0 : matchRank(candidate, needle),
    }))
    .filter((one): one is typeof one & { rank: number } => one.rank !== null)
    .sort((a, b) => a.group - b.group || a.rank - b.rank || a.index - b.index)
    .map((one) => one.candidate);
}

export function completeToken(
  text: string,
  token: TokenQuery,
  trigger: "@" | "/",
  word: string,
): { readonly text: string; readonly caret: number } {
  const rest = text.slice(token.end);
  const head = `${text.slice(0, token.start)}${trigger}${word}${/^\s/.test(rest) ? "" : " "}`;
  return { text: head + rest, caret: head.length };
}

export interface ArmedMention {
  readonly token: string;
  readonly mention: ConductorMention;
}

function firstByName(
  candidates: readonly MentionCandidate[],
): ReadonlyMap<string, MentionCandidate> {
  const byName = new Map<string, MentionCandidate>();
  for (const candidate of candidates)
    if (!byName.has(candidate.name)) byName.set(candidate.name, candidate);
  return byName;
}

export function armedMentions(
  text: string,
  candidates: readonly MentionCandidate[],
): readonly ArmedMention[] {
  const byName = firstByName(candidates);
  const seen = new Set<string>();
  const out: ArmedMention[] = [];
  for (const match of text.matchAll(/(^|\s)@([^\s@]+?)[.,;:!?)\]]*(?=\s|$)/g)) {
    const name = match[2];
    if (name === undefined) continue;
    const candidate = byName.get(name);
    if (candidate === undefined || seen.has(name)) continue;
    seen.add(name);
    out.push({
      token: name,
      mention:
        candidate.kind === "work"
          ? { kind: "work", work: candidate.work, title: candidate.title }
          : {
              kind: "terminal",
              terminalId: candidate.terminalId,
              host: candidate.host,
              name: candidate.name,
              intent: candidate.intent,
              cwd: candidate.cwd,
            },
    });
  }
  return out;
}

export function withScopeMention(
  mentions: readonly ConductorMention[],
  scope: ConductorWorkMention | null,
): readonly ConductorMention[] {
  if (scope === null) return mentions;
  return mentions.some((one) => one.kind === "work" && one.work === scope.work)
    ? mentions
    : [...mentions, scope];
}

export function dropMention(text: string, name: string): string {
  return text
    .replace(new RegExp(`(^|\\s)@${escapeForRegExp(name)}(?=\\s|$)`, "g"), "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function armedMentionText(text: string, name: string): string {
  const token = `@${name}`;
  if (new RegExp(`(^|\\s)@${escapeForRegExp(name)}(?=\\s|$)`).test(text))
    return text;
  return text === "" ? `${token} ` : `${token} ${text}`;
}
