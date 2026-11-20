import { encodeHostKey, LOCAL_HOST } from "kolu-common/hostKey";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../wire", () => ({ activeHost: () => ({ kind: "local" }) }));

import {
  enterConductorMode,
  exitConductorMode,
} from "../conductor/useConductorMode";
import { useActiveHostSelector } from "./isActiveHost";

afterEach(() => {
  exitConductorMode();
});

describe("which host tab is lit", () => {
  it("is the active host while a host tab is the selected entry", () => {
    createRoot((dispose) => {
      const isActive = useActiveHostSelector();
      expect(isActive(encodeHostKey(LOCAL_HOST))).toBe(true);
      dispose();
    });
  });

  it("is NONE of them while the conductor is the selected entry", () => {
    createRoot((dispose) => {
      const isActive = useActiveHostSelector();
      enterConductorMode();
      expect(isActive(encodeHostKey(LOCAL_HOST))).toBe(false);
      exitConductorMode();
      expect(isActive(encodeHostKey(LOCAL_HOST))).toBe(true);
      dispose();
    });
  });
});
