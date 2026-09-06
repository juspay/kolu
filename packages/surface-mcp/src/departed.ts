/**
 * WHAT this endpoint has served and no longer does, and WHO owned it — the
 * RETIREMENT POLICY, as a value with a name.
 *
 * ## Why this is a module
 *
 * "What a departed name is remembered as, how ownership is established, when a
 * tombstone is cleared, and how long one lives" is an axis of its own, distinct
 * from serving — and it has already moved twice (ownership recorded on the entry
 * rather than parsed out of the name; clearing on a sibling's return). It used to
 * be two bare `Map`s inside a 600-line closure, with four module-level functions
 * taking those maps as parameters and mutating them, which is the tell that a
 * value wants a name. The two maps are also only ever written together and only
 * ever read as a pair: they are one fact about one roster move.
 *
 * ## The retention rule, stated
 *
 * UNBOUNDED BY DESIGN. An entry is added when its owner leaves and removed when
 * the new roster serves the name again or its owner comes back — nothing expires
 * on a clock. A long-lived endpoint whose roster churns through distinct keys —
 * the exact use case `reroster` exists for — therefore accumulates one entry per
 * member per key ever seen.
 *
 * That is the intended trade, not an oversight: an agent can hold a `tools/list`
 * from several rosters ago, and the whole point of a tombstone is to tell it "this
 * went away" instead of "you got the name wrong". A time- or size-bounded table
 * would answer correctly for a while and then start lying, silently, to exactly
 * the caller the table exists for. The entries are two short strings each; the
 * roster key set of a real host is small and repeats.
 */

import type { ResolvedBundle } from "./bundle";
import { collectionUri, parseCollectionItem } from "./expose";
import type { SiblingKey } from "@kolu/surface/client";

/** The sentence a retired name earns, in the ONE reading that is true of it.
 *
 *  Two facts, not one, and conflating them is what made this table lose entries.
 *  A name stops being served for two different reasons: its sibling LEFT, or its
 *  sibling is standing and no longer EXPOSES it. Both are "this was real and is
 *  not now" — which is the thing an agent holding an older `tools/list` needs to
 *  hear instead of "you got the name wrong" — and they differ only in what the
 *  caller should do next, so they differ only in the sentence. */
function retiredNote(sibling: string, present: boolean): string {
  return present
    ? `the sibling "${sibling}" no longer exposes it — re-read the list`
    : `the sibling "${sibling}" was dropped from this rooted bundle — re-read the list`;
}

/** The endpoint's tombstones: tool names in one table, resource addresses in the
 *  other, each pointing at the sibling key it was retired with.
 *
 *  Ownership is RECORDED, never derived. A DERIVED name carries its owner's
 *  segment and could in principle be read back out of it, but an AUTHORED tool
 *  name never did — it is the author's word, with nothing in it about which
 *  sibling declared it — so ownership has to be remembered at the moment it is
 *  lost. Reading a leading `<key>_` also answered wrongly for a name that merely
 *  BEGINS with a departed key's word: an unknown tool `outlines_typo` was reported
 *  as "no longer served" by a bundle that had never served it. */
export class DepartedNames {
  private readonly tools = new Map<string, string>();
  private readonly resources = new Map<string, string>();
  /** The sibling keys the CURRENT roster serves, so a tombstone can say which of
   *  the two retirements it is without a second writer deciding. Written by the
   *  same call that writes the tables, from the same generation, because "what is
   *  standing now" and "what stopped being served just now" are one fact about
   *  one move. */
  private standing: ReadonlySet<string> = new Set();

  /** Remember what a roster move RETIRED, and forget what it brought back.
   *
   *  Ownership is read off the outgoing generation's own entries — a tool's
   *  `sibling`, a resource's `sibling` — rather than guessed out of a name, which
   *  is the only reading that works for an authored tool name and the only one
   *  that cannot mistake a stranger for a former tenant.
   *
   *  ONE clearing rule: what the NEW roster SERVES is not retired. That is the
   *  whole of it, and the second rule this used to carry — "clear everything
   *  belonging to a sibling that came back" — was a defect with a repro
   *  (juspay/olai#546).
   *
   *  It was written to stop a false sentence: a sibling that returns exposing
   *  LESS would have its old members reported as "the sibling was dropped" while
   *  the sibling is standing right there. True of the member, false of the
   *  sentence. But deleting the entry answers a wrong sentence with NO sentence,
   *  and it does so DESTRUCTIVELY — the next move records from a generation that
   *  no longer serves the name, so nothing can ever put the tombstone back. A row
   *  that unloads in two steps (members, then zero members, then gone) therefore
   *  lost every name it had ever served, permanently, and answered "unknown tool"
   *  for names an agent had seen in a `tools/list` minutes earlier. A roster that
   *  carries a present-but-empty row is not exotic: it is what a host hands over
   *  while a plugin is shutting down, and olai's own log shows one (`chat:0`).
   *
   *  The fix is to say the true sentence rather than to forget the fact:
   *  {@link retiredNote} reads {@link standing} and tells "dropped" from "no
   *  longer exposes it". A tombstone now outlives its sibling's return, which is
   *  exactly what makes it survive the return's departure. */
  record(previous: ResolvedBundle, next: ResolvedBundle): void {
    const own = (
      map: Map<string, string>,
      key: string,
      owner: SiblingKey,
    ): void => {
      // Only a SIBLING's entry can ever be departed — the core does not move.
      if (owner !== undefined) map.set(key, owner);
    };
    for (const tool of previous.tools) own(this.tools, tool.name, tool.sibling);
    for (const [name, entry] of previous.bespoke) {
      own(this.tools, name, entry.sibling);
    }
    for (const r of previous.resources) own(this.resources, r.uri, r.sibling);
    // Then subtract, over the WHOLE table rather than only what this move touched
    // — an entry retired three rosters ago is cleared by the move that brings its
    // sibling back, and by nothing else.
    for (const name of [...this.tools.keys()]) {
      if (next.toolByName.has(name) || next.bespoke.has(name)) {
        this.tools.delete(name);
      }
    }
    for (const uri of [...this.resources.keys()]) {
      if (next.byUri.has(uri)) this.resources.delete(uri);
    }
    this.standing = next.siblings;
  }

  toolMessage(name: string): string {
    const owner = this.tools.get(name);
    return owner === undefined
      ? `unknown tool "${name}"`
      : `tool "${name}" is no longer served — ${retiredNote(owner, this.standing.has(owner))}`;
  }

  resourceMessage(uri: string): string {
    const owner = this.ownerOfUri(uri);
    return owner === undefined
      ? `unknown resource "${uri}"`
      : `resource "${uri}" is no longer served — ${retiredNote(owner, this.standing.has(owner))}`;
  }

  /** Which departed sibling a resource URI belonged to, if any.
   *
   *  A static resource is looked up by its whole address. A collection ITEM is not
   *  in the table — it is a template instance, never a listed resource — so it is
   *  answered through its COLLECTION's address, which is: the same
   *  `(sibling, key)` pair, composed by the same builder that minted it. */
  private ownerOfUri(uri: string): string | undefined {
    const direct = this.resources.get(uri);
    if (direct !== undefined) return direct;
    const item = parseCollectionItem(uri);
    if (item === null) return undefined;
    return this.resources.get(collectionUri(item.sibling, item.key));
  }
}
