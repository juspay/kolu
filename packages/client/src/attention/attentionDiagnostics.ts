/** Attention diagnostics — the per-terminal fold that makes a paint ⇄ count
 *  disagreement *self-reporting* instead of something a human has to catch in a
 *  screen recording and a maintainer has to reverse-engineer from pixels.
 *
 *  Why this exists. Paint and counts are now the same predicate
 *  (`attentionActive`), so the family of bugs where a tab counted fewer than
 *  the marks beneath it is closed by construction. What remains — and what this
 *  module reports — is the layer BELOW that: whether kolu holds the right facts
 *  at all. The pip has one input no count can corroborate (`shellLive`: orange
 *  purely because bytes are flowing, no agent state involved), and that
 *  fallback is exactly what lights up when kolu is blind to a working agent.
 *
 *  That happened in the field: a codex terminal painted busy rust with the host
 *  tab counting 2 of 3 visibly-working agents. The pixels alone couldn't
 *  distinguish the three candidate causes, and they demand opposite fixes:
 *
 *    1. kolu never knew the agent's state (detection gap) — the pip's byte-level
 *       `shellLive` is then the only thing telling the truth, and the COUNT is
 *       what's wrong;
 *    2. kolu knew, but the client's copy was stale (sync gap) — the count is
 *       right about what it was told and the client is behind;
 *    3. the agent really had finished (`waiting`) and the pip's busy paint was
 *       the lie.
 *
 *  `agentState: null` + a live SPINNER in the terminal's own title is the
 *  signature that separates (1) from (3): a process animating a spinner into
 *  its title is, by its own account, working — so if kolu holds no agent state
 *  for it, kolu is blind, not the terminal idle. Recording that fact at the
 *  moment the user sees the bug is the whole point of this module.
 *
 *  Pure over its inputs — no store reads, no DOM — so it is unit-testable and
 *  the dialog stays a renderer. */

import { activeArm, type TerminalMetadata } from "@kolu/padi/surface";
import type {
  PipMotionKind,
  PipVariant,
} from "@kolu/solid-statepip/pipVariant";
import { isCounted, type TerminalAttention } from "./attentionFacts";

/** Spinner glyphs a CLI animates into its terminal title while it works: the
 *  braille block (U+2800–U+28FF — codex, claude, and most Node spinners use
 *  `cli-spinners`' braille frames) plus the circle/box frame sets. Presence
 *  means "this process says it is busy", independent of anything kolu detected.
 *
 *  The ASCII wheel (`| / - \`) is deliberately EXCLUDED: those characters carry
 *  no spinner signal in a terminal title, where a path separator and a hyphen
 *  are ordinary text — including them made `drishti-osfacts` itself read as
 *  "spinning". A diagnostic that cries wolf on every hyphenated branch name is
 *  worse than one that misses the rare ASCII-spinner CLI, because the whole
 *  value here is that the flag is *rare and therefore meaningful*. */
const SPINNER_RE = /[⠀-⣿◐◓◑◒◜◝◞◟▖▘▝▗]/u;

/** Does the terminal's own foreground title animate a spinner? Only meaningful
 *  for a title a process rewrites (`⠧ drishti-osfacts`). This is *evidence* for
 *  a human reading a bug report — never a control input to any rendering or
 *  counting decision, so a false positive can mislead but can never miscolour
 *  or miscount anything. */
export function titleShowsSpinner(title: string | null | undefined): boolean {
  if (!title) return false;
  return SPINNER_RE.test(title);
}

export type AttentionDiagnostic = {
  id: string;
  label: string;
  /** What kolu believes drives this terminal, and what it is doing. `null`
   *  state = kolu holds no agent for it (detection or sync gap). */
  agentKind: string | null;
  agentState: string | null;
  /** The identity the pip actually renders — falls back to the persisted
   *  restore target, so it can name an agent while `agentKind` is null. That
   *  divergence is itself a symptom worth seeing. */
  glyph: string;
  foreground: { name: string | null; title: string | null };
  /** The terminal's own claim that it is busy (see `titleShowsSpinner`). */
  spinnerInTitle: boolean;
  isLive: boolean;
  isFinished: boolean;
  /** Which attention list padi's partition put this terminal in. */
  attentionClass: string;
  pipVariant: PipVariant;
  /** Does the mark MOVE? The axis a user reads as "something is happening"
   *  before they read any colour. */
  motion: PipMotionKind;
  /** The byte-level busy-paint fallback — true means the pip is orange for a
   *  reason no count can corroborate. */
  shellLive: boolean;
  /** Does the pip read as busy/working to a user glancing at it? */
  paintsBusy: boolean;
  /** Do the attention counts include this terminal as active? */
  countedActive: boolean;
  /** Set when the axes disagree — the line to paste into a bug report. */
  disagreement: string | null;
};

