/**
 * THE REAL PAIR, COMPACTING — the adapter `KOLU_ACP_AGENT` names, driving the
 * `claude` its own wrapper bakes in, seated the way kolu-server seats the
 * Conductor, against a FAKE of the Messages API on loopback. The fake answers
 * every request with a canned reply and reports whatever context size the case
 * sets, so the CLI believes the conversation is as long as the case says.
 *
 * What only the two binaries can answer, and what this work rests on:
 *
 *   - the settings kolu puts on the open's `_meta` make the CLI compact at
 *     200k, a person's own `"autoCompactEnabled": false` notwithstanding;
 *   - the message the compaction runs before is still in the context after
 *     the summary, so the rules that ride it survive;
 *   - a session made WITHOUT those settings and loaded by an adapter that
 *     has them compacts on its first message — the upgrade;
 *   - a loaded session reports no usage until its first turn, which is why
 *     kolu sends the rules when it does not know the count;
 *   - Claude Code's own memory is OFF for the Conductor (kolu keeps its
 *     memory), and its attribution stays off, as agent-distro's launcher
 *     sets it, although the session's settings replace the launcher's.
 *
 * NO REAL MODEL, NO CREDENTIAL, NO REAL HOME: the spawn is handed a scratch
 * `$HOME` and a `CLAUDE_CONFIG_DIR` under it, a key the fake never checks,
 * and `ANTHROPIC_BASE_URL` pointing at the fake, and every variable that
 * could point it anywhere else is removed from it ({@link ELSEWHERE}). Opt-in
 * like `signedOut.live.test.ts` (`KOLU_ACP_LIVE=1`).
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

import type { Leg, NotHere } from "@kolu/acp/engine";
import {
  type Compaction,
  type Harness,
  type HarnessChange,
  startHarness,
  type TurnEnded,
} from "@kolu/acp-harness";
import {
  CONDUCTOR_SEAT,
  conductorConfigDir,
  conductorEngine,
} from "kolu-agents/acp";
import type { ConductorRow } from "kolu-common/conductor";

const LIVE = process.env.KOLU_ACP_LIVE === "1" && process.env.KOLU_ACP_AGENT;

const DEADLINE = 240_000;
/** The Conductor's engine at the default point, the one this file measures. */
const engine = conductorEngine(200_000);
const TEACHING = "# [kolu] live test — RULES-CANARY";
const SUMMARY_CANARY = "SUMMARY-CANARY";

const silent = { info: () => {}, warn: () => {}, error: () => {} };

interface Asked {
  readonly system: string;
  readonly messages: ReadonlyArray<string>;
  readonly summary: boolean;
  /** Whether anything in the request carries Claude Code's own co-author
   *  instructions — what its attribution setting adds. */
  readonly coAuthored: boolean;
}

/**
 * WHAT COULD SEND A REQUEST SOMEWHERE REAL, removed from the spawn whatever
 * shell runs this file. agent-distro's launcher composes a profile's
 * environment, secrets included, from `AI_PROFILE` and
 * `AGENT_DISTRO_PLUGINS`, and the rest name an endpoint or a credential the
 * CLI would use before `ANTHROPIC_BASE_URL`.
 */
const ELSEWHERE: ReadonlyArray<string> = [
  "AI_PROFILE",
  "AGENT_DISTRO_PLUGINS",
  "LITELLM_BASE_URL",
  "LITELLM_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
];

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((block: { type?: string; text?: string }) =>
            typeof block?.text === "string" ? block.text : `[${block?.type}]`,
          )
          .join("\n")
      : "";

