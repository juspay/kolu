/** Workspace switcher public boundary.
 *
 *  Importers outside this folder depend on the model (live-entry
 *  builders, agent-bucket classifier, types). The renderers
 *  (`SearchPanel`) are imported by their concrete file path so the
 *  module's surface stays bucket-classification-oriented rather than
 *  presentation-oriented.
 *
 *  The chrome-bar `WorkspaceSwitcher` controller and `Collapsed` pill
 *  strip retired with #903 — the canonical live-terminal navigator now
 *  lives in `Dock`, which mounts `SearchPanel` directly as its
 *  mega level. */
export {
  agentBucket,
  bucketDescriptor,
  buildWorkspaceEntries,
  buildWorkspaceSwitcherModel,
  sortBySwitcherOrder,
  type WorkspaceSwitcherRepoGroup,
  type WorkspaceSwitcherSourceEntry,
} from "./model";
