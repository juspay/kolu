/**
 * The bake-less mode of `installAgentDelivery`: a kolu-server built from
 * source delivers nothing, and SAYS so — to every REMOTE host that takes the
 * setting (a `padi-agent`, which would otherwise wait for a delivery that never
 * comes), never to the local padi (it shares this process's unbaked
 * environment), and to nobody while agents are off.
 */

import type { AgentDistroDeliveryReport } from "@kolu/agent-distro/schema";
import type { Logger } from "@kolu/log";
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import { Effect } from "effect";
import { LOCAL_HOST } from "kolu-common/hostKey";
import { describe, expect, it, vi } from "vitest";
import {
  type DeliveryPool,
  installAgentDelivery,
  NO_DELIVERY_MESSAGE,
} from "./install.ts";

const log = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

const LOCAL = "local";
const REMOTE = "remote:srid@box";

/** Let the fire-and-forget reports land. */
const settle = () => new Promise((r) => setTimeout(r, 0));

/** A pool of one local and one remote CONNECTED session, each recording what
 *  its padi's `agentDistro.report` was told. */
function fakePool() {
  const reports = new Map<string, AgentDistroDeliveryReport[]>([
    [LOCAL, []],
    [REMOTE, []],
  ]);
  const clientFor = (key: string) =>
    ({
      surface: {
        agentDistro: {
          report: (r: AgentDistroDeliveryReport) =>
            Effect.sync(() => {
              reports.get(key)?.push(r);
            }),
        },
      },
    }) as unknown as PadiSurfaceClient;
  const pool: DeliveryPool = {
    hosts: () => [LOCAL, REMOTE],
    getSession: (key) =>
      reports.has(key)
        ? {
            currentState: () => ({ phase: "connected" }),
            currentClient: () => Promise.resolve(clientFor(key)),
          }
        : undefined,
  };
  return { pool, reports };
}

function install(enabled: boolean) {
  const { pool, reports } = fakePool();
  const handle = installAgentDelivery({
    bake: null,
    pool,
    setting: () => ({ enabled, profile: "vanilla" }),
    bundles: new Set(["vanilla"]),
    label: (h) => (h.kind === "local" ? "laptop" : h.target),
    log,
  });
  return { handle, reports };
}

const NO_DELIVERY: AgentDistroDeliveryReport = {
  kind: "failed",
  profile: "vanilla",
  reason: "delivery",
  message: NO_DELIVERY_MESSAGE,
};

describe("installAgentDelivery without the delivery bake", () => {
  it("tells a remote host taking the setting that nothing delivers", async () => {
    const { handle, reports } = install(true);
    handle.deliverTo(REMOTE);
    await vi.waitFor(() => expect(reports.get(REMOTE)).toEqual([NO_DELIVERY]));
    expect(reports.get(LOCAL)).toEqual([]);
  });

  it("tells the local host nothing", async () => {
    const { handle, reports } = install(true);
    handle.deliverTo(LOCAL);
    handle.deliverNow(LOCAL_HOST);
    await settle();
    await settle();
    expect(reports.get(LOCAL)).toEqual([]);
    expect(reports.get(REMOTE)).toEqual([]);
  });

  it("the user's check over every host tells only the remote one", async () => {
    const { handle, reports } = install(true);
    handle.deliverNow(null);
    await vi.waitFor(() => expect(reports.get(REMOTE)).toEqual([NO_DELIVERY]));
    expect(reports.get(LOCAL)).toEqual([]);
  });

  it("tells nobody while agents are off", async () => {
    const { handle, reports } = install(false);
    handle.deliverTo(REMOTE);
    handle.deliverTo(LOCAL);
    handle.deliverNow(null);
    handle.onSettingChanged();
    await settle();
    await settle();
    expect(reports.get(REMOTE)).toEqual([]);
    expect(reports.get(LOCAL)).toEqual([]);
  });
});
