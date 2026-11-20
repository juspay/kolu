import { encodeHostKey, type HostKey, LOCAL_HOST } from "kolu-common/hostKey";

const PINNED_KEY: string = encodeHostKey(LOCAL_HOST);

export function isPinnedHostKey(key: string): boolean {
  return key === PINNED_KEY;
}

export function orderHostKeys(
  members: readonly HostKey[],
  stored: readonly string[],
): HostKey[] {
  const byKey = new Map(members.map((h) => [encodeHostKey(h), h]));
  const pinned = members.filter((h) => isPinnedHostKey(encodeHostKey(h)));
  const placed = new Set(pinned.map(encodeHostKey));

  const arranged: HostKey[] = [];
  for (const key of stored) {
    const member = byKey.get(key);
    if (member === undefined || placed.has(key)) continue;
    placed.add(key);
    arranged.push(member);
  }

  const rest = members.filter((h) => !placed.has(encodeHostKey(h)));
  return [...pinned, ...arranged, ...rest];
}

export function reorderableHostKeys(ordered: readonly HostKey[]): string[] {
  return ordered.map(encodeHostKey).filter((key) => !isPinnedHostKey(key));
}

export function moveHostKey(
  keys: readonly string[],
  from: string,
  to: string,
): string[] {
  const i = keys.indexOf(from);
  const j = keys.indexOf(to);
  if (i === -1 || j === -1) return keys.slice();
  const next = keys.slice();
  const [moved] = next.splice(i, 1);
  next.splice(j, 0, moved as string);
  return next;
}
