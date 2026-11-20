import type {
  ConductorReadingLevel,
  ConductorWakeEvent,
  ConductorWakeLevel,
} from "kolu-common/conductor";

const NAMED_LIMIT = 3;

export const LEVEL_WORD: Record<
  ConductorReadingLevel | ConductorWakeLevel,
  string
> = {
  working: "working",
  shell: "no agent",
  stopped: "stopped",
  asking: "asking",
  gone: "gone",
  ready: "is up",
  starting: "starting",
  fresh: "ready",
  asleep: "asleep",
  ended: "ended without an agent",
  exited: "exited",
  "taken-over": "taken over by you",
  "handed-back": "handed back to the agent",
};

export function wakeHeadline(events: readonly ConductorWakeEvent[]): string {
  if (events.length === 0) return "a watched terminal rang";
  const named = events
    .slice(0, NAMED_LIMIT)
    .map((event) => `${event.name} ${LEVEL_WORD[event.level]}`);
  const rest = events.length - named.length;
  return rest > 0 ? `${named.join(" · ")} · +${rest} more` : named.join(" · ");
}

export function wakeWhen(since: string): string | null {
  const at = Date.parse(since);
  if (Number.isNaN(at)) return null;
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
