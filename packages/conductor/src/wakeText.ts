/**
 * WHAT THE AGENT IS ACTUALLY HANDED when kolu wakes it — the whole account, in
 * one message.
 *
 * A wake is a turn kolu starts, so these words are the entire input the model
 * gets: the transcript row beside them is for a PERSON, and the agent is
 * reading a conversation rebuilt from its own store, which carries the words
 * and not the row's mark. So the account opens by saying WHO IS SPEAKING —
 * `[kolu]`, the same mark the standing prompt and a message's terminal
 * references wear — and then says, per terminal, everything an agent needs to
 * decide what to do without asking a question first: its `host/id` (the name
 * every tool takes), what it is called, which machine it is on, which agent is
 * in it, and how it stands.
 *
 * AND WHAT TO DO ABOUT IT, because the one thing that must not happen here is
 * the Conductor going back to sleep on a terminal that needs it. The closing
 * lines name the three verbs that answer a wake — read the screen, say
 * something to the agent, stop watching — and then say the rule the whole
 * design rests on: END THE TURN. kolu rings again when something else happens.
 *
 * PURE, and its own file, so what the agent reads is a string a test can
 * compare rather than something only reachable by waking a real conversation.
 */

import type { ConductorWakeEvent } from "kolu-common/conductor";

/** How each level reads in the account — a whole clause, because what the
 *  agent has to decide from is the SITUATION and not a one-word enum it has to
 *  interpret. */
const STANDS: Readonly<Record<ConductorWakeEvent["level"], string>> = {
  stopped: "its agent STOPPED — the turn ended and the output went quiet",
  asking: "its agent is ASKING someone — it is waiting on an answer",
  gone: "the terminal is GONE — it left its host while that host was answering",
  ready:
    "its agent is UP and has not been told anything yet — this is the moment to brief it",
  asleep:
    "the terminal was PUT TO SLEEP — the agent in it is gone with it, and whatever it was doing stopped there",
  ended:
    "the command it was started with ENDED — it is back at a shell prompt and no agent was ever seen in it, so the agent you asked for never came up",
};

/** One terminal's line. The ref comes first because it is what every tool
 *  takes; the prose after it is what a person would say about the same thing.
 *  An EMPTY agent is the `ended` case — no agent was ever in it — and the line
 *  says so rather than naming one that never existed. */
const lineOf = (event: ConductorWakeEvent): string =>
  `- ${event.ref} — “${event.name}” on ${event.hostName}, ${event.agent === "" ? "no agent in it" : `running ${event.agent}`}: ${STANDS[event.level]} (seen ${event.at}).`;

/**
 * The account, for one wake carrying one or more terminals.
 *
 * Several terminals arrive together whenever they rang while a turn was
 * running ({@link ./held.ts}), and they are one message rather than several
 * turns on purpose: the Conductor should see everything that happened while it
 * was busy at once, and decide about all of it in one pass.
 */
export const wakeText = (events: ReadonlyArray<ConductorWakeEvent>): string => {
  const subject =
    events.length === 1
      ? "a terminal you are watching needs you"
      : `${events.length} terminals you are watching need you`;
  return [
    `[kolu] I am waking you: ${subject}. You did not ask for this turn — kolu started it.`,
    events.map(lineOf).join("\n"),
    "Look before you act: `screen_text` reads a terminal's screen. To brief, answer or redirect the agent in one, use `agent_say` — kolu does the keystrokes that agent needs, idle or working; a terminal that is READY is one waiting for exactly that. Use `unwatch_terminal` when a terminal's work is done, and `watch_terminal` for one you want to hear about.",
    "Then END YOUR TURN. Do not wait on anything: kolu wakes you again the moment a watched terminal's agent comes up, stops, asks, sleeps, ends or goes away.",
  ].join("\n\n");
};
