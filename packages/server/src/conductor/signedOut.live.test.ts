/**
 * THE REAL PAIR, SIGNED OUT — the adapter `KOLU_ACP_AGENT` names, driving the
 * `claude` its own wrapper bakes in, against a `$HOME` with no credential in
 * it. Fixture proofs live in `@kolu/acp-harness`'s `harness.test.ts`; what
 * only the two binaries can answer lives here, the way padi's
 * `ports/scan.live.test.ts` holds its OS proofs.
 *
 * WHY THIS ONE IS NOT A FIXTURE: the defect it pins was a disagreement between
 * kolu and the pinned pair about HOW an agent asks for a signature. kolu heard
 * ACP's `-32000` on the OPEN and nothing else; this pair advertises its
 * terminal methods at the handshake, pushes `_auth/status_update
 * {kind:"none"}`, opens the session anyway, and does not refuse until the
 * turn. Every fixture in the tree agreed with kolu, which is exactly why the
 * panel could say "not signed in" over a sign-in button that reported the
 * agent had offered nothing. A fixture copied from the measurement keeps the
 * reading honest; only the binaries keep the MEASUREMENT honest.
 *
 * THE SECOND PROOF IS THE SAME KIND OF THING: how this pair answers a
 * `session/load` for a session id its CLI does not have. MEASURED here, rather
 * than assumed — `-32002 Resource not found: <id>` with the adapter still
 * running, which is a refusal ABOUT THE ID and not a request for a signature,
 * even with nobody signed in. kolu read the two alike, killed the adapter over
 * a stale string, and spawned another to ask the same dead id again.
 *
 * SIGNED OUT BY CONSTRUCTION, never by the state of this machine: the spawn is
 * handed a scratch `$HOME` and a `CLAUDE_CONFIG_DIR` under it, so the CLI reads
 * an empty store whatever the person running the suite is signed into. Nothing
 * here reads, copies or writes the real one, and the sign-in it starts is
 * CANCELLED at the point the URL has been proven to arrive — a test must never
 * complete a login or touch anybody's credential.
 *
 * SKIPPED where the variable is not baked (a bare `vitest` with no nix env).
 */

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

const silent = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** The whole bring-up has to fit inside one of these: two subprocesses start,
 *  one of them resolves this machine's plugins, and a sign-in command is run
 *  after that. */
const DEADLINE = 120_000;

/** Wait until the published state says something, on a deadline so a hang
 *  fails with the state it hung in. The agent is a SUBPROCESS: there is no
 *  clock to fake here, and the signal being waited for is a line it writes. */
