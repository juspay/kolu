import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { NotHere } from "@kolu/acp/engine";
import {
  type Harness,
  type HarnessState,
  startHarness,
} from "@kolu/acp-harness";
import {
  CONDUCTOR_ENGINE as ENGINE,
  conductorConfigDir,
} from "kolu-agents/acp";
import type { ConductorRow } from "kolu-common/conductor";

const silent = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const DEADLINE = 120_000;

const waitFor = async (
  harness: Harness<ConductorRow>,
  holds: (state: HarnessState) => boolean,
  why: string,
): Promise<void> => {
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    if (holds(harness.state())) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${why}: ${JSON.stringify(harness.state().signIn)}`);
};

const LIVE = process.env.KOLU_ACP_LIVE === "1" && process.env.KOLU_ACP_AGENT;

describe.skipIf(!LIVE)(
  "the pinned adapter and the pinned CLI, with nobody signed in",
  () => {
    let home = "";
    const live: Array<Harness<ConductorRow>> = [];

    beforeAll(async () => {
      home = await mkdtemp(path.join(tmpdir(), "kolu-signed-out-"));
    });

    afterAll(async () => {
      await Promise.all(
        live.splice(0, live.length).map((one) => one.stop("stopped by app")),
      );
      await rm(home, { recursive: true, force: true });
    });

    const started = async (
      resume: string | null,
    ): Promise<{ harness: Harness<ConductorRow>; configDir: string }> => {
      const seating = ENGINE.at({
        env: process.env,
        cwd: home,
        found: () => null,
      });
      if ("why" in seating) throw new Error(seating.why);
      const configDir = conductorConfigDir(process.env, home);
      const harness = await startHarness<ConductorRow>({
        agent: ENGINE.id,
        leg: ENGINE.leg,
        adapter: {
          ...(seating as Exclude<typeof seating, NotHere>),
          env: {
            ...(seating as Exclude<typeof seating, NotHere>).env,
            HOME: home,
            CLAUDE_CONFIG_DIR: configDir,
          },
        },
        cwd: home,
        configDir,
        mcpServers: [],
        teaching: "# [kolu] live test",
        taught: false,
        log: silent,
        opens:
          resume === null ? { kind: "fresh" } : { kind: "resume", id: resume },
        readCall: () => undefined,
        whenNewSession: "divide",
        numbering: "continues",
        whenLoadRefused: "fresh",
        whenReplayed: "drop",
        onChange: () => {},
      });
      live.push(harness);
      return { harness, configDir };
    };

    test(
      "offers a sign-in kolu can run, and runs it as far as the URL",
      async () => {
        const { harness, configDir } = await started(null);

        await waitFor(
          harness,
          (one) => one.signIn !== null,
          "the signed-out pair offered nothing",
        );
        const state = harness.state();
        expect(state.identity?.kind).toBe("none");
        expect(state.sessionId).not.toBeNull();
        expect(state.signIn?.methods.length).toBeGreaterThan(0);
        expect(
          state.signIn?.methods.every((one) => one.runs === "client"),
        ).toBe(true);
        expect(state.signIn?.cause).toMatchObject({ kind: "agent" });
        expect(JSON.stringify(state.signIn?.cause)).toContain(configDir);

        const method = state.signIn?.methods[0]?.id ?? "";
        const signing = harness.signIn(method);
        await waitFor(
          harness,
          (one) => (one.signIn?.attempt?.output ?? "").includes("https://"),
          "the sign-in printed no URL",
        );
        expect(await harness.signInCancel()).toBe(true);
        expect(await signing).toBe("cancelled");
      },
      DEADLINE,
    );

    test(
      "opens a fresh conversation when the id padi remembered is not in this CLI's store",
      async () => {
        const gone = "ba0d0775-2692-4460-ad85-61bec0aeb318";
        const { harness } = await started(gone);

        expect(harness.alive()).toBe(true);
        const state = harness.state();
        expect(state.phase).not.toBe("offline");
        expect(state.sessionId).not.toBeNull();
        expect(state.sessionId).not.toBe(gone);
        expect(state.refusal).toBeNull();

        const rows = harness.rows();
        expect(rows.filter((one) => one.kind === "divider").length).toBe(1);
        const notices = rows
          .filter((one) => one.kind === "notice")
          .map((one) => ("text" in one ? one.text : ""));
        expect(notices.length).toBe(1);
        expect(notices[0]).toContain("could not be resumed");
        expect(notices[0]).toContain(`Resource not found: ${gone}`);
        expect(notices[0]).not.toContain("the agent exited");
      },
      DEADLINE,
    );
  },
);
