import { Result, Schema } from "effect";
import {
  encodeHostKey,
  LOCAL_HOST,
  PersistedHostsSchema,
} from "kolu-common/hostKey";
import { store } from "./state.ts";

const LOCAL_KEY = encodeHostKey(LOCAL_HOST);

const decodePersistedHosts = Schema.decodeUnknownResult(PersistedHostsSchema);

export function getPersistedHosts(): readonly string[] {
  const result = decodePersistedHosts(store.get("hosts"));
  if (Result.isFailure(result)) {
    throw new Error(
      `persisted hosts in ${store.path} do not match schema (${String(result.failure)}). Fix the \`hosts\` key to recover.`,
    );
  }
  return result.success;
}

export async function savePoolMembership(
  members: readonly string[],
  declarativeSeedKeys: ReadonlySet<string>,
): Promise<void> {
  store.set(
    "hosts",
    members.filter((h) => h !== LOCAL_KEY && !declarativeSeedKeys.has(h)),
  );
}
