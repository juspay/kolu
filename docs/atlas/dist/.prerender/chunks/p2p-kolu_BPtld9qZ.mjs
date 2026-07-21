import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Issue } from "./Issue_mLFqCJSR.mjs";
import { t as $$PhaseTree } from "./PhaseTree_DI8OxotU.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
//#region src/diagrams/p2p-kolu-tunnel.svg?raw
var p2p_kolu_tunnel_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 960 560\" font-family=\"ui-monospace, SFMono-Regular, Menlo, monospace\" font-size=\"12\">\n  <defs>\n    <marker id=\"parr\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M 0 1 L 9 5 L 0 9 z\" fill=\"#8b94a6\"/>\n    </marker>\n  </defs>\n  <rect width=\"960\" height=\"560\" fill=\"#0f1117\"/>\n\n  <!-- browser -->\n  <rect x=\"290\" y=\"16\" width=\"380\" height=\"58\" rx=\"8\" fill=\"#151823\" stroke=\"#2a3145\"/>\n  <text x=\"306\" y=\"38\" fill=\"#c8d0de\" font-size=\"13\" font-weight=\"600\">browser PWA — L's origin, L's bundle</text>\n  <text x=\"306\" y=\"58\" fill=\"#8b94a6\">per-view binding: ws ?host=R · /host/R/api/…</text>\n\n  <line x1=\"480\" y1=\"74\" x2=\"480\" y2=\"118\" stroke=\"#8b94a6\" stroke-width=\"1.4\" marker-end=\"url(#parr)\"/>\n\n  <!-- L -->\n  <rect x=\"220\" y=\"122\" width=\"520\" height=\"86\" rx=\"10\" fill=\"#131722\" stroke=\"#56b6c2\" stroke-width=\"1.2\"/>\n  <text x=\"240\" y=\"146\" fill=\"#56b6c2\" font-size=\"13\" font-weight=\"700\">local kolu L — full kolu + the gateway</text>\n  <text x=\"240\" y=\"166\" fill=\"#c8d0de\">splices bytes, content-blind: ws + /host/R/api prefix-strip</text>\n  <text x=\"240\" y=\"186\" fill=\"#8b94a6\">serves its own terminals exactly as today · badge taps per pooled host</text>\n\n  <line x1=\"480\" y1=\"208\" x2=\"480\" y2=\"258\" stroke=\"#a78bfa\" stroke-width=\"1.4\" marker-end=\"url(#parr)\"/>\n  <text x=\"496\" y=\"228\" fill=\"#a78bfa\">ssh streamlocal -L · rides the existing ControlMaster</text>\n  <text x=\"496\" y=\"246\" fill=\"#7ec699\">provisioned with L's OWN closure → same build, always</text>\n\n  <!-- R -->\n  <rect x=\"220\" y=\"262\" width=\"520\" height=\"104\" rx=\"10\" fill=\"#151823\" stroke=\"#7ec699\" stroke-width=\"1.2\"/>\n  <text x=\"240\" y=\"286\" fill=\"#7ec699\" font-size=\"13\" font-weight=\"700\">remote kolu R — the SAME full kolu, headless daemon</text>\n  <text x=\"240\" y=\"306\" fill=\"#c8d0de\">0700 unix socket · pid-gate · state-root-digest identity</text>\n  <text x=\"240\" y=\"326\" fill=\"#c8d0de\">its own fold · clock · session store — today's kolu, running there</text>\n  <text x=\"240\" y=\"348\" fill=\"#8b94a6\">restartable: exact-match version, skew ⇒ drain + re-provision</text>\n\n  <line x1=\"480\" y1=\"366\" x2=\"480\" y2=\"404\" stroke=\"#8b94a6\" stroke-width=\"1.4\" marker-end=\"url(#parr)\"/>\n  <text x=\"496\" y=\"390\" fill=\"#8b94a6\">unix socket (today's path)</text>\n\n  <!-- kaval -->\n  <rect x=\"220\" y=\"408\" width=\"520\" height=\"56\" rx=\"8\" fill=\"#151823\" stroke=\"#2a3145\"/>\n  <text x=\"240\" y=\"430\" fill=\"#c8d0de\" font-weight=\"600\">R's kaval — PTY survivor (unchanged)</text>\n  <text x=\"240\" y=\"450\" fill=\"#8b94a6\">terminals outlive kolu restarts, upgrades, ssh blips</text>\n\n  <!-- side note -->\n  <text x=\"480\" y=\"500\" fill=\"#56b6c2\" text-anchor=\"middle\">one logical stream browser ↔ R: any drop = a ws drop the client's existing retry heals</text>\n  <text x=\"480\" y=\"522\" fill=\"#5b6678\" text-anchor=\"middle\">never exists: padi · padiSurface · pulam · mirror/forwarding machinery · any public contract</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/p2p-kolu.mdx
var KT = [
	{
		d: 0,
		g: "○",
		c: "prog",
		l: "K1 · identity & the daemon — boot-split gate · source-digest build-id · unix socket · dual-path adopt",
		m: "local no-op but the namespace re-key",
		h: "#k1"
	},
	{
		d: 0,
		g: "○",
		c: "prog",
		l: "K2 · the dial — provision with L's OWN closure · control-front handshake · streamlocal forward · drain",
		m: "zero UI · pu-box e2e",
		h: "#k2"
	},
	{
		d: 0,
		g: "○",
		c: "prog",
		l: "K3 · the switch — home/binding wire split · gateway splice · instant in-app switch · host picker",
		m: "the user-visible feature",
		h: "#k3"
	},
	{
		d: 0,
		g: "○",
		c: "last",
		l: "K4 · attention — home-wire taps · aggregate sole notifier · deep-link",
		m: "no contract change",
		h: "#k4"
	}
];
var PAL = {
	txt: "#c8d0de",
	sub: "#8b94a6",
	dim: "#5b6678",
	green: "#7ec699",
	amber: "#e6a23c",
	cyan: "#56b6c2"
};
var Meter = ({ n, s = 11 }) => createVNode("span", {
	style: `display:inline-flex;gap:2px;vertical-align:middle`,
	title: `${n}/5`,
	children: [
		1,
		2,
		3,
		4,
		5
	].map((i) => createVNode("span", { style: `width:${s}px;height:${s + 2}px;border-radius:2px;${i <= n ? `background:${PAL.amber}` : "background:transparent;border:1px solid #2a3145"}` }))
});
var LENS = [
	{
		p: "K1",
		h: "#k1",
		user: "nothing",
		vis: false,
		work: 3,
		why: "boot-split · source-digest identity · unix listen · dual-path adopt",
		beh: "kaval's socket moves (kaval-<port> → kaval-<digest>) but the OLD daemon's live PTYs are adopted across the rename, not orphaned; a kolu pid-gate refuses a double-launch that today silently clobbers state.json"
	},
	{
		p: "K2",
		h: "#k2",
		user: "nothing",
		vis: false,
		work: 3,
		why: "one ssh forward shape · a control front · a third drv map · drain",
		beh: "a dialed host gains a gate-held kolu daemon + your closure in its store — config-gated, inert unless dialed; pre-K1 hosts and missing linger are refused loudly, never spawned beside"
	},
	{
		p: "K3",
		h: "#k3",
		user: "everything — host switcher · instant switch · remote canvas as a full peer",
		vis: true,
		work: 5,
		why: "home/binding wire split + binding-generation singletons + the verified-before-splice gateway; the heaviest phase",
		beh: "the app keeps a permanent home socket to L plus a per-view binding; switching swaps the binding in-app (no reload); a remote outage degrades only that view, never the app"
	},
	{
		p: "K4",
		h: "#k4",
		user: "cross-host badges · notification deep-link",
		vis: true,
		work: 2,
		why: "taps over the home wire · aggregate is the sole notifier",
		beh: "notifications fire for hosts you are not looking at; L keeps one light tap per pooled host, stamped on L's clock"
	}
];
var PhaseLens = () => createVNode("div", {
	style: "font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;background:#0f1117;border:1px solid #05070b;border-radius:11px;padding:1rem 1.3rem;margin:1.4rem 0;width:min(60rem,94vw);position:relative;left:50%;transform:translateX(-50%);box-sizing:border-box",
	children: [
		createVNode("div", {
			style: `display:flex;justify-content:space-between;color:${PAL.dim};font-size:.8em;padding-bottom:.6rem;border-bottom:1px solid #1c2231`,
			children: [createVNode("span", { children: [
				"phase · ",
				createVNode("span", {
					style: `color:${PAL.green}`,
					children: "◉ user sees"
				}),
				" · ",
				createVNode("span", {
					style: `color:${PAL.cyan}`,
					children: "Δ behaviour"
				})
			] }), createVNode("span", { children: [
				"architectural rework: ",
				createVNode(Meter, {
					n: 3,
					s: 7
				}),
				" = 3/5"
			] })]
		}),
		LENS.map((r) => createVNode("div", {
			style: "display:grid;grid-template-columns:5ch 1fr;column-gap:1ch;padding:.75rem 0;border-bottom:1px solid #141926",
			children: [createVNode("a", {
				href: r.h,
				style: `color:${PAL.cyan};text-decoration:none;font-weight:700;font-size:1.08em`,
				children: r.p
			}), createVNode("div", {
				style: "display:flex;flex-direction:column;gap:.4rem;min-width:0",
				children: [
					createVNode("span", {
						style: `color:${r.vis ? PAL.green : PAL.dim}`,
						children: [r.vis ? "◉ " : "○ ", r.user]
					}),
					createVNode("span", {
						style: `color:${PAL.txt};font-size:.95em`,
						children: [createVNode("span", {
							style: `color:${PAL.cyan};font-weight:700`,
							children: "Δ "
						}), r.beh]
					}),
					createVNode("span", {
						style: "display:flex;align-items:center;gap:1.2ch;flex-wrap:wrap",
						children: [createVNode(Meter, {
							n: r.work,
							s: 11
						}), createVNode("span", {
							style: `color:${PAL.sub};font-size:.95em`,
							children: r.why
						})]
					})
				]
			})]
		})),
		createVNode("div", {
			style: `color:${PAL.dim};font-size:.8em;padding-top:.6rem`,
			children: [
				"◉ user-visible · ○ invisible · ",
				createVNode("span", {
					style: `color:${PAL.cyan}`,
					children: "Δ"
				}),
				" runtime-behaviour change. The shape: K1–K2 are invisible but each carries a real Δ (the namespace re-key; a new daemon on dialed hosts); the user-loud phase (K3) is the heaviest, because instant switch + the home/binding wire split are genuine client rework, not padi-style server rework."
			]
		})
	]
});
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
		section: "section",
		strong: "strong",
		sup: "sup",
		table: "table",
		tbody: "tbody",
		td: "td",
		th: "th",
		thead: "thead",
		tr: "tr",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		"\n",
		createVNode($$Callout, {
			kind: "warning",
			title: "Status: one alternative among four — NOT decided",
			children: createVNode(_components.p, { children: [
				"This note is an ",
				createVNode(_components.strong, { children: "exploration artifact, not a plan of record" }),
				". Four architectures are under consideration for ",
				createVNode($$Issue, { n: 951 }),
				"’s remaining leg: ",
				createVNode(_components.strong, { children: createVNode(_components.a, {
					href: "padi.html",
					children: "padi"
				}) }),
				" (the current plan of record on PR #1649, whose W1 build is in flight), ",
				createVNode(_components.strong, { children: "P2P kolu" }),
				" (this note), ",
				createVNode(_components.strong, { children: "thin-host" }),
				" (kaval grows domain-agnostic exec/fs primitives; the brain stays local), and the ",
				createVNode(_components.strong, { children: "original pulam plan" }),
				" (master’s shipped direction). This note is written to a build-ready bar so the comparison is fair — not because it won. A decision supersedes; none has been made."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The bet: the kolu monolith is not a problem to fix before going remote — it is the unit of deployment." }),
			" The ",
			createVNode(_components.a, {
				href: "padi.html",
				children: "padi plan"
			}),
			" splits kolu-server into a per-host daemon plus a thin web shell. P2P kolu keeps the fusion and changes the ",
			createVNode(_components.em, { children: "quantifier" }),
			": ",
			createVNode(_components.strong, { children: "every host runs the whole kolu" }),
			", exactly as every host runs kaval today — Nix-provisioned over ssh, adopt-or-spawn behind a pid-gate, on a 0700 unix socket, freely restartable because the PTYs live in kaval. The local kolu (L) is the one you browse; switching host tunnels your view’s wire to another host’s kolu (R). pulam and padi never exist; no new daemon, package, surface contract, or mirroring machinery. The untangling of kolu-server’s internals doesn’t die — it ",
			createVNode(_components.strong, { children: "decouples" }),
			" (",
			createVNode(_components.a, {
				href: "#monolith",
				children: "below"
			}),
			")."
		] }),
		"\n",
		"\n",
		createVNode($$PhaseTree, {
			title: "ROADMAP — P2P kolu (if adopted, replaces padi W1–W3)",
			phases: KT
		}),
		"\n",
		"\n",
		"\n",
		"\n",
		"\n",
		createVNode(PhaseLens, {}),
		"\n",
		createVNode(_components.h2, {
			id: "user-facing-description",
			children: "User-facing description"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Identical to ",
			createVNode(_components.a, {
				href: "padi.html",
				children: "padi"
			}),
			"’s north star — the product decisions carry over unchanged: ",
			createVNode(_components.strong, { children: "single-host canvas per view" }),
			" with a ChromeBar switcher and an ",
			createVNode(_components.strong, { children: "instant in-app switch" }),
			"; a host’s arrangement ",
			createVNode(_components.strong, { children: "lives on that host" }),
			" (its own kolu’s session store), so every device and peer kolu sees the same canvas; a remote canvas is a ",
			createVNode(_components.strong, { children: "full peer" }),
			" because it ",
			createVNode(_components.em, { children: "is" }),
			" today’s kolu, running there; cross-host attention rides the PWA app badge + chip counts + notification deep-link (the A+ model).",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-personas",
				id: "user-content-fnref-personas",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "1"
			}) }),
			" First connect to a new host: kolu ssh-provisions it with ",
			createVNode(_components.strong, { children: "its own build" }),
			" and the host joins the picker. ",
			createVNode(_components.strong, { children: "Preferences are yours, not the host’s" }),
			" — theme, tips, alert settings always read and write your local kolu, so switching host never flips your shell."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"One honest UX delta vs padi: after a ",
			createVNode(_components.strong, { children: "remote kolu restart" }),
			", metadata re-derives for a few seconds — today’s local semantics, now per host — instead of padi’s warm-store restart. kaval keeps the terminals alive through it."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "architecture-level-changes",
			children: "Architecture-level changes"
		}),
		"\n",
		createVNode($$Svg, {
			svg: p2p_kolu_tunnel_default,
			caption: "The P2P stack. Every host runs the same full kolu; the local one (L) is browsed and acts as a content-blind gateway, splicing each view's websocket + byte routes over an ssh streamlocal forward to the bound host's kolu (R). L provisions R with its own closure and both share a source-fileset build-id, so the client↔server wire stays private forever. R is a gate-held daemon on a 0700 unix socket with realpath'd state-root-digest identity; its kaval survives everything above it. The browser also holds one permanent home socket to L for the pool, attention, and preferences."
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Same-build by provisioning — the load-bearing move." }),
			" Exposing kolu’s oRPC naively would turn its private client↔server wire into a public, versioned, compatibility-managed contract — a permanent tax on every future PR (managing that tax is what padi’s W1 existed for). Instead, make cross-version traffic ",
			createVNode(_components.strong, { children: "unrepresentable" }),
			": L provisions every remote ",
			createVNode(_components.strong, { children: "with L’s own closure" }),
			",",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-closure",
				id: "user-content-fnref-closure",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "2"
			}) }),
			" and the handshake is ",
			createVNode(_components.strong, { children: "exact-match-or-refuse on a source-fileset build-id" }),
			" — not a store path, which differs by architecture and would refuse the Mac→Linux case 100% of the time.",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-buildid",
				id: "user-content-fnref-buildid",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "3"
			}) }),
			" Binding an older R offers one action, ",
			createVNode(_components.em, { children: "re-provision + drain-restart" }),
			" (R persists its session and exits; kaval keeps the PTYs; the new build adopts). No two builds ever speak the wire to each other, so it never needs stability. This is kolu’s existing kaval relationship applied to itself: ",
			createVNode(_components.code, { children: "expectedKaval" }),
			" gains a sibling, ",
			createVNode(_components.code, { children: "expectedKolu" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The gateway is a tunnel, not a mirror." }),
			" L neither mirrors nor understands R’s traffic — it ",
			createVNode(_components.strong, { children: "splices bytes" }),
			". The browser↔R stream is one logical stream end-to-end, so padi’s whole per-member forwarding-policy problem dissolves: any drop is a websocket drop the client’s existing retry + snapshot-first attach already heals, and the R5 overflow frame (",
			createVNode($$PrLink, { pr: 1591 }),
			") rides through untouched. But content-blind is not policy-free — the review surfaced three things the splice ",
			createVNode(_components.em, { children: "must" }),
			" enforce, or the architecture’s own invariant breaks:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Verified-before-splice." }),
				" The splice must refuse to connect unless the binding is ",
				createVNode(_components.code, { children: "connected" }),
				" ",
				createVNode(_components.strong, { children: "and" }),
				" version-",
				createVNode(_components.code, { children: "verified" }),
				" — otherwise a browser’s retrying socket can land on R ",
				createVNode(_components.em, { children: "before" }),
				" L’s handshake has compared build-ids, and a skewed R speaks the private wire after all.",
				createVNode(_components.sup, { children: createVNode(_components.a, {
					href: "#user-content-fn-verified",
					id: "user-content-fnref-verified",
					"data-footnote-ref": true,
					"aria-describedby": "footnote-label",
					children: "4"
				}) })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Own-origin gate + strip Origin." }),
				" L runs its ",
				createVNode(_components.em, { children: "own" }),
				" ",
				createVNode(_components.code, { children: "gateWsOrigin" }),
				"/",
				createVNode(_components.code, { children: "gateHttpRpcOrigin" }),
				" on every ",
				createVNode(_components.code, { children: "/host/*" }),
				" route before splicing (else a malicious page drives ",
				createVNode(_components.code, { children: "terminal.create" }),
				" on R — code exec), and forwards a fresh upgrade request with ",
				createVNode(_components.strong, { children: "Origin stripped" }),
				" so R needs no allowlist and ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				" stays untouched. No AF_UNIX-trust arm on R.",
				createVNode(_components.sup, { children: createVNode(_components.a, {
					href: "#user-content-fn-security",
					id: "user-content-fnref-security",
					"data-footnote-ref": true,
					"aria-describedby": "footnote-label",
					children: "5"
				}) })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Per-binding lifecycle." }),
				" A remote binding’s outage must degrade ",
				createVNode(_components.em, { children: "that view only" }),
				" — today’s rescue UI is an app-global full-viewport overlay + ",
				createVNode(_components.code, { children: "location.reload()" }),
				", which a routine remote drain would fire across the whole app.",
				createVNode(_components.sup, { children: createVNode(_components.a, {
					href: "#user-content-fn-lifecycle",
					id: "user-content-fnref-lifecycle",
					"data-footnote-ref": true,
					"aria-describedby": "footnote-label",
					children: "6"
				}) })
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Two enabling facts are audited: unix-socket listening is mechanical (with a stale-inode hygiene fix),",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-unixsock",
				id: "user-content-fnref-unixsock",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "7"
			}) }),
			" and the ssh side needs one new argv shape — a ",
			createVNode(_components.strong, { children: "control front" }),
			" (",
			createVNode(_components.code, { children: "kolu --stdio" }),
			") that returns R’s live socket path + build-id, then an openssh ",
			createVNode(_components.strong, { children: ["streamlocal ", createVNode(_components.code, { children: "-L" })] }),
			" forward to that path riding the existing ControlMaster.",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-dial",
				id: "user-content-fnref-dial",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "8"
			}) })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Identity — grounded, and harder than the sketch claimed." }),
			" Instance = ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "sha256(realpath(state-root))" }) }),
			" truncated — realpath’d because a raw env string spells one directory many ways (symlinked ",
			createVNode(_components.code, { children: "/home" }),
			", trailing slash, ",
			createVNode(_components.code, { children: "$XDG_CONFIG_HOME" }),
			" set vs defaulted) and would mint two gates for one root, reopening the clobber the key exists to close.",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-identity",
				id: "user-content-fnref-identity",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "9"
			}) }),
			" The gate must run in a ",
			createVNode(_components.strong, { children: "boot-split entry module" }),
			" — a ~30-line leaf that acquires the pid-gate ",
			createVNode(_components.em, { children: "before" }),
			" dynamically importing the body, because ",
			createVNode(_components.code, { children: "state.ts" }),
			"’s module constructs ",
			createVNode(_components.code, { children: "Conf" }),
			" and runs the migration ladder at import time, so a naive top-level gate fires after state.json is already migrated-and-written.",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-bootsplit",
				id: "user-content-fnref-bootsplit",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "10"
			}) }),
			" And the ",
			createVNode(_components.code, { children: "kaval-<port>" }),
			" → ",
			createVNode(_components.code, { children: "kaval-<digest>" }),
			" rename must ",
			createVNode(_components.strong, { children: "adopt the old daemon’s live PTYs, not orphan them" }),
			" — a dual-path adopt-candidate list, else a production upgrade leaks every running agent and the restore card duplicates them.",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-migration",
				id: "user-content-fnref-migration",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "11"
			}) })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "What stays exactly as today — the point." }),
			" The awareness architecture (S1/S2 as shipped, one fold on the host’s own clock), the reader-join, the registry, the client-driven restore loop (running against whichever kolu the view is bound to), Code tab, byte routes, sleep/wake, transcript loaders (SQLite and all — they run in R’s kolu), worktrees, MRU — ",
			createVNode(_components.strong, { children: "all untouched" }),
			", because the whole app runs where the terminals are. One writer per host, on its own clock, guarantees at the knowing endpoint; cross-host clock comparison stays unrepresentable.",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-clock",
				id: "user-content-fnref-clock",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "12"
			}) })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The client’s share is the real work of this design." }),
			" The browser keeps ",
			createVNode(_components.strong, { children: "one permanent home socket to L" }),
			" — the pool list, the cross-host attention aggregate, and ",
			createVNode(_components.strong, { children: "all preferences" }),
			" (they are user-state; a bound host’s preferences cell is simply never consulted)",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-prefs",
				id: "user-content-fnref-prefs",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "13"
			}) }),
			" — ",
			createVNode(_components.em, { children: "plus" }),
			" a per-view ",
			createVNode(_components.strong, { children: "binding socket" }),
			" to the bound host; K4 has no other transport when a view is parked remotely.",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-homewire",
				id: "user-content-fnref-homewire",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "14"
			}) }),
			" The binding rides a ",
			createVNode(_components.code, { children: "?host=<id>" }),
			" URL param (reload-safe, deep-linkable, per-tab), and ",
			createVNode(_components.strong, { children: "switching is instant and in-app" }),
			": the wire and its dependent singletons become binding-generation factories with real disposal — a fresh ",
			createVNode(_components.code, { children: "connectSurfaces" }),
			" per switch (reusing a socket across hosts trips the stale-tab pid gate), in-flight coalesced calls drained or rejected against the old generation, the app remounting keyed on the binding.",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-switch",
				id: "user-content-fnref-switch",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "15"
			}) }),
			" Byte routes gain a ",
			createVNode(_components.code, { children: "/host/<id>/api/…" }),
			" prefix that the gateway strips; server-minted preview URLs get prefixed client-side; view-state keys namespace per binding through the ",
			createVNode(_components.code, { children: "persistedPref" }),
			" chokepoint.",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-client",
				id: "user-content-fnref-client",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "16"
			}) }),
			" Because there is one app at one origin, no Vite-base, service-worker, PWA-manifest, or localStorage-collision work exists — those costs belong only to the rejected variant.",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-fullproxy",
				id: "user-content-fnref-fullproxy",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "17"
			}) })
		] }),
		"\n",
		createVNode("a", { id: "monolith" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The monolith question — decoupled, not forfeited." }),
			" padi used remote terminals as the ",
			createVNode(_components.em, { children: "forcing function" }),
			" to untangle kolu-server. P2P removes the coupling: no wire depends on any internal split, so the “terminal-workflow volatility hiding in kolu-server” instinct resolves on its own evidence, per the repo’s graduation discipline — extract a ",
			createVNode(_components.code, { children: "@kolu/*" }),
			" package when churn pain or a real second consumer proves the volatility, not because a feature deadline demands it. That can proceed incrementally under P2P, potentially ending at a padi-shaped ",
			createVNode(_components.em, { children: "library" }),
			" with no process split, no public contract, no re-serve machinery. If a genuine second frontend ever materializes, that is the moment a public surface earns its keep — entered with K1’s identity work already banked (it is padi W2.2’s groundwork, shared verbatim)."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "honest-comparison-vs-padi",
			children: "Honest comparison vs padi"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The preferences episode generalizes, and it cuts for padi." }),
			" P2P ships the ",
			createVNode(_components.em, { children: "whole" }),
			" app to a place where only the terminal-domain subset is meaningful — so R serves members a remote-bound client must ",
			createVNode(_components.strong, { children: "know to ignore" }),
			": ",
			createVNode(_components.code, { children: "preferences" }),
			", the ",
			createVNode(_components.code, { children: "hosts" }),
			" pool, ",
			createVNode(_components.code, { children: "hostBindings" }),
			", ",
			createVNode(_components.code, { children: "hostAttention" }),
			" (a spoke has none of these in any meaningful sense). Each exclusion is small, but the list ",
			createVNode(_components.em, { children: "is" }),
			" padi’s boundary re-emerging as client-side convention — padi, being ",
			createVNode(_components.strong, { children: "a subset of kolu-server by construction" }),
			", cannot even express a preferences cell on the host daemon; what P2P handles by discipline (“never consult R’s prefs”), padi makes unspellable by subsetting. That is a real P4-grade point in padi’s favor that this note’s first draft missed."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "axis" }),
					"\n",
					createVNode(_components.th, { children: "padi" }),
					"\n",
					createVNode(_components.th, { children: "P2P kolu" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "new moving parts" }),
					"\n",
					createVNode(_components.td, { children: "padi daemon + padiSurface + forwarding machinery" }),
					"\n",
					createVNode(_components.td, { children: "none — one ssh forward + a gateway splice + a home/binding client split" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "remaining work" }),
					"\n",
					createVNode(_components.td, { children: "W1 (C/M/R) + W2 ×4 + W3 ×3" }),
					"\n",
					createVNode(_components.td, { children: "K1–K4 (client-heavier than the first sketch said — instant switch is real scope — still < padi)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "kolu-server internals" }),
					"\n",
					createVNode(_components.td, { children: "forcibly untangled now (the seam, the seal)" }),
					"\n",
					createVNode(_components.td, { children: [
						"untangled ",
						createVNode(_components.strong, { children: "on their own evidence, later" }),
						" — decoupled from this feature"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "restart warmth" }),
					"\n",
					createVNode(_components.td, { children: "warm metadata across kolu restarts" }),
					"\n",
					createVNode(_components.td, { children: "re-derive on restart (today’s semantics; PTYs survive in kaval)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "public contract for other frontends" }),
					"\n",
					createVNode(_components.td, { children: "padiSurface, designed for it" }),
					"\n",
					createVNode(_components.td, { children: "none — kolu-tui ships in-closure; a public surface waits for a real second consumer" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "preferences" }),
					"\n",
					createVNode(_components.td, { children: "in the web shell" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "on L, always" }), " (the home wire) — user-state never follows a binding"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "out-of-domain members on the remote" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "none by construction" }), " — padiSurface is exactly the terminal-domain subset; a prefs/pool/attention member on the host daemon is unspellable"] }),
					"\n",
					createVNode(_components.td, { children: [
						"the whole koluSurface exists on R; the client must ignore ",
						createVNode(_components.code, { children: "preferences" }),
						" · ",
						createVNode(_components.code, { children: "hosts" }),
						" · ",
						createVNode(_components.code, { children: "hostBindings" }),
						" · ",
						createVNode(_components.code, { children: "hostAttention" }),
						" on a bound remote — padi’s boundary, re-emerging as discipline"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "behaviour cliff" }),
					"\n",
					createVNode(_components.td, { children: "W2’s process split" }),
					"\n",
					createVNode(_components.td, { children: "K1’s namespace re-key + the remote leg — smaller, but real" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "footprint per remote" }),
					"\n",
					createVNode(_components.td, { children: "padi + kaval" }),
					"\n",
					createVNode(_components.td, { children: [
						"full kolu + kaval (an idle node server; the closure already ships today",
						createVNode(_components.sup, { children: createVNode(_components.a, {
							href: "#user-content-fn-closure",
							id: "user-content-fnref-closure-2",
							"data-footnote-ref": true,
							"aria-describedby": "footnote-label",
							children: "2"
						}) }),
						")"
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
		createVNode("a", { id: "k1" }),
		"\n",
		createVNode(_components.h3, {
			id: "k1--identity--the-daemon-local-no-op-at-rest-the-one-δ-is-the-namespace-re-key",
			children: ["K1 — identity & the daemon ", createVNode(_components.em, { children: "(local no-op at rest; the one Δ is the namespace re-key)" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Boot-split entry",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-bootsplit",
				id: "user-content-fnref-bootsplit-2",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "10"
			}) }),
			"; ",
			createVNode(_components.code, { children: "KOLU_BUILD_ID" }),
			" source-digest",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-buildid",
				id: "user-content-fnref-buildid-2",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "3"
			}) }),
			"; realpath’d state-root instance key",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-identity",
				id: "user-content-fnref-identity-2",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "9"
			}) }),
			"; a kolu pid-gate (refuse, never clobber); unix-socket listen via ",
			createVNode(_components.code, { children: "createAdaptorServer().listen({path})" }),
			" with an extracted-and-exported ",
			createVNode(_components.code, { children: "prepareUnixSocketPath" }),
			" hygiene helper",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-unixsock",
				id: "user-content-fnref-unixsock-2",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "7"
			}) }),
			"; a ",
			createVNode(_components.code, { children: "kolu daemon" }),
			" bin mode + a ",
			createVNode(_components.code, { children: "kolu --stdio" }),
			" control front that prints a ",
			createVNode(_components.code, { children: "{socketPath, buildId, version, pid}" }),
			" ready line",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-dial",
				id: "user-content-fnref-dial-2",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "8"
			}) }),
			"; the ",
			createVNode(_components.code, { children: "kaval-tui" }),
			" discovery digest branch + manifest; the dual-path adopt-candidate migration",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-migration",
				id: "user-content-fnref-migration-2",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "11"
			}) }),
			"; per-port dev/e2e state-root keying so a second dev instance isn’t gate-refused.",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-dev",
				id: "user-content-fnref-dev",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "18"
			}) })
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Done:" }), " two kolus with distinct state-roots coexist, gate-refusal on a shared root pinned by test; an upgrade e2e adopts the pre-K1 daemon’s live PTYs across the rename (zero orphans, zero restore-card duplicates); a headless kolu on a unix socket round-trips its full wire; a SIGKILL’d daemon’s stale socket is cleared on next boot (no EADDRINUSE loop); all e2e green."] }),
			"\n"
		] }),
		"\n",
		createVNode("a", { id: "k2" }),
		"\n",
		createVNode(_components.h3, {
			id: "k2--the-dial-zero-ui",
			children: ["K2 — the dial ", createVNode(_components.em, { children: "(zero UI)" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "koluDrvBySystem" }),
			" via the JSON-less-import map (baking the map onto the binary it maps is an eval cycle; remotes are therefore spokes)",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-drvmap",
				id: "user-content-fnref-drvmap",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "19"
			}) }),
			"; provision + adopt-or-spawn a remote kolu ",
			createVNode(_components.strong, { children: "with L’s own closure" }),
			" — but first, ",
			createVNode(_components.strong, { children: "probe-and-refuse" }),
			": a host with a listening pre-K1 kolu (or any un-gated kolu on the target state-root) gets a typed refusal naming the upgrade path — the dial ",
			createVNode(_components.strong, { children: "never spawns beside an existing instance" }),
			"; it adopts gate-held K1+ daemons only",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-prek1",
				id: "user-content-fnref-prek1",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "20"
			}) }),
			"; the control-front handshake (",
			createVNode(_components.code, { children: "info" }),
			" → socket path + build-id) then the streamlocal ",
			createVNode(_components.code, { children: "-L" }),
			" forward to that path, with forward re-establishment on ",
			createVNode(_components.code, { children: "HostSession" }),
			" reconnect and local forward-socket hygiene",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-dial",
				id: "user-content-fnref-dial-3",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "8"
			}) }),
			"; exact-match on ",
			createVNode(_components.code, { children: "KOLU_BUILD_ID" }),
			" or a typed skew refusal with one-action re-provision; ",
			createVNode(_components.strong, { children: "provenance typing" }),
			" — a self-managed ",
			createVNode(_components.code, { children: "kolu.service" }),
			" is never drained (skew against it is a terminal refusal naming R’s own upgrade path), drain applies only to dialer-spawned gate-held daemons and refuses a peer with attached clients unless confirmed",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-drain",
				id: "user-content-fnref-drain",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "21"
			}) }),
			"; drain = SIGTERM→save→exit, wire-free",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-sigterm",
				id: "user-content-fnref-sigterm",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "22"
			}) }),
			"; a ",
			createVNode(_components.strong, { children: "linger check" }),
			" at provision (refuse loudly if absent — else the daemon dies with the ssh login session)",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-linger",
				id: "user-content-fnref-linger",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "23"
			}) }),
			"; and correct failure classification — ",
			createVNode(_components.code, { children: "nix" }),
			"-not-found is a ",
			createVNode(_components.code, { children: "\"remote\"" }),
			" refusal with an actionable message, not silent infinite “network” retry.",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-nixmiss",
				id: "user-content-fnref-nixmiss",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "24"
			}) })
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Done:" }),
				" a pu-box e2e provisions, dials, round-trips the wire, survives an ssh blip and a remote kolu restart (kaval PTYs intact), proves the skew-refuse → re-provision path, proves the pre-K1 probe refusal, and asserts the daemon+kaval outlive logout when linger is on / refuse loudly when off. ",
				createVNode(_components.em, { children: "Only the real ssh leg can satisfy this." })
			] }),
			"\n"
		] }),
		"\n",
		createVNode("a", { id: "k3" }),
		"\n",
		createVNode(_components.h3, {
			id: "k3--the-switch-the-user-visible-feature-instant-in-app-by-decision15",
			children: [
				"K3 — the switch ",
				createVNode(_components.em, { children: "(the user-visible feature; instant in-app, by decision)" }),
				createVNode(_components.sup, { children: createVNode(_components.a, {
					href: "#user-content-fn-switch",
					id: "user-content-fnref-switch-2",
					"data-footnote-ref": true,
					"aria-describedby": "footnote-label",
					children: "15"
				}) })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Client:" }),
			" split ",
			createVNode(_components.code, { children: "wire.ts" }),
			" into a never-rebinding ",
			createVNode(_components.strong, { children: "home wire" }),
			" (L’s origin — pool, attention, ",
			createVNode(_components.strong, { children: "all preferences" }),
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-prefs",
				id: "user-content-fnref-prefs-2",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "13"
			}) }),
			") and a ",
			createVNode(_components.strong, { children: "binding wire" }),
			" built by a ",
			createVNode(_components.code, { children: "createWire(binding)" }),
			" generation factory; ",
			createVNode(_components.code, { children: "createSharedRoot" }),
			" gains a binding-scoped sibling with real disposal; the app remounts keyed on the binding; switching = swap the binding generation in place (",
			createVNode(_components.code, { children: "history.replaceState" }),
			" for the ",
			createVNode(_components.code, { children: "?host=" }),
			" param — no navigation), fresh socket per generation, old generation disposed with in-flight calls drained or rejected; byte-URL prefixing at the audited consumption points; ",
			createVNode(_components.code, { children: "persistedPref" }),
			" app-vs-binding key split; the ChromeBar host picker fed by a one-shot GET to ",
			createVNode(_components.strong, { children: "L’s origin" }),
			" (so it renders during a remote outage) + persisted last-binding; a disconnected-remote card that ",
			createVNode(_components.strong, { children: "names the host and offers “back to local”" }),
			" (works while R is dead)",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-escape",
				id: "user-content-fnref-escape",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "25"
			}) }),
			"; per-binding lifecycle scoping so a remote blip never fires the app-global overlay.",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-lifecycle",
				id: "user-content-fnref-lifecycle-2",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "6"
			}) })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Server (the gateway in L):" }),
			" the verified-before-splice ws + ",
			createVNode(_components.code, { children: "/host/<id>/api/*" }),
			" HTTP splice",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-verified",
				id: "user-content-fnref-verified-2",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "4"
			}) }),
			" — strip-Origin + own-origin gate",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-security",
				id: "user-content-fnref-security-2",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "5"
			}) }),
			", raw-target routing by an opaque hostId slug",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-routing",
				id: "user-content-fnref-routing",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "26"
			}) }),
			", ",
			createVNode(_components.code, { children: "head" }),
			"-buffer + query-string preservation, ECONNRESET tolerance without tripping kolu’s fatal-error policy",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-econnreset",
				id: "user-content-fnref-econnreset",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "27"
			}) }),
			"; a ",
			createVNode(_components.code, { children: "hostBindings" }),
			" koluSurface collection for per-binding status (kolu-owned, no drishti gate)",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-bindings",
				id: "user-content-fnref-bindings",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "28"
			}) }),
			"; the persisted host pool schema + migration + remove-while-bound teardown",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-pool",
				id: "user-content-fnref-pool",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "29"
			}) }),
			"; and the ",
			createVNode(_components.code, { children: "/host" }),
			" dev-proxy route.",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-devproxy",
				id: "user-content-fnref-devproxy",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "30"
			}) })
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Done:" }),
				" the padi parity-checklist e2e, verbatim, against a real ssh host — PTY echo · Code tab · binary preview (incl. range/video) · paste/upload · transcript (all three agents) · sleep/wake · worktrees · restore card after a remote reboot · reload re-dial — plus: the switch completes ",
				createVNode(_components.strong, { children: "without a navigation" }),
				" (asserted), N switches leak no sockets or xterm/WebGL instances (heap-pinned), no cross-binding call survives a switch, a remote outage leaves local views interactive and offers “back to local”, and a second device is undisturbed."
			] }),
			"\n"
		] }),
		"\n",
		createVNode("a", { id: "k4" }),
		"\n",
		createVNode(_components.h3, {
			id: "k4--attention-the-a-bar",
			children: ["K4 — attention ", createVNode(_components.em, { children: "(the A+ bar)" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"L taps each pooled host’s ",
			createVNode(_components.code, { children: "snapshots" }),
			" collection over its forward (a node-side surface-client on the home wire), folds urgency via the shipped ",
			createVNode(_components.code, { children: "agentProjection" }),
			" (recency-free), and stamps ",
			createVNode(_components.code, { children: "observedAt" }),
			" on ",
			createVNode(_components.strong, { children: "L’s own clock" }),
			" into a ",
			createVNode(_components.code, { children: "hostAttention" }),
			" aggregate served on the home wire",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-k4wire",
				id: "user-content-fnref-k4wire",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "31"
			}) }),
			"; the aggregate is the ",
			createVNode(_components.strong, { children: "sole" }),
			" ",
			createVNode(_components.code, { children: "setAppBadge" }),
			" writer and OS-notifier (the per-binding alert layer keeps only in-canvas duties), with ",
			createVNode(_components.code, { children: "tag: hostId:terminalId" }),
			" so banners coalesce across tabs",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-dblalert",
				id: "user-content-fnref-dblalert",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "32"
			}) }),
			"; a re-dial replaces a host’s entries wholesale (no phantom awaiting rows)",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-redial",
				id: "user-content-fnref-redial",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "33"
			}) }),
			"; the tap runs the same build-id handshake and marks ",
			createVNode(_components.code, { children: "skew" }),
			" to the chip rather than mirroring a skewed R",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-k4skew",
				id: "user-content-fnref-k4skew",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "34"
			}) }),
			"; notification click routes to a view already bound to ",
			createVNode(_components.code, { children: "hostId" }),
			" (else rebinds the focused view — instant, since K3) with a pending-focus latch + timeout.",
			createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-deeplink",
				id: "user-content-fnref-deeplink",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "35"
			}) })
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Done:" }), " an awaiting agent on host B fires badge, chip, and notification while every view is parked on A; the click lands focused on the right tile; B unreachable degrades its chip, never the app; a re-dial after an outage shows no phantom rows."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "spikes-before-k1-each--a-day-falsifiable",
			children: ["Spikes before K1 ", createVNode(_components.em, { children: "(each ≤ a day, falsifiable)" })]
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"streamlocal ",
				createVNode(_components.code, { children: "-L" }),
				" over the existing ControlMaster against a headless hono-on-unix-socket — the ws upgrade splices end to end, ",
				createVNode(_components.strong, { children: "with the security checklist" }),
				": strip-Origin, L-side gate, 0700 forward-socket dir, ",
				createVNode(_components.code, { children: "StreamLocalBindUnlink=yes" }),
				", ",
				createVNode(_components.code, { children: "StreamLocalBindMask=0177" }),
				".",
				createVNode(_components.sup, { children: createVNode(_components.a, {
					href: "#user-content-fn-security",
					id: "user-content-fnref-security-3",
					"data-footnote-ref": true,
					"aria-describedby": "footnote-label",
					children: "5"
				}) })
			] }),
			"\n",
			createVNode(_components.li, { children: ["The gateway’s raw-target rewrite against the byte route’s realpath/traversal guard.", createVNode(_components.sup, { children: createVNode(_components.a, {
				href: "#user-content-fn-routing",
				id: "user-content-fnref-routing-2",
				"data-footnote-ref": true,
				"aria-describedby": "footnote-label",
				children: "26"
			}) })] }),
			"\n",
			createVNode(_components.li, { children: [
				"Bandwidth: measure the value-bearing ",
				createVNode(_components.code, { children: "gitStatus" }),
				"/",
				createVNode(_components.code, { children: "gitDiff" }),
				"/",
				createVNode(_components.code, { children: "fsListAll" }),
				" streams under agent-churn over a WAN forward; cheap mitigations in preference order — ",
				createVNode(_components.code, { children: "permessage-deflate" }),
				" on R’s ",
				createVNode(_components.code, { children: "WebSocketServer" }),
				" (helps local too), ",
				createVNode(_components.code, { children: "-o Compression=yes" }),
				" on the forward; the CodeTab pulse+procedure migration is the structural fallback if numbers demand it.",
				createVNode(_components.sup, { children: createVNode(_components.a, {
					href: "#user-content-fn-bandwidth",
					id: "user-content-fnref-bandwidth",
					"data-footnote-ref": true,
					"aria-describedby": "footnote-label",
					children: "36"
				}) })
			] }),
			"\n",
			createVNode(_components.li, { children: "Remote-restart metadata re-derivation timed on a loaded host — the warmth trade, quantified." }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Instant-switch teardown" }),
				": a throwaway branch proving ",
				createVNode(_components.code, { children: "createWire(binding)" }),
				" + disposal on the two riskiest consumers (the attach stream + the terminal store) before K3 commits to the full ~15-module inversion.",
				createVNode(_components.sup, { children: createVNode(_components.a, {
					href: "#user-content-fn-switch",
					id: "user-content-fnref-switch-3",
					"data-footnote-ref": true,
					"aria-describedby": "footnote-label",
					children: "15"
				}) })
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "open-decisions-the-remaining-technical-ones--product-forks-are-settled",
			children: ["Open decisions ", createVNode(_components.em, { children: "(the remaining, technical ones — product forks are settled)" })]
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "decision" }),
					"\n",
					createVNode(_components.th, { children: "default (recommended)" }),
					"\n",
					createVNode(_components.th, { children: "the fork" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Legacy adopt-candidate sunset" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"keep the ",
						createVNode(_components.code, { children: "kaval-<port>" }),
						" adopt candidate ",
						createVNode(_components.strong, { children: "one release" }),
						", then drop"
					] }),
					"\n",
					createVNode(_components.td, { children: "vs. keep indefinitely (permanent dual-namespace surface — the strangler-stall padi warns of)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "K4 attention wire granularity" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"carry a ",
						createVNode(_components.strong, { children: "trimmed per-terminal list" }),
						" (",
						createVNode(_components.code, { children: "{id,state,title,observedAt}" }),
						") — the wire is private + single-clock, so the recency-ban rationale doesn’t apply"
					] }),
					"\n",
					createVNode(_components.td, { children: "vs. counts-only (forfeits the deep-linked banner subject)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Cold-open deep link" }), " (no kolu window)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"take the drishti-gated ",
						createVNode(_components.code, { children: "openWindow(\"/?attend=…\")" }),
						" SW change"
					] }),
					"\n",
					createVNode(_components.td, { children: ["vs. accept today’s target-losing ", createVNode(_components.code, { children: "openWindow(\"/\")" })] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "settled-decisions-2026-07-01-by-the-user",
			children: ["Settled decisions ", createVNode(_components.em, { children: "(2026-07-01, by the user)" })]
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Pre-K1 host with an existing kolu: probe & refuse." }),
				" The dial detects a listening un-gated kolu and refuses with a clear upgrade message; it only ever adopts gate-held K1+ daemons and never spawns beside an existing state-root.",
				createVNode(_components.sup, { children: createVNode(_components.a, {
					href: "#user-content-fn-prek1",
					id: "user-content-fnref-prek1-2",
					"data-footnote-ref": true,
					"aria-describedby": "footnote-label",
					children: "20"
				}) })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Instant in-app switch from day one (no reload stopover)." }),
				" The singleton-generation inversion is accepted scope, de-risked by spike 5.",
				createVNode(_components.sup, { children: createVNode(_components.a, {
					href: "#user-content-fn-switch",
					id: "user-content-fnref-switch-4",
					"data-footnote-ref": true,
					"aria-describedby": "footnote-label",
					children: "15"
				}) })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Preferences are local, period." }),
				" Not split, not seeded, not per-host — user-state rides the home wire; a bound host’s preferences cell is never consulted.",
				createVNode(_components.sup, { children: createVNode(_components.a, {
					href: "#user-content-fn-prefs",
					id: "user-content-fnref-prefs-3",
					"data-footnote-ref": true,
					"aria-describedby": "footnote-label",
					children: "13"
				}) })
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "if-adopted",
			children: "If adopted"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.a, {
				href: "padi.html",
				children: "padi"
			}),
			" W1/W2/W3 are superseded wholesale (its identity section survives as K1’s spec); the in-flight W1 build stops; pulam daemon + pulam-tui retire on the same schedule with the same ",
			createVNode(_components.code, { children: "wait" }),
			" re-homing answer (a ",
			createVNode(_components.code, { children: "kolu wait" }),
			" subcommand). W0’s landed work — the overflow frame, the freeze, the PR closures — stands either way. ",
			createVNode(_components.strong, { children: "Not superseded:" }),
			" kaval, untouched, as ever."
		] }),
		"\n",
		createVNode(_components.section, {
			"data-footnotes": true,
			className: "footnotes",
			children: [
				createVNode(_components.h2, {
					className: "sr-only",
					id: "footnote-label",
					children: "Footnotes"
				}),
				"\n",
				createVNode(_components.ol, { children: [
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-personas",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"Both personas from the padi UX evaluation get the same shape: the ",
								createVNode(_components.strong, { children: "ephemeral pu-box" }),
								" (“add host, work, tear down” — teardown removes the host from the picker as one unit) and the ",
								createVNode(_components.strong, { children: "permanent headless server" }),
								" (“it’s just kolu, reachable from any of your kolus” — a kolu.service on a K1+ build; pre-K1 services are refused, not adopted, per the settled decision). ",
								createVNode(_components.a, {
									href: "#user-content-fnref-personas",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 1",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-closure",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"Audited: ",
								createVNode(_components.code, { children: "parseDrvBySystem" }),
								"/",
								createVNode(_components.code, { children: "provisionAgent" }),
								"/",
								createVNode(_components.code, { children: "buildAgentCommand" }),
								" are already binary-agnostic, and the kaval drv ",
								createVNode(_components.strong, { children: "already pulls the entire kolu workspace derivation onto every remote it provisions" }),
								" — client bundle included (the kaval wrapper references ",
								createVNode(_components.code, { children: "${kolu}" }),
								"). Shipping “all of kolu” is ",
								createVNode(_components.em, { children: "zero marginal closure weight" }),
								"; the drv to ship is ",
								createVNode(_components.code, { children: "koluBin" }),
								" instead of ",
								createVNode(_components.code, { children: "kaval" }),
								", from the same workspace build. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-closure",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 2",
									className: "data-footnote-backref",
									children: "↩"
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-closure-2",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 2-2",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "2" })]
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-buildid",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								createVNode(_components.strong, { children: "Blocking hole, fixed." }),
								" The sketch said the handshake reuses “the whole-build drv hash” — but ",
								createVNode(_components.code, { children: "drvPath" }),
								"/",
								createVNode(_components.code, { children: "outPath" }),
								" are per-system by construction (the flake builds one drv ",
								createVNode(_components.em, { children: "per" }),
								" system precisely because they differ), so any store-path comparison refuses 100% of cross-arch bindings, i.e. the Mac-laptop→Linux-server primary persona. Fix: mint ",
								createVNode(_components.code, { children: "KOLU_BUILD_ID = hashString \"sha256\" \"${src}\"" }),
								" over the content-addressed workspace fileset (includes ",
								createVNode(_components.code, { children: "pnpm-lock.yaml" }),
								"), byte-identical across platforms — exactly how ",
								createVNode(_components.code, { children: "KAVAL_BUILD_ID" }),
								" already solves this (",
								createVNode(_components.code, { children: "default.nix:165-176" }),
								"). ",
								createVNode(_components.code, { children: "--set" }),
								" it on ",
								createVNode(_components.code, { children: "koluBin" }),
								", expose on ",
								createVNode(_components.code, { children: "buildInfo" }),
								", add a ",
								createVNode(_components.code, { children: "koluBuildIdOverride" }),
								" test hook so the skew e2e can build a “newer” kolu. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-buildid",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 3",
									className: "data-footnote-backref",
									children: "↩"
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-buildid-2",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 3-2",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "2" })]
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-verified",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								createVNode(_components.strong, { children: "Major hole, fixed." }),
								" The one load-bearing invariant is “no two builds ever speak the wire.” The splice is content-blind and enforces nothing, so a browser’s already-retrying PartySocket can land an upgrade on L ",
								createVNode(_components.em, { children: "before" }),
								" L’s handshake client has read R’s ",
								createVNode(_components.code, { children: "buildInfo" }),
								" — and a skewed R speaks the private oRPC wire, surfacing as per-cell Zod errors (or silently half-working on additive drift), the exact “managed contract” failure the design exists to make unrepresentable. Fix: the binding registry carries a tri-state verdict (",
								createVNode(_components.code, { children: "unverified" }),
								" → ",
								createVNode(_components.code, { children: "verified | skew" }),
								"), set only by L’s handshake; both splices consult ",
								createVNode(_components.code, { children: "state === \"connected\" && verdict === \"verified\"" }),
								" and otherwise refuse with distinct codes (",
								createVNode(_components.code, { children: "503" }),
								" connecting/degraded, ",
								createVNode(_components.code, { children: "409" }),
								" skew) so the e2e can pin them; re-provision resets the verdict to ",
								createVNode(_components.code, { children: "unverified" }),
								" before the drain RPC. The client reads the ",
								createVNode(_components.em, { children: "why" }),
								" from the ",
								createVNode(_components.code, { children: "hostBindings" }),
								" collection on the home wire, not the refusal bytes. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-verified",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 4",
									className: "data-footnote-backref",
									children: "↩"
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-verified-2",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 4-2",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "2" })]
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-security",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								createVNode(_components.strong, { children: "Major hole, fixed." }),
								" The forwarded unix socket carries L’s spliced ",
								createVNode(_components.em, { children: "browser" }),
								" traffic, so an AF_UNIX-trust arm on R would let a malicious page (",
								createVNode(_components.code, { children: "ws://L/host/R/rpc/ws" }),
								") reach R as a trusted peer = ",
								createVNode(_components.code, { children: "terminal.create" }),
								"+",
								createVNode(_components.code, { children: "sendInput" }),
								" = code exec on R. Fixes, all pinned into spike 1: (1) ",
								createVNode(_components.strong, { children: "no" }),
								" AF_UNIX-trust arm — L forwards a fresh upgrade with ",
								createVNode(_components.code, { children: "Origin" }),
								" stripped and a constant ",
								createVNode(_components.code, { children: "Host" }),
								", so R’s existing header gate needs no change and ",
								createVNode(_components.code, { children: "@kolu/surface" }),
								" is untouched (no drishti PR); (2) L runs its own ",
								createVNode(_components.code, { children: "gateWsOrigin" }),
								"/",
								createVNode(_components.code, { children: "gateHttpRpcOrigin" }),
								" on all ",
								createVNode(_components.code, { children: "/host/*" }),
								" routes before splicing (a baked per-provision allowlist goes stale the moment the user opens L by a different name — localhost vs LAN vs tailscale — so L uses its own multi-origin allowlist, the ",
								createVNode(_components.code, { children: "KOLU_ALLOWED_ORIGINS" }),
								" mechanism that already exists); (3) forward sockets live under a 0700 ",
								createVNode(_components.code, { children: "getRuntimeSocketPath" }),
								" namespace with ",
								createVNode(_components.code, { children: "-o StreamLocalBindUnlink=yes -o StreamLocalBindMask=0177" }),
								". ",
								createVNode(_components.a, {
									href: "#user-content-fnref-security",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 5",
									className: "data-footnote-backref",
									children: "↩"
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-security-2",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 5-2",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "2" })]
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-security-3",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 5-3",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "3" })]
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-lifecycle",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								createVNode(_components.strong, { children: "Major hole, fixed." }),
								" ",
								createVNode(_components.code, { children: "TransportOverlay" }),
								" is a fixed ",
								createVNode(_components.code, { children: "inset-0" }),
								" dim over the whole app driven by the single ",
								createVNode(_components.code, { children: "useSurfaceApp" }),
								" lifecycle, and “restarted”/stale ⇒ a ",
								createVNode(_components.code, { children: "location.reload()" }),
								" card. K2 makes remote drain-restart a ",
								createVNode(_components.em, { children: "routine" }),
								" flow, so a bound host’s blip would dim the entire app (healthy chips/badges included) and prompt an “App updated” reload for a remote drain where L’s bundle is fine. Fix: scope lifecycle per binding — the local binding keeps the full-viewport overlay; a remote binding’s down/restart renders a canvas-scoped degraded card (reconnect/re-dial/skew actions) and never ",
								createVNode(_components.code, { children: "location.reload()" }),
								". The K3 e2e asserts a remote outage leaves local views interactive. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-lifecycle",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 6",
									className: "data-footnote-backref",
									children: "↩"
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-lifecycle-2",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 6-2",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "2" })]
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-unixsock",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								createVNode(_components.strong, { children: "Major hole, fixed." }),
								" ",
								createVNode(_components.code, { children: "createAdaptorServer" }),
								" + ",
								createVNode(_components.code, { children: ".listen({ path })" }),
								" is the mechanical listen (the ws upgrade is plain ",
								createVNode(_components.code, { children: "server.on(\"upgrade\")" }),
								", transport-agnostic). But ",
								createVNode(_components.code, { children: "serveOverUnixSocket" }),
								" serves a ",
								createVNode(_components.em, { children: "different" }),
								" wire (base64-framed oRPC) and can’t carry hono+ws, so the daemon binds a raw node server — and a SIGKILL’d/OOM’d daemon leaves a stale socket inode → ",
								createVNode(_components.code, { children: "listen" }),
								" fails ",
								createVNode(_components.code, { children: "EADDRINUSE" }),
								" forever → crash-loop under any restart-on-failure supervisor. The privacy/probe/stale-clear logic (",
								createVNode(_components.code, { children: "isPrivateOwnedDir" }),
								", ",
								createVNode(_components.code, { children: "probeSocket" }),
								", ",
								createVNode(_components.code, { children: "classifyInode" }),
								") is module-private in ",
								createVNode(_components.code, { children: "packages/surface/src/unix-socket.ts" }),
								"; extract + export a ",
								createVNode(_components.code, { children: "prepareUnixSocketPath(path)" }),
								" used by both serve paths, and register socket unlink in ",
								createVNode(_components.code, { children: "shutdownCleanup" }),
								". This ",
								createVNode(_components.em, { children: "is" }),
								" an API-facing ",
								createVNode(_components.code, { children: "@kolu/surface" }),
								" change ⇒ the one drishti-gated piece of the whole design. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-unixsock",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 7",
									className: "data-footnote-backref",
									children: "↩"
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-unixsock-2",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 7-2",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "2" })]
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-dial",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"The dial is a two-step the sketch collapsed: ",
								createVNode(_components.code, { children: "frontDaemonOverStdio" }),
								" couples adopt-or-spawn ",
								createVNode(_components.em, { children: "with" }),
								" a stdio relay, but P2P wants a ",
								createVNode(_components.em, { children: "forward" }),
								" for data. So: (1) ",
								createVNode(_components.code, { children: "HostSession" }),
								" dials a control front (",
								createVNode(_components.code, { children: "kolu --stdio" }),
								") that adopt-or-spawns the gate-held daemon and returns ",
								createVNode(_components.code, { children: "{socketPath, buildId, version, pid}" }),
								" from K1’s rendezvous manifest (L cannot know the remote socket path a priori); (2) verify build-id; (3) spawn the openssh ",
								createVNode(_components.code, { children: "-L" }),
								" forward to that literal remote path, riding the existing ControlMaster; (4) re-run info→forward on every ",
								createVNode(_components.code, { children: "HostSession" }),
								" reconnect (paths change if the runtime dir was wiped). L owns the local forward-socket path (0700, unlinked before every respawn, ENOENT-tolerant). The refuted alternative — a dedicated supervised ",
								createVNode(_components.code, { children: "ssh -N -L" }),
								" child instead of ",
								createVNode(_components.code, { children: "-O forward" }),
								" — was considered; ",
								createVNode(_components.code, { children: "-O forward" }),
								" on the master is the cheaper default given explicit re-establishment on reconnect. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-dial",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 8",
									className: "data-footnote-backref",
									children: "↩"
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-dial-2",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 8-2",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "2" })]
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-dial-3",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 8-3",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "3" })]
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-identity",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								createVNode(_components.strong, { children: "Major hole, fixed." }),
								" Hashing the raw ",
								createVNode(_components.code, { children: "KOLU_STATE_DIR" }),
								" string mints two digests for one directory when it’s spelled differently (symlinked ",
								createVNode(_components.code, { children: "/home" }),
								", trailing slash, ",
								createVNode(_components.code, { children: "$XDG_CONFIG_HOME" }),
								" set vs defaulted) → two gates → both instances run → the last-writer-wins ",
								createVNode(_components.code, { children: "state.json" }),
								" clobber the key exists to kill, now hidden behind an identity that claims to prevent it. Fix: ",
								createVNode(_components.code, { children: "instanceKey = sha256(realpathSync(stateRoot)).slice(0,12)" }),
								" after ",
								createVNode(_components.code, { children: "mkdirSync(recursive)" }),
								"; unit-test the symlinked-parent and trailing-slash cases. ",
								createVNode(_components.code, { children: "kavalNamespace" }),
								" widens from ",
								createVNode(_components.code, { children: "number" }),
								" to a string key; the discovery classifier gains the digest branch + a manifest for honest labels; the digest truncates for the ~104-char ",
								createVNode(_components.code, { children: "sun_path" }),
								" budget. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-identity",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 9",
									className: "data-footnote-backref",
									children: "↩"
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-identity-2",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 9-2",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "2" })]
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-bootsplit",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								createVNode(_components.strong, { children: "Blocking hole, fixed." }),
								" ESM import hoisting: ",
								createVNode(_components.code, { children: "index.ts" }),
								" → ",
								createVNode(_components.code, { children: "session.ts" }),
								" → ",
								createVNode(_components.code, { children: "state.ts" }),
								", whose module body constructs ",
								createVNode(_components.code, { children: "Conf" }),
								", ",
								createVNode(_components.em, { children: "runs the migration ladder, and writes defaults" }),
								" at import time — before any top-level statement where a gate could sit. So a naive gate refuses the loser only ",
								createVNode(_components.em, { children: "after" }),
								" it has already up-migrated the shared ",
								createVNode(_components.code, { children: "state.json" }),
								", corrupting the running instance’s next autosave (a 1.29 session written into a 1.31-stamped file → the next real 1.31 boot skips migrations and Zod-rejects). Fix: keep ",
								createVNode(_components.code, { children: "index.ts" }),
								" as the entry but make it a ~30-line gate leaf — compute ",
								createVNode(_components.code, { children: "instanceKey" }),
								" (imports nothing stateful), ",
								createVNode(_components.code, { children: "acquirePidGate" }),
								", refuse on ",
								createVNode(_components.code, { children: "held" }),
								", ",
								createVNode(_components.em, { children: "then" }),
								" ",
								createVNode(_components.code, { children: "await import(\"./main.ts\")" }),
								" (today’s body). Nothing transitively importing ",
								createVNode(_components.code, { children: "state.ts" }),
								" may be statically imported by the gate module. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-bootsplit",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 10",
									className: "data-footnote-backref",
									children: "↩"
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-bootsplit-2",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 10-2",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "2" })]
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-migration",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								createVNode(_components.strong, { children: "Blocking hole, fixed." }),
								" Prod ",
								createVNode(_components.code, { children: "kolu.service" }),
								" (port 7681) holds N live PTYs in ",
								createVNode(_components.code, { children: "kaval-7681/" }),
								"; the K1 build computes ",
								createVNode(_components.code, { children: "kaval-<digest>" }),
								", ",
								createVNode(_components.code, { children: "adoptOrEnsure" }),
								" probes only that path, finds nothing, spawns fresh — the old daemon survives untouched (survivable spawn is the point) holding N orphaned PTYs no supervisor will adopt or kill, while the restore card re-spawns all N on the fresh daemon (duplicate shells, leaked ",
								createVNode(_components.code, { children: "claude" }),
								" sessions). Fix: grow ",
								createVNode(_components.code, { children: "EndpointSpec" }),
								" (supervisor, ",
								createVNode(_components.em, { children: "not" }),
								" drishti-gated) to ",
								createVNode(_components.code, { children: "{ primary, adoptCandidates?: [...] }" }),
								" with ",
								createVNode(_components.code, { children: "connect(socketPath)" }),
								" parameterized; ",
								createVNode(_components.code, { children: "adoptOrEnsure" }),
								" scans ",
								createVNode(_components.code, { children: "[digest, legacy]" }),
								", binds to whichever answered, but ",
								createVNode(_components.code, { children: "ensure" }),
								"/recycle always spawn at ",
								createVNode(_components.code, { children: "primary" }),
								" — so the first deliberate recycle (skew, restart button, reboot) converges to the digest path under the restore-card semantics that already govern recycles. kolu passes ",
								createVNode(_components.code, { children: "adoptCandidates: [legacy]" }),
								" only in interactive mode; sunset per the open decision. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-migration",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 11",
									className: "data-footnote-backref",
									children: "↩"
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-migration-2",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 11-2",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "2" })]
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-clock",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"One residual: “2m ago” strings compare a host’s stamps against the browser clock — bounded display skew, cosmetic. K4’s aggregate sidesteps it by stamping ",
								createVNode(_components.code, { children: "observedAt" }),
								" on L’s clock (one clock for the whole aggregate). ",
								createVNode(_components.a, {
									href: "#user-content-fnref-clock",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 12",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-prefs",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"Settled: preferences are user-state and live on L, always — the earlier “whose preferences” question was a category error (calling them host state was the smell). The client’s preferences subscription moves to the ",
								createVNode(_components.strong, { children: "home wire" }),
								"; a bound host’s ",
								createVNode(_components.code, { children: "preferences" }),
								" cell is never consulted by remote-bound views; Settings always writes L. Nothing is seeded to remotes. (Host-fs facts — the MRU feed, recentRepos — are ",
								createVNode(_components.em, { children: "not" }),
								" preferences and correctly stay per-host.) ",
								createVNode(_components.a, {
									href: "#user-content-fnref-prefs",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 13",
									className: "data-footnote-backref",
									children: "↩"
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-prefs-2",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 13-2",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "2" })]
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-prefs-3",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 13-3",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "3" })]
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-homewire",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								createVNode(_components.strong, { children: "Major hole, fixed." }),
								" K3 makes the wire binding-scoped and the gateway content-blind to R — but then a view bound to host B speaks ",
								createVNode(_components.em, { children: "only" }),
								" to B, and B has no pool, no aggregate, no cross-host knowledge. L’s pool list, attention aggregate, and reachability are L-side facts with no channel to the client; K4’s “awaiting on B fires while parked on A” silently assumed A=local. Fix: the client always keeps ONE binding-independent ",
								createVNode(_components.strong, { children: "home socket" }),
								" to L’s own origin (pool, ",
								createVNode(_components.code, { children: "hostAttention" }),
								", preferences, dial status) alongside the per-view binding socket. ",
								createVNode(_components.code, { children: "wire.ts" }),
								" splits into ",
								createVNode(_components.code, { children: "homeWire.ts" }),
								" (never rebinds) and the binding-scoped wire (terminals, snapshots, fs/git, attach). K4 imports only the home wire. This is the single biggest structural addition the review forced onto the sketch. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-homewire",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 14",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-switch",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"Settled: instant, no reload stopover. The honest scope (from the implementation scout): ",
								createVNode(_components.code, { children: "wire.ts" }),
								" + ",
								createVNode(_components.code, { children: "rpc.ts" }),
								" + ",
								createVNode(_components.code, { children: "createSharedRoot" }),
								" become binding-generation factories across ~15 modules and ~30 importers; disposal must handle in-flight coalesced writes (drain or reject against the old generation); the app remounts keyed on the binding; and each switch constructs a ",
								createVNode(_components.strong, { children: "fresh" }),
								" ",
								createVNode(_components.code, { children: "connectSurfaces" }),
								" — reusing a socket across hosts trips the stale-tab pid gate (",
								createVNode(_components.code, { children: "ProcessIdEcho" }),
								") and bricks the tab. The ",
								createVNode(_components.code, { children: "?host=<id>" }),
								" param updates via ",
								createVNode(_components.code, { children: "history.replaceState" }),
								" (deep-link + reload-safe without navigation). Spike 5 de-risks the two hardest disposals (attach stream, terminal store) before the full inversion. The K3 e2e pins: no navigation on switch; no socket/xterm/WebGL leak after N switches. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-switch",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 15",
									className: "data-footnote-backref",
									children: "↩"
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-switch-2",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 15-2",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "2" })]
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-switch-3",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 15-3",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "3" })]
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-switch-4",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 15-4",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "4" })]
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-client",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"Audit specifics: the server mints absolute preview/artifact URLs into payloads (",
								createVNode(_components.code, { children: "buildIframePreviewUrl" }),
								") — prefixed client-side at the audited points (",
								createVNode(_components.code, { children: "BrowseFileDispatcher" }),
								", ",
								createVNode(_components.code, { children: "markdownImageSrc" }),
								", the solid-fileview renderers; the artifact-sdk ",
								createVNode(_components.code, { children: "<script>" }),
								" is root-absolute and resolves to L, where the same-build copy at the identical path is the right bytes — pinned by a test, not “rides free” as the sketch loosely said). ",
								createVNode(_components.code, { children: "persistedPref" }),
								" gains an app-vs-binding scope: binding keys get a ",
								createVNode(_components.code, { children: "host/<id>/" }),
								" prefix (canvas-maximized, show-sleeping, reattach-announced, font-size, comments), app keys stay unprefixed (dock-mode, activity-window, picker MRU). ",
								createVNode(_components.a, {
									href: "#user-content-fnref-client",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 16",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-fullproxy",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"The rejected variant — proxy the whole remote app (",
								createVNode(_components.code, { children: "/host/R/" }),
								" serves R’s bundle) — would give maximal version-safety and direct browser access, but the audit priced it out: Vite ",
								createVNode(_components.code, { children: "base" }),
								" + a dozen origin-rooted sites; ",
								createVNode(_components.strong, { children: "PWA identity collapse" }),
								" (",
								createVNode(_components.code, { children: "start_url:\"/\"" }),
								", no ",
								createVNode(_components.code, { children: "scope" }),
								"/",
								createVNode(_components.code, { children: "id" }),
								" — two kolus on one origin alias into one installed app; the notification worker’s ",
								createVNode(_components.code, { children: "clients.claim()" }),
								" cross-claims tabs; ",
								createVNode(_components.code, { children: "openWindow(\"/\")" }),
								" lands on the wrong app — structural changes in shared ",
								createVNode(_components.code, { children: "@kolu/surface-app" }),
								", drishti-gated); origin-scoped localStorage collides across the sibling apps (and the debug “Clear localStorage” wipes both). Same-build-by-provisioning gets the version-safety without any of it; keep this in the back pocket as a later “open this host in its own window” affordance. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-fullproxy",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 17",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-dev",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								createVNode(_components.code, { children: "just dev SERVER_PORT=…" }),
								" and the e2e harness run multiple instances per box; today only the kaval socket is per-port-keyed while ",
								createVNode(_components.code, { children: "KOLU_STATE_DIR" }),
								" is shared, so K1’s gate would refuse the second. Fix: the ",
								createVNode(_components.code, { children: "just dev" }),
								" ",
								createVNode(_components.code, { children: "server" }),
								" recipe exports a per-port ",
								createVNode(_components.code, { children: "KOLU_STATE_DIR" }),
								" beside its per-port kaval dir; the bare ",
								createVNode(_components.code, { children: "just dev" }),
								" default stays ",
								createVNode(_components.code, { children: ".kolu-dev" }),
								" so existing dev state survives. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-dev",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 18",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-drvmap",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"Baking ",
								createVNode(_components.code, { children: "KOLU_AGENT_DRVS_JSON" }),
								" onto ",
								createVNode(_components.code, { children: "koluBin" }),
								" when the map contains ",
								createVNode(_components.code, { children: "koluBin" }),
								"’s own ",
								createVNode(_components.code, { children: "drvPath" }),
								" is a Nix eval cycle. The kaval pattern avoids it with a JSON-less import (",
								createVNode(_components.code, { children: "import ./default.nix {…}" }),
								" without the JSON args), so the drv L ships to R is the map-less wrapper variant — byte-different from L’s own binary at ",
								createVNode(_components.em, { children: "wrapper" }),
								" granularity, which is exactly why identity must be the ",
								createVNode(_components.strong, { children: "source digest" }),
								" (identical across both variants), not a store path. Consequence to state plainly: a provisioned remote has no drv map and so cannot itself dial onward — ",
								createVNode(_components.strong, { children: "remotes are spokes" }),
								" (a remote’s picker shows only itself) until a real need arises. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-drvmap",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 19",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-prek1",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"Settled: ",
								createVNode(_components.strong, { children: "probe & refuse." }),
								" Before any spawn, the control front checks the target state-root: a gate-held K1+ daemon ⇒ adopt; an un-gated (pre-K1) kolu detected listening, or any kolu process owning that state-root without a gate ⇒ typed ",
								createVNode(_components.code, { children: "\"remote\"" }),
								" refusal — “host runs a pre-P2P kolu; upgrade it first” — and the dial never spawns beside it (spawning would recreate the state.json clobber K1’s gate exists to kill, against a process that holds no gate to refuse us). ",
								createVNode(_components.a, {
									href: "#user-content-fnref-prek1",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 20",
									className: "data-footnote-backref",
									children: "↩"
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-prek1-2",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 20-2",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "2" })]
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-drain",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								createVNode(_components.strong, { children: "Major hole, fixed." }),
								" The permanent-server persona means R may be someone’s L — so newest-wins drain has two failure modes: (a) a systemd-pinned kolu, drained, is ",
								createVNode(_components.em, { children: "resurrected at the old build" }),
								" by systemd → L’s fresh spawn and the service fight the gate forever (the “monotonic, no livelock” claim only holds among dialer-spawned daemons); (b) even when it works, R’s own browser user gets an app-wide “Reconnecting…” + metadata re-derivation triggered by a remote peer, no consent. Fix: type the daemon’s provenance — a self-managed kolu (baked ",
								createVNode(_components.code, { children: "KOLU_SELF_MANAGED" }),
								" marker) is ",
								createVNode(_components.strong, { children: "never drained" }),
								"; skew against it is a terminal refusal naming R’s own upgrade path. Drain applies only to dialer-spawned gate-held daemons, and refuses a peer reporting attached clients unless the user confirms. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-drain",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 21",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-sigterm",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"kolu-server today does ",
								createVNode(_components.em, { children: "not" }),
								" save on ",
								createVNode(_components.code, { children: "SIGTERM" }),
								", so “drain = save + exit” is new code and must ride the signal, not the wire: ",
								createVNode(_components.code, { children: "index.ts" }),
								" ",
								createVNode(_components.code, { children: "SIGTERM" }),
								"/",
								createVNode(_components.code, { children: "SIGINT" }),
								"/",
								createVNode(_components.code, { children: "SIGHUP" }),
								" handlers call ",
								createVNode(_components.code, { children: "setSavedSessionFromSnapshot(snapshotSession())" }),
								" (synchronous, cancels the stale timer, preserves-on-empty) before ",
								createVNode(_components.code, { children: "process.exit(0)" }),
								". The control front’s ",
								createVNode(_components.code, { children: "drain" }),
								" verb is wire-free — read the pid from K1’s manifest, ",
								createVNode(_components.code, { children: "kill(pid, SIGTERM)" }),
								", poll gate-release + socket-unbind with a deadline — so it works against any older R by construction (the front runs from L’s new closure). Drain aborts on persist failure with a typed error rather than exit-without-persist. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-sigterm",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 22",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-linger",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								createVNode(_components.strong, { children: "Major hole, fixed." }),
								" ",
								createVNode(_components.code, { children: "reExecAsDetachedDaemon" }),
								" detaches from the ssh session, but on systemd hosts logind removes ",
								createVNode(_components.code, { children: "/run/user/<uid>" }),
								" (the rendezvous dir: socket + gate + manifest) when the last session ends without ",
								createVNode(_components.code, { children: "loginctl enable-linger" }),
								", and with ",
								createVNode(_components.code, { children: "KillUserProcesses=yes" }),
								" (default on several distros) SIGKILLs the daemon — and the ",
								createVNode(_components.code, { children: "systemd-run --user" }),
								" kaval needs a live user manager too, so “kaval keeps the PTYs” breaks on the same axis. Concrete: dial a stock Ubuntu box, create terminals, close the laptop → daemon+kaval gone or orphaned with an unlinked socket. Fix: probe ",
								createVNode(_components.code, { children: "loginctl show-user $USER -p Linger" }),
								" at provision; refuse loudly (typed “remote” failure naming ",
								createVNode(_components.code, { children: "loginctl enable-linger $USER" }),
								") when absent — never silently degrade. Whether kolu auto-runs enable-linger is a product call. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-linger",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 23",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-nixmiss",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								createVNode(_components.strong, { children: "Major hole, fixed." }),
								" ",
								createVNode(_components.code, { children: "resolveSystem" }),
								"’s probe throws a plain Error regardless of exit code, and ",
								createVNode(_components.code, { children: "HostSession.spawn" }),
								" classifies any non-",
								createVNode(_components.code, { children: "ResolveDrvError" }),
								" rejection as ",
								createVNode(_components.code, { children: "\"network\"" }),
								" → retry forever at 60s. ",
								createVNode(_components.code, { children: "ssh host nix-instantiate" }),
								" on a nix-less host exits 127 — a reachable host, permanent condition — yet shows “unreachable, retrying” eternally with no hint to install nix. Fix: kolu’s resolver wraps the probe — ssh exit 255 (transport) → ",
								createVNode(_components.code, { children: "\"network\"" }),
								"; any other non-zero → ",
								createVNode(_components.code, { children: "ResolveDrvError(…\"nix not found/failed on host (exit N) — install Nix or pick a NixOS host\", \"remote\")" }),
								" so it lands in terminal ",
								createVNode(_components.code, { children: "failed" }),
								" with the real message; map-miss likewise throws ",
								createVNode(_components.code, { children: "\"remote\"" }),
								". ",
								createVNode(_components.a, {
									href: "#user-content-fnref-nixmiss",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 24",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-escape",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								createVNode(_components.strong, { children: "Major hole, fixed." }),
								" Bind to a pu-box, tear the box down (the plan’s own persona): the splice drops → the disconnected overlay renders “Reconnecting…” forever without saying ",
								createVNode(_components.em, { children: "which" }),
								" server, and any reload re-reads ",
								createVNode(_components.code, { children: "?host=<dead-id>" }),
								" and lands back on the dead binding. Fix, shipped in K3: the overlay names the bound host; a “Switch host / Back to local” action on the disconnected card (pure client-side, works while R is dead); picker data always fetched from L over plain HTTP so it renders during a remote outage. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-escape",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 25",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-routing",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"The byte route slices the raw ",
								createVNode(_components.code, { children: "IncomingMessage.url" }),
								" (",
								createVNode(_components.code, { children: "rawTargetFromContext" }),
								") before the realpath/traversal guard, so a prefix-stripping gateway must rewrite the raw target consistently or the prefix leaks into the guard. Fix: mint opaque hostId slugs (",
								createVNode(_components.code, { children: "[a-z0-9-]{1,32}" }),
								", stored in conf beside the ssh dest — never the raw dest), and derive both hostId and remainder from ONE ",
								createVNode(_components.code, { children: "splitHostPrefix(rawUrl)" }),
								" helper requiring a literal ",
								createVNode(_components.code, { children: "/host/<slug>/" }),
								". Spike 2 proves it against the ",
								createVNode(_components.code, { children: ".." }),
								"/",
								createVNode(_components.code, { children: "%2f" }),
								"/symlink 403 tests. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-routing",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 26",
									className: "data-footnote-backref",
									children: "↩"
								}),
								" ",
								createVNode(_components.a, {
									href: "#user-content-fnref-routing-2",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 26-2",
									className: "data-footnote-backref",
									children: ["↩", createVNode(_components.sup, { children: "2" })]
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-econnreset",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"kolu-server has a deliberate fatal-error policy, so one ",
								createVNode(_components.code, { children: "ECONNRESET" }),
								" on a spliced socket would crash it. The splice module attaches ",
								createVNode(_components.code, { children: "'error'" }),
								" handlers on both sockets at creation (resets log at debug — routine), cross-destroys on ",
								createVNode(_components.code, { children: "'close'" }),
								"/",
								createVNode(_components.code, { children: "'error'" }),
								", and on ",
								createVNode(_components.code, { children: "net.connect" }),
								" failure writes a plain ",
								createVNode(_components.code, { children: "HTTP/1.1 502" }),
								" + destroy on the browser leg pre-101 (so PartySocket backs off). An integration test kills the upstream mid-frame and asserts the process survives. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-econnreset",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 27",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-bindings",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"Per-binding status has no legal home in ",
								createVNode(_components.code, { children: "DaemonStatusSchema" }),
								". New kolu-owned (no drishti gate) ",
								createVNode(_components.code, { children: "koluSurface" }),
								" collection ",
								createVNode(_components.code, { children: "hostBindings" }),
								" keyed by hostId slug: ",
								createVNode(_components.code, { children: "{ state: enum(connecting|connected|degraded|skew|failed), sshDest, label, lastError, remoteVersion? }" }),
								"; server store + publisher mirroring ",
								createVNode(_components.code, { children: "ptyHost/daemonStatus.ts" }),
								", in a new ",
								createVNode(_components.code, { children: "packages/server/src/gateway/bindings.ts" }),
								". Served on the home wire. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-bindings",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 28",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-pool",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								createVNode(_components.code, { children: "PersistedStateSchema.hosts: array(HostPoolEntry).default([])" }),
								" + a ",
								createVNode(_components.code, { children: "1.31.0" }),
								" migration; a new ",
								createVNode(_components.code, { children: "packages/server/src/hosts.ts" }),
								" (get/add/remove, mirroring ",
								createVNode(_components.code, { children: "preferences.ts" }),
								"). Remove-while-bound is one ordered unit: mark the binding ",
								createVNode(_components.code, { children: "failed" }),
								" (publishes on ",
								createVNode(_components.code, { children: "hostBindings" }),
								"), destroy live splices for that hostId, kill the forward child. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-pool",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 29",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-devproxy",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								createVNode(_components.code, { children: "just dev" }),
								"’s vite proxy has no ",
								createVNode(_components.code, { children: "/host" }),
								" route, so gateway paths would 404 into the SPA fallback under development. Add ",
								createVNode(_components.code, { children: "'/host': { target, ws: true }" }),
								" to the proxy in the same K3 commit; a dev-mode smoke joins the K3 done-criteria. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-devproxy",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 30",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-k4wire",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"The node-side tap is a surface-client over the home wire’s forward to each pooled host (the drishti/pulam-web remote-consumption shape). It reads the existing ",
								createVNode(_components.code, { children: "snapshots" }),
								" collection — no new R-side member — and folds ",
								createVNode(_components.code, { children: "agentProjection" }),
								" urgency (recency-free by type). L stamps ",
								createVNode(_components.code, { children: "observedAt: Date.now()" }),
								" (L’s clock) on each state transition into the ",
								createVNode(_components.code, { children: "hostAttention" }),
								" entry, so the client’s existing ",
								createVNode(_components.code, { children: "isStale" }),
								" ticker gates remote entries exactly as it gates local ones, and cross-host clock comparison stays unrepresentable (the plan’s own rule). The wire carries a trimmed per-terminal list (",
								createVNode(_components.code, { children: "{id,state,title,observedAt}" }),
								") per the open decision, because a deep-linked banner needs a subject. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-k4wire",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 31",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-dblalert",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"A view bound to B runs B’s full wire, so B’s terminals flow through the binding’s ",
								createVNode(_components.code, { children: "useTerminalAlerts" }),
								" AND through L’s tap → ",
								createVNode(_components.code, { children: "hostAttention" }),
								" → the home-wire watcher — one ",
								createVNode(_components.code, { children: "awaiting_user" }),
								" flip ⇒ two banners + a double-counted badge; and ",
								createVNode(_components.code, { children: "showNotification" }),
								" carries no ",
								createVNode(_components.code, { children: "tag" }),
								", so every tab stacks its own. Fix: the aggregate (home wire) is the SOLE ",
								createVNode(_components.code, { children: "setAppBadge" }),
								" writer and OS-notifier; the per-binding layer keeps only in-canvas duties (unread marks, dock, sound for the focused view). “Actively watching” suppression generalizes to: skip notify when the terminal’s host is bound in the focused view AND it is the active tile AND ",
								createVNode(_components.code, { children: "document.hasFocus()" }),
								". Add ",
								createVNode(_components.code, { children: "tag: hostId:terminalId" }),
								" so duplicate banners coalesce across tabs. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-dblalert",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 32",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-redial",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"A tap re-dial after an outage must reconcile removals or terminals killed during the outage leave phantom awaiting rows. Rule (a stated invariant of the ",
								createVNode(_components.code, { children: "hostAttention" }),
								" store): on a dial ",
								createVNode(_components.code, { children: "connecting→connected" }),
								", clear-and-rebuild that host’s entry map before applying the first snapshot; entries are replaced wholesale per (re)connect, kept-but-flagged while unreachable. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-redial",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 33",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-k4skew",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"The tap runs K2’s build-id handshake on every (re)dial before opening the mirror (the ",
								createVNode(_components.code, { children: "firstFrameOrThrow" }),
								" pattern); on mismatch the host’s ",
								createVNode(_components.code, { children: "hostAttention" }),
								" entry gets ",
								createVNode(_components.code, { children: "state: \"skew\"" }),
								" (chip renders the same one-action re-provision affordance K3 shows) and parks until re-provisioned — a skewed R is never silently mirrored into the aggregate. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-k4skew",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 34",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-deeplink",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"Click routing: prefer a view already bound to ",
								createVNode(_components.code, { children: "hostId" }),
								" (focus it), else rebind the focused view (instant, per the settled switch decision); a reactive pending-focus latch stores ",
								createVNode(_components.code, { children: "{hostId, terminalId}" }),
								" and fulfils it when that binding’s terminal list contains the id, with a ~10s timeout degrading to “host focused + toast (terminal no longer running)”. Cold-open (no kolu window) loses the target under today’s ",
								createVNode(_components.code, { children: "openWindow(\"/\")" }),
								"; the recommended fix is the drishti-gated SW change to ",
								createVNode(_components.code, { children: "openWindow(\"/?attend=<hostId>:<terminalId>\")" }),
								" consumed at boot (data must flow via URL — the page can’t receive ",
								createVNode(_components.code, { children: "postMessage" }),
								" before it exists). ",
								createVNode(_components.a, {
									href: "#user-content-fnref-deeplink",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 35",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n",
					createVNode(_components.li, {
						id: "user-content-fn-bandwidth",
						children: [
							"\n",
							createVNode(_components.p, { children: [
								"The adversary flagged: zero bandwidth analysis existed for the value-bearing ",
								createVNode(_components.code, { children: "gitStatus" }),
								"/",
								createVNode(_components.code, { children: "gitDiff" }),
								"/",
								createVNode(_components.code, { children: "fsListAll" }),
								" streams over a WAN forward (pulse+procedure shapes exist in-tree precisely because value streams are fat), and the ws has no compression. Spike 3 quantifies; mitigations are one-liners before any structural change is considered. ",
								createVNode(_components.a, {
									href: "#user-content-fnref-bandwidth",
									"data-footnote-backref": "",
									"aria-label": "Back to reference 36",
									className: "data-footnote-backref",
									children: "↩"
								})
							] }),
							"\n"
						]
					}),
					"\n"
				] }),
				"\n"
			]
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "P2P kolu — every host runs the whole app; kolus federate",
	"description": "The non-padi architecture for remote terminals (#951): drop pulam AND padi. Every host runs a full kolu-server as a daemon — like kaval: Nix-provisioned, gate-held, on a 0700 unix socket, restartable because kaval holds the PTYs. The local kolu provisions remotes WITH ITS OWN CLOSURE and tunnels the browser's wire to them over an ssh streamlocal forward — both ends the same build by construction (identity = source-fileset digest, arch-independent), so kolu's client↔server wire never becomes a public contract. Build-ready after a 6-scout implementation review: 3 blocking + ~13 major holes resolved inline. Decisions settled: instant in-app switch; probe-and-refuse pre-K1 hosts; preferences are local, period. Phases K1–K4.",
	"parents": ["remote-terminals"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-01T00:00:00.000Z"
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
			"slug": "honest-comparison-vs-padi",
			"text": "Honest comparison vs padi"
		},
		{
			"depth": 2,
			"slug": "implementation-details",
			"text": "Implementation details"
		},
		{
			"depth": 3,
			"slug": "k1--identity--the-daemon-local-no-op-at-rest-the-one-δ-is-the-namespace-re-key",
			"text": "K1 — identity & the daemon (local no-op at rest; the one Δ is the namespace re-key)"
		},
		{
			"depth": 3,
			"slug": "k2--the-dial-zero-ui",
			"text": "K2 — the dial (zero UI)"
		},
		{
			"depth": 3,
			"slug": "k3--the-switch-the-user-visible-feature-instant-in-app-by-decision15",
			"text": "K3 — the switch (the user-visible feature; instant in-app, by decision)15"
		},
		{
			"depth": 3,
			"slug": "k4--attention-the-a-bar",
			"text": "K4 — attention (the A+ bar)"
		},
		{
			"depth": 3,
			"slug": "spikes-before-k1-each--a-day-falsifiable",
			"text": "Spikes before K1 (each ≤ a day, falsifiable)"
		},
		{
			"depth": 3,
			"slug": "open-decisions-the-remaining-technical-ones--product-forks-are-settled",
			"text": "Open decisions (the remaining, technical ones — product forks are settled)"
		},
		{
			"depth": 3,
			"slug": "settled-decisions-2026-07-01-by-the-user",
			"text": "Settled decisions (2026-07-01, by the user)"
		},
		{
			"depth": 3,
			"slug": "if-adopted",
			"text": "If adopted"
		},
		{
			"depth": 2,
			"slug": "footnote-label",
			"text": "Footnotes"
		}
	];
}
var url = "src/content/atlas/p2p-kolu.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/p2p-kolu.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/p2p-kolu.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, KT, LENS, Meter, PAL, PhaseLens, file, frontmatter, getHeadings, url };
