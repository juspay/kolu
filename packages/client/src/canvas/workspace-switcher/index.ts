/** Workspace switcher public boundary.
 *
 *  Importers outside this folder should depend on the controller component,
 *  the live-entry builders, and the model types exported here. Internal
 *  renderer files stay private so the collapsed form can be replaced later
 *  without spreading import churn across the client. */
export { default } from "./WorkspaceSwitcher";
export {
  agentBucket,
  buildWorkspaceEntries,
  buildWorkspaceSwitcherModel,
  isAwaitingAttention,
  sortBySwitcherOrder,
  type WorkspaceSwitcherRepoGroup,
  type WorkspaceSwitcherSourceEntry,
} from "./model";
