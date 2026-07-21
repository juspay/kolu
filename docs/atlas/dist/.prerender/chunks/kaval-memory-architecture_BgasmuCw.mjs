import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import "./Issue_mLFqCJSR.mjs";
import { t as $$Cite } from "./Cite_IypTixBQ.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
//#region src/diagrams/kaval-memory-architecture.svg?raw
var kaval_memory_architecture_default = "<svg viewBox=\"0 0 660 520\" width=\"100%\" role=\"img\" aria-label=\"One decoded PTY byte stream fans through a single synchronous tap to three sinks: a lightweight VT metadata parser, a small line-capped hot mirror, and a cold store. The cold store is a kaval-internal transcript leaf that frames typed DATA/RESIZE/CKPT records and persists them through @kolu/shared/sqlite — node:sqlite in WAL mode, the repo's canonical embedded store, one DB per PTY — rather than a hand-rolled storage engine. The browser attaches against the small mirror for a bounded snapshot plus live deltas, and lazily backfills deep history from the transcript by byte-offset cursor.\" style=\"max-width:660px;font:13px ui-sans-serif,system-ui,sans-serif\">\n  <defs>\n    <marker id=\"kmaArrow\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"var(--ink-muted,#8a8f98)\" />\n    </marker>\n    <marker id=\"kmaHot\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"var(--good-stroke,#15803D)\" />\n    </marker>\n    <marker id=\"kmaCold\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"var(--struct-stroke,#0D32B2)\" />\n    </marker>\n  </defs>\n\n  <!-- kaval boundary -->\n  <rect x=\"12\" y=\"78\" width=\"636\" height=\"250\" rx=\"12\" fill=\"none\" stroke=\"var(--ink-muted,#b6bcc6)\" stroke-width=\"1.3\" stroke-dasharray=\"5 5\" />\n  <text x=\"24\" y=\"98\" font-size=\"10.5\" font-weight=\"700\" fill=\"var(--ink-muted,#8a8f98)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">kaval daemon (process)</text>\n\n  <!-- Source -->\n  <rect x=\"244\" y=\"12\" width=\"176\" height=\"46\" rx=\"8\" fill=\"var(--surface,#F7F8FE)\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"1.5\" />\n  <text x=\"332\" y=\"34\" text-anchor=\"middle\" font-weight=\"700\" fill=\"var(--ink,#11203a)\">PTY child (node-pty)</text>\n  <text x=\"332\" y=\"50\" text-anchor=\"middle\" font-size=\"11\" fill=\"var(--struct-sub,#4A5072)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">decoded chunk</text>\n\n  <!-- One tap -->\n  <path d=\"M332 58 L332 110\" fill=\"none\" stroke=\"var(--ink-muted,#8a8f98)\" stroke-width=\"2\" marker-end=\"url(#kmaArrow)\" />\n  <text x=\"342\" y=\"76\" font-size=\"10.5\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">proc.onData — one synchronous tap</text>\n\n  <!-- Fan-out arrows -->\n  <path d=\"M332 112 L130 158\" fill=\"none\" stroke=\"var(--ink-muted,#8a8f98)\" stroke-width=\"1.5\" marker-end=\"url(#kmaArrow)\" />\n  <path d=\"M332 112 L332 158\" fill=\"none\" stroke=\"var(--good-stroke,#15803D)\" stroke-width=\"2.5\" marker-end=\"url(#kmaHot)\" />\n  <path d=\"M332 112 L536 158\" fill=\"none\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"1.5\" marker-end=\"url(#kmaCold)\" />\n\n  <!-- LEFT: VT metadata parser (leaf) -->\n  <rect x=\"28\" y=\"160\" width=\"186\" height=\"84\" rx=\"8\" fill=\"var(--surface,#F7F8FE)\" stroke=\"var(--ink-muted,#8a8f98)\" stroke-width=\"1.5\" />\n  <text x=\"121\" y=\"182\" text-anchor=\"middle\" font-weight=\"700\" font-size=\"12\" fill=\"var(--ink,#1a1d21)\">VT metadata parser</text>\n  <text x=\"121\" y=\"201\" text-anchor=\"middle\" font-size=\"10\" fill=\"var(--ink-muted,#6b7280)\">OSC 7 / 0·2 / 633 · device-query</text>\n  <text x=\"121\" y=\"215\" text-anchor=\"middle\" font-size=\"10\" fill=\"var(--ink-muted,#6b7280)\">→ cwd / title / command channels</text>\n  <text x=\"121\" y=\"234\" text-anchor=\"middle\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">job 1 — leaf</text>\n\n  <!-- CENTER: hot mirror (small, good) -->\n  <rect x=\"240\" y=\"160\" width=\"186\" height=\"84\" rx=\"8\" fill=\"var(--good-fill,#eff6f0)\" stroke=\"var(--good-stroke,#15803D)\" stroke-width=\"2.5\" />\n  <text x=\"333\" y=\"182\" text-anchor=\"middle\" font-weight=\"700\" font-size=\"12\" fill=\"var(--ink,#1a1d21)\">hot mirror — SMALL</text>\n  <text x=\"333\" y=\"201\" text-anchor=\"middle\" font-size=\"10\" fill=\"var(--good-text,#166534)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">byte-budgeted xterm</text>\n  <text x=\"333\" y=\"215\" text-anchor=\"middle\" font-size=\"10\" fill=\"var(--good-text,#166534)\">viewport + cushion · never reaped</text>\n  <text x=\"333\" y=\"234\" text-anchor=\"middle\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--good-text,#166534)\">jobs 2 + 4 — snapshot source</text>\n\n  <!-- RIGHT: transcript leaf (kaval) framing records -->\n  <rect x=\"452\" y=\"160\" width=\"186\" height=\"84\" rx=\"8\" fill=\"var(--surface,#EDF0FD)\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"1.5\" />\n  <text x=\"545\" y=\"182\" text-anchor=\"middle\" font-weight=\"700\" font-size=\"12\" fill=\"var(--ink,#11203a)\">transcript/ leaf</text>\n  <text x=\"545\" y=\"201\" text-anchor=\"middle\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">frames DATA · RESIZE · CKPT</text>\n  <text x=\"545\" y=\"215\" text-anchor=\"middle\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\">VT-specific · in kaval</text>\n  <text x=\"545\" y=\"234\" text-anchor=\"middle\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--struct-sub,#4A5072)\">job 3 — deep history</text>\n\n  <!-- arrow from leaf into the reused store -->\n  <path d=\"M545 244 L545 360\" fill=\"none\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"2.5\" marker-end=\"url(#kmaCold)\" />\n  <text x=\"555\" y=\"300\" font-size=\"10\" font-weight=\"600\" fill=\"var(--struct-stroke,#0D32B2)\">withDb() · WAL append</text>\n  <text x=\"555\" y=\"314\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--struct-sub,#4A5072)\">reuses the repo's store</text>\n\n  <!-- REUSED STORE: node:sqlite via @kolu/shared/sqlite (cylinder, outside kaval box) -->\n  <path d=\"M460 366 a85 13 0 0 0 170 0 v94 a85 13 0 0 1 -170 0 z\" fill=\"var(--surface,#EDF0FD)\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"2.5\" />\n  <ellipse cx=\"545\" cy=\"366\" rx=\"85\" ry=\"13\" fill=\"var(--surface,#F7F8FE)\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"2.5\" />\n  <text x=\"545\" y=\"396\" text-anchor=\"middle\" font-weight=\"700\" font-size=\"12\" fill=\"var(--ink,#11203a)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">node:sqlite (WAL)</text>\n  <text x=\"545\" y=\"412\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">via @kolu/shared/sqlite — canonical</text>\n  <text x=\"545\" y=\"427\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">index · durability · range · retention</text>\n  <text x=\"545\" y=\"442\" text-anchor=\"middle\" font-size=\"9\" fill=\"var(--struct-sub,#4A5072)\">one DB per PTY · on disk</text>\n\n  <!-- hot path to client -->\n  <path d=\"M333 244 L333 458\" fill=\"none\" stroke=\"var(--good-stroke,#15803D)\" stroke-width=\"2.5\" marker-end=\"url(#kmaHot)\" />\n  <text x=\"220\" y=\"350\" font-size=\"10.5\" font-weight=\"600\" fill=\"var(--good-text,#166534)\">attach(): bounded</text>\n  <text x=\"220\" y=\"365\" font-size=\"10.5\" fill=\"var(--good-text,#166534)\">snapshot + live deltas</text>\n\n  <!-- cold lazy backfill to client -->\n  <path d=\"M460 430 Q400 450 392 458\" fill=\"none\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"1.5\" stroke-dasharray=\"6 4\" marker-end=\"url(#kmaCold)\" />\n  <text x=\"300\" y=\"437\" text-anchor=\"middle\" font-size=\"10\" font-style=\"italic\" fill=\"var(--struct-sub,#4A5072)\">getLines(stableRow) — lazy, current width</text>\n\n  <!-- Client -->\n  <rect x=\"182\" y=\"464\" width=\"300\" height=\"48\" rx=\"8\" fill=\"var(--surface,#F7F8FE)\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"1.5\" />\n  <text x=\"332\" y=\"485\" text-anchor=\"middle\" font-weight=\"700\" fill=\"var(--ink,#11203a)\">browser xterm</text>\n  <text x=\"332\" y=\"502\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"var(--struct-sub,#4A5072)\">keeps its own 50 K visible scrollback</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/kaval-memory-architecture.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		h4: "h4",
		hr: "hr",
		li: "li",
		ol: "ol",
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
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Companion to the ",
			createVNode(_components.a, {
				href: "./kaval-heap-oom.html",
				children: "kaval heap-OOM RCA"
			}),
			". That note bounded the ",
			createVNode(_components.strong, { children: "chronic" }),
			" crash; a live look at production (kaval reported at ",
			createVNode(_components.strong, { children: "4740 MB" }),
			", draining to ~600 MB over minutes) surfaced a second, ",
			createVNode(_components.strong, { children: "acute" }),
			" failure it had filed as a red herring. Reproduced on a clean box with the prod versions (",
			createVNode(_components.code, { children: "@xterm/headless@6.0.0" }),
			"). This is the plan to end both."
		] }) }),
		"\n",
		createVNode(_components.p, { children: "Three terms up front, because the rest leans on them:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "mirror" }),
				" — kaval’s own in-memory copy of a terminal’s screen. It’s a ",
				createVNode(_components.em, { children: "headless" }),
				" (display-less) ",
				createVNode(_components.code, { children: "@xterm/headless" }),
				" terminal that replays the exact bytes the real PTY emitted, so the server always knows what’s on screen even when no browser is watching. Today it retains a 10 K-line scrollback (",
				createVNode($$Cite, {
					file: "packages/kaval/src/ptyHost.ts",
					label: "ptyHost.ts:52"
				}),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "attach()" }) }),
				" — the call a client makes to start viewing a terminal (",
				createVNode($$Cite, {
					file: "packages/kaval/src/ptyHostSurface.ts",
					label: "ptyHostSurface.ts"
				}),
				"). Kaval hands back a one-shot ",
				createVNode(_components.strong, { children: "snapshot" }),
				" of the current screen (today, the whole mirror serialized to ANSI, ",
				createVNode($$Cite, {
					file: "packages/kaval/src/ptyHost.ts",
					label: "ptyHost.ts:661"
				}),
				"), then streams live output as ",
				createVNode(_components.strong, { children: "deltas" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "reconnect storm" }),
				" — when a client’s WebSocket drops and comes back, it re-",
				createVNode(_components.code, { children: "attach()" }),
				"es to ",
				createVNode(_components.em, { children: "every" }),
				" open terminal at once, and the in-flight attaches it aborted get reissued: a burst of dozens of ",
				createVNode(_components.code, { children: "attach()" }),
				" calls — and dozens of full-mirror serializes — in one moment."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"That single mirror is quietly doing ",
			createVNode(_components.strong, { children: "four unrelated jobs" }),
			": ① a live VT emulator that answers device queries (XTVERSION, DA1/DSR) and scrapes OSC metadata (cwd / title / command); ② the ",
			createVNode(_components.strong, { children: "viewport" }),
			" a freshly-attaching client repaints; ③ the ",
			createVNode(_components.strong, { children: "deep scrollback" }),
			" kept for PDF export, search, and scroll-back; ④ the ",
			createVNode(_components.strong, { children: "wire snapshot" }),
			", serialized to ANSI on every ",
			createVNode(_components.code, { children: "attach()" }),
			". Jobs ② and ④ drive the ",
			createVNode(_components.em, { children: "acute" }),
			" spike; job ③ drives the ",
			createVNode(_components.em, { children: "chronic" }),
			" growth — two distinct failures:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, {}),
					"\n",
					createVNode(_components.th, { children: createVNode(_components.strong, { children: "Acute transient" }) }),
					"\n",
					createVNode(_components.th, { children: createVNode(_components.strong, { children: "Chronic growth" }) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Cause" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "attach()" }), " serializes the whole mirror (job ④); a reconnect storm fires ~60 at once"] }),
					"\n",
					createVNode(_components.td, { children: "the mirror’s deep scrollback (job ③) × an ever-growing terminal count — heap is linear in live-terminal count; terminals are never reaped" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Measured" }),
					"\n",
					createVNode(_components.td, { children: [
						"6 concurrent reconnect rounds (60 serializes) → ",
						createVNode(_components.strong, { children: "2.0 GB" }),
						"; 40 rounds → ",
						createVNode(_components.strong, { children: "3.2 GB" }),
						"; drains over minutes (V8 idle reducer)"
					] }),
					"\n",
					createVNode(_components.td, { children: ["climbs to the ~4 GB ceiling over days → ", createVNode(_components.code, { children: "SIGABRT" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Fix" }),
					"\n",
					createVNode(_components.td, { children: [
						"two ",
						createVNode(_components.strong, { children: "kaval-only" }),
						" changes defang it (PR1); the snapshot bound finishes it in PR2 — no reload-history loss"
					] }),
					"\n",
					createVNode(_components.td, { children: "the on-disk transcript owns deep history; the mirror shrinks to screen-size" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "user-facing-description",
			children: "User-facing description"
		}),
		"\n",
		createVNode(_components.p, { children: "Nothing the user clicks changes. The effects are all in the negative space — what stops happening — plus making deep history honest:" }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Today" }),
					"\n",
					createVNode(_components.th, { children: "After" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["Terminals get laggier the longer the server is up; a reconnect can spike kolu by ", createVNode(_components.strong, { children: "2–3 GB" })] }),
					"\n",
					createVNode(_components.td, { children: "flat memory; reconnect costs tens of KB, not gigabytes" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "kaval OOM-crashes every few days, restarting the server under you" }),
					"\n",
					createVNode(_components.td, { children: "the linear-in-count growth is gone — no scheduled death" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Deep scrollback / PDF export / search read the ",
						createVNode(_components.strong, { children: "client’s" }),
						" buffer; lost on a cold reconnect"
					] }),
					"\n",
					createVNode(_components.td, { children: "served losslessly from disk, surviving server restarts and updates" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "architecture-level-changes",
			children: "Architecture-level changes"
		}),
		"\n",
		createVNode(_components.p, { children: "The root fix is splitting that one over-loaded mirror so each of the four jobs lands where it belongs:" }),
		"\n",
		createVNode($$Svg, {
			svg: kaval_memory_architecture_default,
			caption: "One decoded byte stream, one synchronous tap (proc.onData), fanned to: a VT metadata parser (job ①, a leaf), a small line-capped hot mirror (jobs ② + ④ — the O(1) no-disk snapshot source), and a cold store for job ③. The cold store is a kaval-internal transcript/ leaf that frames the typed DATA/RESIZE/CKPT records and persists them through @kolu/shared/sqlite (node:sqlite, WAL) — the repo's canonical store, not a hand-rolled engine. The client attaches against the small mirror for a bounded snapshot + live deltas, and lazily backfills deep history from the transcript by byte-offset cursor, rendered at the current width."
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Jobs ① + ② + ④ → the hot mirror, made small." }),
				" Keep a real headless mirror — it stays the VT emulator (job ①, device-query replies + OSC scraping) and the cheap O(1) snapshot source a storm can serialize (jobs ② + ④) — sized to ",
				createVNode(_components.strong, { children: "a small line count" }),
				" (",
				createVNode(_components.code, { children: "rows" }),
				" + the deepest screen-scrape tail any reader asks for). It stays xterm’s ",
				createVNode(_components.strong, { children: "native scrollback ring" }),
				" — ",
				createVNode(_components.em, { children: "not" }),
				" a hand-rolled byte-cap: trimming the ring ourselves would reinvent the maintained source-of-truth for a sub-1 MB gain. (Capping by ",
				createVNode(_components.em, { children: "bytes" }),
				" is the transcript’s job — unbounded output volume; capping by ",
				createVNode(_components.em, { children: "a few lines" }),
				" is the mirror’s — screen size.) An idle terminal becomes near-free, without touching the survivability guarantee (terminals freed only on child-exit / user-kill)."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Job ③ → the cold on-disk transcript." }), " Deep scrollback (the reason PDF export, search, restore, and forensics ever needed depth) leaves the heap entirely for a per-PTY append-only store on disk."] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "“Raw PTY bytes” is NOT a lossless source — the correction that shapes the log",
			children: [
				createVNode(_components.p, { children: [
					"The RCA’s cold store is ",
					createVNode(_components.em, { children: "“append-only raw PTY bytes.”" }),
					" Wrong two ways: ",
					createVNode(_components.strong, { children: "resizes are out-of-band" }),
					" — kaval calls ",
					createVNode(_components.code, { children: "headless.resize()" }),
					" (",
					createVNode($$Cite, {
						file: "packages/kaval/src/ptyHost.ts",
						label: "ptyHost.ts:756-766"
					}),
					"), never in the byte stream, yet it governs reflow; replay a flat log at one width and historical spans re-wrap wrong. And ",
					createVNode(_components.strong, { children: "node-pty hands kaval a decoded string" }),
					" (",
					createVNode($$Cite, {
						file: "packages/kaval/src/ptyHost.ts",
						label: "ptyHost.ts:622"
					}),
					"), no more lossless than the mirror. So the transcript stores ",
					createVNode(_components.strong, { children: "typed records" }),
					" (rows; ",
					createVNode(_components.code, { children: "bytes" }),
					"/",
					createVNode(_components.code, { children: "vtState" }),
					" are zstd BLOBs), not a byte dump:"
				] }),
				createVNode(_components.pre, {
					class: "astro-code github-light",
					style: {
						backgroundColor: "#fff",
						color: "#24292e",
						overflowX: "auto"
					},
					tabindex: "0",
					"data-language": "ts",
					children: createVNode(_components.code, { children: [
						createVNode(_components.span, {
							class: "line",
							children: [
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: "type"
								}),
								createVNode(_components.span, {
									style: { color: "#6F42C1" },
									children: " Seq"
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: " ="
								}),
								createVNode(_components.span, {
									style: { color: "#005CC5" },
									children: " number"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: ";   "
								}),
								createVNode(_components.span, {
									style: { color: "#6A737D" },
									children: "// monotonic byte-sequence position in the stream"
								})
							]
						}),
						"\n",
						createVNode(_components.span, {
							class: "line",
							children: [
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: "type"
								}),
								createVNode(_components.span, {
									style: { color: "#6F42C1" },
									children: " Row"
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: " ="
								}),
								createVNode(_components.span, {
									style: { color: "#005CC5" },
									children: " number"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: ";   "
								}),
								createVNode(_components.span, {
									style: { color: "#6A737D" },
									children: "// stable, never-renumbered absolute scrollback line"
								})
							]
						}),
						"\n",
						createVNode(_components.span, { class: "line" }),
						"\n",
						createVNode(_components.span, {
							class: "line",
							children: [
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: "type"
								}),
								createVNode(_components.span, {
									style: { color: "#6F42C1" },
									children: " Record"
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: " ="
								})
							]
						}),
						"\n",
						createVNode(_components.span, {
							class: "line",
							children: [
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: "  |"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: " { "
								}),
								createVNode(_components.span, {
									style: { color: "#E36209" },
									children: "kind"
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: ":"
								}),
								createVNode(_components.span, {
									style: { color: "#032F62" },
									children: " \"data\""
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: ";   "
								}),
								createVNode(_components.span, {
									style: { color: "#E36209" },
									children: "seq"
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: ":"
								}),
								createVNode(_components.span, {
									style: { color: "#6F42C1" },
									children: " Seq"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: "; "
								}),
								createVNode(_components.span, {
									style: { color: "#E36209" },
									children: "firstRow"
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: ":"
								}),
								createVNode(_components.span, {
									style: { color: "#6F42C1" },
									children: " Row"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: "; "
								}),
								createVNode(_components.span, {
									style: { color: "#E36209" },
									children: "bytes"
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: ":"
								}),
								createVNode(_components.span, {
									style: { color: "#6F42C1" },
									children: " Uint8Array"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: " }  "
								}),
								createVNode(_components.span, {
									style: { color: "#6A737D" },
									children: "// a decoded PTY output chunk"
								})
							]
						}),
						"\n",
						createVNode(_components.span, {
							class: "line",
							children: [
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: "  |"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: " { "
								}),
								createVNode(_components.span, {
									style: { color: "#E36209" },
									children: "kind"
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: ":"
								}),
								createVNode(_components.span, {
									style: { color: "#032F62" },
									children: " \"resize\""
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: "; "
								}),
								createVNode(_components.span, {
									style: { color: "#E36209" },
									children: "seq"
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: ":"
								}),
								createVNode(_components.span, {
									style: { color: "#6F42C1" },
									children: " Seq"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: "; "
								}),
								createVNode(_components.span, {
									style: { color: "#E36209" },
									children: "cols"
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: ":"
								}),
								createVNode(_components.span, {
									style: { color: "#005CC5" },
									children: " number"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: "; "
								}),
								createVNode(_components.span, {
									style: { color: "#E36209" },
									children: "rows"
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: ":"
								}),
								createVNode(_components.span, {
									style: { color: "#005CC5" },
									children: " number"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: " }        "
								}),
								createVNode(_components.span, {
									style: { color: "#6A737D" },
									children: "// the out-of-band grid change, at its true position"
								})
							]
						}),
						"\n",
						createVNode(_components.span, {
							class: "line",
							children: [
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: "  |"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: " { "
								}),
								createVNode(_components.span, {
									style: { color: "#E36209" },
									children: "kind"
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: ":"
								}),
								createVNode(_components.span, {
									style: { color: "#032F62" },
									children: " \"ckpt\""
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: ";   "
								}),
								createVNode(_components.span, {
									style: { color: "#E36209" },
									children: "seq"
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: ":"
								}),
								createVNode(_components.span, {
									style: { color: "#6F42C1" },
									children: " Seq"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: "; "
								}),
								createVNode(_components.span, {
									style: { color: "#E36209" },
									children: "row"
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: ":"
								}),
								createVNode(_components.span, {
									style: { color: "#6F42C1" },
									children: " Row"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: "; "
								}),
								createVNode(_components.span, {
									style: { color: "#E36209" },
									children: "vtState"
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: ":"
								}),
								createVNode(_components.span, {
									style: { color: "#6F42C1" },
									children: " Uint8Array"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: " };    "
								}),
								createVNode(_components.span, {
									style: { color: "#6A737D" },
									children: "// periodic VT-state seed: serialize({ scrollback: 0 })"
								})
							]
						})
					] })
				}),
				createVNode(_components.p, { children: [
					createVNode(_components.code, { children: "RESIZE" }),
					" interleaved at its true stream position is what makes replay reflow-correct; ",
					createVNode(_components.code, { children: "CKPT" }),
					" is what makes a range render without replaying from byte 0 (see PR2’s checkpoints)."
				] })
			]
		}),
		"\n",
		createVNode(_components.h3, {
			id: "the-boundary-reuse-kolusharedsqlite--dont-hand-roll-a-storage-engine",
			children: [
				"The boundary: reuse ",
				createVNode(_components.code, { children: "@kolu/shared/sqlite" }),
				" — don’t hand-roll a storage engine"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Durable, seekable persistence ",
			createVNode(_components.em, { children: "is" }),
			" a real volatility — but its receptacle ",
			createVNode(_components.strong, { children: "already exists in this repo" }),
			", so the perfect move is to reuse it, not graduate a parallel one. ",
			createVNode(_components.code, { children: "@kolu/shared/sqlite" }),
			" (",
			createVNode($$Cite, {
				file: "packages/shared/src/sqlite/index.ts",
				label: "shared/sqlite"
			}),
			") wraps ",
			createVNode(_components.code, { children: "node:sqlite" }),
			"’s ",
			createVNode(_components.code, { children: "DatabaseSync" }),
			" in ",
			createVNode(_components.strong, { children: "WAL mode" }),
			" — the repo’s canonical embedded store, already used by the opencode + codex integrations via ",
			createVNode(_components.code, { children: "withDb" }),
			" + ",
			createVNode(_components.code, { children: "createWalSubscription" }),
			". And ",
			createVNode(_components.code, { children: "node:sqlite" }),
			" is ",
			createVNode(_components.strong, { children: "built into Node 24" }),
			" (kaval’s runtime), the same “reuse the platform” bet we make for zstd via ",
			createVNode(_components.code, { children: "node:zlib" }),
			". Extracting a hand-rolled ",
			createVNode(_components.code, { children: "@kolu/segment-log" }),
			" (custom binary format + sparse index + WAL fsync + crc tail-recovery + retention sweeper) would be the ",
			createVNode(_components.em, { children: "parallel hand-rolled store" }),
			" the design philosophy forbids — and a pile of code SQLite gives for free."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"What SQLite eliminates: the ",
			createVNode(_components.strong, { children: "index" }),
			" (a B-tree on indexed columns), ",
			createVNode(_components.strong, { children: "durability + crash recovery" }),
			" (its own WAL journal — a kaval OOM-abort loses at most the last txn), ",
			createVNode(_components.strong, { children: "range queries" }),
			" by line / byte / time (an indexed ",
			createVNode(_components.code, { children: "BETWEEN" }),
			"), and ",
			createVNode(_components.strong, { children: "retention" }),
			" (a ",
			createVNode(_components.code, { children: "DELETE" }),
			" + incremental vacuum). What stays a ",
			createVNode(_components.strong, { children: "kaval leaf" }),
			" (",
			createVNode(_components.code, { children: "packages/kaval/src/transcript/" }),
			") is only the terminal-domain glue that imports ",
			createVNode(_components.code, { children: "@xterm/headless" }),
			" and so ",
			createVNode(_components.em, { children: "can’t" }),
			" be agnostic: the ",
			createVNode(_components.code, { children: "DATA" }),
			"/",
			createVNode(_components.code, { children: "RESIZE" }),
			"/",
			createVNode(_components.code, { children: "CKPT" }),
			" schema, the byte-offset↔line index, and rendering a range by replaying from the nearest checkpoint. That leaf composes ",
			createVNode(_components.code, { children: "@kolu/shared/sqlite" }),
			" — the ",
			createVNode(_components.a, {
				href: "./electricity.html",
				children: "electricity"
			}),
			" split done right: the persistence volatility is already encapsulated; the VT meaning is injected on top."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "implementation-details",
			children: "Implementation details"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Two PRs — and only two because the rest is ",
			createVNode(_components.em, { children: "one indivisible change" }),
			". Shrinking the mirror, writing the transcript, and reading it back are mutually dependent: shrink without read-back regresses copy-all / search / deep-scroll, and read-back without the shrink fixes no memory. So they ship together — there is no point where kolu has less functionality than today."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "pr1-defang-the-storm--kaval-internal-no-disk-no-wire-change",
			children: [createVNode($$Pill, {
				variant: "done",
				children: "PR1"
			}), " Defang the storm — kaval-internal, no disk, no wire change"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped" }),
			" ",
			createVNode($$PrLink, { pr: 1573 }),
			". (The PR chip lives here, not in the heading, so the section anchor stays ",
			createVNode(_components.code, { children: "#pr1-defang-the-storm--kaval-internal-no-disk-no-wire-change" }),
			" — an empty JSX node trailing a heading slugs to a stray ",
			createVNode(_components.code, { children: "-" }),
			".)"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "User impact:" }),
			" a reconnect storm (rapid reload, network blip, laptop wake — especially with many terminals open) no longer spikes kolu by ",
			createVNode(_components.em, { children: "gigabytes" }),
			"; the worst case drops to a brief, bounded blip. Crucially, ",
			createVNode(_components.strong, { children: "a full reload still restores the same history as today" }),
			" — the server still sends the whole mirror snapshot, this PR just stops ",
			createVNode(_components.em, { children: "duplicating and stacking" }),
			" that work. So PR1 is a true strict improvement with ",
			createVNode(_components.strong, { children: "no regression" }),
			" — which is why it can ship first, ahead of the disk work. (Bounding the snapshot — the change that finishes the job but ",
			createVNode(_components.em, { children: "would" }),
			" shrink what a reload restores — is deliberately held to PR2, where backfill makes it lossless.)"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Two changes, both in ",
			createVNode(_components.code, { children: "attach()" }),
			" (",
			createVNode($$Cite, {
				file: "packages/kaval/src/ptyHost.ts",
				label: "ptyHost.ts:668-688"
			}),
			"), neither touching snapshot ",
			createVNode(_components.em, { children: "content" }),
			":"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Cancellable:" }),
				" after the eager subscribe, ",
				createVNode(_components.code, { children: "if (signal?.aborted) return { snapshot: \"\", deltas }" }),
				" (",
				createVNode(_components.code, { children: "\"\"" }),
				" is wire-legal). A disconnect aborts the in-flight attaches and reissues them; today the aborted half still serializes the full mirror for a reader that’s gone — this makes them no-ops, removing the abort-doubling."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Epoch-coalesced snapshot:" }),
				" a per-",
				createVNode(_components.code, { children: "Entry" }),
				" ",
				createVNode(_components.code, { children: "snapshotCache" }),
				", cleared synchronously inside the ",
				createVNode(_components.code, { children: "headless.write" }),
				" callback ",
				createVNode(_components.em, { children: "before" }),
				" ",
				createVNode(_components.code, { children: "publish" }),
				" (",
				createVNode($$Cite, {
					file: "packages/kaval/src/ptyHost.ts",
					label: "ptyHost.ts:624-630"
				}),
				"). Repeated/rapid attaches to one terminal within a single publish-epoch (an idle terminal = a long epoch) serialize ",
				createVNode(_components.strong, { children: "once" }),
				" and share the immutable string. Race-free: cache-set and publish-clear are on the same synchronous tap."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Net: the storm drops from the measured multi-GB to roughly ",
			createVNode(_components.em, { children: "(live-terminal count) × one full snapshot" }),
			" — transient tens-to-low-hundreds of MB — with reload history untouched. One honest cost of the memo: it leaves ",
			createVNode(_components.strong, { children: "one" }),
			" serialized snapshot pinned per terminal between mutations (an idle terminal’s lingers until its next byte or resize — and ",
			createVNode(_components.code, { children: "getScreenState" }),
			" populates the same slot). That retention is real, but it’s ",
			createVNode(_components.strong, { children: "bounded by — and strictly smaller than — the mirror it shadows" }),
			" (a filled 10 K snapshot is ~4 MB of ANSI vs the ~25 MB live cell buffer it serializes), and it’s freed on the next mirror mutation or on teardown — so steady-state heap stays the same ",
			createVNode(_components.code, { children: "O(live-terminal count)" }),
			" class the mirror already occupies, not a new leak. The epoch grain is ",
			createVNode(_components.em, { children: "load-bearing" }),
			", not a missing release: a reconnect storm’s attaches arrive across many event-loop turns, so only an actual data-parse boundary reliably outlasts the burst — a turn/microtask/timer release would fire mid-storm and re-introduce the N serializes. PR2’s snapshot bound then takes each snapshot — pinned or transient — to ~tens of KB."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Guard:" }),
			" a reconnect-storm test (N concurrent + repeated ",
			createVNode(_components.code, { children: "attach()" }),
			", assert peak allocation falls to O(terminal-count) full snapshots, not O(storm-size)) — the guard missing today for the exact spike investigated. ",
			createVNode(_components.code, { children: "Channel" }),
			" is untouched (",
			createVNode($$Cite, {
				file: "packages/kaval/src/channel.ts",
				label: "channel.ts:120-131"
			}),
			" already correct)."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "pr2-the-on-disk-transcript--write-read-and-shrink-atomically",
			children: [createVNode($$Pill, {
				variant: "ok",
				children: "PR2"
			}), " The on-disk transcript — write, read, and shrink, atomically"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "User impact:" }),
			" terminals stay snappy no matter how long the server’s been up or how many you have open, and kolu stops OOM-crashing-and-restarting every few days (the chronic death). A full reload now shows the ",
			createVNode(_components.strong, { children: "visible screen instantly" }),
			", then fills in history as you scroll — reaching the ",
			createVNode(_components.em, { children: "full retained on-disk depth" }),
			" (deeper than today’s 10 K mirror, up to the retention cap), rendered at the correct width, and surviving server restarts. ",
			createVNode(_components.strong, { children: "No regression window:" }),
			" the snapshot is only bounded — and the mirror only shrunk — once backfill is in place to restore depth, all in this one merge."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Build it bottom-up ",
			createVNode(_components.em, { children: "inside the PR" }),
			" so the bound/shrink is last — the transcript can be exercised by tests before any user path depends on it:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"The ",
					createVNode(_components.code, { children: "transcript/" }),
					" leaf over SQLite."
				] }),
				" One DB per PTY (",
				createVNode(_components.code, { children: "$XDG_STATE_HOME/kaval/transcripts/<id>.db" }),
				"), opened via ",
				createVNode(_components.code, { children: "@kolu/shared/sqlite" }),
				"’s ",
				createVNode(_components.code, { children: "withDb" }),
				" in WAL mode. A single ",
				createVNode(_components.code, { children: "record" }),
				" table — ",
				createVNode(_components.code, { children: "(seq INTEGER PK, kind, firstRow, firstByteSeq, tsMs, cols, payload BLOB)" }),
				" — indexed on ",
				createVNode(_components.code, { children: "firstRow" }),
				", ",
				createVNode(_components.code, { children: "firstByteSeq" }),
				", ",
				createVNode(_components.code, { children: "tsMs" }),
				" for the three range queries. ",
				createVNode(_components.code, { children: "payload" }),
				" is a ",
				createVNode(_components.code, { children: "node:zlib" }),
				" zstd-compressed run of coalesced output (batched ~64 KB, ",
				createVNode(_components.em, { children: "not" }),
				" one row per chunk — the write-amplification trap). The writer is the existing ",
				createVNode(_components.code, { children: "proc.onData" }),
				" callback (",
				createVNode($$Cite, {
					file: "packages/kaval/src/ptyHost.ts",
					label: "ptyHost.ts:624-630"
				}),
				"), so the transcript shares the mirror’s byte stream and inherits attach’s race-freedom — no new race. SQLite owns the index, WAL durability, crash recovery, and range reads; the leaf owns only the schema + the ",
				createVNode(_components.code, { children: "DATA" }),
				"/",
				createVNode(_components.code, { children: "RESIZE" }),
				"/",
				createVNode(_components.code, { children: "CKPT" }),
				" framing."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Checkpoints" }),
				" make backfill correct ",
				createVNode(_components.em, { children: "and" }),
				" cheap (the RCA omits them): without one, rendering any range replays from byte 0 — re-creating the multi-GB spike on every scroll. Every ~K lines write a ",
				createVNode(_components.code, { children: "CKPT" }),
				" row = ",
				createVNode(_components.code, { children: "serialize({ scrollback: 0 })" }),
				" (viewport + modal preamble, a few KB — ",
				createVNode(_components.em, { children: "not" }),
				" a full-buffer serialize, which would be ~4 MB/checkpoint = gigabytes of index). A range render = restore the nearest checkpoint into a throwaway headless, replay one bounded run, dispose — behind a semaphore so backfill can’t re-storm the read path."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The read verbs." }),
				" ",
				createVNode(_components.code, { children: "history({ id, beforeCursor, maxLines, width })" }),
				" keyed on an opaque ",
				createVNode(_components.strong, { children: "byte-offset cursor" }),
				", not a line number — render-line numbers shift under reflow (",
				createVNode(_components.code, { children: "reflowCursorLine" }),
				"), so a line-range API bakes in a coordinate that silently moves under resize; a byte offset is reflow-stable, width a ",
				createVNode(_components.em, { children: "render-time" }),
				" parameter. Returns rendered ANSI at the client’s current width; the snapshot frame carries ",
				createVNode(_components.code, { children: "historyCursor" }),
				" (nearest checkpoint ≤ window top) so the join overlaps-not-gaps. Plus ",
				createVNode(_components.code, { children: "exportHistory" }),
				" / ",
				createVNode(_components.code, { children: "searchHistory" }),
				", extending the existing range-read ",
				createVNode(_components.code, { children: "getScreenText" }),
				" idiom (",
				createVNode($$Cite, {
					file: "packages/kaval/src/ptyHostSurface.ts",
					label: "ptyHostSurface.ts:314"
				}),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The client copy-mode pager." }),
				" A read-only pager surface that, on scroll past the hot window, fetches older ranges by byte-offset cursor through the ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "stream" }), " namespace"] }),
				" (",
				createVNode($$Cite, {
					file: "packages/client/src/rpc/rpc.ts",
					label: "rpc.ts"
				}),
				", per ",
				createVNode(_components.code, { children: "streaming.md" }),
				" — snapshot-then-deltas, reconnect-safe) and renders them at the pager’s fixed width, re-fetching on resize. PDF export (",
				createVNode($$Cite, {
					file: "packages/client/src/exportScrollbackAsPdf.ts",
					label: "exportScrollbackAsPdf.ts"
				}),
				") repoints at ",
				createVNode(_components.code, { children: "exportHistory" }),
				"; scrollback search at ",
				createVNode(_components.code, { children: "searchHistory" }),
				". The live ",
				createVNode(_components.code, { children: "Terminal.tsx" }),
				" view is untouched — the pager is a separate surface, so there is no live-grid splice."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Then, and only then, bound the snapshot and shrink the mirror." }),
				" With backfill in place, ",
				createVNode(_components.code, { children: "attach()" }),
				" serializes a ",
				createVNode(_components.code, { children: "HOT_WINDOW" }),
				" viewport (",
				createVNode(_components.code, { children: "serialize({ scrollback: HOT_WINDOW })" }),
				", the 0.14.0 option; same bound on ",
				createVNode(_components.code, { children: "getScreenState" }),
				", ",
				createVNode($$Cite, {
					file: "packages/kaval/src/ptyHost.ts",
					label: "ptyHost.ts:728"
				}),
				") — now ",
				createVNode(_components.strong, { children: "lossless" }),
				", because a reload paints the window instantly and backfills the rest from the transcript on scroll. This is what finally takes the storm to ~tens of KB/snapshot. The mirror itself shrinks to ",
				createVNode(_components.code, { children: "rows + SCRAPE_TAIL_LINES" }),
				" — the screen-scrape promoter’s tail (",
				createVNode($$Cite, {
					file: "packages/server/src/terminalEndpoint/local.ts",
					label: "local.ts:265"
				}),
				"), a screen-sized constant, ",
				createVNode(_components.em, { children: "not" }),
				" 10 K — so ",
				createVNode(_components.code, { children: "DEFAULT_MIRROR_SCROLLBACK" }),
				" stops being a depth dial. ",
				createVNode(_components.strong, { children: "In the same commit, re-route the whole-buffer reads" }),
				" the shrink would otherwise truncate: ",
				createVNode(_components.strong, { children: "Copy-terminal-text" }),
				" calls ",
				createVNode(_components.code, { children: "screenText" }),
				" with ",
				createVNode(_components.em, { children: "no range" }),
				" = the whole buffer (",
				createVNode($$Cite, {
					file: "packages/client/src/terminal/useTerminalCrud.ts",
					label: "useTerminalCrud.ts:280"
				}),
				"), and scrollback search reads deep — both now read the transcript. The bounded screen-scrape tail (",
				createVNode(_components.code, { children: "readScreenText(tailLines)" }),
				") stays on the mirror."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Retention & privacy as spawn-frame policy (B0-style), not a daemon knob." }),
				" The spawn input carries a ",
				createVNode(_components.strong, { children: "required" }),
				" ",
				createVNode(_components.code, { children: "history: { enabled, retentionBytes }" }),
				", threaded through the same three paths that carry ",
				createVNode(_components.code, { children: "scrollback" }),
				" today — ",
				createVNode(_components.code, { children: "composeSpawnInput" }),
				" (",
				createVNode($$Cite, {
					file: "packages/server/src/ptyHost/index.ts",
					label: "ptyHost/index.ts:233"
				}),
				"), kaval-tui’s ",
				createVNode(_components.code, { children: "composeCreateInput" }),
				", and the in-process host (",
				createVNode($$Cite, {
					file: "packages/kaval/src/inProcessPtyHost.ts",
					label: "inProcessPtyHost.ts:260"
				}),
				") — so the daemon derives nothing and a missing field is a loud crash. Retention = ",
				createVNode(_components.code, { children: "DELETE" }),
				" oldest rows past the per-terminal byte cap (raise an ",
				createVNode(_components.code, { children: "oldestRow" }),
				" watermark; a sub-floor read returns ",
				createVNode(_components.code, { children: "{kind:\"evicted\"}" }),
				", never empty) + a global sweeper that reaps ",
				createVNode(_components.em, { children: "exited" }),
				"-terminal DBs first (live ones never reaped — survivability). ",
				createVNode(_components.code, { children: "enabled:false" }),
				" writes no DB; reads return ",
				createVNode(_components.code, { children: "{kind:\"unavailable\"}" }),
				". Files ",
				createVNode(_components.code, { children: "0600" }),
				" under ",
				createVNode(_components.code, { children: "0700" }),
				" — a perms mismatch is a loud crash."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Disk fault never kills the PTY." }),
				" A runtime ",
				createVNode(_components.code, { children: "ENOSPC" }),
				"/",
				createVNode(_components.code, { children: "EIO" }),
				" degrades ",
				createVNode(_components.em, { children: "that one" }),
				" terminal’s transcript to a surfaced ",
				createVNode(_components.code, { children: "{faulted, lastGoodSeq}" }),
				" (via ",
				createVNode(_components.code, { children: "daemonStatus" }),
				"), never a truncated log shown as complete, never a daemon crash — the one place survivability outranks fail-fast (",
				createVNode($$Cite, {
					file: ".claude/rules/conventions.md",
					label: "caught-error-must-not-collapse-to-empty"
				}),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Guards:" }),
				" flat-in-count heap soak (slope ≈ 0); a fast-check ",
				createVNode(_components.strong, { children: "lossless round-trip" }),
				" (random ",
				createVNode(_components.code, { children: "write" }),
				"/",
				createVNode(_components.code, { children: "resize" }),
				" interleavings, replayed per epoch == live grid, concatenated ",
				createVNode(_components.code, { children: "DATA" }),
				" == input); a ",
				createVNode(_components.code, { children: "formatVersion" }),
				" row that ",
				createVNode(_components.strong, { children: "fails loud" }),
				" on an unknown schema (distinct from ",
				createVNode(_components.code, { children: "PTY_HOST_CONTRACT_VERSION" }),
				")."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "PR2 is one breaking 4.0 recycle — say the cost plainly",
			children: createVNode(_components.p, { children: [
				"Persistence can’t be layered onto a running pre-persistence daemon: the new ",
				createVNode(_components.code, { children: "history" }),
				" verbs would 404 and the required ",
				createVNode(_components.code, { children: "history" }),
				" spawn-policy field would be missing — a silent degradation fail-fast forbids. So PR2’s wire changes (remove ",
				createVNode(_components.code, { children: "scrollback" }),
				"; add required ",
				createVNode(_components.code, { children: "history" }),
				" policy; add the verbs; bound the snapshot) are ",
				createVNode(_components.strong, { children: [
					"one major ",
					createVNode(_components.code, { children: "PTY_HOST_CONTRACT_VERSION" }),
					" 4.0 bump"
				] }),
				" (",
				createVNode($$Cite, {
					file: "packages/kaval/src/ptyHostSurface.ts",
					label: "ptyHostSurface.ts:74"
				}),
				") — one forced recycle that ",
				createVNode(_components.strong, { children: "kills every live terminal once" }),
				". The feature that enables session-restore is born from the one event that loses every currently-live session; there is no lossless path around it. (This is also why it can’t be split further: a half-shipped persistence layer is a broken one.)"
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "PR2 is build-ready — every prior open fork is closed (2026-06-25)",
			children: [
				createVNode(_components.p, { children: "The six items left open after the first decision pass are all settled below, each grounded in code or a clean-box spike. Nothing here is a placeholder." }),
				createVNode(_components.ol, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Backfill seam protocol + cross-width reflow" }),
						" — ",
						createVNode(_components.em, { children: "spiked, 11/11." }),
						" The ",
						createVNode(_components.code, { children: "history()" }),
						" shape, the client stitch, and the checkpoint-placement constraint are pinned; cross-width reflow is ",
						createVNode(_components.strong, { children: "byte-identical to a single-shot render" }),
						" under the two constraints proven below."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Copy-mode pager UI" }),
						" — ",
						createVNode(_components.em, { children: "mocked." }),
						" Invocation (keybind + palette + title-bar), desktop modal + mobile drawer mockups, interactions, and the reused primitives are all named."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Constants" }),
						" — ",
						createVNode(_components.em, { children: "pinned:" }),
						" ",
						createVNode(_components.code, { children: "SCRAPE_TAIL_LINES = 40" }),
						", ",
						createVNode(_components.code, { children: "HOT_WINDOW = 500" }),
						", checkpoint ",
						createVNode(_components.code, { children: "K = one CKPT per ~64 KB DATA block (≈500 lines)" }),
						"."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Product semantics" }),
						" — ",
						createVNode(_components.em, { children: "answered:" }),
						" ",
						createVNode(_components.code, { children: "searchHistory" }),
						" (literal+case-insensitive default, regex/case opt-in), PDF export (full on-disk depth, historical-per-span width), session restore (visible screen unchanged, deep reach added)."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Mobile resize" }),
						" — ",
						createVNode(_components.em, { children: "answered by construction:" }),
						" one shared PTY size (pre-existing), ",
						createVNode(_components.code, { children: "RESIZE" }),
						"-journaled; scrollback + PDF stay correct because reads are width-parameterized and export is width-faithful per span."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: [createVNode(_components.code, { children: "node:sqlite" }), " in the real nix closure"] }),
						" — ",
						createVNode(_components.em, { children: "verified two ways:" }),
						" the analytic closure chain and an empirical run of ",
						createVNode(_components.code, { children: "node:sqlite" }),
						" under the exact pinned ",
						createVNode(_components.code, { children: "pkgs.nodejs" }),
						" (24.13.0) on a fresh box."
					] }),
					"\n"
				] }),
				createVNode(_components.p, { children: "This supersedes the open-fork language in the “Decisions resolved” callout below." })
			]
		}),
		"\n",
		createVNode(_components.h4, {
			id: "pinned-constants",
			children: "Pinned constants"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Constant" }),
					"\n",
					createVNode(_components.th, { children: "Value" }),
					"\n",
					createVNode(_components.th, { children: "Where it lives" }),
					"\n",
					createVNode(_components.th, { children: "Why this value" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "SCRAPE_TAIL_LINES" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "40" }) }),
					"\n",
					createVNode(_components.td, { children: ["the mirror-floor formula in ", createVNode($$Cite, {
						file: "packages/kaval/src/ptyHost.ts",
						label: "ptyHost.ts"
					})] }),
					"\n",
					createVNode(_components.td, { children: [
						"Exactly ",
						createVNode(_components.code, { children: "TAIL_REGION_LINES" }),
						" (",
						createVNode($$Cite, {
							file: "packages/integrations/claude-code/src/screen.ts",
							label: "screen.ts:61"
						}),
						"), the deepest detector tail any live reader asks for — consumed at ",
						createVNode($$Cite, {
							file: "packages/integrations/claude-code/src/agent-adapter.ts",
							label: "agent-adapter.ts:88"
						}),
						" and flowing through ",
						createVNode(_components.code, { children: "readScreenText(tailLines)" }),
						" at ",
						createVNode($$Cite, {
							file: "packages/server/src/terminalEndpoint/local.ts",
							label: "local.ts:265"
						}),
						". Derived from that constant (not a fresh magic number) so the floor can’t drift below a reader’s need — ",
						createVNode(_components.em, { children: "reuse the source of truth" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "mirror floor" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: createVNode(_components.code, { children: "rows + 40" }) }) }),
					"\n",
					createVNode(_components.td, { children: "same" }),
					"\n",
					createVNode(_components.td, { children: [
						"The mirror only owes the screen plus the deepest scrape tail. No OSC handler (7, 0/2, 633;E) or device-query handler reads the scrollback buffer — they extract metadata only — so nothing reads past ",
						createVNode(_components.code, { children: "rows + 40" }),
						". ",
						createVNode(_components.code, { children: "DEFAULT_MIRROR_SCROLLBACK" }),
						" stops being a depth dial."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "HOT_WINDOW" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "500 lines" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"the ",
						createVNode(_components.code, { children: "attach()" }),
						" bound and ",
						createVNode(_components.code, { children: "getScreenState" }),
						", ",
						createVNode(_components.code, { children: "serialize({ scrollback: HOT_WINDOW })" }),
						" (",
						createVNode($$Cite, {
							file: "packages/kaval/src/ptyHost.ts",
							label: "ptyHost.ts:728"
						}),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"The bounded attach snapshot. ~500 lines serializes to ",
						createVNode(_components.strong, { children: "tens-to-low-hundreds of KB" }),
						" (vs today’s multi-MB full-mirror serialize), repaints the visible screen plus ~10× viewport of over-scroll margin so a reload rarely hits a backfill round in the first gesture, and the pager fetches anything deeper on scroll. Independent of ",
						createVNode(_components.code, { children: "K" }),
						"; tunable."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["checkpoint ", createVNode(_components.code, { children: "K" })] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: [
						"one ",
						createVNode(_components.code, { children: "CKPT" }),
						" per ~64 KB zstd DATA block (≈500 lines)"
					] }), ", deferred to the next clean line boundary"] }),
					"\n",
					createVNode(_components.td, { children: [
						"the ",
						createVNode(_components.code, { children: "proc.onData" }),
						" writer (",
						createVNode($$Cite, {
							file: "packages/kaval/src/ptyHost.ts",
							label: "ptyHost.ts:624-630"
						}),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: "Pinned below." }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"Why ",
				createVNode(_components.code, { children: "K" }),
				" is block-anchored, not a raw line count."
			] }),
			" The replay-cost spike measured ",
			createVNode(_components.em, { children: "restore checkpoint → resize → replay K lines → render a range" }),
			" on Node 24 / ",
			createVNode(_components.code, { children: "@xterm/headless@6.0.0" }),
			" / ",
			createVNode(_components.code, { children: "addon-serialize@0.14.0" }),
			": ",
			createVNode(_components.code, { children: "K=50: 2.9 ms" }),
			", ",
			createVNode(_components.code, { children: "K=100: 3.6 ms" }),
			", ",
			createVNode(_components.code, { children: "K=200: 4.3 ms" }),
			", ",
			createVNode(_components.code, { children: "K=500: 4.1 ms" }),
			", ",
			createVNode(_components.code, { children: "K=1000: 6.0 ms" }),
			". The curve is ",
			createVNode(_components.strong, { children: "flat and fixed-cost-dominated" }),
			" — ~2.5–3 ms of throwaway-construct + serialize-restore + reflow, then ~0.003 ms/line marginal. An earlier draft floated a flat ",
			createVNode(_components.code, { children: "K = 1000 lines" }),
			"; the spike refines it to ",
			createVNode(_components.strong, { children: "one checkpoint per ~64 KB DATA block" }),
			" because:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"it bounds the ",
				createVNode(_components.em, { children: "real" }),
				" cost driver (",
				createVNode(_components.strong, { children: "bytes parsed" }),
				", not lines), so a pathological long line can’t blow the replay budget;"
			] }),
			"\n",
			createVNode(_components.li, { children: "a single huge logical line can never host a checkpoint (the clean-boundary constraint below), so it’s always replayed whole — block-anchoring makes that cheap by letting a render decompress whole blocks;" }),
			"\n",
			createVNode(_components.li, { children: [
				"it ",
				createVNode(_components.strong, { children: "reuses the existing ~64 KB write-batch cadence" }),
				" the transcript already uses, instead of bolting on a second cadence."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Under the DATA-replayed-return rule, worst-case replay distance per page is ",
			createVNode(_components.code, { children: "≈ K + maxLines + rows ≈ 560 lines" }),
			" → ",
			createVNode(_components.code, { children: "~4 ms/page render" }),
			" — comfortably sub-frame (",
			createVNode(_components.code, { children: "< 16 ms" }),
			") even on a 2–3×-slower production host, and it runs behind the read semaphore so backfill can’t re-storm the read path. Checkpoint storage is negligible: each ",
			createVNode(_components.code, { children: "CKPT = serialize({ scrollback: 0 })" }),
			" ≈ a few KB, so ~200 checkpoints per 100 K retained lines is sub-MB. ",
			createVNode(_components.code, { children: "K" }),
			" can range 256 (~32 KB) to 1000 (~128 KB) without harm; smaller buys little (fixed cost dominates), larger trims the frame-budget margin."
		] }),
		"\n",
		createVNode(_components.h4, {
			id: "the-backfill-seam-protocol",
			children: "The backfill seam protocol"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Cursor type." }),
			" ",
			createVNode(_components.code, { children: "byteSeq" }),
			" is an ",
			createVNode(_components.strong, { children: "opaque, monotonic byte offset" }),
			" into the per-PTY decoded DATA stream (the running sum of decoded-output byte lengths). It is ",
			createVNode(_components.em, { children: "always" }),
			" minted and consumed at a ",
			createVNode(_components.strong, { children: "ground-state clean line boundary" }),
			" — cursor column 0, primary screen, top row is the first row of a logical line (not a wrapped continuation). The ",
			createVNode(_components.code, { children: "record.firstByteSeq" }),
			" index resolves a ",
			createVNode(_components.code, { children: "byteSeq" }),
			" to the ~64 KB block that contains it. ",
			createVNode(_components.strong, { children: "Line numbers never go on the wire" }),
			" — they shift under reflow (",
			createVNode(_components.code, { children: "reflowCursorLine" }),
			"); a byte offset is reflow-stable, width a render-time parameter."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Request" }),
			" (client ",
			createVNode(_components.code, { children: "stream" }),
			" namespace, snapshot-then-deltas):"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.code, { children: "`history({ id, beforeCursor: byteSeq, maxLines: int, width: int })`" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "beforeCursor" }),
				" — the ",
				createVNode(_components.code, { children: "byteSeq" }),
				" at the ",
				createVNode(_components.strong, { children: "top" }),
				" of the content the client currently holds. The first backfill uses the snapshot frame’s ",
				createVNode(_components.code, { children: "historyCursor" }),
				" (the ",
				createVNode(_components.code, { children: "byteSeq" }),
				" of the nearest ",
				createVNode(_components.code, { children: "CKPT ≤ hot-window top" }),
				", already a clean boundary). The server returns the rendered rows immediately ",
				createVNode(_components.strong, { children: "above" }),
				" ",
				createVNode(_components.code, { children: "beforeCursor" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "maxLines" }),
				" — a target of physical (rendered) rows, a ",
				createVNode(_components.strong, { children: "soft minimum" }),
				": the server returns whole logical lines totaling ",
				createVNode(_components.code, { children: "≥ maxLines" }),
				", so it never splits a wrapped line at the top edge."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.code, { children: "width" }), " — the pager’s current render width."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Response:" }),
			" ",
			createVNode(_components.code, { children: "`{ rows: string[] /* rendered ANSI, top→bottom */, nextCursor: byteSeq, atFloor: bool }`" })
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "rows" }),
				" — whole logical lines, ",
				createVNode(_components.code, { children: "≥ maxLines" }),
				" physical rows (fewer only at the floor)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "nextCursor" }),
				" — the ",
				createVNode(_components.code, { children: "byteSeq" }),
				" at the ",
				createVNode(_components.strong, { children: "top" }),
				" of the returned block (",
				createVNode(_components.code, { children: "== firstByteSeq" }),
				" of the topmost returned logical line; a clean boundary). The client passes it as the next ",
				createVNode(_components.code, { children: "beforeCursor" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "atFloor" }),
				" — ",
				createVNode(_components.code, { children: "true" }),
				" when ",
				createVNode(_components.code, { children: "nextCursor" }),
				" reached the oldest retained ",
				createVNode(_components.code, { children: "byteSeq" }),
				" / eviction watermark. A sub-floor read returns ",
				createVNode(_components.code, { children: "`{kind:\"evicted\"}`" }),
				", never empty."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Server algorithm" }), " (one call; every render runs behind the read semaphore):"] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Seed checkpoint C" }),
				" = the latest ",
				createVNode(_components.code, { children: "CKPT" }),
				" captured ",
				createVNode(_components.em, { children: "at or before the first line that will be returned" }),
				". Analytic pick: latest ",
				createVNode(_components.code, { children: "CKPT" }),
				" with ",
				createVNode(_components.code, { children: "capture-line ≤ line(beforeCursor) − maxLines − rows" }),
				". The ",
				createVNode(_components.code, { children: "−rows" }),
				" margin guarantees ",
				createVNode(_components.code, { children: "C" }),
				"’s own restored viewport (the “seed”) has scrolled entirely ",
				createVNode(_components.strong, { children: "above" }),
				" the returned window. Fall back through earlier checkpoints, ultimately the implicit ",
				createVNode(_components.strong, { children: "byte-0 checkpoint" }),
				" (a fresh terminal at the initial width)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Render the segment:" }),
				" throwaway headless at ",
				createVNode(_components.code, { children: "C.cols" }),
				" → restore ",
				createVNode(_components.code, { children: "C.vtState" }),
				" (",
				createVNode(_components.code, { children: "serialize" }),
				" restore) → ",
				createVNode(_components.code, { children: "resize(width, rows)" }),
				" (xterm native reflow of the seed) → write the zstd-decompressed DATA run for ",
				createVNode(_components.code, { children: "(C.firstByteSeq, beforeCursor]" }),
				". ",
				createVNode(_components.strong, { children: "Do not replay RESIZE records" }),
				" — this is reflow-to-current. Dispose."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Slice:" }),
				" take the last ",
				createVNode(_components.code, { children: "≥ maxLines" }),
				" rows; snap the top edge ",
				createVNode(_components.strong, { children: "up" }),
				" to a logical-line start (the row whose ",
				createVNode(_components.code, { children: "isWrapped === false" }),
				"). ",
				createVNode(_components.code, { children: "nextCursor" }),
				" = that line’s ",
				createVNode(_components.code, { children: "firstByteSeq" }),
				". ",
				createVNode(_components.strong, { children: "Load-bearing invariant:" }),
				" the topmost returned line MUST be ",
				createVNode(_components.strong, { children: "DATA-replayed" }),
				" (parsed fresh after ",
				createVNode(_components.code, { children: "C.firstByteSeq" }),
				"), never a reflowed-seed line. If the slice would include a seed line, walk back to an earlier ",
				createVNode(_components.code, { children: "C" }),
				" and re-render."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Return ",
				createVNode(_components.code, { children: "rows + nextCursor + atFloor" }),
				"."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Client backward-paging + stitch." }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"On attach, the snapshot carries ",
				createVNode(_components.code, { children: "historyCursor" }),
				" (nearest ",
				createVNode(_components.code, { children: "CKPT ≤ hot-window top" }),
				"). Render the ",
				createVNode(_components.code, { children: "HOT_WINDOW" }),
				" snapshot; its top ",
				createVNode(_components.code, { children: "== historyCursor" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Scroll up past the loaded top: keep a ",
				createVNode(_components.strong, { children: "cursor stack" }),
				"; call ",
				createVNode(_components.code, { children: "`history({ beforeCursor: topCursor, maxLines: viewportRows × overscan, width })`" }),
				"; ",
				createVNode(_components.strong, { children: "prepend" }),
				" rows; push ",
				createVNode(_components.code, { children: "nextCursor" }),
				"; set ",
				createVNode(_components.code, { children: "topCursor = nextCursor" }),
				"; repeat; stop at ",
				createVNode(_components.code, { children: "atFloor" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Resize the pager:" }),
				" discard rendered rows, ",
				createVNode(_components.strong, { children: "keep the cursor stack" }),
				" (byte offsets); re-issue ",
				createVNode(_components.code, { children: "history()" }),
				" from the bottom cursor at the new width and rebuild upward. Because every cursor is a clean ground-state boundary, the ",
				createVNode(_components.em, { children: "same" }),
				" ",
				createVNode(_components.code, { children: "byteSeq" }),
				" re-renders to a clean physical-row boundary at ",
				createVNode(_components.em, { children: "any" }),
				" width — no row duplicated or dropped across the resize."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "No-gap / no-overlap." }),
			" Page ",
			createVNode(_components.em, { children: "k" }),
			" covers exactly ",
			createVNode(_components.code, { children: "[nextCursor_k, beforeCursor_k)" }),
			" in ",
			createVNode(_components.code, { children: "byteSeq" }),
			", snapped to clean line boundaries, and ",
			createVNode(_components.code, { children: "beforeCursor_k == nextCursor_{k−1}" }),
			" (adjacent pages share the boundary). A ground-state boundary maps to a physical-row boundary at ",
			createVNode(_components.em, { children: "every" }),
			" width, so concatenation reconstructs the single-shot render with no duplicated or missing row. The ",
			createVNode(_components.strong, { children: "hot↔cold join" }),
			": the first ",
			createVNode(_components.code, { children: "history()" }),
			" uses ",
			createVNode(_components.code, { children: "beforeCursor = historyCursor" }),
			" (the snapshot top, a ",
			createVNode(_components.code, { children: "CKPT" }),
			" byteSeq), so its rows end exactly at the snapshot top — prepend with no overlap. ",
			createVNode(_components.code, { children: "exportHistory" }),
			" routes the same machinery in ",
			createVNode(_components.strong, { children: "FAITHFUL" }),
			" mode (restore@",
			createVNode(_components.code, { children: "C.cols" }),
			", replay DATA + RESIZE, render at the historical width, per resize-epoch); ",
			createVNode(_components.code, { children: "searchHistory" }),
			" ranges over the same index."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Cross-width reflow verdict — YES, byte-identical, under two constraints." }),
			" A checkpoint-rooted segment render is ",
			createVNode(_components.strong, { children: "byte-identical" }),
			" to the global single-shot reflow at the client’s width ",
			createVNode(_components.code, { children: "W" }),
			", validated across ",
			createVNode(_components.code, { children: "W ∈ {40, 80, 100, 120, 160}" }),
			", every range, a 4000-char wrapped logical line, and wide-CJK / emoji / combining-mark content — ",
			createVNode(_components.em, { children: "provided" }),
			":"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Constraint 1 — checkpoint placement." }),
				" A ",
				createVNode(_components.code, { children: "CKPT" }),
				" is captured ",
				createVNode(_components.strong, { children: "only at a ground-state clean line boundary" }),
				": ",
				createVNode(_components.code, { children: "buffer.getLine(baseY).isWrapped === false" }),
				" (viewport top is the first row of a logical line), cursor at column 0, primary screen. The writer marks a checkpoint “due” every ",
				createVNode(_components.code, { children: "K" }),
				" worth of bytes but ",
				createVNode(_components.strong, { children: "defers" }),
				" capture to the next byte boundary where ",
				createVNode(_components.code, { children: "isWrapped(baseY) === false" }),
				". ",
				createVNode(_components.em, { children: "Why:" }),
				" ",
				createVNode(_components.code, { children: "serialize({ scrollback: 0 })" }),
				" preserves ",
				createVNode(_components.strong, { children: "logical" }),
				" lines (it joins wrapped rows), so a terminal re-wraps them at its own width — faithful only if each captured logical line is ",
				createVNode(_components.em, { children: "complete" }),
				". The viewport bottom is always completed by DATA replayed after the checkpoint; only the top can be irreparably partial, so forbidding a wrapped top closes the only hole. The same constraint governs ",
				createVNode(_components.code, { children: "nextCursor" }),
				", guaranteed by snapping to a logical-line start."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Constraint 2 — return from DATA." }),
				" Every returned line must be DATA-replayed; the checkpoint is only a VT ",
				createVNode(_components.strong, { children: "seed" }),
				" for content above the window, and its restored-viewport lines are never returned. This neutralizes the one imperfection found (below)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "The seam spike — 11/11, and the one upstream artifact it contains",
			children: [
				createVNode(_components.p, { children: [
					"Run on a clean Node 24 box against the production versions (",
					createVNode(_components.code, { children: "@xterm/headless@6.0.0" }),
					" + ",
					createVNode(_components.code, { children: "@xterm/addon-serialize@0.14.0" }),
					"). The store was modeled as in-memory record arrays + raw-concatenated DATA blocks — the persistence layer (",
					createVNode(_components.code, { children: "node:sqlite" }),
					" WAL, ~64 KB zstd append 0.02 ms, indexed range reads sub-ms, retention ",
					createVNode(_components.code, { children: "DELETE" }),
					" 0.6 ms) was de-risked in the prior store spike and is unchanged."
				] }),
				createVNode(_components.table, { children: [
					"\n",
					createVNode(_components.thead, { children: [
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.th, { children: "#" }),
							"\n",
							createVNode(_components.th, { children: "Case" }),
							"\n",
							createVNode(_components.th, { children: "Result" }),
							"\n"
						] }),
						"\n"
					] }),
					"\n",
					createVNode(_components.tbody, { children: [
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.td, { children: "A1" }),
							"\n",
							createVNode(_components.td, { children: [
								"reflow-to-current, 5 ranges × ",
								createVNode(_components.code, { children: "W ∈ {40,80,100,120,160}" }),
								", clean checkpoint; SGR/CJK/emoji/combining, two interleaved historical resizes ignored"
							] }),
							"\n",
							createVNode(_components.td, { children: [createVNode(_components.strong, { children: "byte-identical" }), " to single-shot"] }),
							"\n"
						] }),
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.td, { children: "A1b" }),
							"\n",
							createVNode(_components.td, { children: [
								"4000-char single logical line reflowed at ",
								createVNode(_components.code, { children: "W=120" }),
								" from a clean checkpoint"
							] }),
							"\n",
							createVNode(_components.td, { children: [
								"33 rows, ",
								createVNode(_components.strong, { children: "exact" }),
								" match to oracle"
							] }),
							"\n"
						] }),
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.td, { children: "A2" }),
							"\n",
							createVNode(_components.td, { children: [createVNode(_components.em, { children: "pathological:" }), " checkpoint captured mid-wrapped-line"] }),
							"\n",
							createVNode(_components.td, { children: [createVNode(_components.strong, { children: "diverges" }), " — proves the clean-boundary constraint is load-bearing"] }),
							"\n"
						] }),
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.td, { children: "A3" }),
							"\n",
							createVNode(_components.td, { children: "FAITHFUL mode (replay RESIZE, render at historical width)" }),
							"\n",
							createVNode(_components.td, { children: [createVNode(_components.code, { children: "==" }), " full resize-replay across epochs"] }),
							"\n"
						] }),
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.td, { children: "A4" }),
							"\n",
							createVNode(_components.td, { children: ["DATA-replayed range incl. the seed-diverging line L735 (wide+combining) @", createVNode(_components.code, { children: "W=80" })] }),
							"\n",
							createVNode(_components.td, { children: [createVNode(_components.strong, { children: "byte-exact" }), " when DATA-replayed"] }),
							"\n"
						] }),
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.td, { children: "B" }),
							"\n",
							createVNode(_components.td, { children: [
								"no-gap/no-overlap backward paging @",
								createVNode(_components.code, { children: "W=120" }),
								" — 68 pages × 37 rows"
							] }),
							"\n",
							createVNode(_components.td, { children: [createVNode(_components.code, { children: "concat(2541) == single-shot(2541)" }), ", byte-identical"] }),
							"\n"
						] }),
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.td, { children: "B" }),
							"\n",
							createVNode(_components.td, { children: [
								"same @",
								createVNode(_components.code, { children: "W=80" }),
								" with wide+combining — 80 pages × 37 rows"
							] }),
							"\n",
							createVNode(_components.td, { children: [createVNode(_components.code, { children: "concat(3004) == single-shot(3004)" }), ", byte-identical"] }),
							"\n"
						] }),
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.td, { children: "D-ctrl" }),
							"\n",
							createVNode(_components.td, { children: ["determinism: ", createVNode(_components.code, { children: "oracle@80 == byte-0-checkpoint replay@80" })] }),
							"\n",
							createVNode(_components.td, { children: "identical — checkpoints add no nondeterminism" }),
							"\n"
						] }),
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.td, { children: "D-iso" }),
							"\n",
							createVNode(_components.td, { children: "the one imperfection isolated" }),
							"\n",
							createVNode(_components.td, { children: "see below" }),
							"\n"
						] }),
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.td, { children: "K" }),
							"\n",
							createVNode(_components.td, { children: "replay cost K=50…1000" }),
							"\n",
							createVNode(_components.td, { children: [
								"flat, 2.9–6.0 ms (drives the ",
								createVNode(_components.code, { children: "K" }),
								" pin)"
							] }),
							"\n"
						] }),
						"\n"
					] }),
					"\n"
				] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "The one imperfection is upstream xterm, fully contained." }),
					" When xterm’s ",
					createVNode(_components.code, { children: "resize()" }),
					"/reflow re-wraps a line mixing wide chars + combining marks across a width change, a combining mark can misattach to a different base (observed ",
					createVNode(_components.code, { children: "Z-acute → G-acute" }),
					"). It is ",
					createVNode(_components.strong, { children: [
						"reproduced by a plain ",
						createVNode(_components.code, { children: "fresh@80" }),
						" vs ",
						createVNode(_components.code, { children: "fresh@100→resize-80" }),
						" with no checkpoint or serialize involved"
					] }),
					" — i.e. a ",
					createVNode(_components.em, { children: "live-terminal" }),
					" resize shows it today, so the pager is ",
					createVNode(_components.strong, { children: "not a regression" }),
					". It can only ever touch a reflowed checkpoint ",
					createVNode(_components.em, { children: "seed" }),
					", and the DATA-replayed-return rule keeps it out of every returned and stitched line (proven by A4 and B@80). A future xterm that fixes combining-mark reflow removes even the seed-level artifact."
				] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Scope caveat — normal flow only." }),
					" Reflow-to-current is correct only for normal-flow scrollback (newline-terminated output) — exactly what the copy-mode pager shows. Alt-screen / absolute-cursor / in-place-overwrite spans (full-screen TUIs) have no width-independent logical-line structure and ",
					createVNode(_components.strong, { children: "must not be reflowed" }),
					"; the transcript already journals them via ",
					createVNode(_components.code, { children: "CKPT" }),
					" + ",
					createVNode(_components.code, { children: "RESIZE" }),
					", and the pager renders such spans at their historical width. Alt-screen is reproduced, never reflowed — consistent with the plan."
				] })
			]
		}),
		"\n",
		createVNode(_components.h4, {
			id: "the-copy-mode-pager",
			children: "The copy-mode pager"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A read-only, fixed-width reader surface — never a splice into the live reflowing grid. The live ",
			createVNode(_components.code, { children: "Terminal.tsx" }),
			" is untouched; it stays mounted and running behind the pager the whole time."
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Invocation — three entry points, one state owner." }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Keybinding ",
					createVNode(_components.code, { children: "viewHistory" }),
					" = Mod+Shift+H"
				] }),
				" (Cmd+Shift+H mac / Ctrl+Shift+H Linux/Win), added to ",
				createVNode(_components.code, { children: "_ACTIONS" }),
				" in ",
				createVNode($$Cite, {
					file: "packages/client/src/input/actions.ts",
					label: "actions.ts"
				}),
				". Verified clean: ",
				createVNode(_components.code, { children: "KeyH" }),
				" is unused across the whole ACTIONS map, and Mod+Shift+",
				createVNode(_components.code, { children: "<letter>" }),
				" is the established app-chord convention that clears in-PTY bytes — same family as ",
				createVNode(_components.code, { children: "shuffleTheme" }),
				" (actions.ts:279), ",
				createVNode(_components.code, { children: "toggleDock" }),
				" (actions.ts:311), ",
				createVNode(_components.code, { children: "toggleCanvasPosture" }),
				" (actions.ts:320). It is ",
				createVNode(_components.strong, { children: "not" }),
				" in ",
				createVNode(_components.code, { children: "PROHIBITED_KEYBINDS" }),
				" (only Ctrl+B and Ctrl+J are reserved, ",
				createVNode($$Cite, {
					file: "packages/client/src/input/prohibitedKeybinds.ts",
					label: "prohibitedKeybinds.ts:21-33"
				}),
				"); ",
				createVNode(_components.code, { children: "keyboard.test.ts" }),
				" proves no collision. Set ",
				createVNode(_components.code, { children: "focusScopeMarker: TERMINAL_SEARCH_MARKER" }),
				" (actions.ts:158) exactly like ",
				createVNode(_components.code, { children: "findInTerminal" }),
				" (actions.ts:215-227) so the chord is claimed only inside a terminal subtree — Firefox’s own Ctrl+Shift+H still works everywhere else. Add ",
				createVNode(_components.code, { children: "toggleHistoryPager: (id) => void" }),
				" to ",
				createVNode(_components.code, { children: "ActionContext" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Command palette" }),
				" — “View terminal history” in the ",
				createVNode(_components.code, { children: "active-terminal" }),
				" section of ",
				createVNode($$Cite, {
					file: "packages/client/src/commands.tsx",
					label: "commands.tsx:234-369"
				}),
				", beside “Export scrollback as PDF” (commands.tsx:284-289), via ",
				createVNode(_components.code, { children: "actionPaletteCommand(\"viewHistory\", …)" }),
				" (actions.ts:399-413). Offered on ",
				createVNode(_components.strong, { children: "both" }),
				" the active ",
				createVNode(_components.em, { children: "and" }),
				" sleeping arms — history is disk-backed (",
				createVNode(_components.code, { children: "$XDG_STATE_HOME/kaval/transcripts/<id>.db" }),
				"), so it needs no live PTY — but gated on a new ",
				createVNode(_components.code, { children: "meta.history?.enabled" }),
				" flag so an opted-out terminal never offers a dead pager."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Title-bar button" }),
				" — a clock / History icon in ",
				createVNode($$Cite, {
					file: "packages/client/src/canvas/TileTitleActions.tsx",
					label: "TileTitleActions.tsx"
				}),
				" between Find (140-152) and Screenshot (153-165), reusing ",
				createVNode(_components.code, { children: "TILE_BUTTON_CLASS" }),
				", ",
				createVNode(_components.code, { children: "Tip" }),
				", and the ",
				createVNode(_components.code, { children: "onTile" }),
				" select-then-act wrapper (63-67). Add a ",
				createVNode(_components.code, { children: "HistoryIcon" }),
				" to ",
				createVNode($$Cite, {
					file: "packages/client/src/ui/Icons.tsx",
					label: "Icons.tsx"
				}),
				" (a clock with a counter-clockwise arrow). Register a one-time tip in ",
				createVNode(_components.code, { children: "settings/tips.ts" }),
				" per the Feature-Discoverability rule."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "State owner:" }),
			" a ",
			createVNode(_components.code, { children: "useHistoryPager" }),
			" singleton built with ",
			createVNode(_components.code, { children: "createSharedRoot" }),
			", a near-clone of ",
			createVNode($$Cite, {
				file: "packages/client/src/terminal/useTerminalSearch.ts",
				label: "useTerminalSearch.ts:31-78"
			}),
			" — per-",
			createVNode(_components.code, { children: "TerminalId" }),
			" open-state, ",
			createVNode(_components.code, { children: "openFor(id)" }),
			" / ",
			createVNode(_components.code, { children: "isOpen(id)" }),
			" / ",
			createVNode(_components.code, { children: "close()" }),
			", and an ",
			createVNode(_components.code, { children: "on(store.activeId)" }),
			" effect that closes the pager on active-terminal switch (the find-bar contract)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Close:" }),
			" Esc / backdrop (desktop) or drag-down / backdrop tap (mobile), the ✕, or “Jump to live ↓”. Every close routes through ",
			createVNode(_components.code, { children: "withKeyboardDismiss" }),
			" and returns focus to the live grid via ",
			createVNode(_components.code, { children: "refocusTerminal" }),
			" (",
			createVNode($$Cite, {
				file: "packages/client/src/ui/ModalDialog.tsx",
				label: "ModalDialog.tsx:25-39"
			}),
			", opted in with ",
			createVNode(_components.code, { children: "refocusOnClose" }),
			")."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Desktop mockup" }),
			" — a tall ",
			createVNode(_components.code, { children: "ModalDialog size=\"lg\"" }),
			" reader, backdrop dims the whole canvas so it reads as a separate surface:"
		] }),
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
					children: createVNode(_components.span, { children: "┌──────────────────────────────────────────────────────────────────────────────┐" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "│  ⏱  History — claude-code (feat/female-flat)      [Aa] [.*]  Find… 3/57  ‹  › │" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "│                                          Jump ▾    ⤓ PDF              ✕  Esc    │" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "├──────────────────────────────────────────────────────────────────────────────┤" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "│ ····· Older output trimmed to stay under the 256 MB history limit ··········· │  ← evicted sentinel" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "│  $ pnpm test                                                                   │" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "│  ✓ packages/kaval   (42)                                                       │" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "│  ✓ packages/shared  (18)                                                       │     read-only xterm" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "│  …                                                                             │     (DOM renderer, no WebGL)" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "│  $ git log --oneline -5                                                        │     fixed width = pager cols" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "│  3eb6cc8  fix(kaval): defang the reconnect storm (#1573)                       │     text is selectable → copy" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "│  ▓▓▓ match: \"reconnect storm\" highlighted in view ▓▓▓                          │" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "│  …                                                                             │" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "│                                                                                │" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "├──────────────────────────────────────────────────────────────────────────────┤" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "│  line ~1,284,330 · 3 days ago · 132 cols                ↓ Jump to live   ◴ new │  ← footer; ◴ ring pulses" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "└──────────────────────────────────────────────────────────────────────────────┘" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  Top-sentinel variants (whichever applies as you scroll up):" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    backfilling →   ····· ⠋ loading older history… ·····" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    true start  →   ──────────── Beginning of session ────────────" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    disabled    →   History isn't being recorded for this terminal." })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    disk fault  →   ⚠ History may be incomplete — disk error; showing up to the last good point." })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  Jump ▾ menu (anchored popover):     Search field toggles:" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    ┌──────────────────────┐           [Aa] case-sensitive   [.*] regex" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    │ ⤒  Top of history    │           (chips inside the field, ripgrep-style)" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    │ ⤓  Latest            │" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    │ ─────────────────    │" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    │ 🕘 1 hour ago        │           NOTE: no \"jump to line N\" — render-line" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    │ 🕘 Today 09:00       │           numbers shift under reflow, so the only" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    │ 🕘 Yesterday         │           position anchors are TIME and top/latest" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    │ 🕘 Pick a time…      │           (the byte-offset cursor is opaque)." })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    └──────────────────────┘" })
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Mobile mockup" }),
			" — a ",
			createVNode(_components.code, { children: "@corvu/drawer side=\"bottom\"" }),
			" sheet at ",
			createVNode(_components.code, { children: "h-[90vh]" }),
			" (the ",
			createVNode(_components.code, { children: "RightPanelDrawer" }),
			" pattern), grabber pill, ≥44 px tap targets:"
		] }),
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
					children: createVNode(_components.span, { children: "              ▁▁▁▁▁▁                                   ← grabber (w-10 h-1 rounded-full)" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "   ┌────────────────────────────────────────────┐" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "   │ ⏱ History                 Find…    ⤓    ✕   │     header — each control ≥44px" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "   │ claude-code · feat/female-flat              │" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "   │ [ Top ]  [ Latest ]  [ Jump to time ▾ ]     │     jump row (full-width buttons)" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "   ├────────────────────────────────────────────┤" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "   │ $ pnpm test                                 │" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "   │ ✓ packages/kaval (42)                       │     read-only xterm" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "   │ …                                           │     native touch scroll;" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "   │ ▓ match highlighted ▓                       │     backfills on scroll-near-top" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "   │ …                                           │" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "   │                                             │" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "   ├────────────────────────────────────────────┤" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "   │  line ~1,284,330 · 3 days ago               │" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "   │        ↓   Jump to live   ◴                 │     big target, ring pulses on new output" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "   └────────────────────────────────────────────┘" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "        (Drawer.Overlay backdrop dims the tile behind)" })
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The component forks on ",
			createVNode(_components.code, { children: "layoutMode()" }),
			" (",
			createVNode($$Cite, {
				file: "packages/client/src/useMobile.ts",
				label: "useMobile.ts:58-67"
			}),
			"): ",
			createVNode(_components.code, { children: "ModalDialog" }),
			" for ",
			createVNode(_components.code, { children: "desktop" }),
			", ",
			createVNode(_components.code, { children: "Drawer" }),
			" for ",
			createVNode(_components.code, { children: "phone" }),
			"/",
			createVNode(_components.code, { children: "compact" }),
			" — exactly as the right panel forks between a Resizable split and ",
			createVNode(_components.code, { children: "RightPanelDrawer" }),
			". Touch invocation is a “History” row in ",
			createVNode($$Cite, {
				file: "packages/client/src/MobileChromeSheet.tsx",
				label: "MobileChromeSheet.tsx:87-141"
			}),
			" next to Palette/Settings/Inspector (with a ",
			createVNode(_components.code, { children: "Kbd" }),
			" chip via ",
			createVNode(_components.code, { children: "formatKeybind" }),
			"), plus the palette. Every control is ≥44 px (above the 24 px WCAG floor the codebase already targets, ",
			createVNode($$Cite, {
				file: "packages/client/src/MobileTileView.tsx",
				label: "MobileTileView.tsx:191-211"
			}),
			")."
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Interactions." }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Scroll / page / backfill." }),
				" The body is a dedicated read-only ",
				createVNode(_components.code, { children: "@xterm/headless" }),
				"-on-DOM instance (its own ",
				createVNode(_components.code, { children: "FitAddon" }),
				" + ",
				createVNode(_components.code, { children: "SearchAddon" }),
				", ",
				createVNode(_components.strong, { children: "DOM renderer" }),
				" to spare the WebGL budget, ",
				createVNode($$Cite, {
					file: "packages/client/src/terminal/webglBudget.ts",
					label: "webglBudget.ts"
				}),
				"), never attached to the live PTY. It opens at the ",
				createVNode(_components.strong, { children: "bottom" }),
				", contiguous with the screen the user just left (the snapshot’s ",
				createVNode(_components.code, { children: "historyCursor" }),
				" makes the join overlap, not gap). Reading is upward. Bindings: wheel/trackpad, PageUp/PageDown, ↑/↓, plus pager idioms — Space/b page down/up, g/G top/latest, ",
				createVNode(_components.code, { children: "/" }),
				" focuses search. Within ~N rows of the loaded top it fires ",
				createVNode(_components.code, { children: "`history({ id, beforeCursor: topCursor, maxLines, width })`" }),
				" and ",
				createVNode(_components.strong, { children: "prepends" }),
				" the returned ANSI, holding scroll position stable by re-anchoring on the previous top line’s cursor (byte cursors are reflow-stable; line numbers are not). A thin top sentinel shimmers in flight."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Search within history (two-tier)." }),
				" The header field mirrors ",
				createVNode($$Cite, {
					file: "packages/client/src/terminal/SearchBar.tsx",
					label: "SearchBar.tsx:35-184"
				}),
				" — “n / m” count, up/down chevrons, Enter = next, Shift+Enter = previous, Esc closes. But finding goes through ",
				createVNode(_components.code, { children: "searchHistory({ id, query, regex, caseSensitive })" }),
				" (cross-window seeking on disk), not xterm’s in-buffer ",
				createVNode(_components.code, { children: "SearchAddon" }),
				". Selecting a match fetches and centers the range; once in view, the pager’s own ",
				createVNode(_components.code, { children: "SearchAddon" }),
				" paints the in-view occurrences with the live search decorations (",
				createVNode(_components.code, { children: "SEARCH_OPTIONS" }),
				", SearchBar.tsx:22-32). Clean split: ",
				createVNode(_components.code, { children: "searchHistory" }),
				" seeks, the local ",
				createVNode(_components.code, { children: "SearchAddon" }),
				" highlights."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Jump ▾" }),
				" — an anchored popover (",
				createVNode(_components.code, { children: "surface()" }),
				" chrome) offering Top (g/Home), Latest (G/End), and ",
				createVNode(_components.strong, { children: "time anchors" }),
				" (relative quick-picks + “Pick a time…”) because the transcript is time-indexed (by-time range reads at 0.004 ms). ",
				createVNode(_components.strong, { children: "No jump-to-line" }),
				" — render-line numbers drift under reflow, the whole reason the cursor is an opaque byte offset."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Export PDF" }),
				" — the “⤓ PDF” button repoints ",
				createVNode($$Cite, {
					file: "packages/client/src/exportScrollbackAsPdf.ts",
					label: "exportScrollbackAsPdf.ts:19-89"
				}),
				" from the in-buffer ",
				createVNode(_components.code, { children: "serializeAsHTML()" }),
				" (today clipped to the 50 K client ring, ",
				createVNode($$Cite, {
					file: "packages/common/src/config.ts",
					label: "config.ts:29"
				}),
				") to ",
				createVNode(_components.code, { children: "exportHistory({ id, width, fromCursor?, toCursor? })" }),
				" — full on-disk depth, rendered per the rules in ",
				createVNode(_components.em, { children: "Full PDF export" }),
				" below. A live text selection offers “Export selection”."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Copy" }),
				" — native selection over the read-only xterm; Ctrl+Shift+C / Cmd+C reuses ",
				createVNode(_components.code, { children: "copySelection" }),
				" (actions.ts:294-302). An overflow “Copy all history” calls the ",
				createVNode(_components.em, { children: "same" }),
				" transcript text read that ",
				createVNode(_components.code, { children: "handleCopyTerminalText" }),
				" is re-routed onto (",
				createVNode($$Cite, {
					file: "packages/client/src/terminal/useTerminalCrud.ts",
					label: "useTerminalCrud.ts:275-293"
				}),
				") — palette “Copy terminal text” and the pager share one disk-backed source."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Coexistence with the live tile." }),
				" New PTY output keeps accruing to the mirror ",
				createVNode(_components.em, { children: "and" }),
				" the transcript while you read; the pager doesn’t tail it (it is the past), but a “◴ new” ring on “Jump to live ↓” pulses when output arrived, reusing ",
				createVNode(_components.code, { children: "ScrollToBottom" }),
				"’s ",
				createVNode(_components.code, { children: "animate-ping" }),
				" ring (",
				createVNode($$Cite, {
					file: "packages/client/src/terminal/ScrollToBottom.tsx",
					label: "ScrollToBottom.tsx:30-33"
				}),
				"). “Jump to live ↓” closes the pager and scrolls the live grid to the bottom."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "State edges." }),
				" ",
				createVNode(_components.em, { children: "Reconnect:" }),
				" backfill rides the reconnect-safe ",
				createVNode(_components.code, { children: "stream" }),
				" namespace; ",
				createVNode(_components.code, { children: "onRetry" }),
				" clears the pager xterm (",
				createVNode(_components.code, { children: "terminal?.reset()" }),
				") before the re-subscribed snapshot lands — the same double-paint defense the live attach uses (",
				createVNode($$Cite, {
					file: "packages/client/src/terminal/Terminal.tsx",
					label: "Terminal.tsx:795-808"
				}),
				"). ",
				createVNode(_components.em, { children: "Evicted:" }),
				" “Older output trimmed to stay under the NN MB history limit” — the honest ",
				createVNode(_components.code, { children: "`{kind:\"evicted\"}`" }),
				" state, never silent-empty. ",
				createVNode(_components.em, { children: "Unavailable" }),
				" (",
				createVNode(_components.code, { children: "history.enabled:false" }),
				"): “History isn’t being recorded for this terminal” (",
				createVNode(_components.code, { children: "`{kind:\"unavailable\"}`" }),
				"). ",
				createVNode(_components.em, { children: "Faulted:" }),
				" on a runtime disk fault the daemon degrades that one transcript to ",
				createVNode(_components.code, { children: "`{faulted, lastGoodSeq}`" }),
				" via ",
				createVNode(_components.code, { children: "daemonStatus" }),
				"; the pager shows a top warning banner, never presenting a truncated log as complete — the one place survivability outranks fail-fast (",
				createVNode($$Cite, {
					file: ".claude/rules/conventions.md",
					label: "caught-error-must-not-collapse-to-empty"
				}),
				")."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Reused primitives:" }),
			" ",
			createVNode(_components.code, { children: "ModalDialog" }),
			" (desktop host, ",
			createVNode(_components.code, { children: "size=\"lg\"" }),
			", height ",
			createVNode(_components.code, { children: "min(74vh, 60rem)" }),
			"); ",
			createVNode(_components.code, { children: "RightPanelDrawer.tsx:58-85" }),
			" (mobile host — grabber, overlay, ",
			createVNode(_components.code, { children: "withKeyboardDismiss" }),
			" + ",
			createVNode(_components.code, { children: "restoreFocus={false}" }),
			"); ",
			createVNode(_components.code, { children: "SearchBar.tsx:35-184" }),
			" (header field clone); ",
			createVNode(_components.code, { children: "ScrollToBottom.tsx:7-37" }),
			" (jump-to-live ring); ",
			createVNode(_components.code, { children: "Terminal.tsx:34,795-808" }),
			" (",
			createVNode(_components.code, { children: "streamCall(client.stream.history, …, { signal, onRetry })" }),
			"); ",
			createVNode(_components.code, { children: "useTerminalSearch.ts:31-78" }),
			" (",
			createVNode(_components.code, { children: "useHistoryPager" }),
			" singleton); ",
			createVNode(_components.code, { children: "webglBudget.ts" }),
			" (DOM renderer); ",
			createVNode(_components.code, { children: "Surface.ts" }),
			" + ",
			createVNode(_components.code, { children: "Kbd.tsx" }),
			" (popover chrome + chips)."
		] }),
		"\n",
		createVNode(_components.h4, {
			id: "full-pdf-export-product-question--answered",
			children: "Full PDF export (product question — answered)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Will users get the full PDF instead of a clipped one? YES, decisively." }),
			" Today ",
			createVNode($$Cite, {
				file: "packages/client/src/exportScrollbackAsPdf.ts",
				label: "exportScrollbackAsPdf.ts:28"
			}),
			" serializes ",
			createVNode(_components.code, { children: "serializeAsHTML()" }),
			" off the ",
			createVNode(_components.strong, { children: "live client xterm ring" }),
			" — clipped to ",
			createVNode(_components.code, { children: "DEFAULT_SCROLLBACK" }),
			" (50 K) and in practice only to what that client buffered (the header even admits it is “NOT the full session”). After PR2, ",
			createVNode(_components.code, { children: "useTerminalCrud.exportScrollbackPdf" }),
			" (useTerminalCrud.ts:325) repoints at ",
			createVNode(_components.code, { children: "exportHistory" }),
			", which reads the ",
			createVNode(_components.strong, { children: "entire per-id transcript on disk" }),
			" — bounded only by the per-terminal ",
			createVNode(_components.code, { children: "retentionBytes" }),
			", surviving server restarts. A multi-hour session that scrolled past the client cap exports in full."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Render width = historical-per-span (faithful), not a fixed export width and not the live width." }),
			" ",
			createVNode(_components.code, { children: "exportHistory" }),
			" walks the transcript oldest→newest and renders each inter-",
			createVNode(_components.code, { children: "RESIZE" }),
			" span at the cols actually in effect then, freezing each span’s wrapped lines before the next ",
			createVNode(_components.code, { children: "RESIZE" }),
			" is applied. A PDF is an archival document; a 200-col table re-wrapped to a narrow width is the exact content the user exported to keep, turned to garbage. The ",
			createVNode(_components.code, { children: "RESIZE" }),
			" epochs make per-span width recoverable (each ",
			createVNode(_components.code, { children: "CKPT" }),
			" stores ",
			createVNode(_components.code, { children: "cols" }),
			"), and the spike proved checkpoint-replay reproduces the exact screen across resize with ",
			createVNode(_components.code, { children: "RESIZE" }),
			" records load-bearing (the negative control) — using them is ",
			createVNode(_components.em, { children: "reuse the source of truth" }),
			". ",
			createVNode(_components.strong, { children: "When the pager is the export source, “current width” = pager width" }),
			" for the visible-range case; the full-depth archival export uses historical-per-span. (This is a ",
			createVNode(_components.em, { children: "desirable" }),
			" divergence from a live xterm, which reflows all scrollback to one final width.)"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Theming handoff" }),
			" (preserving ",
			createVNode(_components.code, { children: "exportScrollbackAsPdf.ts" }),
			"’s existing “server headless has no theme” constraint): the ",
			createVNode(_components.strong, { children: "server" }),
			" streams per-span rendered ANSI-with-SGR segments through the ",
			createVNode(_components.code, { children: "stream" }),
			" namespace (a finite ordered stream, idempotent restart on reconnect, so deep depth isn’t one giant message); the ",
			createVNode(_components.strong, { children: "client" }),
			" writes each segment into an ",
			createVNode(_components.em, { children: "offscreen" }),
			" ",
			createVNode(_components.code, { children: "@xterm/headless" }),
			" + ",
			createVNode(_components.code, { children: "SerializeAddon" }),
			" carrying the live theme — resizing it to each segment’s historical cols before writing — then ",
			createVNode(_components.code, { children: "serializeAsHTML()" }),
			" → the same themed print window the file opens today. Depth moves to the server (un-clipped, faithful); theme stays client-side."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"Edge — ",
				createVNode(_components.code, { children: "history.enabled:false" }),
				"."
			] }),
			" No transcript, so deep export falls to the live client buffer exactly as today (clipped). Not a fail-fast violation: nothing ",
			createVNode(_components.em, { children: "required" }),
			" is missing — the user chose no retention, and exporting the visible buffer is the correct behavior for that mode. The default is ",
			createVNode(_components.code, { children: "enabled:true" }),
			", so full-depth is the path almost every terminal takes."
		] }),
		"\n",
		createVNode(_components.h4, {
			id: "mobile-resize-product-question--answered",
			children: "Mobile resize (product question — answered)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A mobile (or any narrow) client resizing a terminal is ",
			createVNode(_components.strong, { children: "harmless to scrollback and PDF" }),
			", because width is render-time for reads and historical-per-span for export."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Width is one shared PTY size — pre-existing, unchanged by PR2." }),
			" The resize path: client ",
			createVNode(_components.code, { children: "Terminal.tsx" }),
			" ",
			createVNode(_components.code, { children: "FitAddon" }),
			" → ",
			createVNode(_components.code, { children: "client.terminal.resize({id,cols,rows})" }),
			" → ",
			createVNode($$Cite, {
				file: "packages/server/src/router.ts",
				label: "router.ts:113"
			}),
			" → ",
			createVNode(_components.code, { children: "PtyHostTerminalProxy.resize" }),
			" (local.ts:161) → ",
			createVNode(_components.code, { children: "ptyHost.resize" }),
			" (",
			createVNode($$Cite, {
				file: "packages/kaval/src/ptyHost.ts",
				label: "ptyHost.ts:754"
			}),
			") → ",
			createVNode(_components.code, { children: "entry.proc.resize" }),
			" (the one node-pty child) + ",
			createVNode(_components.code, { children: "entry.headless.resize" }),
			" (the one shared mirror) + ",
			createVNode(_components.code, { children: "invalidateSnapshot" }),
			". There is exactly ",
			createVNode(_components.strong, { children: "one" }),
			" ",
			createVNode(_components.code, { children: "proc" }),
			"/",
			createVNode(_components.code, { children: "headless" }),
			" per terminal — no per-client size. All attached clients share the width, last-write-wins; a mobile client fitting to 40 cols reflows the live grid for everyone via SIGWINCH. ",
			createVNode(_components.strong, { children: "This is today’s behavior, not introduced by PR2." })
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "What PR2 adds and why it stays correct:" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "RESIZE" }), " journaling:"] }),
				" ",
				createVNode(_components.code, { children: "ptyHost.resize" }),
				" gains, beside the proc/headless resize + ",
				createVNode(_components.code, { children: "invalidateSnapshot" }),
				", an ",
				createVNode(_components.strong, { children: [
					"append of a typed ",
					createVNode(_components.code, { children: "RESIZE" }),
					" record"
				] }),
				" (",
				createVNode(_components.code, { children: "kind=RESIZE" }),
				", cols, rows) at the current ",
				createVNode(_components.code, { children: "byteSeq" }),
				" — recorded at its true stream position, the load-bearing record the negative control validated. It lands on the same ",
				createVNode(_components.code, { children: "proc.onData" }),
				"/resize writer path, inheriting attach’s race-freedom."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "history()" }), " reads"] }),
				" render at the ",
				createVNode(_components.strong, { children: "reading" }),
				" client’s current width (a render-time parameter), keyed on the reflow-stable byte cursor. A desktop client backfills the same byte range at 200 cols while a phone backfills it at 40 — both get full depth, neither clips the other, and because the cursor is a byte offset, a resize never moves a client’s scroll position."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Live snapshot on attach" }),
				" (",
				createVNode(_components.code, { children: "serialize({ scrollback: HOT_WINDOW })" }),
				") reflects the current shared width; a desktop attaching while a phone holds the PTY narrow paints narrow for a frame, then its own ",
				createVNode(_components.code, { children: "FitAddon" }),
				" re-fits and resizes the shared PTY back (existing behavior). Transcript / history / PDF untouched."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "PDF is historical-per-span," }),
				" so a mobile-narrow span renders at 40 and a desktop-wide span at 200 in the ",
				createVNode(_components.em, { children: "same" }),
				" export — the document is never clipped or squeezed to a narrow live width. ",
				createVNode(_components.strong, { children: "A mobile resize cannot shrink the exported document." })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The pager is its own fixed-width surface." }),
				" A phone rotating or a foldable unfolding just recomputes the pager xterm’s cols (its own ",
				createVNode(_components.code, { children: "FitAddon" }),
				") and re-fetches the visible range at the new width — it never reflows or corrupts the live grid and ",
				createVNode(_components.strong, { children: "never writes anything back to the transcript" }),
				" (typed records are width-agnostic; width is render-time only)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h4, {
			id: "searchhistory-semantics",
			children: "searchHistory semantics"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A ",
			createVNode(_components.strong, { children: "server-side scan over the on-disk transcript" }),
			" that re-routes the find-bar’s deep search — ",
			createVNode(_components.em, { children: "not" }),
			" the live xterm ",
			createVNode(_components.code, { children: "SearchAddon" }),
			"."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Default = literal substring, case-INsensitive" }),
				" — exactly what ",
				createVNode(_components.code, { children: "SearchBar.tsx" }),
				"’s ",
				createVNode(_components.code, { children: "SEARCH_OPTIONS" }),
				" does today (it sets only ",
				createVNode(_components.code, { children: "incremental" }),
				" + ",
				createVNode(_components.code, { children: "decorations" }),
				"; ",
				createVNode(_components.code, { children: "regex" }),
				"/",
				createVNode(_components.code, { children: "caseSensitive" }),
				" unset → false), so the re-route changes nothing the user sees."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "regex" }),
					" and ",
					createVNode(_components.code, { children: "caseSensitive" }),
					" are opt-in booleans"
				] }),
				" on the input, mirroring xterm’s ",
				createVNode(_components.code, { children: "ISearchOptions" }),
				" shape 1:1 (",
				createVNode(_components.em, { children: "reuse the source of truth" }),
				" — these are genuine search capabilities, not degradation knobs, so the fail-fast “no override knobs” rule does not apply). The find-bar can expose toggles later; until then the default reproduces today exactly."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Invalid user regex is surfaced" }), " as a find-bar validation error (“invalid pattern”), never collapsed to empty results (a malformed pattern is user input, a surfaced error, not an internal swallow)."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "How it scans:" }),
				" the schema keeps only the zstd VT payload (no plain-text column — that is write-amplification and a second source of truth), so search ",
				createVNode(_components.strong, { children: "replays rather than greps" }),
				". It walks ",
				createVNode(_components.code, { children: "record" }),
				" rows newest-first from ",
				createVNode(_components.code, { children: "beforeCursor" }),
				" (or the tip); for each zstd DATA block it decompresses and replays from the nearest preceding ",
				createVNode(_components.code, { children: "CKPT" }),
				" into a throwaway headless — the same machinery ",
				createVNode(_components.code, { children: "history()" }),
				"/",
				createVNode(_components.code, { children: "exportHistory" }),
				" use — joins ",
				createVNode(_components.code, { children: "isWrapped" }),
				" continuation rows into ",
				createVNode(_components.strong, { children: "logical" }),
				" lines (so matching is ",
				createVNode(_components.strong, { children: "width-independent" }),
				": a hit is never split by an arbitrary wrap column), and applies the literal-substring or ",
				createVNode(_components.code, { children: "RegExp" }),
				" test per logical line. Runs behind the same read semaphore as ",
				createVNode(_components.code, { children: "history()" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Returns" }),
				" an ordered (newest-first) bounded array: ",
				createVNode(_components.code, { children: "`{ cursor: ByteSeq (reflow-stable, feeds history() so the pager opens AT the match), firstRow: Row, text: string, matches: [{ start, end }] }`" }),
				" + ",
				createVNode(_components.code, { children: "nextCursor: ByteSeq | null" }),
				" + ",
				createVNode(_components.code, { children: "truncated: boolean" }),
				". Capped at ",
				createVNode(_components.code, { children: "maxResults" }),
				" (hard cap 1000) per call; on hitting the cap it sets ",
				createVNode(_components.code, { children: "truncated" }),
				" and returns ",
				createVNode(_components.code, { children: "nextCursor" }),
				" so the find-bar pages “search older”. ",
				createVNode(_components.strong, { children: "One-shot request/response RPC" }),
				", cursor-paged — only the paging ",
				createVNode(_components.code, { children: "history()" }),
				" backfill needs the ",
				createVNode(_components.code, { children: "stream" }),
				" namespace; a search reconnect just re-issues the query."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h4, {
			id: "session-restore-semantics",
			children: "Session restore semantics"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The ",
			createVNode(_components.strong, { children: "visible-screen restore is unchanged" }),
			"; the transcript only adds deep, durable reach — it does not resurrect a killed PTY’s live screen."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Warm restart" }),
				" (daemon outlives kolu-server — the common case, ",
				createVNode(_components.code, { children: "reconcile.ts → adoptTerminal" }),
				"): the live PTY and its in-kaval mirror survive in the daemon’s memory, so the visible screen repaints from the surviving mirror via re-attach exactly as today. PR2 only shrinks that mirror to ",
				createVNode(_components.code, { children: "rows + 40" }),
				" and bounds the snapshot to ",
				createVNode(_components.code, { children: "HOT_WINDOW" }),
				" — and the reload now reaches ",
				createVNode(_components.strong, { children: "more" }),
				" history (full on-disk depth via backfill), not less. No regression."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Cold restore" }),
				" (no survivor — the “restore card” re-spawns onto a fresh daemon): the re-spawn reuses the ",
				createVNode(_components.strong, { children: "saved terminal id" }),
				" (id stability is already the architecture’s invariant — kolu-server mints terminal id == PTY id), so it reopens the ",
				createVNode(_components.em, { children: "same" }),
				" ",
				createVNode(_components.code, { children: "<id>.db" }),
				" and ",
				createVNode(_components.strong, { children: "appends" }),
				" (seq continues from the persisted max). The fresh shell is blank on screen (only the existing agent-resume replay repopulates it), but the pager/search/PDF reach the pre-restart deep history through the continued transcript."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Sleep→wake:" }),
				" wake re-spawns the PTY fresh on the same id and reopens/appends the same ",
				createVNode(_components.code, { children: "<id>.db" }),
				", so a woken terminal’s pager scrolls back into its pre-sleep history — reach sleep/wake lacked. Live screen = the fresh resumed shell (unchanged)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The one-time 4.0 recycle:" }),
				" the breaking ",
				createVNode(_components.code, { children: "PTY_HOST_CONTRACT_VERSION" }),
				" 3.3→4.0 bump (",
				createVNode($$Cite, {
					file: "packages/kaval/src/ptyHostSurface.ts",
					label: "ptyHostSurface.ts:74"
				}),
				") kills every live terminal once. Their transcripts persist on disk but the terminals are gone — exited-terminal DBs the global sweeper reclaims first. Restore does not resurrect them; durable history begins for terminals spawned at/after the recycle."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h4, {
			id: "nodesqlite-inside-the-real-nix-closure--confirmed",
			children: [createVNode(_components.code, { children: "node:sqlite" }), " inside the real nix closure — confirmed"]
		}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "It loads, two ways." }) }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Analytic closure chain." }),
				" ",
				createVNode(_components.code, { children: "nix/nixpkgs.nix" }),
				" pins nixpkgs rev ",
				createVNode(_components.code, { children: "f8573b9c935cfaa162dd62cc9e75ae2db86f85df" }),
				"; ",
				createVNode(_components.code, { children: "nix/overlay.nix" }),
				" adds only ",
				createVNode(_components.code, { children: "kolu-fonts" }),
				" and does ",
				createVNode(_components.strong, { children: "not" }),
				" override ",
				createVNode(_components.code, { children: "nodejs" }),
				"; ",
				createVNode(_components.code, { children: "default.nix" }),
				"’s kaval derivation wraps ",
				createVNode(_components.code, { children: "${pkgs.nodejs}/bin/node" }),
				" with the tsx loader and ",
				createVNode(_components.code, { children: "bin.ts" }),
				" (no extra flags, no ",
				createVNode(_components.code, { children: "NODE_OPTIONS" }),
				"). So the kaval runtime ",
				createVNode(_components.strong, { children: "is" }),
				" exactly ",
				createVNode(_components.code, { children: "pkgs.nodejs" }),
				", which at that pin resolves (",
				createVNode(_components.code, { children: "nix eval" }),
				" locally + a clean ",
				createVNode(_components.code, { children: "nix build" }),
				" on a box) to ",
				createVNode(_components.code, { children: "/nix/store/sy0c7j0npsq33d9zhnnzvjnzc52f4y0p-nodejs-24.13.0" }),
				". ",
				createVNode(_components.code, { children: "node:sqlite" }),
				" is a C++ builtin compiled into that binary, so the full-closure build cannot change the result."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Empirical, on a fresh pu box" }),
				" (destroyed after; egress probed 200): built that exact pinned ",
				createVNode(_components.code, { children: "pkgs.nodejs" }),
				" + ",
				createVNode(_components.code, { children: "pkgs.tsx" }),
				", then ran ",
				createVNode(_components.code, { children: "node:sqlite" }),
				" three ways under ",
				createVNode(_components.code, { children: "…-nodejs-24.13.0/bin/node" }),
				", all exit 0 — (a) bare ",
				createVNode(_components.code, { children: "require(\"node:sqlite\")" }),
				" → ",
				createVNode(_components.code, { children: "DatabaseSync" }),
				" is a function; (b) a real WAL DB: ",
				createVNode(_components.code, { children: "PRAGMA journal_mode=WAL" }),
				" → ",
				createVNode(_components.code, { children: "{journal_mode:wal}" }),
				", 1000 zstd-magic BLOB rows inserted, indexed range-by-",
				createVNode(_components.code, { children: "firstByteSeq" }),
				" SELECT returned the right row, BLOB round-tripped as ",
				createVNode(_components.code, { children: "Uint8Array" }),
				"; (c) kaval’s exact launch shape ",
				createVNode(_components.code, { children: "node --import <tsx loader.mjs> file.ts" }),
				" importing ",
				createVNode(_components.code, { children: "node:sqlite" }),
				" from TypeScript — works, the tsx loader passes the builtin specifier through."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"No flag, no ",
				createVNode(_components.code, { children: "NODE_OPTIONS" }),
				", no suppression knob."
			] }),
			" Node 24.13.0 exposes ",
			createVNode(_components.code, { children: "node:sqlite" }),
			" by default (the ",
			createVNode(_components.code, { children: "--experimental-sqlite" }),
			" requirement was dropped in v23.4); both ",
			createVNode(_components.code, { children: "require()" }),
			" and ESM ",
			createVNode(_components.code, { children: "import" }),
			" return exit 0 with zero flags, including through tsx. The only runtime effect is one ",
			createVNode(_components.code, { children: "ExperimentalWarning: SQLite is an experimental feature…" }),
			" printed to stderr on the ",
			createVNode(_components.strong, { children: "first" }),
			" ",
			createVNode(_components.code, { children: "DatabaseSync" }),
			" construction. ",
			createVNode(_components.strong, { children: [
				"The implementer must leave the kaval wrapper’s ",
				createVNode(_components.code, { children: "--add-flags" }),
				" unchanged and must NOT add ",
				createVNode(_components.code, { children: "--no-warnings" }),
				" / ",
				createVNode(_components.code, { children: "NODE_NO_WARNINGS" }),
				" / ",
				createVNode(_components.code, { children: "--experimental-sqlite" }),
				":"
			] }),
			" a suppression knob is exactly the override the fail-fast rule forbids, it would mask unrelated warnings, and the existing ",
			createVNode(_components.code, { children: "codex" }),
			"/",
			createVNode(_components.code, { children: "opencode" }),
			" integrations already ",
			createVNode(_components.code, { children: "import { DatabaseSync } from \"node:sqlite\"" }),
			" and emit this same warning in the shipped server with no special handling — PR2 follows that precedent. ",
			createVNode(_components.strong, { children: "Net:" }),
			" ",
			createVNode(_components.code, { children: "import { DatabaseSync } from \"node:sqlite\"" }),
			" in ",
			createVNode(_components.code, { children: "@kolu/shared/sqlite" }),
			", do nothing to the nix wrapper, accept the one cosmetic stderr line."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.em, { children: "Watch-item (not an open question):" }),
			" ",
			createVNode(_components.code, { children: "node:sqlite" }),
			" is officially experimental — the API “might change at any time.” The surface used (",
			createVNode(_components.code, { children: "new DatabaseSync(path)" }),
			", ",
			createVNode(_components.code, { children: "prepare" }),
			"/",
			createVNode(_components.code, { children: "run" }),
			"/",
			createVNode(_components.code, { children: "get" }),
			"/",
			createVNode(_components.code, { children: "exec" }),
			", ",
			createVNode(_components.code, { children: "PRAGMA journal_mode=WAL" }),
			", BLOB↔",
			createVNode(_components.code, { children: "Uint8Array" }),
			") is stable across the 24.x line and the version is locked by nixpkgs via npins, so any Node bump rides a deliberate ",
			createVNode(_components.code, { children: "npins update" }),
			", never silent drift. A future major could change the API — the implementer’s to watch, not a blocker."
		] }),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Open questions: NONE." }),
			" Every prior fork is closed and every constant pinned. The single artifact surfaced by the seam spike is ",
			createVNode(_components.strong, { children: "not an open decision" }),
			": the combining-mark-on-width-change misattachment is an ",
			createVNode(_components.em, { children: "upstream xterm reflow limitation" }),
			", reproduced by a plain live-terminal resize with no checkpoint involved (so the pager is not a regression), and the protocol’s DATA-replayed-return rule keeps it out of every returned and stitched line — it can only touch a reflowed checkpoint ",
			createVNode(_components.em, { children: "seed" }),
			", which is never displayed. Stated here in the open rather than papered over; it gates nothing in PR2 and a future xterm fix removes even the seed-level trace."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Supersedes in the OOM RCA",
			children: createVNode(_components.p, { children: [
				"(1) the store is ",
				createVNode(_components.strong, { children: "typed records with resize epochs" }),
				", not raw bytes; (2) ",
				createVNode(_components.strong, { children: "checkpointing is mandatory" }),
				", inseparable from lazy backfill; (3) the ",
				createVNode(_components.strong, { children: "acute transient is a distinct bug, shipped first" }),
				" (PR1) — ",
				createVNode($$PrLink, { pr: 1427 }),
				"’s 50 K→10 K shrink raised the ceiling but left the full-buffer serialize in place; (4) the store ",
				createVNode(_components.strong, { children: [
					"reuses ",
					createVNode(_components.code, { children: "@kolu/shared/sqlite" }),
					" (node:sqlite)"
				] }),
				", not a hand-rolled binary log + index — and so is a kaval ",
				createVNode(_components.em, { children: "leaf" }),
				", not a new package; (5) the wire change is ",
				createVNode(_components.strong, { children: "one breaking 4.0 recycle" }),
				", not #417’s additive multi-PR."
			] })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Kaval Memory — Small Mirror over an On-Disk Transcript",
	"description": "Plan of record for kaval's PTY-host memory. Split one 10 K-line mirror into a small line-capped hot mirror, a cold on-disk transcript stored in node:sqlite (reusing @kolu/shared/sqlite, the repo's canonical store — no hand-rolled storage engine), and an attach protocol that never serializes more than a viewport. Kills both the acute reconnect-storm transient and the chronic linear-in-count heap growth.",
	"parents": ["pty-daemon", "analysis"],
	"status": "proposed",
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
			"depth": 3,
			"slug": "the-boundary-reuse-kolusharedsqlite--dont-hand-roll-a-storage-engine",
			"text": "The boundary: reuse @kolu/shared/sqlite — don’t hand-roll a storage engine"
		},
		{
			"depth": 2,
			"slug": "implementation-details",
			"text": "Implementation details"
		},
		{
			"depth": 3,
			"slug": "pr1-defang-the-storm--kaval-internal-no-disk-no-wire-change",
			"text": "PR1 Defang the storm — kaval-internal, no disk, no wire change"
		},
		{
			"depth": 3,
			"slug": "pr2-the-on-disk-transcript--write-read-and-shrink-atomically",
			"text": "PR2 The on-disk transcript — write, read, and shrink, atomically"
		},
		{
			"depth": 4,
			"slug": "pinned-constants",
			"text": "Pinned constants"
		},
		{
			"depth": 4,
			"slug": "the-backfill-seam-protocol",
			"text": "The backfill seam protocol"
		},
		{
			"depth": 4,
			"slug": "the-copy-mode-pager",
			"text": "The copy-mode pager"
		},
		{
			"depth": 4,
			"slug": "full-pdf-export-product-question--answered",
			"text": "Full PDF export (product question — answered)"
		},
		{
			"depth": 4,
			"slug": "mobile-resize-product-question--answered",
			"text": "Mobile resize (product question — answered)"
		},
		{
			"depth": 4,
			"slug": "searchhistory-semantics",
			"text": "searchHistory semantics"
		},
		{
			"depth": 4,
			"slug": "session-restore-semantics",
			"text": "Session restore semantics"
		},
		{
			"depth": 4,
			"slug": "nodesqlite-inside-the-real-nix-closure--confirmed",
			"text": "node:sqlite inside the real nix closure — confirmed"
		}
	];
}
var url = "src/content/atlas/kaval-memory-architecture.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-memory-architecture.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-memory-architecture.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
