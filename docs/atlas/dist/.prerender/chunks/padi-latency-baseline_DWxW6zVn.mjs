import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
import { t as $$Footnote } from "./Footnote_Co54bi9w.mjs";
//#region src/diagrams/padi-latency-baseline-path.svg?raw
var padi_latency_baseline_path_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 760 300\" font-family=\"ui-sans-serif, system-ui, sans-serif\" font-size=\"13\">\n  <defs>\n    <marker id=\"arr\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0,0 L10,5 L0,10 z\" fill=\"#8b94a6\" />\n    </marker>\n    <marker id=\"arrEcho\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0,0 L10,5 L0,10 z\" fill=\"#7ec699\" />\n    </marker>\n  </defs>\n\n  <!-- nodes -->\n  <g text-anchor=\"middle\">\n    <rect x=\"20\"  y=\"120\" width=\"130\" height=\"60\" rx=\"9\" fill=\"#141a2b\" stroke=\"#3a4666\"/>\n    <text x=\"85\"  y=\"146\" fill=\"#c8d0de\" font-weight=\"600\">client probe</text>\n    <text x=\"85\"  y=\"165\" fill=\"#8b94a6\" font-size=\"11\">Node · /rpc/ws</text>\n\n    <rect x=\"315\" y=\"120\" width=\"130\" height=\"60\" rx=\"9\" fill=\"#141a2b\" stroke=\"#3a4666\"/>\n    <text x=\"380\" y=\"146\" fill=\"#c8d0de\" font-weight=\"600\">kolu-server</text>\n    <text x=\"380\" y=\"165\" fill=\"#8b94a6\" font-size=\"11\">padiSurface</text>\n\n    <rect x=\"610\" y=\"120\" width=\"130\" height=\"60\" rx=\"9\" fill=\"#141a2b\" stroke=\"#3a4666\"/>\n    <text x=\"675\" y=\"142\" fill=\"#c8d0de\" font-weight=\"600\">kaval → PTY</text>\n    <text x=\"675\" y=\"161\" fill=\"#8b94a6\" font-size=\"11\">line-discipline</text>\n    <text x=\"675\" y=\"175\" fill=\"#8b94a6\" font-size=\"11\">echo</text>\n  </g>\n\n  <!-- write path (top) -->\n  <line x1=\"150\" y1=\"138\" x2=\"315\" y2=\"138\" stroke=\"#8b94a6\" stroke-width=\"2\" marker-end=\"url(#arr)\"/>\n  <line x1=\"445\" y1=\"138\" x2=\"610\" y2=\"138\" stroke=\"#8b94a6\" stroke-width=\"2\" marker-end=\"url(#arr)\"/>\n  <text x=\"232\" y=\"128\" text-anchor=\"middle\" fill=\"#8b94a6\" font-size=\"11\">sendInput</text>\n\n  <!-- echo path (bottom) -->\n  <line x1=\"610\" y1=\"162\" x2=\"445\" y2=\"162\" stroke=\"#7ec699\" stroke-width=\"2\" marker-end=\"url(#arrEcho)\"/>\n  <line x1=\"315\" y1=\"162\" x2=\"150\" y2=\"162\" stroke=\"#7ec699\" stroke-width=\"2\" marker-end=\"url(#arrEcho)\"/>\n  <text x=\"232\" y=\"182\" text-anchor=\"middle\" fill=\"#7ec699\" font-size=\"11\">terminalAttach delta</text>\n\n  <!-- clock markers -->\n  <g text-anchor=\"middle\">\n    <circle cx=\"150\" cy=\"138\" r=\"6\" fill=\"#e6a23c\"/>\n    <text x=\"150\" y=\"96\" fill=\"#e6a23c\" font-weight=\"700\">t0</text>\n    <text x=\"150\" y=\"80\" fill=\"#8b94a6\" font-size=\"11\">clock starts</text>\n\n    <circle cx=\"150\" cy=\"162\" r=\"6\" fill=\"#7ec699\"/>\n    <text x=\"150\" y=\"228\" fill=\"#7ec699\" font-weight=\"700\">t1</text>\n    <text x=\"150\" y=\"244\" fill=\"#8b94a6\" font-size=\"11\">clock stops</text>\n  </g>\n\n  <!-- W2.2 hop insertion -->\n  <g>\n    <line x1=\"527\" y1=\"60\" x2=\"527\" y2=\"240\" stroke=\"#a78bfa\" stroke-width=\"1.5\" stroke-dasharray=\"5 4\"/>\n    <rect x=\"452\" y=\"40\" width=\"150\" height=\"22\" rx=\"6\" fill=\"#221b3a\" stroke=\"#a78bfa\"/>\n    <text x=\"527\" y=\"55\" text-anchor=\"middle\" fill=\"#c9b8ff\" font-size=\"11\">W2.2 inserts padi here</text>\n    <text x=\"527\" y=\"262\" text-anchor=\"middle\" fill=\"#8b94a6\" font-size=\"11\">both clock points sit on the near (client) side of this hop</text>\n  </g>\n</svg>\n";
//#endregion
//#region src/content/atlas/padi-latency-baseline.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		li: "li",
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
			createVNode(_components.strong, { children: "The number W2.2 has to beat." }),
			" ",
			createVNode(_components.a, {
				href: "padi.html",
				children: "padi"
			}),
			" W2.2 slips a whole new process\n— padi — ",
			createVNode(_components.em, { children: "between" }),
			" kolu-server and kaval, so every keystroke gains a hop. The plan\nbudgets that hop at ",
			createVNode(_components.strong, { children: "< 5ms added p99" }),
			" and says the ceiling is measured, not\nguessed: W1 (",
			createVNode($$PrLink, { pr: 1652 }),
			") owes a baseline of today’s echo latency, and\nW2.2’s done-criterion (e) compares against it. This note is that baseline — what we\nmeasure, where the clock starts and stops, the box it ran on, the numbers, and the\none command that re-runs it identically."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: padi_latency_baseline_path_default,
			caption: "The measured path. The probe writes a keystroke (t0) via padiSurface.lifecycle.sendInput over kolu-server's /rpc/ws; the PTY line discipline echoes it; the echoed byte returns as a padiSurface.terminalAttach delta (t1). Both clock points sit on the client side of kolu-server's websocket — which is exactly where padi's future hop lands, so W2.2 re-running this probe measures the added cost and nothing else."
		}),
		"\n",
		createVNode(_components.h2, {
			id: "what-the-baseline-measures",
			children: "What the baseline measures"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"One keystroke’s full round-trip through the ",
			createVNode(_components.strong, { children: "real stack" }),
			", timed by a headless\nclient that speaks the same wire the browser does:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "t0 — the clock starts" }),
				" the instant the probe dispatches\n",
				createVNode(_components.code, { children: "padiSurface.lifecycle.sendInput({ id, data: <char> })" }),
				" over kolu-server’s\nwebsocket (",
				createVNode(_components.code, { children: "/rpc/ws" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The write travels kolu-server → kaval → PTY, where the shell’s line discipline\n",
				createVNode(_components.strong, { children: "echoes" }),
				" the typed character back.",
				createVNode($$Footnote, { children: "We type into a fresh shell’s line editor (readline), which echoes each character verbatim in raw mode — the same echo a user sees. The probe never sends a newline, so no command ever runs; between measurements it sends a Backspace so the input line stays one character wide and long-line redraws can’t pollute later samples." })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "t1 — the clock stops" }),
				" when that echoed character first appears in a\n",
				createVNode(_components.code, { children: "padiSurface.terminalAttach" }),
				" delta frame on the same websocket."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "latency = t1 − t0" }),
			", both read from ",
			createVNode(_components.strong, { children: "one process’s" }),
			" monotonic clock\n(",
			createVNode(_components.code, { children: "process.hrtime.bigint()" }),
			"), so absolute clock skew is irrelevant — only the delta\nmatters."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "important",
			title: "Why both clock points are on kolu-server's wire, not kaval's socket",
			children: createVNode(_components.p, { children: [
				"The comparability is the whole point, and it hinges on ",
				createVNode(_components.em, { children: "where" }),
				" we clock. W2.2\ninserts padi ",
				createVNode(_components.strong, { children: "between kolu-server and kaval" }),
				". A probe that dialled kaval’s unix\nsocket directly would sit on the far side of that future hop — it would measure a\npath W2.2 never changes and report a fake near-zero delta. Clocking ",
				createVNode(_components.code, { children: "sendInput" }),
				" →\n",
				createVNode(_components.code, { children: "terminalAttach" }),
				" over kolu-server’s ",
				createVNode(_components.code, { children: "/rpc/ws" }),
				" puts ",
				createVNode(_components.strong, { children: "both" }),
				" endpoints on the near\n(client) side of the new hop, so when W2.2 re-runs this identical probe, the whole\nadded cost of the padi process shows up in the difference. Like-for-like beats a\nprettier absolute number."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-measured-baseline",
			children: "The measured baseline"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Current master (",
			createVNode($$PrLink, { pr: 1652 }),
			" at merge — the padi domain served\n",
			createVNode(_components.strong, { children: "in-process" }),
			", no separate padi process yet), a nix-built kolu (",
			createVNode(_components.code, { children: ".#default" }),
			"), on a\nquiet ephemeral box with nothing else running. ",
			createVNode(_components.strong, { children: "2400 warm keystrokes" }),
			" (8 terminals\n× 300 measured, 50 warm-up discarded per terminal):"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "percentile" }),
					"\n",
					createVNode(_components.th, { children: "latency" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "p50" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "2.14 ms" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "p90" }),
					"\n",
					createVNode(_components.td, { children: "3.16 ms" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "p95" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "3.42 ms" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "p99" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "4.36 ms" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "min / mean / max" }),
					"\n",
					createVNode(_components.td, { children: "0.16 / 2.36 / 20.9 ms" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"A second independent run agreed within noise (p50 2.04, p95 3.45, ",
			createVNode(_components.strong, { children: "p99 4.21" }),
			" ms),\nso the percentiles are stable, not a lucky draw.",
			createVNode($$Footnote, { children: "Percentiles use the nearest-rank method on the ascending-sorted samples (the value at rank ⌈p/100·n⌉) — no interpolation, so the computation itself is deterministic and W2.2 compares like for like. The lone ~21 ms max is a single GC/scheduler outlier well outside p99." })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The box" }),
			" — recorded in the result JSON, so a re-run on a different box is never\nmistaken for the same conditions: ",
			createVNode(_components.code, { children: "pu" }),
			" ephemeral Incus container (NixOS), Intel\nCore i9-14900K, 32 logical CPUs, 125 GiB RAM, Linux 6.12.85 x86_64; kolu’s bundled\nNode v22.22.1; kolu built from master via ",
			createVNode(_components.code, { children: "nix build .#default" }),
			"."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "The budget this sets for W2.2",
			children: createVNode(_components.p, { children: [
				"W2.2’s added hop must keep p99 ",
				createVNode(_components.strong, { children: "within 5 ms of this baseline" }),
				" — i.e. a W2.2 p99\nunder ",
				createVNode(_components.strong, { children: "≈ 9.3 ms" }),
				" (baseline p99 ≈ 4.3 ms + 5 ms) ",
				createVNode(_components.strong, { children: "on the same box, same run" }),
				". If\nbreached, padi’s carve-out permits a raw-byte relay on the padi→kolu-server leg\n(no decode) without touching the contract."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "how-the-probe-drives-the-stack",
			children: "How the probe drives the stack"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The measurement is a small, reusable script — not a one-off — so W2.2 re-runs the\n",
			createVNode(_components.strong, { children: "identical" }),
			" method (bench + this note shipped in ",
			createVNode($$PrLink, { pr: 1660 }),
			"):"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "packages/server/bench/typingEchoLatency.ts" }) }),
				" — the client probe. It dials\n",
				createVNode(_components.code, { children: "ws://host:port/rpc/ws" }),
				" with Node’s global ",
				createVNode(_components.code, { children: "WebSocket" }),
				", wraps it in\n",
				createVNode(_components.code, { children: "@kolu/surface" }),
				"’s ",
				createVNode(_components.code, { children: "websocketLink" }),
				", then for each terminal: ",
				createVNode(_components.code, { children: "lifecycle.create({})" }),
				"\na bare shell, subscribe to ",
				createVNode(_components.code, { children: "terminalAttach" }),
				" (skipping the first frame, which is\nthe scrollback snapshot), and ping single keystrokes ",
				createVNode(_components.strong, { children: "serially" }),
				" — send one,\nwait for its echo, record, repeat. Serial by design: only one keystroke is ever\nin flight, so an echo can never be attributed to the wrong key."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "packages/server/bench/run.sh" }) }),
				" — the orchestrator. Boots a ",
				createVNode(_components.strong, { children: "private,\nisolated" }),
				" kolu (its own kaval via a throwaway ",
				createVNode(_components.code, { children: "$XDG_RUNTIME_DIR" }),
				" +\n",
				createVNode(_components.code, { children: "KOLU_KAVAL_SOCKET" }),
				", its own state dir, a throwaway ",
				createVNode(_components.code, { children: "$HOME" }),
				", an OS-assigned free\nport), waits for it to listen, runs the probe, and tears everything down. The\nprivate socket means kolu’s always-recycle can only ever reap ",
				createVNode(_components.em, { children: "its own" }),
				" kaval —\nit can never touch a production daemon."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Both live under ",
			createVNode(_components.code, { children: "packages/server/" }),
			" because the probe imports ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" and\n",
			createVNode(_components.code, { children: "ws" }),
			", which that package already depends on — no new dependency, no lockfile churn."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "re-running-it",
			children: "Re-running it"
		}),
		"\n",
		createVNode(_components.p, { children: "From a checkout, on a quiet box:" }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"plaintext\"><code><span class=\"line\"><span>just bench-typing-echo</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"That builds ",
			createVNode(_components.code, { children: ".#default" }),
			", boots the private server, runs the probe, prints the\npercentiles, and cleans up. Knobs (all optional) are environment variables:\n",
			createVNode(_components.code, { children: "KOLU_BENCH_SAMPLES" }),
			" (measured keystrokes per terminal), ",
			createVNode(_components.code, { children: "KOLU_BENCH_TERMINALS" }),
			",\n",
			createVNode(_components.code, { children: "KOLU_BENCH_WARMUP" }),
			", ",
			createVNode(_components.code, { children: "KOLU_BENCH_INTERKEY_MS" }),
			", ",
			createVNode(_components.code, { children: "KOLU_BENCH_OUT" }),
			" (write the full JSON,\nraw samples included), and ",
			createVNode(_components.code, { children: "KOLU_BENCH_BIN" }),
			" (point at a pre-built ",
			createVNode(_components.code, { children: "bin/kolu" }),
			" to skip\nthe nix build)."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "For an honest W2.2 comparison",
			children: createVNode(_components.p, { children: [
				"Run the baseline ",
				createVNode(_components.strong, { children: "and" }),
				" the W2.2 build back-to-back on the ",
				createVNode(_components.em, { children: "same" }),
				" freshly-provisioned\nquiet box, with the same ",
				createVNode(_components.code, { children: "KOLU_BENCH_*" }),
				" settings — the absolute numbers drift with\nCPU and load, so only a same-box A/B is a fair test of the added hop. Provision the box\nwith the ",
				createVNode(_components.code, { children: "/pu" }),
				" skill (this baseline ran on one); the box spec lands in the result JSON\neither way."
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
	"title": "Padi — Typing-Echo Latency Baseline",
	"description": "The W1 baseline owed by padi W1 (PR 1652) before W2.2 starts — keystroke→echo latency measured through the real stack on current master, both clock points on kolu-server's websocket so the padi hop W2.2 adds is measured honestly. Method, box spec, numbers, and how to re-run for the sub-5ms added-p99 budget.",
	"parents": ["padi", "reference"],
	"status": "implemented",
	"maturity": "seedling",
	"updated": "2026-07-02T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-the-baseline-measures",
			"text": "What the baseline measures"
		},
		{
			"depth": 2,
			"slug": "the-measured-baseline",
			"text": "The measured baseline"
		},
		{
			"depth": 2,
			"slug": "how-the-probe-drives-the-stack",
			"text": "How the probe drives the stack"
		},
		{
			"depth": 2,
			"slug": "re-running-it",
			"text": "Re-running it"
		}
	];
}
var url = "src/content/atlas/padi-latency-baseline.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/padi-latency-baseline.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/padi-latency-baseline.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
