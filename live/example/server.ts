/**
 * Example server: a counter that broadcasts ticks to all connected clients.
 *
 * Demonstrates:
 *  - createChannel for a broadcast channel
 *  - createKeyedChannel for per-room channels
 *  - liveQuery for snapshot-first streaming
 *
 * This is a conceptual example — it shows how the primitives compose
 * with any async-generator-based RPC framework (oRPC, gRPC, etc.).
 */

import {
  createChannel,
  createKeyedChannel,
  liveQuery,
  liveQueryMany,
} from "../src/server.ts";

// ---------------------------------------------------------------------------
// 1. Broadcast channel: global counter
// ---------------------------------------------------------------------------

const counter = createChannel<number>();
let count = 0;

// Tick every second
setInterval(() => {
  count++;
  counter.publish(count);
}, 1000);

/**
 * Handler for a "counter.live" streaming endpoint.
 *
 * A client connecting to this endpoint gets the current count immediately,
 * then receives every subsequent tick in real time.
 *
 * Usage in an oRPC router:
 *   counter: {
 *     live: handler(async function* ({ signal }) {
 *       yield* counterLive(signal);
 *     }),
 *   }
 */
export const counterLive = liveQuery(
  (signal) => counter.subscribe(signal),
  () => count,
);

// ---------------------------------------------------------------------------
// 2. Keyed channel: per-room chat
// ---------------------------------------------------------------------------

type ChatMessage = { user: string; text: string; timestamp: number };

const chatMessages = createKeyedChannel<string, ChatMessage>();
const chatHistory = new Map<string, ChatMessage[]>();

/** Send a message to a room. */
export function sendMessage(room: string, user: string, text: string): void {
  const msg: ChatMessage = { user, text, timestamp: Date.now() };
  const history = chatHistory.get(room) ?? [];
  history.push(msg);
  chatHistory.set(room, history);
  chatMessages.publish(room, msg);
}

/**
 * Handler for a "chat.messages" streaming endpoint.
 *
 * Yields the full message history for the room, then streams new messages.
 * Uses liveQueryMany because the snapshot is multiple items (history array).
 */
export function chatLive(room: string) {
  return liveQueryMany(
    (signal) => chatMessages.subscribe(room, signal),
    () => chatHistory.get(room) ?? [],
  );
}

// ---------------------------------------------------------------------------
// 3. Demo: consume the streams (simulating two clients)
// ---------------------------------------------------------------------------

async function demo() {
  console.log("=== Counter demo ===");

  const c1 = new AbortController();
  // Client 1 connects to counter
  void (async () => {
    for await (const n of counterLive(c1.signal)) {
      console.log(`[client-1] counter = ${n}`);
      if (n >= 3) c1.abort(); // disconnect after 3
    }
    console.log("[client-1] disconnected");
  })();

  // Wait for counter to tick a few times
  await new Promise((r) => setTimeout(r, 3500));

  console.log("\n=== Chat demo ===");

  const c2 = new AbortController();

  // Seed some history
  sendMessage("general", "alice", "hello!");
  sendMessage("general", "bob", "hey alice");

  // Client 2 connects to chat — gets history then live messages
  void (async () => {
    for await (const msg of chatLive("general")(c2.signal)) {
      console.log(`[client-2] ${msg.user}: ${msg.text}`);
    }
  })();

  // Give the async iterator a tick to start consuming
  await new Promise((r) => setTimeout(r, 10));

  // New message arrives after client connected
  sendMessage("general", "charlie", "what's up?");

  await new Promise((r) => setTimeout(r, 10));
  c2.abort();

  console.log("\nDone.");
  process.exit(0);
}

demo();
