import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$D2 } from "./D2_CXsCOQdn.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import "./Terminal_Cqh2_20m.mjs";
//#region src/content/atlas/pulam.mdx
var FBPAL = {
	txt: "#c8d0de",
	sub: "#8b94a6",
	dim: "#5b6678",
	amber: "#e6a23c",
	cyan: "#56b6c2",
	green: "#7ec699",
	red: "#e06c75",
	violet: "#a78bfa"
};
var FleetRow = ({ r }) => {
	const c = r.kind === "need" ? FBPAL.amber : r.kind === "work" ? FBPAL.cyan : FBPAL.dim;
	const glyph = r.kind === "need" ? "●" : r.kind === "work" ? "◜" : "○";
	const cls = r.kind === "need" ? "fb-pulse" : r.kind === "work" ? "fb-spin" : "";
	return createVNode("div", {
		style: `display:flex;gap:.6rem;align-items:center;padding:.15rem .45rem;border-radius:5px;${r.kind === "need" ? "background:rgba(230,162,60,.12);" : ""}`,
		children: [
			createVNode("span", {
				class: cls,
				style: `color:${c};display:inline-block;width:1.4ch;flex:none`,
				children: glyph
			}),
			createVNode("span", {
				style: `color:${FBPAL.txt};width:7ch;flex:none`,
				children: r.agent
			}),
			createVNode("span", {
				style: `color:${FBPAL.sub};flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`,
				children: r.where
			}),
			createVNode("span", {
				style: `color:${c};width:12ch;flex:none`,
				children: r.state
			}),
			createVNode("span", {
				style: `color:${FBPAL.dim};width:4ch;text-align:right;flex:none`,
				children: r.age
			})
		]
	});
};
var FleetGroup = ({ host, n, badge, rows }) => createVNode("div", {
	style: "margin:.5rem 0 .15rem",
	children: [createVNode("div", {
		style: "display:flex;gap:.5rem;align-items:center;font-size:.82em;padding:0 .45rem .12rem",
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
			badge && createVNode("span", {
				style: "margin-left:auto;color:#e06c75",
				children: badge
			})
		]
	}), rows.map((r, i) => createVNode(FleetRow, { r }, i))]
});
var FleetBoard = ({ mode = "alert" }) => {
	const need = mode === "alert";
	return createVNode("div", {
		style: "font:12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:#0f1117;border:1px solid #05070b;border-radius:11px;overflow:hidden;margin:1.2rem 0;box-shadow:0 10px 34px rgba(0,0,0,.4);max-width:42rem",
		children: [createVNode("div", {
			style: "display:flex;align-items:center;gap:.5rem;padding:.5rem .8rem;background:#0b0d12;border-bottom:1px solid #222838",
			children: [
				createVNode("span", { style: "width:11px;height:11px;border-radius:50%;background:#ff5f56;display:inline-block" }),
				createVNode("span", { style: "width:11px;height:11px;border-radius:50%;background:#ffbd2e;display:inline-block" }),
				createVNode("span", { style: "width:11px;height:11px;border-radius:50%;background:#27c93f;display:inline-block" }),
				createVNode("span", {
					style: "margin-left:.45rem;color:#8b94a6",
					children: "pulam-tui fleet"
				}),
				createVNode("span", {
					style: "margin-left:auto;color:#5b6678",
					children: "⟳ live · 1s"
				})
			]
		}), createVNode("div", {
			style: "padding:.5rem .55rem .65rem",
			children: [
				need && createVNode("div", {
					class: "fb-pulse",
					style: "display:flex;align-items:center;gap:.5rem;margin:.15rem .1rem .4rem;padding:.32rem .55rem;border-radius:7px;background:rgba(230,162,60,.14);border:1px solid rgba(230,162,60,.42);color:#f0b860",
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
							children: "— zest · pu-build-7"
						})
					]
				}),
				createVNode(FleetGroup, {
					host: "zest",
					n: "4 terminals",
					rows: [
						...need ? [{
							kind: "need",
							agent: "claude",
							where: "kolu · feat/dial-ssh   #1412 ✓",
							state: "awaiting you",
							age: "3s"
						}] : [],
						{
							kind: "work",
							agent: "codex",
							where: "drishti · master",
							state: "working",
							age: "0s"
						},
						{
							kind: "work",
							agent: "claude",
							where: "anyforge · fix/checks   #1408 ✗",
							state: "working",
							age: "4s"
						},
						{
							kind: "idle",
							agent: "claude",
							where: "notes · main",
							state: "idle",
							age: "12m"
						}
					]
				}),
				createVNode(FleetGroup, {
					host: "pu-build-7",
					n: "2 terminals",
					rows: [need ? {
						kind: "need",
						agent: "claude",
						where: "kolu · fix/heap-oom   #1427 ✓",
						state: "awaiting you",
						age: "9s"
					} : {
						kind: "work",
						agent: "claude",
						where: "kolu · fix/heap-oom   #1427 ✓",
						state: "working",
						age: "9s"
					}, {
						kind: "work",
						agent: "—",
						where: "infra · deploy",
						state: "working",
						age: "1s"
					}]
				}),
				createVNode(FleetGroup, {
					host: "staging",
					n: "unreachable",
					badge: "ECONNREFUSED",
					rows: []
				}),
				createVNode(FleetGroup, {
					host: "local",
					n: "1 terminal",
					rows: [{
						kind: "idle",
						agent: "claude",
						where: "pulam · feat/fleet",
						state: "idle",
						age: "2m"
					}]
				}),
				createVNode("div", {
					style: "display:flex;gap:.8rem;margin:.5rem .15rem 0;padding-top:.42rem;border-top:1px solid #1c2231;font-size:.85em",
					children: [
						createVNode("span", {
							style: "color:#e6a23c",
							children: [
								"● ",
								need ? 2 : 0,
								" need you"
							]
						}),
						createVNode("span", {
							style: "color:#56b6c2",
							children: [
								"◜ ",
								need ? 3 : 4,
								" working"
							]
						}),
						createVNode("span", {
							style: "color:#5b6678",
							children: "○ 2 idle"
						}),
						createVNode("span", {
							style: "margin-left:auto;color:#5b6678",
							children: need ? "1 host down" : "all clear ✓"
						})
					]
				})
			]
		})]
	});
};
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		blockquote: "blockquote",
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
		createVNode($$Callout, {
			kind: "warn",
			title: "Retired at padi W2.3 — the done-signal re-homed to padi-tui",
			children: createVNode(_components.p, { children: [
				"The standalone ",
				createVNode(_components.code, { children: "pulam" }),
				" daemon and its ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" viewer are ",
				createVNode(_components.strong, { children: "buried" }),
				": the terminal-workspace surface is now the per-host ",
				createVNode(_components.code, { children: "padi" }),
				" daemon’s ",
				createVNode(_components.code, { children: "padiSurface" }),
				", and the agent-state done-signal is ",
				createVNode(_components.code, { children: "padi-tui wait" }),
				". This note stays as historical record."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "kaval decoupled the PTY out of kolu into a standalone, minimal, durable daemon." }),
			" This note makes the ",
			createVNode(_components.em, { children: "same move one level up" }),
			" for the part kolu kept tangling: ",
			createVNode(_components.strong, { children: "terminal awareness" }),
			" (git branch/dirty, PR status, agent detection, foreground). A new daemon — ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "pulam" }) }),
			" (Tamil ",
			createVNode(_components.em, { children: "புலம்" }),
			", “field · domain” — and from the same root ",
			createVNode(_components.em, { children: "pulan" }),
			" = a sense; sibling to ",
			createVNode(_components.code, { children: "kaval" }),
			" = ",
			createVNode(_components.em, { children: "guard" }),
			" and ",
			createVNode(_components.code, { children: "odu" }),
			" = ",
			createVNode(_components.em, { children: "run" }),
			") — sits ",
			createVNode(_components.em, { children: "on top of" }),
			" kaval, runs the sensors, and exposes the result as one typed ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" collection. ",
			createVNode(_components.strong, { children: "One sensor library, two homes:" }),
			" locally kolu runs the sensors in-process; remotely the ",
			createVNode(_components.code, { children: "pulam" }),
			" daemon serves the same awareness over ssh. Either way the result is one typed ",
			createVNode(_components.strong, { children: "observation surface" }),
			" that kolu ",
			createVNode(_components.strong, { children: "reads" }),
			" — it never folds a copy into its own record. (That convergence is ",
			createVNode(_components.a, {
				href: "remote-terminals.html",
				children: "remote-terminals"
			}),
			" ",
			createVNode(_components.strong, { children: "R8" }),
			"; until it lands, kolu’s local path still routes awareness into ",
			createVNode(_components.code, { children: "terminalMetadata" }),
			".)"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Refined by the awareness-derive-store cutover — the producer is memoryless, both homes fold",
			children: createVNode(_components.p, { children: [
				"This note’s “kolu ",
				createVNode(_components.strong, { children: "reads" }),
				", never folds” framing is the R8 stance; the ",
				createVNode(_components.a, {
					href: "awareness-derive-store.html",
					children: "awareness-derive-store cutover"
				}),
				" (now landed) refined it. The producer is now explicitly ",
				createVNode(_components.strong, { children: "memoryless" }),
				": it ",
				createVNode(_components.strong, { children: "emits" }),
				" per-field ",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				"s rather than mutating a host record through an ",
				createVNode(_components.code, { children: "AwarenessSink" }),
				" — that sink, both ",
				createVNode(_components.code, { children: "makeAwarenessSink" }),
				" impls (kolu’s and pulam’s ",
				createVNode(_components.code, { children: "hooks.ts" }),
				"), and the ",
				createVNode(_components.code, { children: "AwarenessRecord" }),
				" are ",
				createVNode(_components.strong, { children: "deleted" }),
				". Both homes now ",
				createVNode(_components.strong, { children: "fold" }),
				" that stream: ",
				createVNode(_components.em, { children: "kolu" }),
				" runs the full fold (the five snapshot fields ",
				createVNode(_components.strong, { children: "plus" }),
				" its two remembered facts — ",
				createVNode(_components.code, { children: "lastActivityAt" }),
				" · ",
				createVNode(_components.code, { children: "lastAgentCommand" }),
				" — on ",
				createVNode(_components.code, { children: "kolu.authored" }),
				"); ",
				createVNode(_components.em, { children: "pulam" }),
				", a memoryless dashboard, folds only the snapshot half (",
				createVNode(_components.code, { children: "foldSnapshot" }),
				"). The served collection value is now ",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				" (was ",
				createVNode(_components.code, { children: "AwarenessValue" }),
				"). What survives unchanged: one library, two homes, and kolu consuming through one seam."
			] })
		}),
		"\n",
		createVNode($$D2, {
			caption: "pulam sits on top of kaval (which stays byte-for-byte minimal). LOCAL terminals run the sensors inside kolu-server, in-process — no socket. REMOTE terminals run pulam host-side: it dials the host's kaval for taps, reads the host fs (git/gh/~/.claude), and serves the awareness slice over ssh, which kolu-server mirrors and reads through one seam (remote-terminals R8 deletes the old server-side fold). The same daemon is independently useful: pulam-tui dials it directly.",
			code: `direction: down
classes: {
client: { style.fill: "#eef0f2"; style.stroke: "#d9dde2"; style.font-color: "#475569" }
server: { style.fill: "#e7eefb"; style.stroke: "#c3d4f3"; style.font-color: "#2563eb" }
pty: { style.fill: "#e6f4ea"; style.stroke: "#bce3c8"; style.font-color: "#15803d" }
tool: { style.fill: "#fbf1dc"; style.stroke: "#ecd9ab"; style.font-color: "#b45309" }
tui: { style.fill: "#efebff"; style.stroke: "#d4cbff"; style.font-color: "#5a3ff0" }
host: { style.fill: "#f1f5f9"; style.stroke: "#e2e8f0"; style.font-color: "#475569" }
}
browser: "browser\\ntiles · reads terminalMetadata" { class: client }
server: "kolu-server\\nreads the observation surface\\nmirror (remote only)" { class: server }
kaval_l: "kaval (local)\\ndurable PTY · taps" { class: pty }
awd: "pulam (host · ephemeral)\\nruns the sensors · serves the slice" { class: tool }
kaval_h: "kaval (host)\\ndurable PTY · taps" { class: pty }
fs: "host fs · git · gh · ~/.claude" { class: host }
tui: "pulam-tui (standalone)" { class: tui }
browser -> server: oRPC
kaval_l -> server: "taps · sensors in-process (local)"
server -> awd: "dial (ssh)"
awd -> server: "slice → mirror (remote)"
kaval_h -> awd: "taps (dialed as client)"
awd -> fs: reads
tui -> awd: dials
`
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-core-model",
			children: "The core model"
		}),
		"\n",
		createVNode(_components.p, { children: "Three claims, each verified against the shipped code:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The unit is a generic observation, not kolu’s record." }),
				" ",
				createVNode(_components.code, { children: "pulam" }),
				" exposes ",
				createVNode(_components.code, { children: "Collection<TerminalId, TerminalSnapshot>" }),
				" — exactly the five fields a host can RE-OBSERVE: ",
				createVNode(_components.code, { children: "cwd · git · pr · agent · foreground" }),
				". It carries ",
				createVNode(_components.strong, { children: "no memory" }),
				": kolu’s two remembered facts (",
				createVNode(_components.code, { children: "lastActivityAt" }),
				" recency, ",
				createVNode(_components.code, { children: "lastAgentCommand" }),
				") are derived by ",
				createVNode(_components.em, { children: "kolu’s" }),
				" fold and live on ",
				createVNode(_components.code, { children: "kolu.authored" }),
				", never on pulam’s collection. That schema lives in ",
				createVNode(_components.code, { children: "@kolu/terminal-workspace" }),
				" (the R4.1 ",
				createVNode(_components.code, { children: "@kolu/terminal-awareness" }),
				", renamed when it grew fs/git in R6), built from the vendor-neutral ",
				createVNode(_components.code, { children: "anyagent" }),
				" / ",
				createVNode(_components.code, { children: "anyforge" }),
				" / ",
				createVNode(_components.code, { children: "kolu-git" }),
				" shapes with ",
				createVNode(_components.strong, { children: "no kolu content" }),
				" — not even ",
				createVNode(_components.code, { children: "location" }),
				" (no producer can know its own kolu-side ",
				createVNode(_components.code, { children: "hostId" }),
				"). Kolu’s per-terminal record is this ",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				" ",
				createVNode(_components.strong, { children: "joined" }),
				" with its authored half (",
				createVNode(_components.code, { children: "location" }),
				", the memory facts, the UI fields): built ",
				createVNode(_components.em, { children: "on" }),
				" it, never carved ",
				createVNode(_components.em, { children: "from" }),
				" it."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "kaval stays byte-for-byte minimal." }),
				" ",
				createVNode(_components.code, { children: "pulam" }),
				" ",
				createVNode(_components.em, { children: "dials" }),
				" kaval as a ",
				createVNode(_components.code, { children: "ptyHostSurface" }),
				" client for the four taps + ",
				createVNode(_components.code, { children: "getScreenText" }),
				"; it adds zero awareness/git/gh logic to kaval. A layer above, never a fork."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Ephemerality is the simplifier." }),
				" Awareness never has to survive a restart — it’s re-derivable from live taps + current host fs. So ",
				createVNode(_components.code, { children: "pulam" }),
				" sheds all of kaval’s durability machinery: no single-instance lock, no spawn/cleanup, no persisted list (it borrows kaval’s ",
				createVNode(_components.code, { children: "terminal.list" }),
				"), no adoption or reconnect. Every (re)start just re-runs the sensors from now."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "one-library-two-homes--one-shape-of-consumption",
			children: "One library, two homes — one shape of consumption"
		}),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "Superseded detail:" }),
				" the cutover (see the callout above) reintroduced a ",
				createVNode(_components.em, { children: "fold" }),
				" — a pure reduce over the producer’s observation stream, ",
				createVNode(_components.strong, { children: "not" }),
				" the old persisted∪live fusion this section says was deleted. Read the “no fold” wording below as R8 history; today kolu folds a memoryless producer’s ",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				" events."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Local and remote share the ",
			createVNode(_components.em, { children: "sensor library" }),
			" and ",
			createVNode(_components.em, { children: "one schema" }),
			" — and, after ",
			createVNode(_components.a, {
				href: "remote-terminals.html",
				children: "remote-terminals"
			}),
			" ",
			createVNode(_components.strong, { children: "R8" }),
			", one ",
			createVNode(_components.strong, { children: "shape of consumption" }),
			" too: the sensors fill the ",
			createVNode(_components.code, { children: "terminalWorkspaceSurface.snapshots" }),
			" collection, and kolu ",
			createVNode(_components.strong, { children: "reads" }),
			" it. The only thing that differs is where that collection is ",
			createVNode(_components.em, { children: "backed" }),
			":"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Local → in-process." }),
				" kolu-server runs the sensors and they fill the in-process awareness collection; kolu reads it through ",
				createVNode(_components.code, { children: "awarenessFor(id)" }),
				" — no transport, no framing, and crucially ",
				createVNode(_components.strong, { children: "no fold" }),
				" (the sensors no longer write kolu’s ",
				createVNode(_components.code, { children: "terminalMetadata" }),
				"). This reverses the earlier ",
				createVNode(_components.em, { children: [
					"local writes ",
					createVNode(_components.code, { children: "terminalMetadata" }),
					" directly"
				] }),
				" stance: at #1406 an in-process surface bought nothing (kolu folded into its record either way), so it read as ceremony; R8 makes it earn its keep — giving observation its own collection is exactly what deletes the fold and the persisted/live fence, and unifies the read seam with remote."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Remote → serve (pulam), then mirror (kolu)." }),
				" ",
				createVNode(_components.code, { children: "pulam" }),
				" is Nix-provisioned over ssh (kaval’s staleKey recipe), runs the identical sensors, and ",
				createVNode(_components.strong, { children: "serves" }),
				" the slice over ",
				createVNode(_components.code, { children: "stdioLink" }),
				". kolu mirrors it (R7’s total dual) and reads the same ",
				createVNode(_components.code, { children: "awarenessFor(id)" }),
				" seam — the backing is a mirror instead of an in-process collection."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"So the old asymmetry — ",
			createVNode(_components.em, { children: "local mutates kolu’s record; remote serves → mirrors → folds" }),
			" — collapses to ",
			createVNode(_components.strong, { children: "one shape, two backings" }),
			": both fill the observation surface, kolu reads it, and local-vs-remote is a backing swap behind the seam. The one new artifact is the host-side hooks impl that reifies each ",
			createVNode(_components.code, { children: "mutate" }),
			" closure into a serialized slice frame — a wire carries values, not closures. (Until R8 lands, kolu’s ",
			createVNode(_components.em, { children: "local" }),
			" path still routes awareness into ",
			createVNode(_components.code, { children: "terminalMetadata" }),
			"; R8 is what moves it onto the surface kolu reads.)"
		] }),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "mirrorRemoteSurface" }), " has graduated"] }),
				" (",
				createVNode($$PrLink, { pr: 1497 }),
				"). It is now the one public mirror in ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				" — the spec-driven dual of ",
				createVNode(_components.code, { children: "implementSurface" }),
				" that drives a served surface’s ",
				createVNode(_components.strong, { children: "streaming" }),
				" primitives (cells/collections/streams) into caller-supplied sinks — mirroring ",
				createVNode(_components.em, { children: "procedures" }),
				" to a ",
				createVNode(_components.strong, { children: "total" }),
				" dual is ",
				createVNode(_components.a, {
					href: "remote-terminals.html",
					children: "remote-terminals"
				}),
				" R7; ",
				createVNode(_components.code, { children: "mirrorRemoteCollection" }),
				" is demoted to its private per-key engine (“you don’t sell half a house”). The trigger was pulam growing a real ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "activity" }), " stream"] }),
				" (the green dot) — the second stream-bearing consumer the graduation waited for. It does not by itself dissolve kolu’s server-side fold — remote-terminals ",
				createVNode(_components.strong, { children: "R8" }),
				" does, by composing the surface into kolu’s own; until then the fold consumes ",
				createVNode(_components.code, { children: "mirrorRemoteSurface" }),
				". As a ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				" API change it rode ",
				createVNode(_components.code, { children: "surface.md" }),
				"’s drishti merge-gate."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-standalone-tools--pulam--its-two-clients",
			children: [
				"The standalone tools — ",
				createVNode(_components.code, { children: "pulam" }),
				" + its two clients"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Like kaval, the daemon is a deliverable in its own right, shipped and proven ",
			createVNode(_components.em, { children: "before" }),
			" kolu touches it. Where ",
			createVNode(_components.code, { children: "kaval-tui" }),
			" shows what’s ",
			createVNode(_components.em, { children: "running" }),
			" in each PTY, the pulam clients show what each terminal ",
			createVNode(_components.em, { children: "is in" }),
			" — the awareness slice, with ",
			createVNode(_components.strong, { children: "zero kolu-server" }),
			", dialable over ssh against a prod box. Two clients read it, split by richness, the kaval picture one layer up:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.a, {
					href: "pulam-tui.html",
					children: "pulam-tui"
				}) }),
				" — the ",
				createVNode(_components.em, { children: "raw" }),
				" client, ",
				createVNode(_components.a, {
					href: "pty-daemon-tui.html",
					children: "kaval-tui"
				}),
				"’s sibling: a thin Node CLI (",
				createVNode(_components.code, { children: "status" }),
				" / ",
				createVNode(_components.code, { children: "watch" }),
				") against ",
				createVNode(_components.strong, { children: "one" }),
				" daemon over a socket or ssh. It is deliberately ",
				createVNode(_components.strong, { children: "not" }),
				" a full TUI — see ",
				createVNode(_components.a, {
					href: "pulam-tui.html",
					children: "its note"
				}),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.a, {
					href: "pulam-web.html",
					children: "pulam-web"
				}) }),
				" — the ",
				createVNode(_components.em, { children: "rich" }),
				" client: the browser fleet dashboard that fans out over N hosts, “what is every agent doing, across every repo, across every machine.” This is where the multi-host glance view lives."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"It ships self-contained: the sensors (",
			createVNode(_components.code, { children: "@kolu/terminal-workspace/sensors.ts" }),
			") import nothing from kolu but a logger, and the host runtime deps are just ",
			createVNode(_components.code, { children: "node · git · gh" }),
			" (SQLite via Node’s built-in ",
			createVNode(_components.code, { children: "node:sqlite" }),
			" — no native addon), so the bin travels cleanly over ssh. Define the contract once and the consumers fall out of one schema — the daemon serves it, the clients read it, and remotely kolu mirrors and reads it."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-r4-tree--shipped-end-to-end",
			children: "The R4 tree — shipped end-to-end"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The standalone pulam story (extract → daemon → remote viewer → Bun → OpenTUI → live fleet → live activity) is complete. ",
			createVNode(_components.strong, { children: "kolu’s consume" }),
			" — kolu dialing this host’s pulam over a long-lived ",
			createVNode(_components.code, { children: "HostSession" }),
			", mirroring it, and reading it into its own canvas — is not pulam’s job; it lives in the parent ",
			createVNode(_components.a, {
				href: "remote-terminals.html",
				children: "remote-terminals"
			}),
			" roadmap as ",
			createVNode(_components.strong, { children: "R8–R9" }),
			" (R8 composes the surface and deletes the fold, R9 dials), gated on the remote dial. ",
			createVNode(_components.em, { children: "And" }),
			" the ",
			createVNode(_components.strong, { children: "fs/git" }),
			" a remote Code tab needs is roadmapped there as ",
			createVNode(_components.strong, { children: "R6" }),
			": this awareness library grows into ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/terminal-workspace" }) }),
			" — ",
			createVNode(_components.em, { children: "one" }),
			" ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" surface that adds fs/git procedures + watcher streams beside the ",
			createVNode(_components.code, { children: "snapshots" }),
			" collection — so kolu runs it in-process locally and pulam hosts the ",
			createVNode(_components.em, { children: "same" }),
			" surface remotely, never a second fs/git impl. pulam just points there. (The ",
			createVNode(_components.strong, { children: "total mirror" }),
			" is proven independently in R7 — ",
			createVNode(_components.em, { children: "drishti" }),
			" gains a “Kill process” action, the first forwarded procedure on a mirrored surface — so R7 needs neither pulam nor kolu.)"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Naming — arivu becomes pulam (the immediate next phase, R4.6)",
			children: createVNode(_components.p, { children: [
				"arivu (அறிவு, ",
				createVNode(_components.em, { children: "the faculty of knowing" }),
				") was named for ",
				createVNode(_components.strong, { children: "awareness" }),
				". R6 broadened the daemon to host the whole ",
				createVNode(_components.code, { children: "terminal-workspace" }),
				" surface — awareness ",
				createVNode(_components.strong, { children: "and" }),
				" fs/git + procedures — so “knowing” undersold it. The rename, ",
				createVNode(_components.strong, { children: ["decided: புலம் ", createVNode(_components.em, { children: "pulam" })] }),
				" — ",
				createVNode(_components.em, { children: "field · domain" }),
				", and from the same root புலன் ",
				createVNode(_components.em, { children: "pulan" }),
				" = ",
				createVNode(_components.em, { children: "a sense / perception" }),
				" (the five senses are ",
				createVNode(_components.em, { children: "pulankaḷ" }),
				"). So pulam quietly means ",
				createVNode(_components.strong, { children: "“the field that also senses”" }),
				": it carries both halves of what the daemon became — the workspace it hosts ",
				createVNode(_components.em, { children: "and" }),
				" the awareness it derives — and stays crisp beside ",
				createVNode(_components.code, { children: "kaval" }),
				" (guard) and ",
				createVNode(_components.code, { children: "odu" }),
				" (run). It lands as ",
				createVNode(_components.strong, { children: createVNode(_components.a, {
					href: "#r46",
					children: "R4.6"
				}) }),
				" — kept deliberately small: ",
				createVNode(_components.em, { children: "the immediate next phase is just the rename" }),
				" (daemon · ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" · this note), behaviour-preserving, green CI is the proof; the package stays ",
				createVNode(_components.code, { children: "@kolu/terminal-workspace" }),
				". Other candidates considered: kaḷam (field/arena), sūzhal (environment), idam (place), thaḷam, nilam, uṇarvu."
			] })
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Phase" }),
					"\n",
					createVNode(_components.th, { children: "Ships" }),
					"\n",
					createVNode(_components.th, { children: [createVNode($$PrLink, { pr: 1413 }), " etc."] }),
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
						createVNode(_components.strong, { children: "R4.1" }),
						" ",
						createVNode($$Pill, { children: "refactor" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"extract ",
						createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/terminal-awareness" }) }),
						" — sensors + generic schemas, off ",
						createVNode(_components.code, { children: "kolu-common" }),
						"; the schema home inverts (kolu-common now imports the schemas and adds ",
						createVNode(_components.code, { children: "location" }),
						"). Behaviour-preserving — green CI is the proof."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1413 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "R4.2" }),
						" ",
						createVNode($$Pill, { children: "refactor" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"finish the ",
						createVNode(_components.code, { children: "provider" }),
						" → ",
						createVNode(_components.code, { children: "adapter" }),
						" rename through the ",
						createVNode(_components.code, { children: "anyagent" }),
						"/",
						createVNode(_components.code, { children: "anyforge" }),
						" leaves (symbols, files, exports — one adapter spine). The live ",
						createVNode(_components.code, { children: "Watcher" }),
						" handle + wire ",
						createVNode(_components.code, { children: "provider" }),
						" discriminant stay. Behaviour-preserving."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1419 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "R4.3" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "feature"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: [
							createVNode(_components.code, { children: "pulam" }),
							" + ",
							createVNode(_components.code, { children: "pulam-tui" }),
							" standalone"
						] }),
						" — the daemon dials kaval and serves the awareness surface; the TUI reads it. Zero kolu-server. ",
						createVNode(_components.code, { children: "--stdio" }),
						" is the seam the ssh dial speaks to."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1428 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "R4.4" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "feature"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: createVNode(_components.code, { children: "pulam-tui --host" }) }),
						" — dial + Nix-provision a remote pulam over ssh, render the same dashboard. The shared one-shot dial graduated to ",
						createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
						"’s ",
						createVNode(_components.code, { children: "dialAgentOnce" }),
						" (a ",
						createVNode(_components.code, { children: "version" }),
						"-cell read is pulam’s connectivity probe). Zero kolu-server."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1439 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "R4.5" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "feature"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"the ",
						createVNode(_components.strong, { children: "fleet dashboard" }),
						" — see below."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$PrLink, { pr: 1470 }),
						" · ",
						createVNode($$PrLink, { pr: 1479 }),
						" · ",
						createVNode($$PrLink, { pr: 1486 }),
						" · ",
						createVNode($$PrLink, { pr: 1497 })
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "r45--the-fleet-board",
			children: "R4.5 — the fleet board"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Superseded for the TUI — the fleet board now lives in the browser",
			children: createVNode(_components.p, { children: [
				"What R4.5 shipped — the multi-host fleet board as an OpenTUI/Bun dashboard ",
				createVNode(_components.em, { children: ["inside ", createVNode(_components.code, { children: "pulam-tui" })] }),
				" — has been ",
				createVNode(_components.strong, { children: "walked back" }),
				": the rich fleet glance is now ",
				createVNode(_components.strong, { children: createVNode(_components.a, {
					href: "pulam-web.html",
					children: "pulam-web"
				}) }),
				"’s, and ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" reverts to a thin ",
				createVNode(_components.code, { children: "status" }),
				" / ",
				createVNode(_components.code, { children: "watch" }),
				" client (",
				createVNode(_components.a, {
					href: "pulam-tui.html",
					children: "its note"
				}),
				"). The record below is shipped history; read it for how the awareness mirror was first proven, not for the current shape of ",
				createVNode(_components.code, { children: "pulam-tui" }),
				"."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The user’s framing made literal — ",
			createVNode(_components.em, { children: "“what is every agent doing, across every repo, across every machine”" }),
			" — as a ",
			createVNode(_components.strong, { children: "dashboard you leave open on a second monitor" }),
			": glance over from the game and a colour you can read across the room tells you whether any agent is ",
			createVNode(_components.strong, { children: "blocked on you" }),
			", and where. It stays a TUI, runs zero kolu-server, and shipped as four steps:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R4.5.1 — Bun runtime" }),
				" ",
				createVNode($$PrLink, { pr: 1470 }),
				". Re-platform ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" onto ",
				createVNode(_components.strong, { children: "Bun" }),
				" via ",
				createVNode(_components.a, {
					href: "electricity.html",
					children: "drishti"
				}),
				"’s bun2nix recipe — pinned via npins, resolved with ",
				createVNode(_components.code, { children: "builtins.getFlake" }),
				" (the ",
				createVNode(_components.code, { children: "odu" }),
				" path, so kolu’s zero-flake-input rule holds), ",
				createVNode(_components.code, { children: "bun.lock" }),
				" + autogenerated ",
				createVNode(_components.code, { children: "bun.nix" }),
				" kept outside the pnpm workspace, ",
				createVNode(_components.code, { children: "@kolu/*" }),
				" hydrated from the Nix store. Today’s ",
				createVNode(_components.code, { children: "list" }),
				"/",
				createVNode(_components.code, { children: "watch" }),
				" run unchanged. The foundation lands first so the OpenTUI bundle sits on proven ground."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R4.5.2 — OpenTUI render, one endpoint" }),
				" ",
				createVNode($$PrLink, { pr: 1479 }),
				". Retire ",
				createVNode(_components.code, { children: "list" }),
				"/",
				createVNode(_components.code, { children: "watch" }),
				" + the ",
				createVNode(_components.code, { children: "columnify" }),
				" text; render a SolidJS-canonical OpenTUI list of one endpoint’s terminals (the already-shipped ",
				createVNode(_components.code, { children: "--socket" }),
				" or single ",
				createVNode(_components.code, { children: "--host" }),
				", reused verbatim — no new connection capability), with a ",
				createVNode(_components.strong, { children: "one-second clock" }),
				" beside it as the liveness proof. The list itself is a one-shot snapshot; live deltas are R4.5.3’s. ",
				createVNode(_components.code, { children: "--json" }),
				" dumps the awareness array."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R4.5.3 — the multi-host fleet board" }),
				" ",
				createVNode($$PrLink, { pr: 1486 }),
				". Fan the one-shot dial over N hosts, mirror each ",
				createVNode(_components.code, { children: "snapshots" }),
				" collection into one aggregate keyed by ",
				createVNode(_components.code, { children: "(host, terminalId)" }),
				", go ",
				createVNode(_components.strong, { children: "live" }),
				" (repaint on any mirror delta), float every ",
				createVNode(_components.code, { children: "awaiting_user" }),
				" agent to the top across the fleet, and render per-host groups + a breathing alert strip + honest unreachable/skew/empty states."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R4.5.4 — the live green dot + full-surface mirror" }),
				" ",
				createVNode($$PrLink, { pr: 1497 }),
				". ",
				createVNode(_components.code, { children: "@kolu/pulam-contract" }),
				" grows its first ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "activity" }), " stream"] }),
				" (terminals moving bytes right now, from kaval’s raw output tap); the board paints each a ",
				createVNode(_components.strong, { children: "live green dot" }),
				" and drives the whole surface — version cell + ",
				createVNode(_components.code, { children: "awareness" }),
				" + ",
				createVNode(_components.code, { children: "activity" }),
				" — through one ",
				createVNode(_components.code, { children: "mirrorRemoteSurface" }),
				" call. Contract bumped ",
				createVNode(_components.code, { children: "0.1 → 0.2" }),
				" (additive); rode ",
				createVNode(_components.code, { children: "surface.md" }),
				"’s drishti merge-gate."
			] }),
			"\n"
		] }),
		"\n",
		"\n",
		"\n",
		"\n",
		"\n",
		createVNode(_components.style, { children: `
.fb-pulse { animation: fbpulse 1.8s ease-in-out infinite; }
@keyframes fbpulse { 0%, 100% { opacity: 1 } 50% { opacity: .5 } }
.fb-spin { animation: fbspin 1.1s linear infinite; transform-origin: 50% 54%; }
@keyframes fbspin { to { transform: rotate(360deg) } }
` }),
		"\n",
		createVNode(FleetBoard, { mode: "alert" }),
		"\n",
		createVNode(_components.p, { children: [
			"When nothing needs you the board sits ",
			createVNode(_components.strong, { children: "calm" }),
			" — cyan working spinners, dim idle rows, a quiet ",
			createVNode(_components.code, { children: "all clear ✓" }),
			". The moment an agent hits ",
			createVNode(_components.code, { children: "awaiting_user" }),
			" its row lifts to the top of the fleet and a warm amber strip ",
			createVNode(_components.strong, { children: "breathes" }),
			", so a glance tells you ",
			createVNode(_components.em, { children: "someone’s waiting" }),
			" before you’ve read a word. Rows sort ",
			createVNode(_components.strong, { children: "needs-you first" }),
			" across the whole fleet; ",
			createVNode(_components.code, { children: "--by agent" }),
			" regroups into one fleet-wide “who is waiting on input, anywhere” list; ",
			createVNode(_components.code, { children: "--json" }),
			" emits the flat ",
			createVNode(_components.code, { children: "[{ host, terminalId, ...TerminalSnapshot }]" }),
			" for a notifier. Unreachable / skew / empty hosts each render distinctly rather than silently vanishing."
		] }),
		"\n",
		createVNode(FleetBoard, { mode: "calm" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Host is stamped at the dial site" }),
			", never by the daemon — the awareness-layer echo of kolu’s kolu-side ",
			createVNode(_components.code, { children: "location" }),
			" stamp (",
			createVNode(_components.code, { children: "TerminalSnapshot" }),
			" deliberately carries no ",
			createVNode(_components.code, { children: "hostId" }),
			"). The render reads the aggregate keyed by ",
			createVNode(_components.code, { children: "(host, terminalId)" }),
			", so two boxes’ identical terminal ids stay distinct."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-fleet-board-moved-to-the-browser--and-pulam-tui-slimmed-down",
			children: "The fleet board moved to the browser — and pulam-tui slimmed down"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"R4.5 shipped the fleet board ",
			createVNode(_components.em, { children: ["as an OpenTUI dashboard inside ", createVNode(_components.code, { children: "pulam-tui" })] }),
			" — a Bun binary, a Zig renderer via ",
			createVNode(_components.code, { children: "Bun.dlopen" }),
			", bun2nix packaging. That was the right call ",
			createVNode(_components.strong, { children: "while the TUI was the only rich fleet view" }),
			". It no longer is: ",
			createVNode(_components.strong, { children: createVNode(_components.a, {
				href: "pulam-web.html",
				children: "pulam-web"
			}) }),
			" is the browser fleet dashboard, and it is the better home for the multi-host glance. So the OpenTUI/Bun half is walked back — ",
			createVNode(_components.code, { children: "pulam-tui" }),
			" reverts to a ",
			createVNode(_components.a, {
				href: "pty-daemon-tui.html",
				children: "kaval-tui"
			}),
			"-style raw client (",
			createVNode(_components.code, { children: "status" }),
			" / ",
			createVNode(_components.code, { children: "watch" }),
			", one daemon over a socket or ssh), and the multi-host fleet lives in pulam-web. The full strip-back — what leaves the package and why — is ",
			createVNode(_components.strong, { children: createVNode(_components.a, {
				href: "pulam-tui.html",
				children: "pulam-tui"
			}) }),
			"’s own note."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The ",
			createVNode(_components.strong, { children: "electricity" }),
			" call survives the move intact — it lands cleaner, in fact:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"pulam’s fleet was the awareness analog of ",
				createVNode(_components.a, {
					href: "electricity.html",
					children: "drishti"
				}),
				": a second consumer proving pulam’s ",
				createVNode(_components.strong, { children: "own" }),
				" surface is a receptacle (the fan-out needed ",
				createVNode(_components.strong, { children: "no contract change" }),
				" — that invariance ",
				createVNode(_components.em, { children: "is" }),
				" the proof). ",
				createVNode(_components.a, {
					href: "pulam-web.html",
					children: "pulam-web"
				}),
				" is now that second consumer, and the ",
				createVNode(_components.em, { children: "better" }),
				" one, so the proof stands without the TUI having to be rich to carry it."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The renderer is electricity, but a domain-agnostic Solid→surface capability the ",
				createVNode(_components.em, { children: "browser" }),
				" already owns — so the TUI no longer mints or even consumes a terminal renderer. The aggregation join stays a leaf reducer (a bounded host-keyed merge, not a hard volatility — transport + provision + reconnect belong to ",
				createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
				"), now living in pulam-web. No ",
				createVNode(_components.code, { children: "@kolu/fleet-mirror" }),
				", the “tidy generic helper” trap electricity warns against."
			] }),
			"\n"
		] }),
		"\n",
		createVNode("a", { id: "r46" }),
		"\n",
		createVNode(_components.h2, {
			id: "r46r48--the-forward-roadmap-what-pulam-proves-before-kolus-r8",
			children: [
				"R4.6–R4.8 — the forward roadmap: what ",
				createVNode(_components.em, { children: "pulam" }),
				" proves before kolu’s R8"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The discipline that built this epic: ",
			createVNode(_components.strong, { children: "every hard primitive graduates through a standalone consumer before kolu touches it" }),
			" — kaval-tui proved the PTY dial, the fleet board proved the awareness mirror, ",
			createVNode(_components.a, {
				href: "electricity.html",
				children: "drishti"
			}),
			" proved the surface mirror + forwarded procedures. Kolu’s remote-terminals ",
			createVNode(_components.strong, { children: "fs/git leg" }),
			" (now ",
			createVNode(_components.a, {
				href: "remote-terminals.html#r9",
				children: createVNode(_components.strong, { children: "R9" })
			}),
			") reached for ",
			createVNode(_components.em, { children: "one" }),
			" thing no standalone consumer had exercised — the ",
			createVNode(_components.strong, { children: "fs/git Code-tab live updates over the browser ws" }),
			" — and the discarded #1510 spent months there. (The real block turned out to be the ",
			createVNode(_components.em, { children: "file-tree renderer" }),
			" not repainting under change-pulse churn, ",
			createVNode(_components.strong, { children: "not" }),
			" the transport — but it was blind: the prod client build hides the console, the server log lives in an ephemeral sandbox.) These three phases pay the debt. Each is a real ",
			createVNode(_components.em, { children: "pulam" }),
			" feature ",
			createVNode(_components.strong, { children: "and" }),
			" the graduation gate for remote-terminals ",
			createVNode(_components.strong, { children: "R9" }),
			" — the drishti pattern, one more turn."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Phase" }),
					"\n",
					createVNode(_components.th, { children: "Ships" }),
					"\n",
					createVNode(_components.th, { children: "…and the gate it is for kolu" }),
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
						createVNode(_components.strong, { children: "R4.6 · rename" }),
						" ",
						createVNode($$Pill, { children: "refactor" }),
						" ",
						createVNode($$PrLink, { pr: 1512 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"arivu → ",
						createVNode(_components.strong, { children: "pulam" }),
						" — the daemon, ",
						createVNode(_components.code, { children: "pulam-tui" }),
						", this note; the package stays ",
						createVNode(_components.code, { children: "@kolu/terminal-workspace" }),
						". Behaviour-preserving; green CI is the proof. ",
						createVNode(_components.em, { children: "Deliberately just the rename — across code, Nix, docs, and the website." })
					] }),
					"\n",
					createVNode(_components.td, { children: "clears the “knowing” misnomer before new surface area is born under it" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: [
							createVNode(_components.a, {
								href: "#r47",
								children: "R4.7"
							}),
							" · live ",
							createVNode(_components.code, { children: "git status" }),
							" in ",
							createVNode(_components.code, { children: "pulam-tui fleet" })
						] }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "feature"
						}),
						" ",
						createVNode($$PrLink, { pr: 1519 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"each fleet ",
						createVNode(_components.strong, { children: "row" }),
						" grows a ",
						createVNode(_components.strong, { children: "live working-tree cell" }),
						" (changed-file count + branch ahead/behind), and a ",
						createVNode(_components.strong, { children: "selected" }),
						" row (↑/↓ · Enter) ",
						createVNode(_components.strong, { children: "drills in" }),
						" to the full ",
						createVNode(_components.code, { children: "git status" }),
						" — ",
						createVNode(_components.code, { children: "staged · modified · untracked" }),
						" + the changed-file list. Driven by ",
						createVNode(_components.code, { children: "subscribeRepoChange" }),
						"’s ",
						createVNode(_components.code, { children: "{seq}" }),
						" pulse re-running ",
						createVNode(_components.code, { children: "git.getStatus" }),
						"; ",
						createVNode(_components.em, { children: "no file content" }),
						" — the changed-file ",
						createVNode(_components.strong, { children: "list" }),
						", never bodies or diffs. ",
						createVNode(_components.code, { children: "git.getStatus" }),
						"’s ",
						createVNode(_components.code, { children: "local" }),
						" arm grew the branch header + section counts and dropped the always-null ",
						createVNode(_components.code, { children: "base" }),
						" — a ",
						createVNode(_components.em, { children: "breaking" }),
						" reshape, so the workspace contract bumps ",
						createVNode(_components.code, { children: "0.3 → 1.0" }),
						"."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"the server ",
						createVNode(_components.code, { children: "source" }),
						"-arm ",
						createVNode(_components.code, { children: "{seq}" }),
						" ",
						createVNode(_components.strong, { children: "shape" }),
						", end-to-end and observable — “is the shape sound?”"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: [
							createVNode(_components.a, {
								href: "pulam-web.html",
								children: "R4.8"
							}),
							" · ",
							createVNode(_components.code, { children: "pulam-web" })
						] }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "feature"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"the ",
						createVNode(_components.strong, { children: "browser twin" }),
						" (",
						createVNode(_components.a, {
							href: "pulam-web.html",
							children: "its own note"
						}),
						") — a ",
						createVNode(_components.a, {
							href: "electricity.html",
							children: "drishti"
						}),
						"-shaped browser ↔ ssh app reading pulam’s surface over ",
						createVNode(_components.strong, { children: [
							createVNode(_components.code, { children: "websocketLink" }),
							" + ",
							createVNode(_components.code, { children: "surfaceClient" }),
							" + Solid ",
							createVNode(_components.code, { children: "reconcile" })
						] }),
						". Cheapest-first: ",
						createVNode(_components.strong, { children: "R-pulamweb-1" }),
						" drishti consumer ✅ · ",
						createVNode(_components.strong, { children: "R-pulamweb-2" }),
						" framework ✅ ",
						createVNode($$PrLink, { pr: 1524 }),
						" · ",
						createVNode(_components.strong, { children: "R-pulamweb-3" }),
						" agent dashboard ✅ ",
						createVNode($$PrLink, { pr: 1535 }),
						" · ",
						createVNode(_components.strong, { children: "R-pulamweb-4" }),
						" live git status + drill-in ◀ next."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "kolu’s exact failing leg" }),
						" — ws + ",
						createVNode(_components.code, { children: "surfaceClient" }),
						" + reconcile — proven kolu-free with a ",
						createVNode(_components.em, { children: "visible console" }),
						"; the recipe ",
						createVNode(_components.strong, { children: "R9" }),
						" rides on"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"Why a ",
				createVNode(_components.em, { children: "web" }),
				" twin, when the TUI sufficed for the glance view."
			] }),
			" pulam-tui rides ",
			createVNode(_components.code, { children: "stdioLink" }),
			" + mirror sinks, so it structurally ",
			createVNode(_components.em, { children: "cannot" }),
			" exercise the leg kolu fails on: browser ",
			createVNode(_components.code, { children: "websocketLink" }),
			" → ",
			createVNode(_components.code, { children: "surfaceClient" }),
			" → Solid ",
			createVNode(_components.code, { children: "reconcile" }),
			". pulam-web ",
			createVNode(_components.em, { children: "is" }),
			" that leg, minus kolu — it reads the ",
			createVNode(_components.strong, { children: "same" }),
			" surface the ",
			createVNode(_components.strong, { children: "same" }),
			" way kolu’s browser will. So it is not a prettier dashboard (that would be the ceremony the fleet-board callout warned against); it is the standalone proof of ",
			createVNode(_components.strong, { children: "kolu’s own consumption shape" }),
			". Only once R4.7 (shape) and R4.8 (transport) are green does kolu’s ",
			createVNode(_components.strong, { children: createVNode(_components.a, {
				href: "remote-terminals.html#r9",
				children: "R9"
			}) }),
			" compose the surface — now a backing-swap onto twice-proven electricity, not a speculative one."
		] }),
		"\n",
		createVNode("a", { id: "r47" }),
		"\n",
		createVNode(_components.h3, {
			id: "r47--pulam-tui-fleet-a-live-git-status-view-proving-the-seq-shape",
			children: [
				"R4.7 — ",
				createVNode(_components.code, { children: "pulam-tui fleet" }),
				": a live ",
				createVNode(_components.code, { children: "git status" }),
				" view (proving the ",
				createVNode(_components.code, { children: "{seq}" }),
				" shape)"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The fleet board already shows each terminal’s ",
			createVNode(_components.code, { children: "repo·branch" }),
			" from the ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "snapshots" }), " collection"] }),
			" — the primitive R4.5 proved. R4.7 consumes the ",
			createVNode(_components.em, { children: "other" }),
			" arm of the surface, the one kolu’s Code tab needs and ",
			createVNode(_components.strong, { children: "nothing had exercised" }),
			": the ",
			createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "subscribeRepoChange" }),
				" ",
				createVNode(_components.code, { children: "{seq}" }),
				" watcher stream"
			] }),
			" re-running the ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "git.getStatus" }), " procedure"] }),
			". Each fleet ",
			createVNode(_components.strong, { children: "row" }),
			" grows a ",
			createVNode(_components.strong, { children: "live working-tree cell" }),
			" — a changed-file count plus the branch’s ahead/behind — and selecting a row (↑/↓) and pressing Enter ",
			createVNode(_components.strong, { children: "drills in" }),
			" to the full ",
			createVNode(_components.code, { children: "git status" }),
			": the ",
			createVNode(_components.code, { children: "staged · modified · untracked" }),
			" summary and the changed-file list. ",
			createVNode(_components.em, { children: "No file content, no diff" }),
			" — the changed-file ",
			createVNode(_components.strong, { children: "list" }),
			" (paths + status codes), never file bodies; ",
			createVNode(_components.code, { children: "git status" }),
			" alone drives the exact pulse-plus-requery loop kolu fails on, so it is the proof."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"To paint ahead/behind, ",
			createVNode(_components.code, { children: "git.getStatus" }),
			"’s ",
			createVNode(_components.code, { children: "local" }),
			" output grew a branch tracking header (",
			createVNode(_components.code, { children: "name · upstream · ahead · behind" }),
			") and the working-tree section counts — read off the ",
			createVNode(_components.em, { children: "same" }),
			" ",
			createVNode(_components.code, { children: "git status" }),
			" the file list already reads, so it costs no extra git call (simple-git already computes both and the code just stopped discarding them). The same change models the result as a discriminated union on ",
			createVNode(_components.code, { children: "mode" }),
			" and ",
			createVNode(_components.strong, { children: ["drops the always-null ", createVNode(_components.code, { children: "base" })] }),
			" from the ",
			createVNode(_components.code, { children: "local" }),
			" arm; removing a field a ",
			createVNode(_components.code, { children: "0.3" }),
			" viewer’s schema still requires is a ",
			createVNode(_components.em, { children: "breaking" }),
			" reshape, so the workspace contract bumps ",
			createVNode(_components.code, { children: "0.3 → 1.0" }),
			" (a ",
			createVNode(_components.strong, { children: "major" }),
			", not a minor) and the gate marks ",
			createVNode(_components.code, { children: "0.3" }),
			" and ",
			createVNode(_components.code, { children: "1.0" }),
			" mutually ",
			createVNode(_components.code, { children: "skew" }),
			" in both directions. This is the one place R4.7 extends the surface rather than purely consuming it — and it stays in ",
			createVNode(_components.code, { children: "kolu-git" }),
			" + ",
			createVNode(_components.code, { children: "@kolu/terminal-workspace" }),
			", touching no ",
			createVNode(_components.code, { children: "@kolu/surface*" }),
			" API, so it needs ",
			createVNode(_components.strong, { children: "no drishti gate" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The consume loop is ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "RepoWatchSet" }) }),
			": per ",
			createVNode(_components.em, { children: "distinct repo" }),
			" across the fleet, subscribe to the ",
			createVNode(_components.code, { children: "{seq}" }),
			" pulse and re-query ",
			createVNode(_components.code, { children: "getStatus" }),
			" on each, keyed by repo root so repo-mates share one subscription and the last to leave tears it down. It runs over the real unix-socket / ",
			createVNode(_components.code, { children: "stdioLink" }),
			" link, so R4.7 answers one question: ",
			createVNode(_components.strong, { children: [
				"does the ",
				createVNode(_components.code, { children: "{seq}" }),
				" source-arm stream + requery survive a real link, end to end?"
			] }),
			" Proven by an integration test over a real served socket (a working-tree change pulses → the re-query reflects it) and by raw-PTY capture — frame N+1 ≠ frame N on a ",
			createVNode(_components.code, { children: "touch" }),
			" / ",
			createVNode(_components.code, { children: "git add" }),
			" — ",
			createVNode(_components.em, { children: "never directLink" }),
			" (the in-process path that masked the bug)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"So the ",
			createVNode(_components.em, { children: "shape" }),
			" is sound over a real wire. ",
			createVNode(_components.strong, { children: [
				"But the consumer here is raw ",
				createVNode(_components.code, { children: "for await" }),
				" iteration over a ",
				createVNode(_components.code, { children: "mirrorRemoteSurface" }),
				" handle — close kin to ",
				createVNode(_components.code, { children: "directLink" }),
				", and ",
				createVNode(_components.em, { children: "not" }),
				" kolu’s consumer."
			] }),
			" kolu’s browser (and the #1510 prototype that stuck) reads through ",
			createVNode(_components.code, { children: "surfaceClient.streams.use()" }),
			" + a Solid ",
			createVNode(_components.code, { children: "reconcile" }),
			" store — a path R4.7 never touches. So two unknowns remain, both R4.8’s: that consumer, and whether the surface should hand a raw ",
			createVNode(_components.code, { children: "{seq}" }),
			" pulse to a browser at all."
		] }),
		"\n",
		createVNode("a", { id: "r48" }),
		"\n",
		createVNode(_components.h3, {
			id: "r48--pulam-web-the-browser-twin--its-own-note",
			children: [
				"R4.8 — ",
				createVNode(_components.code, { children: "pulam-web" }),
				": the browser twin → ",
				createVNode(_components.a, {
					href: "pulam-web.html",
					children: "its own note"
				})
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"R4.8 grew its own UI and a layered plan, so it moved to a dedicated note: ",
			createVNode(_components.strong, { children: createVNode(_components.a, {
				href: "pulam-web.html",
				children: "pulam-web"
			}) }),
			". The short of it — a ",
			createVNode(_components.a, {
				href: "electricity.html",
				children: "drishti"
			}),
			"-shaped ",
			createVNode(_components.strong, { children: "Node" }),
			" browser ↔ ssh app reading pulam’s surface over ",
			createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "websocketLink" }),
				" + ",
				createVNode(_components.code, { children: "surfaceClient" }),
				" + Solid ",
				createVNode(_components.code, { children: "reconcile" })
			] }),
			", ",
			createVNode(_components.em, { children: "kolu’s exact browser-consumption leg minus kolu" }),
			" (Node + Vite, matching kolu’s own stack). It lands cheapest-first: ",
			createVNode(_components.strong, { children: "R-pulamweb-1" }),
			" graduates the reactive stream consumer in ",
			createVNode(_components.strong, { children: "drishti" }),
			" ✅; ",
			createVNode(_components.strong, { children: "R-pulamweb-2" }),
			" stands up the whole framework (provision · fan-out · mirror · re-serve) rendering only a ",
			createVNode(_components.strong, { children: "terminal list" }),
			" ✅ ",
			createVNode($$PrLink, { pr: 1524 }),
			"; ",
			createVNode(_components.strong, { children: "R-pulamweb-3" }),
			" layers the ",
			createVNode(_components.strong, { children: "agent dashboard" }),
			" (every agent sorted by what needs you) ✅ ",
			createVNode($$PrLink, { pr: 1535 }),
			"; ",
			createVNode(_components.strong, { children: "R-pulamweb-4" }),
			" adds the live git status + drill-in — ",
			createVNode(_components.em, { children: "do next" }),
			". Full plan, UI mockup, and verified reuse map live in ",
			createVNode(_components.strong, { children: createVNode(_components.a, {
				href: "pulam-web.html",
				children: "pulam-web"
			}) }),
			"."
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
				createVNode(_components.strong, { children: "pulam-tui slimmed to a thin client; the fleet board is the browser’s" }),
				" (2026-06-26, ",
				createVNode($$PrLink, { pr: 1582 }),
				") — now that ",
				createVNode(_components.a, {
					href: "pulam-web.html",
					children: "pulam-web"
				}),
				" carries the rich multi-host fleet dashboard (R-pulamweb-3, ",
				createVNode($$PrLink, { pr: 1535 }),
				"), ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" no longer needs to be a full-blown TUI. It reverts to a ",
				createVNode(_components.a, {
					href: "pty-daemon-tui.html",
					children: "kaval-tui"
				}),
				"-style raw client — ",
				createVNode(_components.code, { children: "status" }),
				" / ",
				createVNode(_components.code, { children: "watch" }),
				" against ",
				createVNode(_components.strong, { children: "one" }),
				" daemon over a socket or ssh — shedding ",
				createVNode(_components.strong, { children: "Bun + OpenTUI" }),
				", bun2nix, and the multi-host ",
				createVNode(_components.code, { children: "fleet" }),
				" board (all of which leave for pulam-web). The R4.5 fleet board and the “Why this stays a TUI” / “Why Bun” sections are superseded for the client; the strip-back has its own note, ",
				createVNode(_components.strong, { children: createVNode(_components.a, {
					href: "pulam-tui.html",
					children: "pulam-tui"
				}) }),
				". The electricity proof is unaffected — pulam-web is the second consumer that carries it."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "pulam-web split into its own note" }),
				" (2026-06-22) — R4.8 grew its own UI + a layered plan, so it moved to ",
				createVNode(_components.strong, { children: createVNode(_components.a, {
					href: "pulam-web.html",
					children: "pulam-web"
				}) }),
				". Grounded against ",
				createVNode(_components.code, { children: "/home/srid/code/drishti" }),
				" (",
				createVNode(_components.strong, { children: "Node + Vite" }),
				" chosen to match kolu’s stack — the surface leg is identical ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				" code, so the runtime was free; Bun was only drishti’s bundler; autoprovision via ",
				createVNode(_components.code, { children: "getHostSession" }),
				" + ",
				createVNode(_components.code, { children: "provisionAgent" }),
				") and ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" (the ",
				createVNode(_components.code, { children: "startFleet" }),
				" / ",
				createVNode(_components.code, { children: "FleetSink" }),
				" / ",
				createVNode(_components.code, { children: "RepoWatchSet" }),
				" core is renderer-agnostic). Layered as ",
				createVNode(_components.strong, { children: "Step 0" }),
				" (drishti graduates the reactive ",
				createVNode(_components.code, { children: ".streams.use()" }),
				" consumer via ",
				createVNode(_components.code, { children: "processesSnapshot" }),
				") · ",
				createVNode(_components.strong, { children: "R4.8a" }),
				" the whole framework rendering only a terminal list · ",
				createVNode(_components.strong, { children: "R4.8b" }),
				" the user-facing features."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R4.8 plan grounded against R4.7’s shipped code" }),
				" (2026-06-22) — verified R4.7 consumed the real ",
				createVNode(_components.code, { children: "{seq}" }),
				" stream (not the value-bearing awareness ",
				createVNode(_components.code, { children: "git" }),
				" field), so its charter is met — ",
				createVNode(_components.em, { children: "but" }),
				" via ",
				createVNode(_components.code, { children: "pulam-tui" }),
				"’s ",
				createVNode(_components.strong, { children: [
					"raw ",
					createVNode(_components.code, { children: "mirrorRemoteSurface" }),
					" iteration"
				] }),
				", not kolu’s ",
				createVNode(_components.code, { children: "surfaceClient" }),
				" + ",
				createVNode(_components.code, { children: "reconcile" }),
				" (the path #1510 stuck on, which R4.7 never touches). R4.8 sharpened so that gap can’t recur: a trap callout (don’t port the raw loop), an explicit ",
				createVNode(_components.strong, { children: "value-bearing-vs-procedure+pulse design fork" }),
				" (the two shapes are explained in ",
				createVNode(_components.a, {
					href: "surface-live-data.html",
					children: "surface live data"
				}),
				"), a definition-of-done demanding the ",
				createVNode(_components.code, { children: "surfaceClient" }),
				"+reconcile consumer ",
				createVNode(_components.strong, { children: "plus" }),
				" live-over-ws evidence, and a verified file map. The earlier R4.7 plan named the ",
				createVNode(_components.em, { children: "feature" }),
				" (“live git status”) without pinning the ",
				createVNode(_components.em, { children: "mechanism" }),
				" it existed to prove — a planning defect now corrected."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"R4.7 live ",
					createVNode(_components.code, { children: "git status" }),
					" shipped"
				] }),
				" (2026-06-22, ",
				createVNode($$PrLink, { pr: 1519 }),
				") — the fleet board’s first consumer of the surface’s fs/git ",
				createVNode(_components.code, { children: "{seq}" }),
				" watcher arm: each row gains a live working-tree cell (changed count + branch ahead/behind) and a ↑/↓-selectable drill-in to the full ",
				createVNode(_components.code, { children: "git status" }),
				", all driven by ",
				createVNode(_components.code, { children: "subscribeRepoChange" }),
				" re-querying ",
				createVNode(_components.code, { children: "git.getStatus" }),
				". ",
				createVNode(_components.code, { children: "getStatus" }),
				"’s local mode grew the branch tracking header + working-tree counts (off the same ",
				createVNode(_components.code, { children: "git status" }),
				") and dropped the always-null ",
				createVNode(_components.code, { children: "base" }),
				", a breaking reshape that bumps the workspace contract ",
				createVNode(_components.code, { children: "0.3 → 1.0" }),
				"; a ",
				createVNode(_components.code, { children: "RepoWatchSet" }),
				" owns the per-repo subscribe→requery lifecycle. Proven over a real link in ",
				createVNode(_components.code, { children: "pulam/daemon.test.ts" }),
				" (a working-tree change pulses → the re-query reflects it) — the graduation gate for kolu’s remote Code-tab live updates (",
				createVNode(_components.a, {
					href: "remote-terminals.html",
					children: "remote-terminals"
				}),
				" R8b). The lens debate split extend-",
				createVNode(_components.code, { children: "getStatus" }),
				" (hickey) vs ahead/behind-on-the-awareness-sensor (lowy); extending won because routing it through awareness would skip the very loop R4.7 exists to prove."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R4.6 rename shipped" }),
				" (2026-06-22, ",
				createVNode($$PrLink, { pr: 1512 }),
				") — arivu → ",
				createVNode(_components.strong, { children: "pulam" }),
				" carried all the way through: the ",
				createVNode(_components.code, { children: "pulam" }),
				"/",
				createVNode(_components.code, { children: "pulam-tui" }),
				" packages (dir + bin), the Nix flake/",
				createVNode(_components.code, { children: "default.nix" }),
				" attrs + ",
				createVNode(_components.code, { children: "PULAM_*" }),
				" env vars, the ",
				createVNode(_components.code, { children: "$XDG_RUNTIME_DIR/pulam/awareness.sock" }),
				" namespace, the website’s ",
				createVNode(_components.code, { children: "nix run …#pulam" }),
				" commands + etymology, and the sibling Atlas notes. Behaviour-preserving — green CI on both platforms is the proof."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Forward roadmap branched in" }),
				" (2026-06-22) — arivu is renamed ",
				createVNode(_components.strong, { children: "pulam" }),
				" (புலம் — ",
				createVNode(_components.em, { children: "field" }),
				" + ",
				createVNode(_components.em, { children: "sense" }),
				") in ",
				createVNode(_components.a, {
					href: "#r46",
					children: "R4.6"
				}),
				" (kept small: just the rename), and two graduation gates for kolu’s remote-terminals R8 land as standalone pulam features — ",
				createVNode(_components.strong, { children: createVNode(_components.a, {
					href: "#r47",
					children: "R4.7"
				}) }),
				" gives ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" a live ",
				createVNode(_components.code, { children: "git status" }),
				" view (the first consumer of the surface’s ",
				createVNode(_components.code, { children: "{seq}" }),
				" stream — no file content needed), and ",
				createVNode(_components.strong, { children: createVNode(_components.a, {
					href: "#r48",
					children: "R4.8"
				}) }),
				" ships ",
				createVNode(_components.code, { children: "pulam-web" }),
				" (the browser twin) to prove the ws + ",
				createVNode(_components.code, { children: "surfaceClient" }),
				" + reconcile leg kolu’s R8b depends on. Branched from ",
				createVNode(_components.a, {
					href: "remote-terminals.html",
					children: "remote-terminals"
				}),
				" after a prototype (",
				createVNode($$PrLink, { pr: 1510 }),
				") validated the awareness one-writer-per-fact compose but stuck on that un-graduated stream-transport primitive."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The standalone story shipped end-to-end R4.1–R4.5: extract → daemon → remote viewer → Bun → OpenTUI → live fleet → live activity. Supersedes two closed plans (",
				createVNode($$PrLink, { pr: 1398 }),
				", ",
				createVNode($$PrLink, { pr: 1409 }),
				") that kept awareness ",
				createVNode(_components.em, { children: "inside" }),
				" kolu and split hairs over an in-process compose-vs-serve boundary this design dissolves by moving the producer into a daemon."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["R4.4 → ", createVNode(_components.code, { children: "dialAgentOnce" })] }),
				" — the gauntlet lifted the shared one-shot dial into ",
				createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
				"; kaval-tui and pulam-tui are now thin wrappers over one primitive (paired drishti pin-bump merge-gate)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R4.5.3 as-built" }),
				" — the board is always live (",
				createVNode(_components.code, { children: "--json" }),
				" is the one-shot); a dropped one-shot dial flips a host to ",
				createVNode(_components.code, { children: "unreachable" }),
				" rather than reconnecting (long-lived reconnect stays remote-terminals R9 / ",
				createVNode(_components.code, { children: "HostSession" }),
				"); host discovery is ",
				createVNode(_components.code, { children: "--host" }),
				" + a small ",
				createVNode(_components.code, { children: "~/.ssh/config" }),
				" enumerator (no new dep). Gauntlet + dogfooding added ",
				createVNode(_components.code, { children: "--kaval <host>=<socket>" }),
				" pinning, a responsive ",
				createVNode(_components.code, { children: "repo·branch" }),
				" layout, the ",
				createVNode(_components.code, { children: "--host" }),
				" stderr-bleed fix (",
				createVNode(_components.code, { children: "onLog" }),
				" sink), and a darwin ",
				createVNode(_components.code, { children: "bun install --backend=copyfile" }),
				" fix."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Packaging co-located" }),
				" (",
				createVNode($$PrLink, { pr: 1491 }),
				") — the viewer’s Bun/Nix manifest moved from ",
				createVNode(_components.code, { children: "nix/packages/" }),
				" into ",
				createVNode(_components.code, { children: "packages/pulam-tui/nix/" }),
				" so the viewer is one self-contained directory (a pnpm-workspace exclusion keeps the bun manifest out of pnpm’s glob)."
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
	"title": "pulam — the terminal-workspace surface as an ephemeral daemon on kaval",
	"description": "Repeat the kaval decoupling one level up. The awareness sensors (git · PR · agent · foreground) plus fs/git become a generic library that fills one typed surface — kolu runs it in-process locally, and an ephemeral daemon (pulam) on top of kaval serves the same surface over ssh for remote terminals. kolu reads that observation through one seam, never folding a copy into its own record. One library, two homes. The standalone tools ship first; the R4.6–R4.8 forward roadmap (rename → pulam · fs/git in pulam-tui · pulam-web) graduates the browser-ws-stream primitive kolu's remote-terminals R8 depends on.",
	"parents": ["kaval-sessions", "feature"],
	"status": "accepted",
	"maturity": "budding",
	"updated": "2026-06-26T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-core-model",
			"text": "The core model"
		},
		{
			"depth": 2,
			"slug": "one-library-two-homes--one-shape-of-consumption",
			"text": "One library, two homes — one shape of consumption"
		},
		{
			"depth": 2,
			"slug": "the-standalone-tools--pulam--its-two-clients",
			"text": "The standalone tools — pulam + its two clients"
		},
		{
			"depth": 2,
			"slug": "the-r4-tree--shipped-end-to-end",
			"text": "The R4 tree — shipped end-to-end"
		},
		{
			"depth": 2,
			"slug": "r45--the-fleet-board",
			"text": "R4.5 — the fleet board"
		},
		{
			"depth": 2,
			"slug": "the-fleet-board-moved-to-the-browser--and-pulam-tui-slimmed-down",
			"text": "The fleet board moved to the browser — and pulam-tui slimmed down"
		},
		{
			"depth": 2,
			"slug": "r46r48--the-forward-roadmap-what-pulam-proves-before-kolus-r8",
			"text": "R4.6–R4.8 — the forward roadmap: what pulam proves before kolu’s R8"
		},
		{
			"depth": 3,
			"slug": "r47--pulam-tui-fleet-a-live-git-status-view-proving-the-seq-shape",
			"text": "R4.7 — pulam-tui fleet: a live git status view (proving the {seq} shape)"
		},
		{
			"depth": 3,
			"slug": "r48--pulam-web-the-browser-twin--its-own-note",
			"text": "R4.8 — pulam-web: the browser twin → its own note"
		},
		{
			"depth": 2,
			"slug": "history",
			"text": "History"
		}
	];
}
var url = "src/content/atlas/pulam.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/pulam.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/pulam.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, FBPAL, FleetBoard, FleetGroup, FleetRow, file, frontmatter, getHeadings, url };
