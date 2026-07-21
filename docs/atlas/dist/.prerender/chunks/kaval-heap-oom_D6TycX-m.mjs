import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import { t as $$Issue } from "./Issue_mLFqCJSR.mjs";
import { t as $$Cite } from "./Cite_IypTixBQ.mjs";
//#region src/content/atlas/kaval-heap-oom.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		defs: "defs",
		em: "em",
		feMerge: "feMerge",
		g: "g",
		h2: "h2",
		h3: "h3",
		li: "li",
		ol: "ol",
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
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Production postmortem — ",
			createVNode(_components.code, { children: "pureintent" }),
			", the always-on ",
			createVNode(_components.code, { children: "kolu.service" }),
			". Latest crash 2026-06-19 14:26; the ",
			createVNode(_components.strong, { children: "fifth" }),
			" with an identical signature since 2026-05-27. Surfaced by a “why did kolu restart?” investigation."
		] }) }),
		"\n",
		createVNode("figure", {
			style: "margin:1.75rem 0;text-align:center",
			children: [createVNode("svg", {
				viewBox: "0 0 600 384",
				width: "100%",
				role: "img",
				"aria-label": "kolu's diagnostics reaches only the server; localDriver strips the heap-snapshot flag one hop above kaval, the process that OOMs blind",
				style: "max-width:600px;font:13px ui-sans-serif,system-ui,sans-serif",
				children: [
					createVNode(_components.defs, { children: [
						createVNode("marker", {
							id: "khoLeakArrow",
							viewBox: "0 0 10 10",
							refX: "8.5",
							refY: "5",
							markerWidth: "7",
							markerHeight: "7",
							orient: "auto",
							children: createVNode("path", {
								d: "M0 0 L10 5 L0 10 z",
								fill: "var(--ink-muted,#8a8f98)"
							})
						}),
						createVNode("marker", {
							id: "khoLeakDiag",
							viewBox: "0 0 10 10",
							refX: "8.5",
							refY: "5",
							markerWidth: "7",
							markerHeight: "7",
							orient: "auto",
							children: createVNode("path", {
								d: "M0 0 L10 5 L0 10 z",
								fill: "var(--good-stroke,#15803D)"
							})
						}),
						createVNode("filter", {
							id: "khoLeakGlow",
							x: "-20%",
							y: "-20%",
							width: "140%",
							height: "140%",
							children: [createVNode("feGaussianBlur", {
								stdDeviation: "4",
								result: "b"
							}), createVNode(_components.feMerge, { children: [createVNode("feMergeNode", { in: "b" }), createVNode("feMergeNode", { in: "SourceGraphic" })] })]
						})
					] }),
					createVNode("text", {
						x: "34",
						y: "200",
						"text-anchor": "middle",
						"font-size": "10.5",
						"font-weight": "600",
						fill: "var(--good-text,#166534)",
						transform: "rotate(-90 34 200)",
						"font-family": "ui-monospace,'SF Mono',Menlo,monospace",
						children: "KOLU_DIAG_DIR — diagnostics reach"
					}),
					createVNode("path", {
						d: "M52 36 L52 156",
						fill: "none",
						stroke: "var(--good-stroke,#15803D)",
						"stroke-width": "2.5"
					}),
					createVNode("path", {
						d: "M52 156 L46 144 M52 156 L58 144",
						fill: "none",
						stroke: "var(--good-stroke,#15803D)",
						"stroke-width": "2.5"
					}),
					createVNode("rect", {
						x: "84",
						y: "12",
						width: "412",
						height: "58",
						rx: "8",
						fill: "var(--good-fill,#eff6f0)",
						stroke: "var(--good-stroke,#15803D)",
						"stroke-width": "1.5"
					}),
					createVNode("text", {
						x: "290",
						y: "37",
						"text-anchor": "middle",
						"font-weight": "700",
						fill: "var(--ink,#1a1d21)",
						children: "home-manager · services.kolu"
					}),
					createVNode("text", {
						x: "290",
						y: "56",
						"text-anchor": "middle",
						"font-size": "11.5",
						fill: "var(--good-text,#166534)",
						"font-family": "ui-monospace,'SF Mono',Menlo,monospace",
						children: "diagnostics.dir → KOLU_DIAG_DIR (server only)"
					}),
					createVNode("rect", {
						x: "84",
						y: "100",
						width: "412",
						height: "84",
						rx: "8",
						fill: "var(--good-fill,#eff6f0)",
						stroke: "var(--good-stroke,#15803D)",
						"stroke-width": "1.5"
					}),
					createVNode("text", {
						x: "290",
						y: "123",
						"text-anchor": "middle",
						"font-weight": "700",
						fill: "var(--ink,#1a1d21)",
						children: "kolu server — Node 22.22.1"
					}),
					createVNode("text", {
						x: "290",
						y: "142",
						"text-anchor": "middle",
						"font-size": "11.5",
						fill: "var(--good-text,#166534)",
						children: "diagnostics.ts → heap snapshots (server heap) ✓"
					}),
					createVNode("text", {
						x: "290",
						y: "172",
						"text-anchor": "middle",
						"font-size": "11.5",
						fill: "var(--hot-text,#b1241a)",
						"font-family": "ui-monospace,'SF Mono',Menlo,monospace",
						children: "localDriver scrubNodeOptions() ✂ strips –heapsnapshot"
					}),
					createVNode("rect", {
						x: "84",
						y: "222",
						width: "412",
						height: "48",
						rx: "8",
						fill: "var(--surface,#F7F8FE)",
						stroke: "var(--struct-stroke,#0D32B2)",
						"stroke-width": "1.5"
					}),
					createVNode("text", {
						x: "290",
						y: "251",
						"text-anchor": "middle",
						"font-size": "12.5",
						fill: "var(--ink,#11203a)",
						"font-family": "ui-monospace,'SF Mono',Menlo,monospace",
						children: "@kolu/surface-daemon-supervisor → systemd-run –user"
					}),
					createVNode("rect", {
						x: "76",
						y: "300",
						width: "428",
						height: "74",
						rx: "9",
						fill: "none",
						stroke: "var(--hot-stroke,#c0392b)",
						"stroke-width": "1",
						opacity: "0.4",
						filter: "url(#khoLeakGlow)"
					}),
					createVNode("rect", {
						x: "84",
						y: "304",
						width: "412",
						height: "66",
						rx: "8",
						fill: "var(--hot-fill,#fbeee7)",
						stroke: "var(--hot-stroke,#b3471f)",
						"stroke-width": "2.5"
					}),
					createVNode("text", {
						x: "290",
						y: "329",
						"text-anchor": "middle",
						"font-weight": "700",
						fill: "var(--hot-text,#b91c1c)",
						children: "kaval — PTY host · Node 24.13.0"
					}),
					createVNode("text", {
						x: "290",
						y: "350",
						"text-anchor": "middle",
						"font-size": "11.5",
						"font-weight": "600",
						fill: "var(--hot-text,#b1241a)",
						children: "OOM SITE — runs BLIND: no heap limit, no diagnostics"
					}),
					createVNode("path", {
						d: "M290 70 L290 100",
						fill: "none",
						stroke: "var(--good-stroke,#15803D)",
						"stroke-width": "2.5",
						"marker-end": "url(#khoLeakDiag)"
					}),
					createVNode("text", {
						x: "302",
						y: "89",
						"font-size": "10.5",
						fill: "var(--good-text,#166534)",
						children: "ExecStart + env"
					}),
					createVNode("line", {
						x1: "120",
						y1: "186",
						x2: "460",
						y2: "206",
						stroke: "var(--hot-stroke,#b3471f)",
						"stroke-width": "2",
						"stroke-dasharray": "2 4"
					}),
					createVNode("path", {
						d: "M290 184 L290 192",
						fill: "none",
						stroke: "var(--good-stroke,#15803D)",
						"stroke-width": "2.5"
					}),
					createVNode("path", {
						d: "M290 200 L290 222",
						fill: "none",
						stroke: "var(--ink-muted,#8a8f98)",
						"stroke-width": "1.5",
						"marker-end": "url(#khoLeakArrow)"
					}),
					createVNode("text", {
						x: "302",
						y: "217",
						"font-size": "10.5",
						"font-style": "italic",
						fill: "var(--hot-text,#b1241a)",
						children: "spawn — diag flags severed here"
					}),
					createVNode("path", {
						d: "M290 270 L290 300",
						fill: "none",
						stroke: "var(--ink-muted,#8a8f98)",
						"stroke-width": "1.5",
						"marker-end": "url(#khoLeakArrow)"
					}),
					createVNode("text", {
						x: "302",
						y: "291",
						"font-size": "10.5",
						fill: "var(--ink-muted,#8a8f98)",
						children: "spawn (transient unit)"
					}),
					createVNode("path", {
						d: "M504 337 L556 337 L556 142 L496 142",
						fill: "none",
						stroke: "var(--struct-stroke,#0D32B2)",
						"stroke-width": "1.5",
						"marker-end": "url(#khoLeakArrow)"
					}),
					createVNode("text", {
						x: "572",
						y: "240",
						"text-anchor": "middle",
						"font-size": "10.5",
						fill: "var(--struct-sub,#4A5072)",
						transform: "rotate(-90 572 240)",
						"font-family": "ui-monospace,'SF Mono',Menlo,monospace",
						children: "pty-host.sock"
					})
				]
			}), createVNode("figcaption", {
				style: "margin-top:.5rem;font-size:.8rem;color:var(--faint,#7a8089);font-family:ui-sans-serif,system-ui,sans-serif",
				children: [
					"Where the leak lives, and why kaval ran blind: the home-manager diagnostics option reaches the ",
					createVNode(_components.em, { children: "server" }),
					" only; localDriver strips the heap-snapshot flag from NODE_OPTIONS before kaval — the one process that actually OOMs."
				]
			})]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "what-crashed",
			children: "What crashed"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Two processes, one cascade. The ",
			createVNode(_components.strong, { children: "kaval PTY host" }),
			" — the daemon that holds the live PTY file descriptors for every terminal (",
			createVNode($$Cite, {
				file: "packages/kaval/src/bin.ts",
				label: "kaval/src/bin.ts"
			}),
			") — exhausted its V8 JavaScript heap and self-aborted. Losing its only PTY host, the ",
			createVNode(_components.strong, { children: "kolu server" }),
			" then fail-fast-exited, and systemd restarted it."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Time (EDT)" }),
					"\n",
					createVNode(_components.th, { children: "Event" }),
					"\n",
					createVNode(_components.th, { children: "Evidence" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "14:25:49" }),
					"\n",
					createVNode(_components.td, { children: [
						"kaval GC pinned at the ceiling: ",
						createVNode(_components.code, { children: "Mark-Compact (reduce) 4083.2 → 4058.0 MB" }),
						", then ",
						createVNode(_components.code, { children: "FATAL ERROR: Ineffective mark-compacts near heap limit — JavaScript heap out of memory" })
					] }),
					"\n",
					createVNode(_components.td, { children: "kaval unit journal" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "14:25:49" }),
					"\n",
					createVNode(_components.td, { children: ["kaval aborts: ", createVNode(_components.code, { children: "node::OOMErrorHandler → abort → raise" })] }),
					"\n",
					createVNode(_components.td, { children: "coredump stack, thread 329839" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "14:26:08" }),
					"\n",
					createVNode(_components.td, { children: [
						"Coredump captured — 732 MB compressed (",
						createVNode(_components.code, { children: "Signal 6 / ABRT" }),
						"); kaval socket closes"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "coredumpctl info 329839" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "14:26:09.04" }),
					"\n",
					createVNode(_components.td, { children: [
						"kolu server sees ",
						createVNode(_components.code, { children: "[@kolu/surface/links/stdio] outbound write error: read ECONNRESET" }),
						", then a storm of ",
						createVNode(_components.code, { children: "pty-host tap subscription failed" }),
						" / ",
						createVNode(_components.code, { children: "terminal.spawn failed" })
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "kolu.service" }), " journal"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "14:26:09.07" }),
					"\n",
					createVNode(_components.td, { children: [
						"kolu ",
						createVNode(_components.code, { children: "FATAL … uncaught exception" }),
						" → ",
						createVNode(_components.code, { children: "Error: write ECANCELED" })
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "kolu.service" }), " journal"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "14:26:09" }),
					"\n",
					createVNode(_components.td, { children: [
						"systemd: ",
						createVNode(_components.code, { children: "Main process exited, status=1/FAILURE" }),
						" → ",
						createVNode(_components.code, { children: "Failed with result 'exit-code'" }),
						" → ",
						createVNode(_components.code, { children: "Scheduled restart job, restart counter is at 1" })
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "systemd[1274]" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "14:26:09" }),
					"\n",
					createVNode(_components.td, { children: [
						"New server (",
						createVNode(_components.code, { children: "serverId 1010bc7d" }),
						") up with a fresh kaval on the same socket — ",
						createVNode(_components.strong, { children: "healthy" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "systemctl --user show" }),
						" (",
						createVNode(_components.code, { children: "NRestarts=1" }),
						")"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "The kolu-side cascade is working as designed",
			children: createVNode(_components.p, { children: [
				"The server’s exit is ",
				createVNode(_components.strong, { children: "not" }),
				" a second bug. When kaval dies the pty-host stdio socket closes; a pending write rejects with ",
				createVNode(_components.code, { children: "ECANCELED" }),
				", escapes as an uncaught exception, and the process exits ",
				createVNode(_components.code, { children: "status=1" }),
				" — exactly the repo’s ",
				createVNode(_components.em, { children: "fail-fast, crash-loudly" }),
				" contract. systemd restarts it cleanly. ",
				createVNode(_components.strong, { children: "The fix belongs in kaval (stop leaking) and in detection — never in swallowing the kolu-side error" }),
				", which would mask a dead PTY host. Catching ",
				createVNode(_components.code, { children: "ECANCELED" }),
				" to “keep kolu alive” is a fallback, and a fallback here is a defect."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"This was ",
			createVNode(_components.strong, { children: "not" }),
			" a kernel OOM-kill (signal is 6/ABRT, a userspace self-abort — not 9/SIGKILL; ",
			createVNode(_components.code, { children: "journalctl -k" }),
			" had zero OOM lines; the unit’s ",
			createVNode(_components.code, { children: "MemoryMax=infinity" }),
			"), ",
			createVNode(_components.strong, { children: "not" }),
			" a deploy (",
			createVNode(_components.code, { children: "status=1/FAILURE" }),
			" + scheduled restart is a crash, not a clean stop/start), and ",
			createVNode(_components.strong, { children: "not" }),
			" disk-full (",
			createVNode(_components.code, { children: "/" }),
			" at 78 %, 190 GB free). The kolu exit is causally tied to the kaval death — the ",
			createVNode(_components.code, { children: "ECONNRESET" }),
			"/",
			createVNode(_components.code, { children: "ECANCELED" }),
			" both originate on the pty-host link and fire in the same ~30 ms the kaval socket closes."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "root-cause-live-terminals-accumulate-each-pinning-a-50-k-line-mirror",
			children: "Root cause: live terminals accumulate, each pinning a 50 K-line mirror"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Reproduced and confirmed" }),
			" by driving ",
			createVNode(_components.code, { children: "createPtyHost" }),
			" in isolation on a clean box (",
			createVNode(_components.code, { children: "naiveintent" }),
			"). kaval keeps, ",
			createVNode(_components.em, { children: "per live PTY" }),
			", an ",
			createVNode(_components.code, { children: "@xterm/headless" }),
			" screen mirror sized at ",
			createVNode(_components.code, { children: "DEFAULT_SCROLLBACK = 50_000" }),
			" lines (",
			createVNode($$Cite, {
				file: "packages/common/src/config.ts",
				label: "config.ts"
			}),
			", passed at ",
			createVNode($$Cite, {
				file: "packages/server/src/ptyHost/index.ts",
				label: "ptyHost/index.ts"
			}),
			"). The heap is ",
			createVNode(_components.strong, { children: "linear in live-terminal count" }),
			" and ",
			createVNode(_components.strong, { children: "flat under everything else" }),
			":"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Driver" }),
					"\n",
					createVNode(_components.th, { children: "Heap behaviour" }),
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
						"1 terminal, unbounded ",
						createVNode(_components.code, { children: "yes" }),
						" output, 90 s"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"oscillates 14–64 MB — ",
						createVNode(_components.strong, { children: "bounded" }),
						" (scrollback caps it)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "attach + abort a subscription, tight loop" }),
					"\n",
					createVNode(_components.td, { children: [
						"flat — ",
						createVNode(_components.strong, { children: "bounded" }),
						" (abort cleanup works)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "spawn + write + kill, 8 000×" }),
					"\n",
					createVNode(_components.td, { children: [
						"flat — ",
						createVNode(_components.strong, { children: "bounded" }),
						" (",
						createVNode(_components.code, { children: "teardown" }),
						" is complete)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "spawn terminals, never kill" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "linear" }),
						" — ~18 MB ",
						createVNode(_components.strong, { children: "V8 heap" }),
						"/terminal at the production 50 K (+ ~44 MB external cell buffers)"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Under a 1 GB ",
			createVNode(_components.strong, { children: "old-space" }),
			" cap at the production 50 K scrollback, the host dies with the ",
			createVNode(_components.strong, { children: "exact production signature" }),
			" — ",
			createVNode(_components.code, { children: "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory" }),
			" — at ",
			createVNode(_components.strong, { children: "~54 fully-scrolled terminals" }),
			", heap climbing linearly 358 → 970 MB. The abort is an ",
			createVNode(_components.strong, { children: "old-space heap" }),
			" event, so the driver is ",
			createVNode(_components.strong, { children: "~18 MB of V8 heap per terminal" }),
			" (the ",
			createVNode(_components.code, { children: "BufferLine" }),
			" / ",
			createVNode(_components.code, { children: "Object" }),
			" / typed-array ",
			createVNode(_components.em, { children: "wrappers" }),
			"); the cell payloads add ~44 MB of ",
			createVNode(_components.em, { children: "external" }),
			" ",
			createVNode(_components.code, { children: "ArrayBuffer" }),
			" memory each — real RSS pressure, but ",
			createVNode(_components.strong, { children: "not" }),
			" counted by the heap limit that aborts. A one-terminal snapshot at 10 K scrollback shows ~10 000 each of ",
			createVNode(_components.code, { children: "ArrayBuffer" }),
			" / ",
			createVNode(_components.code, { children: "Uint32Array" }),
			" / xterm ",
			createVNode(_components.code, { children: "BufferLine" }),
			" — the scrollback grid, nothing else — scaling ~5× at the production 50 K."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"So the ",
			createVNode(_components.strong, { children: "operative answer" }),
			": heap is proportional to ",
			createVNode(_components.strong, { children: "live terminal count" }),
			" (× each terminal’s scrollback fill). A single busy terminal, or terminal/subscription churn, is bounded — ",
			createVNode(_components.em, { children: "activity" }),
			" alone doesn’t grow it. The default ~4 GB old-space ceiling is reached at ",
			createVNode(_components.strong, { children: "a couple hundred" }),
			" fully-scrolled terminals (≈ 4 GB ÷ ~18 MB ≈ 220; fewer in practice, summed across partially-filled ones)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Why the count grows without bound: ",
			createVNode(_components.code, { children: "reconcile" }),
			" ",
			createVNode(_components.strong, { children: "never reaps" }),
			" — a surviving kaval’s live PTYs are all ",
			createVNode(_components.em, { children: "adopted" }),
			" across every server restart (the “terminals survive a kolu update” guarantee), and a terminal is freed only when its child process exits or the user explicitly kills it (",
			createVNode($$Cite, {
				file: "packages/server/src/reconcile.ts",
				label: "reconcile.ts"
			}),
			"). Long-lived shells and agents — across many worktrees, over days, ratcheted up by each crash-restart — accumulate, each pinning a 50 K-line mirror. ",
			createVNode(_components.strong, { children: "Not a teardown bug" }),
			" (teardown is clean): an unbounded, never-reaped population × a large per-terminal retainer."
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Recurrence is real — same signature on 2026-05-27, 06-13 (825 MB), 06-15 (632 MB), 06-16 (809 MB), 06-19 (732 MB), ~every 2–6 days (",
			createVNode(_components.code, { children: "coredumpctl list" }),
			"). Red herrings now ruled out: a ~60-RPC ",
			createVNode(_components.code, { children: "attach" }),
			" burst 15 s pre-crash (a single WebSocket disconnect aborting in-flight RPCs); the bounded structures (exit tombstones ≤ 1024, per-subscriber queues ≤ 10 K, exit-waiters) — none leak."
		] }) }),
		"\n",
		createVNode(_components.h3, {
			id: "does-this-hurt-kavals-performance--yes-before-it-ever-crashes",
			children: "Does this hurt kaval’s performance? — yes, before it ever crashes"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"This is the part that bites day-to-day, not just at the moment of death. kaval is the hot path for ",
			createVNode(_components.strong, { children: "all" }),
			" terminal I/O — every byte in and out of every PTY crosses its event loop. As the heap creeps toward 4 GB, V8’s GC runs ",
			createVNode(_components.strong, { children: "more often and for longer" }),
			", ending in the “ineffective mark-compacts” the crash banner names: long, stop-the-world pauses that ",
			createVNode(_components.em, { children: "are" }),
			" the leak’s tail. While GC holds the loop, kaval can’t relay output, echo keystrokes, or deliver exit signals — so terminals feel ",
			createVNode(_components.strong, { children: "progressively laggier the longer the server has been up" }),
			", worst in the hours before the OOM, then snap back to crisp after the restart-induced fresh heap. So the leak has two costs: a hard crash every few days, and a soft “kolu gets sluggish over time” that a restart silently papers over. (The leak floor that ",
			createVNode(_components.code, { children: "@kolu/heap-diag" }),
			" is tuned for is ~10 MB/min.)"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "why-we-cant-see-it-yet--the-diagnostics-gap",
			children: "Why we can’t see it yet — the diagnostics gap"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"kolu already has heap diagnostics: set ",
			createVNode(_components.code, { children: "KOLU_DIAG_DIR" }),
			" and the server writes a baseline snapshot, logs subsystem sizes every 5 min, and arms ",
			createVNode(_components.code, { children: "--heapsnapshot-near-heap-limit=3" }),
			" so V8 dumps a snapshot ",
			createVNode(_components.em, { children: "just before" }),
			" an OOM (the shared ",
			createVNode(_components.code, { children: "@kolu/heap-diag" }),
			" receptacle ",
			createVNode($$PrLink, { pr: 1427 }),
			" extracted, ",
			createVNode($$Cite, {
				file: "packages/heap-diag/src/index.ts",
				label: "heap-diag"
			}),
			"). The home-manager module already exposes it as ",
			createVNode(_components.code, { children: "services.kolu.diagnostics.dir" }),
			" (",
			createVNode($$Cite, {
				file: "nix/home/module.nix",
				label: "module.nix"
			}),
			")."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"But it only instruments the server (Node 22) — the process that ",
				createVNode(_components.em, { children: "doesn’t" }),
				" crash."
			] }),
			" kaval (Node 24, the one that ",
			createVNode(_components.em, { children: "does" }),
			") is deliberately excluded:"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "localDriver strips the very flag we need",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "scrubNodeOptions()" }),
				" removes ",
				createVNode(_components.code, { children: "--heapsnapshot*" }),
				", ",
				createVNode(_components.code, { children: "--inspect" }),
				", ",
				createVNode(_components.code, { children: "--heap-prof" }),
				", ",
				createVNode(_components.code, { children: "--cpu-prof" }),
				" from ",
				createVNode(_components.code, { children: "NODE_OPTIONS" }),
				" ",
				createVNode(_components.strong, { children: "before" }),
				" spawning kaval, ",
				createVNode(_components.em, { children: "“so a kolu launched with diagnostics doesn’t make kaval write heap snapshots too.”" }),
				" ",
				createVNode($$Cite, {
					file: "packages/server/src/ptyHost/localDriver.ts",
					label: "localDriver.ts:102-115"
				}),
				" That was the right call when the server was the suspected leaker — but it means the prod kaval has ",
				createVNode(_components.strong, { children: "no heap limit and no pre-OOM snapshot" }),
				". Every crash so far has thrown away the one artifact that would name the leak."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The leak was named without it (the in-process repro on a clean box did the job), but the gap mattered: with kaval instrumented, prod would have shown the ",
			createVNode(_components.code, { children: "terms" }),
			"-count curve climbing for days, and a near-limit snapshot would confirm the same scrollback grid in the ",
			createVNode(_components.em, { children: "real" }),
			" workload. ",
			createVNode(_components.strong, { children: ["Now closed in ", createVNode($$PrLink, { pr: 1427 })] }),
			" — ",
			createVNode(_components.code, { children: "localDriver" }),
			" forwards ",
			createVNode(_components.code, { children: "KOLU_DIAG_DIR" }),
			" and kaval’s wrapper arms its own near-limit snapshot under a kaval-private subdir, so the next approach to the (now bounded) ceiling dumps a snapshot instead of a silent abort."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "how-other-terminals--multiplexers-bound-this",
			children: "How other terminals & multiplexers bound this"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A sweep of the field (ghostty, tmux, zellij, kitty, wezterm, GNU screen, mosh, VTE, zmosh). It’s near-unanimous, and ",
			createVNode(_components.strong, { children: "kaval is the outlier" }),
			" — a 50 K-line ",
			createVNode(_components.em, { children: "server-side" }),
			" mirror is 5–50× everyone else:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "System" }),
					"\n",
					createVNode(_components.th, { children: "Default history" }),
					"\n",
					createVNode(_components.th, { children: "Bounding" }),
					"\n",
					createVNode(_components.th, { children: "Reattach restores" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "kaval (today)" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "50 000 lines / PTY" }) }),
					"\n",
					createVNode(_components.td, { children: "none — no cap, no reap" }),
					"\n",
					createVNode(_components.td, { children: ["full mirror, ", createVNode(_components.strong, { children: "eagerly serialized" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "GNU screen" }),
					"\n",
					createVNode(_components.td, { children: "100 lines" }),
					"\n",
					createVNode(_components.td, { children: "line cap" }),
					"\n",
					createVNode(_components.td, { children: "viewport (RAM)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "xterm.js / headless" }),
					"\n",
					createVNode(_components.td, { children: "1 000 rows (library default — kolu overrides to 50 K)" }),
					"\n",
					createVNode(_components.td, { children: "ring buffer" }),
					"\n",
					createVNode(_components.td, { children: [
						"ANSI snapshot (",
						createVNode(_components.code, { children: "SerializeAddon" }),
						")"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "tmux" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "2 000 lines / pane" }) }),
					"\n",
					createVNode(_components.td, { children: "line cap + batch trim" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "viewport" }), "; scrollback lazily in copy-mode"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "kitty" }),
					"\n",
					createVNode(_components.td, { children: "2 000 in-RAM" }),
					"\n",
					createVNode(_components.td, { children: "overflow spills to a temp file → pager" }),
					"\n",
					createVNode(_components.td, { children: "n/a (emulator)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "wezterm-mux" }),
					"\n",
					createVNode(_components.td, { children: "3 500 lines" }),
					"\n",
					createVNode(_components.td, { children: "line cap (uncompressed)" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "viewport" }),
						"; lazily by range (",
						createVNode(_components.code, { children: "GetLines" }),
						" RPC)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "zellij" }),
					"\n",
					createVNode(_components.td, { children: "10 000 lines" }),
					"\n",
					createVNode(_components.td, { children: ["ring + ", createVNode(_components.strong, { children: "serialize panes to disk" })] }),
					"\n",
					createVNode(_components.td, { children: [
						"cold: from ",
						createVNode(_components.strong, { children: "disk" }),
						", not RAM"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "ghostty" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "10 MB (bytes)" }) }),
					"\n",
					createVNode(_components.td, { children: "byte cap + page-trim, ~12.5 B/cell" }),
					"\n",
					createVNode(_components.td, { children: "n/a (emulator)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "zmosh" }),
					"\n",
					createVNode(_components.td, { children: "ghostty-vt byte cap" }),
					"\n",
					createVNode(_components.td, { children: "ring evict" }),
					"\n",
					createVNode(_components.td, { children: "serialize VT (scrollback + viewport)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "mosh" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "0 — viewport only" }) }),
					"\n",
					createVNode(_components.td, { children: "keeps no history at all" }),
					"\n",
					createVNode(_components.td, { children: "the live screen, ever" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "VTE (GNOME)" }),
					"\n",
					createVNode(_components.td, { children: "“infinite”" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "LZ4 + AES disk ring" }), ", near-0 resident (hot pages only)"] }),
					"\n",
					createVNode(_components.td, { children: "n/a (emulator)" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "Three lessons that reshape the fix:" }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Nobody holds deep history as live cell-objects" }),
				" — it’s a small ring (tmux 2 K) or pushed off the hot path to disk (zellij / kitty / VTE, the last LZ4-compressing its disk ring). kaval’s 50 K of live ",
				createVNode(_components.code, { children: "BufferLine" }),
				" objects is the anomaly. ",
				createVNode(_components.em, { children: [
					"(In V8 the killer is object-header + GC pressure, not raw bytes — so deep history wants to be a compressed ",
					createVNode(_components.code, { children: "Buffer" }),
					" or a file, never live xterm lines.)"
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "No multiplexer eagerly serializes the whole mirror on reattach" }),
				" — tmux / wezterm repaint the ",
				createVNode(_components.em, { children: "viewport" }),
				" and stream older lines ",
				createVNode(_components.strong, { children: "lazily, by range, on scroll" }),
				". kaval’s ",
				createVNode(_components.code, { children: "attach()" }),
				" → full-buffer ",
				createVNode(_components.code, { children: "serialize()" }),
				" is exactly the avoidable cost."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				"Cap by ",
				createVNode(_components.em, { children: "bytes" }),
				", not lines"
			] }), " — a wide blank line still costs, and agent streaming is the real-world OOM driver elsewhere too (tmux #4859 ≈ 48 GB, ghostty 37 GB), not deep interactive history."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-fix--a-small-hot-mirror-over-an-on-disk-transcript-log",
			children: "The fix — a small hot mirror over an on-disk transcript log"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Shipped in #1427",
			children: createVNode(_components.p, { children: [
				"Fix ",
				createVNode(_components.strong, { children: "(1)" }),
				" — the small hot mirror — landed: ",
				createVNode(_components.strong, { children: "10 K" }),
				" lines chosen (decoupled from the client’s 50 K), measured ",
				createVNode(_components.strong, { children: "~4×" }),
				" the OOM ceiling. With it, the ",
				createVNode(_components.strong, { children: "interim safety net" }),
				" is pure observability: kaval-side diagnostics (the ",
				createVNode(_components.code, { children: "services.kolu.diagnostics.dir" }),
				" value now reaches kaval, which logs the heap/",
				createVNode(_components.code, { children: "terms" }),
				" curve + arms a near-limit snapshot) — ",
				createVNode(_components.em, { children: "no" }),
				" explicit heap cap, since with the mirror fixed a cap would only give back the headroom the fix bought. Guarded by a red→green decouple test and live-job-at-a-small-mirror tests. ",
				createVNode($$PrLink, { pr: 1427 }),
				" · ",
				createVNode(_components.strong, { children: "Deferred:" }),
				" the on-disk transcript log (",
				createVNode($$Issue, { n: 417 }),
				") and lazy backfill (3) — they remove the ",
				createVNode(_components.em, { children: "linear-in-count" }),
				" growth and let the mirror shrink further."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The 50 K was never for scrolling. ",
			createVNode($$PrLink, { pr: 416 }),
			" bumped it from 10 K ",
			createVNode(_components.strong, { children: "for PDF export" }),
			" (",
			createVNode($$PrLink, { pr: 413 }),
			") — so a naive shrink would ",
			createVNode(_components.em, { children: "regress export" }),
			". And the real fix is already designed: ",
			createVNode($$Issue, {
				n: 417,
				label: "server-side transcript log"
			}),
			", the on-disk source of truth that #416 explicitly called itself a ",
			createVNode(_components.em, { children: "bandaid" }),
			" for. This RCA promotes #417 from a ",
			createVNode(_components.em, { children: "features" }),
			" ticket to ",
			createVNode(_components.strong, { children: "the memory fix" }),
			" — and corrects its non-goal #1 (“the ~4 KB attach snapshot is already optimal”): ",
			createVNode(_components.code, { children: "attach()" }),
			" serializes the ",
			createVNode(_components.strong, { children: "whole" }),
			" buffer with no scrollback limit (",
			createVNode($$Cite, {
				file: "packages/kaval/src/ptyHost.ts",
				label: "ptyHost.ts:571"
			}),
			"), so that path ",
			createVNode(_components.em, { children: "is" }),
			" the cost, not a constant."
		] }),
		"\n",
		createVNode(_components.p, { children: "The plan of record — which is also just what the field does (small hot buffer + deep history off the hot path + lazy backfill):" }),
		"\n",
		createVNode("figure", {
			style: "margin:1.75rem 0;text-align:center",
			children: [createVNode("svg", {
				viewBox: "0 0 600 360",
				width: "100%",
				role: "img",
				"aria-label": "Target: each PTY byte feeds a small in-RAM mirror (hot path) and an on-disk transcript-log cylinder (cold store); clients attach against the small mirror and lazily backfill deep history from the log",
				style: "max-width:600px;font:13px ui-sans-serif,system-ui,sans-serif",
				children: [
					createVNode(_components.defs, { children: [createVNode("marker", {
						id: "khoTgtHot",
						viewBox: "0 0 10 10",
						refX: "8.5",
						refY: "5",
						markerWidth: "7",
						markerHeight: "7",
						orient: "auto",
						children: createVNode("path", {
							d: "M0 0 L10 5 L0 10 z",
							fill: "var(--good-stroke,#15803D)"
						})
					}), createVNode("marker", {
						id: "khoTgtCold",
						viewBox: "0 0 10 10",
						refX: "8.5",
						refY: "5",
						markerWidth: "7",
						markerHeight: "7",
						orient: "auto",
						children: createVNode("path", {
							d: "M0 0 L10 5 L0 10 z",
							fill: "var(--struct-stroke,#0D32B2)"
						})
					})] }),
					createVNode("rect", {
						x: "190",
						y: "10",
						width: "220",
						height: "46",
						rx: "8",
						fill: "var(--surface,#F7F8FE)",
						stroke: "var(--struct-stroke,#0D32B2)",
						"stroke-width": "1.5"
					}),
					createVNode("text", {
						x: "300",
						y: "32",
						"text-anchor": "middle",
						"font-weight": "700",
						fill: "var(--ink,#11203a)",
						children: "PTY child (node-pty)"
					}),
					createVNode("text", {
						x: "300",
						y: "48",
						"text-anchor": "middle",
						"font-size": "11",
						fill: "var(--struct-sub,#4A5072)",
						"font-family": "ui-monospace,'SF Mono',Menlo,monospace",
						children: "raw bytes"
					}),
					createVNode("text", {
						x: "170",
						y: "118",
						"text-anchor": "middle",
						"font-size": "11",
						"font-weight": "700",
						fill: "var(--good-text,#166534)",
						children: "HOT PATH · in RAM"
					}),
					createVNode("rect", {
						x: "70",
						y: "148",
						width: "200",
						height: "56",
						rx: "8",
						fill: "var(--good-fill,#eff6f0)",
						stroke: "var(--good-stroke,#15803D)",
						"stroke-width": "2.5"
					}),
					createVNode("text", {
						x: "170",
						y: "169",
						"text-anchor": "middle",
						"font-weight": "700",
						"font-size": "12",
						fill: "var(--ink,#1a1d21)",
						children: "mirror — SMALL"
					}),
					createVNode("text", {
						x: "170",
						y: "186",
						"text-anchor": "middle",
						"font-size": "10.5",
						fill: "var(--good-text,#166534)",
						"font-family": "ui-monospace,'SF Mono',Menlo,monospace",
						children: "byte-capped, not 50 K"
					}),
					createVNode("text", {
						x: "170",
						y: "199",
						"text-anchor": "middle",
						"font-size": "8",
						fill: "var(--good-text,#166534)",
						children: "viewport · metadata · scrape · repaint"
					}),
					createVNode("text", {
						x: "472",
						y: "92",
						"text-anchor": "middle",
						"font-size": "11",
						"font-weight": "700",
						fill: "var(--struct-stroke,#0D32B2)",
						children: "COLD STORE · on disk"
					}),
					createVNode(_components.g, { children: [
						createVNode("path", {
							d: "M372 116 a100 13 0 0 0 200 0 v92 a100 13 0 0 1 -200 0 z",
							fill: "var(--surface,#EDF0FD)",
							stroke: "var(--struct-stroke,#0D32B2)",
							"stroke-width": "2.5"
						}),
						createVNode("ellipse", {
							cx: "472",
							cy: "116",
							rx: "100",
							ry: "13",
							fill: "var(--surface,#F7F8FE)",
							stroke: "var(--struct-stroke,#0D32B2)",
							"stroke-width": "2.5"
						}),
						createVNode("text", {
							x: "472",
							y: "150",
							"text-anchor": "middle",
							"font-weight": "700",
							"font-size": "12",
							fill: "var(--ink,#11203a)",
							children: "transcript log (#417)"
						}),
						createVNode("text", {
							x: "472",
							y: "170",
							"text-anchor": "middle",
							"font-size": "10.5",
							fill: "var(--struct-sub,#4A5072)",
							"font-family": "ui-monospace,'SF Mono',Menlo,monospace",
							children: "raw PTY bytes · append-only"
						}),
						createVNode("text", {
							x: "472",
							y: "188",
							"text-anchor": "middle",
							"font-size": "9",
							fill: "var(--struct-sub,#4A5072)",
							children: "retention-capped (disk, deep store)"
						})
					] }),
					createVNode("rect", {
						x: "130",
						y: "298",
						width: "340",
						height: "50",
						rx: "8",
						fill: "var(--surface,#F7F8FE)",
						stroke: "var(--struct-stroke,#0D32B2)",
						"stroke-width": "1.5"
					}),
					createVNode("text", {
						x: "300",
						y: "320",
						"text-anchor": "middle",
						"font-weight": "700",
						fill: "var(--ink,#11203a)",
						children: "browser xterm"
					}),
					createVNode("text", {
						x: "300",
						y: "337",
						"text-anchor": "middle",
						"font-size": "11",
						fill: "var(--struct-sub,#4A5072)",
						children: "keeps its own visible scrollback"
					}),
					createVNode("path", {
						d: "M268 56 L195 148",
						fill: "none",
						stroke: "var(--good-stroke,#15803D)",
						"stroke-width": "2.5",
						"marker-end": "url(#khoTgtHot)"
					}),
					createVNode("text", {
						x: "200",
						y: "104",
						"text-anchor": "end",
						"font-size": "10.5",
						"font-style": "italic",
						fill: "var(--good-text,#166534)",
						children: "parse (live)"
					}),
					createVNode("path", {
						d: "M340 56 L445 104",
						fill: "none",
						stroke: "var(--struct-stroke,#0D32B2)",
						"stroke-width": "1.5",
						"marker-end": "url(#khoTgtCold)"
					}),
					createVNode("text", {
						x: "400",
						y: "88",
						"text-anchor": "end",
						"font-size": "10.5",
						"font-style": "italic",
						fill: "var(--struct-sub,#4A5072)",
						children: "append every byte"
					}),
					createVNode("path", {
						d: "M180 204 L255 298",
						fill: "none",
						stroke: "var(--good-stroke,#15803D)",
						"stroke-width": "2.5",
						"marker-end": "url(#khoTgtHot)"
					}),
					createVNode("text", {
						x: "168",
						y: "258",
						"text-anchor": "end",
						"font-size": "10.5",
						"font-style": "italic",
						fill: "var(--good-text,#166534)",
						children: "attach: viewport + deltas"
					}),
					createVNode("text", {
						x: "168",
						y: "271",
						"text-anchor": "end",
						"font-size": "9.5",
						fill: "var(--good-text,#166534)",
						children: "(hot path)"
					}),
					createVNode("path", {
						d: "M468 234 L352 298",
						fill: "none",
						stroke: "var(--struct-stroke,#0D32B2)",
						"stroke-width": "1.5",
						"stroke-dasharray": "6 4",
						"marker-end": "url(#khoTgtCold)"
					}),
					createVNode("text", {
						x: "436",
						y: "256",
						"text-anchor": "end",
						"font-size": "10.5",
						"font-style": "italic",
						fill: "var(--struct-sub,#4A5072)",
						children: "lazy backfill"
					}),
					createVNode("text", {
						x: "436",
						y: "269",
						"text-anchor": "end",
						"font-size": "9.5",
						fill: "var(--struct-sub,#4A5072)",
						children: "(cold: scroll · PDF · search)"
					})
				]
			}), createVNode("figcaption", {
				style: "margin-top:.5rem;font-size:.8rem;color:var(--faint,#7a8089);font-family:ui-sans-serif,system-ui,sans-serif",
				children: [
					"Target shape. Every PTY byte feeds a ",
					createVNode(_components.em, { children: "small" }),
					" live mirror (viewport + just enough for metadata, scrape, cold repaint — capped by bytes) and appends to an on-disk transcript log (#417). Clients attach against the small mirror; deep scroll-back, PDF export, and search lazily backfill from the log — no live 50 K cell-grid retained per terminal, anywhere."
				]
			})]
		}),
		"\n",
		createVNode(_components.h3, {
			id: "1-keep-the-in-ram-mirror-small--constant",
			children: [createVNode($$Pill, {
				variant: "ok",
				children: "1"
			}), " Keep the in-RAM mirror small & constant"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Size the headless mirror to what the ",
			createVNode(_components.em, { children: "live" }),
			" jobs actually need — viewport + a small window for the metadata OSC handlers, device-query replies, screen-scrape tail, and cold-attach repaint — capped by ",
			createVNode(_components.strong, { children: "bytes" }),
			", not 50 K lines. ",
			createVNode(_components.strong, { children: "Shells are never reaped — the survivability guarantee is untouched" }),
			"; a small mirror makes an idle terminal nearly free, which also dissolves the “should we reap idle terminals?” tension."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Measured, not extrapolated" }), " — re-running the accumulation repro under a fixed 512 MB old-space cap at three mirror sizes:"] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Mirror scrollback" }),
					"\n",
					createVNode(_components.th, { children: "V8 heap / terminal" }),
					"\n",
					createVNode(_components.th, { children: "Terms → OOM (512 MB cap)" }),
					"\n",
					createVNode(_components.th, { children: "→ at the 4 GB ceiling" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "50 K (today)" }) }),
					"\n",
					createVNode(_components.td, { children: "~16 MB" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "32" }) }),
					"\n",
					createVNode(_components.td, { children: "~256 terminals" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "10 K" }),
					"\n",
					createVNode(_components.td, { children: "~3.9 MB" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "130" }), " (4.1×)"] }),
					"\n",
					createVNode(_components.td, { children: "~1,050" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "2 K" }),
					"\n",
					createVNode(_components.td, { children: "~1.0 MB" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "≥396 — no OOM" }), " (≥12×)"] }),
					"\n",
					createVNode(_components.td, { children: "~4,000" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"A ~2 K mirror turns a ~256-terminal ceiling into ~4,000 (and cuts external ",
			createVNode(_components.code, { children: "ArrayBuffer" }),
			" RSS ~15× too). The gain is ",
			createVNode(_components.strong, { children: "sub-linear" }),
			" — a 25× line cut buys ~16×, not 25× — because a fixed ~0.5–1 MB/terminal floor (node-pty handle, ",
			createVNode(_components.code, { children: "Entry" }),
			", channels, the ",
			createVNode(_components.code, { children: "Terminal" }),
			" instance) doesn’t shrink. Two honest bounds: the cap only helps terminals that ",
			createVNode(_components.em, { children: "exceed" }),
			" it (a 500-line terminal is unaffected — but the deep-scrollback agent terminals that ",
			createVNode(_components.em, { children: "do" }),
			" drive the OOM benefit fully), and it ",
			createVNode(_components.em, { children: "raises" }),
			" the ceiling rather than removing the linear-in-count growth (that’s what #2/#3 + reaping are for)."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "2-deep-history--the-on-disk-transcript-log-417",
			children: [createVNode($$Pill, {
				variant: "ok",
				children: "2"
			}), " Deep history → the on-disk transcript log (#417)"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Append every PTY byte to a per-terminal log on disk — raw bytes, the honest replayable source (rendered/serialized state is lossy). PDF export (the reason 50 K exists), scrollback search, true session restore, and crash forensics all read from it; depth is bounded by a ",
			createVNode(_components.strong, { children: "disk retention policy" }),
			", not RAM. This is ",
			createVNode($$Issue, { n: 417 }),
			" as already specified — ",
			createVNode(_components.em, { children: "reuse it, don’t build a parallel store" }),
			"."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "3-lazy-backfill-on-deep-scroll",
			children: [createVNode($$Pill, {
				variant: "ok",
				children: "3"
			}), " Lazy backfill on deep scroll"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Stop eager-serializing the mirror on attach. Repaint the viewport from the small mirror, then when a client scrolls past the hot window, fetch older ranges from the log and render them (the tmux / wezterm pattern). Cold reconnect becomes cheap ",
			createVNode(_components.em, { children: "and" }),
			" lossless."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "now-interim-until-417-lands",
			children: [createVNode($$Pill, {
				variant: "ok",
				children: "now"
			}), " Interim, until #417 lands"]
		}),
		"\n",
		createVNode(_components.p, { children: "#417 is a multi-PR effort; ship the observability net first so a future leak is diagnosable, not a mystery:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "kaval-side diagnostics" }),
				" — un-scrub the snapshot flags (or pass explicit ",
				createVNode(_components.code, { children: "execArgv" }),
				" + diag dir via ",
				createVNode(_components.code, { children: "localKavalDriver" }),
				") so prod shows the ",
				createVNode(_components.code, { children: "terms" }),
				"/heap curve and dumps a near-limit snapshot."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "A soak-test regression guard" }), " — assert per-terminal heap stays proportional and bounded, so a scrollback-size or accumulation regression trips the test, not prod."] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "No explicit heap cap — deliberately",
			children: createVNode(_components.p, { children: [
				"An early draft baked a ",
				createVNode(_components.code, { children: "--max-old-space-size" }),
				" cap into kaval’s wrapper as a “tripwire.” It was ",
				createVNode(_components.strong, { children: "dropped" }),
				": once the mirror shrink raised the ceiling ~4×, an explicit cap ",
				createVNode(_components.em, { children: "below" }),
				" V8’s RAM-derived default would only hand that headroom back, and the default already bounds a runaway. The near-limit heap snapshot fires relative to ",
				createVNode(_components.em, { children: "whatever" }),
				" the ceiling is, so it needs no manual cap. The safety net here is ",
				createVNode(_components.strong, { children: "observability, not a smaller ceiling" }),
				"."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "The home-manager surface (services.kolu)",
			children: createVNode(_components.p, { children: [
				"Deployment is the ",
				createVNode(_components.code, { children: "services.kolu" }),
				" home-manager module, so the wiring lands there — but as ",
				createVNode(_components.em, { children: "plumbing" }),
				", not new knobs. The diag ",
				createVNode(_components.strong, { children: "dir" }),
				" reuses the existing ",
				createVNode(_components.code, { children: "services.kolu.diagnostics.dir" }),
				" option (",
				createVNode($$Cite, {
					file: "nix/home/module.nix",
					label: "module.nix"
				}),
				") — the work is making that value ",
				createVNode(_components.em, { children: "reach kaval" }),
				" (module → server env → ",
				createVNode(_components.code, { children: "localKavalDriver" }),
				" forwards it → kaval’s wrapper arms the V8 hooks), because today ",
				createVNode(_components.code, { children: "scrubNodeOptions" }),
				" severs the server’s flags before kaval. A new ",
				createVNode(_components.code, { children: "mkOption" }),
				" is only warranted to toggle kaval diagnostics ",
				createVNode(_components.em, { children: "independently" }),
				" of the server’s — likely unnecessary."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "current-state--open-questions",
			children: "Current state & open questions"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"Fixed in ",
				createVNode($$PrLink, { pr: 1427 }),
				"."
			] }),
			" The recurrence risk that drove this RCA is now ",
			createVNode(_components.strong, { children: "bounded" }),
			", not just identified. The change that matters: the server-side mirror shrank from 50 K to a ",
			createVNode(_components.strong, { children: "10 K" }),
			" ",
			createVNode(_components.code, { children: "DEFAULT_MIRROR_SCROLLBACK" }),
			" (decoupled from the client’s 50 K, which PDF export + interactive scrollback still need), measured ",
			createVNode(_components.strong, { children: "~4×" }),
			" the OOM ceiling. Alongside it, an ",
			createVNode(_components.strong, { children: "observability net" }),
			" — kaval-side ",
			createVNode(_components.code, { children: "@kolu/heap-diag" }),
			" that logs the heap/",
			createVNode(_components.code, { children: "terms" }),
			" curve and arms a near-limit snapshot, so the next approach to the ceiling dumps a snapshot instead of a silent abort. ",
			createVNode(_components.em, { children: "(No explicit heap cap: with the mirror fixed, a cap would only give back the headroom the fix bought — see the note above.)" })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"This ",
			createVNode(_components.strong, { children: "raises" }),
			" the ceiling ~4×; the ",
			createVNode(_components.em, { children: "linear-in-count" }),
			" growth remains ",
			createVNode(_components.strong, { children: "by design" }),
			" — removing it is the tracked follow-up, not a regression. What remains open:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				"The on-disk transcript log (",
				createVNode($$Issue, { n: 417 }),
				") + lazy backfill"
			] }), " — the real fix that removes the linear-in-count growth and lets the hot mirror shrink further (toward a byte-capped viewport window). #417 also carries its own retention policy (per-terminal disk-log size cap + a privacy off-switch — a legitimate switch, not a degradation knob)."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: ["The exact JS path of the kolu-side ", createVNode(_components.code, { children: "write ECANCELED" })] }), " — inferred (a floating promise on the pty-host stdio link), not pinned to a verified line. Low priority: the kolu exit is correct behaviour regardless."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Reproduced in-process on ",
			createVNode(_components.code, { children: "naiveintent" }),
			" (heap linear in live-terminal count; the production crash signature at the 50 K mirror). The plan landed in ",
			createVNode($$PrLink, { pr: 1421 }),
			"; the fix — small mirror (10 K) + kaval diagnostics — shipped in ",
			createVNode($$PrLink, { pr: 1427 }),
			". The deeper follow-up that removes the linear-in-count growth is ",
			createVNode($$Issue, { n: 417 }),
			" (with ",
			createVNode($$PrLink, { pr: 416 }),
			" / ",
			createVNode($$PrLink, { pr: 413 }),
			" as the why-50K backstory)."
		] }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Kaval PTY-host heap OOM",
	"description": "A recurring production crash — kaval's per-PTY 50 K-line scrollback mirror × an unbounded, never-reaped live-terminal population grows the V8 heap to its ~4 GB ceiling; it self-aborts (SIGABRT) and takes the kolu server down via fail-fast. Reproduced in-process. RCA + prior art (tmux/zellij/ghostty/kitty/mosh) + plan of record — a small hot mirror over an on-disk transcript log (#417).",
	"parents": ["pty-daemon", "analysis"],
	"status": "implemented",
	"maturity": "budding",
	"updated": "2026-06-19T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-crashed",
			"text": "What crashed"
		},
		{
			"depth": 2,
			"slug": "root-cause-live-terminals-accumulate-each-pinning-a-50-k-line-mirror",
			"text": "Root cause: live terminals accumulate, each pinning a 50 K-line mirror"
		},
		{
			"depth": 3,
			"slug": "does-this-hurt-kavals-performance--yes-before-it-ever-crashes",
			"text": "Does this hurt kaval’s performance? — yes, before it ever crashes"
		},
		{
			"depth": 2,
			"slug": "why-we-cant-see-it-yet--the-diagnostics-gap",
			"text": "Why we can’t see it yet — the diagnostics gap"
		},
		{
			"depth": 2,
			"slug": "how-other-terminals--multiplexers-bound-this",
			"text": "How other terminals & multiplexers bound this"
		},
		{
			"depth": 2,
			"slug": "the-fix--a-small-hot-mirror-over-an-on-disk-transcript-log",
			"text": "The fix — a small hot mirror over an on-disk transcript log"
		},
		{
			"depth": 3,
			"slug": "1-keep-the-in-ram-mirror-small--constant",
			"text": "1 Keep the in-RAM mirror small & constant"
		},
		{
			"depth": 3,
			"slug": "2-deep-history--the-on-disk-transcript-log-417",
			"text": "2 Deep history → the on-disk transcript log (#417)"
		},
		{
			"depth": 3,
			"slug": "3-lazy-backfill-on-deep-scroll",
			"text": "3 Lazy backfill on deep scroll"
		},
		{
			"depth": 3,
			"slug": "now-interim-until-417-lands",
			"text": "now Interim, until #417 lands"
		},
		{
			"depth": 2,
			"slug": "current-state--open-questions",
			"text": "Current state & open questions"
		}
	];
}
var url = "src/content/atlas/kaval-heap-oom.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-heap-oom.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-heap-oom.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
