/**
 * `connectSurfaces` — the turnkey client seam for MULTIPLE sibling surfaces over
 * ONE reconnecting wire, with the liveness watchdog wired in by default.
 *
 * The multi-surface counterpart to `connectSurface`: where that builds one
 * `surfaceClient` over one wire, this builds a `surfaceClients` BUNDLE (drishti's
 * control plane multiplexes `admin` + `surfaceApp` over a single transport) and
 * wires the SAME default-on watchdog — one wire, one `createLiveSignal` (which
 * derives the transport status, wires the half-open heartbeat probing the
 * framework-reserved `system/live` member at the tag the ROOTED BUNDLE paragraph
 * below settles — the root's bare one when a `core` rides this wire, the first
 * sibling's scoped one when none does — AND mints the branded `live`). So a multi-surface app gets half-open detection BY CONSTRUCTION,
 * exactly like a single-surface one — instead of hand-rolling `createSurfaceSocket`
 * → `surfaceClients` and (the step the hand-built path forgot) a watchdog. The
 * combined fact folds via {@link surfaceClientsHealth}, and the per-sibling
 * `{ live }` is threaded from the one wire's status so the AND-reduce flips on a
 * dead transport.
 *
 * There is NO `heartbeat: false` opt-out here: this seam mints the watchdog-backed
 * brand, so disabling its watchdog would mint a branded-but-blind signal. When the
 * same wire carries a SECOND consumer (drishti's admin wire also drives a
 * `<SurfaceAppProvider>` lifecycle), the watchdog lives HERE (one wire, one
 * watchdog, one honest brand) and the lifecycle — which mints no brand — opts ITS
 * own watchdog out (`heartbeat: false` on `createServerLifecycle` / the provider).
 *
 * THE ROOTED BUNDLE. A composed wire may also carry an unprefixed ROOT surface
 * beside the siblings — "core plus tenants" — through the `core` slot. It is a
 * slot on THIS seam rather than a second `connectRootedSurfaces`, because a root is
 * data about one wire, not a second kind of wire: present, the root gets its own
 * typed client, joins the health fold under the caller's word, and becomes what the
 * two reserved round-trips address (its bare `surface/system/*` tags — the path
 * `createSurfaceSocket` and `createLiveSignal` already implement by omitting
 * `siblingKey`); absent, every line below behaves exactly as it did, and the old
 * empty-map refusal shrinks to "nothing at all was passed". A consumer whose floor
 * is unprefixed had to rebuild this whole seam by hand to have one
 * (`createSurfaceSocket` → `createLiveSignal` → `surfaceClients` →
 * `surfaceClientsHealth` → `createSurfaceReadout`, the watchdog included — the step
 * the turnkey seams exist to stop an app forgetting); it can now delete the
 * assembly and call this.
 *
 * ASYNC (PLAN D5), like `connectSurface`: the dial is an effect.
 */

import {
  composeSurfaceContracts,
  isStandaloneRoot,
  mergeDisjointGroups,
  notStandaloneRootDetail,
  type Surface,
  type SurfaceSpec,
} from "@kolu/surface/define";
import type { WebsocketLink } from "@kolu/surface/links/websocket";
import {
  createLiveSignal,
  createSurfaceReadout,
  type HeartbeatTuning,
  type LiveSignalHandle,
  type OnClientError,
  type SurfaceClient,
  type SurfaceClients,
  type SurfaceHealth,
  type SurfaceReadout,
  surfaceClient,
  surfaceClients,
  surfaceClientsHealth,
} from "@kolu/surface/solid";
import type { RpcGroup } from "effect/unstable/rpc";
import { type Accessor, createSignal } from "solid-js";
import { createSurfaceSocket, type SurfaceSocketOptions } from "../connect";
import { defaultSurfaceUrl } from "../defaultSurfaceUrl";
import { trackConnectAllocations } from "../connectAllocations";

/** The ROOT SLOT of a rooted bundle: the unprefixed root surface, plus the WORD it
 *  answers to in the health fold and the readout.
 *
 *  Named once and referenced everywhere the shape appears — the option, the rooted
 *  overload's `& { core: … }`, and the seam's own resolution — because three
 *  hand-written spellings of one shape are three things to keep equal, and the
 *  fourth arrives the moment anyone wants to name the argument's type.
 *
 *  `surface` must be a STANDALONE surface (`defineSurface`'s own `surface/` prefix).
 *  A sibling-scoped surface is refused: the client face is built against standalone
 *  tags, so a scoped root would dial `surface/<member>/<verb>` at a wire that serves
 *  `surface/<key>/…` and every call would 404 at the far end with nothing having
 *  said so.
 *
 *  `name` is the role a sibling's key plays in the fold (`surfaceApp/buildInfo`),
 *  which the root has no key to supply. It is app policy, so it crosses as an
 *  argument (the class the required `retired` handler belongs to) rather than being
 *  invented here: the framework has no name for an app's own floor. Must not be one
 *  of the sibling keys — two clients folded under one word would drop one of them in
 *  silence.
 *
 *  It is a LABEL, not a tag segment: the root's members keep their bare tags, so
 *  unlike a sibling key this word never reaches the wire and is not held to
 *  `assertTagSegment`'s grammar. An app may call its floor whatever its readout
 *  should say — as long as the readout can say it, which is the one thing
 *  {@link resolveRoot} holds it to. */
