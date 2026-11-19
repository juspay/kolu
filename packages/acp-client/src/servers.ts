/**
 * WHICH MCP servers a conversation has, and how each one stands.
 *
 * `mcp-roster-visible`: the panel answers "what tool servers does this
 * conversation have?" instead of leaving the MODEL to answer it. The incident
 * is the model getting it wrong — an opencode asked that question listed olai
 * and deepwiki, omitted kolu, and then called `kolu_lifecycle_create`
 * perfectly. Nothing in a conversation's context is a record of what it was
 * handed; the client that handed it over is the only thing that knows.
 *
 * THE ROSTER IS BUILT IN LAYERS, and each layer is only as certain as whoever
 * spoke for it. That is the whole design, and the reason these are two
 * functions rather than one:
 *
 *   - **what olai handed over** ({@link rosterOf}) is fully known, because this
 *     process composed the list and put it on the wire. It is read off the very
 *     array given to `session/new`, so a roster row cannot describe a server
 *     the session was not actually given — the two cannot drift, because
 *     there is only one of them.
 *   - **what the agent then made of it** ({@link movedBy}) is knowable only
 *     where the agent says so. ACP itself never does: `session/new` answers
 *     with a session id and not one word per server, which is why #140 could
 *     only ever report the failures olai found ITSELF. One agent does say —
 *     the Claude Code adapter forwards its CLI's `system`/`init`, and that
 *     message carries a status per server (`olai-plugin-claude`'s `leg.ts`) — and an
 *     agent that says nothing leaves every row at `handed`, which is an honest
 *     answer rather than a degraded one.
 *   - **what the AGENT brought of its own** is in neither, and is not in this
 *     module at all. See {@link movedBy} for why a row for one could not be
 *     kept honest; the sentence a person reads instead is the product's own
 *     roster face.
 *
 * PURE, and separated from {@link ./agent.ts} for the reason every leg rule is:
 * "what a person is told this conversation can reach" is a sentence worth
 * asserting without starting a subprocess, and the interesting cases here — an
 * agent that names a server we never handed, a status word nobody has seen
 * before — are ones a running agent would not produce on demand.
 */

import type { McpServer } from "@agentclientprotocol/sdk";
import type { Reported } from "@kolu/acp/engine";
import type { Server } from "@kolu/acp/wire";

/**
 * AN MCP SERVER this host was meant to give a session and could not, as the
 * PROBE that found out puts it: what it is called, the file it asked, and why
 * that was a no. Not to be confused with `@kolu/acp/engine`'s `NotHere`,
 * which is an AGENT this host cannot seat.
 *
 * Declared here rather than in {@link ./probes.ts} because it is this module's
 * INPUT, and because all four standings are minted below: a probe answers what
 * it found, and what a roster makes of that — which arm, which sentence, and
 * the rule that nothing an agent says may overwrite it — is one vocabulary in
 * one file. `where` is `null` for the ways of failing that never reached a
 * file.
 *
 * `why` IS THE PROBE'S OWN WHOLE SENTENCE and this file does not touch it. The
 * words belong to whoever found out — kolu's five ways of failing are
 * `olai-plugin-kolu`'s to word — and everything here is about the STANDING
 * they are carried under.
 */
export interface MissingServer {
  readonly name: string;
  readonly where: string | null;
  readonly why: string;
}

/**
 * The roster as OLAI composed it: every server this session was handed, plus
 * the one it was meant to have and did not.
 *
 * Read off `handing` — the literal `mcpServers` array that goes to
 * `session/new` ({@link ./agent.ts}'s `mcpServersOf`) — rather than off the
 * values that array was built from. The panel's list and the session's list are
 * then the same list read twice, and the failure mode this closes is the one
 * that matters most here: a roster that says a conversation has a server it was
 * never given is worse than the silence it replaces, because it is the same
 * wrong answer the model was giving, in a place a person has decided to trust.
 *
 * `where` is where the server IS, in whichever way its transport spells that:
 * the URL for one reached over http, the absolute executable for one spawned on
 * this host. Both come off the entry itself, so an entry shape this does not
 * know says `null` rather than guessing — and a `null` there is drawn as
 * nothing at all rather than as a blank line.
 *
 * ORDER IS THE ORDER THEY WERE HANDED, with the missing ones after them. It is
 * the only order that is a fact rather than a preference, and it puts olai's
 * own server first because olai's own server is handed first; the misses keep
 * the order they were probed in, which is the order the build declares its
 * plugins in.
 *
 * A LIST rather than one miss, and it became one the same day the probe did
 * ({@link ./probes.ts}). Any number of optional servers can fail to be here at
 * once, and the two halves have to agree about arity or a second plugin's
 * finding is silently the first one's: what a session was handed is a list, and
 * what it was not is the same list's other half.
 *
 * @param handing the `mcpServers` this session is being opened with
 * @param at the app address each handed server's plugin named for it, if any
 * @param missing what a person is owed about the servers it was not given —
 *   empty when there was nothing to miss ({@link ./probes.ts}'s `missingIn`; a
 *   host that is not running the tool had nothing go wrong)
 */
