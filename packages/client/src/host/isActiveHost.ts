import { encodeHostKey } from "kolu-common/hostKey";
import { createKeySelector } from "../createKeySelector";
import { createSharedRoot } from "../createSharedRoot";
import { conductorMode } from "../conductor/useConductorMode";
import { activeHost } from "../wire";

/** WHICH host tab is lit — and, when the answer is "none of them", why.
 *
 *  The chrome tab row carries two kinds of thing: the host tabs, and the
 *  conductor's own entry beside them. `activeHost` only ever names a HOST,
 *  because the conductor is not one and is deliberately absent from the host
 *  map; which of the two kinds is SELECTED is `conductorMode`. A selector
 *  reading `activeHost` alone therefore kept the last host lit while the
 *  conversation was on screen — the row said you were on `pureintent` while
 *  you were looking at the conductor, which is a tab bar lying about where
 *  you are.
 *
 *  So the two facts are folded HERE, in the one selector every tab, label,
 *  stripe and attention mark already reads, rather than at each of those call
 *  sites: a second place to remember this is a second place to forget it. The
 *  host a person left stays `activeHost`, so switching back lights exactly the
 *  tab they came from.
 *
 *  A per-key PROJECTION ({@link createKeySelector}), Solid 2's spelling of the
 *  old selector: a switch wakes exactly the tab that lost the light and the
 *  one that gained it. */
export const useActiveHostSelector = createSharedRoot(() =>
  createKeySelector(() =>
    conductorMode() ? null : encodeHostKey(activeHost()),
  ),
);
