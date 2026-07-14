/**
 * The entry point AND the turn engine — the glue that turns a verified event
 * into either a one-line decline or a relayed coordinator turn whose reply grows
 * in the thread.
 *
 * The engine is a factory (`createEngine`) over injected dependencies — the XS
 * client, the coordinator driver, the FIFO inbox — so the whole
 * decline-or-relay + post-once-then-update + split + typing + fault flow is
 * driven in tests against a FAKE Xyne and a FAKE driver, with no daemons and no
 * network. `main()` at the bottom wires the REAL dependencies and serves.
 */

import { serve } from "@hono/node-server";
import { attribute } from "./attribution.ts";
import { isOperatorEmail, loadConfig } from "./config.ts";
import { type CoordinatorDriver, KavalPadiCoordinator } from "./coordinator.ts";
import { Inbox } from "./inbox.ts";
import { createLogger, type Logger } from "./log.ts";
import { createWebhookApp, type XyneEvent } from "./webhook.ts";
import { createXyneApi, splitMessage, type XyneApi } from "./xyneApi.ts";

/** The two chat triggers B0 relays. `USER_MENTIONED` is an observer signal we
 *  ignore; anything else is logged and dropped. */
export const RELAYABLE_EVENTS = new Set(["APP_MENTIONED", "DIRECT_MESSAGE"]);

/** ≤1 `updateMessage` per second — the app API has no configured rate limit, so
 *  cadence discipline is pesu's own manners (the plan's "civil cadence"). */
export const MIN_UPDATE_INTERVAL_MS = 1000;

export interface RelayMessage {
  readonly conversationId: string;
  readonly userId: string;
  readonly senderName: string | null;
  readonly text: string;
}

