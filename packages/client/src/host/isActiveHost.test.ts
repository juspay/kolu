/** THE TAB ROW MUST NOT LIE ABOUT WHERE YOU ARE.
 *
 *  `activeHost` names a host at all times — the conductor is not one and is
 *  deliberately absent from the host map — so a selector reading it alone kept
 *  a host tab lit while the conversation covered the screen. The owner saw two
 *  tabs painted as live at once. This pins the fold that fixes it, at the one
 *  seam every tab, label, stripe and attention mark reads. */

import { encodeHostKey, LOCAL_HOST } from "kolu-common/hostKey";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

// `wire` is the whole client's dial; this test is about ONE selector, so it is
// stubbed down to the single accessor that selector reads.
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
      // Not "a different host is lit" — no host is. The host a person left is
      // still `activeHost`, which is what lights the tab they came from the
      // moment they switch back; what changes is only whether the row claims
      // they are standing on it.
      expect(isActive(encodeHostKey(LOCAL_HOST))).toBe(false);
      exitConductorMode();
      expect(isActive(encodeHostKey(LOCAL_HOST))).toBe(true);
      dispose();
    });
  });
});
