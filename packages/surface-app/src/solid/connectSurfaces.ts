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
 * THE ROSTER FOLLOWS IN PLACE. A composed wire's sibling set can MOVE while the
 * tab stays open — a surface app whose plugin roster is a switch in the product
 * (juspay/kolu#2227, the client half of #2225, which made the SERVE side read its
 * generation at each accept). `redial` takes the new roster, and what it replaces
 * is the WIRE, not this connection: `clients`, `core`, `transport`, `readout` and
 * `health` keep their identity across the move, so the app tree keeps standing and
 * standing subscriptions are re-opened by the connection rather than by the page
 * rebuilding itself. Two lifted primitives carry it — `followingWire`
 * (`@kolu/surface/links/following`) for the wire, `surfaceClients`' bundle
 * (`@kolu/surface/solid`) for the client map — and this seam is what joins them to
 * one watchdog and one readout.
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
import { followingWire } from "@kolu/surface/links/following";
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
  surfaceReadout,
} from "@kolu/surface/solid";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { type Accessor, createSignal } from "solid-js";
import {
  createSurfaceSocket,
  type SurfaceSocket,
  type SurfaceSocketOptions,
} from "../connect";
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

/** What a DISPOSED connection's health fact reads: not live, and naming nothing —
 *  there are no subscriptions on a wire that is closed, and a disposed registry's
 *  last fold is not a fact about anything. Frozen and shared: it is a constant, not
 *  per-connection state.
 *
 *  A REDIALLED connection is deliberately NOT this. It used to be — `redial` handed
 *  back a replacement and killed the connection that produced it — and that is the
 *  whole thing juspay/kolu#2227 undoes: a roster move leaves this connection alive,
 *  so its fact keeps answering about the wire it now rides. Only `dispose` is
 *  terminal. */
const goneHealth: SurfaceHealth = Object.freeze({
  live: false,
  subs: Object.freeze([]),
});

/** What a DISPOSED connection's READOUT reads — built by the
 *  framework's own fold rather than spelled here, and frozen for the same reason
 *  {@link goneHealth} is.
 *
 *  TWO THINGS a hand-written literal got wrong. `needsReload` is documented on
 *  `TransportReadout` as true for `retired` and ONLY for `retired` — the bit a
 *  consumer reads instead of re-deriving which states are terminal — and
 *  `surfaceReadout` is the one producer that upholds it (`needsReload: status
 *  === "retired"`). A `{status:"retired", needsReload:false}` written here was a
 *  value that fold can never produce, so an indicator branching on the status and
 *  one branching on the bit gave opposite answers for the same handle, and the
 *  `as SurfaceReadout` cast was what let it compile. And minting it per READ threw
 *  away `createSurfaceReadout`'s `equals: sameReadout` gate, so every consumer memo
 *  over a disposed connection saw a changed reference forever — the
 *  new-reference-every-run anti-pattern the performance atlas has banked a win
 *  against. One frozen value from the real constructor answers both. */
