import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
//#region src/diagrams/pulam-web-mirror-health.svg?raw
var pulam_web_mirror_health_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 780 400\" font-family=\"ui-sans-serif,system-ui,sans-serif\">\n  <defs>\n    <marker id=\"ah-green\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#15803d\"/></marker>\n    <marker id=\"ah-dim\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#64748b\"/></marker>\n    <marker id=\"ah-red\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#dc2626\"/></marker>\n    <marker id=\"ah-violet\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#7c3aed\"/></marker>\n  </defs>\n\n  <!-- title -->\n  <text x=\"390\" y=\"28\" text-anchor=\"middle\" font-size=\"15\" font-weight=\"700\" fill=\"#0f172a\">pulam-web is a 3-tier bridge — only tier-1 health reaches the browser</text>\n\n  <!-- tiers -->\n  <g>\n    <rect x=\"24\" y=\"70\" width=\"180\" height=\"92\" rx=\"10\" fill=\"#eef2ff\" stroke=\"#c7d2fe\"/>\n    <text x=\"114\" y=\"100\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#3730a3\">browser</text>\n    <text x=\"114\" y=\"120\" text-anchor=\"middle\" font-size=\"11\" fill=\"#475569\">SolidJS · surfaceClient</text>\n    <text x=\"114\" y=\"137\" text-anchor=\"middle\" font-size=\"11\" fill=\"#475569\">renders the host card</text>\n\n    <rect x=\"300\" y=\"70\" width=\"180\" height=\"92\" rx=\"10\" fill=\"#ecfdf5\" stroke=\"#a7f3d0\"/>\n    <text x=\"390\" y=\"100\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#065f46\">pulam-web backend</text>\n    <text x=\"390\" y=\"120\" text-anchor=\"middle\" font-size=\"11\" fill=\"#475569\">re-serves the surface</text>\n    <text x=\"390\" y=\"137\" text-anchor=\"middle\" font-size=\"11\" fill=\"#475569\">owns the HostSession</text>\n\n    <rect x=\"576\" y=\"70\" width=\"180\" height=\"92\" rx=\"10\" fill=\"#f8fafc\" stroke=\"#e2e8f0\"/>\n    <text x=\"666\" y=\"100\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#334155\">remote pulam</text>\n    <text x=\"666\" y=\"120\" text-anchor=\"middle\" font-size=\"11\" fill=\"#475569\">the real terminals</text>\n    <text x=\"666\" y=\"137\" text-anchor=\"middle\" font-size=\"11\" fill=\"#475569\">over ssh / stdio</text>\n  </g>\n\n  <!-- transport arrows -->\n  <line x1=\"204\" y1=\"116\" x2=\"296\" y2=\"116\" stroke=\"#64748b\" stroke-width=\"1.5\" marker-end=\"url(#ah-dim)\"/>\n  <line x1=\"296\" y1=\"128\" x2=\"204\" y2=\"128\" stroke=\"#64748b\" stroke-width=\"1.5\" marker-end=\"url(#ah-dim)\"/>\n  <text x=\"250\" y=\"108\" text-anchor=\"middle\" font-size=\"10\" fill=\"#475569\">ws</text>\n  <line x1=\"480\" y1=\"116\" x2=\"572\" y2=\"116\" stroke=\"#64748b\" stroke-width=\"1.5\" marker-end=\"url(#ah-dim)\"/>\n  <line x1=\"572\" y1=\"128\" x2=\"480\" y2=\"128\" stroke=\"#64748b\" stroke-width=\"1.5\" marker-end=\"url(#ah-dim)\"/>\n  <text x=\"528\" y=\"108\" text-anchor=\"middle\" font-size=\"10\" fill=\"#475569\">ssh stdio</text>\n\n  <!-- TIER 1 health: socket status, surfaced today -->\n  <rect x=\"24\" y=\"196\" width=\"456\" height=\"40\" rx=\"8\" fill=\"#f0fdf4\" stroke=\"#bbf7d0\"/>\n  <circle cx=\"44\" cy=\"216\" r=\"5\" fill=\"#16a34a\"/>\n  <text x=\"58\" y=\"213\" font-size=\"11\" font-weight=\"700\" fill=\"#15803d\">tier-1 health — browser↔backend socket</text>\n  <text x=\"58\" y=\"228\" font-size=\"10.5\" fill=\"#475569\">connectSurface status (connecting · live · reconnecting · down) — ✓ already surfaced</text>\n\n  <!-- TIER 2 health: the gap -->\n  <rect x=\"300\" y=\"266\" width=\"456\" height=\"50\" rx=\"8\" fill=\"#fef2f2\" stroke=\"#fecaca\"/>\n  <text x=\"320\" y=\"287\" font-size=\"11\" font-weight=\"700\" fill=\"#b91c1c\">tier-2 health — backend↔remote mirror (HostSession.onState)</text>\n  <text x=\"320\" y=\"303\" font-size=\"10.5\" fill=\"#475569\">copying → connecting → connected → disconnected → failed (+ failureCause, progressLines)</text>\n\n  <!-- onState lives at the backend -->\n  <line x1=\"390\" y1=\"162\" x2=\"390\" y2=\"264\" stroke=\"#dc2626\" stroke-width=\"1.5\" stroke-dasharray=\"4 3\" marker-end=\"url(#ah-red)\"/>\n\n  <!-- THE LIE: today this never reaches the browser -->\n  <path d=\"M300 291 C 150 291, 114 250, 114 168\" fill=\"none\" stroke=\"#dc2626\" stroke-width=\"1.6\" stroke-dasharray=\"5 4\" marker-end=\"url(#ah-red)\"/>\n  <text x=\"150\" y=\"270\" font-size=\"10.5\" font-weight=\"700\" fill=\"#b91c1c\">TODAY: never crosses to the browser</text>\n  <text x=\"150\" y=\"284\" font-size=\"10\" fill=\"#b91c1c\">→ a dead mirror paints green + “no terminals”</text>\n\n  <!-- THE FIX -->\n  <path d=\"M320 276 C 220 235, 150 210, 120 172\" fill=\"none\" stroke=\"#7c3aed\" stroke-width=\"2\" marker-end=\"url(#ah-violet)\"/>\n  <text x=\"232\" y=\"200\" font-size=\"10.5\" font-weight=\"700\" fill=\"#6d28d9\">FIX: a `connection` cell</text>\n  <text x=\"232\" y=\"214\" font-size=\"10\" fill=\"#6d28d9\">parent writes session.onState → browser gates on it</text>\n\n  <text x=\"390\" y=\"350\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#475569\">drishti already does this (its reference shape); pulam-web is the lone consumer that never plugged in.</text>\n  <text x=\"390\" y=\"368\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#475569\">The two health channels stay SEPARATE — conflating socket status with mirror health is the bug.</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/pulam-web-mirror-health.mdx
var PAL = {
	bg: "#0f1117",
	card: "#0f1216",
	head: "#141922",
	line: "#1b2026",
	txt: "#c8d0de",
	sub: "#8b94a6",
	dim: "#5b6678",
	green: "#7ec699",
	amber: "#e6a23c",
	red: "#e06c75",
	violet: "#a78bfa"
};
var Dot = ({ c, pulse }) => createVNode("span", {
	class: pulse ? "mh-pulse" : "",
	style: `display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};flex:none`
});
var Card = ({ host, dotColor, pulse, statusLabel, statusColor, children, count }) => createVNode("div", {
	style: `font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:${PAL.card};border:1px solid ${PAL.line};border-radius:10px;overflow:hidden;margin:.7rem 0`,
	children: [createVNode("div", {
		style: `display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;background:${PAL.head};border-bottom:1px solid ${PAL.line}`,
		children: [
			createVNode("span", {
				style: `color:${PAL.violet}`,
				children: "▌"
			}),
			createVNode("span", {
				style: `color:#aeb7c7;font-weight:600`,
				children: host
			}),
			createVNode("span", {
				style: `color:${PAL.dim};font-size:.82em`,
				children: ["· ", count]
			}),
			createVNode("span", {
				style: `margin-left:auto;display:inline-flex;align-items:center;gap:.4rem;font-size:.82em;color:${statusColor}`,
				children: [createVNode(Dot, {
					c: dotColor,
					pulse
				}), statusLabel]
			})
		]
	}), createVNode("div", {
		style: "padding:.7rem .75rem",
		children
	})]
});
var Body = ({ children, color }) => createVNode("div", {
	style: `color:${color ?? PAL.dim};font-size:.92em`,
	children
});
var BeforeAfter = () => createVNode("div", {
	style: `background:${PAL.bg};border:1px solid #05070b;border-radius:12px;padding:.4rem 1rem 1rem;box-shadow:0 10px 30px rgba(0,0,0,.4)`,
	children: [
		createVNode("div", {
			style: `color:${PAL.red};font-size:.78em;letter-spacing:.08em;text-transform:uppercase;margin:.8rem 0 0`,
			children: [
				"Today — the lie (mirror is ",
				createVNode("b", { children: "failed" }),
				", build mismatch)"
			]
		}),
		createVNode(Card, {
			host: "pureintent",
			count: "0 terminals",
			dotColor: PAL.green,
			pulse: false,
			statusLabel: "",
			statusColor: PAL.green,
			children: createVNode(Body, { children: "no terminals" })
		}),
		createVNode("div", {
			style: `color:${PAL.green};font-size:.78em;letter-spacing:.08em;text-transform:uppercase;margin:1.4rem 0 0`,
			children: "After — honest states, driven by the mirror's real health"
		}),
		createVNode(Card, {
			host: "pureintent",
			count: "provisioning…",
			dotColor: PAL.amber,
			pulse: true,
			statusLabel: "provisioning agent…",
			statusColor: PAL.amber,
			children: createVNode(Body, { children: ["Copying agent to remote… ", createVNode("span", {
				style: `color:${PAL.dim}`,
				children: "(nix copy)"
			})] })
		}),
		createVNode(Card, {
			host: "pureintent",
			count: "connecting…",
			dotColor: PAL.amber,
			pulse: true,
			statusLabel: "connecting…",
			statusColor: PAL.amber,
			children: createVNode(Body, { children: ["Connecting… ", createVNode("span", {
				style: `color:${PAL.dim}`,
				children: "18s"
			})] })
		}),
		createVNode(Card, {
			host: "pureintent",
			count: "reconnecting…",
			dotColor: PAL.amber,
			pulse: true,
			statusLabel: "reconnecting…",
			statusColor: PAL.amber,
			children: createVNode(Body, { children: "Host unreachable — retrying…" })
		}),
		createVNode(Card, {
			host: "pureintent",
			count: "failed",
			dotColor: PAL.red,
			pulse: false,
			statusLabel: "failed",
			statusColor: PAL.red,
			children: createVNode("div", {
				style: `border:1px solid rgba(224,108,117,.4);background:rgba(224,108,117,.06);border-radius:7px;padding:.55rem .65rem`,
				children: [
					createVNode("div", {
						style: `color:${PAL.red};font-weight:600;margin-bottom:.15rem`,
						children: "Remote connection failed"
					}),
					createVNode("div", {
						style: `color:${PAL.dim};font-size:.82em;margin-bottom:.45rem`,
						children: "Gave up after repeated connection failures."
					}),
					createVNode("pre", {
						style: `margin:0 0 .5rem;white-space:pre-wrap;background:#0b0d12;border-radius:5px;padding:.45rem .55rem;color:#c7b8b8;font-size:.82em`,
						children: "kaval speaks pty-host 3.2, pulam needs 3.3 — run them from the same build remote agent exited (code=1)"
					}),
					createVNode("span", {
						style: `display:inline-block;border:1px solid #38507a;border-radius:5px;padding:.2rem .55rem;color:#9fb4d8;font-size:.82em`,
						children: "↻ Reconnect"
					})
				]
			})
		}),
		createVNode(Card, {
			host: "zest",
			count: "0 terminals",
			dotColor: PAL.green,
			pulse: false,
			statusLabel: "",
			statusColor: PAL.green,
			children: createVNode(Body, { children: "no terminals" })
		}),
		createVNode("div", {
			style: `color:${PAL.dim};font-size:.78em;margin-top:.3rem`,
			children: [
				"↑ the only place “no terminals” is honest: a genuinely-",
				createVNode("b", { children: "connected" }),
				" host with an empty roster."
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
		li: "li",
		ol: "ol",
		p: "p",
		strong: "strong",
		style: "style",
		ul: "ul"
	}, props.components);
	const { Fragment: Fragment$1 } = _components;
	if (!Fragment$1) _missingMdxReference("Fragment", true);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "pulam-web can sit in a state where a host reads as a healthy, empty fleet when its data link is dead" }),
			" — a green “connected” dot and “0 terminals / no terminals”, while that host actually has live terminals running on it. It is a confident lie: nothing on screen says “this host is unreachable”. Reproduced in the wild by a kolu ",
			createVNode(_components.strong, { children: "build-version mismatch" }),
			" between the two ends of the mirror (",
			createVNode(_components.a, {
				href: "https://gist.github.com/srid/6309facf79fbe92703da49306c6ea3e2",
				children: "gist"
			}),
			": remote ",
			createVNode(_components.code, { children: "kaval" }),
			" speaks pty-host ",
			createVNode(_components.strong, { children: "3.2" }),
			", local ",
			createVNode(_components.code, { children: "pulam" }),
			" needs ",
			createVNode(_components.strong, { children: "3.3" }),
			", so the remote agent exits and the session gives up — terminal ",
			createVNode(_components.code, { children: "failed" }),
			" — yet the browser stays green). Filed as ",
			createVNode(_components.a, {
				href: "https://github.com/juspay/kolu/issues/1564",
				children: "#1564"
			}),
			". The mismatch is only the ",
			createVNode(_components.em, { children: "trigger" }),
			"; ",
			createVNode(_components.strong, { children: "any" }),
			" dead backend↔remote leg collapses into the same silent empty state."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The fix is small and already proven next door: ",
			createVNode(_components.strong, { children: [createVNode(_components.a, {
				href: "electricity.html",
				children: "drishti"
			}), " does not have this bug"] }),
			" — it surfaces the mirror’s health to the browser as a first-class ",
			createVNode(_components.code, { children: "connection" }),
			" cell and gates its UI on it. pulam-web is the lone consumer that never plugged in. Shipped in ",
			createVNode($$PrLink, { pr: 1568 }),
			" (with the linked drishti gate PR adopting the shared cell)."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "user-facing-description",
			children: "User-facing description"
		}),
		"\n",
		"\n",
		"\n",
		"\n",
		"\n",
		createVNode(_components.style, { children: `
.mh-pulse { animation: mhpulse 1.4s ease-in-out infinite; }
@keyframes mhpulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }
` }),
		"\n",
		"\n",
		createVNode(BeforeAfter, {}),
		"\n",
		createVNode(_components.p, { children: [
			"The host card’s status indicator and body are now driven by ",
			createVNode(_components.strong, { children: "the mirror’s real health" }),
			", not by the browser’s own socket. The shape mirrors kolu’s own connection language and drishti’s exactly:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "copying" }),
					" / ",
					createVNode(_components.code, { children: "connecting" }),
					" / ",
					createVNode(_components.code, { children: "disconnected" })
				] }),
				" are ",
				createVNode(_components.em, { children: "in-flight" }),
				" — an ",
				createVNode(_components.strong, { children: "amber, pulsing" }),
				" dot with a live status line (",
				createVNode(_components.code, { children: "Copying agent to remote…" }),
				", ",
				createVNode(_components.code, { children: "Connecting… 18s" }),
				", ",
				createVNode(_components.code, { children: "Host unreachable — retrying…" }),
				"). The browser is honestly told work is happening; no terminal list is painted yet."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "failed" }) }),
				" is ",
				createVNode(_components.em, { children: "terminal" }),
				" — a ",
				createVNode(_components.strong, { children: "solid red" }),
				" dot and a card carrying the ",
				createVNode(_components.strong, { children: "real failure" }),
				": ",
				createVNode(_components.code, { children: "lastError" }),
				", the tail of the connection log (the gist’s ",
				createVNode(_components.code, { children: "pty-host 3.2 vs 3.3" }),
				" line lands here verbatim), and a ",
				createVNode(_components.strong, { children: "↻ Reconnect" }),
				" button (the only recovery short of a reload)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "connected" }) }),
				" is the only state that paints the terminal list — and the only state in which ",
				createVNode(_components.strong, { children: "“no terminals” is allowed to mean an empty host" }),
				" (see ",
				createVNode(_components.code, { children: "zest" }),
				" above)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "One subtle but load-bearing distinction",
			children: createVNode(_components.p, { children: [
				"The existing green dot today comes from ",
				createVNode(_components.code, { children: "connectSurface" }),
				"’s ",
				createVNode(_components.strong, { children: "transport" }),
				" status — the ",
				createVNode(_components.em, { children: "browser↔backend" }),
				" websocket, which is healthy even when the remote host is dead. That signal is real and stays (a half-open browser↔backend socket is its own failure, fixed default-on by ",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/issues/1542",
					children: "#1542"
				}),
				"). But it must ",
				createVNode(_components.strong, { children: "never" }),
				" be what decides “healthy vs empty”. That decision moves to the new ",
				createVNode(_components.code, { children: "connection" }),
				" cell — the ",
				createVNode(_components.em, { children: "backend↔remote" }),
				" mirror’s health. Two channels, two seams; conflating them ",
				createVNode(_components.strong, { children: "is" }),
				" the bug."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "architecture-level-changes",
			children: "Architecture-level changes"
		}),
		"\n",
		createVNode($$Svg, {
			svg: pulam_web_mirror_health_default,
			caption: "pulam-web is browser ↔ backend ↔ remote pulam. Tier-1 health (the browser↔backend socket) is already surfaced. Tier-2 health (the backend↔remote mirror, tracked by HostSession.onState as copying→…→failed) lives on the backend and TODAY never crosses to the browser — so a dead mirror paints green + “no terminals”. The fix adds a `connection` cell the parent writes from session.onState and the browser gates on. drishti already does exactly this."
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The volatility is already a receptacle — pulam-web just never plugged in." }),
			" The hard, changing thing here is the remote link’s lifecycle: ",
			createVNode(_components.code, { children: "nix copy" }),
			", ssh dial, reconnect/backoff, the connect watchdog, the ",
			createVNode(_components.code, { children: "network" }),
			"-vs-",
			createVNode(_components.code, { children: "remote" }),
			" failure-cause split, the give-up-into-",
			createVNode(_components.code, { children: "failed" }),
			". That volatility was lifted into ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/surface-nix-host" }) }),
			" long ago — ",
			createVNode(_components.code, { children: "HostSession" }),
			" exposes it as a domain-agnostic, snapshot-then-delta ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "onState" }) }),
			" callback carrying ",
			createVNode(_components.code, { children: "HostSessionState" }),
			" (",
			createVNode(_components.code, { children: "connection" }),
			" · ",
			createVNode(_components.code, { children: "lastError" }),
			" · ",
			createVNode(_components.code, { children: "failureCause" }),
			" · ",
			createVNode(_components.code, { children: "progressLines" }),
			" · ",
			createVNode(_components.code, { children: "remoteProgressLines" }),
			"). The mirror ",
			createVNode(_components.em, { children: "loop" }),
			" (",
			createVNode(_components.code, { children: "pumpRemoteSurface" }),
			") graduated out of drishti into the same package. What pulam-web is missing is the ",
			createVNode(_components.strong, { children: "wiring" }),
			" that carries that already-owned state onto the browser surface — and this PR graduates the common pieces of that wiring so a third consumer can’t neglect it either: a ",
			createVNode(_components.strong, { children: [
				"composable ",
				createVNode(_components.code, { children: "connection" }),
				" cell fragment"
			] }),
			" (schema + gate-closed default) apps compose at the mirror seam via ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "mirroredSurface(base)" }) }),
			" — never hand-spread (the seam reserves the ",
			createVNode(_components.code, { children: "connection" }),
			" name and throws on a collision) — plus the node-side ",
			createVNode(_components.code, { children: "onState → cell" }),
			" projection. Only the ",
			createVNode(_components.em, { children: "UI" }),
			" and the per-site cell ",
			createVNode(_components.em, { children: "implementation" }),
			" stay app-local (see the verdict below)."
		] }),
		"\n",
		createVNode(_components.p, { children: "drishti is the worked reference, three pieces:" }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"A browser-facing ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "connection" }), " cell"] }),
				" on its surface, seeded ",
				createVNode(_components.code, { children: "DEFAULT_CONNECTION" }),
				" with ",
				createVNode(_components.code, { children: "state: \"connecting\"" }),
				" — ",
				createVNode(_components.em, { children: "gate-closed by default" }),
				", so “healthy-empty before the first real frame” is structurally unrepresentable (",
				createVNode(_components.code, { children: "drishti common/src/surface.ts" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The parent ",
				createVNode(_components.strong, { children: [
					"pipes ",
					createVNode(_components.code, { children: "session.onState" }),
					" straight into that cell"
				] }),
				" (",
				createVNode(_components.code, { children: "router.ts" }),
				" — ",
				createVNode(_components.code, { children: "session.onState(s => connection.set({ state: s.connection, lastError, failureCause, progressLines }))" }),
				"). The agent serves an ",
				createVNode(_components.strong, { children: "inert stub" }),
				" of the cell; only the parent writes it."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The client ",
				createVNode(_components.strong, { children: ["gates all content on ", createVNode(_components.code, { children: "state === \"connected\"" })] }),
				" and renders a state-driven dot + overlay otherwise (",
				createVNode(_components.code, { children: "connectionColors.ts" }),
				"’s ",
				createVNode(_components.code, { children: "STATE" }),
				" map + ",
				createVNode(_components.code, { children: "ConnectingOverlay" }),
				"/",
				createVNode(_components.code, { children: "FailedCard" }),
				")."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Decomposition — what graduates, what stays put (lens panel)",
			children: [
				createVNode(_components.p, { children: [
					"The instinct to ",
					createVNode(_components.em, { children: "upstream this so consumers can’t neglect it" }),
					" is the same move ",
					createVNode(_components.a, {
						href: "https://github.com/juspay/kolu/issues/1542",
						children: "#1542"
					}),
					" made for liveness — and the surface framework is ",
					createVNode(_components.strong, { children: "composition-first" }),
					" (",
					createVNode(_components.code, { children: "defineSurface" }),
					" is spread-based; ",
					createVNode(_components.code, { children: "system.live" }),
					" is already auto-composed into every surface), so the right shape is a ",
					createVNode(_components.strong, { children: [
						"composable ",
						createVNode(_components.code, { children: "connection" }),
						" fragment apps compose via ",
						createVNode(_components.code, { children: "mirroredSurface(base)" })
					] }),
					" (which owns the spread and reserves the name), not a per-app re-declaration or a raw hand-spread. The ",
					createVNode(_components.strong, { children: "browser boundary" }),
					" then splits ",
					createVNode(_components.em, { children: "where" }),
					" each piece lives, because ",
					createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
					"’s main entry is node-only (it spawns ssh) while ",
					createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
					" is browser-bundled:"
				] }),
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: [
							"Graduates → a new browser-safe ",
							createVNode(_components.code, { children: "@kolu/surface-nix-host/connection" }),
							" subpath: the cell AND the mirror-seam composer."
						] }),
						" The state literals, ",
						createVNode(_components.code, { children: "ConnectionInfoSchema" }),
						", the gate-closed ",
						createVNode(_components.code, { children: "DEFAULT_CONNECTION" }),
						" (",
						createVNode(_components.code, { children: "state: \"connecting\"" }),
						"), the ",
						createVNode(_components.code, { children: "connectionCell" }),
						" descriptor, and — the shape that landed — ",
						createVNode(_components.strong, { children: createVNode(_components.code, { children: "mirroredSurface(base)" }) }),
						", which composes the cell onto a surface ",
						createVNode(_components.strong, { children: "only at the nix-host mirror seam" }),
						". The base surface (",
						createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
						", drishti’s own) stays ",
						createVNode(_components.strong, { children: "connection-free" }),
						"; the browser/mirror surface is ",
						createVNode(_components.code, { children: "mirroredSurface(base)" }),
						". A subpath that imports only zod + ",
						createVNode(_components.code, { children: "@kolu/surface" }),
						" (no ssh code), so the schema ",
						createVNode(_components.strong, { children: "and" }),
						" the safety default are single-sourced for every mirror — pulam-web’s ",
						createVNode(_components.code, { children: "pulamSurface = mirroredSurface(terminalWorkspaceSurface)" }),
						" and drishti’s mirror compose the ",
						createVNode(_components.em, { children: "same" }),
						" fragment."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: [
							"Graduates → ",
							createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
							" (node main entry): the ",
							createVNode(_components.code, { children: "onState → cell" }),
							" projection."
						] }),
						" ",
						createVNode(_components.code, { children: "projectConnection(HostSessionState) → ConnectionInfo" }),
						" + ",
						createVNode(_components.code, { children: "pipeSessionStateToCell(session, set)" }),
						" — the mapping both apps’ ",
						createVNode(_components.em, { children: "parents" }),
						" do identically, beside its volatility owner (",
						createVNode(_components.code, { children: "getHostSession" }),
						"/",
						createVNode(_components.code, { children: "pumpRemoteSurface" }),
						"). The ",
						createVNode(_components.em, { children: "dual" }),
						" of the already-graduated mirror loop: the pump streams data out, this streams state out. ",
						createVNode(_components.strong, { children: [createVNode(_components.code, { children: "pumpRemoteSurface" }), " itself wires it"] }),
						" when the re-served surface carries the ",
						createVNode(_components.code, { children: "connection" }),
						" cell — passing a ",
						createVNode(_components.code, { children: "connection" }),
						" setter makes the pump call ",
						createVNode(_components.code, { children: "pipeSessionStateToCell" }),
						" for the session’s life, so a mirror consumer can’t forget it (the omission that was #1564)."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: [
							"Stays app-local: the UI and the per-site ",
							createVNode(_components.em, { children: "implementation" }),
							"."
						] }),
						" The ",
						createVNode(_components.code, { children: "STATE" }),
						"→colour/label map, the overlay/failed card, and ",
						createVNode(_components.em, { children: "which" }),
						" content hides behind the gate are each app’s own socket (folding them up would drag a SolidJS/UI dep into a transport package — the ",
						createVNode(_components.em, { children: "location-is-structure" }),
						" trap). And composition single-sources the cell’s ",
						createVNode(_components.em, { children: "declaration" }),
						", not its ",
						createVNode(_components.em, { children: "implementation" }),
						": only the ",
						createVNode(_components.strong, { children: "re-serve" }),
						" (",
						createVNode(_components.code, { children: "implementSurface(mirroredSurface(base), …)" }),
						") provides the live ",
						createVNode(_components.code, { children: "connection" }),
						" cell; a direct/local serve of the base surface carries no ",
						createVNode(_components.code, { children: "connection" }),
						" cell at all (no inert stub, no contract-version dance)."
					] }),
					"\n"
				] }),
				createVNode(_components.p, { children: [
					"Two non-homes, by design: ",
					createVNode(_components.strong, { children: ["not ", createVNode(_components.code, { children: "@kolu/surface-app" })] }),
					" — it owns the ",
					createVNode(_components.em, { children: "other" }),
					" connection concept, the browser↔backend socket status (",
					createVNode(_components.code, { children: "createSocketStatus" }),
					"), the one we must keep strictly separate (conflating them is this bug), and it has no business knowing the ssh ",
					createVNode(_components.code, { children: "copying" }),
					"/",
					createVNode(_components.code, { children: "failed" }),
					" vocabulary; ",
					createVNode(_components.strong, { children: "not a framework-reserved member" }),
					" like ",
					createVNode(_components.code, { children: "system.live" }),
					" — those states only mean something for a surface ",
					createVNode(_components.em, { children: "mirrored over a HostSession" }),
					", so it’s an opt-in fragment, not a universal one. The lens panel had split 2–1 on whether ",
					createVNode(_components.em, { children: "anything" }),
					" should graduate (the volatility itself already did); the deciding point is that the fragment makes ",
					createVNode(_components.strong, { children: "drishti the second consumer that drops its hand-rolled copy" }),
					" — which earns the extraction (test ③) and is exactly what the surface gate’s linked drishti PR delivers."
				] })
			]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "implementation-details",
			children: "Implementation details"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "One PR" }),
			", threading seams that already exist — the new state rides the ",
			createVNode(_components.strong, { children: "same" }),
			" per-host ws the awareness collection already uses, so there’s no new socket and no second surface. (Plus the surface gate’s linked drishti PR, step 7 — mandated, not deferred.)"
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: [
			"1 — Add the composable cell to a new browser-safe ",
			createVNode(_components.code, { children: "@kolu/surface-nix-host/connection" }),
			" subpath"
		] }), ", plus the node-side projection on the main entry. Two faces, split by the browser boundary:"] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"New subpath ",
				createVNode(_components.code, { children: "@kolu/surface-nix-host/connection" }),
				" (new ",
				createVNode(_components.code, { children: "exports" }),
				" map entry; imports only ",
				createVNode(_components.code, { children: "zod" }),
				" + ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				" — ",
				createVNode(_components.strong, { children: "no" }),
				" node/ssh code, so it’s safe in the browser bundle): ",
				createVNode(_components.code, { children: "CONNECTION_STATES" }),
				" (the literal tuple), ",
				createVNode(_components.code, { children: "ConnectionInfo" }),
				" (type), ",
				createVNode(_components.code, { children: "ConnectionInfoSchema" }),
				" (zod), ",
				createVNode(_components.code, { children: "DEFAULT_CONNECTION" }),
				" (",
				createVNode(_components.code, { children: "state: \"connecting\"" }),
				" — the gate-closed default), ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "connectionCell" }) }),
				" — the get-only ",
				createVNode(_components.code, { children: "{ schema, default, verbs }" }),
				" descriptor — and ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "mirroredSurface(base)" }) }),
				", the composer that adds ",
				createVNode(_components.code, { children: "connectionCell" }),
				" at the mirror seam (reserving the ",
				createVNode(_components.code, { children: "connection" }),
				" name). Apps reach for ",
				createVNode(_components.code, { children: "mirroredSurface(base)" }),
				", not a hand-spread of ",
				createVNode(_components.code, { children: "connectionCell" }),
				" into ",
				createVNode(_components.code, { children: "cells" }),
				". To keep one source of truth, move the ",
				createVNode(_components.code, { children: "ConnectionState" }),
				" literal tuple here and have ",
				createVNode(_components.code, { children: "hostSession.ts" }),
				" derive its ",
				createVNode(_components.code, { children: "ConnectionState" }),
				" type from it (",
				createVNode(_components.code, { children: "typeof CONNECTION_STATES[number]" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Main entry ",
				createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
				" (node-side, no new runtime dep — pure TS over the existing ",
				createVNode(_components.code, { children: "session.onState" }),
				", ",
				createVNode(_components.code, { children: "hostSession.ts:265" }),
				"): ",
				createVNode(_components.code, { children: "projectConnection(s: HostSessionState): ConnectionInfo" }),
				" (",
				createVNode(_components.code, { children: "state: s.connection" }),
				", ",
				createVNode(_components.code, { children: "progressLines: [...s.progressLines]" }),
				", …) and ",
				createVNode(_components.code, { children: "pipeSessionStateToCell(session, set): () => void" }),
				" (",
				createVNode(_components.code, { children: "session.onState(s => set(projectConnection(s)))" }),
				", returning the unsubscribe)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// @kolu/surface-nix-host/connection — browser-safe (zod + @kolu/surface only)</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">export</span><span style=\"color:#D73A49\"> const</span><span style=\"color:#005CC5\"> CONNECTION_STATES</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> [</span></span>\n<span class=\"line\"><span style=\"color:#032F62\">  \"copying\"</span><span style=\"color:#24292E\">, </span><span style=\"color:#032F62\">\"connecting\"</span><span style=\"color:#24292E\">, </span><span style=\"color:#032F62\">\"connected\"</span><span style=\"color:#24292E\">, </span><span style=\"color:#032F62\">\"disconnected\"</span><span style=\"color:#24292E\">, </span><span style=\"color:#032F62\">\"failed\"</span><span style=\"color:#24292E\">,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">] </span><span style=\"color:#D73A49\">as</span><span style=\"color:#D73A49\"> const</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#D73A49\">export</span><span style=\"color:#D73A49\"> const</span><span style=\"color:#005CC5\"> ConnectionInfoSchema</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> z.</span><span style=\"color:#6F42C1\">object</span><span style=\"color:#24292E\">({</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  state: z.</span><span style=\"color:#6F42C1\">enum</span><span style=\"color:#24292E\">(</span><span style=\"color:#005CC5\">CONNECTION_STATES</span><span style=\"color:#24292E\">),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  lastError: z.</span><span style=\"color:#6F42C1\">string</span><span style=\"color:#24292E\">().</span><span style=\"color:#6F42C1\">nullable</span><span style=\"color:#24292E\">(),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  failureCause: z.</span><span style=\"color:#6F42C1\">enum</span><span style=\"color:#24292E\">([</span><span style=\"color:#032F62\">\"network\"</span><span style=\"color:#24292E\">, </span><span style=\"color:#032F62\">\"remote\"</span><span style=\"color:#24292E\">]).</span><span style=\"color:#6F42C1\">nullable</span><span style=\"color:#24292E\">(),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  progressLines: z.</span><span style=\"color:#6F42C1\">array</span><span style=\"color:#24292E\">(z.</span><span style=\"color:#6F42C1\">string</span><span style=\"color:#24292E\">()).</span><span style=\"color:#6F42C1\">readonly</span><span style=\"color:#24292E\">(),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">export</span><span style=\"color:#D73A49\"> type</span><span style=\"color:#6F42C1\"> ConnectionInfo</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> z</span><span style=\"color:#24292E\">.</span><span style=\"color:#6F42C1\">infer</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#D73A49\">typeof</span><span style=\"color:#24292E\"> ConnectionInfoSchema>;</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// Gate-closed by default: a freshly-composed cell reads \"connecting\", so</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// \"healthy-empty before the first frame\" is structurally unrepresentable.</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">export</span><span style=\"color:#D73A49\"> const</span><span style=\"color:#005CC5\"> DEFAULT_CONNECTION</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> ConnectionInfo</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> {</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  state: </span><span style=\"color:#032F62\">\"connecting\"</span><span style=\"color:#24292E\">, lastError: </span><span style=\"color:#005CC5\">null</span><span style=\"color:#24292E\">, failureCause: </span><span style=\"color:#005CC5\">null</span><span style=\"color:#24292E\">, progressLines: [],</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">};</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// The composable cell — the fragment `mirroredSurface(base)` spreads in at the</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// mirror seam; apps compose via `mirroredSurface`, never hand-spread this.</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// `verbs: [\"get\"]` makes it READ-ONLY over the wire: the parent host owns it</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// (writes server-side off `session.onState`), so a remote client must never be</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// able to `connection.set` the health to `connected` and forge the gate's</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// signal. Without it, a no-`patchSchema` cell defaults to `[\"get\", \"set\"]`.</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">export</span><span style=\"color:#D73A49\"> const</span><span style=\"color:#005CC5\"> connectionCell</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> {</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  schema: ConnectionInfoSchema,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  default: </span><span style=\"color:#005CC5\">DEFAULT_CONNECTION</span><span style=\"color:#24292E\">,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  verbs: [</span><span style=\"color:#032F62\">\"get\"</span><span style=\"color:#24292E\">],</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">} </span><span style=\"color:#D73A49\">as</span><span style=\"color:#D73A49\"> const</span><span style=\"color:#24292E\">;</span></span></code></pre>" }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// @kolu/surface-nix-host (node main entry)</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#D73A49\"> type</span><span style=\"color:#24292E\"> { ConnectionInfo } </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"./connection\"</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#D73A49\">export</span><span style=\"color:#D73A49\"> const</span><span style=\"color:#6F42C1\"> projectConnection</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> (</span><span style=\"color:#E36209\">s</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> HostSessionState</span><span style=\"color:#24292E\">)</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> ConnectionInfo</span><span style=\"color:#D73A49\"> =></span><span style=\"color:#24292E\"> ({</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  state: s.connection,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  lastError: s.lastError,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  failureCause: s.failureCause,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  progressLines: [</span><span style=\"color:#D73A49\">...</span><span style=\"color:#24292E\">s.progressLines],</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// The dual of pumpRemoteSurface (which streams DATA out); this streams STATE</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// out. Returns the unsubscribe.</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">export</span><span style=\"color:#D73A49\"> const</span><span style=\"color:#6F42C1\"> pipeSessionStateToCell</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> &#x3C;</span><span style=\"color:#6F42C1\">C</span><span style=\"color:#24292E\">>(</span></span>\n<span class=\"line\"><span style=\"color:#E36209\">  session</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> HostSession</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">C</span><span style=\"color:#24292E\">>,</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  set</span><span style=\"color:#D73A49\">:</span><span style=\"color:#24292E\"> (</span><span style=\"color:#E36209\">info</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> ConnectionInfo</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#005CC5\"> void</span><span style=\"color:#24292E\">,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">): (() </span><span style=\"color:#D73A49\">=></span><span style=\"color:#D73A49\"> void</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> session.</span><span style=\"color:#6F42C1\">onState</span><span style=\"color:#24292E\">((</span><span style=\"color:#E36209\">s</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> set</span><span style=\"color:#24292E\">(</span><span style=\"color:#6F42C1\">projectConnection</span><span style=\"color:#24292E\">(s)));</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "2 — Compose the cell at the mirror seam, NOT into the base surface." }),
			" The base ",
			createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
			" (",
			createVNode(_components.code, { children: "packages/terminal-workspace/src/surface.ts" }),
			") stays ",
			createVNode(_components.strong, { children: "connection-free" }),
			" — link health is not a property of the daemon’s own surface (a direct/local link has no remote to be down). pulam-web’s browser/mirror surface wraps it: ",
			createVNode(_components.code, { children: "pulamSurface = mirroredSurface(terminalWorkspaceSurface)" }),
			" (",
			createVNode(_components.code, { children: "packages/pulam-web/src/shared/contract.ts" }),
			"). ",
			createVNode(_components.code, { children: "mirroredSurface" }),
			" adds the gate-closed get-only ",
			createVNode(_components.code, { children: "connection" }),
			" cell; the gate-closed ",
			createVNode(_components.code, { children: "state: \"connecting\"" }),
			" seed comes baked in. drishti composes the ",
			createVNode(_components.em, { children: "same" }),
			" ",
			createVNode(_components.code, { children: "mirroredSurface(base)" }),
			" at its own mirror (the step-7 companion). Only the browser-safe ",
			createVNode(_components.code, { children: "@kolu/surface-nix-host/connection" }),
			" subpath + ",
			createVNode(_components.code, { children: "import type" }),
			"s reach the client bundle (the node main entry never does)."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// packages/pulam-web/src/shared/contract.ts</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#24292E\"> { mirroredSurface } </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"@kolu/surface-nix-host/connection\"</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#24292E\"> { terminalWorkspaceSurface } </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"@kolu/terminal-workspace/surface\"</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// The browser-facing surface = base + the get-only `connection` cell.</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">export</span><span style=\"color:#D73A49\"> const</span><span style=\"color:#005CC5\"> pulamSurface</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> mirroredSurface</span><span style=\"color:#24292E\">(terminalWorkspaceSurface);</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "3 — Only the re-serve implements the cell; the daemon serves the connection-free base." }),
			" There is no inert per-site stub. The daemon (",
			createVNode(_components.code, { children: "packages/pulam/src/daemon.ts" }),
			") and every direct/local serve implement ",
			createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
			", which has no ",
			createVNode(_components.code, { children: "connection" }),
			" cell — fail-fast doesn’t ask for one. Only pulam-web’s re-serve implements the augmented ",
			createVNode(_components.code, { children: "pulamSurface" }),
			", backing ",
			createVNode(_components.code, { children: "connection" }),
			" with a seeded local store (",
			createVNode(_components.code, { children: "seedConnectionCell()" }),
			") it writes from the session. The store is ",
			createVNode(_components.strong, { children: "NOT" }),
			" folded by the mirror sink (it’s the session’s state, not the daemon’s data) and writes go through the framework-wrapped ",
			createVNode(_components.code, { children: "ctx.cells.connection.set" }),
			" (persist + PUBLISH the delta) so a browser already subscribed across a reconnect hears the new state."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// packages/pulam-web/src/server/reserve.ts — re-serve of the MIRRORED surface</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> connection</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> seedConnectionCell</span><span style=\"color:#24292E\">(); </span><span style=\"color:#6A737D\">// gate-closed \"connecting\" seed</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> fragment</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> implementSurface</span><span style=\"color:#24292E\">(pulamSurface, {</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  cells: { version: { store: versionStore }, connection },</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">  // collections / streams folded/forwarded from the daemon's base surface…</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// Expose the framework-wrapped setter on the ReServe result:</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">setConnection</span><span style=\"color:#24292E\">: (</span><span style=\"color:#E36209\">info</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> ConnectionInfo</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> fragment.ctx.cells.connection.</span><span style=\"color:#6F42C1\">set</span><span style=\"color:#24292E\">(info),</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "4 — The pump carries session state into the cell — by construction." }),
			" ",
			createVNode(_components.code, { children: "pumpRemoteSurface" }),
			" (the reconnect-mirror loop) takes a ",
			createVNode(_components.code, { children: "connection" }),
			" setter; passing it makes the pump wire ",
			createVNode(_components.code, { children: "pipeSessionStateToCell(session, set)" }),
			" itself for the session’s life. So ",
			createVNode(_components.code, { children: "packages/pulam-web/src/server/hostEntry.ts" }),
			" doesn’t pipe it by hand — it hands the setter to the pump, and the session’s existing lifecycle (first-version ",
			createVNode(_components.code, { children: "markConnected" }),
			", the connect watchdog, give-up-into-",
			createVNode(_components.code, { children: "failed" }),
			") drives every transition. Pumping a session carries its health by construction (#1564), so it can’t be wired wrong."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// packages/pulam-web/src/server/hostEntry.ts</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> reServe</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> buildReServe</span><span style=\"color:#24292E\">({ log: hostLog });</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">void</span><span style=\"color:#6F42C1\"> pumpRemoteSurface</span><span style=\"color:#24292E\">({</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  source: terminalWorkspaceSurface,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  session,</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  makeSink</span><span style=\"color:#24292E\">: () </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> reServe.</span><span style=\"color:#6F42C1\">makeSink</span><span style=\"color:#24292E\">(() </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> session.</span><span style=\"color:#6F42C1\">markConnected</span><span style=\"color:#24292E\">()),</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">  // …live holders + onLinkDown reset…</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  connection: { set: reServe.setConnection }, </span><span style=\"color:#6A737D\">// ← pump wires pipeSessionStateToCell</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"5 — Gate the client on the cell, not on ",
				createVNode(_components.code, { children: "version.pending()" }),
				"."
			] }),
			" In ",
			createVNode(_components.code, { children: "packages/pulam-web/src/client/HostGroup.tsx" }),
			": read ",
			createVNode(_components.code, { children: "app.cells.connection.use()" }),
			" and make the top-level gate ",
			createVNode(_components.code, { children: "connection.state === \"connected\"" }),
			" — replacing the ",
			createVNode(_components.code, { children: "version.pending()" }),
			" “connecting…” gate (~line 289) and the ",
			createVNode(_components.code, { children: "awareness.keys().length" }),
			" “no terminals” decision (~line 297). Off-",
			createVNode(_components.code, { children: "connected" }),
			" renders the state-driven body: provisioning / connecting+elapsed / reconnecting (refined by ",
			createVNode(_components.code, { children: "failureCause" }),
			") / the ",
			createVNode(_components.strong, { children: "failed card" }),
			" (",
			createVNode(_components.code, { children: "lastError" }),
			" + ",
			createVNode(_components.code, { children: "progressLines" }),
			" tail + a ",
			createVNode(_components.strong, { children: "Reconnect" }),
			" button that hits a small ",
			createVNode(_components.code, { children: "POST /api/reconnect?host=" }),
			" route calling ",
			createVNode(_components.code, { children: "registry.getSession(host).reconnect()" }),
			"). Only ",
			createVNode(_components.code, { children: "connected" }),
			" reaches the existing awareness rendering, where “no terminals” is finally honest. The header dot reads a pulam-web-local ",
			createVNode(_components.code, { children: "STATE" }),
			" map keyed by ",
			createVNode(_components.code, { children: "connection.state" }),
			" (its own palette — the UI the panel keeps app-local). ",
			createVNode(_components.code, { children: "statusForHost" }),
			" (the browser↔backend socket) stays a ",
			createVNode(_components.em, { children: "secondary" }),
			" indicator and no longer decides healthy-vs-empty. ",
			createVNode(_components.code, { children: "DEFAULT_VERSION" }),
			" keeps its real job (a version snapshot) and simply stops being abused as a link-live proxy."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"text\"><code><span class=\"line\"><span>// packages/pulam-web/src/client/HostGroup.tsx</span></span>\n<span class=\"line\"><span>const connection = app.cells.connection.use({ onError });</span></span>\n<span class=\"line\"><span>const info = (): ConnectionInfo => connection.value() ?? DEFAULT_CONNECTION;</span></span>\n<span class=\"line\"><span></span></span>\n<span class=\"line\"><span>&#x3C;Show</span></span>\n<span class=\"line\"><span>  when={info().state === \"connected\"}</span></span>\n<span class=\"line\"><span>  fallback={&#x3C;ConnectionView info={info()} host={props.host} />}</span></span>\n<span class=\"line\"><span>></span></span>\n<span class=\"line\"><span>  {/* the existing awareness rendering — \"no terminals\" is honest only here */}</span></span>\n<span class=\"line\"><span>&#x3C;/Show></span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "6 — Hermetic test." }),
			" Extend ",
			createVNode(_components.code, { children: "reserve.test.ts" }),
			" (the existing agent→mirror→re-serve→browser-store proof): drive a ",
			createVNode(_components.code, { children: "session.onState" }),
			" sequence ending in ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "failed" }) }),
			" with no awareness keys, and assert the browser-consumed ",
			createVNode(_components.code, { children: "connection" }),
			" cell reads ",
			createVNode(_components.code, { children: "failed" }),
			" with its ",
			createVNode(_components.code, { children: "lastError" }),
			" — the surface carries the down state — instead of the old empty/healthy path. Goes red if the gate ever reverts to the socket/version proxy. Visual proof is pulam-web over a real ws against a deliberately build-mismatched host (a chrome-devtools or e2e still of the failed card)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "7 — The linked drishti PR (surface gate — ships with this one)." }),
			" Adding exports to ",
			createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
			" is API-facing, so ",
			createVNode(_components.code, { children: ".claude/rules/surface.md" }),
			" requires a linked drishti PR with green CI. drishti already hand-rolls ",
			createVNode(_components.em, { children: "both" }),
			" halves — its own ",
			createVNode(_components.code, { children: "ConnectionSchema" }),
			"/",
			createVNode(_components.code, { children: "DEFAULT_CONNECTION" }),
			" in ",
			createVNode(_components.code, { children: "drishti-common" }),
			" and the inline ",
			createVNode(_components.code, { children: "session.onState(s => cell.set({ state: s.connection, … }))" }),
			" in ",
			createVNode(_components.code, { children: "router.ts" }),
			". The companion bumps drishti’s kolu pin and replaces them: ",
			createVNode(_components.strong, { children: ["wrap its mirror surface in ", createVNode(_components.code, { children: "mirroredSurface(base)" })] }),
			" (dropping its copy of the schema + default and its hand-spread cell) and let the pump wire ",
			createVNode(_components.code, { children: "pipeSessionStateToCell" }),
			" / ",
			createVNode(_components.code, { children: "projectConnection" }),
			" (dropping the inline mapping). Its green CI proves the lift behaviour-preserving — and makes drishti the second consumer that earns the extraction."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Unaffected, stated plainly:" }),
			" kolu’s Code tab and ",
			createVNode(_components.code, { children: "pulam-tui" }),
			" consume ",
			createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
			" directly and track their link in-process. The base surface stays connection-free, so there is no new cell for them to read and nothing to stub — they build unchanged. The ",
			createVNode(_components.code, { children: "connection" }),
			" cell exists only on ",
			createVNode(_components.code, { children: "mirroredSurface(base)" }),
			", which only a re-serving parent (pulam-web, drishti) serves."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Done when" }),
			" a host whose mirror is ",
			createVNode(_components.code, { children: "copying" }),
			"/",
			createVNode(_components.code, { children: "connecting" }),
			"/",
			createVNode(_components.code, { children: "disconnected" }),
			"/",
			createVNode(_components.code, { children: "failed" }),
			" renders an honest state (failure cause + Reconnect on ",
			createVNode(_components.code, { children: "failed" }),
			") instead of green + “no terminals”; a genuinely-empty ",
			createVNode(_components.em, { children: "connected" }),
			" host still reads “no terminals”; the hermetic test asserts the ",
			createVNode(_components.code, { children: "failed" }),
			" mirror reaches the browser as a down state; and both kolu and the linked drishti PR are green. ",
			createVNode(_components.a, {
				href: "https://github.com/juspay/kolu/issues/1564",
				children: "Issue #1564"
			}),
			" tracks it."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-follow-on-layer-clienthealth--one-complete-fact-two-policies",
			children: [
				"The follow-on layer: ",
				createVNode(_components.code, { children: "client.health()" }),
				" — one complete fact, two policies"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The connection cell above kills the ",
			createVNode(_components.em, { children: "one" }),
			" lie #1564 was filed for (a dead ",
			createVNode(_components.strong, { children: "mirror" }),
			" painting green). But it left a ",
			createVNode(_components.em, { children: "class" }),
			" of the same lie open one level down: a ",
			createVNode(_components.code, { children: "surfaceClient" }),
			" runs many subscriptions, and ",
			createVNode(_components.strong, { children: "any" }),
			" of them can be silently dead — a cell that 500s on resubscribe, a raw snapshot feed that stalled — while the surface still paints as if whole. The cell answers “is the ",
			createVNode(_components.strong, { children: "mirror" }),
			" up?”; it can’t answer “is ",
			createVNode(_components.strong, { children: "every subscription" }),
			" the browser depends on actually live?”. So the same review run grew a second, lower primitive: ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "client.health()" }) }),
			" — a ",
			createVNode(_components.em, { children: "total" }),
			" subscription-health ",
			createVNode(_components.strong, { children: "fact" }),
			", ",
			createVNode(_components.code, { children: "{ live: boolean, subs: [{ name, pending, error }] }" }),
			". Every framework subscription enrols at its birth site (cell, the keys-stream, each per-key value, a stream); a ",
			createVNode(_components.strong, { children: "raw" }),
			" stream joins ",
			createVNode(_components.strong, { children: "structurally" }),
			" through ",
			createVNode(_components.code, { children: "client.rawStream(name, proc, input, { onItem })" }),
			", which throws if driven outside a reactive owner — so a raw stream ",
			createVNode(_components.em, { children: "cannot" }),
			" silently escape the fact the way a hand-rolled loop could. Transport liveness is one leg, threaded by the socket owner: ",
			createVNode(_components.code, { children: "connectSurface" }),
			" passes ",
			createVNode(_components.code, { children: "{ live: () => status() === \"live\" }" }),
			" off its own ",
			createVNode(_components.code, { children: "createSocketStatus" }),
			", so ",
			createVNode(_components.code, { children: "health().live" }),
			" is the real socket state, not a constant ",
			createVNode(_components.code, { children: "true" }),
			" — and, as of the round-5 collapse, it carries ",
			createVNode(_components.em, { children: "more" }),
			" than the socket (see the callout below). The socket owner is now ",
			createVNode(_components.code, { children: "connectSurface" }),
			" (single-surface) or ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "connectSurfaces" }) }),
			" (the multi-surface seam: one socket → a ",
			createVNode(_components.code, { children: "surfaceClients" }),
			" bundle + one merged fact), each wiring a ",
			createVNode(_components.strong, { children: "default-on half-open heartbeat" }),
			" that probes the reserved ",
			createVNode(_components.code, { children: "system.live" }),
			", so ",
			createVNode(_components.code, { children: "live" }),
			" means ",
			createVNode(_components.em, { children: "bytes are flowing" }),
			", not merely ",
			createVNode(_components.em, { children: "no close event fired" }),
			" — a silent half-open ws reads not-live without any consumer hand-building a watchdog."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The fact carries ",
			createVNode(_components.strong, { children: "no triage" }),
			" — no “connecting vs degraded” verdict, no human string. That precedence is ",
			createVNode(_components.strong, { children: "policy" }),
			", and policy is a ",
			createVNode(_components.em, { children: "separate" }),
			" primitive: ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "<SurfaceGate>" }) }),
			", which derives ",
			createVNode(_components.code, { children: "connecting > degraded > ready" }),
			" from the fact in exactly one place. Its ",
			createVNode(_components.strong, { children: "default is stale-while-degraded" }),
			" (a sub erroring keeps the last-good children on screen, with a non-blocking notice) — the gentler of the two policies, and the right default for a fleet board; ",
			createVNode(_components.strong, { children: "hard-gating" }),
			" (blank the surface on any sub error) is the explicit opt-in. The split exists because two real consumers ",
			createVNode(_components.strong, { children: "disagree on the policy" }),
			", and a framework that bakes one in forces the other to hand-roll a parallel gate (the very thing #1564 was):"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "pulam-web hard-gates." }),
				" ",
				createVNode(_components.code, { children: "HostGroup" }),
				" mounts ",
				createVNode(_components.code, { children: "<SurfaceGate ready={hostBodyReady}>" }),
				" whose predicate is just ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "h.live && no sub errors" }) }),
				" — and as of round-5 ",
				createVNode(_components.code, { children: "h.live" }),
				" ",
				createVNode(_components.em, { children: "already carries the mirror state" }),
				": the ",
				createVNode(_components.code, { children: "connection" }),
				" cell’s ",
				createVNode(_components.code, { children: "liveWhen" }),
				" predicate AND-folds ",
				createVNode(_components.code, { children: "state === \"connected\"" }),
				" into ",
				createVNode(_components.code, { children: "live" }),
				" by construction (the callout below), so the gate no longer hand-ANDs ",
				createVNode(_components.code, { children: "connInfo.state === \"connected\"" }),
				". A half-open/reconnecting ws ",
				createVNode(_components.strong, { children: "or" }),
				" a non-",
				createVNode(_components.code, { children: "connected" }),
				" mirror both fail the gate closed off that one boolean. A ",
				createVNode(_components.em, { children: "persistent" }),
				" error must win over the body and never collapse to a healthy-looking empty host (the #1524 lesson), so it is the ",
				createVNode(_components.strong, { children: "outermost" }),
				" gate. (A ",
				createVNode(_components.em, { children: "transient" }),
				" error self-heals: each sub’s ",
				createVNode(_components.code, { children: "error()" }),
				" clears on its next frame, so the host recovers without a reload — the zest launchd-restart fix.) The same ",
				createVNode(_components.code, { children: "hostBodyReady" }),
				" predicate also governs the header dot, because the dot is now the shared ",
				createVNode(_components.code, { children: "<HostStatusPip>" }),
				" (callout below) — one verdict, gate and dot."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "drishti renders stale-while-degraded." }),
				" It mounts its OWN ",
				createVNode(_components.code, { children: "<SurfaceGate>" }),
				" with the framework ",
				createVNode(_components.strong, { children: "default" }),
				" policy (stale-while-degraded): a sub error or a transport blip keeps the body visible under a non-blocking amber notice, the opposite of pulam-web’s hard gate over the same fact. It joins its raw metric feed structurally via ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "app.rawStream" }) }),
				" (so the throw guards the real adopter, not just the example), and folds its admin-vs-app sibling clients into one fact with ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "surfaceClientsHealth" }) }),
				" (Leak D) — now threading the admin socket’s ",
				createVNode(_components.code, { children: "live" }),
				", so a dead control plane flips the merged fact, not a constant ",
				createVNode(_components.code, { children: "true" }),
				"."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Completing the fact: `live` folds the mirror, and the fact STILL stays `{live, subs}` (the third re-review)",
			children: [
				createVNode(_components.p, { children: [
					"Earlier rounds threaded the transport ",
					createVNode(_components.code, { children: "live" }),
					" but left each consumer to ",
					createVNode(_components.strong, { children: "hand-AND" }),
					" the mirror state — pulam-web’s gate was ",
					createVNode(_components.code, { children: "app.health().live && connInfo.state === \"connected\"" }),
					", drishti’s dot read the raw cell. A third re-review named that for what it is: the ",
					createVNode(_components.em, { children: "same lie waiting to relocate" }),
					". A hand-AND is forgettable, and drishti’s per-host dot ",
					createVNode(_components.strong, { children: "forgot it" }),
					" — green over a dead mirror, the #1564 lie one viewer over. The cure is not “fold the missing leg in at one more consumer” (whack-a-mole against forgetting); it is to ",
					createVNode(_components.strong, { children: "complete the fact" }),
					" so the partial signal is unrenderable."
				] }),
				createVNode(_components.p, { children: [
					"So ",
					createVNode(_components.code, { children: "health().live" }),
					" now folds the mirror’s readiness ",
					createVNode(_components.strong, { children: "by construction" }),
					" — ",
					createVNode(_components.em, { children: "without" }),
					" dragging the ssh vocabulary into the core. A generic ",
					createVNode(_components.code, { children: "CellSpec.liveWhen?: (value) => boolean" }),
					" hook marks a cell a ",
					createVNode(_components.strong, { children: "readiness gate" }),
					"; ",
					createVNode(_components.code, { children: "surfaceClient" }),
					" AND-folds its predicate into ",
					createVNode(_components.code, { children: "live" }),
					" via an ",
					createVNode(_components.strong, { children: "eager" }),
					" build-time standing subscription (so a dot-only viewer that never ",
					createVNode(_components.code, { children: ".use()" }),
					"s the cell still reads the complete fact — the fold is ",
					createVNode(_components.em, { children: "not" }),
					" ",
					createVNode(_components.code, { children: ".use()" }),
					"-conditional). The ",
					createVNode(_components.code, { children: "connection" }),
					" cell declares ",
					createVNode(_components.code, { children: "liveWhen: (v) => v.state === \"connected\"" }),
					" ",
					createVNode(_components.strong, { children: ["in ", createVNode(_components.code, { children: "@kolu/surface-nix-host" })] }),
					", beside the schema it reads — so the four-state ssh vocabulary (",
					createVNode(_components.code, { children: "copying" }),
					"/",
					createVNode(_components.code, { children: "connecting" }),
					"/",
					createVNode(_components.code, { children: "connected" }),
					"/",
					createVNode(_components.code, { children: "disconnected" }),
					"/",
					createVNode(_components.code, { children: "failed" }),
					") stays exactly where it lived, and ",
					createVNode(_components.code, { children: "@kolu/surface" }),
					" only ",
					createVNode(_components.em, { children: "invokes" }),
					" the predicate (the runtime sibling of ",
					createVNode(_components.code, { children: "CellSpec.equals" }),
					" / ",
					createVNode(_components.code, { children: "resolveCellVerbs" }),
					": core owns the mechanism, the plug owns the meaning). The fact’s ",
					createVNode(_components.strong, { children: "shape is unchanged" }),
					" (",
					createVNode(_components.code, { children: "{live, subs}" }),
					"); only ",
					createVNode(_components.code, { children: "live" }),
					"’s meaning widened from “transport open” to “transport ∧ every readiness leg.” It is the client-side ",
					createVNode(_components.strong, { children: "symmetry" }),
					" to ",
					createVNode(_components.code, { children: "pumpRemoteSurface" }),
					" auto-wiring the server ",
					createVNode(_components.em, { children: "write" }),
					" (",
					createVNode(_components.code, { children: "pipeSessionStateToCell" }),
					"): composing the mirror seam now entails the write (populate the cell), the read (fold it into ",
					createVNode(_components.code, { children: "live" }),
					"), and the display — all by construction. No ",
					createVNode(_components.code, { children: "source" }),
					" discriminant, no ssh vocabulary, ever entered the transport-agnostic core; the earlier round’s ",
					createVNode(_components.em, { children: "location-is-structure" }),
					" boundary holds, the boolean just stopped being something each consumer re-derives."
				] }),
				createVNode(_components.p, { children: [
					"The earlier note’s distinction survives ",
					createVNode(_components.strong, { children: "intact" }),
					": the BOOLEAN readiness now lives in the fact (no consumer re-ANDs it), while the RICHER four-state vocabulary — ",
					createVNode(_components.em, { children: "which" }),
					" leg died, ",
					createVNode(_components.strong, { children: "reload" }),
					" (",
					createVNode(_components.code, { children: "down" }),
					") vs ",
					createVNode(_components.strong, { children: "Reconnect" }),
					" (",
					createVNode(_components.code, { children: "failed" }),
					" mirror) — stays app-local in pulam-web’s ",
					createVNode(_components.code, { children: "effectiveHealth" }),
					" for ",
					createVNode(_components.strong, { children: "presentation" }),
					". The header dot is now the framework ",
					createVNode(_components.strong, { children: createVNode(_components.code, { children: "<HostStatusPip health={…}>" }) }),
					" (rendered by BOTH viewers), whose ",
					createVNode(_components.strong, { children: "green" }),
					" is ",
					createVNode(_components.em, { children: "only" }),
					" the fact’s readiness verdict — there is no raw-state prop, so a stale ",
					createVNode(_components.code, { children: "connected" }),
					" cell can no longer color a dot green over a dead link — with pulam-web’s rich five-state color supplied as its ",
					createVNode(_components.code, { children: "notReadyTone" }),
					", and ",
					createVNode(_components.code, { children: "gateStatus" }),
					" shared with ",
					createVNode(_components.code, { children: "<SurfaceGate>" }),
					" so the dot’s green and the body’s “show it” are provably one decision. The fact stays ",
					createVNode(_components.code, { children: "{live, subs}" }),
					"; what changed is that ",
					createVNode(_components.code, { children: "live" }),
					" finally carries the ",
					createVNode(_components.em, { children: "whole" }),
					" “is it connected?” truth, and there is ",
					createVNode(_components.strong, { children: "one" }),
					" such value no widget can read half of."
				] })
			]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Every producer is now consumed (the second re-review)",
			children: [createVNode(_components.p, { children: [
				"A first pass threaded the ",
				createVNode(_components.code, { children: "live" }),
				" leg and built the structural ",
				createVNode(_components.code, { children: "client.rawStream" }),
				" — but a second re-review caught that ",
				createVNode(_components.strong, { children: "nothing drank from either" }),
				": every gate routed ",
				createVNode(_components.em, { children: "around" }),
				" the new liveness, and the one shipping adopter (drishti) bypassed the structural throw with a hand-enrolled bare stream. Producers without consumers are plumbing, not a fix. So this pass wires the faucets:"
			] }), createVNode(_components.ul, { children: [
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: [
						"A real gate reads ",
						createVNode(_components.code, { children: "health().live" }),
						"."
					] }),
					" pulam-web’s body gate (above), the example’s ",
					createVNode(_components.code, { children: "<SurfaceGate ready={(h) => h.live && …}>" }),
					", and drishti’s ",
					createVNode(_components.code, { children: "surfaceClientsHealth(...).live" }),
					" control-plane strip all consume the threaded leg — and ",
					createVNode(_components.code, { children: "surfaceClients" }),
					" now takes a ",
					createVNode(_components.code, { children: "{ live }" }),
					" it AND-reduces, so a multi-surface fact is no longer structurally constant-true. A ",
					createVNode(_components.code, { children: "connectSurface" }),
					"-driven test (a mocked socket, not a hand-rebuilt predicate) goes red if the thread is reverted."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "The shipping adopter uses the structural path." }),
					" drishti’s ",
					createVNode(_components.code, { children: "metricHistory" }),
					" moved to ",
					createVNode(_components.code, { children: "app.rawStream" }),
					"; the bare ",
					createVNode(_components.code, { children: "@kolu/surface/client" }),
					" export was renamed ",
					createVNode(_components.strong, { children: createVNode(_components.code, { children: "unenrolledStreamCall" }) }),
					" so the one genuinely-exempt root stream (the terminal ",
					createVNode(_components.code, { children: "attach" }),
					") and a ",
					createVNode(_components.code, { children: "createSubscription" }),
					" factory ",
					createVNode(_components.em, { children: "self-flag" }),
					" as deliberately-unenrolled — a hand-enrol can no longer read as a forgotten one."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "The default fails soft on a blip." }),
					" ",
					createVNode(_components.code, { children: "<SurfaceGate>" }),
					"’s default gained a one-way ",
					createVNode(_components.em, { children: "has-painted" }),
					" latch: after the first ready frame a transport drop renders ",
					createVNode(_components.strong, { children: "stale-while-reconnecting" }),
					" (last-good children + a notice) instead of hard-blanking — only a cold connect blocks. And drishti is now a real component-level ",
					createVNode(_components.code, { children: "<SurfaceGate>" }),
					" ",
					createVNode(_components.em, { children: "adopter" }),
					" (not just a fact-consumer), so the two-policy premise holds at the component level too."
				] }),
				"\n"
			] })]
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
	"title": "pulam-web: a dead mirror lies as an empty fleet — surface the connection",
	"description": "pulam-web shows a green connected dot + no terminals when the backend↔remote ssh mirror is actually down/failed (build mismatch, unreachable host). Root cause — the browser only ever sees its own socket health, never the mirror's. Fix (one PR) — graduate a thin onState→cell projection into @kolu/surface-nix-host, declare a gate-closed connection cell on the surface, pipe the session's health into it, and gate the browser UI on it (drishti's proven shape, now shared).",
	"parents": ["pulam-web", "bug"],
	"status": "implemented",
	"maturity": "seedling",
	"updated": "2026-06-25T00:00:00.000Z"
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
			"depth": 2,
			"slug": "the-follow-on-layer-clienthealth--one-complete-fact-two-policies",
			"text": "The follow-on layer: client.health() — one complete fact, two policies"
		}
	];
}
var url = "src/content/atlas/pulam-web-mirror-health.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/pulam-web-mirror-health.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/pulam-web-mirror-health.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { BeforeAfter, Body, Card, Content, Content as default, Dot, PAL, file, frontmatter, getHeadings, url };
