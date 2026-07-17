import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import "./PrLink_DpwCuibs.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
import { t as $$Footnote } from "./Footnote_Co54bi9w.mjs";
//#region src/diagrams/deep-links-architecture.svg?raw
var deep_links_architecture_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 860 300\" font-family=\"ui-monospace, Menlo, monospace\" font-size=\"13\">\n  <rect width=\"860\" height=\"300\" fill=\"#0d1117\"/>\n  <!-- URL sources -->\n  <rect x=\"20\" y=\"30\" width=\"200\" height=\"34\" rx=\"6\" fill=\"#1f2937\" stroke=\"#58a6ff\"/>\n  <text x=\"120\" y=\"52\" fill=\"#c9d1d9\" text-anchor=\"middle\">link click / bookmark</text>\n  <rect x=\"20\" y=\"76\" width=\"200\" height=\"34\" rx=\"6\" fill=\"#1f2937\" stroke=\"#58a6ff\"/>\n  <text x=\"120\" y=\"98\" fill=\"#c9d1d9\" text-anchor=\"middle\">launchQueue (PWA capture)</text>\n  <rect x=\"20\" y=\"122\" width=\"200\" height=\"34\" rx=\"6\" fill=\"#1f2937\" stroke=\"#58a6ff\"/>\n  <text x=\"120\" y=\"144\" fill=\"#c9d1d9\" text-anchor=\"middle\">hashchange (live)</text>\n  <text x=\"120\" y=\"188\" fill=\"#8b949e\" text-anchor=\"middle\" font-size=\"11\">manifest launch_handler:</text>\n  <text x=\"120\" y=\"203\" fill=\"#8b949e\" text-anchor=\"middle\" font-size=\"11\">focus-existing</text>\n\n  <!-- parser -->\n  <rect x=\"290\" y=\"76\" width=\"220\" height=\"80\" rx=\"8\" fill=\"#161b22\" stroke=\"#3fb950\" stroke-width=\"1.5\"/>\n  <text x=\"400\" y=\"106\" fill=\"#e6edf3\" text-anchor=\"middle\" font-weight=\"bold\">deepLink.ts (leaf)</text>\n  <text x=\"400\" y=\"126\" fill=\"#8b949e\" text-anchor=\"middle\" font-size=\"11\">parse, don't validate</text>\n  <text x=\"400\" y=\"142\" fill=\"#8b949e\" text-anchor=\"middle\" font-size=\"11\">bad → loud toast, never route</text>\n\n  <!-- arrows sources->parser -->\n  <path d=\"M220 47 H255 V116 H290\" stroke=\"#58a6ff\" fill=\"none\"/>\n  <path d=\"M220 93 H290\" stroke=\"#58a6ff\" fill=\"none\"/>\n  <path d=\"M220 139 H255 V116\" stroke=\"#58a6ff\" fill=\"none\"/>\n  <polygon points=\"290,116 280,111 280,121\" fill=\"#58a6ff\"/>\n\n  <!-- existing actions -->\n  <rect x=\"590\" y=\"20\" width=\"250\" height=\"34\" rx=\"6\" fill=\"#1f2937\" stroke=\"#d29922\"/>\n  <text x=\"715\" y=\"42\" fill=\"#c9d1d9\" text-anchor=\"middle\">setActiveHost (binding switch)</text>\n  <rect x=\"590\" y=\"64\" width=\"250\" height=\"34\" rx=\"6\" fill=\"#1f2937\" stroke=\"#d29922\"/>\n  <text x=\"715\" y=\"86\" fill=\"#c9d1d9\" text-anchor=\"middle\">store.activate (tile focus)</text>\n  <rect x=\"590\" y=\"108\" width=\"250\" height=\"34\" rx=\"6\" fill=\"#1f2937\" stroke=\"#d29922\"/>\n  <text x=\"715\" y=\"130\" fill=\"#c9d1d9\" text-anchor=\"middle\">right panel · showCode(path)</text>\n  <rect x=\"590\" y=\"152\" width=\"250\" height=\"34\" rx=\"6\" fill=\"#1f2937\" stroke=\"#d29922\"/>\n  <text x=\"715\" y=\"174\" fill=\"#c9d1d9\" text-anchor=\"middle\">settings dialog</text>\n  <text x=\"715\" y=\"212\" fill=\"#8b949e\" text-anchor=\"middle\" font-size=\"11\">all EXISTING seams — the router adds none</text>\n\n  <!-- arrows parser->actions -->\n  <path d=\"M510 100 H550 V37 H590\" stroke=\"#d29922\" fill=\"none\"/>\n  <path d=\"M510 108 H560 V81 H590\" stroke=\"#d29922\" fill=\"none\"/>\n  <path d=\"M510 124 H560 V125 H590\" stroke=\"#d29922\" fill=\"none\"/>\n  <path d=\"M510 132 H550 V169 H590\" stroke=\"#d29922\" fill=\"none\"/>\n\n  <!-- law strip -->\n  <rect x=\"20\" y=\"240\" width=\"820\" height=\"40\" rx=\"6\" fill=\"#161b22\" stroke=\"#f85149\"/>\n  <text x=\"430\" y=\"264\" fill=\"#f85149\" text-anchor=\"middle\" font-size=\"12\">LAW: a deep link only VIEWS — no URL may create, kill, write, or send. Mutation via URL is unrepresentable (no route exists).</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/deep-links.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
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
	return createVNode(Fragment, { children: [
		createVNode(_components.h2, {
			id: "user-facing-description",
			children: "User-facing description"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Any place that can render a link — the orchestrator dashboard, an issue, a Slack message, a bookmark — can point ",
			createVNode(_components.strong, { children: "into" }),
			" kolu: click it and the installed PWA window comes to the front already showing the right host, terminal, file, or dialog. No PWA? The same URL opens in any browser. The full grammar (v1 ships all of it):"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "URL" }),
					"\n",
					createVNode(_components.th, { children: "what you land on" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "#/h/<host>" }) }),
					"\n",
					createVNode(_components.td, { children: ["the host binding switched to ", createVNode(_components.code, { children: "<host>" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "#/t/<host>/<terminalId>" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"that host ",
						createVNode(_components.strong, { children: "and" }),
						" the terminal tile focused"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "#/t/<host>/<terminalId>/code?path=<p>&line=<n>" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"the terminal’s right panel on the ",
						createVNode(_components.strong, { children: "Code tab" }),
						", ",
						createVNode(_components.code, { children: "<p>" }),
						" open (optionally at line ",
						createVNode(_components.code, { children: "<n>" }),
						")"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "#/t/<host>/<terminalId>/inspector" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"the terminal’s right panel on the ",
						createVNode(_components.strong, { children: "Inspector" }),
						" tab"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "#/settings" }) }),
					"\n",
					createVNode(_components.td, { children: "the settings dialog" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "<host>" }),
			" is the canonical encoded host key (",
			createVNode(_components.code, { children: "encodeHostKey" }),
			" — the local host is ",
			createVNode(_components.code, { children: "local" }),
			"); ",
			createVNode(_components.code, { children: "<terminalId>" }),
			" is the terminal’s UUID.",
			createVNode($$Footnote, { children: [
				"The same two facts every attention-notification click already carries (",
				createVNode(_components.code, { children: "attentionNotify.ts" }),
				"’s ",
				createVNode(_components.code, { children: "AttentionClick" }),
				"), validated the same way: a non-canonical host key or a non-UUID id is dropped, never routed."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: "Behavior on the edges — always loud, never silent:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Target gone" }), " (terminal closed, host removed): a toast names what the link pointed at and that it no longer exists; you land on the nearest surviving ancestor (the host for a dead terminal; home for a dead host)."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Unknown route" }), " (a future grammar, a typo): a toast + home. Old kolu never silently ignores a new link shape."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Links are durable" }), ": unlike a notification click (consumed once, stripped from the URL), a deep link is a bookmark — reload and it re-navigates."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "What no URL can ever do: mutate." }),
			" No route creates a terminal, kills one, writes a file, or sends keys. This is a law, not a review item — the router has no mutating routes to hit, so a hostile link’s worst case is a view change.",
			createVNode($$Footnote, { children: "The classic drive-by risk with URL handlers is a GET that acts. Kolu’s grammar is view-only by construction; any future “action URL” proposal reopens this note’s Decision, not a code review." })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "architecture-level-changes",
			children: "Architecture-level changes"
		}),
		"\n",
		createVNode($$Svg, {
			svg: deep_links_architecture_default,
			wide: true,
			caption: "One new leaf. Three URL entry points (boot, hashchange, PWA launchQueue) feed one parser; every route lands on an EXISTING action seam — host switch, tile focus, right panel, settings. The law strip: mutation is unrepresentable."
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"A leaf in ",
					createVNode(_components.code, { children: "packages/client" }),
					", no new package."
				] }),
				" Parsing a hash and calling four existing actions hides no hard volatility — no transport, no lifetime, no reconnect. The three receptacle tests all say leaf.",
				createVNode($$Footnote, { children: [
					"The nearest electricity is already built: the W5 notification seam (",
					createVNode(_components.code, { children: "@kolu/surface-app/notify" }),
					") owns the genuinely volatile part — service-worker delivery, multi-window dedup, cold-start handoff. Deep links deliberately do NOT ride it: its payload param is consume-once by design (a click must not re-fire on reload), which is the opposite of a bookmark. Same validation ",
					createVNode(_components.em, { children: "pattern" }),
					", different channel."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Reuse, not invention:" }),
				" the route actions are the exact seams W5’s notification click already drives — ",
				createVNode(_components.code, { children: "setActiveHost" }),
				" + ",
				createVNode(_components.code, { children: "store.activate" }),
				" — plus the right panel’s per-terminal ",
				createVNode(_components.code, { children: "showCode" }),
				"/",
				createVNode(_components.code, { children: "showInspector" }),
				" and the settings dialog. The router implements the switch-then-focus ",
				createVNode(_components.strong, { children: "ordering" }),
				" locally in ",
				createVNode(_components.code, { children: "routeToTerminal" }),
				" (host first, then focus — the “id routes against the wrong host” trap ",
				createVNode(_components.code, { children: "useHostAttention" }),
				" first named; the router does not call ",
				createVNode(_components.code, { children: "useHostAttention" }),
				" itself, whose optimistic fire-and-forget is the wrong shape for a gone-verdict route). The router adds ",
				createVNode(_components.strong, { children: "zero" }),
				" new capability, only addressability."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "PWA link capture" }),
				" is manifest configuration, not code: ",
				createVNode(_components.code, { children: "launch_handler: { client_mode: \"focus-existing\" }" }),
				" + the app’s scope makes an in-scope https link focus the already-open PWA window, handing the URL through ",
				createVNode(_components.code, { children: "launchQueue" }),
				". Custom schemes are rejected: a PWA can only register ",
				createVNode(_components.code, { children: "web+" }),
				"-prefixed handlers, and the browser rewrites those to an https URL anyway — pure indirection, dead on uninstalled machines, and it loses the origin (which ",
				createVNode(_components.em, { children: "is" }),
				" the “which kolu instance” fact, load-bearing since srid runs several)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Hash, not path:" }),
				" ",
				createVNode(_components.code, { children: "#/…" }),
				" needs no server routing change (kolu-server keeps serving one page), works file-identically across local/remote origins, and ",
				createVNode(_components.code, { children: "hashchange" }),
				" gives live in-app navigation for free."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "One authority, stated:" }),
				" client state (the tile store, the panel state) is the authority for “current view” — always. The URL is a ",
				createVNode(_components.strong, { children: "command channel" }),
				" into it (DL1), and under DL2 ",
				createVNode(_components.em, { children: "additionally" }),
				" a derived projection of it — never the authority. A route is a request the store may refuse (gone target), not a fact the store must mirror."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["Not ", createVNode(_components.code, { children: "@solidjs/router" })] }),
				" (the C1 question, answered): it has hash mode and the house rule prefers libraries — but its model is route→component-tree, and kolu is a single-canvas app whose routes map to ",
				createVNode(_components.em, { children: "actions" }),
				" (focus this, open that). Adopting it would bolt a page-navigation indirection onto an app with one page. The ~50-line discriminated-union parser + zod validation is the honest fit; this paragraph is the recorded verdict."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Splits are covered, but only if the action is total:" }),
				" a split pane is a ",
				createVNode(_components.em, { children: "sub-terminal" }),
				" with its own ",
				createVNode(_components.code, { children: "TerminalId" }),
				" (one id space — the grammar needs no split syntax), but focusing one is a three-part action: activate the ",
				createVNode(_components.strong, { children: "parent tile" }),
				", select the sub in ",
				createVNode(_components.code, { children: "activeSubTab" }),
				", set ",
				createVNode(_components.code, { children: "focusTarget: \"sub\"" }),
				" (",
				createVNode(_components.code, { children: "TerminalContent.tsx" }),
				"’s pane model). ",
				createVNode(_components.code, { children: "#/t/…/<subId>" }),
				" must resolve that chain — see DL1 step 4a and its pinned test."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "implementation-details",
			children: "Implementation details"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "dl1--the-router--the-full-menu-one-pr",
			children: "DL1 — the router + the full menu (one PR)"
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Manifest:" }),
				" add ",
				createVNode(_components.code, { children: "launch_handler: { client_mode: \"focus-existing\" }" }),
				" to the PWA manifest (",
				createVNode(_components.code, { children: "packages/surface-app" }),
				" owns the manifest seam — confirm at the tree; if the manifest is kolu-owned, it’s a kolu file change only)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "packages/client/src/deepLink.ts" }) }),
				" — the grammar as a discriminated union, parse-don’t-validate: split the hash, validate ",
				createVNode(_components.code, { children: "<host>" }),
				" with ",
				createVNode(_components.code, { children: "isEncodedHostKey" }),
				" and ",
				createVNode(_components.code, { children: "<terminalId>" }),
				" with ",
				createVNode(_components.code, { children: "TerminalIdSchema" }),
				" (the ",
				createVNode(_components.code, { children: "attentionNotify.ts" }),
				" pattern, verbatim bar the shape), ",
				createVNode(_components.code, { children: "?line=" }),
				" a positive int. Output ",
				createVNode(_components.code, { children: "DeepLink | { kind: \"invalid\"; reason }" }),
				" — never a partially-valid route."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Wire three entry points" }),
				" in ",
				createVNode(_components.code, { children: "App.tsx" }),
				" boot: (a) parse ",
				createVNode(_components.code, { children: "location.hash" }),
				" once at startup; (b) ",
				createVNode(_components.code, { children: "hashchange" }),
				" listener; (c) ",
				createVNode(_components.code, { children: "window.launchQueue?.setConsumer" }),
				" reading the launch ",
				createVNode(_components.code, { children: "targetURL" }),
				" (Chromium; on browsers without it the plain boot parse of the same URL covers the case — one grammar, two delivery paths, no knob)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Route" }),
				" through the existing actions: ",
				createVNode(_components.code, { children: "#/h" }),
				" → ",
				createVNode(_components.code, { children: "setActiveHost" }),
				"; ",
				createVNode(_components.code, { children: "#/t" }),
				" → switch-then-focus (reuse ",
				createVNode(_components.code, { children: "useHostAttention" }),
				"’s ordering — host first, then ",
				createVNode(_components.code, { children: "focusTerminal" }),
				", never the reverse); ",
				createVNode(_components.code, { children: "/code" }),
				" → right panel ",
				createVNode(_components.code, { children: "showCode" }),
				" + select ",
				createVNode(_components.code, { children: "path" }),
				" (+ scroll to ",
				createVNode(_components.code, { children: "line" }),
				" ",
				createVNode(_components.strong, { children: "if" }),
				" the Code tab exposes line targeting — ground ",
				createVNode(_components.code, { children: "CodeTab" }),
				"’s ",
				createVNode(_components.code, { children: "selectedPath" }),
				"/viewer at build time; if line-scroll needs new Code-tab capability, ship path-only and record ",
				createVNode(_components.code, { children: "?line=" }),
				" as accepted-but-inert with a pointer here, one line — and in the parsed type, ",
				createVNode(_components.code, { children: "line" }),
				" lives ",
				createVNode(_components.em, { children: "inside" }),
				" the code variant, so line-without-path has no encoding);",
				createVNode($$Footnote, { children: [
					"The right panel is per-terminal state (",
					createVNode(_components.code, { children: "useRightPanel" }),
					", persisted via session restore) — which is why file links anchor on a terminal: ",
					createVNode(_components.code, { children: "#/t/…/code?path=…" }),
					", never a bare ",
					createVNode(_components.code, { children: "#/f/…" }),
					". A file link without a terminal has no panel to open in."
				] }),
				" ",
				createVNode(_components.code, { children: "/inspector" }),
				" → ",
				createVNode(_components.code, { children: "showInspector" }),
				"; ",
				createVNode(_components.code, { children: "#/settings" }),
				" → open the dialog.",
				"\n",
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "4a — sub-terminals (splits):" }),
						" when the routed id is a sub-terminal, the action is the full chain — activate the parent tile, select the sub in ",
						createVNode(_components.code, { children: "activeSubTab" }),
						", ",
						createVNode(_components.code, { children: "focusTarget: \"sub\"" }),
						". Done-criterion: an e2e deep-links to a ",
						createVNode(_components.em, { children: "split" }),
						" terminal and asserts the pane is live — the route is not done when only main tiles focus."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "4b — the cold-boot membership race:" }),
						" a cold-start link fires before the target host’s terminal membership has loaded; deciding “gone” at that moment would toast every bookmark spuriously. The route defers its verdict until the host’s membership settles (bounded — then the gone-toast). The reuse seam, corrected at build-time grounding: ",
						createVNode(_components.strong, { children: "CodeTab’s settle-then-verdict pattern" }),
						" (",
						createVNode(_components.code, { children: "right-panel/CodeTab.tsx" }),
						" — the ",
						createVNode(_components.code, { children: "pendingOpen" }),
						" effect gated on ",
						createVNode(_components.code, { children: "allPaths.pending()" }),
						"), applied to the terminal list. (The originally-named ",
						createVNode(_components.code, { children: "useHostAttention" }),
						" sequencing was checked and is the ",
						createVNode(_components.em, { children: "wrong" }),
						" precedent — it is optimistic fire-and-forget: no defer, no gone-verdict.) “Exists” is only knowable at the post-connect store — the guarantee lives there, not at parse time."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Loud edges:" }),
				" gone-target and invalid-route toasts (the existing toast seam); after a handled route, leave the hash in place (durability); never ",
				createVNode(_components.code, { children: "history.replaceState" }),
				"-strip it (that is the notification param’s semantic, not ours)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Tests:" }),
				" parser unit table (valid × each family, invalid host/id/route/line); an e2e that boots with ",
				createVNode(_components.code, { children: "#/t/<host>/<id>" }),
				" and asserts the tile is focused, plus a live ",
				createVNode(_components.code, { children: "hashchange" }),
				" navigation; the negative pin — grep-shaped — that no route handler calls a mutating client verb."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Dashboard integration" }),
				" (rides free): the orchestrator dashboard’s terminal tags become ",
				createVNode(_components.code, { children: "href" }),
				"s in this grammar."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Risks, named: ",
			createVNode(_components.code, { children: "launchQueue" }),
			" is Chromium-only — the fallback is the boot parse of the same URL (safe: same truth, not a degraded mode). Host keys in URLs expose ssh targets on screenshares — accepted for v1 (they’re already visible in the host chips); revisit under DL2’s privacy note. The ",
			createVNode(_components.code, { children: "?line=" }),
			" fork is pinned in step 4 so the implementer never stalls on it."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "dl2--the-address-bar-follows-focus-planned-gated-on-srids-go",
			children: ["DL2 — the address bar follows focus ", createVNode(_components.em, { children: "(planned, gated on srid’s go)" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Write the hash on focus/panel change so the URL always deep-links to the current view — every session becomes bookmarkable and shareable mid-flow. Costs to weigh at the gate: history noise (mitigate with ",
			createVNode(_components.code, { children: "replaceState" }),
			", no history entries), and terminal IDs + host keys permanently visible in the address bar (the screenshare consideration). One design obligation named now so DL2 can’t ship without it: the hash gains ",
			createVNode(_components.strong, { children: "two writers" }),
			" (user navigation and the follow-focus writer), and a naive programmatic write re-fires ",
			createVNode(_components.code, { children: "hashchange" }),
			" → re-route → focus change → write — a feedback loop. DL2 must carry an explicit echo-suppression discipline (write via ",
			createVNode(_components.code, { children: "replaceState" }),
			" and/or a self-write marker the router skips), with the authority rule above (client state owns the view; the URL never routes back its own echo) as the invariant a test pins. Not started until ruled; DL1 is complete without it."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Deep Links — Every View Addressable by URL",
	"description": "A hash-based URL grammar that opens kolu at a host, a terminal, a file in the Code tab, or settings — reusing the W5 notification cold-start machinery; view-only by law; PWA link-capture via launch_handler.",
	"parents": ["feature"],
	"status": "accepted",
	"maturity": "seedling",
	"updated": "2026-07-15T00:00:00.000Z"
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
			"depth": 2,
			"slug": "implementation-details",
			"text": "Implementation details"
		},
		{
			"depth": 3,
			"slug": "dl1--the-router--the-full-menu-one-pr",
			"text": "DL1 — the router + the full menu (one PR)"
		},
		{
			"depth": 3,
			"slug": "dl2--the-address-bar-follows-focus-planned-gated-on-srids-go",
			"text": "DL2 — the address bar follows focus (planned, gated on srid’s go)"
		}
	];
}
var url = "src/content/atlas/deep-links.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/deep-links.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/deep-links.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
