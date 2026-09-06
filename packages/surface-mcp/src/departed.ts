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

/** The sentence a departed sibling's name earns — the same one
 *  `SurfaceSiblingDropped` gives a caller on the wire, in this face's vocabulary.
 *
 *  Told apart from "you got the name wrong" on purpose: an agent holding a tool
 *  list from before a reroster has made a reasonable call against a name that WAS
 *  real, and "unknown" tells it to doubt itself instead of to re-read the list. */
function droppedNote(sibling: string): string {
  return `the sibling "${sibling}" was dropped from this rooted bundle — re-read the list`;
}

/** The endpoint's tombstones: tool names in one table, resource addresses in the
 *  other, each pointing at the sibling key that went away with it.
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

  /** Remember what a roster move RETIRED, and forget what it brought back.
   *
   *  Ownership is read off the outgoing generation's own entries — a tool's
   *  `sibling`, a resource's `sibling` — rather than guessed out of a name, which
   *  is the only reading that works for an authored tool name and the only one
   *  that cannot mistake a stranger for a former tenant.
   *
   *  Two clearing rules, and both are needed. What the NEW roster serves is not
   *  departed, obviously. And so is everything belonging to a sibling that came
   *  BACK: a sibling that returns exposing less would otherwise leave its old
   *  members reported as "the sibling was dropped" while the sibling is standing
   *  right there — true of the member, and false of the sentence. Those fall
   *  through to plain "unknown", which is what they are. */
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
    for (const [name, owner] of [...this.tools]) {
      const served = next.toolByName.has(name) || next.bespoke.has(name);
      if (served || next.siblings.has(owner)) this.tools.delete(name);
    }
    for (const [uri, owner] of [...this.resources]) {
      if (next.byUri.has(uri) || next.siblings.has(owner)) {
        this.resources.delete(uri);
      }
    }
  }

  toolMessage(name: string): string {
    const owner = this.tools.get(name);
    return owner === undefined
      ? `unknown tool "${name}"`
      : `tool "${name}" is no longer served — ${droppedNote(owner)}`;
  }

  resourceMessage(uri: string): string {
    const owner = this.ownerOfUri(uri);
    return owner === undefined
      ? `unknown resource "${uri}"`
      : `resource "${uri}" is no longer served — ${droppedNote(owner)}`;
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
