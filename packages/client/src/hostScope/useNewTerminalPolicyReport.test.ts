/** The new-terminal policy reporter's ORDERING contract (#2045).
 *
 *  padi distinguishes "no chrome has reported" (→ no opinion, the caller's own
 *  default) from a real user preference. That distinction is only worth anything
 *  if the REPORTING side keeps it too: `preferences()` floors an unloaded cell to
 *  `DEFAULT_PREFERENCES`, so reporting off it would tell padi a confident
 *  `shuffle`/`auto` during the connect window — a terminal created in that window
 *  would land on a policy the user never chose, which is the very failure #2045
 *  is about. So the reporter stays SILENT until the preferences cell has yielded.
 *
 *  Driven over the injected ports rather than the live wire, so the ordering is
 *  the only thing under test. */

import type { HostKey } from "kolu-common/hostKey";
import type { NewTerminalPolicy } from "kolu-common/surface";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { createNewTerminalPolicyReport } from "./useNewTerminalPolicyReport";

const LOCAL: HostKey = { kind: "local" };

const LOADED: NewTerminalPolicy = {
  newTerminalTheme: "inherit",
  shuffleBehavior: "colourful",
  isDark: false,
};

/** Stand the reporter up over signals, returning the levers + what was sent. */
function harness() {
  const [policy, setPolicy] = createSignal<NewTerminalPolicy | undefined>(
    undefined,
  );
  const [connected, setConnected] = createSignal(true);
  const [hosts, setHosts] = createSignal<HostKey[]>([LOCAL]);
  const sent: { host: HostKey; policy: NewTerminalPolicy }[] = [];
  const dispose = createRoot((d) => {
    createNewTerminalPolicyReport({
      hosts,
      policy,
      portFor: (host) => ({
        connected,
        send: async (p) => {
          sent.push({ host, policy: p });
        },
      }),
      onError: (_host, err) => {
        throw err;
      },
    });
    return d;
  });
  return { setPolicy, setConnected, setHosts, sent, dispose };
}

describe("createNewTerminalPolicyReport", () => {
  it("sends NOTHING before the preferences cell has yielded", () => {
    const h = harness();
    // Link up, host present — and still silent, because the only thing missing
    // is the fact itself. padi's "nobody has reported" branch stays reachable.
    expect(h.sent).toEqual([]);
    h.dispose();
  });

  it("sends once the cell lands — and reports what the user actually chose", () => {
    const h = harness();
    h.setPolicy(LOADED);
    expect(h.sent).toEqual([{ host: LOCAL, policy: LOADED }]);
    h.dispose();
  });

  it("holds a landed policy back until the host's link is up, then sends it", () => {
    const [policy, setPolicy] = createSignal<NewTerminalPolicy | undefined>(
      undefined,
    );
    const [connected, setConnected] = createSignal(false);
    const sent: NewTerminalPolicy[] = [];
    const dispose = createRoot((d) => {
      createNewTerminalPolicyReport({
        hosts: () => [LOCAL],
        policy,
        portFor: () => ({
          connected,
          send: async (p) => {
            sent.push(p);
          },
        }),
        onError: (_h, err) => {
          throw err;
        },
      });
      return d;
    });
    setPolicy(LOADED);
    expect(sent).toEqual([]);
    // A padi that respawned or was redialled starts with no reported policy —
    // the link coming (back) up is what re-seeds it.
    setConnected(true);
    expect(sent).toEqual([LOADED]);
    dispose();
  });

  it("reports to EVERY member host, not just the one being looked at", () => {
    const remote: HostKey = { kind: "remote", target: "user@box" };
    const h = harness();
    h.setPolicy(LOADED);
    h.setHosts([LOCAL, remote]);
    expect(h.sent.map((s) => s.host)).toEqual([LOCAL, remote]);
    h.dispose();
  });
});
