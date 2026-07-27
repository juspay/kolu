/** Attention diagnostics — the per-terminal fold that makes a paint ⇄ count
 *  disagreement *self-reporting* instead of something a human has to catch in a
 *  screen recording and a maintainer has to reverse-engineer from pixels.
 *
 *  Why this exists. The attention marks are computed by two independent folds
 *  over what kolu believes about an agent: the COUNTS (host tab, dock section
 *  header) read `agentBucket(agent.state)`, and the PIP reads
 *  `agentPaintClass(agent.state)` — plus a fallback, `shellLive`, that paints
 *  busy-orange purely because bytes are flowing, with no agent state involved.
 *  So the pip can say "busy" when every count says "nothing working", and the
 *  screen gives no clue which of the two is lying or why.
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
import { agentBucket } from "kolu-common/surface";
import type { PipVariant } from "@kolu/solid-statepip/pipVariant";

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
  pipVariant: PipVariant;
  /** The byte-level busy-paint fallback — true means the pip is orange for a
   *  reason no count can corroborate. */
  shellLive: boolean;
  /** Does the pip read as busy/working to a user glancing at it? */
  paintsBusy: boolean;
  /** Do the attention counts include this terminal as working? */
  countedWorking: boolean;
  /** Set when the axes disagree — the line to paste into a bug report. */
  disagreement: string | null;
};

/** Fold one terminal's live facts into its diagnostic row. */
export function attentionDiagnostic(input: {
  id: string;
  meta: TerminalMetadata;
  glyph: string;
  pipVariant: PipVariant;
  shellLive: boolean;
  isLive: boolean;
  isFinished: boolean;
}): AttentionDiagnostic {
  const arm = activeArm(input.meta);
  const agent = arm?.agent ?? null;
  const agentState = agent?.state ?? null;
  const foreground = {
    name: arm?.foreground?.name ?? null,
    title: arm?.foreground?.title ?? null,
  };
  const spinnerInTitle = titleShowsSpinner(foreground.title);
  // "Busy" as the USER reads it: the working paint, or the byte-level shell
  // fallback that renders in the identical orange.
  const paintsBusy = input.shellLive || input.pipVariant === "working";
  // Exactly what every attention count folds — no agent state, no count.
  const countedWorking =
    agentState !== null && agentBucket(agentState) === "working";

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
    pipVariant: input.pipVariant,
    shellLive: input.shellLive,
    paintsBusy,
    countedWorking,
    disagreement: describeDisagreement({
      agentState,
      agentKind: agent?.kind ?? null,
      glyph: input.glyph,
      spinnerInTitle,
      paintsBusy,
      countedWorking,
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
  countedWorking: boolean;
  isLive: boolean;
}): string | null {
  if (f.paintsBusy && !f.countedWorking) {
    if (f.agentState === null) {
      return f.spinnerInTitle
        ? `pip paints busy and the terminal's own title is spinning, but kolu holds NO agent state for it (glyph ${f.glyph} came from the restore target) — kolu is blind to a working agent, so no count can include it`
        : `pip paints busy (live bytes) but kolu holds no agent state — no count can include it`;
    }
    return `pip paints busy but agent state is "${f.agentState}", which no count reads as working`;
  }
  if (!f.paintsBusy && f.countedWorking) {
    return `counts read this as working (state "${f.agentState}") but the pip does not paint busy`;
  }
  // Agent state absent while the terminal insists it is working — no count can
  // see it even when the pip happens not to be busy. Worth flagging on its own:
  // it is the detection/sync gap, caught before it becomes a visible mismatch.
  if (f.agentState === null && f.spinnerInTitle && f.agentKind === null) {
    return `terminal's title is spinning (it is working) but kolu holds no agent state for it — invisible to every attention count`;
  }
  return null;
}
