import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import { selectFleetTerminal } from "./palette/fleetActions";

const LOCAL: HostKey = { kind: "local" };
const REMOTE: HostKey = { kind: "remote", target: "zest" };
const TID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" as TerminalId;

describe("selectFleetTerminal", () => {
  it("activates without switching when the row is on the active host", () => {
    const switchHost = vi.fn();
    const activate = vi.fn();
    selectFleetTerminal(LOCAL, TID, LOCAL, switchHost, activate);
    expect(switchHost).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledWith(TID);
  });

  it("switches host then activates for a foreign row", () => {
    const switchHost = vi.fn();
    const activate = vi.fn();
    selectFleetTerminal(REMOTE, TID, LOCAL, switchHost, activate);
    expect(switchHost).toHaveBeenCalledWith(REMOTE);
    expect(activate).toHaveBeenCalledWith(TID);
    expect(switchHost.mock.invocationCallOrder[0]).toBeLessThan(
      activate.mock.invocationCallOrder[0]!,
    );
  });
});
