import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/diagrams/surface-map-101-shape.svg?raw
var surface_map_101_shape_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 920 400\" font-family=\"system-ui, sans-serif\">\n  <rect width=\"920\" height=\"400\" fill=\"#0f1117\"/>\n  <!-- lanes -->\n  <text x=\"90\" y=\"30\" fill=\"#8b95a7\" font-size=\"13\" font-weight=\"600\">REMOTE HOSTS</text>\n  <text x=\"330\" y=\"30\" fill=\"#8b95a7\" font-size=\"13\" font-weight=\"600\">SERVER — the map</text>\n  <text x=\"640\" y=\"30\" fill=\"#8b95a7\" font-size=\"13\" font-weight=\"600\">BROWSER — the client</text>\n\n  <!-- hosts -->\n  <g>\n    <rect x=\"30\" y=\"60\" width=\"150\" height=\"44\" rx=\"8\" fill=\"#1a2130\" stroke=\"#2dd4a7\" stroke-width=\"1.5\"/>\n    <text x=\"105\" y=\"80\" fill=\"#e6eaf2\" font-size=\"13\" text-anchor=\"middle\">local</text>\n    <text x=\"105\" y=\"96\" fill=\"#8b95a7\" font-size=\"11\" text-anchor=\"middle\">padi (same box)</text>\n    <rect x=\"30\" y=\"120\" width=\"150\" height=\"44\" rx=\"8\" fill=\"#1a2130\" stroke=\"#e8b44c\" stroke-width=\"1.5\"/>\n    <text x=\"105\" y=\"140\" fill=\"#e6eaf2\" font-size=\"13\" text-anchor=\"middle\">srid@zest</text>\n    <text x=\"105\" y=\"156\" fill=\"#8b95a7\" font-size=\"11\" text-anchor=\"middle\">padi over ssh</text>\n    <rect x=\"30\" y=\"180\" width=\"150\" height=\"44\" rx=\"8\" fill=\"#1a2130\" stroke=\"#e05252\" stroke-width=\"1.5\" stroke-dasharray=\"5 3\"/>\n    <text x=\"105\" y=\"200\" fill=\"#e6eaf2\" font-size=\"13\" text-anchor=\"middle\">naiveintent</text>\n    <text x=\"105\" y=\"216\" fill=\"#8b95a7\" font-size=\"11\" text-anchor=\"middle\">failed(cause)</text>\n  </g>\n\n  <!-- server map -->\n  <rect x=\"250\" y=\"52\" width=\"270\" height=\"240\" rx=\"10\" fill=\"#141925\" stroke=\"#3d4a63\" stroke-width=\"1.5\"/>\n  <text x=\"385\" y=\"76\" fill=\"#e6eaf2\" font-size=\"13\" font-weight=\"600\" text-anchor=\"middle\">serveSurfaceMap</text>\n  <rect x=\"268\" y=\"90\" width=\"234\" height=\"52\" rx=\"6\" fill=\"#1a2130\" stroke=\"#5b8def\"/>\n  <text x=\"385\" y=\"110\" fill=\"#9db4e8\" font-size=\"12\" text-anchor=\"middle\">MapRegistry</text>\n  <text x=\"385\" y=\"128\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">members · subscribe · resolve ⇒ session | fault</text>\n  <rect x=\"268\" y=\"152\" width=\"234\" height=\"52\" rx=\"6\" fill=\"#1a2130\" stroke=\"#5b8def\"/>\n  <text x=\"385\" y=\"172\" fill=\"#9db4e8\" font-size=\"12\" text-anchor=\"middle\">entries: Collection&lt;Key, EntryStatus&gt;</text>\n  <text x=\"385\" y=\"190\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">warming · connected(clockOffset) · failed(cause)</text>\n  <rect x=\"268\" y=\"214\" width=\"234\" height=\"52\" rx=\"6\" fill=\"#1a2130\" stroke=\"#3d4a63\"/>\n  <text x=\"385\" y=\"234\" fill=\"#c8d0de\" font-size=\"12\" text-anchor=\"middle\">one session per member key</text>\n  <text x=\"385\" y=\"252\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">membership = the registry's word, nothing else</text>\n\n  <!-- host->server arrows -->\n  <g stroke=\"#3d4a63\" stroke-width=\"1.5\" fill=\"none\">\n    <path d=\"M182 82 C 215 82, 220 100, 248 105\"/>\n    <path d=\"M182 142 C 215 142, 220 150, 248 160\"/>\n    <path d=\"M182 202 C 215 202, 220 230, 248 236\" stroke-dasharray=\"5 3\"/>\n  </g>\n\n  <!-- the one socket -->\n  <rect x=\"540\" y=\"140\" width=\"60\" height=\"60\" rx=\"30\" fill=\"#1a2130\" stroke=\"#c07ae8\" stroke-width=\"1.5\"/>\n  <text x=\"570\" y=\"165\" fill=\"#dbb8f0\" font-size=\"11\" text-anchor=\"middle\">ONE</text>\n  <text x=\"570\" y=\"180\" fill=\"#dbb8f0\" font-size=\"11\" text-anchor=\"middle\">socket</text>\n  <path d=\"M522 170 L 538 170\" stroke=\"#c07ae8\" stroke-width=\"1.5\"/>\n  <path d=\"M602 170 L 618 170\" stroke=\"#c07ae8\" stroke-width=\"1.5\"/>\n  <text x=\"570\" y=\"222\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">every frame enveloped</text>\n  <text x=\"570\" y=\"236\" fill=\"#c8d0de\" font-size=\"10.5\" text-anchor=\"middle\">{ mapKey, input }</text>\n\n  <!-- client -->\n  <rect x=\"620\" y=\"52\" width=\"270\" height=\"240\" rx=\"10\" fill=\"#141925\" stroke=\"#3d4a63\" stroke-width=\"1.5\"/>\n  <text x=\"755\" y=\"76\" fill=\"#e6eaf2\" font-size=\"13\" font-weight=\"600\" text-anchor=\"middle\">map client</text>\n  <rect x=\"638\" y=\"90\" width=\"234\" height=\"52\" rx=\"6\" fill=\"#1a2130\" stroke=\"#2dd4a7\"/>\n  <text x=\"755\" y=\"110\" fill=\"#7fe3c3\" font-size=\"12\" text-anchor=\"middle\">entries (bound collection)</text>\n  <text x=\"755\" y=\"128\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">absence = not in the map — no \"absent\" arm</text>\n  <rect x=\"638\" y=\"152\" width=\"234\" height=\"52\" rx=\"6\" fill=\"#1a2130\" stroke=\"#2dd4a7\"/>\n  <text x=\"755\" y=\"172\" fill=\"#7fe3c3\" font-size=\"12\" text-anchor=\"middle\">per-key singleton slots</text>\n  <text x=\"755\" y=\"190\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">(proc, input) dedup · last-listener eviction</text>\n  <rect x=\"638\" y=\"214\" width=\"234\" height=\"52\" rx=\"6\" fill=\"#1a2130\" stroke=\"#e8b44c\"/>\n  <text x=\"755\" y=\"234\" fill=\"#f0d49b\" font-size=\"12\" text-anchor=\"middle\">useEntry(activeHost)</text>\n  <text x=\"755\" y=\"252\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">which key is active = APP policy, not framework</text>\n\n  <!-- bottom moral -->\n  <rect x=\"250\" y=\"320\" width=\"640\" height=\"52\" rx=\"8\" fill=\"#141925\" stroke=\"#3d4a63\"/>\n  <text x=\"570\" y=\"342\" fill=\"#c8d0de\" font-size=\"12\" text-anchor=\"middle\">The framework owns the KEYED volatility: membership, per-key lifecycles, dedup, honest per-key status.</text>\n  <text x=\"570\" y=\"360\" fill=\"#8b95a7\" font-size=\"12\" text-anchor=\"middle\">The app owns POLICY: which keys exist (the gate) and which one the canvas shows (activeHost).</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/surface-map-101.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		blockquote: "blockquote",
		code: "code",
		em: "em",
		h2: "h2",
		li: "li",
		p: "p",
		pre: "pre",
		span: "span",
		strong: "strong",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"This is the companion to ",
			createVNode(_components.a, {
				href: "surface-hosting-101.html",
				children: "the hosting side, taught"
			}),
			". That note taught how ",
			createVNode(_components.strong, { children: "one" }),
			" surface crosses a machine. This note teaches the layer ",
			createVNode($$PrLink, { pr: 1714 }),
			" added above it: ",
			createVNode(_components.strong, { children: "many" }),
			" surfaces of the same type, keyed by host, changing membership at runtime, consumed over ",
			createVNode(_components.strong, { children: "one" }),
			" socket — ",
			createVNode(_components.code, { children: "@kolu/surface-map" }),
			". It replaces the earlier client-half note (“binding-101”): the interim W4 API that note taught (",
			createVNode(_components.code, { children: "createActiveConnectionManager" }),
			", ",
			createVNode(_components.code, { children: "connectionScoped" }),
			", ",
			createVNode(_components.code, { children: "bindingScoped" }),
			") was deleted by the surface-map redesign, and this note teaches what shipped instead.",
			createVNode($$Footnote, { children: [
				"The deleted manager owned “N connections, exactly one active, retire on switch.” The redesign inverted the ownership: the framework owns the ",
				createVNode(_components.em, { children: "keyed map" }),
				" (membership, per-key lifecycle, dedup), and “which key is active” became ",
				createVNode(_components.strong, { children: "app policy" }),
				" — kolu’s ",
				createVNode(_components.code, { children: "activeHost" }),
				" signal, drishti’s tab strip. That inversion is why drishti could adopt the map by ",
				createVNode(_components.em, { children: "deleting" }),
				" its own host registry rather than adapting to a manager’s opinions."
			] })
		] }),
		"\n",
		createVNode($$Svg, {
			svg: surface_map_101_shape_default,
			wide: true,
			caption: "One surface type, N keyed instances. The server folds every member behind one socket with enveloped frames; the client re-derives per-key facts from the entries collection. The framework owns the keyed volatility; the app owns which keys exist and which one it shows."
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-volatility-being-tamed",
			children: "The volatility being tamed"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A multi-host client faces one hard problem: ",
			createVNode(_components.strong, { children: "N same-shaped remote surfaces whose set changes while you watch" }),
			". Hosts get added and removed at runtime; each has its own connection lifecycle (warming, live, dropped, refused); every fact on the wire is true ",
			createVNode(_components.em, { children: "of one host" }),
			"; and the UI must never show host A’s data under host B’s name. None of that is kolu-specific — drishti’s fleet dashboard faces exactly the same thing — so it lives in the framework. What stays out of the framework is just as deliberate: ",
			createVNode(_components.em, { children: "which" }),
			" hosts exist (kolu gates that behind ",
			createVNode(_components.code, { children: "KOLU_PADI_HOST" }),
			") and ",
			createVNode(_components.em, { children: "which one" }),
			" the canvas shows (",
			createVNode(_components.code, { children: "activeHost" }),
			") are policy, one signal each, in app code."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "defining-a-map-one-surface-type-keyed-instances",
			children: "Defining a map: one surface type, keyed instances"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "defineSurfaceMap({ key, codec, entry, failure })" }),
			" produces the ",
			createVNode(_components.em, { children: "map" }),
			" form of a surface: every member’s input gains a key, so one socket can carry all instances. The ordinary surface definition — the same cells/collections/procedures the hosting note taught — goes in through ",
			createVNode(_components.code, { children: "entry" }),
			"; ",
			createVNode(_components.code, { children: "key" }),
			"/",
			createVNode(_components.code, { children: "codec" }),
			" brand and (de)serialize the member key; and ",
			createVNode(_components.code, { children: "failure" }),
			" ",
			createVNode($$PrLink, { pr: 1804 }),
			" is the domain schema that validates the value on a failed entry (",
			createVNode(_components.code, { children: "Failure" }),
			" is inferred from it, so a domain map needs no explicit type argument). The mechanics:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The fold envelope." }),
				" Each member’s input is wrapped as ",
				createVNode(_components.code, { children: "{ mapKey, input }" }),
				" — the fold is mechanical and type-preserving, and a ",
				createVNode(_components.strong, { children: [
					"void-input member carries no ",
					createVNode(_components.code, { children: "input" }),
					" key at all"
				] }),
				".",
				createVNode($$Footnote, { children: [
					"That last clause is load-bearing, learned the hard way: ",
					createVNode(_components.code, { children: "{ input: undefined }" }),
					" doesn’t survive JSON (the key is dropped), and whether a validator accepts the missing key turned out to be a ",
					createVNode(_components.strong, { children: "zod version mood" }),
					" — drishti’s lockfile floated to zod 4.4.x, which rejects it, and every void-input cell in its fleet view went dark while kolu’s 4.3.6 shrugged. The fix made the fold emit ",
					createVNode(_components.em, { children: "no" }),
					" key for void members — one representation, no dependence on the validator’s leniency — and drishti unpinned zod and re-proved itself on the once-breaking version."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The key codec." }),
				" Keys are branded, not strings-by-convention: kolu’s ",
				createVNode(_components.code, { children: "HostKey" }),
				" is a sum (",
				createVNode(_components.code, { children: "{kind:\"local\"} | {kind:\"remote\", target}" }),
				") with one codec (",
				createVNode(_components.code, { children: "local" }),
				" / ",
				createVNode(_components.code, { children: "remote:<target>" }),
				" on the wire) and a canonicalizing cache so the same host is always the same object identity. Parsing human input (",
				createVNode(_components.code, { children: "localhost" }),
				", ",
				createVNode(_components.code, { children: "127.0.0.1" }),
				", ",
				createVNode(_components.code, { children: "user@host" }),
				") is a ",
				createVNode(_components.strong, { children: "separate boundary" }),
				" from decoding canonical wire keys — two functions, so a loose parse can never leak into the wire vocabulary."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "entries--the-one-membership-authority",
			children: [createVNode(_components.code, { children: "entries" }), " — the one membership authority"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The map publishes a single collection: ",
			createVNode(_components.code, { children: "entries: Collection<Key, EntryStatus<Failure>>" }),
			". Two design commitments do most of the work:"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Absence means absence." }),
			" A key not in ",
			createVNode(_components.code, { children: "entries" }),
			" is ",
			createVNode(_components.em, { children: "not in the map" }),
			" — there is no ",
			createVNode(_components.code, { children: "\"absent\"" }),
			" status arm, because a collection already expresses absence by not containing the key. (The client-side fold adds an explicit ",
			createVNode(_components.code, { children: "not-a-member" }),
			" value when ",
			createVNode(_components.em, { children: "you" }),
			" ask about a key that isn’t there, so reads stay total — but the wire never carries it.)"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The status sum is small and honest." }),
			" ",
			createVNode(_components.code, { children: "EntryStatus<Failure>" }),
			" has exactly three arms:"
		] }),
		"\n",
		createVNode(_components.pre, {
			class: "astro-code github-light",
			style: {
				backgroundColor: "#fff",
				color: "#24292e",
				overflowX: "auto"
			},
			tabindex: "0",
			"data-language": "ts",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "|"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"warming\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "membershipId"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": string }                          "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// in motion — coming up, or coming back on its own"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "|"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"connected\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "membershipId"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": string; "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "clockOffset"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": number "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "|"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " null"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " } "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// live (link-liveness); offset null = not-yet-measured"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "|"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"failed\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "membershipId"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": string; "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "failure"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": Failure }         "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// NOT proceeding without intervention"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Every arm carries a ",
			createVNode(_components.code, { children: "membershipId" }),
			" — an opaque, never-reused identity stamped when the key is added. A same-key remove/re-add mints a ",
			createVNode(_components.em, { children: "new" }),
			" one, so a client keys owners on ",
			createVNode(_components.code, { children: "{key, membershipId}" }),
			" and never mistakes a fresh occupant for the old one."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The arm meanings are a ",
			createVNode(_components.strong, { children: "projection contract" }),
			", not vibes: ",
			createVNode(_components.code, { children: "warming" }),
			" = the system is doing something and will resolve on its own (first provision ",
			createVNode(_components.em, { children: "and" }),
			" a transient reconnect-backoff both land here); ",
			createVNode(_components.code, { children: "failed" }),
			" = it will ",
			createVNode(_components.em, { children: "not" }),
			" resolve without someone acting (a terminal give-up, or a ",
			createVNode(_components.em, { children: "standing refuse" }),
			" like “another kolu owns this host’s padi”).",
			createVNode($$Footnote, { children: [
				"Both halves of that contract were paid for in blood the week this shipped. First a retriable reconnect window rendered as a steady red “failed” chip (indistinguishable from dead — the architecture review’s one confirmed defect); the fix over-corrected, and standing refuses got masked as an eternal “Connecting…” spinner. The settled contract discriminates the session’s down state by its ",
				createVNode(_components.strong, { children: "domain cause" }),
				": a specific cause (cross-supervisor, contract-skew) is a standing condition → ",
				createVNode(_components.code, { children: "failed" }),
				" + an actionable card; no specific cause is a transient drop → ",
				createVNode(_components.code, { children: "warming" }),
				". The invariant “every refuse verdict carries a specific cause” is pinned at the session layer so the discrimination can’t rot."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "Failure" }),
			" is a ",
			createVNode(_components.strong, { children: "type parameter, not a baked-in list" }),
			" — the generic package doesn’t know padi’s failure taxonomy; kolu instantiates ",
			createVNode(_components.code, { children: "EntryStatus<PadiEntryFailure>" }),
			" (a ",
			createVNode(_components.code, { children: "z.discriminatedUnion" }),
			" on a structural ",
			createVNode(_components.code, { children: "cause" }),
			") and attaches domain extras (the typed ",
			createVNode(_components.code, { children: "running" }),
			"/",
			createVNode(_components.code, { children: "expected" }),
			" version pair on the contract-skew arm) inside that schema-validated failure, not a loose object. The map validates the failure against the map’s own ",
			createVNode(_components.code, { children: "failure" }),
			" schema — an unclassifiable producer fails loud rather than publishing a fabricated catch-all. That’s the volatility-boundary rule applied to a type: domain vocabulary stays in the domain."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "reading-one-entry-entrykey-and-useentry",
			children: [
				"Reading one entry: ",
				createVNode(_components.code, { children: "entry(key)" }),
				" and ",
				createVNode(_components.code, { children: "useEntry" })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "entry(key)" }),
			" is a ",
			createVNode(_components.strong, { children: "total lens" }),
			" — ask about any key, get an honest answer (",
			createVNode(_components.code, { children: "not-a-member" }),
			" included). ",
			createVNode(_components.code, { children: "useEntry(keyAccessor)" }),
			" is its Solid form: hand it a ",
			createVNode(_components.em, { children: "reactive" }),
			" key (kolu hands it ",
			createVNode(_components.code, { children: "activeHost" }),
			") and every read re-keys when the key changes — ",
			createVNode(_components.em, { children: "and" }),
			" on a same-key membership replacement (the ",
			createVNode(_components.code, { children: "membershipId" }),
			" above changes), so a remove/re-add under the same key rebuilds the subscription rather than silently retaining the departed owner’s. This is the load-bearing consumer pattern in kolu — every per-host fact the UI shows (daemon status, identity, the canvas’s connection state) reads through ",
			createVNode(_components.code, { children: "useEntry(activeHost)" }),
			", which is what makes “switch the chip, every readout follows” true by wiring rather than by discipline."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Underneath sits the ",
			createVNode(_components.strong, { children: "keyed subscription cache" }),
			": one singleton slot per ",
			createVNode(_components.code, { children: "(procedure, stable-input-hash)" }),
			", so ten components reading the same host’s daemon status share one wire subscription; the last listener’s disposal evicts the slot; and a slot’s lifetime is tied to the key’s ",
			createVNode(_components.strong, { children: "membership" }),
			" — remove the host and its subscriptions end with a ",
			createVNode(_components.em, { children: "typed" }),
			" end (",
			createVNode(_components.code, { children: "{reason: \"removed\"}" }),
			"), not an error toast.",
			createVNode($$Footnote, { children: [
				"The teardown invariant survives from the old note because it’s timeless: ",
				createVNode(_components.em, { children: "a disposed subscription cannot report anything." }),
				" Its modern regression was subtle — a leak fix routed reads through a shared root but left one path that could subscribe ",
				createVNode(_components.strong, { children: "ownerless" }),
				", resurrecting undisposable subscriptions; the fix pins every read under a real owner (",
				createVNode(_components.code, { children: "runUnderOwner" }),
				"), and the “unknown daemon dialog” bug it caused is why the pin exists."
			] })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "serving-a-map-servesurfacemap-and-the-mapregistry-seam",
			children: [
				"Serving a map: ",
				createVNode(_components.code, { children: "serveSurfaceMap" }),
				" and the ",
				createVNode(_components.code, { children: "MapRegistry" }),
				" seam"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The server side takes an explicit ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "MapRegistry" }) }),
			" — ",
			createVNode(_components.code, { children: "members" }),
			" / ",
			createVNode(_components.code, { children: "subscribe" }),
			" / ",
			createVNode(_components.code, { children: "has" }),
			" / ",
			createVNode(_components.code, { children: "resolve(key) ⇒ EntrySession | EntryFault" }),
			" (a ",
			createVNode(_components.code, { children: "kind" }),
			"-tagged sum, so the two arms are provably disjoint). Membership must be ",
			createVNode(_components.em, { children: "observable" }),
			" (the registry’s subscribe drives ",
			createVNode(_components.code, { children: "entries" }),
			"), and status is a ",
			createVNode(_components.strong, { children: "projection of session state" }),
			" — there is no second writer. kolu’s instance is ",
			createVNode(_components.code, { children: "serveHostMap" }),
			" (sessions from ",
			createVNode(_components.code, { children: "@kolu/surface-remote" }),
			", failures classified via a ",
			createVNode(_components.code, { children: "failureOf" }),
			" hook); drishti proved the seam’s width by adapting its own pre-existing host registry to ",
			createVNode(_components.code, { children: "MapRegistry" }),
			" in one file. Clock stays per-entry: ",
			createVNode(_components.code, { children: "connected.clockOffset" }),
			" is ",
			createVNode(_components.em, { children: "that host’s" }),
			" clock seam, and a consumer reprojects remote timestamps through it — never through its own wall clock."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-survived-what-died-and-the-moral",
			children: "What survived, what died, and the moral"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Survived:" }),
			" ",
			createVNode(_components.code, { children: "createKeyedRoot" }),
			" (the dispose-on-key-change atom — still under everything that re-keys), the shared-singleton reading pattern (now ",
			createVNode(_components.em, { children: "inside" }),
			" the cache instead of at call sites), and the teardown invariant. ",
			createVNode(_components.strong, { children: "Died:" }),
			" the active-connection manager and its whole vocabulary — retire-on-switch, pick epochs, ",
			createVNode(_components.code, { children: "bindingScoped" }),
			" — because once the framework owns a keyed map and the app owns one ",
			createVNode(_components.code, { children: "activeHost" }),
			" signal, “switching” stops being machinery and becomes ",
			createVNode(_components.em, { children: "changing which key you read" }),
			". The moral, which is also the test for the next addition: ",
			createVNode(_components.strong, { children: "the framework owns keyed volatility; the app owns policy." }),
			" If a proposed framework feature encodes an opinion about which key matters, it’s policy wearing a framework costume."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The consumers as proof." }),
			" kolu consumes the map unconditionally (the always-map wire — the gate only controls whether the UI offers more than ",
			createVNode(_components.code, { children: "local" }),
			"). drishti adopted it by ",
			createVNode(_components.strong, { children: "deletion" }),
			" (its hand-rolled host membership replaced by the map; net shrink in the core files). odu consumes only ",
			createVNode(_components.code, { children: "@kolu/surface-remote" }),
			" — the boundary between “keyed map” and “remote session” is cut so that taking one without the other is natural. Two-and-a-half consumers, no escape hatches: the framework earned the noun."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "where-this-goes-next-per-host-state-by-ownership-w7",
			children: [
				"Where this goes next: per-host state by ",
				createVNode(_components.em, { children: "ownership" }),
				" (W7)"
			]
		}),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "Shipped (2026-07-08)." }),
				" This section is the framework design; it landed as kolu padi W7 (branch ",
				createVNode(_components.code, { children: "w7-per-host-ownership" }),
				") + the ",
				createVNode(_components.a, {
					href: "https://github.com/srid/drishti/pull/91",
					children: createVNode(_components.code, { children: "srid/drishti#91" })
				}),
				" pair. Two corrections the implementation settled: ",
				createVNode(_components.code, { children: "scopedByEntry" }),
				" lives at ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/surface-map/client" }) }),
				" (the client half is inherently Solid — there is no ",
				createVNode(_components.code, { children: "/solid" }),
				" subpath), and its ",
				createVNode(_components.code, { children: "active" }),
				" accessor is ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "Accessor<K | null>" }) }),
				" (the fleet / no-host slot is a real inhabitant, floored to the empty view, not a bug). The map now also exports ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "codec" }) }),
				" — the key ",
				createVNode(_components.code, { children: "encode" }),
				" the scope keys its ",
				createVNode(_components.code, { children: "keyArray" }),
				" on. See ",
				createVNode(_components.a, {
					href: "padi.html#w7",
					children: "padi § W7"
				}),
				" for the phase status + what W7 consciously excluded."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Everything above keys the ",
			createVNode(_components.strong, { children: "wire" }),
			" reads. The remaining hole is the client’s ",
			createVNode(_components.strong, { children: "own" }),
			" state — and W4 shipped a bug family proving it: the focused terminal, the split layout, and the camera each quietly lived at app lifetime while the tiles around them became per-host, found one at a time by switching hosts live (",
			createVNode(_components.a, {
				href: "padi.html#w7",
				children: "padi W7"
			}),
			" is the ratified phase; this section is the framework design it will land)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"Why ",
				createVNode(_components.code, { children: "useEntry" }),
				" can’t be the answer."
			] }),
			" ",
			createVNode(_components.code, { children: "useEntry" }),
			" is built on ",
			createVNode(_components.code, { children: "createKeyedRoot" }),
			", whose contract is ",
			createVNode(_components.em, { children: "dispose-on-key-change" }),
			" — on a switch it synchronously tears down the old key’s root and rebuilds (that ordering is what makes swaps leak-free for ",
			createVNode(_components.em, { children: "wire" }),
			" subscriptions, which are cheap to re-open). App state needs the opposite lifetime: ",
			createVNode(_components.strong, { children: "retained on switch-away, restored on switch-back, disposed only when the host leaves the map" }),
			". Today kolu fakes that with an enumerated record (",
			createVNode(_components.code, { children: "useViewState" }),
			"’s ",
			createVNode(_components.code, { children: "HostView = {activeId, mruOrder, attention}" }),
			", swapped by hand at the switch seam) — and ",
			createVNode(_components.em, { children: "enumeration is the bug" }),
			": the camera was a forgotten field, and nothing asks a new ",
			createVNode(_components.code, { children: "createSignal" }),
			" which axis it lives on."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The primitive is not ours to write" }),
			" — the ecosystem survey (mandatory after ",
			createVNode(_components.code, { children: "createKeyedRoot" }),
			" turned out to be ",
			createVNode(_components.code, { children: "mapArray" }),
			" in a trenchcoat) found it: ",
			createVNode(_components.a, {
				href: "https://primitives.solidjs.community/package/keyed",
				children: createVNode(_components.code, { children: "@solid-primitives/keyed" })
			}),
			"’s ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "keyArray" }) }),
			" already has exactly the retained-owner contract — ",
			createVNode(_components.em, { children: "a key that persists keeps its reactive root even as data changes; the root is disposed when the key leaves the source list" }),
			". Retained across switches, disposed on membership exit. So layer 1 is ",
			createVNode(_components.code, { children: "keyArray" }),
			" over the map’s member list plus a small ",
			createVNode(_components.code, { children: "get(key)" }),
			" index — a dependency, not an invention.",
			createVNode($$Footnote, { children: [
				"The near-miss worth recording: ",
				createVNode(_components.code, { children: "rootless" }),
				"’s ",
				createVNode(_components.code, { children: "createRootPool" }),
				" (already a dependency) passes its factory an ",
				createVNode(_components.code, { children: "active" }),
				" signal — the exact ",
				createVNode(_components.code, { children: "ScopeCtx.isActive" }),
				" ergonomic — but a ",
				createVNode(_components.em, { children: "pool" }),
				" reuses roots by availability across different args, so per-",
				createVNode(_components.em, { children: "key" }),
				" state retention isn’t its contract. Right shape, wrong lifetime model; ",
				createVNode(_components.code, { children: "keyArray" }),
				" keys by identity, which is the lifetime W7 needs."
			] }),
			" What remains framework work is only the map-tied glue (",
			createVNode(_components.code, { children: "@kolu/surface-map/client" }),
			"):"
		] }),
		"\n",
		createVNode(_components.pre, {
			class: "astro-code github-light",
			style: {
				backgroundColor: "#fff",
				color: "#24292e",
				overflowX: "auto"
			},
			tabindex: "0",
			"data-language": "ts",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// Layer 2: membership drives the key set (via keyArray); \"active\" stays app policy."
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "scopedByEntry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "K"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "T"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">(map: SurfaceMapClient"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "…"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ">"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", active: Accessor"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "K"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " null"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ">"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ","
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "                    build: ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "key"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " K"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "ctx"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "isActive"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Accessor"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "boolean"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "> }) "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " T"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "): {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  active: Accessor"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "T"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ">"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";              "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// the active key's world — re-keys on switch"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  get"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(key: "
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "K"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "): "
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "T"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " undefined"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";       "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// background peek (attention rollups, W5)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "}"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The load-bearing line: ",
			createVNode(_components.strong, { children: [
				"the owner’s lifetime is ",
				createVNode(_components.code, { children: "entries" }),
				" membership"
			] }),
			" — the same authority that ends a removed host’s subscriptions disposes its state world; no second lifecycle to reconcile. And ",
			createVNode(_components.code, { children: "ctx.isActive" }),
			" is where the active-only discipline (WebGL release/re-acquire, center-on-activate) stops being a bridge between two independently-timed lifecycles — the camera’s post-mortem showed such a bridge is a race a guard narrows but never closes; inside the scope the ordering is intrinsic."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "kolu adopts it" }), " by dissolving the enumeration:"] }),
		"\n",
		createVNode(_components.pre, {
			class: "astro-code github-light",
			style: {
				backgroundColor: "#fff",
				color: "#24292e",
				overflowX: "auto"
			},
			tabindex: "0",
			"data-language": "ts",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "export"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " hostScopes"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " scopedByEntry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(padiMap, activeHost, ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "host"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "ctx"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ") "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ({"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  view: "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "createViewState"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(),          "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// activeId / mru / attention — plain signals now"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  camera: "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "createCamera"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(ctx),        "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// born per-host; centers on ctx.isActive"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  tiles: "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "createTileStore"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(host),"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  restore: "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "createSessionRestore"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(host),"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "}));"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "hostScopes."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "active"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "().view.activeId; "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// always the ACTIVE host's — by construction"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The ",
			createVNode(_components.code, { children: "HostView" }),
			" record, ",
			createVNode(_components.code, { children: "ensureHost" }),
			", the hand-swap at the seam, the per-host restore latches — deleted. A future dev’s bare ",
			createVNode(_components.code, { children: "createSignal" }),
			" inside ",
			createVNode(_components.code, { children: "build" }),
			" is per-host with zero ceremony; a slim boundary test (no module-scope state constructors in the host/canvas domain) fences the one place ownership can’t reach."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "drishti adopts it" }),
			" for a different prize. Its per-host view state (e.g. ",
			createVNode(_components.code, { children: "selectedPid" }),
			", the process expanded in a host’s detail panel) is already ",
			createVNode(_components.em, { children: "safe" }),
			" — but by hand-rolled discipline: documented-ephemeral, cleared by an effect when the pid leaves the live set, and simply ",
			createVNode(_components.strong, { children: "lost" }),
			" on every tab switch. Under ",
			createVNode(_components.code, { children: "scopedByEntry(hostMap, selectedHost, …)" }),
			" each host’s selection/sort/expansion ",
			createVNode(_components.strong, { children: "survives tab-away and restores verbatim" }),
			" (the shape-B behavior kolu’s users already have), the manual clearing effect dissolves into the scope’s disposal, and a removed host’s view state dies with its subscriptions. Same primitive, ",
			createVNode(_components.code, { children: "selectedHost" }),
			" instead of ",
			createVNode(_components.code, { children: "activeHost" }),
			" — the “active” slot staying app policy is the proof it belongs in the framework."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Two settled defaults, one open question." }),
			" Settled: owners are created ",
			createVNode(_components.strong, { children: "lazily" }),
			" (first activation) and retained thereafter — background hosts you never visit cost nothing, and W5’s attention rollups read the ",
			createVNode(_components.em, { children: "wire" }),
			" (the urgency projection), not the scope. Settled: the app-level state that is genuinely host-independent (theme, palette, dialog stack — the audited seventeen) stays outside; nobody scopes the whole app. Open: whether ",
			createVNode(_components.code, { children: "get()" }),
			" should ",
			createVNode(_components.em, { children: "create" }),
			" a scope on background access (an attention badge wanting to write into an unvisited host’s world) — today’s answer is no, revisit when a real consumer demands it."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "The surface framework's client half, taught — what surface-map added",
	"description": "A plain-words primer on @kolu/surface-map — a dynamic keyed map of remote surfaces over one socket — and the client story built on it: the entries membership authority, EntryStatus<Failure>, useEntry, per-key subscription slots, and typed teardown. kolu and drishti appear as the two proving consumers.",
	"parents": [
		"pedagogy",
		"padi",
		"surface"
	],
	"maturity": "budding",
	"updated": "2026-07-08T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-volatility-being-tamed",
			"text": "The volatility being tamed"
		},
		{
			"depth": 2,
			"slug": "defining-a-map-one-surface-type-keyed-instances",
			"text": "Defining a map: one surface type, keyed instances"
		},
		{
			"depth": 2,
			"slug": "entries--the-one-membership-authority",
			"text": "entries — the one membership authority"
		},
		{
			"depth": 2,
			"slug": "reading-one-entry-entrykey-and-useentry",
			"text": "Reading one entry: entry(key) and useEntry"
		},
		{
			"depth": 2,
			"slug": "serving-a-map-servesurfacemap-and-the-mapregistry-seam",
			"text": "Serving a map: serveSurfaceMap and the MapRegistry seam"
		},
		{
			"depth": 2,
			"slug": "what-survived-what-died-and-the-moral",
			"text": "What survived, what died, and the moral"
		},
		{
			"depth": 2,
			"slug": "where-this-goes-next-per-host-state-by-ownership-w7",
			"text": "Where this goes next: per-host state by ownership (W7)"
		}
	];
}
var url = "src/content/atlas/surface-map-101.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-map-101.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-map-101.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
