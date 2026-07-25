/**
 * A scripted stdio ACP agent — the test double the suite drives the real bins
 * against.
 *
 * It is a *real* ACP agent (the official library, over real stdio), not an
 * in-process shim, so the proxy's adapter face is exercised exactly as it will
 * be in production. What it is not is intelligent: the prompt text is the
 * directive.
 *
 *   `crash`  exits mid-turn, without ever answering the prompt
 *   `hang`   streams and then never finishes, and ignores `session/cancel` —
 *            the case that must expire into a grace-window respawn
 *   `slow`   streams and finishes only when cancelled — a well-behaved cancel
 *   *        echoes, via a tool call and a permission request
 *
 * `--verbose` splits the reply across several chunks and adds a thought chunk.
 * The suite runs over both styles, which is what makes "the adapter is argv"
 * a property the tests check rather than a claim the README makes.
 *
 * Deterministic, offline, no credentials.
 */

import { Readable, Writable } from "node:stream";
import {
  type Agent,
  AgentSideConnection,
  type CancelNotification,
  type NewSessionResponse,
  ndJsonStream,
  PROTOCOL_VERSION,
  type PermissionOption,
  type PromptRequest,
  type PromptResponse,
  type InitializeResponse,
} from "@zed-industries/agent-client-protocol";

const VERBOSE = process.argv.includes("--verbose");
const DECOY_PERMISSION = process.argv.includes("--decoy-permission");
const SESSION_ID = "fake-session-1";

const PLAIN_OPTIONS: PermissionOption[] = [
  { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
  { optionId: "reject-once", name: "Reject", kind: "reject_once" },
];

/** The same three choices, arranged as a trap: the first option and the
 *  obvious id both belong to `allow_always`. Only `kind` identifies the one a
 *  harness is allowed to pick. */
const DECOY_OPTIONS: PermissionOption[] = [
  { optionId: "allow-once", name: "Always allow", kind: "allow_always" },
  { optionId: "opt-allow-99", name: "Just this once", kind: "allow_once" },
  { optionId: "reject-once", name: "Reject", kind: "reject_once" },
];

class FakeAgent implements Agent {
  readonly #connection: AgentSideConnection;
  #cancelled: (() => void) | null = null;

  constructor(connection: AgentSideConnection) {
    this.#connection = connection;
  }

  async initialize(): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { promptCapabilities: { image: false } },
      authMethods: [],
    };
  }

  async newSession(): Promise<NewSessionResponse> {
    return { sessionId: SESSION_ID };
  }

  async authenticate(): Promise<void> {}

  async cancel(_params: CancelNotification): Promise<void> {
    // `hang` deliberately does not wire this up: an agent that ignores cancel
    // is the failure mode the proxy's grace window exists for.
    this.#cancelled?.();
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const text = params.prompt
      .map((block) => (block.type === "text" ? block.text : ""))
      .join(" ")
      .trim();
    const sessionId = params.sessionId;

    if (text === "crash") {
      await this.#say(sessionId, "about to crash");
      process.exit(1);
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
    return await this.#echo(sessionId, text);
  }

  async #echo(sessionId: string, text: string): Promise<PromptResponse> {
    if (VERBOSE) {
      await this.#connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "considering the echo" },
        },
      });
      for (const word of `echo: ${text}`.split(" ")) {
        await this.#say(sessionId, `${word} `);
      }
    } else {
      await this.#say(sessionId, `echo: ${text}`);
    }

    const toolCallId = "fake-tool-1";
    const title = `echo ${text}`;
    await this.#connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId,
        title,
        kind: "execute",
        status: "pending",
      },
    });
    const options = DECOY_PERMISSION ? DECOY_OPTIONS : PLAIN_OPTIONS;
    const decision = await this.#connection.requestPermission({
      sessionId,
      toolCall: { toolCallId, title },
      options,
    });
    // Graded on `kind`, never on the id: under `--decoy-permission` the
    // invitingly-named `allow-once` id is the *allow_always* option, so a
    // client that matches on names or takes the first option grades as failed.
    const outcome = decision.outcome;
    const allowed =
      outcome.outcome === "selected" &&
      options.find((o) => o.optionId === outcome.optionId)?.kind ===
        "allow_once";
    await this.#connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: allowed ? "completed" : "failed",
      },
    });
    return { stopReason: "end_turn" };
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
  (connection) => new FakeAgent(connection),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
