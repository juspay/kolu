import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createXyneApi, MESSAGE_CAP, splitMessage } from "./xyneApi.ts";

const JWT = "fake.jwt.token";

// ── A FAKE Xyne server, stood up in-test — no real XS, no secrets ────────────
interface FakeState {
  authHeaders: string[];
  messages: Map<string, string>;
  progress: Array<{ conversationId: string; inProgress: boolean }>;
  seq: number;
}

let server: ReturnType<typeof serve>;
let baseUrl: string;
let state: FakeState;

beforeAll(async () => {
  state = { authHeaders: [], messages: new Map(), progress: [], seq: 0 };
  const app = new Hono();

  app.use("/api/apps/*", async (c, next) => {
    state.authHeaders.push(c.req.header("Authorization") ?? "");
    await next();
  });

  app.post("/api/apps/chat/postMessage", async (c) => {
    const { content } = await c.req.json<{
      conversationId: string;
      content: string;
    }>();
    const messageId = `m${++state.seq}`;
    state.messages.set(messageId, content);
    return c.json({ messageId });
  });

  app.post("/api/apps/chat/updateMessage", async (c) => {
    const { messageId, content } = await c.req.json<{
      messageId: string;
      content: string;
    }>();
    state.messages.set(messageId, content);
    return c.json({ ok: true });
  });

  app.post("/api/apps/chat/agentProgress", async (c) => {
    const body = await c.req.json<{
      conversationId: string;
      inProgress: boolean;
    }>();
    state.progress.push(body);
    return c.json({ ok: true });
  });

  app.get("/api/apps/user/info", (c) => {
    const userId = c.req.query("userId");
    if (userId === "u-srid")
      return c.json({ name: "Sridhar", email: "srid@srid.ca" });
    return c.json({ user: { name: "Nobody", email: "nobody@example.com" } });
  });

  server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  const addr = server.address();
  if (addr === null || typeof addr === "string")
    throw new Error("expected a TCP address");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("createXyneApi against a fake Xyne", () => {
  it("posts a message and returns its id, with a Bearer token", async () => {
    const api = createXyneApi({ baseUrl, jwtToken: JWT });
    const { messageId } = await api.postMessage({
      conversationId: "c1",
      content: "hello",
    });
    expect(state.messages.get(messageId)).toBe("hello");
    expect(state.authHeaders.at(-1)).toBe(`Bearer ${JWT}`);
  });

  it("updates a posted message in place (the growing-reply UX)", async () => {
    const api = createXyneApi({ baseUrl, jwtToken: JWT });
    const { messageId } = await api.postMessage({
      conversationId: "c1",
      content: "…",
    });
    await api.updateMessage({ messageId, content: "growing reply" });
    expect(state.messages.get(messageId)).toBe("growing reply");
  });

  it("sends typing on/off via agentProgress", async () => {
    const api = createXyneApi({ baseUrl, jwtToken: JWT });
    await api.agentProgress({ conversationId: "c1", inProgress: true });
    await api.agentProgress({ conversationId: "c1", inProgress: false });
    expect(state.progress.slice(-2)).toEqual([
      { conversationId: "c1", inProgress: true },
      { conversationId: "c1", inProgress: false },
    ]);
  });

  it("resolves + caches user/info (a bare record and a {user} envelope)", async () => {
    const api = createXyneApi({ baseUrl, jwtToken: JWT });
    const before = state.authHeaders.length;
    const srid = await api.getUserInfo("u-srid");
    expect(srid).toEqual({ name: "Sridhar", email: "srid@srid.ca" });
    const other = await api.getUserInfo("u-other");
    expect(other).toEqual({ name: "Nobody", email: "nobody@example.com" });
    // Second read of the same user is served from cache — no new request.
    await api.getUserInfo("u-srid");
    expect(state.authHeaders.length).toBe(before + 2);
  });

  it("throws loudly on a non-2xx response (never a silent swallow)", async () => {
    const api = createXyneApi({
      baseUrl: "http://127.0.0.1:1/",
      jwtToken: JWT,
    });
    await expect(
      api.postMessage({ conversationId: "c1", content: "x" }),
    ).rejects.toThrow();
  });
});

describe("splitMessage — the 40,000-char cap", () => {
  it("leaves a short message as one chunk", () => {
    expect(splitMessage("short")).toEqual(["short"]);
  });

  it("splits a message longer than the cap into multiple chunks, each within the cap", () => {
    const line = `${"x".repeat(100)}\n`;
    const text = line.repeat(500); // ~50,500 chars, > 40,000
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MESSAGE_CAP);
    expect(chunks.join("")).toBe(text);
  });

  it("hard-splits a single over-cap line with no newline", () => {
    const text = "y".repeat(MESSAGE_CAP + 50);
    const chunks = splitMessage(text);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.length).toBe(MESSAGE_CAP);
    expect(chunks.join("")).toBe(text);
  });
});
