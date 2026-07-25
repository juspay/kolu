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

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
} from "@agentclientprotocol/sdk";

const VERBOSE = process.argv.includes("--verbose");
const DECOY_PERMISSION = process.argv.includes("--decoy-permission");
/** Exit before answering anything — the adapter that dies during the handshake. */
const DIE_ON_BOOT = process.argv.includes("--die-on-boot");
/** Complete the handshake, then exit — the adapter that never stays up, which
 *  is what the respawn backoff and give-up cap exist for. */
const DIE_WHEN_READY = process.argv.includes("--die-when-ready");
/** Serve the first generation normally, then die *during the handshake* of
 *  every generation after it. The replacement dying mid-handshake is the case
 *  a respawn guard can silently swallow, leaving no adapter and no report. */
const DIE_ON_RESPAWN = process.argv.includes("--die-on-respawn");
/** Close the ACP stream but keep running — a live process with a dead
 *  transport, which no `exit` or `error` event would ever report. */
const DROP_STREAM = process.argv.includes("--drop-stream");
/** Leave a long-lived child in this process's group, then exit — the tool or
 *  MCP server an adapter is expected to take with it. */
const LEAK_CHILD = process.argv.includes("--leak-child");
const SESSION_ID = "fake-session-1";

/**
 * How many times this fixture has already run under the same proxy, counted
 * through a file because each generation is a fresh process. Lets a directive
 * behave differently on a *replacement* than on the original.
 */
function generationsBefore(): number {
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir === undefined) return 0;
  const marker = join(runtimeDir, "fake-adapter-generations");
  let seen = 0;
  try {
    seen = Number(readFileSync(marker, "utf8")) || 0;
  } catch {
    // No marker yet (the first generation), or one that cannot be read — either
    // way this run is generation zero. The counter is test scaffolding, and a
    // bad read of it must not be louder than the behaviour under test.
    seen = 0;
  }
  writeFileSync(marker, String(seen + 1));
  return seen;
}

/** Which run of this fixture we are, counted once per process. */
const GENERATION = DIE_ON_RESPAWN ? generationsBefore() : 0;

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
    if (DIE_ON_RESPAWN && GENERATION > 0) {
      // Never answers `initialize`; dies holding the request open — exactly the
      // shape the ACP library leaves pending forever.
      process.exit(11);
    }
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { promptCapabilities: { image: false } },
      authMethods: [],
    };
  }

  async newSession(): Promise<NewSessionResponse> {
    if (LEAK_CHILD) {
      // A descendant in the adapter's process group, whose pid is left where
      // the test can find it. It must not survive its parent.
      const runtimeDir = process.env.XDG_RUNTIME_DIR ?? "/tmp";
      const child = spawn("sleep", ["300"], { stdio: "ignore" });
      writeFileSync(join(runtimeDir, "leaked-child-pid"), String(child.pid));
      setTimeout(() => process.exit(4), 50);
    }
    if (DROP_STREAM) {
      // Answer, then drop the protocol stream while staying alive.
      setTimeout(() => process.stdout.end(), 50);
    }
    if (DIE_WHEN_READY || DIE_ON_RESPAWN) {
      // Answer first, then go, so the proxy sees a *ready* adapter die — the
      // case the respawn policy must pace rather than report as a handshake
      // failure. The two flags differ in what the NEXT generation does, not
      // here: DIE_ON_RESPAWN's replacement dies inside its own handshake.
      setTimeout(() => process.exit(9), 20);
    }
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

if (DIE_ON_BOOT) process.exit(7);

new AgentSideConnection(
  (connection) => new FakeAgent(connection),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