const waitFor = async (
  harness: Harness,
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

describe.skipIf(!process.env.KOLU_ACP_AGENT)(
  "the pinned adapter and the pinned CLI, with nobody signed in",
  () => {
    let home = "";
    /** Every harness this file started — more than one, and a scratch `$HOME`
     *  with two `claude` children under it is the leak a missed `stop()`
     *  leaves on the machine running the suite. */
    const live: Array<Harness> = [];

    beforeAll(async () => {
      home = await mkdtemp(path.join(tmpdir(), "kolu-signed-out-"));
    });

    afterAll(async () => {
      await Promise.all(live.splice(0, live.length).map((one) => one.stop()));
      await rm(home, { recursive: true, force: true });
    });

    /** The spawn kolu-server makes, with the scratch home merged over it —
     *  `env` is merged into the spawn and `unset` still strips the five remote
     *  signals, so what runs here is the real seating and not a second recipe
     *  written for a test. */
    const started = async (
      resume: string | null,
    ): Promise<{ harness: Harness; configDir: string }> => {
      const seating = ENGINE.at({
        env: process.env,
        cwd: home,
        found: () => null,
      });
      if ("why" in seating) throw new Error(seating.why);
      const configDir = conductorConfigDir(process.env, home);
      const harness = await startHarness({
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
        teaching: ["[kolu] live test"],
        log: silent,
        resume,
        onChange: () => {},
      });
      live.push(harness);
      return { harness, configDir };
    };

    test(
      "offers a sign-in kolu can run, and runs it as far as the URL",
      async () => {
        const { harness, configDir } = await started(null);

        // THE OFFER ARRIVES WITHOUT ANY REFUSAL OF THE OPEN: this pair opens
        // the conversation for a signed-out CLI, and `session/new` succeeding
        // is the measurement that made the old reading wrong.
        await waitFor(
          harness,
          (one) => one.signIn !== null,
          "the signed-out pair offered nothing",
        );
        const state = harness.state();
        expect(state.identity?.kind).toBe("none");
        expect(state.sessionId).not.toBeNull();
        // Every method on offer is one KOLU runs — the adapter lists its
        // paste-a-code logins only for a client that advertised terminal auth,
        // and a method the panel could not run would be a dead button.
        expect(state.signIn?.methods.length).toBeGreaterThan(0);
        expect(
          state.signIn?.methods.every((one) => one.runs === "client"),
        ).toBe(true);
        // ... and the sentence names the store it was judged against.
        expect(state.signIn?.why).toContain(configDir);

        // THE RUN. The method's own command line is spawned and its output is
        // the row: a sign-in that cannot show the URL is one that asks a
        // person to find it in a log.
        const method = state.signIn?.methods[0]?.id ?? "";
        const signing = harness.signIn(method);
        await waitFor(
          harness,
          (one) => (one.signIn?.attempt?.output ?? "").includes("https://"),
          "the sign-in printed no URL",
        );
        // CANCELLED HERE, deliberately: what comes next is a person pasting a
        // code into somebody's real account, which no test may do.
        expect(await harness.signInCancel()).toBe(true);
        expect(await signing).toBe("cancelled");
      },
      DEADLINE,
    );

    test(
      "opens a fresh conversation when the id padi remembered is not in this CLI's store",
      async () => {
        // THE DEFECT THIS PAIR OWNS. kolu persists the agent's session id and
        // hands it back on the next boot; a CLI reading another store — a new
        // `CLAUDE_CONFIG_DIR`, a pruned history, a different machine — answers
        // `-32002 Resource not found: <id>` and goes on running. MEASURED
        // here, with `claude-agent-acp` 0.81.2 over agent-distro's `claude`:
        //
        //   → session/load {"sessionId":"ba0d0775-…"}
        //   ← {"code":-32002,"message":"Resource not found: ba0d0775-…",
        //      "data":{"uri":"ba0d0775-…"}}
        //
        // Read as a broken agent, that killed the adapter and the conductor
        // spawned another to ask the same dead id again. It is a fact about a
        // STRING kolu wrote down, so the conversation opens fresh and the
        // transcript says so.
        //
        // SIGNED OUT is the harder half on purpose: this is the state the
        // owner's panel was in, and the refusal still has to read as the id
        // rather than as the signature — `-32002`, not `-32000`.
        const gone = "ba0d0775-2692-4460-ad85-61bec0aeb318";
        const { harness } = await started(gone);

        // THE ADAPTER IS ALIVE and in a conversation — a different one, which
        // the agent minted on the `session/new` this fall-through asked for.
        expect(harness.alive()).toBe(true);
        const state = harness.state();
        expect(state.phase).not.toBe("offline");
        expect(state.sessionId).not.toBeNull();
        expect(state.sessionId).not.toBe(gone);
        expect(state.refusal).toBeNull();

        // ... and the two rows that account for it: ONE break where the
        // resumed conversation could not be, and one line carrying the CLI's
        // own sentence.
        const rows = harness.rows();
        expect(rows.filter((one) => one.kind === "divider").length).toBe(1);
        const notices = rows
          .filter((one) => one.kind === "notice")
          .map((one) => ("text" in one ? one.text : ""));
        expect(notices.length).toBe(1);
        expect(notices[0]).toContain("could not be resumed");
        expect(notices[0]).toContain(`Resource not found: ${gone}`);
        // Nothing was torn down, so nothing exited: that line is what a dead
        // adapter writes, and four of them is what this cost before.
        expect(notices[0]).not.toContain("the agent exited");
      },
      DEADLINE,
    );
  },
);
