import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Issue } from "./Issue_mLFqCJSR.mjs";
import { t as $$Phase } from "./Phase_Ctvqq2QS.mjs";
import { t as $$PhaseTree } from "./PhaseTree_DI8OxotU.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/diagrams/padi-architecture.svg?raw
var padi_architecture_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 960 620\" font-family=\"ui-monospace, SFMono-Regular, Menlo, monospace\" font-size=\"12\">\n  <defs>\n    <marker id=\"arr\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M 0 1 L 9 5 L 0 9 z\" fill=\"#8b94a6\"/>\n    </marker>\n    <marker id=\"arrg\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M 0 1 L 9 5 L 0 9 z\" fill=\"#7ec699\"/>\n    </marker>\n  </defs>\n  <rect width=\"960\" height=\"620\" fill=\"#0f1117\"/>\n\n  <!-- clients -->\n  <rect x=\"110\" y=\"16\" width=\"300\" height=\"56\" rx=\"8\" fill=\"#151823\" stroke=\"#2a3145\"/>\n  <text x=\"126\" y=\"38\" fill=\"#c8d0de\" font-size=\"13\" font-weight=\"600\">PWA window · view = local</text>\n  <text x=\"126\" y=\"58\" fill=\"#8b94a6\">canvas · dock · Code tab</text>\n\n  <rect x=\"550\" y=\"16\" width=\"300\" height=\"56\" rx=\"8\" fill=\"#151823\" stroke=\"#2a3145\"/>\n  <text x=\"566\" y=\"38\" fill=\"#c8d0de\" font-size=\"13\" font-weight=\"600\">PWA window · view = nix@prod</text>\n  <text x=\"566\" y=\"58\" fill=\"#8b94a6\">same client · other binding</text>\n\n  <line x1=\"260\" y1=\"72\" x2=\"260\" y2=\"124\" stroke=\"#8b94a6\" stroke-width=\"1.4\" marker-end=\"url(#arr)\"/>\n  <line x1=\"700\" y1=\"72\" x2=\"700\" y2=\"124\" stroke=\"#8b94a6\" stroke-width=\"1.4\" marker-end=\"url(#arr)\"/>\n  <text x=\"480\" y=\"102\" fill=\"#56b6c2\" text-anchor=\"middle\">per-connection binding — a switch swaps scopes, never a global rebind</text>\n\n  <!-- kolu-server -->\n  <rect x=\"100\" y=\"128\" width=\"760\" height=\"100\" rx=\"10\" fill=\"#131722\" stroke=\"#56b6c2\" stroke-width=\"1.2\"/>\n  <text x=\"120\" y=\"152\" fill=\"#56b6c2\" font-size=\"13\" font-weight=\"700\">kolu-server — the web shell (no terminal state)</text>\n  <text x=\"120\" y=\"172\" fill=\"#8b94a6\">HTTP · PWA · preferences · notification fan-in</text>\n  <text x=\"120\" y=\"192\" fill=\"#c8d0de\">bindings: <tspan fill=\"#7ec699\">local ●</tspan>  <tspan fill=\"#7ec699\">nix@prod ●</tspan>  <tspan fill=\"#5b6678\">pu-box-3 ○</tspan>  — adopt-or-spawn, never recycle</text>\n  <text x=\"120\" y=\"212\" fill=\"#8b94a6\">re-serve: <tspan fill=\"#7ec699\">values hold-open</tspan> · <tspan fill=\"#e6a23c\">delta streams fail-through</tspan></text>\n\n  <!-- links to hosts -->\n  <line x1=\"260\" y1=\"228\" x2=\"260\" y2=\"284\" stroke=\"#7ec699\" stroke-width=\"1.4\" marker-end=\"url(#arrg)\"/>\n  <text x=\"274\" y=\"260\" fill=\"#8b94a6\">unix socket</text>\n  <line x1=\"700\" y1=\"228\" x2=\"700\" y2=\"284\" stroke=\"#a78bfa\" stroke-width=\"1.4\" marker-end=\"url(#arr)\"/>\n  <text x=\"714\" y=\"252\" fill=\"#a78bfa\">ssh · frontDaemonOverStdio</text>\n  <text x=\"714\" y=\"270\" fill=\"#8b94a6\">Nix-provisioned</text>\n\n  <!-- local host -->\n  <rect x=\"55\" y=\"288\" width=\"415\" height=\"288\" rx=\"10\" fill=\"#0d0f15\" stroke=\"#222838\"/>\n  <text x=\"75\" y=\"310\" fill=\"#5b6678\" font-weight=\"600\">HOST · this machine</text>\n\n  <rect x=\"75\" y=\"320\" width=\"375\" height=\"132\" rx=\"8\" fill=\"#151823\" stroke=\"#7ec699\" stroke-width=\"1.2\"/>\n  <text x=\"91\" y=\"342\" fill=\"#7ec699\" font-size=\"13\" font-weight=\"700\">padi — the workspace authority</text>\n  <text x=\"91\" y=\"362\" fill=\"#c8d0de\">terminals (authored ⋈ snapshot)</text>\n  <text x=\"91\" y=\"380\" fill=\"#c8d0de\">the ONE fold + memory — host clock</text>\n  <text x=\"91\" y=\"398\" fill=\"#c8d0de\">lifecycle · fs/git · bytes · restore</text>\n  <text x=\"91\" y=\"416\" fill=\"#c8d0de\">session store · supervises kaval</text>\n  <text x=\"91\" y=\"440\" fill=\"#5b6678\">serves padiSurface · 0700 · pid-gate</text>\n\n  <line x1=\"260\" y1=\"452\" x2=\"260\" y2=\"480\" stroke=\"#8b94a6\" stroke-width=\"1.4\" marker-end=\"url(#arr)\"/>\n  <text x=\"274\" y=\"470\" fill=\"#8b94a6\">taps · attach 1:1</text>\n\n  <rect x=\"75\" y=\"484\" width=\"375\" height=\"48\" rx=\"8\" fill=\"#151823\" stroke=\"#2a3145\"/>\n  <text x=\"91\" y=\"504\" fill=\"#c8d0de\" font-weight=\"600\">kaval — PTY survivor (unchanged)</text>\n  <text x=\"91\" y=\"522\" fill=\"#8b94a6\">PTYs outlive padi + kolu restarts</text>\n\n  <rect x=\"75\" y=\"542\" width=\"375\" height=\"22\" rx=\"5\" fill=\"#0f1117\" stroke=\"#2a3145\" stroke-dasharray=\"4 3\"/>\n  <text x=\"91\" y=\"557\" fill=\"#5b6678\">state-root/ = identity · store · kaval ns</text>\n\n  <!-- remote host -->\n  <rect x=\"490\" y=\"288\" width=\"415\" height=\"288\" rx=\"10\" fill=\"#0d0f15\" stroke=\"#3a3355\"/>\n  <text x=\"510\" y=\"310\" fill=\"#a78bfa\" font-weight=\"600\">HOST · nix@prod — same stack</text>\n\n  <rect x=\"510\" y=\"320\" width=\"375\" height=\"132\" rx=\"8\" fill=\"#151823\" stroke=\"#7ec699\" stroke-width=\"1.2\"/>\n  <text x=\"526\" y=\"342\" fill=\"#7ec699\" font-size=\"13\" font-weight=\"700\">padi — identical closure</text>\n  <text x=\"526\" y=\"362\" fill=\"#c8d0de\">its own fold · clock · store</text>\n  <text x=\"526\" y=\"380\" fill=\"#c8d0de\">cross-host clocks never compared</text>\n  <text x=\"526\" y=\"398\" fill=\"#c8d0de\">the host owns its koḷu —</text>\n  <text x=\"526\" y=\"416\" fill=\"#c8d0de\">every device sees the same canvas</text>\n  <text x=\"526\" y=\"440\" fill=\"#5b6678\">ephemeral pu-box or permanent server</text>\n\n  <line x1=\"700\" y1=\"452\" x2=\"700\" y2=\"480\" stroke=\"#8b94a6\" stroke-width=\"1.4\" marker-end=\"url(#arr)\"/>\n\n  <rect x=\"510\" y=\"484\" width=\"375\" height=\"48\" rx=\"8\" fill=\"#151823\" stroke=\"#2a3145\"/>\n  <text x=\"526\" y=\"504\" fill=\"#c8d0de\" font-weight=\"600\">kaval — PTY survivor</text>\n  <text x=\"526\" y=\"522\" fill=\"#8b94a6\">survives ssh blips + padi restarts</text>\n\n  <rect x=\"510\" y=\"542\" width=\"375\" height=\"22\" rx=\"5\" fill=\"#0f1117\" stroke=\"#2a3145\" stroke-dasharray=\"4 3\"/>\n  <text x=\"526\" y=\"557\" fill=\"#5b6678\">state-root/ — the host owns its state</text>\n\n  <!-- footer -->\n  <text x=\"480\" y=\"602\" fill=\"#5b6678\" font-size=\"11\" text-anchor=\"middle\">dead: HostLocation · resolveTerminalEndpoint · localOnly · terminalEvents wire · pulam · pulam-web</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/padi.mdx
var ROADMAP = [
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "W0 · decks cleared",
		m: "all landed",
		h: "#w0"
	},
	{
		d: 1,
		g: "✓",
		c: "ship",
		l: "overflow frame — typed overflow → re-attach on kaval's attach contract",
		m: "#1591 · kaval 5.0",
		h: "#w0"
	},
	{
		d: 1,
		g: "✓",
		c: "ship",
		l: "#1637–#1640 closed · finale superseded",
		m: "2026-07-01",
		h: "#w0"
	},
	{
		d: 1,
		g: "✓",
		c: "ship",
		l: "freeze terminalWorkspaceSurface at 3.0 · retire pulam-web",
		m: "#1650",
		h: "#w0"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "W1 · the padi seam, in place — ONE PR; commit stages contract → motion → rewiring",
		m: "#1652 · 2026-07-02",
		h: "#w1"
	},
	{
		d: 1,
		g: "✓",
		c: "ship",
		l: "W1.C · the contract — packages/padi born: padiSurface 1.0 + control core + tests",
		m: "in #1652",
		h: "#w1c"
	},
	{
		d: 1,
		g: "✓",
		c: "ship",
		l: "W1.M · the motion — the terminal domain relocates into @kolu/padi (severing commits named)",
		m: "in #1652",
		h: "#w1m"
	},
	{
		d: 1,
		g: "✓",
		c: "ship",
		l: "W1.R · the rewiring — serve complete · client onto the surface · root RPC dies · seal",
		m: "in #1652",
		h: "#w1r"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "W2 · padi the process — 3 PRs · byte-identical · warm restarts",
		m: "all shipped",
		h: "#w2"
	},
	{
		d: 1,
		g: "✓",
		c: "ship",
		l: "W2.1 · the re-serve machinery in @kolu/surface* — forwarding policy · per-binding scope",
		m: "#1661 · drishti #84 adopts",
		h: "#w21"
	},
	{
		d: 1,
		g: "✓",
		c: "ship",
		l: "W2.2 · padi the process — ONE PR: binary + identity + owns kaval + the cutover (bind · re-serve · store migration)",
		m: "#1664 · 2026-07-03",
		h: "#w22"
	},
	{
		d: 1,
		g: "✓",
		c: "ship",
		l: "W2.3 · dial carve + padi-tui born + the burial — wait/status/create/worktree · pulam* retired · terminalWorkspaceSurface DELETED",
		m: "#1665 · 2026-07-03",
		h: "#w23"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "W3 · remote — the binding · the full-peer gaps",
		m: "W3.4's CI gate parked",
		h: "#w3"
	},
	{
		d: 1,
		g: "✓",
		c: "ship",
		l: "W3.1 · the remote binding — provision + front a remote padi over ssh (KOLU_PADI_HOST)",
		m: "#1675 · 2026-07-04",
		h: "#w31"
	},
	{
		d: 1,
		g: "✓",
		c: "ship",
		l: "W3.2 · the full-peer gaps — remote file preview + remote daemon list",
		m: "#1685 · #1686 · 2026-07-05",
		h: "#w32"
	},
	{
		d: 1,
		g: "▶",
		c: "prog",
		l: "W3.4 · remote e2e parity in CI — machinery DONE; gate parked on the parity tail",
		m: "#1689 parked → remote-bind-parity note",
		h: "#w34"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "W4 · the switch — @kolu/surface-map + the multi-host canvas (Labs picker)",
		m: "#1714 · 2026-07-07",
		h: "#w4"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "W7 · per-host state by ownership, not enumeration",
		m: "#1723 · drishti#91 · 2026-07-08",
		h: "#w7"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "W8 · remote terminals, documented honestly (docs phase)",
		m: "#1722 · #1727 · 2026-07-08",
		h: "#w8"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "W6 · the honest connect — the connection type made perfect + the connect overlay",
		m: "#1730 · drishti#92 · 2026-07-09",
		h: "#w6"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "W5 · cross-host attention — urgency fan-in · OS badge · notification deep-link",
		m: "#1759 · drishti#93 in review · 2026-07-11",
		h: "#w5"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "W9 · instant host switch-back — retained per-host wire subscriptions (W7's K1)",
		m: "#1764 · 2026-07-11",
		h: "#w9"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "W11 · one verb per fact — user-remove vs system-retire in the pool",
		m: "#1775 · 2026-07-12",
		h: "#w11"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "W10 · hosts survive a restart — membership as a settings field in the conf store",
		m: "#1772 · 2026-07-12",
		h: "#w10"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "W12 · restore survives an unclean kaval death — can't-observe emits unknown, not agent-ended",
		m: "#1784 · 2026-07-12",
		h: "#w12"
	},
	{
		d: 0,
		g: "▶",
		c: "prog",
		l: "Consolidation — the surface-runtime plan (unnumbered · parallel · ongoing)",
		m: "→ the plan of record",
		h: "surface-runtime-boundary.html"
	},
	{
		d: 0,
		g: "○",
		c: "last",
		l: "Future work — cross-host dock · kolu-cli (tui/mcp faces) · hybrid only if earned (unnumbered · demand-driven)",
		m: "",
		h: "#future"
	}
];
var PAL = {
	txt: "#c8d0de",
	sub: "#8b94a6",
	dim: "#5b6678",
	green: "#7ec699",
	amber: "#e6a23c",
	cyan: "#56b6c2",
	violet: "#a78bfa"
};
var HostChip = ({ name, active, badge, remote }) => createVNode("span", {
	style: `display:inline-flex;align-items:center;gap:.5ch;padding:.18rem .65rem;border-radius:6px;font-size:.85em;${active ? `background:rgba(126,198,153,.13);color:${PAL.txt};border:1px solid rgba(126,198,153,.4)` : `color:${PAL.dim};border:1px solid #222838`}`,
	children: [
		remote && createVNode("span", {
			style: `color:${PAL.violet};font-size:.85em`,
			children: "ssh"
		}),
		name,
		badge && createVNode("span", {
			style: `background:${PAL.amber};color:#0f1117;border-radius:8px;padding:0 .55ch;font-weight:700;font-size:.8em`,
			children: badge
		})
	]
});
var Switcher = () => createVNode("div", {
	style: "font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;background:#0f1117;border:1px solid #05070b;border-radius:11px;overflow:hidden;margin:1.2rem 0;max-width:44rem;box-shadow:0 10px 34px rgba(0,0,0,.4)",
	children: [createVNode("div", {
		style: "display:flex;align-items:center;gap:.45rem;padding:.5rem .8rem;background:#0d0f15;border-bottom:1px solid #1c2231",
		children: [
			createVNode("span", {
				style: "color:#5b6678;font-size:.8em",
				children: "host"
			}),
			createVNode(HostChip, { name: "local" }),
			createVNode(HostChip, {
				name: "nix@prod",
				active: true,
				remote: true
			}),
			createVNode(HostChip, {
				name: "pu-kolu-3",
				badge: "2",
				remote: true
			}),
			createVNode("span", {
				style: "margin-left:.2rem;color:#3f4858",
				children: "+ host"
			}),
			createVNode("span", {
				style: "margin-left:auto;color:#5b6678;font-size:.8em",
				children: "⌥H switch"
			})
		]
	}), createVNode("div", {
		style: "padding:.7rem .9rem;color:#8b94a6",
		children: [
			"The whole canvas is ",
			createVNode("span", {
				style: `color:${PAL.violet}`,
				children: "nix@prod"
			}),
			"'s — its own layout, its own dock, exactly as any other device sees it.",
			createVNode("span", {
				style: `color:${PAL.amber}`,
				children: " pu-kolu-3"
			}),
			" has 2 agents awaiting you: the chip badge, the PWA app badge, and an OS notification all say so — clicking the notification switches the view and focuses the tile (one action)."
		]
	})]
});
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		h4: "h4",
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
			createVNode(_components.strong, { children: [
				"The ground-up re-architecture for ",
				createVNode($$Issue, { n: 951 }),
				" — remote terminals — and the extraction that untangles kolu-server and the client along the way."
			] }),
			" The old plan (",
			createVNode(_components.a, {
				href: "remote-terminals.html#finale",
				children: "the pre-padi record"
			}),
			") tagged every terminal with a ",
			createVNode(_components.code, { children: "HostLocation" }),
			" and checked that tag all over kolu-server, because it assumed one canvas could mix tiles from several hosts. Drop that assumption and the problem gets much simpler: ",
			createVNode(_components.strong, { children: [
				"“which host” is a property of the ",
				createVNode(_components.em, { children: "connection" }),
				", not of each terminal."
			] }),
			" One daemon per host — ",
			createVNode(_components.strong, { children: "padi" }),
			" (படி, the stepped stand a koḷu is arranged on) — knows everything about that host’s terminals and serves it as one complete surface. kolu-server becomes a thin web shell that ",
			createVNode(_components.em, { children: "connects" }),
			" each browser view to one padi. The four prep PRs (",
			createVNode($$PrLink, { pr: 1637 }),
			" ",
			createVNode($$PrLink, { pr: 1638 }),
			" ",
			createVNode($$PrLink, { pr: 1639 }),
			" ",
			createVNode($$PrLink, { pr: 1640 }),
			") were closed; pulam and pulam-web dissolve into padi. Before committing, the design was stress-tested hard — seven independent reviewers each trying to break it a different way, every finding re-checked by a skeptic, plus a UX study of two real usage patterns; everything they caught is baked in below."
		] }),
		"\n",
		"\n",
		createVNode($$PhaseTree, {
			title: "ROADMAP — padi (replaces R9/R10) · kept up to date",
			phases: ROADMAP
		}),
		"\n",
		"\n",
		"\n",
		"\n",
		createVNode(_components.h2, {
			id: "what-padi-is",
			children: "What padi is"
		}),
		"\n",
		createVNode(Switcher, {}),
		"\n",
		createVNode(_components.p, { children: [
			"Shipped with W4: a ",
			createVNode(_components.strong, { children: "host switcher" }),
			" — ",
			createVNode(_components.em, { children: "kinda like tmux sessions" }),
			" (under the command palette’s Labs group until it stabilizes; the ChromeBar picker graduates later). A canvas shows ",
			createVNode(_components.strong, { children: "one host’s terminals" }),
			"; switching hosts swaps the whole canvas instantly (bindings stay warm server-side). A host’s arrangement — tile layout, names, themes, remembered agent commands — ",
			createVNode(_components.strong, { children: "lives on that host" }),
			", so your desktop, laptop, and phone all see the same canvas for ",
			createVNode(_components.code, { children: "nix@prod" }),
			", and a teammate-free second kolu (or the future ",
			createVNode(_components.code, { children: "kolu tui" }),
			" face) joins the same arrangement. A remote canvas is a ",
			createVNode(_components.strong, { children: "full peer" }),
			" of the local one: Code tab, binary preview, paste/upload, transcript export, sleep/wake, session restore — all against the terminal’s own host, nothing silently wrong-host."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"While you’re parked on one host, the others reach you through the channels an installed PWA already owns: the ",
			createVNode(_components.strong, { children: "app badge" }),
			" aggregates awaiting-agents across all bound hosts, the ",
			createVNode(_components.strong, { children: "switcher chips" }),
			" carry per-host counts, and an ",
			createVNode(_components.strong, { children: "OS notification’s click is one action" }),
			" — switch binding + focus the tile. (The per-terminal plumbing — ",
			createVNode(_components.code, { children: "setAppBadge" }),
			", service-worker notifications — predated it; W5 aggregated it across bindings.)"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Two personas anchor the design, and both get the same shape: an ",
			createVNode(_components.strong, { children: "ephemeral cloud box" }),
			" (a pu-style instance per project — teardown removes the host from the picker as one clean unit, never wreckage on a shared canvas) and a ",
			createVNode(_components.strong, { children: "permanent headless server" }),
			" (days-long agents; hop local⇄server many times a day — instant switch + 1-action notification response is the tmux-grade loop that persona lives in)."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Why not hybrid tiles (several hosts on one canvas)? Evaluated, deferred — not foreclosed",
			children: createVNode(_components.p, { children: [
				"We compared three designs against real usage: plain switching (A), switching with warm connections and badges (A+ — this design), and mixed tiles (B). A+ gives nearly everything B would: you find out when an agent elsewhere needs you, you respond in one click, every device shows a host’s canvas the same way, and tearing down a cloud box removes it cleanly. B’s one real advantage is watching two hosts’ terminals side by side in one window. Its real cost: two tiles that look identical — same repo, same branch, one of them is prod — differing only by a tiny badge. That’s a wrong-host paste waiting to happen. And when the app is in the background (most of the day), B’s on-screen indicators are invisible anyway; both designs end up relying on the OS notification. So: ship A+, and keep B possible later — it would be a layer on top of the same daemons, nothing below changes. If switching ever feels insufficient, the first thing to try is a ",
				createVNode(_components.strong, { children: "cross-host dock" }),
				" (",
				createVNode(_components.a, {
					href: "#future",
					children: "future work"
				}),
				"): other hosts’ agents listed in your dock, click = switch — you want attention across hosts, not tiles across hosts. The dock data reserves a host field from W1 so this can land without breaking the contract."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-architecture",
			children: "The architecture"
		}),
		"\n",
		createVNode($$Svg, {
			svg: padi_architecture_default,
			caption: "The padi architecture. Every host runs kaval (PTY survivor, unchanged role) + padi (the workspace authority: registry, one fold on the host's clock, lifecycle, fs/git+bytes, persistence, kaval supervision) serving padiSurface — the ONE complete surface. kolu-server is a web shell holding a pool of warm bindings; each client connection is scoped to one binding, so a host switch closes one scope and opens another — no global rebind exists. Local and remote legs are byte-identical; remote adds ssh + frontDaemonOverStdio + Nix provisioning."
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The gap this fixes." }),
			" Today, no single thing can tell you everything about one host’s terminals. kaval has the PTYs. pulam has the awareness and fs/git — which it gets by dialing kaval itself. Everything else — layout, memory, restore targets, saved sessions, sleep/wake, boot adoption — lives only inside kolu-server. Because there was no one place to point at, the old plan had to tag every terminal with its host and check the tag at ~11 different places, behind two different lookup helpers. Meanwhile the client never needed any of it: it talks to one server over one socket, and no client code reads a host field. padi fixes this at the right level: ",
			createVNode(_components.strong, { children: "below, one daemon that knows everything about its host’s terminals; above, one connection per view that picks the host; nothing per-terminal anywhere." })
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-three-layers-and-what-each-owns",
			children: "The three layers, and what each owns"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "layer" }),
					"\n",
					createVNode(_components.th, { children: "owns" }),
					"\n",
					createVNode(_components.th, { children: "explicitly does NOT own" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "kaval" }), " (per padi)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"PTYs, screen mirror, VT taps, inventory — unchanged role, byte-minimal; the overflow frame ",
						createVNode(_components.strong, { children: "shipped" }),
						" (",
						createVNode($$PrLink, { pr: 1591 }),
						", contract 5.0)"
					] }),
					"\n",
					createVNode(_components.td, { children: "awareness, git, sleep, persistence (as today)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "padi" }), " (per host × state-root)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"the registry (",
						createVNode(_components.strong, { children: [createVNode(_components.code, { children: "terminals" }), " = authored ⋈ snapshot, composed server-side"] }),
						"); the ",
						createVNode(_components.strong, { children: "one fold" }),
						" + ",
						createVNode(_components.code, { children: "AgentMemory" }),
						" on ",
						createVNode(_components.strong, { children: "the host’s clock" }),
						"; ",
						createVNode(_components.code, { children: "restoreTarget" }),
						"; lifecycle (create · kill · sleep/wake · boot adoption · inventory reconcile); spawn-policy composition against its kaval’s ",
						createVNode(_components.code, { children: "system.info" }),
						"; fs/git endpoint + watcher pulses; byte procedures (",
						createVNode(_components.code, { children: "previewRead" }),
						" · ",
						createVNode(_components.code, { children: "scratch.write" }),
						"); ",
						createVNode(_components.code, { children: "transcript.exportHtml" }),
						" (the agent loaders run host-side — codex/opencode transcripts are ",
						createVNode(_components.strong, { children: "SQLite queries" }),
						", not file reads); ",
						createVNode(_components.strong, { children: "worktree create/remove" }),
						"; the ",
						createVNode(_components.strong, { children: "MRU activity feed" }),
						" (",
						createVNode(_components.code, { children: "recentRepos" }),
						"/",
						createVNode(_components.code, { children: "recentAgents" }),
						" — host-fs facts written inside the fold’s emit path); session persistence in its state-root; ",
						createVNode(_components.strong, { children: "kaval supervision" }),
						"; status cells (kaval ",
						createVNode(_components.code, { children: "daemonStatus" }),
						", ",
						createVNode(_components.code, { children: "expectedKaval" }),
						"); the ",
						createVNode(_components.strong, { children: "urgency projection" }),
						" (awaiting counts + ids — no recency); the frozen ",
						createVNode(_components.strong, { children: "control core" }),
						" (hello · version · drain · ",
						createVNode(_components.code, { children: "clock.now" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: "serving browsers; user preferences; which client looks at it" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "kolu-server" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"HTTP · static · PWA · websocket; user-scoped preferences; buildInfo (minus ",
						createVNode(_components.code, { children: "expectedKaval" }),
						", which moves to padi); the ",
						createVNode(_components.strong, { children: "binding pool" }),
						" (dial + supervise-or-front padis; per-connection scope; re-serve); binding/link status on its own shell surface; notification fan-in across bindings"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "terminals — it writes nothing about them." }),
						" No registry, no fold, no adoption, no terminal-derived cells — with one read-only exception: the ",
						createVNode(_components.strong, { children: "cross-binding urgency sum" }),
						" for badges, sourced solely from each padi’s urgency-projection member"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "client" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"one padiSurface consumer per view + the shell surface; ages recency against the ",
						createVNode(_components.strong, { children: "bind-time clock offset" }),
						" (never the browser clock vs a foreign clock)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"per-terminal host routing — there is nothing left to route with; ",
						createVNode(_components.code, { children: "HostLocation" }),
						" is deleted from records and create input"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "padi’s identity is its state-root — the folder on the host that holds its data — and clients never kill a running padi." }),
			" (kaval today is namespaced per kolu-server port precisely because its supervisor kills-and-respawns on version mismatch, and a shared daemon once let a dev server kill prod’s — the #1313 incident.) padi flips the relationship: ",
			createVNode(_components.strong, { children: "one padi per (host, state-root)" }),
			". The deployed kolu binds the host’s default state-root locally; a ",
			createVNode(_components.strong, { children: "remote" }),
			" binder gets a per-client isolated estate by default (",
			createVNode(_components.code, { children: "padi-<clientId>" }),
			", ",
			createVNode($$PrLink, { pr: 1881 }),
			" — so two kolus binding one host never share a padi by accident); a dev kolu and each e2e worker pass their own private one, which also gives them a private kaval. A dev instance therefore ",
			createVNode(_components.em, { children: "can’t" }),
			" touch prod’s daemon, and a second kolu binding the same state-root ",
			createVNode(_components.em, { children: "does" }),
			" see the same canvas — sharing vs isolation is now an explicit choice, not a port accident. The mechanics (each exists because a reviewer constructed the failure without it):"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The data folder is permanent; the socket is not." }),
				" The state-root must survive reboots — restore depends on it. But the socket and the lock file live in the runtime dir, named by a hash of the state-root path (",
				createVNode(_components.code, { children: "$XDG_RUNTIME_DIR/padi-<digest>/" }),
				"; same scheme for padi’s kaval). The runtime dir is wiped at every boot, so a stale lock can never make a dead padi look alive, and socket paths stay short no matter how deep the state-root sits. A small file in each runtime dir maps hash → state-root, so ",
				createVNode(_components.code, { children: "kaval-tui" }),
				"’s no-flags discovery keeps working and can label what it finds — that migration ships in the same PR, not a release note."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The padi binary decides the default state-root, on the host." }),
				" One fixed rule in one place — never computed by a client, never sent over the wire. Otherwise two ways of reaching the host (login shell vs ssh, with different env) could compute two different “defaults” and silently split the host’s terminals across two padis. Local clients pass nothing (default); remote binders pass their persisted client-id ",
				createVNode(_components.strong, { children: "token" }),
				" (",
				createVNode(_components.code, { children: "--client-id" }),
				" — the host still spells the ",
				createVNode(_components.code, { children: "padi-<uuid>" }),
				" path itself, ",
				createVNode($$PrLink, { pr: 1881 }),
				"); dev/e2e pass an explicit path."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Clients may start or join a padi — never restart one." }), " This is a new, third supervisor policy, named so nobody reaches for the existing one (which kills-and-respawns on version mismatch — exactly what must not happen here). Two clients racing to start the same padi is safe: taking the lock is atomic, and the loser just connects to the winner."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Upgrades converge on the newest version, through a small frozen “control core”." }),
				" padiSurface will grow, so version mismatches will happen — and if “restart” only existed inside the versioned contract, the one moment you need it is the moment you can’t call it. So padi also serves a tiny never-changing side channel: hello · version · ",
				createVNode(_components.strong, { children: "drain" }),
				" · ",
				createVNode(_components.code, { children: "clock.now" }),
				". The rule: a client ",
				createVNode(_components.em, { children: "older" }),
				" than the running padi is refused, loudly (upgrade your kolu). A client ",
				createVNode(_components.em, { children: "newer" }),
				" may ask padi to ",
				createVNode(_components.strong, { children: "drain" }),
				" — save everything and exit; the PTYs stay alive in kaval — and then start the newer version. Newest always wins, so two clients at different versions converge instead of fighting, and nothing ever force-kills a padi."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-state-model--what-survives-from-the-awareness-design-and-what-moves",
			children: "The state model — what survives from the awareness design, and what moves"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The ",
			createVNode(_components.a, {
				href: "awareness-derive-store.html",
				children: "observe-vs-remember split"
			}),
			" survives unchanged ",
			createVNode(_components.em, { children: "inside" }),
			" padi: the sensors still cannot write memory (the types forbid it), the fold stays the one and only writer, and the shipped types are reused as-is. What moves is ",
			createVNode(_components.em, { children: "where remembering lives" }),
			": sensors and fold now sit in the same process, so nothing folded ever has to be rebuilt across a wire — the whole planned event-stream apparatus (#1638’s framer, sequence numbers, gap frames) is simply never built, and the old fold-overwrite bug class (#1614) can’t happen because there’s no second writer left. Two consequences, decided out loud rather than slipped in:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The host’s clock stamps memory now." }),
				" (The old rule said the consumer’s clock — but that rule existed for a mixed-host canvas, which no longer exists. Within one host, its own clock is the only one; two hosts’ times are never compared, because no view ever shows two hosts.) For display (“2m ago”), the client measures the clock difference once per connection — one ",
				createVNode(_components.code, { children: "clock.now()" }),
				" round-trip, halved — and ages everything locally against that offset, so even a badly-skewed host shows sane ages. We deliberately do NOT serve a ticking “now” value: it would either be stale at connect or push a useless frame to every connection forever. Anything that does cross hosts (badges, the future cross-host dock) carries ",
				createVNode(_components.strong, { children: "counts only, never times" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The client-side join retires." }),
				" R8 split a terminal’s data into two collections because two processes wrote the two halves. In padi one process writes both, so it serves one composed ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "terminals" }) }),
				" collection (the same compose function, now run server-side; disk saving keeps using it too). The two-halves split lives on as internal types — the fence that keeps sensors from writing memory — it just stops being a wire format."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "session-state-and-restore--the-host-restores-itself",
			children: "Session state and restore — the host restores itself"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Today session state lives in kolu-server’s config store, and ",
			createVNode(_components.strong, { children: "restore is client-driven" }),
			": after a restart the browser re-creates saved terminals one ",
			createVNode(_components.code, { children: "create" }),
			" call at a time, with a known race against PTYs that survived. Under padi, session state lives with the process that can actually guarantee it, and the client stops participating:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "state" }),
					"\n",
					createVNode(_components.th, { children: "lives" }),
					"\n",
					createVNode(_components.th, { children: "survives" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "live PTYs + scrollback" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "kaval" }), " (RAM)"] }),
					"\n",
					createVNode(_components.td, { children: "padi restarts, kolu-server restarts, ssh blips" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"terminal session — authored records (layout · chrome · active tile · panel sizes · memory · ",
						createVNode(_components.code, { children: "restoreTarget" }),
						") + the restore-relevant awareness projection"
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "padi’s state-root, on the host" }), " (persistent storage — pinned)"] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "host reboots included" }), " — at a reboot only the PTYs die (kaval’s row); the records park for restore"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "user preferences · binding pool (which hosts, last binding per view)" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "kolu-server" }), " conf-store"] }),
					"\n",
					createVNode(_components.td, { children: "kolu-server has no terminal state to lose" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "per-tab view posture (canvas-maximized, minimap-expanded, …)" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "browser localStorage, namespaced per binding" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"host switches don’t collide two hosts’ view-state. (Active tile + panel sizes are NOT here — they ride padi’s authored session via the chrome procedures, as today’s ",
						createVNode(_components.code, { children: "setActive" }),
						"/",
						createVNode(_components.code, { children: "setSubPanel" }),
						" persistence does)"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "The four restore flows, each owned by the layer that knows:" }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "padi restarts" }), " (deploy, crash): on boot it adopts surviving kaval PTYs by id, reconciles them against its persisted session, re-seeds fold memory from its store, and re-runs sensors fresh (the #1031 posture). By the time any client binds, the canvas is already whole — no client participates."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Host reboots" }),
				" (the PTYs are gone): padi’s boot finds saved records with no live PTYs and marks them ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "parked" }) }),
				" — a distinct state. Deliberately-slept terminals stay ",
				createVNode(_components.code, { children: "sleeping" }),
				", untouched: waking a slept terminal resumes its agent, so parking must not blur the two (they restore differently, exactly as today). padi ",
				createVNode(_components.strong, { children: "never auto-respawns agents with nobody watching" }),
				" — and a warm server-side connection is not a watcher — so restore is never a side effect of connecting. The browser shows today’s restore card over the parked records, and your click calls ",
				createVNode(_components.code, { children: "session.restore({resumeIds})" }),
				" (per-terminal opt-out preserved). The respawn then runs inside padi, the single writer, and calling it twice is harmless (each record flips parked→active exactly once). The old client-loop race is gone by construction. “Import session” becomes a padi procedure too."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "kolu-server restarts" }), ": nothing happens to terminals at all — padi’s registry stays warm (strictly better than today, where every restart re-derives all metadata). The browser reconnects and rebinds; the canvas is byte-identical."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Browser reload / device switch" }),
				": pure re-subscribe. The client no longer contains respawn logic of any kind; a reload against a rebooted ",
				createVNode(_components.em, { children: "remote" }),
				" host lands in flow 2 on that host’s padi, same as local."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Two safety rules came out of W1’s shipping rounds, each pinned by a test that fails if its guard is removed (",
			createVNode(_components.code, { children: "reattach.test.ts" }),
			", ",
			createVNode(_components.code, { children: "restartLocal.test.ts" }),
			"): ",
			createVNode(_components.strong, { children: "nothing but the user may ever empty or shrink a non-empty saved session" }),
			" — parked records freeze the autosave, and the restart’s capture→drain→park window freezes it entirely (that transiently-empty moment is exactly where a session got eaten on a real host); and ",
			createVNode(_components.strong, { children: "a daemon we adopt that isn’t the one we recorded pairing with" }),
			" (compared by ",
			createVNode(_components.code, { children: "startedAt" }),
			") ",
			createVNode(_components.strong, { children: "is treated as a fresh boot" }),
			" — preserve and park, never overwrite the saved session with the new daemon’s emptiness."
		] }),
		"\n",
		createVNode("a", { id: "padisurface" }),
		"\n",
		createVNode(_components.h3, {
			id: "padisurface--one-contract-with-per-member-forwarding-semantics",
			children: "padiSurface — one contract, with per-member forwarding semantics"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"padi serves a ",
			createVNode(_components.strong, { children: "new" }),
			" surface, ",
			createVNode(_components.code, { children: "padiSurface" }),
			" 1.0. (The old ",
			createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
			" is frozen at 3.0 and dies with the pulam daemons at W2.3 — growing it instead would have forced every new member through three packages we’re deleting, because a served surface must implement every member or refuse to start.) Members: ",
			createVNode(_components.code, { children: "version" }),
			" + status cells; the ",
			createVNode(_components.code, { children: "activityFeed" }),
			" (MRU) + ",
			createVNode(_components.code, { children: "session" }),
			" cells (padi-owned on the wire from W1; conf-store storage moves to the state-root at W2.2); the composed ",
			createVNode(_components.code, { children: "terminals" }),
			" collection (record states ",
			createVNode(_components.code, { children: "active | sleeping | parked" }),
			"; the dock projection carries the optional host axis, reserved); the ",
			createVNode(_components.strong, { children: "urgency projection" }),
			" (awaiting counts + terminal ids, recency-free — the sole thing kolu-server reads from ",
			createVNode(_components.em, { children: "every" }),
			" warm binding, for badge fan-in); ",
			createVNode(_components.code, { children: "activity" }),
			" stream; repo/file ",
			createVNode(_components.code, { children: "{seq}" }),
			" pulses; fs/git procedures (incl. worktree ops); byte procedures; ",
			createVNode(_components.code, { children: "transcript.exportHtml" }),
			"; lifecycle + chrome procedures; ",
			createVNode(_components.code, { children: "session.restore" }),
			" / ",
			createVNode(_components.code, { children: "session.import" }),
			"; ",
			createVNode(_components.code, { children: "terminalExit" }),
			" event; ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "terminalAttach" }) }),
			". Beside the surface, the frozen ",
			createVNode(_components.strong, { children: "control core" }),
			" (hello · version · drain · ",
			createVNode(_components.code, { children: "clock.now" }),
			") that never versions."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Per-connection scope is new machinery, and we say so plainly." }),
			" Today the framework wires every member to one store at startup, and every websocket shares one router — nothing is per-connection. W2/W3 add it: one mirror store per bound host (shared by all connections watching that host), a router chosen by the connection’s declared host, and the client’s global wire objects rebuilt per binding, so an in-app switch is a clean rebuild (v1 of the switch may simply be a page reload). Whatever part of this lands in ",
			createVNode(_components.code, { children: "@kolu/surface*" }),
			" goes through the usual drishti check."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The contract’s one novelty, forced by review: ",
			createVNode(_components.strong, { children: "every member declares how it may be relayed" }),
			". Value members (cells, collections, pulses) can be held open across a hiccup and replayed — replaying a value is harmless. ",
			createVNode(_components.strong, { children: [
				"Byte streams (",
				createVNode(_components.code, { children: "terminalAttach" }),
				", ",
				createVNode(_components.code, { children: "activity" }),
				") must fail through instead"
			] }),
			": if the padi↔kolu-server leg drops, the browser’s stream must end too, so the existing retry reconnects end-to-end and a scrollback snapshot only ever arrives as the ",
			createVNode(_components.em, { children: "first" }),
			" frame of a ",
			createVNode(_components.em, { children: "fresh" }),
			" stream. (Holding a byte stream open and splicing a replayed snapshot into a live terminal would corrupt the screen — the relay helper makes that a type error, not a convention to remember.) Attach keeps its special path — one dedicated stream per subscriber, straight through every hop — and the shipped overflow signal (",
			createVNode($$PrLink, { pr: 1591 }),
			") rides it unchanged. The relay helpers grow out of pulam-web’s ",
			createVNode(_components.code, { children: "reserve" }),
			" into the shared surface stack, behind the usual drishti check."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "rejected-shapes-each-killed-by-a-specific-review-finding",
			children: "Rejected shapes (each killed by a specific review finding)"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				"Per-terminal ",
				createVNode(_components.code, { children: "HostLocation" }),
				" tagging"
			] }), " (the finale plan): checked the host at a dozen places when one place (the connection) suffices — and the client never needed it at all. Closed with #1637–#1640."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Merging kaval into padi" }),
				": padi bundles the system’s highest-churn code (agent sensors, fs/git serving); kaval earns “restarts only on contract change” by containing nothing that churns. Fusing them means sensor churn kills PTYs. padi restarts are instead ",
				createVNode(_components.em, { children: "cheap by design" }),
				": re-seed from the state-root + fresh sensors (the #1031 posture — warm across web-shell churn, honestly re-derived across padi churn)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Server-global binding with a “rebind + client reset” switch" }),
				" (the brief’s own first draft): behind a constant origin, in-flight id/repoPath-keyed calls and every other device silently straddle a rebind — a two-actor temporal convention with a race window. Replaced by ",
				createVNode(_components.strong, { children: "per-connection binding scope" }),
				": a call minted under one binding cannot reach another, and other devices are untouched by your switch."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Local padi as in-process library, process only for remote" }), ": keeps two assemblies (the drift the one-library-two-homes era already suffered), keeps kolu-server fat, and forfeits warm-across-restart metadata and multi-client (kolu-cli) for the local host."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "where-this-stands--and-whats-next",
			children: "Where this stands — and what’s next"
		}),
		"\n",
		createVNode($$Phase, {
			id: "W0",
			name: "decks cleared — freeze the old contract, retire pulam-web, land the overflow frame, close the PRs",
			status: "done"
		}),
		"\n",
		createVNode($$Phase, {
			id: "W1",
			name: "the padi seam, in place — padiSurface served in-process, client migrated, root oRPC dispositioned",
			status: "shipped",
			needs: ["W0"],
			links: [{
				label: "#1652",
				href: "https://github.com/juspay/kolu/pull/1652"
			}]
		}),
		"\n",
		createVNode($$Phase, {
			id: "W2",
			name: "padi the process — state-root identity, owns kaval, on-host persistence; kolu-server binds + re-serves",
			status: "shipped",
			needs: ["W1"],
			links: [
				{
					label: "#1661",
					href: "https://github.com/juspay/kolu/pull/1661"
				},
				{
					label: "#1664",
					href: "https://github.com/juspay/kolu/pull/1664"
				},
				{
					label: "#1665",
					href: "https://github.com/juspay/kolu/pull/1665"
				}
			]
		}),
		"\n",
		createVNode($$Phase, {
			id: "W3",
			name: "remote — the ssh/Nix binding, the full-peer gaps; CI parity (W3.4) parked on the mock-agent burn-down",
			status: "shipped",
			needs: ["W2"],
			links: [
				{
					label: "#1675",
					href: "https://github.com/juspay/kolu/pull/1675"
				},
				{
					label: "#1685",
					href: "https://github.com/juspay/kolu/pull/1685"
				},
				{
					label: "#1686",
					href: "https://github.com/juspay/kolu/pull/1686"
				}
			]
		}),
		"\n",
		createVNode($$Phase, {
			id: "W4",
			name: "the switch — host picker, per-view bindings, warm pool (+ @kolu/surface-map)",
			status: "shipped",
			needs: ["W3"],
			links: [{
				label: "#1714",
				href: "https://github.com/juspay/kolu/pull/1714"
			}]
		}),
		"\n",
		createVNode($$Phase, {
			id: "W7",
			name: "per-host state by ownership, not enumeration",
			status: "shipped",
			needs: ["W4"],
			links: [{
				label: "#1723",
				href: "https://github.com/juspay/kolu/pull/1723"
			}]
		}),
		"\n",
		createVNode($$Phase, {
			id: "W8",
			name: "remote terminals, documented honestly (docs phase)",
			status: "shipped",
			needs: ["W4"],
			links: [{
				label: "#1722",
				href: "https://github.com/juspay/kolu/pull/1722"
			}, {
				label: "#1727",
				href: "https://github.com/juspay/kolu/pull/1727"
			}]
		}),
		"\n",
		createVNode($$Phase, {
			id: "W6",
			name: "the honest connect — the connection type made perfect + the connect overlay",
			status: "shipped",
			needs: ["W4"],
			links: [{
				label: "#1730",
				href: "https://github.com/juspay/kolu/pull/1730"
			}]
		}),
		"\n",
		createVNode($$Phase, {
			id: "W5",
			name: "cross-host attention — urgency fan-in · OS badge · notification deep-link",
			status: "shipped",
			needs: ["W4"],
			links: [{
				label: "#1759",
				href: "https://github.com/juspay/kolu/pull/1759"
			}]
		}),
		"\n",
		createVNode($$Phase, {
			id: "cleanup",
			name: "consolidation — the surface-runtime plan (unnumbered, parallel, ongoing)",
			status: "todo",
			needs: ["W2"]
		}),
		"\n",
		createVNode($$Phase, {
			id: "W9",
			name: "instant host switch-back — retained per-host wire subscriptions (completing W7's K1)",
			status: "shipped",
			needs: ["W7"],
			links: [{
				label: "#1764",
				href: "https://github.com/juspay/kolu/pull/1764"
			}]
		}),
		"\n",
		createVNode($$Phase, {
			id: "W11",
			name: "one verb per fact — user-remove vs system-retire in surface-remote's pool",
			status: "shipped",
			needs: ["W6"],
			links: [{
				label: "#1775",
				href: "https://github.com/juspay/kolu/pull/1775"
			}]
		}),
		"\n",
		createVNode($$Phase, {
			id: "W10",
			name: "hosts survive a restart — membership as a settings field in the conf store",
			status: "shipped",
			needs: ["W6"],
			links: [{
				label: "#1772",
				href: "https://github.com/juspay/kolu/pull/1772"
			}]
		}),
		"\n",
		createVNode($$Phase, {
			id: "W12",
			name: "restore survives an unclean kaval death — a can't-observe terminal emits `unknown`, not an authoritative agent-end",
			status: "shipped",
			links: [{
				label: "#1784",
				href: "https://github.com/juspay/kolu/pull/1784"
			}]
		}),
		"\n",
		createVNode($$Phase, {
			id: "future",
			name: "future work — cross-host dock (B-lite) · kolu-cli · hybrid canvas only if earned",
			status: "todo",
			needs: ["W4"]
		}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "As of 2026-07-12, in order:" }) }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "W10 — hosts survive a restart" }),
				" shipped (",
				createVNode($$PrLink, { pr: 1772 }),
				") 2026-07-12 in the ratified conf-store shape, clearing the numbered ladder."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "W12 — restore survives an unclean kaval death" }),
				" shipped (",
				createVNode($$PrLink, { pr: 1784 }),
				") — independent of W10 in code (it lives in padi’s agent sensor, not the host pool). The seedling’s exit-flush guess was falsified by the incident forensics + a live kill-9; the real defect and cure are recorded in ",
				createVNode(_components.a, {
					href: "#w12",
					children: "its section"
				}),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The consolidation runs in parallel" }),
				" — its plan of record is ",
				createVNode(_components.a, {
					href: "surface-runtime-boundary.html",
					children: "A Complete Surface Runtime"
				}),
				" (the kernel + bridge PR sequence); the remaining parked padi-area cleanups are listed ",
				createVNode(_components.a, {
					href: "#parked",
					children: "below"
				}),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Parked, not forgotten:" }),
				" W3.4 (remote e2e parity in CI) waits on the mock-agent burn-down (",
				createVNode($$PrLink, { pr: 1689 }),
				"); W4’s honest-clocks piece 5 is a named fast-follow; W7’s field-acceptance leg (srid confirms the camera symptom gone on a real deploy) stays open until observed; W5’s drishti pair (",
				createVNode(_components.a, {
					href: "https://github.com/srid/drishti/pull/93",
					children: "srid/drishti#93"
				}),
				" — the ",
				createVNode(_components.code, { children: "alerts" }),
				" cell) is still in review."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The law of every PR in this plan (srid, promoted note-wide 2026-07-04): a PR is self-sufficient and end-to-end — it ships NOTHING that isn’t consumed within it." }),
			" No framework halves awaiting their consumer, no pools nobody switches, no contracts nobody serves: a capability with zero consumers is a ",
			createVNode(_components.em, { children: "commit stage inside" }),
			" the PR that consumes it, never a PR of its own (W2.2’s “a daemon with zero consumers is a commit stage” ruling; the #1651 complete-but-unconsumed adapter is the canonical tell). The one sanctioned exception is a framework PR whose consumer-proof is a paired second consumer landing with it (the W2.1/drishti precedent)."
		] }),
		"\n",
		createVNode("a", { id: "w12" }),
		"\n",
		createVNode(_components.h3, {
			id: "w12--restore-survives-an-unclean-kaval-death-shipped---independent-of-w10",
			children: ["W12 — restore survives an unclean kaval death ", createVNode(_components.em, { children: [
				"(shipped ",
				createVNode($$PrLink, { pr: 1784 }),
				" — independent of W10)"
			] })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "In simple words:" }),
			" before W12, if kaval died cleanly your agents came back after restore — but if it was killed or crashed, you got your terminals back ",
			createVNode(_components.em, { children: "empty" }),
			": the agents were gone, and you restarted each one by hand.",
			createVNode($$Footnote, { children: [
				"The 2026-07-12 production incident: prod’s kaval was killed un-gracefully; session restore brought back the terminal list, but every agent came back as a bare shell and srid restored them by hand. On zest, a ",
				createVNode(_components.em, { children: "graceful" }),
				" kaval restart restores agents fine — the two outcomes differ only in how kaval died."
			] }),
			" After W12 the two cases look the same: restore brings the agents back either way. The only thing an unclean death may still lose is the last few moments of screen output."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The defect, precisely (corrected 2026-07-12 after the incident forensics + a live kill-9 — the seedling’s exit-flush guess was falsified):" }),
			" the facts are ",
			createVNode(_components.strong, { children: "not" }),
			" written at exit — padi already journals ",
			createVNode(_components.code, { children: "restoreTarget" }),
			" on every change (the always-on autosave). The real defect: an unclean kaval death makes each terminal’s agent sensor emit an authoritative ",
			createVNode(_components.em, { children: "agent-ended" }),
			" — because it can no longer ",
			createVNode(_components.strong, { children: "observe" }),
			" the terminal through the dead pty-host — and the fold turns that into ",
			createVNode(_components.code, { children: "restoreTarget: none" }),
			", which the always-on autosave journals ",
			createVNode(_components.strong, { children: "over" }),
			" the good ",
			createVNode(_components.code, { children: "exact" }),
			" targets ~0.5s later, before any restore. On 2026-07-12 the false ",
			createVNode(_components.em, { children: "ended" }),
			" fired at 09:38:39.923, ",
			createVNode(_components.strong, { children: "~3ms before" }),
			" the endpoint was even marked ",
			createVNode(_components.code, { children: "degraded" }),
			", so no freeze/park-on-degraded guard could win that race — the emit itself is the defect. ",
			createVNode(_components.strong, { children: "The cure (structural, not a race-win — hardened after an independent perfection review):" }),
			" tell the two facts apart by the triggering foreground sample’s OWN content — pure data, so there is no cross-stream ordering to lose. A resolved-null whose foreground is a ",
			createVNode(_components.strong, { children: "defined non-shell process" }),
			" (the agent’s own pid, its session file gone — exactly what an unclean death leaves) is ",
			createVNode(_components.em, { children: "ambiguous" }),
			": emit ",
			createVNode(_components.code, { children: "unknown" }),
			", and the fold ",
			createVNode(_components.strong, { children: "keeps" }),
			" the last agent and its resume id — for a pre-death buffered burst of any length. A resolved-null whose foreground is ",
			createVNode(_components.strong, { children: "shell-idle" }),
			" (the shell is back — the post-quit state) is a genuine end and still ",
			createVNode(_components.strong, { children: "clears" }),
			" the target, so restore never resurrects a dead agent. Safety leans on one pinned invariant: blindness never presents an ",
			createVNode(_components.code, { children: "undefined" }),
			" foreground while an agent lives (the tap’s error handler doesn’t reset the last sample), so a dead observer always shows the stale ",
			createVNode(_components.em, { children: "defined" }),
			" agent pid. The resume id survives an unclean death by construction. (A companion fix freezes the autosave across ",
			createVNode(_components.code, { children: "session.restore" }),
			" and re-parks a respawn that fails mid-restore, so a kaval death ",
			createVNode(_components.em, { children: "during" }),
			" restore re-offers the card instead of deleting the terminals.)"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped" }),
			" ",
			createVNode($$PrLink, { pr: 1784 }),
			". The grounding overturned the seedling’s two guesses: the resume facts live in ",
			createVNode(_components.strong, { children: "padi, not kaval" }),
			" (kaval persists no session file at all), and they were ",
			createVNode(_components.strong, { children: "already" }),
			" journaled on change — so the “move exit-flush to change-journaling” framing was moot. The fix lives entirely in ",
			createVNode(_components.code, { children: "@kolu/padi" }),
			": the agent sensor’s ",
			createVNode(_components.strong, { children: "sample-content discriminant" }),
			" (a resolved-null with a defined non-shell foreground emits ",
			createVNode(_components.code, { children: "unknown" }),
			", not an authoritative end) plus a restore-respawn ",
			createVNode(_components.strong, { children: "seed" }),
			" so restore re-persists the surviving ",
			createVNode(_components.code, { children: "exact" }),
			", never ",
			createVNode(_components.code, { children: "none" }),
			", and a ",
			createVNode(_components.strong, { children: "freeze + re-park" }),
			" so a kaval death mid-restore never deletes terminals. Witnessed on a real kill-9 — ",
			createVNode(_components.code, { children: "restoreTarget" }),
			" stayed ",
			createVNode(_components.code, { children: "exact" }),
			" across the kill (100/100 polls) and restore brought the agent back on its exact prior session (same ",
			createVNode(_components.code, { children: "sessionId" }),
			" + transcript). Independent of W10: that lives in kolu-server’s host pool; this lives in the per-host padi."
		] }),
		"\n",
		createVNode("a", { id: "cleanup" }),
		"\n",
		createVNode("a", { id: "parked" }),
		"\n",
		createVNode(_components.h3, {
			id: "consolidation-and-parked-cleanups-unnumbered--a-parallel-ongoing-track",
			children: ["Consolidation and parked cleanups ", createVNode(_components.em, { children: "(unnumbered — a parallel, ongoing track)" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"W2 and W3 shipped at pace (a deliberate call); the consolidation pays the pace’s debts — refactors, decomplecting, framework-level electricity upstreaming, deletions. Nothing user-visible ships here; that is the point. ",
			createVNode(_components.strong, { children: ["The active plan of record is ", createVNode(_components.a, {
				href: "surface-runtime-boundary.html",
				children: "A Complete Surface Runtime"
			})] }),
			" — the kernel + bridge PR sequence, byte-identical on screen, each PR proven by what it deletes. A shipped phase’s deferred review items land in the note that owns the area — or below, as a parked cleanup with a named gate; an item that never ripens is deleted with a reason, never silently kept."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Parked, each with its gate" }),
			" ",
			createVNode(_components.em, { children: "(none is schedulable until its gate opens)" }),
			":"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Unify the wait-until-predicate scaffold shared by padi-tui and kaval-tui" }),
				" — the duplication is REAL today (padi-tui ",
				createVNode(_components.code, { children: "read.ts:awaitAgentState" }),
				" and kaval-tui ",
				createVNode(_components.code, { children: "wait.ts:awaitOutputCondition" }),
				" share a near-verbatim ~40-line scaffold: the 5-arm ",
				createVNode(_components.code, { children: "WaitOutcome" }),
				" union, AbortSignal chaining, first-writer-wins settle — held in lockstep by JSDoc cross-references), but this item’s earlier form was doubly wrong: the “ledger tag comment in ",
				createVNode(_components.code, { children: "packages/padi-tui/src/" }),
				"” does not exist (grep confirms), and the earlier kolu-cli gate was misdrawn — the CLI faces consume neither helper, so its shipping proves nothing here. Real gate: a third consumer of the ",
				createVNode(_components.em, { children: "scaffold" }),
				", or lockstep drift actually biting. ",
				createVNode(_components.strong, { children: "That gate is met by kolu-cli PR2 (in build)" }),
				", and the extraction splits by what each piece IS: the generic scaffold (",
				createVNode(_components.code, { children: "WaitOutcome" }),
				"/",
				createVNode(_components.code, { children: "runWait" }),
				" — outcome union, abort chain, first-writer settle, timeout/fallback) lands in ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/surface/wait" }) }),
				" (the ",
				createVNode(_components.code, { children: "firstFrame" }),
				" precedent: a zero-import stream-consumption leaf all three consumers already depend on), while the padi-shaped predicate vocabulary (",
				createVNode(_components.code, { children: "awaitAgentState" }),
				", ",
				createVNode(_components.code, { children: "watchTerminals" }),
				", ",
				createVNode(_components.code, { children: "WAIT_STATES" }),
				"/",
				createVNode(_components.code, { children: "agentMatchesUntil" }),
				") graduates into ",
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "@kolu/padi" }),
					"’s ",
					createVNode(_components.code, { children: "dial" }),
					" entry"
				] }),
				" — NOT @kolu/surface, which must never gain padi vocabulary — with kolu-mcp’s ",
				createVNode(_components.code, { children: "wait_agentState" }),
				" as the verbatim second consumer. Watchers stay per-consumer (port, not extract)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Delete the legacy-kaval migration arm" }),
				" — at a version srid names. The W2.2 adopter (binder legacy-socket hint, padi’s legacy-adopt branch, port-keyed discovery in ",
				createVNode(_components.code, { children: "socketPath.ts" }),
				", the ",
				createVNode(_components.code, { children: "adoption-upgrade" }),
				" VM tests) exists solely for pre-W2.2 upgrades; done when no code path can dial a port-keyed kaval and the release note names the required upgrade path."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Split the sensors out of padi’s restart hash" }), " — only on recorded deploy-pain evidence (a stretch where sensor-only changes forced padi restarts users noticed). The restart is cheap by design; until the evidence exists this is deliberately a no-op, and never serve stale detection (#1031) governs any eventual split."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Retire the near-unreachable ",
					createVNode(_components.code, { children: "PADI_MEMORY_READ_ERROR" }),
					" contract arm"
				] }),
				" — ",
				createVNode($$PrLink, { pr: 1699 }),
				" moved the memory read onto the in-process mirror, which cannot fail like the remote dial the arm was built for; retiring it is a contract change and ships as its own deliberate wire-version decision, not a rider."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The fine-grained CI token" }), " — srid mints a public-repo read-only PAT (its only job: authenticated rate limits for flake-input fetches); an agent wires it via the pool provisioning path (stdin, never in the store or logs); done when the personal token is rotated and absent from every box."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Flaky-test debt" }),
				" — a standing root-cause pass dispatched off ",
				createVNode(_components.a, {
					href: "flaky-test-tracker.html",
					children: "the flaky tracker"
				}),
				" (fix or quarantine-with-reason, never re-tuned retries); done when a full both-platform e2e run passes without retries twice consecutively, or every tracked flake carries a root-cause note and a quarantine decision."
			] }),
			"\n"
		] }),
		"\n",
		createVNode("a", { id: "w34" }),
		"\n",
		createVNode(_components.h3, {
			id: "w34--remote-e2e-parity-in-ci-parked--machinery-done--proven-the-gate-waits-on-the-parity-tail-the-remote-bind-parity-note-srid-2026-07-05",
			children: ["W3.4 — remote e2e parity in CI ", createVNode(_components.em, { children: [
				"(parked — machinery done + proven; the gate waits on the parity tail: ",
				createVNode(_components.a, {
					href: "remote-bind-parity.html",
					children: "the remote-bind parity note"
				}),
				", srid 2026-07-05)"
			] })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Today the full e2e suite (~493 scenarios) runs in CI per-PR ",
			createVNode(_components.strong, { children: "locally only" }),
			"; the ",
			createVNode(_components.code, { children: "KOLU_PADI_HOST" }),
			" path has zero CI coverage (the sandbox claim is honest but the exposure is real — the two live bugs of 2026-07-04 were both found by hand). This phase closes it: ",
			createVNode(_components.strong, { children: "every PR’s CI runs the existing e2e suite AS-IS, twice — local (as today) and with kolu-server bound remotely" }),
			" (",
			createVNode(_components.code, { children: "KOLU_PADI_HOST=<a second pu box leased from the pool>" }),
			"). No tagged subsets, no reduced tier: the same scenarios, a real ssh hop."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Mechanics (we do NOT control the pool boxes’ config — everything rides ssh we already have): the CI recipe leases a ",
			createVNode(_components.strong, { children: "pair" }),
			" of pool boxes — box A runs the lane as today, box B is the bind target; box B’s per-run hygiene (state wipe before, destructive-ack, provisioning via the baked drv map — which also exercises the cross-arch arm when the darwin lane binds a linux box) is done over the ssh session, never via box config. The ",
			createVNode(_components.code, { children: "just e2e-ssh" }),
			" transport lane folds into the same node."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The real work is the ",
			createVNode(_components.strong, { children: "burn-down" }),
			" so “as-is” is honest: (a) the ~70 scenarios that failed the one manual full-suite ssh run need their tight Playwright waits widened to remote-tolerant timeouts — behaviour was correct, the waits were not; (b) the agent-state scenarios get an honest mock — ",
			createVNode(_components.strong, { children: "decided 2026-07-04 (srid), replacing an earlier copy-files-over-ssh idea" }),
			": a small pretend-agent program runs INSIDE the kolu terminal like a real agent, driven through the terminal itself (“act busy”, “act done”), writing its session files on its own machine at the real default paths. Wherever the terminal is, the files land on the right machine by construction — the tests contain no remote-vs-local branches at all, and the pretending gets MORE realistic (a foreground process writing its own files is exactly what production senses — including the file-watching layer where #1680 lived); (c) lane wall-time budgeted (remote suite ran ~2× local on the manual run) — it runs as a parallel odu node on the paired box, so the wall grows only if it becomes the slowest node."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Done:" }), " a PR that breaks any feature only-under-remote-binding goes RED in normal CI on both platform lanes; the remote node’s scenario count equals the local node’s (no silent exclusions — an excluded scenario is a named, counted skip with a reason); the pair-lease returns both boxes clean."] }),
			"\n"
		] }),
		"\n",
		createVNode("a", { id: "future" }),
		"\n",
		createVNode(_components.h3, {
			id: "future-work--demand-driven",
			children: "Future work — demand-driven"
		}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"(The researched, tiered menu for everything below — ecosystem survey × shipped primitives, plus the promoted ",
			createVNode(_components.a, {
				href: "port-preview.html",
				children: "port-preview"
			}),
			" and ",
			createVNode(_components.a, {
				href: "shared-canvas.html",
				children: "shared-canvas"
			}),
			" notes — lives in ",
			createVNode(_components.a, {
				href: "remote-terminals-future.html",
				children: "remote-terminals-future"
			}),
			".)"
		] }) }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Cross-host dock" }),
			" (B-lite: foreign hosts’ rows, urgency-ranked, click = switch + focus — the host axis is already in the contract) is the first escalation if switching proves insufficient. ",
			createVNode(_components.strong, { children: "kolu-cli" }),
			" (the ",
			createVNode(_components.code, { children: "kolu tui" }),
			"/",
			createVNode(_components.code, { children: "kolu mcp" }),
			" faces) — the graduation proof, now a ratified plan of its own: ",
			createVNode(_components.a, {
				href: "kolu-cli.html",
				children: "kolu-cli"
			}),
			" owns the criterion (the named padiSurface path incl. the ",
			createVNode(_components.code, { children: "terminalAttach" }),
			" ",
			createVNode(_components.code, { children: "{seq}" }),
			" stream, both transports, or it doesn’t count). ",
			createVNode(_components.strong, { children: "Hybrid canvas" }),
			" (model B) only if one-window side-by-side proves a recurring demand — it stays an aggregation layer over N bindings, zero daemon changes."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "risks-named-with-mitigations",
			children: "Risks, named, with mitigations"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Attach latency gains a local hop" }), " (kaval→padi→kolu-server vs kaval→kolu-server). Measure typing-echo p99 before/after W2 with a budget (< 5ms added); if breached, the carve-out permits a raw-byte relay on the padi→kolu-server leg (frontDaemonOverStdio-style, no decode) without touching the contract."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Sensor code changes often, and any padi change restarts padi" }), " (the restart-hash covers the whole package). Accepted: a padi restart re-reads its store and re-runs sensors — seconds, PTYs untouched. If deploys make this hurt in practice, the sensors can later be split out of the hash; we’ll decide that on evidence, not up front."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Multi-client writes" }), " (two kolu-servers, one padi): padi serializes all chrome/layout procedures — one writer, last-write-wins, concurrent editors see each other’s moves live. Accepted semantics (same as any shared session)."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "drishti gate" }),
				": the graduated forwarding helpers (per-member policy, input-keyed forward) and any per-connection scope machinery landing in ",
				createVNode(_components.code, { children: "@kolu/surface*" }),
				" — paired drishti PR, pinned to final kolu HEAD, per ",
				createVNode(_components.code, { children: ".claude/rules/surface.md" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "N warm bindings have a standing cost" }),
				" (one ssh session + one urgency subscription per host, even while parked elsewhere). Bounded: the pool holds only user-added hosts, the subscription is the count-sized urgency member (never ",
				createVNode(_components.code, { children: "terminals" }),
				"), and an unreachable host degrades its chip, not the app. Costed explicitly rather than discovered in production."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Session-file migration" }), ": one-shot import at padi’s first boot, then hard cutover — a failed import crashes loudly (fail-fast), never silently starts empty."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Testing W2.2 on zest" }),
				": that box runs TWO instances sharing ",
				createVNode(_components.code, { children: "~/.config/kolu/config.json" }),
				" — the deployed one and a ",
				createVNode(_components.code, { children: "faint-bottom" }),
				" dev worktree carrying an older, pre-fix pairing implementation that can null the shared file and poison any repro. Stop or reconcile ",
				createVNode(_components.code, { children: "faint-bottom" }),
				" before testing there. (The state-root move being tested is exactly what ends this collision class.)"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-shipped-record",
			children: "The shipped record"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Each phase, compacted to what shipped and the facts that still govern; the full build narratives live in git history and the PRs. ",
			createVNode(_components.strong, { children: "When packages are born" }),
			" — graduation is a scheduled event, not a side effect:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "package" }),
					"\n",
					createVNode(_components.th, { children: "born" }),
					"\n",
					createVNode(_components.th, { children: "why then, not earlier/later" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "@kolu/padi" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "W1.C" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"location is structure: code destined for the daemon must not camp in ",
						createVNode(_components.code, { children: "packages/server" }),
						". Package at W1, ",
						createVNode(_components.strong, { children: "process at W2.2" }),
						". ",
						createVNode(_components.strong, { children: "The dependency arrow: padi imports no kolu app package" }),
						" (libraries only) — the app imports padi, never the reverse. Otherwise app churn would pollute padi’s restart hash, and kolu-cli (which exists to prove padi needs no kolu) would drag kolu back in"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "re-serve machinery" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "W2.1" }),
						" ✓ ",
						createVNode($$PrLink, { pr: 1661 }),
						", into existing ",
						createVNode(_components.code, { children: "@kolu/surface" }),
						" / ",
						createVNode(_components.code, { children: "surface-nix-host" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"it generalizes proven pulam-web code for a second consumer (kolu-server) — that ",
						createVNode(_components.em, { children: "is" }),
						" the graduation moment; no new package, it extends the receptacle that already owns mirroring (drishti-gated)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "the control core" }),
					"\n",
					createVNode(_components.td, { children: ["lives in ", createVNode(_components.code, { children: "@kolu/padi" })] }),
					"\n",
					createVNode(_components.td, { children: [
						"extraction is gated on electricity test ② (a real axis of variation), and with one daemon the axis doesn’t vary yet — nothing to encapsulate. If a second daemon adopts it, that’s test ③’s after-the-fact proof and it graduates to ",
						createVNode(_components.code, { children: "@kolu/surface-daemon" }),
						". (Corrected 2026-07-03: an earlier wording here inverted the doctrine into ‘proof before extraction’ — the second consumer is the proof extraction was right, never the gate for doing it)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"padi’s ",
						createVNode(_components.code, { children: "wait" }),
						" (the agent done-signal)"
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "W2.3" }), ", a subcommand of the padi binary"] }),
					"\n",
					createVNode(_components.td, { children: "no new package: the kaval-tui precedent (separate TUI package) is for a full client; a done-signal probe rides the daemon’s own CLI" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "kolu-cli" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "planned" }),
						" — ",
						createVNode(_components.a, {
							href: "kolu-cli.html",
							children: "kolu-cli"
						}),
						", new package"
					] }),
					"\n",
					createVNode(_components.td, { children: "a new consumer app, not an extraction — it exists to prove padiSurface serves a second frontend (test ③’s proof); the plan note owns scope + criterion" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode("a", { id: "w0" }),
		"\n",
		createVNode(_components.h3, {
			id: "w0--decks-cleared-all-three-landed",
			children: ["W0 — decks cleared ", createVNode(_components.em, { children: "(all three landed)" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"All three landed: the ",
			createVNode(_components.strong, { children: [
				"freeze of ",
				createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
				" at 3.0 + pulam-web retired"
			] }),
			" (",
			createVNode($$PrLink, { pr: 1650 }),
			"); the ",
			createVNode(_components.strong, { children: "overflow frame" }),
			" (",
			createVNode($$PrLink, { pr: 1591 }),
			", kaval contract 5.0 — typed ",
			createVNode(_components.em, { children: "overflow → re-attach" }),
			", the recovery loop later migrated into padi at W2); and the ",
			createVNode(_components.strong, { children: "four in-flight PRs closed" }),
			" (",
			createVNode($$PrLink, { pr: 1637 }),
			" ",
			createVNode($$PrLink, { pr: 1638 }),
			" ",
			createVNode($$PrLink, { pr: 1639 }),
			" ",
			createVNode($$PrLink, { pr: 1640 }),
			", 2026-07-01), the ",
			createVNode(_components.a, {
				href: "remote-terminals.html#finale",
				children: "pre-padi plan"
			}),
			" marked superseded."
		] }),
		"\n",
		createVNode("a", { id: "w1" }),
		"\n",
		createVNode(_components.h3, {
			id: "w1--the-padi-seam-in-place--shipped-",
			children: [
				"W1 — the padi seam, in place — ",
				createVNode(_components.em, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1652 })
			]
		}),
		"\n",
		createVNode("a", { id: "w1c" }),
		"\n",
		createVNode("a", { id: "w1m" }),
		"\n",
		createVNode("a", { id: "w1r" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped 2026-07-02" }),
			" — one PR (contract → motion → rewiring commit stages): the whole root ",
			createVNode(_components.code, { children: "terminal.*" }),
			"/",
			createVNode(_components.code, { children: "git.*" }),
			" RPC namespace deleted member-by-member into padiSurface procedures; ",
			createVNode(_components.code, { children: "@kolu/padi" }),
			" exited complete ",
			createVNode(_components.strong, { children: "as a library" }),
			" (W2.2 gave it the process). Still standing from this phase: the ",
			createVNode(_components.strong, { children: "seal" }),
			" — tests pinning the boundary both ways (",
			createVNode(_components.code, { children: "packages/server" }),
			" contains no terminal code and imports only padi’s public entries; padi imports nothing from kolu’s packages, transitively); ",
			createVNode(_components.strong, { children: "permanent trace logging" }),
			" on session writes (every destructive write logs a stack — the residue of three session-loss fixes, each pinned by a failing-first test); and the ",
			createVNode(_components.strong, { children: "typing baseline" }),
			" (#1660: p50 2.14 ms · p99 4.36 ms — the reference W2.2’s ≈ 9.3 ms ceiling was set against; ",
			createVNode(_components.a, {
				href: "padi-latency-baseline.html",
				children: "the baseline note"
			}),
			")."
		] }),
		"\n",
		createVNode("a", { id: "w2" }),
		"\n",
		createVNode(_components.h3, {
			id: "w2--padi-the-process-local--shipped-three-prs",
			children: [
				"W2 — padi the process ",
				createVNode(_components.em, { children: "(local)" }),
				" — ",
				createVNode(_components.em, { children: "shipped, three PRs" })
			]
		}),
		"\n",
		createVNode(_components.p, { children: "W1 sealed the domain behind the contract as a library; W2 gave it a process. The note-wide self-sufficiency law was first articulated here." }),
		"\n",
		createVNode("a", { id: "w21" }),
		"\n",
		createVNode(_components.h4, {
			id: "w21--the-re-serve-machinery-in-kolusurface--shipped-",
			children: [
				"W2.1 — the re-serve machinery in ",
				createVNode(_components.code, { children: "@kolu/surface*" }),
				" — ",
				createVNode(_components.em, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1661 })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped 2026-07-03" }),
			" — the policy-driven re-serve machinery (streams + events re-serve; cells always fold; procedures always forward), landed first to freeze the surface API before the big PR. drishti adopting the new ",
			createVNode(_components.code, { children: "initialKeys" }),
			" reconcile hook (",
			createVNode(_components.a, {
				href: "https://github.com/srid/drishti/pull/84",
				children: "srid/drishti#84"
			}),
			", fixing its own ghost-PID bug with it) was the second-consumer proof."
		] }),
		"\n",
		createVNode("a", { id: "w22" }),
		"\n",
		createVNode(_components.h4, {
			id: "w22--padi-the-process-the-binary-and-the-cutover--shipped-",
			children: [
				"W2.2 — padi the process: the binary AND the cutover — ",
				createVNode(_components.em, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1664 })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped 2026-07-03" }),
			" — the padi binary born ",
			createVNode(_components.strong, { children: "and" }),
			" kolu-server bound to it, one PR (a daemon with zero consumers is a ",
			createVNode(_components.em, { children: "commit stage" }),
			", not a PR). Standing doctrine born here: ",
			createVNode(_components.strong, { children: "deploy-adoption — a deploy must ADOPT a compatible running daemon and its live PTYs; restore is the path for a DEAD daemon only." }),
			" Also still governing: ",
			createVNode(_components.strong, { children: "newest-wins convergence" }),
			" (a newer binder drains a skewed padi via the control core and respawns its own closure; an older binder is refused, never recycles anything), ",
			createVNode(_components.strong, { children: "padiLink" }),
			" on the shell surface (padi cannot serve its own unreachability), ",
			createVNode(_components.strong, { children: "parked records immutable" }),
			" (the no-non-user-writer invariant), and the measured hop — ",
			createVNode(_components.strong, { children: "+1.3 ms p99" }),
			" against the +5 budget."
		] }),
		"\n",
		createVNode("a", { id: "w23" }),
		"\n",
		createVNode(_components.h4, {
			id: "w23--padi-tui-is-born-and-the-burial--shipped-",
			children: [
				"W2.3 — padi-tui is born, and the burial — ",
				createVNode(_components.em, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1665 })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped 2026-07-03" }),
			" — the ",
			createVNode(_components.strong, { children: "dial carve" }),
			" (",
			createVNode(_components.code, { children: "@kolu/padi/dial" }),
			"; the seal’s allowed set is exactly ",
			createVNode(_components.code, { children: "{assembly, surface, dial, log}" }),
			"); ",
			createVNode(_components.strong, { children: "padi-tui born" }),
			" (wait/status off real agent state · ",
			createVNode(_components.code, { children: "create --parent" }),
			" / ",
			createVNode(_components.code, { children: "--worktree" }),
			" · the live ",
			createVNode(_components.code, { children: "activity" }),
			" stream · ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "$PADI_SOCKET" }), " stamped on every padi-spawned terminal"] }),
			", so the agent-drives-agent loop is flagless); and ",
			createVNode(_components.strong, { children: "the burial" }),
			" — packages/pulam + pulam-tui deleted, ",
			createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
			" + its assemblers deleted, every legacy-conf strip/import backing the file up first."
		] }),
		"\n",
		createVNode("a", { id: "w3" }),
		"\n",
		createVNode(_components.h3, {
			id: "w3--remote-the-binding--the-full-peer-gaps--the-ci-parity-leg-w34-is-parked-under-whats-next",
			children: ["W3 — remote ", createVNode(_components.em, { children: [
				"(the binding · the full-peer gaps — the CI-parity leg ",
				createVNode(_components.a, {
					href: "#w34",
					children: "W3.4"
				}),
				" is parked, under what’s next)"
			] })]
		}),
		"\n",
		createVNode("a", { id: "w31" }),
		"\n",
		createVNode(_components.h4, {
			id: "w31--the-remote-binding--shipped-",
			children: [
				"W3.1 — the remote binding — ",
				createVNode(_components.em, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1675 })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped 2026-07-04" }),
			" — provision + front a remote padi over ssh: ",
			createVNode(_components.code, { children: "KOLU_PADI_HOST" }),
			" with ",
			createVNode(_components.code, { children: "RemotePadiSession" }),
			" as the ssh arm through the same re-serve seam; the arch-keyed drv map ships kaval inside padi’s closure (one dial provisions both, cross-arch verified); ",
			createVNode(_components.code, { children: "padi --stdio" }),
			" fronts the durable daemon; convergence hardened for the transport (the instance-keyed drain fence, adopt-loudly on budget exhaustion); every degraded bind a standing dialog state naming the bound host; deterministic bounded daemon logs on all spawn paths; and the ssh e2e lanes (",
			createVNode(_components.code, { children: "just e2e-ssh" }),
			" + ",
			createVNode(_components.code, { children: "e2e-ssh-2box" }),
			", destructive-ack-guarded). Standing permanently: ",
			createVNode(_components.strong, { children: "the ssh-user caveat" }),
			" — the remote padi runs as the SSH user; 0700 sockets make the SSH identity the daemon owner."
		] }),
		"\n",
		createVNode("a", { id: "w32" }),
		"\n",
		createVNode(_components.h4, {
			id: "w32--the-full-peer-gaps--shipped--",
			children: [
				"W3.2 — the full-peer gaps — ",
				createVNode(_components.em, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1685 }),
				" ",
				createVNode($$PrLink, { pr: 1686 })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped 2026-07-05, two self-sufficient PRs." }),
			" ",
			createVNode(_components.strong, { children: "Preview" }),
			" (#1685): a file on a remote machine now previews for real — the route asks padi for the bytes in bounded 8 MiB chunks, pinned by a strong ETag so a file changing mid-read aborts loudly instead of serving spliced bytes. ",
			createVNode(_components.strong, { children: "Inventory" }),
			" (#1686): the “Running daemons” list shows the connected machine’s daemons, each group labeled by machine. Together they met the W3 “full peer — nothing silently wrong-host” promise for the single-host binding."
		] }),
		"\n",
		createVNode("a", { id: "w4" }),
		"\n",
		createVNode(_components.h3, {
			id: "w4--the-switch--shipped-",
			children: [
				"W4 — the switch — ",
				createVNode(_components.em, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1714 })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped 2026-07-07" }),
			" as ",
			createVNode(_components.code, { children: "@kolu/surface-map" }),
			" + the ",
			createVNode(_components.code, { children: "KOLU_PADI_HOST" }),
			"-gated multi-host canvas: kolu-server holds a warm pool of padi connections (",
			createVNode(_components.code, { children: "buildHostRegistry" }),
			", one ",
			createVNode(_components.code, { children: "PadiSession" }),
			" per machine, opened on demand), each browser tab names its machine, and switching swaps the client’s wiring in place — no reload — like switching tmux sessions. Your laptop tab can sit on ",
			createVNode(_components.code, { children: "zest" }),
			" while your phone sits on ",
			createVNode(_components.code, { children: "sincereintent" }),
			", against the same kolu, neither disturbing the other. ",
			createVNode(_components.em, { children: [
				"(The machinery primer: ",
				createVNode(_components.a, {
					href: "surface-hosting-101.html",
					children: "the surface framework’s hosting side, taught"
				}),
				" — serve → mirror → sessions → the registry.)"
			] }),
			" Deliberately, the ",
			createVNode(_components.strong, { children: "only" }),
			" ways in until the feature stabilizes are the picker under the command palette’s ",
			createVNode(_components.strong, { children: "Labs" }),
			" group and ",
			createVNode(_components.code, { children: "KOLU_PADI_HOST" }),
			" (which sets the ",
			createVNode(_components.strong, { children: "default host only" }),
			" — the picker switches freely away from it); the ChromeBar picker graduates when it’s stable."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Still live from the ship: ",
			createVNode(_components.strong, { children: "honest clocks (piece 5) is a named fast-follow" }),
			" — the serving half exists (a wall-clock probe every daemon answers), and the offset half now ships in the surface framework: ",
			createVNode(_components.code, { children: "makeSession" }),
			" measures the far-end offset off the framework-reserved ",
			createVNode(_components.code, { children: "system.clockNow" }),
			" at admit and carries it on the session’s ",
			createVNode(_components.code, { children: "connected" }),
			" state, which a keyed ",
			createVNode(_components.code, { children: "SurfaceMap" }),
			" folds into ",
			createVNode(_components.code, { children: "EntryStatus.connected" }),
			" (PR3 — the offset MEASUREMENT graduated to the framework-reserved ",
			createVNode(_components.code, { children: "system.clockNow" }),
			", a member every surface answers; the padi-specific ",
			createVNode(_components.code, { children: "control.core.clockNow" }),
			" is ",
			createVNode(_components.strong, { children: "kept forever" }),
			" — a frozen-core member never versions, so it stays as the cross-version skew channel old binders cross on, living ",
			createVNode(_components.em, { children: "beside" }),
			" the new path, not replaced by it). The remaining consuming piece is the client formatters reprojecting host-stamped times through that offset; until they do, remote hosts’ ages mislabel (a pre-existing W3.1-era gap, not a switch regression). The per-host-state bugs the deploy surfaced (focus, splits, camera) got instance fixes in-PR; their class fix became ",
			createVNode(_components.a, {
				href: "#w7",
				children: "W7"
			}),
			". The ledger’s L11 sweep (the client’s interim wire-shape scaffolding) landed with cleanup campaign 3 (",
			createVNode($$PrLink, { pr: 1747 }),
			")."
		] }),
		"\n",
		createVNode("a", { id: "w7" }),
		"\n",
		createVNode(_components.h3, {
			id: "w7--per-host-state-by-ownership-not-enumeration--shipped---the-sriddrishti91-framework-gate-pair",
			children: [
				"W7 — per-host state by ownership, not enumeration — ",
				createVNode(_components.em, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1723 }),
				" ",
				createVNode(_components.em, { children: [
					"(+ the ",
					createVNode(_components.a, {
						href: "https://github.com/srid/drishti/pull/91",
						children: createVNode(_components.code, { children: "srid/drishti#91" })
					}),
					" framework-gate pair)"
				] })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped 2026-07-08" }),
			" — the class fix for W4’s “forgotten field” bug family (focus, splits, camera each quietly living at app lifetime while the tiles became per-host): per-host-ness flipped from ",
			createVNode(_components.strong, { children: "enumeration to ownership" }),
			". ",
			createVNode(_components.code, { children: "scopedByEntry" }),
			" lives in ",
			createVNode(_components.code, { children: "@kolu/surface-map" }),
			"; kolu’s ",
			createVNode(_components.code, { children: "hostScope/hostScopes" }),
			" dissolves the ",
			createVNode(_components.code, { children: "HostView" }),
			" record and its kin into one per-host reactive owner, so everything born inside the canvas subtree is per-host ",
			createVNode(_components.strong, { children: "by construction" }),
			", and a boundary-guard test (",
			createVNode(_components.code, { children: "canvas/canvasBoundaryGuard.test.ts" }),
			") fences state born outside it. The design story lives in ",
			createVNode(_components.a, {
				href: "surface-map-101.html",
				children: "surface-map-101"
			}),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Two live edges: ",
			createVNode(_components.strong, { children: ["K1’s completion shipped as ", createVNode(_components.a, {
				href: "#w9",
				children: "W9"
			})] }),
			" — the per-host wire subscriptions the owner deliberately did not retain. ",
			createVNode(_components.strong, { children: "Field acceptance still open:" }),
			" srid confirms the live camera symptom gone on a ",
			createVNode(_components.strong, { children: "real deploy" }),
			" (the timing a unit pin structurally can’t see) before this phase closes."
		] }),
		"\n",
		createVNode("a", { id: "w8" }),
		"\n",
		createVNode(_components.h3, {
			id: "w8--remote-terminals-documented-honestly--shipped---a-docs-phase",
			children: [
				"W8 — remote terminals, documented honestly — ",
				createVNode(_components.em, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1722 }),
				" ",
				createVNode($$PrLink, { pr: 1727 }),
				" ",
				createVNode(_components.em, { children: "(a docs phase)" })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped 2026-07-08, two PRs" }),
			" — a docs phase seeded by a live incident (a kolu remote terminal is an ",
			createVNode(_components.em, { children: "ssh session" }),
			", not the machine’s GUI login session, so tools like ",
			createVNode(_components.code, { children: "gh" }),
			" that lean on the macOS Keychain silently break over the bind): the atlas analysis of the ssh-session environment gaps (",
			createVNode($$PrLink, { pr: 1722 }),
			") and the user-facing website page (",
			createVNode($$PrLink, { pr: 1727 }),
			" — remote hosts as a ",
			createVNode(_components.em, { children: "feature" }),
			": enable · add · switch, with the gaps as one compact limitations/FAQ section, marked alpha). The living rule: ",
			createVNode(_components.strong, { children: "the catalogue grows by incident" }),
			" — every future “works locally, breaks in kolu” report lands a row (the flaky-tracker discipline, applied to environment gaps)."
		] }),
		"\n",
		createVNode("a", { id: "w6" }),
		"\n",
		createVNode(_components.h3, {
			id: "w6--the-honest-connect--shipped---the-sriddrishti92-pair--both-merged-2026-07-09",
			children: [
				"W6 — the honest connect — ",
				createVNode(_components.em, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1730 }),
				" ",
				createVNode(_components.em, { children: [
					"(+ the ",
					createVNode(_components.a, {
						href: "https://github.com/srid/drishti/pull/92",
						children: "srid/drishti#92"
					}),
					" pair — both merged 2026-07-09)"
				] })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped 2026-07-09" }),
			" (merge ",
			createVNode(_components.code, { children: "e4acb5b2f" }),
			") — a first connect to a fresh remote host can spend minutes in a Nix copy+build, and the canvas used to show one mute ",
			createVNode(_components.strong, { children: "“Connecting…”" }),
			" for the whole window; now the connect overlay names the phase, streams a live tail of the actual build output, and shows a server-stamped elapsed — and the connection type was made perfect along the way (the server’s state sum reaches the browser as a discriminated mirror, not a lying 4-nullable-field product; seven names collapsed into the family below; ",
			createVNode(_components.code, { children: "remoteProgressLines" }),
			" and the in-band ",
			createVNode(_components.code, { children: "[local]" }),
			"/",
			createVNode(_components.code, { children: "[remote]" }),
			" prefixes deleted). Live testing hardened the batch: the coarse-chip/fine-cell divergence trap is a ",
			createVNode(_components.strong, { children: "type error" }),
			" (",
			createVNode(_components.code, { children: "connectPhase" }),
			" exists only on the not-yet-connected facts arms); the cell is ",
			createVNode(_components.strong, { children: "floored on transport liveness" }),
			"; and the connect copy has ",
			createVNode(_components.strong, { children: "one authority" }),
			" — ",
			createVNode(_components.code, { children: "CanvasMode" }),
			" arms carry no strings and no per-phase flags, display derives from the frame’s data, so a silent or flickering connect window is unwritable. ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "ConnectPhase" }) }),
			" graduated to a ",
			createVNode(_components.code, { children: "@kolu/surface-remote" }),
			" export beside ",
			createVNode(_components.code, { children: "ConnectionInfo" }),
			", its owner; kolu’s overlay is the consumer (drishti’s color map keys the full phase union directly, so it imports nothing extra)."
		] }),
		"\n",
		createVNode(_components.p, { children: "The type family as shipped — the reference for the connection vocabulary:" }),
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
						children: "// @kolu/surface-remote — ONE framework type; the connector declares its own phases"
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
							children: " SessionState"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "Prov"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " extends"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " never"
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
							children: "  log"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " readonly"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "source"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"local\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"remote\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "line"
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
							children: " }[]; "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// last 20; per-EPISODE (reset on a down→up crossing)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  sinceMs"
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
							style: { color: "#6A737D" },
							children: "// current episode's elapsed, stamped on the SERVER's clock — a duration, never a foreign epoch"
						})
					]
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
							children: "&"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
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
							children: " \"connecting\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"connected\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Prov"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }                  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// up — error fields don't exist"
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
							children: " \"disconnected\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "error"
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
							children: "cause"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"network\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"remote\""
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
							children: "phase"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"failed\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";       "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "error"
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
							children: "cause"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"network\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"remote\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " } "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// terminality is the phase, not the cause: a budget-exhausted silent step gives up \"network\" (#1908)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: ");"
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
							children: "type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " SshProv"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"probing\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"copying\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"building\""
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
						style: { color: "#6A737D" },
						children: "//  probing  = the ask-only warm check (nix-store -q --outputs + --check-validity — is padi already there?, never a substituting realise) — presented calmly, no build UI"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "//  copying  = nix copy --derivation …  (the .drv push — fast)"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "//  building = ssh $host nix-store --realise …  (the remote compile — the minutes)"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// sshConnector: SessionState<SshProv> · local endpoint: SessionState<never>"
					})
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// browser cell: ConnectionInfo = SessionState<SshProv>, LITERALLY — the zod schema's"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// inferred type is pinned identical by a test-d file, so schema/type drift is a compile error."
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// ConnectPhase = Exclude<ConnectionInfo[\"phase\"], \"connected\"|\"disconnected\"|\"failed\">"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// — the one narratable-phase vocabulary, exported beside its owner; consumers"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// derive from it, never hand-list phase names."
					})
				})
			] })
		}),
		"\n",
		createVNode("a", { id: "w5" }),
		"\n",
		createVNode(_components.h3, {
			id: "w5--cross-host-attention--shipped--the-drishti-pair-sriddrishti93--the-alerts-cell-the-first-reactor-consumer--is-still-in-review",
			children: [
				"W5 — cross-host attention — ",
				createVNode(_components.em, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1759 }),
				" ",
				createVNode(_components.em, { children: [
					"(the drishti pair ",
					createVNode(_components.a, {
						href: "https://github.com/srid/drishti/pull/93",
						children: "srid/drishti#93"
					}),
					" — the ",
					createVNode(_components.code, { children: "alerts" }),
					" cell, the first reactor consumer — is still in review)"
				] })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped 2026-07-11" }),
			" (merge ",
			createVNode(_components.code, { children: "52d60bf1b" }),
			") — an agent flipping to ",
			createVNode(_components.em, { children: "awaiting you" }),
			" on a background host now reaches you: an ",
			createVNode(_components.strong, { children: "OS notification" }),
			" whose click is one action (switch host + focus the tile), the PWA ",
			createVNode(_components.strong, { children: "app badge" }),
			" summed over live hosts, beside the switcher chips’ per-host counts (W4). The architecture as ratified: attention is ",
			createVNode(_components.strong, { children: "level state" }),
			" carried in an ordinary per-entry cell — ",
			createVNode(_components.strong, { children: "kolu minted no wire member" }),
			" (it consumes padi’s existing ",
			createVNode(_components.code, { children: "cells.urgency" }),
			", the tiny projection W7’s K1 ruling keeps hot per host) — and the PR’s framework slice is ",
			createVNode(_components.strong, { children: ["phase 0 of the ", createVNode(_components.a, {
				href: "surface-reactive-bridge.html",
				children: "reactive bridge"
			})] }),
			": ",
			createVNode(_components.code, { children: "reactor.ts" }),
			" (",
			createVNode(_components.code, { children: "source" }),
			" · ",
			createVNode(_components.code, { children: "scan" }),
			" · ",
			createVNode(_components.code, { children: "derived.cell" }),
			", the engine lint-banned behind it) in ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			", ",
			createVNode(_components.code, { children: "Subscription.updated()" }),
			" change pairs, mirrors-never-fabricate in ",
			createVNode(_components.code, { children: "@kolu/surface-remote" }),
			", the eager ",
			createVNode(_components.code, { children: "watchByEntry" }),
			" watcher in ",
			createVNode(_components.code, { children: "@kolu/surface-map" }),
			", and ",
			createVNode(_components.code, { children: "notify" }),
			" delivery in ",
			createVNode(_components.code, { children: "@kolu/surface-app" }),
			". The design is taught end-to-end in ",
			createVNode(_components.a, {
				href: "surface-attention-101.html",
				children: "the attention primer"
			}),
			"; the bridge’s later phases, sequenced after, live in ",
			createVNode(_components.a, {
				href: "surface-reactive-bridge.html",
				children: "the bridge note"
			}),
			"."
		] }),
		"\n",
		createVNode("a", { id: "w9" }),
		"\n",
		createVNode(_components.h3, {
			id: "w9--instant-host-switch-back--shipped-",
			children: [
				"W9 — instant host switch-back — ",
				createVNode(_components.em, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1764 })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped 2026-07-11" }),
			" (merge ",
			createVNode(_components.code, { children: "10070a662" }),
			", two-platform CI green) — host switch-back is now the instant, tmux-grade move it was designed to be: the per-host wire subscriptions (terminal keys, ",
			createVNode(_components.code, { children: "terminals" }),
			", saved session, daemon status, activity feed) live in the retained app-lifetime per-host owner (",
			createVNode(_components.code, { children: "createHostWire" }),
			" inside ",
			createVNode(_components.code, { children: "scopedByEntry" }),
			"), so switching back has no resubscribe and no pending window — the dock, tiles, and RightPanel stay mounted. The Code tab’s queries are scoped per host ",
			createVNode(_components.strong, { children: "by ownership" }),
			" in a parallel per-host owner (",
			createVNode(_components.code, { children: "right-panel/hostCodeTab.ts" }),
			"): paused while backgrounded, resumed from the held value on switch-back, disposed on membership exit. Review shaped the ship — the first keep-last/LRU query cache and the component-owned retention were both replaced by ownership, and the old ",
			createVNode(_components.code, { children: "perHostPolledQuery" }),
			"/",
			createVNode(_components.code, { children: "createRepoPolledQuery" }),
			" constructors were retired outright so component-owned retention is unspellable. Deliberately excluded, still: xterm/WebGL stay active-host-only, and a grounded follow-up investigation pinned what that exclusion concretely costs — a ",
			createVNode(_components.strong, { children: "full-scrollback replay on every cross-host switch" }),
			": the old host’s ",
			createVNode(_components.code, { children: "<Terminal>" }),
			"s unmount and the new host’s mount, and each mount re-attaches from scratch — kaval serializes its whole headless mirror with no viewport bound and the client writes the entire snapshot back into xterm, so the “sub-second re-attach paint” is a full serialize + full re-write, bounded only by the 10,000-line mirror cap.",
			createVNode($$Footnote, { children: [
				"The mechanism, file-cited: same-host terminal switches replay ",
				createVNode(_components.strong, { children: "nothing" }),
				" — inactive tiles stay mounted and CSS-hidden (",
				createVNode(_components.code, { children: "Terminal.tsx" }),
				" ",
				createVNode(_components.code, { children: "classList={{ hidden }}" }),
				", #988), so switching ",
				createVNode(_components.code, { children: "activeId" }),
				" is a CSS reshuffle. Cross-host switches swap the tile set; on mount, ",
				createVNode(_components.code, { children: "snapshotOf" }),
				" calls ",
				createVNode(_components.code, { children: "serialize.serialize()" }),
				" with no viewport bound (",
				createVNode(_components.code, { children: "packages/kaval/src/ptyHost.ts:705-708" }),
				"), emitting full scrollback + screen up to ",
				createVNode(_components.code, { children: "DEFAULT_MIRROR_SCROLLBACK = 10_000" }),
				" lines (",
				createVNode(_components.code, { children: "ptyHost.ts:52" }),
				" — the cap exists because an unbounded serialize once caused heap OOMs), which the client writes wholesale into xterm before live deltas resume. The ratified direction is now ",
				createVNode(_components.a, {
					href: "scrollback-backfill.html",
					children: "scrollback backfill"
				}),
				": a bounded attach snapshot kills the per-switch replay, and older history backfills into the terminal’s ",
				createVNode(_components.em, { children: "own" }),
				" scrollback on scroll-up. ",
				createVNode($$PrLink, { pr: 1577 }),
				"’s separate copy-mode-pager shape was rejected for this purpose — the user only cares about the actual terminal scrollback — and its memory goal (the 10k-line RAM mirrors) remains open, untouched by that plan."
			] }),
			" No server or padi changes."
		] }),
		"\n",
		createVNode("a", { id: "w11" }),
		"\n",
		createVNode(_components.h3, {
			id: "w11--one-verb-per-fact-user-remove-vs-system-retire--shipped-",
			children: [
				"W11 — one verb per fact: user-remove vs system-retire — ",
				createVNode(_components.em, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1775 })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped 2026-07-12" }),
			" (squash ",
			createVNode(_components.code, { children: "7f2811539" }),
			") — surface-remote’s pool now speaks two verbs for its two facts: ",
			createVNode(_components.code, { children: "remove(host)" }),
			" means the ",
			createVNode(_components.em, { children: "user" }),
			" removed it (fires the persist hook), ",
			createVNode(_components.code, { children: "retire(host)" }),
			" is the system shedding a faulted session (same teardown, no persist); kolu’s ",
			createVNode($$Issue, { n: 1708 }),
			" pump-death path uses retire, so an internal fault can never masquerade as a user decision — the prerequisite W10’s persistence needed. The gauntlet’s structural insight: the remembered fleet is its ",
			createVNode(_components.strong, { children: "own" }),
			" ordered set (",
			createVNode(_components.code, { children: "persistedMembership" }),
			"), a fact in its own right — never derived from the live pool’s ",
			createVNode(_components.code, { children: "entries.keys()" }),
			", because retire deliberately desyncs live from remembered. Codex caught two edges, both fixed: remove-after-retire was a no-op, and a throwing listener could make retire reject."
		] }),
		"\n",
		createVNode("a", { id: "w10" }),
		"\n",
		createVNode(_components.h3, {
			id: "w10--hosts-survive-a-restart--shipped-",
			children: [
				"W10 — hosts survive a restart — ",
				createVNode(_components.em, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1772 })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped 2026-07-12" }),
			" (merge ",
			createVNode(_components.code, { children: "9f516987c" }),
			") — the hosts you added through the selector strip come back after a kolu restart; the only way a host leaves the strip is your explicit remove. ",
			createVNode(_components.strong, { children: "Hosts are settings:" }),
			" the remembered fleet is one field in ",
			createVNode(_components.code, { children: "PersistedStateSchema" }),
			", a value in the conf store beside every other preference — same store, same migrations ladder, same throw-on-corrupt behavior (the fail-fast doctrine ",
			createVNode(_components.em, { children: "inherited" }),
			", not re-implemented) — written through the pool’s transactional persist-before-commit hook, which fires only on user-intent mutations (",
			createVNode(_components.a, {
				href: "#w11",
				children: "W11"
			}),
			"’s split). The unremovable local default never enters the field (it’s seeded in code — persisting it would mint a second authority for “local always exists”); an env seed (",
			createVNode(_components.code, { children: "KOLU_PADI_HOST" }),
			") stays declarative provenance, never captured into persistence; validation is loud — a persisted value naming local or carrying duplicates is rejected, not repaired. Boot re-enters through the front door: each persisted host flows the ordinary ",
			createVNode(_components.code, { children: "pool.add" }),
			" and the ",
			createVNode(_components.a, {
				href: "#w6",
				children: "W6"
			}),
			" connect pipeline (warming → probing → connected, or failed with its honest cause — no lazy-dial knob). The shape itself was a pre-merge overturn: the design originally persisted membership as its own separate ",
			createVNode(_components.code, { children: "hosts.json" }),
			", killed when fact-checking dismantled its justifications — hosts are no different from settings.",
			createVNode($$Footnote, { children: [
				"The separate ",
				createVNode(_components.code, { children: "hosts.json" }),
				" was zod-schemed with hand-rolled atomic writes (tmp + rename) and its own crash-on-corrupt rule. It was overturned by srid’s 2026-07-12 ruling when its justifications failed fact-checking: conf does not reset-to-defaults on corruption (it throws — ",
				createVNode(_components.code, { children: "clearInvalidConfig" }),
				" is false — the same behavior the separate file was built to guarantee), and no concrete incident distinguished the two designs. Hosts are no different from settings, so they ride the settings store."
			] })
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "superseded-by-this-note",
			children: "Superseded by this note"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The pre-padi R9/R10 decomposition (",
			createVNode(_components.a, {
				href: "remote-terminals.html#finale",
				children: "recorded in the portal"
			}),
			"; whole plan: PR-1/2/3, F-REMOTE, R10) — closed PRs ",
			createVNode($$PrLink, { pr: 1637 }),
			", ",
			createVNode($$PrLink, { pr: 1638 }),
			", ",
			createVNode($$PrLink, { pr: 1639 }),
			", ",
			createVNode($$PrLink, { pr: 1640 }),
			". Partially superseded: ",
			createVNode(_components.a, {
				href: "awareness-derive-store.html",
				children: "awareness-derive-store"
			}),
			" (the fold’s ",
			createVNode(_components.em, { children: "home" }),
			" moves to padi; owner-clock replaces consumer-clock; producer, fold, and types survive verbatim) and ",
			createVNode(_components.a, {
				href: "terminal-metadata-model.html",
				children: "the terminal model"
			}),
			" (the reader-join collapses into padi’s composed ",
			createVNode(_components.code, { children: "terminals" }),
			" collection; the authored/snapshot split stays as padi-internal types). Unaffected: kaval’s design (",
			createVNode(_components.a, {
				href: "pty-daemon.html",
				children: "pty-daemon"
			}),
			") apart from the shipped overflow frame (contract 5.0, ",
			createVNode($$PrLink, { pr: 1591 }),
			"); #1577."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "padi — the per-host terminal-workspace daemon",
	"description": "The architecture that replaced the R9/R10 finale plan for remote terminals (#951). One workspace daemon per host — padi, atop kaval — knows everything about that host's terminals and serves it as one surface (padiSurface); kolu-server thins to a web shell that connects each browser view to one padi. The canvas shows one host at a time (instant switch; other hosts reach you via badges and OS notifications). The host owns its state — layout, memory, clock. Phases W0–W12 all shipped (W10 — hosts persist as a settings field in the conf store; W12 — restore survives an unclean kaval death), with the surface consolidation in parallel.",
	"parents": ["remote-terminals"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-12T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-padi-is",
			"text": "What padi is"
		},
		{
			"depth": 2,
			"slug": "the-architecture",
			"text": "The architecture"
		},
		{
			"depth": 3,
			"slug": "the-three-layers-and-what-each-owns",
			"text": "The three layers, and what each owns"
		},
		{
			"depth": 3,
			"slug": "the-state-model--what-survives-from-the-awareness-design-and-what-moves",
			"text": "The state model — what survives from the awareness design, and what moves"
		},
		{
			"depth": 3,
			"slug": "session-state-and-restore--the-host-restores-itself",
			"text": "Session state and restore — the host restores itself"
		},
		{
			"depth": 3,
			"slug": "padisurface--one-contract-with-per-member-forwarding-semantics",
			"text": "padiSurface — one contract, with per-member forwarding semantics"
		},
		{
			"depth": 3,
			"slug": "rejected-shapes-each-killed-by-a-specific-review-finding",
			"text": "Rejected shapes (each killed by a specific review finding)"
		},
		{
			"depth": 2,
			"slug": "where-this-stands--and-whats-next",
			"text": "Where this stands — and what’s next"
		},
		{
			"depth": 3,
			"slug": "w12--restore-survives-an-unclean-kaval-death-shipped---independent-of-w10",
			"text": "W12 — restore survives an unclean kaval death (shipped  — independent of W10)"
		},
		{
			"depth": 3,
			"slug": "consolidation-and-parked-cleanups-unnumbered--a-parallel-ongoing-track",
			"text": "Consolidation and parked cleanups (unnumbered — a parallel, ongoing track)"
		},
		{
			"depth": 3,
			"slug": "w34--remote-e2e-parity-in-ci-parked--machinery-done--proven-the-gate-waits-on-the-parity-tail-the-remote-bind-parity-note-srid-2026-07-05",
			"text": "W3.4 — remote e2e parity in CI (parked — machinery done + proven; the gate waits on the parity tail: the remote-bind parity note, srid 2026-07-05)"
		},
		{
			"depth": 3,
			"slug": "future-work--demand-driven",
			"text": "Future work — demand-driven"
		},
		{
			"depth": 3,
			"slug": "risks-named-with-mitigations",
			"text": "Risks, named, with mitigations"
		},
		{
			"depth": 2,
			"slug": "the-shipped-record",
			"text": "The shipped record"
		},
		{
			"depth": 3,
			"slug": "w0--decks-cleared-all-three-landed",
			"text": "W0 — decks cleared (all three landed)"
		},
		{
			"depth": 3,
			"slug": "w1--the-padi-seam-in-place--shipped-",
			"text": "W1 — the padi seam, in place — shipped "
		},
		{
			"depth": 3,
			"slug": "w2--padi-the-process-local--shipped-three-prs",
			"text": "W2 — padi the process (local) — shipped, three PRs"
		},
		{
			"depth": 4,
			"slug": "w21--the-re-serve-machinery-in-kolusurface--shipped-",
			"text": "W2.1 — the re-serve machinery in @kolu/surface* — shipped "
		},
		{
			"depth": 4,
			"slug": "w22--padi-the-process-the-binary-and-the-cutover--shipped-",
			"text": "W2.2 — padi the process: the binary AND the cutover — shipped "
		},
		{
			"depth": 4,
			"slug": "w23--padi-tui-is-born-and-the-burial--shipped-",
			"text": "W2.3 — padi-tui is born, and the burial — shipped "
		},
		{
			"depth": 3,
			"slug": "w3--remote-the-binding--the-full-peer-gaps--the-ci-parity-leg-w34-is-parked-under-whats-next",
			"text": "W3 — remote (the binding · the full-peer gaps — the CI-parity leg W3.4 is parked, under what’s next)"
		},
		{
			"depth": 4,
			"slug": "w31--the-remote-binding--shipped-",
			"text": "W3.1 — the remote binding — shipped "
		},
		{
			"depth": 4,
			"slug": "w32--the-full-peer-gaps--shipped--",
			"text": "W3.2 — the full-peer gaps — shipped  "
		},
		{
			"depth": 3,
			"slug": "w4--the-switch--shipped-",
			"text": "W4 — the switch — shipped "
		},
		{
			"depth": 3,
			"slug": "w7--per-host-state-by-ownership-not-enumeration--shipped---the-sriddrishti91-framework-gate-pair",
			"text": "W7 — per-host state by ownership, not enumeration — shipped  (+ the srid/drishti#91 framework-gate pair)"
		},
		{
			"depth": 3,
			"slug": "w8--remote-terminals-documented-honestly--shipped---a-docs-phase",
			"text": "W8 — remote terminals, documented honestly — shipped   (a docs phase)"
		},
		{
			"depth": 3,
			"slug": "w6--the-honest-connect--shipped---the-sriddrishti92-pair--both-merged-2026-07-09",
			"text": "W6 — the honest connect — shipped  (+ the srid/drishti#92 pair — both merged 2026-07-09)"
		},
		{
			"depth": 3,
			"slug": "w5--cross-host-attention--shipped--the-drishti-pair-sriddrishti93--the-alerts-cell-the-first-reactor-consumer--is-still-in-review",
			"text": "W5 — cross-host attention — shipped  (the drishti pair srid/drishti#93 — the alerts cell, the first reactor consumer — is still in review)"
		},
		{
			"depth": 3,
			"slug": "w9--instant-host-switch-back--shipped-",
			"text": "W9 — instant host switch-back — shipped "
		},
		{
			"depth": 3,
			"slug": "w11--one-verb-per-fact-user-remove-vs-system-retire--shipped-",
			"text": "W11 — one verb per fact: user-remove vs system-retire — shipped "
		},
		{
			"depth": 3,
			"slug": "w10--hosts-survive-a-restart--shipped-",
			"text": "W10 — hosts survive a restart — shipped "
		},
		{
			"depth": 3,
			"slug": "superseded-by-this-note",
			"text": "Superseded by this note"
		}
	];
}
var url = "src/content/atlas/padi.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/padi.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/padi.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, HostChip, PAL, ROADMAP, Switcher, file, frontmatter, getHeadings, url };
