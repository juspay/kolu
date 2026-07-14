/**
 * The outbound half — pesu → XS through the installed app's HTTP API, one bearer
 * token. This is BOTH halves of the mirror in one client: the reply to a message
 * and (in B2) the unprompted post are the same `postMessage` call.
 *
 * ─── MORNING-VERIFY ──────────────────────────────────────────────────────────
 * The exact request/response shapes under `/api/apps/*` are modelled from the
 * plan-of-record (grounded against the XS source on 2026-07-13) and the field
 * conventions in the shipped xyne-cli (`content` / `conversationId` /
 * `messageId`, `Authorization: Bearer`, defensive JSON parse). B0 ships CI-class
 * green against an in-test FAKE Xyne that mirrors these shapes; the LIVE round
 * trip is the morning acceptance with srid, when the real server confirms them.
 * Each method names the exact wire body/path it assumes so a mismatch is a
 * one-line fix, not a redesign. Responses are parsed defensively (accept
 * `messageId` OR `id`) for the same reason.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The subset of the app API pesu drives. An interface so the engine can be
 *  tested against a fake without a network. */
export interface XyneApi {
  /** POST /api/apps/chat/postMessage — post into a thread (by `conversationId`).
   *  Returns the new message id (for the growing-reply `updateMessage`s). */
  postMessage(input: {
    conversationId: string;
    content: string;
  }): Promise<{ messageId: string }>;
  /** POST /api/apps/chat/updateMessage — edit a posted message in place. */
  updateMessage(input: { messageId: string; content: string }): Promise<void>;
  /** POST /api/apps/chat/agentProgress — ephemeral typing indicator on/off. */
  agentProgress(input: {
    conversationId: string;
    inProgress: boolean;
  }): Promise<void>;
  /** GET /api/apps/user/info — resolve a user id to name/email (cached). DM
   *  payloads omit even the display name, so this is how pesu attributes a turn
   *  and checks the operator allowlist. */
  getUserInfo(
    userId: string,
  ): Promise<{ name: string | null; email: string | null }>;
}

/** XS caps a single message at 40,000 characters. A reply longer than that is
 *  split into as many messages as it takes. */
export const MESSAGE_CAP = 40000;

/** Split `text` into chunks of at most `cap` characters, preferring to break at a
 *  newline so a chunk boundary rarely lands mid-line. A single line longer than
 *  `cap` is hard-split. Always returns at least one chunk (`[""]` for empty). */
export function splitMessage(
  text: string,
  cap: number = MESSAGE_CAP,
): string[] {
  if (text.length <= cap) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > cap) {
    const window = rest.slice(0, cap);
    const nl = window.lastIndexOf("\n");
    // Only honour a newline break if it isn't right at the start (which would
    // make no forward progress); otherwise hard-split at the cap.
    const cut = nl > 0 ? nl + 1 : cap;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks.length > 0 ? chunks : [""];
}

export interface XyneApiConfig {
  readonly baseUrl: string;
  readonly jwtToken: string;
  /** Injectable for tests; defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
}

function pickString(obj: unknown, ...keys: string[]): string | null {
  if (obj === null || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

/** The real HTTP client. A missing/negative response fails LOUD (throws) — the
 *  engine turns that into a visible fault reply, never a silent swallow. */
export function createXyneApi(cfg: XyneApiConfig): XyneApi {
  const doFetch = cfg.fetch ?? fetch;
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const userCache = new Map<
    string,
    { name: string | null; email: string | null }
  >();

  async function post(path: string, body: unknown): Promise<unknown> {
    const res = await doFetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.jwtToken}`,
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`XS ${path} → ${res.status}: ${raw.slice(0, 300)}`);
    }
    try {
      return raw.length > 0 ? JSON.parse(raw) : {};
    } catch {
      return raw;
    }
  }

  return {
    async postMessage({ conversationId, content }) {
      const out = await post("/api/apps/chat/postMessage", {
        conversationId,
        content,
      });
      const messageId = pickString(out, "messageId", "id");
      if (messageId === null) {
        throw new Error(
          `XS postMessage returned no message id — got ${JSON.stringify(out).slice(0, 200)}`,
        );
      }
      return { messageId };
    },

    async updateMessage({ messageId, content }) {
      await post("/api/apps/chat/updateMessage", { messageId, content });
    },

    async agentProgress({ conversationId, inProgress }) {
      await post("/api/apps/chat/agentProgress", {
        conversationId,
        inProgress,
      });
    },

    async getUserInfo(userId) {
      const cached = userCache.get(userId);
      if (cached !== undefined) return cached;
      const res = await doFetch(
        `${base}/api/apps/user/info?userId=${encodeURIComponent(userId)}`,
        { headers: { Authorization: `Bearer ${cfg.jwtToken}` } },
      );
      const raw = await res.text();
      if (!res.ok) {
        throw new Error(`XS user/info → ${res.status}: ${raw.slice(0, 300)}`);
      }
      let parsed: unknown;
      try {
        parsed = raw.length > 0 ? JSON.parse(raw) : {};
      } catch {
        parsed = {};
      }
      // Accept a bare `{ name, email }` or a `{ user: { … } }` envelope.
      const user =
        parsed !== null && typeof parsed === "object" && "user" in parsed
          ? (parsed as { user: unknown }).user
          : parsed;
      const info = {
        name: pickString(user, "name", "displayName", "senderName"),
        email: pickString(user, "email"),
      };
      userCache.set(userId, info);
      return info;
    },
  };
}
