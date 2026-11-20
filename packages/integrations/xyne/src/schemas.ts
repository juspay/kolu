import { type AgentVocab, TaskProgressSchema, UUID_RE } from "anyagent";
import { Schema } from "effect";

export type { TaskProgress } from "anyagent";
export { TaskProgressSchema };

export const XyneInfoSchema = Schema.Struct({
  kind: Schema.Literal("xyne"),
  /** Always `waiting`: Xyne's JSONL transcript carries only persisted
   *  message history, so no busy/attention distinction is derivable. */
  state: Schema.Literal("waiting"),
  /** Session UUID from the transcript's `{"type":"session"}` header entry
   *  (also the `<id>` in the transcript filename). */
  sessionId: Schema.String,
  /** Provider/model id from the transcript's latest `model_change` entry.
   *  Null when the session never recorded one. */
  model: Schema.NullOr(Schema.String),
  /** Display title from the transcript's sidecar `*_summary.json`. */
  summary: Schema.NullOr(Schema.String),
  /** Task checklist; always null — Xyne exposes none on disk. */
  taskProgress: Schema.NullOr(TaskProgressSchema),
  /** Context-window usage; always null — the adapter derives no telemetry
   *  from the persisted transcript. */
  contextTokens: Schema.NullOr(Schema.Number),
  /** Epoch-ms the session began (the transcript header's `timestamp`);
   *  survives a resume. */
  startedAt: Schema.NullOr(Schema.Number),
});

export type XyneInfo = typeof XyneInfoSchema.Type;

const XYNE_MARK = {
  viewBox: "0 0 24 24",
  paint: "fill" as const,
  paths: [
    "M5.04 3h4.05L12 9.27 14.91 3h4.05l-4.74 9L18.96 21h-4.05L12 14.73 9.09 21H5.04l4.74-9L5.04 3z",
  ],
};

/** Xyne's vocabulary — display name, brand mark, CLI grammar, resume policy,
 *  and wire schema. */
export const xyneVocab: AgentVocab<XyneInfo> = {
  kind: "xyne",
  displayName: "Xyne",
  mark: XYNE_MARK,
  cli: {
    basename: "xyne",
    shims: new Set(["python", "python3", "uv", "uvx"]),
    stableFlags: new Map([
      ["--debug", "boolean"],
      ["--port", "value"],
    ]),
  },
  resume: {
    byId: (id) => `--session ${id}`,
    idPattern: UUID_RE,
    ref: (info) => info.sessionId,
  },
  say: {
    idle: ["Enter"],
    working: { keys: ["Enter"], delivery: "steer", sight: "unmeasured" },
    verified: "ran xyne-cli 0.4.8-dev in a kolu terminal, 2026-11-13",
  },
  infoSchema: XyneInfoSchema,
};
