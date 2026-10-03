import { createSelector } from "solid-js";
import { encodeHostKey } from "kolu-common/hostKey";
import { createSharedRoot } from "../createSharedRoot";
import { activeHost } from "../wire";

export const useActiveHostSelector = createSharedRoot(() =>
  createSelector(() => encodeHostKey(activeHost())),
);
