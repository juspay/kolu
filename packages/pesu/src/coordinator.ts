/**
 * The one door onto the coordinator — the identical agent-drives-agent loop kolu
 * already ships, wrapped as a `CoordinatorDriver`. A turn:
 *
 *   resolve the terminal BY TITLE (kaval re-keys ids across restarts; titles
 *   survive) → baseline the coordinator's assistant transcript → write the
 *   attributed prompt in (bracketed paste, settle, snapshot-verify, THEN a
 *   separate Enter — a same-breath Enter races the paste debounce and is dropped)
 *   → wait for the turn to end via padi's agent-state buckets, streaming the
 *   growing reply as new assistant text lands → return the final reply.
 *
 * Reply text is read through the SHIPPED loaders (`kolu-claude-code` /
 * `kolu-codex` / `kolu-grok` / `kolu-opencode`), dispatched on the agent kind
 * padi publishes — the same dispatch `packages/padi/src/transcript.ts` does, so
 * pesu is model-agnostic on day one and owns NO transcript parser of its own.
 * Only `sessionId` + `cwd` feed the loader (pesu reads assistant TEXT, not the
 * rendered header), so no repo/PR/git plumbing is needed here.
 *
 * ─── VENUE ───────────────────────────────────────────────────────────────────
 * The `KavalPadiCoordinator` impl talks to LIVE kaval + padi daemons, so it is
 * exercised by the morning live round-trip (with srid), not in CI. The CI-class
 * tests pin the PURE helpers below (title resolution, the assistant-reply delta)
 * and drive the turn engine against a FAKE driver. Keeping the daemon glue thin
 * and the decisions pure is what makes that split honest.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  connectPadi,
  resolveRunningPadiSocket,
  scopePadiSurface,
} from "@kolu/padi/dial";
import { type PadiTerminal, padiSurface } from "@kolu/padi/surface";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import { NAMED_KEY_BYTES, wrapBracketedPaste } from "@kolu/terminal-protocol";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { type ptyHostSurface, resolveRunningKavalSocket } from "kaval";
import { loadClaudeCodeTranscript } from "kolu-claude-code";
import { loadCodexTranscript } from "kolu-codex";
import { loadGrokTranscript } from "kolu-grok";
import { loadOpenCodeTranscript } from "kolu-opencode";
import type { Transcript } from "kolu-transcript-core";
import { match } from "ts-pattern";
import type { Logger } from "./log.ts";

// ── The contract: one turn on the coordinator ────────────────────────────────

export interface CoordinatorDriver {
  /** Run one turn: write `prompt` into the coordinator, stream the growing reply
   *  through `onGrow` (called with the FULL reply-so-far each time it grows), and
   *  resolve with the final reply text. Rejects on any fault (terminal not found,
   *  write-in didn't land, turn timed out) — the engine turns that into a visible
   *  reply, never silence. */
  runTurn(prompt: string, onGrow: (reply: string) => void): Promise<string>;
}

// ── Pure helpers (CI-tested) ─────────────────────────────────────────────────

/** A terminal list entry, narrowed to what title resolution needs. */
export interface TitledTerminal {
  readonly id: string;
  readonly title?: string | undefined;
}

/** Resolve the coordinator terminal by its exact title. Throws — loudly and
 *  specifically — on zero matches (coordinator not running / wrong title) or more
 *  than one (an ambiguous title that must be unique). A title, not an id, because
 *  kaval re-keys every id when it restarts but the title survives. */
