import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
//#region src/content/atlas/mobile-architecture-review.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		blockquote: "blockquote",
		code: "code",
		defs: "defs",
		em: "em",
		h2: "h2",
		hr: "hr",
		li: "li",
		ol: "ol",
		p: "p",
		strong: "strong",
		table: "table",
		tbody: "tbody",
		td: "td",
		th: "th",
		thead: "thead",
		title: "title",
		tr: "tr",
		ul: "ul"
	}, props.components);
	const { Fragment: Fragment$1 } = _components;
	if (!Fragment$1) _missingMdxReference("Fragment", true);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"An adversarially-verified read of kolu’s mobile support through two lenses: Rich\nHickey’s ",
			createVNode(_components.em, { children: "Simple Made Easy" }),
			" (is mobile ",
			createVNode(_components.em, { children: "complected" }),
			" through the app?) and Juval\nLowy’s volatility-based decomposition (is mobile an ",
			createVNode(_components.em, { children: "encapsulated" }),
			" change, or\nsmeared across every consumer?)."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Verdict — half-electricity",
			children: createVNode(_components.p, { children: "Two outlets are wired to spec — the rest of the app clips bare leads onto the\nmains. Scope ~11 files · 18 signal reads · 5 mobile components. Method: 24 agents\n— map ▸ dual-lens ▸ verify ▸ synthesize; 16 claims re-checked vs source." })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Update — the four receptacles shipped",
			children: createVNode(_components.p, { children: [
				createVNode($$PrLink, { pr: 1088 }),
				" (merged 2026-06-01) implemented all four §⑦ recommendations:\nthe breakpoint is unified via the ",
				createVNode(_components.code, { children: "--breakpoint-sm" }),
				" theme token, ",
				createVNode(_components.code, { children: "openInCodeTab" }),
				"\ncalls ",
				createVNode(_components.code, { children: "rp.reveal()" }),
				", feature gates live in ",
				createVNode(_components.code, { children: "capabilities.ts" }),
				", and the\ncontenteditable surgery is extracted to ",
				createVNode(_components.code, { children: "enableSoftKeyboardInput()" }),
				". The circuit\ndiagram, scorecard, and §⑤/§⑧ below record the pre-#1088 wiring."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Update — the fork went three-state (compact)",
			children: createVNode(_components.p, { children: [
				createVNode($$PrLink, { pr: 1380 }),
				" gave the macro fork a third voltage. The boolean ",
				createVNode(_components.code, { children: "isMobile" }),
				"\n(viewport size alone) became ",
				createVNode(_components.code, { children: "layoutMode()" }),
				" — ",
				createVNode(_components.code, { children: "phone" }),
				" · ",
				createVNode(_components.code, { children: "compact" }),
				" · ",
				createVNode(_components.code, { children: "desktop" }),
				" — so\na ",
				createVNode(_components.em, { children: "wide but finger-only" }),
				" device no longer crosses the width line into the\nmouse-driven desktop canvas. A Z Fold 6 unfolded is ~900 CSS px (past ",
				createVNode(_components.code, { children: "sm" }),
				") yet is\ntouch-only (",
				createVNode(_components.code, { children: "(pointer: coarse) and (hover: none)" }),
				"); width alone mis-mounted the\ndesktop layout on it. Now width still picks ",
				createVNode(_components.code, { children: "phone" }),
				" below ",
				createVNode(_components.code, { children: "sm" }),
				", but above it the\n",
				createVNode(_components.strong, { children: "pointer" }),
				" axis splits a handheld (",
				createVNode(_components.code, { children: "compact" }),
				" — a two-pane rail + tile via\n",
				createVNode(_components.code, { children: "CompactTileView" }),
				", the ",
				createVNode(_components.code, { children: "DockList" }),
				" shared with the phone drawer) from a real\npointer (",
				createVNode(_components.code, { children: "desktop" }),
				"). The ",
				createVNode(_components.code, { children: "capabilities.ts" }),
				" gates read ",
				createVNode(_components.code, { children: "isDesktop()" }),
				"; ",
				createVNode(_components.code, { children: "reveal()" }),
				"\nand the Code-tab touch-scroll driver read ",
				createVNode(_components.code, { children: "!isDesktop()" }),
				", so phone and compact\nshare the drawer-hosted panel. The circuit diagram, scorecard, and §②/§⑤ below\nrecord the pre-#1380 two-state fork (",
				createVNode(_components.code, { children: "match(isMobile())" }),
				")."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "-the-analogy--lowys-receptacle",
			children: "① The analogy — Lowy’s receptacle"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Lowy uses household power to argue you decompose by what ",
			createVNode(_components.em, { children: "changes" }),
			", not what it\n",
			createVNode(_components.em, { children: "does" }),
			":"
		] }),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: ["“Power in a house is highly volatile: AC or DC; 110 or 220 volts; 50 or 60 hertz; solar, generator, or grid. All that volatility is encapsulated behind a receptacle. When it is time to consume power, all the user sees is an opaque receptacle.” — Juval Lowy, ", createVNode(_components.em, { children: "Righting Software" })] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The toaster never exposes the wires or measures the frequency — it ",
			createVNode(_components.em, { children: "plugs in" }),
			".\nEvery appliance carrying its own voltmeter and deciding what to do with the raw\nmains is what Lowy calls ",
			createVNode(_components.strong, { children: "functional decomposition" }),
			" and Hickey calls\n",
			createVNode(_components.strong, { children: "complecting" }),
			". So the question is precise: ",
			createVNode(_components.strong, { children: [
				"does feature code plug into a\nstable interface that already resolved “where am I running,” or does each\nconsumer measure the voltage (",
				createVNode(_components.code, { children: "isMobile()" }),
				") and branch itself?"
			] }),
			" The answer for\nkolu: ",
			createVNode(_components.em, { children: "two outlets, one good extension cord, and a lot of bare wire." })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "-the-circuit-as-wired-today",
			children: "② The circuit as wired today"
		}),
		"\n",
		createVNode(_components.p, { children: "One source, two voltages, two clean outlets — then exposed mains:" }),
		"\n",
		createVNode("div", {
			role: "img",
			"aria-label": "Circuit diagram of kolu mobile wiring — one source, two receptacles, and the bare-mains consumers",
			style: {
				background: "#0e121a",
				border: "1px solid var(--rule)",
				borderRadius: "10px",
				padding: "1rem",
				margin: "1.2rem 0",
				overflowX: "auto"
			},
			children: createVNode("svg", {
				viewBox: "0 0 980 430",
				xmlns: "http://www.w3.org/2000/svg",
				fontFamily: "ui-monospace, monospace",
				style: {
					width: "100%",
					height: "auto",
					minWidth: "640px"
				},
				children: [
					createVNode(_components.title, { children: "kolu mobile wiring — one source, two receptacles, and the bare-mains consumers" }),
					createVNode(_components.defs, { children: [createVNode("marker", {
						id: "arrow",
						markerWidth: "9",
						markerHeight: "9",
						refX: "7",
						refY: "4.5",
						orient: "auto",
						children: createVNode("path", {
							d: "M0,0 L9,4.5 L0,9 z",
							fill: "#7c8aa3"
						})
					}), createVNode("marker", {
						id: "arrowL",
						markerWidth: "9",
						markerHeight: "9",
						refX: "7",
						refY: "4.5",
						orient: "auto",
						children: createVNode("path", {
							d: "M0,0 L9,4.5 L0,9 z",
							fill: "#e8a44c"
						})
					})] }),
					createVNode("rect", {
						x: "24",
						y: "170",
						width: "180",
						height: "92",
						rx: "10",
						fill: "#141a26",
						stroke: "#2f3b51"
					}),
					createVNode("text", {
						x: "114",
						y: "196",
						fill: "#e7ecf3",
						fontSize: "13",
						fontWeight: "700",
						textAnchor: "middle",
						children: "useMobile.ts"
					}),
					createVNode("text", {
						x: "114",
						y: "220",
						fill: "#4cc4a3",
						fontSize: "11.5",
						textAnchor: "middle",
						children: "isMobile · 639px"
					}),
					createVNode("text", {
						x: "114",
						y: "238",
						fill: "#6aa8ff",
						fontSize: "11.5",
						textAnchor: "middle",
						children: "isTouch · coarse"
					}),
					createVNode("text", {
						x: "114",
						y: "158",
						fill: "#7c8aa3",
						fontSize: "10.5",
						textAnchor: "middle",
						children: "⚡ THE SOURCE (two circuits)"
					}),
					createVNode("line", {
						x1: "204",
						y1: "200",
						x2: "330",
						y2: "120",
						stroke: "#4cc4a3",
						strokeWidth: "2.5",
						markerEnd: "url(#arrow)"
					}),
					createVNode("rect", {
						x: "332",
						y: "78",
						width: "220",
						height: "86",
						rx: "10",
						fill: "#141a26",
						stroke: "#4cc4a3"
					}),
					createVNode("text", {
						x: "442",
						y: "104",
						fill: "#8fe3cd",
						fontSize: "12.5",
						fontWeight: "700",
						textAnchor: "middle",
						children: "OUTLET ✓ App.tsx:546"
					}),
					createVNode("text", {
						x: "442",
						y: "124",
						fill: "#b4c0d4",
						fontSize: "11",
						textAnchor: "middle",
						children: "match(isMobile())"
					}),
					createVNode("text", {
						x: "442",
						y: "142",
						fill: "#7c8aa3",
						fontSize: "10.5",
						textAnchor: "middle",
						children: "→ MobileTileView | TerminalCanvas"
					}),
					createVNode("text", {
						x: "442",
						y: "158",
						fill: "#7c8aa3",
						fontSize: "10",
						textAnchor: "middle",
						children: "leaves plug in blind · no per-leaf if"
					}),
					createVNode("line", {
						x1: "204",
						y1: "216",
						x2: "330",
						y2: "216",
						stroke: "#4cc4a3",
						strokeWidth: "2.5",
						markerEnd: "url(#arrow)"
					}),
					createVNode("rect", {
						x: "332",
						y: "182",
						width: "220",
						height: "70",
						rx: "10",
						fill: "#141a26",
						stroke: "#4cc4a3"
					}),
					createVNode("text", {
						x: "442",
						y: "206",
						fill: "#8fe3cd",
						fontSize: "12.5",
						fontWeight: "700",
						textAnchor: "middle",
						children: "OUTLET ✓ withKeyboardDismiss"
					}),
					createVNode("text", {
						x: "442",
						y: "226",
						fill: "#7c8aa3",
						fontSize: "10.5",
						textAnchor: "middle",
						children: "isTouch guard lives inside"
					}),
					createVNode("text", {
						x: "442",
						y: "242",
						fill: "#7c8aa3",
						fontSize: "10.5",
						textAnchor: "middle",
						children: "4 drawers inject only their setter"
					}),
					createVNode("line", {
						x1: "204",
						y1: "240",
						x2: "330",
						y2: "320",
						stroke: "#e8a44c",
						strokeWidth: "2.5",
						markerEnd: "url(#arrowL)"
					}),
					createVNode("line", {
						x1: "552",
						y1: "320",
						x2: "610",
						y2: "320",
						stroke: "#e8a44c",
						strokeWidth: "2.5"
					}),
					createVNode("rect", {
						x: "332",
						y: "286",
						width: "220",
						height: "68",
						rx: "10",
						fill: "#1a1206",
						stroke: "#e8a44c",
						strokeDasharray: "5 4"
					}),
					createVNode("text", {
						x: "442",
						y: "312",
						fill: "#f0c48b",
						fontSize: "12.5",
						fontWeight: "700",
						textAnchor: "middle",
						children: "⚠ BARE MAINS"
					}),
					createVNode("text", {
						x: "442",
						y: "332",
						fill: "#b4c0d4",
						fontSize: "10.5",
						textAnchor: "middle",
						children: "raw isMobile() / isTouch() exported"
					}),
					createVNode("text", {
						x: "442",
						y: "348",
						fill: "#7c8aa3",
						fontSize: "10",
						textAnchor: "middle",
						children: "no posture / capability interface"
					}),
					createVNode("g", {
						fontSize: "10.5",
						children: [
							createVNode("rect", {
								x: "628",
								y: "270",
								width: "330",
								height: "146",
								rx: "10",
								fill: "#141a26",
								stroke: "#2f3b51"
							}),
							createVNode("text", {
								x: "644",
								y: "290",
								fill: "#7c8aa3",
								fontSize: "10",
								children: "~18 consumers each measure the voltage:"
							}),
							createVNode("text", {
								x: "644",
								y: "312",
								fill: "#f0c48b",
								children: "🔌 useTips.ts:65,73 — suppress tips ×2"
							}),
							createVNode("text", {
								x: "644",
								y: "330",
								fill: "#f0c48b",
								children: "🔌 commands.tsx:318 — erase canvas section"
							}),
							createVNode("text", {
								x: "644",
								y: "348",
								fill: "#f0c48b",
								children: "🔌 openInCodeTab.ts:76 — fork the intent"
							}),
							createVNode("text", {
								x: "644",
								y: "366",
								fill: "#f0c48b",
								children: "🔌 CodeTab.tsx:103/548 — density + scroll"
							}),
							createVNode("text", {
								x: "644",
								y: "384",
								fill: "#f0c48b",
								children: "🔌 App.tsx:194/225 — center / switcher"
							}),
							createVNode("text", {
								x: "644",
								y: "402",
								fill: "#ef6f6f",
								children: "🔌 Terminal.tsx:538 — contenteditable surgery"
							})
						]
					}),
					createVNode("line", {
						x1: "552",
						y1: "320",
						x2: "628",
						y2: "330",
						stroke: "#e8a44c",
						strokeWidth: "1.5",
						markerEnd: "url(#arrowL)"
					}),
					createVNode("rect", {
						x: "628",
						y: "78",
						width: "330",
						height: "120",
						rx: "10",
						fill: "#1a0e0e",
						stroke: "#ef6f6f",
						strokeDasharray: "5 4"
					}),
					createVNode("text", {
						x: "793",
						y: "102",
						fill: "#ef9a6f",
						fontSize: "12",
						fontWeight: "700",
						textAnchor: "middle",
						children: "⚡ VOLTAGE MISMATCH"
					}),
					createVNode("text", {
						x: "793",
						y: "128",
						fill: "#b4c0d4",
						fontSize: "11",
						textAnchor: "middle",
						children: "JS receptacle rated 639px"
					}),
					createVNode("text", {
						x: "793",
						y: "146",
						fill: "#b4c0d4",
						fontSize: "11",
						textAnchor: "middle",
						children: "CSS receptacle (Tailwind sm:) 640px"
					}),
					createVNode("text", {
						x: "793",
						y: "172",
						fill: "#7c8aa3",
						fontSize: "10",
						textAnchor: "middle",
						children: "639–640 band: JS says mobile,"
					}),
					createVNode("text", {
						x: "793",
						y: "187",
						fill: "#7c8aa3",
						fontSize: "10",
						textAnchor: "middle",
						children: "CSS says desktop. Comment misclaims “match”."
					})
				]
			})
		}),
		"\n",
		createVNode("div", {
			style: {
				display: "flex",
				flexWrap: "wrap",
				gap: "0.5rem 1.4rem",
				fontFamily: "var(--mono)",
				fontSize: "0.72rem",
				color: "var(--ink-muted)",
				margin: "0 0 0.4rem"
			},
			children: [
				createVNode("span", {
					style: {
						display: "inline-flex",
						alignItems: "center",
						gap: "0.45em"
					},
					children: [createVNode("i", { style: {
						width: "0.8em",
						height: "0.8em",
						border: "2px solid #4cc4a3",
						borderRadius: "2px",
						display: "inline-block"
					} }), "Encapsulated — appliance plugs in blind"]
				}),
				createVNode("span", {
					style: {
						display: "inline-flex",
						alignItems: "center",
						gap: "0.45em"
					},
					children: [createVNode("i", { style: {
						width: "0.8em",
						height: "0.8em",
						border: "2px solid #e8a44c",
						borderRadius: "2px",
						display: "inline-block"
					} }), "Bare mains — consumer measures the voltage"]
				}),
				createVNode("span", {
					style: {
						display: "inline-flex",
						alignItems: "center",
						gap: "0.45em"
					},
					children: [createVNode("i", { style: {
						width: "0.8em",
						height: "0.8em",
						border: "2px dashed #ef6f6f",
						borderRadius: "2px",
						display: "inline-block"
					} }), "Two voltages for one threshold"]
				})
			]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "-scorecard",
			children: "③ Scorecard"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Dimension" }),
					"\n",
					createVNode(_components.th, { children: "Grade" }),
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
					createVNode(_components.td, { children: "Single source of truth" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "C"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						"Each ",
						createVNode(_components.em, { children: "concept" }),
						" has one signal — but the breakpoint ",
						createVNode(_components.em, { children: "value" }),
						" was defined twice (JS 639px vs Tailwind ",
						createVNode(_components.code, { children: "sm:" }),
						" 640px); the comment misclaimed they match. ",
						createVNode($$Pill, {
							variant: "done",
							children: "fixed · #1088"
						}),
						" — the JS query now derives from the ",
						createVNode(_components.code, { children: "--breakpoint-sm" }),
						" token."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Encapsulation" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "C"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Two receptacles done right; ~18 consumers branch on the raw signal with no posture/capability layer." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Concept separation" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "good",
						children: "B"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "isMobile" }),
						" (size) and ",
						createVNode(_components.code, { children: "isTouch" }),
						" (modality) are orthogonal; ",
						createVNode(_components.code, { children: "useViewPosture" }),
						" refuses to fold mobile in."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "CSS vs JS discipline" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "bad",
						children: "D"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						"18 JS signal-reads vs 4 Tailwind classes, 0 custom ",
						createVNode(_components.code, { children: "@media" }),
						". CSS owns almost no structure."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Component duplication" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "good",
						children: "B"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						"Verification ",
						createVNode(_components.em, { children: "refuted" }),
						" the alarms: row/pip/metadata logic is already shared. Only reviewer-approved JSX shells diverge."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Consumer leakage" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "bad",
						children: "D"
					}) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "openInCodeTab" }), " forks intent inline; tips/commands/canvas each ask “am I mobile?”; the feature layer is functionally decomposed."] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "-whats-wired-right--the-parts-that-already-are-electricity",
			children: "④ What’s wired right — the parts that already are electricity"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "🔋 The two-axis split is a correct un-braiding",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "useMobile.ts" }),
				" ships ",
				createVNode(_components.em, { children: "two" }),
				" signals for two genuinely independent volatilities:\n",
				createVNode(_components.code, { children: "isMobile = (max-width: 639px)" }),
				" is form-factor; ",
				createVNode(_components.code, { children: "isTouch = (pointer: coarse)" }),
				" is\ninteraction model. A 1366px touch iPad resolves to ",
				createVNode(_components.code, { children: "isMobile()=false / isTouch()=true" }),
				" — desktop layout, soft-keyboard handling. ",
				createVNode($$Pill, {
					variant: "new",
					children: "Hickey: one fold"
				}),
				" ",
				createVNode($$Pill, {
					variant: "new",
					children: "Lowy: orthogonal"
				})
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "🔌 The top-level layout switch is a true receptacle",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "App.tsx:546" }),
				" routes the whole UI into two ",
				createVNode(_components.em, { children: "compositionally separate" }),
				" subtrees.\nLeaf components plug into one world and never measure voltage — ",
				createVNode(_components.code, { children: "MobileTileView" }),
				"’s\nswipe handlers carry ",
				createVNode(_components.em, { children: "no" }),
				" ",
				createVNode(_components.code, { children: "isTouch()" }),
				" guard because they aren’t mounted on the\ndesktop side; the minimap is absent from mobile ",
				createVNode(_components.em, { children: "by composition" }),
				", not per-component ",
				createVNode(_components.code, { children: "if" }),
				"."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "⭐ withKeyboardDismiss — the one feature-level receptacle done right",
			children: createVNode(_components.p, { children: [
				"The ",
				createVNode(_components.code, { children: "isTouch()" }),
				" guard lives ",
				createVNode(_components.em, { children: "inside" }),
				" the wrapper (",
				createVNode(_components.code, { children: "dismissSoftKeyboard.ts:33" }),
				"), so\nall four consumers plug in by injecting ",
				createVNode(_components.em, { children: "only their own open-state setter" }),
				".\n“Dismissing an overlay leaves the keyboard down” is ",
				createVNode(_components.strong, { children: "structural" }),
				", not a\nper-overlay convention a new drawer could forget. This is the shape\n",
				createVNode(_components.code, { children: "openInCodeTab" }),
				", ",
				createVNode(_components.code, { children: "useTips" }),
				", and the canvas gates are missing."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "🧭 useViewPosture refuses to fold mobile into canvas posture",
			children: createVNode(_components.p, { children: [
				"Its header is Hickey written in prose: ",
				createVNode(_components.em, { children: "“Mobile is a separate axis … different\nchange frequency, different reactivity source, different blast radius. kolu#628.”" }),
				"\nTwo things that change for different reasons are kept as two things."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "✅ Verification refuted the loudest duplication alarms",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "setActiveSilently" }),
				" ",
				createVNode(_components.em, { children: "is" }),
				" the bare ",
				createVNode(_components.code, { children: "setActiveId" }),
				" setter (used on desktop too);\ndock-row data, pips, sublines, intent markdown are already extracted into shared\nmodules consumed by both surfaces. Only JSX ",
				createVNode(_components.em, { children: "shells" }),
				" diverge — and ",
				createVNode(_components.code, { children: "Dock.tsx:386-391" }),
				"\nrecords two reviewers explicitly choosing that over a ",
				createVNode(_components.code, { children: "BaseRow" }),
				"."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "-where-the-leads-are-bare--five-leaks-that-survived-verification",
			children: "⑤ Where the leads are bare — five leaks that survived verification"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "⚡ Dual breakpoint — one threshold, two voltages",
			children: createVNode(_components.p, { children: [
				"JS query ",
				createVNode(_components.code, { children: "max-width:639px" }),
				" vs Tailwind ",
				createVNode(_components.code, { children: "sm:" }),
				" at ",
				createVNode(_components.code, { children: "min-width:640px" }),
				" (v4 default; no\n",
				createVNode(_components.code, { children: "tailwind.config" }),
				"). In the 639–640 band JS thinks mobile, CSS thinks desktop;\n",
				createVNode(_components.code, { children: "useMobile.ts" }),
				"’s comment claims it ",
				createVNode(_components.em, { children: "“Matches Tailwind’s sm: (640px)”" }),
				" —\ncontradicting its own query. Worse: ",
				createVNode(_components.code, { children: "ChromeBar" }),
				"’s ",
				createVNode(_components.code, { children: "hidden sm:flex" }),
				" is ",
				createVNode(_components.strong, { children: "dead" }),
				" at\nthat boundary because ",
				createVNode(_components.code, { children: "App.tsx:507" }),
				" unmounts the whole ",
				createVNode(_components.code, { children: "ChromeBar" }),
				" via ",
				createVNode(_components.code, { children: "isMobile()" }),
				".\nFixed in ",
				createVNode($$PrLink, { pr: 1088 }),
				" — ",
				createVNode(_components.code, { children: "useMobile.ts" }),
				" now reads Tailwind’s\n",
				createVNode(_components.code, { children: "--breakpoint-sm" }),
				" theme token and derives the JS query from it: one rating, no\ndesync band, and the comment is accurate.\n",
				createVNode($$Pill, {
					variant: "bad",
					children: "Verified · real"
				}),
				" ",
				createVNode($$Pill, {
					variant: "done",
					children: "fixed · #1088"
				})
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "⚡ openInCodeTab forks one intent into two state mutations inline",
			children: [
				createVNode(_components.p, { children: "The producer of a navigation intent measures the voltage itself:" }),
				createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// right-panel/openInCodeTab.ts:76-80 — inside batch()</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">rp.</span><span style=\"color:#6F42C1\">openCodeAt</span><span style=\"color:#24292E\">(req.targetMode);</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">if</span><span style=\"color:#24292E\"> (</span><span style=\"color:#6F42C1\">isMobile</span><span style=\"color:#24292E\">()) rp.</span><span style=\"color:#6F42C1\">setDrawerOpen</span><span style=\"color:#24292E\">(</span><span style=\"color:#005CC5\">true</span><span style=\"color:#24292E\">);        </span><span style=\"color:#6A737D\">// mobile mechanism</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">else</span><span style=\"color:#D73A49\"> if</span><span style=\"color:#24292E\"> (rp.</span><span style=\"color:#6F42C1\">collapsed</span><span style=\"color:#24292E\">()) rp.</span><span style=\"color:#6F42C1\">expandPanel</span><span style=\"color:#24292E\">();     </span><span style=\"color:#6A737D\">// desktop mechanism</span></span></code></pre>" }),
				createVNode(_components.p, { children: [
					"“Reveal the code view” is ",
					createVNode(_components.em, { children: "one" }),
					" concept; how it becomes visible is the host’s job.\n",
					createVNode(_components.code, { children: "useRightPanel" }),
					" already owns both mechanisms as separate volatilities — the\nnatural home for a single ",
					createVNode(_components.code, { children: "rp.reveal()" }),
					" that resolves posture internally.\nShipped in ",
					createVNode($$PrLink, { pr: 1088 }),
					" — ",
					createVNode(_components.code, { children: "openInCodeTab" }),
					" now calls ",
					createVNode(_components.code, { children: "rp.reveal()" }),
					", and\nthe verb resolves drawer-open vs uncollapse inside ",
					createVNode(_components.code, { children: "useRightPanel" }),
					".\n",
					createVNode($$Pill, {
						variant: "bad",
						children: "Verified · real"
					}),
					" ",
					createVNode($$Pill, {
						variant: "done",
						children: "fixed · #1088"
					})
				] })
			]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "⚡ Feature availability is functionally decomposed",
			children: createVNode(_components.p, { children: [
				"Tips, canvas commands, and palette gates each independently ask “am I mobile?”:\n",
				createVNode(_components.code, { children: "useTips.ts:65/73" }),
				", ",
				createVNode(_components.code, { children: "commands.tsx:318" }),
				" (",
				createVNode(_components.code, { children: "...(!deps.isMobile() ? […] : [])" }),
				"),\n",
				createVNode(_components.code, { children: "App.tsx:194/225" }),
				". These are ",
				createVNode(_components.strong, { children: "capability" }),
				" decisions spread across consumers as\nraw ",
				createVNode(_components.em, { children: "viewport" }),
				" checks — and several key off ",
				createVNode(_components.code, { children: "isMobile" }),
				" when “spatial canvas is\nunusable” is really a touch/pointer concern (the ",
				createVNode(_components.em, { children: "wrong axis" }),
				"). The leak is the\naggregate pattern, not any one guard. Resolved in ",
				createVNode($$PrLink, { pr: 1088 }),
				" —\n",
				createVNode(_components.code, { children: "capabilities.ts" }),
				" now provides the resolved seam (",
				createVNode(_components.code, { children: "supportsSpatialCanvas" }),
				",\n",
				createVNode(_components.code, { children: "showsAmbientTips" }),
				", …) and these consumers plug into it; the remaining raw\n",
				createVNode(_components.code, { children: "isMobile" }),
				" reads in ",
				createVNode(_components.code, { children: "App.tsx" }),
				" are the macro layout fork, documented as\ndeliberate in the seam’s header.\n",
				createVNode($$Pill, {
					variant: "bad",
					children: "Verified · aggregate"
				}),
				" ",
				createVNode($$Pill, {
					variant: "done",
					children: "fixed · #1088"
				})
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "⚡ CodeTab samples the viewport at mount — and on the wrong axis",
			children: createVNode(_components.p, { children: [
				"Two non-reactive reads at construction: ",
				createVNode(_components.code, { children: "treeDensity = isMobile() ? \"relaxed\" : undefined" }),
				"\n(line 103) and ",
				createVNode(_components.code, { children: "if (isMobile()) attachPierreTouchScroll(el)" }),
				" (line 548). The review\ncalled the ",
				createVNode(_components.strong, { children: [
					"touch-scroll gate keying off ",
					createVNode(_components.code, { children: "isMobile" }),
					" (viewport) instead of ",
					createVNode(_components.code, { children: "isTouch" }),
					"\n(modality)"
				] }),
				" a genuine wrong-axis bug. Re-examined in ",
				createVNode($$PrLink, { pr: 1088 }),
				": density\nis now keyed on ",
				createVNode(_components.code, { children: "isTouch" }),
				" (tap-target rationale in ",
				createVNode(_components.code, { children: "CodeTab.tsx" }),
				"), while the\ntouch-scroll gate deliberately stays on ",
				createVNode(_components.code, { children: "isMobile" }),
				" — the workaround targets the\nmobile drawer layout’s iOS native scroll, not touch modality (rationale in-code and\nin ",
				createVNode(_components.code, { children: "capabilities.ts" }),
				"’s deliberate-raw-read list) — so the wrong-axis verdict is\nretracted. ",
				createVNode($$Pill, {
					variant: "bad",
					children: "Verified · wrong-axis"
				}),
				" ",
				createVNode($$Pill, {
					variant: "done",
					children: "re-examined · #1088"
				})
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "🩺 Terminal soft-keyboard adaptation leaks as raw shadow-DOM surgery",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "Terminal.tsx:538-549" }),
				" branches on ",
				createVNode(_components.code, { children: "isTouch()" }),
				" and reaches into xterm’s internal\n",
				createVNode(_components.code, { children: ".xterm-screen" }),
				" to set ",
				createVNode(_components.code, { children: "contenteditable" }),
				"/",
				createVNode(_components.code, { children: "spellcheck" }),
				"/",
				createVNode(_components.code, { children: "caret-color" }),
				". This\nvolatility ",
				createVNode(_components.em, { children: "legitimately must surface" }),
				" (see §6) — but the knowledge “touch needs a\ncontenteditable target” was welded into Terminal.tsx’s setup path, coupled to\nundocumented xterm internals. The leak is justified; its ",
				createVNode(_components.em, { children: "form" }),
				" was the smell.\nExtracted in ",
				createVNode($$PrLink, { pr: 1088 }),
				" — the surgery and its ",
				createVNode(_components.code, { children: "isTouch()" }),
				" guard now live\nbehind ",
				createVNode(_components.code, { children: "enableSoftKeyboardInput(term)" }),
				" in ",
				createVNode(_components.code, { children: "softKeyboardInput.ts" }),
				"; ",
				createVNode(_components.code, { children: "Terminal.tsx" }),
				"\ncalls the one verb.\n",
				createVNode($$Pill, {
					variant: "bad",
					children: "Verified · confirmed"
				}),
				" ",
				createVNode($$Pill, {
					variant: "done",
					children: "fixed · #1088"
				})
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "-where-the-analogy-honestly-breaks--a-phone-is-not-a-110-volt-desktop",
			children: "⑥ Where the analogy honestly breaks — a phone is not a 110-volt desktop"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The load-bearing nuance",
			children: createVNode(_components.p, { children: [
				"Electricity’s promise is that ",
				createVNode(_components.em, { children: "the same appliance" }),
				" runs on any voltage. That does\n",
				createVNode(_components.strong, { children: "not" }),
				" fully hold for mobile — and pretending it does would be the wrong fix."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Some mobile volatility is not a different ",
			createVNode(_components.em, { children: "voltage" }),
			" of the same signal; it is a\ncategorically different ",
			createVNode(_components.strong, { children: "appliance" }),
			". A soft keyboard is not a 220V keyboard —\nit’s a different input device with its own focus model and contenteditable target.\nThe pan/zoom canvas is genuinely ",
			createVNode(_components.em, { children: "unusable" }),
			" on a phone, so ",
			createVNode(_components.code, { children: "MobileTileView" }),
			" and\nthe drawers are a second, correctly-built product surface. This is why “just move\nit all to CSS” is wrong:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Same appliance, different voltage → CSS." }), " Spacing, inline-label hide/show, max-widths, density. Today kolu does almost none of this in CSS (18 JS reads vs 4 classes) — the recoverable ground."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Different appliance → JS, behind a seam." }),
				" Soft-keyboard input surface, focus suppression, swipe nav, touch-scroll. Lowy’s demand isn’t “don’t branch” — it’s “branch in ",
				createVNode(_components.em, { children: "one named place" }),
				", not as raw ",
				createVNode(_components.code, { children: "isTouch()" }),
				" poking xterm internals from a setup loop.”"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"There are ",
			createVNode(_components.strong, { children: "four concepts wearing one word" }),
			" — viewport-size, touch-modality,\nlayout-posture, feature-availability. The first two are correctly receptacled; the\nsecond two are functionally decomposed. The fix is to add the missing posture and\ncapability receptacles, not to erase the divergence."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "-the-receptacle-that-should-exist--keep-the-wiring-add-three-faceplates",
			children: "⑦ The receptacle that should exist — keep the wiring, add three faceplates"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Keep the wiring." }),
			" ",
			createVNode(_components.code, { children: "isMobile" }),
			" and ",
			createVNode(_components.code, { children: "isTouch" }),
			" stay as the two axes — but unify the\n",
			createVNode(_components.em, { children: "rating" }),
			": register the breakpoint once (Tailwind v4 ",
			createVNode(_components.code, { children: "@theme { --breakpoint-sm }" }),
			"\nor a shared constant) and derive the JS ",
			createVNode(_components.code, { children: "createMediaQuery" }),
			" from the same number.\nThe 639/640 desync and the misleading comment both vanish. Then three named seams:"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "useRightPanel.reveal()" }) }),
				" — one verb that internally resolves drawer-open (mobile) vs uncollapse (desktop). ",
				createVNode(_components.code, { children: "openInCodeTab" }),
				" and every future producer call it and never read ",
				createVNode(_components.code, { children: "isMobile" }),
				". ~5 lines; ",
				createVNode(_components.em, { children: "highest payoff-to-effort fix." })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A resolved capability object" }),
				" — ",
				createVNode(_components.code, { children: "layout.supportsSpatialCanvas" }),
				", ",
				createVNode(_components.code, { children: "showsAmbientTips" }),
				", ",
				createVNode(_components.code, { children: "isCompact" }),
				" — computed once, each from the ",
				createVNode(_components.em, { children: "right" }),
				" axis. Consumers ask about capability, not pixels."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "enableSoftKeyboardInput(term)" }) }),
				" — owns the contenteditable knowledge + xterm poking so ",
				createVNode(_components.code, { children: "Terminal.tsx" }),
				" calls one verb; re-key ",
				createVNode(_components.code, { children: "CodeTab" }),
				"’s touch-scroll off touch capability rather than viewport."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.code, { children: "withKeyboardDismiss" }), " is the existence proof these work: a drawer plugs in by\npassing its setter and never measures the voltage."] }),
		"\n",
		createVNode(_components.h2, {
			id: "-what-was-done--ranked-by-payoff--effort",
			children: "⑧ What was done — ranked by payoff ÷ effort"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Action" }),
					"\n",
					createVNode(_components.th, { children: "Why" }),
					"\n",
					createVNode(_components.th, { children: "Effort" }),
					"\n",
					createVNode(_components.th, { children: "Payoff" }),
					"\n",
					createVNode(_components.th, { children: "Status" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Unify the breakpoint" }), " (639px ⟶ one value)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"Register ",
						createVNode(_components.code, { children: "--breakpoint-sm" }),
						" once + derive the JS query; fix the contradicting comment. Kills the desync band + orphaned ",
						createVNode(_components.code, { children: "ChromeBar" }),
						" ",
						createVNode(_components.code, { children: "sm:" }),
						"."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "sm",
						children: "small"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "high"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "done",
						children: "shipped · #1088"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: ["Add ", createVNode(_components.code, { children: "useRightPanel.reveal()" })] }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Move the ",
						createVNode(_components.code, { children: "isMobile" }),
						" fork out of ",
						createVNode(_components.code, { children: "openInCodeTab" }),
						" into one host-owned verb; mirrors ",
						createVNode(_components.code, { children: "withKeyboardDismiss" }),
						". Near-zero blast radius."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "sm",
						children: "small"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "high"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "done",
						children: "shipped · #1088"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "A resolved capability seam" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Replace scattered ",
						createVNode(_components.code, { children: "isMobile()" }),
						" feature checks with one resolved object, each keyed off the right axis."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "medium"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "medium"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "done",
						children: "shipped · #1088"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: createVNode(_components.code, { children: "enableSoftKeyboardInput(term)" }) }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Wrap the contenteditable surgery behind a named seam; re-key ",
						createVNode(_components.code, { children: "CodeTab" }),
						" touch-scroll off touch capability."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "medium"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "medium"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "done",
						children: "shipped · #1088"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: [
						"Do ",
						createVNode(_components.em, { children: "not" }),
						" extract the dock-row / metadata JSX shells"
					] }) }),
					"\n",
					createVNode(_components.td, { children: [
						"The volatile logic is already shared; only JSX shells diverge, for documented touch-target reasons two reviewers chose. A forced ",
						createVNode(_components.code, { children: "BaseRow" }),
						" would be worse."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "sm",
						children: "small"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "guard"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "standing"
					}) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The one-line answer at review time: ",
			createVNode(_components.strong, { children: "mobile is electricity for the macro layout\nswitch and the keyboard-dismiss wrapper, and bare mains everywhere else." }),
			" The\nwiring discipline was good — two correctly-separated circuits — but neither\nterminated in enough receptacles, and the one threshold was rated at two\nvoltages. ",
			createVNode($$PrLink, { pr: 1088 }),
			" added the missing receptacles and unified the rating."
		] }),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Method · 24 subagents over a 4-phase workflow: 5 parallel mappers (66 findings)\n→ independent Hickey + Lowy lenses → 16 structural claims adversarially re-read\nagainst source → reconciled synthesis. Source: ",
			createVNode(_components.code, { children: "kolu/packages/client/src" }),
			", branch\n",
			createVNode(_components.code, { children: "brave-second" }),
			", 2026-06-01."
		] }) })
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
	"title": "Is Mobile Electricity?",
	"description": "A Hickey/Lowy review of kolu's mobile support — is mobile an encapsulated change behind a receptacle, or smeared across every consumer measuring the voltage?",
	"parents": ["electricity", "analysis"],
	"maturity": "evergreen",
	"updated": "2026-06-15T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "-the-analogy--lowys-receptacle",
			"text": "① The analogy — Lowy’s receptacle"
		},
		{
			"depth": 2,
			"slug": "-the-circuit-as-wired-today",
			"text": "② The circuit as wired today"
		},
		{
			"depth": 2,
			"slug": "-scorecard",
			"text": "③ Scorecard"
		},
		{
			"depth": 2,
			"slug": "-whats-wired-right--the-parts-that-already-are-electricity",
			"text": "④ What’s wired right — the parts that already are electricity"
		},
		{
			"depth": 2,
			"slug": "-where-the-leads-are-bare--five-leaks-that-survived-verification",
			"text": "⑤ Where the leads are bare — five leaks that survived verification"
		},
		{
			"depth": 2,
			"slug": "-where-the-analogy-honestly-breaks--a-phone-is-not-a-110-volt-desktop",
			"text": "⑥ Where the analogy honestly breaks — a phone is not a 110-volt desktop"
		},
		{
			"depth": 2,
			"slug": "-the-receptacle-that-should-exist--keep-the-wiring-add-three-faceplates",
			"text": "⑦ The receptacle that should exist — keep the wiring, add three faceplates"
		},
		{
			"depth": 2,
			"slug": "-what-was-done--ranked-by-payoff--effort",
			"text": "⑧ What was done — ranked by payoff ÷ effort"
		}
	];
}
var url = "src/content/atlas/mobile-architecture-review.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/mobile-architecture-review.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/mobile-architecture-review.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
