/**
 * @kolu/acp — the Agent Client Protocol's words, owned by the wall that
 * speaks them.
 *
 * Three modules and a rule. {@link ./wire.ts} is the vocabulary that travels
 * kolu's wire — the ask shapes, `YES_NO`, `FileDiff` — on its own `./wire`
 * subpath, so the surface declaration that carries an orchestrator's asks
 * imports them from here rather than re-declaring them: the package that
 * speaks the foreign thing owns its words.
 * THIS entry is the other half and only this half — {@link ./asks.ts},
 * {@link ./diffs.ts} and {@link ./usage.ts}, the projections between the
 * protocol's own payloads and that vocabulary, which only `@kolu/acp-harness` — the
 * package that runs an ACP subprocess — consumes. The two entries are disjoint on purpose: everyone
 * who wants the vocabulary has it on `./wire`, so a wire shape
 * offered here as well would be a second path to the same word.
 *
 * The rule is that this is a LEAF that speaks ACP and nothing of kolu: no
 * `@kolu/*` import, and refusals in its own one word ({@link Refused}) for the
 * domain to translate at the seam. Machine-checked, not remembered —
 * {@link ./manifest.test.ts} enumerates what may cross this boundary in both
 * directions.
 */

export {
  contentOf,
  type Form,
  formOf,
  hostOf,
  PERMISSION_FIELD,
  permissionFormOf,
  Refused,
  urlOf,
} from "./asks.ts";
export { diffsOf, relativeTo } from "./diffs.ts";
export { usageIn } from "./usage.ts";

export { terminalMetaIn } from "./terminal.ts";

export {
  nativeActivity,
  type ActivityUpdate,
  type ActivityNotification,
} from "./activity.ts";