function str(rec: Record<string, unknown>, key: string): string | null {
  const v = rec[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Pull the fields pesu needs out of an event payload. `cleanContent` (plain
 *  text) is preferred for the relay; `content` (HTML) is the fallback. Returns
 *  null when there's no thread to reply into. */
export function extractMessage(
  payload: Record<string, unknown>,
): RelayMessage | null {
  const conversationId = str(payload, "conversationId");
  if (conversationId === null) return null;
  return {
    conversationId,
    userId: str(payload, "userId") ?? "",
    senderName: str(payload, "senderName"),
    text: str(payload, "cleanContent") ?? str(payload, "content") ?? "",
  };
}

function declineLine(name: string): string {
  return `Sorry ${name} — you're not on pesu's operator allowlist, so I can't relay that to the coordinator. (B0 is single-operator by design; widening it is a config change.)`;
}

export interface EngineDeps {
  readonly xyne: XyneApi;
  readonly driver: CoordinatorDriver;
  readonly inbox: Inbox;
  readonly operatorEmails: readonly string[];
  /** Injectable clock for the cadence throttle (tests). Default `Date.now`. */
  readonly now?: () => number;
  readonly minUpdateIntervalMs?: number;
  /** The pino logger — REQUIRED. Every decision (ignore / decline / relay) and
   *  every turn boundary is logged. */
  readonly log: Logger;
}

export interface Engine {
  /** Handle one verified event. Resolves when the decline is posted or the turn
   *  is ENQUEUED (the turn itself runs on the inbox, one at a time). */
  handleEvent(event: XyneEvent): Promise<void>;
}

export function createEngine(deps: EngineDeps): Engine {
  const now = deps.now ?? Date.now;
  const minInterval = deps.minUpdateIntervalMs ?? MIN_UPDATE_INTERVAL_MS;
  const log = deps.log;

  /** Post the reply once, then update it in place as it grows — one thread
   *  message (or several, if it crosses the 40k cap). Every write is serialized
   *  through `chain` so updates can't race out of order, and throttled to
   *  `minInterval` (except a forced final/fault flush). */
  async function relayTurn(
    conversationId: string,
    prompt: string,
  ): Promise<void> {
    const messageIds: string[] = [];
    let latestReply = "";
    let lastSyncAt = 0;
    let chain: Promise<void> = Promise.resolve();

    async function doSync(content: string): Promise<void> {
      const chunks = splitMessage(content.length > 0 ? content : "…");
      for (let i = 0; i < chunks.length; i++) {
        const body = chunks[i] ?? "";
        const existing = messageIds[i];
        if (existing !== undefined) {
          await deps.xyne.updateMessage({ messageId: existing, content: body });
        } else {
          const { messageId } = await deps.xyne.postMessage({
            conversationId,
            content: body,
          });
          messageIds.push(messageId);
          log.info(
            { conversationId, messageId, chunk: i },
            "posted thread message",
          );
        }
      }
    }

    function enqueueSync(
      getContent: () => string,
      force: boolean,
    ): Promise<void> {
      chain = chain
        .then(async () => {
          const t = now();
          if (!force && t - lastSyncAt < minInterval) return;
          lastSyncAt = t;
          await doSync(getContent());
        })
        .catch((err: unknown) =>
          log.error(
            { conversationId, err: (err as Error).message },
            "thread sync failed",
          ),
        );
      return chain;
    }

    log.info({ conversationId }, "turn start — driving the coordinator");
    await deps.xyne.agentProgress({ conversationId, inProgress: true });
    try {
      // Post the (placeholder) message once so the thread shows a growing reply.
      await enqueueSync(() => latestReply, true);
      const final = await deps.driver.runTurn(prompt, (reply) => {
        latestReply = reply;
        void enqueueSync(() => latestReply, false);
      });
      latestReply = final;
      await enqueueSync(
        () =>
          final.length > 0 ? final : "(the coordinator produced no reply)",
        true,
      );
      log.info({ conversationId, chars: final.length }, "turn done");
    } catch (err) {
      // A fault is a VISIBLE reply, never silence — the fail-loud doctrine at the
      // chat boundary. Keep whatever reply had already streamed, append the fault.
      log.error(
        { conversationId, err: (err as Error).message },
        "turn FAULT — posting a visible fault reply",
      );
      const fault = `⚠️ ${(err as Error).message}`;
      await enqueueSync(
        () => (latestReply.length > 0 ? `${latestReply}\n\n${fault}` : fault),
        true,
      );
    } finally {
      await deps.xyne
        .agentProgress({ conversationId, inProgress: false })
        .catch((err: unknown) => {
          log.error(
            { conversationId, err: (err as Error).message },
            "clearing typing indicator failed",
          );
        });
    }
  }

  return {
    async handleEvent(event) {
      if (!RELAYABLE_EVENTS.has(event.eventType)) {
        log.info(
          { eventType: event.eventType },
          "ignoring non-relayable event",
        );
        return;
      }
      const msg = extractMessage(event.payload);
      if (msg === null) {
        log.warn(
          { eventType: event.eventType },
          "ignoring event with no conversationId in payload",
        );
        return;
      }
      const info = msg.userId
        ? await deps.xyne.getUserInfo(msg.userId)
        : { name: null, email: null };
      const name = msg.senderName ?? info.name ?? "someone";
      log.info(
        {
          conversationId: msg.conversationId,
          userId: msg.userId,
          email: info.email,
          name,
        },
        "resolved sender",
      );
      if (!isOperatorEmail(deps.operatorEmails, info.email)) {
        // A non-operator gets a visible decline, never a relayed turn, never silence.
        log.warn(
          { conversationId: msg.conversationId, email: info.email, name },
          "DECLINED — sender not on the operator allowlist",
        );
        await deps.xyne.postMessage({
          conversationId: msg.conversationId,
          content: declineLine(name),
        });
        return;
      }
      // Operator — queue the turn on the write floor (one in flight, FIFO).
      log.info(
        {
          conversationId: msg.conversationId,
          name,
          depth: deps.inbox.depth,
          text: msg.text.slice(0, 80),
        },
        "RELAYING — queued on the inbox",
      );
      deps.inbox.enqueue(() =>
        relayTurn(msg.conversationId, attribute(name, msg.text)),
      );
    },
  };
}

async function main(): Promise<void> {
  const log = createLogger();

  // Nothing escapes unlogged: a stray rejection or throw anywhere in the daemon
  // lands here loudly instead of dying silently.
  process.on("unhandledRejection", (reason) => {
    log.error(
      {
        err:
          reason instanceof Error
            ? (reason.stack ?? reason.message)
            : String(reason),
      },
      "unhandledRejection",
    );
  });
  process.on("uncaughtException", (err) => {
    log.error({ err: err.stack ?? err.message }, "uncaughtException");
  });

  const config = loadConfig();

  const xyne = createXyneApi({
    baseUrl: config.xyneBaseUrl,
    jwtToken: config.jwtToken,
    log,
  });
  const inbox = new Inbox((err) =>
    log.error({ err: (err as Error).message }, "turn failed at the inbox"),
  );
  const driver = new KavalPadiCoordinator({
    coordinatorTitle: config.coordinatorTitle,
    log,
  });
  const engine = createEngine({
    xyne,
    driver,
    inbox,
    operatorEmails: config.operatorEmails,
    log,
  });

  const app = createWebhookApp({
    signingSecret: config.signingSecret,
    onEvent: (event) => engine.handleEvent(event),
    log,
  });

  serve(
    { fetch: app.fetch, hostname: "127.0.0.1", port: config.port },
    (info) => {
      log.info(
        {
          port: info.port,
          coordinatorTitle: config.coordinatorTitle,
          operators: config.operatorEmails.length,
          xyneBaseUrl: config.xyneBaseUrl,
        },
        `pesu listening on 127.0.0.1:${info.port}`,
      );
    },
  );
}

// Run only when invoked as the entry point (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    // Boot failed before the logger could take over (e.g. a missing env var) —
    // write directly to stderr so the fatal reason is never lost.
    // eslint-disable-next-line no-console -- fatal boot error to stderr.
    console.error(`[pesu] fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}