// biome-ignore lint/suspicious/noExplicitAny: the root surface pins its own spec.
interface SurfaceRoot<C extends Surface<any>> {
  readonly surface: C;
  readonly name: string;
}

/** What a SUPERSEDED or DISPOSED connection's health fact reads: not live, and
 *  naming nothing — there are no subscriptions on a wire that is closed, and a
 *  disposed registry's last fold is not a fact about anything. Frozen and shared:
 *  it is a constant, not per-connection state. */
const goneHealth: SurfaceHealth = Object.freeze({
  live: false,
  subs: Object.freeze([]),
});

export interface ConnectSurfacesOptions<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces, each pinning its own spec.
  E extends Record<string, Surface<any>>,
  // The unprefixed ROOT surface, when this wire carries one. `undefined` — the
  // default, inferred whenever `core` is omitted — is a siblings-only wire, which
  // is every caller that existed before the slot did.
  // biome-ignore lint/suspicious/noExplicitAny: the root surface pins its own spec.
  C extends Surface<any> | undefined = undefined,
  // The reserved probes' target is DERIVED here, never passed: this seam is the one
  // that knows the whole wire. With a `core` it is the root's BARE reserved tags;
  // without one, the first sibling's.
> extends Omit<SurfaceSocketOptions, "group" | "siblingKey" | "url"> {
  /** Base WS URL — a string, or a thunk re-evaluated on every reconnect when the
   *  base itself varies (the `pid` echo is appended on top either way; see
   *  `SurfaceSocketOptions.url`).
   *
   *  OPTIONAL, exactly as on `connectSurface`: omitted, it defaults to
   *  `surfaceWsUrl(location.origin)` — the page's own origin through the ONE
   *  scheme-swap + path derivation. A browser app dials the origin that served it,
   *  which is not a choice, so every browser consumer that spelled this by hand
   *  spelled the same line. It was required here and defaulted on the singular twin
   *  for no reason either seam could name; a consumer collapsing a hand-built wire
   *  onto this one found it as the last residue that survived an otherwise complete
   *  collapse (juspay/kolu#2222).
   *
   *  Omitting it anywhere without a `location` — a Node caller, a test, an SSR pass
   *  — throws loudly rather than dialling a fabricated address, and throws BEFORE
   *  anything is allocated. */
  url?: SurfaceSocketOptions["url"];
  /** The sibling surfaces to build a client bundle for — the same map
   *  `surfaceClients` takes (`{ admin: adminSurface, surfaceApp: appSurface }`).
   *  Each becomes a scoped client at the tags `surface/<key>/<member>/<verb>`.
   *  The combined `RpcGroup` the wire is built over is derived from them here
   *  (`composeSurfaceContracts`), so the wire and the clients can never disagree
   *  about which members exist.
   *
   *  MAY BE EMPTY when {@link ConnectSurfacesOptions.core} is present — a wire
   *  that carries only its root is an ordinary wire (an app whose sibling map is
   *  built from a roster that happens to be empty this run). What is refused is
   *  a call that passes NOTHING: no root and no siblings is not a wire. */
  surfaces: E;
  /** The unprefixed ROOT surface this wire carries BESIDE the siblings — the
   *  `core` half of "core plus tenants". A composed wire's siblings are tagged
   *  `surface/<key>/<member>/<verb>`; the root's members keep the bare
   *  `surface/<member>/<verb>`, which is the tag shape every STANDALONE surface
   *  has and the one `defineSurface` mints.
   *
   *  Present, the root is first-class in all three ways a sibling is:
   *
   *    - its members join the ONE dialled group (through the same counted merge
   *      `extraGroups` rides, so a root/sibling/extra collision is a boot crash
   *      rather than a tag that answers the wrong schema);
   *    - it gets a typed `surfaceClient` of its own, handed back as
   *      {@link SurfacesConnection.core};
   *    - it joins the health fold — and therefore the readout — under `core.name`,
   *      so a stopped root subscription is named like any sibling's.
   *
   *  And the two reserved round-trips (the `system/identity` echo and the
   *  `system/live` watchdog) address the root's BARE reserved tags instead of a
   *  sibling's, which is the path `createSurfaceSocket` and `createLiveSignal`
   *  already implement for a single-surface wire (omit `siblingKey`). The root is
   *  on every serve this wire can reach — that is what makes it the root — so it
   *  is the one probe target a wire whose SIBLING set varies per serve can trust.
   *
   *  Absent — every caller before this slot existed — the wire is siblings-only
   *  and behaves exactly as it did: the probes address the first sibling's tags.
   *
   *  NOT the same thing as {@link ConnectSurfacesOptions.extraGroups}. A root
   *  SURFACE is a `Surface` and gets everything a surface gets; `extraGroups`
   *  carries tags that are not a surface at all (a keyed map's group, a host's
   *  hand-written root procedures) and are dialled raw over `conn.transport`. A
   *  consumer can pass both, and kolu does. */
  // biome-ignore lint/suspicious/noExplicitAny: the same bound `C` carries — the root surface pins its own spec. The conditional is what keeps a rootless wire's `core` honestly `undefined` rather than a fillable `{ surface: undefined }`.
  core?: C extends Surface<any> ? SurfaceRoot<C> : undefined;
  /** Groups MULTIPLEXED on the same wire that are not sibling `Surface`s — the tags a
   *  consumer dials over `conn.transport` rather than through `clients.<key>`:
   *
   *   - a keyed `SurfaceMap`'s group, for the documented
   *     `connectSurfaceMap(map, conn.transport)` composition (kolu's padi host map);
   *   - a host's HAND-WRITTEN root procedures (kolu's `server/*`, `daemon/*`,
   *     `hosts/*`), reached through `conn.transport.dispatch`.
   *
   *  They belong here because the wire's `RpcGroup` is what carries every tag's
   *  payload/success SCHEMAS: Effect RPC's flat client looks a call's tag up in the
   *  group it was built over, so a tag the group never minted cannot be dispatched at
   *  all. Deriving the group from `surfaces` ALONE therefore made the two documented
   *  multiplexing paths above unspellable — the wire connected, and every call over it
   *  died. This option is what keeps "the wire serves exactly the tags this connection
   *  can dial" true for a consumer that multiplexes.
   *
   *  Each group must be DISJOINT from the root, from the composed siblings and from
   *  every other extra group: `RpcGroup.merge` is a last-writer-wins `Map.set` with
   *  no collision detection, so a collision would silently drop one spelling of a
   *  shared tag. The merge below is `mergeDisjointGroups`, which claims every half's
   *  tags before merging and throws naming the tag AND the two halves that claimed
   *  it.
   *
   *  The element union is left OPEN, and the erasure is THIS seam's rather than its
   *  callers': `RpcGroup<in out Rpcs>` is invariant, so a precisely-typed group — a
   *  host's root procedures, spelled member by member — is not assignable to
   *  `RpcGroup<Rpc.Any>` even though every element IS an `Rpc.Any`. Demanding the
   *  erased shape here would make the `as unknown as` double-cast the standard idiom
   *  at this option's own call sites, which is a poor thing for the door onto a
   *  safety proof to teach — and it is exactly the law `mergeDisjointGroups`, which
   *  this value flows straight into, adopted for itself. */
  // biome-ignore lint/suspicious/noExplicitAny: the erasure is this seam's, not its callers' — see the paragraph above.
  extraGroups?: ReadonlyArray<RpcGroup.RpcGroup<any>>;
  /** TUNE the always-on liveness heartbeat (`intervalMs`/`timeoutMs`/`onStale`) —
   *  the same knob `connectSurface` accepts. There is deliberately NO disable
   *  option: this seam mints the watchdog-backed brand, and a disabled watchdog
   *  would mint a branded-but-blind signal (the forbidden override knob). When
   *  another layer owns the wire's lifecycle (drishti's admin wire, watched by
   *  `<SurfaceAppProvider>`'s `createServerLifecycle`), THAT layer opts its
   *  watchdog out (`heartbeat: false` on the lifecycle, which mints no brand) — so
   *  this seam stays the single watchdog and the single, honest brand. */
  heartbeat?: HeartbeatTuning;
  /** The app's ORIGIN-FREE client error interpreter — threaded to EVERY sibling
   *  client so a spec-declared `client.onError` policy (a surface built via
   *  `defineSurfaceWithPolicy`) reaches app code on a subscription failure. The app
   *  spells ONE interpreter HERE (design §A/m4); `surfaceClients` forwards it to each
   *  `buildSurfaceClient`.
   *
   *  OPTIONAL at the type: a policy-FREE surface bundle (`TPolicy = never`, the
   *  existing callers) declares no `client.onError`, so it needs none. When a sibling
   *  DOES carry a policy, `buildSurfaceClient` THROWS at construction if this was
   *  omitted (design §D / F5) — a declared policy can never route nowhere. */
  onClientError?: OnClientError;
}

