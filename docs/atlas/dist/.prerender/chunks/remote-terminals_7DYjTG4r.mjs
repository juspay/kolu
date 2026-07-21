import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Issue } from "./Issue_mLFqCJSR.mjs";
import { t as $$Phase } from "./Phase_Ctvqq2QS.mjs";
import { t as $$PhaseTree } from "./PhaseTree_DI8OxotU.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
//#region src/diagrams/remote-terminals-architecture.svg?raw
var remote_terminals_architecture_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 820 600\" font-family=\"ui-sans-serif, system-ui, sans-serif\" role=\"img\" aria-label=\"The multi-host shape for remote terminals. The browser drives kolu-server over one WebSocket. kolu-server holds the TerminalEndpoint seam keyed by hostId, behind which sit three drivers — the shipped local driver (R2), the remaining ssh driver (R9), and the remaining mirror (R9). On this machine a local kaval daemon owns the PTYs and survives deploys, with awareness run in-process. Each remote ssh host runs the same kaval daemon plus an pulam daemon hosting the terminal-workspace surface (awareness + R6 fs/git) over ssh. Green = shipped, amber = remaining.\">\n  <defs>\n    <marker id=\"rt-arr-green\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#15803D\"/>\n    </marker>\n    <marker id=\"rt-arr-amber\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#B45309\"/>\n    </marker>\n    <marker id=\"rt-arr-slate\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#475569\"/>\n    </marker>\n    <style>\n      .rt-paper  { fill:#ffffff; }\n      .rt-title  { fill:#0f172a; font-size:16px; font-weight:700; }\n      .rt-sub    { fill:#64748b; font-size:11.5px; }\n      .rt-tier   { fill:#94a3b8; font-size:10.5px; font-weight:700; letter-spacing:0.07em; }\n      .rt-mono   { font-family:ui-monospace, \"SF Mono\", Menlo, monospace; }\n\n      .rt-srv-box   { fill:#EDF0FD; stroke:#0D32B2; stroke-width:2; }\n      .rt-srv-inner { fill:#F7F9FF; stroke:#9DB0EE; stroke-width:1.5; }\n      .rt-srv-t     { fill:#0A0F25; font-size:13.5px; font-weight:700; }\n      .rt-srv-s     { fill:#4A5072; font-size:11px; }\n\n      .rt-cli-box { fill:#EEF0F2; stroke:#94A3B8; stroke-width:2; }\n      .rt-cli-t   { fill:#334155; font-size:13px; font-weight:700; }\n      .rt-cli-s   { fill:#64748B; font-size:11px; }\n      .rt-host    { fill:#F8FAFC; stroke:#CBD5E1; stroke-width:1.5; }\n\n      .rt-green-box { fill:#E6F4EA; stroke:#15803D; stroke-width:2; }\n      .rt-green-t   { fill:#14532D; font-size:13px; font-weight:700; }\n      .rt-green-s   { fill:#166534; font-size:11px; }\n      .rt-green-e   { stroke:#15803D; stroke-width:2; fill:none; }\n\n      .rt-amber-box { fill:#FBF1DC; stroke:#B45309; stroke-width:2; }\n      .rt-amber-t   { fill:#7a4f00; font-size:13px; font-weight:700; }\n      .rt-amber-s   { fill:#92400E; font-size:11px; }\n      .rt-amber-e   { stroke:#B45309; stroke-width:2; fill:none; stroke-dasharray:6 4; }\n\n      .rt-slate-e { stroke:#475569; stroke-width:2; fill:none; }\n      .rt-elabel  { fill:#475569; font-size:10.5px; font-weight:600; }\n\n      .rt-pill-g  { fill:#15803D; }\n      .rt-pill-a  { fill:#B45309; }\n      .rt-pill-tx { fill:#ffffff; font-size:10.5px; font-weight:700; }\n    </style>\n  </defs>\n\n  <rect class=\"rt-paper\" x=\"0\" y=\"0\" width=\"820\" height=\"600\"/>\n\n  <text class=\"rt-title\" x=\"32\" y=\"34\">Remote terminals — the multi-host shape</text>\n  <text class=\"rt-sub\" x=\"32\" y=\"53\">one kaval daemon per host · kolu-server keys every endpoint by hostId · colour = shipped vs remaining</text>\n\n  <!-- legend -->\n  <rect class=\"rt-green-box\" x=\"566\" y=\"22\" width=\"14\" height=\"14\" rx=\"3\"/>\n  <text class=\"rt-sub\" x=\"586\" y=\"33\">shipped — R1 · R2 · R6</text>\n  <rect class=\"rt-amber-box\" x=\"566\" y=\"42\" width=\"14\" height=\"14\" rx=\"3\"/>\n  <text class=\"rt-sub\" x=\"586\" y=\"53\">remaining — R5 · R8 · R9</text>\n\n  <!-- ================= browser ================= -->\n  <rect class=\"rt-cli-box\" x=\"290\" y=\"74\" width=\"240\" height=\"48\" rx=\"10\"/>\n  <text class=\"rt-cli-t\" x=\"410\" y=\"96\" text-anchor=\"middle\">browser — SolidJS client</text>\n  <text class=\"rt-cli-s\" x=\"410\" y=\"113\" text-anchor=\"middle\">ChromeBar host switcher</text>\n\n  <path class=\"rt-slate-e\" d=\"M410 122 L410 150\" marker-end=\"url(#rt-arr-slate)\"/>\n  <text class=\"rt-elabel\" x=\"420\" y=\"140\">WebSocket · oRPC</text>\n\n  <!-- ================= kolu-server ================= -->\n  <rect class=\"rt-srv-box\" x=\"70\" y=\"150\" width=\"680\" height=\"178\" rx=\"12\"/>\n  <text class=\"rt-srv-t\" x=\"88\" y=\"174\">kolu-server <tspan class=\"rt-srv-s\">— restarts every deploy</tspan></text>\n\n  <rect class=\"rt-srv-inner\" x=\"92\" y=\"184\" width=\"636\" height=\"34\" rx=\"8\"/>\n  <text class=\"rt-srv-s rt-mono\" x=\"410\" y=\"205\" text-anchor=\"middle\">TerminalEndpoint seam · keyed by hostId · awareness sensors (fresh each deploy)</text>\n\n  <!-- local driver (shipped) -->\n  <rect class=\"rt-green-box\" x=\"92\" y=\"232\" width=\"200\" height=\"80\" rx=\"10\"/>\n  <rect class=\"rt-pill-g\" x=\"104\" y=\"244\" width=\"34\" height=\"17\" rx=\"8.5\"/>\n  <text class=\"rt-pill-tx\" x=\"121\" y=\"256\" text-anchor=\"middle\">R2 ✓</text>\n  <text class=\"rt-green-t\" x=\"146\" y=\"257\">local driver</text>\n  <text class=\"rt-green-s\" x=\"104\" y=\"280\">spawn · supervise · adopt</text>\n  <text class=\"rt-green-s rt-mono\" x=\"104\" y=\"297\">localDriver.ts</text>\n\n  <!-- ssh driver (remaining) -->\n  <rect class=\"rt-amber-box\" x=\"312\" y=\"232\" width=\"196\" height=\"80\" rx=\"10\"/>\n  <rect class=\"rt-pill-a\" x=\"324\" y=\"244\" width=\"26\" height=\"17\" rx=\"8.5\"/>\n  <text class=\"rt-pill-tx\" x=\"337\" y=\"256\" text-anchor=\"middle\">R9</text>\n  <text class=\"rt-amber-t\" x=\"358\" y=\"257\">ssh driver</text>\n  <text class=\"rt-amber-s\" x=\"324\" y=\"280\">reach · provision · multiplex</text>\n  <text class=\"rt-amber-s rt-mono\" x=\"324\" y=\"297\">surface-nix-host</text>\n\n  <!-- awareness + fs/git fold (remaining) -->\n  <rect class=\"rt-amber-box\" x=\"528\" y=\"232\" width=\"200\" height=\"80\" rx=\"10\"/>\n  <rect class=\"rt-pill-a\" x=\"540\" y=\"244\" width=\"26\" height=\"17\" rx=\"8.5\"/>\n  <text class=\"rt-pill-tx\" x=\"553\" y=\"256\" text-anchor=\"middle\">R9</text>\n  <text class=\"rt-amber-t\" x=\"574\" y=\"257\">the mirror</text>\n  <text class=\"rt-amber-s\" x=\"540\" y=\"280\">mirror pulam's surface</text>\n  <text class=\"rt-amber-s rt-mono\" x=\"540\" y=\"297\">awareness + fs/git</text>\n\n  <!-- ================= host tier ================= -->\n  <text class=\"rt-tier\" x=\"32\" y=\"356\">HOSTS — same hashed kaval daemon on every one</text>\n\n  <!-- this machine -->\n  <rect class=\"rt-host\" x=\"70\" y=\"368\" width=\"320\" height=\"200\" rx=\"12\"/>\n  <text class=\"rt-cli-t\" x=\"88\" y=\"392\">this machine</text>\n  <rect class=\"rt-green-box\" x=\"92\" y=\"404\" width=\"276\" height=\"142\" rx=\"10\"/>\n  <text class=\"rt-green-t\" x=\"110\" y=\"432\">kaval ✓</text>\n  <text class=\"rt-green-s\" x=\"110\" y=\"454\">durable PTY · holds the fds + screen mirror</text>\n  <text class=\"rt-green-s\" x=\"110\" y=\"472\">survives a kolu-server deploy</text>\n  <text class=\"rt-green-s\" x=\"110\" y=\"512\">awareness + fs/git: in-process here</text>\n  <text class=\"rt-green-s\" x=\"110\" y=\"528\">(the same terminal-workspace surface pulam hosts)</text>\n\n  <!-- remote ssh host -->\n  <rect class=\"rt-host\" x=\"430\" y=\"368\" width=\"320\" height=\"200\" rx=\"12\"/>\n  <text class=\"rt-cli-t\" x=\"448\" y=\"392\">remote ssh host <tspan class=\"rt-cli-s\">×N</tspan></text>\n  <rect class=\"rt-green-box\" x=\"452\" y=\"404\" width=\"138\" height=\"142\" rx=\"10\"/>\n  <text class=\"rt-green-t\" x=\"470\" y=\"432\">kaval</text>\n  <text class=\"rt-green-s\" x=\"470\" y=\"454\">same daemon</text>\n  <text class=\"rt-green-s\" x=\"470\" y=\"472\">PTYs survive</text>\n  <text class=\"rt-green-s\" x=\"470\" y=\"490\">blips + deploys</text>\n  <rect class=\"rt-amber-box\" x=\"600\" y=\"404\" width=\"130\" height=\"142\" rx=\"10\"/>\n  <text class=\"rt-amber-t\" x=\"618\" y=\"432\">pulam</text>\n  <text class=\"rt-amber-s\" x=\"618\" y=\"454\">awareness</text>\n  <text class=\"rt-amber-s\" x=\"618\" y=\"472\">+ fs/git (R6)</text>\n  <text class=\"rt-amber-s\" x=\"618\" y=\"490\">served / ssh</text>\n\n  <!-- edges server → hosts -->\n  <path class=\"rt-green-e\" d=\"M180 312 L180 404\" marker-end=\"url(#rt-arr-green)\"/>\n  <text class=\"rt-elabel\" x=\"188\" y=\"362\">unix socket</text>\n\n  <path class=\"rt-amber-e\" d=\"M410 312 L410 344 L521 344 L521 404\" marker-end=\"url(#rt-arr-amber)\"/>\n  <text class=\"rt-elabel\" x=\"430\" y=\"338\">ssh stdio</text>\n\n  <path class=\"rt-amber-e\" d=\"M628 312 L628 344 L665 344 L665 404\" marker-end=\"url(#rt-arr-amber)\"/>\n  <text class=\"rt-elabel\" x=\"640\" y=\"338\">ssh · mirror</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/remote-terminals.mdx
var PAL = {
	bg: "#0f1117",
	txt: "#c8d0de",
	sub: "#8b94a6",
	dim: "#5b6678",
	green: "#7ec699",
	amber: "#e6a23c",
	cyan: "#56b6c2",
	violet: "#a78bfa"
};
var HostPill = ({ name, active, dot }) => createVNode("span", {
	style: `display:inline-flex;align-items:center;gap:.45ch;padding:.16rem .6rem;border-radius:6px;font-size:.82em;${active ? `background:rgba(126,198,153,.13);color:${PAL.txt};border:1px solid rgba(126,198,153,.4)` : `color:${PAL.dim};border:1px solid transparent`}`,
	children: [dot && createVNode("span", {
		class: "rt-blink",
		style: `width:7px;height:7px;border-radius:50%;background:${PAL.green};display:inline-block`
	}), name]
});
var Tile = ({ host, repo, branch, pr, agent, state, kind, remote }) => {
	const c = kind === "need" ? PAL.amber : kind === "work" ? PAL.cyan : PAL.dim;
	const glyph = kind === "need" ? "●" : kind === "work" ? "◜" : "○";
	return createVNode("div", {
		style: `background:#151823;border:1px solid ${kind === "need" ? "rgba(230,162,60,.5)" : "#222838"};border-radius:8px;padding:.5rem .6rem;display:flex;flex-direction:column;gap:.32rem;min-width:0`,
		children: [
			createVNode("div", {
				style: "display:flex;align-items:center;gap:.5ch;font-size:.78em",
				children: [
					createVNode("span", {
						style: `color:${remote ? PAL.violet : PAL.dim};font-weight:600`,
						children: host
					}),
					remote && createVNode("span", {
						style: `color:${PAL.violet};border:1px solid rgba(167,139,250,.45);border-radius:4px;padding:0 .4ch;font-size:.85em`,
						children: "ssh"
					}),
					createVNode("span", {
						class: "rt-blink",
						style: `margin-left:auto;width:7px;height:7px;border-radius:50%;background:${PAL.green};display:inline-block`
					})
				]
			}),
			createVNode("div", {
				style: `color:${PAL.txt};font-size:.9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`,
				children: [
					repo,
					" ",
					createVNode("span", {
						style: `color:${PAL.sub}`,
						children: ["· ", branch]
					}),
					pr && createVNode("span", {
						style: `color:${PAL.sub}`,
						children: [" ", pr]
					})
				]
			}),
			createVNode("div", {
				style: "display:flex;align-items:center;gap:.5ch;font-size:.8em",
				children: [
					createVNode("span", {
						class: kind === "work" ? "rt-spin" : kind === "need" ? "rt-blink" : "",
						style: `color:${c}`,
						children: glyph
					}),
					createVNode("span", {
						style: `color:${PAL.sub}`,
						children: agent
					}),
					createVNode("span", {
						style: `color:${c};margin-left:auto`,
						children: state
					})
				]
			})
		]
	});
};
var RemoteCanvas = () => createVNode("div", {
	style: "font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:#0f1117;border:1px solid #05070b;border-radius:11px;overflow:hidden;margin:1.2rem 0;box-shadow:0 10px 34px rgba(0,0,0,.4);max-width:44rem",
	children: [
		createVNode("div", {
			style: "display:flex;align-items:center;gap:.5rem;padding:.5rem .8rem;background:#0b0d12;border-bottom:1px solid #222838",
			children: [
				createVNode("span", { style: "width:11px;height:11px;border-radius:50%;background:#ff5f56;display:inline-block" }),
				createVNode("span", { style: "width:11px;height:11px;border-radius:50%;background:#ffbd2e;display:inline-block" }),
				createVNode("span", { style: "width:11px;height:11px;border-radius:50%;background:#27c93f;display:inline-block" }),
				createVNode("span", {
					style: "margin-left:.4rem;color:#8b94a6",
					children: "kolu"
				})
			]
		}),
		createVNode("div", {
			style: "display:flex;align-items:center;gap:.4rem;padding:.45rem .7rem;background:#0d0f15;border-bottom:1px solid #1c2231",
			children: [
				createVNode("span", {
					style: "color:#5b6678;font-size:.78em;margin-right:.15rem",
					children: "host"
				}),
				createVNode(HostPill, { name: "local" }),
				createVNode(HostPill, {
					name: "nix@prod",
					active: true,
					dot: true
				}),
				createVNode(HostPill, { name: "staging" }),
				createVNode("span", {
					style: "margin-left:.15rem;color:#3f4858",
					children: "+ host"
				}),
				createVNode("span", {
					style: "margin-left:auto;color:#5b6678;font-size:.78em",
					children: "⌥H switch · one host per canvas"
				})
			]
		}),
		createVNode("div", {
			style: "display:grid;grid-template-columns:1fr 1fr;gap:.55rem;padding:.6rem",
			children: [
				createVNode(Tile, {
					host: "nix@prod",
					remote: true,
					repo: "kolu",
					branch: "feat/dial-ssh",
					pr: "#1412 ✓",
					agent: "claude",
					state: "awaiting you",
					kind: "need"
				}),
				createVNode(Tile, {
					host: "nix@prod",
					remote: true,
					repo: "infra",
					branch: "deploy",
					agent: "—",
					state: "working",
					kind: "work"
				}),
				createVNode(Tile, {
					host: "nix@prod",
					remote: true,
					repo: "kolu",
					branch: "master",
					agent: "codex",
					state: "working",
					kind: "work"
				}),
				createVNode(Tile, {
					host: "nix@prod",
					remote: true,
					repo: "notes",
					branch: "main",
					agent: "claude",
					state: "idle",
					kind: "idle"
				})
			]
		})
	]
});
var PT = [
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "R1 · Foundation — seam · framework · engine",
		m: "#981·984·1004"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "R2 · kaval — local PTY survival",
		m: "→ pty-daemon",
		h: "pty-daemon.html"
	},
	{
		d: 1,
		g: "✓",
		c: "ship",
		l: "R2.1–R2.5 · inversion → door → survival → inventory",
		m: "#1292…1458"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "R3 · remote-ssh spike",
		m: "→ kaval-sessions",
		h: "kaval-sessions.html"
	},
	{
		d: 1,
		g: "✓",
		c: "ship",
		l: "R3.1–R3.6 · kaval-tui dials local + ssh",
		m: "#1364…1378"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "R4 · pulam — the workspace daemon",
		m: "→ pulam",
		h: "pulam.html"
	},
	{
		d: 1,
		g: "✓",
		c: "ship",
		l: "R4.1–R4.5 · sensors → daemon → --host → fleet",
		m: "#1413…1497"
	},
	{
		d: 1,
		g: "✓",
		c: "ship",
		l: "R4.6 · rename arivu → pulam",
		m: "#1512",
		h: "pulam.html#r46"
	},
	{
		d: 1,
		g: "✓",
		c: "ship",
		l: "R4.7 · live git status in pulam-tui",
		m: "#1519",
		h: "pulam.html#r47"
	},
	{
		d: 1,
		g: "◐",
		c: "ship",
		l: "R4.8 · pulam-web — the browser twin (retired at padi W0)",
		m: "→ pulam-web",
		h: "pulam-web.html"
	},
	{
		d: 2,
		g: "✓",
		c: "ship",
		l: "R-pulamweb-1 · drishti reactive consumer",
		m: "drishti#72",
		h: "pulam-web.html#r-pulamweb-1"
	},
	{
		d: 2,
		g: "✓",
		c: "ship",
		l: "R-pulamweb-2 · framework — provision · fan-out · list",
		m: "#1524",
		h: "pulam-web.html#r-pulamweb-2"
	},
	{
		d: 2,
		g: "✓",
		c: "ship",
		l: "R-pulamweb-3 · agent dashboard — agents by state",
		m: "#1535",
		h: "pulam-web.html#r-pulamweb-3"
	},
	{
		d: 2,
		g: "✕",
		c: "prog",
		l: "R-pulamweb-4 · git status drill-in — never proceeded (pulam-web retired)",
		m: "superseded by padi",
		h: "pulam-web.html#r-pulamweb-4"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "R5 · Overflow-recovery loop — typed overflow frame, web tier re-attaches",
		m: "#1591",
		h: "#r5"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "R-dock-unify · kolu's Dock reads the shared agentProjection (consistency)",
		m: "#1541",
		h: "#r-dock-unify"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "R-pip-unify · one status pip — Dock + dashboard render the same icon",
		m: "#1551",
		h: "#r-pip-unify"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "R-activity-merge · merge the activity dot into the state pip, one shared indicator",
		m: "#1555",
		h: "#r-activity-merge"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "R6 · terminal-workspace — one fs/git impl, two homes",
		m: "#1506",
		h: "#r6"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "R7 · mirrorRemoteSurface → total dual",
		m: "#1505",
		h: "#r7"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "R8 · kolu serves awareness raw; client joins authored ⋈ awareness",
		m: "#1594",
		h: "#r8"
	},
	{
		d: 0,
		g: "✓",
		c: "ship",
		l: "S1 · S2 · R9.0 · R9.1 · the awareness foundation + the endpoint resolver",
		m: "#1626 · #1603",
		h: "awareness-derive-store.html"
	},
	{
		d: 0,
		g: "▶",
		c: "prog",
		l: "R9 · R10 → re-architected as padi — W0–W4 · W6–W8 SHIPPED (the multi-host switch is live); W5 next",
		m: "→ padi",
		h: "padi.html"
	}
];
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		li: "li",
		p: "p",
		strong: "strong",
		style: "style",
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
				"The portal for ",
				createVNode($$Issue, { n: 951 }),
				" — remote terminals over SSH."
			] }),
			" Every host — this machine and each ssh remote — runs the ",
			createVNode(_components.em, { children: "same" }),
			" daemon stack, and you switch hosts from a picker, ",
			createVNode(_components.em, { children: "kinda like tmux sessions" }),
			". ",
			createVNode(_components.strong, { children: "R1–R8 are shipped" }),
			" — the foundation, the local kaval survivor, the remote-ssh spike, the standalone pulam awareness daemon, the overflow-recovery loop, ",
			createVNode(_components.code, { children: "@kolu/terminal-workspace" }),
			", the total-dual surface mirror, and kolu serving the shared awareness raw. ",
			createVNode(_components.strong, { children: ["The R9/R10 leg was re-architected as ", createVNode(_components.a, {
				href: "padi.html",
				children: "padi"
			})] }),
			" — one workspace daemon per host, the canvas single-host per view — and that plan is now mostly shipped: ",
			createVNode(_components.strong, { children: "W0–W4 and W6–W8 are live" }),
			" (kolu on master runs the multi-host switch today, honest connect overlay included — ",
			createVNode($$PrLink, { pr: 1730 }),
			"), ",
			createVNode(_components.strong, { children: "W5" }),
			" (cross-host attention) is next, and the surface consolidation runs in parallel. This note is the ",
			createVNode(_components.strong, { children: "root of the plan tree" }),
			": ",
			createVNode(_components.a, {
				href: "#map",
				children: "the map below"
			}),
			" reaches every inner note, and ",
			createVNode(_components.a, {
				href: "#finale",
				children: "the finale record"
			}),
			" holds the superseded pre-padi R9/R10 decomposition."
		] }),
		"\n",
		"\n",
		"\n",
		"\n",
		"\n",
		createVNode(_components.style, { children: `
.rt-blink { animation: rtblink 1.8s ease-in-out infinite; }
@keyframes rtblink { 0%, 100% { opacity: 1 } 50% { opacity: .45 } }
.rt-spin { display:inline-block; animation: rtspin 1.1s linear infinite; transform-origin: 50% 54%; }
@keyframes rtspin { to { transform: rotate(360deg) } }
` }),
		"\n",
		createVNode($$Callout, {
			kind: "warning",
			title: "R9/R10 re-architected — the plan of record is now padi (2026-07-01)",
			children: createVNode(_components.p, { children: [
				"The R9/R10 work was re-evaluated from the ground up and ",
				createVNode(_components.strong, { children: ["superseded by the ", createVNode(_components.a, {
					href: "padi.html",
					children: "padi architecture"
				})] }),
				": one workspace daemon per host (padi) owns the complete terminal state — registry, fold + memory on the host’s clock, lifecycle, fs/git + bytes, session persistence, kaval supervision — and kolu-server thins to a web shell that connects each browser view to one padi. The canvas is ",
				createVNode(_components.strong, { children: "single-host per view" }),
				" (a host switcher, not mixed tiles); pulam, pulam-tui and pulam-web are retired. ",
				createVNode(_components.strong, { children: "Status: on the padi side W0–W4 and W6–W8 are SHIPPED" }),
				" — kolu on master runs the multi-host switch today, honest connect overlay included (",
				createVNode($$PrLink, { pr: 1730 }),
				"); ",
				createVNode(_components.strong, { children: "W5" }),
				" (cross-host attention) is next, and the ",
				createVNode(_components.a, {
					href: "surface-runtime-boundary.html",
					children: "surface consolidation"
				}),
				" runs in parallel. Everything shipped through R8 + S1/S2/R9.0/R9.1 survives inside padi — this note and the child build logs remain the record."
			] })
		}),
		"\n",
		createVNode("a", { id: "map" }),
		"\n",
		createVNode(_components.h2, {
			id: "the-map--navigating-this-tree",
			children: "The map — navigating this tree"
		}),
		"\n",
		createVNode(_components.p, { children: "Every plan note in the remote-terminals tree, reachable from this root:" }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Current plan" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.a, {
					href: "padi.html",
					children: "padi"
				}),
				" — ",
				createVNode(_components.strong, { children: "the plan of record" }),
				": one workspace daemon per host, the canvas single-host per view; phases W0–W8 with live status."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "surface-runtime-boundary.html",
				children: "surface-runtime-boundary"
			}), " — the surface-framework consolidation plan: the refactors, upstreamings, and deletions the phases’ pace deferred, sequenced as one PR list."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "padi-latency-baseline.html",
				children: "padi-latency-baseline"
			}), " — the keystroke→echo baseline the padi hop’s sub-5ms budget was measured against."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Framework primers" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "surface-hosting-101.html",
				children: "surface-hosting-101"
			}), " — how a surface travels between machines (serve → mirror → re-serve → sessions → the registry), the machinery under W4’s switch."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.a, {
					href: "surface-map-101.html",
					children: "surface-map-101"
				}),
				" — ",
				createVNode(_components.code, { children: "@kolu/surface-map" }),
				" taught: the dynamic keyed map of remote surfaces, and W7’s per-host ownership design."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.a, {
					href: "surface-attention-101.html",
					children: "surface-attention-101"
				}),
				" — the W5 attention pieces taught: the cell completed to a Dynamic (",
				createVNode(_components.code, { children: "updated" }),
				"), mirrors that never fabricate, the derivation algebra, the eager watcher, and service-worker delivery."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "surface-reactive-bridge.html",
				children: "surface-reactive-bridge"
			}), " — the ratified backend-reactivity direction: state is a signal, derived is a computed, the wire snapshots and replays; phase 0 is W5’s framework slice."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "surface-reactor-engine.html",
				children: "surface-reactor-engine"
			}), " — the engine decision, made: @preact/signals-core behind reactor.ts now, @solidjs/signals the named swap target; the live-probed six-engine comparison."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Build logs of shipped branches" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "pty-daemon.html",
				children: "pty-daemon"
			}), " — R2: kaval, the standalone PTY daemon terminals survive deploys in."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "kaval-sessions.html",
				children: "kaval-sessions"
			}), " — R3: the remote-ssh spike (a kaval is a daemon you dial; remote is never a second backend)."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "pulam.html",
				children: "pulam"
			}), " — R4: the standalone awareness/workspace daemon (later dissolved into padi)."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "pulam-web.html",
				children: "pulam-web"
			}), " — R4.8: the browser twin that proved the browser-consumption leg (retired at padi W0)."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Design records" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "awareness-derive-store.html",
				children: "awareness-derive-store"
			}), " — observe vs remember: the memoryless producer + the one fold (its home is now padi)."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.a, {
					href: "terminal-metadata-model.html",
					children: "terminal-metadata-model"
				}),
				" — the terminal model: ",
				createVNode(_components.code, { children: "authored ⋈ snapshot" }),
				", one writer per fact."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "remote-bind-parity.html",
				children: "remote-bind-parity"
			}), " — W3.4’s parity note: everything between today and “kolu fully works over a remote bind”, as a working ledger."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Future / demand-driven" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "remote-terminals-future.html",
				children: "remote-terminals-future"
			}), " — the researched, tiered menu of what to build on top of the multi-host switch."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "port-preview.html",
				children: "port-preview"
			}), " — a bound host’s dev-server ports as clickable previews through kolu’s own origin."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "shared-canvas.html",
				children: "shared-canvas"
			}), " — share a live canvas with someone else; read-only viewers first."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "user-facing-description",
			children: "User-facing description"
		}),
		"\n",
		createVNode(RemoteCanvas, {}),
		"\n",
		createVNode(_components.p, { children: [
			"You switch hosts from a ",
			createVNode(_components.strong, { children: "picker" }),
			" — ",
			createVNode(_components.em, { children: "kinda like tmux sessions" }),
			" — and the canvas shows ",
			createVNode(_components.strong, { children: "one host’s terminals at a time" }),
			" (the shipped shape; the mockup above predates padi’s single-host ruling). A remote terminal carries the ",
			createVNode(_components.em, { children: "same" }),
			" live awareness a local one does — git branch/dirty, PR status, agent state, live activity — and it survives a network blip or a kolu-server deploy with full scrollback. One local host is always present; remotes are added on demand from your ssh config."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "SSH in as the user that runs kaval",
			children: createVNode(_components.p, { children: [
				"A remote dial (",
				createVNode(_components.code, { children: "kaval-tui --host" }),
				"; padi’s ",
				createVNode(_components.code, { children: "KOLU_PADI_HOST" }),
				" binding likewise) runs the remote daemon ",
				createVNode(_components.strong, { children: "as the SSH user" }),
				" — ",
				createVNode(_components.code, { children: "ssh <host> kaval --stdio" }),
				" / ",
				createVNode(_components.code, { children: "padi --stdio" }),
				". That user is the identity that reaches the kaval socket, and kaval’s socket directory is ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "0700" }), ", owner-only"] }),
				" by design: the socket serves the ",
				createVNode(_components.em, { children: "full" }),
				" pty-host surface (write/kill/spawn/getScreenText), so anyone who can ",
				createVNode(_components.code, { children: "connect()" }),
				" has total control of every terminal on the box. There is no group-share knob — the gate rejects ",
				createVNode(_components.strong, { children: "any" }),
				" group or other bit (",
				createVNode(_components.code, { children: "(mode & 0o077) === 0" }),
				"), so a ",
				createVNode(_components.code, { children: "0750" }),
				" dir doesn’t share the socket, it makes kaval ",
				createVNode(_components.strong, { children: "refuse to serve" }),
				". The consequence: the SSH user and the kaval owner must be the ",
				createVNode(_components.strong, { children: "same identity" }),
				". On a deployment that runs kaval as a dedicated service account (e.g. a ",
				createVNode(_components.code, { children: "kolu" }),
				" user), SSH in ",
				createVNode(_components.strong, { children: "as that account" }),
				" (a restricted/forced-command key is the usual way) rather than as a separate login user. (",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/discussions/1620",
					children: "discussion #1620"
				}),
				")"
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "architecture-level-changes",
			children: "Architecture-level changes"
		}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"The rest of this section records the ",
			createVNode(_components.strong, { children: "pre-padi" }),
			" architecture (the R1–R8 era) — kept as the historical record; the current architecture is ",
			createVNode(_components.a, {
				href: "padi.html",
				children: "padi"
			}),
			"."
		] }) }),
		"\n",
		createVNode($$Svg, {
			svg: remote_terminals_architecture_default,
			caption: "The pre-padi multi-host shape (historical). Every host runs the same hashed kaval daemon; kolu-server keys its terminal endpoint by hostId behind one TerminalEndpoint seam. The local driver (R2, shipped) spawns + supervises a kaval over a unix socket; the ssh driver (R9) reaches + provisions the same kaval closure over ssh stdio; the remote mirror (R9) reaches a host-side pulam's awareness (kolu serves the shared awareness collection raw as of R8, joined with the authored half at the reader) + fs/git (read in R9). Local awareness runs in-process; only remote crosses a process boundary."
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "One endpoint, bound to a dialed kaval." }),
			" A kaval is a daemon you ",
			createVNode(_components.em, { children: "dial" }),
			" — local over a unix socket, remote over ssh — so remote is ",
			createVNode(_components.strong, { children: "not a second backend" }),
			". There is ",
			createVNode(_components.em, { children: "one" }),
			" ",
			createVNode(_components.code, { children: "TerminalEndpoint" }),
			" per terminal, resolved by ",
			createVNode(_components.code, { children: "HostLocation" }),
			" (",
			createVNode(_components.code, { children: "{kind:\"local\"}" }),
			" today, ",
			createVNode(_components.code, { children: "{kind:\"remote\",hostId}" }),
			" in R9). That resolver is meant to be the ",
			createVNode(_components.strong, { children: "sole" }),
			" place a tile maps to its kaval; everything downstream talks to the backend and never asks “which kind?”. No ",
			createVNode(_components.code, { children: "RemoteTerminalEndpoint" }),
			" — and the resolver ",
			createVNode(_components.strong, { children: "shipped in R9.1" }),
			" (",
			createVNode(_components.code, { children: "resolveTerminalEndpoint" }),
			", ",
			createVNode($$PrLink, { pr: 1603 }),
			"): per-terminal ops already resolve off ",
			createVNode(_components.code, { children: "entry.meta.location" }),
			" and never ask “which kind?”, with the ",
			createVNode(_components.code, { children: "{kind:\"remote\"}" }),
			" arm failing loud until ",
			createVNode(_components.strong, { children: ["R9.2 adds the ssh ", createVNode(_components.em, { children: "driver" })] }),
			" as an additive sibling of R2’s local driver."
		] }),
		"\n",
		createVNode(_components.p, { children: "Two volatility axes stay open (R1/R2 closed the rest):" }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Axis — changes for its own reason" }),
					"\n",
					createVNode(_components.th, { children: "Encapsulated by" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Where a terminal’s state lives — this machine vs an ssh host" }),
					"\n",
					createVNode(_components.td, { children: [
						"the ",
						createVNode(_components.code, { children: "HostLocation" }),
						"-resolved kaval endpoint — one impl + a discriminator, not a second backend"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "How the backend reaches its agent — transport · framing · reconnect" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "HostSession" }),
						" + ",
						createVNode(_components.code, { children: "@kolu/surface/links/stdio" }),
						" — unix socket today, ssh in R9"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Zero domain knowledge crosses the transport" }),
			" (Hickey’s cut): the agent runs the unmodified sensors and the boundary ships their ",
			createVNode(_components.em, { children: "values" }),
			". An earlier per-domain design (",
			createVNode(_components.code, { children: "RemoteGitInfoProvider" }),
			", …) was transport adapters wearing domain costumes; the single-endpoint seam dissolved them."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "kolu no longer keeps its own copy of awareness — R8 shipped",
			children: createVNode(_components.p, { children: [
				"kolu used to fuse awareness into its ",
				createVNode(_components.strong, { children: "own" }),
				" ",
				createVNode(_components.code, { children: "terminalMetadata" }),
				" record — a private copy. ",
				createVNode(_components.strong, { children: "R8" }),
				" (",
				createVNode($$PrLink, { pr: 1594 }),
				") split it: a single-writer awareness store is served ",
				createVNode(_components.strong, { children: "raw" }),
				" on ",
				createVNode(_components.code, { children: "terminalWorkspaceSurface.awareness" }),
				", kolu keeps only what it ",
				createVNode(_components.em, { children: "authors" }),
				" (",
				createVNode(_components.code, { children: "kolu.authored" }),
				"), and the ",
				createVNode(_components.strong, { children: "client joins the two at the reader" }),
				" — no server-side fusion. Detail in ",
				createVNode(_components.strong, { children: "R8" }),
				" and ",
				createVNode(_components.a, {
					href: "terminal-metadata-model.html",
					children: "the terminal model"
				}),
				". ",
				createVNode(_components.strong, { children: "Correction (settled):" }),
				" R8’s reader-join is kept. The awareness architecture for remote terminals is now decided: split ",
				createVNode(_components.strong, { children: "observing" }),
				" from ",
				createVNode(_components.strong, { children: "remembering" }),
				" — a ",
				createVNode(_components.em, { children: "memoryless producer" }),
				" per host emits ",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				" events; ",
				createVNode(_components.em, { children: "kolu alone folds" }),
				" them, owns the memory (on ",
				createVNode(_components.code, { children: "kolu.authored" }),
				"), and stamps recency with its own clock. Two earlier directions are dead — the local-pulam-",
				createVNode(_components.strong, { children: "process" }),
				" (",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/pull/1614",
					children: "#1614"
				}),
				", closed) and createPulam / share-the-assembly (superseded). See ",
				createVNode(_components.a, {
					href: "awareness-derive-store.html",
					children: "the awareness design"
				}),
				"; the fold’s home later moved into padi (",
				createVNode(_components.a, {
					href: "padi.html",
					children: "padi"
				}),
				")."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Already paid for, so R5–R10 are narrow." }),
			" ",
			createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
			" ships ",
			createVNode(_components.code, { children: "HostSession" }),
			", ",
			createVNode(_components.code, { children: "provisionAgent" }),
			" (ships the ",
			createVNode(_components.em, { children: "derivation" }),
			" — a darwin parent drives a linux remote with no cross-builder), and ",
			createVNode(_components.code, { children: "resolveSystem" }),
			"; ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" ships ",
			createVNode(_components.code, { children: "mirrorRemoteSurface" }),
			" (now a total dual). R2 already shipped the host-count-agnostic spine: ",
			createVNode(_components.code, { children: "@kolu/surface-daemon-supervisor" }),
			" and the per-connect ",
			createVNode(_components.code, { children: "system.version" }),
			" handshake. So R9 is an ssh driver behind shipped seams; R8 made kolu serve the shared awareness (",
			createVNode($$PrLink, { pr: 1594 }),
			"); R7 ",
			createVNode(_components.em, { children: "completed" }),
			" the surface mirror (",
			createVNode($$PrLink, { pr: 1505 }),
			"); R6 grew pulam’s fs/git (",
			createVNode($$PrLink, { pr: 1506 }),
			"); R5 added the one wire signal that distinguishes a slow-subscriber drop from a PTY exit (",
			createVNode($$PrLink, { pr: 1591 }),
			")."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "implementation-details",
			children: "Implementation details"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The whole epic as one tree — bird’s-eye, with each row’s right-hand link a ",
			createVNode(_components.strong, { children: "drill-down" }),
			" to where that phase lives (the child notes for shipped branches, the ",
			createVNode(_components.code, { children: "###" }),
			" sections below for the rest). ",
			createVNode(_components.strong, { children: [
				"R1–R8 (incl. pulam-web’s framework) are shipped; the R9/R10 leg re-architected as ",
				createVNode(_components.a, {
					href: "padi.html",
					children: "padi"
				}),
				" — W0–W2.2 shipped there."
			] })
		] }),
		"\n",
		"\n",
		createVNode($$PhaseTree, {
			title: "ROADMAP — remote terminals over ssh (#951)",
			phases: PT
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Everything marked ✓ is shipped (PRs linked). ",
			createVNode(_components.strong, { children: "R8" }),
			" (",
			createVNode($$PrLink, { pr: 1594 }),
			") ended kolu’s private awareness copy: a single-writer store served ",
			createVNode(_components.strong, { children: "raw" }),
			", kolu keeping only ",
			createVNode(_components.code, { children: "kolu.authored" }),
			", the client joining the halves at the reader. The S1/S2 awareness foundation + the endpoint resolver shipped next (",
			createVNode($$PrLink, { pr: 1626 }),
			", ",
			createVNode($$PrLink, { pr: 1603 }),
			") — and the rest of the R9/R10 leg was ",
			createVNode(_components.strong, { children: ["re-architected wholesale as ", createVNode(_components.a, {
				href: "padi.html",
				children: "padi"
			})] }),
			": its W1 rewired the client onto one complete surface, its W2 made padi the per-host process that owns the domain, its W3/W4 landed the remote binding and the host switch. The web-UI indicator thread — ",
			createVNode(_components.strong, { children: createVNode(_components.a, {
				href: "#r-dock-unify",
				children: "R-dock-unify"
			}) }),
			" (",
			createVNode($$PrLink, { pr: 1541 }),
			") · ",
			createVNode(_components.strong, { children: createVNode(_components.a, {
				href: "#r-pip-unify",
				children: "R-pip-unify"
			}) }),
			" (",
			createVNode($$PrLink, { pr: 1551 }),
			") · ",
			createVNode(_components.strong, { children: createVNode(_components.a, {
				href: "#r-activity-merge",
				children: "R-activity-merge"
			}) }),
			" (",
			createVNode($$PrLink, { pr: 1555 }),
			") — single-sourced the per-row indicators, so the Dock and the dashboard render one indicator from one projection. Each ✓ row drills into its detail — the child notes for shipped branches, the ",
			createVNode(_components.code, { children: "###" }),
			" sections below for the rest."
		] }),
		"\n",
		createVNode("a", { id: "r5" }),
		"\n",
		createVNode(_components.h3, {
			id: "r5--overflow-recovery-loop",
			children: "R5 — overflow-recovery loop"
		}),
		"\n",
		createVNode($$Phase, {
			id: "R5",
			name: "overflow-recovery loop",
			status: "shipped",
			links: [{
				label: "#1591",
				href: "https://github.com/juspay/kolu/pull/1591"
			}]
		}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: "Independent — needed nothing, blocked nothing; landed on its own." }) }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped" }),
			" (",
			createVNode($$PrLink, { pr: 1591 }),
			"). kaval sheds a slow attach subscriber by ",
			createVNode(_components.em, { children: "ending" }),
			" its iterator, which was indistinguishable on the wire from a PTY exit — so the client treated the drop as terminal and froze scrollback. The attach contract (",
			createVNode(_components.code, { children: "ptyHostSurface" }),
			", bumped to 5.0 — a new ",
			createVNode(_components.em, { children: "emitted" }),
			" union variant is breaking for an older client, which the version predicate would otherwise wave through) now carries a typed ",
			createVNode(_components.code, { children: "overflow" }),
			" control frame, emitted as the stream’s last frame when the host drops a lagging subscriber, distinct from a PTY ",
			createVNode(_components.code, { children: "exit" }),
			". The web tier (",
			createVNode(_components.code, { children: "terminalEndpoint/local.ts" }),
			") reads it and ",
			createVNode(_components.strong, { children: "re-attaches for a fresh snapshot" }),
			" — reset-then-snapshot so the repaint replaces stale rows rather than double-painting — instead of freezing; kaval-tui’s existing re-attach loop reads it to skip writing a dataless frame; pulam ignores it (activity is best-effort). The drop is reproducible on the ",
			createVNode(_components.em, { children: "local" }),
			" socket, so it is CI-tested today (",
			createVNode(_components.code, { children: "inProcessPtyHost.test.ts" }),
			", ",
			createVNode(_components.code, { children: "reattachingDeltas.test.ts" }),
			"), and the hardened contract is a clean prerequisite for the remote reconnect R9 leans on. ",
			createVNode(_components.a, {
				href: "herdr-vs-kolu.html",
				children: "herdr vs kolu"
			}),
			" flagged the same gap."
		] }),
		"\n",
		createVNode("a", { id: "r6" }),
		"\n",
		createVNode("a", { id: "r-dock-unify" }),
		"\n",
		createVNode(_components.h3, {
			id: "r-dock-unify--kolus-dock-reads-the-shared-agentprojection",
			children: ["R-dock-unify — kolu’s Dock reads the shared ", createVNode(_components.code, { children: "agentProjection" })]
		}),
		"\n",
		createVNode($$Phase, {
			id: "R-dock-unify",
			name: "Dock + dashboard, one source",
			status: "shipped",
			needs: ["R-pulamweb-3"],
			links: [{
				label: "born in #1535",
				href: "https://github.com/juspay/kolu/pull/1535"
			}, {
				label: "#1541",
				href: "https://github.com/juspay/kolu/pull/1541"
			}]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped" }),
			" (",
			createVNode($$PrLink, { pr: 1541 }),
			") — kolu’s Dock became the third consumer of the shared ",
			createVNode(_components.code, { children: "@kolu/terminal-workspace/agentProjection" }),
			", so the Dock, pulam-tui, and pulam-web rank/paint agents from one source; a differential test pins them equal."
		] }),
		"\n",
		createVNode("a", { id: "r-pip-unify" }),
		"\n",
		createVNode(_components.h3, {
			id: "r-pip-unify--one-status-pip-across-the-web-surfaces",
			children: "R-pip-unify — one status pip across the web surfaces"
		}),
		"\n",
		createVNode($$Phase, {
			id: "R-pip-unify",
			name: "Dock + dashboard render the same icon",
			status: "shipped",
			needs: ["R-dock-unify"],
			links: [{
				label: "#1551",
				href: "https://github.com/juspay/kolu/pull/1551"
			}]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped" }),
			" (",
			createVNode($$PrLink, { pr: 1551 }),
			") — the Dock’s ",
			createVNode(_components.code, { children: "StatePip" }),
			" lifted into ",
			createVNode(_components.code, { children: "@kolu/solid-statepip" }),
			" + a shared ",
			createVNode(_components.code, { children: "@kolu/theme" }),
			", so the Dock and pulam-web render the identical status pip from one component."
		] }),
		"\n",
		createVNode("a", { id: "r-activity-merge" }),
		"\n",
		createVNode(_components.h3, {
			id: "r-activity-merge--merge-the-activity-dot-into-the-state-pip",
			children: "R-activity-merge — merge the activity dot into the state pip"
		}),
		"\n",
		createVNode($$Phase, {
			id: "R-activity-merge",
			name: "merge the activity dot into the state pip",
			status: "shipped",
			needs: ["R-pip-unify"],
			links: [{
				label: "#1555",
				href: "https://github.com/juspay/kolu/pull/1555"
			}]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped" }),
			" (",
			createVNode($$PrLink, { pr: 1555 }),
			") — the live-activity dot and the unread alert merged into that same ",
			createVNode(_components.code, { children: "StatePip" }),
			" (a sweeping green ring + an amber corner badge), so each row renders one indicator from one leaf."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "r6--koluterminal-workspace-one-library-one-fsgit-impl-two-homes",
			children: [
				"R6 — ",
				createVNode(_components.code, { children: "@kolu/terminal-workspace" }),
				": one library, one fs/git impl, two homes"
			]
		}),
		"\n",
		createVNode($$Phase, {
			id: "R6",
			name: "terminal-workspace — one fs/git impl, two homes",
			status: "shipped",
			needs: ["R4"],
			blocks: ["R8"],
			links: [{
				label: "#1506",
				href: "https://github.com/juspay/kolu/pull/1506"
			}]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped" }),
			" (",
			createVNode($$PrLink, { pr: 1506 }),
			") — ",
			createVNode(_components.code, { children: "@kolu/terminal-workspace" }),
			": one fs/git impl (",
			createVNode(_components.code, { children: "createTerminalWorkspaceEndpoint" }),
			"), run in-process by kolu and hosted remotely by pulam. The shared ",
			createVNode(_components.em, { children: "impl" }),
			", not yet the shared ",
			createVNode(_components.em, { children: "surface" }),
			" — the shared ",
			createVNode(_components.strong, { children: "awareness" }),
			" surface is ",
			createVNode(_components.strong, { children: "R8" }),
			"; the fs/git surface is ",
			createVNode(_components.strong, { children: "R9" }),
			"."
		] }),
		"\n",
		createVNode("a", { id: "r7" }),
		"\n",
		createVNode(_components.h3, {
			id: "r7--mirrorremotesurface-is-now-a-total-dual--shipped-",
			children: [
				"R7 — ",
				createVNode(_components.code, { children: "mirrorRemoteSurface" }),
				" is now a total dual — ",
				createVNode(_components.em, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1505 })
			]
		}),
		"\n",
		createVNode($$Phase, {
			id: "R7",
			name: "mirrorRemoteSurface → total dual",
			status: "shipped",
			blocks: ["R9"],
			links: [{
				label: "#1505",
				href: "https://github.com/juspay/kolu/pull/1505"
			}]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped" }),
			" (",
			createVNode($$PrLink, { pr: 1505 }),
			") — ",
			createVNode(_components.code, { children: "mirrorRemoteSurface" }),
			" became a total dual returning ",
			createVNode(_components.code, { children: "{ procedures, done }" }),
			" (every procedure a forwarding stub), so ",
			createVNode(_components.code, { children: "serve ∘ mirror ≈ identity" }),
			"; proven by drishti’s forwarded “Kill process” action under the surface.md gate."
		] }),
		"\n",
		createVNode("a", { id: "r8" }),
		"\n",
		createVNode(_components.h3, {
			id: "r8--kolu-serves-awareness-raw-the-client-joins-it--shipped-",
			children: [
				"R8 — kolu serves awareness raw; the client joins it — ",
				createVNode(_components.em, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1594 })
			]
		}),
		"\n",
		createVNode($$Phase, {
			id: "R8",
			name: "kolu serves awareness raw; client joins authored ⋈ awareness",
			status: "shipped",
			needs: ["R6"],
			blocks: ["R9", "R9a"],
			links: [{
				label: "#1594",
				href: "https://github.com/juspay/kolu/pull/1594"
			}]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped" }),
			" (",
			createVNode($$PrLink, { pr: 1594 }),
			"). kolu used to fuse awareness into its own private ",
			createVNode(_components.code, { children: "terminalMetadata" }),
			" record. R8 bisected it: the sensor fields live in a ",
			createVNode(_components.strong, { children: "single-writer awareness store" }),
			" served ",
			createVNode(_components.strong, { children: "raw" }),
			" on ",
			createVNode(_components.code, { children: "terminalWorkspaceSurface.awareness" }),
			" (",
			createVNode(_components.code, { children: "AwarenessValue" }),
			"); kolu keeps only what it ",
			createVNode(_components.em, { children: "authors" }),
			" on ",
			createVNode(_components.code, { children: "kolu.authored" }),
			" (",
			createVNode(_components.code, { children: "AuthoredTerminal" }),
			" — location · chrome · the active|sleeping discriminant). ",
			createVNode(_components.strong, { children: "Neither side fuses them" }),
			" — ",
			createVNode(_components.code, { children: "surfaceCtx.collections.terminalMetadata" }),
			" is a compile error. The ",
			createVNode(_components.strong, { children: "client joins the two halves at the reader" }),
			" (",
			createVNode(_components.code, { children: "useTerminalMetadata" }),
			" → ",
			createVNode(_components.code, { children: "composeTerminalMetadata" }),
			"), and the same join authors the on-disk ",
			createVNode(_components.code, { children: "SavedTerminal" }),
			", so disk and the read can’t diverge. One writer per fact, and the bisection reaches the consumer. Full model: ",
			createVNode(_components.a, {
				href: "terminal-metadata-model.html",
				children: "the terminal model"
			}),
			". ",
			createVNode(_components.em, { children: [
				"(The awareness half was later reshaped by the ",
				createVNode(_components.a, {
					href: "awareness-derive-store.html",
					children: "awareness-derive-store cutover"
				}),
				": the single-writer store became kolu’s ",
				createVNode(_components.strong, { children: "fold" }),
				" over a memoryless producer’s observation stream, and the collection value ",
				createVNode(_components.code, { children: "AwarenessValue" }),
				" became ",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				" — the reader-join itself is unchanged.)"
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "One surface, two homes." }),
			" kolu-server and the ",
			createVNode(_components.code, { children: "pulam" }),
			" daemon both serve ",
			createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
			", but assemble it via ",
			createVNode(_components.strong, { children: "one factory" }),
			" — ",
			createVNode(_components.code, { children: "@kolu/terminal-workspace/serveTerminalWorkspace" }),
			", the volatility-boundary twin of ",
			createVNode(_components.code, { children: "serveFsGit" }),
			": the ",
			createVNode(_components.code, { children: "version" }),
			" cell + fs/git procedures/streams live there once, and each home injects only its ",
			createVNode(_components.strong, { children: "awareness backing" }),
			" (kolu projects off its registry; pulam reads its own store) and its ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "activity" }), " source"] }),
			" (quiet for kolu, live for pulam). So R8 ",
			createVNode(_components.strong, { children: ["unblocks ", createVNode(_components.a, {
				href: "#r9a",
				children: "R9a"
			})] }),
			" — kolu now serves an awareness a second process can read — and makes remote awareness in R9 a ",
			createVNode(_components.strong, { children: "backing injection" }),
			", not a rewrite."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "fs/git is not part of R8 — it rides R9." }),
			" ",
			createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
			" deliberately serves fs/git as ",
			createVNode(_components.strong, { children: "procedures + pulse" }),
			", not value-bearing streams: ",
			createVNode(_components.code, { children: "fs.listAll" }),
			"/",
			createVNode(_components.code, { children: "git.getStatus" }),
			" are request→response procedures, and ",
			createVNode(_components.code, { children: "subscribeRepoChange" }),
			"/",
			createVNode(_components.code, { children: "subscribeFileChange" }),
			" are payload-free ",
			createVNode(_components.code, { children: "{seq}" }),
			" pulses you re-query on (",
			createVNode(_components.code, { children: "surface.ts:89-109" }),
			" — ",
			createVNode(_components.em, { children: "“re-queries procedures rather than streaming full diffs over the wire”" }),
			"). kolu’s Code tab today reads ",
			createVNode(_components.code, { children: "koluSurface" }),
			"’s ",
			createVNode(_components.strong, { children: "value-bearing" }),
			" streams (",
			createVNode(_components.code, { children: "app.streams.gitStatus/fsListAll/gitDiff.use" }),
			", ",
			createVNode(_components.code, { children: "CodeTab.tsx:314-373" }),
			"). Making kolu read the shared surface’s fs/git means ",
			createVNode(_components.strong, { children: "rewriting the Code tab from value-bearing streams to procedure + pulse-then-requery" }),
			" — a large client change the surface ties to mirroring the surface whole. So it lands with ",
			createVNode(_components.strong, { children: "R9" }),
			", where kolu mirrors the whole surface anyway."
		] }),
		"\n",
		createVNode("a", { id: "r9" }),
		"\n",
		createVNode(_components.h3, {
			id: "r9r10--kolu-dials-remotes-then-the-canvas",
			children: "R9–R10 — kolu dials remotes, then the canvas"
		}),
		"\n",
		createVNode("a", { id: "r9a" }),
		"\n",
		createVNode("a", { id: "r10" }),
		"\n",
		createVNode($$Phase, {
			id: "R9",
			name: "kolu dials remotes → re-architected as padi",
			status: "superseded",
			needs: ["R7", "R8"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: ["Superseded — this leg became the ", createVNode(_components.a, {
				href: "padi.html",
				children: "padi architecture"
			})] }),
			", after the ground-up re-evaluation recorded in History: “which host” is a property of the ",
			createVNode(_components.em, { children: "connection" }),
			", not of each terminal, so instead of threading a per-terminal ",
			createVNode(_components.code, { children: "HostLocation" }),
			" through kolu-server, one workspace daemon per host (padi) owns the complete terminal state and the canvas shows one host at a time. What the old decomposition planned maps as: R9.2 (ssh driver) + R9.3 (remote awareness) + R9.4 (reconnect/adoption) → padi ",
			createVNode(_components.strong, { children: "W3.1" }),
			" (the remote binding, shipped); R9.5 (Code-tab rewrite) → shipped inside padi ",
			createVNode(_components.strong, { children: "W1" }),
			" (un-gated from R-pulamweb-4); R10 (canvas) → padi ",
			createVNode(_components.strong, { children: "W4/W5" }),
			" (the host switch — shipped — + cross-host attention, single-host per view; the multiplex-vs-switch question was settled by a persona UX study, switch won). ",
			createVNode(_components.strong, { children: "Shipped on the padi side: W0–W4 and W6–W8" }),
			" — kolu on master runs the multi-host switch today; ",
			createVNode(_components.strong, { children: "W5" }),
			" next. ",
			createVNode(_components.a, {
				href: "#finale",
				children: "The finale record below"
			}),
			" holds the superseded R9/R10 decomposition; ",
			createVNode(_components.a, {
				href: "surface-runtime-boundary.html",
				children: "surface-runtime-boundary"
			}),
			" holds the consolidation plan."
		] }),
		"\n",
		createVNode("a", { id: "finale" }),
		"\n",
		createVNode("a", { id: "prep" }),
		"\n",
		createVNode("a", { id: "fremote" }),
		"\n",
		createVNode(_components.h3, {
			id: "the-finale-record-r9-converged--r10--superseded",
			children: "The finale record (R9 converged · R10) — superseded"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The pre-padi plan of record for this leg. Its foundations shipped and live on: ",
			createVNode(_components.strong, { children: "S1 + S2 + R9.0 + R9.1" }),
			" (",
			createVNode($$PrLink, { pr: 1626 }),
			", ",
			createVNode($$PrLink, { pr: 1603 }),
			") — the memoryless awareness producer, kolu’s fold, the in-process local awareness, and the ",
			createVNode(_components.code, { children: "HostLocation" }),
			" endpoint resolver — all reused inside padi. The awareness types and API are recorded in ",
			createVNode(_components.a, {
				href: "awareness-derive-store.html",
				children: "awareness-derive-store"
			}),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The re-sequenced remainder — three parallel local-preserving prep PRs (",
			createVNode(_components.strong, { children: "PR-1" }),
			" lifecycle · ",
			createVNode(_components.strong, { children: "PR-2" }),
			" fs/git · ",
			createVNode(_components.strong, { children: "PR-3" }),
			" awareness) → ",
			createVNode(_components.strong, { children: "F-REMOTE" }),
			" (the one complete remote tile) → ",
			createVNode(_components.strong, { children: "R10" }),
			" (canvas + host picker) — ",
			createVNode(_components.strong, { children: "never proceeded" }),
			": the whole decomposition was superseded by ",
			createVNode(_components.a, {
				href: "padi.html",
				children: "padi"
			}),
			" on 2026-07-01 (its per-terminal ",
			createVNode(_components.code, { children: "HostLocation" }),
			" threading was N-site handling of a connection-level volatility), and its prep PRs #1637–#1640 were closed. The W-phase mapping is in the section above; the detailed sub-phase specs live in git history."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "history",
			children: "History"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "padi W0–W2.2 shipped — kolu runs on padi" }),
				" (2026-07-02 → 03) — the padi plan’s first three phases landed: W0 decks cleared (the old surface frozen #1650, pulam-web retired, R5’s overflow frame #1591 riding along as kaval 5.0), W1 the padi seam (",
				createVNode($$PrLink, { pr: 1652 }),
				" — ",
				createVNode(_components.code, { children: "packages/padi" }),
				" born, the client rewired onto padiSurface, the root RPC namespace deleted, the seal), W2.1 the policy-driven re-serve machinery (",
				createVNode($$PrLink, { pr: 1661 }),
				", drishti adopting ",
				createVNode(_components.code, { children: "initialKeys" }),
				" as the second-consumer proof), and W2.2 padi-the-process (",
				createVNode($$PrLink, { pr: 1664 }),
				" — state-root identity, digest rendezvous, padi owns kaval, the cutover; plus the endgame’s doctrine: deploy-adoption — a deploy ADOPTS a compatible running daemon and its live PTYs, restore is for dead daemons only — newest-wins upgrade convergence via a frozen control core, Restart-kaval recycling kaval inside padi, and the migration adopter for pre-padi installs). W2.3 (padi-tui + the pulam burial) in flight; W4 became the consolidation track (now ",
				createVNode(_components.a, {
					href: "surface-runtime-boundary.html",
					children: "the surface-runtime plan"
				}),
				"); W5 demand-driven."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R9/R10 superseded by the padi architecture" }),
				" (2026-07-01) — a ground-up re-evaluation (7-lens adversarial review + persona UX evaluation) found “which host” to be a ",
				createVNode(_components.em, { children: "connection-level" }),
				" volatility, not a per-terminal one: the canvas becomes single-host per view, and a per-host workspace daemon (",
				createVNode(_components.strong, { children: "padi" }),
				" — pulam grown to completion + kolu-server’s whole terminal domain) serves ONE complete surface that kolu-server merely binds to. PRs #1637/#1638/#1639/#1640 closed; pulam-web/pulam-tui retire; the S1/S2 producer+fold move into padi verbatim (owner-clock replaces consumer-clock — re-settled, since no view ever compares two hosts). Plan of record: ",
				createVNode(_components.a, {
					href: "padi.html",
					children: "padi"
				}),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R9 awareness architecture settled — observe vs. remember; createPulam superseded" }),
				" (2026-06-29) — A grounded 3-agent design debate (held to the perfection bar) converged the remote-awareness architecture: split ",
				createVNode(_components.strong, { children: "observing" }),
				" from ",
				createVNode(_components.strong, { children: "remembering" }),
				". The producer is ",
				createVNode(_components.strong, { children: "memoryless" }),
				" — it emits ",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				" events and ",
				createVNode(_components.em, { children: "cannot spell" }),
				" the memory fields, by type. ",
				createVNode(_components.strong, { children: "kolu alone folds" }),
				", owns the memory (moved to ",
				createVNode(_components.code, { children: "kolu.authored" }),
				"), and stamps recency with its own clock (killing cross-host clock skew); the wire carries an event stream, not whole values, so local and remote are one fold path and the remote reconcile disappears. This ",
				createVNode(_components.strong, { children: "supersedes createPulam" }),
				" (“share the assembly” still fused deriving with storing), so ",
				createVNode(_components.strong, { children: "R9·lib dissolves" }),
				". Decided: memory→",
				createVNode(_components.code, { children: "kolu.authored" }),
				", identity-only recency, urgency-only dashboards, host-scoped key. Full design: ",
				createVNode(_components.a, {
					href: "awareness-derive-store.html",
					children: "the awareness note"
				}),
				"; plan: ",
				createVNode(_components.a, {
					href: "#finale",
					children: "the finale record"
				}),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R9 re-grounded — the decoupling is the library, not a process; #1614 closed" }),
				" (2026-06-28) — A step back, grounded in the source, found the previous correction’s premise wrong: the awareness capability is ",
				createVNode(_components.strong, { children: "already a decoupled library" }),
				" (",
				createVNode(_components.code, { children: "@kolu/terminal-workspace" }),
				" — its dependency arrow points out, six consumers) and kolu already consumes it in-process (",
				createVNode(_components.code, { children: "terminalEndpoint/local.ts" }),
				" runs the library’s ",
				createVNode(_components.code, { children: "startAwareness" }),
				" against kaval’s taps). So no ",
				createVNode(_components.em, { children: "local pulam process" }),
				" was ever needed. ",
				createVNode(_components.strong, { children: [
					"PR ",
					createVNode(_components.a, {
						href: "https://github.com/juspay/kolu/pull/1614",
						children: "#1614"
					}),
					" is closed"
				] }),
				" (the local-pulam-process — a misdiagnosis that also introduced a fold-clobber intrinsic to mirroring an ephemeral local process across a socket). The real gap: the library exposes only ",
				createVNode(_components.em, { children: "parts" }),
				", with no single assembly, so there is ",
				createVNode(_components.strong, { children: "no 1:1" }),
				" between it and the pulam daemon (the assembly + the sink + the byte-tap live in the daemon, re-implemented divergently inside kolu). Corrected plan at the time — ",
				createVNode(_components.strong, { children: "R9·lib" }),
				" gives the library one assembly entry point (createPulam) the daemon wraps trivially. (That createPulam direction is itself now ",
				createVNode(_components.strong, { children: "superseded" }),
				" by the observe-vs-remember design — see the entry above.)"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R9a discarded; an interim “local pulam process” direction" }),
				" (2026-06-28) — R8’s reader-join is kept; ",
				createVNode(_components.strong, { children: [
					"R9a (",
					createVNode($$PrLink, { pr: 1604 }),
					") is abandoned"
				] }),
				" (its approach had pulam-web reach ",
				createVNode(_components.em, { children: "into" }),
				" kolu), and the one real thing it surfaced — a ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				" membership bug (",
				createVNode(_components.code, { children: "broadcastKeys" }),
				") — landed on its own (",
				createVNode($$PrLink, { pr: 1609 }),
				"). This entry’s then-proposed direction (kolu running a ",
				createVNode(_components.em, { children: "local pulam process" }),
				" as its awareness backing) is ",
				createVNode(_components.strong, { children: "superseded by the re-grounding above" }),
				" — the awareness library was already decoupled, so no process was needed."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R8 shipped — awareness served raw, joined at the reader" }),
				" (2026-06-27, ",
				createVNode($$PrLink, { pr: 1594 }),
				") — rather than re-fusing awareness into kolu’s own record, R8 serves two raw collections (",
				createVNode(_components.code, { children: "terminalWorkspace.snapshots" }),
				" + ",
				createVNode(_components.code, { children: "kolu.authored" }),
				") and the client joins them via ",
				createVNode(_components.code, { children: "composeTerminalMetadata" }),
				"; the same join authors disk. A perfection-review pass collapsed an interim server-side compose (no ",
				createVNode(_components.code, { children: "terminalMetadata" }),
				" served collection survives), and a follow-up factored the two-home serving into ",
				createVNode(_components.code, { children: "serveTerminalWorkspace" }),
				" (the ",
				createVNode(_components.code, { children: "serveFsGit" }),
				" twin). Model: ",
				createVNode(_components.a, {
					href: "terminal-metadata-model.html",
					children: "the terminal model"
				}),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R5 shipped — overflow-recovery loop" }),
				" (2026-06-26, ",
				createVNode($$PrLink, { pr: 1591 }),
				") — the attach contract (",
				createVNode(_components.code, { children: "ptyHostSurface" }),
				" 5.0 — a breaking major bump, since a new emitted union variant is not backwards-compatible for an older client) gained a typed ",
				createVNode(_components.code, { children: "overflow" }),
				" control frame; the web tier re-attaches for a fresh snapshot on it instead of freezing scrollback, distinct from a PTY exit. Hardens the attach contract for both transports ahead of R9."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R8 re-scoped to awareness only; fs/git is R9" }),
				" (2026-06-26) — a fresh implementing agent caught that ",
				createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
				" deliberately serves fs/git as procedures + a ",
				createVNode(_components.code, { children: "{seq}" }),
				" pulse (not value-bearing streams; ",
				createVNode(_components.code, { children: "surface.ts:89-109" }),
				"). So R8 is now just the awareness compose (clean, unblocks R9a); making kolu read the shared surface’s fs/git is the Code-tab rewrite to pulse-then-requery, which rides R9. R-pulamweb-4 consumes the existing procedure + pulse (needs only R-pulamweb-3). The two wire shapes are explained in ",
				createVNode(_components.a, {
					href: "surface-live-data.html",
					children: "surface live data"
				}),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Pierre de-gated" }),
				" (2026-06-26) — the ",
				createVNode(_components.code, { children: "@pierre/trees" }),
				" swallow-emit was reproduced harmless in kolu (",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/issues/1534",
					children: "#1534"
				}),
				"), so the git drill-in no longer waits on a renderer proof; R-pulamweb-4 consumes the existing procedure + pulse."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R-activity-merge" }),
				" (2026-06-24, ",
				createVNode($$PrLink, { pr: 1555 }),
				") — activity dot + unread alert merged into ",
				createVNode(_components.code, { children: "StatePip" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R-pip-unify" }),
				" (2026-06-23, ",
				createVNode($$PrLink, { pr: 1551 }),
				") — one status pip via ",
				createVNode(_components.code, { children: "@kolu/solid-statepip" }),
				" + ",
				createVNode(_components.code, { children: "@kolu/theme" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R-dock-unify" }),
				" (2026-06-23, ",
				createVNode($$PrLink, { pr: 1541 }),
				") — Dock joins the shared ",
				createVNode(_components.code, { children: "agentProjection" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "codex late-detection fixed" }),
				" (2026-06-24, ",
				createVNode($$PrLink, { pr: 1559 }),
				") — the kaval pty-host retains ",
				createVNode(_components.code, { children: "lastCommand" }),
				" and replays ",
				createVNode(_components.code, { children: "commandRun" }),
				" snapshot-first, so a late/restarted sensor detects command-only agents."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R-pulamweb-1/2/3" }),
				" (2026-06-22 → 23) — pulam-web shipped: the reactive stream consumer (drishti #72), the framework (",
				createVNode($$PrLink, { pr: 1524 }),
				"), and the agent dashboard (",
				createVNode($$PrLink, { pr: 1535 }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R7" }),
				" (2026-06-21, ",
				createVNode($$PrLink, { pr: 1505 }),
				") — ",
				createVNode(_components.code, { children: "mirrorRemoteSurface" }),
				" total dual."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R6" }),
				" (2026-06-21, ",
				createVNode($$PrLink, { pr: 1506 }),
				") — ",
				createVNode(_components.code, { children: "@kolu/terminal-workspace" }),
				": one fs/git impl, two homes."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R1–R4" }),
				" (2026-05-26 → 06-21) — the ",
				createVNode(_components.code, { children: "TerminalEndpoint" }),
				" seam, ",
				createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
				", the shared sensor engine, the pty-daemon multi-client survivor, and the arivu→pulam rename."
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
	"title": "Remote terminals over SSH",
	"description": "The portal for kolu#951 — remote terminals over SSH. This is the root of the whole plan tree — every inner note (the padi plan of record, the surface consolidation plan, the framework primers, the shipped branches' build logs, the design records, the future menu) is reachable from the map here. Status — R1–R8 shipped; the R9/R10 leg was re-architected from the ground up as padi (one workspace daemon per host owns the complete terminal state; the canvas single-host per view), and on the padi side W0–W4 and W6–W8 are shipped — kolu on master runs the multi-host switch today, with an honest connect overlay — with W5 (cross-host attention) next and the surface consolidation running in parallel. The superseded pre-padi R9/R10 decomposition (the finale) is recorded in a section here.",
	"parents": ["feature"],
	"status": "accepted",
	"maturity": "budding",
	"updated": "2026-07-10T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-map--navigating-this-tree",
			"text": "The map — navigating this tree"
		},
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
			"slug": "r5--overflow-recovery-loop",
			"text": "R5 — overflow-recovery loop"
		},
		{
			"depth": 3,
			"slug": "r-dock-unify--kolus-dock-reads-the-shared-agentprojection",
			"text": "R-dock-unify — kolu’s Dock reads the shared agentProjection"
		},
		{
			"depth": 3,
			"slug": "r-pip-unify--one-status-pip-across-the-web-surfaces",
			"text": "R-pip-unify — one status pip across the web surfaces"
		},
		{
			"depth": 3,
			"slug": "r-activity-merge--merge-the-activity-dot-into-the-state-pip",
			"text": "R-activity-merge — merge the activity dot into the state pip"
		},
		{
			"depth": 3,
			"slug": "r6--koluterminal-workspace-one-library-one-fsgit-impl-two-homes",
			"text": "R6 — @kolu/terminal-workspace: one library, one fs/git impl, two homes"
		},
		{
			"depth": 3,
			"slug": "r7--mirrorremotesurface-is-now-a-total-dual--shipped-",
			"text": "R7 — mirrorRemoteSurface is now a total dual — shipped "
		},
		{
			"depth": 3,
			"slug": "r8--kolu-serves-awareness-raw-the-client-joins-it--shipped-",
			"text": "R8 — kolu serves awareness raw; the client joins it — shipped "
		},
		{
			"depth": 3,
			"slug": "r9r10--kolu-dials-remotes-then-the-canvas",
			"text": "R9–R10 — kolu dials remotes, then the canvas"
		},
		{
			"depth": 3,
			"slug": "the-finale-record-r9-converged--r10--superseded",
			"text": "The finale record (R9 converged · R10) — superseded"
		},
		{
			"depth": 2,
			"slug": "history",
			"text": "History"
		}
	];
}
var url = "src/content/atlas/remote-terminals.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/remote-terminals.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/remote-terminals.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, HostPill, PAL, PT, RemoteCanvas, Tile, file, frontmatter, getHeadings, url };
