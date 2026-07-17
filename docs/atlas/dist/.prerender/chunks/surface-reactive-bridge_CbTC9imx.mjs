import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
//#region src/diagrams/surface-reactive-bridge-layers.svg?raw
var surface_reactive_bridge_layers_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 980 430\" font-family=\"system-ui, sans-serif\">\n  <rect width=\"980\" height=\"430\" fill=\"#0f1117\"/>\n  <defs>\n    <marker id=\"arr\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#8b95a7\"/>\n    </marker>\n  </defs>\n\n  <!-- layer 1: engine -->\n  <text x=\"30\" y=\"30\" fill=\"#8b95a7\" font-size=\"13\" font-weight=\"600\">LAYER 1 — PRODUCER ENGINE (decided)</text>\n  <rect x=\"30\" y=\"42\" width=\"920\" height=\"66\" rx=\"9\" fill=\"#1a2130\" stroke=\"#a78bfa\" stroke-width=\"1.5\"/>\n  <text x=\"490\" y=\"66\" fill=\"#e6eaf2\" font-size=\"12\" text-anchor=\"middle\">@preact/signals-core — swappable → @solidjs/signals (once Solid 2.0 + ecosystem stabilize)</text>\n  <text x=\"490\" y=\"84\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">hidden behind reactor.ts, the ONLY module allowed to import it (lint-banned elsewhere)</text>\n  <text x=\"490\" y=\"100\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">reactor.ts exports computed + bridge constructors — never raw signal, never raw effect</text>\n\n  <!-- layer 2: bridge -->\n  <text x=\"30\" y=\"140\" fill=\"#8b95a7\" font-size=\"13\" font-weight=\"600\">LAYER 2 — THE BRIDGE (per-member wire adapters; every wire law stays where it lives)</text>\n  <rect x=\"30\" y=\"152\" width=\"920\" height=\"118\" rx=\"9\" fill=\"#141925\" stroke=\"#3d4a63\" stroke-width=\"1.5\"/>\n  <rect x=\"46\" y=\"166\" width=\"280\" height=\"42\" rx=\"6\" fill=\"#1a2130\" stroke=\"#5b8def\"/>\n  <text x=\"186\" y=\"184\" fill=\"#9db4e8\" font-size=\"11\" text-anchor=\"middle\">sources into the graph</text>\n  <text x=\"186\" y=\"199\" fill=\"#8b95a7\" font-size=\"9.5\" text-anchor=\"middle\">source (push | poll) · reactiveFamily (phase 3)</text>\n  <rect x=\"342\" y=\"166\" width=\"280\" height=\"42\" rx=\"6\" fill=\"#1a2130\" stroke=\"#5b8def\"/>\n  <text x=\"482\" y=\"184\" fill=\"#9db4e8\" font-size=\"11\" text-anchor=\"middle\">the graph: computed + $ (typed sibling reads)</text>\n  <text x=\"482\" y=\"199\" fill=\"#8b95a7\" font-size=\"9.5\" text-anchor=\"middle\">derived reads derived as computed — glitch-free diamonds</text>\n  <rect x=\"638\" y=\"166\" width=\"296\" height=\"42\" rx=\"6\" fill=\"#1a2130\" stroke=\"#5b8def\"/>\n  <text x=\"786\" y=\"184\" fill=\"#9db4e8\" font-size=\"11\" text-anchor=\"middle\">exits: derived.cell · derived.collection (· registry, ph. 3)</text>\n  <text x=\"786\" y=\"199\" fill=\"#8b95a7\" font-size=\"9.5\" text-anchor=\"middle\">each effect a leaf → applyAndPublish, untouched</text>\n  <text x=\"490\" y=\"228\" fill=\"#e6eaf2\" font-size=\"10.5\" text-anchor=\"middle\">the laws live here: equals at the member (once) · batch owned by the bridge · seeds from truth · one error wrapper (statefulness line)</text>\n  <text x=\"490\" y=\"245\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">one-writer structural: a derived member has NO ctx entry and no write verbs — the second writer is unrepresentable</text>\n  <text x=\"490\" y=\"262\" fill=\"#e8b44c\" font-size=\"10.5\" text-anchor=\"middle\">streams and events do NOT ride the graph — a signal is state, not a log (a named, permanent boundary)</text>\n\n  <!-- wire -->\n  <line x1=\"30\" y1=\"296\" x2=\"950\" y2=\"296\" stroke=\"#e05252\" stroke-width=\"1.2\" stroke-dasharray=\"7 5\"/>\n  <text x=\"490\" y=\"290\" fill=\"#e05252\" font-size=\"10.5\" text-anchor=\"middle\">THE WIRE — snapshots and replays; per-member frames, no cross-channel atomicity (seamless API, not seamless semantics)</text>\n\n  <!-- layer 3: client -->\n  <text x=\"30\" y=\"326\" fill=\"#8b95a7\" font-size=\"13\" font-weight=\"600\">LAYER 3 — SOLID CLIENT (mechanically unchanged)</text>\n  <rect x=\"30\" y=\"338\" width=\"920\" height=\"60\" rx=\"9\" fill=\"#1a2130\" stroke=\"#2dd4a7\" stroke-width=\"1.5\"/>\n  <text x=\"490\" y=\"362\" fill=\"#e6eaf2\" font-size=\"12\" text-anchor=\"middle\">useCell / useCollection / surface-map / scopedByEntry — createMemo is the client's computed</text>\n  <text x=\"490\" y=\"380\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">Subscription.updated becomes a true change-iff-fired edge (producer spec-equals guaranteed on every derived member)</text>\n\n  <line x1=\"490\" y1=\"108\" x2=\"490\" y2=\"150\" stroke=\"#8b95a7\" stroke-width=\"1.3\" marker-end=\"url(#arr)\"/>\n  <line x1=\"490\" y1=\"270\" x2=\"490\" y2=\"292\" stroke=\"#8b95a7\" stroke-width=\"1.3\" marker-end=\"url(#arr)\"/>\n  <line x1=\"490\" y1=\"300\" x2=\"490\" y2=\"336\" stroke=\"#8b95a7\" stroke-width=\"1.3\" marker-end=\"url(#arr)\"/>\n\n  <text x=\"490\" y=\"420\" fill=\"#5b6678\" font-size=\"10.5\" text-anchor=\"middle\">the author's one model: state is a signal · derived is a computed · the wire is a signal boundary that snapshots and replays</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/surface-reactive-bridge.mdx
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
			createVNode(_components.strong, { children: "The model, in one paragraph." }),
			" State is a signal; derived state is a computed; an effect reacts; ",
			createVNode(_components.strong, { children: "the wire is a signal boundary that snapshots and replays" }),
			". Server-side, a signals engine becomes a dependency of ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" only, wrapped in one module — ",
			createVNode(_components.code, { children: "reactor.ts" }),
			" — which exports ",
			createVNode(_components.code, { children: "computed" }),
			" and the bridge constructors but never raw ",
			createVNode(_components.code, { children: "signal" }),
			" or raw ",
			createVNode(_components.code, { children: "effect" }),
			"; the engine’s deep import is lint-banned outside reactor.ts, so the wrapper is the only graph exit by construction, not by review. Client-side, Solid is mechanically unchanged. ",
			createVNode(_components.strong, { children: "Streams and events deliberately do not ride the graph" }),
			" — a signal is state, not a log (it conflates same-batch frames by construction); they keep snapshot-then-delta and ",
			createVNode(_components.code, { children: "ctx.publish" }),
			". This is a named, permanent boundary. And the wire adds what no engine has — latency, serialization, authority, partial failure — which the API names rather than hides: ",
			createVNode(_components.strong, { children: "seamless API, not seamless semantics" }),
			"."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: surface_reactive_bridge_layers_default,
			wide: true,
			caption: "Three layers. The engine — @preact/signals-core, swappable to @solidjs/signals — hidden behind reactor.ts; the bridge, where every wire law lives — sources in, computed graph with typed sibling reads, wire-effect exits as leaves into the untouched publish paths; the wire as the honest boundary; the Solid client unchanged."
		}),
		"\n",
		createVNode(_components.p, { children: "The one story, both sides — derive on whichever side of the wire the inputs live:" }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// ── server (producer) ──────────────────────────────</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">cells</span><span style=\"color:#24292E\">: {</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  urgency</span><span style=\"color:#24292E\">: derived.</span><span style=\"color:#6F42C1\">cell</span><span style=\"color:#24292E\">((</span><span style=\"color:#E36209\">$</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> recomputeUrgency</span><span style=\"color:#24292E\">($.</span><span style=\"color:#6F42C1\">terminals</span><span style=\"color:#24292E\">())),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">},</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// ── client (consumer) ─────────────────────────────</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> urgency</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> client.cells.urgency.</span><span style=\"color:#6F42C1\">use</span><span style=\"color:#24292E\">();          </span><span style=\"color:#6A737D\">// Accessor via Solid store, reconciled</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> badge</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> createMemo</span><span style=\"color:#24292E\">(() </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> urgency.</span><span style=\"color:#6F42C1\">value</span><span style=\"color:#24292E\">().awaitingIds.</span><span style=\"color:#005CC5\">length</span><span style=\"color:#24292E\">);</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">createEffect</span><span style=\"color:#24292E\">(() </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> title.</span><span style=\"color:#6F42C1\">set</span><span style=\"color:#24292E\">(</span><span style=\"color:#6F42C1\">badge</span><span style=\"color:#24292E\">() </span><span style=\"color:#D73A49\">></span><span style=\"color:#005CC5\"> 0</span><span style=\"color:#D73A49\"> ?</span><span style=\"color:#032F62\"> `(${</span><span style=\"color:#6F42C1\">badge</span><span style=\"color:#032F62\">()</span><span style=\"color:#032F62\">})`</span><span style=\"color:#D73A49\"> :</span><span style=\"color:#032F62\"> \"\"</span><span style=\"color:#24292E\">));</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "$" }),
			" is the typed sibling read face (a plain mapped type over the spec — no ",
			createVNode(_components.code, { children: "keyof" }),
			" union explosion): ",
			createVNode(_components.code, { children: "$.someCell(): T" }),
			", ",
			createVNode(_components.code, { children: "$.someCollection(): ReadonlyMap<K,T>" }),
			". The critical rule: an authored member’s graph face is its post-equals mirror; ",
			createVNode(_components.strong, { children: [
				"a derived member’s graph face is its ",
				createVNode(_components.code, { children: "computed" }),
				" directly"
			] }),
			" — so every derivation chain is a pure computed graph (glitch-free by the engine’s version-checked lazy pull) and each wire effect is a leaf into ",
			createVNode(_components.code, { children: "applyAndPublish" }),
			", untouched."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The engine is decided:" }),
			" ",
			createVNode(_components.code, { children: "@preact/signals-core" }),
			" behind reactor.ts now, ",
			createVNode(_components.code, { children: "@solidjs/signals" }),
			" the named swap target once Solid 2.0 and its ecosystem stabilize — ",
			createVNode(_components.a, {
				href: "surface-reactor-engine.html",
				children: "the engine note"
			}),
			" holds the probed comparison and the eliminations; ",
			createVNode(_components.code, { children: "reactor.ts" }),
			" keeps it a two-way door (rename + a flush rule + the law tests)."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-api-symbol-by-symbol",
			children: "The API, symbol by symbol"
		}),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Seven orthogonal symbols — reflex’s cut" }), ": three graph, two wire, two glue. One card each, hello-world sized; the tag names the migration phase that ships it."] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: "Graph:" }) }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "source(...)" }) }),
			" ",
			createVNode(_components.em, { children: "(phase 0)" }),
			" — external input into the graph: one constructor, two argument shapes (an install callback for push; ",
			createVNode(_components.code, { children: "{read, install}" }),
			" for poll)."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> online</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> source</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#005CC5\">boolean</span><span style=\"color:#24292E\">>((</span><span style=\"color:#E36209\">emit</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> net.</span><span style=\"color:#6F42C1\">onChange</span><span style=\"color:#24292E\">(emit), </span><span style=\"color:#005CC5\">true</span><span style=\"color:#24292E\">);  </span><span style=\"color:#6A737D\">// push</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> temperature</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> source</span><span style=\"color:#24292E\">({</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  read</span><span style=\"color:#24292E\">: () </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> sensor.</span><span style=\"color:#6F42C1\">readCelsius</span><span style=\"color:#24292E\">(),          </span><span style=\"color:#6A737D\">// poll: T+0 seed; a failing FIRST read crashes boot</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  install</span><span style=\"color:#24292E\">: (</span><span style=\"color:#E36209\">tick</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> everySeconds</span><span style=\"color:#24292E\">(</span><span style=\"color:#005CC5\">5</span><span style=\"color:#24292E\">, tick),  </span><span style=\"color:#6A737D\">// the caller owns the cadence</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "scan(source, initial, step)" }) }),
			" ",
			createVNode(_components.em, { children: "(phase 0)" }),
			" — an accumulation: a free-standing graph node, not a member variant. Scan takes a ",
			createVNode(_components.em, { children: "source" }),
			" because each emission is an occurrence that steps the fold exactly once; ",
			createVNode(_components.code, { children: "$" }),
			" reads are levels — current values with no per-emission meaning. Durability rides a visible options argument."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> clicks</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> source</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#005CC5\">void</span><span style=\"color:#24292E\">>((</span><span style=\"color:#E36209\">emit</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> button.</span><span style=\"color:#6F42C1\">onPress</span><span style=\"color:#24292E\">(emit));</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> count</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> scan</span><span style=\"color:#24292E\">(clicks, </span><span style=\"color:#005CC5\">0</span><span style=\"color:#24292E\">, (</span><span style=\"color:#E36209\">n</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> n </span><span style=\"color:#D73A49\">+</span><span style=\"color:#005CC5\"> 1</span><span style=\"color:#24292E\">);</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// durable: scan(clicks, (stored) => stored ?? 0, step, { store: conf })</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "computed(fn)" }) }),
			" ",
			createVNode(_components.em, { children: "(phase 1)" }),
			" — a derived value; also the private intermediate node several members share without it becoming a wire member."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> frames</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> source</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">Stats</span><span style=\"color:#24292E\">>((</span><span style=\"color:#E36209\">emit</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> statsTap</span><span style=\"color:#24292E\">(emit));</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> smoothed</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> computed</span><span style=\"color:#24292E\">(() </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> ema</span><span style=\"color:#24292E\">(frames.value));  </span><span style=\"color:#6A737D\">// never on the wire</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">cells</span><span style=\"color:#24292E\">: {</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  cpu</span><span style=\"color:#24292E\">: derived.</span><span style=\"color:#6F42C1\">cell</span><span style=\"color:#24292E\">(() </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> smoothed.value.cpu),</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  mem</span><span style=\"color:#24292E\">: derived.</span><span style=\"color:#6F42C1\">cell</span><span style=\"color:#24292E\">(() </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> smoothed.value.mem),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">}</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: "Wire:" }) }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "derived.cell(nodeOrFn)" }) }),
			" ",
			createVNode(_components.em, { children: "(phase 0)" }),
			" — publish any graph node, or a ",
			createVNode(_components.code, { children: "$" }),
			"-reading compute, as a cell; it publishes through the member’s own ",
			createVNode(_components.code, { children: "equals" }),
			" gate."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6F42C1\">cells</span><span style=\"color:#24292E\">: {</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  name</span><span style=\"color:#24292E\">:     { </span><span style=\"color:#6F42C1\">schema</span><span style=\"color:#24292E\">: z.</span><span style=\"color:#6F42C1\">string</span><span style=\"color:#24292E\">(), </span><span style=\"color:#D73A49\">default</span><span style=\"color:#24292E\">: </span><span style=\"color:#032F62\">\"world\"</span><span style=\"color:#24292E\"> },</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  greeting</span><span style=\"color:#24292E\">: derived.</span><span style=\"color:#6F42C1\">cell</span><span style=\"color:#24292E\">((</span><span style=\"color:#E36209\">$</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#032F62\"> `hello, ${</span><span style=\"color:#24292E\">$</span><span style=\"color:#032F62\">.</span><span style=\"color:#6F42C1\">name</span><span style=\"color:#032F62\">()</span><span style=\"color:#032F62\">}!`</span><span style=\"color:#24292E\">),  </span><span style=\"color:#6A737D\">// a compute fn</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  count</span><span style=\"color:#24292E\">:    derived.</span><span style=\"color:#6F42C1\">cell</span><span style=\"color:#24292E\">(count),                         </span><span style=\"color:#6A737D\">// any graph node (the scan above)</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">}</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "derived.collection(nodeOrFn)" }) }),
			" ",
			createVNode(_components.em, { children: "(phase 2)" }),
			" — publish a keyed node as a collection; the bridge diffs each output against the last by the collection’s ",
			createVNode(_components.code, { children: "equals" }),
			" and publishes only the changed keys."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6F42C1\">collections</span><span style=\"color:#24292E\">: {</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  bigFiles</span><span style=\"color:#24292E\">:  derived.</span><span style=\"color:#6F42C1\">collection</span><span style=\"color:#24292E\">((</span><span style=\"color:#E36209\">$</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> filterValues</span><span style=\"color:#24292E\">($.</span><span style=\"color:#6F42C1\">files</span><span style=\"color:#24292E\">(), (</span><span style=\"color:#E36209\">f</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> f.bytes </span><span style=\"color:#D73A49\">></span><span style=\"color:#005CC5\"> 1e6</span><span style=\"color:#24292E\">)),</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  processes</span><span style=\"color:#24292E\">: derived.</span><span style=\"color:#6F42C1\">collection</span><span style=\"color:#24292E\">(</span><span style=\"color:#6F42C1\">source</span><span style=\"color:#24292E\">({ read: readProcessTable, install: everySecond })),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">}</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: "Glue:" }) }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "$" }) }),
			" ",
			createVNode(_components.em, { children: "(phase 1)" }),
			" — the typed sibling reader handed to every compute; reading is depending, and a derived sibling is read as its computed, never its mirror."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6F42C1\">cells</span><span style=\"color:#24292E\">: {</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  overview</span><span style=\"color:#24292E\">: derived.</span><span style=\"color:#6F42C1\">cell</span><span style=\"color:#24292E\">((</span><span style=\"color:#E36209\">$</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> ({</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">    open:  $.</span><span style=\"color:#6F42C1\">terminals</span><span style=\"color:#24292E\">().size,       </span><span style=\"color:#6A737D\">// $.someCollection(): ReadonlyMap&#x3C;K,T></span></span>\n<span class=\"line\"><span style=\"color:#24292E\">    theme: $.</span><span style=\"color:#6F42C1\">preferences</span><span style=\"color:#24292E\">().theme,    </span><span style=\"color:#6A737D\">// $.someCell(): T</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  })),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">}</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "batch" }) }),
			" ",
			createVNode(_components.em, { children: "(phase 1)" }),
			" — group several writes into one graph frame, so derivations recompute once."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6F42C1\">batch</span><span style=\"color:#24292E\">(() </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> {</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  registry.</span><span style=\"color:#6F42C1\">set</span><span style=\"color:#24292E\">(id, next);</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  registry.</span><span style=\"color:#6F42C1\">delete</span><span style=\"color:#24292E\">(oldId);</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});  </span><span style=\"color:#6A737D\">// one frame → one recompute per derivation</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"Not carded: the keyed machinery — ",
			createVNode(_components.code, { children: "reactiveFamily" }),
			" ",
			createVNode(_components.em, { children: "(SR9)" }),
			" and ",
			createVNode(_components.code, { children: "signalMap" }),
			" ",
			createVNode(_components.em, { children: "(SR10)" }),
			" — arrives with its phases, introduced there. Client-side, the one new symbol stays ",
			createVNode(_components.code, { children: "Subscription.updated" }),
			" (the change-iff-fired edge; see the worked alerts example)."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-worked-examples",
			children: "The worked examples"
		}),
		"\n",
		createVNode(_components.p, { children: "The review artifact: real befores at master, the after as it would read." }),
		"\n",
		createVNode(_components.h3, {
			id: "sr7--worked-example-1--padi-urgency",
			children: "SR7 · worked example 1 — padi urgency"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Before:" }),
			" ",
			createVNode(_components.code, { children: "recomputeUrgency" }),
			" (",
			createVNode(_components.code, { children: "urgency.ts:23-38" }),
			") is refolded by ",
			createVNode(_components.code, { children: "publishUrgency" }),
			" (",
			createVNode(_components.code, { children: "metadata.ts:110-112" }),
			") as a rider inside every ",
			createVNode(_components.code, { children: "publishComposedTerminal" }),
			" (",
			createVNode(_components.code, { children: ":97-105" }),
			") on the ~150 ms agent firehose, plus a separate removal-path refold (",
			createVNode(_components.code, { children: "dropSnapshot" }),
			", ",
			createVNode(_components.code, { children: ":129-132" }),
			"), held together by a prose invariant (",
			createVNode(_components.code, { children: "metadata.ts:93-96" }),
			"). ",
			createVNode(_components.strong, { children: "After" }),
			", in servePadi.ts:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6F42C1\">cells</span><span style=\"color:#24292E\">: {</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">  // spec unchanged: equals: urgencyEqual stays the ONE wire dedup point</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  urgency</span><span style=\"color:#24292E\">: derived.</span><span style=\"color:#6F42C1\">cell</span><span style=\"color:#24292E\">((</span><span style=\"color:#E36209\">$</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> recomputeUrgency</span><span style=\"color:#24292E\">($.</span><span style=\"color:#6F42C1\">terminals</span><span style=\"color:#24292E\">())),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">},</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "recomputeUrgency" }),
			"’s body survives with its parameter becoming the map. Deleted: ",
			createVNode(_components.code, { children: "publishUrgency" }),
			", its rider, the ",
			createVNode(_components.code, { children: "dropSnapshot" }),
			" refold, the prose invariant — a registry writer can no longer forget urgency because the edge is tracked, not conventional."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"Honest cost — a REGRESSION, not a hypothetical (SR7, ",
				createVNode($$PrLink, { pr: 1823 }),
				"):"
			] }),
			" reading ",
			createVNode(_components.code, { children: "$.terminals()" }),
			" folds the ",
			createVNode(_components.strong, { children: "composed" }),
			" collection, so every firehose poke re-composes ",
			createVNode(_components.em, { children: "every" }),
			" live terminal (",
			createVNode(_components.code, { children: "registryMap(composePadiTerminal)" }),
			" — object-spreads for active, ",
			createVNode(_components.code, { children: "SleepingTerminalSchema.parse" }),
			" for sleeping/parked) even though one terminal changed. That is O(M) composes per write → ",
			createVNode(_components.strong, { children: "O(M²) compose per ~150 ms firehose cycle" }),
			", where pre-SR7 ",
			createVNode(_components.code, { children: "recomputeUrgency()" }),
			" folded the raw registry (",
			createVNode(_components.code, { children: "terminalEntries()" }),
			") at O(M) ",
			createVNode(_components.em, { children: "field reads" }),
			", zero composition. (M is real: ~16 live terminals on a busy dev host.) The in-scope mitigations are both worse trades — folding the raw registry re-couples ",
			createVNode(_components.code, { children: "recomputeUrgency" }),
			" to the global registry the migration just decoupled, and memoizing ",
			createVNode(_components.code, { children: "composePadiTerminal" }),
			" is a new caching layer bigger than SR7 — so the fix lands in SR8, ",
			createVNode(_components.strong, { children: "precisely located" }),
			": not ",
			createVNode(_components.code, { children: "derived.collection" }),
			"’s keyed reconciler (that is a ",
			createVNode(_components.em, { children: "wire" }),
			" dedup — it diffs a whole-map read against the last, so the recompose has already happened by the time it runs) but the ",
			createVNode(_components.strong, { children: [
				"incremental ",
				createVNode(_components.code, { children: "$" }),
				" sibling read"
			] }),
			" — the framework maintains the composed per-key map in the existing ",
			createVNode(_components.code, { children: "wrappedUpsert" }),
			"/",
			createVNode(_components.code, { children: "wrappedRemove" }),
			" (which already carry the composed value), so ",
			createVNode(_components.code, { children: "$.terminals()" }),
			" returns the maintained map with zero recomposes: ",
			createVNode(_components.strong, { children: "M composes per firehose cycle, one per poke" }),
			". Opt-in, and safe only where every change flows through ",
			createVNode(_components.code, { children: "ctx.upsert/remove" }),
			" (terminals qualifies). SR8 carries this as a ",
			createVNode(_components.a, {
				href: "surface-runtime-boundary.html",
				children: "named obligation"
			}),
			" and proves it with a compose-count gate (24 vs 600 per cycle at M=24); ",
			createVNode(_components.code, { children: "batch()" }),
			" around a burst does NOT address it (it coalesces ",
			createVNode(_components.em, { children: "frequency" }),
			", not the per-recompute compose cost). Wall-clock honesty (measured, #1832’s evidence): stripping the compose term is a ~14× plateau (278→19 ms/cycle at M=1536), not a growing win — ",
			createVNode(_components.code, { children: "recomputeUrgency" }),
			" still scans the whole map per poke, a cheap residual O(M²) parked as ",
			createVNode(_components.a, {
				href: "surface-runtime-boundary.html#sr8b",
				children: "SR8.b"
			}),
			"."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "2-drishti-alerts--hysteresis-scan-durability-chosen-in-the-signature",
			children: "2. drishti alerts — hysteresis scan, durability chosen in the signature"
		}),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// drishti server</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> metrics</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> source</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">MetricsFrame</span><span style=\"color:#24292E\">>((</span><span style=\"color:#E36209\">emit</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> installMetricsTap</span><span style=\"color:#24292E\">(emit));</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">cells</span><span style=\"color:#24292E\">: {</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">  // durability CHOICE: no store — alerts deliberately do NOT survive restart;</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">  // step returning the prev reference ⇒ no publish</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  alerts</span><span style=\"color:#24292E\">: derived.</span><span style=\"color:#6F42C1\">cell</span><span style=\"color:#24292E\">(</span><span style=\"color:#6F42C1\">scan</span><span style=\"color:#24292E\">(metrics, noAlerts, applyHysteresis)),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">},</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"The durable variant is the same scan with the choice explicit: ",
			createVNode(_components.code, { children: "scan(metrics, (stored) => stored ?? noAlerts, applyHysteresis, { store: alertsConf })" }),
			". Wire-read-only by construction (no ctx entry; verbs exclude ",
			createVNode(_components.code, { children: "set" }),
			"/",
			createVNode(_components.code, { children: "patch" }),
			"/",
			createVNode(_components.code, { children: "test__set" }),
			"). A ",
			createVNode(_components.code, { children: "step" }),
			" throw hits the stateful policy in the one wrapper: log loudly, dispose, hold last published, flip the member’s stopped-latch into health. Client side:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> alerts</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> client.cells.alerts.</span><span style=\"color:#6F42C1\">use</span><span style=\"color:#24292E\">();</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">wireSubscriptionUpdated</span><span style=\"color:#24292E\">(alerts.sub, () </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> playRaiseSound</span><span style=\"color:#24292E\">());  </span><span style=\"color:#6A737D\">// fires iff spec-equals said \"changed\"</span></span></code></pre>" }),
		"\n",
		createVNode(_components.h3, {
			id: "sr8--worked-example-3--a-sampler-padi-processmemory",
			children: "SR8 · worked example 3 — a sampler (padi processMemory)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Before:" }),
			" ",
			createVNode(_components.code, { children: "startPadiMemorySampler" }),
			" (",
			createVNode(_components.code, { children: "memorySampler.ts" }),
			") hand-rolls the T+0 fire, the 5s ",
			createVNode(_components.code, { children: "setInterval(...).unref()" }),
			", and the ",
			createVNode(_components.code, { children: "inFlight" }),
			" non-overlap guard; ",
			createVNode(_components.code, { children: "samplePadiMemoryOnce" }),
			" publishes via ",
			createVNode(_components.code, { children: "padiSurfaceCtx.cells.processMemory.set" }),
			". ",
			createVNode(_components.strong, { children: "After:" })
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6F42C1\">cells</span><span style=\"color:#24292E\">: {</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  processMemory</span><span style=\"color:#24292E\">: derived.</span><span style=\"color:#6F42C1\">cell</span><span style=\"color:#24292E\">(</span><span style=\"color:#6F42C1\">source</span><span style=\"color:#24292E\">({</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">    read: samplePadiMemory,   </span><span style=\"color:#6A737D\">// pure async read RETURNING {padi, kaval} — the honest</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">                              // three-way inside pollKavalRss survives verbatim</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">    install</span><span style=\"color:#24292E\">: (</span><span style=\"color:#E36209\">tick</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> {</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">      const</span><span style=\"color:#005CC5\"> iv</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> setInterval</span><span style=\"color:#24292E\">(tick, </span><span style=\"color:#005CC5\">MEMORY_SAMPLE_INTERVAL_MS</span><span style=\"color:#24292E\">);</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">      iv.</span><span style=\"color:#6F42C1\">unref</span><span style=\"color:#24292E\">();</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">      return</span><span style=\"color:#24292E\"> () </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> clearInterval</span><span style=\"color:#24292E\">(iv);</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">    },</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  })),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">},</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"The bridge owns: the T+0 seed read whose ",
			createVNode(_components.strong, { children: "first failure propagates" }),
			" (never a fabricated default), the inFlight guard, later-read log-skip-continue. kolu-server’s fused cadence (interval + ",
			createVNode(_components.code, { children: "onState" }),
			" force-resample, ",
			createVNode(_components.code, { children: "index.ts:807" }),
			") is two more plain lines inside ",
			createVNode(_components.code, { children: "install" }),
			" — no cadence micro-API. ",
			createVNode(_components.code, { children: "hostInventory.ts" }),
			" falls to the identical pattern."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "sr9--worked-example-4--the-servehostmap-keyed-family",
			children: "SR9 · worked example 4 — the serveHostMap keyed family"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Before" }),
			" (",
			createVNode(_components.code, { children: "serveHostMap.ts:145-206" }),
			"): hand-held ",
			createVNode(_components.code, { children: "latestState" }),
			"/",
			createVNode(_components.code, { children: "stateSubs" }),
			"/",
			createVNode(_components.code, { children: "links" }),
			" Maps, attach/detach/reconcile, the ",
			createVNode(_components.code, { children: "fire" }),
			" fan-out, the per-member catch (",
			createVNode(_components.code, { children: ":168-182" }),
			"); drishti carries a drifted clone (",
			createVNode(_components.code, { children: "hostMapRegistry.ts" }),
			", clockOffset hardcoded ",
			createVNode(_components.code, { children: "0" }),
			"). ",
			createVNode(_components.strong, { children: "After:" })
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> hosts</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> reactiveFamily</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#005CC5\">string</span><span style=\"color:#24292E\">, </span><span style=\"color:#6F42C1\">SessionState</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#005CC5\">string</span><span style=\"color:#24292E\">>>({</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  members: </span><span style=\"color:#6F42C1\">source</span><span style=\"color:#24292E\">((</span><span style=\"color:#E36209\">emit</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> pool.</span><span style=\"color:#6F42C1\">subscribe</span><span style=\"color:#24292E\">(() </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> emit</span><span style=\"color:#24292E\">(pool.</span><span style=\"color:#6F42C1\">hosts</span><span style=\"color:#24292E\">())), pool.</span><span style=\"color:#6F42C1\">hosts</span><span style=\"color:#24292E\">()),</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  attach</span><span style=\"color:#24292E\">: (</span><span style=\"color:#E36209\">enc</span><span style=\"color:#24292E\">, </span><span style=\"color:#E36209\">set</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> pool.</span><span style=\"color:#6F42C1\">getSession</span><span style=\"color:#24292E\">(enc)</span><span style=\"color:#D73A49\">!</span><span style=\"color:#24292E\">.</span><span style=\"color:#6F42C1\">onState</span><span style=\"color:#24292E\">(set),  </span><span style=\"color:#6A737D\">// snapshot-then-delta seeds sync</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  onEvict</span><span style=\"color:#24292E\">: (</span><span style=\"color:#E36209\">enc</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> links.</span><span style=\"color:#6F42C1\">delete</span><span style=\"color:#24292E\">(enc),                        </span><span style=\"color:#6A737D\">// linkFor memo eviction rides exit</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// ReadonlySignal&#x3C;ReadonlyMap&#x3C;string, SessionState>> — last-frame hold, membership diff,</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// per-key disposal, per-member error isolation (d3): ALL bridge-owned, once.</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> registry</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> derived.</span><span style=\"color:#6F42C1\">registry</span><span style=\"color:#24292E\">((</span><span style=\"color:#E36209\">$</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  mapValues</span><span style=\"color:#24292E\">(hosts.value, (</span><span style=\"color:#E36209\">enc</span><span style=\"color:#24292E\">, </span><span style=\"color:#E36209\">s</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> resolveEntry</span><span style=\"color:#24292E\">(</span><span style=\"color:#6F42C1\">decode</span><span style=\"color:#24292E\">(enc), s, opts)));</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// resolveEntry = projectState (:52-77, verbatim, undefined→connecting arm intact)</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//              + causeFor + offsetOf + the #1716 belt, composed pure</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"~60 lines of kolu plumbing and the ~90-line drishti clone die; the pure projections survive untouched. The target stays the pull-shaped ",
			createVNode(_components.code, { children: "MapRegistry" }),
			" face its one live consumer eats."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warning",
			title: "The bug SR9 exists to make unspellable — one connection fact, two authorities (srid/drishti#102)",
			children: [
				createVNode(_components.p, { children: [
					"A live drishti regression (",
					createVNode(_components.a, {
						href: "https://github.com/srid/drishti/issues/102",
						children: "srid/drishti#102"
					}),
					") is the concrete cost of not having this primitive yet. One host’s connection status is served ",
					createVNode(_components.strong, { children: "twice, independently" }),
					", from one ",
					createVNode(_components.code, { children: "session.onState" }),
					": the ",
					createVNode(_components.strong, { children: "dot" }),
					" reads ",
					createVNode(_components.code, { children: "serveHostMap" }),
					"’s ",
					createVNode(_components.code, { children: "EntryStatus" }),
					" projection (this section’s ",
					createVNode(_components.code, { children: "projectState" }),
					"); the ",
					createVNode(_components.strong, { children: "word" }),
					" reads the ",
					createVNode(_components.em, { children: "separate" }),
					" per-host ",
					createVNode(_components.code, { children: "connection" }),
					" cell (",
					createVNode(_components.code, { children: "connectionPipe::projectConnection" }),
					"). Two wire channels, two client subscriptions, nothing binding them to agree — so the dot reaches ",
					createVNode(_components.code, { children: "connected" }),
					" (metrics stream live) while the word latches on ",
					createVNode(_components.code, { children: "connecting" }),
					" ",
					createVNode(_components.strong, { children: "forever" }),
					". It entered drishti at ",
					createVNode(_components.a, {
						href: "https://github.com/srid/drishti/pull/92",
						children: "srid/drishti#92"
					}),
					" adopting kolu W6’s honest connect (",
					createVNode($$PrLink, { pr: 1730 }),
					"), whose own architecture review predicted exactly this “two authorities disagree permanently” divergence."
				] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Scope honesty:" }),
					" SR9 as written unifies only the ",
					createVNode(_components.strong, { children: "dot" }),
					" — ",
					createVNode(_components.code, { children: "EntryStatus" }),
					" moves onto the single ",
					createVNode(_components.code, { children: "reactiveFamily<SessionState>" }),
					" source. The ",
					createVNode(_components.strong, { children: "word" }),
					" rides a different surface (the per-host ",
					createVNode(_components.code, { children: "connection" }),
					" cell), so SR9 alone does not collapse the split; the cure is SR9 ",
					createVNode(_components.strong, { children: "extended" }),
					" so both views derive from the one family source (or drishti derives the word client-side ",
					createVNode(_components.em, { children: "from" }),
					" the entry, never a second subscription). One fact, one authority, derived views — the positive form of the P3/P4 violation this campaign exists to make unwritable."
				] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Why no test caught it:" }),
					" each projection is asserted alone — ",
					createVNode(_components.code, { children: "serveHostMap.test.ts" }),
					" pins ",
					createVNode(_components.code, { children: "EntryStatus" }),
					", ",
					createVNode(_components.code, { children: "connection.test.ts" }),
					" pins ",
					createVNode(_components.code, { children: "projectConnection" }),
					" — and no test asserts the joint invariant. The missing law, to bank with SR9: ",
					createVNode(_components.em, { children: [
						"for any ",
						createVNode(_components.code, { children: "SessionState" }),
						", ",
						createVNode(_components.code, { children: "EntryStatus === connected" }),
						" ⟺ ",
						createVNode(_components.code, { children: "connection.phase === connected" })
					] }),
					", plus a drishti steady-state e2e that a connected host’s dot and word agree in one settled frame."
				] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Resolved" }),
					" — SR9 shipped it (",
					createVNode($$PrLink, { pr: 1836 }),
					" + ",
					createVNode(_components.a, {
						href: "https://github.com/srid/drishti/pull/105",
						children: "srid/drishti#105"
					}),
					"): the second projection/subscription and ",
					createVNode(_components.code, { children: "connectionPipe.ts" }),
					" are deleted, the joint invariant is enforced pre-publication and pinned (contract test + drishti’s joint-render pin), and srid live-confirmed the fix before merge. The disagreement no longer has an encoding."
				] })
			]
		}),
		"\n",
		createVNode(_components.h3, {
			id: "5-cross-member-derivation--free",
			children: "5. Cross-member derivation — free"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The deferred ",
			createVNode(_components.code, { children: "combineCells" }),
			" combinator, as three lines of the same primitive:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6F42C1\">cells</span><span style=\"color:#24292E\">: {</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  overview</span><span style=\"color:#24292E\">: derived.</span><span style=\"color:#6F42C1\">cell</span><span style=\"color:#24292E\">((</span><span style=\"color:#E36209\">$</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> ({</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">    terminals: $.</span><span style=\"color:#6F42C1\">terminals</span><span style=\"color:#24292E\">().size,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">    awaiting:  $.</span><span style=\"color:#6F42C1\">urgency</span><span style=\"color:#24292E\">().awaitingIds.</span><span style=\"color:#005CC5\">length</span><span style=\"color:#24292E\">,   </span><span style=\"color:#6A737D\">// reads the DERIVED sibling</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">    memoryMb:  </span><span style=\"color:#6F42C1\">toMb</span><span style=\"color:#24292E\">($.</span><span style=\"color:#6F42C1\">processMemory</span><span style=\"color:#24292E\">().padi),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  })),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">},</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"A real diamond — terminals → urgency → overview and terminals → overview — resolved glitch-free: one batch frame yields one overview recompute seeing new terminals ",
			createVNode(_components.em, { children: "and" }),
			" new urgency together; a half-updated pair never crosses the wire. The same fold across the wire is the same shape client-side (",
			createVNode(_components.code, { children: "createMemo" }),
			"), with the honest difference stated: no transactional frame exists across two wire channels — same-process is glitch-free, cross-wire is eventually consistent."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-laws-and-how-each-is-enforced",
			children: "The laws, and how each is enforced"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "law" }),
					"\n",
					createVNode(_components.th, { children: "engine posture" }),
					"\n",
					createVNode(_components.th, { children: "the bridge’s enforcement" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "glitch-freedom" }),
					"\n",
					createVNode(_components.td, { children: "HOLDS (version-checked lazy pull)" }),
					"\n",
					createVNode(_components.td, { children: "in-process: “derived reads derived as computed, never as mirror” — chains are pure computed graphs, wire effects are leaves. Across the wire: per member only; no cross-channel frame — stated as law, not patched." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "transactional frames" }),
					"\n",
					createVNode(_components.td, { children: "HOLDS-WITH-DISCIPLINE (batch is opt-in)" }),
					"\n",
					createVNode(_components.td, { children: [
						"“the bridge owns the batch”: apps never hold a raw setter; every graph entry point (emit, poll tick, mirror pokes, family frames) wraps ",
						createVNode(_components.code, { children: "batch()" }),
						" itself; ",
						createVNode(_components.code, { children: "batch()" }),
						" is the one exported knob for multi-member bursts."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "change-iff-fired" }),
					"\n",
					createVNode(_components.td, { children: [
						"HOLDS-WITH-DISCIPLINE (",
						createVNode(_components.code, { children: "!==" }),
						" only)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"“equals lives at the member, once”: mirrors poked post-spec-equals, so graph edges inherit each member’s declared equality; suppressed writes never poke; ",
						createVNode(_components.code, { children: "applyAndPublish" }),
						"’s gate stays the final wire dedup. The ",
						createVNode(_components.code, { children: "force" }),
						" re-serve write stays wire-only — a rebound-but-equal value implies equal derived state."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "hold’s old-value law" }),
					"\n",
					createVNode(_components.td, { children: "MISSING" }),
					"\n",
					createVNode(_components.td, { children: [
						"“prev is scan’s, not the graph’s”: the only sanctioned previous value is ",
						createVNode(_components.code, { children: "scan" }),
						"’s carried state. No app effects exist, so nobody observes mid-propagation old values."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "mirrors-never-fabricate" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: [
						"seeds are truth by construction: authored mirrors seed from ",
						createVNode(_components.code, { children: "store.get()" }),
						"/",
						createVNode(_components.code, { children: "readAll()" }),
						" at walk; derived cells seed by eagerly pulling their computed (throw = boot crash); poll seeds are a genuine T+0 read, first failure propagates; scan seeds ",
						createVNode(_components.code, { children: "initial(stored?)" }),
						". Forwarded cells poke only on confirmed upstream frames."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "one-writer" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: [
						"structural, not checked: a derived member gets no ctx entry (the in-process second writer is unrepresentable) and the boot pass crashes on declared write verbs — contract, handlers, and client binding literally have no ",
						createVNode(_components.code, { children: ".set" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "fail-fast" }),
					"\n",
					createVNode(_components.td, { children: "VIOLATED by the engine (batch flush surfaces only the first effect error)" }),
					"\n",
					createVNode(_components.td, { children: [
						"“no effect body escapes its wrapper”: raw ",
						createVNode(_components.code, { children: "effect" }),
						" unexported + lint-banned; every bridge effect catches at its own boundary. One doctrine, one home: sync-at-wiring throw = boot crash; stateless compute throw = log-skip-continue holding last published; stateful step throw = log-STOP (dispose) holding last published. Mandatory: synchronous propagation runs derivations inside the writer’s stack — the wrapper keeps a fold from crashing ",
						createVNode(_components.code, { children: "commitSnapshot" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "durability / reconnect" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "derived cells always recompute at boot (bridge-internal store, never served stale from disk); every accepted engine output lands in the member store, so snapshot-then-delta replay works with zero engine involvement." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "stopped-derivation visibility" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: [
						"the stateful stop path flips a bridge-owned stopped-latch into the surface’s liveness gate (",
						createVNode(_components.code, { children: "define.ts:143" }),
						") — one line of policy in one home, so frozen-derived is distinguishable from legitimately quiet."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "ownership / teardown" }),
					"\n",
					createVNode(_components.td, { children: "flat + manual in the engine" }),
					"\n",
					createVNode(_components.td, { children: [
						"“the walk owns every disposer”: walkSurface collects every effect disposer and source uninstall; close/abort disposes all; ",
						createVNode(_components.code, { children: "reactiveFamily" }),
						" owns per-key disposal. Apps never create effects, so the nested-effect leak class is unrepresentable."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "cycles" }),
					"\n",
					createVNode(_components.td, { children: "runtime-detected on tracked edges" }),
					"\n",
					createVNode(_components.td, { children: "computed self-read throws; effect-write loops throw at the batch iteration cap; eager seed-pull at walk makes first evaluation = boot for the whole derived graph. Caveats carried: a conditionally-read branch can hide a cycle past boot; untracked loops through external emitters stay equals-terminated, livelock-is-a-bug." }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-fate-of-the-seven-names",
			children: "The fate of the seven names"
		}),
		"\n",
		createVNode(_components.p, { children: "A name survives only where its promise cannot be expressed by composition:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "deriveCell" }),
				" → survives as ",
				createVNode(_components.code, { children: "derived.cell(compute)" })
			] }), " — the sanctioned graph exit; pins stateless, skip-continue, wire-read-only, recompute-at-boot."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "scanCell" }),
					" → survives as the free-standing ",
					createVNode(_components.code, { children: "scan(source, initial, step)" }),
					","
				] }),
				" published via ",
				createVNode(_components.code, { children: "derived.cell(scan(...))" }),
				" — pins the stop-hold doctrine and the durability question at the declaration site; the only home of prev-value access."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "foldCollection" }), " → dissolves."] }),
				" ",
				createVNode(_components.code, { children: "derived.cell(($) => fold($.terminals()))" }),
				" is the whole feature; its private second coalescer never gets built."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "scanStream" }), " → survives, outside the graph."] }),
				" Signals conflate frames; a stream must see every one. Keeps snapshot-then-delta + ",
				createVNode(_components.code, { children: "scanMsgSchema" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "pollCollection" }), " → survives as composition:"] }),
				" ",
				createVNode(_components.code, { children: "derived.collection(source({read, install}))" }),
				" — the collection wire form pins “membership changes become wire frames” (keysBus + deltas), which a bare computed does not promise; no fused name."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "registryFromFamily" }), " → transformed, split along the source/exit axis:"] }),
				" ",
				createVNode(_components.code, { children: "reactiveFamily" }),
				" (graph source) + ",
				createVNode(_components.code, { children: "derived.registry" }),
				" (pull-face exit); the family can also feed a ",
				createVNode(_components.code, { children: "derived.collection" }),
				" if that face ever earns a consumer."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "combineCells" }), " → dissolves entirely"] }),
				" — multiple ",
				createVNode(_components.code, { children: "$" }),
				" reads; likewise the whole queued tail (deriveCollection, scanCollection, mergeSources, filters/gates) dissolves into ",
				createVNode(_components.code, { children: "computed" }),
				" composition, including private intermediate nodes the combinator taxonomy structurally could not express."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The adapters collapse to ",
				createVNode(_components.strong, { children: ["one ", createVNode(_components.code, { children: "source(...)" })] }),
				" with two argument shapes (push install; poll ",
				createVNode(_components.code, { children: "{read, install}" }),
				"), promises intact (T+0 seed, first-read-propagates, no private dedup). The keyed reconciler becomes ",
				createVNode(_components.em, { children: "the collection wire adapter" }),
				" (diff by ",
				createVNode(_components.code, { children: "CollectionSpec.equals" }),
				" → wrapped publishers) — wire semantics, living in the adapter. Event names (",
				createVNode(_components.code, { children: "gateEvent" }),
				", ",
				createVNode(_components.code, { children: "deriveEvent" }),
				"+SKIP) are ",
				createVNode(_components.strong, { children: "not minted" }),
				" — no consumer exists; ",
				createVNode(_components.code, { children: "derived.event" }),
				" gets minted if one materializes."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Net public vocabulary: ",
			createVNode(_components.strong, { children: "seven orthogonal symbols" }),
			" — ",
			createVNode(_components.code, { children: "source" }),
			" · ",
			createVNode(_components.code, { children: "scan" }),
			" · ",
			createVNode(_components.code, { children: "computed" }),
			" (graph), ",
			createVNode(_components.code, { children: "derived.cell" }),
			" · ",
			createVNode(_components.code, { children: "derived.collection" }),
			" (wire), ",
			createVNode(_components.code, { children: "$" }),
			" · ",
			createVNode(_components.code, { children: "batch" }),
			" (glue) — plus SR9/SR10’s keyed machinery (",
			createVNode(_components.code, { children: "reactiveFamily" }),
			", ",
			createVNode(_components.code, { children: "signalMap" }),
			"); versus the algebra’s 7–8 names with 6 queued."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "sr7sr10--migration-phase-0-shipped-as-the-w5-slice",
			children: "SR7–SR10 — migration (phase 0 shipped as the W5 slice)"
		}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Sequencing superseded (2026-07-13): the phase labels below are no longer the campaign’s numbering — phases 1–4 land as SR7–SR10 of ",
			createVNode(_components.a, {
				href: "surface-runtime-boundary.html",
				children: "the merged plan of record"
			}),
			", which carries the one sequenced PR list (kernel first). This section survives as the technical content of those PRs; the plan note says the same on its side."
		] }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["Phase 0 — shipped as ", createVNode(_components.a, {
					href: "padi.html#w5",
					children: "W5’s framework slice"
				})] }),
				" (",
				createVNode($$PrLink, { pr: 1759 }),
				", merged 2026-07-11). ",
				createVNode(_components.code, { children: "reactor.ts" }),
				" exporting ",
				createVNode(_components.code, { children: "derived.cell" }),
				" + ",
				createVNode(_components.code, { children: "scan" }),
				" + ",
				createVNode(_components.code, { children: "source" }),
				" with the error wrapper and the stopped-latch→health flip; boot narrowing (derived member: no ctx entry, no write verbs); the engine’s deep import lint-banned. Zero runtime surgery — derived cells ride the existing cell connect seam (",
				createVNode(_components.code, { children: "server.ts:1120" }),
				", ",
				createVNode(_components.code, { children: ":1490-1494" }),
				"). First consumer: drishti alerts (worked example 2), the paired drishti PR per ",
				createVNode(_components.code, { children: ".claude/rules/surface.md" }),
				" (",
				createVNode(_components.a, {
					href: "https://github.com/srid/drishti/pull/93",
					children: "srid/drishti#93"
				}),
				", merged 2026-07-11 — the ",
				createVNode(_components.code, { children: "alerts" }),
				" cell ships)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Phase 1 — the ",
					createVNode(_components.code, { children: "$" }),
					" read face + first sibling derivation."
				] }),
				" Each authored member’s graph face is a mirror the bridge pokes post-spec-equals: a cell’s mirror rides a ",
				createVNode(_components.strong, { children: "bridge-owned store wrapper both cell write paths pass through" }),
				" (",
				createVNode(_components.code, { children: "applyAndPublish" }),
				" and the ctx ",
				createVNode(_components.code, { children: "set" }),
				" both land through the one wrapped ",
				createVNode(_components.code, { children: "store.set" }),
				", after the equals gate — so a missed poke is unwritable by construction, never a two-site rider held by pinning tests, per ",
				createVNode(_components.a, {
					href: "#the-open-questions",
					children: "open question 2"
				}),
				"); a collection’s mirror is a version poke on the wrapped collection publishers. Plus ",
				createVNode(_components.code, { children: "batch" }),
				"; export ",
				createVNode(_components.code, { children: "computed" }),
				". Consumer: padi urgency (worked example 1) — deletes ",
				createVNode(_components.code, { children: "publishUrgency" }),
				", both riders, and the prose invariant."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Phase 2 — ",
					createVNode(_components.code, { children: "derived.collection" }),
					" + the collection connect seam,"
				] }),
				" the keyed-reconciler diff, and ",
				createVNode(_components.code, { children: "source" }),
				"’s poll argument shape. Consumers: padi memorySampler + hostInventory; drishti’s three keyed poll-reconciles (",
				createVNode(_components.code, { children: "main.ts:262-330" }),
				") — the most-repeated hand-roll in both trees dies here. The third sampler (kolu-server processMemory) is parked as ",
				createVNode(_components.a, {
					href: "surface-runtime-boundary.html#sr8a",
					children: "SR8.a"
				}),
				": kolu’s surface is served eagerly at module load while the sampler’s read + ",
				createVNode(_components.code, { children: "onState" }),
				" resample need the later-created ",
				createVNode(_components.code, { children: "padiSession" }),
				", and the late-bind seam that would force it in-scope is an override-knob — its conversion lands with the eager-serve ordering fix."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				"Phase 3 — ",
				createVNode(_components.code, { children: "reactiveFamily" }),
				" + ",
				createVNode(_components.code, { children: "derived.registry" }),
				"."
			] }), " The serveHostMap reshape (worked example 4); drishti deletes its clone."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"SR10 — the padi registry as ",
					createVNode(_components.code, { children: "signalMap" }),
					" (open question 9)."
				] }),
				" With it, all five ",
				createVNode(_components.code, { children: "metadata.ts" }),
				" publish seams collapse into ",
				createVNode(_components.code, { children: "terminals: derived.collection(...)" }),
				" and convention-published members end in padi; without it, only downstream derivations ride the graph. Padi’s call, taken with SR7–SR9 as evidence — its own adjudicated step."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The campaign-1 hand-roll deletions land across these phases (urgency riders P1; samplers ×2 and drishti reconciles ×3 P2, the third sampler parked as ",
			createVNode(_components.a, {
				href: "surface-runtime-boundary.html#sr8a",
				children: "SR8.a"
			}),
			"; serveHostMap plumbing + clone P3; metadata seams ×5 P4); the algebra’s would-have-been machinery — the second coalescer, the hand boot cycle walk, the cadence helper, ",
			createVNode(_components.code, { children: "combineCells" }),
			" — costs zero by never existing. During migration the two idioms coexist safely (hand publishes and derived members write through the same seams); each phase converts whole members, never half of one."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-honest-costs",
			children: "The honest costs"
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: ["A new load-bearing dependency in ", createVNode(_components.code, { children: "@kolu/surface" })] }), ", inherited by every consumer — version pinning, upstream semantics changes, and a supply-chain surface in daemons that must never silently degrade."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Two engines to reason about, permanently" }), " — Solid client-side, the producer engine server-side: two batching models, two equality defaults, two debugging vocabularies. Hidden from app code, not from whoever debugs “why did this republish”."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Batch-vs-tick: two frame boundaries that do not coincide." }), " One glitch-free engine frame touching N members becomes N independent wire frames — a client can see member A new and member B old. Stated, not papered; the seamless story breaks exactly here."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The error wrapper is load-bearing safety." }),
				" Synchronous propagation runs derivations inside the writer’s stack; an unwrapped effect could crash ",
				createVNode(_components.code, { children: "commitSnapshot" }),
				", and the engine’s batch flush swallows all-but-first sibling errors if anything ever escapes."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Implicit edges regress auditability." }),
				" Auto-tracking discovers the graph by running, not from a spec; ",
				createVNode(_components.code, { children: "$." }),
				" is greppable and scoped to ",
				createVNode(_components.code, { children: "derived.*" }),
				" compute bodies, but “what recomputes when this writes” now means reading them."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The substrate is partial forever:" }), " engine for state-shaped members, pumps for logs — two idioms in one package, honestly counted."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Wasted recomputes on wire-equal values:" }), " no per-node custom equality in the engine, so a fresh-but-spec-equal output recomputes in-graph descendants before the wire gate stops the frame. Accepted under one-dedup-point; measure before caring."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The mirror pokes instrument the write path itself" }),
				" — and a missed poke = silently stale derivations, the repo’s most-hated defect class. ",
				createVNode(_components.strong, { children: "Decided (open question 2): the structural fix" }),
				" — the mirror rides a bridge-owned store wrapper both write paths must pass through, so a missed poke is unwritable by construction rather than a two-site rider held by pinning tests."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "hold’s old-value law stays missing" }), " outside scan’s carried state; any future “value before this frame” need gets designed then."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Dual idioms persist until phase 4 completes" }), " — and phase 4 is a genuinely open product decision; if padi declines it, convention-published members persist alongside derived ones indefinitely."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-open-questions",
			children: "The open questions"
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The engine — decided." }),
				" ",
				createVNode(_components.code, { children: "@preact/signals-core" }),
				" now; ",
				createVNode(_components.code, { children: "@solidjs/signals" }),
				" the named swap target once Solid 2.0 and its ecosystem stabilize — the probed comparison, the eliminations, and the two-way-door demonstration live in ",
				createVNode(_components.a, {
					href: "surface-reactor-engine.html",
					children: "the engine note"
				}),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The mirror-poke seam — decided, the structural fix." }), " The mirror rides a bridge-owned store wrapper both write paths must pass through, so a missed poke is unwritable by construction — make-illegal-states-unrepresentable beats a convention held by pinning tests."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The fused constructors — decided, minimal vocabulary." }),
				" The ",
				createVNode(_components.code, { children: ".fromPoll" }),
				" forms and the two source names die; poll input is ",
				createVNode(_components.code, { children: "source({read, install})" }),
				" composed with ",
				createVNode(_components.code, { children: "derived.cell" }),
				"/",
				createVNode(_components.code, { children: "derived.collection" }),
				" — seven orthogonal symbols, nothing fused."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A permanently-broken derivation looks healthy." }),
				" A derived value recomputes whenever its inputs change. If one recompute throws, we log it and keep showing the last good value — the next successful recompute heals it. But if the compute starts failing ",
				createVNode(_components.em, { children: "every" }),
				" time (say the code hits a case it can’t handle), the member keeps showing an ever-older value while its health still reads healthy — a green light on stale data. The question: after N failures in a row, should the member’s health flip to unhealthy so dashboards and humans can see it’s wedged? Cost: one counter. Alternative: accept that a permanently-broken derivation looks fine while lying."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Two named ergonomics patches:" }),
				" the live-map identity question (what ",
				createVNode(_components.code, { children: "$.someCollection()" }),
				" returns across frames) and the missing server-side effect story (an app that wants to ",
				createVNode(_components.em, { children: "react" }),
				" without minting a member) — each a bounded patch to design, not a rethink."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "scan durability migration:" }),
				" ",
				createVNode(_components.code, { children: "initial(stored)" }),
				" is caller-owned; a versioned-migration seam waits for a second durable consumer."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The composed resolve’s home" }), " (serveHostMap reshape): surface-remote shared with drishti, or drishti imports only the projection — the electricity ruling."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "activityFeed:" }),
				" fix the mutating read (",
				createVNode(_components.code, { children: "activity.ts:50-57" }),
				") now; ",
				createVNode(_components.code, { children: "trackRecent*" }),
				" migrates to a scan whenever next touched — churn timing only."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "SR10:" }),
				" does padi’s terminal-registry become a ",
				createVNode(_components.code, { children: "signalMap" }),
				"? ",
				createVNode(_components.strong, { children: "Adjudicated — DECLINED, 2026-07-15" }),
				" (the ",
				createVNode(_components.a, {
					href: "surface-runtime-boundary.html",
					children: "plan note’s SR10 row"
				}),
				" carries the full reasoning + revive conditions). The convention-publish seams persist as the accepted debt; honest cost #10’s “dual idioms persist indefinitely” is now the recorded state, not a risk."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Cross-surface zip stays client-side as law" }),
				" (no transactional frame across channels). Concretely: you want a badge that says “zest’s CPU is higher than the local host’s, ",
				createVNode(_components.em, { children: "right now" }),
				".” The two facts live in two different hosts’ surfaces and arrive over two connections with different delays — there is no “right now” the wire can promise: by the time both values are in one place, either may be stale relative to the other. The law says: pair them in the browser (Solid), where they at least share one render moment, and label the result as approximate — or, when both facts live in ONE server process, derive the pair ",
				createVNode(_components.em, { children: "there" }),
				" as a single member (one process = one frame, honestly simultaneous). Reconfirm that law, or leave the door open for the framework to ship an explicit “eventually-consistent pair” member type if a real feature ever needs it?"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "appendix--the-reflexsurface-mapping-exhaustively",
			children: "Appendix — the reflex→surface mapping, exhaustively"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The primitive correspondences the bridge stands on — every reflex combinator family, its verdict, and its surface analog. The verdicts read in the vocabulary of the study that fed the bridge; “the fate of the seven names” above maps them (",
			createVNode(_components.code, { children: "deriveCell" }),
			" → ",
			createVNode(_components.code, { children: "derived.cell" }),
			"; ",
			createVNode(_components.code, { children: "scanCell" }),
			" → ",
			createVNode(_components.code, { children: "scan" }),
			" published via ",
			createVNode(_components.code, { children: "derived.cell" }),
			"; ",
			createVNode(_components.code, { children: "foldCollection" }),
			"/",
			createVNode(_components.code, { children: "combineCells" }),
			" → ",
			createVNode(_components.code, { children: "computed" }),
			" composition; ",
			createVNode(_components.code, { children: "pollCollection" }),
			" → ",
			createVNode(_components.code, { children: "derived.collection(source(...))" }),
			"; ",
			createVNode(_components.code, { children: "registryFromFamily" }),
			" → ",
			createVNode(_components.code, { children: "reactiveFamily" }),
			" + ",
			createVNode(_components.code, { children: "derived.registry" }),
			"; ",
			createVNode(_components.code, { children: "scanStream" }),
			" survives off-graph). Legend: ",
			createVNode(_components.strong, { children: "EXISTS" }),
			" (file:line, verified in-tree) · ",
			createVNode(_components.strong, { children: "ADD-SHIP" }),
			" (demand named) · ",
			createVNode(_components.strong, { children: "ADD-DEFER" }),
			" (trigger named) · ",
			createVNode(_components.strong, { children: "N/A" }),
			" (argued). File cites are kolu ",
			createVNode(_components.code, { children: "packages/surface/src/…" }),
			" unless another package is named."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "reflex combinator / family" }),
					"\n",
					createVNode(_components.th, { children: "verdict" }),
					"\n",
					createVNode(_components.th, { children: "surface analog" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "§0 primitives" }) }),
					"\n",
					createVNode(_components.td, {}),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "Behavior" }) }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						"stream member (",
						createVNode(_components.code, { children: "define.ts:152-155" }),
						"): derived, read-only, sampled at will. Server-side, any sibling cell’s current value is also a Behavior: ",
						createVNode(_components.code, { children: "deps.store.get()" }),
						" read synchronously (",
						createVNode(_components.code, { children: "server.ts:198-207" }),
						")."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "Event" }) }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						"event member (",
						createVNode(_components.code, { children: "define.ts:157-160" }),
						"): occurrence, no snapshot obligation (",
						createVNode(_components.code, { children: "project.ts:172-179" }),
						")."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "Dynamic" }) }),
					"\n",
					createVNode(_components.td, { children: "EXISTS + phase 1" }),
					"\n",
					createVNode(_components.td, { children: [
						"cell (",
						createVNode(_components.code, { children: "define.ts:89-144" }),
						") is the value half; the change half is phase 1’s ",
						createVNode(_components.code, { children: "updated()" }),
						" on the client Subscription, change-iff-fired enforced at the producer by spec ",
						createVNode(_components.code, { children: "equals" }),
						" (",
						createVNode(_components.code, { children: "server.ts:198-207" }),
						")."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "Incremental" }) }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						"collection with the opt-in ",
						createVNode(_components.code, { children: "deltas" }),
						" verb (",
						createVNode(_components.code, { children: "define.ts:64-87" }),
						"): snapshot = PatchTarget, coalesced ",
						createVNode(_components.code, { children: "upserts" }),
						"/",
						createVNode(_components.code, { children: "removes" }),
						" = the patch; one wire authority ",
						createVNode(_components.code, { children: "collectionDeltasSchema" }),
						" (",
						createVNode(_components.code, { children: "define.ts:274-287" }),
						")."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "currentIncremental" }) }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						"the collection’s snapshot half: server ",
						createVNode(_components.code, { children: "readAll()" }),
						" / client per-key ",
						createVNode(_components.code, { children: "get" }),
						" + ",
						createVNode(_components.code, { children: "keys" }),
						" — the current PatchTarget without the patch stream."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "updatedIncremental" }) }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						"the ",
						createVNode(_components.code, { children: "deltas" }),
						" verb’s delta frames alone — the patch stream without the snapshot (a client that skips frame 1)."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "incrementalToDynamic" }) }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						"snapshot + client-side fold of deltas into a whole-map view — what the ",
						createVNode(_components.code, { children: "deltas" }),
						" verb’s client consumer does (surface-map’s folded entry collection decodes the same one authority)."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "PushM" }),
						" / ",
						createVNode(_components.code, { children: "PullM" })
					] }),
					"\n",
					createVNode(_components.td, { children: "N/A" }),
					"\n",
					createVNode(_components.td, { children: "the server process is the monad — handlers are arbitrary TS reading stores synchronously." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "never" }) }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: "an event member nobody publishes." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "constant" }) }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						"a cell default with no writer; ",
						createVNode(_components.code, { children: "inMemoryCell(initial)" }),
						" (",
						createVNode(_components.code, { children: "project.ts:242" }),
						")."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "push" }),
						" / ",
						createVNode(_components.code, { children: "pushAlways" }),
						" / ",
						createVNode(_components.code, { children: "pushCheap" })
					] }),
					"\n",
					createVNode(_components.td, { children: "EXISTS / ADD-DEFER" }),
					"\n",
					createVNode(_components.td, { children: [
						"always-firing map = ",
						createVNode(_components.code, { children: "deriveEvent" }),
						" (",
						createVNode(_components.code, { children: "project.ts:180-187" }),
						"); the Maybe-filtering half is a deferred ",
						createVNode(_components.code, { children: "SKIP" }),
						" return. Cheap variants N/A (graph-caching contract; a surface bus is already multicast)."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "pull" }) }),
					"\n",
					createVNode(_components.td, { children: "free under the bridge / EXISTS client" }),
					"\n",
					createVNode(_components.td, { children: [
						"server-side multi-cell recompute is a ",
						createVNode(_components.code, { children: "computed" }),
						" over ",
						createVNode(_components.code, { children: "$" }),
						" reads; client-side, a Solid memo over ",
						createVNode(_components.code, { children: "useCell" }),
						" subscriptions already is ",
						createVNode(_components.code, { children: "pull" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "switch" }),
						", ",
						createVNode(_components.code, { children: "coincidence" })
					] }),
					"\n",
					createVNode(_components.td, { children: "N/A" }),
					"\n",
					createVNode(_components.td, { children: [
						"a switching occurrence must carry an Event ",
						createVNode(_components.em, { children: "as its value" }),
						"; a wire frame is Zod-schema’d data (",
						createVNode(_components.code, { children: "define.ts:245-265" }),
						"). The index travels as data and the client re-subscribes — ",
						createVNode(_components.code, { children: "scopedByEntry" }),
						" (",
						createVNode(_components.code, { children: "scoped.ts:81-210" }),
						") is the switching machinery."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "current" }),
						" / ",
						createVNode(_components.code, { children: "updated" })
					] }),
					"\n",
					createVNode(_components.td, { children: "EXISTS / phase 1" }),
					"\n",
					createVNode(_components.td, { children: [
						"the client accessor half exists today; ",
						createVNode(_components.code, { children: "updated()" }),
						" change pairs are phase 1."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "unsafeBuildDynamic" }),
						" / ",
						createVNode(_components.code, { children: "unsafeBuildIncremental" })
					] }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						"the raw ",
						createVNode(_components.code, { children: "source" }),
						" escape hatch (StreamImplDeps raw branch, ",
						createVNode(_components.code, { children: "server.ts:1171-1199" }),
						"): the author vouches for snapshot-then-delta — reflex’s “caller owns the law” posture."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "mergeIncrementalG" }),
						" / ",
						createVNode(_components.code, { children: "…WithMoveG" })
					] }),
					"\n",
					createVNode(_components.td, { children: "ADD-DEFER" }),
					"\n",
					createVNode(_components.td, { children: [
						"keyed sources joining/leaving under a membership reconcile, as a collection member — under the bridge, ",
						createVNode(_components.code, { children: "reactiveFamily" }),
						" feeding a ",
						createVNode(_components.code, { children: "derived.collection" }),
						" if that face ever earns a consumer."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.em, { children: [
							"(no reflex analog — a ",
							createVNode(_components.strong, { children: "resource" }),
							" merge, not an event merge)"
						] }),
						" ",
						createVNode(_components.code, { children: "mergeInstalls" })
					] }),
					"\n",
					createVNode(_components.td, { children: "ADD-DEFER" }),
					"\n",
					createVNode(_components.td, { children: [
						"N-ary tick-install composition (",
						createVNode(_components.code, { children: "everyMsOr" }),
						" generalized). Trigger: a third tick source, or a non-interval pair. Ships with the bracket-informed error policy (acquisition error wins; cleanup errors attach as context, never mask; LIFO release) and ",
						createVNode(_components.strong, { children: ["deletes ", createVNode(_components.code, { children: "everyMsOr" })] }),
						" per the fate-of-names rule (it becomes ",
						createVNode(_components.code, { children: "mergeInstalls(everyMs(ms), subscribe)" }),
						" — a composition). Until then the install contract ",
						createVNode(_components.code, { children: "(tick) => cleanup" }),
						" is the general primitive and the fused name is the one composition with receipts (two consumers, exception-safety gauntlet-proven, SR8.c)."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "behaviorCoercion" }), " etc."] }),
					"\n",
					createVNode(_components.td, { children: "N/A" }),
					"\n",
					createVNode(_components.td, { children: "TS structural typing makes coercions free." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "sample" }), " (MonadSample)"] }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						"synchronous ",
						createVNode(_components.code, { children: "store.get()" }),
						" / ctx ",
						createVNode(_components.code, { children: "cells.<k>.get()" }),
						" (",
						createVNode(_components.code, { children: "server.ts:1469-1474" }),
						"); app-level use: ",
						createVNode(_components.code, { children: "activity.ts:73-101" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "hold" }),
						" / ",
						createVNode(_components.code, { children: "holdDyn" })
					] }),
					"\n",
					createVNode(_components.td, { children: "ADD-SHIP" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "source" }),
						" (push shape) + ",
						createVNode(_components.code, { children: "derived.cell" }),
						": hold a push source’s last frame in a cell."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "holdIncremental" }) }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						"the collection store + wrapped upsert/remove publish path (",
						createVNode(_components.code, { children: "server.ts:1585-1600" }),
						")."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.em, { children: "poll → keyed snapshot reconcile" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "ADD-SHIP" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "derived.collection(source({read, install}))" }), " — no single reflex name. The most-repeated hand-roll in both trees."] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "buildDynamic" }) }),
					"\n",
					createVNode(_components.td, { children: "EXISTS-in-ADD" }),
					"\n",
					createVNode(_components.td, { children: "derived cells seed from computed truth at wiring (eager pull at walk), never a fabricated default." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "headE" }),
						" / ",
						createVNode(_components.code, { children: "now" }),
						" / ",
						createVNode(_components.code, { children: "slowHeadE" })
					] }),
					"\n",
					createVNode(_components.td, { children: "N/A" }),
					"\n",
					createVNode(_components.td, { children: [
						"no wire demand; a raw ",
						createVNode(_components.code, { children: "source" }),
						" generator expresses one-shot/first-occurrence trivially."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "§1 pure map/filter" }) }),
					"\n",
					createVNode(_components.td, {}),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "fmap" }), " (Event/Dynamic/Behavior)"] }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "deriveEvent" }),
						" (",
						createVNode(_components.code, { children: "project.ts:180-187" }),
						"), ",
						createVNode(_components.code, { children: "deriveCell" }),
						" (",
						createVNode(_components.code, { children: "project.ts:236-280" }),
						", error policy per the statefulness line), ",
						createVNode(_components.code, { children: "deriveStream" }),
						" (",
						createVNode(_components.code, { children: "project.ts:163-170" }),
						")."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "fmapMaybe" }),
						" / ",
						createVNode(_components.code, { children: "ffilter" }),
						" / ",
						createVNode(_components.code, { children: "filterLeft" }),
						" / ",
						createVNode(_components.code, { children: "filterRight" })
					] }),
					"\n",
					createVNode(_components.td, { children: "ADD-DEFER" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "SKIP" }),
						"-returning map on events ONLY. Illegal on streams: dropping the first frame breaks snapshot-then-delta reconnect (",
						createVNode(_components.code, { children: "define.ts:58-63" }),
						"); a “filtered stream” is a scan holding the last passing value."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "ffor" }),
						"/",
						createVNode(_components.code, { children: "ffor2" }),
						"/",
						createVNode(_components.code, { children: "ffor3" })
					] }),
					"\n",
					createVNode(_components.td, { children: "N/A" }),
					"\n",
					createVNode(_components.td, { children: "argument-order sugar." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "splitE" }),
						" / ",
						createVNode(_components.code, { children: "Unzip" })
					] }),
					"\n",
					createVNode(_components.td, { children: "composition" }),
					"\n",
					createVNode(_components.td, { children: "two derived members off one upstream; the source bus multicasts." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Event ",
						createVNode(_components.code, { children: "Alt" }),
						"/",
						createVNode(_components.code, { children: "Apply" }),
						"/",
						createVNode(_components.code, { children: "Bind" }),
						"/",
						createVNode(_components.code, { children: "Semigroup" }),
						"/",
						createVNode(_components.code, { children: "Align" }),
						"/",
						createVNode(_components.code, { children: "Zip" })
					] }),
					"\n",
					createVNode(_components.td, { children: "N/A" }),
					"\n",
					createVNode(_components.td, { children: "defined by same-frame simultaneity; per-member wire channels share no frame." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"cheap variants (",
						createVNode(_components.code, { children: "fmapCheap" }),
						"…)"
					] }),
					"\n",
					createVNode(_components.td, { children: "N/A" }),
					"\n",
					createVNode(_components.td, { children: "Haskell pull-graph perf contract; no analog." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "traceEvent" }),
						" / ",
						createVNode(_components.code, { children: "traceDyn" })
					] }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						"the ",
						createVNode(_components.code, { children: "onWrite" }),
						" fire-and-forget seam on cells (",
						createVNode(_components.code, { children: "server.ts" }),
						" ~1110) or a logging map."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "§2 sampling (Behavior×Event)" }) }),
					"\n",
					createVNode(_components.td, {}),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "tag" }),
						"/",
						createVNode(_components.code, { children: "attach" }),
						"/",
						createVNode(_components.code, { children: "attachWith" }),
						"/",
						createVNode(_components.code, { children: "<@>" }),
						"/",
						createVNode(_components.code, { children: "<@" })
					] }),
					"\n",
					createVNode(_components.td, { children: "free server-side / N/A wire / EXISTS client" }),
					"\n",
					createVNode(_components.td, { children: [
						"same-process: a ",
						createVNode(_components.code, { children: "computed" }),
						" reads sibling stores at its tick. Cross-surface over the wire: N/A (no shared frame). Client-side pairing: the UI’s reactive batch."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "gate" }) }),
					"\n",
					createVNode(_components.td, { children: "ADD-DEFER" }),
					"\n",
					createVNode(_components.td, { children: "drop upstream frames while a sibling cell’s current value fails a predicate; same-process only." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "tagPromptlyDyn" }),
						" family vs ",
						createVNode(_components.code, { children: "tag (current d)" })
					] }),
					"\n",
					createVNode(_components.td, { children: "N/A distinction" }),
					"\n",
					createVNode(_components.td, { children: [
						"folds always see the post-write value (",
						createVNode(_components.code, { children: "store.set" }),
						" precedes ",
						createVNode(_components.code, { children: "bus.publish" }),
						", ",
						createVNode(_components.code, { children: "server.ts:198-207" }),
						") — uniformly “promptly”; per-member channels share no frame, so no same-frame old/new distinction exists to spell."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "§3 fan-in" }) }),
					"\n",
					createVNode(_components.td, {}),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "merge" }),
						"/",
						createVNode(_components.code, { children: "mergeWith" }),
						"/",
						createVNode(_components.code, { children: "leftmost" }),
						"/",
						createVNode(_components.code, { children: "mergeList" })
					] }),
					"\n",
					createVNode(_components.td, { children: "ADD-DEFER" }),
					"\n",
					createVNode(_components.td, { children: "interleave N upstreams into one event member. No cross-channel simultaneity ⇒ the three conflict policies are vacuously one shape." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "mergeMap" }),
						" / ",
						createVNode(_components.code, { children: "mergeInt" }),
						" / ",
						createVNode(_components.code, { children: "mergeIntIncremental" })
					] }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						"the deltas coalescer: N same-tick keyed mutations publish ONE ",
						createVNode(_components.code, { children: "upserts" }),
						"/",
						createVNode(_components.code, { children: "removes" }),
						" frame (",
						createVNode(_components.code, { children: "createTickCoalescer" }),
						", ",
						createVNode(_components.code, { children: "server.ts:281-312" }),
						"); tick = microtask."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "alignEventWithMaybe" }),
						" / ",
						createVNode(_components.code, { children: "difference" })
					] }),
					"\n",
					createVNode(_components.td, { children: "N/A" }),
					"\n",
					createVNode(_components.td, { children: "simultaneity-defined." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "mergeIncremental" }),
						" / ",
						createVNode(_components.code, { children: "mergeMapIncremental(WithMove)" })
					] }),
					"\n",
					createVNode(_components.td, { children: "ADD-DEFER" }),
					"\n",
					createVNode(_components.td, { children: "the collection-member face of the keyed-family core." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "unsafeMapIncremental" }) }),
					"\n",
					createVNode(_components.td, { children: "ADD-DEFER" }),
					"\n",
					createVNode(_components.td, { children: [
						"patch-preserving per-key map; hard dependency on ",
						createVNode(_components.code, { children: "CollectionSpec.equals" }),
						" for its reconnect diff."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "§4 fan-out" }) }),
					"\n",
					createVNode(_components.td, {}),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "fan" }),
						" / ",
						createVNode(_components.code, { children: "fanMap" }),
						" / ",
						createVNode(_components.code, { children: "EventSelector" }),
						" / ",
						createVNode(_components.code, { children: "selectG" })
					] }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						"collection per-key ",
						createVNode(_components.code, { children: "get" }),
						" over ",
						createVNode(_components.code, { children: "perKeyBus" }),
						" (",
						createVNode(_components.code, { children: "server.ts:382-417" }),
						"): key in, per-key stream out; absent key = held-open subscription."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "fanEither" }),
						" / ",
						createVNode(_components.code, { children: "fanThese" })
					] }),
					"\n",
					createVNode(_components.td, { children: "composition (deferred)" }),
					"\n",
					createVNode(_components.td, { children: [
						"two ",
						createVNode(_components.code, { children: "SKIP" }),
						"-filtered derived events off one upstream — needs the filter ADD."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "filterEventKey" }),
						" / ",
						createVNode(_components.code, { children: "factorEvent" })
					] }),
					"\n",
					createVNode(_components.td, { children: "N/A" }),
					"\n",
					createVNode(_components.td, { children: "the key travels as data and the client re-subscribes; stop-permanently semantics have no demand." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "fanInt" }),
						" / ",
						createVNode(_components.code, { children: "EventSelectorInt" })
					] }),
					"\n",
					createVNode(_components.td, { children: "N/A" }),
					"\n",
					createVNode(_components.td, { children: "perf specialization of fan." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "§5 hold-class (stateful)" }) }),
					"\n",
					createVNode(_components.td, {}),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "hold" }),
						"/",
						createVNode(_components.code, { children: "holdDyn" })
					] }),
					"\n",
					createVNode(_components.td, { children: "ADD-SHIP" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "source" }),
						" — push and poll shapes (+ ",
						createVNode(_components.code, { children: "derived.cell" }),
						"); no isEqual of its own — dedup at the target cell’s spec ",
						createVNode(_components.code, { children: "equals" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "Accumulator" }),
						" (",
						createVNode(_components.code, { children: "accum*" }),
						"), ",
						createVNode(_components.code, { children: "foldDyn" }),
						"/",
						createVNode(_components.code, { children: "foldDynMaybe*" })
					] }),
					"\n",
					createVNode(_components.td, { children: "ADD-SHIP" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "scan" }),
						" published via ",
						createVNode(_components.code, { children: "derived.cell" }),
						" — ",
						createVNode(_components.code, { children: "(state, frame) => state" }),
						" fold; ",
						createVNode(_components.code, { children: "accumMaybe" }),
						"’s “Nothing = no update” = return the previous state reference. Demand: drishti’s committed alerts scan (paired-PR campaign); the padi activityFeed adoption is conditional (the activityFeed open question)."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "mapAccumDyn" }),
						"/",
						createVNode(_components.code, { children: "mapAccumB" }),
						" (state + output, snapshot-worthy)"
					] }),
					"\n",
					createVNode(_components.td, { children: "ADD-SHIP" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "scanStream" }),
						" — carried state + per-frame delta, wire face ",
						createVNode(_components.code, { children: "snapshot(state)" }),
						"-then-deltas via ",
						createVNode(_components.code, { children: "subscribeBeforeSnapshot" }),
						" (",
						createVNode(_components.code, { children: "server.ts:350-363" }),
						")."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "mapAccum_" }),
						" family / ",
						createVNode(_components.code, { children: "numberOccurrences*" }),
						" / ",
						createVNode(_components.code, { children: "zipListWithEvent" })
					] }),
					"\n",
					createVNode(_components.td, { children: ["N/A → raw ", createVNode(_components.code, { children: "source" })] }),
					"\n",
					createVNode(_components.td, { children: [
						"the state-",
						createVNode(_components.em, { children: "discarded" }),
						" variants output an Event with no snapshot obligation — the honest analog is a raw ",
						createVNode(_components.code, { children: "source" }),
						" generator closing over carried state (",
						createVNode(_components.code, { children: "project.ts:172-179" }),
						")."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "accumIncremental" }), " (fold to a PATCH)"] }),
					"\n",
					createVNode(_components.td, { children: "ADD-DEFER" }),
					"\n",
					createVNode(_components.td, { children: [
						"fold emitting collection patches instead of full refolds. Trigger: a full refold measured too hot over large N (urgency today is a deliberate, cheap full refold, ",
						createVNode(_components.code, { children: "urgency.ts:23-38" }),
						")."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "scanDyn" }),
						"/",
						createVNode(_components.code, { children: "scanDynMaybe" }),
						"/",
						createVNode(_components.code, { children: "mapDynM" })
					] }),
					"\n",
					createVNode(_components.td, { children: "ADD-SHIP" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "scan" }), " with a cell upstream."] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "count" }),
						"/",
						createVNode(_components.code, { children: "toggle" })
					] }),
					"\n",
					createVNode(_components.td, { children: "N/A named" }),
					"\n",
					createVNode(_components.td, { children: "one-line scan instances." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "tailE" }),
						"/",
						createVNode(_components.code, { children: "headTailE" }),
						"/",
						createVNode(_components.code, { children: "takeWhileE" }),
						"/…/",
						createVNode(_components.code, { children: "improvingMaybe" })
					] }),
					"\n",
					createVNode(_components.td, { children: "N/A" }),
					"\n",
					createVNode(_components.td, { children: [
						"prefix/suffix machines; a raw ",
						createVNode(_components.code, { children: "source" }),
						" generator; no in-repo demand."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "§6 switching (higher-order)" }) }),
					"\n",
					createVNode(_components.td, {}),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "switch" }),
						"/",
						createVNode(_components.code, { children: "switchHold*" }),
						"/",
						createVNode(_components.code, { children: "switcher" }),
						"/",
						createVNode(_components.code, { children: "switchDyn" }),
						"/",
						createVNode(_components.code, { children: "switchPromptlyDyn" }),
						"/",
						createVNode(_components.code, { children: "coincidence" }),
						"/",
						createVNode(_components.code, { children: "coincidencePatch*" })
					] }),
					"\n",
					createVNode(_components.td, { children: "N/A on the wire" }),
					"\n",
					createVNode(_components.td, { children: [
						"a live channel is process-bound state and the only serializable stand-in is a capability handle (dead epochs, no snapshot obligation, a second writer on “which stream is current”). The index travels as data (a per-key ",
						createVNode(_components.code, { children: "get" }),
						" held open on an absent key is ",
						createVNode(_components.code, { children: "switchHold never" }),
						"’s idle state, ",
						createVNode(_components.code, { children: "server.ts:382-417" }),
						"); the client re-subscribes — ",
						createVNode(_components.code, { children: "scopedByEntry" }),
						" (",
						createVNode(_components.code, { children: "scoped.ts:81-210" }),
						") is the switching machinery."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "join" }), " (Dynamic-is-a-Monad, unkeyed)"] }),
					"\n",
					createVNode(_components.td, { children: "N/A wire" }),
					"\n",
					createVNode(_components.td, { children: [
						"a cell-of-cell is unspellable as wire data (the inner cell would travel as a channel capability); the outer value is data, the client re-subscribes. Keyed ",
						createVNode(_components.code, { children: "joinDynThroughMap" }),
						" is the collection row (§8)."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "maybeDyn" }),
						"/",
						createVNode(_components.code, { children: "eitherDyn" }),
						"/",
						createVNode(_components.code, { children: "factorDyn" })
					] }),
					"\n",
					createVNode(_components.td, { children: "N/A wire" }),
					"\n",
					createVNode(_components.td, { children: [
						"client-side discriminated rendering: a memo on the discriminant; Solid ",
						createVNode(_components.code, { children: "<Show>" }),
						"/",
						createVNode(_components.code, { children: "<Switch>" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "§7 uniqueness" }) }),
					"\n",
					createVNode(_components.td, {}),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "holdUniqDyn" }),
						" / ",
						createVNode(_components.code, { children: "holdUniqDynBy" })
					] }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						"producer-side spec ",
						createVNode(_components.code, { children: "equals" }),
						" (",
						createVNode(_components.code, { children: "define.ts:124" }),
						"), enforced on both write paths (",
						createVNode(_components.code, { children: "server.ts:198-207" }),
						", ",
						createVNode(_components.code, { children: "1469-1474" }),
						"). THIS is where equals lives: at the ONE writer’s publish gate, never inside a deriver, never at a mirror."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "UniqDynamic" }), " + ptr-equality"] }),
					"\n",
					createVNode(_components.td, { children: "N/A" }),
					"\n",
					createVNode(_components.td, { children: "explicit, reviewable predicate on the spec; JS has no WHNF/ptr semantics to exploit." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "alreadyUniqDynamic" }) }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						"the per-write ",
						createVNode(_components.code, { children: "force" }),
						" equals bypass (",
						createVNode(_components.code, { children: "server.ts:1238" }),
						") for re-serve rebind epochs."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "stream uniqueness" }),
					"\n",
					createVNode(_components.td, { children: "EXISTS (poll shape)" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "pollOnEvent" }),
						"’s ",
						createVNode(_components.code, { children: "isEqual" }),
						" yield gate (",
						createVNode(_components.code, { children: "server.ts:540-561" }),
						", gate at ",
						createVNode(_components.code, { children: ":557" }),
						") — streams have no spec-equals gate, so the source owns it; cells do."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "collection VALUE uniqueness" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "ADD-SHIP" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "CollectionSpec.equals" }),
						" gating per-key publish + coalescer enqueue (",
						createVNode(_components.code, { children: "server.ts:1585-1600" }),
						"), mirroring the cell gate. Live demand: drishti’s ",
						createVNode(_components.code, { children: "processChanged" }),
						" (agent ",
						createVNode(_components.code, { children: "main.ts:90-106" }),
						"), hand-held at the write site today."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "demux" }) }),
					"\n",
					createVNode(_components.td, { children: "N/A wire" }),
					"\n",
					createVNode(_components.td, { children: [
						"selection is client state; ",
						createVNode(_components.code, { children: "demuxed(k)" }),
						" = a client memo."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "§8 combining / distribution" }) }),
					"\n",
					createVNode(_components.td, {}),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "zipDyn" }),
						" / ",
						createVNode(_components.code, { children: "zipDynWith" })
					] }),
					"\n",
					createVNode(_components.td, { children: "free server-side / N/A cross-surface / EXISTS client" }),
					"\n",
					createVNode(_components.td, { children: [
						"server-side: a ",
						createVNode(_components.code, { children: "computed" }),
						" over multiple ",
						createVNode(_components.code, { children: "$" }),
						" reads (the diamond example). Cross-surface wire zip deliberately absent: independent channels can present (new a, old b); no transactional frame restores glitch-freedom."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "distributeMapOverDynPure" }),
						" / ",
						createVNode(_components.code, { children: "joinDynThroughMap" }),
						" / ",
						createVNode(_components.code, { children: "distributeList*" })
					] }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: [
						"the collection IS the distributed map: ",
						createVNode(_components.code, { children: "deltas" }),
						" = a coherent whole-map view per tick; ",
						createVNode(_components.code, { children: "keys" }),
						"+",
						createVNode(_components.code, { children: "get" }),
						" = the per-key view."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "splitDynPure" }) }),
					"\n",
					createVNode(_components.td, { children: "composition" }),
					"\n",
					createVNode(_components.td, { children: "two derived cells off one upstream." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "constDyn" }),
						" / ",
						createVNode(_components.code, { children: "unsafeDynamic" })
					] }),
					"\n",
					createVNode(_components.td, { children: "EXISTS" }),
					"\n",
					createVNode(_components.td, { children: "cell default with no writer / the raw-source escape hatch." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["HList machinery / ", createVNode(_components.code, { children: "collectDynPure" })] }),
					"\n",
					createVNode(_components.td, { children: "N/A" }),
					"\n",
					createVNode(_components.td, { children: [
						"TS structural records; n-ary combines are ",
						createVNode(_components.code, { children: "computed" }),
						" composition."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Num/IsString/Semigroup instances" }),
					"\n",
					createVNode(_components.td, { children: "N/A" }),
					"\n",
					createVNode(_components.td, { children: "sugar over fmap/zip." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "§10 Adjustable + collection UIs" }) }),
					"\n",
					createVNode(_components.td, {}),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "Adjustable" }),
						"/",
						createVNode(_components.code, { children: "runWithReplace" }),
						"/",
						createVNode(_components.code, { children: "traverse*WithAdjust(WithMove)" })
					] }),
					"\n",
					createVNode(_components.td, { children: ["EXISTS client / ", createVNode(_components.strong, { children: "ADD-SHIP server" })] }),
					"\n",
					createVNode(_components.td, { children: [
						"client: ",
						createVNode(_components.code, { children: "scopedByEntry" }),
						" (",
						createVNode(_components.code, { children: "scoped.ts:81-210" }),
						"). Server: ",
						createVNode(_components.code, { children: "reactiveFamily" }),
						" + ",
						createVNode(_components.code, { children: "derived.registry" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "listHoldWithKey" }),
						"/",
						createVNode(_components.code, { children: "listWithKey" }),
						"/…/",
						createVNode(_components.code, { children: "simpleList" })
					] }),
					"\n",
					createVNode(_components.td, { children: "same" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "scopedByEntry" }),
						" / ",
						createVNode(_components.code, { children: "watchByEntry" }),
						" (client); ",
						createVNode(_components.code, { children: "reactiveFamily" }),
						" (server)."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "networkView" }),
						"/",
						createVNode(_components.code, { children: "networkHold" }),
						"/",
						createVNode(_components.code, { children: "untilReady" })
					] }),
					"\n",
					createVNode(_components.td, { children: "N/A" }),
					"\n",
					createVNode(_components.td, { children: [
						"whole-graph replacement is a process/UI concern: Solid ",
						createVNode(_components.code, { children: "<Show>" }),
						"/Suspense client-side; server-side, the re-serve rebind epoch (force republish, ",
						createVNode(_components.code, { children: "server.ts:1238" }),
						")."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "§11 Query" }) }),
					"\n",
					createVNode(_components.td, {}),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "Query" }),
						"/",
						createVNode(_components.code, { children: "crop" }),
						"/",
						createVNode(_components.code, { children: "QueryMorphism" }),
						"/",
						createVNode(_components.code, { children: "SelectedCount" }),
						"/",
						createVNode(_components.code, { children: "MonadQuery" }),
						"/",
						createVNode(_components.code, { children: "queryDyn" })
					] }),
					"\n",
					createVNode(_components.td, { children: "N/A as API" }),
					"\n",
					createVNode(_components.td, { children: [
						"per-member subscription + AbortSignal IS a query declaration; subscriber counts are SelectedCount; abort is the decrement-to-zero prune. Crop ",
						createVNode(_components.em, { children: "policy" }),
						" is app-level (W7 K1). A genuine analog becomes worth building at range/viewport partial subscription over a large collection."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "deprecated inventory" }),
					"\n",
					createVNode(_components.td, { children: "N/A" }),
					"\n",
					createVNode(_components.td, { children: "aliases of covered combinators." }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
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
	"title": "The reactive bridge — backend signals, one seamless API",
	"description": "The ratified direction for backend reactivity: state is a signal, derived state is a computed, the wire is a signal boundary that snapshots and replays. The engine — @preact/signals-core now, @solidjs/signals the named swap target — lives behind reactor.ts in @kolu/surface, apps are lint-banned from touching it; every wire law stays where it lives today; Solid is unchanged client-side; streams and events stay off the graph permanently. The worked before/after examples, the law-enforcement table, the fate of the seven wire-contract names, the migration phases (phase 0 IS the W5 slice), the honest costs, the open questions srid rules on, and the exhaustive reflex→surface mapping as the closing appendix.",
	"parents": [
		"pedagogy",
		"padi",
		"surface"
	],
	"status": "implemented",
	"maturity": "seedling",
	"updated": "2026-07-15T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-api-symbol-by-symbol",
			"text": "The API, symbol by symbol"
		},
		{
			"depth": 2,
			"slug": "the-worked-examples",
			"text": "The worked examples"
		},
		{
			"depth": 3,
			"slug": "sr7--worked-example-1--padi-urgency",
			"text": "SR7 · worked example 1 — padi urgency"
		},
		{
			"depth": 3,
			"slug": "2-drishti-alerts--hysteresis-scan-durability-chosen-in-the-signature",
			"text": "2. drishti alerts — hysteresis scan, durability chosen in the signature"
		},
		{
			"depth": 3,
			"slug": "sr8--worked-example-3--a-sampler-padi-processmemory",
			"text": "SR8 · worked example 3 — a sampler (padi processMemory)"
		},
		{
			"depth": 3,
			"slug": "sr9--worked-example-4--the-servehostmap-keyed-family",
			"text": "SR9 · worked example 4 — the serveHostMap keyed family"
		},
		{
			"depth": 3,
			"slug": "5-cross-member-derivation--free",
			"text": "5. Cross-member derivation — free"
		},
		{
			"depth": 2,
			"slug": "the-laws-and-how-each-is-enforced",
			"text": "The laws, and how each is enforced"
		},
		{
			"depth": 2,
			"slug": "the-fate-of-the-seven-names",
			"text": "The fate of the seven names"
		},
		{
			"depth": 2,
			"slug": "sr7sr10--migration-phase-0-shipped-as-the-w5-slice",
			"text": "SR7–SR10 — migration (phase 0 shipped as the W5 slice)"
		},
		{
			"depth": 2,
			"slug": "the-honest-costs",
			"text": "The honest costs"
		},
		{
			"depth": 2,
			"slug": "the-open-questions",
			"text": "The open questions"
		},
		{
			"depth": 2,
			"slug": "appendix--the-reflexsurface-mapping-exhaustively",
			"text": "Appendix — the reflex→surface mapping, exhaustively"
		}
	];
}
var url = "src/content/atlas/surface-reactive-bridge.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/surface-reactive-bridge.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/surface-reactive-bridge.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