/** A live multi-surface connection: the shared wire, the per-key client bundle,
 *  the branded transport handle (for framework composition), the reactive
 *  `readout` (the wire's state folded with every sibling's subscription health),
 *  the COMBINED health fact across every sibling, and a `dispose` that stops the
 *  heartbeat, tears down every client's standing subscriptions, and closes the
 *  wire.
 *
 *  No `echo`: the socket feeds its own `pid` handshake (see `../connect`), so there
 *  is no longer a returned value whose omission silently kills it. */
export interface SurfacesConnection<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces.
  E extends Record<string, Surface<any>>,
  // biome-ignore lint/suspicious/noExplicitAny: the root surface pins its own spec.
  C extends Surface<any> | undefined = undefined,
> {
  /** The wire this bundle rides — `{ dispatch, wire, dispose }`. (Was
   *  `ws: PartySocket`.) */
  link: WebsocketLink;
  /** One scoped `surfaceClient` per sibling surface (the `surfaceClients` shape).
   *  Reach a sibling's primitives through `clients.<key>` and its reserved members
   *  through `clients.<key>.rpc` (the tag-scoped face).
   *
   *  It carries the SIBLINGS ONLY — a rooted wire's root client is
   *  {@link SurfacesConnection.core}, deliberately beside rather than inside, so a
   *  sibling key and a root word cannot be confused and so the root's different tag
   *  shape is not lied about. So do NOT hand-fold this record:
   *  `surfaceClientsHealth(conn.clients)` is a spellable line (the function is a
   *  public export) that on a rooted wire returns a fact GREEN OVER A DEAD ROOT, and
   *  the same under-coverage reaches any consumer walking `Object.values(clients)`
   *  for a cross-client operation. {@link SurfacesConnection.health} and
   *  {@link SurfacesConnection.readout} fold the root in, and `dispose` tears it
   *  down; use those. */
  clients: SurfaceClients<E>;
  /** The ROOT surface's own `surfaceClient` — present exactly when
   *  {@link ConnectSurfacesOptions.core} was passed, and typed as `undefined` when
   *  it was not, so a siblings-only caller reads no optional it has to check.
   *
   *  It is an ordinary client over the ordinary combined dispatch: the root's tags
   *  are the bare `surface/<member>/<verb>`, so unlike a sibling's it needs no
   *  tag-scoping wrapper at all. Its health is already folded into
   *  {@link SurfacesConnection.health} and {@link SurfacesConnection.readout} under
   *  the caller's word; reach for the client itself to `.use()` the root's
   *  members. */
  core: C extends Surface<infer S> ? SurfaceClient<S> : undefined;
  /** The BRANDED transport handle `createLiveSignal` minted (dispatch + watchdog
   *  `live` + status, paired by construction). Exposed for FRAMEWORK COMPOSITION over
   *  a SIBLING of this combined wire: `connectSurfaceMap(map, conn.transport)` slices
   *  the sibling named by `map.name` from the handle and recovers THIS wire's watchdog
   *  `live` — so a keyed map dialled over the sibling floors its chips on the real
   *  transport, with NO raw-`{ live }` seam to forge. It is also the handle to reach
   *  the COMBINED dispatch (`conn.transport.dispatch`) for a consumer with root-level
   *  members multiplexed at the same wire. The handle is unforgeable (module-private
   *  brand), so exposing it invites no green-over-dead lie. */
  transport: LiveSignalHandle;
  /** The reactive READOUT (`@kolu/surface/solid`'s {@link SurfaceReadout}) —
   *  `connecting` / `live` / `degraded` / `reconnecting` / `retired`, the
   *  `needsReload` bit, and the NAMES of whatever stopped — folded from the shared
   *  wire's status AND the combined fact below, so `live` is a claim about what
   *  reaches the page rather than about a socket. Across siblings the names arrive
   *  already prefixed by surface key (`surfaceApp/buildInfo`) — and a root's by the
   *  word its `core.name` supplied — which is what makes a multi-surface degraded
   *  readout say WHICH surface went quiet.
   *
   *  It replaced a transport-only `status` beside a `health()` an app could
   *  forget to call. Memoized, so every indicator bound to it costs one fold. */
  readout: Accessor<SurfaceReadout>;
  /** The COMBINED health fact — `surfaceClientsHealth` over every sibling AND, when
   *  a `core` was passed, the root under {@link ConnectSurfacesOptions.core}'s
   *  `name` — folding their subs + the shared transport `live` (AND-reduced). Pass it straight
   *  to `<SurfaceGate health={conn.health}>` / `<HostStatusPip health={conn.health}>`.
   *
   *  Still the FACT, and still the gate's input: the gate's policy (pending blocks
   *  the body) is deliberately not the readout's (pending does not amber the
   *  light). Note it re-folds the whole registry per READ — bind
   *  {@link SurfacesConnection.readout} for an indicator; reach for the raw fact
   *  when a component wants the per-sub `pending`/`error` detail. */
  health: () => SurfaceHealth;
  /** Take a NEW SIBLING ROSTER by dialling a new wire — the honest answer to
   *  "this connection's surfaces changed", and the reason there is no `update`.
   *
   *  ## Why a roster change cannot be an in-place update
   *
   *  Effect RPC resolves a call's payload/success/error SCHEMAS by looking the
   *  tag up in the `RpcGroup` its client was built over, and this seam's group is
   *  built at the DIAL (`openWireLink` does `RpcClient.make(group, …)` once, over
   *  a protocol whose fibers live in the link's own scope). A sibling that joins
   *  the roster brings tags that group never minted, so no client built before it
   *  can dispatch them — and the far end has the same constraint, because each
   *  accepted socket builds its own `RpcServer` over the group it was handed at
   *  accept. A roster change is therefore a NEW WIRE at both ends. That is a fact
   *  about the transport, not a gap in this seam, so it is stated here rather
   *  than papered over with a method that would quietly rebuild everything and
   *  call itself an update.
   *
   *  What this door removes is the part that WAS a gap: hand-rolling the redial.
   *  It re-uses every option this connection was dialled with — the `url` (thunk
   *  included), the heartbeat tuning, `extraGroups`, `onClientError`, the socket
   *  options — so a consumer cannot drift them by re-spelling the call, which is
   *  the same failure `connectSurfaces` itself exists to stop (juspay/kolu#2222).
   *  And it owns the ORDER: the replacement is dialled FIRST and this connection
   *  released only once THAT DIAL HAS RESOLVED, so a failing dial leaves the
   *  working wire alone and rejects, rather than the obvious dispose-then-dial
   *  that leaves the caller with nothing. "Resolved" is this seam's own await and
   *  not an OPEN socket — `connectSurfaces` hands back a connection whose wire may
   *  still be connecting, exactly as a first dial does. What is guaranteed is that
   *  a dial which THROWS costs the caller nothing.
   *
   *  A `dispose()` landing while a redial is in flight is TERMINAL and wins: the
   *  replacement is released and this call rejects, rather than handing back a
   *  live wire the caller has already given up.
   *
   *  THE ROOT DOES NOT MOVE. Only the siblings are re-rostered: the root is the
   *  member on every serve this wire can reach, which is what makes it the
   *  reserved probes' target on a bundle whose sibling set varies (see
   *  {@link ConnectSurfacesOptions.core}) — and a `core` that could change would
   *  make this the very thing it is not, a second `connectSurfaces`. Dial a
   *  different root by calling `connectSurfaces` again.
   *
   *  EVERYTHING THIS CONNECTION HANDED OUT IS DEAD once it resolves — `clients`,
   *  `core`, `transport`, `readout`, `health` — and it SAYS SO rather than
   *  leaving that to the caller. `readout` reads `retired` and `health` reads
   *  not-live from the instant this call supersedes the connection, so an
   *  indicator still bound to the old accessor goes dark instead of freezing on
   *  whatever it last computed (which, on the common path — the roster moved,
   *  the wire was fine — is `live`: a permanent green light over a closed wire).
   *  A `connectSurfaceMap(map, conn.transport)` built over the old handle fails
   *  loudly on its next call (the link is disposed), never silently. Reading
   *  everything off the returned connection is still the right habit; it is no
   *  longer the thing standing between the page and a lie.
   *
   *  Refuses on a connection that has ALREADY been redialled or disposed: a
   *  second redial would dial a third wire while the caller still believes it
   *  holds one, which is the leak this seam's allocation tracking exists to
   *  prevent. */
  redial<
    // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces, as on the options.
    const E2 extends Record<string, Surface<any>>,
  >(surfaces: E2): Promise<SurfacesConnection<E2, C>>;
  /** Stop the heartbeat, dispose the standing subscriptions of every client in the
   *  fold — the siblings and, when a `core` rode this wire, the root — and release
   *  the wire. A page-lifetime cached bundle needn't call it. */
  dispose: () => Promise<void>;
}

