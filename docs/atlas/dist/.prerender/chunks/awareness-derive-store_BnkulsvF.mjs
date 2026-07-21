import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import "./Issue_mLFqCJSR.mjs";
import "./Phase_Ctvqq2QS.mjs";
import { t as $$PhaseTree } from "./PhaseTree_DI8OxotU.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
//#region src/diagrams/awareness-before.svg?raw
var awareness_before_default = "<svg viewBox=\"0 0 720 440\" xmlns=\"http://www.w3.org/2000/svg\" font-family=\"ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif\">\n  <defs>\n    <marker id=\"r\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#dc2626\"/></marker>\n    <marker id=\"s\" markerWidth=\"8\" markerHeight=\"8\" refX=\"6\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L6,3 L0,6 Z\" fill=\"#94a3b8\"/></marker>\n    <marker id=\"b\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#3a2bb8\"/></marker>\n  </defs>\n\n  <text x=\"360\" y=\"22\" text-anchor=\"middle\" font-size=\"14\" font-weight=\"700\" fill=\"#334155\">Today — deriving is fused with storing</text>\n  <text x=\"360\" y=\"41\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#64748b\">record.meta is the engine's prior-state AND the host's store — one object, two roles</text>\n\n  <!-- sensor set -->\n  <rect x=\"258\" y=\"62\" width=\"204\" height=\"52\" rx=\"9\" fill=\"#fff6e8\" stroke=\"#d98a1f\" stroke-width=\"1.7\"/>\n  <text x=\"360\" y=\"84\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"#8a5a12\">sensor set (the engine)</text>\n  <text x=\"360\" y=\"101\" text-anchor=\"middle\" font-size=\"10\" fill=\"#7a4f10\">git→pr · agent×3 · foreground</text>\n\n  <!-- record.meta — the complect (red) -->\n  <rect x=\"240\" y=\"176\" width=\"240\" height=\"84\" rx=\"10\" fill=\"#fff0f0\" stroke=\"#dc2626\" stroke-width=\"1.9\"/>\n  <text x=\"360\" y=\"200\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"#991b1b\">record.meta : AwarenessValue</text>\n  <text x=\"360\" y=\"222\" text-anchor=\"middle\" font-size=\"10\" fill=\"#b91c1c\">▲ read back — dedup · recency · session gates</text>\n  <text x=\"360\" y=\"240\" text-anchor=\"middle\" font-size=\"10\" fill=\"#b91c1c\">▼ mutated in place = the store</text>\n\n  <!-- bidirectional fusion arrows -->\n  <line x1=\"328\" y1=\"116\" x2=\"328\" y2=\"174\" stroke=\"#dc2626\" stroke-width=\"1.8\" marker-end=\"url(#r)\"/>\n  <line x1=\"392\" y1=\"174\" x2=\"392\" y2=\"116\" stroke=\"#dc2626\" stroke-width=\"1.8\" marker-end=\"url(#r)\"/>\n  <rect x=\"150\" y=\"135\" width=\"118\" height=\"16\" rx=\"3\" fill=\"#fff\"/>\n  <text x=\"209\" y=\"147\" text-anchor=\"middle\" font-size=\"9.5\" font-weight=\"700\" fill=\"#dc2626\">mutate via sink ▼</text>\n  <rect x=\"452\" y=\"135\" width=\"118\" height=\"16\" rx=\"3\" fill=\"#fff\"/>\n  <text x=\"511\" y=\"147\" text-anchor=\"middle\" font-size=\"9.5\" font-weight=\"700\" fill=\"#dc2626\">▲ read prior-state</text>\n\n  <!-- the two homes that alias record.meta -->\n  <rect x=\"60\" y=\"310\" width=\"270\" height=\"66\" rx=\"9\" fill=\"#efebff\" stroke=\"#5a3ff0\" stroke-width=\"1.6\"/>\n  <text x=\"195\" y=\"333\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"700\" fill=\"#3a2bb8\">kolu host — its own sink</text>\n  <text x=\"195\" y=\"350\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"#352a7a\">entry.awareness (registry) · fold · persist</text>\n  <text x=\"195\" y=\"366\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"#352a7a\">+ trackRecent</text>\n\n  <rect x=\"392\" y=\"310\" width=\"266\" height=\"66\" rx=\"9\" fill=\"#eef2f7\" stroke=\"#64748b\" stroke-width=\"1.6\"/>\n  <text x=\"525\" y=\"333\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"700\" fill=\"#334155\">pulam host — its own sink</text>\n  <text x=\"525\" y=\"350\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"#475569\">its cache · publish</text>\n  <text x=\"525\" y=\"366\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"#475569\">(ephemeral)</text>\n\n  <line x1=\"300\" y1=\"258\" x2=\"210\" y2=\"308\" stroke=\"#94a3b8\" stroke-width=\"1.3\" stroke-dasharray=\"3 4\" marker-end=\"url(#s)\"/>\n  <line x1=\"420\" y1=\"258\" x2=\"512\" y2=\"308\" stroke=\"#94a3b8\" stroke-width=\"1.3\" stroke-dasharray=\"3 4\" marker-end=\"url(#s)\"/>\n  <rect x=\"246\" y=\"276\" width=\"86\" height=\"15\" rx=\"3\" fill=\"#fff\"/>\n  <text x=\"289\" y=\"288\" text-anchor=\"middle\" font-size=\"9\" fill=\"#64748b\">record IS this</text>\n  <rect x=\"398\" y=\"276\" width=\"86\" height=\"15\" rx=\"3\" fill=\"#fff\"/>\n  <text x=\"441\" y=\"288\" text-anchor=\"middle\" font-size=\"9\" fill=\"#64748b\">record IS this</text>\n\n  <!-- consequence footnote -->\n  <rect x=\"40\" y=\"402\" width=\"640\" height=\"28\" rx=\"8\" fill=\"#fff7ed\" stroke=\"#fdba74\" stroke-width=\"1.1\"/>\n  <text x=\"360\" y=\"420\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"#9a3412\">Each home wires its OWN sink + record ⟹ <tspan font-weight=\"700\">two assemblers</tspan>; and because deriving writes the store, a fresh derivation can <tspan font-weight=\"700\">clobber</tspan> remembered state.</text>\n</svg>\n";
//#endregion
//#region src/diagrams/awareness-foldflow.svg?raw
var awareness_foldflow_default = "<svg viewBox=\"0 0 800 472\" xmlns=\"http://www.w3.org/2000/svg\" font-family=\"ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif\">\n  <defs>\n    <marker id=\"b\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#3a2bb8\"/></marker>\n    <marker id=\"g\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#15803d\"/></marker>\n    <marker id=\"a\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#b06d12\"/></marker>\n    <marker id=\"s\" markerWidth=\"8\" markerHeight=\"8\" refX=\"6\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L6,3 L0,6 Z\" fill=\"#94a3b8\"/></marker>\n  </defs>\n\n  <text x=\"400\" y=\"22\" text-anchor=\"middle\" font-size=\"14\" font-weight=\"700\" fill=\"#334155\">S2 (R9.0) — the producer observes, kolu remembers</text>\n\n  <!-- kaval taps -->\n  <rect x=\"36\" y=\"52\" width=\"208\" height=\"46\" rx=\"9\" fill=\"#f1f5f9\" stroke=\"#64748b\" stroke-width=\"1.6\"/>\n  <text x=\"140\" y=\"72\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"700\" fill=\"#334155\">kaval taps</text>\n  <text x=\"140\" y=\"89\" text-anchor=\"middle\" font-size=\"9.3\" fill=\"#475569\">cwd · title · commandRun · foreground</text>\n\n  <!-- producer -->\n  <rect x=\"292\" y=\"44\" width=\"232\" height=\"84\" rx=\"10\" fill=\"#fff6e8\" stroke=\"#d98a1f\" stroke-width=\"1.9\"/>\n  <text x=\"408\" y=\"68\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#8a5a12\">memoryless producer</text>\n  <text x=\"408\" y=\"86\" text-anchor=\"middle\" font-size=\"10\" fill=\"#7a4f10\">emits events · no seed</text>\n  <text x=\"408\" y=\"103\" text-anchor=\"middle\" font-size=\"10\" fill=\"#7a4f10\">TerminalSnapshot only</text>\n  <text x=\"408\" y=\"120\" text-anchor=\"middle\" font-size=\"9\" font-style=\"italic\" fill=\"#b07d2a\">cannot spell the 2 memory fields</text>\n  <line x1=\"244\" y1=\"76\" x2=\"290\" y2=\"86\" stroke=\"#64748b\" stroke-width=\"1.6\" marker-end=\"url(#s)\"/>\n\n  <!-- event legend -->\n  <rect x=\"560\" y=\"46\" width=\"224\" height=\"126\" rx=\"9\" fill=\"#fffdf6\" stroke=\"#e7c98a\" stroke-width=\"1.3\"/>\n  <text x=\"571\" y=\"64\" font-size=\"10.3\" font-weight=\"700\" fill=\"#8a5a12\">TerminalEvent</text>\n  <text x=\"571\" y=\"82\" font-size=\"9.2\" fill=\"#7a4f10\">cwd · git · pr · foreground</text>\n  <text x=\"571\" y=\"99\" font-size=\"9.2\" fill=\"#7a4f10\">agent  (snapshot|delta from frame)</text>\n  <text x=\"571\" y=\"116\" font-size=\"9.2\" fill=\"#7a4f10\">commandRun &#123; replayed &#125;</text>\n  <text x=\"571\" y=\"135\" font-size=\"9\" font-style=\"italic\" fill=\"#b07d2a\">— no memory fields —</text>\n  <text x=\"571\" y=\"155\" font-size=\"9\" font-style=\"italic\" fill=\"#b07d2a\">recentRepo/Agent: fold-derived</text>\n  <line x1=\"524\" y1=\"92\" x2=\"558\" y2=\"92\" stroke=\"#b06d12\" stroke-width=\"1.6\" marker-end=\"url(#a)\"/>\n\n  <!-- kolu fold -->\n  <rect x=\"292\" y=\"196\" width=\"232\" height=\"84\" rx=\"10\" fill=\"#eafaf0\" stroke=\"#15803d\" stroke-width=\"1.8\"/>\n  <text x=\"408\" y=\"220\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"#14663a\">kolu's fold</text>\n  <text x=\"408\" y=\"238\" text-anchor=\"middle\" font-size=\"9.8\" fill=\"#14663a\">last-write-wins + 2 kolu-only fields</text>\n  <text x=\"408\" y=\"255\" text-anchor=\"middle\" font-size=\"9.8\" fill=\"#14663a\">kolu's clock · identity-only recency</text>\n  <text x=\"408\" y=\"272\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"#14663a\">arm autosave = restore-relevant value changed</text>\n  <line x1=\"408\" y1=\"128\" x2=\"408\" y2=\"196\" stroke=\"#b06d12\" stroke-width=\"1.8\" marker-end=\"url(#a)\"/>\n  <rect x=\"360\" y=\"152\" width=\"96\" height=\"16\" rx=\"3\" fill=\"#fff\"/>\n  <text x=\"408\" y=\"164\" text-anchor=\"middle\" font-size=\"9\" font-weight=\"700\" fill=\"#b06d12\">events</text>\n\n  <!-- two stores -->\n  <rect x=\"64\" y=\"322\" width=\"262\" height=\"58\" rx=\"9\" fill=\"#efebff\" stroke=\"#5a3ff0\" stroke-width=\"1.7\"/>\n  <text x=\"195\" y=\"344\" text-anchor=\"middle\" font-size=\"11\" font-weight=\"700\" fill=\"#3a2bb8\">snapshots collection</text>\n  <text x=\"195\" y=\"362\" text-anchor=\"middle\" font-size=\"9.3\" fill=\"#352a7a\">TerminalSnapshot {cwd·git·pr·agent·fg} — no memory</text>\n\n  <rect x=\"470\" y=\"322\" width=\"298\" height=\"58\" rx=\"9\" fill=\"#efebff\" stroke=\"#5a3ff0\" stroke-width=\"1.7\"/>\n  <text x=\"619\" y=\"344\" text-anchor=\"middle\" font-size=\"11\" font-weight=\"700\" fill=\"#3a2bb8\">kolu.authored</text>\n  <text x=\"619\" y=\"362\" text-anchor=\"middle\" font-size=\"9.3\" fill=\"#352a7a\">memory: lastActivityAt · lastAgentCommand</text>\n\n  <line x1=\"360\" y1=\"280\" x2=\"240\" y2=\"320\" stroke=\"#15803d\" stroke-width=\"1.7\" marker-end=\"url(#g)\"/>\n  <rect x=\"244\" y=\"294\" width=\"78\" height=\"15\" rx=\"3\" fill=\"#fff\"/>\n  <text x=\"283\" y=\"306\" text-anchor=\"middle\" font-size=\"8.8\" fill=\"#15803d\">snapshot</text>\n  <line x1=\"470\" y1=\"280\" x2=\"600\" y2=\"320\" stroke=\"#15803d\" stroke-width=\"1.7\" marker-end=\"url(#g)\"/>\n  <rect x=\"500\" y=\"294\" width=\"64\" height=\"15\" rx=\"3\" fill=\"#fff\"/>\n  <text x=\"532\" y=\"306\" text-anchor=\"middle\" font-size=\"8.8\" fill=\"#15803d\">memory</text>\n\n  <!-- browser -->\n  <rect x=\"280\" y=\"412\" width=\"300\" height=\"38\" rx=\"8\" fill=\"#f4f1ff\" stroke=\"#5a3ff0\" stroke-width=\"1.5\"/>\n  <text x=\"430\" y=\"436\" text-anchor=\"middle\" font-size=\"10.5\" font-weight=\"700\" fill=\"#3a2bb8\">browser — authored ⋈ snapshots (unchanged)</text>\n  <line x1=\"220\" y1=\"380\" x2=\"330\" y2=\"412\" stroke=\"#3a2bb8\" stroke-width=\"1.5\" marker-end=\"url(#b)\"/>\n  <line x1=\"600\" y1=\"380\" x2=\"510\" y2=\"412\" stroke=\"#3a2bb8\" stroke-width=\"1.5\" marker-end=\"url(#b)\"/>\n\n  <!-- footnote -->\n  <text x=\"400\" y=\"466\" text-anchor=\"middle\" font-size=\"9.3\" font-style=\"italic\" fill=\"#64748b\">no record handed back · no sink · no seed · no clobber — and a producer cannot spell memory, by type</text>\n</svg>\n";
//#endregion
//#region src/diagrams/awareness-homes.svg?raw
var awareness_homes_default = "<svg viewBox=\"0 0 820 432\" xmlns=\"http://www.w3.org/2000/svg\" font-family=\"ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif\">\n  <defs>\n    <marker id=\"b\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#3a2bb8\"/></marker>\n    <marker id=\"g\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#15803d\"/></marker>\n    <marker id=\"s\" markerWidth=\"8\" markerHeight=\"8\" refX=\"6\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L6,3 L0,6 Z\" fill=\"#94a3b8\"/></marker>\n  </defs>\n\n  <text x=\"410\" y=\"22\" text-anchor=\"middle\" font-size=\"14\" font-weight=\"700\" fill=\"#334155\">Same producer, same fold — two transports (local R9.0 · remote R9.3)</text>\n\n  <!-- LOCAL -->\n  <rect x=\"20\" y=\"40\" width=\"362\" height=\"352\" rx=\"12\" fill=\"#ffffff\" stroke=\"#cbd5e1\" stroke-width=\"1.2\" stroke-dasharray=\"6 5\"/>\n  <text x=\"40\" y=\"58\" font-size=\"11.5\" font-weight=\"700\" fill=\"#64748b\">LOCAL (R9.0) — kolu-server</text>\n\n  <rect x=\"66\" y=\"74\" width=\"270\" height=\"44\" rx=\"9\" fill=\"#fff6e8\" stroke=\"#d98a1f\" stroke-width=\"1.8\"/>\n  <text x=\"201\" y=\"93\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"700\" fill=\"#8a5a12\">memoryless producer — in-process</text>\n  <text x=\"201\" y=\"109\" text-anchor=\"middle\" font-size=\"9\" font-style=\"italic\" fill=\"#b07d2a\">← kaval taps (local socket)</text>\n\n  <rect x=\"66\" y=\"146\" width=\"270\" height=\"44\" rx=\"9\" fill=\"#eafaf0\" stroke=\"#15803d\" stroke-width=\"1.7\"/>\n  <text x=\"201\" y=\"165\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"700\" fill=\"#14663a\">kolu's fold</text>\n  <text x=\"201\" y=\"181\" text-anchor=\"middle\" font-size=\"9\" fill=\"#14663a\">kolu's clock · seeds from its record</text>\n\n  <rect x=\"66\" y=\"216\" width=\"270\" height=\"44\" rx=\"9\" fill=\"#efebff\" stroke=\"#5a3ff0\" stroke-width=\"1.7\"/>\n  <text x=\"201\" y=\"235\" text-anchor=\"middle\" font-size=\"10.5\" font-weight=\"700\" fill=\"#3a2bb8\">snapshots = TerminalSnapshot</text>\n  <text x=\"201\" y=\"251\" text-anchor=\"middle\" font-size=\"9.3\" fill=\"#352a7a\">+ memory → kolu.authored</text>\n\n  <rect x=\"66\" y=\"300\" width=\"270\" height=\"42\" rx=\"9\" fill=\"#f4f1ff\" stroke=\"#5a3ff0\" stroke-width=\"1.5\"/>\n  <text x=\"201\" y=\"320\" text-anchor=\"middle\" font-size=\"10.5\" font-weight=\"700\" fill=\"#3a2bb8\">browser</text>\n  <text x=\"201\" y=\"335\" text-anchor=\"middle\" font-size=\"9\" fill=\"#352a7a\">authored ⋈ snapshots</text>\n\n  <line x1=\"201\" y1=\"118\" x2=\"201\" y2=\"146\" stroke=\"#b06d12\" stroke-width=\"1.6\" marker-end=\"url(#g)\"/>\n  <line x1=\"201\" y1=\"190\" x2=\"201\" y2=\"216\" stroke=\"#15803d\" stroke-width=\"1.6\" marker-end=\"url(#g)\"/>\n  <line x1=\"201\" y1=\"260\" x2=\"201\" y2=\"300\" stroke=\"#3a2bb8\" stroke-width=\"1.5\" marker-end=\"url(#b)\"/>\n\n  <!-- REMOTE -->\n  <rect x=\"438\" y=\"40\" width=\"362\" height=\"352\" rx=\"12\" fill=\"#ffffff\" stroke=\"#cbd5e1\" stroke-width=\"1.2\" stroke-dasharray=\"6 5\"/>\n  <text x=\"780\" y=\"58\" text-anchor=\"end\" font-size=\"11.5\" font-weight=\"700\" fill=\"#64748b\">REMOTE (R9.3)</text>\n\n  <text x=\"484\" y=\"76\" font-size=\"9.5\" font-weight=\"700\" fill=\"#8a5a12\">pulam daemon (degenerate host — no memory)</text>\n  <rect x=\"484\" y=\"82\" width=\"272\" height=\"42\" rx=\"9\" fill=\"#fff6e8\" stroke=\"#d98a1f\" stroke-width=\"1.8\"/>\n  <text x=\"620\" y=\"101\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"700\" fill=\"#8a5a12\">memoryless producer — SAME</text>\n  <text x=\"620\" y=\"116\" text-anchor=\"middle\" font-size=\"9\" font-style=\"italic\" fill=\"#b07d2a\">← remote kaval taps</text>\n\n  <rect x=\"484\" y=\"148\" width=\"272\" height=\"40\" rx=\"9\" fill=\"#eef2f7\" stroke=\"#64748b\" stroke-width=\"1.6\"/>\n  <text x=\"620\" y=\"166\" text-anchor=\"middle\" font-size=\"10.3\" font-weight=\"700\" fill=\"#334155\">serve: terminalEvents stream</text>\n  <text x=\"620\" y=\"180\" text-anchor=\"middle\" font-size=\"9\" fill=\"#475569\">TerminalEvent · snapshot-then-deltas</text>\n\n  <rect x=\"466\" y=\"270\" width=\"312\" height=\"64\" rx=\"9\" fill=\"#eafaf0\" stroke=\"#15803d\" stroke-width=\"1.7\"/>\n  <text x=\"622\" y=\"291\" text-anchor=\"middle\" font-size=\"10.8\" font-weight=\"700\" fill=\"#14663a\">kolu: subscribe stream → the SAME fold</text>\n  <text x=\"622\" y=\"308\" text-anchor=\"middle\" font-size=\"9.3\" fill=\"#14663a\">kolu's clock · seeds from its record</text>\n  <text x=\"622\" y=\"324\" text-anchor=\"middle\" font-size=\"8.6\" font-style=\"italic\" fill=\"#15803d\">snapshot frame IS the reconcile — no reconcileRemoteSnapshot</text>\n\n  <line x1=\"620\" y1=\"124\" x2=\"620\" y2=\"148\" stroke=\"#b06d12\" stroke-width=\"1.6\" marker-end=\"url(#g)\"/>\n  <line x1=\"620\" y1=\"188\" x2=\"620\" y2=\"270\" stroke=\"#15803d\" stroke-width=\"1.7\" stroke-dasharray=\"5 3\" marker-end=\"url(#g)\"/>\n  <rect x=\"556\" y=\"216\" width=\"128\" height=\"16\" rx=\"3\" fill=\"#fff\"/>\n  <text x=\"620\" y=\"228\" text-anchor=\"middle\" font-size=\"9\" font-weight=\"700\" fill=\"#15803d\">ssh · events (lossless)</text>\n\n  <!-- same connector -->\n  <line x1=\"336\" y1=\"96\" x2=\"484\" y2=\"103\" stroke=\"#94a3b8\" stroke-width=\"1.4\" stroke-dasharray=\"3 4\" marker-end=\"url(#s)\"/>\n  <rect x=\"350\" y=\"78\" width=\"120\" height=\"15\" rx=\"3\" fill=\"#fff\"/>\n  <text x=\"410\" y=\"90\" text-anchor=\"middle\" font-size=\"8.8\" font-weight=\"700\" fill=\"#64748b\">identical producer + fold</text>\n\n  <!-- footnote -->\n  <rect x=\"20\" y=\"400\" width=\"780\" height=\"26\" rx=\"8\" fill=\"#ffffff\" stroke=\"#cbd5e1\" stroke-width=\"1.1\" stroke-dasharray=\"5 4\"/>\n  <text x=\"410\" y=\"417\" text-anchor=\"middle\" font-size=\"9.3\" fill=\"#64748b\">kolu seeds <tspan font-weight=\"700\" fill=\"#475569\">current</tspan> from its durable record either way, so the snapshot frame is the reconcile — one fold, two transports. Memory → <tspan font-weight=\"700\" fill=\"#475569\">kolu.authored</tspan>; the snapshots collection is TerminalSnapshot everywhere.</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/awareness-derive-store.mdx
var PT = [
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "S1 · memoryless producer — observations, no seed, TerminalSnapshot only",
		m: "shipped #1626",
		h: "#s1"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "S2 · kolu's fold — last-write-wins + 2 kolu-only fields · kolu's clock · memory→authored",
		m: "shipped #1626",
		h: "#s2"
	},
	{
		d: 0,
		g: "✕",
		c: "prog",
		l: "R9·lib · DISSOLVES — nothing to assemble; producer + fold are pure leaves",
		m: "subsumed by S1+S2",
		h: "#how-r9-collapses"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "R9.0 · kolu runs the producer in-process, folds onto authored+snapshots",
		m: "shipped #1626 (foundation assessed transport-agnostic)",
		h: "#how-r9-collapses"
	},
	{
		d: 0,
		g: "✕",
		c: "prog",
		l: "PR-3 · awareness host-ready — framer + terminalEvents wire — never built",
		m: "superseded by padi",
		h: "#r93-the-remote-build"
	},
	{
		d: 0,
		g: "✕",
		c: "prog",
		l: "F-REMOTE · the complete remote tile — never proceeded",
		m: "superseded by padi",
		h: "remote-terminals.html#finale"
	},
	{
		d: 0,
		g: "✕",
		c: "last",
		l: "PR-1 · PR-2 · R10 (lifecycle · fs/git · host-picker UX) — never proceeded",
		m: "superseded by padi",
		h: "remote-terminals.html#finale"
	}
];
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		li: "li",
		ol: "ol",
		p: "p",
		pre: "pre",
		span: "span",
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
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The de-entanglement that makes R9 mostly evaporate." }),
			" Every hard thing in ",
			createVNode(_components.a, {
				href: "remote-terminals.html#finale",
				children: "the finale plan"
			}),
			" — the two assemblers, the createPulam boundary, the fold-clobber — traces to ",
			createVNode(_components.strong, { children: "one" }),
			" complect: the sensor engine ",
			createVNode(_components.em, { children: "derives" }),
			" awareness by ",
			createVNode(_components.em, { children: "mutating a host record it also reads back as memory" }),
			". Split ",
			createVNode(_components.strong, { children: "observing" }),
			" from ",
			createVNode(_components.strong, { children: "remembering" }),
			" and it dissolves. This note pins the ",
			createVNode(_components.strong, { children: "types, the API, and the flows" }),
			" so the boundary can be evaluated before any code; every claim cites the code it restructures."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Landed" }),
			" (S1 + S2 → R9.0): ",
			createVNode($$PrLink, { pr: 1626 }),
			", then hardened by a 4-reviewer architecture-first-principles + perfection-review gauntlet. As shipped, the restore target is a ",
			createVNode(_components.strong, { children: "fold-produced discriminated value" }),
			" on the authored record — ",
			createVNode(_components.code, { children: "RestoreTarget = none | { exact, command, agent } | { legacyMostRecent, command }" }),
			" (",
			createVNode(_components.code, { children: "restoreTargetOf" }),
			", consumed by ",
			createVNode(_components.code, { children: "resumeFormFor" }),
			") — rather than a bare optional identity, so an absent field can never be misread as “resume most-recent”. Quit-to-shell → ",
			createVNode(_components.code, { children: "none" }),
			" → ",
			createVNode(_components.strong, { children: "bare shell by construction" }),
			" for new records (the strict #1492 behavior); migrated pre-1.29 records keep their old most-recent resume as a ",
			createVNode(_components.em, { children: "named" }),
			" ",
			createVNode(_components.code, { children: "legacyMostRecent" }),
			". ",
			createVNode(_components.strong, { children: "Deferred" }),
			" (tracked, not shipped): the ",
			createVNode(_components.strong, { children: "active drain-at-sleep" }),
			" — ",
			createVNode(_components.code, { children: "beginSleep" }),
			" freezes the last fold-written target and does ",
			createVNode(_components.strong, { children: "not" }),
			" drain a final settle, so a launch-then-sleep ",
			createVNode(_components.em, { children: "inside" }),
			" the agent settle window freezes a stale ",
			createVNode(_components.code, { children: "none" }),
			" and wakes to a ",
			createVNode(_components.strong, { children: "false bare shell" }),
			" (narrow, self-corrects on re-launch). The recency frame phase is now ",
			createVNode(_components.strong, { children: "value-based" }),
			" (compare the re-resolved identity to the saved target), not the original wall-clock window. ",
			createVNode(_components.strong, { children: "Follow-up fix" }),
			" (",
			createVNode($$PrLink, { pr: 1726 }),
			"): making recency ",
			createVNode(_components.em, { children: "identity-only" }),
			" froze it for a stable session — a terminal running one week-old session forever never changed identity, so its “last activity” stopped moving even while it produced output. Recency now bumps on a same-identity ",
			createVNode(_components.strong, { children: "output" }),
			" tick too, throttled to ",
			createVNode(_components.code, { children: "RECENCY_THROTTLE_MS" }),
			" (60s) so the ~1s agent-detail firehose can’t recreate the per-tick write noise #1626 removed; the identity bump stays and the two compose. The ",
			createVNode(_components.code, { children: "recencyBaseline" }),
			" (seeded to the survivor’s identity) is kept — it’s what keeps the adopt re-observation from counting as new activity, and, being identity- not count-based, it holds across the survivor’s ",
			createVNode(_components.em, { children: "multi-emit" }),
			" settle burst and never swallows a later genuinely-new agent launch. The throttle clock is floored at the sensor run’s start (",
			createVNode(_components.code, { children: "FoldCtx.runStartedAt" }),
			"), so that settle burst — clustered at run start — coalesces against it instead of false-bumping the (possibly week-old) saved recency."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Partially superseded — under the padi architecture, the fold's HOME moves (2026-07-01)",
			children: createVNode(_components.p, { children: [
				"The ",
				createVNode(_components.strong, { children: "types and the cut survive verbatim" }),
				" — memoryless producer, ",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				"/",
				createVNode(_components.code, { children: "AgentMemory" }),
				"/",
				createVNode(_components.code, { children: "Known<T>" }),
				"/",
				createVNode(_components.code, { children: "RestoreTarget" }),
				", the one fold, the clobber-free-by-type property. What the ",
				createVNode(_components.a, {
					href: "padi.html",
					children: "padi architecture"
				}),
				" changes is ",
				createVNode(_components.strong, { children: "where remembering lives" }),
				": the fold and memory move from kolu-server into ",
				createVNode(_components.strong, { children: "padi, the per-host workspace daemon" }),
				", co-resident with the producer — so ",
				createVNode(_components.em, { children: "no fold ever crosses a wire" }),
				", and the planned remote apparatus (the framer, ",
				createVNode(_components.code, { children: "TerminalFrame" }),
				" ",
				createVNode(_components.code, { children: "seq" }),
				"/",
				createVNode(_components.code, { children: "gap" }),
				", the ",
				createVNode(_components.code, { children: "terminalEvents" }),
				" wire, the consumer arm — PR #1638) is ",
				createVNode(_components.strong, { children: "deleted unbuilt" }),
				". Two decisions are re-settled deliberately: recency rides the ",
				createVNode(_components.strong, { children: "host’s (owner’s) clock" }),
				", not the consumer’s — sound now because a canvas is single-host per view, so cross-host comparison is unrepresentable (display ages against padi’s served ",
				createVNode(_components.code, { children: "now" }),
				"); and the reader-join collapses into padi’s composed ",
				createVNode(_components.code, { children: "terminals" }),
				" collection. “kolu remembers” becomes “",
				createVNode(_components.strong, { children: "the host’s padi remembers" }),
				"”; everything below about ",
				createVNode(_components.em, { children: "how" }),
				" observing and remembering are split still stands."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Provenance — a settled design, simplified in review",
			children: createVNode(_components.p, { children: [
				"This supersedes the createPulam / shared-leaf direction of the finale’s R9·lib + R9.0, the “seed-the-engine” draft of this note, ",
				createVNode(_components.strong, { children: "and" }),
				" the earlier three-category (cache / live / memory) model from the debate. The shape held; the ",
				createVNode(_components.em, { children: "count" }),
				" shrank. A long review collapsed it to the simplest thing that still can’t clobber: ",
				createVNode(_components.strong, { children: "one observation a host produces, two facts only kolu keeps." }),
				" The record of the debate is ",
				createVNode(_components.code, { children: "debates/awareness-architecture/conclusion.md" }),
				"; the first-principles hardening pass (",
				createVNode(_components.code, { children: "05.*.md" }),
				") supplied the frame discriminator, the per-subscription ",
				createVNode(_components.code, { children: "seq" }),
				", the value-change autosave fence, the mutator deletion, and the branded key — all carried below. The forks are ",
				createVNode(_components.strong, { children: "decided" }),
				" (the “Decided” sections), not left open."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Round 6 — the one-field collapse was tried and REJECTED (keep two memory fields)",
			children: [
				createVNode(_components.p, { children: [
					"A further simplification was proposed and stress-tested by the 3-agent debate (",
					createVNode(_components.code, { children: "06.*.md" }),
					"): collapse ",
					createVNode(_components.code, { children: "lastAgentCommand" }),
					" into an ",
					createVNode(_components.em, { children: "snapshot" }),
					" ",
					createVNode(_components.code, { children: "agentCommand" }),
					" field too, leaving ",
					createVNode(_components.strong, { children: "one" }),
					" memory field. All three agents rejected it on grounded code, and the claims were re-verified here:"
				] }),
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "The launch line is NOT re-observable" }),
						" — the killer fact. ",
						createVNode(_components.code, { children: "record.currentAgent" }),
						" holds only the agent ",
						createVNode(_components.strong, { children: "basename" }),
						" (",
						createVNode(_components.code, { children: "agentNameFromCommand" }),
						", ",
						createVNode(_components.code, { children: "sensors.ts:407-408" }),
						"); the full invocation (",
						createVNode(_components.code, { children: "\"claude --model sonnet\"" }),
						") lives ",
						createVNode(_components.strong, { children: "only" }),
						" in ",
						createVNode(_components.code, { children: "lastAgentCommand" }),
						" (",
						createVNode(_components.code, { children: "sensors.ts:410-413" }),
						"). It’s a discrete command mark kaval retains only as the ",
						createVNode(_components.em, { children: "last" }),
						" one — overwritten by any later non-agent command (",
						createVNode(_components.code, { children: "ls" }),
						") — so a still-live agent whose mark has rolled off ",
						createVNode(_components.strong, { children: "cannot" }),
						" have its command re-snapshot. That is exactly what makes it ",
						createVNode(_components.strong, { children: "memory" }),
						", not observation."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "The exact flags are correctness, not polish" }),
						" — ",
						createVNode(_components.code, { children: "resumeFormFor" }),
						" returns ",
						createVNode(_components.code, { children: "null" }),
						" (→ bare shell) when ",
						createVNode(_components.code, { children: "lastAgentCommand" }),
						" is absent; it does ",
						createVNode(_components.em, { children: "not" }),
						" fall back to a flagless ",
						createVNode(_components.code, { children: "--resume <id>" }),
						". The wake test pins the full form ",
						createVNode(_components.code, { children: "opencode --session <id> --model sonnet" }),
						" (",
						createVNode(_components.code, { children: "sleepWake.test.ts:259" }),
						"). Losing the tail changes model / permission-mode / config, not just cosmetics."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: [createVNode(_components.code, { children: "replayed" }), " does NOT collapse into the frame phase"] }),
						" — it is a lower-tap fact (",
						createVNode(_components.code, { children: "kavalChannels.ts:93" }),
						") a restarted tap can replay into a ",
						createVNode(_components.em, { children: "delta" }),
						" even while kolu’s subscription stays live; the code comment calls the flag “",
						createVNode(_components.strong, { children: "load-bearing, NOT decorative" }),
						"” (",
						createVNode(_components.code, { children: "inProcessPtyHost.ts:148-163" }),
						") precisely because recency stamps ",
						createVNode(_components.code, { children: "Date.now()" }),
						". Keep it."
					] }),
					"\n"
				] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Verdict: two memory fields stay." }),
					" The collapse was a false economy — it moved the deleted field’s job into an unsound snapshot-null rule and a larger, lie-laden disk payload. What the round ",
					createVNode(_components.em, { children: "did" }),
					" surface (folded in below): an explicit lawful representation for the async agent null, the ",
					createVNode(_components.code, { children: "commandRun" }),
					" agent-filter + dedup the fold had dropped, an authoritative-freeze caveat on the ",
					createVNode(_components.code, { children: "agentSession" }),
					" collapse, and the persistence-tier table."
				] })
			]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Foundations — a fold over a stream, not shared mutable state",
			children: [
				createVNode(_components.p, { children: [
					"The shape is a deliberate move off ",
					createVNode(_components.strong, { children: "shared mutable state" }),
					" onto ",
					createVNode(_components.strong, { children: "an immutable fold over a stream of observations" }),
					". The vocabulary a future reader should reason in:"
				] }),
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Observations are a log/stream." }),
						" The producer’s interface is a stream of events (“observed git = X”), not a writable record. It is ",
						createVNode(_components.strong, { children: "memoryless" }),
						" — ",
						createVNode(_components.em, { children: "effectful but memoryless" }),
						" (it runs watchers/timers), ",
						createVNode(_components.strong, { children: "not" }),
						" a pure function."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "The fold is a reduce." }),
						" ",
						createVNode(_components.code, { children: "fold(current, observation) → current'" }),
						" is a reducer; the stored value is a left-fold (scan) over the stream. For the five ",
						createVNode(_components.em, { children: "snapshot" }),
						" fields it is plain ",
						createVNode(_components.strong, { children: "last-write-wins" }),
						"; the only judgment is the two ",
						createVNode(_components.em, { children: "remembered" }),
						" fields."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Immutability." }),
						" The fold builds new values (",
						createVNode(_components.code, { children: "{ ...current, snapshot: { ...snapshot, … } }" }),
						"); it never mutates a shared record. That in-place mutation ",
						createVNode(_components.em, { children: "was" }),
						" the original complect (the knot below)."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "A materialized read model (CQRS flavor)." }),
						" The ",
						createVNode(_components.code, { children: "snapshots" }),
						" collection is a derived projection — the stream is the input, the snapshot the output."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "One writer; owner-owned clock." }),
						" The two remembered facts have a single writer (kolu’s fold), and recency is stamped by the ",
						createVNode(_components.strong, { children: "owner’s (host padi’s)" }),
						" clock — matching the padi callout above; a remote producer’s wall clock is never imported as ordering truth. (",
						createVNode(_components.code, { children: "FoldCtx.at" }),
						" and ",
						createVNode(_components.code, { children: "runStartedAt" }),
						" are both that host’s ",
						createVNode(_components.code, { children: "Date.now()" }),
						".)"
					] }),
					"\n"
				] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Two honest limits, so the anchor doesn’t over-reach:" }),
					" (1) the producer is ",
					createVNode(_components.em, { children: "memoryless and effectful" }),
					" — “pure” applies to the ",
					createVNode(_components.strong, { children: "fold and gates" }),
					", not the producer; (2) this is ",
					createVNode(_components.strong, { children: "fold-to-state, not classic event sourcing" }),
					" — we persist the derived ",
					createVNode(_components.em, { children: "state" }),
					", not the event log. The stream is ephemeral; a reconnect re-folds from a snapshot frame."
				] })
			]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-knot-today--observing-is-fused-with-remembering",
			children: "The knot today — observing is fused with remembering"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The sensor engine does ",
			createVNode(_components.strong, { children: "not" }),
			" return awareness. It takes a host ",
			createVNode(_components.code, { children: "AwarenessSink" }),
			" + a per-terminal ",
			createVNode(_components.code, { children: "AwarenessRecord" }),
			", ",
			createVNode(_components.strong, { children: [
				"mutates ",
				createVNode(_components.code, { children: "record.meta" }),
				" through the sink"
			] }),
			", and ",
			createVNode(_components.strong, { children: [
				"reads ",
				createVNode(_components.code, { children: "record.meta" }),
				" back"
			] }),
			" as its own prior state. ",
			createVNode(_components.code, { children: "sensors.ts:139-162" }),
			" calls this the load-bearing ",
			createVNode(_components.em, { children: "apply-and-publish" }),
			" contract — a sink that publishes ",
			createVNode(_components.em, { children: "without" }),
			" mutating the record “would silently defeat every dedup/transition gate.”"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"So ",
			createVNode(_components.code, { children: "record.meta" }),
			" plays ",
			createVNode(_components.strong, { children: "two roles at once" }),
			":"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"the engine’s ",
				createVNode(_components.strong, { children: "prior-state" }),
				" for its gates — command dedup ",
				createVNode(_components.code, { children: "record.meta.lastAgentCommand" }),
				" (",
				createVNode(_components.code, { children: "sensors.ts:410" }),
				"), publish-if-changed ",
				createVNode(_components.code, { children: "agentInfoEqual(record.meta.agent, …)" }),
				" (",
				createVNode(_components.code, { children: "sensors.ts:516" }),
				"), recency ",
				createVNode(_components.code, { children: "shouldBumpRecencyForAgentChange(…, record.meta.lastActivityAt)" }),
				" (",
				createVNode(_components.code, { children: "sensors.ts:519" }),
				"), session dedup ",
				createVNode(_components.code, { children: "agentSessionToPersist(record.meta.agentSession, …)" }),
				" (",
				createVNode(_components.code, { children: "sensors.ts:526" }),
				");"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"the host’s ",
				createVNode(_components.strong, { children: "stored value" }),
				" — kolu aliases ",
				createVNode(_components.code, { children: "record.meta = getTerminal(id)!.awareness" }),
				" (",
				createVNode(_components.code, { children: "local.ts:700-704" }),
				"); ",
				createVNode(_components.code, { children: "pulam" }),
				" points it at a cache (",
				createVNode(_components.code, { children: "daemon.ts:209-217" }),
				")."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Svg, {
			svg: awareness_before_default,
			caption: "Today: the sensor set and the host's storage are the SAME object. record.meta is both the engine's prior-state (read back by the dedup/recency/session gates) and the host's stored value (mutated in place via the sink). Because deriving writes the store, a fresh derivation can clobber remembered state, two sinks must each wire the assembly, and 'share the assembly' (createPulam) is the only way two homes can reuse the sensing."
		}),
		"\n",
		createVNode(_components.p, { children: [
			"That fusion is the cause of everything downstream: ",
			createVNode(_components.strong, { children: "two assemblers" }),
			" (",
			createVNode(_components.code, { children: "local.ts:278" }),
			" vs ",
			createVNode(_components.code, { children: "pulam/src/hooks.ts:39" }),
			"), the ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "AwarenessSink" }), " foot-gun"] }),
			" (mutate-before-publish or defeat the gates), and the ",
			createVNode(_components.strong, { children: "fold-clobber class" }),
			" (a fresh/ephemeral derivation overwrites remembered history — the defect that killed the local-pulam-process #1614 and that the createPulam loop re-risked)."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-cut-one-question--can-a-host-re-observe-it",
			children: "The cut: one question — can a host re-observe it?"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"There are not three categories. There is ",
			createVNode(_components.strong, { children: "one question per field" }),
			", and it sorts every field into exactly two places:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Yes, a host can re-observe it" }),
				" → it belongs to the one value a producer emits, ",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				". Five fields."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "No, it can’t be snapshot" }), " → it’s kolu’s to remember. Two fields."] }),
			"\n"
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
						children: "// What a host PRODUCER emits — exactly what it can RE-OBSERVE. Local or remote, the SAME type."
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " TerminalSnapshot"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  cwd"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  git"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " GitInfo"
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
							style: { color: "#24292E" },
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  pr"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " PrResult"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  agent"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " AgentInfo"
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
							style: { color: "#24292E" },
							children: ";        "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// the LIVE agent right now, or null when the user is at the shell"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  foreground"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Foreground"
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
							style: { color: "#24292E" },
							children: ";  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// the live foreground process (vim, …)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "};"
					})
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// The two facts a host CANNOT observe — recency is a clock reading; the launch line is what the"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// user typed. Irrecoverable from a screen, so kolu remembers them; written by kolu's fold ALONE."
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " AgentMemory"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  lastActivityAt"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " number"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";         "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// recency — a CLOCK reading. You can't see \"active 3h ago\" on a screen."
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  lastAgentCommand"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "?:"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";      "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// the exact launch line to replay (\"claude --model sonnet\"). Absent if no agent ran."
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "};"
					})
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// kolu's stored value: the last-seen TerminalSnapshot + the two remembered facts. NESTED, not merged,"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// so the half published to the snapshots collection is `current.snapshot` — structurally WITHOUT"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// the two memory fields, not a runtime strip."
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " TerminalState"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "snapshot"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " TerminalSnapshot"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "memory"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " AgentMemory"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " };"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "TerminalSnapshot" }),
			" is the keystone type: a producer — local or remote — ",
			createVNode(_components.strong, { children: "cannot construct" }),
			" ",
			createVNode(_components.code, { children: "lastActivityAt" }),
			" or ",
			createVNode(_components.code, { children: "lastAgentCommand" }),
			", so a producer’s stream (however buggy, restarted, or hostile) ",
			createVNode(_components.strong, { children: "cannot overwrite kolu’s two remembered facts" }),
			", by the compiler. The persisted/live partition (",
			createVNode(_components.code, { children: "schema.ts:139-176" }),
			") was too coarse; the simpler structure is ",
			createVNode(_components.em, { children: "observable vs not" }),
			", and the only fence that must be a ",
			createVNode(_components.strong, { children: "type" }),
			" is that one — the producer’s emit type is ",
			createVNode(_components.code, { children: "TerminalSnapshot" }),
			", full stop."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Why only two remembered fields — agentSession collapsed",
			children: createVNode(_components.p, { children: [
				"The earlier model kept ",
				createVNode(_components.strong, { children: "three" }),
				" (it also stored ",
				createVNode(_components.code, { children: "agentSession" }),
				", the exact-conversation ref for #1495). The restore rule below removes it: you only ever restore an agent that was ",
				createVNode(_components.strong, { children: "live at sleep/restart" }),
				", so the session id is ",
				createVNode(_components.em, { children: "already" }),
				" sitting inside the frozen ",
				createVNode(_components.code, { children: "TerminalSnapshot.agent" }),
				". ",
				createVNode(_components.code, { children: "agentSession" }),
				" stops being a separate field — it’s ",
				createVNode(_components.code, { children: "frozen.agent.sessionId" }),
				". Two facts remain because they’re the only ones a host genuinely ",
				createVNode(_components.strong, { children: "cannot re-observe" }),
				": a clock reading (",
				createVNode(_components.code, { children: "lastActivityAt" }),
				") and the launch invocation with its flags (",
				createVNode(_components.code, { children: "lastAgentCommand" }),
				", fed by the ",
				createVNode(_components.code, { children: "commandRun" }),
				" mark — ",
				createVNode(_components.code, { children: "TerminalSnapshot.foreground" }),
				" is only the bare basename ",
				createVNode(_components.code, { children: "\"claude\"" }),
				", no flags)."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Decided — restore resumes only a still-live agent",
			children: [
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Restore (wake or session-restore) brings an agent back only if it was still running at the moment of sleep / kolu-restart." }),
					" If the user quit the agent back to the shell, there is nothing to restore — wake lands on a ",
					createVNode(_components.strong, { children: "bare shell" }),
					" (the existing #1492 behavior). The gate is the frozen agent itself:"
				] }),
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
									style: { color: "#24292E" },
									children: "wake "
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: "="
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: " frozen.snapshot.agent"
								})
							]
						}),
						"\n",
						createVNode(_components.span, {
							class: "line",
							children: [
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: "  ?"
								}),
								createVNode(_components.span, {
									style: { color: "#6F42C1" },
									children: " resume"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: "(frozen.snapshot.agent.sessionId, frozen.memory.lastAgentCommand)  "
								}),
								createVNode(_components.span, {
									style: { color: "#6A737D" },
									children: "// exact conversation (#1495)"
								})
							]
						}),
						"\n",
						createVNode(_components.span, {
							class: "line",
							children: [
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: "  :"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: " bareShell;                                                               "
								}),
								createVNode(_components.span, {
									style: { color: "#6A737D" },
									children: "// quit → nothing to resume"
								})
							]
						})
					] })
				}),
				createVNode(_components.p, { children: [
					"This is what collapses ",
					createVNode(_components.code, { children: "agentSession" }),
					": the session id rides the frozen ",
					createVNode(_components.code, { children: "agent" }),
					"; ",
					createVNode(_components.code, { children: "quit ⇒ agent: null ⇒ no restore" }),
					" is the rule, not a special case. ",
					createVNode(_components.code, { children: "lastAgentCommand" }),
					" is read ",
					createVNode(_components.strong, { children: "only" }),
					" when ",
					createVNode(_components.code, { children: "frozen.agent" }),
					" is non-null — to rebuild the exact invocation (flags + ",
					createVNode(_components.code, { children: "--resume <id>" }),
					")."
				] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Caveat (the freeze must be authoritative — drain DEFERRED)." }),
					" The collapse is only sound if the agent frozen at sleep is the ",
					createVNode(_components.em, { children: "true live-at-sleep" }),
					" value, not a lagging observation. Agent detection settles over ~1 s, and ",
					createVNode(_components.code, { children: "beginSleep" }),
					" tears the sensors down ",
					createVNode(_components.em, { children: "first" }),
					" — so a sleep during the settle window freezes whatever ",
					createVNode(_components.code, { children: "restoreTarget" }),
					" the fold last wrote (a still-",
					createVNode(_components.code, { children: "none" }),
					", because the agent hadn’t resolved yet) and produces a ",
					createVNode(_components.strong, { children: "false bare shell" }),
					". As shipped this is ",
					createVNode(_components.strong, { children: "NOT closed by construction" }),
					": ",
					createVNode(_components.code, { children: "beginSleep" }),
					" does not drain a final settle. The ",
					createVNode(_components.code, { children: "Known<>" }),
					" rule keeps the ",
					createVNode(_components.em, { children: "steady-state" }),
					" freeze authoritative (the fold only ever stores an ",
					createVNode(_components.code, { children: "{ value }" }),
					", never ",
					createVNode(_components.code, { children: "unknown" }),
					"), but the sub-second launch-then-sleep race is a documented ",
					createVNode(_components.strong, { children: "deferral" }),
					" — the active drain (an async ",
					createVNode(_components.code, { children: "beginSleep" }),
					" reorder) rides a follow-up. The race is narrow and self-correcting (re-launch fixes it). Under the shipped model-B (",
					createVNode(_components.code, { children: "none" }),
					" → bare shell) the consequence is a false ",
					createVNode(_components.em, { children: "bare shell" }),
					", not a wrong conversation — fail-safe, not fail-dangerous."
				] })
			]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Decided — persisting the live agent is safe (the active/sleeping discriminant)",
			children: createVNode(_components.p, { children: [
				"Storing the last-seen ",
				createVNode(_components.code, { children: "agent" }),
				" (with its ",
				createVNode(_components.code, { children: "state: \"awaiting_user\"" }),
				", token counts) would ",
				createVNode(_components.em, { children: "look" }),
				" like it fabricates a “needs you” alert on a dormant tile — ",
				createVNode(_components.code, { children: "agentUrgency(agent)" }),
				" turns ",
				createVNode(_components.code, { children: "awaiting_user" }),
				" into the alert wash (",
				createVNode(_components.code, { children: "agentProjection.ts:216" }),
				" → ",
				createVNode(_components.code, { children: "fleet.ts:122-123" }),
				"). It doesn’t, because ",
				createVNode(_components.strong, { children: "urgency is computed only on the active arm" }),
				": kolu’s authored record carries the active/sleeping discriminant (",
				createVNode(_components.code, { children: "meta.state" }),
				", ",
				createVNode(_components.code, { children: "local.ts:865-874" }),
				"), and a sleeping tile has ",
				createVNode(_components.strong, { children: "no urgency path at all" }),
				". “Alert on a sleeping terminal” is unrepresentable at the ",
				createVNode(_components.em, { children: "terminal" }),
				" type — so we don’t strip ",
				createVNode(_components.code, { children: "agent" }),
				"’s fields, we just never compute urgency for a dormant tile. That is why the whole last-seen ",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				" can be persisted without the lie-when-dead problem."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "s1--the-producer-is-memoryless",
			children: "S1 — the producer is memoryless"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"It owns transient ",
			createVNode(_components.em, { children: "derivation" }),
			" working state (the agent watcher, ",
			createVNode(_components.code, { children: "latestInfo" }),
			", the last-emitted live mirror, ",
			createVNode(_components.code, { children: "currentAgent" }),
			", the git→PR wire, the screen-scrape poll, the adapter registry — all re-seeded empty each start) and emits ",
			createVNode(_components.strong, { children: "per-field observations" }),
			". It takes ",
			createVNode(_components.strong, { children: "no seed" }),
			" and touches no host store. The standing five build the ",
			createVNode(_components.code, { children: "TerminalSnapshot" }),
			"; ",
			createVNode(_components.code, { children: "commandRun" }),
			" is a discrete mark that feeds kolu’s ",
			createVNode(_components.code, { children: "lastAgentCommand" }),
			" memory and the recent-agent MRU."
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
						children: "// The agent is the one field that resolves ASYNCHRONOUSLY — the session file lands a beat after"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// the mark, over a settle window (`COMMAND_RUN_RECONCILE_DELAYS_MS = [0,75,300,1000]`, `sensors.ts:486`;"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// `SCREEN_SCRAPE_POLL_MS = 1000`, `:492`). So a bare `agent: null` is ambiguous — \"no agent\" or \"not"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// resolved yet?\" Make the null LAWFUL (round-6 fix): a producer mid-resolution emits `unknown` (kolu"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// KEEPS its last value); `{ value }` is authoritative (kolu APPLIES it, even when null). The authority"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// for `{ value: null }` is shell-idle — the foreground IS the shell (`sensors.ts:432,448`), i.e. the"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// session ended (`sensors.ts:640-644`); a value can't be both \"agent live\" and \"shell idle.\""
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Known"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "T"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "> "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"unknown\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "value"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " T"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " };"
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " TerminalEvent"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  |"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"cwd\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";        "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "cwd"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  |"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"git\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";        "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "git"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " GitInfo"
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
							style: { color: "#24292E" },
							children: " }                  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// also drives the recentRepo MRU (kolu side)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  |"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"pr\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";         "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "pr"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " PrResult"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  |"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"foreground\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "foreground"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Foreground"
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
							style: { color: "#24292E" },
							children: " }"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  |"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"agent\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";      "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "agent"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Known"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "AgentInfo"
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
							style: { color: "#24292E" },
							children: "> }    "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// async-resolved → lawful unknown/snapshot, never a bare null"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  |"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"commandRun\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "command"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "replayed"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " boolean"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " };  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// feeds lastAgentCommand + recentAgent MRU"
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "function"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " startSensors"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  id"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " TerminalId"
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
							style: { color: "#E36209" },
							children: "  inputs"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "    pid"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " number"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "    cwd"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";                                          "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// spawn-time cwd; later cwd flows via signals"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "    signals"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " SensorSignals"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";                            "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// the four taps — UNCHANGED"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "    readScreenText"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "?:"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "tailLines"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " number"
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
							style: { color: "#6F42C1" },
							children: " Promise"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">;  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// pure input for screen-scrape (#905)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "    log"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Logger"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  },"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  emit"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "o"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " TerminalEvent"
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
							style: { color: "#005CC5" },
							children: " void"
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
							children: ")"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " () "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " void"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "replayed" }) }),
			" is the one provenance flag on an observation, and it must be a ",
			createVNode(_components.strong, { children: "required" }),
			" field (a flag-less event is a compile error). It is genuine ",
			createVNode(_components.em, { children: "content" }),
			" — kaval’s tap (",
			createVNode(_components.code, { children: "sensors.ts:103-106" }),
			") reports whether a command mark is a replay (scrollback re-emit on restart) or a live run; the producer does not guess it. There is ",
			createVNode(_components.strong, { children: ["no ", createVNode(_components.code, { children: "fromSnapshot" })] }),
			": “is this a re-observation or a live change” is ",
			createVNode(_components.strong, { children: "not a property of the event" }),
			" — it’s kolu’s subscription-phase fact, carried on the ",
			createVNode(_components.strong, { children: "frame" }),
			" (",
			createVNode(_components.a, {
				href: "#the-wire-observations-not-whole-values",
				children: "the wire"
			}),
			"), never a per-event flag a producer asserts and kolu trusts."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Deleted:" }),
			" the ",
			createVNode(_components.code, { children: "AwarenessSink" }),
			" interface, ",
			createVNode(_components.em, { children: "both" }),
			" ",
			createVNode(_components.code, { children: "makeAwarenessSink" }),
			" impls, the ",
			createVNode(_components.code, { children: "AwarenessRecord" }),
			" type, the apply-and-publish read-back contract — and any ",
			createVNode(_components.code, { children: "seed" }),
			". The git→PR channel and the adapter registry were always engine-internal and stay."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "s2--kolu-remembers-the-fold-owns-the-two-facts-and-the-clock",
			children: "S2 — kolu remembers; the fold owns the two facts and the clock"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"kolu folds each observation into a new ",
			createVNode(_components.code, { children: "TerminalState" }),
			". The five snapshot fields are ",
			createVNode(_components.strong, { children: "last-write-wins" }),
			"; the only decisions are the two remembered fields — stamp ",
			createVNode(_components.code, { children: "lastActivityAt" }),
			" on a ",
			createVNode(_components.strong, { children: "live agent-identity change" }),
			" (kolu’s clock), and keep ",
			createVNode(_components.code, { children: "lastAgentCommand" }),
			" from the latest ",
			createVNode(_components.code, { children: "commandRun" }),
			". A producer can write none of that. ",
			createVNode(_components.em, { children: "(The identity-only recency shown below froze a stable session’s recency; it now bumps on a throttled same-identity output tick too — see the follow-up fix in the status note above.)" })
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
						children: "// Liveness + clock are kolu's, passed as VALUES (not a thunk the reducer may fire):"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "//   live — true iff this came in a DELTA frame (a snapshot re-observation is not \"new activity\")"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "//   at   — kolu samples its own clock ONCE at intake, before folding"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " FoldCtx"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "live"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " boolean"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "at"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " number"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " };"
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "function"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " fold"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "cur"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " TerminalState"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "o"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " TerminalEvent"
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
							style: { color: "#6F42C1" },
							children: " FoldCtx"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ")"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " TerminalState"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  const"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " obs"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "p"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Partial"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "TerminalSnapshot"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">) "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ({ "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "..."
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "cur, snapshot: { "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "..."
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "cur.snapshot, "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "..."
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "p } });"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#D73A49" },
						children: "  switch"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: " (o.kind) {"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    case"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"cwd\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ":        "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "return"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " obs"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ cwd: o.cwd });"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    case"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"git\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ":        "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "return"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " obs"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ git: o.git });"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    case"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"pr\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ":         "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "return"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " obs"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ pr: o.pr });           "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// pr is true-when-dead — persisted like git"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    case"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"foreground\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "return"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " obs"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ foreground: o.foreground });"
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    case"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"agent\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "      if"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " (o.agent "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "==="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"unknown\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ") "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "return"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " cur;               "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// not re-resolved yet → KEEP kolu's last value (no clobber)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "      const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " agent"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " o.agent.value;                          "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// authoritative (incl. a shell-idle null = session ended)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "      const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " next"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " obs"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ agent });                          "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// last-write-wins"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "      // RECENCY (decided: identity-only): bump iff a LIVE agent-IDENTITY change — start / finish /"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "      // new session. ctx.live (the frame phase), not a producer flag, says \"live\"; kolu's clock stamps it."
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "      const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " idChanged"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " cur.snapshot.agent?.kind      "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "!=="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " agent?.kind"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "                     ||"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " cur.snapshot.agent?.sessionId "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "!=="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " agent?.sessionId;"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "      return"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ctx.live "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "&&"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " idChanged"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "        ?"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "..."
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "next, memory: { "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "..."
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "next.memory, lastActivityAt: ctx.at } }"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#D73A49" },
						children: "        :"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: " next;"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "    }"
					})
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    case"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"commandRun\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ":                                     "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// the producer emits this ONLY for a recognized agent"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "      return"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " cur.memory.lastAgentCommand "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "==="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " o.command     "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "//   command, already NORMALIZED (`sensors.ts:404-409`) — a"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "        ?"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " cur                                              "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "//   non-agent `ls` yields no event, so it can't clobber."
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "        :"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "..."
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "cur, memory: { "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "..."
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "cur.memory, lastAgentCommand: o.command } };  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// dedup (`sensors.ts:410`): a replay is a no-op"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  }"
					})
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
						children: "// kolu's host recipe. Autosave (disk) arms ONLY when a RESTORE-RELEVANT value changes — the"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// five snapshot fields minus the churny ones, plus the two memory fields. Agent DETAIL (state,"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// tokens, summary) and `foreground` change every ~150 ms and are re-derived on (re)spawn, so they"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// never touch disk: the firehose can't reach it, because what arms is a VALUE CHANGE, not a tick."
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " restoreRelevant"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "a"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " TerminalState"
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
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  cwd: a.snapshot.cwd, git: a.snapshot.git, pr: a.snapshot.pr,"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  agentId: a.snapshot.agent "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "&&"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { kind: a.snapshot.agent.kind, sessionId: a.snapshot.agent.sessionId }, "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// IDENTITY only"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#D73A49" },
						children: "  ..."
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "a.memory,"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "});"
					})
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "function"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " watch"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
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
							children: " HostTerminalKey"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "terminal"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ")"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " () "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " void"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  let"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " current "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " seed"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(terminal);                            "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// kolu seeds from its durable record"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " stop"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " subscribeSnapshots"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(key, terminal, ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "frame"
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
							children: " {          "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// frame: snapshot | delta | gap (the wire)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    if"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " (frame.phase "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "==="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"gap\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ") { current "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " reseed"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(key); "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "return"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; }      "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// a detected gap re-snapshots — never a silent diverge"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " ctx"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " FoldCtx"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { live: frame.phase "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "==="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"delta\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", at: Date."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "now"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "() };  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// kolu's clock, sampled once"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    for"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " e"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " of"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " frame.events) {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "      const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " before"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " current;"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "      current "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " fold"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(current, e, ctx);                     "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// a NEW value; nothing mutated"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "      if"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "!"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "shallowEqual"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "restoreRelevant"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(before), "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "restoreRelevant"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(current))) "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "armAutosave"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "();  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// value change, not tick"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "      if"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " (e.kind "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "==="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"git\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " &&"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " e.git)            "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "trackRecentRepo"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(e.git.mainRepoRoot, e.git.repoName);  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// MRU, kolu side"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "      if"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " (e.kind "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "==="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"commandRun\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " &&"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " !"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "e.replayed) "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "trackRecentAgent"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(e.command);                        "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// replay never MRUs"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "    }"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "    snapshots."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "upsert"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(key, current.snapshot);               "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// the snapshots collection = TerminalSnapshot (memory absent by type)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "    authored."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "updateMemory"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(key, current.memory);            "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// the ONE memory writer (a narrowed mutator)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  });"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  return"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " () "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "stop"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(); "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "/* late events after stop are ignored — the post-teardown no-op guard */"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " };"
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
		createVNode($$Callout, {
			kind: "note",
			title: "Why this is clobber-free, with no seed",
			children: createVNode(_components.p, { children: [
				"The producer ",
				createVNode(_components.strong, { children: "cannot construct memory" }),
				" (",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				" has no ",
				createVNode(_components.code, { children: "lastActivityAt" }),
				"/",
				createVNode(_components.code, { children: "lastAgentCommand" }),
				"), so nothing it emits can overwrite a remembered fact. kolu seeds ",
				createVNode(_components.code, { children: "current" }),
				" from its own durable record and folds; a fact the producer can’t re-observe is simply never in an observation, so it survives. The old “seed the engine + restore-caveat” machinery is gone: recency reads no prior ",
				createVNode(_components.code, { children: "lastActivityAt" }),
				"; the ",
				createVNode(_components.strong, { children: "frame phase" }),
				" (",
				createVNode(_components.code, { children: "ctx.live" }),
				" — kolu’s own fact) tells a re-observation from a real change. (",
				createVNode(_components.code, { children: "shouldBumpRecencyForAgentChange" }),
				"’s restore caveat at ",
				createVNode(_components.code, { children: "agentRecency.ts:31" }),
				" is ",
				createVNode(_components.strong, { children: "deleted" }),
				", not ported — and it fixes a latent bug: a genuinely-new agent started after a prior one finished is no longer wrongly suppressed.)"
			] })
		}),
		"\n",
		createVNode($$Svg, {
			svg: awareness_foldflow_default,
			caption: "S2 (R9.0), local. The memoryless producer emits per-field observations (no seed, no memory). kolu's fold seeds current from its durable record and folds each framed observation: the five snapshot fields are last-write-wins; lastActivityAt is stamped on a LIVE (delta-frame) agent-identity change with kolu's clock; lastAgentCommand is remembered from the commandRun mark. It publishes the snapshot half to the snapshots collection (TerminalSnapshot — the two memory fields are absent by type) and the memory half to kolu.authored. Autosave arms only when the RESTORE-RELEVANT projection (cwd, git, pr, agent identity, the two memory fields) changes — agent detail and foreground churn never reach disk, so the firehose can't. One way: observe → fold → store. No record handed back, no sink, no seed, no clobber."
		}),
		"\n",
		createVNode(_components.h2, {
			id: "persistence-tiers--what-lives-where",
			children: "Persistence tiers — what lives where"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The types say ",
			createVNode(_components.em, { children: "who may write" }),
			" a field; they don’t yet say ",
			createVNode(_components.em, { children: "where it survives" }),
			". Three tiers, and the disk/RAM line is — honestly — the old cache/live split wearing a new coat (round-6 confirmed it doesn’t vanish; it moves from a field-typed split to the ",
			createVNode(_components.code, { children: "restoreRelevant" }),
			" projection):"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "tier" }),
					"\n",
					createVNode(_components.th, { children: "what" }),
					"\n",
					createVNode(_components.th, { children: "why" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "server disk" }), " (survives kolu restart)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"the ",
						createVNode(_components.code, { children: "restoreRelevant" }),
						" projection: ",
						createVNode(_components.code, { children: "cwd" }),
						" · ",
						createVNode(_components.code, { children: "git" }),
						" · ",
						createVNode(_components.code, { children: "pr" }),
						" · agent ",
						createVNode(_components.strong, { children: "identity" }),
						" ",
						createVNode(_components.code, { children: "{ kind, sessionId }" }),
						" · ",
						createVNode(_components.code, { children: "lastActivityAt" }),
						" · ",
						createVNode(_components.code, { children: "lastAgentCommand" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"the minimum to re-seed and to honor model-B restore. Agent identity only — ",
						createVNode(_components.strong, { children: "not" }),
						" the full ",
						createVNode(_components.code, { children: "AgentInfo" }),
						" (no lie-when-dead ",
						createVNode(_components.code, { children: "state" }),
						"/",
						createVNode(_components.code, { children: "tokens" }),
						" on disk; the round-5 invariant survives the merge). Autosave arms on a ",
						createVNode(_components.em, { children: "change" }),
						" to this projection, so the ~150 ms firehose never reaches disk."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "server RAM" }), " (re-derived on (re)spawn)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"the rest of ",
						createVNode(_components.code, { children: "snapshot" }),
						": full ",
						createVNode(_components.code, { children: "AgentInfo" }),
						" detail (",
						createVNode(_components.code, { children: "state" }),
						", ",
						createVNode(_components.code, { children: "summary" }),
						", ",
						createVNode(_components.code, { children: "tokens" }),
						", ",
						createVNode(_components.code, { children: "taskProgress" }),
						") · ",
						createVNode(_components.code, { children: "foreground" })
					] }),
					"\n",
					createVNode(_components.td, { children: "lie-when-dead and high-churn. A respawned PTY re-derives it in ~1 s; losing it on crash costs nothing, so it never earns a disk write." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "browser localStorage" }), " (per-device, never server)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"client view-state — ",
						createVNode(_components.code, { children: "attention" }),
						"/unread (",
						createVNode(_components.code, { children: "useViewState.ts" }),
						"), zoom/layout, per-device prefs (",
						createVNode(_components.code, { children: "persistedPref.ts" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"a ",
						createVNode(_components.em, { children: "viewing" }),
						" posture, not a fact about the terminal. It must not round-trip through the server (it’s device-local), and the server must never treat it as awareness."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"So the simplification deletes the ",
			createVNode(_components.strong, { children: "names" }),
			" ",
			createVNode(_components.code, { children: "cache" }),
			"/",
			createVNode(_components.code, { children: "live" }),
			" but not the underlying categories — it relocates them: cache→",
			createVNode(_components.code, { children: "restoreRelevant" }),
			", live→RAM-only. The honest claim is “persistence is the ",
			createVNode(_components.code, { children: "restoreRelevant" }),
			" projection,” not “everything in ",
			createVNode(_components.code, { children: "TerminalSnapshot" }),
			" persists.”"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-wire--observations-not-whole-values",
			children: "The wire — observations, not whole values"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The collection serving a whole ",
			createVNode(_components.code, { children: "AwarenessValue" }),
			" (",
			createVNode(_components.code, { children: "surface.ts:119-124" }),
			") is ",
			createVNode(_components.strong, { children: "retired" }),
			" as the awareness primitive. Producers serve an ",
			createVNode(_components.strong, { children: [
				"ordered, framed ",
				createVNode(_components.code, { children: "terminalEvents" }),
				" stream"
			] }),
			" (host-scoped, snapshot-then-deltas, subscribe-before-serialize — the attach contract, ",
			createVNode(_components.code, { children: "router.ts:162-169" }),
			", and the ",
			createVNode(_components.code, { children: "streaming.md" }),
			" rule) of ",
			createVNode(_components.code, { children: "TerminalSnapshot" }),
			" events. The wire carries the fold’s ",
			createVNode(_components.em, { children: "input" }),
			", not its lossy ",
			createVNode(_components.em, { children: "output" }),
			". There is ",
			createVNode(_components.strong, { children: ["no ", createVNode(_components.code, { children: "observedAt" })] }),
			" on the wire (a clock-skew temptation) — kolu samples its own clock at intake."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The stream is ",
			createVNode(_components.strong, { children: "framed" }),
			" — the frame carries provenance and order so the ",
			createVNode(_components.em, { children: "observation" }),
			" vocabulary can stay field-level (the ",
			createVNode(_components.code, { children: "streaming.md" }),
			"-prescribed shape, and the round-5 hardening fix):"
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
							children: "type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " TerminalFrame"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  |"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "phase"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"snapshot\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "events"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " TerminalEvent"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "[] }            "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// ctx.live = false — a re-observation, never bumps recency"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  |"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "phase"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"delta\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";    "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "seq"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " number"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "events"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " TerminalEvent"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "[] }  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// ctx.live = true; seq is monotonic per subscription"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  |"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "phase"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"gap\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";      "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "afterSeq"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " number"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " };                               "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// a detected coalescing/overflow gap → kolu re-snapshots"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: "Two facts the frame owns that a per-event flag must not:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "snapshot vs delta" }),
				" is ",
				createVNode(_components.strong, { children: "kolu’s" }),
				" subscription-phase fact, not a producer boolean. Putting it on the frame lets kolu derive ",
				createVNode(_components.code, { children: "ctx.live" }),
				" from the frame it received — its own knowledge — and ",
				createVNode(_components.strong, { children: ["deletes ", createVNode(_components.code, { children: "fromSnapshot" })] }),
				". The frame decides ",
				createVNode(_components.strong, { children: "liveness only" }),
				" (does this bump recency). It does ",
				createVNode(_components.strong, { children: "not" }),
				" decide what a null ",
				createVNode(_components.em, { children: "means" }),
				" — round 6 showed that’s a separate question (a snapshot null could be “no agent” ",
				createVNode(_components.em, { children: "or" }),
				" “not resolved yet”), and overloading the frame phase to answer it is the unsound rule the collapse died on. The meaning of an agent null rides the ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "Known<>" }), " field"] }),
				" (",
				createVNode(_components.code, { children: "unknown" }),
				" = keep, ",
				createVNode(_components.code, { children: "{ value: null }" }),
				" = authoritative absent), never the frame. (",
				createVNode(_components.code, { children: "replayed" }),
				" likewise stays on the ",
				createVNode(_components.code, { children: "commandRun" }),
				" event — a restarted tap can replay a mark into a ",
				createVNode(_components.em, { children: "delta" }),
				", so the frame phase can’t stand in for it; ",
				createVNode(_components.code, { children: "inProcessPtyHost.ts:148-163" }),
				".)"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["a per-subscription monotonic ", createVNode(_components.code, { children: "seq" })] }),
				" (precedent: ",
				createVNode(_components.code, { children: "RepoChangePulse.seq" }),
				", ",
				createVNode(_components.code, { children: "surface.ts:58-67" }),
				"): kolu asserts contiguity; a hole forces a ",
				createVNode(_components.code, { children: "gap" }),
				" frame → re-snapshot, instead of a silently divergent fold. A counter is ",
				createVNode(_components.strong, { children: "not" }),
				" a wall clock, so it imports nothing."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"kolu consumes the framed stream through one ",
			createVNode(_components.code, { children: "subscribeSnapshots(key, …)" }),
			" seam regardless of transport: ",
			createVNode(_components.strong, { children: "locally" }),
			" it wraps the in-process ",
			createVNode(_components.code, { children: "startSensors" }),
			" (the initial emit burst is the ",
			createVNode(_components.code, { children: "snapshot" }),
			" frame, later emits are ",
			createVNode(_components.code, { children: "delta" }),
			"s); ",
			createVNode(_components.strong, { children: "remotely" }),
			" it is the ssh stream verbatim. So the framing — not the engine — carries ",
			createVNode(_components.code, { children: "phase" }),
			"/",
			createVNode(_components.code, { children: "seq" }),
			", and the engine stays a pure memoryless emitter. But ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "ctx.live" }), " is not the frame phase alone"] }),
			": it is ",
			createVNode(_components.code, { children: "(phase === \"delta\")" }),
			" ",
			createVNode(_components.strong, { children: "AND" }),
			" kolu’s durable agent-identity baseline check, derived in kolu’s ",
			createVNode(_components.em, { children: "consumer arm" }),
			". A snapshot re-observation is never live; and a ",
			createVNode(_components.code, { children: "delta" }),
			" that merely re-resolves the ",
			createVNode(_components.em, { children: "adopted" }),
			" agent — which seeds ",
			createVNode(_components.code, { children: "null" }),
			", the resume identity riding the authored ",
			createVNode(_components.code, { children: "restoreTarget" }),
			", not the snapshot — must not bump recency either. The framer alone can’t decide liveness; only kolu, holding the durable record, can. ",
			createVNode(_components.em, { children: [
				"(Settled by the R9.2/R9.3 debate, ",
				createVNode(_components.code, { children: "debates/r92-r93/" }),
				".)"
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The payoff: ",
			createVNode(_components.strong, { children: [
				"kolu’s fold is one function for local and remote, and ",
				createVNode(_components.code, { children: "reconcileRemoteSnapshot" }),
				" disappears."
			] }),
			" The snapshot frame meets a pre-seeded ",
			createVNode(_components.code, { children: "current" }),
			" and folds with ",
			createVNode(_components.code, { children: "ctx.live = false" }),
			" (no spurious recency bump). ",
			createVNode(_components.code, { children: "adoptedAwareness" }),
			" (",
			createVNode(_components.code, { children: "local.ts:340" }),
			"), wake, remote-connect, and remote-reconnect are the ",
			createVNode(_components.strong, { children: "same" }),
			" “seed from memory, then fold” — ",
			createVNode(_components.code, { children: "orphanAwareness" }),
			" (",
			createVNode(_components.code, { children: "local.ts:368" }),
			") is the degenerate zero-memory seed."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Scale + coalescing (decided)",
			children: createVNode(_components.p, { children: [
				"Volume is tens–hundreds of small events/sec at realistic fleet sizes — the firehose is already coalesced at source by ",
				createVNode(_components.code, { children: "agentInfoEqual" }),
				" (",
				createVNode(_components.code, { children: "sensors.ts:516" }),
				"), the same count the browser already fans out. ",
				createVNode(_components.strong, { children: "Coalescing rule:" }),
				" latest-wins display fields (",
				createVNode(_components.code, { children: "agent" }),
				" detail, ",
				createVNode(_components.code, { children: "pr" }),
				", ",
				createVNode(_components.code, { children: "foreground" }),
				") may coalesce; ",
				createVNode(_components.strong, { children: "discrete marks may not" }),
				" — ",
				createVNode(_components.code, { children: "commandRun" }),
				" (the ",
				createVNode(_components.code, { children: "replayed" }),
				" bit), the agent ",
				createVNode(_components.strong, { children: "identity" }),
				" transition (drives recency), and ",
				createVNode(_components.code, { children: "git" }),
				"/",
				createVNode(_components.code, { children: "cwd" }),
				" edges. Default: coalesce nothing beyond ",
				createVNode(_components.code, { children: "agentInfoEqual" }),
				"; if scale ever bites, split ",
				createVNode(_components.code, { children: "agent" }),
				" into a lossless identity lane and a coalescible detail lane. On buffer overflow the mechanism is concrete: a ",
				createVNode(_components.code, { children: "phase: \"gap\"" }),
				" frame + the monotonic ",
				createVNode(_components.code, { children: "seq" }),
				" let kolu ",
				createVNode(_components.em, { children: "detect" }),
				" the hole and re-snapshot rather than fold a silently divergent stream."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "how-r9-collapses",
			children: "How R9 collapses"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A “host” is now ",
			createVNode(_components.em, { children: "dial a kaval → per terminal: run the memoryless producer → serve its observation stream" }),
			". ",
			createVNode(_components.strong, { children: "kolu" }),
			" is the one consumer that remembers: it folds every host’s stream (localhost in-process, remotes over ssh) into a host-keyed aggregate. “Two homes” was an artifact — there is ",
			createVNode(_components.strong, { children: "one producer per host; localhost is the degenerate (in-process) host" }),
			"."
		] }),
		"\n",
		"\n",
		createVNode($$PhaseTree, {
			title: "S1 · S2 → R9 collapses",
			phases: PT
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "phase" }),
					"\n",
					createVNode(_components.th, { children: "was" }),
					"\n",
					createVNode(_components.th, { children: "now" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "R9·lib" }) }),
					"\n",
					createVNode(_components.td, { children: "share a daemon-shaped assembly (createPulam)" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "dissolved" }), " — producer + fold are pure leaves; each host’s loop is ~8 lines"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "R9.0" }) }),
					"\n",
					createVNode(_components.td, { children: "kolu cuts over its sink/loop; clobber risk" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "✓ shipped" }),
						" (",
						createVNode($$PrLink, { pr: 1626 }),
						") — producer in-process, folds onto authored+snapshots; clobber-free by type"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "remote awareness" }) }),
					"\n",
					createVNode(_components.td, { children: "unbuilt; “the remote-only fold”" }),
					"\n",
					createVNode(_components.td, { children: [
						"re-sequenced (",
						createVNode(_components.code, { children: "debates/r92-r93/" }),
						"): the producer-side prep is ",
						createVNode(_components.strong, { children: "PR-3" }),
						" (framer + the ",
						createVNode(_components.code, { children: "terminalEvents" }),
						" wire, a local no-op), and ",
						createVNode(_components.strong, { children: "F-REMOTE" }),
						" subscribes the remote stream → the ",
						createVNode(_components.strong, { children: "same" }),
						" fold. No ",
						createVNode(_components.code, { children: "reconcileRemoteSnapshot" }),
						". Work-list below."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "the rest" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "PR-1/PR-2/F-REMOTE/R10 never proceeded" }),
						" — the finale plan was ",
						createVNode(_components.a, {
							href: "remote-terminals.html#finale",
							children: "superseded by padi"
						})
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Svg, {
			svg: awareness_homes_default,
			caption: "Local (R9.0, in-process) vs remote (F-REMOTE) — the SAME memoryless producer and the SAME fold, two transports. LOCAL: kolu runs the producer in-process; its observations feed kolu's fold directly. REMOTE: the producer runs in the pulam daemon and serves an ordered TerminalSnapshot event stream over ssh; kolu subscribes and folds with ITS clock. Either way kolu seeds current from its durable record, so the snapshot frame is the reconcile — there is no separate reconcileRemoteSnapshot. The two memory fields land on kolu.authored; the snapshots collection is TerminalSnapshot everywhere. Reader-join (authored ⋈ snapshots) unchanged."
		}),
		"\n",
		createVNode("a", { id: "r93-the-remote-build" }),
		"\n",
		createVNode(_components.h2, {
			id: "remote-awareness--the-build-pr-3-prep--f-remote-consume",
			children: "Remote awareness — the build (PR-3 prep + F-REMOTE consume)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"R9.0 shipped (",
			createVNode($$PrLink, { pr: 1626 }),
			"). Before building remote awareness it was ",
			createVNode(_components.strong, { children: "assessed by a 4-reviewer\nfoundation debate" }),
			" (",
			createVNode(_components.code, { children: "debates/r93-foundation/" }),
			"): the verdict is ",
			createVNode(_components.strong, { children: "clean / transport-agnostic" }),
			" —\nnothing in R9.0 must be undone. Verified against the merged diff:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"the ",
				createVNode(_components.strong, { children: "fold" }),
				" is reused ",
				createVNode(_components.strong, { children: "verbatim" }),
				" — ",
				createVNode(_components.code, { children: "fold(state, event, ctx:{live, at})" }),
				" injects clock + liveness\nas values; it knows no transport;"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"the ",
				createVNode(_components.strong, { children: "producer" }),
				" (",
				createVNode(_components.code, { children: "startSensors" }),
				") “names no host” (",
				createVNode(_components.code, { children: "sensors.ts:757" }),
				") and already runs in the pulam\ndaemon — a remote daemon calls it with its own inputs and serves the ",
				createVNode(_components.code, { children: "emit" }),
				" stream;"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "reconcileRemoteSnapshot" }), " is genuinely unnecessary"] }),
				" — seed-from-durable-record + the snapshot\nframe ",
				createVNode(_components.em, { children: "is" }),
				" the reconcile; the value-based recency baseline (the R9.0 substitute for the deleted\n",
				createVNode(_components.code, { children: "AWARENESS_SNAPSHOT_WINDOW_MS" }),
				" timer) suppresses the re-observation bump."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"So remote awareness is an ",
			createVNode(_components.strong, { children: "additive transport arm" }),
			", not a refactor — and the re-sequence (",
			createVNode(_components.code, { children: "debates/r92-r93/" }),
			") places the ",
			createVNode(_components.strong, { children: "producer-side prep in PR-3" }),
			" (a pure local no-op) and the ",
			createVNode(_components.strong, { children: "consume in F-REMOTE" }),
			" (sharing the pulam dial F-REMOTE already holds for fs/git). Mapping the work-list below: items 1–3 are ",
			createVNode(_components.strong, { children: "PR-3" }),
			" (the framer, the wire, pulam serving events); items 4–5 are ",
			createVNode(_components.strong, { children: "F-REMOTE" }),
			" (kolu subscribes + folds, ",
			createVNode(_components.code, { children: "HostTerminalKey" }),
			"). The work-list, given R9.0’s actual structure:"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Build the ",
					createVNode(_components.code, { children: "TerminalFrame" }),
					" type"
				] }),
				" (designed above — ",
				createVNode(_components.code, { children: "snapshot | delta(seq) | gap" }),
				"). R9.0 has only\n",
				createVNode(_components.code, { children: "TerminalEvent" }),
				"; the framed stream was deferred here, by design. ",
				createVNode(_components.em, { children: "(PR-3)" })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A framer" }),
				" that turns the producer’s ",
				createVNode(_components.code, { children: "emit" }),
				" sequence into frames — ",
				createVNode(_components.em, { children: "wraps" }),
				" the producer (which\nstays a pure emitter) and assigns ",
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "phase" }),
					"/",
					createVNode(_components.code, { children: "seq" }),
					" only"
				] }),
				". It is ",
				createVNode(_components.strong, { children: "not" }),
				" where ",
				createVNode(_components.code, { children: "ctx.live" }),
				" is decided:\nliveness is ",
				createVNode(_components.code, { children: "(phase === \"delta\")" }),
				" ",
				createVNode(_components.strong, { children: "AND" }),
				" kolu’s durable agent-identity baseline check, in kolu’s\n",
				createVNode(_components.em, { children: "consumer arm" }),
				" (the framer can’t see kolu’s ",
				createVNode(_components.code, { children: "restoreTarget" }),
				"; the remote framer runs in pulam, which\nhas no kolu memory). Deleting the baseline would spuriously bump recency on every restart — adopt\nre-seeds ",
				createVNode(_components.code, { children: "agent: null" }),
				" and the agent re-resolves ",
				createVNode(_components.em, { children: "asynchronously as a delta" }),
				". ",
				createVNode(_components.em, { children: "(PR-3 — pin the adopt\ncase with a differential test.)" })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Pulam serves the framed ",
					createVNode(_components.em, { children: "event" }),
					" stream — not just its snapshot cache."
				] }),
				" ⚠️ The sharp,\nnon-obvious requirement (the debate’s headline): pulam today folds each ",
				createVNode(_components.code, { children: "TerminalEvent" }),
				" into a\n",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				" cache and serves ",
				createVNode(_components.em, { children: "that" }),
				" (perfect for pulam-tui/pulam-web, which need no recency).\nBut that cache is ",
				createVNode(_components.strong, { children: "insufficient" }),
				" for kolu-as-remote-consumer, because ",
				createVNode(_components.code, { children: "commandRun" }),
				" is a ",
				createVNode(_components.strong, { children: "memory\nmark" }),
				" that ",
				createVNode(_components.code, { children: "foldSnapshot" }),
				" drops — so the remote daemon must serve the ",
				createVNode(_components.strong, { children: "raw event stream" }),
				" (a new\n",
				createVNode(_components.code, { children: "terminalEvents" }),
				" stream beside the ",
				createVNode(_components.code, { children: "snapshots" }),
				" collection, contract bump ",
				createVNode(_components.code, { children: "3.0 → 3.1" }),
				", additive), and\n",
				createVNode(_components.strong, { children: ["kolu must not rebuild memory from the served ", createVNode(_components.code, { children: "snapshots" })] }),
				". ",
				createVNode(_components.em, { children: "(PR-3)" })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "kolu’s remote subscribe-and-fold arm" }),
				" — dial the remote ",
				createVNode(_components.strong, { children: "pulam" }),
				" (it serves the terminal-workspace\nsurface — kaval serves only PTY; ",
				createVNode(_components.code, { children: "getHostSession({binary:\"pulam\"})" }),
				", the ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" precedent, bake\n",
				createVNode(_components.code, { children: "PULAM_AGENT_DRVS_JSON" }),
				"), mirror the ",
				createVNode(_components.code, { children: "terminalEvents" }),
				" over ",
				createVNode(_components.strong, { children: "R7" }),
				"’s total dual, seed ",
				createVNode(_components.code, { children: "current" }),
				" from\nkolu’s durable record, fold exactly as local; on a missing ",
				createVNode(_components.code, { children: "seq" }),
				", force a ",
				createVNode(_components.code, { children: "gap" }),
				" → re-snapshot. ",
				createVNode(_components.em, { children: "(F-REMOTE)" })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Host-scoped keys" }),
				" — the branded ",
				createVNode(_components.code, { children: "HostTerminalKey" }),
				" (designed in “Decided”), ",
				createVNode(_components.strong, { children: "kolu-intake-only" }),
				"\n(the wire stays bare ",
				createVNode(_components.code, { children: "TerminalId" }),
				"), lands here, where two hosts’ opaque PTY ids can actually collide.\n",
				createVNode(_components.em, { children: "(F-REMOTE)" })
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "PR-3 prep — route the LOCAL path through the framer too (one phase-seam, not two)",
			children: createVNode(_components.p, { children: [
				"R9.0 decides snapshot-vs-delta ",
				createVNode(_components.strong, { children: "inline" }),
				" in the local emit closure (the value-based recency baseline,\n",
				createVNode(_components.code, { children: "local.ts:773-795" }),
				"). When building PR-3, route the in-process path through the ",
				createVNode(_components.em, { children: "same" }),
				" framer so\n“subscribe-and-fold” is ",
				createVNode(_components.em, { children: "the" }),
				" one seam — only the ",
				createVNode(_components.strong, { children: "source of frames" }),
				" differs (in-process framer vs ssh\nwire). ",
				createVNode(_components.strong, { children: "But this is not a pure no-op, and the framer does not subsume the baseline." }),
				" The debate\n(",
				createVNode(_components.code, { children: "debates/r92-r93/" }),
				") verified that replacing the baseline with ",
				createVNode(_components.code, { children: "live = (phase === \"delta\")" }),
				" ",
				createVNode(_components.em, { children: "spuriously\nbumps recency on every restart" }),
				": adopt re-seeds ",
				createVNode(_components.code, { children: "agent: null" }),
				" (the resume identity rides the authored\n",
				createVNode(_components.code, { children: "restoreTarget" }),
				"), the agent re-resolves ",
				createVNode(_components.strong, { children: "async as a delta" }),
				", so ",
				createVNode(_components.code, { children: "agentIdentityChanged(null, A) = true" }),
				".\nSo the prep ",
				createVNode(_components.strong, { children: "moves" }),
				" the durable-baseline identity check out of the local emit closure into kolu’s\n",
				createVNode(_components.strong, { children: "consumer arm" }),
				" (uniform for local and remote), where it ANDs with the frame phase. The framer carries\nphase/seq; kolu’s arm carries the baseline; ",
				createVNode(_components.code, { children: "fold" }),
				" stays verbatim. Pin the adopt case with a differential test."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Order (as planned — never proceeded):" }),
			" ",
			createVNode(_components.strong, { children: "PR-3" }),
			" was to land in parallel with PR-1 (lifecycle) and PR-2\n(fs/git) — all three pure local no-ops — then ",
			createVNode(_components.strong, { children: "F-REMOTE" }),
			" would subscribe the remote ",
			createVNode(_components.code, { children: "terminalEvents" }),
			" and\nfold it through the same fold. The whole sequence was superseded by padi, where the producer and the fold\nare co-resident and no fold ever crosses a wire. See ",
			createVNode(_components.a, {
				href: "remote-terminals.html#finale",
				children: "the finale record"
			}),
			"."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "decided--the-forks-closed",
			children: "Decided — the forks closed"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The activity rule" }),
				" (the one product judgment): recency (",
				createVNode(_components.code, { children: "lastActivityAt" }),
				") bumps on a live agent-identity change — it starts, finishes, or a new session appears — ",
				createVNode(_components.strong, { children: "and" }),
				" (since ",
				createVNode($$PrLink, { pr: 1726 }),
				") on a same-identity ",
				createVNode(_components.strong, { children: "output" }),
				" tick, throttled to ",
				createVNode(_components.code, { children: "RECENCY_THROTTLE_MS" }),
				", so a stable long-running session doesn’t freeze; a bare ",
				createVNode(_components.code, { children: "thinking↔awaiting" }),
				" flip is subsumed by the throttled output arm. The “needs you” alert is unaffected — it rides live ",
				createVNode(_components.code, { children: "agent.state" }),
				"/urgency, not recency."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Restore resumes only a still-live agent" }),
				" (collapses ",
				createVNode(_components.code, { children: "agentSession" }),
				"): wake/session-restore resumes the conversation ",
				createVNode(_components.strong, { children: "only if the agent was live at sleep/restart" }),
				"; quit-to-shell wakes to a bare shell. As shipped, the fold derives a discriminated ",
				createVNode(_components.code, { children: "RestoreTarget" }),
				" (",
				createVNode(_components.code, { children: "restoreTargetOf" }),
				") — ",
				createVNode(_components.code, { children: "exact" }),
				" carries the conversation id (#1495), ",
				createVNode(_components.code, { children: "none" }),
				" is the bare shell — so the exact-conversation ref is a fold output, not a separate sticky field, and ",
				createVNode(_components.code, { children: "none" }),
				"-vs-",
				createVNode(_components.code, { children: "exact" }),
				" is a ",
				createVNode(_components.em, { children: "named" }),
				" discriminant the renderer can’t misread (a migrated pre-1.29 record’s most-recent resume is the third arm, ",
				createVNode(_components.code, { children: "legacyMostRecent" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "pr" }),
					" is restore-relevant, persisted like ",
					createVNode(_components.code, { children: "git" })
				] }),
				": a forge fact keyed by the branch, true-when-dead, so it survives on the dormant tile and arms autosave — deleting the frozen-",
				createVNode(_components.code, { children: "pr" }),
				" special case (",
				createVNode(_components.code, { children: "local.ts:871" }),
				", the sleeping-arm ",
				createVNode(_components.code, { children: "pr?" }),
				") and the ",
				createVNode(_components.code, { children: "pending" }),
				" flash on restore."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["The two memory fields live on ", createVNode(_components.code, { children: "kolu.authored" })] }),
				" (so the ",
				createVNode(_components.code, { children: "snapshots" }),
				" collection is ",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				" everywhere — kolu’s own and every producer’s). The fold is their ",
				createVNode(_components.strong, { children: "one" }),
				" writer through a narrowed ",
				createVNode(_components.code, { children: "authored.updateMemory(key, AgentMemory)" }),
				" mutator — mirroring the existing narrowed ",
				createVNode(_components.code, { children: "updateClientMetadata" }),
				" (",
				createVNode(_components.code, { children: "metadata.ts:166" }),
				") — so “the fold writes only memory; client code never does” is typed, not remembered. Reader-join shape unchanged (",
				createVNode(_components.code, { children: "authored ⋈ snapshots" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Dashboards (pulam-tui / pulam-web) → urgency-only" }),
				" — they read ",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				" + the urgency projection and need no fold. Because ",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				" has no ",
				createVNode(_components.code, { children: "lastActivityAt" }),
				", a dashboard that still imports recency ",
				createVNode(_components.strong, { children: "fails to compile" }),
				" (split ",
				createVNode(_components.code, { children: "compareAgents" }),
				" into ",
				createVNode(_components.code, { children: "compareAgentUrgency" }),
				" (host-safe) and a kolu-only recency tiebreak)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Host-scoped aggregation key — a branded ",
					createVNode(_components.code, { children: "HostTerminalKey" }),
					" type"
				] }),
				", not the prose pair ",
				createVNode(_components.code, { children: "(HostLocation, TerminalId)" }),
				": kaval ids are opaque (",
				createVNode(_components.code, { children: "ptyHostSurface.ts:87" }),
				"), so a bare ",
				createVNode(_components.code, { children: "Map<TerminalId, …>" }),
				" still ",
				createVNode(_components.em, { children: "spells" }),
				" the cross-host orphan collision. kolu intake pairs the host-local ",
				createVNode(_components.code, { children: "TerminalId" }),
				" with its ",
				createVNode(_components.code, { children: "HostLocation" }),
				" ",
				createVNode(_components.strong, { children: "before" }),
				" the fold; aggregates key by it, so a fleet view cannot alias two hosts’ non-kolu-minted PTY ids."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "phasing--migration",
			children: "Phasing & migration"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "S1 → S2 → R9." }),
				" S1 (the memoryless producer) is the one real lift — rewriting the freshness-critical sensors from mutate-via-sink to emit-observations, with the existing sensor tests as the safety net; it ",
				createVNode(_components.em, { children: "deletes" }),
				" the sink ×2, the record, the read-back contract, the seed, and the clobber. S2 (kolu’s fold + the two memory fields → authored + the framed ",
				createVNode(_components.code, { children: "terminalEvents" }),
				" stream) follows, and ",
				createVNode(_components.strong, { children: [
					"deletes the awareness ",
					createVNode(_components.em, { children: "mutator" }),
					" APIs too, not only the sink"
				] }),
				": ",
				createVNode(_components.code, { children: "mutateAwarenessPersisted" }),
				" / ",
				createVNode(_components.code, { children: "mutateAwarenessLive" }),
				" (",
				createVNode(_components.code, { children: "terminal-registry.ts:177-197" }),
				") and the ",
				createVNode(_components.code, { children: "(m) => { m.x = … }" }),
				" callbacks they feed (",
				createVNode(_components.code, { children: "metadata.ts:124-159" }),
				") are the surviving mutable ",
				createVNode(_components.em, { children: "place" }),
				" — the commit seam ",
				createVNode(_components.strong, { children: "replaces" }),
				" the registry value (",
				createVNode(_components.code, { children: "entry.snapshot = next" }),
				") instead of handing a caller a mutable object. After both, R9·lib is gone, R9.0 is an ~8-line loop, and remote awareness (F-REMOTE) is subscribe-and-fold."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Hard cutover, no knobs" }),
				" (the fail-fast rule). The two remembered facts are single-writer ",
				createVNode(_components.em, { children: "by type" }),
				" (",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				" can’t spell them; ",
				createVNode(_components.code, { children: "TerminalState" }),
				" nests them so the published slice can’t carry them), the clock is kolu’s ",
				createVNode(_components.em, { children: "by type" }),
				" (the producer has no memory field to stamp) and a sampled ",
				createVNode(_components.em, { children: "value" }),
				" not a thunk, and the autosave fence rides a ",
				createVNode(_components.strong, { children: "restore-relevant value change" }),
				" — honestly “by a value check,” not “by type,” since a ",
				createVNode(_components.code, { children: "Partial<T>" }),
				" always admits ",
				createVNode(_components.code, { children: "{}" }),
				" (the one place the design can’t reach a pure type, made explicit rather than overclaimed)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "What it retires:" }),
				" createPulam; the ",
				createVNode(_components.code, { children: "AwarenessSink" }),
				"; the seed and the restore-caveat heuristic; ",
				createVNode(_components.code, { children: "reconcileRemoteSnapshot" }),
				"; the separate ",
				createVNode(_components.code, { children: "agentSession" }),
				" field; the “two homes, two assemblers” framing; and the fold-clobber as a ",
				createVNode(_components.em, { children: "class" }),
				". #1614 stays dead for the right reason — the in-process producer can’t clobber, so no local pulam ",
				createVNode(_components.em, { children: "process" }),
				" is needed."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-one-thing-no-type-settles--and-its-containment",
			children: "The one thing no type settles — and its containment"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Exactly one judgment is a product choice, not a type: ",
			createVNode(_components.strong, { children: "which agent transition counts as “activity”" }),
			" (two composing arms since ",
			createVNode($$PrLink, { pr: 1726 }),
			": an identity change always, plus a throttled same-identity output tick — see the follow-up fix at the top). It lives in the fold’s tested branches with ",
			createVNode(_components.strong, { children: "no producer bypass" }),
			". Almost everything else is unspellable ",
			createVNode(_components.em, { children: "by type" }),
			"; the single honest exception is the autosave fence, which rides a ",
			createVNode(_components.strong, { children: "restore-relevant value change" }),
			" (a ",
			createVNode(_components.code, { children: "Partial<T>" }),
			" admits ",
			createVNode(_components.code, { children: "{}" }),
			") — so it gets a test, not a type. ",
			createVNode(_components.strong, { children: "Tests that make that real:" })
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.em, { children: "type" }),
				" — ",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				" cannot contain ",
				createVNode(_components.code, { children: "lastActivityAt" }),
				"/",
				createVNode(_components.code, { children: "lastAgentCommand" }),
				"; ",
				createVNode(_components.code, { children: "TerminalState.snapshot" }),
				" is what publishes to the snapshots collection, so memory can’t ride along; no ",
				createVNode(_components.code, { children: "reconcileRemoteSnapshot(AwarenessValue, AwarenessValue)" }),
				" API exists."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.em, { children: "the headline fence" }),
				" — an ",
				createVNode(_components.code, { children: "agent" }),
				" token tick that changes detail but ",
				createVNode(_components.strong, { children: "no" }),
				" restore-relevant value (same identity, same session — the ~150 ms firehose) folds to an ",
				createVNode(_components.strong, { children: "equal" }),
				" ",
				createVNode(_components.code, { children: "restoreRelevant" }),
				" projection and ",
				createVNode(_components.strong, { children: "does not" }),
				" arm autosave. Remove the value-change check and this test fails (the firehose reaches disk)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"a ",
				createVNode(_components.code, { children: "null→detected" }),
				" agent in a ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "delta" }) }),
				" frame bumps recency; the same in a ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "snapshot" }) }),
				" frame (re-observation) does ",
				createVNode(_components.strong, { children: "not" }),
				" — the frame phase, not a producer flag, decides; there is no ",
				createVNode(_components.code, { children: "fromSnapshot" }),
				" to mislabel."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"restore: an agent ",
				createVNode(_components.strong, { children: "live" }),
				" at sleep resumes its exact conversation (",
				createVNode(_components.code, { children: "frozen.agent.sessionId" }),
				"); an agent the user ",
				createVNode(_components.strong, { children: "quit" }),
				" before sleep (",
				createVNode(_components.code, { children: "agent: null" }),
				") wakes to a bare shell."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"a replayed ",
				createVNode(_components.code, { children: "commandRun" }),
				" updates ",
				createVNode(_components.code, { children: "lastAgentCommand" }),
				" (so wake can replay) but fires ",
				createVNode(_components.strong, { children: "no" }),
				" recent-agent MRU bump."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"a producer clock a year ahead never reorders kolu’s recency (kolu samples its own clock; the wire has no ",
				createVNode(_components.code, { children: "observedAt" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"a dropped delta (a hole in ",
				createVNode(_components.code, { children: "seq" }),
				") yields a ",
				createVNode(_components.code, { children: "gap" }),
				" frame and a re-snapshot — never a silently divergent fold."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"the same id on two ",
				createVNode(_components.code, { children: "HostLocation" }),
				"s keeps two aggregate entries (a bare ",
				createVNode(_components.code, { children: "TerminalId" }),
				" can’t index the fleet — ",
				createVNode(_components.code, { children: "HostTerminalKey" }),
				" is required)."
			] }),
			"\n"
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Awareness — the producer observes, kolu remembers",
	"description": "The converged awareness architecture (PR #1621), simplified across a long design review. One complect underlies every hard thing in R9 — the sensor engine DERIVES awareness by mutating a host record it also reads back as memory. The fix splits observing from remembering. A host PRODUCER emits one TerminalSnapshot = {cwd, git, pr, agent, foreground} — exactly what it can re-observe, and nothing it cannot. kolu stores TerminalState = that last-seen TerminalSnapshot plus TWO facts a host can never observe and only kolu may write — lastActivityAt (recency, on kolu's clock) and lastAgentCommand (the line to replay). The \"fold\" is last-write-wins for the five snapshot fields plus those two rules. Restore resumes an agent only if it was still live at sleep/restart (quit-to-shell wakes to a bare shell), which collapses agentSession into the frozen agent. Lie-when-dead is handled by the active/sleeping discriminant, not by dropping fields. This note pins the types, the API, and the flows.",
	"parents": ["remote-terminals"],
	"status": "implemented",
	"maturity": "budding",
	"updated": "2026-07-01T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-knot-today--observing-is-fused-with-remembering",
			"text": "The knot today — observing is fused with remembering"
		},
		{
			"depth": 2,
			"slug": "the-cut-one-question--can-a-host-re-observe-it",
			"text": "The cut: one question — can a host re-observe it?"
		},
		{
			"depth": 2,
			"slug": "s1--the-producer-is-memoryless",
			"text": "S1 — the producer is memoryless"
		},
		{
			"depth": 2,
			"slug": "s2--kolu-remembers-the-fold-owns-the-two-facts-and-the-clock",
			"text": "S2 — kolu remembers; the fold owns the two facts and the clock"
		},
		{
			"depth": 2,
			"slug": "persistence-tiers--what-lives-where",
			"text": "Persistence tiers — what lives where"
		},
		{
			"depth": 2,
			"slug": "the-wire--observations-not-whole-values",
			"text": "The wire — observations, not whole values"
		},
		{
			"depth": 2,
			"slug": "how-r9-collapses",
			"text": "How R9 collapses"
		},
		{
			"depth": 2,
			"slug": "remote-awareness--the-build-pr-3-prep--f-remote-consume",
			"text": "Remote awareness — the build (PR-3 prep + F-REMOTE consume)"
		},
		{
			"depth": 2,
			"slug": "decided--the-forks-closed",
			"text": "Decided — the forks closed"
		},
		{
			"depth": 2,
			"slug": "phasing--migration",
			"text": "Phasing & migration"
		},
		{
			"depth": 2,
			"slug": "the-one-thing-no-type-settles--and-its-containment",
			"text": "The one thing no type settles — and its containment"
		}
	];
}
var url = "src/content/atlas/awareness-derive-store.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/awareness-derive-store.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/awareness-derive-store.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, PT, file, frontmatter, getHeadings, url };
