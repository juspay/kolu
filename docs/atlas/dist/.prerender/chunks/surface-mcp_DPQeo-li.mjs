import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import { t as $$Issue } from "./Issue_CB1XoZJT.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
import { t as $$Terminal } from "./Terminal_Cqh2_20m.mjs";
//#region src/diagrams/surface-mcp-seam.svg?raw
var surface_mcp_seam_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 640 740\" font-family=\"ui-sans-serif, system-ui, sans-serif\" role=\"img\" aria-label=\"A @kolu/surface (two shapes: fresh spec+handlers or a live odu socket) feeds the @kolu/surface-mcp adapter. The adapter splits into a framework-owned generic spine and a consumer-curated default-deny gate that fronts the MCP host.\">\n  <defs>\n    <marker id=\"mseam-arrow\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0L10 5L0 10z\" fill=\"#0D32B2\"/>\n    </marker>\n    <marker id=\"mseam-arrow-gate\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0L10 5L0 10z\" fill=\"#B45309\"/>\n    </marker>\n    <filter id=\"mseam-gateglow\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\">\n      <feDropShadow dx=\"0\" dy=\"0\" stdDeviation=\"5\" flood-color=\"#B45309\" flood-opacity=\"0.30\"/>\n    </filter>\n    <style>\n      .source    { fill:#E3E9FD; stroke:#0D32B2; stroke-width:1.5; }\n      .adapter   { fill:#F7F8FE; stroke:#0D32B2; stroke-width:1.5; }\n      .spine     { fill:#EDF0FD; stroke:#0D32B2; stroke-width:1.5; }\n      .leaf      { fill:#F7F8FE; stroke:#0D32B2; stroke-width:1; }\n      .gate      { fill:#FBF1DC; stroke:#B45309; stroke-width:2.5; }\n      .gateleaf  { fill:#FFFBF1; stroke:#B45309; stroke-width:1.25; }\n      .host      { fill:#E6F4EA; stroke:#15803D; stroke-width:1.5; }\n      .title     { fill:#0D32B2; font-weight:700; font-size:14px; }\n      .titleamber{ fill:#92400E; font-weight:700; font-size:14px; }\n      .titlegreen{ fill:#14532d; font-weight:700; font-size:14px; }\n      .grouptitle{ fill:#0D32B2; font-weight:700; font-size:13px; }\n      .gtamber   { fill:#92400E; font-weight:700; font-size:13px; }\n      .leaftext  { fill:#11203a; font-size:12px; }\n      .gateleaftext { fill:#7a4f00; font-size:12px; }\n      .mono      { font-family:ui-monospace, \"SF Mono\", Menlo, monospace; }\n      .sub       { fill:#4A5072; font-size:10.5px; }\n      .gatesub   { fill:#92400E; font-size:10.5px; font-weight:700; }\n      .edge      { stroke:#0D32B2; stroke-width:2; fill:none; }\n      .edgegate  { stroke:#B45309; stroke-width:2.5; fill:none; }\n      .edgelabel { fill:#0D32B2; font-size:11px; font-style:italic; }\n      .edgelabelg{ fill:#92400E; font-size:11px; font-style:italic; }\n      .ownbadge  { font-size:10px; font-weight:700; }\n    </style>\n  </defs>\n\n  <!-- TIER 1: source surface — two shapes (bridge primary) -->\n  <g>\n    <rect class=\"source\" x=\"160\" y=\"20\" width=\"320\" height=\"124\" rx=\"8\"/>\n    <text class=\"title\" x=\"320\" y=\"42\" text-anchor=\"middle\">a @kolu/surface — two shapes</text>\n    <!-- bridge: primary shape (live socket) -->\n    <rect class=\"leaf\" x=\"180\" y=\"56\" width=\"280\" height=\"38\" rx=\"5\"/>\n    <text class=\"leaftext\" x=\"320\" y=\"74\" text-anchor=\"middle\">bridge a live surface <tspan class=\"sub\">— primary</tspan></text>\n    <text class=\"leaftext mono\" x=\"320\" y=\"89\" text-anchor=\"middle\" font-size=\"11px\">odu's .ci/odu.sock</text>\n    <!-- serve: thin composition -->\n    <rect class=\"leaf\" x=\"180\" y=\"100\" width=\"280\" height=\"34\" rx=\"5\"/>\n    <text class=\"leaftext\" x=\"320\" y=\"122\" text-anchor=\"middle\">serve a spec fresh — spec + handlers</text>\n  </g>\n\n  <!-- edge: source -> adapter -->\n  <path class=\"edge\" d=\"M320 144 L320 180\" marker-end=\"url(#mseam-arrow)\"/>\n  <text class=\"edgelabel\" x=\"330\" y=\"166\" text-anchor=\"start\">bridge live  OR  serve fresh</text>\n\n  <!-- TIER 2: adapter = generic spine (framework) + consumer gate -->\n  <g>\n    <rect class=\"adapter\" x=\"36\" y=\"182\" width=\"568\" height=\"420\" rx=\"10\"/>\n    <text class=\"title\" x=\"320\" y=\"206\" text-anchor=\"middle\">@kolu/surface-mcp — shipped (#1270)</text>\n\n    <!-- SPINE: framework-owned, generic (brand blue) -->\n    <rect class=\"spine\" x=\"56\" y=\"218\" width=\"528\" height=\"184\" rx=\"6\"/>\n    <rect x=\"56\" y=\"218\" width=\"6\" height=\"184\" fill=\"#0D32B2\"/>\n    <text class=\"grouptitle\" x=\"76\" y=\"240\" text-anchor=\"start\">generic spine</text>\n    <text class=\"ownbadge\" x=\"568\" y=\"240\" text-anchor=\"end\" fill=\"#0D32B2\">FRAMEWORK-OWNED</text>\n    <rect class=\"leaf\" x=\"74\"  y=\"250\" width=\"244\" height=\"64\" rx=\"5\"/>\n    <text class=\"leaftext\" x=\"196\" y=\"278\" text-anchor=\"middle\">primitive → resource / tool</text>\n    <text class=\"sub\" x=\"196\" y=\"296\" text-anchor=\"middle\">the 1:1 map (the demo)</text>\n    <rect class=\"leaf\" x=\"322\" y=\"250\" width=\"244\" height=\"64\" rx=\"5\"/>\n    <text class=\"leaftext\" x=\"444\" y=\"278\" text-anchor=\"middle\">subscribe / teardown lifecycle</text>\n    <text class=\"sub\" x=\"444\" y=\"296\" text-anchor=\"middle\">ResourcePusher — the month</text>\n    <rect class=\"leaf\" x=\"74\"  y=\"322\" width=\"244\" height=\"64\" rx=\"5\"/>\n    <text class=\"leaftext mono\" x=\"196\" y=\"350\" text-anchor=\"middle\" font-size=\"11.5px\">zod → JSON-Schema</text>\n    <text class=\"sub\" x=\"196\" y=\"368\" text-anchor=\"middle\">z.toJSONSchema() · 2020-12</text>\n    <rect class=\"leaf\" x=\"322\" y=\"322\" width=\"244\" height=\"64\" rx=\"5\"/>\n    <text class=\"leaftext\" x=\"444\" y=\"350\" text-anchor=\"middle\">stdout-is-the-protocol</text>\n    <text class=\"sub\" x=\"444\" y=\"368\" text-anchor=\"middle\">via serveOverStdio discipline</text>\n\n    <!-- GATE: consumer-curated, default-deny (amber, gate shape, emphasis) -->\n    <!-- notched/gate shape: rounded rect with a top center notch + halo glow -->\n    <g filter=\"url(#mseam-gateglow)\">\n      <path class=\"gate\" d=\"M66 432 L294 432 L308 420 L322 432 L574 432\n                            a8 8 0 0 1 8 8 L582 580 a8 8 0 0 1 -8 8\n                            L74 588 a8 8 0 0 1 -8 -8 L66 440 a8 8 0 0 1 0 -8 Z\"/>\n    </g>\n    <text class=\"gtamber\" x=\"84\" y=\"456\" text-anchor=\"start\">consumer gate</text>\n    <text class=\"gatesub\" x=\"84\" y=\"472\" text-anchor=\"start\">DEFAULT-DENY — nothing reaches the agent unopted</text>\n    <text class=\"ownbadge\" x=\"566\" y=\"456\" text-anchor=\"end\" fill=\"#92400E\">CONSUMER-CURATED · not free</text>\n\n    <rect class=\"gateleaf\" x=\"80\"  y=\"484\" width=\"234\" height=\"92\" rx=\"5\"/>\n    <text class=\"gateleaftext\" x=\"197\" y=\"512\" text-anchor=\"middle\">expose · project</text>\n    <text class=\"gateleaftext\" x=\"197\" y=\"530\" text-anchor=\"middle\">bespoke tools</text>\n    <text class=\"gatesub\" x=\"197\" y=\"556\" text-anchor=\"middle\" font-weight=\"400\" font-size=\"10.5px\">surface the four good tools</text>\n    <rect class=\"gateleaf\" x=\"326\" y=\"484\" width=\"234\" height=\"92\" rx=\"5\"/>\n    <text class=\"gateleaftext\" x=\"443\" y=\"512\" text-anchor=\"middle\">guards ·</text>\n    <text class=\"gateleaftext\" x=\"443\" y=\"530\" text-anchor=\"middle\">observer / mutator authz</text>\n    <text class=\"gatesub\" x=\"443\" y=\"556\" text-anchor=\"middle\" font-weight=\"400\" font-size=\"10.5px\">keep the dangerous verb off the wire</text>\n  </g>\n\n  <!-- edge: gate -> host (amber: the gate decides what crosses) -->\n  <path class=\"edgegate\" d=\"M320 602 L320 658\" marker-end=\"url(#mseam-arrow-gate)\"/>\n  <text class=\"edgelabelg\" x=\"330\" y=\"626\" text-anchor=\"start\">tools · resources · notifications/*</text>\n  <text class=\"edgelabelg\" x=\"330\" y=\"642\" text-anchor=\"start\" font-size=\"10.5px\">— only what the gate allows onto the wire</text>\n\n  <!-- TIER 3: MCP host -->\n  <g>\n    <rect class=\"host\" x=\"118\" y=\"660\" width=\"404\" height=\"58\" rx=\"8\"/>\n    <text class=\"titlegreen\" x=\"320\" y=\"685\" text-anchor=\"middle\">MCP host</text>\n    <text class=\"leaftext\" x=\"320\" y=\"704\" text-anchor=\"middle\" fill=\"#166534\">Claude · Codex · opencode · Gemini</text>\n  </g>\n</svg>\n";
//#endregion
//#region src/diagrams/surface-mcp-projectsurface.svg?raw
var surface_mcp_projectsurface_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 640 648\" font-family=\"ui-sans-serif, system-ui, sans-serif\" role=\"img\" aria-label=\"oduSurface (A, live) feeds the NEW projectSurface primitive, which serves the curated observer-safe oduAgentSurface (B); every face maps B one-to-one.\">\n  <defs>\n    <marker id=\"mproj-arrow-blue\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0L10 5L0 10z\" fill=\"#0D32B2\"/>\n    </marker>\n    <marker id=\"mproj-arrow-amber\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"8\" markerHeight=\"8\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0L10 5L0 10z\" fill=\"#B45309\"/>\n    </marker>\n    <marker id=\"mproj-arrow-green\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0L10 5L0 10z\" fill=\"#15803D\"/>\n    </marker>\n    <style>\n      .leaftext  { font-size:12px; }\n      .grouptitle{ font-weight:700; font-size:14px; }\n      .edgelabel { fill:#3f444b; font-size:11px; font-style:italic; }\n      .mono      { font-family:ui-monospace,\"SF Mono\",Menlo,monospace; }\n    </style>\n  </defs>\n\n  <!-- A: live coordinator (neutral blue — today's spine) -->\n  <g>\n    <rect x=\"120\" y=\"20\" width=\"400\" height=\"106\" rx=\"8\" fill=\"#E3E9FD\" stroke=\"#0D32B2\" stroke-width=\"1.5\"/>\n    <text class=\"grouptitle\" x=\"320\" y=\"46\" text-anchor=\"middle\" fill=\"#0D32B2\">oduSurface (A) — live coordinator</text>\n    <rect x=\"140\" y=\"60\" width=\"360\" height=\"48\" rx=\"5\" fill=\"#F7F8FE\" stroke=\"#0D32B2\" stroke-width=\"1\"/>\n    <text class=\"leaftext mono\" x=\"320\" y=\"89\" text-anchor=\"middle\" fill=\"#11203a\">nodes cell · nodeLog stream · node.rerun</text>\n  </g>\n  <path d=\"M320 126 L320 162\" fill=\"none\" stroke=\"#0D32B2\" stroke-width=\"2\" marker-end=\"url(#mproj-arrow-blue)\"/>\n  <text class=\"edgelabel\" x=\"330\" y=\"148\" text-anchor=\"start\">client of A</text>\n\n  <!-- projectSurface: THE SUBJECT — the NEW primitive (amber, halo + heavy stroke) -->\n  <g>\n    <rect x=\"56\" y=\"160\" width=\"528\" height=\"186\" rx=\"11\" fill=\"none\" stroke=\"#B45309\" stroke-width=\"1\" opacity=\"0.28\"/>\n    <rect x=\"60\" y=\"164\" width=\"520\" height=\"178\" rx=\"8\" fill=\"#FBF1DC\" stroke=\"#B45309\" stroke-width=\"2.5\"/>\n    <text class=\"grouptitle\" x=\"320\" y=\"190\" text-anchor=\"middle\" fill=\"#92400E\"><tspan font-size=\"15\">projectSurface(A, …)</tspan> — NEW in @kolu/surface</text>\n    <rect x=\"80\" y=\"204\" width=\"480\" height=\"38\" rx=\"5\" fill=\"#FFFBF1\" stroke=\"#B45309\" stroke-width=\"1\"/>\n    <text class=\"leaftext\" x=\"320\" y=\"228\" text-anchor=\"middle\" fill=\"#7a4f00\"><tspan class=\"mono\">surfaceClientRef</tspan> — B reads a live A client</text>\n    <rect x=\"80\" y=\"250\" width=\"480\" height=\"38\" rx=\"5\" fill=\"#FFFBF1\" stroke=\"#B45309\" stroke-width=\"1\"/>\n    <text class=\"leaftext\" x=\"320\" y=\"274\" text-anchor=\"middle\" fill=\"#7a4f00\"><tspan class=\"mono\">derive</tspan> — settled · red · bounded/guarded log</text>\n    <rect x=\"80\" y=\"296\" width=\"480\" height=\"38\" rx=\"5\" fill=\"#FFFBF1\" stroke=\"#B45309\" stroke-width=\"1\"/>\n    <text class=\"leaftext\" x=\"320\" y=\"320\" text-anchor=\"middle\" fill=\"#7a4f00\">stream teardown — shared with the spine</text>\n  </g>\n  <path d=\"M320 346 L320 378\" fill=\"none\" stroke=\"#B45309\" stroke-width=\"2.5\" marker-end=\"url(#mproj-arrow-amber)\"/>\n  <text class=\"edgelabel\" x=\"330\" y=\"365\" text-anchor=\"start\">serves B, a sibling of A</text>\n\n  <!-- B: curated, observer-safe projection (green — the safety guarantee) -->\n  <g>\n    <rect x=\"120\" y=\"380\" width=\"400\" height=\"106\" rx=\"8\" fill=\"#E6F4EA\" stroke=\"#15803D\" stroke-width=\"2\"/>\n    <text class=\"grouptitle\" x=\"320\" y=\"406\" text-anchor=\"middle\" fill=\"#15803D\">oduAgentSurface (B) — curated, observer-safe</text>\n    <rect x=\"140\" y=\"420\" width=\"360\" height=\"48\" rx=\"5\" fill=\"#EAF6EC\" stroke=\"#15803D\" stroke-width=\"1\"/>\n    <text class=\"leaftext mono\" x=\"320\" y=\"449\" text-anchor=\"middle\" fill=\"#14532d\">nodes(+red) · log · settled · node.rerun</text>\n  </g>\n  <path d=\"M320 486 L320 522\" fill=\"none\" stroke=\"#15803D\" stroke-width=\"2\" marker-end=\"url(#mproj-arrow-green)\"/>\n  <text class=\"edgelabel\" x=\"330\" y=\"508\" text-anchor=\"start\">1:1</text>\n\n  <!-- faces: every face maps B 1:1 (neutral blue — structure) -->\n  <g>\n    <rect x=\"120\" y=\"524\" width=\"400\" height=\"100\" rx=\"8\" fill=\"#E3E9FD\" stroke=\"#0D32B2\" stroke-width=\"1.5\"/>\n    <text class=\"grouptitle\" x=\"320\" y=\"550\" text-anchor=\"middle\" fill=\"#0D32B2\">every face maps B 1:1</text>\n    <rect x=\"140\" y=\"564\" width=\"360\" height=\"44\" rx=\"5\" fill=\"#F7F8FE\" stroke=\"#0D32B2\" stroke-width=\"1\"/>\n    <text class=\"leaftext mono\" x=\"320\" y=\"591\" text-anchor=\"middle\" fill=\"#11203a\">TUI · web · @kolu/surface-mcp (+ bespoke run)</text>\n  </g>\n</svg>\n";
//#endregion
//#region src/content/atlas/surface-mcp.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
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
			createVNode(_components.em, { children: [
				"Plan of record for ",
				createVNode($$Issue, {
					n: 982,
					label: "@kolu/surface: expose any stdio-served surface as an MCP server"
				}),
				". The issue’s framing — “the framework is one adapter away from ",
				createVNode(_components.em, { children: "every Kolu surface is also an MCP server" }),
				"” — is true and worth building. This note ",
				createVNode(_components.strong, { children: "right-scopes" }),
				" it: ",
				createVNode(_components.em, { children: "smaller" }),
				" where the issue over-reached (buy zod 4’s native converter, lean on the already-shipped ",
				createVNode(_components.code, { children: "serveOverStdio" }),
				") and ",
				createVNode(_components.em, { children: "bigger" }),
				" where it under-reached (a new core ",
				createVNode(_components.code, { children: "projectSurface" }),
				" primitive so curation graduates too — all in one PR) — grounded in odu’s hand-built face, which already taught us where every seam is."
			] }),
			" ",
			createVNode($$Pill, {
				variant: "new",
				children: "grounded in odu’s shipped mcp face"
			})
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Status: ",
			createVNode($$Pill, {
				variant: "done",
				children: "implemented"
			}),
			" · shipped in ",
			createVNode($$PrLink, { pr: 1270 }),
			" — ",
			createVNode(_components.code, { children: "projectSurface" }),
			" on the ",
			createVNode(_components.code, { children: "@kolu/surface/project" }),
			" subpath + the new ",
			createVNode(_components.code, { children: "@kolu/surface-mcp" }),
			" package, with a composition proof. odu’s migration onto it follows in a paired PR."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			children: createVNode(_components.p, { children: [
				"The 1:1 map — every cell a resource, every procedure a tool — is a ",
				createVNode(_components.strong, { children: [
					"morning’s work and the partly-",
					createVNode(_components.em, { children: "wrong" }),
					" 80%"
				] }),
				". The agent-useful tools aren’t procedures; the dangerous procedure must not be a tool; and the real engineering is the subscribe/unsubscribe teardown, the zod→JSON-Schema bridge, and the stdout-is-the-protocol discipline. Lead ",
				createVNode(_components.code, { children: "@kolu/surface-mcp" }),
				" with the ",
				createVNode(_components.strong, { children: "lifecycle spine + the selection/authz gate" }),
				"; the auto-map is the demo, not the product."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The strongest evidence isn’t speculative — ",
			createVNode(_components.strong, { children: "it already exists, built by hand." }),
			" odu’s ",
			createVNode(_components.code, { children: "odu mcp" }),
			" face (",
			createVNode($$PrLink, {
				pr: 3,
				repo: "juspay/odu"
			}),
			", consumed in kolu ",
			createVNode($$PrLink, { pr: 1258 }),
			") is exactly this adapter: it re-exposes the ",
			createVNode(_components.code, { children: "oduSurface" }),
			" to Claude Code / Codex / opencode / Gemini CLI as MCP tools and resources. So the core correspondence is ",
			createVNode(_components.strong, { children: "validated, not hoped for" }),
			" — and shipping it taught us which 20% is the framework and which 80% is the consumer’s. This note is that lesson, turned into a scope."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: surface_mcp_seam_default,
			caption: "Where the seam falls, read top to bottom. A surface (in either of two shapes) feeds the generic spine — mapping + subscribe/teardown lifecycle + zod→JSON-Schema + stdout discipline — the framework primitive worth extracting. Downstream of it, fronting the host, sits the selection/authz gate: NOT free, per-surface curation the consumer must write, and exactly what keeps the dangerous procedure off the wire."
		}),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Package: a sibling, not a subpath",
			children: createVNode(_components.p, { children: [
				"#982 names it ",
				createVNode(_components.code, { children: "@kolu/surface/mcp" }),
				" (a subpath of core). Prefer ",
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "packages/surface-mcp/" }),
					" → ",
					createVNode(_components.code, { children: "@kolu/surface-mcp" })
				] }),
				" — matching the existing ",
				createVNode(_components.code, { children: "@kolu/surface-app" }),
				" / ",
				createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
				" siblings, and keeping the ",
				createVNode(_components.code, { children: "@modelcontextprotocol/sdk" }),
				" dependency ",
				createVNode(_components.strong, { children: ["out of core ", createVNode(_components.code, { children: "@kolu/surface" })] }),
				" (drishti, the browser client, and every non-MCP consumer shouldn’t pull the SDK). It needs only surface’s public introspection — ",
				createVNode(_components.code, { children: "surface.spec" }),
				" + ",
				createVNode(_components.code, { children: "descriptors" }),
				" — which a sibling consumes cleanly; the dependency arrow points one way, ",
				createVNode(_components.code, { children: "surface-mcp → surface" }),
				", never back."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-map-is-a-morning-the-selection-is-the-project",
			children: "The map is a morning; the selection is the project"
		}),
		"\n",
		createVNode(_components.p, { children: "The wire shapes line up cleanly — that part of the issue is right:" }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: [createVNode(_components.code, { children: "@kolu/surface" }), " primitive"] }),
					"\n",
					createVNode(_components.th, { children: "MCP shape" }),
					"\n",
					createVNode(_components.th, { children: "Auto-mappable?" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Cell" }), " (singleton value)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"resource + ",
						createVNode(_components.code, { children: "resources/subscribe" }),
						" → ",
						createVNode(_components.code, { children: "notifications/resources/updated" })
					] }),
					"\n",
					createVNode(_components.td, { children: "clean" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Collection" }), " (keyed map)"] }),
					"\n",
					createVNode(_components.td, { children: "resource list + per-key resource" }),
					"\n",
					createVNode(_components.td, { children: "clean-ish (key→URI encoding)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Stream" }), " (derived, input-driven)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"resource snapshot ",
						createVNode(_components.strong, { children: "or" }),
						" notification"
					] }),
					"\n",
					createVNode(_components.td, { children: "needs intent — pull vs push" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Event" }), " (occurrences, no snapshot)"] }),
					"\n",
					createVNode(_components.td, { children: "notification" }),
					"\n",
					createVNode(_components.td, { children: "clean" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Procedure" }), " (imperative verb)"] }),
					"\n",
					createVNode(_components.td, { children: "tool" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "unsafe to auto-map" }) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"So a literal “every cell→resource, every procedure→tool” adapter is real, and it’s a demo. The trouble is what it produces. Look at what ",
			createVNode(_components.code, { children: "odu mcp" }),
			" actually exposes versus the ",
			createVNode(_components.code, { children: "oduSurface" }),
			" it wraps:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: [createVNode(_components.code, { children: "odu mcp" }), " tool"] }),
					"\n",
					createVNode(_components.th, { children: "backing primitive" }),
					"\n",
					createVNode(_components.th, { children: "what it really is" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "get_nodes" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "nodes" }), " cell"] }),
					"\n",
					createVNode(_components.td, { children: [
						"projection — a snapshot + a computed ",
						createVNode(_components.code, { children: "red" }),
						" verdict bit"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "tail_log" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "nodeLog" }), " stream"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "composition" }),
						" — live stream snapshot ",
						createVNode(_components.em, { children: "or" }),
						" the durable per-SHA file, with a path-traversal guard"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "rerun_node" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "node.rerun" }), " procedure"] }),
					"\n",
					createVNode(_components.td, { children: [
						"the ",
						createVNode(_components.strong, { children: "only" }),
						" 1:1 tool"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "wait_for_settle" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "nodes" }), " cell (streamed)"] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "composition" }), " — blocking wait with fail-fast + cancellation + half-observed-run safety"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "run" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.em, { children: "none" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "composition" }), " — spawns the coordinator, polls the socket up"] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Five tools; ",
			createVNode(_components.strong, { children: "one" }),
			" is a procedure mapped 1:1. The four valuable ones are hand-authored projections and compositions. And the surface’s ",
			createVNode(_components.em, { children: "other" }),
			" procedure — ",
			createVNode(_components.code, { children: "run.configure" }),
			", lane-only and dangerous — is ",
			createVNode(_components.strong, { children: "deliberately not a tool at all" }),
			" (it lives on the ",
			createVNode(_components.code, { children: "laneSurface" }),
			" the coordinator never re-exposes). “Every procedure is a tool” would have shipped the one dangerous verb and missed the four good ones."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "The annotation the issue lists as an open question is the project",
			children: createVNode(_components.p, { children: [
				"#982 asks “which primitives map cleanly, and which need an explicit ",
				createVNode(_components.code, { children: "@mcp-resource" }),
				" / ",
				createVNode(_components.code, { children: "@mcp-tool" }),
				" annotation?” — and files it under ",
				createVNode(_components.em, { children: "open questions" }),
				". It’s not a detail; it ",
				createVNode(_components.strong, { children: "is the package" }),
				". The default must be ",
				createVNode(_components.em, { children: "deny" }),
				": nothing reaches an agent until the surface author opts it in (and says whether a stream is pull-a-snapshot or push-notifications, and whether a tool mutates). Auto-expose is the demo’s convenience and a production foot-gun. The curation layer — selection + guards — is the part a generic package makes ",
				createVNode(_components.em, { children: "safe and ergonomic" }),
				"; it is not the part it makes ",
				createVNode(_components.em, { children: "disappear" }),
				"."
			] })
		}),
		"\n",
		createVNode(_components.h3, {
			id: "how-the-developer-tags-it--in-typescript-default-deny",
			children: "How the developer tags it — in TypeScript, default-deny"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"So how does an author say “map ",
			createVNode(_components.em, { children: "this" }),
			" one,” concretely? Three ways, ordered by ",
			createVNode(_components.em, { children: "least" }),
			" MCP-coupling:"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Structural — membership is the tag." }),
				" Put the primitive in the exposed surface and leave the rest out; the surface’s ",
				createVNode(_components.em, { children: "shape" }),
				" is the allowlist, no annotation at all. This is the second-surface cut (below), and it’s the strongest — core surface stays MCP-agnostic and the dangerous verb is ",
				createVNode(_components.em, { children: "unreachable" }),
				", not merely unticked."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"A typed ",
					createVNode(_components.code, { children: "expose" }),
					" allowlist"
				] }),
				" (the hello-world’s map) — the recommended default when you don’t want a second surface. Fully type-checked: keys are constrained to the spec’s own primitive names, each value constrained by that primitive’s ",
				createVNode(_components.em, { children: "kind" }),
				" — a procedure may be a ",
				createVNode(_components.code, { children: "tool" }),
				", a cell a ",
				createVNode(_components.code, { children: "resource" }),
				"; mis-tag a cell as a tool, or typo a name, and it’s a compile error. Omission means ",
				createVNode(_components.em, { children: "not exposed" }),
				":",
				"\n",
				createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// surface-mcp infers the legal keys &#x26; values from your spec.</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// `mutates` is optional but defaults CONSERVATIVELY: absent ⇒ mutating/destructive</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// (a host could auto-run a read-only-hinted tool unconfirmed); mark a read-only tool `mutates: false`.</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">type</span><span style=\"color:#6F42C1\"> Expose</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">S</span><span style=\"color:#D73A49\"> extends</span><span style=\"color:#6F42C1\"> SurfaceSpec</span><span style=\"color:#24292E\">> </span><span style=\"color:#D73A49\">=</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  &#x26;</span><span style=\"color:#24292E\"> { [</span><span style=\"color:#6F42C1\">K</span><span style=\"color:#D73A49\"> in</span><span style=\"color:#6F42C1\"> ProcedureName</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">S</span><span style=\"color:#24292E\">>]</span><span style=\"color:#D73A49\">?:</span><span style=\"color:#032F62\"> \"tool\"</span><span style=\"color:#D73A49\"> |</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">tool</span><span style=\"color:#D73A49\">:</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">mutates</span><span style=\"color:#D73A49\">?:</span><span style=\"color:#005CC5\"> boolean</span><span style=\"color:#24292E\"> } } }</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  &#x26;</span><span style=\"color:#24292E\"> { [</span><span style=\"color:#6F42C1\">K</span><span style=\"color:#D73A49\"> in</span><span style=\"color:#6F42C1\"> CellName</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">S</span><span style=\"color:#24292E\">> </span><span style=\"color:#D73A49\">|</span><span style=\"color:#6F42C1\"> CollectionName</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">S</span><span style=\"color:#24292E\">> </span><span style=\"color:#D73A49\">|</span><span style=\"color:#6F42C1\"> StreamName</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">S</span><span style=\"color:#24292E\">> </span><span style=\"color:#D73A49\">|</span><span style=\"color:#6F42C1\"> EventName</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">S</span><span style=\"color:#24292E\">>]</span><span style=\"color:#D73A49\">?:</span><span style=\"color:#032F62\"> \"resource\"</span><span style=\"color:#24292E\"> };</span></span></code></pre>" }),
				"\n"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Co-located wrapper tags" }),
				" — for teams who want the tag ",
				createVNode(_components.em, { children: "next" }),
				" to the primitive, surface-mcp can ship ",
				createVNode(_components.code, { children: "mcpTool()" }),
				" / ",
				createVNode(_components.code, { children: "mcpResource()" }),
				" / ",
				createVNode(_components.code, { children: "readOnly()" }),
				" helpers used at definition time; they attach a symbol-keyed annotation the adapter reads, so the MCP vocabulary still lives in the ",
				createVNode(_components.em, { children: "sibling" }),
				" package, never in core surface."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"What it is ",
			createVNode(_components.strong, { children: "not" }),
			" is a TypeScript ",
			createVNode(_components.em, { children: "decorator" }),
			": surface specs are plain object literals (",
			createVNode(_components.code, { children: "defineSurface({ … })" }),
			"), not classes, so the issue’s ",
			createVNode(_components.code, { children: "@mcp-tool" }),
			" reads like a decorator but can’t be one. The “annotation” is a typed field or a wrapper — checked by the compiler, defaulting to deny."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-hard-part-is-lifecycle-not-mapping",
			children: "The hard part is lifecycle, not mapping"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"If the mapping is a morning, the lifecycle is the month — and it’s the part that’s genuinely ",
			createVNode(_components.em, { children: "generic" }),
			", so it’s the strongest candidate for the package. In odu, the bulk of ",
			createVNode(_components.code, { children: "src/mcp/" }),
			" (~1550 lines, not “one file”) isn’t the five tool bodies; it’s ",
			createVNode(_components.code, { children: "ResourcePusher" }),
			" — the thing that makes ",
			createVNode(_components.code, { children: "resources/subscribe" }),
			" correct under teardown."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The subtle bug it dodges is an ",
			createVNode(_components.code, { children: "ERR_STREAM_DESTROYED" }),
			" race: when the last subscriber leaves (or the run ends), aborting each per-resource stream controller races the oRPC cancel-send against the socket close. odu’s fix is a ",
			createVNode(_components.strong, { children: "detach-without-abort + generation-token" }),
			" dance — bump a generation counter ",
			createVNode(_components.em, { children: "before" }),
			" disposing, close the whole attachment so the transport tears every stream at once, and have each in-flight stream loop check ",
			createVNode(_components.code, { children: "gen !== this.generation" }),
			" so it knows it was torn down (versus ended because the run settled) and doesn’t reschedule a retry. Per-stream abort is reserved for the one case where a ",
			createVNode(_components.em, { children: "single" }),
			" resource unsubscribes while the socket stays open for others. Getting that right generically — plus debounced ",
			createVNode(_components.code, { children: "notifications/resources/updated" }),
			", a bounded retry while subscribers wait for a not-yet-live surface, and clean EOF vs error teardown — is where a shared package earns its test burden. ",
			createVNode(_components.strong, { children: "Nobody should hand-write this twice." })
		] }),
		"\n",
		createVNode(_components.p, { children: "Two more pieces of the spine are concrete and generic — and, happily, mostly already solved:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "zod → JSON-Schema — buy, not build." }),
				" Surface descriptors carry zod schemas; MCP tool inputs are JSON Schema. A prior-art sweep settled this: ",
				createVNode(_components.strong, { children: "zod 4 ships the converter natively" }),
				" — ",
				createVNode(_components.a, {
					href: "https://zod.dev/json-schema",
					children: createVNode(_components.code, { children: "z.toJSONSchema()" })
				}),
				", already present in the repo’s pinned ",
				createVNode(_components.code, { children: "zod@4.3.6" }),
				", defaulting to JSON Schema ",
				createVNode(_components.strong, { children: "draft 2020-12" }),
				" (the dialect MCP standardized on). The adapter calls it on each descriptor ",
				createVNode(_components.em, { children: [
					"and reuses the same schema to ",
					createVNode(_components.code, { children: ".parse()" }),
					" the incoming args"
				] }),
				" — one source of truth, collapsing odu’s hand-written JSON-Schema literals plus its parallel validator (a desync waiting to happen). Don’t reach for the old ",
				createVNode(_components.code, { children: "zod-to-json-schema" }),
				" lib (sunset Nov 2025; under zod 4 it only reads v3-shaped schemas), and don’t route through the SDK’s high-level ",
				createVNode(_components.code, { children: "McpServer" }),
				" (draft-07, and it has itself regressed to emitting ",
				createVNode(_components.code, { children: "$ref" }),
				"). What the package ",
				createVNode(_components.em, { children: "does" }),
				" own is a thin, load-bearing ",
				createVNode(_components.strong, { children: "glue" }),
				" — and ",
				createVNode(_components.em, { children: "this" }),
				" is what “real work” meant: set the options explicitly (",
				createVNode(_components.code, { children: "io: \"input\"" }),
				", so ",
				createVNode(_components.code, { children: ".default()" }),
				" args aren’t forced ",
				createVNode(_components.code, { children: "required" }),
				"; an ",
				createVNode(_components.code, { children: "unrepresentable" }),
				" policy with a per-field override, so one ",
				createVNode(_components.code, { children: "z.date" }),
				" degrades to ",
				createVNode(_components.code, { children: "{type:\"string\",format:\"date-time\"}" }),
				" instead of blanking a field or crashing ",
				createVNode(_components.code, { children: "tools/list" }),
				"); a small ",
				createVNode(_components.strong, { children: "dereference pass" }),
				" that inlines local ",
				createVNode(_components.code, { children: "$ref" }),
				"/",
				createVNode(_components.code, { children: "$defs" }),
				" (mandatory — ",
				createVNode(_components.code, { children: "z.toJSONSchema" }),
				" still emits ",
				createVNode(_components.code, { children: "$ref" }),
				" on recursion and ",
				createVNode(_components.code, { children: ".meta({id})" }),
				", and ",
				createVNode(_components.code, { children: "$ref" }),
				" is rejected across a wide client matrix — Anthropic, Gemini, Bedrock, Codex, Claude Desktop — though it’s valid 2020-12; the MCP TS SDK hit exactly this and fixed it with a ~95-line deref); enforce a top-level ",
				createVNode(_components.code, { children: "type: \"object\"" }),
				"; and pin it all behind one ",
				createVNode(_components.code, { children: "toInputSchema()" }),
				" with a snapshot test, because the option ",
				createVNode(_components.em, { children: "defaults" }),
				" are a zod-version seam (4.3.6 inlines reuse, 4.4 refs it). Buy the engine, own the ~100 lines of adapter glue."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The stdout discipline, already solved upstream." }),
				" ",
				createVNode(_components.code, { children: "serveOverStdio" }),
				" (shipped in ",
				createVNode(_components.code, { children: "peer-server.ts" }),
				", the R1b work #982 builds on) already owns base64+newline framing and the “stdout ",
				createVNode(_components.em, { children: "is" }),
				" the protocol channel — redirect ",
				createVNode(_components.code, { children: "console.log" }),
				" to stderr” invariant that MCP-over-stdio needs identically. The adapter should ",
				createVNode(_components.strong, { children: "compose with it, not re-own the transport." }),
				" That answers the issue’s third open question directly: don’t own stdio, sit on ",
				createVNode(_components.code, { children: "serveOverStdio" }),
				"."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "two-shapes-serve-a-spec-or-bridge-a-live-surface",
			children: "Two shapes: serve a spec, or bridge a live surface"
		}),
		"\n",
		createVNode(_components.p, { children: "The issue quietly conflates two different adapters, and the package should name them apart:" }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Serve a spec fresh" }),
				" — wrap a ",
				createVNode(_components.code, { children: "defineSurface" }),
				" spec, supply its handlers via ",
				createVNode(_components.code, { children: "implementSurface" }),
				", and serve ",
				createVNode(_components.em, { children: "that" }),
				" over stdio. The MCP server ",
				createVNode(_components.em, { children: "is" }),
				" the surface’s backend — the shape for an app with no separate running server to dial."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Bridge a live surface" }),
				" — be a ",
				createVNode(_components.strong, { children: "client" }),
				" that dials an already-running served surface and re-projects it. This is odu: ",
				createVNode(_components.code, { children: "odu mcp" }),
				" predetermines no host, dials ",
				createVNode(_components.code, { children: ".ci/odu.sock" }),
				" on every call, reads a snapshot or opens a stream, detaches. The MCP server owns no domain state; it’s a face on a server that already exists."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"These have different ownership (backend vs. client), different lifecycles (process-local vs. attach/reconnect), and different failure modes (handler bug vs. socket drop). A serve-a-spec adapter can’t express odu (which dials a server that already exists); a bridge adapter can’t serve an app that has no server yet. The package should pick ",
			createVNode(_components.strong, { children: "bridge-a-live-surface as the primary shape" }),
			" (it’s the one with a real consumer and the harder lifecycle) and offer serve-fresh as the thin composition ",
			createVNode(_components.code, { children: "implementSurface" }),
			" + the bridge already imply."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "see-it-in-action-odus-agent-face-on-the-package",
			children: "See it in action: odu’s agent face, on the package"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"odu’s hand-built MCP face is ~1550 lines of ",
			createVNode(_components.code, { children: "src/mcp/" }),
			". On ",
			createVNode(_components.code, { children: "@kolu/surface-mcp" }),
			", the bridge case collapses to a declaration — dial the surface odu already serves on ",
			createVNode(_components.code, { children: ".ci/odu.sock" }),
			", name what an agent may touch, serve it over stdio:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// odu mcp, rebuilt on the package (proposed shape)</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#24292E\"> { oduAgentSurface } </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"./common/agent-surface\"</span><span style=\"color:#24292E\">; </span><span style=\"color:#6A737D\">// a curated projection — see below</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#24292E\"> { unixSocketLink } </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"@kolu/surface\"</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#24292E\"> { serveSurfaceAsMcp } </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"@kolu/surface-mcp\"</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#24292E\"> { z } </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"zod\"</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#D73A49\">await</span><span style=\"color:#6F42C1\"> serveSurfaceAsMcp</span><span style=\"color:#24292E\">({</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">  // BRIDGE the live coordinator — `unixSocketLink` returns `{ client, dispose }`,</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">  // an owned connection the adapter closes on teardown / re-dials after a drop.</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  client</span><span style=\"color:#24292E\">: () </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> unixSocketLink</span><span style=\"color:#24292E\">({ socketPath: </span><span style=\"color:#032F62\">\".ci/odu.sock\"</span><span style=\"color:#24292E\"> }),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  surface: oduAgentSurface,</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">  // 1:1 surface primitives → resources &#x26; tools (default-deny allowlist)</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  expose: {</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">    nodes:        </span><span style=\"color:#032F62\">\"resource\"</span><span style=\"color:#24292E\">,                  </span><span style=\"color:#6A737D\">// cell   → odu://nodes  (+ live notifications)</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">    log:          </span><span style=\"color:#032F62\">\"resource\"</span><span style=\"color:#24292E\">,                  </span><span style=\"color:#6A737D\">// stream → odu://log/{node}  (bounded, path-guarded)</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">    settled:      </span><span style=\"color:#032F62\">\"tool\"</span><span style=\"color:#24292E\">,                      </span><span style=\"color:#6A737D\">// event  → fail-fast \"wait until done / first red\"</span></span>\n<span class=\"line\"><span style=\"color:#032F62\">    \"node.rerun\"</span><span style=\"color:#24292E\">: { tool: { mutates: </span><span style=\"color:#005CC5\">true</span><span style=\"color:#24292E\"> } }, </span><span style=\"color:#6A737D\">// procedure → rerun one node + dependents</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  },</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">  // bespoke, MCP-call-shaped tools — compose over the live client, share the spine</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  tools: {</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">    run: {                                     </span><span style=\"color:#6A737D\">// genuinely imperative: spawn + await the socket</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">      input: z.</span><span style=\"color:#6F42C1\">object</span><span style=\"color:#24292E\">({ strict: z.</span><span style=\"color:#6F42C1\">boolean</span><span style=\"color:#24292E\">().</span><span style=\"color:#6F42C1\">default</span><span style=\"color:#24292E\">(</span><span style=\"color:#005CC5\">true</span><span style=\"color:#24292E\">) }),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">      mutates: </span><span style=\"color:#005CC5\">true</span><span style=\"color:#24292E\">,</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">      handler</span><span style=\"color:#24292E\">: (</span><span style=\"color:#E36209\">args</span><span style=\"color:#24292E\">, </span><span style=\"color:#E36209\">client</span><span style=\"color:#24292E\">, </span><span style=\"color:#E36209\">signal</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> spawnAndAwait</span><span style=\"color:#24292E\">(args, signal),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">    },</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  },</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"The package owns what was the ",
			createVNode(_components.em, { children: "bulk" }),
			" of those 1550 lines — the ",
			createVNode(_components.code, { children: "ResourcePusher" }),
			" subscribe/teardown dance, the ",
			createVNode(_components.code, { children: "resources/subscribe" }),
			" → ",
			createVNode(_components.code, { children: "notifications/resources/updated" }),
			" wiring, each tool’s zod→JSON-Schema, and the stdout discipline (via ",
			createVNode(_components.code, { children: "serveOverStdio" }),
			"). odu keeps only what is odu’s: the projection that ",
			createVNode(_components.em, { children: "defines" }),
			" ",
			createVNode(_components.code, { children: "oduAgentSurface" }),
			" (next section), the ",
			createVNode(_components.code, { children: "expose" }),
			" allowlist, and one bespoke ",
			createVNode(_components.code, { children: "run" }),
			" tool."
		] }),
		"\n",
		createVNode(_components.p, { children: "Nothing about the agent’s experience changes — it’s the same session that drives kolu’s CI today:" }),
		"\n",
		createVNode($$Terminal, {
			title: "claude — odu's CI surface as MCP, via @kolu/surface-mcp",
			lines: [
				`$ claude        # odu in .mcp.json — stdio, in-band, predetermines no host`,
				`# /mcp → odu · resources: odu://nodes  odu://log/{node} · tools: run settled node.rerun`,
				` `,
				`user: run CI; if it goes red, find the broken node, show why, rerun it.`,
				` `,
				`→ run()                          # procedure → starts the coordinator`,
				`→ read odu://nodes               # cell resource, live`,
				`    surface ✓ ok   nix-host ✓ ok   attach ✗ failed`,
				`→ read odu://log/attach          # bounded + path-guarded by the projection`,
				`    src/client/wire.ts:88 — TS2345: 'string' not assignable to 'NodeId'`,
				` `,
				`assistant: attach failed on a tsc error at wire.ts:88 — fixed the cast.`,
				` `,
				`→ node.rerun({ id: "attach" })   # the rerun mutator`,
				`→ settled({ failFast: true })    # event → blocks until done or first red`,
				`    { passed: true, durationMs: 4100 }`,
				` `,
				`assistant: Green ✓ — attach passed in 4.1s.`
			]
		}),
		"\n",
		createVNode(_components.p, { children: ["The whole diff from hand-rolled to package: ", createVNode(_components.strong, { children: [
			"~1550 lines of protocol plumbing → a projected surface + an ",
			createVNode(_components.code, { children: "expose" }),
			"/",
			createVNode(_components.code, { children: "tools" }),
			" declaration."
		] })] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-authz-boundary-every-adapter-inherits",
			children: "The authz boundary every adapter inherits"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"“Every surface is an MCP server” means ",
			createVNode(_components.strong, { children: "every exposed procedure is RCE for whoever is connected." }),
			" That is ",
			createVNode(_components.em, { children: "fine" }),
			" under odu’s model — single operator, same ssh trust as the CLI, ",
			createVNode(_components.code, { children: "run.configure" }),
			" simply not on the wire — and it is ",
			createVNode(_components.strong, { children: "load-bearing the moment this enables multi-client exposure." }),
			" The read-observer-versus-mutator boundary the browser PWA face would also force (catalogued as latent in ",
			createVNode(_components.a, {
				href: "./odu.html",
				children: "the odu note"
			}),
			", since grown into ",
			createVNode(_components.a, {
				href: "./odu-web.html",
				children: "its own plan"
			}),
			") is the same boundary here, arriving earlier: an MCP host is an untrusted-ish caller by default."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"So the curation gate isn’t only about ",
			createVNode(_components.em, { children: "usefulness" }),
			" (surface the four good tools), it’s about ",
			createVNode(_components.em, { children: "safety" }),
			" (keep the dangerous verb off, and mark which tools mutate). A generic adapter must make “this tool mutates / this resource is read-only” a first-class, default-deny annotation — not a comment. And ",
			createVNode(_components.code, { children: "mutates" }),
			" itself fails safe: it’s optional but ",
			createVNode(_components.strong, { children: "defaults conservatively" }),
			" — an absent ",
			createVNode(_components.code, { children: "mutates" }),
			" reads as ",
			createVNode(_components.code, { children: "true" }),
			" (destructive / not auto-approvable), because an unannotated tool advertised ",
			createVNode(_components.code, { children: "readOnlyHint: true" }),
			" could be auto-run unconfirmed by a host; a genuinely read-only tool opts in with explicit ",
			createVNode(_components.code, { children: "mutates: false" }),
			". This is why the gate sits ",
			createVNode(_components.em, { children: "downstream" }),
			" of the spine in the diagram, fronting the host: the spine makes the wire correct; the gate decides what’s allowed onto it."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "curation-as-a-projected-surface--the-projectsurface-primitive-982-ships",
			children: [
				"Curation as a projected surface — the ",
				createVNode(_components.code, { children: "projectSurface" }),
				" primitive #982 ships"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The easy reading is that curation “stays hand-written.” It doesn’t have to — and we won’t let it. The sharp move: odu exposes its curation as a ",
			createVNode(_components.em, { children: "second surface" }),
			" projected from the live coordinator; the generic adapter maps that 1:1; the migration is ",
			createVNode(_components.strong, { children: "total" }),
			". The framework piece that makes this first-class — ",
			createVNode(_components.code, { children: "projectSurface" }),
			" — is ",
			createVNode(_components.strong, { children: "in scope for #982, the same PR" }),
			". No “bigger ask, maybe later”; build it right, once."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"odu’s compositions are surface-shaped, so they become primitives of a projected ",
			createVNode(_components.code, { children: "oduAgentSurface" }),
			":"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "tail_log" }),
				" → a ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "log" }), " stream"] }),
				" that bakes the 64 KB bound and the path-traversal refusal into its ",
				createVNode(_components.em, { children: "projection" }),
				" — safe ",
				createVNode(_components.strong, { children: "by construction" }),
				" before it’s ever a primitive."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "wait_for_settle" }),
				" → a ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "settled" }), " event"] }),
				" derived off the ",
				createVNode(_components.code, { children: "nodes" }),
				" cell (fires when the run is terminal, or fail-fast on first red); ",
				createVNode(_components.code, { children: "get_nodes" }),
				"’ ",
				createVNode(_components.code, { children: "red" }),
				" bit → a derived field on ",
				createVNode(_components.code, { children: "nodes" }),
				"."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "oduAgentSurface" }),
			" is a surface that is itself a ",
			createVNode(_components.strong, { children: ["client of ", createVNode(_components.code, { children: "oduSurface" })] }),
			" — and odu’s coordinator already ",
			createVNode(_components.em, { children: "is" }),
			" a server-that’s-a-client, so this is in-grain — served as a ",
			createVNode(_components.strong, { children: "sibling" }),
			" of ",
			createVNode(_components.code, { children: "oduSurface" }),
			" over the same transport."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: surface_mcp_projectsurface_default,
			caption: "projectSurface, in one PR. oduAgentSurface (B, green = observer-safe) is a curated projection of the live oduSurface (A), served as a sibling of the NEW projectSurface primitive (amber). Every face — TUI, web, and @kolu/surface-mcp — maps B 1:1; a projected stream's teardown is the same lifecycle the adapter spine builds, so it's solved once. Genuinely call-shaped bits (run) ride the adapter as bespoke tools, not forced through surface."
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"What ",
				createVNode(_components.code, { children: "projectSurface" }),
				" actually requires"
			] }),
			" — grounded in the framework, this is bounded, not a rewrite. Already present and reused as-is: sibling composition (",
			createVNode(_components.code, { children: "implementSurfaces" }),
			" / ",
			createVNode(_components.code, { children: "composeSurfaceContracts" }),
			" / ",
			createVNode(_components.code, { children: "surfaceClients" }),
			") and the handler ",
			createVNode(_components.code, { children: "source: (input, signal) => AsyncIterable" }),
			" shape. Genuinely net-new, all in this PR:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "projectSurface(sourceSurface, projection) → Surface<B>" }) }),
				" — the combinator plus a typed ",
				createVNode(_components.code, { children: "ProjectionSpec" }),
				" that references A’s descriptors and computes B’s spec."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "surfaceClientRef" }) }),
				" — the one missing internal: a way for B’s handlers to hold a live client of sibling surface A ",
				createVNode(_components.em, { children: "on the same host" }),
				" (today siblings are independent)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"a ",
					createVNode(_components.code, { children: "reactiveCell" }),
					" / ",
					createVNode(_components.code, { children: "derive" }),
					" helper"
				] }),
				" — so a projected cell/event re-computes from its source (e.g. ",
				createVNode(_components.code, { children: "settled" }),
				" from ",
				createVNode(_components.code, { children: "nodes" }),
				") instead of every projection re-hand-wiring poll-on-delta."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The payoff that makes this worth doing ",
			createVNode(_components.em, { children: "in-package" }),
			": a projected stream’s subscribe/teardown is the ",
			createVNode(_components.strong, { children: [
				"same ",
				createVNode(_components.code, { children: "ERR_STREAM_DESTROYED" }),
				"-class lifecycle the spine already builds"
			] }),
			" — so it’s solved ",
			createVNode(_components.strong, { children: "once" }),
			", in surface-land, and shared by the MCP adapter, the projection, and every future face. One teardown, not one per consumer. ",
			createVNode(_components.em, { children: "(Lowy: encapsulate “a safe, useful projection of a run” behind one socket; Hickey: don’t write the teardown twice.)" })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Two paths, no gap." }),
			" Not everything is surface-shaped, and surface-mcp doesn’t pretend it is. Alongside ",
			createVNode(_components.code, { children: "expose" }),
			" (map/project primitives), the adapter takes ",
			createVNode(_components.strong, { children: ["bespoke ", createVNode(_components.code, { children: "tools" })] }),
			" — hand-authored MCP tools whose handler composes over the live client and still rides the package’s zod→JSON-Schema, lifecycle, and stdout spine (it just supplies a zod input + a function). ",
			createVNode(_components.code, { children: "run" }),
			" — spawn the coordinator, block until its socket is live — is genuinely call-shaped, so it’s a bespoke tool, not a forced primitive. The “MCP-call-shaped sliver” isn’t a graduation gap; it’s a first-class second registration path. Surface-shaped curation → project it (every face benefits); call-shaped capability → a bespoke tool (the adapter’s legitimate job)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"Authz becomes the ",
				createVNode(_components.em, { children: "shape" }),
				" of the surface."
			] }),
			" ",
			createVNode(_components.code, { children: "run.configure" }),
			" isn’t “denied” — it simply isn’t ",
			createVNode(_components.em, { children: "in" }),
			" ",
			createVNode(_components.code, { children: "oduAgentSurface" }),
			". Observer-vs-mutator becomes “expose the read-only surface, or the mutating one”; what’s left to mark is which of the few bespoke tools mutate."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "does-it-graduate--the-electricity-test-applied-honestly",
			children: "Does it graduate? — the electricity test, applied honestly"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.a, {
				href: "./electricity.html",
				children: "Electricity"
			}),
			" is the bar for a ",
			createVNode(_components.code, { children: "@kolu/*" }),
			" extraction: ① domain-agnostic, ② hides a ",
			createVNode(_components.em, { children: "hard" }),
			" volatility, ③ graduates — a ",
			createVNode(_components.em, { children: "different" }),
			" consumer plugs in, proven not aspired."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "① domain-agnostic — yes." }),
				" The spine maps ",
				createVNode(_components.em, { children: "any" }),
				" spec; no CI/notes/terminal vocabulary leaks into it."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "② hard volatility — yes, and it’s the right one." }),
				" Not “a tidy generic module” (the leaf trap the electricity note warns about) — it hides the MCP ",
				createVNode(_components.strong, { children: "subscribe/teardown lifecycle" }),
				", the notification framing, the zod→JSON-Schema bridge, and the stdout-is-protocol discipline. That’s transport-and-protocol volatility, the receptacle kind."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "③ graduates — totally." }),
				" odu’s ",
				createVNode(_components.code, { children: "odu mcp" }),
				" is a real, shipped first consumer — no toy demo needed. The test, stated precisely: ",
				createVNode(_components.strong, { children: [
					"can odu’s ",
					createVNode(_components.code, { children: "src/mcp/*" }),
					" refactor ",
					createVNode(_components.em, { children: "onto" }),
					" the package?"
				] }),
				" Yes, end to end: the ",
				createVNode(_components.em, { children: "spine" }),
				" subsumes the lifecycle/resource/schema plumbing (odu deletes it); the ",
				createVNode(_components.em, { children: "curation" }),
				" moves into a projected ",
				createVNode(_components.code, { children: "oduAgentSurface" }),
				" via ",
				createVNode(_components.code, { children: "projectSurface" }),
				" (surface-shaped, now reused by the TUI and web); and the genuinely call-shaped bits (",
				createVNode(_components.code, { children: "run" }),
				") become bespoke ",
				createVNode(_components.code, { children: "tools" }),
				" on the adapter. What stays uniquely odu’s is the ",
				createVNode(_components.em, { children: "projection logic" }),
				" — domain work, in surface-land where every face shares it — and a short bespoke-tools file. ",
				createVNode(_components.code, { children: "src/mcp/" }),
				" (~1550 lines) → a projection + an ",
				createVNode(_components.code, { children: "expose" }),
				"/",
				createVNode(_components.code, { children: "tools" }),
				" declaration. That’s not “real electricity, mostly” — it’s the whole receptacle."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "The recommendation, in one line",
			children: createVNode(_components.p, { children: [
				"Ship #982 as ",
				createVNode(_components.strong, { children: "one PR, three moving parts, no follow-ups" }),
				": ",
				createVNode(_components.strong, { children: "(1)" }),
				" a sibling package ",
				createVNode(_components.code, { children: "packages/surface-mcp/" }),
				" (so ",
				createVNode(_components.code, { children: "@modelcontextprotocol/sdk" }),
				" never enters core surface) — the lifecycle spine, the zod→JSON-Schema buy-plus-glue, composition with ",
				createVNode(_components.code, { children: "serveOverStdio" }),
				", a default-deny ",
				createVNode(_components.code, { children: "expose" }),
				", and a ",
				createVNode(_components.strong, { children: ["bespoke-", createVNode(_components.code, { children: "tools" })] }),
				" escape hatch for call-shaped capabilities; ",
				createVNode(_components.strong, { children: "(2)" }),
				" ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "projectSurface" }) }),
				" added to core ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				" (the combinator + ",
				createVNode(_components.code, { children: "surfaceClientRef" }),
				" + a ",
				createVNode(_components.code, { children: "derive" }),
				" helper) so curation lives as a projected surface every face shares; ",
				createVNode(_components.strong, { children: "(3)" }),
				" ",
				createVNode(_components.strong, { children: "odu’s full migration" }),
				" — delete ",
				createVNode(_components.code, { children: "src/mcp/" }),
				", project ",
				createVNode(_components.code, { children: "oduAgentSurface" }),
				", keep ",
				createVNode(_components.code, { children: "run" }),
				" as a bespoke tool — as the falsifiability proof. The honest pitch: ",
				createVNode(_components.em, { children: "every surface is an MCP server without re-writing the subscribe-teardown dance, the schema bridge, or the stdout discipline — and you still shape, in surface-land, exactly what’s exposed." })
			] })
		})
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
	"title": "@kolu/surface-mcp — every surface an MCP server, honestly scoped",
	"description": "A generic adapter that re-exposes any @kolu/surface spec to an MCP host. The 1:1 primitive→tool map is the demo; the real package is the subscribe/teardown lifecycle, the zod→JSON-Schema bridge, and the tool-selection/authz gate. Grounded in odu's hand-built mcp face — the validated, and partial, prior art.",
	"parents": [
		"odu",
		"electricity",
		"feature",
		"surface"
	],
	"status": "implemented",
	"maturity": "budding",
	"updated": "2026-06-10T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-map-is-a-morning-the-selection-is-the-project",
			"text": "The map is a morning; the selection is the project"
		},
		{
			"depth": 3,
			"slug": "how-the-developer-tags-it--in-typescript-default-deny",
			"text": "How the developer tags it — in TypeScript, default-deny"
		},
		{
			"depth": 2,
			"slug": "the-hard-part-is-lifecycle-not-mapping",
			"text": "The hard part is lifecycle, not mapping"
		},
		{
			"depth": 2,
			"slug": "two-shapes-serve-a-spec-or-bridge-a-live-surface",
			"text": "Two shapes: serve a spec, or bridge a live surface"
		},
		{
			"depth": 2,
			"slug": "see-it-in-action-odus-agent-face-on-the-package",
			"text": "See it in action: odu’s agent face, on the package"
		},
		{
			"depth": 2,
			"slug": "the-authz-boundary-every-adapter-inherits",
			"text": "The authz boundary every adapter inherits"
		},
		{
			"depth": 2,
			"slug": "curation-as-a-projected-surface--the-projectsurface-primitive-982-ships",
			"text": "Curation as a projected surface — the projectSurface primitive #982 ships"
		},
		{
			"depth": 2,
			"slug": "does-it-graduate--the-electricity-test-applied-honestly",
			"text": "Does it graduate? — the electricity test, applied honestly"
		}
	];
}
var url = "src/content/atlas/surface-mcp.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/surface-mcp.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/surface-mcp.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
