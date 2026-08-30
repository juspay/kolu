/**
 * `connectSurfaces` — the turnkey client seam for MULTIPLE sibling surfaces over
 * ONE reconnecting wire, with the liveness watchdog wired in by default.
 *
 * The multi-surface counterpart to `connectSurface`: where that builds one
 * `surfaceClient` over one wire, this builds a `surfaceClients` BUNDLE (drishti's
 * control plane multiplexes `admin` + `surfaceApp` over a single transport) and
 * wires the SAME default-on watchdog — one wire, one `createLiveSignal` (which
 * derives the transport status, wires the half-open heartbeat probing the
 * framework-reserved `system/live` member on the first sibling's TAG, AND mints the
 * branded `live`). So a multi-surface app gets half-open detection BY CONSTRUCTION,
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
  mergeDisjointGroups,
  type Surface,
  SURFACE_TAG_PREFIX,
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
import type { Accessor } from "solid-js";
import { createSurfaceSocket, type SurfaceSocketOptions } from "../connect";

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
> extends Omit<SurfaceSocketOptions, "group" | "siblingKey"> {
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
  core?: {
    /** The root surface itself — a STANDALONE surface (`defineSurface`'s own
     *  `surface/` prefix). A sibling-scoped surface here is refused: the client
     *  face is built against standalone tags, so a scoped root would dial
     *  `surface/<member>/<verb>` at a wire that serves `surface/<key>/…` and
     *  every call would 404 at the far end with nothing having said so. */
    surface: C;
    /** The WORD the root answers to in the health fold and the readout — the role a
     *  sibling's key plays there (`surfaceApp/buildInfo`), which the root has no key
     *  to supply. It is app policy, so it crosses as an argument (the class the
     *  required `retired` handler belongs to) rather than being invented here: the
     *  framework has no name for an app's own floor. Must not be one of the sibling
     *  keys — two clients folded under one word would drop one of them in silence.
     *
     *  It is a LABEL, not a tag segment: the root's members keep their bare tags, so
     *  unlike a sibling key this word never reaches the wire and is not held to
     *  `assertTagSegment`'s grammar. An app may call its floor whatever its readout
     *  should say. */
    name: string;
  };
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
   *  through `clients.<key>.rpc` (the tag-scoped face). */
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
  /** Stop the heartbeat, dispose every sibling client's standing subscriptions,
   *  and release the wire. A page-lifetime cached bundle needn't call it. */
  dispose: () => Promise<void>;
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
  opts: ConnectSurfacesOptions<E, C> & { core: { surface: C; name: string } },
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
    ...socketOptions
  } = opts;
  const root: { surface: Surface<SurfaceSpec>; name: string } | undefined =
    core;
  if (root !== undefined) {
    // A sibling-scoped surface as the root is the one miswiring nothing downstream
    // would catch: `surfaceClient` builds its face from the SPEC and mints
    // standalone tags whatever prefix the value carries, so a scoped root would
    // dial `surface/<member>/<verb>` over a wire that serves `surface/<key>/…`
    // and every call would die at the far end — after connecting cleanly.
    //
    // ONE LAW, TWO DOORS. The identical refusal stands at the SERVE side's rooted
    // gate — `exposeRootedFaces` (`@kolu/surface/expose`), which cites this one back
    // — because a root is standalone or it is not a root, and each door has to hold
    // the rule for the app that happens to use only that door. The two sites are
    // deliberately not one shared assertion: the message names the door a reader
    // arrived through, and the ERROR CLASS is each module's own (`ExposeMapError` is
    // `expose.ts`'s recognisable class for a malformed exposure; this seam has none
    // and raises a plain `Error`, like its two neighbouring refusals). What a shared
    // predicate would buy — one reading of "is this the root of a bundle" — is real,
    // and is the recorded next step rather than this PR's, which is capped at the
    // single new export it already spends on `mergeDisjointGroups`. Until then the
    // two sites cite each other, so neither can be relaxed by someone who did not
    // know the other existed.
    if (root.surface.tagPrefix !== SURFACE_TAG_PREFIX) {
      throw new Error(
        `connectSurfaces: \`core.surface\` carries the tag prefix "${root.surface.tagPrefix}", ` +
          `not the standalone "${SURFACE_TAG_PREFIX}" — it is a sibling-scoped surface, and the ` +
          "root of a rooted bundle is the UNPREFIXED one. Pass the standalone surface " +
          "(`defineSurface(spec)`), or make it a sibling in `surfaces`.",
      );
    }
    // The health fold is keyed by word, so a root sharing a sibling's key would
    // put two clients under one name — and one of them would vanish from the fold
    // (and from the readout) with nothing said.
    if (Object.hasOwn(surfaces, root.name)) {
      throw new Error(
        `connectSurfaces: \`core.name\` is "${root.name}", which is also a sibling key — ` +
          "the health fold is keyed by that word, so one of the two clients would be " +
          "dropped from it in silence. Give the root a name no sibling has.",
      );
    }
  }
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
  //   - without one, the FIRST sibling's, exactly as before. Every sibling carries
  //     the same three reserved `system/*` members and answers the same per-process
  //     id, so "first" is "take one", never a ranking.
  //
  // The refusal below is what is left of the old empty-map throw: with a root slot
  // a root-only map is an ordinary wire, so the only thing left to refuse is a call
  // that passed nothing at all.
  const probeSibling = ((): string | undefined => {
    if (root !== undefined) return undefined;
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
  })();
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
    siblings: composed.group,
    ...Object.fromEntries(
      extraGroups.map((extra, i) => [`extraGroups[${i}]`, extra]),
    ),
  });
  const socket = await createSurfaceSocket({
    ...socketOptions,
    group,
    siblingKey: probeSibling,
  });
  const { link } = socket;
  // `createLiveSignal` takes the WHOLE `{ dispatch, wire }` the link factory
  // minted: it wires the half-open watchdog (probing the reserved liveness member
  // at the FIRST sibling's tag — every sibling answers it) AND mints the BRANDED
  // handle whose one `live` feeds every sibling's `health().live` (the leg
  // `surfaceClientsHealth` AND-reduces, so a dead wire flips the merged fact
  // not-live). We hand that whole handle to `surfaceClients` so clients and probe
  // share ONE dispatch — there is no separate, fabricatable probe target.
  const transport = createLiveSignal(link, { siblingKey: probeSibling, ...hb });
  const clients = surfaceClients(transport, surfaces, onClientError);
  // The root's client rides the SAME handle, unwrapped: its members already sit at
  // the bare tags the combined dispatch carries, so unlike a sibling it needs no
  // tag-scoping. The app's one error interpreter reaches it too — a policy declared
  // on the root would otherwise route nowhere (`buildSurfaceClient` refuses that at
  // construction), which would make the root second-class exactly where a sibling is
  // first-class.
  const rooted =
    root === undefined
      ? undefined
      : {
          name: root.name,
          client: surfaceClient(root.surface, transport, onClientError),
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
  const readout = createSurfaceReadout(transport.status, health);
  return {
    link,
    clients,
    // No cast: the implementation signature is erased, so `core` here is the
    // honest `SurfaceClient | undefined` the value actually is. The two overloads
    // above are what turn that into a definite client for a rooted caller and a
    // definite `undefined` for a siblings-only one.
    core: rooted?.client,
    transport,
    readout: readout.readout,
    health,
    dispose: async () => {
      transport.dispose();
      readout.dispose();
      for (const client of Object.values(folded)) {
        (client as { dispose: () => void }).dispose();
      }
      await socket.dispose();
    },
  };
}
