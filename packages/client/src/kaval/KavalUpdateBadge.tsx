import type { PadiStatus } from "@kolu/padi-client/surface";
import { createRoot } from "solid-js";
import { activeHost, padiMap } from "../wire";

const padiStatus = createRoot(() =>
  padiMap.useEntry(activeHost).cells.status.use(),
);

export const expectedKaval = (): PadiStatus["expectedKaval"] =>
  padiStatus.value()?.expectedKaval;