const fakeApi = () => {
  const asked: Asked[] = [];
  let used = 1_000;
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const body = (raw === "" ? {} : JSON.parse(raw)) as {
        readonly system?: unknown;
        readonly messages?: ReadonlyArray<{ readonly content?: unknown }>;
        readonly stream?: boolean;
        readonly model?: string;
      };
      const system = textOf(body.system);
      const messages = (body.messages ?? []).map((one) => textOf(one.content));
      const summary =
        /create a detailed summary|summary of the conversation/i.test(
          `${messages.at(-1) ?? ""}${system}`,
        );
      if (req.url?.includes("count_tokens")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ input_tokens: used }));
        return;
      }
      if (!req.url?.includes("/v1/messages")) {
        res.writeHead(404);
        res.end("{}");
        return;
      }
      asked.push({
        system,
        messages,
        summary,
        coAuthored: /Co-Authored-By/i.test(raw),
      });
      const text = summary
        ? `<summary>\n${SUMMARY_CANARY} the earlier talk.\n</summary>`
        : "noted";
      const message = {
        id: `msg_${asked.length}`,
        type: "message",
        role: "assistant",
        model: body.model ?? "fake",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: summary ? 2_000 : used,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      };
      if (body.stream !== true) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ...message,
            content: [{ type: "text", text }],
            stop_reason: "end_turn",
          }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const event = (type: string, data: object): void => {
        res.write(
          `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
        );
      };
      event("message_start", { message });
      event("content_block_start", {
        index: 0,
        content_block: { type: "text", text: "" },
      });
      event("content_block_delta", {
        index: 0,
        delta: { type: "text_delta", text },
      });
      event("content_block_stop", { index: 0 });
      event("message_delta", {
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 1 },
      });
      event("message_stop", {});
      res.end();
    });
  });
  return {
    server,
    asked,
    setUsed: (tokens: number) => {
      used = tokens;
    },
  };
};

const withoutSettings = (leg: Leg): Leg => {
  const raw = leg.rawMessages;
  if (raw === null) throw new Error("the engine's leg forwards no messages");
  const { options: _, ...claudeCode } = raw.openMeta["claudeCode"] as Record<
    string,
    unknown
  >;
  return { ...leg, rawMessages: { ...raw, openMeta: { claudeCode } } };
};

describe.skipIf(!LIVE)(
  "the pinned adapter and the pinned CLI, compacting where kolu says",
  () => {
    const api = fakeApi();
    let base = "";
    let home = "";
    const live: Array<Harness<ConductorRow>> = [];

    beforeAll(async () => {
      const listening = Promise.withResolvers<void>();
      api.server.listen(0, "127.0.0.1", listening.resolve);
      await listening.promise;
      base = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
      await Promise.all(
        live.splice(0, live.length).map((one) => one.stop("stopped by app")),
      );
      if (home !== "") await rm(home, { recursive: true, force: true });
      home = "";
    });

    afterAll(async () => {
      const closed = Promise.withResolvers<void>();
      api.server.close(() => closed.resolve());
      await closed.promise;
    });

    const started = async (
      over: {
        leg?: Leg;
        resume?: string | null;
        taught?: boolean;
        /** The control: the adapter WITHOUT the engine row's own
         *  environment (all of it is the engine's addition), and with those
         *  names unset in case this shell exports one. */
        withoutEngineEnv?: boolean;
      } = {},
    ) => {
      if (home === "")
        home = await mkdtemp(path.join(tmpdir(), "kolu-compacting-"));
      const seating = CONDUCTOR_SEAT.at({
        env: process.env,
        cwd: home,
        found: () => null,
      });
      if ("why" in seating) throw new Error(seating.why);
      const seated = seating as Exclude<typeof seating, NotHere>;
      const configDir = conductorConfigDir({}, home);
      const compactions: Compaction[] = [];
      const ended = new Map<string, TurnEnded>();
      const waiting = new Map<string, (turn: TurnEnded) => void>();
      const harness = await startHarness<ConductorRow>({
        agent: CONDUCTOR_SEAT.id,
        leg: over.leg ?? engine.leg,
        adapter: {
          ...seated,
          unset: [
            ...(seated.unset ?? []),
            ...ELSEWHERE,
            ...(over.withoutEngineEnv === true
              ? Object.keys(seated.env ?? {})
              : []),
          ],
          env: {
            ...(over.withoutEngineEnv === true ? {} : seated.env),
            HOME: home,
            CLAUDE_CONFIG_DIR: configDir,
            ANTHROPIC_BASE_URL: base,
            ANTHROPIC_API_KEY: "sk-ant-fake-not-a-key",
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          },
        },
        cwd: home,
        configDir,
        mcpServers: [],
        teaching: TEACHING,
        taught: over.taught ?? false,
        ...(engine.compacts === undefined
          ? {}
          : { compacts: engine.compacts.due }),
        onCompaction: (one) => compactions.push(one),
        log: silent,
        opens:
          over.resume === undefined || over.resume === null
            ? { kind: "fresh" }
            : { kind: "resume", id: over.resume },
        readCall: () => undefined,
        whenNewSession: "divide",
        numbering: "continues",
        whenLoadRefused: "report",
        whenReplayed: "drop",
        onChange: (change: HarnessChange<ConductorRow>) => {
          if (change.kind !== "turn") return;
          ended.set(change.row, change);
          waiting.get(change.row)?.(change);
        },
      });
      live.push(harness);
      const say = async (text: string, used: number): Promise<void> => {
        api.setUsed(used);
        const { rowId } = await harness.prompt(
          { text, body: text, extra: { attachments: [] }, files: [] },
          false,
        );
        const turn = Promise.withResolvers<TurnEnded>();
        waiting.set(rowId, turn.resolve);
        const already = ended.get(rowId);
        if (already !== undefined) turn.resolve(already);
        expect((await turn.promise).outcome).toBe("ended");
      };
      return { harness, compactions, say, configDir };
    };

    /** The conversation's own requests from `from` on — the CLI also asks
     *  the API for a title, which carries one message and no tools. */
    const turnsFrom = (from: number): ReadonlyArray<Asked> =>
      api.asked.slice(from).filter((one) => one.messages.length > 1);

    const afterSummary = (from: number): Asked | undefined => {
      const asked = turnsFrom(from);
      const at = asked.findIndex((one) => one.summary);
      return at === -1
        ? undefined
        : asked.slice(at + 1).find((one) => !one.summary);
    };

    test(
      "does not compact at 190k, compacts at 205k, and keeps the message it compacted before",
      async () => {
        const { compactions, say } = await started();
        await say("first", 1_000);
        await say("second", 190_000);
        await say("at 190k", 190_000);
        expect(compactions).toEqual([]);

        await say("third", 205_000);
        const from = api.asked.length;
        await say("MESSAGE-CANARY past the limit", 1_000);
        expect(compactions.at(-1)).toMatchObject({
          status: "completed",
          teaching: "sent",
        });
        expect(compactions.at(-1)?.summary).toContain(SUMMARY_CANARY);
        const next = afterSummary(from);
        expect(next?.messages.join("\n")).toContain(SUMMARY_CANARY);
        expect(next?.messages.join("\n")).toContain("MESSAGE-CANARY");
        expect(next?.messages.join("\n")).toContain("RULES-CANARY");
      },
      DEADLINE,
    );

    test(
      "compacts all the same when the person's own settings turn it off",
      async () => {
        home = await mkdtemp(path.join(tmpdir(), "kolu-compacting-"));
        const configDir = conductorConfigDir({}, home);
        await mkdir(configDir, { recursive: true });
        await writeFile(
          path.join(configDir, "settings.json"),
          JSON.stringify({ autoCompactEnabled: false }),
        );
        const { compactions, say } = await started();
        await say("first", 1_000);
        await say("second", 205_000);
        await say("MESSAGE-CANARY past the limit", 1_000);
        expect(compactions.at(-1)).toMatchObject({ status: "completed" });
      },
      DEADLINE,
    );

    test(
      "compacts a conversation from before the upgrade on its first message, once loaded with the settings",
      async () => {
        const before = await started({ leg: withoutSettings(engine.leg) });
        await before.say("first", 1_000);
        await before.say("long", 250_000);
        await before.say("still long", 250_000);
        expect(before.compactions).toEqual([]);
        const session = before.harness.state().sessionId;
        if (session === null) throw new Error("no session to come back to");
        await before.harness.stop("stopped by app");
        live.splice(live.indexOf(before.harness), 1);

        const after = await started({ resume: session, taught: true });
        // NOTHING SAYS HOW FULL IT IS until a turn runs — the reason the first
        // message after a restart carries the rules.
        expect(after.harness.state().usage).toBeNull();
        const from = api.asked.length;
        await after.say("MESSAGE-CANARY after the upgrade", 1_000);
        expect(after.compactions.at(-1)).toMatchObject({ status: "completed" });
        const next = afterSummary(from);
        expect(next?.messages.join("\n")).toContain("MESSAGE-CANARY");
        expect(next?.messages.join("\n")).toContain("RULES-CANARY");
      },
      DEADLINE,
    );

    test(
      "keeps Claude Code's own memory off, as the engine row says",
      async () => {
        const { say } = await started();
        const from = api.asked.length;
        await say("first", 1_000);
        expect(turnsFrom(from)[0]?.system).not.toContain("# Memory");
      },
      DEADLINE,
    );

    test(
      "has Claude Code's own memory without the engine row's environment — the control",
      async () => {
        const { say } = await started({ withoutEngineEnv: true });
        const from = api.asked.length;
        await say("first", 1_000);
        expect(turnsFrom(from)[0]?.system).toContain("# Memory");
      },
      DEADLINE,
    );

    test(
      "keeps Claude Code's attribution off, as the launcher sets it",
      async () => {
        const { say } = await started();
        const from = api.asked.length;
        await say("first", 1_000);
        await say("second", 1_000);
        const asked = api.asked.slice(from);
        expect(asked.length).toBeGreaterThan(0);
        expect(asked.filter((one) => one.coAuthored)).toEqual([]);
      },
      DEADLINE,
    );
  },
);
