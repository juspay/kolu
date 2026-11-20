export function pruneToMembers<K, V>(
  cache: Map<K, V>,
  isMember: (host: K) => boolean,
  onEvict: (evicted: V) => void,
): void {
  for (const [host, evicted] of [...cache]) {
    if (!isMember(host)) {
      cache.delete(host);
      onEvict(evicted);
    }
  }
}
