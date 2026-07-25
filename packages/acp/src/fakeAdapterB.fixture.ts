/**
 * A *second* scripted ACP agent, deliberately unlike the first.
 *
 * Running the suite twice over one fake with a flag flipped proves the argv is
 * read; it does not prove the package is free of assumptions about how an agent
 * behaves. This one is a different vendor profile, and the suite's passing over
 * both is the in-CI half of "any stdio ACP agent works" (the out-of-band smoke
 * against real `claude-agent-acp` and `codex-acp` is the other half).
 *
 * What differs from `fakeAdapter.fixture.ts`, all legal under ACP:
 *
 *   - session ids look nothing alike (`vendor-b/0001` vs `fake-session-1`)
 *   - capabilities differ, and it ships a vendor `_meta` block
 *   - the reply arrives as ONE batched chunk instead of a stream
 *   - the frame ORDER is different: a plan, then the permission request BEFORE
 *     the tool call it guards, then the call, then its update
 *   - it emits the newer frame kinds (`usage_update`), which the previous
 *     library version rejected outright and this one delivers
 *
 * Same observable contract, so the same tests run against it unchanged.
 */

import { Readable, Writable } from "node:stream";
import {
  type Agent,
  AgentSideConnection,
  type CancelNotification,
  type InitializeResponse,
  ndJsonStream,
  type NewSessionResponse,
  PROTOCOL_VERSION,
  type PermissionOption,
  type PromptRequest,
  type PromptResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";

const SESSION_ID = "vendor-b/0001";

/** Reversed relative to the other fake, and with an extra choice in front, so
 *  position is never a workable way to find `allow_once`. */
const OPTIONS: PermissionOption[] = [
  { optionId: "b.always", name: "Always", kind: "allow_always" },
  { optionId: "b.no", name: "Deny", kind: "reject_once" },
  { optionId: "b.once", name: "This time only", kind: "allow_once" },
];

class VendorBAgent implements Agent {
  readonly #connection: AgentSideConnection;
  #cancelled: (() => void) | null = null;

  constructor(connection: AgentSideConnection) {
    this.#connection = connection;
  }

  async initialize(): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        promptCapabilities: { image: true, embeddedContext: true },
        loadSession: true,
      },
      authMethods: [],
      _meta: { "vendor-b": { flavour: "batched" } },
    };
  }

  async newSession(): Promise<NewSessionResponse> {
    return { sessionId: SESSION_ID };
  }

  async authenticate(): Promise<void> {}

  async cancel(_params: CancelNotification): Promise<void> {
    this.#cancelled?.();
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const text = params.prompt
      .map((block) => (block.type === "text" ? block.text : ""))
      .join(" ")
      .trim();
    const sessionId = params.sessionId;

    if (text === "crash") {
      await this.#say(sessionId, "vendor b is going down");
      process.exit(3);
    }
    if (text === "hang") {
      await this.#say(sessionId, "streaming, then silence");
      return await new Promise<PromptResponse>(() => {});
    }
    if (text === "slow") {
      await this.#say(sessionId, "working, cancel me");
      await new Promise<void>((resolve) => {
        this.#cancelled = resolve;
      });
      this.#cancelled = null;
      return { stopReason: "cancelled" };
    }

    // A plan first — a frame the other fake never sends.
    await this.#connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "plan",
        entries: [
          { content: "echo it back", priority: "medium", status: "pending" },
        ],
      },
    });
    await this.#noise(sessionId);

    // The whole reply in one frame, not a stream.
    await this.#say(sessionId, `echo: ${text}`);

    const toolCallId = "b-tool";
    const title = `echo ${text}`;
    // Asks permission BEFORE announcing the call — the reverse of the other
    // fake, and equally legal.
    const decision = await this.#connection.requestPermission({
      sessionId,
      toolCall: { toolCallId, title },
      options: OPTIONS,
    });
    const outcome = decision.outcome;
    const allowed =
      outcome.outcome === "selected" &&
      OPTIONS.find((o) => o.optionId === outcome.optionId)?.kind ===
        "allow_once";

    await this.#connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId,
        title,
        kind: "execute",
        status: "in_progress",
      },
    });
    await this.#connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: allowed ? "completed" : "failed",
      },
    });
    await this.#noise(sessionId);
    return { stopReason: "end_turn" };
  }

  /**
   * A frame kind both real adapters send. The previous library's schema did not
   * know it and rejected it, so it never reached anyone; this one does, so it
   * lands in the transcript and at every attached client. Either way it must
   * not break the turn.
   */
  async #noise(sessionId: string): Promise<void> {
    await this.#connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "usage_update",
        used: 42,
        size: 1000,
      } as unknown as SessionNotification["update"],
    });
  }

  async #say(sessionId: string, text: string): Promise<void> {
    await this.#connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    });
  }
}

new AgentSideConnection(
  (connection) => new VendorBAgent(connection),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
