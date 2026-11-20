import { createSignal } from "solid-js";
import { defaultInvalidWarning, persistedPref } from "../persistedPref";

type ChromeTab = "conductor" | "hosts";

const [chromeTab, setChromeTab] = persistedPref<ChromeTab>({
  name: "kolu-active-chrome-tab",
  fallback: "hosts",
  parse: (raw) => {
    if (raw === "conductor" || raw === "hosts") return raw;
    throw new Error(`unknown chrome tab "${raw}"`);
  },
  storage: sessionStorage,
  onInvalid: defaultInvalidWarning("kolu-active-chrome-tab", "hosts"),
});

export const conductorMode = (): boolean => chromeTab() === "conductor";

const [everSelected, setEverSelected] = createSignal(
  chromeTab() === "conductor",
);
export const conductorEverSelected = everSelected;

export function enterConductorMode(): void {
  setEverSelected(true);
  setChromeTab("conductor");
}

export function exitConductorMode(): void {
  setChromeTab("hosts");
}

export function toggleConductorMode(): void {
  setChromeTab((tab) => {
    const next = tab === "conductor" ? "hosts" : "conductor";
    if (next === "conductor") setEverSelected(true);
    return next;
  });
}
