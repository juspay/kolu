/**
 * The Agents-setting push — `installPadiCellPusher` writing padi's memory-only
 * `agentDistro` cell. Same fakes as `newTerminalPolicy.test.ts`: the pusher's
 * pool/session/client slices are narrow on purpose, so no real padi is needed.
 * What this pins for THIS cell: a push on every connect (first bind and
 * reconnect — padi forgets the setting with its link), a re-push when the
 * preference moves, nothing for an unrelated preference write, and a refusal (a
 * host that does not know the profile) logged and contained.
 */

import { Effect } from "effect";
import type { Logger } from "@kolu/log";
import {
  type AgentDistroSetting,
  agentDistroSettingEqual,
} from "@kolu/agent-distro/schema";
import { describe, expect, it, vi } from "vitest";
import {
  installPadiCellPusher,
  type PadiCellPushSession,
} from "./padiCellPusher.ts";

const VANILLA: AgentDistroSetting = { enabled: true, profile: "vanilla" };
const JUSPAY: AgentDistroSetting = { enabled: true, profile: "juspay" };

const log = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

const settle = () => new Promise((r) => setTimeout(r, 0));

function fakeSession(opts: { refuse?: boolean } = {}) {
  const listeners = new Set<(s: { phase: string }) => void>();
  let state = { phase: "connecting" };
  const pushed: AgentDistroSetting[] = [];
  const client = {
    surface: {
      agentDistro: {
        set: (value: AgentDistroSetting) =>
          Effect.suspend(() => {
            if (opts.refuse === true)
              return Effect.fail(new Error("unknown agent-distro profile"));
            pushed.push(value);
            return Effect.void;
          }),
      },
    },
  };
  const session: PadiCellPushSession = {
    onState(cb) {
      listeners.add(cb);
      cb(state);
      return () => {
        listeners.delete(cb);
      };
    },
    currentState: () => state,
    currentClient: () => Promise.resolve(client),
  };
  return {
    session,
    pushed,
    to(phase: string) {
      state = { phase };
      for (const l of [...listeners]) l(state);
    },
  };
}

function poolOf(entries: Record<string, PadiCellPushSession>) {
  return {
    hosts: () => Object.keys(entries),
    getSession: (h: string) => entries[h],
    subscribe: () => () => {},
  };
}

describe("the agentDistro push", () => {
  it("pushes the setting on connect, and again on every reconnect", async () => {
    const local = fakeSession();
    installPadiCellPusher({
      cell: "agentDistro",
      pool: poolOf({ local: local.session }),
      getValue: () => VANILLA,
      equals: agentDistroSettingEqual,
      log,
    });
    local.to("connected");
    await settle();
    local.to("reconnecting");
    local.to("connected");
    await settle();
    expect(local.pushed).toEqual([VANILLA, VANILLA]);
  });

  it("re-pushes a changed setting to every connected host, and skips an unchanged one", async () => {
    const local = fakeSession();
    const remote = fakeSession();
    let value = VANILLA;
    const pusher = installPadiCellPusher({
      cell: "agentDistro",
      pool: poolOf({ local: local.session, "remote:box": remote.session }),
      getValue: () => value,
      equals: agentDistroSettingEqual,
      log,
    });
    local.to("connected");
    remote.to("connected");
    await settle();
    pusher.republish(); // an unrelated preference write
    await settle();
    value = JUSPAY;
    pusher.republish();
    await settle();
    expect(local.pushed).toEqual([VANILLA, JUSPAY]);
    expect(remote.pushed).toEqual([VANILLA, JUSPAY]);
  });

  it("logs a host's refusal at error and keeps running", async () => {
    const remote = fakeSession({ refuse: true });
    const errors = vi.fn();
    installPadiCellPusher({
      cell: "agentDistro",
      pool: poolOf({ "remote:box": remote.session }),
      getValue: () => JUSPAY,
      equals: agentDistroSettingEqual,
      log: { ...log, error: errors } as unknown as Logger,
    });
    expect(() => remote.to("connected")).not.toThrow();
    await settle();
    expect(errors).toHaveBeenCalledTimes(1);
  });
});
