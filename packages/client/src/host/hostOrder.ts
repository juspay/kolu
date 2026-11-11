/** hostOrder — the user's host-tab arrangement as an OVERLAY on pool
 *  membership, and the drag verb that rewrites it.
 *
 *  The stored order (the `hostOrder` preference — CANONICAL encoded keys, see
 *  `encodeHostKey`) is NEVER a second membership authority. Pool membership
 *  (`padiMap.entries`) decides WHO is in the list; this module decides only
 *  WHERE each member sits:
 *
 *    · the LOCAL host is pinned first — it is the pool's unremovable default and
 *      the always-available escape hatch, so it is not draggable and nothing can
 *      land before it (it is therefore never stored either, the same rule
 *      `PersistedHostsSchema` applies to the persisted fleet);
 *    · members named by the stored order follow, in that order;
 *    · a member the stored order does not name sorts AFTER them, in pool order —
 *      so a newly added host lands at the end rather than jumping the queue;
 *    · a stored key that is no longer a member is ignored — a removed host
 *      leaves no hole, and re-adding it later just puts it back where it was.
 *
 *  Pure and wire-free on purpose: the one place the arrangement rule lives, and
 *  the one place it is tested (`hostOrder.test.ts`). */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";

/** The pool's members in the user's arrangement — the ONE ordered host list
 *  every surface that LISTS hosts renders off (the chip strip, the "⋯ +N"
 *  overflow menu, the narrow dropdown switcher, the phone host row, and the
 *  palette's Hosts rows). */
export function orderHostKeys(
  members: readonly HostKey[],
  stored: readonly string[],
): HostKey[] {
  const byKey = new Map(members.map((h) => [encodeHostKey(h), h]));
  const local = members.filter((h) => h.kind === "local");
  const placed = new Set(local.map(encodeHostKey));

  const arranged: HostKey[] = [];
  for (const key of stored) {
    const member = byKey.get(key);
    // Not a member (removed, or never one) → ignored; already placed (local, or
    // a duplicate key in a hand-edited store) → never listed twice.
    if (member === undefined || placed.has(key)) continue;
    placed.add(key);
    arranged.push(member);
  }

  const rest = members.filter((h) => !placed.has(encodeHostKey(h)));
  return [...local, ...arranged, ...rest];
}

/** The re-orderable keys of an arranged list — every member except the pinned
 *  local host, encoded. What a drag permutes and what gets stored. */
export function reorderableHostKeys(ordered: readonly HostKey[]): string[] {
  return ordered.filter((h) => h.kind !== "local").map(encodeHostKey);
}

/** THE drop verb: move host `from` onto host `to`'s slot in the arrangement,
 *  answering the NEXT stored order.
 *
 *  `keys` is the WHOLE re-orderable list (`reorderableHostKeys` over the
 *  arranged members), not just the chips the strip could seat — so a host
 *  folded into the "⋯ +N" overflow keeps its relative slot through a drag it
 *  took no part in. An unknown id (a drop whose host left the pool mid-gesture)
 *  returns the list unchanged: the gesture is a no-op, never a rewrite. */
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
