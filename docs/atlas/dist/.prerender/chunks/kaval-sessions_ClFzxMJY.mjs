import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
//#region src/content/atlas/kaval-sessions.mdx
var KavalCanvas = () => createVNode("div", {
	style: "margin:1.5rem 0;max-width:35rem;border:1px solid #11131a;border-radius:11px;overflow:hidden;box-shadow:0 6px 22px rgba(0,0,0,.3);font-family:ui-sans-serif,system-ui",
	children: [
		createVNode("div", {
			style: "display:flex;align-items:center;gap:.5rem;padding:.5rem .8rem;background:#1b1e27;border-bottom:1px solid #11131a",
			children: [
				createVNode("span", {
					style: "font:700 .8rem/1 ui-monospace,monospace;color:#e8ecf7",
					children: "kolu"
				}),
				createVNode("span", { style: "width:1px;height:14px;background:#343a48;margin:0 .1rem;display:inline-block" }),
				createVNode("span", {
					style: "display:inline-flex;align-items:center;gap:.3rem;padding:.26rem .5rem;background:#222632;border:1px solid #3a4152;border-radius:6px;font:600 .66rem/1 ui-monospace,monospace;color:#c9d1e3",
					children: [createVNode("span", { style: "width:6px;height:6px;border-radius:50%;background:#27c93f;display:inline-block" }), "local"]
				}),
				createVNode("span", {
					style: "display:inline-flex;align-items:center;gap:.3rem;padding:.26rem .5rem;background:#222632;border:1px solid #3a4152;border-radius:6px;font:600 .66rem/1 ui-monospace,monospace;color:#c9d1e3",
					children: [
						createVNode("span", { style: "width:6px;height:6px;border-radius:50%;background:#ffbd2e;display:inline-block" }),
						"prod",
						createVNode("span", {
							style: "font:600 .52rem/1 ui-monospace,monospace;color:#7fb0ff;border:1px solid #38507a;border-radius:3px;padding:.06rem .22rem",
							children: "ssh"
						})
					]
				}),
				createVNode("span", {
					style: "font:.64rem/1 ui-monospace,monospace;color:#5b6377",
					children: "+ host"
				}),
				createVNode("span", { style: "flex:1" }),
				createVNode("span", {
					style: "font:.55rem/1 ui-monospace,monospace;color:#5b6377",
					children: "from ssh config"
				})
			]
		}),
		createVNode("div", {
			style: "display:grid;grid-template-columns:1fr 1fr;gap:.6rem;padding:.7rem;background:#0e1016",
			children: [createVNode("div", {
				style: "border:1px solid #2a2f3a;border-radius:8px;background:#161922;overflow:hidden",
				children: [createVNode("div", {
					style: "display:flex;align-items:center;gap:.35rem;padding:.32rem .5rem;background:rgba(228,228,232,.05);border-bottom:1px solid #22262f",
					children: [
						createVNode("span", { style: "width:6px;height:6px;border-radius:50%;background:#27c93f;display:inline-block" }),
						createVNode("span", {
							style: "font:600 .6rem/1 ui-monospace,monospace;color:#9aa3ba",
							children: "build · ~/app"
						}),
						createVNode("span", { style: "flex:1" }),
						createVNode("span", {
							style: "font:600 .5rem/1 ui-monospace,monospace;color:#6b7488",
							children: "local"
						})
					]
				}), createVNode("div", {
					style: "padding:.45rem .5rem;font:.6rem/1.5 ui-monospace,monospace;color:#8a93a8",
					children: "▸ vite build — watching…"
				})]
			}), createVNode("div", {
				style: "border:1px solid #2a2f3a;border-radius:8px;background:#161922;overflow:hidden",
				children: [createVNode("div", {
					style: "display:flex;align-items:center;gap:.35rem;padding:.32rem .5rem;background:rgba(228,228,232,.05);border-bottom:1px solid #22262f",
					children: [
						createVNode("span", { style: "width:6px;height:6px;border-radius:50%;background:#ffbd2e;display:inline-block" }),
						createVNode("span", {
							style: "font:600 .6rem/1 ui-monospace,monospace;color:#9aa3ba",
							children: "deploy · prod"
						}),
						createVNode("span", { style: "flex:1" }),
						createVNode("span", {
							style: "font:600 .5rem/1 ui-monospace,monospace;color:#7fb0ff",
							children: "ssh"
						})
					]
				}), createVNode("div", {
					style: "padding:.45rem .5rem;font:.6rem/1.5 ui-monospace,monospace;color:#8a93a8",
					children: "$ kubectl rollout status…"
				})]
			})]
		}),
		createVNode("div", {
			style: "padding:.5rem .8rem;background:#0e1016;border-top:1px solid #14161d;font:.62rem/1.4 ui-monospace,monospace;color:#6b7488",
			children: [
				"↳ one canvas, tiles on different kavals — ",
				createVNode("span", {
					style: "color:#9aa3ba",
					children: "local"
				}),
				" always present, remotes added on demand"
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
				"The R3 branch of ",
				createVNode(_components.a, {
					href: "remote-terminals.html",
					children: "remote-terminals"
				}),
				" — remote over ssh."
			] }),
			" A kaval is ",
			createVNode(_components.strong, { children: "a daemon you dial" }),
			" — local over a unix socket, remote over ssh — so remote is ",
			createVNode(_components.strong, { children: "not a second backend" }),
			". One backend, bound to an endpoint; location never complected in. Put a tile on any kaval. Whether the canvas ",
			createVNode(_components.strong, { children: "switches" }),
			" one kaval at a time (tmux-style) or ",
			createVNode(_components.strong, { children: "multiplexes" }),
			" several side by side is a UI choice on the ",
			createVNode(_components.em, { children: "same" }),
			" substrate — and because kolu is a ",
			createVNode(_components.em, { children: "canvas" }),
			", it leans multiplex."
		] }),
		"\n",
		createVNode(KavalCanvas, {}),
		"\n",
		createVNode(_components.h2, {
			id: "one-backend-bound-to-a-dialed-endpoint",
			children: "One backend, bound to a dialed endpoint"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"kolu-server keys its pty-host endpoint by ",
			createVNode(_components.code, { children: "hostId" }),
			" (one key today — ",
			createVNode(_components.code, { children: "local" }),
			"). R3 just instantiates more keys: a registry of kaval endpoints, each reached by a driver — unix socket (local, shipped) or ssh stdio (",
			createVNode(_components.code, { children: "HostSession" }),
			", the same closure ",
			createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
			" ships). ",
			createVNode(_components.strong, { children: [
				"One backend means one ",
				createVNode(_components.em, { children: "shape" }),
				", not one host:"
			] }),
			" three surfaces bound to an endpoint — ",
			createVNode(_components.strong, { children: "PTY · fs · git" }),
			" — local vs remote only the transport each is dialed over."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "At the endpoint" }),
					"\n",
					createVNode(_components.th, { children: "local" }),
					"\n",
					createVNode(_components.th, { children: [
						"remote — same ",
						createVNode(_components.code, { children: "HostSession" }),
						" link"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "PTY" }), " — kaval (fds + OSC taps)"] }),
					"\n",
					createVNode(_components.td, { children: "unix socket" }),
					"\n",
					createVNode(_components.td, { children: "ssh stdio" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "awareness — provider DAG + git watcher" }) }),
					"\n",
					createVNode(_components.td, { children: "in kolu-server (in-process)" }),
					"\n",
					createVNode(_components.td, { children: [
						"in ",
						createVNode(_components.strong, { children: createVNode(_components.a, {
							href: "pulam.html",
							children: "pulam"
						}) }),
						" → mirrored, kolu reads (R8)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Code-tab fs" }), " — browse · read · watch"] }),
					"\n",
					createVNode(_components.td, { children: "node fs (native)" }),
					"\n",
					createVNode(_components.td, { children: "a thin remote fs/git surface · snapshot-then-delta" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Awareness providers (cwd · title · foreground · command · agent-detection) are ",
			createVNode(_components.em, { children: "tap-fed" }),
			", so transport-free. kaval stays the durable survivor; the ",
			createVNode(_components.strong, { children: ["provider DAG is ", createVNode(_components.a, {
				href: "pulam.html",
				children: "pulam"
			})] }),
			" — the host-side awareness daemon, already shipped standalone and decoupled from kolu — dialed and read in by R8–R9. pulam is ",
			createVNode(_components.strong, { children: "ephemeral and re-provisioned each dial" }),
			", so its sensors are always re-derived from the current build (the #1031 “never serve stale detection” lesson, met by re-provisioning, not a kolu-coupled process). kaval itself is dialed ",
			createVNode(_components.strong, { children: "directly" }),
			" over ssh via the shipped ",
			createVNode(_components.code, { children: "frontDaemonOverStdio" }),
			" (R3.4) — nothing fronts it. So R3.1’s ",
			createVNode(_components.code, { children: "TerminalEndpoint" }),
			" rename anticipated a second ",
			createVNode(_components.em, { children: "implementation" }),
			" the kaval model dissolves: not two backends, one whose surfaces bind to an endpoint. Adding a kaval is ",
			createVNode(_components.strong, { children: "adoption you already shipped" }),
			" — ",
			createVNode(_components.code, { children: "adoptOrEnsure" }),
			" adopts a live survivor’s PTYs (else provisions + spawns), now run per endpoint — and multiple ",
			createVNode(_components.em, { children: "local" }),
			" kavals fall out free (kaval is namespaced per kolu-server port, ",
			createVNode(_components.code, { children: "kaval-<port>/" }),
			", ",
			createVNode($$PrLink, { pr: 1313 }),
			")."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Switch or multiplex" }),
			" is a later, reversible UI call the spike doesn’t depend on. The lean is ",
			createVNode(_components.strong, { children: "multiplex" }),
			": switch is a ",
			createVNode(_components.em, { children: "terminal-multiplexer" }),
			" metaphor, but kolu is a ",
			createVNode(_components.em, { children: "canvas" }),
			" — “watch a local build beside a prod-ssh tile” is the point, not a corner case. The cost over switch is modest and clean — per-tile ",
			createVNode(_components.code, { children: "location" }),
			" returns, but ",
			createVNode(_components.em, { children: "additively" }),
			" (no ",
			createVNode(_components.code, { children: "RemoteTerminalBackend" }),
			", no screen mirror — just which endpoint holds this tile’s PTY), and the ChromeBar shows only the kavals this canvas actually has tiles on."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-spike--kaval-tui-dials-local-and-ssh-r31r36-shipped",
			children: "The spike — kaval-tui dials local and ssh (R3.1–R3.6, shipped)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.a, {
				href: "pty-daemon-tui.html",
				children: "kaval-tui"
			}),
			" is the minimal client — it proves the transport before any kolu UI, and because it and kolu-server dial the same socket through the same client, ",
			createVNode(_components.strong, { children: [
				"the spike ",
				createVNode(_components.em, { children: "is" }),
				" the production driver"
			] }),
			". Both halves landed."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode($$Pill, {
			variant: "ok",
			children: "shipped"
		}), " The full warm path, dialing a remote kaval:"] }),
		"\n",
		createVNode(_components.pre, {
			class: "astro-code github-light",
			style: {
				backgroundColor: "#fff",
				color: "#24292e",
				overflowX: "auto"
			},
			tabindex: "0",
			"data-language": "plaintext",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "$ kaval-tui list --host nix@prod" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  ↳ ssh nix@prod · nix copy --derivation → realise … kaval up" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  ↳ dialing the remote kaval over ssh stdio … connected · 0 terminals" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "$ kaval-tui create --host nix@prod      → spawned a8f1…  plain shell on prod" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "$ kaval-tui attach a8f1… --host nix@prod" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  ↳ ~/app on prod — remote PTY survives · detach/reattach anytime" })
				})
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
					createVNode(_components.th, { children: "What shipped" }),
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
						createVNode(_components.strong, { children: "R3.1" }),
						" · backend cleanup ",
						createVNode($$PrLink, { pr: 1364 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"collapsed the speculative ",
						createVNode(_components.code, { children: "TerminalBackend" }),
						"/",
						createVNode(_components.code, { children: "getTerminalBackendFor(location)" }),
						" dispatch into one ",
						createVNode(_components.strong, { children: createVNode(_components.code, { children: "TerminalEndpoint" }) }),
						" (renamed, byte-identical) — remote becomes a transport, not a second backend. Its doc-comment is the seam the parent’s R9 fills"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "R3.2" }),
						" · ",
						createVNode(_components.code, { children: "kaval-tui create" }),
						" ",
						createVNode($$PrLink, { pr: 1370 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"spawns a plain ",
						createVNode(_components.code, { children: "$SHELL" }),
						" (or ",
						createVNode(_components.code, { children: "create -- htop -d 5" }),
						") and prints the id — a fresh daemon needs something to attach to. Thin over ",
						createVNode(_components.code, { children: "terminal.spawn" }),
						" (spawn is fully-specified; the caller composes ",
						createVNode(_components.code, { children: "{argv, env, initFiles}" }),
						", no kolu policy). ",
						createVNode(_components.code, { children: "--json" }),
						" for scripts"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "R3.3" }),
						" · ",
						createVNode(_components.code, { children: "kaval-tui --host" }),
						" ",
						createVNode($$PrLink, { pr: 1373 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "reach + provision in one PR" }),
						" (ssh). One ",
						createVNode(_components.code, { children: "getHostSession" }),
						" both provisions (",
						createVNode(_components.code, { children: "nix copy --derivation" }),
						" → realise → pin) and dials over ssh ",
						createVNode(_components.code, { children: "stdioLink" }),
						", handing back the same ",
						createVNode(_components.code, { children: "ptyHostSurface" }),
						" client the unix socket speaks. The one daemon-side addition — ",
						createVNode(_components.code, { children: "kaval --stdio" }),
						" — ",
						createVNode(_components.strong, { children: "fronts the durable daemon" }),
						" (adopt-or-start the host’s kaval, raw-byte-relay the link to its unix socket), so a remote PTY survives the link. ssh-config auto-detect deferred"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "R3.4" }),
						" · upstream ",
						createVNode(_components.code, { children: "frontDaemonOverStdio" }),
						" ",
						createVNode($$PrLink, { pr: 1374 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"homed R3.3’s durable-fronting bridge in ",
						createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/surface-daemon" }) }),
						" as ",
						createVNode(_components.code, { children: "frontDaemonOverStdio" }),
						" — the ",
						createVNode(_components.strong, { children: ["durable counterpart to ", createVNode(_components.code, { children: "serveOverStdio" })] }),
						" (“",
						createVNode(_components.code, { children: "dtach" }),
						"/",
						createVNode(_components.code, { children: "abduco" }),
						" for any surface daemon, over ssh”): a contract-agnostic relay + adopt-or-spawn, parameterized by socket path + spawn command. kaval’s ",
						createVNode(_components.code, { children: "--stdio" }),
						" became a thin call into it"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "R3.5" }),
						" · skip redundant provisioning ",
						createVNode($$PrLink, { pr: 1377 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"a warm host re-ran the full ",
						createVNode(_components.code, { children: "nix copy → realise → pin" }),
						" (copy reports ",
						createVNode(_components.em, { children: "“copying 0 paths”" }),
						"). ",
						createVNode(_components.code, { children: "provisionAgent" }),
						" now tries the cheap realise+pin ",
						createVNode(_components.strong, { children: "first" }),
						" (instant when the closure is present, doubles as the presence check), falling through to the full copy only on a miss — keyed on store-realisability, not the dangle-prone GC root. Internal to the shared ensure verb, so ",
						createVNode(_components.strong, { children: "drishti" }),
						" gets the warm-skip free"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "R3.6" }),
						" · multiplex ssh connections ",
						createVNode($$PrLink, { pr: 1378 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"the warm path still opened ",
						createVNode(_components.strong, { children: "3" }),
						" separate ssh handshakes (arch probe · provision check · agent dial). One shared connection via ",
						createVNode(_components.code, { children: "ControlMaster=auto" }),
						"/",
						createVNode(_components.code, { children: "ControlPersist" }),
						", added as ",
						createVNode(_components.code, { children: "-o" }),
						" flags to the existing ",
						createVNode(_components.code, { children: "SSH_OPT_PAIRS" }),
						" (no ",
						createVNode(_components.code, { children: "~/.ssh/config" }),
						" touch; a kolu-private ",
						createVNode(_components.code, { children: "%C" }),
						" ",
						createVNode(_components.code, { children: "ControlPath" }),
						"), plus a per-host arch cache. Warm dial → one handshake + near-instant channels"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "ssh reach is the one genuinely-new transport",
			children: createVNode(_components.p, { children: [
				"ssh ",
				createVNode(_components.em, { children: "reach + provision" }),
				" is R3’s biggest unknown, shared by both granularities. Proving it in kaval-tui builds the production driver and lets real feedback settle switch-vs-multiplex later — the right validation step even before the canvas model is final. (R3.1 was independent kolu-server cleanup; it landed first, without waiting on the spike.) The durable-fronting bridge (R3.4) is a ",
				createVNode(_components.em, { children: "different primitive" }),
				" from the ephemeral remote-agent ",
				createVNode(_components.code, { children: "serveOverStdio" }),
				" serves — mini-ci, remote-process-monitor, and drishti all ",
				createVNode(_components.em, { children: "re-run fresh" }),
				" per link; the durable bridge proxies a ",
				createVNode(_components.em, { children: "separate, gate-held" }),
				" daemon (the mosh/tmux/",
				createVNode(_components.code, { children: "dtach" }),
				" lineage, generalized to any surface daemon). drishti’s companion is a ",
				createVNode(_components.em, { children: "verified-compatible pin bump" }),
				", not a durable-observer rewrite — drishti’s ",
				createVNode(_components.code, { children: "/proc" }),
				" snapshot rebuilds in ~2s by design, so durability fights its nothing-on-the-remote identity."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Measured warm path" }), " (real ssh, median of 7, the exact opts the code emits). Three round-trips; multiplexing turns 2 of the 3 handshakes into channel reuse, so the saving scales with distance:"] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "host" }),
					"\n",
					createVNode(_components.th, { children: "fresh handshake" }),
					"\n",
					createVNode(_components.th, { children: "multiplexed channel" }),
					"\n",
					createVNode(_components.th, { children: [
						"warm-path ssh: ",
						createVNode(_components.strong, { children: "before" }),
						" → ",
						createVNode(_components.strong, { children: "after" })
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "linux pu box (kolu-ci-1, Tailscale)" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "5.42 s" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "0.70 s" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "16.3 s → 6.8 s" }), " (2.4×)"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "darwin (rasam, Tailscale WAN)" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "2.89 s" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "0.48 s" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "8.7 s → 3.9 s" }), " (2.25×)"] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "whats-next--in-the-parent-roadmap",
			children: "What’s next — in the parent roadmap"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Dialing remotes, composing awareness + fs/git, and the multiplex canvas now live as the linear ",
			createVNode(_components.strong, { children: "R5–R10" }),
			" roadmap in the parent ",
			createVNode(_components.a, {
				href: "remote-terminals.html",
				children: "remote-terminals"
			}),
			" note — including pulam growing an ",
			createVNode(_components.strong, { children: "fs/git surface" }),
			" (R6). This note is the shipped spike (R3.1–R3.6)."
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
				createVNode(_components.strong, { children: "2026-06" }),
				" — the spike shipped R3.1→R3.6 end to end: backend cleanup (",
				createVNode($$PrLink, { pr: 1364 }),
				"), ",
				createVNode(_components.code, { children: "kaval-tui create" }),
				" (",
				createVNode($$PrLink, { pr: 1370 }),
				"), ",
				createVNode(_components.code, { children: "--host" }),
				" reach + provision (",
				createVNode($$PrLink, { pr: 1373 }),
				"), ",
				createVNode(_components.code, { children: "frontDaemonOverStdio" }),
				" upstreamed to ",
				createVNode(_components.code, { children: "@kolu/surface-daemon" }),
				" (",
				createVNode($$PrLink, { pr: 1374 }),
				"), warm-skip provisioning (",
				createVNode($$PrLink, { pr: 1377 }),
				"), ssh ",
				createVNode(_components.code, { children: "ControlMaster" }),
				" multiplexing (",
				createVNode($$PrLink, { pr: 1378 }),
				"). The spike is the production driver."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Renumbered to the one R1–R10 tree" }),
				" (2026-06-21) — this note is ",
				createVNode(_components.strong, { children: "R3" }),
				"; was a local ",
				createVNode(_components.code, { children: "P0…P4" }),
				" scheme, now gone (git holds the old labels). kolu composes awareness in the parent’s ",
				createVNode(_components.strong, { children: "R8" }),
				" (the server-side fold dissolves there) and dials remotes in ",
				createVNode(_components.strong, { children: "R9" }),
				"; ",
				createVNode(_components.strong, { children: "R4" }),
				" is ",
				createVNode(_components.a, {
					href: "pulam.html",
					children: "pulam"
				}),
				" (the awareness daemon); the foundation seam is ",
				createVNode(_components.strong, { children: "R1" }),
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
	"title": "Kaval sessions — dial daemons, multiplex the canvas",
	"description": "The R3 branch of remote-terminals — remote-over-ssh. A kaval is a daemon you dial (local unix socket, remote ssh via surface-nix-host), so remote is never a second backend. The spike shipped (R3.1–R3.6): kaval-tui create + --host reach/provision, the warm path deduped and connection-multiplexed. The forward work — composing one surface, dialing remotes, the canvas — now lives in the parent remote-terminals R5–R10 roadmap.",
	"parents": ["remote-terminals", "feature"],
	"status": "accepted",
	"maturity": "budding",
	"updated": "2026-06-22T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "one-backend-bound-to-a-dialed-endpoint",
			"text": "One backend, bound to a dialed endpoint"
		},
		{
			"depth": 2,
			"slug": "the-spike--kaval-tui-dials-local-and-ssh-r31r36-shipped",
			"text": "The spike — kaval-tui dials local and ssh (R3.1–R3.6, shipped)"
		},
		{
			"depth": 2,
			"slug": "whats-next--in-the-parent-roadmap",
			"text": "What’s next — in the parent roadmap"
		},
		{
			"depth": 2,
			"slug": "history",
			"text": "History"
		}
	];
}
var url = "src/content/atlas/kaval-sessions.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-sessions.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-sessions.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, KavalCanvas, file, frontmatter, getHeadings, url };
