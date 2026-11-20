import { createSelector } from "solid-js";
import { encodeHostKey } from "kolu-common/hostKey";
import { createSharedRoot } from "../createSharedRoot";
import { conductorMode } from "../conductor/useConductorMode";
import { activeHost } from "../wire";

export const useActiveHostSelector = createSharedRoot(() =>
  createSelector(() => (conductorMode() ? null : encodeHostKey(activeHost()))),
);
