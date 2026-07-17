import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import "./Callout_va3z_Xoj.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
import { t as $$Footnote } from "./Footnote_Co54bi9w.mjs";
import { t as $$Terminal } from "./Terminal_Cqh2_20m.mjs";
//#region src/diagrams/kolu-cli-arch.svg?raw
var kolu_cli_arch_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 860 470\" font-family=\"ui-sans-serif, system-ui, sans-serif\">\n  <rect width=\"860\" height=\"470\" rx=\"12\" fill=\"#f6f7fb\"/>\n\n  <!-- title row -->\n  <text x=\"430\" y=\"30\" text-anchor=\"middle\" font-size=\"15\" font-weight=\"700\" fill=\"#1a1d29\">one padiSurface, two frontends — kolu tui/mcp never touch kolu-server</text>\n\n  <!-- kolu-tui box -->\n  <rect x=\"40\" y=\"60\" width=\"300\" height=\"150\" rx=\"10\" fill=\"#ffffff\" stroke=\"#7c3aed\" stroke-width=\"2.5\"/>\n  <text x=\"190\" y=\"85\" text-anchor=\"middle\" font-size=\"14\" font-weight=\"700\" fill=\"#7c3aed\">kolu tui · kolu mcp (packages/kolu-cli)</text>\n  <rect x=\"60\" y=\"100\" width=\"120\" height=\"90\" rx=\"8\" fill=\"#f3e8ff\" stroke=\"#a78bfa\"/>\n  <text x=\"120\" y=\"122\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"600\" fill=\"#4c1d95\">canvas face</text>\n  <text x=\"120\" y=\"140\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#4c1d95\">tiles · urgency</text>\n  <text x=\"120\" y=\"155\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#4c1d95\">attach · create/kill</text>\n  <text x=\"120\" y=\"170\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#4c1d95\">(human, raw ANSI)</text>\n  <rect x=\"200\" y=\"100\" width=\"120\" height=\"90\" rx=\"8\" fill=\"#ede9fe\" stroke=\"#a78bfa\"/>\n  <text x=\"260\" y=\"122\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"600\" fill=\"#4c1d95\">MCP face</text>\n  <text x=\"260\" y=\"140\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#4c1d95\">serveSurfaceAsMcp</text>\n  <text x=\"260\" y=\"155\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#4c1d95\">resources + tools</text>\n  <text x=\"260\" y=\"170\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#4c1d95\">(agents, stdio)</text>\n\n  <!-- kolu-server box, grayed -->\n  <rect x=\"530\" y=\"60\" width=\"290\" height=\"150\" rx=\"10\" fill=\"#eef0f5\" stroke=\"#9aa1b1\" stroke-width=\"1.5\" stroke-dasharray=\"6 4\"/>\n  <text x=\"675\" y=\"85\" text-anchor=\"middle\" font-size=\"14\" font-weight=\"700\" fill=\"#6b7280\">kolu-server + browser</text>\n  <text x=\"675\" y=\"110\" text-anchor=\"middle\" font-size=\"11\" fill=\"#6b7280\">the FIRST frontend — multi-host map,</text>\n  <text x=\"675\" y=\"126\" text-anchor=\"middle\" font-size=\"11\" fill=\"#6b7280\">provisioning, web canvas</text>\n  <text x=\"675\" y=\"152\" text-anchor=\"middle\" font-size=\"11\" font-style=\"italic\" fill=\"#6b7280\">absent from every kolu-tui path —</text>\n  <text x=\"675\" y=\"168\" text-anchor=\"middle\" font-size=\"11\" font-style=\"italic\" fill=\"#6b7280\">that absence IS the graduation proof</text>\n\n  <!-- shared client seam -->\n  <rect x=\"90\" y=\"235\" width=\"200\" height=\"34\" rx=\"8\" fill=\"#e0e7ff\" stroke=\"#6366f1\" stroke-width=\"1.5\"/>\n  <text x=\"190\" y=\"257\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"600\" fill=\"#3730a3\">ONE surfaceClient (STREAM_RETRY mounted)</text>\n\n  <!-- transports -->\n  <rect x=\"60\" y=\"292\" width=\"120\" height=\"30\" rx=\"8\" fill=\"#dcfce7\" stroke=\"#16a34a\" stroke-width=\"1.5\"/>\n  <text x=\"120\" y=\"312\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"600\" fill=\"#14532d\">unix socket</text>\n  <rect x=\"200\" y=\"292\" width=\"120\" height=\"30\" rx=\"8\" fill=\"#dcfce7\" stroke=\"#16a34a\" stroke-width=\"1.5\"/>\n  <text x=\"260\" y=\"312\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"600\" fill=\"#14532d\">ssh stdio pipe</text>\n\n  <!-- padi box -->\n  <rect x=\"40\" y=\"350\" width=\"450\" height=\"90\" rx=\"10\" fill=\"#ffffff\" stroke=\"#0891b2\" stroke-width=\"2.5\"/>\n  <text x=\"265\" y=\"374\" text-anchor=\"middle\" font-size=\"14\" font-weight=\"700\" fill=\"#0e7490\">padi (per-host workspace daemon)</text>\n  <text x=\"265\" y=\"396\" text-anchor=\"middle\" font-size=\"11.5\" fill=\"#155e75\">padiSurface: terminals · urgency · status · activity · screen</text>\n  <text x=\"265\" y=\"413\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"600\" fill=\"#155e75\">terminalAttach ({seq} byte stream — the path that breaks)</text>\n  <text x=\"265\" y=\"430\" text-anchor=\"middle\" font-size=\"11.5\" fill=\"#155e75\">procs: create · kill · send…</text>\n\n  <!-- kaval box -->\n  <rect x=\"560\" y=\"350\" width=\"230\" height=\"90\" rx=\"10\" fill=\"#ffffff\" stroke=\"#ca8a04\" stroke-width=\"2\"/>\n  <text x=\"675\" y=\"380\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#854d0e\">kaval (PTY daemon)</text>\n  <text x=\"675\" y=\"402\" text-anchor=\"middle\" font-size=\"11\" fill=\"#854d0e\">bytes + PTYs; padi binds it —</text>\n  <text x=\"675\" y=\"418\" text-anchor=\"middle\" font-size=\"11\" fill=\"#854d0e\">the CLI faces never import it</text>\n\n  <!-- arrows -->\n  <defs>\n    <marker id=\"arr\" viewBox=\"0 0 8 8\" refX=\"7\" refY=\"4\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto\"><path d=\"M0 0 L8 4 L0 8 z\" fill=\"#475569\"/></marker>\n    <marker id=\"arrGray\" viewBox=\"0 0 8 8\" refX=\"7\" refY=\"4\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto\"><path d=\"M0 0 L8 4 L0 8 z\" fill=\"#9aa1b1\"/></marker>\n  </defs>\n  <line x1=\"150\" y1=\"190\" x2=\"175\" y2=\"235\" stroke=\"#475569\" stroke-width=\"1.8\" marker-end=\"url(#arr)\"/>\n  <line x1=\"245\" y1=\"190\" x2=\"210\" y2=\"235\" stroke=\"#475569\" stroke-width=\"1.8\" marker-end=\"url(#arr)\"/>\n  <line x1=\"150\" y1=\"269\" x2=\"125\" y2=\"292\" stroke=\"#475569\" stroke-width=\"1.8\" marker-end=\"url(#arr)\"/>\n  <line x1=\"230\" y1=\"269\" x2=\"255\" y2=\"292\" stroke=\"#475569\" stroke-width=\"1.8\" marker-end=\"url(#arr)\"/>\n  <line x1=\"120\" y1=\"322\" x2=\"180\" y2=\"350\" stroke=\"#475569\" stroke-width=\"1.8\" marker-end=\"url(#arr)\"/>\n  <line x1=\"260\" y1=\"322\" x2=\"290\" y2=\"350\" stroke=\"#475569\" stroke-width=\"1.8\" marker-end=\"url(#arr)\"/>\n  <line x1=\"530\" y1=\"395\" x2=\"492\" y2=\"395\" stroke=\"#475569\" stroke-width=\"1.8\" marker-end=\"url(#arr)\" transform=\"rotate(180 511 395)\"/>\n  <text x=\"525\" y=\"388\" text-anchor=\"middle\" font-size=\"10\" fill=\"#475569\">binds</text>\n  <line x1=\"620\" y1=\"210\" x2=\"420\" y2=\"352\" stroke=\"#9aa1b1\" stroke-width=\"1.5\" stroke-dasharray=\"5 4\" marker-end=\"url(#arrGray)\"/>\n  <text x=\"545\" y=\"290\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#6b7280\">dials padiSurface too (today's only consumer)</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/kolu-cli.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		em: "em",
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
		createVNode(_components.p, { children: [
			"One binary, three faces: ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "kolu web" }) }),
			" (today’s server+browser, still the\nbare-",
			createVNode(_components.code, { children: "kolu" }),
			" default), ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "kolu tui" }) }),
			" (the terminal canvas), ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "kolu mcp" }) }),
			"\n(the agent face). The tui and mcp faces are the ",
			createVNode(_components.strong, { children: "second frontend" }),
			" — the\nclient that proves ",
			createVNode(_components.code, { children: "padiSurface" }),
			" serves someone other than kolu-server.\nNeither is a scripting CLI: ",
			createVNode(_components.code, { children: "padi-tui" }),
			" and ",
			createVNode(_components.code, { children: "kaval-tui" }),
			" keep their verbs as\ntheir daemons’ scripting faces.",
			createVNode($$Footnote, { children: "The note was born as “kolu-tui”, a\nnew executable; the ratified shape is subcommands of the one product binary,\nso the plan covers the CLI restructure too — hence the rename." }),
			createVNode($$Footnote, { children: [
				"The\nsubsume-the-CLIs option was considered and rejected at ratification: verb\nparity would drag a kaval dependency into the CLI faces and blur the proof. Agents\nthat want verbs get them through the MCP face below — derived from\n",
				createVNode(_components.code, { children: "padiSurface" }),
				", not reimplemented."
			] }),
			" Ratified scope: **canvas + attach"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: "create/kill, single host, plus an MCP face** (srid, 2026-07-16)." }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "user-facing-description",
			children: "User-facing description"
		}),
		"\n",
		createVNode(_components.p, { children: "One binary, two faces." }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The canvas (humans)." }),
			" ",
			createVNode(_components.code, { children: "kolu tui" }),
			" connects to the local padi socket —\n",
			createVNode(_components.code, { children: "kolu tui --host user@zest" }),
			" pipes over ssh — and renders that host’s live\ncanvas: one tile per terminal, title, agent badge, urgency mark. The same\narrangement the browser shows for this host, in a terminal."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Prototype A — the default view" }),
			": urgency-ordered grid of live tiles + a\none-column status rail for everything that doesn’t fit. Tile order follows the\nurgency ladder (blocked ▲ > done-unseen ● > working ✳ > idle), so the tile that\nneeds you is always top-left; the rail’s dots carry the same states for\noff-grid terminals, and the most urgent off-grid state bubbles into the rail\nheader.",
			createVNode($$Footnote, { children: "The rail + ladder + seen/unseen semantics are taken from the\nherdr study (an unseen-done agent outranks a still-working one — done+unseen\nneeds a human, working does not; the ● badge self-clears on attach). herdr’s\nown layout is list+focus+zoom, not a grid — the grid stays kolu’s\ndifferentiator; the rail is its overflow answer." })
		] }),
		"\n",
		createVNode($$Terminal, {
			title: "kolu tui — zest",
			lines: [
				"▲│┌─ 1 flake-5x ▲ blocked ────┐┌─ 2 live-fix ● done ───────┐",
				"●││ Need your ruling on (a)/(b)││ ❯ 14/14 green — lease     │",
				"✳││ — see report 07.          ││   released. Holding.      │",
				"✳│└───────────────────────────┘└───────────────────────────┘",
				"·│┌─ 3 chlog-2 ✳ working ─────┐┌─ 4 sr11 · idle ───────────┐",
				"·││ · Baking… (14m 27s)       ││ ❯                         │",
				" ││   695 passed, 0 failed    ││                           │",
				" │└───────────────────────────┘└───────────────────────────┘",
				"# 1-9 focus · Enter attach · g goto · c create · x kill · ? keys"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Prototype B — attached (maximized)" }),
			": full-screen raw passthrough; one\nreverse-video status line is the only chrome. Detach with the ssh-style ",
			createVNode(_components.code, { children: "~." }),
			"\nline-start chord (",
			createVNode(_components.code, { children: "~~" }),
			" sends a literal ",
			createVNode(_components.code, { children: "~" }),
			", ",
			createVNode(_components.code, { children: "~?" }),
			" lists escapes — the\n",
			createVNode(_components.code, { children: "kaval-tui attach" }),
			" grammar, verbatim). The status line keeps the rail’s\nmost-urgent dot, so a blocked agent elsewhere is visible even while attached."
		] }),
		"\n",
		createVNode($$Terminal, {
			title: "kolu tui — zest · attached: flake-5x",
			lines: [
				"✻ Hatching… (31s · thinking)",
				"  ⎿  streak 3/5 — r-cert 4 relaunched on kolu-ci-2",
				"❯ ",
				"",
				"[flake-5x ▲ · ~. detach · ~? help          rail: ●✳✳ · 2 off-grid]"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Prototype C — the navigator" }),
			" (",
			createVNode(_components.code, { children: "g" }),
			"): fuzzy jump across every terminal, with\nsingle-key state filters — ",
			createVNode(_components.code, { children: "b" }),
			" blocked, ",
			createVNode(_components.code, { children: "d" }),
			" done-unseen, ",
			createVNode(_components.code, { children: "w" }),
			" working — because\nspatial navigation stops scaling past a dozen agents.",
			createVNode($$Footnote, { children: [
				"Taken from\nherdr’s navigator/goto overlay; its state-filter chords are the triage tool a\ngrid of agents needs. The overlay renders the user’s REAL bindings, not\nhardcoded docs — same rule for the ",
				createVNode(_components.code, { children: "?" }),
				" help overlay."
			] })
		] }),
		"\n",
		createVNode($$Terminal, {
			title: "kolu tui — zest · goto",
			lines: [
				"goto ❯ fla█                    [b]locked [d]one [w]orking [a]ll",
				"  ▲ 1 flake-5x      blocked 4m   Need your ruling on (a)/(b)…",
				"  ✳ 3 chlog-2       working 14m  Baking…",
				"  · 7 scratch-fla   idle 2h     ❯",
				"# Enter focus · ⏎⏎ attach · Esc cancel"
			]
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Focus" }),
				" moves with ",
				createVNode(_components.code, { children: "hjkl" }),
				"/arrows; the focused tile shows a live screen\npreview (the ",
				createVNode(_components.code, { children: "screen" }),
				" collection), not a frozen snapshot. The grid is the\nterminal-native projection of the canvas: tiles sorted by the host\narrangement’s reading order, so spatial memory survives as ",
				createVNode(_components.em, { children: "ordering" }),
				", not\ngeometry.",
				createVNode($$Footnote, { children: "An infinite-canvas viewport (pan over the browser’s\nplane) was considered and rejected: characters don’t scale, so a terminal\nhas no continuous zoom — a tile is either 1:1 readable or\ndownsampled-to-decoration, and panning a plane where at most ~4 tiles are\nreadable just loses terminals off-screen. Pixel-preview escape hatches\n(sixel, kitty graphics) were rejected with it: terminal-specific\nelectricity against the raw-ANSI decision. Maximized + grid is what every\nTUI multiplexer converges on, for this reason." })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Enter attaches" }),
				": full-screen raw passthrough to that terminal — keystrokes\nin, bytes out, exactly the ",
				createVNode(_components.code, { children: "kaval-tui attach" }),
				" UX (same detach chord, same\nresize-then-attach discipline) but riding ",
				createVNode(_components.code, { children: "padiSurface" }),
				"’s ",
				createVNode(_components.code, { children: "terminalAttach" }),
				"\nstream. Detach returns to the canvas."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "c" }), " creates"] }),
				" a terminal (prompted command, default shell) ",
				createVNode(_components.strong, { children: "without\nstealing focus" }),
				" by default — spawning a helper must not yank your view;\n",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "x" }), " kills"] }),
				" the focused one, and the confirm states the blast radius\n(“kill 1 terminal, agent working 14m”) rather than a generic are-you-sure.\nBoth are ",
				createVNode(_components.code, { children: "padiSurface" }),
				" procedure calls — the same intents the browser sends."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Notifications are edge-triggered and focus-suppressed" }),
				": state\n",
				createVNode(_components.em, { children: "transitions" }),
				" only (never levels), and never for the tile you’re already\nlooking at — the two rules that keep a multi-agent watcher quiet."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Urgency (",
				createVNode(_components.code, { children: "awaiting" }),
				" badge) reorders nothing and blinks nothing; it renders\nthe daemon’s own ",
				createVNode(_components.code, { children: "urgency" }),
				" cell, so a padi-side change appears without a\nCLI release."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "The MCP face" }), " gets its own section below — one connected surface, two\nconsumers."] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Out of scope, deliberately:" }),
			" multi-host (the host map is kolu-server’s job;\na later phase may dial N padis if demand shows), provisioning (the CLI faces dial\na padi that already runs — if none listens it fails fast with the socket/ssh\nerror, never a silent retry loop), and any ",
			createVNode(_components.code, { children: "padi-tui" }),
			"/",
			createVNode(_components.code, { children: "kaval-tui" }),
			" verb."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-mcp-face",
			children: "The MCP face"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The MCP face (agents)." }),
			" ",
			createVNode(_components.code, { children: "kolu mcp [--host …]" }),
			" serves the ",
			createVNode(_components.em, { children: "same\nconnected surface" }),
			" to a coding agent over stdio via ",
			createVNode(_components.code, { children: "serveSurfaceAsMcp" }),
			"\n(",
			createVNode(_components.code, { children: "@kolu/surface-mcp" }),
			"), ",
			createVNode(_components.strong, { children: "default-deny" }),
			" — the v1 expose map is this table and\nnothing else:",
			createVNode($$Footnote, { children: [
				"This is how “agents can drive padi/kaval verbs through\nthe kolu binary” lands without it growing a verb CLI: the verbs are\n",
				createVNode(_components.code, { children: "padiSurface" }),
				"’s own procedures, re-exposed by the existing adapter. Nothing is\nreimplemented; ",
				createVNode(_components.code, { children: "padi-tui" }),
				"/",
				createVNode(_components.code, { children: "kaval-tui" }),
				" remain the human scripting faces. The\nkaval-tui verb set maps onto it directly: ",
				createVNode(_components.code, { children: "list" }),
				" → the ",
				createVNode(_components.code, { children: "terminals" }),
				" resource,\n",
				createVNode(_components.code, { children: "snapshot" }),
				" → ",
				createVNode(_components.code, { children: "screen.text" }),
				", ",
				createVNode(_components.code, { children: "send" }),
				" → ",
				createVNode(_components.code, { children: "lifecycle.sendInput" }),
				", ",
				createVNode(_components.code, { children: "create" }),
				"/",
				createVNode(_components.code, { children: "kill" }),
				" →\n",
				createVNode(_components.code, { children: "lifecycle.create" }),
				"/",
				createVNode(_components.code, { children: "kill" }),
				", ",
				createVNode(_components.code, { children: "wait" }),
				" → subscribe ",
				createVNode(_components.code, { children: "urgency" }),
				"/",
				createVNode(_components.code, { children: "activity" }),
				" and watch\nfor the edge."
			] })
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "exposed as" }),
					"\n",
					createVNode(_components.th, { children: "member" }),
					"\n",
					createVNode(_components.th, { children: "what the agent gets" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "resource (subscribable)" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "terminals" }) }),
					"\n",
					createVNode(_components.td, { children: "the live roster — id, title, command, agent kind + state per terminal" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "resource (subscribable)" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "urgency" }) }),
					"\n",
					createVNode(_components.td, { children: "the awaiting-ids set — “which terminals need a human/agent now”" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "resource (subscribable)" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "status" }) }),
					"\n",
					createVNode(_components.td, { children: "daemon/kaval health" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "resource (subscribable)" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "activity" }) }),
					"\n",
					createVNode(_components.td, { children: "the host’s activity feed (state transitions to wait on)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "tool, read-only" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "screen.text" }),
						" · ",
						createVNode(_components.code, { children: "screen.history" })
					] }),
					"\n",
					createVNode(_components.td, { children: "a terminal’s rendered screen / scrollback as text — the snapshot face" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "tool, read-only" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "git.getStatus" }),
						" · ",
						createVNode(_components.code, { children: "git.getDiff" })
					] }),
					"\n",
					createVNode(_components.td, { children: "the workspace’s git context, same source of truth the browser’s Code tab reads" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "tool, read-only" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "fs.listAll" }),
						" · ",
						createVNode(_components.code, { children: "fs.readFile" })
					] }),
					"\n",
					createVNode(_components.td, { children: "workspace file listing / file contents" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["tool, ", createVNode(_components.code, { children: "mutates" })] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "lifecycle.create" }) }),
					"\n",
					createVNode(_components.td, { children: "spawn a terminal (command, cwd) — returns the TerminalInfo" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["tool, ", createVNode(_components.code, { children: "mutates" })] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "lifecycle.kill" }) }),
					"\n",
					createVNode(_components.td, { children: "kill one terminal by id" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["tool, ", createVNode(_components.code, { children: "mutates" })] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "lifecycle.sendInput" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"write input to a terminal — text AND the named-key vocabulary (",
						createVNode(_components.code, { children: "Enter" }),
						", ",
						createVNode(_components.code, { children: "Escape" }),
						", ",
						createVNode(_components.code, { children: "Backspace" }),
						", ",
						createVNode(_components.code, { children: "C-u" }),
						"-style chords), because the skills’ three-step submit protocol sends text and Enter as SEPARATE calls"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "tool, composite (MCP-face-local)" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "wait.outputSettled" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"block until a terminal’s output is idle for N ms (with timeout) — the ",
						createVNode(_components.code, { children: "kaval-tui wait --until idle:<ms>" }),
						" done-signal, watched client-side off the ",
						createVNode(_components.code, { children: "terminalAttach" }),
						" stream"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "tool, composite (MCP-face-local)" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "wait.agentState" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"block until a terminal’s detected agent state enters a target bucket — the ",
						createVNode(_components.code, { children: "padi-tui wait --until <buckets>" }),
						" done-signal, watched off the ",
						createVNode(_components.code, { children: "terminals" }),
						" collection"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Deliberately denied in v1" }),
			" (each an explicit non-entry, not an oversight):\n",
			createVNode(_components.code, { children: "terminalAttach" }),
			" (a raw ",
			createVNode(_components.code, { children: "{seq}" }),
			" byte stream is the wrong shape for MCP\nconsumers — ",
			createVNode(_components.code, { children: "screen.text" }),
			" is the read face); ",
			createVNode(_components.code, { children: "lifecycle.killAll" }),
			" /\n",
			createVNode(_components.code, { children: "recycleKaval" }),
			" / ",
			createVNode(_components.code, { children: "discardSleeping" }),
			" (daemon-admin blast radius — human verbs);\n",
			createVNode(_components.code, { children: "lifecycle.sleep" }),
			"/",
			createVNode(_components.code, { children: "wake" }),
			"/",
			createVNode(_components.code, { children: "resize" }),
			" (layout/lifecycle policy the canvas owns);\n",
			createVNode(_components.code, { children: "chrome.*" }),
			" (browser canvas arrangement — meaningless for an agent and\nhazardous to script); ",
			createVNode(_components.code, { children: "git.worktreeCreate" }),
			"/",
			createVNode(_components.code, { children: "worktreeRemove" }),
			" and\n",
			createVNode(_components.code, { children: "scratch.write" }),
			" (write-side beyond terminal control — expandable later, on\ndemand, one row at a time); ",
			createVNode(_components.code, { children: "session.restore" }),
			" + every ",
			createVNode(_components.code, { children: "test__set" }),
			" verb\n(admin/test). Widening the map is a one-row diff with a review, never a\ndefault."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "skill-parity--the-orchestrator--kolu-migration-contract",
			children: "Skill parity — the /orchestrator · /kolu migration contract"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The end state (ratified): the ",
			createVNode(_components.strong, { children: [
				"/orchestrator and /kolu skills drive agents\nthrough this MCP when it’s available, falling back to ",
				createVNode(_components.code, { children: "kaval-tui" }),
				"/",
				createVNode(_components.code, { children: "padi-tui" }),
				"\nwhen it isn’t"
			] }),
			" — so the expose map is not a menu, it’s a parity contract with\nwhat those skills do today. The audit of their actual verb usage:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "skill verb today (uses)" }),
					"\n",
					createVNode(_components.th, { children: "MCP equivalent" }),
					"\n",
					createVNode(_components.th, { children: "parity notes" }),
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
						createVNode(_components.code, { children: "kaval-tui wait --until idle:<ms>" }),
						" (28×) + ",
						createVNode(_components.code, { children: "padi-tui wait --until <state>" }),
						" (20×)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "wait.outputSettled" }),
						" / ",
						createVNode(_components.code, { children: "wait.agentState" })
					] }),
					"\n",
					createVNode(_components.td, { children: "THE core done-signal — the send → settle → Enter → settle loop is the whole dispatch protocol; without blocking wait tools the MCP face fails the skills on their most-used verb" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "kaval-tui send \"text\"" }),
						" / ",
						createVNode(_components.code, { children: "send --key Enter" }),
						" (24×)"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "lifecycle.sendInput" }) }),
					"\n",
					createVNode(_components.td, { children: "the named-key vocabulary is load-bearing: submit is its OWN Enter after an observed settle, never text+newline fused" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "kaval-tui list" }), " (12×)"] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "terminals" }), " resource"] }),
					"\n",
					createVNode(_components.td, { children: "must carry id, title, cwd, and idle-time — the coordinator re-finds terminals BY TITLE after daemon re-keys" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "kaval-tui" }),
						"/",
						createVNode(_components.code, { children: "padi-tui create [--parent --repo]" }),
						" (10×)"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "lifecycle.create" }) }),
					"\n",
					createVNode(_components.td, { children: "parameter parity: command, cwd/repo, parent — and the returned TerminalInfo must include the id the skills capture" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "kaval-tui snapshot [--viewport]" }), " (10×)"] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "screen.text" }) }),
					"\n",
					createVNode(_components.td, { children: "viewport/tail modes, so “read the last N lines” stays one cheap call" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "kaval-tui kill" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "lifecycle.kill" }) }),
					"\n",
					createVNode(_components.td, { children: "with the canvas’s blast-radius text available to the agent too" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Two consequences worth naming. First, the composite ",
			createVNode(_components.code, { children: "wait.*" }),
			" tools are\n",
			createVNode(_components.strong, { children: "client-side scaffolding, not padiSurface procedures" }),
			" — the same\nWaitOutcome/abort-chain scaffold ",
			createVNode(_components.code, { children: "padi-tui/read.ts" }),
			" and ",
			createVNode(_components.code, { children: "kaval-tui/wait.ts" }),
			"\neach hand-roll today. The MCP face is therefore the ",
			createVNode(_components.em, { children: "third consumer" }),
			" of\nthat scaffold, which meets the unification gate ",
			createVNode(_components.code, { children: "padi.mdx" }),
			" records: the shared\nscaffold gets extracted (a small leaf) as part of this PR rather than a third\ncopy. Second, ",
			createVNode(_components.code, { children: "wait.outputSettled" }),
			" consumes the ",
			createVNode(_components.code, { children: "terminalAttach" }),
			" ",
			createVNode(_components.code, { children: "{seq}" }),
			"\nstream ",
			createVNode(_components.em, { children: "without rendering it" }),
			" — a second, non-canvas consumer of the named\ngraduation path, which strengthens the pin (the stream must serve a\nbyte-watcher and a renderer from one subscription discipline)."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "across-padikaval-restarts",
			children: "Across padi/kaval restarts"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The daemons own durability; the MCP face owes agents ",
			createVNode(_components.em, { children: "honesty about the seam" }),
			".\nWhat actually survives, grounded in the contract:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "kaval recycle" }),
				" (",
				createVNode(_components.code, { children: "lifecycle.recycleKaval" }),
				", padiSurface 1.1) is\n",
				createVNode(_components.em, { children: "session-preserving by definition" }),
				" — terminals and their PTYs survive; the\nbrowser shows a warming canvas and re-attaches. An agent’s terminal ids stay\nvalid; at most a ",
				createVNode(_components.code, { children: "status" }),
				"/",
				createVNode(_components.code, { children: "activity" }),
				" transition is visible."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "padi restart" }),
				" is the warm path the process split exists for\n(warm-across-restart metadata, ",
				createVNode(_components.code, { children: "padi.mdx" }),
				"): kaval keeps holding the PTYs,\nthe restarted padi re-binds them, ids stay valid. What ",
				createVNode(_components.em, { children: "breaks" }),
				" is the\ntransport: the unix socket endpoint dies — and the socket path is\n",
				createVNode(_components.strong, { children: "digest-keyed" }),
				" (",
				createVNode(_components.code, { children: "resolveRunningPadiSocket" }),
				"), so an upgraded padi listens\nat a ",
				createVNode(_components.em, { children: "different" }),
				" path. Redial is re-",
				createVNode(_components.em, { children: "resolve" }),
				" + dial, not retry-same-path."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "The MCP face’s discipline across that gap, in order:" }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["Streams blip → ", createVNode(_components.code, { children: "STREAM_RETRY" })] }),
				" (already mounted on the one client)\nresubscribes transparently; surface consumption is snapshot-then-delta, so\na resubscribe re-seeds each resource with a fresh snapshot — MCP\nsubscribers get an ",
				createVNode(_components.code, { children: "updated" }),
				" notification per resource, never a spliced\ndelta across generations."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Socket death → bounded re-resolve + redial" }),
				", then the same handshake a\ncold dial runs: control-core ",
				createVNode(_components.code, { children: "hello" }),
				" + ",
				createVNode(_components.code, { children: "assertPadiSurfaceCompatible" }),
				". A\nrestarted padi that no longer speaks our contract ",
				createVNode(_components.strong, { children: "fails the gate loudly\nand the MCP server exits with that error" }),
				" — it never keeps serving a\nsurface it can’t honestly represent (fail-fast; no silent degradation)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Tools during the gap fail fast, typed, retryable" }),
				" — a ",
				createVNode(_components.code, { children: "create" }),
				" or\n",
				createVNode(_components.code, { children: "sendInput" }),
				" while disconnected returns an explicit\ntransport-down error the agent can retry; nothing queues locally (a queued\nmutation replayed against a new daemon generation is exactly the\ntwo-clocks bug SR9/LIVE-FIX exist to prevent)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Generations are visible, never spliced" }),
				": padi’s ",
				createVNode(_components.code, { children: "identity" }),
				" cell carries\nits boot time and build commit; it is exposed read-only via the ",
				createVNode(_components.code, { children: "status" }),
				"\nresource story so an agent (or its human) can ",
				createVNode(_components.em, { children: "see" }),
				" “the daemon restarted\nunder me” instead of inferring it from weirdness. The restart is data, not\nan anomaly."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "The pin for this section rides the e2e (step 9): mid-attach and mid-subscribe,\nrecycle kaval and restart padi; assert ids survive, resources re-seed, the\nin-gap tool call fails typed, and the compat-gate failure path exits loudly." }),
		"\n",
		createVNode(_components.h2, {
			id: "architecture-level-changes",
			children: "Architecture-level changes"
		}),
		"\n",
		createVNode($$Svg, {
			svg: kolu_cli_arch_default,
			caption: "The CLI faces: tui + mcp over one surfaceClient, two transports, zero kolu-server. kaval stays behind padi."
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"A pure ",
					createVNode(_components.code, { children: "padiSurface" }),
					" client."
				] }),
				" The load-bearing grounding: ",
				createVNode(_components.code, { children: "terminalAttach" }),
				"\nis a ",
				createVNode(_components.code, { children: "padiSurface" }),
				" collection — terminal byte streams ride the surface\nitself. So the CLI client needs ",
				createVNode(_components.strong, { children: "no kaval import and no kolu app import" }),
				"; its\ndependencies are ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				" (client), ",
				createVNode(_components.code, { children: "@kolu/surface-mcp" }),
				", and\n",
				createVNode(_components.code, { children: "@kolu/padi" }),
				"’s surface ",
				createVNode(_components.em, { children: "definition" }),
				" (the contract module kolu-server already\nimports). This keeps padi’s restart hash clean of app churn — the arrow rule\n",
				createVNode(_components.code, { children: "padi.mdx" }),
				" records (the second frontend exists to prove padi needs no kolu) is\nhonored by construction."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The graduation criterion, owned here" }),
				" (moved from ",
				createVNode(_components.code, { children: "padi.mdx" }),
				", which now\nlinks): the unit of done is ",
				createVNode(_components.strong, { children: "the named path" }),
				" — ",
				createVNode(_components.code, { children: "padiSurface" }),
				" consumed\nthrough ",
				createVNode(_components.code, { children: "surfaceClient" }),
				", ",
				createVNode(_components.em, { children: [
					"including the ",
					createVNode(_components.code, { children: "terminalAttach" }),
					" ",
					createVNode(_components.code, { children: "{seq}" }),
					" stream"
				] }),
				",\nover ",
				createVNode(_components.strong, { children: "both" }),
				" transports (unix socket and ssh stdio), rendering a live\ncanvas. A feature built any other way (raw mirror iteration, a value-bearing\ncell read) satisfies the words and proves nothing — the pin below can only\ngo green through the real path."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Boundary verdict, conditioned on the build" }),
				" (the loop, not a waterfall):\nthe CLI faces are ",
				createVNode(_components.strong, { children: "leaf app packages" }),
				" (",
				createVNode(_components.code, { children: "packages/kolu-mcp" }),
				", ",
				createVNode(_components.code, { children: "packages/kolu-tui" }),
				"), not electricity —\n",
				createVNode(_components.em, { children: "because" }),
				" the renderer is raw ANSI with no engine dependency (decision\nbelow) and every hard volatility it touches (transport, reconnect, stream\nretry, MCP lifecycle) already lives in its receptacle (",
				createVNode(_components.code, { children: "@kolu/surface" }),
				",\n",
				createVNode(_components.code, { children: "@kolu/surface-mcp" }),
				"). If the renderer choice ever escalates to an engine\nowning alternate-screen/context-loss recovery, that engine wrapper — not\nkolu-cli — would be the extraction candidate."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Transport = the seams that already exist — nothing hand-rolled." }),
				" Local:\n",
				createVNode(_components.code, { children: "resolveRunningPadiSocket" }),
				" (",
				createVNode(_components.code, { children: "@kolu/padi/dial" }),
				") resolves, ",
				createVNode(_components.code, { children: "connectPadi" }),
				" dials\n(handshake + compatibility gate). ssh: ",
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "dialAgentOnce" }),
					" from\n",
					createVNode(_components.code, { children: "@kolu/surface-remote" })
				] }),
				" — the same one-shot dial both sibling TUIs’ 15–24\nline ",
				createVNode(_components.code, { children: "hostConnect.ts" }),
				" wrappers already consume; kolu-cli writes its own thin\noptions literal and nothing else.",
				createVNode($$Footnote, { children: [
					"An earlier draft said “not\n",
					createVNode(_components.code, { children: "@kolu/surface-remote" }),
					"” — the lens run confirmed that contradicts the actual\nshape: the ssh-stdio dial ",
					createVNode(_components.em, { children: "is" }),
					" ",
					createVNode(_components.code, { children: "surface-remote" }),
					"’s ",
					createVNode(_components.code, { children: "dialAgentOnce" }),
					", and both\nTUIs use it. What stays out is the rest of surface-remote (provision,\nrealise, reconnect supervision — kolu-server’s session machinery): the CLI faces\ndial a padi that already runs and fails fast otherwise. A pre-lifted\n",
					createVNode(_components.code, { children: "connectPadiViaHost" }),
					" composition was proposed and REFUTED — padi-tui’s\nwrapper carries padi-specific probe/scoping the CLI client may diverge from;\ncompose in-app, extract only if a byte-identical twin actually emerges."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				"One ",
				createVNode(_components.code, { children: "surfaceClient" }),
				", ",
				createVNode(_components.code, { children: "STREAM_RETRY" }),
				" mounted."
			] }), " The flaky-tracker’s #1827\nlesson binds: a raw client without the retry plugin flakes on\nattach-vs-reconnect races that production consumers survive. The CLI client mounts\nthe same plugin production mounts — both faces share the one client, so the\nMCP face inherits it."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "escape.ts" }),
					" graduates to ",
					createVNode(_components.code, { children: "@kolu/terminal-protocol" }),
					" in this PR"
				] }),
				" (confirmed\nby both lenses): kaval-tui’s 143-line line-start escape scanner (",
				createVNode(_components.code, { children: "~." }),
				" / ",
				createVNode(_components.code, { children: "~~" }),
				"\n/ ",
				createVNode(_components.code, { children: "~?" }),
				", bracketed-paste-suspended) is protocol policy with zero transport\ncoupling — its only import is already ",
				createVNode(_components.code, { children: "@kolu/terminal-protocol" }),
				", and the tui face\nis the second ",
				createVNode(_components.em, { children: "verbatim" }),
				" consumer, which is that package’s exact birth\ncondition (it was created when kaval-tui made the same concept fragment\nacross three modules). Move the file, point kaval-tui at the export, consume\nfrom kolu-cli — a copy here would be two lockstep owners of a detach grammar."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The attach passthrough scaffold is a PORT, not an extraction" }),
				" (confirmed):\nkaval-tui’s ",
				createVNode(_components.code, { children: "attach.ts" }),
				" pattern (ordered write queue, snapshot-first-frame,\nresize-then-attach, tty-less test harness via the ",
				createVNode(_components.code, { children: "AttachTty" }),
				" seam) carries\nover, but its call sites bind kaval’s ",
				createVNode(_components.code, { children: "ptyHostSurface" }),
				" members while the tui face\nrides ",
				createVNode(_components.code, { children: "padiSurface" }),
				" — non-verbatim twins. No ",
				createVNode(_components.code, { children: "@kolu/tui-kit" }),
				" receptacle now;\nthe recorded gate: after the tui face’s loop lands, diff the two scaffolds — if\nthey’re identical modulo an injected ops object, that diff IS the extraction\nspec and the receptacle earns itself then."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "From the herdr study, adopted at the architecture level" }),
				" (herdr = a Rust\nagent multiplexer whose daemon owns every VT state — the same server-owns-\nstate shape as padiSurface, independently arrived at, which is the strongest\navailable validation of the thin render-only client): per-pane damage\ntracking (an idle preview costs one clean-check; only changed rows repaint);\na single dirty-flag + ~16ms coalescing render loop (N noisy panes → at most\none repaint per frame; first-producer-notifies dedup); each composite frame\nwrapped in synchronized-output ",
				createVNode(_components.code, { children: "DECSET ?2026" }),
				" (no tearing, RAII-style\nbegin/end); ",
				createVNode(_components.strong, { children: "the direct-attach resize lock" }),
				" (while a terminal is attached\nfull-screen it owns its PTY geometry — the grid’s resize path must yield, or\nlayout and attach thrash the child); previews stay LIVE and pre-sized, never\npaused — throttle their repaint rate, never their input; and scroll events\nin attach mode drive the server-side viewport rather than forwarding to the\nchild (except when the child requested mouse mode)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "implementation-details",
			children: "Implementation details"
		}),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Two PRs — a real sequencing constraint, not staging." }), createVNode($$Footnote, { children: "An earlier\ndraft said one PR; the skill-parity contract changed the calculus. PR1’s\ndeliverable is independently valuable the day it merges — the /orchestrator\nand /kolu skills gain their MCP path with CLI fallback — and it carries none\nof the canvas’s renderer/attach risk. Each PR has its own complete pin, so\nneither is staging for appearance." })] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "PR1 — the CLI restructure" }),
				" (srid’s sequencing + placement): the ",
				createVNode(_components.code, { children: "kolu" }),
				"\nbin MOVES to a new ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "packages/kolu-cli" }) }),
				" — the composition root owning\ncleye subcommand dispatch — and ",
				createVNode(_components.code, { children: "packages/server" }),
				" stops being the bin,\nexporting its boot as a function the ",
				createVNode(_components.code, { children: "web" }),
				" arm calls (dispatch in\npackages/server would braid the product’s argv face with the web server’s\nboot; the volatility is in the set of faces, and only a dedicated package\nencapsulates it). ",
				createVNode(_components.code, { children: "kolu web" }),
				" names today’s behavior, bare ",
				createVNode(_components.code, { children: "kolu" }),
				" stays its\nalias (byte-for-byte: same flags, same boot), ",
				createVNode(_components.code, { children: "tui" }),
				"/",
				createVNode(_components.code, { children: "mcp" }),
				" reserved with a\nclear not-yet-shipped error. The nix ",
				createVNode(_components.code, { children: "koluBin" }),
				" entry moves with the bin.\nPin: bare ",
				createVNode(_components.code, { children: "kolu" }),
				" and ",
				createVNode(_components.code, { children: "kolu web" }),
				" behaviorally identical (flag matrix test) +\nthe reserved subcommands fail with the named message. A composition root is\nthe one module allowed to import everything — kolu-cli importing\npackages/server is main() doing its job, not a leak."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "PR2 — the MCP face" }),
				" (",
				createVNode(_components.code, { children: "kolu mcp" }),
				"): new ",
				createVNode(_components.code, { children: "packages/kolu-mcp" }),
				" (manifest =\nthe fence: padi/surface deps only) exporting the serve-function over an\ninjected client; kolu-cli gains the connect layer (both transports, the one\n",
				createVNode(_components.code, { children: "surfaceClient" }),
				" + ",
				createVNode(_components.code, { children: "STREAM_RETRY" }),
				") and the ",
				createVNode(_components.code, { children: "mcp" }),
				" arm; ",
				createVNode(_components.code, { children: "serveSurfaceAsMcp" }),
				" +\nthe expose map, the composite ",
				createVNode(_components.code, { children: "wait.*" }),
				" tools (extracting the shared\nWaitOutcome scaffold — the third consumer), the restart discipline. Its pin: the headless leg of step\n9 — create → sendInput → wait.outputSettled (the ",
				createVNode(_components.code, { children: "{seq}" }),
				" stream, watched\nnot rendered) → screen.text → kill, over BOTH transports, plus the restart\nlegs. This already exercises most of the graduation path, headlessly. The\n/orchestrator and /kolu skills can adopt MCP-first-CLI-fallback the day\nthis merges."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "PR3 — the canvas" }),
				" (",
				createVNode(_components.code, { children: "kolu tui" }),
				"): new ",
				createVNode(_components.code, { children: "packages/kolu-tui" }),
				" (same\nmanifest-fence), taking the injected client from kolu-cli’s ",
				createVNode(_components.code, { children: "tui" }),
				" arm:\nrenderer, attach loop, ",
				createVNode(_components.code, { children: "escape.ts" }),
				" graduation (attach-scoped, so it rides\nthis PR), create/kill gestures, navigator/rail. Its pin: the rendering leg of step 9 — the live canvas\nover the same path."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"The binary is ",
				createVNode(_components.code, { children: "kolu" }),
				", not a new ",
				createVNode(_components.code, { children: "kolu-tui" }),
				" executable"
			] }),
			" (ratified): today’s\n",
			createVNode(_components.code, { children: "kolu" }),
			" cleye definition has flags and NO subcommands, so the namespace is\nfree — ",
			createVNode(_components.code, { children: "kolu tui" }),
			" opens the canvas, ",
			createVNode(_components.code, { children: "kolu mcp" }),
			" serves agents, and bare ",
			createVNode(_components.code, { children: "kolu" }),
			"\nkeeps meaning what it means today (the web server). Three packages, each a\nleaf in the house per-app style (",
			createVNode(_components.code, { children: "padi-tui" }),
			"/",
			createVNode(_components.code, { children: "kaval-tui" }),
			"/",
			createVNode(_components.code, { children: "pulam-tui" }),
			" precedent):\n",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "packages/kolu-cli" }) }),
			" — the bin + cleye dispatch, the composition root that\nmay import everything (it resolves the padi socket, dials, mounts\n",
			createVNode(_components.code, { children: "STREAM_RETRY" }),
			", and boots whichever face); ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "packages/kolu-mcp" }) }),
			" and\n",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "packages/kolu-tui" }) }),
			" — the faces, each exporting a run-function that takes\nthe ",
			createVNode(_components.strong, { children: "injected, already-connected client" }),
			" (",
			createVNode(_components.code, { children: "serveSurfaceAsMcp" }),
			" already takes\na live-client factory, so the mcp face owns zero connect code). The\ngraduation fence is STRUCTURAL, not tested: the face packages’ manifests\nsimply do not list any kolu app package, so the illegal import is a\nmissing-dependency build error — unrepresentable beats detected.",
			createVNode($$Footnote, { children: "An\nearlier draft kept the faces inside kolu-cli behind a module-level\nimport-guard test. Rejected on the repo’s own doctrine: that test guards a\nstructure that permits the violation, where separate manifests make it\nunspellable — and the per-app-package norm means the split costs nothing. It\nalso makes the recorded escape hatch (a standalone MCP artifact for padi-only\nhosts) a trivial bin target on an existing package." }),
			" The graduation proof is about\nthe RUNTIME path — no kolu-server ",
			createVNode(_components.em, { children: "process" }),
			" behind ",
			createVNode(_components.code, { children: "kolu tui" }),
			"/",
			createVNode(_components.code, { children: "kolu mcp" }),
			" —\nnot the shipping closure; ",
			createVNode(_components.code, { children: "p2p-kolu.mdx" }),
			" already records this client shipping\nin-closure.",
			createVNode($$Footnote, { children: [
				"The one cost: a padi-only remote host wanting a local\n",
				createVNode(_components.code, { children: "kolu mcp" }),
				" pulls the kolu closure. Demand-gated escape hatch, recorded not\nbuilt: a thin standalone bin target for the CLI package if that host profile\never materializes."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: "Steps, in build order (PR1 = the kolu-cli package + dispatch + boot-function extraction; PR2 = steps 1–3 + 8; PR3 = the rest):" }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Face packages, not face modules" }),
				": ",
				createVNode(_components.code, { children: "packages/kolu-mcp" }),
				" (PR2) and\n",
				createVNode(_components.code, { children: "packages/kolu-tui" }),
				" (PR3), each exporting a run-function over an injected\nclient; the connect layer (resolve + dial + ",
				createVNode(_components.code, { children: "STREAM_RETRY" }),
				") lives in\nkolu-cli, the composition root."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Connect" }),
				": local socket resolution via ",
				createVNode(_components.code, { children: "resolveRunningPadiSocket" }),
				" +\n",
				createVNode(_components.code, { children: "connectPadi" }),
				" (",
				createVNode(_components.code, { children: "@kolu/padi/dial" }),
				" — the resolution never lived in\n",
				createVNode(_components.code, { children: "connect.ts" }),
				"; the TUIs’ connect files only dial an already-resolved path);\n",
				createVNode(_components.code, { children: "--host" }),
				" via a thin ",
				createVNode(_components.code, { children: "dialAgentOnce" }),
				" options wrapper (",
				createVNode(_components.code, { children: "@kolu/surface-remote" }),
				",\nthe sibling ",
				createVNode(_components.code, { children: "hostConnect.ts" }),
				" shape). Build the one ",
				createVNode(_components.code, { children: "surfaceClient" }),
				" with\n",
				createVNode(_components.code, { children: "STREAM_RETRY" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Canvas model" }),
				": subscribe ",
				createVNode(_components.code, { children: "terminals" }),
				" + ",
				createVNode(_components.code, { children: "urgency" }),
				" + ",
				createVNode(_components.code, { children: "status" }),
				"; derive the\ntile grid purely from the collection (no local arrangement state — the\narrangement lives on the host, same as the browser)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Renderer" }),
				": raw ANSI to the alternate screen — ",
				createVNode(_components.strong, { children: "no OpenTUI, no Bun" }),
				"\n(the ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" shed-the-engine precedent binds; a TUI engine is the one\ndependency that could flip the boundary verdict above). The in-repo idiom\nto build on is ",
				createVNode(_components.code, { children: "kaval-tui/attach.ts" }),
				" (",
				createVNode(_components.code, { children: "\\x1b[H\\x1b[2J" }),
				" + ",
				createVNode(_components.code, { children: "setRawMode" }),
				" —\nNOT ",
				createVNode(_components.code, { children: "render.ts" }),
				", which is a columnify table formatter with zero ANSI; the\nplan’s earlier citation was wrong). Structure per the herdr findings:\ndirty-flag + ~16ms coalesce loop, per-tile damage checks, ",
				createVNode(_components.code, { children: "?2026" }),
				"\nsynchronized-output around each composite frame."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Graduate the escape scanner" }),
				": move ",
				createVNode(_components.code, { children: "kaval-tui/escape.ts" }),
				" (verbatim,\n143 lines) into ",
				createVNode(_components.code, { children: "@kolu/terminal-protocol" }),
				", repoint kaval-tui, add nothing."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Attach loop" }),
				": full-screen passthrough pumping stdin → send intent and\n",
				createVNode(_components.code, { children: "terminalAttach" }),
				" ",
				createVNode(_components.code, { children: "{seq}" }),
				" frames → stdout; resize-then-attach, ordered write\nqueue, snapshot-first-frame, and exit-stream discrimination PORTED from\n",
				createVNode(_components.code, { children: "kaval-tui/attach.ts" }),
				" (call sites re-bound from ",
				createVNode(_components.code, { children: "ptyHostSurface" }),
				" members to\n",
				createVNode(_components.code, { children: "padiSurface" }),
				"’s; the ",
				createVNode(_components.code, { children: "AttachTty" }),
				" seam + tty-less test harness come along);\nthe detach chord consumed from the newly-graduated scanner. Honor the\ndirect-attach resize lock: attached tile owns geometry, grid yields."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "create/kill" }), " as canvas gestures calling the surface procedures; confirm\non kill."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "mcp" }), " subcommand"] }),
				": ",
				createVNode(_components.code, { children: "serveSurfaceAsMcp({ surface, client, expose })" }),
				" with\nan explicit default-deny expose map (resources: ",
				createVNode(_components.code, { children: "terminals" }),
				", ",
				createVNode(_components.code, { children: "screen" }),
				",\n",
				createVNode(_components.code, { children: "activity" }),
				", ",
				createVNode(_components.code, { children: "urgency" }),
				"; tools: create/kill/send, ",
				createVNode(_components.code, { children: "mutates: true" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The pin (e2e, red-if-broken)" }),
				": spawn a real padi, run ",
				createVNode(_components.code, { children: "kolu tui" }),
				"/",
				createVNode(_components.code, { children: "kolu mcp" }),
				" against\nit over the unix socket ",
				createVNode(_components.strong, { children: "and" }),
				" over ",
				createVNode(_components.code, { children: "ssh localhost" }),
				" — script: create a\nterminal through the canvas gesture, attach, assert bytes round-trip\nthrough the ",
				createVNode(_components.code, { children: "{seq}" }),
				" stream, kill, assert the tile leaves the canvas. This\ntest is the graduation proof; it cannot pass through any path but the\nnamed one."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Risks, named with mitigations:" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.em, { children: "Attach passthrough vs canvas rendering fight over the tty" }),
				" → strict modal\nsplit: canvas owns the alternate screen; attach tears it down before raw\nmode and restores after detach (the ",
				createVNode(_components.code, { children: "kaval-tui" }),
				" snapshot-reciprocal reset\nalready encodes the discipline — reuse, don’t rewrite)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.em, { children: [createVNode(_components.code, { children: "{seq}" }), " gaps under reconnect"] }),
				" → ",
				createVNode(_components.code, { children: "STREAM_RETRY" }),
				" from day one (step 2), and\nthe pin’s ssh leg kills the pipe mid-attach once to assert the re-subscribe\npath (that’s the #1827 class, pinned at the consumer this time)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.em, { children: "MCP stdio discipline vs canvas stdout" }),
				" → the two faces never share a\nprocess mode: ",
				createVNode(_components.code, { children: "mcp" }),
				" is its own subcommand, no canvas rendering; stdout is\nthe protocol channel (",
				createVNode(_components.code, { children: "@kolu/surface-mcp" }),
				" owns the discipline)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.em, { children: "padi.mdx drift" }),
				" → same PR edits ",
				createVNode(_components.code, { children: "padi.mdx" }),
				"’s future-work items to link\nhere (the criterion moves, one owner), and the §207 wait-helper upstream\nitem becomes actionable once this ships — recorded there as the follow-up,\ngated on this PR merging, not part of it."
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
	"title": "kolu CLI — web · tui · mcp, the binary's three faces",
	"description": "The kolu binary grows subcommands — kolu web (today's default), kolu tui (a tmux-like canvas), kolu mcp (the agent face) — the latter two pure padiSurface clients with no kolu-server, the graduation proof that padi serves a second frontend.",
	"parents": ["padi", "feature"],
	"status": "accepted",
	"maturity": "seedling",
	"updated": "2026-07-16T00:00:00.000Z"
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
			"slug": "the-mcp-face",
			"text": "The MCP face"
		},
		{
			"depth": 3,
			"slug": "skill-parity--the-orchestrator--kolu-migration-contract",
			"text": "Skill parity — the /orchestrator · /kolu migration contract"
		},
		{
			"depth": 3,
			"slug": "across-padikaval-restarts",
			"text": "Across padi/kaval restarts"
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
		}
	];
}
var url = "src/content/atlas/kolu-cli.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/kolu-cli.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/kolu-cli.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
