import { isPipGlyphId, isPipVariant } from "@kolu/solid-statepip/pipVariant";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import type { TerminalMetadata } from "@kolu/padi-client/vocab";
import {
  DERIVED_PIP_KEYS,
  type DockRowBucket,
  FALLBACK_PIP_GLYPH,
  FALLBACK_PIP_VARIANT,
  hasAgentOf,
  FALLBACK_ORDER_BUCKET,
  pipMotionKind,
  pipShellLive,
  type StatePipBind,
  type StatePipDerived,
  type StatePipFacts,
} from "./pipBind.ts";
import type { RecencyMode } from "./recency.ts";
import { stateLabels } from "./rowSubline.ts";

/** The agent state the row's `agentState` prop and its subline speak. */
export type RowAgentState = AgentInfo["state"];

export const ROW_AGENT_STATES = Object.keys(
  stateLabels,
) as readonly RowAgentState[];

export function isRowAgentState(raw: string): raw is RowAgentState {
  return Object.hasOwn(stateLabels, raw);
}

const DOCK_ROW_BUCKET_KEYS: Record<DockRowBucket, null> = {
  awaiting: null,
  linger: null,
  working: null,
  none: null,
  idle: null,
  sleeping: null,
  parked: null,
};

export const DOCK_ROW_BUCKETS = Object.keys(
  DOCK_ROW_BUCKET_KEYS,
) as readonly DockRowBucket[];

export function isDockRowBucket(raw: string): raw is DockRowBucket {
  return Object.hasOwn(DOCK_ROW_BUCKET_KEYS, raw);
}

const RECENCY_MODE_KEYS: Record<RecencyMode, null> = {
  "wait-chip": null,
  hidden: null,
  ago: null,
};

export const RECENCY_MODES = Object.keys(
  RECENCY_MODE_KEYS,
) as readonly RecencyMode[];

export function isRecencyMode(raw: string): raw is RecencyMode {
  return Object.hasOwn(RECENCY_MODE_KEYS, raw);
}

/** What a row shows for one agent's state, narrowed from a wire that carries
 *  that state as a plain nullable string. Nothing here is a cast, and nothing
 *  here is a silent default: an unrecognised state keeps its raw word. */
export type NarrowedAgentState = {
  /** The closed literal when this build knows it, `undefined` when it does not.
   *  Feed this to the folds that demand the vocabulary; they will read an
   *  unknown state as "no agent state", which is honest, rather than as some
   *  neighbouring state, which would not be. */
  state: RowAgentState | undefined;
  /** What the row's `agentState` prop takes — the wire's own word, recognised
   *  or not. `data-agent-state` is a verbatim debug/e2e handle, and printing an
   *  unfamiliar word there is more honest than dropping it. `undefined` only
   *  when the wire said there is no agent at all. */
  attr: string | undefined;
  /** The words for the row's subline: the state's own label when recognised,
   *  else the raw literal. Empty only when there is no agent. */
  label: string;
  /** False when the wire named a state this build's vocabulary does not have —
   *  the one bit a consumer might want to log, count, or paint an "unknown"
   *  affordance from. */
  known: boolean;
};

/** Narrow a wire's agent-state string into what the row needs from it. */
export function narrowAgentState(
  raw: string | null | undefined,
): NarrowedAgentState {
  if (raw === null || raw === undefined || raw === "") {
    return { state: undefined, attr: undefined, label: "", known: true };
  }
  if (isRowAgentState(raw)) {
    return { state: raw, attr: raw, label: stateLabels[raw], known: true };
  }
  return { state: undefined, attr: raw, label: raw, known: false };
}

export type WireRowVocab = {
  pip: Omit<StatePipFacts, "variant" | "glyph"> & {
    variant: string;
    glyph: string;
    /** WHETHER AN AGENT IS DRIVING the terminal — the one `shellLive` input the
     *  bag does not itself carry, and the reason `shellLive` can leave the wire
     *  the way `motion` did. Send this, not the answer. */
    hasAgent: boolean;
  };
  /** The row's ORDER bucket (`data-bucket`), verbatim. */
  bucket: string;
};

export function toWireRowVocab(row: {
  pip: StatePipBind;
  bucket: DockRowBucket;
  meta: TerminalMetadata;
}): WireRowVocab {
  const pip: Partial<StatePipBind> = { ...row.pip };
  for (const key of Object.keys(DERIVED_PIP_KEYS)) {
    delete pip[key as keyof StatePipDerived];
  }
  return {
    pip: { ...(pip as StatePipFacts), hasAgent: hasAgentOf(row.meta) },
    bucket: row.bucket,
  };
}

/** Which wire word this build did not recognise. Three, not four: `motion` is
 *  derived, never a wire word. */
export type RowVocabField = "variant" | "glyph" | "bucket";

type RecognisedRowVocab = { known: true };

type UnrecognisedRowVocab = {
  known: false;
  unrecognised: Partial<Record<RowVocabField, string>>;
};

/** What the row needs from a wire's vocabulary, narrowed. Nothing here is a
 *  cast, and no unknown word is swallowed. */
export type NarrowedRowVocab = {
  pip: StatePipBind;
  /** The row's `bucket` prop — `data-bucket`, and the order the row ranks at. */
  bucket: DockRowBucket;
} & (RecognisedRowVocab | UnrecognisedRowVocab);

export function narrowRowVocab(wire: WireRowVocab): NarrowedRowVocab {
  const unrecognised: Partial<Record<RowVocabField, string>> = {};

  function narrow<T extends string>(
    field: RowVocabField,
    raw: string,
    is: (value: string) => value is T,
    fallback: T,
  ): T {
    if (is(raw)) return raw;
    unrecognised[field] = raw;
    return fallback;
  }

  const variant = narrow(
    "variant",
    wire.pip.variant,
    isPipVariant,
    FALLBACK_PIP_VARIANT,
  );
  const glyph = narrow(
    "glyph",
    wire.pip.glyph,
    isPipGlyphId,
    FALLBACK_PIP_GLYPH,
  );
  const bucket = narrow(
    "bucket",
    wire.bucket,
    isDockRowBucket,
    FALLBACK_ORDER_BUCKET,
  );
  const { hasAgent, ...rest } = wire.pip;
  const motion = pipMotionKind({ variant, active: wire.pip.active });
  const shellLive = pipShellLive({
    variant,
    hasAgent,
    bytesLive: wire.pip.bytesLive,
  });

  const pip = { ...rest, variant, glyph, motion, shellLive };
  const words = Object.keys(unrecognised);
  return words.length === 0
    ? { pip, bucket, known: true }
    : { pip, bucket, known: false, unrecognised };
}
