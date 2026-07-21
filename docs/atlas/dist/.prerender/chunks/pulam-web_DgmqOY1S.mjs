import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$D2 } from "./D2_CPv-UX0x.mjs";
import "./Pill_DD4u2LYa.mjs";
import { t as $$Phase } from "./Phase_Ctvqq2QS.mjs";
//#region src/content/atlas/pulam-web.mdx
var UIPAL = {
	txt: "#c8d0de",
	sub: "#8b94a6",
	dim: "#5b6678",
	green: "#7ec699",
	amber: "#e6a23c",
	cyan: "#56b6c2",
	red: "#e06c75",
	violet: "#a78bfa"
};
var ARow = ({ agent, where, dirty, clean, state, when, active }) => {
	const c = state === "need" ? UIPAL.amber : state === "work" ? UIPAL.cyan : UIPAL.dim;
	const g = state === "need" ? "●" : state === "work" ? "◜" : "○";
	const label = state === "need" ? "needs you" : state === "work" ? "working" : "idle";
	return createVNode("div", {
		style: `display:flex;align-items:center;gap:.6rem;padding:.26rem .5rem;border-radius:6px;${state === "need" ? "background:rgba(230,162,60,.1);" : ""}`,
		children: [
			createVNode("span", {
				class: active ? "pw-blink" : "",
				title: "moving bytes",
				style: `width:.8ch;flex:none;font-size:.7em;color:${active ? UIPAL.green : "#262b38"}`,
				children: "●"
			}),
			createVNode("span", {
				class: state === "need" ? "pw-pulse" : state === "work" ? "pw-spin" : "",
				style: `color:${c};width:1.3ch;flex:none`,
				children: g
			}),
			createVNode("span", {
				style: `color:${UIPAL.txt};width:6.5ch;flex:none`,
				children: agent
			}),
			createVNode("span", {
				style: `color:${UIPAL.sub};flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`,
				children: where
			}),
			createVNode("span", {
				style: `color:${clean ? UIPAL.dim : UIPAL.amber};width:3.5ch;flex:none;font-size:.82em`,
				children: clean ? "✓" : `✎${dirty}`
			}),
			createVNode("span", {
				style: `color:${c};width:8ch;flex:none;font-size:.85em`,
				children: label
			}),
			createVNode("span", {
				style: `color:${UIPAL.dim};width:3.5ch;text-align:right;flex:none;font-size:.82em`,
				children: when
			})
		]
	});
};
var Grp = ({ host, n, ssh, children }) => createVNode("div", {
	style: "margin:.35rem 0 .1rem",
	children: [createVNode("div", {
		style: "display:flex;gap:.4rem;align-items:center;font-size:.78em;padding:0 .45rem .12rem",
		children: [
			createVNode("span", {
				style: "color:#a78bfa",
				children: "▌"
			}),
			createVNode("span", {
				style: "color:#aeb7c7;font-weight:600",
				children: host
			}),
			createVNode("span", {
				style: "color:#5b6678",
				children: ["· ", n]
			}),
			ssh && createVNode("span", {
				style: "color:#7fb0ff;border:1px solid #38507a;border-radius:3px;padding:0 .3ch;font-size:.82em",
				children: "ssh"
			})
		]
	}), children]
});
var PulamWebUI = () => createVNode("div", {
	style: "font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:#0f1117;border:1px solid #05070b;border-radius:11px;overflow:hidden;margin:1.2rem 0;box-shadow:0 12px 36px rgba(0,0,0,.45);max-width:44rem",
	children: [
		createVNode("div", {
			style: "display:flex;align-items:center;gap:.5rem;padding:.45rem .7rem;background:#0b0d12;border-bottom:1px solid #222838",
			children: [
				createVNode("span", { style: "width:11px;height:11px;border-radius:50%;background:#ff5f56" }),
				createVNode("span", { style: "width:11px;height:11px;border-radius:50%;background:#ffbd2e" }),
				createVNode("span", { style: "width:11px;height:11px;border-radius:50%;background:#27c93f" }),
				createVNode("span", {
					style: "margin-left:.5rem;flex:1;background:#161922;border:1px solid #2a2f3a;border-radius:6px;padding:.16rem .6rem;color:#6b7488;font-size:.8em",
					children: "pulam.local — every agent, every host"
				}),
				createVNode("span", {
					style: "color:#5b6678;font-size:.78em",
					children: "⟳ live"
				})
			]
		}),
		createVNode("div", {
			style: "display:flex;align-items:center;gap:.4rem;padding:.4rem .7rem;background:#0d0f15;border-bottom:1px solid #1c2231",
			children: [
				createVNode("span", {
					style: "color:#5b6678;font-size:.78em;margin-right:.15rem",
					children: "hosts"
				}),
				createVNode("span", {
					style: "display:inline-flex;align-items:center;gap:.4ch;padding:.16rem .55rem;border-radius:6px;background:rgba(126,198,153,.13);border:1px solid rgba(126,198,153,.4);color:#c8d0de;font-size:.8em",
					children: [createVNode("span", { style: "width:6px;height:6px;border-radius:50%;background:#7ec699" }), "local"]
				}),
				createVNode("span", {
					style: "display:inline-flex;align-items:center;gap:.4ch;padding:.16rem .55rem;border-radius:6px;background:rgba(167,139,250,.12);border:1px solid rgba(167,139,250,.4);color:#c8d0de;font-size:.8em",
					children: [
						createVNode("span", { style: "width:6px;height:6px;border-radius:50%;background:#a78bfa" }),
						"nix@prod ",
						createVNode("span", {
							style: "color:#7fb0ff;border:1px solid #38507a;border-radius:3px;padding:0 .3ch;font-size:.85em",
							children: "ssh"
						})
					]
				}),
				createVNode("span", {
					style: "display:inline-flex;align-items:center;gap:.4ch;padding:.16rem .55rem;border-radius:6px;color:#5b6678;font-size:.8em",
					children: [
						createVNode("span", { style: "width:6px;height:6px;border-radius:50%;background:#e6a23c" }),
						"staging ",
						createVNode("span", {
							style: "font-size:.8em;color:#7a5a24",
							children: "copying…"
						})
					]
				}),
				createVNode("span", {
					style: "color:#3f4858;font-size:.8em",
					children: "+ host"
				})
			]
		}),
		createVNode("div", {
			style: "padding:.5rem .55rem .65rem",
			children: [
				createVNode("div", {
					class: "pw-pulse",
					style: "display:flex;align-items:center;gap:.5rem;margin:.1rem .1rem .45rem;padding:.32rem .55rem;border-radius:7px;background:rgba(230,162,60,.14);border:1px solid rgba(230,162,60,.42);color:#f0b860",
					children: [
						createVNode("span", {
							style: "font-size:1.05em",
							children: "●"
						}),
						createVNode("span", {
							style: "font-weight:600",
							children: "2 agents need you"
						}),
						createVNode("span", {
							style: "color:#b9863a",
							children: "— zest · nix@prod"
						})
					]
				}),
				createVNode(Grp, {
					host: "zest",
					n: "3 agents",
					children: [
						createVNode(ARow, {
							agent: "claude",
							where: "kolu · feat/dial-ssh   #1412 ✓",
							dirty: 5,
							state: "need",
							when: "3s"
						}),
						createVNode(ARow, {
							agent: "codex",
							where: "drishti · master",
							clean: true,
							state: "work",
							when: "0s",
							active: true
						}),
						createVNode(ARow, {
							agent: "claude",
							where: "anyforge · fix/checks   #1408 ✗",
							dirty: 5,
							state: "work",
							when: "4s",
							active: true
						})
					]
				}),
				createVNode(Grp, {
					host: "nix@prod",
					n: "2 agents",
					ssh: true,
					children: [createVNode(ARow, {
						agent: "claude",
						where: "kolu · fix/heap-oom   #1427 ✓",
						dirty: 2,
						state: "need",
						when: "9s"
					}), createVNode(ARow, {
						agent: "claude",
						where: "infra · deploy",
						dirty: 2,
						state: "work",
						when: "1s",
						active: true
					})]
				}),
				createVNode("div", {
					style: "display:flex;gap:.4rem;align-items:center;font-size:.78em;padding:.3rem .45rem .1rem;color:#5b6678",
					children: [
						createVNode("span", {
							style: "color:#a78bfa",
							children: "▌"
						}),
						createVNode("span", {
							style: "color:#7c8395",
							children: "staging"
						}),
						createVNode("span", {
							style: "color:#7a5a24",
							children: "· provisioning…"
						})
					]
				}),
				createVNode("div", {
					style: "display:flex;gap:.8rem;align-items:center;margin:.5rem .15rem 0;padding-top:.42rem;border-top:1px solid #1c2231;font-size:.82em",
					children: [
						createVNode("span", {
							style: "color:#94a3b8",
							children: ["showing ", createVNode("b", {
								style: "color:#c8d0de",
								children: "agents"
							})]
						}),
						createVNode("span", {
							style: "color:#475569",
							children: "+ idle"
						}),
						createVNode("span", {
							style: "color:#475569",
							children: "+ non-agent terminals"
						}),
						createVNode("span", {
							style: "color:#475569",
							children: "+ sleeping"
						}),
						createVNode("span", {
							style: "margin-left:auto;color:#e6a23c",
							children: "● 2 need you"
						}),
						createVNode("span", {
							style: "color:#56b6c2",
							children: "◜ 3 working"
						})
					]
				})
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
				"pulam-web is ",
				createVNode(_components.a, {
					href: "electricity.html",
					children: "drishti"
				}),
				"’s twin, pointed at the terminal-workspace surface."
			] }),
			" Where drishti monitors per-host ",
			createVNode(_components.em, { children: "processes" }),
			" in a browser, pulam-web is an ",
			createVNode(_components.strong, { children: "agent dashboard" }),
			" — a bird’s-eye view of ",
			createVNode(_components.strong, { children: "every agent across every host, sorted by what needs you" }),
			" (needs-you · working · idle), auto-provisioned over ssh. It’s the ",
			createVNode(_components.code, { children: "pulam-tui" }),
			" fleet board, in a browser. And on top of being a real product, it earns its engineering keep: it is ",
			createVNode(_components.strong, { children: "kolu’s own browser-consumption leg, minus kolu" }),
			" — ",
			createVNode(_components.code, { children: "websocketLink" }),
			" → ",
			createVNode(_components.code, { children: "surfaceClient" }),
			" → Solid ",
			createVNode(_components.code, { children: "reconcile" }),
			" — so it de-risks the remote-consumption leg ",
			createVNode(_components.a, {
				href: "remote-terminals.html#r9",
				children: ["remote-terminals ", createVNode(_components.strong, { children: "R9" })]
			}),
			" leans on, in a build whose console you can actually see."
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
.pw-pulse { animation: pwpulse 1.8s ease-in-out infinite; }
@keyframes pwpulse { 0%, 100% { opacity: 1 } 50% { opacity: .5 } }
.pw-spin { display:inline-block; animation: pwspin 1.1s linear infinite; transform-origin: 50% 54%; }
@keyframes pwspin { to { transform: rotate(360deg) } }
.pw-blink { animation: pwblink 1.4s ease-in-out infinite; }
@keyframes pwblink { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }
` }),
		"\n",
		createVNode(PulamWebUI, {}),
		"\n",
		createVNode(_components.p, { children: [
			"Leave it open on a second monitor: ",
			createVNode(_components.strong, { children: "every agent across every host, sorted by what needs you." }),
			" A blocked agent (",
			createVNode(_components.code, { children: "awaiting_user" }),
			") floats to the top and a warm strip ",
			createVNode(_components.strong, { children: "breathes" }),
			", so a glance tells you ",
			createVNode(_components.em, { children: "someone’s waiting" }),
			" before you’ve read a word; working agents spin cyan, idle ones sit dim. Each row carries a ",
			createVNode(_components.strong, { children: "green activity dot" }),
			" when it’s moving bytes right now (like the Dock), its ",
			createVNode(_components.code, { children: "repo · branch" }),
			", a compact ",
			createVNode(_components.strong, { children: "dirty/clean" }),
			" mark, and how long it’s been in that state. You don’t care about terminals ",
			createVNode(_components.em, { children: "not" }),
			" running an agent, or sleeping ones — so they’re ",
			createVNode(_components.strong, { children: "hidden by default" }),
			", with one-click toggles to fold them back in. Hosts are added on demand and auto-provisioned over ssh (the ",
			createVNode(_components.code, { children: "provisioning…" }),
			" row is the live state), so a teammate opens one URL and watches the whole fleet. The per-agent ",
			createVNode(_components.strong, { children: "git drill-in" }),
			" — a live changed-file tree — is the one heavier piece; it’s split out as ",
			createVNode(_components.strong, { children: createVNode(_components.a, {
				href: "#r-pulamweb-4",
				children: "R-pulamweb-4"
			}) }),
			"."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "What's shipped vs the picture above",
			children: createVNode(_components.p, { children: [
				"Shipped through ",
				createVNode(_components.strong, { children: "R-pulamweb-3" }),
				" (",
				createVNode($$PrLink, { pr: 1535 }),
				"): the ",
				createVNode(_components.strong, { children: "agent dashboard" }),
				" — every agent bucketed and sorted needs-you-first, the breathing alert, the colour-coded states, the green ",
				createVNode(_components.strong, { children: "activity dot" }),
				", and the agent/idle/non-agent/sleeping toggles, all over the live ws. The two cells in the picture that are ",
				createVNode(_components.strong, { children: "not" }),
				" yet live are the per-agent git ",
				createVNode(_components.strong, { children: "dirty/clean mark" }),
				" (the ",
				createVNode(_components.code, { children: "✎5" }),
				" / ",
				createVNode(_components.code, { children: "✓" }),
				") and the ",
				createVNode(_components.strong, { children: "drill-in" }),
				" pane — both need ",
				createVNode(_components.code, { children: "git.getStatus" }),
				" (the awareness ",
				createVNode(_components.code, { children: "git" }),
				" info carries only repo·branch), so they land together in ",
				createVNode(_components.strong, { children: createVNode(_components.a, {
					href: "#r-pulamweb-4",
					children: "R-pulamweb-4"
				}) }),
				"."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "architecture-level-changes",
			children: "Architecture-level changes"
		}),
		"\n",
		createVNode($$D2, {
			caption: "pulam-web is browser ↔ backend ↔ N pulam over ssh. The backend auto-provisions + mirrors each remote pulam via the shared @kolu/surface-nix-host helpers (getHostSession + pumpRemoteSurface, keyed by buildHostRegistry), re-serves the whole terminalWorkspaceSurface per host, and dispatches one /rpc/ws?host= per host to its oRPC RPCHandler. The browser reads it through websocketLink + surfaceClient + Solid reconcile — the SAME @kolu/surface code kolu's own Code tab uses, which is why a green pulam-web proves kolu's R9 remote-consumption leg. Green = shipped @kolu/* primitives reused as-is; teal = the newly-shared fan-out helpers (drishti adopts them too); violet = the app-local pulam-web wiring (re-serve + ws-upgrade).",
			code: `direction: down
classes: {
cli: { style.fill: "#eef0f2"; style.stroke: "#d9dde2"; style.font-color: "#475569" }
new: { style.fill: "#efebff"; style.stroke: "#d4cbff"; style.font-color: "#5a3ff0" }
ship: { style.fill: "#e6f4ea"; style.stroke: "#bce3c8"; style.font-color: "#15803d" }
shared: { style.fill: "#e0f2f1"; style.stroke: "#a7d8d4"; style.font-color: "#0f766e" }
host: { style.fill: "#f1f5f9"; style.stroke: "#e2e8f0"; style.font-color: "#475569" }
}
browser: "browser (SolidJS)\\nsurfaceClient(websocketLink) · .collections.snapshots.use() + reconcile" { class: cli }
be: "pulam-web backend (Node)\\napp-local re-serve + ws-upgrade · RPCHandler.upgrade per /rpc/ws?host=" { class: new }
agg: "@kolu/surface-nix-host (NEW shared)\\nbuildHostRegistry · pumpRemoteSurface (drishti adopts too)" { class: shared }
mirror: "per host: getHostSession (reconnecting)\\nmirrorRemoteSurface → re-serve whole surface" { class: ship }
pulam1: "pulam (host A) — terminal-workspace surface" { class: host }
pulam2: "pulam (host B) — terminal-workspace surface" { class: host }
browser -> be: "ws · oRPC (kolu's exact leg)"
be -> agg: "fans out via"
agg -> mirror: "drives"
mirror -> pulam1: "ssh stdio · nix copy --derivation"
mirror -> pulam2: "ssh stdio"
`
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"It is the same ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				" code kolu and drishti run — that is the whole point."
			] }),
			" Serve side: ",
			createVNode(_components.code, { children: "implementSurface" }),
			" → oRPC ",
			createVNode(_components.code, { children: "RPCHandler" }),
			" (",
			createVNode(_components.code, { children: "@orpc/server/ws" }),
			") → ",
			createVNode(_components.code, { children: "handler.upgrade(ws)" }),
			" on a ",
			createVNode(_components.code, { children: "/rpc/ws" }),
			" socket. Consume side: ",
			createVNode(_components.code, { children: "websocketLink" }),
			" → ",
			createVNode(_components.code, { children: "surfaceClient" }),
			"/",
			createVNode(_components.code, { children: "surfaceClients" }),
			" → the reactive ",
			createVNode(_components.code, { children: ".use()" }),
			" hooks (",
			createVNode(_components.code, { children: "surfaceClient.ts" }),
			" owns snapshot-then-deltas + ",
			createVNode(_components.code, { children: "reconcile" }),
			"). drishti proves this trio is electricity; kolu’s Code tab proves ",
			createVNode(_components.code, { children: ".streams.use()" }),
			" for a ",
			createVNode(_components.strong, { children: "value-bearing" }),
			" ",
			createVNode(_components.code, { children: "gitStatus" }),
			" stream. pulam-web is the first ",
			createVNode(_components.em, { children: "standalone" }),
			" app to put those together — a live surface ",
			createVNode(_components.strong, { children: [
				"consumed over ",
				createVNode(_components.code, { children: "surfaceClient" }),
				" sourced from a mirror"
			] }),
			", the exact remote leg R9 needs. R-pulamweb-3 proves it with the value-bearing ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "activity" }) }),
			" stream (the live dot); the ",
			createVNode(_components.strong, { children: "git status" }),
			" leg — ",
			createVNode(_components.code, { children: "git.getStatus" }),
			" re-queried on the ",
			createVNode(_components.code, { children: "subscribeRepoChange" }),
			" pulse, the same shape R9’s Code tab adopts — is R-pulamweb-4’s, where it ships with the drill-in."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Node, matching kolu’s own stack." }),
			" The surface leg is identical ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" code on any runtime — drishti even writes its server Node-style (",
			createVNode(_components.code, { children: "@hono/node-server" }),
			" + the ",
			createVNode(_components.code, { children: "ws" }),
			" package) and runs it on Bun ",
			createVNode(_components.em, { children: "only" }),
			" for its ",
			createVNode(_components.code, { children: "Bun.build" }),
			" client bundler. We go ",
			createVNode(_components.strong, { children: "Node" }),
			", like kolu-server, and bundle the SolidJS frontend with ",
			createVNode(_components.strong, { children: ["Vite + ", createVNode(_components.code, { children: "vite-plugin-solid" })] }),
			" (kolu’s own client toolchain) rather than drishti’s ",
			createVNode(_components.code, { children: "Bun.build" }),
			" — so pulam-web is kolu’s stack end-to-end."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Common it up — what graduates to the surface family, what stays app-local (grounded)",
			children: [
				createVNode(_components.p, { children: [
					"The directive was ",
					createVNode(_components.em, { children: "don’t replicate drishti’s plumbing into pulam-web — upstream the common stuff" }),
					". Grounding both apps against the installed code drew the line precisely:"
				] }),
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: [
							"What graduates — the per-host mirror-bridge + registry → ",
							createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
							"."
						] }),
						" drishti’s ",
						createVNode(_components.code, { children: "bridgeAgentToParent" }),
						" (a ",
						createVNode(_components.code, { children: "makeClientCursor" }),
						" reconnect loop re-issuing ",
						createVNode(_components.code, { children: "mirrorRemoteSurface" }),
						" per spawn + a live-procedure forwarding holder) and its ",
						createVNode(_components.code, { children: "hostRegistry" }),
						" (",
						createVNode(_components.code, { children: "Map<host,{session,handler}>" }),
						") are ~600 lines pulam-web would otherwise copy verbatim. They graduate as ",
						createVNode(_components.code, { children: "pumpRemoteSurface" }),
						" + ",
						createVNode(_components.code, { children: "buildHostRegistry" }),
						" — the ",
						createVNode(_components.strong, { children: "N-host, consume-side companions" }),
						" to nix-host’s ",
						createVNode(_components.em, { children: "existing" }),
						" ",
						createVNode(_components.code, { children: "makeClientCursor" }),
						" + ",
						createVNode(_components.code, { children: "getHostSession" }),
						", with ",
						createVNode(_components.strong, { children: "zero new deps" }),
						" (the registry stays generic over the handler type, so no ",
						createVNode(_components.code, { children: "@orpc/server/ws" }),
						" in nix-host). Both apps consume one copy."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "What stays app-local — the ws-serve upgrade block." }),
						" It is ",
						createVNode(_components.em, { children: "not" }),
						" the right thing to extract: ",
						createVNode(_components.code, { children: "@kolu/surface" }),
						" core has no ",
						createVNode(_components.code, { children: "ws" }),
						" dep (putting a ",
						createVNode(_components.code, { children: "WebSocketServer" }),
						" helper there inverts its transport-agnostic boundary — a defect per ",
						createVNode(_components.a, {
							href: "electricity.html",
							children: "electricity"
						}),
						"), and drishti’s real handler validates ",
						createVNode(_components.code, { children: "?host=" }),
						" and ",
						createVNode(_components.code, { children: "destroy()" }),
						"s the raw socket ",
						createVNode(_components.em, { children: "before" }),
						" ",
						createVNode(_components.code, { children: "handleUpgrade" }),
						", plus dispatches an ",
						createVNode(_components.code, { children: "__admin__" }),
						" sentinel to a second handler — neither fits a generic ",
						createVNode(_components.code, { children: "onConnection(ws)" }),
						" seam. So each app keeps its ~18-line upgrade block, composed from the ",
						createVNode(_components.strong, { children: "already-shared" }),
						" ",
						createVNode(_components.code, { children: "gateWsOrigin" }),
						" (",
						createVNode(_components.code, { children: "@kolu/surface/ws-origin" }),
						") + ",
						createVNode(_components.code, { children: "gateStaleSocket" }),
						" + ",
						createVNode(_components.code, { children: "startWsHeartbeat" }),
						" (",
						createVNode(_components.code, { children: "@kolu/surface-app/server" }),
						")."
					] }),
					"\n"
				] }),
				createVNode(_components.p, { children: [
					"So the extraction is drishti’s own proven code lifted up — drishti’s adoption is a near-mechanical swap whose green CI proves the lift was behaviour-preserving (the same way ",
					createVNode(_components.code, { children: "gateStaleSocket" }),
					" was already extracted from drishti)."
				] })
			]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "How git status reaches the browser — consume the surface's procedure + pulse",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
				" serves git status as a ",
				createVNode(_components.code, { children: "git.getStatus" }),
				" ",
				createVNode(_components.strong, { children: "procedure" }),
				" + a ",
				createVNode(_components.code, { children: "subscribeRepoChange" }),
				" ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "{seq}" }), " pulse"] }),
				" — a deliberate choice for the remote/ssh case (don’t stream full diffs over the wire; send a tiny pulse, re-query on demand). pulam-web ",
				createVNode(_components.strong, { children: "consumes that as-is" }),
				": call the procedure for a snapshot, then re-query on each pulse. (kolu’s ",
				createVNode(_components.em, { children: "in-process" }),
				" ",
				createVNode(_components.code, { children: "koluSurface" }),
				" wraps the same endpoint into a ",
				createVNode(_components.em, { children: "value-bearing" }),
				" stream via ",
				createVNode(_components.code, { children: "pollOnEvent" }),
				" — the other shape — but that’s kolu’s local choice, not the shared surface’s; wrapping one into pulam-web would be inventing an app-local surface, which defeats the point. The two shapes are explained in ",
				createVNode(_components.a, {
					href: "surface-live-data.html",
					children: "surface live data"
				}),
				".) This is the exact remote git leg ",
				createVNode(_components.strong, { children: "R9" }),
				"’s Code tab adopts, so a green pulam-web de-risks it."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "implementation-details",
			children: "Implementation details"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Three steps, each isolating ",
			createVNode(_components.strong, { children: "one" }),
			" risk. ",
			createVNode(_components.strong, { children: "R-pulamweb-1 (in drishti)" }),
			" graduates the reactive ",
			createVNode(_components.em, { children: "stream" }),
			" consumer — kolu’s failing leg — on its own. ",
			createVNode(_components.strong, { children: "R-pulamweb-2" }),
			" stands up the ",
			createVNode(_components.em, { children: "entire framework" }),
			" (provision · dial · fan-out · mirror · re-serve · browser-consume) rendering ",
			createVNode(_components.strong, { children: "only a terminal list" }),
			" — no features, so a plumbing failure has nowhere to hide. ",
			createVNode(_components.strong, { children: "R-pulamweb-3" }),
			" is the agent dashboard — a render/sort/filter layer over the snapshots collection plus the value-bearing ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "activity" }) }),
			" stream (R-pulamweb-1’s proven ",
			createVNode(_components.code, { children: ".streams.use()" }),
			" consumer); ",
			createVNode(_components.strong, { children: "R-pulamweb-4" }),
			" adds the live git status (the dirty/clean cell) and the file-tree drill-in. ",
			createVNode(_components.strong, { children: "R-pulamweb-1 and R-pulamweb-2 are independent" }),
			" (one’s a drishti change, the other a fresh app); ",
			createVNode(_components.strong, { children: "R-pulamweb-3 needs both" }),
			"; ",
			createVNode(_components.strong, { children: "R-pulamweb-4 needs R-pulamweb-3" }),
			" and de-risks ",
			createVNode(_components.strong, { children: "R9" }),
			"’s remote git leg."
		] }),
		"\n",
		createVNode("a", { id: "r-pulamweb-1" }),
		"\n",
		createVNode(_components.h3, {
			id: "r-pulamweb-1--the-reactive-stream-consumer-in-drishti--shipped",
			children: "R-pulamweb-1 — the reactive stream consumer, in drishti ✅ shipped"
		}),
		"\n",
		createVNode($$Phase, {
			id: "R-pulamweb-1",
			name: "reactive stream consumer (drishti)",
			status: "shipped",
			blocks: ["R-pulamweb-3"],
			links: [{
				label: "drishti #72",
				href: "https://github.com/srid/drishti/pull/72"
			}]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped" }),
			" (",
			createVNode(_components.a, {
				href: "https://github.com/srid/drishti/pull/72",
				children: "drishti #72"
			}),
			"). Before pulam-web exists, prove its riskiest piece — a reactive stream consumer that survives delta accumulation — where the browser ⇄ ssh ⇄ mirror stack already runs: ",
			createVNode(_components.strong, { children: "drishti" }),
			". drishti’s ",
			createVNode(_components.code, { children: "processesSnapshot" }),
			" (",
			createVNode(_components.code, { children: "packages/common/src/surface.ts" }),
			") is mirrored per host and was consumed ",
			createVNode(_components.strong, { children: "imperatively" }),
			" — ",
			createVNode(_components.code, { children: "unenrolledStreamCall(app.rpc.surface.processesSnapshot.get)" }),
			" + ",
			createVNode(_components.code, { children: "for await" }),
			" + a teardown controller. This graduates that one call site to a declarative reactive subscription. The exercise surfaced the trap that ",
			createVNode(_components.strong, { children: "is" }),
			" R9’s lesson:"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: ".streams.use()" }),
				" is for ",
				createVNode(_components.em, { children: "value-bearing" }),
				" streams; ",
				createVNode(_components.code, { children: "processesSnapshot" }),
				" is ",
				createVNode(_components.em, { children: "delta-accumulate" }),
				"."
			] }),
			" The first cut switched the call site to ",
			createVNode(_components.code, { children: "app.streams.processesSnapshot.use()" }),
			" and copied the latest frame into a ",
			createVNode(_components.code, { children: "reconcile" }),
			" store from a coarse ",
			createVNode(_components.code, { children: "createEffect" }),
			". That ",
			createVNode(_components.strong, { children: "silently drops same-shape delta frames" }),
			": ",
			createVNode(_components.code, { children: ".streams.use()" }),
			" writes each frame into a ",
			createVNode(_components.code, { children: "reconcile" }),
			" store, and a coarse reader (",
			createVNode(_components.code, { children: "const msg = sub()" }),
			") only re-fires for the paths it actually reads — so two consecutive deltas differing only in a nested field (a hot PID’s ",
			createVNode(_components.code, { children: "cpuPct" }),
			" ticking under an unchanged key set) coalesce and the second is lost; live values freeze in steady state. ",
			createVNode(_components.code, { children: "processesSnapshot" }),
			" is snapshot-",
			createVNode(_components.strong, { children: "then-delta" }),
			" — each frame is a ",
			createVNode(_components.em, { children: "change" }),
			", not the full state — so the consumer must accumulate."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The fix — and the rule it pins." }),
			" Drop one level to ",
			createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "createSubscription" }),
				" + ",
				createVNode(_components.code, { children: "reduce" })
			] }),
			": the reducer folds ",
			createVNode(_components.em, { children: "every" }),
			" frame in the subscription’s own ",
			createVNode(_components.code, { children: "for await" }),
			" loop (no frame can be coalesced away), and the table renders ",
			createVNode(_components.strong, { children: "fine-grained" }),
			" off the accumulated value (",
			createVNode(_components.code, { children: "processes()[pid].cpuPct" }),
			"), so an in-place ",
			createVNode(_components.code, { children: "reconcile" }),
			" leaf update re-notifies exactly that cell. The hermetic test drives a ",
			createVNode(_components.strong, { children: "same-shape delta" }),
			" (cpu ",
			createVNode(_components.code, { children: "10 → 20 → 30" }),
			") and asserts a fine-grained reader observes ",
			createVNode(_components.code, { children: "30" }),
			" — the exact case the coarse copy dropped. Because drishti’s CI is typecheck + nix only (no test lane), the review gauntlet, not CI, is what caught this — which is precisely why graduating it in drishti ",
			createVNode(_components.em, { children: "before" }),
			" the kolu work earns its keep. A drishti PR — independent of R-pulamweb-2’s framework, the thing ",
			createVNode(_components.strong, { children: "R-pulamweb-3" }),
			"’s value-bearing ",
			createVNode(_components.code, { children: "activity" }),
			" consumer (and ",
			createVNode(_components.strong, { children: "R-pulamweb-4" }),
			"’s git-status consumer) rides on."
		] }),
		"\n",
		createVNode("a", { id: "r-pulamweb-2" }),
		"\n",
		createVNode(_components.h3, {
			id: "r-pulamweb-2--the-framework-terminal-list-only--",
			children: ["R-pulamweb-2 — the framework (terminal list only) ✅ ", createVNode($$PrLink, { pr: 1524 })]
		}),
		"\n",
		createVNode($$Phase, {
			id: "R-pulamweb-2",
			name: "framework — provision · fan-out · list",
			status: "shipped",
			blocks: ["R-pulamweb-3"],
			links: [{
				label: "#1524",
				href: "https://github.com/juspay/kolu/pull/1524"
			}]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"R-pulamweb-2 stands up ",
			createVNode(_components.strong, { children: "everything hard" }),
			" — auto-provision + dial N pulam over ssh, mirror each, fan out, re-serve to the browser over ",
			createVNode(_components.code, { children: "/rpc/ws" }),
			", and consume in the browser — but renders ",
			createVNode(_components.strong, { children: "only a plain list of terminals" }),
			" (grouped by host). No git status, no drill-in, no features. The point is to prove the ",
			createVNode(_components.em, { children: "plumbing" }),
			" with a payload so small a failure has nowhere to hide."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Backend (Node)" }),
				" — per host, ",
				createVNode(_components.code, { children: "buildEntry(host)" }),
				": ",
				createVNode(_components.code, { children: "getHostSession({ binary:\"pulam\", resolveDrvPath, … })" }),
				" (the pooled, ",
				createVNode(_components.strong, { children: "reconnecting" }),
				" session — ",
				createVNode(_components.code, { children: "getHostSession" }),
				" + ",
				createVNode(_components.code, { children: "makeClientCursor" }),
				", ",
				createVNode(_components.em, { children: "not" }),
				" one-shot ",
				createVNode(_components.code, { children: "dialAgentOnce" }),
				", so a transient ssh drop self-heals), a per-host re-serve of the ",
				createVNode(_components.strong, { children: "whole" }),
				" ",
				createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
				" via ",
				createVNode(_components.code, { children: "implementSurface" }),
				" (",
				createVNode(_components.code, { children: "implementSurface" }),
				" fail-fast-throws on any unimplemented primitive, so the re-serve folds ",
				createVNode(_components.code, { children: "version" }),
				" + ",
				createVNode(_components.code, { children: "awareness" }),
				" from the mirror and ",
				createVNode(_components.strong, { children: "forwards" }),
				" the rest — ",
				createVNode(_components.code, { children: "fs.*" }),
				"/",
				createVNode(_components.code, { children: "git.*" }),
				" procedures via the live-procedure holder, the ",
				createVNode(_components.code, { children: "activity" }),
				"/repo/file streams via the live client — never a degraded stub), and ",
				createVNode(_components.code, { children: "pumpRemoteSurface(session, makeSink)" }),
				" (the shared reconnect-mirror loop) folding the agent’s frames in. The N entries live in ",
				createVNode(_components.code, { children: "buildHostRegistry({ buildEntry })" }),
				"; one ",
				createVNode(_components.code, { children: "RPCHandler.upgrade(ws)" }),
				" per ",
				createVNode(_components.code, { children: "/rpc/ws?host=<id>" }),
				", dispatched by an ",
				createVNode(_components.strong, { children: "app-local" }),
				" upgrade block (",
				createVNode(_components.code, { children: "gateWsOrigin" }),
				" + ",
				createVNode(_components.code, { children: "gateStaleSocket" }),
				" + ",
				createVNode(_components.code, { children: "startWsHeartbeat" }),
				", all already shared). ",
				createVNode(_components.code, { children: "pulam-tui" }),
				"’s ",
				createVNode(_components.code, { children: "hostConnect.ts" }),
				" is the dial template."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Browser (SolidJS + Vite)" }),
				" — per host a ",
				createVNode(_components.code, { children: "surfaceClient(pulamSurface, websocketLink(ws?host=<id>))" }),
				" — the browser consumes the ",
				createVNode(_components.strong, { children: "mirrored" }),
				" surface (",
				createVNode(_components.code, { children: "pulamSurface = mirroredSurface(terminalWorkspaceSurface)" }),
				"), the one carrying the composed ",
				createVNode(_components.code, { children: "connection" }),
				" cell, not the connection-free base — → ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "app.collections.snapshots.use({})" }) }),
				" → render a list of terminals per host (",
				createVNode(_components.code, { children: "cwd" }),
				" · foreground · agent), plus a coarse ",
				createVNode(_components.code, { children: "connecting…" }),
				" overlay until the first frame. This is the ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: ".collections.use()" }) }),
				" consumer (which drishti already proves); the ",
				createVNode(_components.em, { children: "value-bearing stream" }),
				" consumer (",
				createVNode(_components.code, { children: ".streams.use()" }),
				") is deferred to R-pulamweb-3. (For R-pulamweb-2 the host roster is a static ",
				createVNode(_components.code, { children: "/api/hosts" }),
				" boot list; dynamic add still rides a small parent fleet surface in a follow-up. The per-host ",
				createVNode(_components.strong, { children: "connection health" }),
				", however, now ships: pulam-web’s browser surface — ",
				createVNode(_components.code, { children: "pulamSurface = mirroredSurface(terminalWorkspaceSurface)" }),
				" — carries a composed read-only ",
				createVNode(_components.code, { children: "connection" }),
				" cell (the base ",
				createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
				" stays connection-free; ",
				createVNode(_components.code, { children: "mirroredSurface" }),
				" adds the cell only at the nix-host re-serve seam), the backend↔remote mirror’s ",
				createVNode(_components.code, { children: "copying → connecting → connected → disconnected → failed" }),
				", so a dead mirror reads honestly instead of as an empty fleet. See ",
				createVNode(_components.a, {
					href: "pulam-web-mirror-health.html",
					children: "pulam-web: a dead mirror lies as an empty fleet"
				}),
				".)"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Done when:" }),
			" the browser shows a ",
			createVNode(_components.strong, { children: "live terminal list across N auto-provisioned pulam hosts" }),
			" — its terminals appear and come/go live (awareness deltas) — all over the real ws. The mirror → re-serve → browser-store path is proven deterministically by the hermetic test (below). No features yet. That alone proves the framework: provision · dial · reconnect · fan-out · ws-serve · browser collection-consume."
		] }),
		"\n",
		createVNode("a", { id: "r-pulamweb-3" }),
		"\n",
		createVNode(_components.h3, {
			id: "r-pulamweb-3--the-agent-dashboard--",
			children: ["R-pulamweb-3 — the agent dashboard ✅ ", createVNode($$PrLink, { pr: 1535 })]
		}),
		"\n",
		createVNode($$Phase, {
			id: "R-pulamweb-3",
			name: "agent dashboard — agents by state",
			status: "shipped",
			needs: ["R-pulamweb-2"],
			blocks: ["R-pulamweb-4"],
			links: [{
				label: "#1535",
				href: "https://github.com/juspay/kolu/pull/1535"
			}]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The dashboard you actually want — ",
			createVNode(_components.em, { children: "every agent across the fleet, sorted by what needs you" }),
			" — has ",
			createVNode(_components.strong, { children: "nothing to build underneath it." }),
			" The state you sort by (",
			createVNode(_components.code, { children: "awaiting_user · working · idle" }),
			") already lives in the ",
			createVNode(_components.code, { children: "snapshots" }),
			" collection R-pulamweb-2 consumes (",
			createVNode(_components.code, { children: "AgentInfoSchema" }),
			", ",
			createVNode(_components.code, { children: "terminal-workspace/schema.ts:54" }),
			"; ",
			createVNode(_components.code, { children: "HostGroup.tsx:49" }),
			" reads ",
			createVNode(_components.code, { children: "value.agent" }),
			" today), and ",
			createVNode(_components.code, { children: "pulam-tui" }),
			" already has the state-bucketing, needs-you-first sort, and colour map (",
			createVNode(_components.code, { children: "render.ts:79-201" }),
			", renderer-agnostic). So R-pulamweb-3 is a ",
			createVNode(_components.strong, { children: "render / sort / filter layer" }),
			" — ",
			createVNode(_components.strong, { children: [
				"no surface change, no ",
				createVNode(_components.code, { children: "@pierre/trees" }),
				", nothing gated"
			] }),
			":"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Sort by what needs you" }),
				" — port pulam-tui’s bucket + sort (",
				createVNode(_components.code, { children: "agentBucket" }),
				"/",
				createVNode(_components.code, { children: "agentUrgency" }),
				"/the comparator, ",
				createVNode(_components.code, { children: "render.ts:77-92,324-335,452-465" }),
				"): a blocked agent (",
				createVNode(_components.code, { children: "awaiting_user" }),
				") floats to the top with a breathing alert strip; working spins cyan; idle sits dim. Per row: the agent, its ",
				createVNode(_components.code, { children: "repo · branch" }),
				", the state, and how long it’s been there. ",
				createVNode(_components.em, { children: [
					"The dirty/clean mark in the picture is ",
					createVNode(_components.strong, { children: "not" }),
					" here — ",
					createVNode(_components.code, { children: "awareness.git" }),
					" carries only ",
					createVNode(_components.code, { children: "repoName" }),
					"/",
					createVNode(_components.code, { children: "branch" }),
					", so the file count needs the ",
					createVNode(_components.code, { children: "git.getStatus" }),
					" procedure; it ships with the rest of git status in ",
					createVNode(_components.a, {
						href: "#r-pulamweb-4",
						children: "R-pulamweb-4"
					}),
					" (the reuse map already files ",
					createVNode(_components.code, { children: "RepoWatchSet" }),
					" there)."
				] }),
				" The ported logic lives in a pulam-web-local ",
				createVNode(_components.code, { children: "fleet.ts" }),
				" (pinned to the TUI’s behaviour by ",
				createVNode(_components.code, { children: "fleet.test.ts" }),
				") — a TUI/OpenTUI package has no place in the Vite browser bundle, so it’s owned, not imported."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Live activity dot" }),
				" — a green dot ",
				createVNode(_components.em, { children: "left of" }),
				" the agent state when the terminal is ",
				createVNode(_components.strong, { children: "moving bytes right now" }),
				" (like the Dock’s row dot). That’s the ",
				createVNode(_components.code, { children: "activity" }),
				" stream (",
				createVNode(_components.code, { children: "ActivitySet" }),
				" — the set of producing terminals, ",
				createVNode(_components.code, { children: "surface.ts:127" }),
				"), which R-pulamweb-2 already re-serves. It is ",
				createVNode(_components.strong, { children: "value-bearing" }),
				" (each frame is the full current live set), so it consumes through ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: ".streams.use()" }) }),
				" — the replace-each-frame consumer — ",
				createVNode(_components.em, { children: "not" }),
				" R-pulamweb-1’s ",
				createVNode(_components.code, { children: "createSubscription" }),
				" + reduce (that path is for the delta-accumulate ",
				createVNode(_components.code, { children: "processesSnapshot" }),
				"; conflating the two was a premise this note carried). So the dashboard reads two surface members — the ",
				createVNode(_components.code, { children: "awareness" }),
				" ",
				createVNode(_components.strong, { children: "collection" }),
				" (state) + the ",
				createVNode(_components.code, { children: "activity" }),
				" ",
				createVNode(_components.strong, { children: "stream" }),
				" (the dot) — both already-proven consumers, still nothing gated."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Agents, not terminals" }),
				" — show every agent by default (active ",
				createVNode(_components.em, { children: "and" }),
				" idle, the full agent board); one-click toggles fold in non-agent terminals and sleeping ones. ",
				createVNode(_components.em, { children: "(Shipped initially with only active agents on by default; the idle-by-default widening came as a later follow-up — see History.)" })
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Done when" }),
			" the browser shows the live agent dashboard across the fleet — blocked agents floated and breathing, states colour-coded, updating live over the real ws (",
			createVNode(_components.strong, { children: "video" }),
			"), with the toggles working. No file tree yet — that’s R-pulamweb-4."
		] }),
		"\n",
		createVNode("a", { id: "r-pulamweb-4" }),
		"\n",
		createVNode(_components.h3, {
			id: "r-pulamweb-4--the-live-git-drill-in-file-tree",
			children: "R-pulamweb-4 — the live git drill-in (file tree)"
		}),
		"\n",
		createVNode($$Phase, {
			id: "R-pulamweb-4",
			name: "git drill-in — live changed-file tree",
			status: "todo",
			needs: ["R-pulamweb-3"],
			blocks: ["R9"],
			links: [{
				label: "renderer non-issue #1534",
				href: "https://github.com/juspay/kolu/issues/1534"
			}]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The git-status phase, in two parts: the per-agent ",
			createVNode(_components.strong, { children: "dirty/clean cell" }),
			" (the ",
			createVNode(_components.code, { children: "✎5" }),
			" / ",
			createVNode(_components.code, { children: "✓" }),
			" mark + ahead/behind), and — clicking an agent — a ",
			createVNode(_components.strong, { children: "drill-in to its live changed-file tree" }),
			" (the file tree like kolu’s Code tab, not just ",
			createVNode(_components.code, { children: "git status" }),
			" text). Both consume the same git-status data, and it is the same git procedure + pulse ",
			createVNode(_components.strong, { children: "R9" }),
			"’s Code tab reuses (which is why pulam-web de-risks it). It is a ",
			createVNode(_components.strong, { children: "plain render/consume feature" }),
			" — the Pierre renderer everyone feared is ",
			createVNode(_components.em, { children: "not" }),
			" a blocker (risk note below)."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Risk note — Pierre is NOT the blocker (corrected 2026-06-26)",
			children: createVNode(_components.p, { children: [
				"The roadmap long carried ",
				createVNode(_components.em, { children: [
					"“the renderer is the hard part — carry the ",
					createVNode(_components.code, { children: "@pierre/trees" }),
					" swallow-emit patch.”"
				] }),
				" ",
				createVNode(_components.strong, { children: "Reproduced in kolu" }),
				" (the real ",
				createVNode(_components.code, { children: "@kolu/solid-pierre" }),
				" → ",
				createVNode(_components.code, { children: "@pierre/trees" }),
				" path, in ",
				createVNode(_components.code, { children: "happy-dom" }),
				" with the guard instrumented), that fear is ",
				createVNode(_components.strong, { children: "measured false" }),
				": live git-status repaints ride Pierre’s ",
				createVNode(_components.strong, { children: [
					"guard-independent ",
					createVNode(_components.code, { children: "setGitStatus" }),
					" prop"
				] }),
				", and kolu’s ",
				createVNode(_components.code, { children: "FileTree" }),
				" ",
				createVNode(_components.strong, { children: "never re-subscribes" }),
				" its controller (the five effect deps stay stable), so the swallow-emit quirk (",
				createVNode(_components.code, { children: "hasSeenInitialControllerSnapshot" }),
				" in ",
				createVNode(_components.code, { children: "@pierre/trees/dist/render/FileTreeView.js" }),
				") never fires beyond the correct initial-mount suppression. Facts + reproduction on ",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/issues/1534",
					children: "#1534"
				}),
				"; upstream ",
				createVNode(_components.a, {
					href: "https://github.com/pierrecomputer/pierre/issues/883",
					children: "pierrecomputer/pierre#883"
				}),
				" (a Preact component; the maintainer welcomed a PR). A one-line fix is vendored-ready at ",
				createVNode(_components.code, { children: "origin/r8:patches/@pierre__trees@1.0.0-beta.4.patch" }),
				" as ",
				createVNode(_components.strong, { children: "optional insurance, not a gate" }),
				" — drop it in (or land the upstream ",
				createVNode(_components.code, { children: "useRef" }),
				" form) only if a ",
				createVNode(_components.em, { children: "future" }),
				" persistently-mounted, re-subscribing design ever surfaces the swallow. So R-pulamweb-4 is a ",
				createVNode(_components.strong, { children: "plain render/consume feature" }),
				", no special renderer work."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Build it end-to-end." }),
			" The load-bearing decision a first attempt got wrong (",
			createVNode(_components.code, { children: "feat/pulamweb-git-drillin" }),
			", discarded) is ",
			createVNode(_components.strong, { children: "where the new streams live" }),
			" — pin it:"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "The streams go in @kolu/terminal-workspace — pulam-web consumes the surface AS IS",
			children: [createVNode(_components.p, { children: [
				"pulam-web exists ",
				createVNode(_components.strong, { children: "solely" }),
				" to prove kolu’s ",
				createVNode(_components.em, { children: "exact" }),
				" surface-consumption leg ahead of R9. So pulam-web must ",
				createVNode(_components.strong, { children: "not" }),
				" invent its own surface — it consumes ",
				createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
				" ",
				createVNode(_components.strong, { children: "exactly as the daemon serves it" }),
				": git status is the ",
				createVNode(_components.code, { children: "git.getStatus" }),
				" / ",
				createVNode(_components.code, { children: "fs.listAll" }),
				" ",
				createVNode(_components.strong, { children: "procedures" }),
				" + the ",
				createVNode(_components.code, { children: "subscribeRepoChange" }),
				" ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "{seq}" }), " pulse"] }),
				" (the shared surface’s deliberate shape — ",
				createVNode(_components.a, {
					href: "surface-live-data.html",
					children: "surface live data"
				}),
				"). pulam-web’s ",
				createVNode(_components.code, { children: "shared/contract.ts" }),
				" stays ",
				createVNode(_components.code, { children: "pulamSurface = mirroredSurface(terminalWorkspaceSurface)" }),
				", ",
				createVNode(_components.strong, { children: "unchanged" }),
				", and the drill-in re-queries the procedure on each pulse."
			] }), createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "Do NOT" }),
				" wrap git status into a value-bearing stream on a pulam-web-local surface — a ",
				createVNode(_components.code, { children: "pulamSurface" }),
				" / ",
				createVNode(_components.code, { children: "defineSurface" }),
				" extension, or a ",
				createVNode(_components.code, { children: "pollOnEvent" }),
				" in ",
				createVNode(_components.code, { children: "reserve.ts" }),
				" (the discarded attempt did exactly this and touched ",
				createVNode(_components.strong, { children: "zero" }),
				" shared code). An app-local surface makes pulam-web diverge from what kolu serves — proving nothing kolu reuses, which ",
				createVNode(_components.strong, { children: "defeats pulam-web’s entire reason to exist" }),
				". Consume the procedure + pulse the daemon already serves. When kolu later moves its ",
				createVNode(_components.strong, { children: "own" }),
				" Code tab onto that same procedure + pulse (the fs/git half of ",
				createVNode(_components.strong, { children: "R9" }),
				"), pulam-web will have already proven the remote leg."
			] })]
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Consume the surface’s existing git procedure + pulse — add nothing." }),
				" ",
				createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
				" already serves git status the shared-surface way (R6): ",
				createVNode(_components.code, { children: "git.getStatus" }),
				" / ",
				createVNode(_components.code, { children: "fs.listAll" }),
				" are ",
				createVNode(_components.strong, { children: "procedures" }),
				" (request→response) and ",
				createVNode(_components.code, { children: "subscribeRepoChange" }),
				" is a payload-free ",
				createVNode(_components.code, { children: "{seq}" }),
				" ",
				createVNode(_components.strong, { children: "pulse" }),
				". The drill-in calls the procedure for a snapshot, then ",
				createVNode(_components.strong, { children: "re-queries on each pulse" }),
				" (",
				createVNode(_components.a, {
					href: "surface-live-data.html",
					children: "surface live data"
				}),
				" explains the pattern). No new stream, no ",
				createVNode(_components.code, { children: "pollOnEvent" }),
				", no surface change — pulam-web reads ",
				createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
				" exactly as it is, which is the whole point."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Browser: the dirty/clean cell." }),
				" Consume ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "app.streams.gitStatus.use(...)" }) }),
				" ",
				createVNode(_components.strong, { children: "fine-grained" }),
				" (each frame the full status), reusing ",
				createVNode(_components.code, { children: "pulam-tui" }),
				"’s ",
				createVNode(_components.code, { children: "gitCell" }),
				" projection — ",
				createVNode(_components.strong, { children: ["ported into pulam-web’s own ", createVNode(_components.code, { children: "fleet.ts" })] }),
				" and pinned by ",
				createVNode(_components.code, { children: "fleet.test.ts" }),
				" (the reuse-map row below; do ",
				createVNode(_components.strong, { children: "not" }),
				" import the TUI/OpenTUI package into the Vite bundle). Render ",
				createVNode(_components.code, { children: "✎<n>" }),
				" / ",
				createVNode(_components.code, { children: "✓" }),
				" + ahead/behind in the agent row, replacing the ",
				createVNode(_components.code, { children: "NO git dirty/clean count" }),
				" placeholder at ",
				createVNode(_components.code, { children: "packages/pulam-web/src/client/HostGroup.tsx:27" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Browser: the drill-in file tree." }),
				" On clicking an agent, render the changed-file tree through ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/solid-pierre" }) }),
				"’s ",
				createVNode(_components.code, { children: "<FileTree>" }),
				" — kolu’s Code-tab wrapper (",
				createVNode(_components.code, { children: "packages/client/src/right-panel/CodeTab.tsx" }),
				", ",
				createVNode(_components.code, { children: "packages/solid-pierre/src/FileTree.tsx" }),
				"): ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "app.streams.fsListAll.use(...)" }) }),
				" for the paths + ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "app.streams.gitStatus.use(...)" }) }),
				" for decorations (the ",
				createVNode(_components.code, { children: "gitStatus" }),
				" prop → ",
				createVNode(_components.code, { children: "setGitStatus" }),
				"). ",
				createVNode(_components.strong, { children: "Reuse the porcelain→Pierre mapping, don’t copy it" }),
				" — lift ",
				createVNode(_components.code, { children: "packages/client/src/ui/gitStatusEntries.ts" }),
				" into ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/solid-pierre" }) }),
				" so kolu ",
				createVNode(_components.em, { children: "and" }),
				" pulam-web import the one copy (the discarded attempt duplicated it into pulam-web). ",
				createVNode(_components.strong, { children: [
					"Add ",
					createVNode(_components.code, { children: "@kolu/solid-pierre" }),
					" + ",
					createVNode(_components.code, { children: "@pierre/trees" }),
					" to ",
					createVNode(_components.code, { children: "packages/pulam-web/package.json" })
				] }),
				" — pulam-web does ",
				createVNode(_components.strong, { children: "not" }),
				" depend on Pierre today. Keep the tree ",
				createVNode(_components.strong, { children: "mounted" }),
				" for flicker-free updates."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Surface coverage this phase adds." }),
			" Before R-pulamweb-4 the browser consumed cells + the awareness ",
			createVNode(_components.strong, { children: "collection" }),
			" + the activity ",
			createVNode(_components.strong, { children: "value-bearing stream" }),
			". This phase adds the ",
			createVNode(_components.strong, { children: "procedure + pulse" }),
			" pattern — ",
			createVNode(_components.code, { children: "git.getStatus" }),
			"/",
			createVNode(_components.code, { children: "fs.listAll" }),
			" called over the mirror, re-queried on each ",
			createVNode(_components.code, { children: "subscribeRepoChange" }),
			" pulse — over kolu’s ",
			createVNode(_components.em, { children: "exact" }),
			" surface, not a pulam-web variant, proving the ",
			createVNode(_components.strong, { children: "remote/mirror" }),
			" leg. It’s the ",
			createVNode(_components.em, { children: "same" }),
			" git shape kolu’s Code tab adopts in R9 (the fs/git half), so R-pulamweb-4 de-risks it. (The file-content/diff viewer — ",
			createVNode(_components.code, { children: "git.getDiff" }),
			" / ",
			createVNode(_components.code, { children: "fs.readFile" }),
			" via ",
			createVNode(_components.code, { children: "@pierre/diffs" }),
			" — stays out: same pattern, rides R9.)"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Done when" }),
			" the dirty/clean cell and the drill-in’s file tree update within ~1s of a working-tree change over the real ws (",
			createVNode(_components.strong, { children: "video" }),
			"), and a hermetic test fires a ",
			createVNode(_components.code, { children: "subscribeRepoChange" }),
			" pulse and asserts the drill-in ",
			createVNode(_components.strong, { children: [
				"re-queries ",
				createVNode(_components.code, { children: "git.getStatus" }),
				"/",
				createVNode(_components.code, { children: "fs.listAll" }),
				" and repaints"
			] }),
			", over the agent → mirror → re-serve → browser leg. No Pierre patch is required (see the risk note). This is the same procedure + pulse git leg kolu’s Code tab adopts in R9."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "r-pulamweb-5--fleet-notifications-the-alertclass-mirror",
			children: [
				"R-pulamweb-5 — fleet notifications (the ",
				createVNode(_components.code, { children: "alertClass" }),
				" mirror)"
			]
		}),
		"\n",
		createVNode($$Phase, {
			id: "R-pulamweb-5",
			name: "fleet notifications — alertClass",
			status: "todo",
			needs: ["R-pulamweb-3"],
			links: [{
				label: "born in #1541",
				href: "https://github.com/juspay/kolu/pull/1541"
			}]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The last ",
			createVNode(_components.strong, { children: "Dock-mirror" }),
			" gap. kolu’s Dock fires an ",
			createVNode(_components.strong, { children: "OS notification" }),
			" (+ PWA badge) when an agent crosses into the ",
			createVNode(_components.strong, { children: "notify" }),
			" class — finished (",
			createVNode(_components.code, { children: "waiting" }),
			") or blocked (",
			createVNode(_components.code, { children: "awaiting_user" }),
			") — for a terminal you aren’t watching; the membership is the shared ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "alertClass" }) }),
			" fold (",
			createVNode(_components.a, {
				href: "remote-terminals.html#r-dock-unify",
				children: createVNode(_components.code, { children: "@kolu/terminal-workspace/agentProjection" })
			}),
			"). The fleet board is the ",
			createVNode(_components.em, { children: "exact" }),
			" surface that wants this — you “leave it open on a second monitor”, so a ping when something needs you is the point — and pulam-web’s server ",
			createVNode(_components.strong, { children: [
				"already serves the ",
				createVNode(_components.code, { children: "notify" }),
				" service worker"
			] }),
			" (",
			createVNode(_components.code, { children: "installFreshStatic({ serviceWorker: \"notify\" })" }),
			"), so the transport is in place. What’s missing is the ",
			createVNode(_components.strong, { children: "client firing leg" }),
			", which today lives kolu-local (",
			createVNode(_components.code, { children: "useActivityAlerts" }),
			" / ",
			createVNode(_components.code, { children: "useTerminalAlerts" }),
			" — permission request, the fire-on-crossing effect, the SW click-routing)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"So this phase is ",
			createVNode(_components.strong, { children: "not a fold-consume — it’s a feature" }),
			": (1) ",
			createVNode(_components.strong, { children: "extract" }),
			" the renderer-agnostic firing channels (request-permission · fire-notification · SW message routing) out of the kolu client into a shared home — ",
			createVNode(_components.code, { children: "@kolu/surface-app" }),
			" already owns ",
			createVNode(_components.code, { children: "NOTIFICATION_SW_SOURCE" }),
			", the natural electricity boundary — so kolu and pulam-web fire through one path, not two; (2) ",
			createVNode(_components.strong, { children: "wire" }),
			" pulam-web: a per-host effect over the ",
			createVNode(_components.code, { children: "snapshots" }),
			" collection that fires on an ",
			createVNode(_components.code, { children: "alertClass" }),
			" crossing for a background host, gated on a permission opt-in (the dashboard’s own toggle). The paint + rank mirror shipped with R-dock-unify (",
			createVNode($$PrLink, { pr: 1541 }),
			"); this is the third fold catching up. ",
			createVNode(_components.strong, { children: "Done when" }),
			" a fleet agent finishing/blocking on an unfocused tab fires one OS notification whose click focuses pulam-web (",
			createVNode(_components.strong, { children: "video" }),
			"), and kolu + pulam-web fire through the ",
			createVNode(_components.em, { children: "same" }),
			" extracted channel (no duplicated firing logic)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Reuse map — how the framework (R-pulamweb-1/2) was built" }),
			" (grounded against installed code + ",
			createVNode(_components.code, { children: "/home/srid/code/drishti" }),
			"). ",
			createVNode(_components.em, { children: "Shared" }),
			" = consumed from the surface family, not copied; ",
			createVNode(_components.em, { children: "app-local" }),
			" = pulam-web’s own. The rows R-pulamweb-3/4 add are the last (agent-state cells, then the drill-in); everything else here already shipped."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Concern" }),
					"\n",
					createVNode(_components.th, { children: "Source" }),
					"\n",
					createVNode(_components.th, { children: "Note" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "per-host mirror loop" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "shared" }),
						" ",
						createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
						" ",
						createVNode(_components.code, { children: "pumpRemoteSurface" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"extracted from drishti ",
						createVNode(_components.code, { children: "bridgeAgentToParent" }),
						"; ",
						createVNode(_components.code, { children: "makeClientCursor" }),
						" reconnect + ",
						createVNode(_components.code, { children: "mirrorRemoteSurface" }),
						" per spawn + live-procedure/live-client holders"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "fan-out registry" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "shared" }),
						" ",
						createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
						" ",
						createVNode(_components.code, { children: "buildHostRegistry" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"extracted from drishti ",
						createVNode(_components.code, { children: "hostRegistry.ts" }),
						"; ",
						createVNode(_components.code, { children: "Map<host,{session,handler}>" }),
						", generic over the handler type"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "ws-serve (~18 lines)" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "app-local" }),
						" in ",
						createVNode(_components.code, { children: "pulam-web" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"composed from shared ",
						createVNode(_components.code, { children: "gateWsOrigin" }),
						" (",
						createVNode(_components.code, { children: "@kolu/surface/ws-origin" }),
						") + ",
						createVNode(_components.code, { children: "gateStaleSocket" }),
						" + ",
						createVNode(_components.code, { children: "startWsHeartbeat" }),
						" (",
						createVNode(_components.code, { children: "@kolu/surface-app/server" }),
						"); ",
						createVNode(_components.code, { children: "?host=" }),
						" dispatch is the app’s (see the ",
						createVNode(_components.em, { children: "common-it-up" }),
						" callout above)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "whole-surface re-serve" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "app-local" }),
						" ",
						createVNode(_components.code, { children: "implementSurface(terminalWorkspaceSurface, …)" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"folds ",
						createVNode(_components.code, { children: "version" }),
						"+",
						createVNode(_components.code, { children: "awareness" }),
						" from the mirror, forwards ",
						createVNode(_components.code, { children: "fs.*" }),
						"/",
						createVNode(_components.code, { children: "git.*" }),
						" + the watcher streams (fail-fast: every primitive implemented)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "autoprovision + dial" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "shared" }),
						" ",
						createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
						" ",
						createVNode(_components.code, { children: "getHostSession" }),
						" (+ ",
						createVNode(_components.code, { children: "resolveSystem" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"dial template = ",
						createVNode(_components.code, { children: "pulam-tui/src/hostConnect.ts" }),
						"; pins ",
						createVNode(_components.code, { children: "binary:\"pulam\"" }),
						", ",
						createVNode(_components.code, { children: "PULAM_AGENT_DRVS_JSON" }),
						". Provisioning lives ",
						createVNode(_components.em, { children: "inside" }),
						" the session’s reconnect cycle — no hand-rolled ",
						createVNode(_components.code, { children: "provisionAgent" }),
						" call"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "browser bootstrap" }),
					"\n",
					createVNode(_components.td, { children: [
						"drishti ",
						createVNode(_components.code, { children: "app/src/client/wire.ts" }),
						" (pattern)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"one ",
						createVNode(_components.code, { children: "surfaceClient(pulamSurface, websocketLink(ws?host=))" }),
						" per host — the browser reads the ",
						createVNode(_components.strong, { children: "mirrored" }),
						" surface (",
						createVNode(_components.code, { children: "pulamSurface = mirroredSurface(terminalWorkspaceSurface)" }),
						"), which carries the ",
						createVNode(_components.code, { children: "connection" }),
						" cell; the base is connection-free (",
						createVNode(_components.code, { children: "@kolu/surface/solid" }),
						" + ",
						createVNode(_components.code, { children: "@kolu/surface/links/websocket" }),
						")"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "serve the bundle" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "shared" }),
						" ",
						createVNode(_components.code, { children: "installFreshStatic" }),
						" (",
						createVNode(_components.code, { children: "@kolu/surface-app/server" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: "the same fresh-static contract kolu-server uses" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "render.ts" }),
						" (state buckets · ",
						createVNode(_components.code, { children: "agentUrgency" }),
						" · sort · ",
						createVNode(_components.code, { children: "relativeTime" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "pulam-tui" }),
						" — ",
						createVNode(_components.strong, { children: "R-pulamweb-3" }),
						" ✅"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"ported to pulam-web’s own ",
						createVNode(_components.code, { children: "fleet.ts" }),
						" (pinned by ",
						createVNode(_components.code, { children: "fleet.test.ts" }),
						"), ",
						createVNode(_components.strong, { children: "not imported" }),
						" — no TUI/OpenTUI dep in the Vite bundle; the agent rows + needs-you-first sort"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "render.ts" }),
						" / ",
						createVNode(_components.code, { children: "fleet.ts" }),
						" (",
						createVNode(_components.code, { children: "gitCell" }),
						", ",
						createVNode(_components.code, { children: "gitDetail" }),
						", ",
						createVNode(_components.code, { children: "RepoWatchSet" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "pulam-tui" }),
						" — ",
						createVNode(_components.strong, { children: "R-pulamweb-4" })
					] }),
					"\n",
					createVNode(_components.td, { children: "the dirty/clean cell + the live file-tree drill-in (all the git-status consumption)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "bundler + nix" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: ["Vite + ", createVNode(_components.code, { children: "vite-plugin-solid" })] }),
						" (kolu’s ",
						createVNode(_components.code, { children: "packages/client" }),
						" toolchain), Node"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"in-repo package: ",
						createVNode(_components.code, { children: "@kolu/*" }),
						" are ",
						createVNode(_components.strong, { children: "workspace deps" }),
						" (no npins); nix derivation + flake/justfile wiring modeled on ",
						createVNode(_components.code, { children: "packages/client" })
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The hermetic test." }),
			" No in-memory ",
			createVNode(_components.code, { children: "websocketLink" }),
			" double exists (only ",
			createVNode(_components.code, { children: "directLink" }),
			"/",
			createVNode(_components.code, { children: "stdio" }),
			"/unix-socket). Model on R7’s ",
			createVNode(_components.code, { children: "mirrorRemoteSurface.test.ts" }),
			": stand up a real ",
			createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
			" agent via ",
			createVNode(_components.code, { children: "implementSurface" }),
			", connect it with ",
			createVNode(_components.code, { children: "directLink" }),
			", drive pulam-web’s ",
			createVNode(_components.code, { children: "buildReServe" }),
			" fold path (the mirror sink) with that client, then consume the ",
			createVNode(_components.strong, { children: "re-served" }),
			" surface through a second ",
			createVNode(_components.code, { children: "surfaceClient" }),
			" + a Solid ",
			createVNode(_components.code, { children: "reconcile" }),
			" store — asserting the re-served value re-notifies on the second delta (agent → mirror → re-serve → browser-store). ",
			createVNode(_components.code, { children: "buildReServe" }),
			" is split so the mirror step takes an injected client, which is exactly what makes it driveable without ssh. Per ",
			createVNode(_components.strong, { children: "R-pulamweb-1’s correction" }),
			", R-pulamweb-3’s value-bearing ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "activity" }) }),
			" consumer reads ",
			createVNode(_components.strong, { children: "fine-grained" }),
			" and its test drives a ",
			createVNode(_components.strong, { children: "same-shape" }),
			" second frame — two same-cardinality membership swaps (",
			createVNode(_components.code, { children: "[A]→[B]→[A]" }),
			") that each must re-notify a ",
			createVNode(_components.code, { children: "liveSet().has(id)" }),
			" dot reader (the coalescing regression a coarse copy-into-store silently drops); R-pulamweb-2’s awareness consumer asserts the simpler key re-notify. (R-pulamweb-4’s git-status consumer is the ",
			createVNode(_components.em, { children: "procedure + pulse" }),
			" leg — re-query on the pulse; activity is R-pulamweb-3’s value-bearing leg.) That catches a coalescing/reconcile break deterministically; a ws-flush break only shows over a real socket — so ",
			createVNode(_components.strong, { children: "pulam-web over real ws is the full proof" }),
			", the unit test necessary-but-not-sufficient."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Definition of done — by phase." }),
			" ",
			createVNode(_components.strong, { children: "R-pulamweb-1 (drishti):" }),
			" ✅ shipped (",
			createVNode(_components.a, {
				href: "https://github.com/srid/drishti/pull/72",
				children: "drishti #72"
			}),
			") — ",
			createVNode(_components.code, { children: "processesSnapshot" }),
			" rendered live via ",
			createVNode(_components.code, { children: "createSubscription" }),
			" + ",
			createVNode(_components.code, { children: "reduce" }),
			", read fine-grained, guarded by a same-shape-delta regression test. ",
			createVNode(_components.strong, { children: "R-pulamweb-2:" }),
			" a live terminal list across N auto-provisioned hosts over the real ws — the ",
			createVNode(_components.em, { children: "framework" }),
			", no features. ",
			createVNode(_components.strong, { children: "R-pulamweb-3:" }),
			" ✅ shipped (",
			createVNode($$PrLink, { pr: 1535 }),
			") — the live ",
			createVNode(_components.strong, { children: "agent dashboard" }),
			" across the fleet (blocked agents floated + breathing, states colour-coded, the activity dot live, the toggles working, over the real ws); the value-bearing ",
			createVNode(_components.code, { children: "activity" }),
			" consumer guarded by a same-shape-swap re-notify test. No git cells, no file tree, nothing gated. ",
			createVNode(_components.strong, { children: "R-pulamweb-4:" }),
			" the dirty/clean cell + the drill-in’s file tree update live over the real ws, the git-status ",
			createVNode(_components.strong, { children: "procedure + pulse" }),
			" pinned by a re-query-on-pulse test — ",
			createVNode(_components.strong, { children: "no Pierre patch needed" }),
			" (the swallow-emit is measured harmless in kolu, ",
			createVNode(_components.a, {
				href: "https://github.com/juspay/kolu/issues/1534",
				children: "#1534"
			}),
			"); the same git shape ",
			createVNode(_components.strong, { children: "R9" }),
			"’s Code tab adopts."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Shared @kolu/surface* — the drishti gate APPLIES this round",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "@kolu/surface" }),
				", ",
				createVNode(_components.code, { children: "@kolu/surface-app" }),
				", ",
				createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
				" are shared with ",
				createVNode(_components.a, {
					href: "https://github.com/srid/drishti",
					children: "drishti"
				}),
				", and any ",
				createVNode(_components.em, { children: "API-facing" }),
				" change to them requires a linked drishti PR with green CI (",
				createVNode(_components.code, { children: ".claude/rules/surface.md" }),
				"). The ",
				createVNode(_components.em, { children: "common-it-up" }),
				" extraction ",
				createVNode(_components.strong, { children: "adds two exports" }),
				" to ",
				createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
				" — ",
				createVNode(_components.code, { children: "pumpRemoteSurface" }),
				" + ",
				createVNode(_components.code, { children: "buildHostRegistry" }),
				" — so the gate is in scope (additive, non-breaking, but API-facing). The linked drishti PR refactors drishti’s ",
				createVNode(_components.code, { children: "bridgeAgentToParent" }),
				" + ",
				createVNode(_components.code, { children: "hostRegistry.ts" }),
				" to consume the shared helpers (dropping its hand-rolled copies), bumps drishti’s npins kolu pin to this branch, and goes green — its passing CI is what proves the lift behaviour-preserving. pulam-web’s ",
				createVNode(_components.em, { children: "consumption" }),
				" of the rest (",
				createVNode(_components.code, { children: "mirrorRemoteSurface" }),
				", ",
				createVNode(_components.code, { children: "getHostSession" }),
				", ",
				createVNode(_components.code, { children: "gateStaleSocket" }),
				", …) stays read-only."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "history",
			children: "History"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Pierre renderer de-gated — reproduced harmless in kolu" }),
				" (2026-06-26) — the long-standing ",
				createVNode(_components.em, { children: [
					"“the file-tree renderer is R-pulamweb-4’s hard part — carry the ",
					createVNode(_components.code, { children: "@pierre/trees" }),
					" patch”"
				] }),
				" claim was ",
				createVNode(_components.strong, { children: "reproduced and falsified" }),
				": in kolu’s real ",
				createVNode(_components.code, { children: "@kolu/solid-pierre" }),
				" → ",
				createVNode(_components.code, { children: "@pierre/trees" }),
				" path the live git-status repaint rides Pierre’s guard-independent ",
				createVNode(_components.code, { children: "setGitStatus" }),
				" prop and kolu’s ",
				createVNode(_components.code, { children: "FileTree" }),
				" never re-subscribes its controller, so the swallow-emit (",
				createVNode(_components.a, {
					href: "https://github.com/pierrecomputer/pierre/issues/883",
					children: "pierre#883"
				}),
				") does not manifest. R-pulamweb-4 is now a ",
				createVNode(_components.strong, { children: "plain render/consume feature" }),
				"; the one-line fix stays vendored-ready on ",
				createVNode(_components.code, { children: "origin/r8" }),
				" as optional insurance. Reproduction + measurement filed on ",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/issues/1534",
					children: "#1534"
				}),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Idle agents show by default" }),
				" (2026-06-24) — the dashboard opened showing only ",
				createVNode(_components.em, { children: "active" }),
				" agents (need/work), with idle ones behind the opt-in toggle, so a fleet whose agents had all gone quiet read as an empty board. The default now shows ",
				createVNode(_components.strong, { children: "every agent" }),
				" — active ",
				createVNode(_components.em, { children: "and" }),
				" idle (one ",
				createVNode(_components.code, { children: "DEFAULT_FLEET_FILTERS" }),
				", pinned by ",
				createVNode(_components.code, { children: "fleet.test.ts" }),
				") — leaving only the agentless categories (non-agent terminals, sleeping shells) opt-in. A small UX default flip; rode the R-activity-merge PR (",
				createVNode($$PrLink, { pr: 1555 }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R-dock-unify filled in the paint mirror; R-pulamweb-5 born" }),
				" (2026-06-23) — ",
				createVNode($$PrLink, { pr: 1541 }),
				" made kolu’s Dock the third consumer of the shared ",
				createVNode(_components.code, { children: "agentProjection" }),
				" and, on the way, brought the two fleet MIRRORS up to consume the ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "agentPaintClass" }) }),
				" fold too: pulam-web’s agent glyph (",
				createVNode(_components.code, { children: "fleet.ts" }),
				"’s ",
				createVNode(_components.code, { children: "PAINT" }),
				"/",
				createVNode(_components.code, { children: "paintClassFor" }),
				") and pulam-tui’s state tone (",
				createVNode(_components.code, { children: "render.ts" }),
				"’s ",
				createVNode(_components.code, { children: "agentTone" }),
				") now follow PAINT, decoupled from the urgency sort — so a just-finished ",
				createVNode(_components.code, { children: "waiting" }),
				" agent keeps the lingering “awaiting” amber instead of dropping to idle grey, mirroring the Dock’s new order≠colour split. The remaining shared fold, ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "alertClass" }) }),
				" (fire-a-notification membership), is the one mirror gap left — pulam-web fleet notifications are now ",
				createVNode(_components.strong, { children: createVNode(_components.a, {
					href: "#r-pulamweb-5",
					children: "R-pulamweb-5"
				}) }),
				". A ",
				createVNode(_components.code, { children: ".apm/instructions" }),
				" rule (",
				createVNode(_components.code, { children: "dock-fleet-mirror" }),
				") pins the three-surface contract so the next agent-state change keeps Dock + pulam-tui + pulam-web in lockstep."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R-pulamweb-3 shipped" }),
				" (2026-06-23) — ",
				createVNode($$PrLink, { pr: 1535 }),
				". The agent dashboard: a render / sort / filter layer over R-pulamweb-2’s framework, no surface change. pulam-tui’s bucket/urgency/sort/recency projection extracted into the shared ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/terminal-workspace/agentProjection" }) }),
				" (a presentation-neutral leaf — no TUI/OpenTUI in the Vite bundle) and imported by ",
				createVNode(_components.em, { children: "both" }),
				" ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" and pulam-web’s ",
				createVNode(_components.code, { children: "fleet.ts" }),
				" (the web-tone wrapper, pinned by ",
				createVNode(_components.code, { children: "fleet.test.ts" }),
				"); kolu’s Dock joins as the third consumer in ",
				createVNode(_components.a, {
					href: "remote-terminals.html#r-dock-unify",
					children: "R-dock-unify"
				}),
				". The value-bearing ",
				createVNode(_components.code, { children: "activity" }),
				" stream consumed via ",
				createVNode(_components.code, { children: ".streams.use()" }),
				" for the green dot, App-owned filters + a fleet-wide breathing “needs you” strip. Grounding against the installed code ",
				createVNode(_components.strong, { children: "corrected two premises this note carried" }),
				": (1) the dirty/clean count is ",
				createVNode(_components.em, { children: "not" }),
				" in ",
				createVNode(_components.code, { children: "awareness.git" }),
				" (only ",
				createVNode(_components.code, { children: "repoName" }),
				"/",
				createVNode(_components.code, { children: "branch" }),
				") — it needs ",
				createVNode(_components.code, { children: "git.getStatus" }),
				", so it moved to R-pulamweb-4 with the rest of git-status consumption (where the reuse map already filed ",
				createVNode(_components.code, { children: "RepoWatchSet" }),
				"); (2) ",
				createVNode(_components.code, { children: "activity" }),
				" is ",
				createVNode(_components.em, { children: "value-bearing" }),
				" (full set each frame), so the simple ",
				createVNode(_components.code, { children: ".streams.use()" }),
				" consumer, ",
				createVNode(_components.strong, { children: "not" }),
				" R-pulamweb-1’s ",
				createVNode(_components.code, { children: "createSubscription" }),
				"+reduce (that’s for delta-accumulate ",
				createVNode(_components.code, { children: "processesSnapshot" }),
				"). The hermetic proof is the value-bearing analog of R-pulamweb-1’s: two same-cardinality activity swaps each re-notify a fine-grained dot reader over the full agent→mirror→re-serve→browser leg."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R-pulamweb-2 shipped" }),
				" (2026-06-22) — ",
				createVNode($$PrLink, { pr: 1524 }),
				". The framework: the shared per-host fan-out (",
				createVNode(_components.code, { children: "pumpRemoteSurface" }),
				" + ",
				createVNode(_components.code, { children: "buildHostRegistry" }),
				" in ",
				createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
				", 11 registry tests) + the new ",
				createVNode(_components.code, { children: "@kolu/pulam-web" }),
				" package (whole-surface re-serve, app-local ws-upgrade from the shared gates, Solid+Vite awareness client, the hermetic agent→mirror→re-serve→browser-store proof). Deep-grounded against the installed code (drishti’s ",
				createVNode(_components.code, { children: "bridgeAgentToParent" }),
				"/",
				createVNode(_components.code, { children: "hostRegistry" }),
				", the ",
				createVNode(_components.code, { children: "@kolu/surface*" }),
				" family, ",
				createVNode(_components.code, { children: "pulam-tui" }),
				"’s dial, the ",
				createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
				" shape, kolu’s Vite/nix client toolchain), which corrected the original sketch on two load-bearing points: ",
				createVNode(_components.strong, { children: "(1)" }),
				" the ",
				createVNode(_components.em, { children: "common-it-up" }),
				" extraction is the per-host ",
				createVNode(_components.strong, { children: "mirror-bridge + registry" }),
				", ",
				createVNode(_components.strong, { children: "not" }),
				" a ws-serve helper (surface core has no ",
				createVNode(_components.code, { children: "ws" }),
				" dep; drishti’s upgrade handler doesn’t fit a generic seam, so ws-serve stays app-local); ",
				createVNode(_components.strong, { children: "(2)" }),
				" the per-host re-serve is the ",
				createVNode(_components.strong, { children: "whole" }),
				" ",
				createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
				" (fail-fast on any omission), dialed via the ",
				createVNode(_components.strong, { children: "reconnecting" }),
				" ",
				createVNode(_components.code, { children: "getHostSession" }),
				"+",
				createVNode(_components.code, { children: "makeClientCursor" }),
				". drishti adopts the shared helpers in a linked gated PR. Packaged as a first-class Nix derivation — ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "nix run .#pulam-web" }) }),
				" (a Vite client build + a tsx server wrapper baking the per-system pulam drv map, ",
				createVNode(_components.code, { children: "default.nix" }),
				"), with a ",
				createVNode(_components.code, { children: "just pulam-web" }),
				" dev recipe — and proven end-to-end against a real two-host fleet (a Linux pu box + a macOS host, ",
				createVNode(_components.code, { children: "sincereintent" }),
				") over the live ws."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R-pulamweb-1 shipped" }),
				" (2026-06-22) — graduated drishti’s ",
				createVNode(_components.code, { children: "processesSnapshot" }),
				" consumer (",
				createVNode(_components.a, {
					href: "https://github.com/srid/drishti/pull/72",
					children: "drishti #72"
				}),
				"). The review gauntlet caught a coalescing regression that ",
				createVNode(_components.strong, { children: "corrected this note’s premise" }),
				": ",
				createVNode(_components.code, { children: "processesSnapshot" }),
				" is ",
				createVNode(_components.em, { children: "delta-accumulate" }),
				", not “value-bearing”, so ",
				createVNode(_components.code, { children: ".streams.use()" }),
				" + a coarse copy-into-store drops same-shape delta frames (a hot PID’s metric freezes). The fix — ",
				createVNode(_components.code, { children: "createSubscription" }),
				" + ",
				createVNode(_components.code, { children: "reduce" }),
				", rendered ",
				createVNode(_components.strong, { children: "fine-grained" }),
				" — and its same-shape-delta test are now pinned as the git-consumer recipe here and in ",
				createVNode(_components.a, {
					href: "remote-terminals.html#r9",
					children: "remote-terminals"
				}),
				". drishti CI is typecheck+nix only, so the gauntlet (not CI) caught it — the case for graduating in drishti first."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Planned" }),
				" (2026-06-22) — branched out of ",
				createVNode(_components.a, {
					href: "pulam.html",
					children: "pulam"
				}),
				"’s R4.8 once it grew its own UI and a layered plan (R-pulamweb-1 in drishti · R-pulamweb-2 framework · R-pulamweb-3 features). Grounded against ",
				createVNode(_components.code, { children: "/home/srid/code/drishti" }),
				" (the surface leg is identical ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				" code, so the runtime is free — ",
				createVNode(_components.strong, { children: "chose Node + Vite" }),
				" to match kolu-server/client; Bun was only drishti’s bundler; autoprovision is ",
				createVNode(_components.code, { children: "getHostSession" }),
				"+",
				createVNode(_components.code, { children: "provisionAgent" }),
				") and against ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" (the ",
				createVNode(_components.code, { children: "startFleet" }),
				"/",
				createVNode(_components.code, { children: "FleetSink" }),
				"/",
				createVNode(_components.code, { children: "RepoWatchSet" }),
				" core is renderer-agnostic and reusable). Gates ",
				createVNode(_components.a, {
					href: "remote-terminals.html#r9",
					children: "remote-terminals R9"
				}),
				"."
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
	"title": "pulam-web — the browser twin (kolu's surface-consumption leg, proven standalone)",
	"description": "A browser ↔ Node ↔ ssh app (drishti's twin for the terminal-workspace surface) that proves kolu's exact browser-consumption leg ahead of remote-terminals R9 — a live git-status view reaching a browser over websocketLink + surfaceClient + Solid reconcile, sourced from a mirrored pulam, auto-provisioned over ssh. Node + Vite, matching kolu's own client stack (the surface leg is identical @kolu/surface code, so it is a faithful reproduction of kolu's leg). Lands cheapest-first — R-pulamweb-1 (shipped) graduated the reactive stream consumer in drishti; R-pulamweb-2 stands up the whole framework (provision · fan-out · mirror · re-serve) rendering only a terminal list; R-pulamweb-3 layers the agent dashboard (every agent sorted by what needs you, with a live activity dot); R-pulamweb-4 adds the live git status (dirty/clean cell + drill-in).",
	"parents": ["pulam", "feature"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-06-23T00:00:00.000Z"
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
			"slug": "r-pulamweb-1--the-reactive-stream-consumer-in-drishti--shipped",
			"text": "R-pulamweb-1 — the reactive stream consumer, in drishti ✅ shipped"
		},
		{
			"depth": 3,
			"slug": "r-pulamweb-2--the-framework-terminal-list-only--",
			"text": "R-pulamweb-2 — the framework (terminal list only) ✅ "
		},
		{
			"depth": 3,
			"slug": "r-pulamweb-3--the-agent-dashboard--",
			"text": "R-pulamweb-3 — the agent dashboard ✅ "
		},
		{
			"depth": 3,
			"slug": "r-pulamweb-4--the-live-git-drill-in-file-tree",
			"text": "R-pulamweb-4 — the live git drill-in (file tree)"
		},
		{
			"depth": 3,
			"slug": "r-pulamweb-5--fleet-notifications-the-alertclass-mirror",
			"text": "R-pulamweb-5 — fleet notifications (the alertClass mirror)"
		},
		{
			"depth": 2,
			"slug": "history",
			"text": "History"
		}
	];
}
var url = "src/content/atlas/pulam-web.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pulam-web.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pulam-web.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { ARow, Content, Content as default, Grp, PulamWebUI, UIPAL, file, frontmatter, getHeadings, url };
