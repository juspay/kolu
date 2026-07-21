import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Cite } from "./Cite_IypTixBQ.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/diagrams/xterm-kit-architecture.svg?raw
var xterm_kit_architecture_default = "<svg viewBox=\"0 0 980 704\" width=\"100%\" role=\"img\" aria-label=\"The package boundary for kolu's xterm machinery. Two consumers sit on top: the kolu client's Terminal.tsx policy half (padi attach wire, frame kinds, keybindings, theme values, renderer preference, WebGL budget policy, paste and drop upload, file-ref links, tap policy, MobileKeyBar and sticky modifiers, mobile chrome, activity, diagnostics, the e2e __xterm bridge) imports both the core and the /solid entrypoint; the kaval daemon's ptyHost.ts policy half (node-pty spawn and exit, attach and getHistory verbs, bounded-snapshot cache, reflow-epoch stale replies, OSC metadata, foreground sampling, the headless mirror itself) imports the core only, keeping solid-js and the DOM out of the daemon closure. The package holds two compartments. The /solid browser adapter: the Xterm component, createXtermLifecycle for owner-correct async construct and dispose, attachWebGL for single-owner addon lifetime with context-loss recovery and deterministic loseContext release, createRenderRecovery for forced sync repaints, wireScrollIntent, and the touch surface — enableSoftKeyboardInput, wireTouchTaps, and wireTouchScroll — owning tap-vs-scroll discrimination and the soft-keyboard focus rules, with an IME-routing slot reserved for the open PR 1634. The runtime-neutral core, which works on any terminal, browser or headless, with no DOM and no solid-js: the hardened write path (createScrollLock, createSnapshotBoundary, createBackfillController with seam tokens, RIS halt, and generation guards, fetch injected so no wire type enters), fail-loud buffer surgery (prependScrollback: in-place splice, register shift, renderer pokes, throwing on any missing symbol or headroom shortfall), mirror anchoring joining from kaval (createMirrorAnchor: onTrim eviction origin, RIS re-anchor, reflowEpoch, plus snapToWrapHead for wrap-safe serialize cuts), and the /internals door to _core.* whose cosmetic reads degrade to null. The contract-pin tests ship inside the package so any pinned-symbol move on an xterm bump is red CI. Underneath, the volatility adapted: the exact-pinned @xterm/xterm 6.1.0-beta.225 with its addons in the browser, and @xterm/headless 6.0.0 in node, their BufferLine shapes verified identical by the pins.\" style=\"max-width:980px;font:13px ui-sans-serif,system-ui,sans-serif\">\n  <defs>\n    <marker id=\"xkArrow\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"var(--ink-muted,#8a8f98)\" />\n    </marker>\n    <marker id=\"xkGood\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"var(--good-stroke,#15803D)\" />\n    </marker>\n    <marker id=\"xkStruct\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"var(--struct-stroke,#0D32B2)\" />\n    </marker>\n  </defs>\n\n  <!-- consumer: kolu client -->\n  <rect x=\"20\" y=\"20\" width=\"452\" height=\"168\" rx=\"12\" fill=\"none\" stroke=\"var(--ink-muted,#b6bcc6)\" stroke-width=\"1.3\" stroke-dasharray=\"5 5\" />\n  <text x=\"34\" y=\"44\" font-size=\"11\" font-weight=\"700\" fill=\"var(--ink,#1a1d21)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">kolu client · Terminal.tsx — the policy half (stays)</text>\n  <text x=\"34\" y=\"62\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">which bytes, when, for whom</text>\n  <text x=\"34\" y=\"84\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\">padi attach wire · frame kinds (snapshot | delta) · unenrolledStreamCall</text>\n  <text x=\"34\" y=\"102\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\">keybindings + prohibited chords · theme values · renderer preference</text>\n  <text x=\"34\" y=\"120\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\">WebGL budget policy — which tiles hold a context (webglBudget.ts)</text>\n  <text x=\"34\" y=\"138\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\">paste/drop upload · file-ref links · tap policy (what a tap opens)</text>\n  <text x=\"34\" y=\"156\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\">MobileKeyBar + sticky modifiers · mobile chrome</text>\n  <text x=\"34\" y=\"174\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\">activity + diagnostics · the e2e __xterm bridge</text>\n\n  <!-- consumer: kaval daemon -->\n  <rect x=\"508\" y=\"20\" width=\"452\" height=\"168\" rx=\"12\" fill=\"none\" stroke=\"var(--ink-muted,#b6bcc6)\" stroke-width=\"1.3\" stroke-dasharray=\"5 5\" />\n  <text x=\"522\" y=\"44\" font-size=\"11\" font-weight=\"700\" fill=\"var(--ink,#1a1d21)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">kaval daemon · ptyHost.ts — the policy half (stays)</text>\n  <text x=\"522\" y=\"62\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">PTYs, verbs, metadata</text>\n  <text x=\"522\" y=\"84\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\">node-pty spawn/exit · attach + getHistory verbs</text>\n  <text x=\"522\" y=\"102\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\">bounded-snapshot cache · reflow-epoch stale replies</text>\n  <text x=\"522\" y=\"120\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\">OSC 7/633 metadata · foreground sampling · XTVERSION answer</text>\n  <text x=\"522\" y=\"138\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\">the mirror itself — one headless xterm per PTY</text>\n\n  <!-- consumer → package arrows -->\n  <path d=\"M246 188 L246 236\" fill=\"none\" stroke=\"var(--good-stroke,#15803D)\" stroke-width=\"2\" marker-end=\"url(#xkGood)\" />\n  <text x=\"258\" y=\"216\" font-size=\"10\" font-weight=\"600\" fill=\"var(--good-text,#166534)\">imports core + /solid</text>\n  <path d=\"M734 188 L734 236\" fill=\"none\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"2\" marker-end=\"url(#xkStruct)\" />\n  <text x=\"746\" y=\"210\" font-size=\"10\" font-weight=\"600\" fill=\"var(--struct-stroke,#0D32B2)\">imports core only</text>\n  <text x=\"746\" y=\"224\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--struct-sub,#4A5072)\">no solid-js in the daemon closure</text>\n\n  <!-- the package -->\n  <rect x=\"20\" y=\"236\" width=\"940\" height=\"356\" rx=\"12\" fill=\"none\" stroke=\"var(--good-stroke,#15803D)\" stroke-width=\"2.5\" />\n  <text x=\"34\" y=\"260\" font-size=\"12\" font-weight=\"700\" fill=\"var(--good-text,#166534)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">@kolu/xterm-kit — high-level xterm machinery</text>\n  <text x=\"946\" y=\"260\" text-anchor=\"end\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">no PTY · no wire · no host — bytes and buffers only</text>\n\n  <!-- /solid compartment -->\n  <rect x=\"40\" y=\"276\" width=\"284\" height=\"296\" rx=\"8\" fill=\"var(--good-fill,#eff6f0)\" stroke=\"var(--good-stroke,#15803D)\" stroke-width=\"1.5\" />\n  <text x=\"182\" y=\"298\" text-anchor=\"middle\" font-size=\"11\" font-weight=\"700\" fill=\"var(--good-text,#166534)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">/solid — the browser adapter</text>\n  <text x=\"54\" y=\"324\" font-size=\"10\" font-weight=\"600\" fill=\"var(--ink,#1a1d21)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">&lt;Xterm&gt;</text>\n  <text x=\"54\" y=\"338\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">the component form — reactive props, onReady handle</text>\n  <text x=\"54\" y=\"370\" font-size=\"10\" font-weight=\"600\" fill=\"var(--ink,#1a1d21)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">createXtermLifecycle</text>\n  <text x=\"54\" y=\"384\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">owner-correct async construct + dispose (#591/#606)</text>\n  <text x=\"54\" y=\"416\" font-size=\"10\" font-weight=\"600\" fill=\"var(--ink,#1a1d21)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">attachWebGL</text>\n  <text x=\"54\" y=\"430\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">single-owner addon · context-loss recovery ·</text>\n  <text x=\"54\" y=\"443\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">deterministic loseContext() release</text>\n  <text x=\"54\" y=\"475\" font-size=\"10\" font-weight=\"600\" fill=\"var(--ink,#1a1d21)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">createRenderRecovery</text>\n  <text x=\"54\" y=\"489\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">forced sync repaint when the rAF loop parks</text>\n  <text x=\"54\" y=\"521\" font-size=\"10\" font-weight=\"600\" fill=\"var(--ink,#1a1d21)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">wireScrollIntent</text>\n  <text x=\"54\" y=\"535\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">DOM wheel/pointer wiring for the core scroll lock</text>\n  <text x=\"54\" y=\"553\" font-size=\"10\" font-weight=\"600\" fill=\"var(--ink,#1a1d21)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">enableSoftKeyboardInput · wireTouch*</text>\n  <text x=\"54\" y=\"567\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">tap-vs-scroll · soft-keyboard rules · IME slot</text>\n\n  <!-- composes arrow -->\n  <path d=\"M324 424 L344 424\" fill=\"none\" stroke=\"var(--ink-muted,#8a8f98)\" stroke-width=\"1.5\" marker-end=\"url(#xkArrow)\" />\n  <text x=\"334\" y=\"414\" text-anchor=\"middle\" font-size=\"8.5\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">uses</text>\n\n  <!-- core compartment -->\n  <rect x=\"344\" y=\"276\" width=\"596\" height=\"296\" rx=\"8\" fill=\"var(--surface,#F7F8FE)\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"1.5\" />\n  <text x=\"642\" y=\"298\" text-anchor=\"middle\" font-size=\"11\" font-weight=\"700\" fill=\"var(--struct-stroke,#0D32B2)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">core — runtime-neutral: any Terminal, browser or headless · no DOM · no solid-js</text>\n\n  <!-- core: hardened write path -->\n  <rect x=\"360\" y=\"312\" width=\"280\" height=\"118\" rx=\"6\" fill=\"none\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"1.2\" />\n  <text x=\"500\" y=\"332\" text-anchor=\"middle\" font-size=\"10.5\" font-weight=\"700\" fill=\"var(--ink,#11203a)\">hardened write path</text>\n  <text x=\"500\" y=\"350\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">createScrollLock · createSnapshotBoundary</text>\n  <text x=\"500\" y=\"366\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">createBackfillController</text>\n  <text x=\"500\" y=\"384\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">seam tokens · RIS halt · generation guards</text>\n  <text x=\"500\" y=\"402\" text-anchor=\"middle\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">fetch is injected — no wire type enters</text>\n\n  <!-- core: buffer surgery -->\n  <rect x=\"652\" y=\"312\" width=\"272\" height=\"118\" rx=\"6\" fill=\"none\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"1.2\" />\n  <text x=\"788\" y=\"332\" text-anchor=\"middle\" font-size=\"10.5\" font-weight=\"700\" fill=\"var(--ink,#11203a)\">buffer surgery — FAIL-LOUD</text>\n  <text x=\"788\" y=\"350\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">prependScrollback</text>\n  <text x=\"788\" y=\"366\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">in-place splice · register shift · renderer pokes</text>\n  <text x=\"788\" y=\"384\" text-anchor=\"middle\" font-size=\"9.5\" font-weight=\"600\" fill=\"var(--ink,#1a1d21)\">throws on a missing symbol or headroom</text>\n  <text x=\"788\" y=\"402\" text-anchor=\"middle\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">a partial prepend is corruption, never a degrade</text>\n\n  <!-- core: mirror anchoring -->\n  <rect x=\"360\" y=\"442\" width=\"280\" height=\"118\" rx=\"6\" fill=\"none\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"1.2\" />\n  <text x=\"500\" y=\"462\" text-anchor=\"middle\" font-size=\"10.5\" font-weight=\"700\" fill=\"var(--ink,#11203a)\">mirror anchoring — joins from kaval</text>\n  <text x=\"500\" y=\"480\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">createMirrorAnchor · snapToWrapHead</text>\n  <text x=\"500\" y=\"498\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">onTrim eviction origin · RIS re-anchor · reflowEpoch</text>\n  <text x=\"500\" y=\"516\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">wrap-safe serialize cuts</text>\n  <text x=\"500\" y=\"534\" text-anchor=\"middle\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">fail-loud too — a frozen origin corrupts history</text>\n\n  <!-- core: internals door + pins -->\n  <rect x=\"652\" y=\"442\" width=\"272\" height=\"118\" rx=\"6\" fill=\"none\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"1.2\" />\n  <text x=\"788\" y=\"462\" text-anchor=\"middle\" font-size=\"10.5\" font-weight=\"700\" fill=\"var(--ink,#11203a)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">/internals — the door to _core.*</text>\n  <text x=\"788\" y=\"480\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">cosmetic reads degrade to null</text>\n  <text x=\"788\" y=\"496\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">renderService · readBufferBytes · coords patch</text>\n  <text x=\"788\" y=\"518\" text-anchor=\"middle\" font-size=\"9.5\" font-weight=\"700\" fill=\"var(--good-text,#166534)\">CONTRACT PINS ship in the package</text>\n  <text x=\"788\" y=\"534\" text-anchor=\"middle\" font-size=\"9.5\" font-weight=\"600\" fill=\"var(--good-text,#166534)\">red CI on any pinned-symbol move</text>\n\n  <!-- package → xterm deps -->\n  <path d=\"M285 592 L285 624\" fill=\"none\" stroke=\"var(--ink-muted,#8a8f98)\" stroke-width=\"1.5\" marker-end=\"url(#xkArrow)\" />\n  <path d=\"M695 592 L695 624\" fill=\"none\" stroke=\"var(--ink-muted,#8a8f98)\" stroke-width=\"1.5\" marker-end=\"url(#xkArrow)\" />\n  <text x=\"490\" y=\"612\" text-anchor=\"middle\" font-size=\"10\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">the volatility adapted — every _core reach pinned</text>\n\n  <!-- deps -->\n  <rect x=\"120\" y=\"624\" width=\"330\" height=\"64\" rx=\"8\" fill=\"var(--surface,#F7F8FE)\" stroke=\"var(--ink-muted,#8a8f98)\" stroke-width=\"1.3\" />\n  <text x=\"285\" y=\"648\" text-anchor=\"middle\" font-size=\"10.5\" font-weight=\"700\" fill=\"var(--ink,#1a1d21)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">@xterm/xterm 6.1.0-beta.225 + 8 addons</text>\n  <text x=\"285\" y=\"668\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">browser · exact pnpm-overrides pin</text>\n  <rect x=\"530\" y=\"624\" width=\"330\" height=\"64\" rx=\"8\" fill=\"var(--surface,#F7F8FE)\" stroke=\"var(--ink-muted,#8a8f98)\" stroke-width=\"1.3\" />\n  <text x=\"695\" y=\"648\" text-anchor=\"middle\" font-size=\"10.5\" font-weight=\"700\" fill=\"var(--ink,#1a1d21)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">@xterm/headless 6.0.0</text>\n  <text x=\"695\" y=\"668\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">node · BufferLine shape pin-verified identical</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/xterm-kit.mdx
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
			"Ratified by srid (2026-07-13) as the next refactor task: graduate kolu’s xterm\nmachinery into its own workspace package. Shipped as two PRs on evidence class\n(see the migration): the behavior-neutral graduation in ",
			createVNode($$PrLink, { pr: 1795 }),
			" (PR\n1), the ",
			createVNode(_components.code, { children: "<Xterm>" }),
			" wrapper + touch-divisor unification in the e2e-gated\n",
			createVNode($$PrLink, { pr: 1808 }),
			" (PR 2).\nThe ",
			createVNode(_components.a, {
				href: "electricity.html",
				children: "electricity ledger"
			}),
			"\nhas carried this as its one not-yet-built row since the framework audit, under\nthe working name ",
			createVNode(_components.code, { children: "@kolu/solid-xterm" }),
			" — and that name turned out to be the plan’s\nown first bug. What kolu has actually accumulated is ",
			createVNode(_components.strong, { children: "high-level xterm.js\nmachinery" }),
			", most of which has nothing Solid about it: the pinned reaches into\n",
			createVNode(_components.code, { children: "_core.*" }),
			" with two deliberate failure philosophies, in-place scrollback surgery\n(",
			createVNode($$PrLink, { pr: 1783 }),
			"), seam-token parsing, scroll-lock write buffering, RIS\ndetection and re-anchoring — all of it operating on ",
			createVNode(_components.em, { children: "any" }),
			" xterm ",
			createVNode(_components.code, { children: "Terminal" }),
			",\nbrowser or ",
			createVNode(_components.code, { children: "@xterm/headless" }),
			". So the package is a ",
			createVNode(_components.strong, { children: [
				"runtime-neutral core plus a\n",
				createVNode(_components.code, { children: "/solid" }),
				" entrypoint"
			] }),
			" (the ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" → ",
			createVNode(_components.code, { children: "@kolu/surface/solid" }),
			" pattern), and\nit has ",
			createVNode(_components.strong, { children: "two consumers on day one" }),
			": kaval imports the core; the client imports\ncore + ",
			createVNode(_components.code, { children: "/solid" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"This note is the plan and the ",
			createVNode(_components.strong, { children: "API design record" }),
			" — the exported surface is\ndesigned here, per srid’s instruction, because the API ",
			createVNode(_components.em, { children: "is" }),
			" the product of this\nrefactor. It is not the reference manual (kolu.dev reference docs come later):\neach export gets the sentence that justifies its existence, not its option list.\nThe name is decided (srid, 2026-07-13): ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/xterm-kit" }) }),
			", with four\nentrypoints — ",
			createVNode(_components.code, { children: "@kolu/xterm-kit" }),
			" (the daemon-safe, runtime-neutral core),\n",
			createVNode(_components.code, { children: "@kolu/xterm-kit/backfill" }),
			" (the ",
			createVNode(_components.code, { children: "@xterm/xterm" }),
			"-constructing scrollback write\npath), ",
			createVNode(_components.code, { children: "@kolu/xterm-kit/internals" }),
			" (the cosmetic ",
			createVNode(_components.code, { children: "_core.*" }),
			" reads), and\n",
			createVNode(_components.code, { children: "@kolu/xterm-kit/solid" }),
			" (the SolidJS adapter). The core/",
			createVNode(_components.code, { children: "/solid" }),
			" split is the\nheadline (",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" → ",
			createVNode(_components.code, { children: "@kolu/surface/solid" }),
			"); ",
			createVNode(_components.code, { children: "/backfill" }),
			" and ",
			createVNode(_components.code, { children: "/internals" }),
			"\nexist because a static ",
			createVNode(_components.code, { children: "@xterm/xterm" }),
			" value import and the ",
			createVNode(_components.code, { children: "_core" }),
			" reaches must\nstay off the daemon-imported root (see the build-time correction below)."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Revised against the installed system during the build",
			children: createVNode(_components.p, { children: [
				"Three claims in the first draft were corrected by grounding them against the\nrunning code rather than trusting the plan — recorded here so the note stays the\nhonest source of truth. ",
				createVNode(_components.strong, { children: "(1)" }),
				" The core root is daemon-safe only once\n",
				createVNode(_components.code, { children: "createScrollLock" }),
				" (solid-reactive) moves to ",
				createVNode(_components.code, { children: "/solid" }),
				" and the ",
				createVNode(_components.code, { children: "@xterm/xterm" }),
				"\nscratch path moves to ",
				createVNode(_components.code, { children: "/backfill" }),
				": kaval runs from TS source under tsx (eager\nESM), where a static ",
				createVNode(_components.code, { children: "@xterm/xterm" }),
				" named import crashes cjs-module-lexer and any\nre-exported ",
				createVNode(_components.code, { children: "solid-js" }),
				" loads into the daemon. A closure-guard test now enforces\nit. ",
				createVNode(_components.strong, { children: "(2)" }),
				" The Mobile section’s claim that the two touch divisors “unify by\nconstruction” was refuted — they agree only when xterm’s font-metric cell equals\n",
				createVNode(_components.code, { children: "rect.width / cols" }),
				", which nothing guarantees, so unifying them is a behavior\nchange, not a move (see the Mobile section). ",
				createVNode(_components.strong, { children: "(3)" }),
				" Those two facts split the\nwork into two PRs on evidence class (see the migration). The design and boundary\nare unchanged; only claims that didn’t survive contact with the code are."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "what-a-consumer-gets",
			children: "What a consumer gets"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The “user” of this feature is a developer embedding a terminal. Both consumers\nget the same promise: ",
			createVNode(_components.strong, { children: "the hazards are owned by the package" }),
			", and the consumer\nwrites only its own policy — which bytes, when, for whom."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"A SolidJS app renders a live terminal in one component (the ",
			createVNode(_components.code, { children: "<Xterm>" }),
			" wrapper\nshipped in PR 2, ",
			createVNode($$PrLink, { pr: 1808 }),
			", composing the primitives PR 1 graduated):"
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
			"data-language": "tsx",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "import"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { Xterm, "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "type"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " XtermHandle } "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "from"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"@kolu/xterm-kit/solid\""
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
							style: { color: "#D73A49" },
							children: "import"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"@xterm/xterm/css/xterm.css\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "<"
					}), createVNode(_components.span, {
						style: { color: "#005CC5" },
						children: "Xterm"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  theme"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "{dracula}                 "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// reactive — live re-theme, texture atlas cleared"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  fontSize"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "{"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "14"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "}                   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// reactive — refit + atlas clear"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  fontFamily"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"MonoLisa\""
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "           // the face awaited before construction"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  visible"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "{props.visible}         "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// fit gate: hidden panes wait at 80×24"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  webgl"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "{() "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " underBudget"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()}     "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// renderer gate — an accessor, never a snapshot"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  scrollLockEnabled"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "{() "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " true"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "}  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// scroll-lock gate — an accessor (e.g. a pref)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  onData"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "{("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "bytes"
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
							children: " pty."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "write"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(bytes)}                    "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// keystrokes out"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  onResize"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "{({ "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "cols"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "rows"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }) "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " pty."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "resize"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(cols, rows)}   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// grid → PTY"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  onTap"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "{("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "x"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "y"
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
							children: " false"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "}         "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// touch: what a tap MEANS is the consumer's"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  onReady"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "{("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "h"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " XtermHandle"
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
							children: " pty."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "onData"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "c"
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
							children: " h."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "write"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(c))} "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// bytes in"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "/>"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: "Behind that hello-world, the package owns the hazards kolu paid to learn:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Owner-correct async dispose." }),
				" Construction must await the terminal font,\nand SolidJS loses its reactive owner across any ",
				createVNode(_components.code, { children: "await" }),
				" — every cleanup\nregistered after it is a silent no-op, which is exactly how kolu leaked\nwhole xterm graphs per mode toggle.",
				createVNode($$Footnote, { children: [
					"The #591/#606 leak class:\n~900\xA0KB of ",
					createVNode(_components.code, { children: "InputHandler" }),
					" + ",
					createVNode(_components.code, { children: "BufferLine" }),
					"s per orphaned instance, found by\nheap-snapshot retainer walks (190+ retained ",
					createVNode(_components.code, { children: "xterm Terminal" }),
					" trees). The fix\nis structural — capture the owner before the ",
					createVNode(_components.code, { children: "await" }),
					", re-enter it with\n",
					createVNode(_components.code, { children: "runWithOwner" }),
					", register teardown synchronously before the async body, and\nbail on a ",
					createVNode(_components.code, { children: "disposed" }),
					" flag after the await\n(",
					createVNode($$Cite, {
						file: "packages/xterm-kit/src/solid/xtermLifecycle.ts",
						lines: "50-108"
					}),
					")."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "WebGL context-loss recovery and deterministic release." }),
				" The addon is\nsingle-owner, self-heals on ",
				createVNode(_components.code, { children: "webglcontextlost" }),
				", and explicitly fires\n",
				createVNode(_components.code, { children: "WEBGL_lose_context.loseContext()" }),
				" on unload — without that, detached\ncanvases hold GPU contexts until GC and Chrome’s per-tab context budget\nevicts ",
				createVNode(_components.em, { children: "live" }),
				" ones.",
				createVNode($$Footnote, { children: [
					"Chrome allows ~16 WebGL contexts per tab; rapid\nfocus changes created contexts faster than GC released them, flickering\nevery tile (#575, #591, the #1399 budget). The ",
					createVNode(_components.em, { children: "mechanism" }),
					" — accessor-gated\nload/unload with in-microtask release — is the package’s\n(",
					createVNode($$Cite, { file: "packages/xterm-kit/src/solid/webgl.ts" }),
					");\nthe ",
					createVNode(_components.em, { children: "policy" }),
					" of which panes deserve a context stays the consumer’s."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Version-pinned internals with tripwire tests." }),
				" Every reach into xterm’s\nprivate ",
				createVNode(_components.code, { children: "_core.*" }),
				" is confined to the package, typed structurally, and pinned\nby contract tests that turn an xterm bump into red CI instead of silent\ncorruption — with two philosophies, chosen per operation (see the API\ncontract below)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The hardened write path." }),
				" Snapshot-vs-delta discrimination across\nre-attaches, the scroll lock that freezes output while the user reads\nscrollback (buffered writes keep their parse callbacks), seam tokens that\nbind a snapshot’s re-seed to its byte position, and RIS handling that halts\nbackfill rather than corrupt it (",
				createVNode($$PrLink, { pr: 1783 }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Mobile input." }),
				" xterm 6.0 ships no touch path at all — it declares\n",
				createVNode(_components.code, { children: "IViewport.handleTouchStart/Move" }),
				" types with zero wiring, and the WebGL\ncanvas eats touch events before the viewport sees them — so the kit owns\ntouch-scroll bridging, tap-vs-scroll discrimination, the iOS soft-keyboard\nsummoning rules, and (once ",
				createVNode($$PrLink, { pr: 1634 }),
				" merges) Android\nIME/composition routing. What a tap ",
				createVNode(_components.em, { children: "means" }),
				" stays the consumer’s ",
				createVNode(_components.code, { children: "onTap" }),
				"\nhook — designed in the Mobile section below."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"And a ",
			createVNode(_components.strong, { children: "headless consumer" }),
			" — kaval today, any TUI or server tomorrow — uses\nthe same core to keep a long-lived mirror addressable:"
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
							children: "import"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { createMirrorAnchor, snapToWrapHead } "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "from"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"@kolu/xterm-kit\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";"
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
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " anchor"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " createMirrorAnchor"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(headless); "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// pins onTrim, survives RIS buffer swaps"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// absolute line coordinates that survive eviction and reset:"
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
							style: { color: "#005CC5" },
							children: " topLine"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " anchor."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "baseLine"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "() "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "+"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " snapToWrapHead"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(buf, start);"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// anchor.reflowEpoch() stales any history cursor a width reflow renumbered"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-package-boundary",
			children: "The package boundary"
		}),
		"\n",
		createVNode($$Svg, {
			svg: xterm_kit_architecture_default,
			wide: true,
			caption: "The boundary, its two compartments, and both day-one consumers. The runtime-neutral core (blue) owns the hardened write path, fail-loud buffer surgery, the mirror anchoring lifted from kaval, and the /internals door — with the contract-pin tests shipping inside the package, so the pins travel WITH the dependents. The /solid entrypoint (green) owns the component, owner-correct async dispose, WebGL lifetime, and the touch surface. Above the line, each consumer keeps its policy half: Terminal.tsx keeps which bytes and when (padi wire, keybindings, theme, budget policy, e2e bridge); ptyHost.ts keeps PTYs, verbs, and metadata. Below, the volatility being adapted: one workspace-wide exact xterm pin set, browser and headless."
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The line, in one sentence: ",
			createVNode(_components.strong, { children: "a robust adapter over xterm goes in; “which bytes\nand when” stays out." }),
			" Nothing in the package knows a PTY, a host, a padi frame,\nor a keybinding — it speaks bytes, buffers, and ",
			createVNode(_components.code, { children: "Terminal" }),
			" objects. The backfill\ncontroller is the proof the line already holds: its inputs are\n",
			createVNode(_components.code, { children: "consumeSnapshotFrame(topLine, reflowEpoch, carriesReset)" }),
			" and an injected\n",
			createVNode(_components.code, { children: "fetch" }),
			" — numbers, booleans, and a function — so kolu’s wire types never cross\nthe boundary even though the controller drives kolu’s wire.",
			createVNode($$Footnote, { children: [
				"Terminal.tsx\nkeeps the wire knowledge: it discriminates ",
				createVNode(_components.code, { children: "frame.kind === \"snapshot\"" }),
				", checks\nfor the leading ",
				createVNode(_components.code, { children: "TERMINAL_RESET" }),
				", and calls the controller with plain values\n(",
				createVNode($$Cite, {
					file: "packages/client/src/terminal/Terminal.tsx",
					lines: "410-440"
				}),
				"). The\nseam bytes themselves are minted by the controller\n(",
				createVNode($$Cite, {
					file: "packages/xterm-kit/src/scrollbackBackfill.ts",
					lines: "309-351"
				}),
				");\nthe consumer only concatenates."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Against the ",
			createVNode(_components.a, {
				href: "electricity.html",
				children: "electricity three tests"
			}),
			":"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Domain-agnostic" }),
				" — the interface names terminals, buffers, chunks, and\naccessors; no terminal-",
				createVNode(_components.em, { children: "app" }),
				" concept (host, tile, agent, PTY) appears in any\nsignature."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A real volatility" }),
				" — three axes the system demonstrably varies along:\n",
				createVNode(_components.strong, { children: "xterm itself" }),
				" (an exact-pinned beta whose private ",
				createVNode(_components.code, { children: "_core" }),
				" shape moves\nunder version bumps, plus buffer semantics — eviction, RIS buffer swaps,\nreflow — that both runtimes share), ",
				createVNode(_components.strong, { children: "GPU context loss" }),
				" (the browser\nreclaims contexts at will), and ",
				createVNode(_components.strong, { children: ["SolidJS owner semantics across ", createVNode(_components.code, { children: "await" })] }),
				"\n(the dispose-ordering axis). The pins travel ",
				createVNode(_components.em, { children: "with" }),
				" the dependents: the\ncontract-pin tests ship inside the package, so an xterm bump is one\npackage’s red CI, not a repo-wide archaeology."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Graduates with two consumers day one" }),
				" — kaval (a Node daemon, none of the\nbrowser domain) imports the core; the client imports core + ",
				createVNode(_components.code, { children: "/solid" }),
				". Both\nare in-repo, so an ",
				createVNode(_components.em, { children: "external" }),
				" consumer remains future proof — but the\npopulation-of-one caveat that shadowed the old ",
				createVNode(_components.code, { children: "solid-xterm" }),
				" plan is gone."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "A reversed decision, recorded: kaval's mirror half joins the core",
			children: createVNode(_components.p, { children: [
				"The ratified brief for this note — and the electricity ledger’s row — ruled that\nkaval’s headless mirror pins ",
				createVNode(_components.strong, { children: "stay server-side" }),
				", with only the pin ",
				createVNode(_components.em, { children: "pattern" }),
				"\nmaybe sharing a testlib later. Writing the core’s export list overturned that.\nThe ruling was an artifact of the Solid-shaped ",
				createVNode(_components.em, { children: "name" }),
				": with the package framed\nas “SolidJS bindings,” a daemon obviously doesn’t consume it. But the volatility\nkaval’s mirror bookkeeping hides is ",
				createVNode(_components.strong, { children: "xterm" }),
				" — the same ",
				createVNode(_components.code, { children: "_core.buffers.normal.lines" }),
				"\npath the client pins, the same fail-loud philosophy (",
				createVNode(_components.code, { children: "normalLinesOf" }),
				" throws,\n",
				createVNode($$Cite, {
					file: "packages/kaval/src/ptyHost.ts",
					lines: "101-119"
				}),
				"), the same RIS\nrenumbering problem the client’s backfill controller guards — and nothing about\nit is Solid. Once the package is named by its real axis, the mirror half\n(",
				createVNode(_components.code, { children: "onTrim" }),
				" eviction origin, RIS identity re-anchor, ",
				createVNode(_components.code, { children: "reflowEpoch" }),
				",\n",
				createVNode(_components.code, { children: "snapToWrapHead" }),
				", and ",
				createVNode(_components.code, { children: "xtermMirrorContract.test.ts" }),
				") belongs in the core, and\nkaval becomes a consumer rather than a parallel pinning site. The consequence is\nstated above: ",
				createVNode(_components.strong, { children: "two real consumers from day one" }),
				", and the\nprove-then-extract-prerogative framing the earlier plan needed is deleted, not\nsoftened."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "API shape — component plus escape-hatch primitives." }),
			" The ",
			createVNode(_components.code, { children: "/solid" }),
			" entry leads\nwith a component (",
			createVNode(_components.code, { children: "<Xterm>" }),
			"), modeled on ",
			createVNode(_components.code, { children: "@kolu/solid-statepip" }),
			"’s\ncomponent-first surface; every capability under it is also exported as a\nprimitive, and the component is built ",
			createVNode(_components.em, { children: "from" }),
			" those primitives so the two can’t\ndrift. Kolu’s own Terminal.tsx consumes the component and wires its policy in\n",
			createVNode(_components.code, { children: "onReady" }),
			" — the component is consumer #1, not aspiration. The split entrypoints\n(",
			createVNode(_components.code, { children: "." }),
			" / ",
			createVNode(_components.code, { children: "./internals" }),
			" / ",
			createVNode(_components.code, { children: "./solid" }),
			") follow ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			"’s exports map."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-name--decided-koluxterm-kit",
			children: ["The name — decided: ", createVNode(_components.code, { children: "@kolu/xterm-kit" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "solid-xterm" }),
			" was wrong (srid’s own flag): the core is the larger half and\nSolid is one entrypoint. srid picked ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/xterm-kit" }) }),
			" (2026-07-13) — it\nsays “machinery over xterm, not a fork,” and a kit has compartments, which\ncore + ",
			createVNode(_components.code, { children: "/solid" }),
			" is. The bare ",
			createVNode(_components.code, { children: "@kolu/xterm" }),
			" was passed over as one character\nclass away from upstream ",
			createVNode(_components.code, { children: "@xterm/xterm" }),
			" in an import block."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-public-api",
			children: "The public API"
		}),
		"\n",
		createVNode(_components.p, { children: "Two tiers, matching the two consumers. Every export earns its line with one\nsentence; option lists and edge-case semantics are the future reference docs’\njob, not this note’s." }),
		"\n",
		createVNode(_components.h3, {
			id: "core--koluxterm-kit-and-internals",
			children: [
				"Core — ",
				createVNode(_components.code, { children: "@kolu/xterm-kit" }),
				" and ",
				createVNode(_components.code, { children: "/internals" })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The root barrel is the ",
			createVNode(_components.strong, { children: "daemon-safe" }),
			" core — everything on it works on a browser\n",
			createVNode(_components.code, { children: "Terminal" }),
			" or an ",
			createVNode(_components.code, { children: "@xterm/headless" }),
			" one, imports no ",
			createVNode(_components.code, { children: "solid-js" }),
			", and constructs no\nconcrete terminal, so kaval (a Node daemon run from TS source under tsx, eager\nESM) imports it with no UI framework in its closure and no ",
			createVNode(_components.code, { children: "@xterm/xterm" }),
			"\nESM-named-import to crash Node’s cjs-module-lexer. Two exports the first draft\nput here moved out under that constraint, each behind the entrypoint that owns\nits dependency: ",
			createVNode(_components.code, { children: "createScrollLock" }),
			" is ",
			createVNode(_components.code, { children: "solid" }),
			"-reactive (",
			createVNode(_components.code, { children: "/solid" }),
			"), and the\nbackfill write path constructs ",
			createVNode(_components.code, { children: "@xterm/xterm" }),
			" scratch terminals (",
			createVNode(_components.code, { children: "/backfill" }),
			"). A\nclosure-guard test walks the root’s import graph and fails if either returns."
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
					children: [createVNode(_components.span, {
						style: { color: "#D73A49" },
						children: "import"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: " {"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "  // mirror anchoring (the kaval half) + reattach discrimination — runtime-neutral"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  createMirrorAnchor,       "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// absolute-line origin that survives eviction and RIS"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  snapToWrapHead,           "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// never cut a serialize at a soft-wrap continuation"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  createSnapshotBoundary,   "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// first-frame-is-snapshot vs live-delta discrimination"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "} "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "from"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"@kolu/xterm-kit\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#D73A49" },
						children: "import"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: " {"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  createBackfillController, "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// scroll-triggered older-history backfill; fetch injected"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  prependScrollback,        "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// the fail-loud in-place prepend under the controller"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  defaultScratch,           "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// the @xterm/xterm scratch the controller replays through"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "} "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "from"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"@kolu/xterm-kit/backfill\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// browser-only — constructs @xterm/xterm"
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#D73A49" },
						children: "import"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: " {"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  renderService, readDecPrivateMode, readBufferBytes,"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  patchTransformAwareMouseCoords,"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "} "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "from"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"@kolu/xterm-kit/internals\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// cosmetic reads — degrade to null"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "createSnapshotBoundary()" }) }), " exists because a reattaching stream’s first\nframe is a repaint, not activity: it gives any consumer the one bit\n“is this chunk a genuine live delta?” without the consumer tracking retry\nstate itself."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "createBackfillController(term, { fetch, onError })" }) }),
				" exists because\nextending a live buffer upward is a minefield of races — in-flight fetches\nvs. reset/resize/RIS, foreign reflows, seam provenance under scroll lock —\nand it owns all of them behind two calls (",
				createVNode(_components.code, { children: "consumeSnapshotFrame" }),
				", ",
				createVNode(_components.code, { children: "reset" }),
				")\nand an injected ",
				createVNode(_components.code, { children: "fetch" }),
				". ",
				createVNode(_components.code, { children: "onError" }),
				" is required: an omitted handler would\nsilently recreate the swallow it exists to prevent."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "prependScrollback(term, chunk, servedRows, opts): PrependResult" }) }),
				" exists\nas the controller’s engine and as a standalone primitive: replay raw bytes\nthrough a scratch terminal (the real parser), splice the resulting\n",
				createVNode(_components.code, { children: "BufferLine" }),
				"s above everything, shift the registers — the viewport never\nmoves. Its result is a discriminated union so “inserted 0 rows” and “nothing\nconsumed” cannot be conflated."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "createMirrorAnchor(headless)" }) }),
				" exists because a long-lived mirror’s\nabsolute line numbering silently breaks twice — scrollback eviction trims\nthe top, and a RIS reset swaps the whole line list, orphaning any ",
				createVNode(_components.code, { children: "onTrim" }),
				"\nsubscription — and every history-paging feature dies with it. It pins\n",
				createVNode(_components.code, { children: "onTrim" }),
				", detects the buffer swap by identity from the consumer’s write\ncallback, advances its origin past discarded rows, and bumps a\n",
				createVNode(_components.code, { children: "reflowEpoch" }),
				" that stales outstanding cursors.",
				createVNode($$Footnote, { children: [
					"Lifted from\n",
					createVNode(_components.code, { children: "ptyHost.ts" }),
					"’s ",
					createVNode(_components.code, { children: "Entry" }),
					" bookkeeping, behavior-identical: ",
					createVNode(_components.code, { children: "mirrorBaseLine" }),
					" +\nthe trim pin and the RIS identity re-anchor now live in the kit\n(",
					createVNode($$Cite, { file: "packages/xterm-kit/src/mirrorAnchor.ts" }),
					"), and kaval drives it\nfrom its write callback and resize path\n(",
					createVNode($$Cite, { file: "packages/kaval/src/ptyHost.ts" }),
					") — including the F5 fix that\nkeeps re-subscriptions from leaking one disposable per reset."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "snapToWrapHead(buffer, start)" }) }),
				" exists because a serialize cut through a\nsoft-wrapped line replays the continuation as a fresh hard line: it is the\none home for the invariant that kaval’s bounded-snapshot start and history\nchunk tops both enforce (",
				createVNode($$Cite, { file: "packages/xterm-kit/src/mirrorAnchor.ts" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "/internals" }) }),
				" exists as the ",
				createVNode(_components.em, { children: "single" }),
				" door to ",
				createVNode(_components.code, { children: "_core.*" }),
				" for cosmetic\nreads: a render-service probe, a DEC-mode read, per-buffer byte counts, and\nthe transform-aware mouse-coords patch",
				createVNode($$Footnote, { children: [
					"The coords patch corrects a\nknown-but-unfixed upstream asymmetry (xterm.js #2488 made char measurement\ntransform-agnostic; the hit-test was never reconciled — #3242 closed as its\nduplicate), so a pin bump won’t retire it; only an upstream coord-path fix\nwould (",
					createVNode($$Cite, {
						file: "packages/xterm-kit/src/internals.ts",
						lines: "203-241"
					}),
					")."
				] }),
				"\n— anything whose worst failure is a wrong number or a no-op."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The two internals philosophies are not an implementation detail — they are the\n",
			createVNode(_components.strong, { children: "API contract" }),
			" a consumer can rely on:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "you call" }),
					"\n",
					createVNode(_components.th, { children: [
						"when a pinned ",
						createVNode(_components.code, { children: "_core" }),
						" symbol moves"
					] }),
					"\n",
					createVNode(_components.th, { children: "why" }),
					"\n",
					createVNode(_components.th, { children: "the tripwire" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"a ",
						createVNode(_components.strong, { children: "cosmetic read" }),
						" (",
						createVNode(_components.code, { children: "/internals" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"returns ",
						createVNode(_components.code, { children: "null" }),
						" / no-ops — the probe reports “unknown”"
					] }),
					"\n",
					createVNode(_components.td, { children: "a byte count or a coord patch may degrade; crashing a live terminal for it may not" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "internals.test.ts" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"a ",
						createVNode(_components.strong, { children: "buffer mutation" }),
						" (",
						createVNode(_components.code, { children: "prependScrollback" }),
						", ",
						createVNode(_components.code, { children: "createMirrorAnchor" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "throws" }), ", immediately"] }),
					"\n",
					createVNode(_components.td, { children: "a partial splice or a frozen eviction origin is silent scrollback corruption" }),
					"\n",
					createVNode(_components.td, { children: [
						"the ",
						createVNode(_components.code, { children: "CONTRACT PIN" }),
						" suites, browser ",
						createVNode(_components.strong, { children: "and" }),
						" headless",
						createVNode($$Footnote, { children: [
							createVNode($$Cite, { file: "packages/xterm-kit/src/scrollbackBackfill.test.ts" }),
							" pins the ",
							createVNode(_components.code, { children: "@xterm/xterm" }),
							" shape (including the behavioral splice-fires-",
							createVNode(_components.code, { children: "onInsert" }),
							" pin and the unopened-",
							createVNode(_components.code, { children: "write()" }),
							" scratch pin); ",
							createVNode($$Cite, { file: "packages/xterm-kit/src/xtermMirrorContract.test.ts" }),
							" pins the ",
							createVNode(_components.code, { children: "@xterm/headless" }),
							" twin and verifies the shapes identical. Both suites now live in the package — its CI teeth."
						] })
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "solid--the-browser-adapter",
			children: [createVNode(_components.code, { children: "/solid" }), " — the browser adapter"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The first three below shipped in PR 2 (the ",
			createVNode(_components.code, { children: "<Xterm>" }),
			" component and its\nlifecycle/WebGL primitives); the rest in PR 1:"
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
			"data-language": "tsx",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#D73A49" },
						children: "import"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: " {"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  Xterm,                "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// the component: lifecycle + addons + WebGL + fit, in JSX form (PR 2)"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  createXtermLifecycle, "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// the primitive under it, for a non-JSX composition (PR 2)"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  attachWebGL,          "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// single-owner WebglAddon lifetime + context-loss recovery (PR 2)"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  createRenderRecovery, "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// forced sync repaint when the rAF paint loop parks"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  wireScrollIntent,     "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// DOM wheel/pointer wiring for the core scroll lock"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  createScrollLock,     "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// freeze-while-reading latch; buffered writes keep their callbacks"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  enableSoftKeyboardInput, "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// iOS contenteditable soft-keyboard surface"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  isCoarsePointer,      "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// pointer:coarse media query (the touch gate)"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "} "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "from"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"@kolu/xterm-kit/solid\""
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
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "createScrollLock(enabled)" }) }),
				" lives here, not on the core root, because it is\n",
				createVNode(_components.code, { children: "solid" }),
				"-reactive today (its latch and buffered-write queue are ",
				createVNode(_components.code, { children: "createSignal" }),
				"s /\n",
				createVNode(_components.code, { children: "createEffect" }),
				"s) and the core root must stay free of ",
				createVNode(_components.code, { children: "solid-js" }),
				" so kaval’s daemon\nnever vendors it. It exists because live output and a user reading scrollback\nfight over the same viewport: it buffers writes while the user is scrolled up\nand — the load-bearing part — preserves each buffered chunk’s parse callback\nacross the flush, which lets a snapshot’s re-seed committer survive the\nlock.",
				createVNode($$Footnote, { children: [
					"The reactivity is ",
					createVNode(_components.em, { children: "incidental" }),
					", not intrinsic — the logic is a\nbuffering latch, not a rendering concern. A future framework-neutral rewrite\n(plain callbacks over ",
					createVNode(_components.code, { children: "createSignal" }),
					") could return it to the runtime-neutral\ncore, but only with that named change; until then its home is ",
					createVNode(_components.code, { children: "/solid" }),
					" and the\nclosure-guard test keeps it there."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "<Xterm>" }) }),
				" exists so the whole hazard set is one JSX element (the\nhello-world above). Its ",
				createVNode(_components.code, { children: "onReady" }),
				" hands the consumer a handle —\n",
				createVNode(_components.code, { children: "{ terminal, container, addons: { fit, search, serialize }, write, scrollLock, hasWebgl, clearTextureAtlas }" }),
				" — inside the component’s reactive owner, so\npolicy wiring (kolu’s key handler, link provider, e2e ",
				createVNode(_components.code, { children: "__xterm" }),
				" bridge,\n",
				createVNode(_components.code, { children: "data-*" }),
				" attributes) registers cleanups that actually run."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "createXtermLifecycle(container, options)" }) }),
				" exists because the\nawait-the-font construction is where the owner is lost: it owns the\ncapture-owner / ",
				createVNode(_components.code, { children: "runWithOwner" }),
				" / synchronous-teardown / ",
				createVNode(_components.code, { children: "disposed" }),
				"-bail\nchoreography once, for any consumer whose composition the component doesn’t\nfit."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "attachWebGL(terminal, should: Accessor<boolean>)" }) }),
				" exists because the\naddon’s lifetime has exactly one safe shape: single owner, self-heal on\ncontext loss, explicit ",
				createVNode(_components.code, { children: "loseContext()" }),
				" on unload. The gate is an accessor by\ntype — budget ",
				createVNode(_components.em, { children: "policy" }),
				" (kolu’s recency budget, a preference toggle, always-on)\nstays whatever the consumer computes."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "createRenderRecovery(term, visible)" }) }), " exists because Chromium parks the\nrAF loop under window occlusion and xterm’s paint silently freezes: it\nforces a synchronous repaint when buffered data outruns the last paint,\nkeyed to xterm’s parse, not stream receipt."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "wireScrollIntent(el, lock)" }) }), " exists to keep the scroll lock’s state\nmachine DOM-free: the wheel/pointer capture-hold-release rules live here,\nbeside the component, so the core stays runtime-neutral."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "mobile--the-touch-half-of-the-adapter",
			children: "Mobile — the touch half of the adapter"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The plan’s first draft had no mobile lens (srid’s review added it), and the\ngap was real: the client carries touch machinery that is adapter-grade, not\nkolu chrome. xterm 6.0 ships ",
			createVNode(_components.strong, { children: "no touch support" }),
			" — the types exist, the\nwiring doesn’t, and the WebGL canvas swallows touch events — so everything a\nterminal does on a phone, kolu hand-built inside Terminal.tsx. The\nadapter-grade parts join ",
			createVNode(_components.code, { children: "/solid" }),
			":"
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
			"data-language": "tsx",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#D73A49" },
						children: "import"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: " {"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  enableSoftKeyboardInput, "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// contenteditable input surface — the iOS quirk knowledge, in one place"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  wireTouchTaps,           "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// tap-vs-scroll discrimination; `onTap` is the policy hook"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  wireTouchScroll,         "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// touch → scrollback bridge (xterm ships none); arms the scroll lock"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "} "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "from"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"@kolu/xterm-kit/solid\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// `<Xterm>` composes all three on touch devices"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Touch intent and the soft-keyboard focus rules join as owned mechanism —\nwith exactly one policy hook." }),
				" The mechanism is browser-quirk knowledge\nend to end: ",
				createVNode(_components.code, { children: "preventDefault" }),
				" on pointerdown to stop the focus shuffle iOS\nSafari rejects, focus deferred to pointerup inside the user-gesture window,\na tap-sized movement threshold so scrolls never summon the keyboard, and\nthe rule that on touch the keyboard rises ",
				createVNode(_components.em, { children: "only" }),
				" from an explicit tap —\nnever from a tile switch or reveal (",
				createVNode(_components.code, { children: "focusOnSelection" }),
				" is a deliberate\nno-op on touch).",
				createVNode($$Footnote, { children: [
					"All shipped behavior: the focus-is-a-no-op rule\n(",
					createVNode($$Cite, {
						file: "packages/client/src/terminal/Terminal.tsx",
						lines: "169-176"
					}),
					")\nand the tap surface\n(",
					createVNode($$Cite, {
						file: "packages/xterm-kit/src/solid/touch.ts",
						lines: "38-75"
					}),
					" —\nthe ",
					createVNode(_components.code, { children: "TAP_THRESHOLD_PX" }),
					" discrimination and the pointerup gesture window; the\ncontenteditable input via\n",
					createVNode($$Cite, { file: "packages/xterm-kit/src/solid/softKeyboardInput.ts" }),
					"). That is\nvolatility, not product choice — which is why it’s owned, not\nhook-provided."
				] }),
				" The one ",
				createVNode(_components.em, { children: "domain" }),
				" decision in the gesture — what a\ntap on content means (kolu: follow a ",
				createVNode(_components.code, { children: "path:line" }),
				" ref into the Code tab,\nelse focus-to-type) — is the ",
				createVNode(_components.code, { children: "onTap" }),
				" hook, threaded through ",
				createVNode(_components.code, { children: "<Xterm>" }),
				" as a\nprop."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"The touch divisor was a hand-rolled parallel of a fact xterm already owns —\nPR 2 (",
					createVNode($$PrLink, { pr: 1808 }),
					") deleted it."
				] }),
				" One invariant — pointer→cell under a\nCSS transform — used to be computed by ",
				createVNode(_components.strong, { children: "two separate divisors" }),
				": xterm’s\nhit-test path (its font-metric cell mapping, the authority that actually places\nthe glyphs, corrected on the ",
				createVNode(_components.em, { children: "input" }),
				" by ",
				createVNode(_components.code, { children: "unscaleEventPoint" }),
				"), and the tap path’s\n",
				createVNode(_components.code, { children: "fileRefAtPoint" }),
				", which derived its OWN cell size from the post-transform rect\n(",
				createVNode(_components.code, { children: "rect.width / cols" }),
				"). They agreed only when xterm’s internal cell equalled\n",
				createVNode(_components.code, { children: "rect.width / cols" }),
				" — which nothing guarantees: font-metric rounding, sub-pixel,\nor screen padding can make a tap near a cell boundary resolve to a ",
				createVNode(_components.em, { children: "different" }),
				"\ncell under zoom. So the rect-derived divisor was a hand-rolled parallel of the\nexisting source of truth. PR 2 added ",
				createVNode(_components.code, { children: "cellAtPoint" }),
				" to ",
				createVNode(_components.code, { children: "/internals" }),
				" (the single\npointer→cell authority, a cosmetic read that degrades to null) and routes the\ntap through it, ",
				createVNode(_components.strong, { children: "deleting" }),
				" the rect divisor and the mirrored ",
				createVNode(_components.em, { children: "“keep both in\nstep”" }),
				" fence warnings that guarded the pair.",
				createVNode($$Footnote, { children: [
					"The tap resolver now lives\nin ",
					createVNode(_components.code, { children: "Terminal.tsx" }),
					"’s ",
					createVNode(_components.code, { children: "onTap" }),
					" (via ",
					createVNode(_components.code, { children: "cellAtPoint" }),
					"), and ",
					createVNode(_components.code, { children: "internals.ts" }),
					" records the\nhistory in past tense — the single divisor is ",
					createVNode(_components.code, { children: "unscaleEventPoint" }),
					" +\n",
					createVNode(_components.code, { children: "getCoords" }),
					", shared by selection, hover, and the tap\n(",
					createVNode($$Cite, { file: "packages/xterm-kit/src/internals.ts" }),
					")."
				] }),
				" Its\ndone-criterion was ",
				createVNode(_components.em, { children: "correctness" }),
				", not equivalence — a tap resolves to the cell\nthe user visually tapped, under a CSS transform — proven by a standard-suite\nbrowser e2e. No user-observed regression surfaced, so it landed as the\nreuse-the-source-of-truth dedup rather than a bug fix."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The e2e proves it under a transform, but NOT in the literal desktop-zoom\nquadrant — because Chromium cannot emulate that quadrant (do not re-attempt\nit)." }),
				" The real state the tap-under-zoom guards is a touch tap on the ",
				createVNode(_components.em, { children: "desktop\ncanvas’s zoomed tile" }),
				", which needs a coarse-PRIMARY pointer that can ",
				createVNode(_components.em, { children: "hover" }),
				"\n(",
				createVNode(_components.code, { children: "isTouch" }),
				" wires the tap; ",
				createVNode(_components.code, { children: "handheld = coarse ∧ hover:none" }),
				" being false mounts\nthe canvas). Chromium welds pointer↔hover to touch capability: ",
				createVNode(_components.strong, { children: ["coarse ⟺ touch\n⟺ ", createVNode(_components.code, { children: "hover:none" })] }),
				". A two-run CI oracle proved both directions — with Playwright\n",
				createVNode(_components.code, { children: "hasTouch" }),
				" the media is ",
				createVNode(_components.code, { children: "{coarse, hover:none}" }),
				"; without it, ",
				createVNode(_components.code, { children: "{fine, hover}" }),
				"; and\nCDP ",
				createVNode(_components.code, { children: "setEmulatedMedia" }),
				"’s ",
				createVNode(_components.code, { children: "pointer" }),
				"/",
				createVNode(_components.code, { children: "hover" }),
				" features had ",
				createVNode(_components.em, { children: "no effect" }),
				" (pure device\ndefaults). So ",
				createVNode(_components.code, { children: "(pointer:coarse) and (hover:hover)" }),
				" is unconstructable, and the\ngate instead runs in the reachable ",
				createVNode(_components.code, { children: "@mobile" }),
				" touch config with an ",
				createVNode(_components.strong, { children: "injected" }),
				"\nCSS ",
				createVNode(_components.code, { children: "scale()" }),
				" standing in for the tile-zoom transform. That is honest, not a\ncheat: ",
				createVNode(_components.code, { children: "cellAtPoint" }),
				" reads the scale off ",
				createVNode(_components.code, { children: "getBoundingClientRect" }),
				"/",
				createVNode(_components.code, { children: "offsetWidth" }),
				",\nso the transform’s ",
				createVNode(_components.em, { children: "source" }),
				" is transparent to the code under test — the exact\ntap path runs under a real CSS transform. It is corroborated by\n",
				createVNode(_components.code, { children: "canvas-selection.feature" }),
				" (the ",
				createVNode(_components.em, { children: "same" }),
				" ",
				createVNode(_components.code, { children: "unscaleEventPoint" }),
				" + ",
				createVNode(_components.code, { children: "getCoords" }),
				"\nauthority under real canvas zoom, for selection) and the ",
				createVNode(_components.code, { children: "cellAtPoint" }),
				" unit\ndelegation pin. A future reviewer should NOT try to build the desktop-zoom\nquadrant in e2e — it is a browser-emulation limit, not a missing test."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "stickyModifiers" }), " stays out — the boundary test, applied honestly."] }),
				" It\nnever touches a ",
				createVNode(_components.code, { children: "Terminal" }),
				": it is an arming latch over\n",
				createVNode(_components.code, { children: "@kolu/terminal-protocol" }),
				"’s control/meta byte tables, armed by kolu’s\nMobileKeyBar and folded into outgoing input. The volatility it leans on\n(PTY chord encoding) is already owned by ",
				createVNode(_components.code, { children: "terminal-protocol" }),
				"; nothing\nxterm-shaped remains to encapsulate. A leaf beside the key bar, not kit\nmaterial (",
				createVNode($$Cite, { file: "packages/client/src/terminal/stickyModifiers.ts" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"IME/composition routing is adapter-level; its machinery lands here once\n",
					createVNode($$PrLink, { pr: 1634 }),
					" merges — open today, not shipped."
				] }),
				" Android soft\nkeyboards replay autocorrect and suggestion state through xterm’s\nprose-oriented helper textarea (the ",
				createVNode(_components.code, { children: "keyCode=229" }),
				" diff path); the open PR\nroutes input through a hidden ",
				createVNode(_components.code, { children: "type=password" }),
				" transport with a zero-width\nsentinel, forwarding ",
				createVNode(_components.code, { children: "beforeinput" }),
				" as raw data. That is soft-keyboard +\nxterm-internals knowledge with zero kolu domain — the kit’s mobile surface\nis its home when it lands, and this plan reserves the slot rather than\nclaiming the ship."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"What stays kolu: ",
			createVNode(_components.strong, { children: "MobileKeyBar and the mobile chrome" }),
			" (sheets, pull chrome,\nthe mobile tile view) are pure policy — which keys a phone deserves and what\nthe chrome looks like — plus the tap→file-ref decision via ",
			createVNode(_components.code, { children: "onTap" }),
			", and the\nsticky-modifier arming above."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Two interplays are already handled, recorded so mobile doesn’t re-open them:\nraising the soft keyboard is a ",
			createVNode(_components.strong, { children: "rows-only" }),
			" resize, and the backfill\ncontroller pauses only on a ",
			createVNode(_components.em, { children: "cols" }),
			" change — so the keyboard no longer stales\nbackfill (the ",
			createVNode($$PrLink, { pr: 1783 }),
			" family-3\nfix",
			createVNode($$Footnote, { children: [createVNode($$Cite, {
				file: "packages/xterm-kit/src/scrollbackBackfill.ts",
				lines: "657-666"
			}), " —\n“a height-only change is harmless”; a width reflow is what invalidates the\nabsolute cursor."] }),
			"); and momentum-scroll flinging the viewport into\nthe trigger band mid-backfill was a named spike risk, covered by the\ncontroller’s in-flight serialization and generation guards."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "deliberately-not-exported",
			children: "Deliberately not exported"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The package refuses to learn: ",
			createVNode(_components.strong, { children: "wire and frame types" }),
			" (padi’s attach schema,\n",
			createVNode(_components.code, { children: "TERMINAL_RESET" }),
			", oRPC anything), ",
			createVNode(_components.strong, { children: "host semantics and metadata" }),
			" (cwd, git,\nagents), ",
			createVNode(_components.strong, { children: "keybinding policy" }),
			" (actions, prohibited chords), ",
			createVNode(_components.strong, { children: "theme values" }),
			"\n(it takes an ",
			createVNode(_components.code, { children: "ITheme" }),
			", never defines one), ",
			createVNode(_components.strong, { children: "activity semantics" }),
			" (what counts\nas “live”), the ",
			createVNode(_components.strong, { children: "WebGL budget policy" }),
			" (which panes deserve a context), and\nkolu’s ",
			createVNode(_components.strong, { children: "diagnostics registry and e2e bridge" }),
			". Each is a “which bytes and\nwhen” concern — the consumer’s policy half, per the diagram."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-migration--two-prs",
			children: "The migration — two PRs"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The first draft planned one PR. Grounding the build against the installed system\nsplit it, on ",
			createVNode(_components.strong, { children: "evidence class" }),
			": what is behavior-neutral ships now, proven by the\nmoved suites staying green plus two-platform CI; what changes on-screen behavior\nis its own immediate fast-follow, proven by e2e. One PR carrying both classes\nleaves its headline half-proven; two PRs each prove their own claim completely.\nThe split is not decomposition theater — the hard volatility graduates whole in\nPR 1 and both consumers rest on it; PR 2 is ergonomics over already-graduated\nprimitives, a leaf that may follow."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "pr-1--graduate-the-volatility-behavior-neutral",
			children: "PR 1 — graduate the volatility (behavior-neutral)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The pinned internals, the fail-loud buffer surgery, the mirror anchoring, and the\nhardened write path move into the package, and both consumers import them. No\non-screen behavior changes: ",
			createVNode(_components.code, { children: "Terminal.tsx" }),
			" still constructs its terminal inline,\nnow from the kit’s primitives — the ",
			createVNode(_components.code, { children: "<Xterm>" }),
			" wrapper is PR 2."
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Create the package" }),
				" — ",
				createVNode(_components.code, { children: "packages/xterm-kit/" }),
				", ",
				createVNode(_components.code, { children: "package.json" }),
				" modeled on\n",
				createVNode(_components.code, { children: "@kolu/solid-statepip" }),
				", exports map ",
				createVNode(_components.code, { children: "." }),
				" / ",
				createVNode(_components.code, { children: "./backfill" }),
				" / ",
				createVNode(_components.code, { children: "./internals" }),
				" /\n",
				createVNode(_components.code, { children: "./solid" }),
				". ",
				createVNode(_components.code, { children: "solid-js" }),
				" is a peer of the ",
				createVNode(_components.code, { children: "/solid" }),
				" entry only. The xterm versions\nkeep the single root pnpm-overrides pin — scratch and live ",
				createVNode(_components.code, { children: "BufferLine" }),
				" shapes\nmust match, so one workspace-wide version is a correctness requirement."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Move the core verbatim" }),
				": ",
				createVNode(_components.code, { children: "scrollbackBackfill.ts" }),
				" (+ its ",
				createVNode(_components.code, { children: "CONTRACT PIN" }),
				"\nsuite), ",
				createVNode(_components.code, { children: "snapshotBoundary.ts" }),
				" (+ test), ",
				createVNode(_components.code, { children: "scrollLock.ts" }),
				" (+ test) from the\nclient; ",
				createVNode(_components.code, { children: "xtermInternals.ts" }),
				" (+ test) becomes ",
				createVNode(_components.code, { children: "./internals" }),
				";\n",
				createVNode(_components.code, { children: "xtermMirrorContract.test.ts" }),
				" from kaval. Zero semantic edits in moved files."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["Lift ", createVNode(_components.code, { children: "createMirrorAnchor" })] }),
				" out of ",
				createVNode(_components.code, { children: "ptyHost.ts" }),
				" (",
				createVNode(_components.code, { children: "normalLinesOf" }),
				", the trim\nhandler, the RIS identity re-anchor, the ",
				createVNode(_components.code, { children: "reflowEpoch" }),
				" bump, ",
				createVNode(_components.code, { children: "snapToWrapHead" }),
				")\nand re-point kaval onto it — the one non-mechanical change, behavior-identical\nby construction, gated on kaval’s existing suites (",
				createVNode(_components.code, { children: "ptyHostHistory.test.ts" }),
				"\ncovers eviction, RIS, and history paging)."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Re-point both consumers" }), " onto the kit — client and kaval, import paths only."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Prove the teeth" }), ": typecheck drives the re-point; deliberately break one\npinned symbol and watch the package’s vitest lane go red before merge."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Two corrections the first draft got wrong, each ",
			createVNode(_components.strong, { children: "grounded against the installed\nsystem" }),
			" (not deduced) and pinned by a closure-guard test that walks the root\nbarrel’s import graph:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "kaval runs from TS source under tsx (eager ESM, no tree-shaking)." }),
				" So a\nmodule the root barrel re-exports is ",
				createVNode(_components.em, { children: "loaded" }),
				" by the daemon, whichever symbol it\nimports. ",
				createVNode(_components.code, { children: "createScrollLock" }),
				" is ",
				createVNode(_components.code, { children: "solid" }),
				"-reactive, so it moved to ",
				createVNode(_components.code, { children: "/solid" }),
				" (the\nroot must stay solid-free); and a static ",
				createVNode(_components.code, { children: "import { Terminal } from \"@xterm/xterm\"" }),
				"\n",
				createVNode(_components.strong, { children: "crashes" }),
				" Node’s cjs-module-lexer under tsx (",
				createVNode(_components.em, { children: "“does not provide an export named\n‘Terminal’”" }),
				"), so the ",
				createVNode(_components.code, { children: "@xterm/xterm" }),
				"-constructing backfill write path moved\nbehind ",
				createVNode(_components.code, { children: "/backfill" }),
				". The root barrel is now genuinely what it claims — runtime-\nneutral, daemon-safe — and the closure guard turns any future misclassification\ninto red CI rather than a broken daemon (superseding the first draft’s\nconditional ",
				createVNode(_components.code, { children: "./scratch" }),
				" containment)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"kaval’s currency slice treats ",
				createVNode(_components.code, { children: "@kolu/xterm-kit" }),
				" as a ",
				createVNode(_components.strong, { children: "stable leaf" }),
				", like the\ndaemon spine: the anchor’s kaval-relevant behavioral surface is\n",
				createVNode(_components.code, { children: "PTY_HOST_CONTRACT_VERSION" }),
				" (hashed in kaval), so a wire-breaking anchor change\nrides the contract bump while a ",
				createVNode(_components.code, { children: "/solid" }),
				" or ",
				createVNode(_components.code, { children: "/backfill" }),
				" change never recycles a\nlive PTY."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "pr-2--the-xterm-wrapper--the-divisor-fix-e2e-gated-immediate-fast-follow",
			children: [
				"PR 2 — the ",
				createVNode(_components.code, { children: "<Xterm>" }),
				" wrapper + the divisor fix (e2e-gated, immediate fast-follow)"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Started as soon as PR 1 ships, same owner, its tests written into the standard e2e\nsuite (",
			createVNode(_components.code, { children: "packages/tests/features/*" }),
			", which runs on the standing two-platform\nlanes — no special infrastructure)."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The component cut." }),
				" ",
				createVNode(_components.code, { children: "Terminal.tsx" }),
				"’s ~700-line ",
				createVNode(_components.code, { children: "onMount" }),
				" becomes the policy\nhalf consuming ",
				createVNode(_components.code, { children: "<Xterm onReady onTap>" }),
				": the font-wait/owner/",
				createVNode(_components.code, { children: "disposed" }),
				"-bail\nchoreography becomes ",
				createVNode(_components.code, { children: "createXtermLifecycle" }),
				"; ",
				createVNode(_components.code, { children: "loadWebgl" }),
				"/",
				createVNode(_components.code, { children: "unloadWebgl" }),
				" become\n",
				createVNode(_components.code, { children: "attachWebGL" }),
				"; the touch machinery becomes ",
				createVNode(_components.code, { children: "wireTouchTaps" }),
				"/",
				createVNode(_components.code, { children: "wireTouchScroll" }),
				"\n(",
				createVNode(_components.code, { children: "enableSoftKeyboardInput" }),
				", ",
				createVNode(_components.code, { children: "createRenderRecovery" }),
				", ",
				createVNode(_components.code, { children: "wireScrollIntent" }),
				" already\nmoved in PR 1). The ",
				createVNode(_components.code, { children: "__xterm" }),
				" e2e bridge, ",
				createVNode(_components.code, { children: "data-*" }),
				" attributes, keybindings,\npaste/drop, MobileKeyBar + sticky modifiers, and diagnostics all stay, so\ncucumber steps are untouched."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The divisor fix." }),
				" Delete the tap path’s hand-rolled ",
				createVNode(_components.code, { children: "rect.width / cols" }),
				"\ndivisor and route the tap through xterm’s font-metric mapping in ",
				createVNode(_components.code, { children: "/internals" }),
				" —\nthe one authority that places the glyphs. This is a ",
				createVNode(_components.strong, { children: "behavior change" }),
				" (see the\nMobile section): its done-criterion is ",
				createVNode(_components.em, { children: "correctness" }),
				", not equivalence to today —\na tap resolves to the cell the user visually tapped, at normal scale AND under\nzoom. If the e2e shows today’s taps already mis-target under zoom, an issue is\nfiled when PR 1 ships so the symptom is on record before its fix."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Its gate is the ",
			createVNode(_components.code, { children: "@touch-desktop" }),
			" tap-under-zoom e2e (that the extracted touch tap\nstill lands on the visually-tapped cell, at normal scale and under zoom) plus the\n123 client terminal unit tests staying green UNMODIFIED — the behavior-neutral\nproof for the policy surrounding the split. WebGL context-loss recovery\n(",
			createVNode(_components.code, { children: "webgl.ts" }),
			"’s self-heal) and owner-correct async dispose (the lifecycle’s\nowner-capture-before-await + LIFO cleanup) carry ",
			createVNode(_components.strong, { children: "no" }),
			" dedicated unit test —\nthey are preserved as behavior-identical extracted logic, held to correctness by\nreview + typecheck and the leak-invariant argument spelled out in this note, not\nby an automated scenario."
		] }),
		"\n",
		createVNode(_components.p, { children: "Risks (PR 1 unless noted):" }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "#" }),
					"\n",
					createVNode(_components.th, { children: "risk" }),
					"\n",
					createVNode(_components.th, { children: "mitigation" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "1" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "The Terminal.tsx split line drifts" }), " (PR 2) — a policy line crosses in, or a hazard stays behind."] }),
					"\n",
					createVNode(_components.td, { children: [
						"One review question per moved line: ",
						createVNode(_components.em, { children: "does it know which bytes, which host, which keybind?" }),
						" Yes → stays. The diagram’s stays-lists are the checklist."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "2" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Import-churn breadth" }), " across client and kaval hides a semantic edit."] }),
					"\n",
					createVNode(_components.td, { children: [
						"Moved files are byte-identical (",
						createVNode(_components.code, { children: "git mv" }),
						"); the only edited lines are import paths. Typecheck is the linter; the moved + kaval suites are the behavior gate."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "3" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Test relocation loses CI teeth" }), " — a moved contract pin the unit lane no longer runs."] }),
					"\n",
					createVNode(_components.td, { children: [
						"The package registers ",
						createVNode(_components.code, { children: "test:unit" }),
						" like every workspace package (the lane runs all workspaces), proven by the deliberate-red rehearsal."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "4" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "The mirror-anchor lift regresses a hot daemon path" }), " (attach, history paging, RIS under load)."] }),
					"\n",
					createVNode(_components.td, { children: [
						"Extract-and-delegate, no logic change; kaval’s ",
						createVNode(_components.code, { children: "ptyHost.test.ts" }),
						" + ",
						createVNode(_components.code, { children: "ptyHostHistory.test.ts" }),
						" are the oracle and stay green untouched."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "5" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "The daemon imports a browser/solid dependency it can’t run" }), " (tsx eager ESM)."] }),
					"\n",
					createVNode(_components.td, { children: [
						"Resolved structurally: ",
						createVNode(_components.code, { children: "/backfill" }),
						" and ",
						createVNode(_components.code, { children: "/solid" }),
						" hold the browser/solid code; the root is daemon-safe and ",
						createVNode(_components.code, { children: "noSolidInDaemon.test.ts" }),
						" fails CI if either leaks back."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "6" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "The WebGL gate crosses as a stale boolean" }), " (PR 2)."] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "attachWebGL" }),
						" takes ",
						createVNode(_components.code, { children: "Accessor<boolean>" }),
						" in its signature; ",
						createVNode(_components.code, { children: "<Xterm>" }),
						"’s ",
						createVNode(_components.code, { children: "webgl" }),
						" prop is that accessor; no boolean overload exists to misuse."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "Two operational notes, for scope honesty:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Sharing a package with the daemon does not couple browser churn to PTY\nlifetimes." }),
				" A ",
				createVNode(_components.code, { children: "/solid" }),
				" (or ",
				createVNode(_components.code, { children: "/backfill" }),
				") change never recycles kaval: kaval\nrestarts only on its own ",
				createVNode(_components.code, { children: "PTY_HOST_CONTRACT_VERSION" }),
				" bump (the staleKey), never\non build drift — and the currency-slice leaf classification above enforces it."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"The core + ",
					createVNode(_components.code, { children: "/solid" }),
					" boundary is an ",
					createVNode(_components.em, { children: "enabler" }),
					" for per-binary nix source\nfiltering"
				] }),
				" — change-scoped build identity, where a ",
				createVNode(_components.code, { children: "/solid" }),
				"-only edit wouldn’t\ndirty the daemon’s build input. That opportunity pre-exists this refactor and it\ndeliberately does not take it on."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Done, PR 1:" }),
			" both consumers compile against the package, the contract-pin\nrehearsal has been seen red then green, kaval’s suites and the client suite pass\nunmodified, the closure guard is green, and the ",
			createVNode(_components.a, {
				href: "electricity.html",
				children: "electricity ledger"
			}),
			"’s\nrow flips from “to build” to done. ",
			createVNode(_components.strong, { children: "Done, PR 2:" }),
			" ",
			createVNode(_components.code, { children: "Terminal.tsx" }),
			" consumes\n",
			createVNode(_components.code, { children: "<Xterm>" }),
			", the touch tap routes through the single-authority divisor (guarded by\nthe ",
			createVNode(_components.code, { children: "@touch-desktop" }),
			" tap-under-zoom e2e), and the 123 client terminal unit tests\nstay green unmodified."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "xterm-kit — Graduating Kolu's xterm Machinery",
	"description": "Plan of record for a core + /solid package that owns xterm's hazards — pinned internals with two failure philosophies, buffer surgery, the hardened write path, mirror anchoring, and the SolidJS adapter — with kaval and the client as two consumers from day one.",
	"parents": ["feature"],
	"status": "implemented",
	"maturity": "seedling",
	"updated": "2026-07-13T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-a-consumer-gets",
			"text": "What a consumer gets"
		},
		{
			"depth": 2,
			"slug": "the-package-boundary",
			"text": "The package boundary"
		},
		{
			"depth": 3,
			"slug": "the-name--decided-koluxterm-kit",
			"text": "The name — decided: @kolu/xterm-kit"
		},
		{
			"depth": 2,
			"slug": "the-public-api",
			"text": "The public API"
		},
		{
			"depth": 3,
			"slug": "core--koluxterm-kit-and-internals",
			"text": "Core — @kolu/xterm-kit and /internals"
		},
		{
			"depth": 3,
			"slug": "solid--the-browser-adapter",
			"text": "/solid — the browser adapter"
		},
		{
			"depth": 3,
			"slug": "mobile--the-touch-half-of-the-adapter",
			"text": "Mobile — the touch half of the adapter"
		},
		{
			"depth": 3,
			"slug": "deliberately-not-exported",
			"text": "Deliberately not exported"
		},
		{
			"depth": 2,
			"slug": "the-migration--two-prs",
			"text": "The migration — two PRs"
		},
		{
			"depth": 3,
			"slug": "pr-1--graduate-the-volatility-behavior-neutral",
			"text": "PR 1 — graduate the volatility (behavior-neutral)"
		},
		{
			"depth": 3,
			"slug": "pr-2--the-xterm-wrapper--the-divisor-fix-e2e-gated-immediate-fast-follow",
			"text": "PR 2 — the <Xterm> wrapper + the divisor fix (e2e-gated, immediate fast-follow)"
		}
	];
}
var url = "src/content/atlas/xterm-kit.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/xterm-kit.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/xterm-kit.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
