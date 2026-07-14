/**
 * The receiver — the one inbound door. XS POSTs a signed event; pesu verifies
 * the signature on the RAW body (constant-time) BEFORE it parses anything,
 * answers 200 immediately, and hands the parsed event to the engine to work
 * asynchronously (delivery is fire-and-forget — no retries — so a slow turn must
 * never hold the HTTP response open).
 *
 * Only the HMAC + parse + immediate-ack live here. Which event types matter, who
 * may drive, and how a turn runs are the engine's concern (`bin.ts`), injected
 * as `onEvent`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { z } from "zod";
import type { Logger } from "./log.ts";

/** The signature header XS sends: HMAC-SHA256 (hex) of the raw JSON body with the
 *  app signing secret. */
export const SIGNATURE_HEADER = "x-xyne-signature";

/** Constant-time verification of `X-Xyne-Signature` against the raw request body.
 *  Compares over the FULL hex digest with `timingSafeEqual` (equal-length
 *  buffers only — an unequal length can't be a valid HMAC, so it returns false
 *  without a variable-time short-circuit that would leak the compare length).
 *  There is no timestamp/replay scheme in the XS contract, so this is the whole
 *  of authentication — recorded, accepted risk. */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | undefined | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader.trim().toLowerCase(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The three chat triggers XS delivers to an installed app. B0 relays
 *  `APP_MENTIONED` + `DIRECT_MESSAGE`; `USER_MENTIONED` is an observer signal the
 *  engine ignores. Unknown future types are carried through as their literal
 *  string so the engine can log-and-ignore rather than the parser rejecting a
 *  validly-signed delivery. */
export const XyneEventSchema = z.object({
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
  timestamp: z.number().optional(),
});
export type XyneEvent = z.infer<typeof XyneEventSchema>;

export interface WebhookDeps {
  readonly signingSecret: string;
  /** Handle a verified, parsed event. Called AFTER the 200 is returned; its
   *  rejection is caught here (fire-and-forget) so a failing turn never surfaces
   *  as an HTTP error to XS. */
  readonly onEvent: (event: XyneEvent) => void | Promise<void>;
  /** The webhook path. Default `/webhook`. */
  readonly path?: string;
  /** The pino logger — REQUIRED (never the secret). Logging the inbound edge is
   *  the whole point; a missing logger would mean a silently deaf webhook. */
  readonly log: Logger;
}

/** Build the Hono app for the receiver. Kept transport-blind (no `serve`) so a
 *  test can hit `app.fetch(req)` directly and `bin.ts` owns the node adapter.
 *
 *  Logging is deliberately total: an access line for EVERY request (Hono's
 *  `logger` middleware), a semantic line for every delivery and every decision
 *  (received → verified → accepted / rejected), a `notFound` line for a request
 *  to the wrong path (so a mis-registered webhook URL is visible, not a silent
 *  404), and an `onError` line for any thrown error (never swallowed). */
export function createWebhookApp(deps: WebhookDeps): Hono {
  const app = new Hono();
  const path = deps.path ?? "/webhook";
  const log = deps.log;

  // Access log for every request: `<-- POST /webhook` then `--> POST /webhook 200 3ms`.
  app.use(
    "*",
    honoLogger((message, ...rest) => log.info({ rest }, message.trim())),
  );

  app.post(path, async (c) => {
    const raw = await c.req.text();
    const sig = c.req.header(SIGNATURE_HEADER);
    log.info(
      { bytes: raw.length, signature: sig ? "present" : "MISSING" },
      "webhook delivery received",
    );
    if (!verifySignature(raw, sig, deps.signingSecret)) {
      log.warn(
        { bytes: raw.length },
        "REJECTED (401): invalid or missing X-Xyne-Signature",
      );
      return c.text("invalid signature", 401);
    }
    let event: XyneEvent;
    try {
      event = XyneEventSchema.parse(JSON.parse(raw));
    } catch (err) {
      log.warn(
        { err: (err as Error).message, head: raw.slice(0, 120) },
        "REJECTED (400): signed body is not a valid event",
      );
      return c.text("bad request", 400);
    }
    log.info(
      {
        eventType: event.eventType,
        conversationId: event.payload.conversationId,
        userId: event.payload.userId,
      },
      "ACCEPTED delivery — handing to the engine",
    );
    // Verified — ACK now, work later. The turn (or decline) runs off the
    // response path; a rejection is logged (with its stack), never thrown at XS.
    void Promise.resolve(deps.onEvent(event)).catch((err: unknown) => {
      log.error(
        { err: (err as Error).stack ?? (err as Error).message },
        "event handler threw",
      );
    });
    return c.text("ok", 200);
  });

  // A liveness probe for the funnel / systemd — no auth, no side effects.
  app.get("/health", (c) => c.text("ok", 200));

  // A request to any other route is almost always a mis-registered webhook URL
  // (wrong path) or a probe — surface it loudly rather than a silent 404.
  app.notFound((c) => {
    log.warn(
      { method: c.req.method, path: new URL(c.req.url).pathname },
      `404 unmatched route (the webhook is POST ${path})`,
    );
    return c.text("not found", 404);
  });

  // Any error escaping a handler is logged, never swallowed into a bare 500.
  app.onError((err, c) => {
    log.error(
      { err: err.stack ?? err.message },
      "unhandled error in the webhook app",
    );
    return c.text("internal error", 500);
  });

  return app;
}