const retiredReadout: SurfaceReadout = Object.freeze(
  surfaceReadout("retired", goneHealth),
);

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
  /** The wire this bundle rides — `{ dispatch, wire, dispose, diagnostics }`.
   *
   *  It is the STANDING wire, not a generation: `dispatch` and `wire` are the same
   *  values across a {@link SurfacesConnection.redial}, which is what lets a
   *  consumer hold `conn.link.wire` at module scope (drishti hands it to
   *  `<SurfaceAppProvider>`'s `createServerLifecycle`) and keep holding it while
   *  the roster moves underneath. `diagnostics` is the one leg that cannot be
   *  standing — a dial history belongs to the socket that dialled — so it reads
   *  through to whichever generation is current. */
  link: WebsocketLink;
  /** One scoped `surfaceClient` per sibling surface (the `surfaceClients` shape).
   *  Reach a sibling's primitives through `clients.<key>` and its reserved members
   *  through `clients.<key>.rpc` (the tag-scoped face).
   *
   *  THE SAME OBJECT for this connection's whole life, mutated in place by
   *  {@link SurfacesConnection.redial}: a sibling that arrives appears on it, a
   *  sibling that leaves is dropped from it (and its client, which a component may
   *  still hold, refuses in words on the next call). Read it AFTER the `redial`
   *  promise resolves — that is when the arrivals are on it — and there is nothing
   *  to re-bind, which is the point.
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
  /** Take a NEW SIBLING ROSTER — in place. Resolves to THIS SAME CONNECTION,
   *  retyped to the roster it now carries.
   *
   *  ## What moves, and what does not
   *
   *  A new WIRE is dialled, and that part is not negotiable: Effect RPC resolves a
   *  call's payload/success/error SCHEMAS by looking the tag up in the `RpcGroup`
   *  its client was built over, and that group is fixed when a link is opened
   *  (`openWireLink` does `RpcClient.make(group, …)` once). A sibling that joins
   *  brings tags that group never minted; the far end has the same constraint,
   *  because each accepted socket builds its `RpcServer` over the generation it was
   *  handed at accept (juspay/kolu#2225). So a roster change IS a new wire at both
   *  ends.
   *
   *  What is NOT a fact about the transport is that the connection object had to go
   *  with it. It used to: `redial` handed back a replacement and everything this
   *  one produced — `clients`, `core`, `transport`, `readout`, `health` — was dead,
   *  so every standing subscription had to be reopened by the APP, which meant
   *  rebuilding the reactive tree, which meant losing local UI state that has
   *  nothing to do with the roster (a half-typed editor, an open pane, a scroll
   *  position). The bill for that came in as roughly fifteen separate "a roster
   *  change discarded X" fixes in one downstream release (juspay/kolu#2227). So the
   *  wire is the only thing replaced now:
   *
   *   - `clients` is the SAME map, mutated: an arriving sibling appears on it, a
   *     departing one is dropped — and the departing one's CLIENT, which a
   *     still-mounted component may hold, refuses in words on its next call rather
   *     than dialling tags the server no longer serves;
   *   - `core`, `transport`, `link`, `readout` and `health` keep their identity,
   *     and `readout` never reads `retired` for a roster move — a move is not a
   *     retirement, and saying so was the second thing every consumer had to work
   *     around;
   *   - STANDING SUBSCRIPTIONS re-open themselves. The wire's own supersession
   *     fails whatever was in flight with the transport error the per-subscription
   *     retry fence already retries on (`@kolu/surface/links/following`), so the
   *     next frame each subscription sees is its fresh snapshot from the new
   *     generation. No app code re-subscribes, and there is no second recovery
   *     path beside the fence.
   *
   *  ## What it still owns
   *
   *  Every option this connection was dialled with — the `url` (thunk included),
   *  the heartbeat tuning, `extraGroups`, `onClientError`, the socket options — so
   *  a consumer cannot drift them by re-spelling the call, which is the same
   *  failure `connectSurfaces` itself exists to stop (juspay/kolu#2222).
   *
   *  And the ORDER: every refusal the new roster earns is raised BEFORE anything is
   *  dialled, the replacement wire is dialled BEFORE the old one is given up, and
   *  the handover itself — adopt the wire, move the clients, re-fold the health —
   *  is synchronous. A dial that throws costs the caller nothing: the connection is
   *  untouched and still on its current roster. ("Resolved" is this seam's own
   *  await and not an OPEN socket — `connectSurfaces` hands back a connection whose
   *  wire may still be connecting, exactly as a first dial does.)
   *
   *  A `dispose()` landing while the dial is in flight is TERMINAL and wins: the
   *  replacement wire is released and this call rejects, rather than adopting a
   *  wire onto a connection the caller has already given up.
   *
   *  THE ROOT DOES NOT MOVE. Only the siblings are re-rostered: the root is the
   *  member on every serve this wire can reach, which is what makes it the
   *  reserved probes' target on a bundle whose sibling set varies (see
   *  {@link ConnectSurfacesOptions.core}) — and a `core` that could change would
   *  make this the very thing it is not, a second `connectSurfaces`. Dial a
   *  different root by calling `connectSurfaces` again.
   *
   *  ## The two things a caller still has to know
   *
   *  Refuses while ANOTHER redial is in flight (one wire is dialled at a time, so
   *  a queue belongs to the caller that has two rosters in hand) and on a DISPOSED
   *  connection.
   *
   *  And the returned type is the honest half of an in-place move: the object does
   *  not change, so a binding still typed on the OLD roster will keep claiming
   *  departed keys exist. Re-bind through this call's result — `conn = await
   *  conn.redial(next)` — which costs nothing at runtime and keeps the type
   *  truthful. */
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
 *  this seam owes a root ITSELF has been made — or `undefined` for a siblings-only
 *  wire.
 *
 *  ONE decision, taken once, so the body below asks a VALUE whether there is a root
 *  rather than re-deciding it, and so a reader looking for "what does this door
 *  refuse about a root" finds all of it in one place instead of two-thirds of it.
 *
 *  The refusal that is about the root AND a ROSTER lives in
 *  {@link assertRootWordFree} instead, because it has to be re-made on every roster
 *  this connection takes: the root is fixed for the connection's life, but the
 *  siblings its word must stay clear of are not. */
