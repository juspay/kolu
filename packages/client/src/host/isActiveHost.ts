import { createSelector } from "solid-js";
import { encodeHostKey } from "kolu-common/hostKey";
import { createSharedRoot } from "../createSharedRoot";
import { orchestratorMode } from "../orchestrator/useOrchestratorMode";
import { activeHost } from "../wire";

/** WHICH host tab is lit — and, when the answer is "none of them", why.
 *
 *  The chrome tab row carries two kinds of thing: the host tabs, and the
 *  orchestrator's own entry beside them. `activeHost` only ever names a HOST,
 *  because the orchestrator is not one and is deliberately absent from the host
 *  map; which of the two kinds is SELECTED is `orchestratorMode`. A selector
 *  reading `activeHost` alone therefore kept the last host lit while the
 *  conversation was on screen — the row said you were on `pureintent` while
 *  you were looking at the orchestrator, which is a tab bar lying about where
 *  you are.
 *
 *  So the two facts are folded HERE, in the one selector every tab, label,
 *  stripe and attention mark already reads, rather than at each of those call
 *  sites: a second place to remember this is a second place to forget it. The
 *  host a person left stays `activeHost`, so switching back lights exactly the
 *  tab they came from. */
export const useActiveHostSelector = createSharedRoot(() =>
  createSelector(() =>
    orchestratorMode() ? null : encodeHostKey(activeHost()),
  ),
);
