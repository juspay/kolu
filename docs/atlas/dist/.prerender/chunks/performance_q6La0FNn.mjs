import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import { t as $$Issue } from "./Issue_mLFqCJSR.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
import { t as $$Finding } from "./Finding_CGyJz3Ru.mjs";
//#region src/content/atlas/performance.mdx
var NcuLevers = () => createVNode("div", {
	style: "margin:1.5rem 0;overflow-x:auto",
	children: createVNode("svg", {
		viewBox: "0 0 720 336",
		width: "100%",
		style: "min-width:600px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;font-family:ui-sans-serif,system-ui",
		role: "img",
		"aria-label": "Kolu's optimizations sorted into three columns by the lever they pull. N (do fewer things) is green-heavy — reactivity re-derivation, markdown re-sanitize, scrollback share, and canvas coalescing all shipped, with getSubTerminalIds, mobile wake-ups, and the Nix build still open. C (make each thing cheaper) is led by the now-shipped marquee item — compressing the 2.56 MB client bundle to 571 kB — plus still-open binary framing, metadata deltas, and a tap-rect cache. U (use idle capacity) has one shipped win, off-thread diff highlighting, then workspace and server test parallelism and byte-bounded kaval queues open — a thin lever because a single-user client has little idle capacity.",
		children: [
			createVNode("text", {
				x: "20",
				y: "26",
				"font-size": "14",
				"font-weight": "700",
				fill: "#0A0F25",
				children: "Kolu's optimizations by lever"
			}),
			createVNode("text", {
				x: "20",
				y: "45",
				"font-size": "12",
				"font-weight": "650",
				fill: "#3f444b",
				children: "Time ≈ (N × C) / U"
			}),
			createVNode("rect", {
				x: "470",
				y: "14",
				width: "13",
				height: "13",
				rx: "3",
				fill: "#E6F4EA",
				stroke: "#15803D",
				"stroke-width": "1.5"
			}),
			createVNode("text", {
				x: "489",
				y: "25",
				"font-size": "11",
				fill: "#3f444b",
				children: "shipped"
			}),
			createVNode("rect", {
				x: "560",
				y: "14",
				width: "13",
				height: "13",
				rx: "3",
				fill: "#FBF1DC",
				stroke: "#B45309",
				"stroke-width": "1.5"
			}),
			createVNode("text", {
				x: "579",
				y: "25",
				"font-size": "11",
				fill: "#3f444b",
				children: "to tune"
			}),
			createVNode("text", {
				x: "636",
				y: "25",
				"font-size": "11",
				fill: "#166534",
				children: "★ = marquee ✓"
			}),
			createVNode("rect", {
				x: "16",
				y: "60",
				width: "222",
				height: "264",
				rx: "10",
				fill: "#F7F8FE",
				stroke: "#0D32B2",
				"stroke-width": "1.4"
			}),
			createVNode("text", {
				x: "30",
				y: "88",
				"font-size": "21",
				"font-weight": "800",
				fill: "#0D32B2",
				children: "N"
			}),
			createVNode("text", {
				x: "54",
				y: "80",
				"font-size": "11.5",
				"font-weight": "700",
				fill: "#11203a",
				children: "Do fewer things"
			}),
			createVNode("text", {
				x: "54",
				y: "94",
				"font-size": "9.3",
				fill: "#5b6470",
				children: "fewer steps · redundant work"
			}),
			createVNode("text", {
				x: "30",
				y: "110",
				"font-size": "9",
				"font-style": "italic",
				fill: "#166534",
				children: "where Kolu has already won"
			}),
			[
				[
					"Reactivity re-derivation ✓ #1425",
					true,
					"#n-reactivity-memo"
				],
				[
					"Markdown re-sanitize ✓ #1446",
					true,
					"#n-markdown-toggle"
				],
				[
					"Scrollback share ✓ #1573",
					true,
					"#banked-scrollback"
				],
				[
					"Canvas rAF-coalesce ✓ #1368",
					true,
					"#banked-canvas"
				],
				[
					"getSubTerminalIds O(n²)",
					false,
					"#n-getsubterminalids"
				],
				[
					"Mobile wake-ups ↓ (15s·60s·1s)",
					false,
					"#n-heartbeat"
				],
				[
					"Nix build-once",
					false,
					"#n-nix-hash"
				]
			].map(([label, ok, href], i) => createVNode("a", {
				href,
				style: "cursor:pointer",
				children: [createVNode("rect", {
					x: "26",
					y: 120 + i * 26,
					width: "202",
					height: "20",
					rx: "5",
					fill: ok ? "#E6F4EA" : "#FBF1DC",
					stroke: ok ? "#15803D" : "#B45309",
					"stroke-width": "1.3"
				}), createVNode("text", {
					x: "35",
					y: 134 + i * 26,
					"font-size": "9.4",
					fill: ok ? "#166534" : "#92400E",
					children: label
				})]
			})),
			createVNode("rect", {
				x: "249",
				y: "60",
				width: "222",
				height: "264",
				rx: "10",
				fill: "#F7F8FE",
				stroke: "#0b6478",
				"stroke-width": "1.4"
			}),
			createVNode("text", {
				x: "263",
				y: "88",
				"font-size": "21",
				"font-weight": "800",
				fill: "#0b6478",
				children: "C"
			}),
			createVNode("text", {
				x: "287",
				y: "80",
				"font-size": "11.5",
				"font-weight": "700",
				fill: "#11203a",
				children: "Make each cheaper"
			}),
			createVNode("text", {
				x: "287",
				y: "94",
				"font-size": "9.3",
				fill: "#5b6470",
				children: "fewer bytes · less distance"
			}),
			createVNode("text", {
				x: "263",
				y: "110",
				"font-size": "9",
				"font-style": "italic",
				fill: "#92400E",
				children: "frontier: the wire + the bundle"
			}),
			createVNode("rect", {
				x: "256",
				y: "117",
				width: "208",
				height: "26",
				rx: "7",
				fill: "#E6F4EA",
				stroke: "#E6F4EA",
				"stroke-width": "6",
				opacity: "0.6"
			}),
			createVNode("a", {
				href: "#c-compression",
				style: "cursor:pointer",
				children: [createVNode("rect", {
					x: "259",
					y: "120",
					width: "202",
					height: "20",
					rx: "5",
					fill: "#E6F4EA",
					stroke: "#15803D",
					"stroke-width": "2.3"
				}), createVNode("text", {
					x: "268",
					y: "134",
					"font-size": "9.4",
					"font-weight": "700",
					fill: "#166534",
					children: "★ Bundle compressed ✓ 4.6× #1643"
				})]
			}),
			[
				["base64 → binary framing +33%", "#c-base64"],
				["Full metadata → deltas", "#c-metadata"],
				["Tap-rect cache (layout read)", "#c-taprect"]
			].map(([label, href], i) => createVNode("a", {
				href,
				style: "cursor:pointer",
				children: [createVNode("rect", {
					x: "259",
					y: 146 + i * 26,
					width: "202",
					height: "20",
					rx: "5",
					fill: "#FBF1DC",
					stroke: "#B45309",
					"stroke-width": "1.3"
				}), createVNode("text", {
					x: "268",
					y: 160 + i * 26,
					"font-size": "9.4",
					fill: "#92400E",
					children: label
				})]
			})),
			createVNode("text", {
				x: "263",
				y: "242",
				"font-size": "9",
				"font-style": "italic",
				fill: "#166534",
				children: "bundle compression ✓ banked"
			}),
			createVNode("rect", {
				x: "482",
				y: "60",
				width: "222",
				height: "264",
				rx: "10",
				fill: "#F7F8FE",
				stroke: "#7c4dd4",
				"stroke-width": "1.4"
			}),
			createVNode("text", {
				x: "496",
				y: "88",
				"font-size": "21",
				"font-weight": "800",
				fill: "#7c4dd4",
				children: "U"
			}),
			createVNode("text", {
				x: "520",
				y: "80",
				"font-size": "11.5",
				"font-weight": "700",
				fill: "#11203a",
				children: "Use idle capacity"
			}),
			createVNode("text", {
				x: "520",
				y: "94",
				"font-size": "9.3",
				fill: "#5b6470",
				children: "parallel · pipeline · pre-compute"
			}),
			createVNode("text", {
				x: "496",
				y: "110",
				"font-size": "9",
				"font-style": "italic",
				fill: "#6d28d9",
				children: "nearly untapped"
			}),
			[
				[
					"Off-thread diff ✓ #1363",
					true,
					"#banked-diff"
				],
				[
					"Workspace test parallelism",
					false,
					"#u-test-parallelism"
				],
				[
					"Server vitest parallelism",
					false,
					"#u-server-vitest"
				],
				[
					"kaval byte-bounded queues",
					false,
					"#u-kaval-queues"
				]
			].map(([label, ok, href], i) => createVNode("a", {
				href,
				style: "cursor:pointer",
				children: [createVNode("rect", {
					x: "492",
					y: 120 + i * 26,
					width: "202",
					height: "20",
					rx: "5",
					fill: ok ? "#E6F4EA" : "#FBF1DC",
					stroke: ok ? "#15803D" : "#B45309",
					"stroke-width": "1.3"
				}), createVNode("text", {
					x: "501",
					y: 134 + i * 26,
					"font-size": "9.4",
					fill: ok ? "#166534" : "#92400E",
					children: label
				})]
			})),
			createVNode("text", {
				x: "496",
				y: "242",
				"font-size": "9",
				"font-style": "italic",
				fill: "#5b6470",
				children: "thin — a single-user client"
			})
		]
	})
});
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
			"This is the Atlas hub for ",
			createVNode(_components.strong, { children: "keeping Kolu nimble and fast" }),
			" — a living map of the\nmonorepo’s performance surfaces, the wins already banked, and the opportunities\nworth tuning next, all organized by one model: ",
			createVNode(_components.strong, { children: "N/C/U" }),
			". It was built by a survey\nworkflow with adversarial verification,",
			createVNode($$Footnote, { children: [
				createVNode(_components.strong, { children: "10 investigators" }),
				", one per\nsubsystem, each reading real source, then synthesis. Every finding was then\nchecked against the code — this repo’s history shows plausible, code-cited perf\ndiagnoses are ",
				createVNode(_components.em, { children: "often wrong" }),
				" (see\n",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/blob/master/docs/perf-investigations/memory-learnings.md",
					children: createVNode(_components.code, { children: "memory-learnings" })
				}),
				"\nand ",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/blob/master/docs/perf-investigations/dock-and-eventloop-1308.md",
					children: createVNode(_components.code, { children: "dock-and-eventloop-1308" })
				}),
				")."
			] }),
			"\nand re-files every survivor under the lever it pulls.",
			createVNode($$Footnote, { children: [
				"Of ",
				createVNode(_components.strong, { children: "66 raw\nfindings, 35 survived" }),
				" as real or partial, 6 were confirmed already-shipped, and\n",
				createVNode(_components.strong, { children: "25 were dropped" }),
				" as speculative or mechanically wrong. This pass also adds one\nverified new item (the uncompressed bundle) and two low-confidence candidates a\nsecond sweep surfaced."
			] })
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The honest headline — Kolu is N-dominated and measurement-disciplined",
			children: createVNode(_components.p, { children: [
				"Read through the model, the ledger has a clear shape. ",
				createVNode(_components.strong, { children: "N — doing fewer things —\nis where Kolu has already won" }),
				": nearly every banked win removes redundant\nwork.",
				createVNode($$Footnote, { children: [
					"The reactivity re-derivation gate ",
					createVNode($$PrLink, { pr: 1425 }),
					", the markdown\nre-sanitize keep-alive ",
					createVNode($$PrLink, { pr: 1446 }),
					", the per-attach scrollback share\n",
					createVNode($$PrLink, { pr: 1573 }),
					", rAF-coalesced canvas gestures ",
					createVNode($$PrLink, { pr: 1368 }),
					"."
				] }),
				"\n",
				createVNode(_components.strong, { children: "C — making each thing cheaper — concentrates on the wire and the bundle" }),
				", and\njust banked its first win: a ",
				createVNode(_components.strong, { children: "2.56 MB client bundle now served compressed" }),
				"\n(→ 571 kB, 4.6×) ",
				createVNode($$PrLink, { pr: 1643 }),
				".",
				createVNode($$Footnote, { children: "The C work still open lives on the\nwire — full-set broadcasts and base64 framing." }),
				" ",
				createVNode(_components.strong, { children: "U — using idle\ncapacity — is nearly untapped" }),
				": off-thread diff highlighting ",
				createVNode($$PrLink, { pr: 1363 }),
				"\nis the lone banked U win, because a single-user desktop client has little idle\ncapacity to reclaim. Verification ",
				createVNode(_components.strong, { children: "downgraded every “high-impact” claim to\nmedium" }),
				" — what remains is mostly real-but-bounded structural inefficiency, not\nacute regression. So the rule this map enforces is ",
				createVNode(_components.em, { children: "measure before you tune" }),
				":\n",
				createVNode(_components.strong, { children: "the model tells you which lever a fix pulls and where to look next; a trace\nstill tells you whether it matters." })
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-ncu-model",
			children: "The N/C/U model"
		}),
		"\n",
		createVNode(_components.p, { children: "Think of any workload as a loop. The time to finish it is roughly:" }),
		"\n",
		createVNode("p", {
			style: "text-align:center;font-size:1.2rem;margin:1.1rem 0;font-weight:650;color:#11203a",
			children: "Time\xA0to\xA0outcome\xA0\xA0≈\xA0\xA0(N\xA0×\xA0C)\xA0/\xA0U"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "N — how many times." }), " Iterations, round-trips, re-derivations, retries. Lower\nit with a better algorithm, by removing dead work, by doing shared work once, or\nby not doing work until it’s actually asked for."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "C — how much each time costs." }),
				" Dominated by ",
				createVNode(_components.em, { children: "distance" }),
				" — network hops, layers\nof indirection, bytes moved. Lower it by keeping hot data close, compacting what\nrepeats, and shrinking what crosses the wire."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "U — how much of your capacity is working." }), " Idle cores, idle links, unbalanced\nload. Raise it with parallelism, pipelining, and pre-computing in slack time."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The three levers are orthogonal, so they ",
			createVNode(_components.em, { children: "multiply" }),
			": a 3× on each is 27×, not\n9×.",
			createVNode($$Footnote, { children: [
				"That is the aspirational ceiling, not Kolu’s ledger — this repo’s wins\nare mostly ",
				createVNode(_components.strong, { children: "single-lever and single-digit-percent at today’s scale" }),
				" (3–20\nterminals, small/medium docs)."
			] }),
			" Here the model earns its keep as a\n",
			createVNode(_components.strong, { children: "search heuristic" }),
			": it names the lever each fix pulls, so we don’t double-count a\nwin, and points at the thin levers — ",
			createVNode(_components.strong, { children: "C on the wire, and U almost everywhere" }),
			" —\nwhere the next structural headroom sits. Then you measure."
		] }),
		"\n",
		"\n",
		createVNode(NcuLevers, {}),
		"\n",
		createVNode(_components.h2, {
			id: "the-backlog",
			children: "The backlog"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The actionable shortlist, ranked by leverage, tagged with the lever each item\npulls. ",
			createVNode(_components.strong, { children: "Impact" }),
			" and ",
			createVNode(_components.strong, { children: "effort" }),
			" are the ",
			createVNode(_components.em, { children: "verified" }),
			" estimates (post-adversarial\ncorrection), not the original claims. Row 1 is new this pass and the only item on\nthe list that is ",
			createVNode(_components.strong, { children: "not bounded at today’s scale" }),
			" — it fires on every cold load,\nnow."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "#" }),
					"\n",
					createVNode(_components.th, { children: "Opportunity" }),
					"\n",
					createVNode(_components.th, { children: "Lever" }),
					"\n",
					createVNode(_components.th, { children: "Surface" }),
					"\n",
					createVNode(_components.th, { children: "Impact" }),
					"\n",
					createVNode(_components.th, { children: "Effort" }),
					"\n",
					createVNode(_components.th, { children: "The fix, in one line" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "1" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Serve the client bundle compressed" }),
						" ",
						createVNode($$Pill, {
							variant: "done",
							children: "shipped"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "run",
						children: "C·U"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Bundle" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "med"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "low"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Done" }),
						" ",
						createVNode($$PrLink, { pr: 1643 }),
						" — build-time ",
						createVNode(_components.code, { children: ".br" }),
						"/",
						createVNode(_components.code, { children: ".gz" }),
						" + serve-static negotiation; the 2.56 MB main chunk → ",
						createVNode(_components.strong, { children: "571 kB brotli (4.6×)" }),
						" on every cold / remote / phone load."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "2" }),
					"\n",
					createVNode(_components.td, { children: "Per-key collection deltas on the wire" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "run",
						children: "C·N"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Wire" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "med"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "med"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						"Publish ",
						createVNode(_components.code, { children: "{added/changed/removed}" }),
						" keys, not the full key array, on every upsert/remove."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "3" }),
					"\n",
					createVNode(_components.td, { children: "Heartbeat: hidden-tab probe interval" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "dx",
						children: "N"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Mobile" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "med"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "med"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Lengthen" }),
						" the background probe (30–60s), don’t stop it (that blinds the watchdog). Reconnect-on-resume already shipped ",
						createVNode($$PrLink, { pr: 1598 }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "4" }),
					"\n",
					createVNode(_components.td, { children: "Workspace-level test parallelism" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "dx",
						children: "U"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Dev-loop" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "med"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "low"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						"Add ",
						createVNode(_components.code, { children: "--workspace-concurrency" }),
						" so ~44 packages don’t test one-at-a-time."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "5" }),
					"\n",
					createVNode(_components.td, { children: "Lazy-load the Code tab — measured, deferred" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "run",
						children: "N·U"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Bundle" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "med"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "high"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						"171 kB gzip / 23% of the eager chunk, but ",
						createVNode(_components.code, { children: "activeTab" }),
						" ",
						createVNode(_components.strong, { children: ["defaults to ", createVNode(_components.code, { children: "code" })] }),
						" so it defers past first paint rather than skips — a faster-first-paint-vs-cold-flash trade. Deferred."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "6" }),
					"\n",
					createVNode(_components.td, { children: [
						"One-shot Nix ",
						createVNode(_components.code, { children: "pnpmDeps" }),
						" hash check"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "dx",
						children: "N"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Dev-loop" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "med"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "high"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Compute the hash once instead of two sequential builds (2m45s on darwin)." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "7" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: [
							"Stabilize the ",
							createVNode(_components.code, { children: "terminalIds" }),
							" memo"
						] }),
						" ",
						createVNode($$Pill, {
							variant: "done",
							children: "shipped"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "dx",
						children: "N"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Reactivity" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "med"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "med"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Done" }),
						" ",
						createVNode($$PrLink, { pr: 1425 }),
						" — the memo keeps its prior array when the id order is unchanged, so ",
						createVNode(_components.code, { children: "terminalIds()" }),
						" stops ",
						createVNode(_components.em, { children: "notifying" }),
						" downstream on non-display metadata writes."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "8" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Markdown toggle keep-alive" }),
						" ",
						createVNode($$Pill, {
							variant: "done",
							children: "shipped"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "dx",
						children: "N"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Markdown" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "med"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "med"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Done" }),
						" ",
						createVNode($$PrLink, { pr: 1446 }),
						" — a Source⇄Rendered flip is a visibility change, not a remount + full re-sanitize (pipeline runs ",
						createVNode(_components.strong, { children: "0×" }),
						" per toggle, was 1×)."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Read this before picking one up",
			children: createVNode(_components.p, { children: [
				"Almost every item below row 1 is ",
				createVNode(_components.strong, { children: "bounded at today’s scale" }),
				" (3–20 terminals,\nsmall/medium docs). The verdicts repeatedly note the mechanism is real but the\ncost is below perception until the scale grows. ",
				createVNode(_components.strong, { children: "Confirm with a profile first" }),
				" —\nthe ",
				createVNode(_components.a, {
					href: "#from-static-reads-to-live-traces",
					children: "coverage gaps"
				}),
				" section says exactly which\ntraces are still missing. The point of this map is to ",
				createVNode(_components.em, { children: "prioritize measurement" }),
				",\nnot to license speculative rewrites. Compression (row 1) is the exception — it\nalready ",
				createVNode(_components.strong, { children: "shipped" }),
				" ",
				createVNode($$PrLink, { pr: 1643 }),
				" at a measured ",
				createVNode(_components.strong, { children: "4.6×" }),
				" byte cut, so the\nonly work left there is capturing the after-LCP on a real phone."
			] })
		}),
		"\n",
		createVNode(_components.h3, {
			id: "already-banked",
			children: "Already banked"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"So this map isn’t re-litigated: the wins below are ",
			createVNode(_components.strong, { children: "shipped and verified" }),
			" — do\nnot re-report them as opportunities. Each is tagged with the lever it pulled;\nremaining slivers inside them are noted in the lever sections as ",
			createVNode(_components.em, { children: "“remaining\nwithin …”" }),
			"."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Reactivity keystone" }),
				" ",
				createVNode($$Pill, {
					variant: "dx",
					children: "N"
				}),
				" ",
				createVNode($$PrLink, { pr: 1425 }),
				" — the ",
				createVNode(_components.code, { children: "terminalIds" }),
				" memo keeps a stable reference when the top-level id order is unchanged (",
				createVNode(_components.code, { children: "sameTerminalIdOrder" }),
				" ",
				createVNode(_components.code, { children: "equals" }),
				" gate), so the accessor stops ",
				createVNode(_components.em, { children: "notifying" }),
				" downstream on non-display metadata writes; proven by a re-run-count regression test.",
				createVNode($$Footnote, { children: [
					createVNode(_components.code, { children: "displayInfos" }),
					" keeps its own field-level subscriptions to ",
					createVNode(_components.code, { children: "git" }),
					" / ",
					createVNode(_components.code, { children: "cwd" }),
					" / ",
					createVNode(_components.code, { children: "parentId" }),
					" via the surface store’s ",
					createVNode(_components.code, { children: "reconcile" }),
					" writes, so PR / agent / foreground churn never reached it even before this gate; a real ",
					createVNode(_components.code, { children: "git" }),
					" / ",
					createVNode(_components.code, { children: "cwd" }),
					" / ",
					createVNode(_components.code, { children: "parentId" }),
					" change still re-runs it, correctly — that path is left intact, by design."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Markdown toggle keep-alive" }),
				" ",
				createVNode($$Pill, {
					variant: "dx",
					children: "N"
				}),
				" ",
				createVNode($$PrLink, { pr: 1446 }),
				" — ",
				createVNode(_components.code, { children: "FileView" }),
				" keeps both Source ⇄ Rendered modes alive, so toggling a ",
				createVNode(_components.code, { children: ".md" }),
				" preview is a visibility flip, not a remount + full re-sanitize (the marked→DOMPurify→Shiki→",
				createVNode(_components.code, { children: "innerHTML" }),
				" pipeline runs 0× per toggle, was 1×).",
				createVNode($$Footnote, { children: [
					"A per-slot ",
					createVNode(_components.code, { children: "heldFile" }),
					" snapshot keeps reload-on-edit intact with no ",
					createVNode(_components.code, { children: "render(file)" }),
					" API change. The companion ",
					createVNode(_components.em, { children: "“stabilize the markdown image resolver reference”" }),
					" claim was ",
					createVNode(_components.a, {
						href: "https://github.com/juspay/kolu/blob/master/docs/perf-investigations/markdown-image-resolver-and-toggle.md",
						children: "refuted as a measured no-op"
					}),
					"."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode("span", { id: "banked-scrollback" }),
				createVNode(_components.strong, { children: "Per-attach scrollback share" }),
				" ",
				createVNode($$Pill, {
					variant: "dx",
					children: "N"
				}),
				" ",
				createVNode($$PrLink, { pr: 1573 }),
				" — an already-aborted attach does zero ",
				createVNode(_components.code, { children: "serialize()" }),
				", and a burst of attaches to one PTY within a publish-epoch shares one memoized snapshot; the reconnect-storm transient dropped from a measured ",
				createVNode(_components.strong, { children: "2–3.2 GB" }),
				" of concurrent full serializes to O(live-terminal count).",
				createVNode($$Footnote, { children: [
					"Bounding each snapshot to a viewport is the follow-up — ",
					createVNode(_components.a, {
						href: "./kaval-memory-architecture.html",
						children: "kaval memory"
					}),
					"."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Client bundle compression" }),
				" ",
				createVNode($$Pill, {
					variant: "dx",
					children: "C·U"
				}),
				" ",
				createVNode($$PrLink, { pr: 1643 }),
				" — the client build emits ",
				createVNode(_components.code, { children: ".br" }),
				"/",
				createVNode(_components.code, { children: ".gz" }),
				" for the immutable ",
				createVNode(_components.code, { children: "/assets/*" }),
				" and ",
				createVNode(_components.code, { children: "installFreshStatic" }),
				" serves them via serve-static ",
				createVNode(_components.code, { children: "precompressed" }),
				"; the 2.56 MB main chunk crosses the wire as ",
				createVNode(_components.strong, { children: "571 kB brotli (4.6×)" }),
				" on every cold / remote / phone load.",
				createVNode($$Footnote, { children: [
					"The ",
					createVNode(_components.code, { children: "no-store" }),
					" shell stays uncompressed (its commit stamp is seded post-build); zero per-request CPU, compression time-shifted to build."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "OpenCode-derived wins" }),
				" ",
				createVNode($$Pill, {
					variant: "dx",
					children: "N·U"
				}),
				" — ",
				createVNode(_components.code, { children: "@pierre/diffs" }),
				" 1.2.10 + Shiki 4.2.0 ",
				createVNode($$PrLink, { pr: 1360 }),
				", ",
				createVNode("span", { id: "banked-diff" }),
				"off-thread diff highlighting ",
				createVNode($$PrLink, { pr: 1363 }),
				" (the lone banked ",
				createVNode(_components.strong, { children: "U" }),
				" win), ",
				createVNode("span", { id: "banked-canvas" }),
				"the canvas gesture-p99 harness + rAF-coalesced pan/zoom ",
				createVNode($$PrLink, { pr: 1368 }),
				". Full write-up: ",
				createVNode(_components.a, {
					href: "./opencode-perf.html",
					children: "opencode-perf"
				}),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "WebGL context cap" }),
				" ",
				createVNode($$Pill, {
					variant: "dx",
					children: "U"
				}),
				" ",
				createVNode($$PrLink, { pr: 1416 }),
				" ",
				createVNode($$Issue, { n: 1399 }),
				" — admit the whole working set under a 12-context cap; killed the focus-churn VRAM leak on Chrome+AMD."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Compositor paint storms" }),
				" ",
				createVNode($$Pill, {
					variant: "dx",
					children: "C"
				}),
				" — canvas tile-aura + dock CSS animations moved to compositor-friendly properties ",
				createVNode($$PrLink, { pr: 1354 }),
				" ",
				createVNode($$Issue, { n: 1308 }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Off-screen work elimination" }),
				" ",
				createVNode($$Pill, {
					variant: "dx",
					children: "N"
				}),
				" — covered tiles reuse the viewport box; no redundant ",
				createVNode(_components.code, { children: "ResizeObserver" }),
				" ",
				createVNode(_components.code, { children: "fit()" }),
				" cycles on hidden terminals."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Memory" }),
				" ",
				createVNode($$Pill, {
					variant: "dx",
					children: "U"
				}),
				" — ",
				createVNode(_components.code, { children: "storesByKey" }),
				" released on terminal deletion; per-terminal history-browser state reset on repo change ",
				createVNode($$Issue, { n: 610 }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Heartbeat reconnect-on-resume" }),
				" ",
				createVNode($$Pill, {
					variant: "dx",
					children: "N"
				}),
				" ",
				createVNode($$PrLink, { pr: 1598 }),
				" — the watchdog compares elapsed wall vs monotonic time across each probe and voids-and-re-probes a window a suspension crossed, so a laptop sleep / tab freeze no longer forces a spurious reconnect over a healthy socket."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Blocking ",
					createVNode(_components.code, { children: "git rev-parse" }),
					" off the event loop"
				] }),
				" ",
				createVNode($$Pill, {
					variant: "dx",
					children: "N"
				}),
				" ",
				createVNode($$PrLink, { pr: 1615 }),
				" — the Code-view watchers resolved each repo’s git dir with a synchronous ",
				createVNode(_components.code, { children: "execSync('git rev-parse')" }),
				" inline on every watcher install, which could freeze the ",
				createVNode(_components.em, { children: "entire" }),
				" single-threaded event loop.",
				createVNode($$Footnote, { children: [
					"One wedged call froze the event loop in ",
					createVNode(_components.code, { children: "waitpid" }),
					" with no timeout — a 25-minute browser-unresponsive wedge. Now async + bounded: ",
					createVNode(_components.code, { children: "execFile" }),
					" 5s timeout, ",
					createVNode(_components.code, { children: "fs.promises.realpath" }),
					"."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Nix dev-shell eval" }),
				" ",
				createVNode($$Pill, {
					variant: "dx",
					children: "C"
				}),
				" — 35× faster (",
				createVNode(_components.code, { children: "docs/nix-eval-perf-report.md" }),
				")."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "n--do-fewer-things",
			children: "N — Do fewer things"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The fat lever, and the one Kolu has mostly already pulled. On a reactive client\nthe enemy is ",
			createVNode(_components.strong, { children: "redundant re-derivation" }),
			", not distance or idle cores — so the\nbanked wins above (reactivity, markdown, scrollback, canvas) all live here, and\nwhat’s left is more of the same: scans that could be indexed, timers that wake\nwhen nothing’s watching, and round-trips that could be shared or deferred."
		] }),
		"\n",
		createVNode($$Finding, {
			sev: "low",
			id: "n-reactivity-memo",
			title: "Keystone — stabilize the terminalIds memo reference — ✓ shipped",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "terminalIds" }),
				" was a ",
				createVNode(_components.code, { children: "createMemo" }),
				" running ",
				createVNode(_components.code, { children: "meta.keys().filter(...)" }),
				"\n(",
				createVNode(_components.code, { children: "useTerminalMetadata.ts" }),
				"), returning a ",
				createVNode(_components.strong, { children: "new array reference every run even when\nthe contents were identical" }),
				". The dependent ",
				createVNode(_components.code, { children: "displayInfos" }),
				" memo tracked that\nreference, so ",
				createVNode(_components.em, { children: "any single terminal’s metadata mutation" }),
				" re-ran\n",
				createVNode(_components.code, { children: "buildTerminalDisplayInfos" }),
				" for ",
				createVNode(_components.strong, { children: "all" }),
				" terminals (",
				createVNode(_components.code, { children: "terminalDisplay.ts" }),
				") and\nre-evaluated every tile’s ",
				createVNode(_components.code, { children: "Show" }),
				" gate.",
				createVNode($$Footnote, { children: [
					"Each pass allocated 4–5\nintermediate collections and re-checked ",
					createVNode(_components.code, { children: "getDisplayInfo" }),
					" per tile\n(",
					createVNode(_components.code, { children: "TerminalCanvas.tsx" }),
					"). Verification corrected the original “O(n³)” claim to\nO(n log n) — the cost was wasted allocations + re-derivation, not algorithmic\nblowup."
				] }),
				" ",
				createVNode(_components.strong, { children: "Done" }),
				" ",
				createVNode($$PrLink, { pr: 1425 }),
				" — the memo now carries a\n",
				createVNode(_components.code, { children: "sameTerminalIdOrder" }),
				" ",
				createVNode(_components.code, { children: "equals" }),
				" gate, so it keeps the prior array whenever the\ntop-level id set is unchanged; the ",
				createVNode(_components.em, { children: "set-shaped" }),
				" re-run path now fires only on a\nreal add / remove / reorder, not on every metadata mutation. The accessor still\nre-runs cheaply; what it no longer does is ",
				createVNode(_components.em, { children: "notify" }),
				" downstream when the set is\nidentical. Proven by a re-run-count regression test\n(",
				createVNode(_components.code, { children: "useTerminalMetadata.test.ts" }),
				").",
				createVNode($$Footnote, { children: [
					createVNode(_components.code, { children: "displayInfos" }),
					" keeps a second,\nfield-level subscription to ",
					createVNode(_components.code, { children: "git" }),
					" / ",
					createVNode(_components.code, { children: "cwd" }),
					" / ",
					createVNode(_components.code, { children: "parentId" }),
					" inside its own scope;\nbecause the surface store writes via ",
					createVNode(_components.code, { children: "reconcile" }),
					", PR / agent / foreground churn\nnever reached it even before this gate, and a real display-identity change still\nre-runs it, correctly. The gate closes the ",
					createVNode(_components.em, { children: "set-reference" }),
					" path; the field-level\npath is already as narrow as it should be."
				] })
			] })
		}),
		"\n",
		createVNode($$Finding, {
			sev: "low",
			id: "n-displayinfo-no-live-record",
			title: "Corollary — the display-info snapshot must carry NO live record — ✓ fixed",
			children: createVNode(_components.p, { children: [
				"The keystone win has a sharp edge worth stating on its own, so a future change\ndoesn’t re-introduce it: ",
				createVNode(_components.strong, { children: "precisely because" }),
				" PR / agent / foreground churn\nnever re-runs ",
				createVNode(_components.code, { children: "displayInfos" }),
				", anything ",
				createVNode(_components.em, { children: "live" }),
				" carried in its ",
				createVNode(_components.strong, { children: "output" }),
				" silently\ngoes stale. ",
				createVNode(_components.code, { children: "TerminalDisplayInfo" }),
				" used to bundle the whole ",
				createVNode(_components.code, { children: "TerminalMetadata" }),
				",\nso a consumer reading ",
				createVNode(_components.code, { children: "getDisplayInfo(id).meta.pr" }),
				" off that snapshot saw a value\nfrozen at the last ",
				createVNode(_components.code, { children: "git" }),
				" / ",
				createVNode(_components.code, { children: "cwd" }),
				" / membership change — the canvas tile title bar\nlagged the dock on PR resolution (the dock reads the live ",
				createVNode(_components.code, { children: "getMetadata(id)" }),
				"\nproxy; the header read the snapshot). This is the ",
				createVNode(_components.em, { children: "reactively-correct" }),
				" shape: a\nmemo hands out only what it invalidates on. ",
				createVNode(_components.strong, { children: "Fixed" }),
				" ",
				createVNode($$PrLink, { pr: 1897 }),
				" —\n",
				createVNode(_components.code, { children: "meta" }),
				" is removed from ",
				createVNode(_components.code, { children: "TerminalDisplayInfo" }),
				" entirely, so every live fact (pr / agent / foreground /\nintent / git) now reads from ",
				createVNode(_components.code, { children: "getMetadata(id)" }),
				" — the fine-grained store proxy —\nat each consumer’s own leaf, and the header tracks the same leaf the dock does. A\n",
				createVNode(_components.code, { children: "terminalDisplay.test.ts" }),
				" guard asserts the display info can never again carry a\nrecord; the memo keeps only colors, the identity key, and sub-count."
			] })
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode("span", { id: "n-getsubterminalids" }),
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "getSubTerminalIds" }), " O(n) scan, called per top-level terminal"] }),
				" inside the display derivation → O(n²) per metadata update (",
				createVNode(_components.code, { children: "useTerminalMetadata.ts:54-56" }),
				", ",
				createVNode(_components.code, { children: "terminalDisplay.ts:80" }),
				"). A ",
				createVNode(_components.code, { children: "Map<ParentId, TerminalId[]>" }),
				" index built in the same memo replaces the repeated full scans with one O(n) pass — a ",
				createVNode(_components.em, { children: "better-algorithm" }),
				" N cut. ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "terminalLabel" }),
					" O(n) ",
					createVNode(_components.code, { children: "indexOf" }),
					" per access"
				] }),
				" (",
				createVNode(_components.code, { children: "useTerminalMetadata.ts:94-96" }),
				") — real, but only 2 call sites, both at event boundaries; a precomputed id→position map (derived alongside the group-by index above) collapses it to O(1). Bundle it with that index work, don’t chase it alone. ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Per-tile geometry arithmetic" }),
				" (",
				createVNode(_components.code, { children: "onScreen" }),
				", ",
				createVNode(_components.code, { children: "tileTransformCSS" }),
				" in ",
				createVNode(_components.code, { children: "CanvasTile.tsx:114-130" }),
				") recomputes per pan/zoom frame — but the big win (not ",
				createVNode(_components.em, { children: "mounting" }),
				" off-screen auras) already shipped; the residual ~4 ops/tile/rAF is the arithmetic pan/zoom genuinely changes each frame, likely below noise. ",
				createVNode(_components.em, { children: "Remaining within" }),
				" the canvas work. ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Finding, {
			sev: "medium",
			id: "n-markdown-toggle",
			title: "Markdown preview render cost — the resolver 'fix' was a no-op; the toggle remount was real — ✓ shipped",
			children: createVNode(_components.p, { children: [
				"The original claim — ",
				createVNode(_components.em, { children: [
					createVNode(_components.code, { children: "BrowseFileDispatcher" }),
					" passes ",
					createVNode(_components.code, { children: "resolveImageSrc" }),
					" as an inline\narrow, so ",
					createVNode(_components.code, { children: "Markdown" }),
					"’s memo re-runs"
				] }),
				" — is a ",
				createVNode(_components.strong, { children: "measured no-op" }),
				" (stabilizing the\nreference eliminates ",
				createVNode(_components.strong, { children: "zero" }),
				" ",
				createVNode(_components.code, { children: "sanitizeHtml" }),
				" runs; the inline-arrow prop is static\nto the Solid compiler, never a reactive dependency). ",
				createVNode(_components.strong, { children: "The real cost the\nreproduction surfaced — now fixed:" }),
				" ",
				createVNode(_components.code, { children: "active()" }),
				" returned only the active branch,\nso a Source⇄Rendered ",
				createVNode(_components.strong, { children: "toggle remounted and re-sanitized the whole doc" }),
				" (a\n50-image doc: ~50 image-resolutions + a full parse/sanitize/highlight/DOM-reparse\n",
				createVNode(_components.em, { children: "per toggle" }),
				"). ",
				createVNode(_components.strong, { children: "Fixed" }),
				" ",
				createVNode($$PrLink, { pr: 1446 }),
				" — ",
				createVNode(_components.code, { children: "FileView" }),
				" now keeps both toggle\nmodes alive (the #818 ",
				createVNode(_components.code, { children: "RightPanel" }),
				" keep-alive pattern), so a flip is a visibility\nchange, not a remount; the pipeline runs ",
				createVNode(_components.strong, { children: "0× per toggle" }),
				" — a textbook\n",
				createVNode(_components.em, { children: "pre-compute + reuse" }),
				". Proven by an e2e. Full write-up + reproduction:\n",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/blob/master/docs/perf-investigations/markdown-image-resolver-and-toggle.md",
					children: "markdown-image-resolver-and-toggle"
				}),
				"."
			] })
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "sanitizeHtml" }), " does 6 sequential full-tree walks per parse"] }),
				" (",
				createVNode(_components.code, { children: "sanitize.ts:359-410" }),
				") — six ",
				createVNode(_components.code, { children: "querySelectorAll" }),
				" passes (anchors, inputs, pre, img, ",
				createVNode(_components.code, { children: "[id]" }),
				", ",
				createVNode(_components.code, { children: "a[href^=#]" }),
				") each re-traverse the whole DOM; fusing them into one traversal that dispatches per node visits each node once instead of six times (",
				createVNode(_components.em, { children: "find common work" }),
				"). Memo-gated on content, so it only bites very large documents. ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "File-search ancestor recompute per keystroke" }),
				" (",
				createVNode(_components.code, { children: "fileSearch.ts:50-62" }),
				") — ",
				createVNode(_components.code, { children: "ancestorDirectoryPaths" }),
				" (and the per-path normalization) re-derives over a stable tree on every keystroke; a path-keyed module-level memo reuses it (",
				createVNode(_components.em, { children: "pre-compute + reuse" }),
				"). Measured at 0.076 ms/200 calls, below perception — cheap insurance, not urgent. ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Finding, {
			sev: "medium",
			title: "Lazy-load the Code tab — measured (171 kB gzip), deferred — N (skip) + U (time-shift)",
			children: createVNode(_components.p, { children: [
				"An A/B production build measured the Code-tab tree — ",
				createVNode(_components.code, { children: "@kolu/solid-pierre" }),
				"’s\n",
				createVNode(_components.code, { children: "FileTree" }),
				", the ",
				createVNode(_components.code, { children: "@kolu/solid-markdown" }),
				" renderer, the diff/source view wrappers,\nand the comment system — at ",
				createVNode(_components.strong, { children: "629 kB raw / 171 kB gzip (23%)" }),
				" of the eager\n",
				createVNode(_components.code, { children: "index" }),
				" chunk (a static import in ",
				createVNode(_components.code, { children: "RightPanel" }),
				"). Splitting it out ",
				createVNode(_components.strong, { children: "skips\nparsing+executing it entirely" }),
				" on mobile / collapsed-panel sessions (N: work\nnever done) and ",
				createVNode(_components.strong, { children: "time-shifts it async past first paint" }),
				" on the default desktop\ncase (U: moved off the first-paint window) — not any byte shrink. Lazy-loading\n",
				createVNode(_components.strong, { children: "works" }),
				" (built, review-clean, e2e 115/115) but is ",
				createVNode(_components.strong, { children: "deferred" }),
				": ",
				createVNode(_components.code, { children: "activeTab" }),
				"\n",
				createVNode(_components.strong, { children: ["defaults to ", createVNode(_components.code, { children: "code" })] }),
				" and the desktop panel opens by default, so on a typical\ndesktop session CodeTab loads anyway, just async — a faster-first-paint-vs-cold-\nflash trade whose perceptual net is the ",
				createVNode(_components.strong, { children: "untraced" }),
				" cold-start TTI. Two premises\nit refuted: Shiki grammars are ",
				createVNode(_components.em, { children: "already" }),
				" lazy, and ",
				createVNode(_components.code, { children: "ImageAddon" }),
				" ",
				createVNode(_components.strong, { children: "can’t" }),
				"\nlazy-on-first-use (it must precede the image escape sequence). Full write-up + the\nunblock path:\n",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/blob/master/docs/perf-investigations/bundle-codetab-lazyload.md",
					children: "bundle-codetab-lazyload"
				}),
				".\nNote the C sibling below: before deferring this 171 kB slice, ",
				createVNode(_components.em, { children: "compressing" }),
				" the\nwhole 2.56 MB bundle is a strictly larger, unconditional win."
			] })
		}),
		"\n",
		createVNode($$Finding, {
			sev: "medium",
			id: "n-heartbeat",
			title: "Heartbeat probe: reconnect-on-resume fixed; hidden-tab battery still open",
			children: [createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "createHeartbeat()" }),
				" runs ",
				createVNode(_components.code, { children: "system.live" }),
				" / ",
				createVNode(_components.code, { children: "identity.info()" }),
				" every 15s while the\nsocket is OPEN. Two distinct costs hid behind one finding, both N:"
			] }), createVNode(_components.ul, { children: [
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: ["Spurious reconnect on resume — FIXED ", createVNode($$PrLink, { pr: 1598 })] }),
					" (",
					createVNode(_components.em, { children: "eliminate\nretries" }),
					"). A laptop sleep / tab freeze paused the event loop; the probe’s 10s\ntimeout fired ",
					createVNode(_components.em, { children: "overdue" }),
					" on resume and forced a reconnect over a still-healthy\nsocket. The watchdog now compares elapsed wall time against elapsed monotonic\ntime across each probe and ",
					createVNode(_components.strong, { children: "voids-and-re-probes" }),
					" a window a suspension crossed,\nand a window-focus / tab-visible ",
					createVNode(_components.strong, { children: "wake" }),
					" event re-probes at once."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Hidden-tab radio wake — still open" }),
					" (",
					createVNode(_components.em, { children: "reduce round-trips" }),
					"). The probe still\nruns ≈240×/hour while backgrounded, forcing the mobile radio idle→active. The\ntempting fix — stop the interval while ",
					createVNode(_components.code, { children: "document.visibilityState === 'hidden'" }),
					" —\nis a ",
					createVNode(_components.strong, { children: "coverage regression" }),
					": a hidden tab is still ",
					createVNode(_components.em, { children: "running" }),
					", so gating the\nprobe blinds the watchdog to a genuine half-open during a long background. A\nbattery fix must ",
					createVNode(_components.strong, { children: "lengthen" }),
					" the hidden-tab interval (30–60s), not stop it.\n",
					createVNode(_components.strong, { children: "Measure:" }),
					" packet-capture probes/hour backgrounded on a real phone — target\nunder ~10, vs ~240 today."
				] }),
				"\n"
			] })]
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Every-minute staleness ticker fires globally" }),
				" regardless of visibility (",
				createVNode(_components.code, { children: "terminal/staleness.ts:26-57" }),
				") — gate the shared 60s ",
				createVNode(_components.code, { children: "setNow" }),
				" tick on ",
				createVNode(_components.code, { children: "visibilitychange" }),
				" (reuse the ",
				createVNode(_components.code, { children: "refitOnTabVisible" }),
				" pattern); its re-bucketing is invisible while the tab is hidden (",
				createVNode(_components.em, { children: "remove dead work" }),
				"). ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A second, ungated 1s clock tick" }),
				" drives the uptime / “Running for” / heap readouts (",
				createVNode(_components.code, { children: "time/clock.ts:24" }),
				") with no ",
				createVNode(_components.code, { children: "visibilitychange" }),
				" gate — the same family as the 60s staleness ticker, firing ",
				createVNode(_components.strong, { children: "60× more often" }),
				". Its comment assumes a hidden tab self-throttles to ~1/min, but kolu holds an always-open surface WebSocket, which can exempt the page from Chrome’s background-timer throttling — so backgrounded it may keep waking a phone. Gate it on visibility like the ticker (the readouts it feeds are invisible while hidden). ",
				createVNode(_components.em, { children: "New this pass; low, unmeasured — the same on-device caveat as the rest of this cluster." }),
				" ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"N per-terminal ",
					createVNode(_components.code, { children: "visibilitychange" }),
					" listeners"
				] }),
				" for re-fit (",
				createVNode(_components.code, { children: "refitOnTabVisible.ts" }),
				") — collapse to one shared App-root listener fanning out to a Set of ",
				createVNode(_components.code, { children: "debouncedFit" }),
				" callbacks (",
				createVNode(_components.em, { children: "find common work" }),
				" — N redundant registrations on one document event). ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "useCollection" }), " subscribes to all keys"] }),
				" even if one is consumed (",
				createVNode(_components.code, { children: "useTerminalMetadata.ts:34" }),
				") — bounded, since rendered terminals genuinely need metadata; lazily subscribing only visible terminals removes standing streams never read, worth it only in 50+ terminal workspaces with most invisible (",
				createVNode(_components.em, { children: "lazy evaluation" }),
				"). ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Three parallel git-status subscriptions per Code tab" }),
				" (",
				createVNode(_components.code, { children: "CodeTab.tsx:314-349" }),
				") — real duplication (",
				createVNode(_components.code, { children: "localStatus" }),
				" and ",
				createVNode(_components.code, { children: "activeStatus" }),
				" even collide on identical ",
				createVNode(_components.code, { children: "{mode:'local'}" }),
				" input), but ",
				createVNode(_components.strong, { children: "documented as load-bearing" }),
				" (the passive subs swallow ",
				createVNode(_components.code, { children: "BASE_BRANCH_NOT_FOUND" }),
				" while the active one revives after fetch). Do not coalesce blindly. ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode("span", { id: "n-nix-hash" }),
				createVNode(_components.strong, { children: [
					"One-shot Nix ",
					createVNode(_components.code, { children: "pnpmDeps" }),
					" hash check"
				] }),
				" — ",
				createVNode(_components.code, { children: "ci::pnpm-hash-fresh" }),
				" runs ",
				createVNode(_components.strong, { children: [
					"two sequential ",
					createVNode(_components.code, { children: "nix build" }),
					"s"
				] }),
				" (the second ",
				createVNode(_components.code, { children: "--rebuild" }),
				"), so ",
				createVNode(_components.code, { children: "pnpm install" }),
				" runs fully twice — measured at ",
				createVNode(_components.strong, { children: "2m45s on darwin / 25s on linux" }),
				" (",
				createVNode(_components.code, { children: "ci/mod.just:82-84" }),
				", ",
				createVNode(_components.code, { children: "default.nix:154-159" }),
				"). Compute the hash once into a temp derivation, then compare in a pure eval step (",
				createVNode(_components.em, { children: "remove the redundant double-fetch" }),
				"). ",
				createVNode($$Pill, {
					variant: "md",
					children: "med"
				})
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "c--make-each-thing-cheaper",
			children: "C — Make each thing cheaper"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"C is dominated by ",
			createVNode(_components.strong, { children: "distance" }),
			" — bytes over the wire, layers of indirection — and\nits marquee item is now ",
			createVNode(_components.strong, { children: "banked" }),
			": the client bundle, which shipped uncompressed,\nis now served ",
			createVNode(_components.code, { children: ".br" }),
			"/",
			createVNode(_components.code, { children: ".gz" }),
			" — a 4.6× cut on every cold load ",
			createVNode($$PrLink, { pr: 1643 }),
			". The\nrest is open wire work (payload shapes) plus one forced layout read."
		] }),
		"\n",
		createVNode($$Finding, {
			sev: "low",
			id: "c-compression",
			title: "Serve the client bundle compressed — ✓ shipped (2.56 MB → 571 kB)",
			children: [createVNode(_components.p, { children: [
				"The production Hono server shipped the client build through ",
				createVNode(_components.code, { children: "@hono/node-server" }),
				"’s\n",
				createVNode(_components.code, { children: "serveStatic" }),
				" (",
				createVNode(_components.code, { children: "installFreshStatic" }),
				") with ",
				createVNode(_components.strong, { children: "no compression in the pipeline" }),
				", so\nthe ~",
				createVNode(_components.strong, { children: "2.56 MB" }),
				" eager ",
				createVNode(_components.code, { children: "index" }),
				" bundle went out with ",
				createVNode(_components.strong, { children: ["no ", createVNode(_components.code, { children: "Content-Encoding" })] }),
				" even\nthough every browser offers ",
				createVNode(_components.code, { children: "gzip, deflate, br" }),
				". Caching was already right, so it\nonly bit the ",
				createVNode(_components.strong, { children: "cold load" }),
				" — but that’s exactly the ",
				createVNode(_components.strong, { children: "remote / Tailscale / phone" }),
				"\npath kolu markets, where bytes over a slow radio dominate first\npaint.",
				createVNode($$Footnote, { children: [
					"Immutable hashed ",
					createVNode(_components.code, { children: "/assets/*" }),
					" with ",
					createVNode(_components.code, { children: "max-age" }),
					" a year, so the miss is\nfirst visit, cache-miss, and every post-deploy hash change."
				] }),
				" ",
				createVNode(_components.strong, { children: "Done" }),
				"\n",
				createVNode($$PrLink, { pr: 1643 }),
				" — the client Vite build now emits ",
				createVNode(_components.code, { children: ".br" }),
				"/",
				createVNode(_components.code, { children: ".gz" }),
				" siblings for the\nimmutable ",
				createVNode(_components.code, { children: "/assets/*" }),
				" at build time (brotli q11), and ",
				createVNode(_components.code, { children: "installFreshStatic" }),
				" turns on\nserve-static’s ",
				createVNode(_components.code, { children: "precompressed" }),
				", which negotiates ",
				createVNode(_components.code, { children: "Accept-Encoding" }),
				" and serves the\nsibling at ",
				createVNode(_components.strong, { children: "zero per-request CPU" }),
				" — the compression ",
				createVNode(_components.em, { children: "time-shifted" }),
				" to build, a U\n“pre-compute in idle” move on top of the C byte cut."
			] }), createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "Measured on the main chunk: 2.56 MB → 571 kB brotli (4.58×) / 726 kB gzip" }),
				" —\nbeating the ~700 kB the map first estimated.",
				createVNode($$Footnote, { children: [
					"The ",
					createVNode(_components.code, { children: "no-store" }),
					" shell\n(",
					createVNode(_components.code, { children: "index.html" }),
					") is deliberately left ",
					createVNode(_components.strong, { children: "uncompressed" }),
					": its commit stamp is seded\npost-build (kolu#1319), so a compressed shell would strand a returning browser on a\nstale stamp — the build emits siblings for ",
					createVNode(_components.code, { children: "/assets/*" }),
					" only. A per-request\n",
					createVNode(_components.code, { children: "compress" }),
					" middleware was the rejected alternative (per-request CPU vs build-time\nzero)."
				] }),
				" This was row 1 and the only item on the map ",
				createVNode(_components.strong, { children: "not bounded at\ntoday’s scale" }),
				" — it fires on every cold load — and it settled the Code-tab\nlazy-load debate: compressing ships ~2 MB less on the ",
				createVNode(_components.em, { children: "whole" }),
				" eager load,\nunconditionally, dwarfing that deferred 171 kB slice. Covered by an\n",
				createVNode(_components.code, { children: "installFreshStatic" }),
				" negotiation test; the remaining trace is on-device cold-start\nLCP over Tailscale (see ",
				createVNode(_components.a, {
					href: "#from-static-reads-to-live-traces",
					children: "coverage gaps"
				}),
				")."
			] })]
		}),
		"\n",
		createVNode($$Finding, {
			sev: "medium",
			title: "Publish per-key collection deltas, not the full key set — C (payload) + N (client work)",
			children: createVNode(_components.p, { children: [
				"Every upsert/remove publishes the ",
				createVNode(_components.strong, { children: "entire" }),
				" key array via\n",
				createVNode(_components.code, { children: "keysBus.publish(Array.from(...))" }),
				" — a fresh object each time — which crosses the\nwire and triggers client ",
				createVNode(_components.code, { children: "mapArray" }),
				" reconciliation (",
				createVNode(_components.code, { children: "surface/server.ts:1218-1223" }),
				",\n",
				createVNode(_components.code, { children: "useCollection.ts:60-65" }),
				"). Publishing discriminated ",
				createVNode(_components.code, { children: "{added:[k]}/{changed:[k]}/{removed:[k]}" }),
				"\ndeltas (full set only on init) ",
				createVNode(_components.strong, { children: "shrinks the per-event payload/allocation (C)" }),
				"\nand lets ",
				createVNode(_components.code, { children: "useCollection" }),
				" apply the change instead of re-reconciling the whole key\nset (N). The batched machinery already exists (",
				createVNode(_components.code, { children: "deltasBus" }),
				" + ",
				createVNode(_components.code, { children: "createTickCoalescer" }),
				",\n",
				createVNode(_components.code, { children: "useCollectionDeltas" }),
				") but the ",
				createVNode(_components.code, { children: "useTerminalMetadata" }),
				" call sites pass explicit\n",
				createVNode(_components.code, { children: "keys" }),
				", which forces the per-key path regardless of the ",
				createVNode(_components.code, { children: "deltas" }),
				" verb — so\nrealizing this is a call-site change, not a one-line verb flip. ",
				createVNode(_components.strong, { children: "Measure:" }),
				"\n",
				createVNode(_components.code, { children: "keysBus" }),
				" publish frequency and payload sizes during terminal spawn/metadata\nchurn."
			] })
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode("span", { id: "c-metadata" }),
				createVNode(_components.strong, { children: "Full metadata object per live-field update" }),
				" (",
				createVNode(_components.code, { children: "terminalEndpoint/metadata.ts:96-136" }),
				") — ",
				createVNode(_components.code, { children: "publishAuthored" }),
				" upserts a full ",
				createVNode(_components.code, { children: "{...entry.meta}" }),
				" clone on every field change. Upstream dedup gates (",
				createVNode(_components.code, { children: "prResultEqual" }),
				", ",
				createVNode(_components.code, { children: "agentInfoEqual" }),
				") already cap the ",
				createVNode(_components.em, { children: "number" }),
				" of publishes to PR-poll 30s / screen-scrape 1s, so the remaining lever is ",
				createVNode(_components.em, { children: "payload size" }),
				" (C): splitting live vs persisted deltas. Lower priority. ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode("span", { id: "c-base64" }),
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "base64" }), " stdio framing adds ~33%"] }),
				" (",
				createVNode(_components.code, { children: "links/stdio-codec.ts:25-64" }),
				") — ",
				createVNode(_components.code, { children: "encodeFrame" }),
				" base64-encodes every peer message, a fixed 4/3 byte inflation; framing is already swappable, so a length-prefixed binary frame is the upgrade (",
				createVNode(_components.em, { children: "compact encoding" }),
				"), ",
				createVNode(_components.strong, { children: "gated on measured large-payload ops" }),
				" (git diff, ",
				createVNode(_components.code, { children: "fsListAll" }),
				"). ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode("span", { id: "c-taprect" }),
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "getBoundingClientRect" }), " per terminal tap"] }),
				" for link detection (",
				createVNode(_components.code, { children: "Terminal.tsx:572-591" }),
				") — guarded to genuine taps, but each forces a sync layout read; caching the rect against the ",
				createVNode(_components.code, { children: "ResizeObserver" }),
				" (",
				createVNode(_components.em, { children: "local caching" }),
				" — recompute only on real resize) removes the reflow. ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Eager per-terminal addons" }),
				" — ",
				createVNode(_components.code, { children: "Search" }),
				"/",
				createVNode(_components.code, { children: "Image" }),
				"/",
				createVNode(_components.code, { children: "Serialize" }),
				" are instantiated per terminal (",
				createVNode(_components.code, { children: "Terminal.tsx:490-510" }),
				") though conditional; dynamic-importing ",
				createVNode(_components.code, { children: "Serialize" }),
				"/",
				createVNode(_components.code, { children: "Search" }),
				" would defer bundle load (N) and stop per-mount allocation (C), but ",
				createVNode(_components.code, { children: "ImageAddon" }),
				" can’t defer and the survivors minify to ~10–15 kB gzip while adding async to the hot path. Low value. ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "u--use-the-capacity-you-have",
			children: "U — Use the capacity you have"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The thinnest lever, because a single-user desktop client has little idle capacity\nto reclaim — which is exactly why the one banked U win (off-thread diff\nhighlighting ",
			createVNode($$PrLink, { pr: 1363 }),
			") and most of what’s open live in the ",
			createVNode(_components.strong, { children: "dev-loop\nand the backend" }),
			", where cores and queues actually sit idle. The rule here is\n",
			createVNode(_components.em, { children: "don’t waste, don’t bottleneck, pre-compute in slack time" }),
			"."
		] }),
		"\n",
		createVNode($$Finding, {
			sev: "medium",
			id: "u-test-parallelism",
			title: "Parallelize tests across the workspace",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "pnpm -r" }),
				" serializes package test runs (no ",
				createVNode(_components.code, { children: "--workspace-concurrency" }),
				"), so on a\nmulti-core machine the ",
				createVNode(_components.strong, { children: "~44 packages run roughly one-at-a-time" }),
				" even though each\nvitest threads internally — workspace-level parallelism is unused\n(",
				createVNode(_components.code, { children: "package.json:7" }),
				"). Enabling workspace concurrency in the ",
				createVNode(_components.code, { children: "test:unit" }),
				" recipe fills\nidle cores (",
				createVNode(_components.em, { children: "parallelism / raise utilization" }),
				") without changing the tests run;\nconsider ",
				createVNode(_components.code, { children: "vitest --shard" }),
				" for the slowest packages (",
				createVNode(_components.code, { children: "git/index.test.ts" }),
				").\n",
				createVNode(_components.strong, { children: "Measure:" }),
				" ",
				createVNode(_components.code, { children: "just test-unit" }),
				" baseline vs ",
				createVNode(_components.code, { children: "--workspace-concurrency N" }),
				"."
			] })
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode("span", { id: "u-server-vitest" }),
				createVNode(_components.strong, { children: "Server unit tests run single-file" }),
				" — ",
				createVNode(_components.code, { children: "packages/server/package.json" }),
				" forces ",
				createVNode(_components.code, { children: "vitest --fileParallelism=false" }),
				" because all 16 server test files share one ",
				createVNode(_components.code, { children: "KOLU_STATE_DIR" }),
				" (keyed off the shell PID ",
				createVNode(_components.code, { children: "$$" }),
				", resolved once so every worker inherits the same path), and a module-level ",
				createVNode(_components.code, { children: "Conf" }),
				" singleton would collide across parallel forks. Key the state dir per ",
				createVNode(_components.code, { children: "VITEST_WORKER_ID" }),
				" (each fork a private dir) and drop the flag to run the files across cores — a ",
				createVNode(_components.em, { children: "within-package" }),
				" U win distinct from the cross-package item above (that fans out whole packages; this unblocks the slowest one). ",
				createVNode(_components.em, { children: [
					"New this pass; bounded by whether server is the unit-lane long pole (",
					createVNode(_components.code, { children: "git" }),
					" is named the slowest)."
				] }),
				" ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Finding, {
			sev: "low",
			id: "u-kaval-queues",
			title: "Bound subscriber queues by bytes, not just item count",
			children: createVNode(_components.p, { children: [
				"Each subscriber queue caps at ",
				createVNode(_components.code, { children: "maxQueue" }),
				" (10k ",
				createVNode(_components.em, { children: "items" }),
				") with no byte bound\n(",
				createVNode(_components.code, { children: "kaval/channel.ts:54-132" }),
				"), so a stalled subscriber on a 1 KB/event PTY could\npin ~10 MB before being dropped. Tracking queue byte size at publish and dropping\nwhen ",
				createVNode(_components.em, { children: "either" }),
				" item-count or a new ",
				createVNode(_components.code, { children: "maxQueueBytes" }),
				" is exceeded ",
				createVNode(_components.em, { children: "right-sizes" }),
				" the\ndrop threshold to actual heap. ",
				createVNode(_components.strong, { children: "Note:" }),
				" the ",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/issues/1420",
					children: "#1420"
				}),
				"\nRCA rules this out as the production OOM source — this is a known-constant memory\ncap, not the leak fix (which lives in scrollback/snapshot retention and needs a\ndedicated heap snapshot)."
			] })
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"No backpressure / drop-visibility on ",
					createVNode(_components.code, { children: "proc.onData" }),
					" fan-out"
				] }),
				" (",
				createVNode(_components.code, { children: "ptyHost.ts:544-548" }),
				") — ",
				createVNode(_components.code, { children: "publish()" }),
				" is fire-and-forget; wiring the unused ",
				createVNode(_components.code, { children: "onOverflow" }),
				" hook into a dropped-subscriber counter surfaces ",
				createVNode(_components.em, { children: "when" }),
				" the fan-out sheds load, the measurement needed to balance producer/consumer capacity. (The original “O(N) push” claim was wrong — ",
				createVNode(_components.code, { children: "push" }),
				" is O(1).) ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Exit-code tombstones FIFO-evicted, no TTL" }),
				" (",
				createVNode(_components.code, { children: "ptyHost.ts:39-42" }),
				") — an intentional bounded reuse-cache (1024 entries, FIFO); a missing tombstone falls back harmlessly to ",
				createVNode(_components.code, { children: "0" }),
				". Add a TTL only if measurement shows time-based eviction ",
				createVNode(_components.em, { children: "right-sizes" }),
				" retention better than count-based. ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "useComments" }),
					" ",
					createVNode(_components.code, { children: "persistedPref" }),
					" hand-rolls a per-",
					createVNode(_components.code, { children: "terminalId" }),
					" signal"
				] }),
				" (",
				createVNode(_components.code, { children: "useComments.ts:36-83" }),
				") — consumers wrap it in ",
				createVNode(_components.code, { children: "createMemo" }),
				" so owners ",
				createVNode(_components.em, { children: "do" }),
				" auto-dispose (the leak claim was overstated), but moving to ",
				createVNode(_components.code, { children: "makePersisted" }),
				" from ",
				createVNode(_components.code, { children: "@solid-primitives" }),
				" would make owner cleanup automatic (",
				createVNode(_components.em, { children: "don’t waste retained capacity" }),
				"). Marginal. ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "WebGL cap oversized for phones" }),
				" — ",
				createVNode(_components.code, { children: "WEBGL_CONTEXT_CAP=12" }),
				" suits desktop; mobile shows 1–2 tiles. Largely mitigated (",
				createVNode(_components.code, { children: "Terminal.tsx:185-196" }),
				" requires ",
				createVNode(_components.code, { children: "visible && holdsWebgl" }),
				"), but a layout-specific budget (1 on phone) would ",
				createVNode(_components.em, { children: "right-size" }),
				" held VRAM tighter. ",
				createVNode(_components.em, { children: "Remaining within" }),
				" ",
				createVNode($$Issue, { n: 1399 }),
				". ",
				createVNode($$Pill, {
					variant: "lo",
					children: "low"
				})
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "from-static-reads-to-live-traces",
			children: "From static reads to live traces"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Every finding above is a ",
			createVNode(_components.strong, { children: "static code read" }),
			". Verification corrected several\noverstated claims (no “high” survived; “O(n³)” was O(n log n); a “100–400 KB”\nsnapshot was ~4 MB, not ~4 KB) precisely because nobody had a number. The next\nround moves from reading to ",
			createVNode(_components.strong, { children: "measuring" }),
			" — the gaps this map does ",
			createVNode(_components.em, { children: "not" }),
			" yet rest\non:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Compression’s byte cut is measured; the on-device time isn’t." }),
				" The build cut is banked — the main chunk went 2.56 MB → 571 kB brotli (4.6×) ",
				createVNode($$PrLink, { pr: 1643 }),
				". What’s still untraced is the ",
				createVNode(_components.em, { children: "perceptual" }),
				" win: cold-start LCP/INP on a real phone over Tailscale, before/after."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "No live client trace." }), " Capture LCP/INP/CLS and a flame chart of a real 20+ terminal session (chrome-devtools) to confirm which N-lever items actually surface — this gates the open reactivity/wire items (the keystone shipped, proven by a deterministic re-run-count test rather than a trace; the markdown toggle re-sanitize shipped, proven by an e2e)."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The two new candidates rest on mechanism, not measurement." }),
				" The ungated 1s ",
				createVNode(_components.code, { children: "clock.ts" }),
				" tick leans on unverified WebSocket-exempts-throttling browser behavior; the server vitest parallelism win is bounded by whether server is the unit-lane long pole. Both are code-confirmed and correctly levered, both unmeasured."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The #1420 OOM root cause is still unidentified." }), " The Channel-queue RCA ruled itself out; a dedicated kaval heap snapshot needs to find the real scrollback/snapshot retention path."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Mobile rests on mechanism, not on-device traces." }), " Battery wake-ups (15s heartbeat, 60s + 1s tickers), GPU memory across swipes, and keystroke-to-paint on low-end Android are all unmeasured."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Wire payloads are uncounted." }), " No captured byte sizes for full-key-set / full-object publishes or base64 framing across representative repos."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Server CPU under load" }), " (git-status polling, 1s agent screen-scrape, PR polling) hasn’t been profiled in aggregate, only mechanism-by-mechanism."] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "How this note lives",
			children: createVNode(_components.p, { children: [
				"Items advance by ",
				createVNode(_components.strong, { children: "measurement, then merge" }),
				". When a trace confirms one, link the\nprofiling note and the PR (",
				createVNode(_components.code, { children: "<PrLink pr={N} />" }),
				"), flip its line to ✓, and move it to\n",
				createVNode(_components.em, { children: "Already banked" }),
				" under the lever it pulled. When a trace ",
				createVNode(_components.em, { children: "refutes" }),
				" one (this repo’s\nspecialty — see ",
				createVNode(_components.code, { children: "dock-and-eventloop-1308" }),
				"), record the negative here too: a\nfaithfully-reproduced negative is as load-bearing as a fix. The map shrinks from\nthe top."
			] })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Performance — Where Kolu Can Get Faster",
	"description": "A living tuning map of the Kolu monorepo, read through the N/C/U performance model — do fewer things (N), make each thing cheaper (C), use idle capacity (U). Built from a 77-agent survey and adversarial verification, it files every shipped win and open opportunity under the lever it pulls, so we keep Kolu nimble and fast, by measurement, over time.",
	"parents": ["analysis"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-01T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-ncu-model",
			"text": "The N/C/U model"
		},
		{
			"depth": 2,
			"slug": "the-backlog",
			"text": "The backlog"
		},
		{
			"depth": 3,
			"slug": "already-banked",
			"text": "Already banked"
		},
		{
			"depth": 2,
			"slug": "n--do-fewer-things",
			"text": "N — Do fewer things"
		},
		{
			"depth": 2,
			"slug": "c--make-each-thing-cheaper",
			"text": "C — Make each thing cheaper"
		},
		{
			"depth": 2,
			"slug": "u--use-the-capacity-you-have",
			"text": "U — Use the capacity you have"
		},
		{
			"depth": 2,
			"slug": "from-static-reads-to-live-traces",
			"text": "From static reads to live traces"
		}
	];
}
var url = "src/content/atlas/performance.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/performance.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/performance.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, NcuLevers, file, frontmatter, getHeadings, url };
