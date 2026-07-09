/**
 * `session.provisions` — the RUNTIME twin of the erased `Prov` type parameter:
 * `initialConnection`'s VALUE is the only witness left standing at
 * construction (see the derivation in `session.ts`'s `makeSession`). This pins
 * that the derivation is sound for BOTH arms now that
 * `MakeSessionOptions.initialConnection` is narrowed to exactly the
 * connector's TRUE opening phase — `"connecting"` for the local/endpoint arm
 * (`Prov = never`), `Prov` for the provisioning arm (`"copying"` for ssh) —
 * rather than the broad local phase set the local arm used to admit (which
 * would have let a local session's TYPE claim `"failed"`/`"connected"`/
 * `"disconnected"` as a boot state, a lying first frame). See
 * `localSessionPhase.test-d.ts` for the TYPE-level pin that a down/other state
 * can't even be written as `initialConnection` in the first place.
 */
import { describe, expect, it } from "vitest";
import { makeSession } from "./session";
import type { SshProv } from "./sshConnector";

// A connector that's never invoked — every test here only constructs the
// session (synchronous) and reads `.provisions`; none of them `.pin()`.
const neverDial = (): Promise<never> =>
  Promise.reject(new Error("connector should not run"));

describe("session.provisions", () => {
  it("is FALSE for the local/endpoint arm (Prov = never, opens at 'connecting')", () => {
    const session = makeSession<unknown, never>({
      connectOnce: neverDial,
      initialConnection: "connecting",
    });
    expect(session.provisions).toBe(false);
    session.destroy();
  });

  it("is TRUE for the provisioning arm (Prov = SshProv, opens at 'copying')", () => {
    const session = makeSession<unknown, SshProv>({
      connectOnce: neverDial,
      initialConnection: "copying",
    });
    expect(session.provisions).toBe(true);
    session.destroy();
  });
});