/** The ROOT, resolved: the slot exactly as the caller passed it, once every refusal
 *  this seam owes a root has been made — or `undefined` for a siblings-only wire.
 *
 *  ONE decision, taken once, so the body below asks a VALUE whether there is a root
 *  rather than re-deciding it, and so a reader looking for "what does this door
 *  refuse about a root" finds all of it in one place instead of two-thirds of it. */
function resolveRoot(
  core: SurfaceRoot<Surface<SurfaceSpec>> | undefined,
  surfaces: Record<string, unknown>,
): SurfaceRoot<Surface<SurfaceSpec>> | undefined {
  if (core === undefined) return undefined;
  // A sibling-scoped surface as the root is the one miswiring nothing downstream
  // would catch: `surfaceClient` builds its face from the SPEC and mints
  // standalone tags whatever prefix the value carries, so a scoped root would
  // dial `surface/<member>/<verb>` over a wire that serves `surface/<key>/…`
  // and every call would die at the far end — after connecting cleanly.
  //
  // ONE LAW, THREE DOORS — and ONE READING of it. The identical refusal stands at
  // the serve side's two rooted doors: `implementRootedSurfaces` (`@kolu/surface`)
  // and the gate `exposeRootedFaces` (`@kolu/surface/expose`). A root is standalone
  // or it is not a root, and each door has to hold the rule for the app that
  // happens to use only that door. What the three sites now SHARE is the predicate
  // and the sentence (`@kolu/surface/define`, beside the tag prefix they are
  // about); what each keeps is its own ERROR CLASS and the alternative it can
  // offer. Three copies cross-citing each other was the shape the third copy
  // arrived without amending — a rule kept by discipline, and discipline is what
  // this replaces.
  if (!isStandaloneRoot(core.surface)) {
    throw new Error(
      notStandaloneRootDetail(
        "connectSurfaces",
        "`core.surface`",
        core.surface.tagPrefix,
        "make it a sibling in `surfaces`",
      ),
    );
  }
  // The health fold is keyed by word, so a root sharing a sibling's key would
  // put two clients under one name — and one of them would vanish from the fold
  // (and from the readout) with nothing said.
  if (Object.hasOwn(surfaces, core.name)) {
    throw new Error(
      `connectSurfaces: \`core.name\` is "${core.name}", which is also a sibling key — ` +
        "the health fold is keyed by that word, so one of the two clients would be " +
        "dropped from it in silence. Give the root a name no sibling has.",
    );
  }
  // The word is a LABEL and not a tag segment, so it is deliberately NOT held to
  // `assertTagSegment`'s grammar — but it has exactly one job, which is to be READ,
  // and two spellings cannot do it. `surfaceClientsHealth` prefixes every stopped
  // subscription as `<name>/<sub>`: an empty word reads as `/floor`, and one
  // carrying the separator (`a/b`) is indistinguishable from a sub of a sibling
  // named `a`. A degraded readout that names the wrong thing is worse than one that
  // names nothing, and naming is all this field does.
  if (core.name === "" || core.name.includes("/")) {
    throw new Error(
      `connectSurfaces: \`core.name\` is ${JSON.stringify(core.name)} — the word is ` +
        "what a degraded readout says the root is called, and it is prefixed onto every " +
        "stopped subscription as `<name>/<sub>`. It must be non-empty and carry no `/`.",
    );
  }
  return core;
}