export function pickTerminalByTitle<T extends TitledTerminal>(
  entries: readonly T[],
  title: string,
): T {
  const matches = entries.filter((e) => e.title === title);
  if (matches.length === 0) {
    throw new Error(
      `no coordinator terminal titled ${JSON.stringify(title)} — is the coordinator running? (titles survive kaval restarts; check \`kaval-tui list\`)`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} terminals are titled ${JSON.stringify(title)} — the coordinator title must be unique`,
    );
  }
  // filter guarantees a first element here.
  return matches[0] as T;
}

function assistantTexts(t: Transcript | null): string[] {
  if (t === null) return [];
  return t.events
    .filter((e) => e.kind === "assistant")
    .map((e) => ("text" in e ? e.text : ""));
}

/** How many assistant messages the transcript holds — the baseline captured
 *  BEFORE the write-in, so the reply is exactly the assistant text produced by
 *  THIS turn. */
export function assistantCount(t: Transcript | null): number {
  return assistantTexts(t).length;
}

/** The reply produced since `baselineCount` — the assistant text of THIS turn,
 *  concatenated. Indexing by message count (not a string prefix) is robust to
 *  the coordinator interleaving tool calls between assistant messages. */
export function replySince(
  t: Transcript | null,
  baselineCount: number,
): string {
  return assistantTexts(t).slice(baselineCount).join("\n\n").trim();
}

/** Dispatch on the agent kind padi publishes to the shipped loader — the same
 *  four-arm match `padi/transcript.ts` does. `.exhaustive()` means a new agent
 *  kind fails the typecheck here until it has a loader, rather than silently
 *  degrading. Only `sessionId` + `cwd` are load-bearing (the loader locates the
 *  on-disk session from them); the rest is header metadata pesu doesn't read. */
export function loadCoordinatorTranscript(
  agent: AgentInfo,
  cwd: string | null,
): Transcript | null {
  const base = {
    sessionId: agent.sessionId,
    title: agent.summary,
    repoName: null,
    cwd,
    model: agent.model,
    contextTokens: agent.contextTokens,
    pr: null,
  };
  return match(agent)
    .with({ kind: "claude-code" }, () => loadClaudeCodeTranscript(base))
    .with({ kind: "opencode" }, () => loadOpenCodeTranscript(base))
    .with({ kind: "codex" }, () => loadCodexTranscript(base))
    .with({ kind: "grok" }, () => loadGrokTranscript(base))
    .exhaustive();
}

// ── The live driver ──────────────────────────────────────────────────────────

export interface KavalPadiCoordinatorConfig {
  readonly coordinatorTitle: string;
  /** How long to wait for the coordinator to PICK UP the prompt (reach the
   *  `working` bucket) after Enter. Default 30s. */
  readonly pickupTimeoutMs?: number;
  /** How long a whole turn may run before pesu gives up. Default 10 min. */
  readonly turnTimeoutMs?: number;
  /** How often to re-read the growing reply. Default 800ms. */
  readonly pollIntervalMs?: number;
  /** The pino logger — REQUIRED. Every drive step (resolve → write-in → pickup →
   *  turn end) is logged, and a mirror link error is surfaced, not swallowed. */
  readonly log: Logger;
}

const activeAgentOf = (v: PadiTerminal): AgentInfo | null =>
  v.state === "active" ? v.agent : null;
const cwdOf = (v: PadiTerminal): string | null =>
  v.state === "active" ? (v.cwd ?? null) : null;
const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

type PadiClient = ReturnType<typeof scopePadiSurface>;
type MirrorEvent =
  | { kind: "upsert"; id: string; value: PadiTerminal }
  | { kind: "remove"; id: string };

/** Drive a padi `terminals` mirror until `decide` yields a value (then resolve
 *  it), the link closes, or `timeoutMs` elapses. The `activity` stream is
 *  subscribed only to keep the mirror open (a collection-only mirror settles
 *  right after its snapshot) — exactly padi-tui's own pattern. The mirror replays
 *  each terminal's current value on connect, so a state that already holds
 *  matches immediately (no missed-transition race). */
async function mirrorUntil<T>(
  client: PadiClient,
  decide: (e: MirrorEvent) => T | undefined,
  timeoutMs: number,
  log: Logger,
  label: string,
): Promise<T | null> {
  const abort = new AbortController();
  let result: T | undefined;
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const handle = (e: MirrorEvent): void => {
    if (result !== undefined) return;
    const decided = decide(e);
    if (decided !== undefined) {
      result = decided;
      abort.abort();
    }
  };
  try {
    await mirrorRemoteSurface(
      padiSurface,
      client,
      {
        collections: {
          terminals: {
            upsert: (id, value) => handle({ kind: "upsert", id, value }),
            remove: (id) => handle({ kind: "remove", id }),
          },
        },
        streams: { activity: { input: {}, onFrame: () => {} } },
      },
      { signal: abort.signal },
    ).done;
  } catch (err) {
    // We abort() on a match or a timeout, so a caught error is expected once
    // we've resolved; only an UNresolved catch is a genuine link failure worth
    // surfacing (never a silent swallow).
    if (result === undefined) {
      log.warn(
        { label, err: (err as Error).message },
        "padi mirror closed before a match",
      );
    }
  } finally {
    clearTimeout(timer);
  }
  return result ?? null;
}

export class KavalPadiCoordinator implements CoordinatorDriver {
  constructor(private readonly cfg: KavalPadiCoordinatorConfig) {}

  async runTurn(
    prompt: string,
    onGrow: (reply: string) => void,
  ): Promise<string> {
    const pickupTimeoutMs = this.cfg.pickupTimeoutMs ?? 30_000;
    const turnTimeoutMs = this.cfg.turnTimeoutMs ?? 600_000;
    const pollIntervalMs = this.cfg.pollIntervalMs ?? 800;
    const log = this.cfg.log;
    const title = this.cfg.coordinatorTitle;

    const kaval = await unixSocketLink<typeof ptyHostSurface.contract>({
      socketPath: resolveKavalSocket(),
    });
    const padiConn = await connectPadi(resolvePadiSocket());
    const padi = scopePadiSurface(padiConn.client);
    try {
      // 1. Resolve the coordinator terminal by title (fresh — ids re-key).
      const { entries } = await kaval.client.surface.terminal.list({});
      const term = pickTerminalByTitle(entries, title);
      const id = term.id;
      log.info(
        { title, id, terminals: entries.length },
        "resolved coordinator terminal by title",
      );

      // 2. Read the coordinator's active agent + cwd, and baseline its transcript.
      const rec = await mirrorUntil(
        padi,
        (e) => {
          if (e.kind !== "upsert" || e.id !== id) return undefined;
          const agent = activeAgentOf(e.value);
          return agent === null ? undefined : { agent, cwd: cwdOf(e.value) };
        },
        pickupTimeoutMs,
        log,
        "read-active-agent",
      );
      if (rec === null) {
        throw new Error(
          `coordinator terminal ${id} has no active agent session — start an agent in ${JSON.stringify(title)} first`,
        );
      }
      const baseline = assistantCount(
        loadCoordinatorTranscript(rec.agent, rec.cwd),
      );
      log.info(
        {
          id,
          agentKind: rec.agent.kind,
          sessionId: rec.agent.sessionId,
          baseline,
        },
        "coordinator agent read; baselined transcript",
      );

      // 3. Attributed write-in: bracketed paste, settle, snapshot-verify, Enter.
      const before = await screen(kaval, id);
      await kaval.client.surface.terminal.write({
        id,
        data: wrapBracketedPaste(prompt),
      });
      await settleScreen(kaval, id);
      const after = await screen(kaval, id);
      if (after === before) {
        throw new Error(
          "write-in did not land — the coordinator's screen is unchanged after the paste",
        );
      }
      await kaval.client.surface.terminal.write({
        id,
        data: NAMED_KEY_BYTES.enter ?? "\r",
      });
      log.info(
        { id, promptChars: prompt.length },
        "wrote prompt in and submitted",
      );

      // 4. Wait for pickup (working), then the turn end (awaiting/waiting),
      //    streaming the growing reply. The mirror replays current state, so
      //    watching turn-end AFTER pickup can't miss a fast turn.
      const pickedUp = await mirrorUntil(
        padi,
        (e) => bucketMatch(e, id, ["working"]),
        pickupTimeoutMs,
        log,
        "await-pickup",
      );
      log.info(
        { id, pickedUp: pickedUp !== null },
        pickedUp !== null
          ? "coordinator picked up the prompt"
          : "coordinator did not visibly pick up (proceeding to watch for a reply)",
      );

      const readReply = (): string =>
        replySince(loadCoordinatorTranscript(rec.agent, rec.cwd), baseline);
      let ended = false;
      const endWatch = mirrorUntil(
        padi,
        (e) => bucketMatch(e, id, ["awaiting", "waiting"]),
        turnTimeoutMs,
        log,
        "await-turn-end",
      ).then((r) => {
        ended = r !== null;
        return r;
      });
      const deadline = Date.now() + turnTimeoutMs;
      while (!ended && Date.now() < deadline) {
        onGrow(readReply());
        await sleep(pollIntervalMs);
      }
      await endWatch;

      // 5. Grace for the final assistant event to flush to disk after the bucket
      //    flipped (gate on "the reply grew"), then the final read.
      for (let i = 0; i < 4 && readReply().length === 0; i++)
        await sleep(pollIntervalMs);
      const finalReply = readReply();
      onGrow(finalReply);
      log.info({ id, chars: finalReply.length }, "coordinator turn complete");
      return finalReply;
    } finally {
      kaval.dispose();
      padiConn.dispose();
    }
  }
}

function bucketMatch(
  e: MirrorEvent,
  id: string,
  targets: readonly string[],
): "met" | undefined {
  if (e.kind !== "upsert" || e.id !== id) return undefined;
  const agent = activeAgentOf(e.value);
  if (agent === null) return undefined;
  return targets.includes(agentBucket(agent.state)) ? "met" : undefined;
}

async function screen(
  kaval: Awaited<
    ReturnType<typeof unixSocketLink<typeof ptyHostSurface.contract>>
  >,
  id: string,
): Promise<string> {
  const { text } = await kaval.client.surface.terminal.getScreenText({
    id,
    extent: { kind: "viewport" },
  });
  return text;
}

/** Poll the viewport until it holds still across two reads (the paste has
 *  registered), capped so a continuously-busy coordinator can't hang the settle.
 *  The caller's own snapshot-verify decides whether the write actually landed. */
async function settleScreen(
  kaval: Awaited<
    ReturnType<typeof unixSocketLink<typeof ptyHostSurface.contract>>
  >,
  id: string,
): Promise<void> {
  const stepMs = 300;
  const capMs = 4000;
  const deadline = Date.now() + capMs;
  let prev = await screen(kaval, id);
  while (Date.now() < deadline) {
    await sleep(stepMs);
    const cur = await screen(kaval, id);
    if (cur === prev) return;
    prev = cur;
  }
}

function resolveKavalSocket(): string {
  const r = resolveRunningKavalSocket();
  if (r.kind === "many") {
    throw new Error(
      `multiple kaval daemons are running — pesu needs exactly one on this host (in the Incus container, mount only the coordinator's kaval socket dir). candidates: ${r.candidates.map((c) => c.socket).join(", ")}`,
    );
  }
  if (r.kind === "none") {
    throw new Error(
      "no running kaval daemon found — is kolu running on this host?",
    );
  }
  return r.socket;
}

function resolvePadiSocket(): string {
  const r = resolveRunningPadiSocket();
  if (r.kind === "many") {
    throw new Error(
      `multiple padi daemons are running — pesu needs exactly one on this host. candidates: ${r.candidates.map((c) => c.socket).join(", ")}`,
    );
  }
  if (r.kind === "none") {
    throw new Error(
      "no running padi daemon found — is kolu running on this host?",
    );
  }
  return r.socket;
}
