import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$D2 } from "./D2_CXsCOQdn.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$Cite } from "./Cite_D-1zLbJ9.mjs";
import { t as $$Terminal } from "./Terminal_Cqh2_20m.mjs";
//#region src/content/atlas/kaval-vs-zmosh.mdx
var Journey = () => createVNode("div", {
	style: "margin:1.5rem 0;overflow-x:auto",
	children: createVNode("svg", {
		viewBox: "0 0 720 196",
		width: "100%",
		style: "min-width:560px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;font-family:ui-sans-serif,system-ui",
		role: "img",
		"aria-label": "A roaming timeline left to right: desk Wi-Fi attached, then ~20 minutes offline with the lid closed while moving from Wi-Fi to cellular, then café cellular still attached — one kaval session spanning the whole width unbroken, scrollback intact, no reconnect.",
		children: [
			createVNode("defs", { children: createVNode("linearGradient", {
				id: "kvzJyGap",
				x1: "0",
				y1: "0",
				x2: "1",
				y2: "0",
				children: [
					createVNode("stop", {
						offset: "0",
						"stop-color": "#15803d"
					}),
					createVNode("stop", {
						offset: "0.04",
						"stop-color": "#9aa0aa"
					}),
					createVNode("stop", {
						offset: "0.96",
						"stop-color": "#9aa0aa"
					}),
					createVNode("stop", {
						offset: "1",
						"stop-color": "#15803d"
					})
				]
			}) }),
			createVNode("text", {
				x: "22",
				y: "28",
				"font-size": "13",
				"font-weight": "700",
				fill: "#0a0f25",
				children: "Attach once. Keep it."
			}),
			createVNode("text", {
				x: "22",
				y: "44",
				"font-size": "10.5",
				fill: "#6b7178",
				children: "one green session, end to end — the only break is the network, never the session"
			}),
			createVNode("rect", {
				x: "24",
				y: "60",
				width: "186",
				height: "62",
				rx: "8",
				fill: "#e6f4ea",
				stroke: "#15803d",
				"stroke-width": "2"
			}),
			createVNode("text", {
				x: "40",
				y: "82",
				"font-size": "12",
				"font-weight": "700",
				fill: "#14532d",
				children: "desk · Wi-Fi"
			}),
			createVNode("text", {
				x: "40",
				y: "99",
				"font-size": "11",
				"font-family": "ui-monospace,'SF Mono',Menlo,monospace",
				fill: "#4a5072",
				children: "198.51.100.7"
			}),
			createVNode("circle", {
				cx: "46",
				cy: "112",
				r: "4",
				fill: "#15803d"
			}),
			createVNode("text", {
				x: "56",
				y: "116",
				"font-size": "10.5",
				"font-weight": "600",
				fill: "#166534",
				children: "attached"
			}),
			createVNode("rect", {
				x: "226",
				y: "60",
				width: "266",
				height: "62",
				rx: "8",
				fill: "#f4f4f5",
				stroke: "#9aa0aa",
				"stroke-width": "1.3",
				"stroke-dasharray": "5 4"
			}),
			createVNode("text", {
				x: "359",
				y: "80",
				"font-size": "12",
				"font-weight": "700",
				fill: "#71717a",
				"text-anchor": "middle",
				children: "lid closed · moving"
			}),
			createVNode("text", {
				x: "359",
				y: "97",
				"font-size": "11",
				fill: "#71717a",
				"text-anchor": "middle",
				children: "Wi-Fi → cellular · no IP"
			}),
			createVNode("text", {
				x: "359",
				y: "115",
				"font-size": "11",
				"font-weight": "700",
				fill: "#71717a",
				"text-anchor": "middle",
				children: "◷ OFFLINE ~20 min"
			}),
			createVNode("rect", {
				x: "508",
				y: "60",
				width: "188",
				height: "62",
				rx: "8",
				fill: "#e6f4ea",
				stroke: "#15803d",
				"stroke-width": "2"
			}),
			createVNode("text", {
				x: "524",
				y: "82",
				"font-size": "12",
				"font-weight": "700",
				fill: "#14532d",
				children: "café · cellular"
			}),
			createVNode("text", {
				x: "524",
				y: "99",
				"font-size": "11",
				"font-family": "ui-monospace,'SF Mono',Menlo,monospace",
				fill: "#4a5072",
				children: "203.0.113.9"
			}),
			createVNode("circle", {
				cx: "530",
				cy: "112",
				r: "4",
				fill: "#15803d"
			}),
			createVNode("text", {
				x: "540",
				y: "116",
				"font-size": "10.5",
				"font-weight": "700",
				fill: "#166534",
				children: "still attached"
			}),
			createVNode("rect", {
				x: "24",
				y: "146",
				width: "672",
				height: "22",
				rx: "11",
				fill: "url(#kvzJyGap)"
			}),
			createVNode("text", {
				x: "36",
				y: "161",
				"font-size": "11",
				"font-weight": "600",
				fill: "#fff",
				children: "one kaval session — never re-created · scrollback intact · no reconnect spinner"
			})
		]
	})
});
var Recovery = () => createVNode("div", {
	style: "margin:1.5rem 0;overflow-x:auto",
	children: createVNode("svg", {
		viewBox: "0 0 720 196",
		width: "100%",
		style: "min-width:560px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;font-family:ui-sans-serif,system-ui",
		role: "img",
		"aria-label": "Three panels. zmosh on loss replays the full screen snapshot. kaval on attach does snapshot-then-delta from @xterm/headless — the same recovery primitive, already shipped (green). What is missing is only a roaming transport to carry it (today ssh stdio) — the only new code (amber).",
		children: [
			createVNode("text", {
				x: "22",
				y: "27",
				"font-size": "13",
				"font-weight": "700",
				fill: "#0a0f25",
				children: "The hard part is recovery — kaval already does it"
			}),
			createVNode("rect", {
				x: "24",
				y: "44",
				width: "206",
				height: "100",
				rx: "8",
				fill: "#f4f4f5",
				stroke: "#9aa0aa",
				"stroke-width": "1.3"
			}),
			createVNode("text", {
				x: "38",
				y: "66",
				"font-size": "12.5",
				"font-weight": "700",
				fill: "#3f444b",
				children: "zmosh, on loss"
			}),
			createVNode("text", {
				x: "38",
				y: "89",
				"font-size": "11",
				fill: "#3f444b",
				children: "gap on a seq ⇒ replay"
			}),
			createVNode("text", {
				x: "38",
				y: "105",
				"font-size": "11",
				fill: "#3f444b",
				children: "the full screen snapshot"
			}),
			createVNode("text", {
				x: "38",
				y: "131",
				"font-size": "10",
				"font-family": "ui-monospace,'SF Mono',Menlo,monospace",
				fill: "#9aa0a6",
				children: "serve.zig:389-398"
			}),
			createVNode("text", {
				x: "243",
				y: "98",
				"font-size": "15",
				"font-weight": "700",
				fill: "#9aa0aa",
				"text-anchor": "middle",
				children: "≡"
			}),
			createVNode("rect", {
				x: "253",
				y: "38",
				width: "216",
				height: "112",
				rx: "9",
				fill: "#e6f4ea",
				stroke: "#15803d",
				"stroke-width": "2.4"
			}),
			createVNode("rect", {
				x: "253",
				y: "38",
				width: "216",
				height: "20",
				rx: "9",
				fill: "#15803d"
			}),
			createVNode("rect", {
				x: "253",
				y: "48",
				width: "216",
				height: "10",
				fill: "#15803d"
			}),
			createVNode("text", {
				x: "267",
				y: "52",
				"font-size": "10.5",
				"font-weight": "700",
				fill: "#fff",
				children: "ALREADY SHIPPED · the hard part"
			}),
			createVNode("text", {
				x: "267",
				y: "82",
				"font-size": "12.5",
				"font-weight": "700",
				fill: "#14532d",
				children: "kaval, on attach"
			}),
			createVNode("text", {
				x: "267",
				y: "103",
				"font-size": "11",
				fill: "#11203a",
				children: "snapshot-then-delta from"
			}),
			createVNode("text", {
				x: "267",
				y: "119",
				"font-size": "11",
				"font-family": "ui-monospace,'SF Mono',Menlo,monospace",
				fill: "#166534",
				children: "@xterm/headless"
			}),
			createVNode("text", {
				x: "267",
				y: "139",
				"font-size": "10",
				"font-family": "ui-monospace,'SF Mono',Menlo,monospace",
				fill: "#15803d",
				children: "ptyHost.ts:565-573"
			}),
			createVNode("rect", {
				x: "490",
				y: "44",
				width: "206",
				height: "100",
				rx: "50",
				fill: "#fbf1dc",
				stroke: "#b45309",
				"stroke-width": "2.4"
			}),
			createVNode("text", {
				x: "513",
				y: "66",
				"font-size": "12.5",
				"font-weight": "700",
				fill: "#92400e",
				children: "what's missing"
			}),
			createVNode("text", {
				x: "513",
				y: "89",
				"font-size": "11",
				fill: "#7a4f00",
				children: "a roaming transport to"
			}),
			createVNode("text", {
				x: "513",
				y: "105",
				"font-size": "11",
				fill: "#7a4f00",
				children: "carry it (today: ssh stdio)"
			}),
			createVNode("text", {
				x: "513",
				y: "131",
				"font-size": "10",
				"font-weight": "700",
				"font-style": "italic",
				fill: "#b45309",
				children: "+ the only new code"
			}),
			createVNode("text", {
				x: "22",
				y: "176",
				"font-size": "11.5",
				fill: "#11203a",
				children: [
					"Same primitive — re-send the ",
					createVNode("tspan", {
						"font-weight": "700",
						children: "whole screen"
					}),
					", never the lost bytes. kaval owns it server-side; only the pipe needs to roam."
				]
			})
		]
	})
});
var CidViz = () => createVNode("div", {
	style: "margin:1.5rem 0;overflow-x:auto",
	children: createVNode("svg", {
		viewBox: "0 0 720 244",
		width: "100%",
		style: "min-width:600px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;font-family:ui-sans-serif,system-ui",
		role: "img",
		"aria-label": "What QUIC changes: the connection isn't the IP. TCP/ssh is keyed by the 4-tuple, so a client IP change breaks the 4-tuple and the connection dies — re-dial plus a fresh TLS/ssh handshake. QUIC is keyed by a Connection ID carried in every packet, so the same IP change keeps the same connection running; PATH_CHALLENGE validates the path in 1 RTT.",
		children: [
			createVNode("text", {
				x: "22",
				y: "27",
				"font-size": "13",
				"font-weight": "700",
				fill: "#0a0f25",
				children: "What QUIC changes — the connection isn't the IP"
			}),
			createVNode("rect", {
				x: "24",
				y: "44",
				width: "324",
				height: "158",
				rx: "9",
				fill: "#fbeee7",
				stroke: "#b3471f",
				"stroke-width": "1.5"
			}),
			createVNode("text", {
				x: "40",
				y: "68",
				"font-size": "12",
				"font-weight": "700",
				fill: "#b1241a",
				children: "TCP / ssh — keyed by the 4-tuple"
			}),
			createVNode("rect", {
				x: "40",
				y: "82",
				width: "292",
				height: "32",
				rx: "6",
				fill: "#fff",
				stroke: "#e0b3a6",
				"stroke-dasharray": "5 4"
			}),
			createVNode("text", {
				x: "52",
				y: "102",
				"font-size": "10",
				"font-family": "ui-monospace,'SF Mono',Menlo,monospace",
				fill: "#1a1c20",
				children: "conn = (198.51.100.7:51000 → prod:22)"
			}),
			createVNode("text", {
				x: "40",
				y: "138",
				"font-size": "10.5",
				fill: "#3f444b",
				children: "client IP changes → 203.0.113.9"
			}),
			createVNode("text", {
				x: "40",
				y: "160",
				"font-size": "11",
				"font-weight": "700",
				fill: "#b1241a",
				children: "✗ 4-tuple broke — connection dead"
			}),
			createVNode("text", {
				x: "40",
				y: "180",
				"font-size": "10.5",
				fill: "#6b7178",
				children: "re-dial + fresh TLS/ssh handshake"
			}),
			createVNode("rect", {
				x: "372",
				y: "44",
				width: "324",
				height: "158",
				rx: "9",
				fill: "#eaf6ec",
				stroke: "#15803d",
				"stroke-width": "2.4"
			}),
			createVNode("text", {
				x: "388",
				y: "68",
				"font-size": "12",
				"font-weight": "700",
				fill: "#166534",
				children: "QUIC — keyed by Connection ID"
			}),
			createVNode("rect", {
				x: "388",
				y: "82",
				width: "292",
				height: "32",
				rx: "6",
				fill: "#fff",
				stroke: "#9fd4b1"
			}),
			createVNode("text", {
				x: "400",
				y: "102",
				"font-size": "10",
				"font-family": "ui-monospace,'SF Mono',Menlo,monospace",
				fill: "#14532d",
				children: "conn = CID 0x9f3a… (in every packet)"
			}),
			createVNode("text", {
				x: "388",
				y: "138",
				"font-size": "10.5",
				fill: "#11203a",
				children: "client IP changes → 203.0.113.9 · CID stays"
			}),
			createVNode("text", {
				x: "388",
				y: "160",
				"font-size": "11",
				"font-weight": "700",
				fill: "#166534",
				children: "✓ same connection — keeps running"
			}),
			createVNode("text", {
				x: "388",
				y: "180",
				"font-size": "10.5",
				fill: "#4a5072",
				children: "PATH_CHALLENGE validates the path · 1 RTT"
			}),
			createVNode("text", {
				x: "22",
				y: "222",
				"font-size": "10.5",
				fill: "#4a5072",
				children: ["RFC 9000 §9 · only the client migrates (exactly kaval-tui's direction) ·", createVNode("tspan", {
					x: "22",
					dy: "15",
					children: "the stream stays reliable+ordered, so kaval's wire rides it unchanged"
				})]
			})
		]
	})
});
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		del: "del",
		em: "em",
		h2: "h2",
		h3: "h3",
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
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "kaval-tui" }),
			" attaches to kaval sessions — local over a unix socket, and (R3) remote over ssh. ",
			createVNode(_components.strong, { children: "zmosh" }),
			" (",
			createVNode(_components.a, {
				href: "https://github.com/mmonad/zmosh",
				children: "mmonad/zmosh"
			}),
			") is a session daemon whose remote attach survives Wi-Fi↔cellular and sleep/wake with no reconnect. This note: give kaval-tui the same. ",
			createVNode($$Pill, {
				variant: "new",
				children: "24-agent workflow · verified vs. both codebases"
			})
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "see-it",
			children: "See it"
		}),
		"\n",
		createVNode(_components.p, { children: "Same command, today vs. with roaming. The difference is the 20 minutes you don’t notice." }),
		"\n",
		createVNode($$Terminal, {
			title: "today · kaval-tui --host over ssh stdio",
			lines: [
				"$ kaval-tui --host nix@prod attach build",
				"  ↳ prod · vite build — watching…            [ssh stdio · TCP]",
				"  — close laptop · walk to café · Wi-Fi → cellular —",
				"  ⚠ ssh: connection reset by peer",
				"  ↳ re-dialing prod… re-attaching… snapshot restored",
				"  ✓ back — after ~6 s of dead air, and only because you noticed"
			]
		}),
		"\n",
		createVNode($$Terminal, {
			title: "with roaming · kaval-tui --host over QUIC",
			lines: [
				"$ kaval-tui --host nix@prod attach build",
				"  ↳ prod · vite build — watching…            [QUIC]",
				"  — close laptop · walk to café · Wi-Fi → cellular —",
				"  ✓ build finished — never dropped a frame",
				"    (one authenticated datagram re-pinned the peer · scrollback intact)"
			]
		}),
		"\n",
		createVNode(Journey, {}),
		"\n",
		createVNode(_components.p, { children: [
			"That is the whole user-facing win: ",
			createVNode(_components.strong, { children: "attach once, and the session is yours until you kill it" }),
			" — across network switches, VPN flips, and a closed lid. No ",
			createVNode(_components.code, { children: "⚠" }),
			", no spinner, no lost output."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "one-hop-one-swap",
			children: "One hop, one swap"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"kaval-tui ↔ kaval is a ",
			createVNode(_components.strong, { children: "single hop" }),
			" — exactly zmosh’s shape. Local attach (unix socket) is already roam-proof; only the ",
			createVNode(_components.strong, { children: "remote" }),
			" transport changes. Nothing about kaval the daemon, your shell, or detach/reattach moves."
		] }),
		"\n",
		createVNode($$D2, {
			caption: "The only thing that changes is the wire between kaval-tui and a remote kaval. Today it's ssh stdio (a TCP child that dies on an IP change); the swap is teaching kaval to bind an encrypted-UDP listener beside its unix socket — no extra process — where one authenticated datagram re-pins the peer after a roam.",
			code: `direction: down
tui: "kaval-tui · your laptop"
kaval: "kaval daemon · remote host — owns PTYs + server-side VT" {
style.fill: "#e7f6ec"
style.stroke: "#1b7a3a"
}
pty: "your shell / build / agent — survives detach"
tui -> kaval: "the ONE hop: ssh stdio (drops on roam)  →  QUIC (roams · connection migration · RFC 9000 ss9)" {
style.stroke: "#c0392b"
style.stroke-width: 3
}
kaval -> pty: "owned in-process · OSC taps — unchanged"
`
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				"Local ",
				createVNode(_components.code, { children: "kaval-tui attach" }),
				" is untouched"
			] }), " — unix socket, same machine, nothing to roam."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Remote: kaval ",
					createVNode(_components.em, { children: "also" }),
					" binds an encrypted-UDP (QUIC) listener"
				] }),
				" — a ",
				createVNode(_components.code, { children: "serveOverUdp" }),
				" link beside today’s ",
				createVNode(_components.code, { children: "serveOverUnixSocket" }),
				", serving the ",
				createVNode(_components.em, { children: "same" }),
				" shared router. No extra process. Started over ssh it hands off its port + cert (à la mosh); the ssh pipe closes and QUIC carries the session."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Why not just make the PTY socket itself UDP?",
			children: createVNode(_components.p, { children: [
				"You almost can — and you don’t need a separate gateway ",
				createVNode(_components.em, { children: "process" }),
				" to do it; kaval binds the UDP listener itself, next to the unix socket. But the socket can’t be ",
				createVNode(_components.em, { children: "repointed" }),
				" at UDP, for one hard reason: kaval’s wire is base64+newline oRPC over a ",
				createVNode(_components.strong, { children: "reliable, ordered stream" }),
				" (",
				createVNode($$Cite, {
					file: "packages/surface/src/links/unix-socket.ts",
					lines: "34-39"
				}),
				" hands the raw ",
				createVNode(_components.code, { children: "net.Socket" }),
				" straight to ",
				createVNode(_components.code, { children: "stdioLink" }),
				"). That framing has no sequence numbers, no retransmit, no reassembly — TCP/unix-stream gives it those. UDP is lossy, unordered, and datagram-capped, so it needs a reliability + crypto + roaming layer ",
				createVNode(_components.em, { children: "underneath" }),
				" the same wire. ",
				createVNode(_components.strong, { children: "That layer is QUIC" }),
				" — a QUIC stream is reliable, ordered, and TLS-1.3-encrypted, and it roams via connection migration — so you don’t hand-roll the equivalent of zmosh’s ",
				createVNode($$Cite, {
					file: "src/transport.zig",
					lines: "110-211",
					repo: "mmonad/zmosh",
					label: "transport.zig"
				}),
				". Either way it’s a ",
				createVNode(_components.strong, { children: "transport kaval binds" }),
				", not a daemon it spawns. (See ",
				createVNode("a", {
					href: "#the-transport-quic",
					children: "The transport"
				}),
				".) Keep the unix socket for local (cheap, same-host, filesystem-authed — that privacy gate ",
				createVNode(_components.em, { children: "is" }),
				" the security model); add UDP only for the remote case, and only it pays for crypto."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "already-half-built",
			children: "Already half-built"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The expensive half of “mosh for a session daemon” is keeping a ",
			createVNode(_components.strong, { children: "server-side terminal-state authority" }),
			" so a reconnecting client can be re-hydrated. kaval has it — ",
			createVNode(_components.code, { children: "@xterm/headless" }),
			" mirrors every byte and ",
			createVNode(_components.code, { children: "attach()" }),
			" hands back a race-free snapshot-then-delta (",
			createVNode($$Cite, {
				file: "packages/kaval/src/ptyHost.ts",
				lines: "565-573"
			}),
			"). On overflow it sheds the wedged consumer and recovers with a fresh snapshot (",
			createVNode($$Cite, {
				file: "packages/kaval/src/channel.ts",
				lines: "120-131"
			}),
			"). That is zmosh’s recovery model, already shipped."
		] }),
		"\n",
		createVNode(Recovery, {}),
		"\n",
		createVNode(_components.p, { children: [
			"So the work is ",
			createVNode(_components.strong, { children: "only the transport" }),
			" — the daemon, the VT, the wire contract (",
			createVNode($$Cite, {
				file: "packages/kaval/src/ptyHost.ts",
				lines: "565-573",
				label: "ptyHostSurface · contract 3.0"
			}),
			"), and kaval-tui’s attach loop all stay as they are."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-transport--quic",
			children: "The transport — QUIC"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The remote wire should be ",
			createVNode(_components.strong, { children: "QUIC" }),
			" — and not as a hedge. QUIC is UDP + TLS 1.3 + reliable, multiplexed, ordered streams (RFC 9000/9001/9002). Two of its properties are ",
			createVNode(_components.em, { children: "exactly" }),
			" this problem:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Connection migration is the roaming" }),
				" (RFC 9000 §9, §5.1, verified). A QUIC connection is keyed by a ",
				createVNode(_components.strong, { children: "Connection ID in the packet, not the 4-tuple" }),
				" — so an IP/port change (Wi-Fi→cellular, NAT-rebind on wake) keeps the ",
				createVNode(_components.em, { children: "same" }),
				" connection after a one-round-trip ",
				createVNode(_components.code, { children: "PATH_CHALLENGE" }),
				"/",
				createVNode(_components.code, { children: "PATH_RESPONSE" }),
				". No re-dial, no re-handshake. Only the client migrates — exactly kaval-tui’s direction."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A QUIC stream is reliable + ordered, so kaval’s wire rides it unchanged." }),
				" kaval’s base64+newline oRPC already runs over a reliable duplex (",
				createVNode(_components.code, { children: "stdioLink" }),
				"); a QUIC bidi stream ",
				createVNode(_components.em, { children: "is" }),
				" that duplex — hand it to the same codec, zero reassembly shim."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(CidViz, {}),
		"\n",
		createVNode(_components.p, { children: [
			"So QUIC isn’t “zmosh’s idea, maybe” — it ",
			createVNode(_components.strong, { children: "is" }),
			" zmosh’s design (per-packet AEAD, roaming, reliable transport), standardized, fuzzed, interop-tested, with path-spoofing defenses the bare seq rule lacks. You write none of it. That’s why hand-rolling a UDP transport is the wrong call: raw UDP forces you to rebuild sequencing/retransmit/ARQ by hand — the one piece mosh got to ",
			createVNode(_components.em, { children: "skip" }),
			" (it discards lost frames; an RPC byte-stream can’t)."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "The one honest caveat is the Node library, not the protocol" }), " (verified, mid-2026): there is no turnkey-perfect QUIC for Node yet."] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Option" }),
					"\n",
					createVNode(_components.th, { children: "State" }),
					"\n",
					createVNode(_components.th, { children: "Call" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "node:quic" }) }), " (Node built-in, ngtcp2)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"generic bidi streams ✓, but ",
						createVNode(_components.strong, { children: "experimental" }),
						" (“Stability 1.0”) — needs a ",
						createVNode(_components.em, { children: "custom Node build" }),
						" (compile-time ",
						createVNode(_components.code, { children: "--experimental-quic" }),
						" + OpenSSL 3.5) plus a runtime flag; landed ~Node 26.2"
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "the target" }), " — bet on the standard; own the build"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "@matrixai/quic" }) }), " (quiche bindings)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"real ",
						createVNode(_components.code, { children: "ReadableStream" }),
						"/",
						createVNode(_components.code, { children: "WritableStream" }),
						" ✓, but ~15 mo stale, single-sponsor, ",
						createVNode(_components.strong, { children: [
							"no ",
							createVNode(_components.code, { children: "linux-arm64" }),
							" prebuilt"
						] }),
						" (aarch64 compiles quiche from Rust)"
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "prototype only" }), " — validates the design, too thin to depend on"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.del, { children: "bespoke UDP port" }) }),
					"\n",
					createVNode(_components.td, { children: "hand-rolled crypto + ARQ" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "rejected" }), " — rebuilds what QUIC ships"] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Doing it ",
			createVNode(_components.em, { children: "properly" }),
			" means ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "node:quic" }), ", with the QUIC-enabled Node owned in the Nix closure"] }),
			" — a clean cost that shrinks as the flag graduates — not an under-maintained binding. Nix is the ideal place to own that runtime build."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Where it lives (lowy + hickey agree)",
			children: [
				createVNode(_components.p, { children: [
					"First, scope: QUIC here is ",
					createVNode(_components.strong, { children: "Node-only" }),
					" — kaval-tui (CLI) and kolu-server reaching a remote kaval. The browser keeps WebSocket (it can’t run ",
					createVNode(_components.code, { children: "node:quic" }),
					", and its hop already roams), so the question is purely where the Node-side code lives. It splits along volatility axes the framework already owns, so it needs ",
					createVNode(_components.strong, { children: "no new package" }),
					":"
				] }),
				createVNode(_components.ul, { children: [
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "The link codec" }),
						" (oRPC wire over a QUIC bidi stream) → ",
						createVNode(_components.code, { children: "@kolu/surface/links/quic.ts" }),
						", a sibling of ",
						createVNode(_components.code, { children: "links/stdio" }),
						" / ",
						createVNode(_components.code, { children: "links/unix-socket" }),
						". The ",
						createVNode(_components.em, { children: "same" }),
						" transport-medium volatility the link family already encapsulates — a new wire in an existing socket, not a new receptacle. Clean because ",
						createVNode(_components.code, { children: "node:quic" }),
						" is a built-in (zero npm dep), exactly like the ",
						createVNode(_components.code, { children: "node:stream" }),
						"/",
						createVNode(_components.code, { children: "node:net" }),
						" behind those Node-only subpaths the browser never imports."
					] }),
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Roaming / connection migration" }),
						" → ",
						createVNode(_components.em, { children: "dissolves" }),
						". It lives inside the QUIC protocol; there’s no app code — which is the deep reason QUIC is the right call: it deletes the very lifecycle volatility ",
						createVNode(_components.code, { children: "recheck()" }),
						"/reconnect exist to paper over."
					] }),
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Bootstrap + supervise" }),
						" (provision over ssh, cert/port handoff, reconnect) → ",
						createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
						"’s ",
						createVNode(_components.code, { children: "HostSession" }),
						" — swap its one ",
						createVNode(_components.code, { children: "stdioLink(…)" }),
						" callsite for a ",
						createVNode(_components.code, { children: "quicLink" }),
						" via a ",
						createVNode(_components.code, { children: "linkFactory" }),
						"; the whole reconnect/provision state machine is reused."
					] })
				] }),
				createVNode(_components.p, { children: [
					"The only thing that could move this boundary is a parent runtime that can’t run ",
					createVNode(_components.code, { children: "node:quic" }),
					" — which would force ",
					createVNode(_components.code, { children: "@matrixai/quic" }),
					" (a native npm addon) into a codec-only ",
					createVNode(_components.code, { children: "@kolu/surface-quic" }),
					" (a dependency firewall, not an electricity). ",
					createVNode(_components.strong, { children: "That’s now moot: drishti is moving Bun→Node" }),
					", so ",
					createVNode(_components.code, { children: "node:quic" }),
					" runs on both parents and the codec settles cleanly in ",
					createVNode(_components.code, { children: "@kolu/surface/links/quic.ts" }),
					" — no firewall package, kolu and drishti alike."
				] })
			]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "QUIC can't do everything — keep ssh-stdio as the fallback",
			children: createVNode(_components.p, { children: [
				"QUIC rides UDP, and plenty of enterprise/hotel/captive networks block or throttle it — so a QUIC-only design would be half-baked on hostile networks. ",
				createVNode(_components.strong, { children: "ssh-stdio stays" }),
				": it’s the trust/key bootstrap (TLS authenticates the server, but ",
				createVNode(_components.em, { children: "which" }),
				" daemon to trust still comes over ssh — and never put terminal input in 0-RTT early data, which has no replay protection) ",
				createVNode(_components.em, { children: "and" }),
				" the automatic fallback where UDP is blocked (it just doesn’t roam there). Provisioning still rides ",
				createVNode(_components.code, { children: "surface-nix-host" }),
				" (see “Where it lives” above) — shared infra, not a kaval-only fork."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "phases",
			children: "Phases"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"Prerequisite — ",
				createVNode(_components.code, { children: "node:quic" }),
				" in Nix (day one, not a phase)."
			] }),
			" kolu is Nix-first, so the QUIC-enabled Node is baked into the flake from the start, not bolted on later: build Node with ",
			createVNode(_components.code, { children: "--experimental-quic" }),
			" (needs OpenSSL ≥ 3.5) in the devShell ",
			createVNode(_components.em, { children: "and" }),
			" in the kaval/agent closures. One change to the flake’s Node derivation; kolu and drishti both inherit it (both run ",
			createVNode(_components.code, { children: "node:quic" }),
			"). Everything below assumes it. Drop the compile flag if/when it graduates upstream — no code change, just the derivation."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"There’s no decision-spike left (library/package settled: ",
			createVNode(_components.code, { children: "node:quic" }),
			", codec in ",
			createVNode(_components.code, { children: "@kolu/surface/links/quic.ts" }),
			"), and ",
			createVNode(_components.strong, { children: "nothing is demonstrable until the daemon roams" }),
			" — so the transport and its demo land together. The “session survives a roam” win is a ",
			createVNode(_components.em, { children: "daemon" }),
			" property, so the demo is ",
			createVNode(_components.strong, { children: "kaval, not drishti" }),
			": drishti has no surviving session (a dropped agent just re-streams), so it can de-risk the ",
			createVNode(_components.em, { children: "transport" }),
			" (and ",
			createVNode(_components.code, { children: ".claude/rules/surface.md" }),
			" mandates its PR) but it can’t show the feature."
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
					createVNode(_components.th, { children: "Visible?" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: [
						"P1 · transport + ",
						createVNode(_components.code, { children: "kaval-tui --host" }),
						" roaming demo"
					] }) }),
					"\n",
					createVNode(_components.td, { children: [
						"the ",
						createVNode(_components.code, { children: "links/quic" }),
						" codec, kaval’s QUIC listener, the ",
						createVNode(_components.code, { children: "HostSession" }),
						" dial seam, and kaval-tui’s ",
						createVNode(_components.code, { children: "--host" }),
						" path — end to end"
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "yes" }), " — attach → roam Wi-Fi↔cellular → session + scrollback survive, no reconnect"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "P2 · kolu dials a remote kaval" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"kolu’s ",
						createVNode(_components.code, { children: "TerminalEndpoint" }),
						" registry dials remote kavals over QUIC; ssh-stdio kept as the auto-fallback"
					] }),
					"\n",
					createVNode(_components.td, { children: "yes — a roaming remote tile on the canvas" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "p1-file-by-file",
			children: "P1, file by file"
		}),
		"\n",
		createVNode(_components.p, { children: "A single vertical slice. Each piece mirrors an existing member of the link family, so the pattern is already established in-tree:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/surface" }) }),
				" — the codec, client + server halves (mirror the unix-socket pair):",
				"\n",
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.code, { children: "src/links/quic.ts" }),
						" → ",
						createVNode(_components.code, { children: "quicLink({ host, port, certFingerprint })" }),
						": open a ",
						createVNode(_components.code, { children: "node:quic" }),
						" session, take one bidi ",
						createVNode(_components.code, { children: "QuicStream" }),
						" (a Node ",
						createVNode(_components.code, { children: "Duplex" }),
						"), hand ",
						createVNode(_components.code, { children: "{ read, write }" }),
						" to the existing ",
						createVNode(_components.code, { children: "stdioLink" }),
						" codec. Direct sibling of ",
						createVNode(_components.code, { children: "src/links/unix-socket.ts" }),
						", which does exactly this with a ",
						createVNode(_components.code, { children: "net.Socket" }),
						"."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.code, { children: "src/quic.ts" }),
						" → ",
						createVNode(_components.code, { children: "serveOverQuic({ router, tlsKeyPair })" }),
						": bind a ",
						createVNode(_components.code, { children: "QuicEndpoint" }),
						", serve ",
						createVNode(_components.code, { children: "router" }),
						" over each accepted bidi stream with the same peer framing as ",
						createVNode(_components.code, { children: "serveOverUnixSocket" }),
						" (",
						createVNode(_components.code, { children: "src/unix-socket.ts:205" }),
						") and ",
						createVNode(_components.code, { children: "serveOverStdio" }),
						" (",
						createVNode(_components.code, { children: "src/peer-server.ts:130" }),
						"). Add ",
						createVNode(_components.code, { children: "./links/quic" }),
						" + ",
						createVNode(_components.code, { children: "./quic" }),
						" to package ",
						createVNode(_components.code, { children: "exports" }),
						"."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "packages/kaval" }) }),
				" — bind the listener ",
				createVNode(_components.em, { children: "beside" }),
				" the unix socket (additive, never a replacement):",
				"\n",
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.code, { children: "src/servePtyHostOverQuic.ts" }),
						" → wraps ",
						createVNode(_components.code, { children: "serveOverQuic" }),
						" for the ",
						createVNode(_components.em, { children: "same" }),
						" ",
						createVNode(_components.code, { children: "servedRouter" }),
						" (",
						createVNode(_components.code, { children: "createInProcessPtyHost" }),
						"); the unix-socket precedent is ",
						createVNode(_components.code, { children: "src/serveOverSocket.ts" }),
						". Mints an ephemeral cert, binds an ephemeral UDP port, returns ",
						createVNode(_components.code, { children: "{ port, certFingerprint, close }" }),
						"."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.code, { children: "src/daemonMain.ts" }),
						" (~",
						createVNode(_components.code, { children: ":45–50" }),
						", beside ",
						createVNode(_components.code, { children: "servePtyHostOverUnixSocket" }),
						") → under a ",
						createVNode(_components.code, { children: "--quic" }),
						" flag, also serve QUIC and print one line to stdout: ",
						createVNode(_components.code, { children: "KAVAL_QUIC <port> <certFingerprint>" }),
						"."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/surface-nix-host" }) }),
				" — the dial + supervise seam (the one genuinely ",
				createVNode(_components.em, { children: "hard" }),
				" change):",
				"\n",
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.code, { children: "src/hostSession.ts:spawn()" }),
						" (",
						createVNode(_components.code, { children: ":388–547" }),
						") → add ",
						createVNode(_components.code, { children: "transport: \"stdio\" | \"quic\"" }),
						". Today it wraps ",
						createVNode(_components.code, { children: "stdioLink({ read: child.stdout, write: child.stdin })" }),
						" (",
						createVNode(_components.code, { children: ":524" }),
						") and treats ",
						createVNode(_components.code, { children: "child.on(\"exit\")" }),
						" as the disconnect. For ",
						createVNode(_components.code, { children: "\"quic\"" }),
						": ssh starts the agent with ",
						createVNode(_components.code, { children: "--quic" }),
						", read its ",
						createVNode(_components.code, { children: "KAVAL_QUIC" }),
						" line, ",
						createVNode(_components.strong, { children: "then close the ssh child" }),
						" and build ",
						createVNode(_components.code, { children: "quicLink({ host, port, certFingerprint })" }),
						". ",
						createVNode(_components.strong, { children: "The load-bearing flip:" }),
						" with stdio the ssh child ",
						createVNode(_components.em, { children: "is" }),
						" the link (its TCP death = disconnect); with QUIC the ssh child is only the ",
						createVNode(_components.em, { children: "bootstrap" }),
						", so it must be closed — otherwise a roam kills its TCP and trips ",
						createVNode(_components.code, { children: "handleChildDone" }),
						" even though QUIC migrated. Supervision moves from the child’s ",
						createVNode(_components.code, { children: "exit" }),
						" to the QUIC link’s connection-close event; ",
						createVNode(_components.code, { children: "scheduleReconnect" }),
						"/backoff/",
						createVNode(_components.code, { children: "recheck" }),
						" reuse unchanged."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "packages/kaval-tui" }) }),
				" — the demo driver:",
				"\n",
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.code, { children: "src/connect.ts" }),
						" → add ",
						createVNode(_components.code, { children: "connectPtyHostQuic({ host, port, certFingerprint })" }),
						" via ",
						createVNode(_components.code, { children: "quicLink" }),
						" — the file already anticipates it (“the same link the ssh/daemon path will reuse”)."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.code, { children: "src/main.ts" }),
						" → ",
						createVNode(_components.code, { children: "--host <ssh>" }),
						": ",
						createVNode(_components.code, { children: "provisionAgent" }),
						" → ssh-start ",
						createVNode(_components.code, { children: "kaval --quic" }),
						" → read the bootstrap line → ",
						createVNode(_components.code, { children: "connectPtyHostQuic" }),
						" → ",
						createVNode(_components.code, { children: "attach" }),
						". This ",
						createVNode(_components.code, { children: "--host" }),
						" path ",
						createVNode(_components.em, { children: "is" }),
						" the driver kolu reuses in P2."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Bootstrap (mosh-style)." }),
			" (1) ",
			createVNode(_components.code, { children: "provisionAgent" }),
			" (",
			createVNode(_components.code, { children: "nix copy --derivation" }),
			" → realise) puts kaval on the host. (2) ssh runs ",
			createVNode(_components.code, { children: "kaval --quic" }),
			", which binds a unix socket (local) + a QUIC listener (ephemeral UDP port, ephemeral self-signed cert) and prints ",
			createVNode(_components.code, { children: "KAVAL_QUIC <port> <certFingerprint>" }),
			". (3) kaval-tui reads that line and ",
			createVNode(_components.strong, { children: "closes ssh" }),
			". (4) It dials ",
			createVNode(_components.code, { children: "quic://host:<port>" }),
			" pinning the fingerprint — TLS secures the channel, and the fingerprint, delivered over the authenticated ssh hop, is the trust anchor (TLS alone doesn’t say ",
			createVNode(_components.em, { children: "which" }),
			" kaval). (5) Only QUIC after that; an IP change migrates by Connection ID, no re-dial."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Acceptance — prove the roam, don’t assume it." }),
			" Attach to a remote kaval running a counter; force a client IP/port change (a NAT rebind, or move the client between two network namespaces); the session keeps streaming with ",
			createVNode(_components.strong, { children: [
				"one ",
				createVNode(_components.code, { children: "PATH_CHALLENGE" }),
				"/",
				createVNode(_components.code, { children: "PATH_RESPONSE" }),
				" and no reconnect log line"
			] }),
			", scrollback intact. The same flow over ",
			createVNode(_components.code, { children: "transport: \"stdio\"" }),
			" drops (",
			createVNode(_components.code, { children: "agent exited" }),
			" → reconnect) — that contrast ",
			createVNode(_components.em, { children: "is" }),
			" the demo."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Companion (mandated, not a phase)." }),
			" The paired drishti PR for the ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" + ",
			createVNode(_components.code, { children: "HostSession" }),
			" change (",
			createVNode(_components.code, { children: ".claude/rules/surface.md" }),
			"). drishti dials its process-monitor agent with ",
			createVNode(_components.code, { children: "transport: \"quic\"" }),
			"; a sequence/echo agent proves the ",
			createVNode(_components.em, { children: "bytes" }),
			" migrate across an IP change. drishti can’t show session-survival (no daemon) — that’s P1’s job."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "p2--kolu--the-fallback",
			children: "P2 — kolu + the fallback"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"kolu’s endpoint registry (the ",
			createVNode(_components.code, { children: "TerminalEndpoint" }),
			" seam, #1364) dials remote kavals through the same ",
			createVNode(_components.code, { children: "HostSession" }),
			" ",
			createVNode(_components.code, { children: "transport: \"quic\"" }),
			". ",
			createVNode(_components.strong, { children: "ssh-stdio stays as the automatic fallback:" }),
			" if QUIC can’t establish (UDP blocked, handshake timeout) fall back to ",
			createVNode(_components.code, { children: "transport: \"stdio\"" }),
			" — no roaming, but it always connects. Terminal input never rides 0-RTT early data (no replay protection). The canvas multiplexes a roaming remote kaval beside local ones."
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"zmosh cloned at HEAD; kaval claims verified against ",
			createVNode(_components.code, { children: "packages/kaval" }),
			"; QUIC claims verified against RFC 9000/9001/9002 and the mid-2026 Node QUIC landscape; placement per a lowy + hickey lens pass. Sibling to ",
			createVNode(_components.a, {
				href: "kaval-sessions.html",
				children: "kaval-sessions"
			}),
			" (the kaval-tui plan)."
		] }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "kaval-tui that roams — remote attach that survives the network",
	"description": "Today kaval-tui attaches to a remote kaval over ssh stdio (TCP — it drops the moment you change networks). zmosh's idea, applied to kaval — teach kaval to also bind an encrypted-UDP listener beside its unix socket, so you attach once and keep the session through Wi-Fi↔cellular and sleep/wake, with no reconnect and no lost scrollback. No extra process; kaval already owns the hard half (server-side VT + snapshot-then-delta); only the transport changes.",
	"parents": ["kaval-sessions", "comparison"],
	"maturity": "seedling",
	"updated": "2026-06-14T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "see-it",
			"text": "See it"
		},
		{
			"depth": 2,
			"slug": "one-hop-one-swap",
			"text": "One hop, one swap"
		},
		{
			"depth": 2,
			"slug": "already-half-built",
			"text": "Already half-built"
		},
		{
			"depth": 2,
			"slug": "the-transport--quic",
			"text": "The transport — QUIC"
		},
		{
			"depth": 2,
			"slug": "phases",
			"text": "Phases"
		},
		{
			"depth": 3,
			"slug": "p1-file-by-file",
			"text": "P1, file by file"
		},
		{
			"depth": 3,
			"slug": "p2--kolu--the-fallback",
			"text": "P2 — kolu + the fallback"
		}
	];
}
var url = "src/content/atlas/kaval-vs-zmosh.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/kaval-vs-zmosh.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/kaval-vs-zmosh.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { CidViz, Content, Content as default, Journey, Recovery, file, frontmatter, getHeadings, url };