export const rosterOf = (
  handing: ReadonlyArray<McpServer>,
  missing: ReadonlyArray<MissingServer>,
  at: ReadonlyMap<string, string> = new Map(),
): ReadonlyArray<Server> => [
  ...handing.map(
    (server): Server => ({
      name: server.name,
      where: whereOf(server),
      ...(at.has(server.name) ? { at: at.get(server.name)! } : {}),
      // HANDED, never `connected`, and this is the layering in one line: olai
      // knows it gave the server to the session and cannot know the session took
      // it. Only an agent's own word moves a row past here ({@link movedBy}).
      standing: "handed",
      said: null,
    }),
  ),
  // ... and the ones it did not get, as the fourth standing. `missing` is the
  // arm for a server olai could not hand over AT ALL, which is exactly what a
  // probe's no is: the other three all describe a server that WAS handed over
  // and differ only in what the agent then said about it. Its `said` is the
  // probe's own sentence, whole.
  ...missing.map(
    (one): Server => ({
      name: one.name,
      where: one.where,
      standing: "missing",
      said: one.why,
    }),
  ),
];

/** Where one handed server is, out of the entry the session was given. The two
 *  transports olai hands over spell it differently — a URL for the route on
 *  this process's own listener, an absolute path for somebody else's program on
 *  this host — and an entry of a shape this does not know answers `null`, which
 *  is the same "nothing to point at" the one pathless probe failure produces. */
const whereOf = (server: McpServer): string | null => {
  if ("url" in server && typeof server.url === "string") return server.url;
  if ("command" in server && typeof server.command === "string")
    return server.command;
  return null;
};

/**
 * ... and the roster as the AGENT's own report leaves it — or `null` when that
 * report moved nothing.
 *
 * `null` for "nothing moved" because this is asked on every message an agent
 * forwards, and the Claude Code adapter forwards one per TURN: a conversation
 * whose servers are all fine would otherwise republish an identical roster to
 * every open tab for the life of the session. It is the same shape
 * {@link ./agent.ts} already reads the live model through, for the same reason.
 *
 * WHAT MOVES, and what deliberately does not:
 *
 *   - **a handed row the agent named** takes the agent's answer. `connected` is
 *     recognised positively and everything else becomes `unattached` carrying
 *     the agent's own word — a status set that grows on somebody else's release
 *     schedule may not be a set this file claims to know.
 *   - **a handed row the agent did NOT name** keeps the standing it had. An
 *     agent naming some of its servers has said nothing about the others, and
 *     reading silence as a downgrade would make a row flicker on every message
 *     that happened to be shorter than the last. It is {@link ./calls.ts}'s
 *     rule over a different subject — a frame REFINES and never retracts, so
 *     an absent field is "nothing has said yet" — and it is written out again
 *     rather than shared, because that registry is a per-call lookup a
 *     permission question consults and this is an ordered list published whole.
 *   - **a `missing` row is never touched**, whatever the agent says. That row
 *     is olai's own probe's finding about a server it did NOT hand over, so an
 *     agent reporting a server of that name is reporting its OWN — a `kolu` out
 *     of somebody's `~/.claude.json`, not the one this host's padi would not
 *     answer for. Letting it overwrite the probe would turn the one failure
 *     #140 exists to show back into a tick.
 *   - **a server the agent names that olai never handed** adds no row, and
 *     this is the layer's boundary rather than an oversight. The agent's own
 *     MCP servers are configured where olai cannot see, are told to us at most
 *     once per turn by an agent free to reconnect one in between, and are
 *     absent entirely from the other leg — so a row for one is a row that
 *     could never be kept honest, on one agent only. The panel says "plus the
 *     agent's own" instead, which is true of every agent and stays true.
 *
 * @param roster the conversation's roster as it stands
 * @param said what the agent reported, by name
 */
export const movedBy = (
  roster: ReadonlyArray<Server>,
  said: ReadonlyArray<Reported>,
): ReadonlyArray<Server> | null => {
  const next = roster.map((server) => asSaid(server, said));
  // A ROW THAT DID NOT MOVE IS THE SAME OBJECT, which is what makes this one
  // expression rather than a flag threaded through the map above: the map
  // answers what each row becomes, and this answers whether any of them became
  // something else. Written with a mutable `moved` set inside the callback, the
  // two questions are one loop and neither is readable on its own.
  return next.some((server, index) => server !== roster[index]) ? next : null;
};

/** What one row becomes under a report — itself, when the report leaves it
 *  where it was. Every arm of "leaves it where it was" is here rather than at
 *  the caller, because each is a decision about this layer's boundary and the
 *  identity above is what publishes them all as one answer. */
const asSaid = (server: Server, said: ReadonlyArray<Reported>): Server => {
  if (server.standing === "missing") return server;
  const reported = said.find((one) => one.name === server.name);
  if (reported === undefined) return server;
  // WHICH WORD MEANT YES was decided by the leg, which is the file allowed to
  // be wrong about one agent (`@kolu/acp/engine`'s `Leg`). What is left here is
  // the mapping onto a standing, which is true of every agent.
  //
  // THE WORD IS CARRIED WHOLE AND UNWRAPPED, on both arms: `said` is "the
  // agent's own sentence about the server wherever it said one"
  // (`@kolu/acp/wire`'s `Server`), so a row that quoted it inside a sentence of
  // this file's own would be putting words the agent never wrote into a field
  // the contract says are its — and a `connected` row that answered `null`
  // would be saying nobody spoke about a server the agent had just spoken
  // about. A reader can still act on `needs-auth` (sign the server in)
  // differently from `failed` (it broke), which is what quoting is for.
  const standing = reported.attached ? "connected" : "unattached";
  return server.standing === standing && server.said === reported.said
    ? server
    : { ...server, standing, said: reported.said };
};
