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
import { z } from "zod";

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
  /** Diagnostic sink (never the secret). */
  readonly log?: (line: string) => void;
}

/** Build the Hono app for the receiver. Kept transport-blind (no `serve`) so a
 *  test can hit `app.fetch(req)` directly and `bin.ts` owns the node adapter. */
export function createWebhookApp(deps: WebhookDeps): Hono {
  const app = new Hono();
  const path = deps.path ?? "/webhook";

  app.post(path, async (c) => {
    const raw = await c.req.text();
    const sig = c.req.header(SIGNATURE_HEADER);
    if (!verifySignature(raw, sig, deps.signingSecret)) {
      deps.log?.("rejected a delivery with an invalid or missing signature");
      return c.text("invalid signature", 401);
    }
    let event: XyneEvent;
    try {
      event = XyneEventSchema.parse(JSON.parse(raw));
    } catch {
      deps.log?.("rejected a signed delivery whose body was not a valid event");
      return c.text("bad request", 400);
    }
    // Verified — ACK now, work later. The turn (or decline) runs off the
    // response path; a rejection is logged, never thrown at XS.
    void Promise.resolve(deps.onEvent(event)).catch((err: unknown) => {
      deps.log?.(`event handler failed: ${(err as Error).message}`);
    });
    return c.text("ok", 200);
  });

  // A liveness probe for the funnel / systemd — no auth, no side effects.
  app.get("/health", (c) => c.text("ok", 200));

  return app;
}