/** The FIRST sibling's key — the reserved round-trips' target on a ROOTLESS wire.
 *  Every sibling carries the same three reserved `system/*` members and answers the
 *  same per-process id, so "first" is "take one", never a ranking.
 *
 *  THROWS when there is none, which is the third and last of this seam's refusals:
 *  a rootless wire with no siblings carries no member at all, so there is no
 *  reserved tag for either round-trip to address. It is spelled as a named function
 *  rather than folded into the derivation below because a refusal produced by a
 *  closure named for the value it computes is a refusal a reader does not find. */
function firstSiblingKey(surfaces: Record<string, unknown>): string {
  const first = Object.keys(surfaces)[0];
  if (first === undefined) {
    throw new Error(
      "connectSurfaces: nothing was passed — no `core` surface and no siblings, so " +
        "this wire would carry no members and there would be no reserved `system/live` " +
        "member for the half-open watchdog to probe. Pass a `core`, at least one " +
        "sibling, or both.",
    );
  }
  return first;
}

/** A SIBLINGS-ONLY wire — every caller that existed before the `core` slot did.
 *  `core` is spelled `undefined` rather than merely omitted so a caller cannot
 *  reach this overload with a root it computed conditionally; see the note on the
 *  rooted overload below for why that matters. */
export async function connectSurfaces<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces.
  const E extends Record<string, Surface<any>> = Record<string, Surface<any>>,