function resolveRoot(
  core: SurfaceRoot<Surface<SurfaceSpec>> | undefined,
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

/** The root's WORD must be clear of the roster's keys — re-checked for every roster
 *  this connection takes, which is why it is not inside {@link resolveRoot}.
 *
 *  The health fold is keyed by word, so a root sharing a sibling's key would put two
 *  clients under one name and one of them would vanish from the fold (and from the
 *  readout) with nothing said. The fold is rebuilt on every roster move, so a roster
 *  that only NOW collides with the root would introduce exactly that silence — which
 *  is the whole reason a `redial` raises this before it dials anything. */
function assertRootWordFree(
  root: SurfaceRoot<Surface<SurfaceSpec>> | undefined,
  surfaces: Record<string, unknown>,
): void {
  if (root !== undefined && Object.hasOwn(surfaces, root.name)) {
    throw new Error(
      `connectSurfaces: \`core.name\` is "${root.name}", which is also a sibling key — ` +
        "the health fold is keyed by that word, so one of the two clients would be " +
        "dropped from it in silence. Give the root a name no sibling has.",
    );
  }
}

/** Everything about ONE ROSTER that has to be settled — and refused — before a wire
 *  is dialled for it: the combined `RpcGroup` the wire is built over, and which
 *  member the two reserved round-trips address.
 *
 *  It is a named value rather than two locals because a roster is taken more than
 *  once now (`redial`), and "what a roster derives" drifting between the first dial
 *  and a later one is exactly the class of bug the seam's option re-use exists to
 *  stop. Every refusal in here is raised BEFORE the caller's working wire is
 *  touched. */
interface GenerationPlan {
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  readonly probeSibling: string | undefined;
}

function planGeneration(
  root: SurfaceRoot<Surface<SurfaceSpec>> | undefined,
  surfaces: Record<string, Surface<SurfaceSpec>>,
  // biome-ignore lint/suspicious/noExplicitAny: the erasure is this seam's — see `ConnectSurfacesOptions.extraGroups`.
  extraGroups: ReadonlyArray<RpcGroup.RpcGroup<any>>,
): GenerationPlan {
  assertRootWordFree(root, surfaces);
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
  //
  // On a ROOTLESS wire the answer therefore moves with the roster, which is why the
  // watchdog reads it through a thunk rather than being handed a string once.
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
  return { group, probeSibling };
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
  const root = resolveRoot(core);
  // What the CURRENT roster derives — the wire's group and the reserved probes'
  // target. REASSIGNED by `redial`, and read below through this binding rather
  // than through `opts`, which is what makes "the watchdog probes a member the
  // CURRENT generation serves" true rather than true-on-the-first-dial.
  //
  // The roster ITSELF is deliberately not kept beside it: after the handover the
  // roster this connection rides is exactly `bundle.clients`' key set, and a
  // second copy would be a place two writers keep in step by hand for no reader.
  let plan = planGeneration(root, surfaces, extraGroups);
  // Resolved ONCE, before anything is allocated — a browser app's own origin does
  // not change between generations, and the refusal a missing `location` earns has
  // to land before the first dial (the law `defaultSurfaceUrl` states).
  const dialUrl = url ?? defaultSurfaceUrl("connectSurfaces");
  const dialGeneration = (next: GenerationPlan): Promise<SurfaceSocket> =>
    createSurfaceSocket({
      ...socketOptions,
      url: dialUrl,
      group: next.group,
      siblingKey: next.probeSibling,
    });
  // Past this await the wire is LIVE, and every construction below can throw over
  // it — so each allocation is tracked and given back in reverse if one does. See
  // `../connectAllocations` for why a rejected connect that leaves an open
  // socket and a running heartbeat is the worst shape this seam could fail in.
  const allocations = trackConnectAllocations("connectSurfaces");
  const first = await dialGeneration(plan);
  // THE STANDING WIRE. `followingWire` allocates nothing and cannot throw — it
  // reads a status and registers a listener — so taking ownership of the dialled
  // socket and tracking the result is one step with no window between them.
  //
  // Everything below is built over THIS, never over a generation: its `dispatch`
  // and its `wire` are the same values for the connection's whole life, which is
  // what lets the watchdog, the clients and the readout survive a roster move.
  // Releasing it releases whichever generation it currently holds, so the tracker
  // still owns exactly one wire-shaped resource.
  const following = allocations.track(
    "wire",
    followingWire<WebsocketLink>({
      transport: first.link,
      dispose: first.dispose,
    }),
  );
  try {
    // `createLiveSignal` takes the WHOLE `{ dispatch, wire }` — here the STANDING
    // pair — so it wires the half-open watchdog over the same dispatch every client
    // dials AND mints the BRANDED handle whose one `live` feeds every client's
    // `health().live` (the leg `surfaceClientsHealth` AND-reduces, so a dead wire
    // flips the merged fact not-live). Because the pair is standing, the handle is
    // too: `conn.transport` is the same unforgeable value across a roster move, and
    // a `connectSurfaceMap(map, conn.transport)` built over it keeps working.
    //
    // The probe target is a THUNK over the CURRENT plan (`@kolu/surface`'s
    // `CreateLiveSignalOptions.siblingKey`): with a root it stays `undefined` — the
    // bare `surface/system/live` — and on a rootless wire it follows the roster, so
    // the watchdog can never probe a member this generation stopped serving and
    // read the "unknown tag" answer as a dead wire.
    const transport = allocations.track(
      "watchdog",
      createLiveSignal(following, {
        siblingKey: () => plan.probeSibling,
        ...hb,
      }),
    );
    // The sibling BUNDLE — one client per sibling over the standing dispatch, and
    // the one thing that knows how a roster MOVES (which clients survive, which are
    // retracted, which are built). Tracked as ONE resource because it owns its
    // children's lifetimes across every roster this connection takes; a per-sibling
    // entry in this list could only describe the roster the connection was born
    // with.
    const bundle = allocations.track(
      "clients",
      surfaceClients(transport, surfaces, onClientError),
    );
    // THE map the app holds, for the connection's whole life. `reroster` mutates
    // it in place, so there is nothing here to reassign and nothing for a consumer
    // to re-read.
    const clients = bundle.clients;
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
    // the root under the caller's word. REBUILT on every roster move (`refold`),
    // because `clients` is mutated in place and a spread taken once would keep
    // folding the roster this connection was born with. `assertRootWordFree` runs
    // for every roster, so the spread can never drop the root by shadowing it.
    let folded: Record<string, Pick<SurfaceClient<SurfaceSpec>, "health">> = {};
    const refold = (): void => {
      folded =
        rooted === undefined
          ? { ...clients }
          : { [rooted.name]: rooted.client, ...clients };
    };
    refold();
    // The roster's own VERSION, read by the fact below so a Solid memo bound to it
    // re-folds when the MEMBERSHIP moves. Every other input to `health()` is already
    // reactive (each sub's self-clearing signals, the transport `live`); the roster
    // is the one that changes by plain-object mutation, so it needs the same
    // membership bump `createSurfaceHealthRegistry` uses for exactly this reason.
    // `equals: false` makes each bump a distinct notification though the value is
    // constant.
    const [rosterMembership, bumpRosterMembership] = createSignal(0, {
      equals: false,
    });
    const health = (): SurfaceHealth => {
      rosterMembership();
      return surfaceClientsHealth(folded);
    };
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
    // Only `dispose` reaches `"gone"` now. A redial passes THROUGH `"redialing"`
    // and back to `"live"`, because the connection it started with is the one it
    // ends with — that is the whole of juspay/kolu#2227.
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
    // The connection is named so `redial` can hand back the very object it moved:
    // an in-place roster change has no replacement to return, and returning `this`
    // is what lets the caller re-bind the TYPE (`conn = await conn.redial(next)`)
    // without re-binding anything at runtime.
    // biome-ignore lint/suspicious/noExplicitAny: the implementation signature is erased; the overloads above are the contract.
    const connection: SurfacesConnection<any, any> = {
      // The STANDING link. `dispatch` and `wire` are the following wire's own
      // (stable across a roster move, which is what lets a consumer hold
      // `conn.link.wire` at module scope); `diagnostics` is the one fact that
      // belongs to a GENERATION rather than to the wire, so it reads through to
      // whichever generation is current instead of freezing on the first.
      link: {
        dispatch: following.dispatch,
        wire: following.wire,
        dispose: following.dispose,
        diagnostics: {
          dialHistory: () => following.current().diagnostics.dialHistory(),
          epoch: () => following.current().diagnostics.epoch(),
        },
      },
      clients,
      // No cast: the implementation signature is erased, so `core` here is the
      // honest `SurfaceClient | undefined` the value actually is. The two overloads
      // above are what turn that into a definite client for a rooted caller and a
      // definite `undefined` for a siblings-only one.
      core: rooted?.client,
      transport,
      // A DISPOSED connection answers about nothing. `readout` is a memo inside a
      // root `release()` has already disposed, and a disposed memo keeps its last
      // computed value and stops updating — which is `live`: a permanent green
      // light over a closed wire. That is the exact lie `surfaceReadout` refuses to
      // tell one hop down ("the green-over-a-dead-link lie with a longer wire").
      // `retired` is the one transport state that is terminal and not live, which
      // is what a disposed connection is.
      //
      // A REDIALLED connection is not disposed and does not read this: its wire is
      // open, its subscriptions are re-establishing on the new generation, and
      // `reconnecting`/`live` — whatever the real wire says — is the truth.
      readout: () =>
        stateNow() === "gone" ? retiredReadout : readout.readout(),
      health: () => (stateNow() === "gone" ? goneHealth : health()),
      redial: async (next: Record<string, Surface<SurfaceSpec>>) => {
        if (stateNow() !== "live") {
          throw new Error(
            stateNow() === "gone"
              ? "connectSurfaces: `redial` on a DISPOSED connection — its wire is " +
                  "released, so this call would dial a wire nothing holds."
              : "connectSurfaces: `redial` while another `redial` is still in flight — " +
                  "this connection dials one wire at a time, and a second call would " +
                  "dial a wire the first one is about to supersede. Await the redial " +
                  "in flight before asking for another roster.",
          );
        }
        // EVERY refusal the new roster earns, raised while the working wire is
        // still untouched and nothing has been dialled — the same law the first
        // dial holds, applied to every later roster.
        const nextPlan = planGeneration(root, next, extraGroups);
        setState("redialing");
        let generation: SurfaceSocket;
        try {
          // The NEW wire first, over the SAME options with only the roster's
          // group and probe target replaced. A dial that throws leaves this
          // connection exactly as it was — nothing has been given up — so the
          // caller keeps a working wire on its current roster and hears the
          // failure.
          generation = await dialGeneration(nextPlan);
        } catch (dialError) {
          // Back to `live` ONLY if this call is still the one holding the
          // transition. A `dispose()` that landed during the dial has already
          // moved the state to `gone`, which is terminal — re-arming over it is
          // the erasure this state exists to make unspellable.
          if (stateNow() === "redialing") setState("live");
          throw dialError;
        }
        // A `dispose()` during the dial means the caller has GIVEN UP this
        // connection — so the wire just dialled is one nobody holds. Release it
        // and fail, rather than adopting it onto a connection whose clients and
        // watchdog are already released.
        if (stateNow() === "gone") {
          await generation.dispose();
          throw new Error(
            "connectSurfaces: this connection was disposed while `redial` was dialling — " +
              "the replacement wire has been released. A disposed connection takes no " +
              "new roster.",
          );
        }
        // THE HANDOVER, and every line of it is SYNCHRONOUS. There is no window in
        // which the wire, the clients and the fold disagree about which roster this
        // connection is on — which is what makes "a `dispose()` may land anywhere"
        // a statement about two well-defined states rather than about a schedule.
        plan = nextPlan;
        // Adopting fails whatever was in flight over the old generation with the
        // transport error the per-subscription retry fence retries on, so every
        // standing subscription re-opens ITSELF against the new one. The promise
        // is the SUPERSEDED generation's release; the swap itself already happened.
        const superseded = following.adopt({
          transport: generation.link,
          dispose: generation.dispose,
        });
        try {
          // Departed siblings are retracted (their clients refuse in words from
          // here on), arrivals are built, and `clients` — the object the app holds
          // — carries both. The returned bundle IS this one; only the type moves.
          //
          // It must run AFTER the adopt, and that is not a preference: an arriving
          // sibling's client can open a standing subscription AT CONSTRUCTION (a
          // mirrored surface's eager `liveWhen` leg, forked synchronously), and its
          // tags are ones the OUTGOING generation's `RpcGroup` never minted — so
          // built a moment earlier it would address an unknown tag on the wire it
          // is replacing, and that answer is not the transport failure the fence
          // retries on. The arrivals therefore go onto the wire that serves them.
          bundle.reroster(next);
        } catch (rerosterError) {
          // AND THAT ORDER HAS A PRICE, paid here rather than hidden. The wire has
          // already moved and cannot move back — the generation this connection
          // dialled FROM is being released as this runs — so a connection whose
          // wire serves one roster while its clients were built for another cannot
          // be made honest again. It is given up, loudly and completely, rather
          // than left wedged mid-transition with every later `redial` refused.
          // (`buildSurfaceClient` throws by design for a sibling whose spec
          // declares a `client.onError` policy with no interpreter — a programming
          // error, which is exactly the class that must crash rather than degrade.)
          setState("gone");
          await superseded;
          try {
            await allocations.release();
          } catch (releaseError) {
            // Logged, not raised: the caller needs the error that CAUSED the
            // teardown, not the teardown's own.
            console.error(
              "connectSurfaces: releasing this connection FAILED while giving it up " +
                "over a roster move its clients could not follow",
              releaseError,
            );
          }
          throw new Error(
            "connectSurfaces: the new roster's clients could not be built after its wire " +
              "had already been adopted, so this connection has been RELEASED — its wire " +
              "served one roster while its clients were built for another, and nothing can " +
              "make that honest. Dial a fresh connection over the roster you want.",
            { cause: rerosterError },
          );
        }
        refold();
        bumpRosterMembership(0);
        setState("live");
        // Awaited LAST: the connection is already consistent and live on the new
        // roster, so a teardown that drags does not hold the new roster back, and
        // a `dispose()` landing in this window releases the generation now held
        // rather than the corpse. It never rejects — `followingWire.adopt` logs a
        // superseded generation's teardown failure rather than raising it, because
        // the value this call exists to produce is already delivered.
        await superseded;
        return connection;
      },
      // The tracker's own list, in reverse — NOT a second list written beside it.
      // Two hand-kept teardowns fail asymmetrically: an allocation added above and
      // forgotten here leaks on the SUCCESS path, the one every consumer takes,
      // while the failure path — the one anybody would think to check — keeps
      // looking correct. One list, two exits (`release` here, `unwind` below).
      dispose: async () => {
        // Terminal, and set BEFORE the release so an in-flight `redial` observing
        // it after its dial knows the caller has given the connection up.
        setState("gone");
        await allocations.release();
      },
    };
    return connection;
  } catch (constructionError) {
    return allocations.unwind(constructionError);
  }
}
