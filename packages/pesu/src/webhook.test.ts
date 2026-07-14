import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createWebhookApp,
  SIGNATURE_HEADER,
  verifySignature,
  type XyneEvent,
} from "./webhook.ts";

const SECRET = "test-signing-secret";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

async function post(
  app: ReturnType<typeof createWebhookApp>,
  body: string,
  sig: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (sig !== null) headers[SIGNATURE_HEADER] = sig;
  return app.fetch(
    new Request("http://local/webhook", { method: "POST", body, headers }),
  );
}

describe("verifySignature — constant-time HMAC", () => {
  it("accepts a correct signature", () => {
    const body = '{"eventType":"APP_MENTIONED","payload":{}}';
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });
  it("rejects a forged / wrong-secret signature", () => {
    const body = '{"eventType":"APP_MENTIONED","payload":{}}';
    expect(verifySignature(body, sign(body, "wrong"), SECRET)).toBe(false);
    expect(verifySignature(body, "deadbeef", SECRET)).toBe(false);
  });
  it("rejects a missing signature", () => {
    expect(verifySignature("{}", undefined, SECRET)).toBe(false);
    expect(verifySignature("{}", "", SECRET)).toBe(false);
  });
});

describe("createWebhookApp — verify, ack 200, dispatch async", () => {
  it("rejects a forged signature with 401 and never dispatches (pinned RED)", async () => {
    const seen: XyneEvent[] = [];
    const app = createWebhookApp({
      signingSecret: SECRET,
      onEvent: (e) => void seen.push(e),
    });
    const body =
      '{"eventType":"APP_MENTIONED","payload":{"conversationId":"c1"}}';
    const res = await post(app, body, sign(body, "attacker-guess"));
    expect(res.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("accepts a correctly-signed delivery with 200 and dispatches it (pinned GREEN)", async () => {
    let resolveSeen!: (e: XyneEvent) => void;
    const seen = new Promise<XyneEvent>((r) => {
      resolveSeen = r;
    });
    const app = createWebhookApp({
      signingSecret: SECRET,
      onEvent: (e) => resolveSeen(e),
    });
    const body =
      '{"eventType":"APP_MENTIONED","payload":{"conversationId":"c1","userId":"u1"}}';
    const res = await post(app, body, sign(body));
    expect(res.status).toBe(200);
    const event = await seen;
    expect(event.eventType).toBe("APP_MENTIONED");
    expect(event.payload.conversationId).toBe("c1");
  });

  it("returns 400 for a signed-but-malformed body without dispatching", async () => {
    const seen: XyneEvent[] = [];
    const app = createWebhookApp({
      signingSecret: SECRET,
      onEvent: (e) => void seen.push(e),
    });
    const body = "not json";
    const res = await post(app, body, sign(body));
    expect(res.status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it("answers 200 immediately even if the handler is slow (fire-and-forget)", async () => {
    let released = false;
    const app = createWebhookApp({
      signingSecret: SECRET,
      onEvent: () =>
        new Promise<void>((r) =>
          setTimeout(() => {
            released = true;
            r();
          }, 50),
        ),
    });
    const body =
      '{"eventType":"DIRECT_MESSAGE","payload":{"conversationId":"c1"}}';
    const res = await post(app, body, sign(body));
    expect(res.status).toBe(200);
    expect(released).toBe(false); // returned before the handler finished
  });

  it("serves a health probe", async () => {
    const app = createWebhookApp({ signingSecret: SECRET, onEvent: () => {} });
    const res = await app.fetch(new Request("http://local/health"));
    expect(res.status).toBe(200);
  });
});