/** Fold one terminal's live facts into its diagnostic row. */
export function attentionDiagnostic(input: {
  id: string;
  meta: TerminalMetadata;
  glyph: string;
  pipVariant: PipVariant;
  motion: PipMotionKind;
  shellLive: boolean;
  isLive: boolean;
  isFinished: boolean;
  attention: TerminalAttention;
}): AttentionDiagnostic {
  const arm = activeArm(input.meta);
  const agent = arm?.agent ?? null;
  const agentState = agent?.state ?? null;
  const foreground = {
    name: arm?.foreground?.name ?? null,
    title: arm?.foreground?.title ?? null,
  };
  const spinnerInTitle = titleShowsSpinner(foreground.title);
  // "Busy" as the USER reads it — and that includes the MOTION axis: a mark
  // that is spinning reads as busy whatever colour it wears, which is how a
  // violet lingering pip spun beside a host tab counting nothing and the
  // diagnostic still reported agreement.
  const paintsBusy =
    input.shellLive ||
    input.pipVariant === "working" ||
    input.motion === "spin";
  // Exactly what every attention count folds — the ONE shared predicate, read
  // off the same value the pip was bound from. A diagnostic that re-spells the
  // rule it is diagnosing agrees with itself by construction and cannot see the
  // drift it was built to catch, so this is a CALL, never a copy.
  const countedActive = isCounted(input.attention);

  return {
    id: input.id,
    label: input.meta.git?.branch ?? input.meta.cwd,
    agentKind: agent?.kind ?? null,
    agentState,
    glyph: input.glyph,
    foreground,
    spinnerInTitle,
    isLive: input.isLive,
    isFinished: input.isFinished,
    attentionClass: input.attention.klass,
    pipVariant: input.pipVariant,
    motion: input.motion,
    shellLive: input.shellLive,
    paintsBusy,
    countedActive,
    disagreement: describeDisagreement({
      agentState,
      agentKind: agent?.kind ?? null,
      glyph: input.glyph,
      spinnerInTitle,
      paintsBusy,
      countedActive,
      isLive: input.isLive,
    }),
  };
}

/** Name the disagreement in the terms that decide the fix, or `null` when the
 *  axes agree. Deliberately descriptive, never prescriptive: it reports which
 *  signals conflict and what the terminal itself claims, and leaves "so which
 *  one is wrong" to the human reading it with padi's side in hand. */
function describeDisagreement(f: {
  agentState: string | null;
  agentKind: string | null;
  glyph: string;
  spinnerInTitle: boolean;
  paintsBusy: boolean;
  countedActive: boolean;
  isLive: boolean;
}): string | null {
  if (f.paintsBusy && !f.countedActive) {
    if (f.agentState === null) {
      return f.spinnerInTitle
        ? `pip paints busy and the terminal's own title is spinning, but kolu holds NO agent state for it (glyph ${f.glyph} came from the restore target) — kolu is blind to a working agent, so no count can include it`
        : `pip paints busy (live bytes) but kolu holds no agent state — no count can include it`;
    }
    return `pip paints busy but agent state is "${f.agentState}", which the activity predicate does not read as active`;
  }
  if (!f.paintsBusy && f.countedActive) {
    return `counts read this as active (state "${f.agentState}") but the pip neither paints busy nor moves`;
  }
  // Agent state absent while the terminal insists it is working. The COUNT is
  // fine — byte motion carries it — but kolu is still blind to the agent
  // itself, and everything that needs to know WHICH agent and WHAT it is doing
  // is degraded: no chime when it finishes, no needs-you rank when it asks, no
  // identity but the restore target's. That is the detection/sync gap, worth
  // reporting even though nothing on screen looks wrong.
  if (f.agentState === null && f.spinnerInTitle && f.agentKind === null) {
    return `terminal's title is spinning (it is working) but kolu holds no agent state for it — counted only because bytes are moving, so kolu cannot tell when it finishes or when it needs you`;
  }
  return null;
}