>(
  opts: ConnectSurfacesOptions<E> & { core?: undefined },
): Promise<SurfacesConnection<E>>;
/** A ROOTED wire. `C` is pinned to an actual `Surface` — NOT `Surface | undefined`
 *  — which is what keeps {@link SurfacesConnection.core}'s type honest.
 *
 *  Two overloads rather than one signature with an optional slot, because "does
 *  this wire have a root" is decided at RUNTIME while `conn.core`'s type states it
 *  at COMPILE time, and one signature lets the two disagree. Written as one, a
 *  caller could pass `core: enabled ? { surface, name } : undefined` — TypeScript
 *  infers `C` from the non-`undefined` arm, so `conn.core` types as a definite
 *  client while the seam takes the rootless path at runtime and hands back
 *  `undefined`; `conn.core.cells.x.use()` then compiles and throws. The same one
 *  signature also admitted `core: { surface: undefined, name }` (`C` = `undefined`
 *  satisfies the bound), which reached a raw `TypeError` instead of either of this
 *  seam's named refusals. Split in two, both are call-site type errors: a
 *  conditional root matches NEITHER overload, so a caller that wants one branches
 *  the call — which is honest, since the two branches hand back different types. */
export async function connectSurfaces<
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous map of surfaces.
  const E extends Record<string, Surface<any>>,
  // biome-ignore lint/suspicious/noExplicitAny: the root surface pins its own spec.
  const C extends Surface<any>,
