import type {
  RecentAgent,
  RecentRepo,
  SavedSession,
} from "@kolu/padi-client/surface";
import type { Subscription } from "@kolu/surface/solid";
import type { TerminalId } from "kolu-common/surface";
import { activeScope } from "./hostScopes.ts";
import { windowedSub } from "./windowedSub.ts";

export const recentRepos = (): readonly RecentRepo[] =>
  activeScope()?.wire.activityFeed.value()?.recentRepos ?? [];
export const recentAgents = (): readonly RecentAgent[] =>
  activeScope()?.wire.activityFeed.value()?.recentAgents ?? [];

export const savedSession = (): SavedSession | null =>
  activeScope()?.wire.session.value() ?? null;

export const savedSessionSub: Subscription<SavedSession | null> = windowedSub(
  () => activeScope()?.wire.session.sub,
  (v) => v,
  null,
);

export const terminalListSub: Subscription<{ id: TerminalId }[]> = windowedSub(
  () => activeScope()?.wire.terminalKeys,
  (ids) => ids.map((id) => ({ id })),
  undefined,
);
