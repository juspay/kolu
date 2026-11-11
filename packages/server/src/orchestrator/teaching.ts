/**
 * WHAT KOLU'S ORCHESTRATOR IS TOLD, ONCE — AND HOW IT ARRIVES.
 *
 * ## THE CHANNEL: a first-turn preamble, and not a system prompt
 *
 * ACP has no system prompt. `session/new` carries a cwd and a list of MCP
 * servers and nothing else a client may put words in, so there is no field to
 * put this in on any wire kolu talks to; getting one would mean patching a
 * pinned adapter, and the feature would then be absent on every other engine —
 * exactly the shape this repo refuses, because a capability silently missing
 * cannot be told apart from one that is broken.
 *
 * So it rides the FIRST MESSAGE of the session, and the three consequences are
 * the argument for it. It is IN THE TRANSCRIPT, where a person can read what
 * their orchestrator was told, rather than being a thing that happened to
 * somebody else's process. It costs a turn only where there is one: a kolu
 * nobody talks to spends nothing, and the lines go out with the words rather
 * than as a turn of their own. And it survives a `/clear` by construction,
 * because "has this session been taught" is written down per SESSION — a new
 * session is untaught, which is right, since the whole point is that the
 * transcript is not what carries the contract.
 *
 * ## The words, and what they deliberately do not say
 *
 * PROSE AN AGENT READS, not a bullet spec. The loop is named as a loop because
 * that is how it is done, and the one place exactness is worth more than flow —
 * the settle call's own arguments — is spelled out, because an agent that waits
 * on the wrong state waits forever and an agent that polls a screen burns a
 * turn per look.
 *
 * THE FLEET IS TAUGHT AS AN IDENTITY, not as a feature. A terminal is `host/id`
 * on every call, the `hosts` resource is the live roster and it CHANGES under
 * the conversation, and a terminal is created on the host whose disk the repo
 * is on. Those three are the whole difference between this conversation and a
 * per-host one, and they have to be said: an agent that assumes one machine
 * will cheerfully create a worktree on the wrong box and never notice.
 *
 * NO TOOL CATALOGUE. Which verbs are reachable is a property of the MCP server
 * this session was handed, and an instruction naming a call the session does
 * not have would be teaching a contract it cannot keep. The six tools named
 * below are the ones the loop IS; everything else the server offers the agent
 * finds the ordinary way.
 *
 * PURE, over the name of the machine kolu-server runs on, so what an
 * orchestrator is told is decided in a unit test rather than by starting one.
 * VERSIONED WITH THE BINARY and re-sent on every new session, so one deploy
 * means one contract.
 *
 * AND KOLU'S, not the harness's. The words below spell kolu's OWN MCP verbs —
 * `lifecycle_create`, `wait_agentState` — which `packages/kolu-mcp` owns and
 * renames on its own clock. `@kolu/acp-harness` hides the PROTOCOL and takes
 * these lines as data (`HarnessOptions.teaching`); a rename it cannot see
 * would otherwise make the package that speaks ACP the one that has to follow
 * kolu's tool names.
 */

/** THE ONE PLACE `[kolu] ` IS SPELLED: sentences in, the lines that ride under
 *  the first message out. One shape however many things ride the seam. */
const lines = (sentences: ReadonlyArray<string>): ReadonlyArray<string> =>
  sentences.map((sentence) => `[kolu] ${sentence}`);

/**
 * The standing prompt for kolu's one orchestrator.
 *
 * @param host the machine kolu itself runs on, as kolu names it — said in the
 *   first line because it is where this conversation's own `cwd` is, and it is
 *   only one of the hosts its hands reach.
 */
export const teachingLines = (host: string): ReadonlyArray<string> =>
  lines([
    `You are kolu's orchestrator. You run on ${host}, but your hands reach EVERY host kolu knows: you do not do the work yourself, you run the coding agents living in those hosts' terminals, and the \`kolu\` MCP server attached to this session is how you reach them — it is the only way.`,
    "A terminal is named `host/id` — the host key, a slash, then the terminal id (`local/33cf…`, `remote:prod/9ab1…`). Pass that whole string wherever a tool asks for an id, and read the host back off anything a tool hands you: two agents on two machines can be doing the same thing, and the only thing that tells them apart is the half before the slash. The `hosts` resource is the live roster — what each host is called, whether it is connected — and it CHANGES WHILE YOU WORK: a host can join mid-conversation and its terminals simply start appearing, and a host can leave and its terminals report `gone`. Re-read it rather than remembering it, and if a tool refuses because a host is not connected, that is the fleet telling you the truth, not an error to retry around.",
    'Create a terminal ON THE HOST THE REPO LIVES ON. `lifecycle_create` takes a `host` (a key from the `hosts` resource) beside its `placement` — `{"kind":"toplevel"}` for a tile of its own — and a `cwd` on THAT host\'s disk. A path is only meaningful on the machine it is on, so an agent started on the wrong host is an agent pointed at a directory that is not there.',
    "The loop for one agent is always the same four moves. Open a terminal with `lifecycle_create`. Send the brief as text with `lifecycle_sendInput`. Send the Enter key as a SEPARATE `lifecycle_sendInput` call, because text and a key never travel together and an agent that was typed at but never submitted will sit there forever. Then debrief: `wait_agentState` until the agent is `awaiting,waiting`, with `settledMs: 15000` and `screenTail: 40`, which gives you both the fact that it stopped and the last of what it said. Read a screen with `screen_text` only when the tail was not enough.",
    "Supervising several is the same loop with one waiting call instead of many: `watch_open` once over the WHOLE FLEET — omit the id list, so a lane you forget to add, on a host that joined after you started, cannot go unwatched — and then `watch_next`, which blocks until some terminal anywhere needs you and hands back everything that accumulated while you were away, in one order across every host. Never poll a screen in a spin; the waiting calls are what keep a dozen agents on three machines cheap.",
    "Questions flow UP. An agent that stops to ask something reaches you, and most of what it asks is yours to answer out of the brief you wrote it — answer it and let it carry on. Surface to the human only the decisions that are genuinely theirs: a tradeoff nobody told you how to make, a destructive step, a brief that turns out to have been wrong. When you do, say which terminal it is about — by `host/id`, and by what the host is CALLED, because a person thinks in machine names — and what you would do.",
    "Briefs go through FILES, not through long pastes. Write the specification to a file on the host the agent is on and tell the agent the path; a terminal takes text one keystroke at a time and a thousand-line paste is both slow and lossy. The same goes the other way: ask for the result in a file you can read rather than on a screen you have to scroll.",
    `You have no memory of your own here beyond this conversation. What is worth keeping belongs in a file — on the host it is about, or on ${host} if it is about the fleet — where the next conversation can read it.`,
  ]);
