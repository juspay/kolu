import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
import { t as $$Footnote } from "./Footnote_Co54bi9w.mjs";
//#region src/diagrams/remote-surfaces-map.svg?raw
var remote_surfaces_map_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 880 560\" font-family=\"ui-sans-serif, system-ui, sans-serif\" font-size=\"13\">\n  <rect width=\"880\" height=\"560\" fill=\"#101014\" rx=\"12\"/>\n\n  <!-- THE NOTION -->\n  <rect x=\"140\" y=\"24\" width=\"600\" height=\"150\" fill=\"#1f2a24\" stroke=\"#3fae6a\" stroke-width=\"1.5\" rx=\"10\"/>\n  <text x=\"440\" y=\"48\" text-anchor=\"middle\" fill=\"#7be0a3\" font-weight=\"bold\" font-size=\"15\">@kolu/surface-map — the notion (NEW package)</text>\n  <text x=\"440\" y=\"72\" text-anchor=\"middle\" fill=\"#b9e8cb\" font-size=\"11.5\">entry spec typed ONCE · branded key folded into every proc's INPUT (one already-muxed socket)</text>\n  <text x=\"440\" y=\"90\" text-anchor=\"middle\" fill=\"#b9e8cb\" font-size=\"11.5\">ONE authority: entries — Collection&lt;Key, warming | connected | failed(reason) + clockOffset&gt;</text>\n  <text x=\"440\" y=\"108\" text-anchor=\"middle\" fill=\"#b9e8cb\" font-size=\"11.5\">absence = not in the collection · removal ⇒ typed END of that key's subs</text>\n  <text x=\"440\" y=\"126\" text-anchor=\"middle\" fill=\"#8fceaa\" font-size=\"11.5\">client: pure entry(key) · Solid useEntry(accessor) — swap = dispose-and-rebuild, sync first value</text>\n  <text x=\"440\" y=\"144\" text-anchor=\"middle\" fill=\"#8fceaa\" font-size=\"11.5\">base @kolu/surface: sub-dedup = keyed map of createSingletonRoot slots (lifetime tied to entries)</text>\n  <text x=\"440\" y=\"164\" text-anchor=\"middle\" fill=\"#6e6e80\" font-size=\"10.5\">rides @kolu/surface only · serveSurfaceMap(map, { resolve }) — resolver-backed · composed by @kolu/surface-remote (né nix-host, renamed this PR)</text>\n\n  <!-- unification banner -->\n  <text x=\"440\" y=\"204\" text-anchor=\"middle\" fill=\"#e0b04a\" font-size=\"12\" font-weight=\"bold\">the UNIFICATION of two independent hand-rollings (prove-then-extract: met by archaeology)</text>\n  <line x1=\"340\" y1=\"176\" x2=\"240\" y2=\"230\" stroke=\"#3fae6a\" stroke-width=\"2\"/>\n  <line x1=\"540\" y1=\"176\" x2=\"640\" y2=\"230\" stroke=\"#3fae6a\" stroke-width=\"2\"/>\n\n  <!-- CONSUMER 1: KOLU -->\n  <rect x=\"24\" y=\"230\" width=\"410\" height=\"300\" fill=\"#16161d\" stroke=\"#2e2e3a\" rx=\"10\"/>\n  <text x=\"229\" y=\"254\" text-anchor=\"middle\" fill=\"#8b8b9e\" font-size=\"11\" letter-spacing=\"2\">CONSUMER 1 · KOLU (the one kolu PR)</text>\n\n  <rect x=\"44\" y=\"268\" width=\"370\" height=\"82\" fill=\"#1c1c26\" stroke=\"#3d3d4d\" rx=\"8\"/>\n  <text x=\"229\" y=\"288\" text-anchor=\"middle\" fill=\"#e6e6f0\" font-weight=\"bold\" font-size=\"12\">kolu-server: serveHostMap(buildHostRegistry)</text>\n  <text x=\"229\" y=\"306\" text-anchor=\"middle\" fill=\"#8b8b9e\" font-size=\"11\">warm ssh sessions · lazy drv faults → failed(reason)</text>\n  <text x=\"229\" y=\"322\" text-anchor=\"middle\" fill=\"#8b8b9e\" font-size=\"11\">hosts.add/remove = root RPCs writing the registry (P3)</text>\n  <text x=\"229\" y=\"340\" text-anchor=\"middle\" fill=\"#6e6e80\" font-size=\"10.5\">#1708 lessons re-land clean-room (pins as checklist)</text>\n\n  <line x1=\"229\" y1=\"350\" x2=\"229\" y2=\"372\" stroke=\"#e0b04a\" stroke-width=\"2\"/>\n  <text x=\"300\" y=\"366\" text-anchor=\"middle\" fill=\"#a8853a\" font-size=\"10\">one socket (ops gate: measured)</text>\n\n  <rect x=\"44\" y=\"372\" width=\"370\" height=\"112\" fill=\"#241f2e\" stroke=\"#a56de2\" rx=\"8\"/>\n  <text x=\"229\" y=\"392\" text-anchor=\"middle\" fill=\"#cfa9f5\" font-weight=\"bold\" font-size=\"12\">kolu browser</text>\n  <text x=\"229\" y=\"410\" text-anchor=\"middle\" fill=\"#b9a3d6\" font-size=\"11\">canvas = useEntry(activeHost) — switch = a signal write</text>\n  <text x=\"229\" y=\"426\" text-anchor=\"middle\" fill=\"#b9a3d6\" font-size=\"11\">selector strip (drishti-like) + add/remove buttons —</text>\n  <text x=\"229\" y=\"442\" text-anchor=\"middle\" fill=\"#b9a3d6\" font-size=\"11\">gated on KOLU_PADI_HOST · chips: status + urgency LIVE</text>\n  <text x=\"229\" y=\"462\" text-anchor=\"middle\" fill=\"#9d84c0\" font-size=\"10.5\">fallback policy reads entries — a value, not a callback</text>\n  <text x=\"229\" y=\"478\" text-anchor=\"middle\" fill=\"#9d84c0\" font-size=\"10.5\">env seeds the pool · runtime add/remove ephemeral · no recentHosts</text>\n\n  <text x=\"229\" y=\"506\" text-anchor=\"middle\" fill=\"#6e6e80\" font-size=\"10.5\">DEAD: activeConnectionManager · per-host sockets · pick-epoch</text>\n  <text x=\"229\" y=\"521\" text-anchor=\"middle\" fill=\"#6e6e80\" font-size=\"10.5\">retire-stubbing · useBindingScopedSub/bindingScoped/reSub tower</text>\n\n  <!-- CONSUMER 2: DRISHTI -->\n  <rect x=\"446\" y=\"230\" width=\"410\" height=\"300\" fill=\"#16161d\" stroke=\"#2e2e3a\" rx=\"10\"/>\n  <text x=\"651\" y=\"254\" text-anchor=\"middle\" fill=\"#8b8b9e\" font-size=\"11\" letter-spacing=\"2\">CONSUMER 2 · DRISHTI (the paired adoption PR)</text>\n\n  <rect x=\"466\" y=\"268\" width=\"370\" height=\"82\" fill=\"#1c1c26\" stroke=\"#3d3d4d\" rx=\"8\"/>\n  <text x=\"651\" y=\"288\" text-anchor=\"middle\" fill=\"#e6e6f0\" font-weight=\"bold\" font-size=\"12\">parent server: hostRegistry → serveHostMap</text>\n  <text x=\"651\" y=\"306\" text-anchor=\"middle\" fill=\"#8b8b9e\" font-size=\"11\">agent shipped over ssh stdio · per-host sessions kept</text>\n  <text x=\"651\" y=\"322\" text-anchor=\"middle\" fill=\"#8b8b9e\" font-size=\"11\">admin hosts.add/remove/reconnect → registry writes</text>\n  <text x=\"651\" y=\"340\" text-anchor=\"middle\" fill=\"#6e6e80\" font-size=\"10.5\">its hand-rolled admin-surface host plumbing: adopted away</text>\n\n  <line x1=\"651\" y1=\"350\" x2=\"651\" y2=\"372\" stroke=\"#e0b04a\" stroke-width=\"2\"/>\n\n  <rect x=\"466\" y=\"372\" width=\"370\" height=\"112\" fill=\"#241f2e\" stroke=\"#a56de2\" rx=\"8\"/>\n  <text x=\"651\" y=\"392\" text-anchor=\"middle\" fill=\"#cfa9f5\" font-weight=\"bold\" font-size=\"12\">drishti browser (fleet view — behavior parity)</text>\n  <text x=\"651\" y=\"410\" text-anchor=\"middle\" fill=\"#b9a3d6\" font-size=\"11\">fleet cards + tab strip = entries.use() (one authority)</text>\n  <text x=\"651\" y=\"426\" text-anchor=\"middle\" fill=\"#b9a3d6\" font-size=\"11\">drill-down = useEntry(selectedHost) · ?host= deep links</text>\n  <text x=\"651\" y=\"442\" text-anchor=\"middle\" fill=\"#b9a3d6\" font-size=\"11\">connection dots read EntryStatus values</text>\n  <text x=\"651\" y=\"462\" text-anchor=\"middle\" fill=\"#9d84c0\" font-size=\"10.5\">acceptance = the DELETION diff + parity screenshots —</text>\n  <text x=\"651\" y=\"478\" text-anchor=\"middle\" fill=\"#9d84c0\" font-size=\"10.5\">the framework proves itself by shrinking a real product</text>\n\n  <text x=\"651\" y=\"506\" text-anchor=\"middle\" fill=\"#6e6e80\" font-size=\"10.5\">DEAD: hand-rolled hostRegistry membership glue +</text>\n  <text x=\"651\" y=\"521\" text-anchor=\"middle\" fill=\"#6e6e80\" font-size=\"10.5\">admin-surface hosts collection/status plumbing</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/remote-surfaces.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		blockquote: "blockquote",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		li: "li",
		ol: "ol",
		p: "p",
		strong: "strong",
		table: "table",
		tbody: "tbody",
		td: "td",
		th: "th",
		thead: "thead",
		tr: "tr",
		ul: "ul"
	}, props.components);
	const { Fragment: Fragment$1 } = _components;
	if (!Fragment$1) _missingMdxReference("Fragment", true);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "What this note is." }),
			" The redesign of W4 under srid’s constraints: no facade over the swap — the framework gains a ",
			createVNode(_components.em, { children: "notion" }),
			"; consumers reach a host’s cells ",
			createVNode(_components.strong, { children: "through the client object itself" }),
			" (",
			createVNode(_components.code, { children: "app.remoteSurfaces.get(\"zest\").padi.cells.daemonStatus.use(…)" }),
			"); multi-host ",
			createVNode(_components.strong, { children: "multiplexing is in scope now" }),
			", not a future relaxation; nothing deferred; every invariant held to ",
			createVNode(_components.a, {
				href: "#the-invariant-table",
				children: "/architecture-first-principles"
			}),
			" and the perfection bar (the defect class becomes ",
			createVNode(_components.em, { children: "inexpressible" }),
			", not guarded). Grounded in the code, not memory: a surface is a typed oRPC router ",
			createVNode(_components.strong, { children: "already stream-multiplexed over one socket" }),
			"; the client is ",
			createVNode(_components.strong, { children: "type-generated from the contract" }),
			"; ",
			createVNode(_components.code, { children: "buildHostRegistry" }),
			" + ",
			createVNode(_components.code, { children: "reServeSurface" }),
			" already hold and re-serve one warm session per host. Those three facts are what make this design small. This revision folds in a 3-agent adversarial debate (simplifier / purist / pragmatist lenses; record in ",
			createVNode(_components.code, { children: "debates/remote-surfaces-family/" }),
			", uncommitted) and the grounded discovery that ",
			createVNode(_components.strong, { children: "drishti already hand-rolled this entire pattern" }),
			" (",
			createVNode(_components.code, { children: "hostRegistry.ts" }),
			" + ",
			createVNode(_components.code, { children: "admin-surface.ts" }),
			": keyed host collection, per-host connection cell, add/remove/reconnect procedures, membership-subscribed client) — which, with kolu’s #1708 manager (closed, superseded by this design), makes two independent implementations: the prove-then-extract bar for the map, met before a line is written."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "user-facing-description",
			children: "User-facing description"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"One kolu PR — the switch, multi-active chips, and the map that powers them; the whole multi-host UI gated on ",
				createVNode(_components.code, { children: "KOLU_PADI_HOST" }),
				"."
			] }),
			" The env var (srid-ruled) grows to a comma-separated seed list — ",
			createVNode(_components.code, { children: "KOLU_PADI_HOST=\"localhost,srid@zest\"" }),
			" — and is the ",
			createVNode(_components.strong, { children: "feature gate" }),
			": set, kolu’s chrome shows a host selector strip ",
			createVNode(_components.em, { children: "just like drishti’s" }),
			" (one chip per pool host: live status + agent-urgency count — N hosts consumed concurrently; padi already serves the ",
			createVNode(_components.code, { children: "urgency" }),
			" cell ",
			createVNode(_components.code, { children: "{awaiting, awaitingIds}" }),
			") plus ",
			createVNode(_components.strong, { children: "add/remove host buttons" }),
			"; unset, kolu renders exactly as today — zero UI change, single local host. Switching is ",
			createVNode(_components.em, { children: "instant" }),
			": picking a chip repaints the canvas into that host’s ",
			createVNode(_components.code, { children: "warming" }),
			"/",
			createVNode(_components.code, { children: "connected" }),
			" state at once (selection is a signal write, not an awaited connect). Add a host → its chip appears immediately ",
			createVNode(_components.code, { children: "warming" }),
			" → flips ",
			createVNode(_components.code, { children: "connected" }),
			"; a bogus host shows ",
			createVNode(_components.code, { children: "failed(reason)" }),
			" as a value while siblings keep streaming; removal ends its subscriptions with a ",
			createVNode(_components.em, { children: "typed" }),
			" reason. Membership semantics are drishti’s, adopted wholesale: the env seeds the pool at boot, runtime add/remove are ephemeral (gone on server restart), local is always the unremovable default member. ",
			createVNode(_components.strong, { children: [
				"No Labs entry, no persisted ",
				createVNode(_components.code, { children: "recentHosts" }),
				" cell"
			] }),
			" — the env is the explicit seed, which also kills the boot-brick class at its root (nothing persisted to parse at boot; a seeded remote with no drv map is that entry’s ",
			createVNode(_components.code, { children: "failed(reason)" }),
			", never a crash)."
		] }),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "Revised in W10 (padi note)." }),
				" The “runtime add/remove are ephemeral” decision above was later reversed: strip-added membership now ",
				createVNode(_components.strong, { children: "persists across restarts" }),
				" as a ",
				createVNode(_components.code, { children: "hosts" }),
				" field in the server-side conf state store (",
				createVNode(_components.code, { children: "config.json" }),
				", fail-fast on corruption — the same store ",
				createVNode(_components.code, { children: "preferences" }),
				" rides), re-seeded at boot through the same connect pipeline. The boot-brick class stays killed — a corrupt store crashes ",
				createVNode(_components.em, { children: "loudly" }),
				" with the path, never a silent brick. This paragraph records the W4 decision as shipped; the W10 phase of the padi note carries the current behaviour."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The paired drishti PR is the unification’s other half — adoption as deletion." }),
			" drishti already hand-rolled the map pattern (",
			createVNode(_components.code, { children: "hostRegistry.ts" }),
			", ",
			createVNode(_components.code, { children: "admin-surface.ts" }),
			": keyed host collection + per-host connection cell + add/remove/reconnect + membership-subscribed tab strip). Its PR replaces that machinery with ",
			createVNode(_components.code, { children: "@kolu/surface-map" }),
			" consumption, behavior-parity, ",
			createVNode(_components.strong, { children: "acceptance measured in deleted code" }),
			" — the framework proving itself by making an existing product smaller, not by a demo app. (padi-dashboard — the attention product — remains a natural ",
			createVNode(_components.em, { children: "future" }),
			" PR on the proven map; the demo burden no longer rides on it. ",
			createVNode(_components.code, { children: "packages/surface-map" }),
			" ships only the README hello-world + a mock-entry e2e harness through the same resolver seam.)"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "architecture-level-changes",
			children: "Architecture-level changes"
		}),
		"\n",
		createVNode($$Svg, {
			svg: remote_surfaces_map_default,
			wide: true,
			caption: "One notion, two consumers: @kolu/surface-map (top) is the unification of the two existing hand-rollings — kolu (left: serveHostMap over the warm ssh registry; canvas + multi-active chips on useEntry/entries) and drishti (right: its hostRegistry + admin-surface plumbing adopted away; fleet view at behavior parity, acceptance = the deletion diff). Membership lives in ONE entries collection; the swap is a signal write; every wrapper tower dies."
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"The new notion — ",
				createVNode(_components.code, { children: "SurfaceMap" }),
				": a dynamic keyed set of surfaces served as one."
			] }),
			" Today a surface’s shape is static in the contract. The map adds the one honest dynamic axis: ",
			createVNode(_components.em, { children: "entry spec typed once, entries keyed at runtime" }),
			". Server-side, ",
			createVNode(_components.code, { children: "serveSurfaceMap(entrySpec, registry)" }),
			" is a ",
			createVNode(_components.strong, { children: "router transform, not a transport change" }),
			": every entry proc gets the ",
			createVNode(_components.code, { children: "key" }),
			" folded into its ",
			createVNode(_components.em, { children: "input" }),
			", the handler resolves ",
			createVNode(_components.code, { children: "registry.getSession(key)" }),
			" at call time, and membership gates every call — unknown key is a typed rejection. Alongside the entry procs, ",
			createVNode(_components.strong, { children: "one authoritative collection carries the membership fact" }),
			" (debate-unanimous refinement — the earlier keys-collection-plus-total-status-cell shape gave one fact two homes, a P3 violation): ",
			createVNode(_components.code, { children: "entries: Collection<Key, EntryStatus>" }),
			" with ",
			createVNode(_components.code, { children: "EntryStatus = warming | connected | failed(reason)" }),
			" (+ the entry’s ",
			createVNode(_components.code, { children: "clockOffset" }),
			", derived by the serving process with ",
			createVNode(_components.strong, { children: "its own clock" }),
			" at hello — the writer named, per P3). ",
			createVNode(_components.strong, { children: "Absence = the key is not in the collection" }),
			"; there is no ",
			createVNode(_components.code, { children: "absent" }),
			" status variant. One writer (the membership registry) publishes membership and status together, so cross-channel contradictions (status says connected, keys says gone) are unconstructible at the source. Removing an entry ",
			createVNode(_components.strong, { children: "ends that key’s live subscriptions with a typed reason" }),
			" — the mirrored session’s teardown already ends its streams; the map maps that into a typed completion instead of a socket error.",
			createVNode($$Footnote, { children: [
				"Why key-as-input and not per-key sockets or new frame tags: the oRPC peer already multiplexes many concurrent streams over one connection — that is how N cells coexist today. Key-as-input reuses the existing dispatch and typing wholesale; the misroute guard stops being retire-stubbing machinery and becomes a property of the data — a subscription ",
				createVNode(_components.em, { children: "carries its key in every frame by construction" }),
				", so a call can’t cross hosts any more than it can cross procs. W4’s per-host sockets made misroute ",
				createVNode(_components.em, { children: "structurally" }),
				" impossible (a frame on zest’s socket physically cannot reach local’s handler); key-in-input is honestly weaker — a runtime membership gate (P5), not unrepresentability (P4). The design buys the P4 half back at the public API with a ",
				createVNode(_components.strong, { children: "branded key type" }),
				": ",
				createVNode(_components.code, { children: "defineSurfaceMap(keySchema, entrySpec)" }),
				" brands ",
				createVNode(_components.code, { children: "Key" }),
				", and the map lens is the only public producer of branded keys, so a forged or unchecked key is a ",
				createVNode(_components.em, { children: "type error" }),
				" for every consumer of the typed API (raw wire access can still spell a bad key and gets the typed rejection — claim stated at its true strength, per the debate’s purist)."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"The client half — ",
				createVNode(_components.code, { children: "app.remoteSurfaces" }),
				", a typed map client."
			] }),
			" ",
			createVNode(_components.code, { children: ".get(key)" }),
			" partial-applies the key and returns the ",
			createVNode(_components.em, { children: "entry-typed" }),
			" client subtree — so ",
			createVNode(_components.code, { children: "remoteSurfaces.get(\"zest\").padi.cells.daemonStatus.use(…)" }),
			" is the API, exactly the spelling asked for. Two properties do all the work the old wrappers did:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Pure and reactive access are two named APIs" }),
				" (debate refinement — the owner boundary gets a name instead of a runtime surprise): ",
				createVNode(_components.code, { children: "entry(key)" }),
				" is the pure lens (no owner needed, no I/O — safe anywhere), and ",
				createVNode(_components.code, { children: "useEntry(keyAccessor)" }),
				" is the Solid-only form that owns swap disposal — key change disposes the old entry scope and rebuilds synchronously (the ",
				createVNode(_components.code, { children: "createKeyedRoot" }),
				"/",
				createVNode(_components.code, { children: "mapArray" }),
				" atom survives as the internal mechanism; it was always right — exposing wrappers around it was the mistake). ",
				createVNode(_components.code, { children: "useEntry" }),
				" outside a reactive owner throws the documented contract."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Subscription dedup by construction — built ON the ecosystem primitive, in the BASE client." }),
				" The sharing-by-convention hack (module-const singletons) predates multi-host, so ref-counted dedup per ",
				createVNode(_components.code, { children: "(proc, stable-input)" }),
				" lands in ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				"’s client where every consumer inherits it; the map gets keyed dedup free (its branded key is part of the input). ",
				createVNode(_components.strong, { children: "The implementation is not hand-rolled ref-counting" }),
				" (the debate’s C1 objection, answered): each cache slot is ",
				createVNode(_components.code, { children: "@solid-primitives/rootless" }),
				"’s ",
				createVNode(_components.code, { children: "createSingletonRoot" }),
				" — the audited ecosystem primitive whose exact semantics are “created once, ref-counted per reactive listener, disposed when the last leaves” — held in a map keyed by ",
				createVNode(_components.code, { children: "(proc, stable-input-hash)" }),
				". (The same audit that ",
				createVNode(_components.em, { children: "rejected" }),
				" this primitive for ",
				createVNode(_components.code, { children: "createSharedRoot" }),
				"’s never-teardown consumers endorses it here: a feed nobody watches ",
				createVNode(_components.em, { children: "should" }),
				" close. TanStack Solid Query was weighed and declined: request/response-shaped with staleness semantics — the wrong shape for server-push cells.) ",
				createVNode(_components.strong, { children: "The lifetime contract closes the debate’s P1 hole" }),
				": on removal the map completes matching iterators with the typed end ",
				createVNode(_components.em, { children: "before" }),
				" the registry destroys the session (test pin: no socket-error frame after a typed end); a typed completion evicts the cache slot; a key absent from ",
				createVNode(_components.code, { children: "entries" }),
				" at subscribe time is never cached. A live cached sub for an absent member is thereby unrepresentable. Dedup applies to ",
				createVNode(_components.strong, { children: "static-input" }),
				" subs (every real kolu case today — 15/15); accessor-input subs stay per-consumer (two input accessors are honestly two subscriptions). Warmth is policy: one deliberate app-scope reader in kolu’s ",
				createVNode(_components.code, { children: "wire.ts" }),
				", not a framework knob. This deletes the module-const convention, ",
				createVNode(_components.code, { children: "createSharedRoot" }),
				"-as-sharing, ",
				createVNode(_components.code, { children: "useBindingScopedSub" }),
				", ",
				createVNode(_components.code, { children: "bindingScoped" }),
				", ",
				createVNode(_components.code, { children: "reSub" }),
				", and wire.ts’s adapter layer."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "entry(key)" }), " is total — existence is a value, never a nullable."] }),
			" The lens is ",
			createVNode(_components.em, { children: "partial application of the key" }),
			": pure, synchronous, no I/O, no existence claim — because membership is a time-varying fact, and an ",
			createVNode(_components.code, { children: "entry(): Entry | undefined" }),
			" would be a TOCTOU lie reintroducing the overloaded-",
			createVNode(_components.code, { children: "undefined" }),
			" this cycle eradicated elsewhere. Existence lives in exactly two honest places, both reading the ONE authority: (1) ",
			createVNode(_components.strong, { children: ["a client-side total fold over ", createVNode(_components.code, { children: "entries" })] }),
			" — ",
			createVNode(_components.code, { children: "entry(k).state()" }),
			" yields the collection’s ",
			createVNode(_components.code, { children: "EntryStatus" }),
			" when the key is a member and an explicit not-a-member value when it isn’t, so a persisted active host removed from another device boots into a ",
			createVNode(_components.em, { children: "value" }),
			" the fallback policy reads (the totality the consumer needs, WITHOUT a second server-side authority — the debate’s fix); “inactive” is not a framework concept (activeness is the app’s signal). (2) ",
			createVNode(_components.strong, { children: "Data subs follow one rule" }),
			": a subscription ends, typed, when-and-because its key is not a member — removed mid-stream → ",
			createVNode(_components.code, { children: "{reason: \"removed\"}" }),
			"; never a member → immediate ",
			createVNode(_components.code, { children: "{reason: \"absent\"}" }),
			" on the same channel (one semantics, both timings). One-shot ",
			createVNode(_components.em, { children: "calls" }),
			" on an absent key typed-reject, since a call cannot end gracefully."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Activeness is app policy — a value, and that kills two machines." }),
			" The framework holds the ",
			createVNode(_components.em, { children: "set" }),
			"; “which host(s) this tab looks at” is a plain signal in kolu. Switching = writing the signal — ",
			createVNode(_components.strong, { children: "synchronous" }),
			", so there is nothing to race: the pick-epoch machinery (built because selection awaited a warm) has no reason to exist. Warming stays real but becomes a ",
			createVNode(_components.em, { children: "server-side observable" }),
			" (",
			createVNode(_components.code, { children: "status" }),
			" cell) the UI renders honestly — the W6 “honest connect” note lands here for free. Retirement stubbing (",
			createVNode(_components.code, { children: "send" }),
			"-throws-typed-error) likewise dies: a switched-away key’s subs just keep running if something still reads them (multi-active is ",
			createVNode(_components.em, { children: "allowed" }),
			"), and end typed when the entry is actually removed. One-active is a ",
			createVNode(_components.em, { children: "policy" }),
			" the app enforces by construction of its own signal — precisely the “multiplicity as policy, not physics” line the old plan’s footnote promised, now made literal."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "packaging-kolusurface-map-its-own-package",
			children: [
				"Packaging: ",
				createVNode(_components.code, { children: "@kolu/surface-map" }),
				", its own package"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The map spans contract, server, and client — inside ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" it would ",
			createVNode(_components.em, { children: "smear" }),
			" across ",
			createVNode(_components.code, { children: "define.ts" }),
			"/",
			createVNode(_components.code, { children: "server.ts" }),
			"/",
			createVNode(_components.code, { children: "client.ts" }),
			" as edits to each. It is also its own volatility axis (lowy): ",
			createVNode(_components.strong, { children: "membership dynamics" }),
			" (“the set of surfaces changes at runtime”) can change independently of stream mechanics — you could swap how membership works (config, discovery) without touching how a cell streams, and vice versa. So it gets its own receptacle, ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "packages/surface-map" }) }),
			" (",
			createVNode(_components.code, { children: "-map" }),
			" over ",
			createVNode(_components.code, { children: "-family" }),
			"/",
			createVNode(_components.code, { children: "-multi" }),
			", srid-ruled: the members are homogeneous — one entry spec, N keys — so the thing IS a keyed map; “family” colloquially suggests kin-but-different members, and “multi” names nothing), depending only on ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			", with its own define/serve/client/solid entrypoints. Layering: ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" gains only the generic sub-dedup (universal, see above) · ",
			createVNode(_components.code, { children: "@kolu/surface-map" }),
			" owns the keyed axis · ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/surface-remote" }) }),
			" (srid-ruled rename of ",
			createVNode(_components.code, { children: "surface-nix-host" }),
			", done IN this PR: with the map extracted, the package’s identity is ‘hosting surface daemons on remote machines’ — ssh is the transport, nix the provisioning strategy, remoteness the name; it survives a future non-nix provisioner) composes ",
			createVNode(_components.code, { children: "serveHostMap = map over buildRemotePool" }),
			" · kolu, drishti, and odu consume. ",
			createVNode(_components.strong, { children: "The rename carries a naming sweep" }),
			": exported API drops legacy vocabulary — anchor: ",
			createVNode(_components.code, { children: "buildHostRegistry" }),
			" → ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "buildRemotePool" }) }),
			" (‘registry’ retires; a ",
			createVNode(_components.em, { children: "pool" }),
			" holds warm sessions, the map’s ",
			createVNode(_components.em, { children: "entries" }),
			" publishes membership — one word per concept). The sweep judges each export in the PR; names that are already honest (",
			createVNode(_components.code, { children: "makeSession" }),
			", ",
			createVNode(_components.code, { children: "sshConnector" }),
			", ",
			createVNode(_components.code, { children: "isLocalHost" }),
			", ",
			createVNode(_components.code, { children: "resolveSystem" }),
			" — odu’s entire import surface) stay, keeping odu’s change mechanical. Location ",
			createVNode(_components.em, { children: "is" }),
			" structure: the notion is first-class in the workspace, with its own README and tests. And the extraction bar is not speculative — ",
			createVNode(_components.strong, { children: "the two consumers already exist as hand-rollings" }),
			": kolu’s ",
			createVNode(_components.code, { children: "activeConnectionManager" }),
			" + ",
			createVNode(_components.code, { children: "hostPool" }),
			" admin plumbing (#1708, closed) and drishti’s ",
			createVNode(_components.code, { children: "hostRegistry" }),
			" + ",
			createVNode(_components.code, { children: "admin-surface" }),
			". The package’s job is their unification; prove-then-extract is satisfied by archaeology, not promises (the debate’s evidence-gate demand, answered)."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-notion-in-25-lines--kolus-actual-usage-not-a-toy-map-api-indicative-the-padi-cells-are-real-code",
			children: "The notion in ~25 lines — kolu’s ACTUAL usage, not a toy (map API indicative; the padi cells are real code)"
		}),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// 0 · THE PACKAGE UNDER PROPOSAL — every map API below comes from it</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#24292E\"> { defineSurfaceMap } </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"@kolu/surface-map\"</span><span style=\"color:#24292E\">;          </span><span style=\"color:#6A737D\">// contract half</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#24292E\"> { serveSurfaceMap } </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"@kolu/surface-map/server\"</span><span style=\"color:#24292E\">;    </span><span style=\"color:#6A737D\">// server half</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#24292E\"> { connectSurfaceMap } </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"@kolu/surface-map/client\"</span><span style=\"color:#24292E\">;  </span><span style=\"color:#6A737D\">// client half (+ /solid: useEntry)</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// 1 · CONTRACT — no new spec invented: the map is built over kolu's REAL padi surface</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//     (packages/padi/src/surface.ts — its `urgency` cell {awaiting, awaitingIds} and</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//      `terminals` collection already exist and already stream today)</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#24292E\"> { padiSurface } </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"@kolu/padi/surface\"</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">export</span><span style=\"color:#D73A49\"> const</span><span style=\"color:#005CC5\"> padiHosts</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> defineSurfaceMap</span><span style=\"color:#24292E\">(HostKeySchema, padiSurface);</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// ↑ HostKeySchema BRANDS the key; brings `entries: Collection&#x3C;HostKey, EntryStatus>` free —</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//   the ONE membership authority (warming | connected | failed(reason), + clockOffset;</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//   absence = not in the collection)</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// 2 · SERVER (kolu-server) — the warm ssh pool IS the resolver; env seeds membership.</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//     buildRemotePool is NOT map API — it's the EXISTING pool from @kolu/surface-remote</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//     (né surface-nix-host's buildHostRegistry, renamed with the package: one warm</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//     DaemonSession per host — ssh dial, nix provisioning, reconnect). Pool ≠ map: the</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//     pool owns the UPSTREAM connections (its volatility: ssh/nix/daemon lifetime); the</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//     map owns the DOWNSTREAM serving shape (membership on the wire).</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//     The pool is the single WRITER of membership; the map's `entries` collection is</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//     that truth PUBLISHED — one writer, one projection (P3). The resolver seam is the</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//     boundary: any session source can back a map (this pool, drishti's agent shipper,</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//     the e2e harness's mock subprocesses).</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#24292E\"> { buildRemotePool } </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"@kolu/surface-remote\"</span><span style=\"color:#24292E\">; </span><span style=\"color:#6A737D\">// né buildHostRegistry / surface-nix-host</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> pool</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> buildRemotePool</span><span style=\"color:#24292E\">({ seed: </span><span style=\"color:#6F42C1\">parseKoluPadiHost</span><span style=\"color:#24292E\">() </span><span style=\"color:#6A737D\">/* \"localhost,srid@zest\" */</span><span style=\"color:#24292E\"> });</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">serveSurfaceMap</span><span style=\"color:#24292E\">(padiHosts, </span><span style=\"color:#6F42C1\">poolAsMapRegistry</span><span style=\"color:#24292E\">(pool));</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// MapRegistry = { members(), subscribe(onChange), has(key), resolve(key) => EntrySession | EntryFault }</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// — membership as a first-class SUBSCRIBABLE fact (it must DRIVE the entries collection; a fused</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// resolve-only seam can't observe changes). onChange fires only AFTER members()/has() reflect the</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// change; status is DERIVED from the resolved session's state (projection, not a second writer).</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// hosts.add/remove stay root RPCs writing the pool — one writer, runtime-ephemeral</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// 3 · CLIENT — construct the typed map client ONCE from the contract + the app's link</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//     (this is where `app.padiHosts` comes from — nothing ambient)</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> app</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> { padiHosts: </span><span style=\"color:#6F42C1\">connectSurfaceMap</span><span style=\"color:#24292E\">(padiHosts, link) };</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//     the switcher chips: every host's agent urgency, LIVE, one loop</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">&#x3C;</span><span style=\"color:#24292E\">For each</span><span style=\"color:#D73A49\">=</span><span style=\"color:#24292E\">{app.padiHosts.entries.use().keys()}</span><span style=\"color:#D73A49\">></span><span style=\"color:#24292E\">{(host) => (</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  &#x3C;HostChip</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">    status</span><span style=\"color:#D73A49\">=</span><span style=\"color:#24292E\">{app.padiHosts.entry(host).state()}            </span><span style=\"color:#6A737D\">// EntryStatus | not-a-member — a VALUE</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">    awaiting</span><span style=\"color:#D73A49\">=</span><span style=\"color:#24292E\">{app.padiHosts.entry(host).cells.urgency.use().value()?.awaiting}</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  /></span></span>\n<span class=\"line\"><span style=\"color:#24292E\">)}</span><span style=\"color:#D73A49\">&#x3C;/</span><span style=\"color:#24292E\">For</span><span style=\"color:#D73A49\">></span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// 4 · CLIENT — the canvas follows the picked host; switching = writing a signal</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#24292E\"> [</span><span style=\"color:#005CC5\">activeHost</span><span style=\"color:#24292E\">, </span><span style=\"color:#005CC5\">setActiveHost</span><span style=\"color:#24292E\">] </span><span style=\"color:#D73A49\">=</span><span style=\"color:#6F42C1\"> createSignal</span><span style=\"color:#24292E\">(</span><span style=\"color:#005CC5\">LOCAL_HOST</span><span style=\"color:#24292E\">);   </span><span style=\"color:#6A737D\">// per-tab, sessionStorage-backed</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> active</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> app.padiHosts.</span><span style=\"color:#6F42C1\">useEntry</span><span style=\"color:#24292E\">(activeHost);              </span><span style=\"color:#6A737D\">// Solid-only: owns swap disposal</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">active.cells.terminals.</span><span style=\"color:#6F42C1\">use</span><span style=\"color:#24292E\">();  </span><span style=\"color:#6A737D\">// re-keys on switch, synchronous first value; a removed host's</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">                               // subs end typed {reason:\"removed\"} — the fallback policy reads</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">                               // entry(host).state() and falls back to local: a value, no callback</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "What survives from #1708, honestly." }),
			" The server half survives nearly whole: ",
			createVNode(_components.code, { children: "buildHostRegistry" }),
			" + sessions, ssh warm, lazy drv resolution + typed per-host faults (Group 1), ",
			createVNode(_components.code, { children: "UnremovableHostError" }),
			", entry cells (they become the map’s ",
			createVNode(_components.code, { children: "status" }),
			"/identity cells), the shared local scan, the dialog work, Labs UI (repointed). The batch’s framework ",
			createVNode(_components.em, { children: "atoms" }),
			" survive (",
			createVNode(_components.code, { children: "createKeyedRoot" }),
			"-over-",
			createVNode(_components.code, { children: "mapArray" }),
			" in ",
			createVNode(_components.code, { children: "@kolu/surface/solid" }),
			", ",
			createVNode(_components.code, { children: "createSubRoot" }),
			" in ",
			createVNode(_components.code, { children: "useCell" }),
			", the manager-honesty lessons as test cases). What is discarded is the client-side composite: ",
			createVNode(_components.code, { children: "createActiveConnectionManager" }),
			", ",
			createVNode(_components.code, { children: "connectionScoped" }),
			" as consumer API, per-host browser sockets, retirement stubbing, pick-epoch, and kolu’s wrapper tower. ",
			createVNode(_components.strong, { children: "Adoption path — clean-room, no cherry-pick (anti-regurgitation rule):" }),
			" PR1 starts from a fresh branch off master with this note as the only spec and the old client design explicitly out of bounds; in PR2 the #1708 branch serves as a ",
			createVNode(_components.em, { children: "lessons reference" }),
			" — its pins and test cases become checklists the new code must also satisfy (the toast ordering, the drv-map boot, the remove-default rejection) — but code is ",
			createVNode(_components.strong, { children: "re-derived against the map shape" }),
			", and anything copied verbatim must individually justify itself against the new design. Rejecting the PR discards ",
			createVNode(_components.em, { children: "shape" }),
			", not knowledge."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-invariant-table-perfection-bar-each-defect-class-inexpressible",
			children: "The invariant table (perfection bar: each defect class inexpressible)"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "defect class (all real, all hit this cycle)" }),
					"\n",
					createVNode(_components.th, { children: "killed by" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "misroute — a call resolves against the wrong host" }),
					"\n",
					createVNode(_components.td, { children: "branded key type — only the map lens constructs one (P4 at the typed API); runtime membership gate on the wire (P5, stated at its true strength)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "yank — a slow warm commits a stale pick" }),
					"\n",
					createVNode(_components.td, { children: "selection is a synchronous value; nothing awaits (P1/P2)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "leak-on-swap — old sub outlives the switch" }),
					"\n",
					createVNode(_components.td, { children: [
						"entry scope owns subs; disposal is ",
						createVNode(_components.code, { children: "mapArray" }),
						"’s, not convention (P1)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "sharing-by-convention — module-const singletons" }),
					"\n",
					createVNode(_components.td, { children: [
						"base-client dedup: a keyed map of ",
						createVNode(_components.code, { children: "createSingletonRoot" }),
						" slots (ecosystem primitive, C1) with the membership-tied lifetime contract (P1)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "signal-of-signals at call sites" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: ".get(key)" }), " returns the entry client; nesting internal to the atom (C2)"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "boot-brick — a persisted host crashes startup" }),
					"\n",
					createVNode(_components.td, { children: [
						"per-entry ",
						createVNode(_components.code, { children: "failed(reason)" }),
						" status value; boot never parses per-host config eagerly (P4, kept from Group 1)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "dishonest teardown — “server restarted” lie" }),
					"\n",
					createVNode(_components.td, { children: "removal ends subs with a typed reason; no stub errors (P4/P5)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"silent no-op — ",
						createVNode(_components.code, { children: "remove(default)" }),
						" “succeeds”"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"typed ",
						createVNode(_components.code, { children: "UnremovableHostError" }),
						" (kept)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "foreign clock — cross-host timestamps" }),
					"\n",
					createVNode(_components.td, { children: [
						"per-entry ",
						createVNode(_components.code, { children: "clockOffset" }),
						" on ",
						createVNode(_components.code, { children: "entries" }),
						", derived by the serving process with its own clock at hello — one named writer (P3; no deferred honest-clocks item)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "live cached sub for an absent member" }),
					"\n",
					createVNode(_components.td, { children: "typed end evicts the dedup slot; absent-at-subscribe is never cached; map completes streams before session destroy (P1/P5, pinned)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "dual authority for membership" }),
					"\n",
					createVNode(_components.td, { children: [
						"ONE ",
						createVNode(_components.code, { children: "entries" }),
						" collection; absence = not in it; status and membership published by one writer (P3)"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "implementation-details",
			children: "Implementation details"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "One kolu PR + the paired drishti adoption PR" }),
			" (srid-ruled; #1708 and drishti#89 are closed with successor pointers). With the old PR closed there is no separate “framework proof” PR: the demand proof is the two hand-rollings that already exist, and the kolu PR ships the ",
			createVNode(_components.em, { children: "product" }),
			" (switch + chips) on the ",
			createVNode(_components.em, { children: "notion" }),
			" (the map) in one reviewable unit — the atlas one-PR default, honored. The drishti PR is the unification’s other half and satisfies the surface gate substantively."
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: [
			"The kolu PR — ",
			createVNode(_components.code, { children: "@kolu/surface-map" }),
			" + base dedup + the switch + chips."
		] }) }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "@kolu/surface" }),
				" (base): sub-dedup as a keyed map of ",
				createVNode(_components.code, { children: "createSingletonRoot" }),
				" slots per ",
				createVNode(_components.code, { children: "(proc, stable-input-hash)" }),
				", with the membership-tied lifetime contract (typed end evicts; absent-at-subscribe never cached; pinned)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "packages/surface-map" }),
				" (new): ",
				createVNode(_components.code, { children: "defineSurfaceMap(keySchema, entrySpec)" }),
				" — branded key, entry-router transform (key into input, zod-validated), the ",
				createVNode(_components.code, { children: "entries" }),
				" collection contract (status + clockOffset, one writer); ",
				createVNode(_components.code, { children: "serveSurfaceMap(map, mapRegistry)" }),
				" — ",
				createVNode(_components.code, { children: "MapRegistry" }),
				" = ",
				createVNode(_components.code, { children: "{ members, subscribe, has, resolve => EntrySession | EntryFault }" }),
				": membership as a first-class subscribable fact (it drives ",
				createVNode(_components.code, { children: "entries" }),
				"; ruled at the Phase-1 consult — a fused resolve-only seam cannot observe membership changes), source-agnostic (pool adapter, mock harness); ",
				createVNode(_components.code, { children: "SurfaceMapClient" }),
				" with pure ",
				createVNode(_components.code, { children: "entry(key)" }),
				" + Solid ",
				createVNode(_components.code, { children: "useEntry(accessor)" }),
				"; typed end on membership loss. README hello-world + a mock-entry e2e harness (subprocess entries through the same resolver seam) are the package’s example — no demo app."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "@kolu/surface-remote" }),
				" — the rename of ",
				createVNode(_components.code, { children: "surface-nix-host" }),
				" + the naming sweep land here, same PR: ",
				createVNode(_components.code, { children: "serveHostMap(buildRemotePool(...))" }),
				"; entry faults from the lazy drv/ssh path land as ",
				createVNode(_components.code, { children: "failed(reason)" }),
				" values."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"kolu: server parses ",
				createVNode(_components.code, { children: "KOLU_PADI_HOST" }),
				" as a comma-separated seed list (validated per entry; local always the implicit unremovable default, deduped if listed); serves the padi map; ",
				createVNode(_components.code, { children: "hosts.add/remove" }),
				" stay root RPCs writing the pool (P3), runtime-ephemeral like drishti’s. Client: ",
				createVNode(_components.code, { children: "wire.ts" }),
				" consumes ",
				createVNode(_components.code, { children: "useEntry(activeHost)" }),
				" (per-tab signal + ",
				createVNode(_components.code, { children: "sessionStorage" }),
				"); the selector strip + urgency chips + add/remove buttons render ",
				createVNode(_components.strong, { children: "only when the gate cell says the env is set" }),
				" (server publishes the gate as a cell — the client never reads env); rejection/removal fallback is app policy reading ",
				createVNode(_components.code, { children: "entries" }),
				". No Labs entry; no persisted ",
				createVNode(_components.code, { children: "recentHosts" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The #1708 lessons re-land clean-room" }),
				" (no cherry-pick — the anti-regurgitation rule): its pins are the checklist (lazy drv boot, ",
				createVNode(_components.code, { children: "UnremovableHostError" }),
				", shared local scan, dialog clarity, toast ordering), the code re-derived against the map shape; anything copied verbatim must individually justify itself."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Done-criteria naming the paths" }),
				": switch mid-stream (old key’s subs release, new key’s populate synchronously); boot with a dead host in the env seed (chip ",
				createVNode(_components.code, { children: "failed" }),
				", canvas fine, fallback policy reads a value); remove-active-host from another tab (typed end → fallback); gate off (env unset) → zero multi-host UI rendered; two hosts’ chips ticking on two hosts’ clocks with per-entry offsets; dedup observable (two views of one cell = one upstream sub in server count); no socket-error frame after a typed end."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The one-socket ops question — RESOLVED by product ruling (srid, 2026-07-08), not by measurement" }), ": the debate’s storm/HOL concerns were fleet-scale concerns misapplied to a few-hosts product — padi/kaval persist all state, so a socket blip is views re-hydrating through honest pending states (nothing lost), and head-of-line is noise at status-cell/urgency-count frame sizes. The measurement campaign is cancelled; one simple recovery check rides the user pass (kill the ws mid-session → honest degrade → live recovery, no refresh). Per-host sockets remain re-introducible under the same map API if scale ever demands — the notion is transport-agnostic, which is the point of it."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The drishti PR — adoption as deletion." }),
			" ",
			createVNode(_components.code, { children: "hostRegistry.ts" }),
			" + ",
			createVNode(_components.code, { children: "admin-surface.ts" }),
			" replaced by map consumption; behavior parity (tab strip, fleet cards, add/remove/reconnect, ",
			createVNode(_components.code, { children: "?host=" }),
			" deep links); acceptance = the deletion diff + parity screenshots. This is the pairing PR the surface gate requires, made substantive."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Risks, named with mitigations" }),
			": ",
			createVNode(_components.em, { children: "dedup input-hashing" }),
			" — stable-stringify only zod-validated static inputs, throw on functions; ",
			createVNode(_components.em, { children: "end-vs-error ordering on removal" }),
			" — the map completes streams before the registry destroys the session (pinned above); ",
			createVNode(_components.em, { children: "chip fan-out cost" }),
			" — bounded by pool size and the urgency-count wire rule (W5), measured in the PR."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Both PRs run the full gauntlet — the C1–C7 checks first (C2 reads every new export from the consumer’s chair; this design exists because that chair was empty last time), then lens/codex/simplify/police, then ",
			createVNode(_components.code, { children: "/perfection-review" }),
			" against the invariant table above: for each row, either cite the structural mechanism or construct the defect — no “acceptable for scope”."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
function _missingMdxReference(id, component) {
	throw new Error("Expected " + (component ? "component" : "object") + " `" + id + "` to be defined: you likely forgot to import, pass, or provide it.");
}
var frontmatter = {
	"title": "remoteSurfaces — a keyed map of remote surfaces (W4, redesigned)",
	"description": "The switch rebuilt on a first-class surface notion — a dynamic keyed map of re-served remote surfaces, N-active by construction — unifying the two hand-rolled implementations of the pattern (kolu's closed",
	"parents": [
		"padi",
		"feature",
		"surface"
	],
	"status": "accepted",
	"maturity": "seedling",
	"updated": "2026-07-06T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "user-facing-description",
			"text": "User-facing description"
		},
		{
			"depth": 2,
			"slug": "architecture-level-changes",
			"text": "Architecture-level changes"
		},
		{
			"depth": 3,
			"slug": "packaging-kolusurface-map-its-own-package",
			"text": "Packaging: @kolu/surface-map, its own package"
		},
		{
			"depth": 3,
			"slug": "the-notion-in-25-lines--kolus-actual-usage-not-a-toy-map-api-indicative-the-padi-cells-are-real-code",
			"text": "The notion in ~25 lines — kolu’s ACTUAL usage, not a toy (map API indicative; the padi cells are real code)"
		},
		{
			"depth": 3,
			"slug": "the-invariant-table-perfection-bar-each-defect-class-inexpressible",
			"text": "The invariant table (perfection bar: each defect class inexpressible)"
		},
		{
			"depth": 2,
			"slug": "implementation-details",
			"text": "Implementation details"
		}
	];
}
var url = "src/content/atlas/remote-surfaces.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/remote-surfaces.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/remote-surfaces.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
