import { activeArm, type TerminalMetadata } from "@kolu/padi-client/surface";
import type {
  PipMotionKind,
  PipVariant,
} from "@kolu/solid-statepip/pipVariant";
import { isCounted, type TerminalAttention } from "@kolu/padi-client/attention";

const BRAILLE_SPINNER = /[\u2800-\u28FF]/u;
const BOX_SPINNER = /[◐◓◑◒◜◝◞◟▖▘▝▗]/u;

export function titleShowsSpinner(title: string | null | undefined): boolean {
  if (!title) return false;
  return BRAILLE_SPINNER.test(title) || BOX_SPINNER.test(title);
}

export type AttentionDiagnostic = {
  id: string;
  label: string;
  agentKind: string | null;
  agentState: string | null;
  glyph: string;
  foreground: { name: string | null; title: string | null };
  spinnerInTitle: boolean;
  isLive: boolean;
  isFinished: boolean;
  attentionClass: string;
  pipVariant: PipVariant;
  motion: PipMotionKind;
  shellLive: boolean;
  paintsBusy: boolean;
  countedActive: boolean;
  disagreement: string | null;
};

export function attentionDiagnostic(input: {
  id: string;
  meta: TerminalMetadata;
  glyph: string;
  pipVariant: PipVariant;
  motion: PipMotionKind;
  shellLive: boolean;
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
  const paintsBusy =
    input.shellLive ||
    input.pipVariant === "working" ||
    input.motion === "spin";
  const countedActive = isCounted(input.attention);

  return {
    id: input.id,
    label:
      input.meta.git.kind === "repo"
        ? input.meta.git.info.branch
        : input.meta.cwd,
    agentKind: agent?.kind ?? null,
    agentState,
    glyph: input.glyph,
    foreground,
    spinnerInTitle,
    isLive: input.attention.live,
    isFinished: input.attention.klass === "finished",
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
    }),
  };
}

function describeDisagreement(f: {
  agentState: string | null;
  agentKind: string | null;
  glyph: string;
  spinnerInTitle: boolean;
  paintsBusy: boolean;
  countedActive: boolean;
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
  if (f.agentState === null && f.spinnerInTitle && f.agentKind === null) {
    return `terminal's title is spinning (it is working) but kolu holds no agent state for it — counted only because bytes are moving, so kolu cannot tell when it finishes or when it needs you`;
  }
  return null;
}