>(
  opts: ConnectSurfacesOptions<E, C> & { core: SurfaceRoot<C> },
): Promise<SurfacesConnection<E, C>>;
export async function connectSurfaces(
  // biome-ignore lint/suspicious/noExplicitAny: the implementation signature is erased — the two overloads above are the contract, and they are what a caller is checked against.
  opts: ConnectSurfacesOptions<any, any>,
  // biome-ignore lint/suspicious/noExplicitAny: ditto.
): Promise<SurfacesConnection<any, any>> {
  const {
    surfaces,
    core,
    extraGroups = [],
    heartbeat: hb,
    onClientError,
    url,
    ...socketOptions
  } = opts;
  // ONE decision, taken once: the root, checked, or `undefined`. Every line below
  // asks THIS binding — never the option, and never the question a second time.
  const root = resolveRoot(core, surfaces);
  // WHICH member the two reserved round-trips address — the `system/identity` echo
  // behind the stale-tab handshake and the `system/live` half-open watchdog. They
  // share ONE target (two prefixes over one wire is a split brain, not a fallback),
  // and it is DERIVED here, where the whole wire is known, rather than passed:
  //
  //   - with a ROOT, the target is the root's BARE reserved tags — `undefined` is
  //     how both primitives already spell "the unprefixed member". The root is the
  //     one participant on every serve this wire can reach, so it is the only
  //     trustworthy target when the SIBLING set varies per serve (a build that
  //     imported more siblings than the serve composed would otherwise probe a tag
  //     that serve does not carry, and read the "unknown tag" as a dead wire);
  //   - without one, the FIRST sibling's, exactly as before — {@link firstSiblingKey},
  //     which also carries what is left of the old empty-map throw: with a root slot
  //     a root-only map is an ordinary wire, so the only thing left to refuse is a
  //     call that passed nothing at all.
  const probeSibling =
    root === undefined ? firstSiblingKey(surfaces) : undefined;
  // The ONE combined group every member's tags live in — the client twin of
  // `implementSurfaces`. Deriving it here (rather than taking it as an option)
  // is what makes "the wire serves exactly these surfaces" true by construction:
  // the root's bare tags, the siblings' prefixed ones (`composeSurfaceContracts`),
  // and anything else multiplexed on this wire (a keyed map's group, a host's
  // hand-written root procedures).
  //
  // `RpcGroup.merge` has no collision detection, so disjointness is only real if it
  // is COUNTED — `mergeDisjointGroups` is the framework's one statement of that
  // proof (the same one kolu-server's `servedGroup` carries on the serving side),
  // and it reports WHICH two halves claimed a tag. A swallowed tag would present as
  // "the wire is up and this one call answers the wrong schema", which is far worse
  // than a boot crash.
  const composed = composeSurfaceContracts(surfaces);
  const group = mergeDisjointGroups({
    ...(root === undefined ? {} : { core: root.surface.group }),
    // Each sibling by NAME, not the whole bundle as one half. The labels exist
    // because "the useful half of a collision report is not the tag — it is WHICH
    // TWO of the caller's own halves both claimed it", and this is the one call site
    // in the repo whose half-count is UNBOUNDED, so it is where that resolution
    // matters most: `claimed by "siblings" and "extraGroups[0]"` withholds the one
    // fact the caller needs. `composeSurfaceContracts` already proved the siblings
    // disjoint among themselves; re-claiming them costs one walk of tags already in
    // hand (each `composed.siblings[key].group` IS the scoped group it merged).
    ...Object.fromEntries(
      Object.entries(composed.siblings).map(([key, sibling]) => [
        `surfaces.${key}`,
        sibling.group,
      ]),
    ),
    ...Object.fromEntries(
      extraGroups.map((extra, i) => [`extraGroups[${i}]`, extra]),
    ),
  });
  // Past this await the wire is LIVE, and every construction below can throw over
  // it — so each allocation is tracked and given back in reverse if one does. See
  // `../connectAllocations` for why a rejected connect that leaves an open
  // socket and a running heartbeat is the worst shape this seam could fail in.
  const allocations = trackConnectAllocations("connectSurfaces");
  const socket = allocations.track(
    "wire",
    await createSurfaceSocket({
      ...socketOptions,
      url: url ?? defaultSurfaceUrl("connectSurfaces"),
      group,
      siblingKey: probeSibling,
    }),
  );
  const { link } = socket;
  try {
    // `createLiveSignal` takes the WHOLE `{ dispatch, wire }` the link factory
    // minted: it wires the half-open watchdog — probing the reserved liveness member
    // at the tag `probeSibling` names: with a root, `undefined`, which is the BARE
    // `surface/system/live`; without one, the first sibling's scoped tag (every
    // sibling answers it, so any would do) — AND mints the BRANDED handle whose one
    // `live` feeds every client's `health().live` (the leg `surfaceClientsHealth`
    // AND-reduces, so a dead wire flips the merged fact not-live). We hand that whole
    // handle to `surfaceClients` so clients and probe share ONE dispatch — there is
    // no separate, fabricatable probe target.
    const transport = allocations.track(
      "watchdog",
      createLiveSignal(link, { siblingKey: probeSibling, ...hb }),
    );
    const clients = surfaceClients(transport, surfaces, onClientError);
    // Tracked PER SIBLING rather than as one bundle: the teardown-failure report
    // then names the sibling whose `dispose` threw, and the release list stays a
    // flat list of resources rather than a list with one entry that is secretly a
    // loop.
    //
    // This loop only ever sees a COMPLETE bundle. `surfaceClients` builds each
    // client eagerly and one can throw (a sibling's declared `client.onError`
    // policy with no interpreter), so it releases what it already built before the
    // exception leaves it — the guarantee has to be ITS, because nothing here can
    // reach a child that was never handed back. Pinned in
    // `surfaceClient.health.test.ts`.
    for (const [key, client] of Object.entries(clients)) {
      allocations.track(`client ${key}`, client as { dispose: () => void });
    }
    // The root's client rides the SAME handle, unwrapped: its members already sit at
    // the bare tags the combined dispatch carries, so unlike a sibling it needs no
    // tag-scoping. The app's one error interpreter reaches it too — a policy declared
    // on the root would otherwise route nowhere (`buildSurfaceClient` refuses that at
    // construction), which would make the root second-class exactly where a sibling is
    // first-class.
    //
    // A second binding rather than a field on `root`, because a client cannot exist
    // before the transport does; pairing the WORD with the CLIENT here is what keeps
    // the two readers below (the fold, and the returned `core`) asking the presence
    // question once each, of a value that carries both answers.
    const rooted =
      root === undefined
        ? undefined
        : {
            name: root.name,
            client: allocations.track(
              "root client",
              surfaceClient(root.surface, transport, onClientError),
            ),
          };
    // The record the combined fact is folded over: every sibling under its key, and
    // the root under the caller's word. Built ONCE — it is a static record; the
    // reactivity is inside each client's `health()`. The spread would WIN over the
    // root if a sibling key equalled `core.name`, quietly dropping the root from the
    // fold and from the readout, which is exactly why the refusal above exists: it,
    // and not this write order, is what makes the record complete.
    const folded =
      rooted === undefined
        ? clients
        : { [rooted.name]: rooted.client, ...clients };
    const health = (): SurfaceHealth => surfaceClientsHealth(folded);
    // ONE fold of the two facts for the whole bundle: the shared wire's status and
    // every sibling's subs. Memoized here (this seam runs outside any reactive
    // owner, so the memo brings its own root) rather than re-walked at each
    // indicator — the merged fact re-folds N registries per read.
    const readout = allocations.track(
      "readout",
      createSurfaceReadout(transport.status, health),
    );
    // THE CONNECTION'S OWN LIFECYCLE, as a state and not a bit. It was one
    // boolean set by both `redial` and `dispose`, and one bit cannot carry two
    // facts: the dial-failure path restored it unconditionally, so a `dispose`
    // that landed during a failed dial was ERASED — the connection re-armed
    // itself over already-released allocations, and the next `redial` dialled a
    // wire off a dead `clients`/`transport`/`readout` and double-released. The
    // state names what is actually true, and `"gone"` is terminal, so that
    // interleaving is unrepresentable rather than merely unlikely.
    //
    // `dispose` stays idempotent (a page-lifetime bundle may call it twice);
    // only `redial` refuses, because only `redial` would allocate over the
    // refusal.
    //
    // REACTIVE, because the two folded faces below are gated on it and a Solid
    // memo bound to a plain `let` would never re-run when it moved. Reading it
    // through the accessor also costs nothing in honesty: TypeScript narrows a
    // `let` from the last assignment it can SEE, so a direct read after an
    // `await` would be typed `"redialing"` and the `"gone"` branch — the one a
    // `dispose()` landing in that window produces — would read as dead code. A
    // signal read returns the declared union, which is the honest type of a
    // state another path can move while this one is suspended.
    type ConnectionState = "live" | "redialing" | "gone";
    const [stateNow, setState] = createSignal<ConnectionState>("live");
    return {
      link,
      clients,
      // No cast: the implementation signature is erased, so `core` here is the
      // honest `SurfaceClient | undefined` the value actually is. The two overloads
      // above are what turn that into a definite client for a rooted caller and a
      // definite `undefined` for a siblings-only one.
      core: rooted?.client,
      transport,
      // A SUPERSEDED OR DISPOSED CONNECTION ANSWERS ABOUT NOTHING. `readout` is a
      // memo inside a root `release()` has already disposed, and a disposed memo
      // keeps its last computed value and stops updating — which on the common
      // redial path (the roster moved, the wire was fine) is `live`: a permanent
      // green light over a closed wire. That is the exact lie `surfaceReadout`
      // refuses to tell one hop down ("the green-over-a-dead-link lie with a
      // longer wire"), and the serve half of this seam's own PR retracts a
      // dropped sibling's READ face for the same reason. `retired` is the one
      // transport state that is terminal and not live, which is what a
      // superseded connection is.
      readout: () =>
        stateNow() === "gone"
          ? ({ status: "retired", needsReload: false } as SurfaceReadout)
          : readout.readout(),
      health: () => (stateNow() === "gone" ? goneHealth : health()),
      redial: async (next: Record<string, Surface<SurfaceSpec>>) => {
        if (stateNow() !== "live") {
          throw new Error(
            `connectSurfaces: \`redial\` on a connection that is ${stateNow() === "gone" ? "already redialled or disposed" : "already redialling"} — ` +
              "its wire is gone or going, so this call would dial a wire the caller does " +
              "not know it holds. Redial the connection `redial` handed back.",
          );
        }
        setState("redialing");
        let replacement: SurfacesConnection<
          // biome-ignore lint/suspicious/noExplicitAny: the implementation signature is erased; the interface member above is the contract.
          any,
          // biome-ignore lint/suspicious/noExplicitAny: ditto.
          any
        >;
        try {
          // The NEW wire first, over the SAME options with only the roster
          // replaced. A dial that throws leaves this connection exactly as it
          // was — nothing has been released yet — so the caller keeps a working
          // wire and hears the failure.
          replacement = await connectSurfaces({
            // biome-ignore lint/suspicious/noExplicitAny: the erased implementation signature; the overloads above check the caller.
            ...(opts as any),
            surfaces: next,
          });
        } catch (dialError) {
          // Back to `live` ONLY if this call is still the one holding the
          // transition. A `dispose()` that landed during the dial has already
          // moved the state to `gone`, which is terminal — re-arming over it is
          // the erasure this state exists to make unspellable.
          if (stateNow() === "redialing") setState("live");
          throw dialError;
        }
        // A `dispose()` during the dial means the caller has GIVEN UP this
        // connection — so the replacement is a wire nobody asked for and nobody
        // holds. Release it and fail, rather than handing back an open socket and
        // a running heartbeat the caller will never dispose.
        if (stateNow() === "gone") {
          await replacement.dispose();
          throw new Error(
            "connectSurfaces: this connection was disposed while `redial` was dialling — " +
              "the replacement has been released. A disposed connection has no successor.",
          );
        }
        setState("gone");
        // The tracker's SUPERSEDED exit: log a release that itself failed, and
        // continue — the value this call exists to produce is the live
        // replacement, and rejecting over the old wire's teardown would hand the
        // caller nothing while a new wire is open. Written in the module that
        // owns exits rather than as a `try/catch` here, so the log-vs-raise
        // decision has one home and the failing resource is named in the line.
        await allocations.supersede();
        return replacement;
      },
      // The tracker's own list, in reverse — NOT a second list written beside it.
      // Two hand-kept teardowns fail asymmetrically: an allocation added above and
      // forgotten here leaks on the SUCCESS path, the one every consumer takes,
      // while the failure path — the one anybody would think to check — keeps
      // looking correct. One list, three exits (`release` here, `unwind` below,
      // `supersede` in `redial`).
      dispose: async () => {
        // Terminal, and set BEFORE the release so an in-flight `redial` observing
        // it after its dial knows the caller has given the connection up.
        setState("gone");
        await allocations.release();
      },
    };
  } catch (constructionError) {
    return allocations.unwind(constructionError);
  }
}
