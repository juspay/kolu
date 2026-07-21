import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$D2 } from "./D2_CPv-UX0x.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import { t as $$Finding } from "./Finding_CGyJz3Ru.mjs";
//#region src/content/atlas/opencode-perf.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		del: "del",
		em: "em",
		h2: "h2",
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
			"A read of ",
			createVNode(_components.a, {
				href: "https://x.com/LukeParkerDev/status/2066190330660004230",
				children: "OpenCode Desktop v2’s perf release"
			}),
			"\n(≈4 → 45.7 FPS under a 30× CPU throttle) against Kolu’s real architecture.\nMethod: 13 agents — external research ▸ code-map ▸ synthesize ▸ adversarially\nverify; every load-bearing fact re-checked against source + the npm registry."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Verdict — the number is workload-specific",
			children: createVNode(_components.p, { children: [
				"OpenCode’s win is a ",
				createVNode(_components.strong, { children: "streaming-markdown message timeline" }),
				" number. Kolu has no\nsuch surface: agent output is the ",
				createVNode(_components.code, { children: "xterm.js" }),
				" WebGL terminal, the only transcript\nis a static HTML export, and the live code/diff views are ",
				createVNode(_components.em, { children: "already" }),
				" virtualized\ninside Pierre.\nSo 4 of their 6 techniques have ",
				createVNode(_components.strong, { children: "no consumer" }),
				" here. What transfers is narrow,\nand all of it has now shipped: ",
				createVNode(_components.strong, { children: "R1" }),
				" (bump ",
				createVNode(_components.code, { children: "@pierre/diffs" }),
				" 1.2.1 → 1.2.10 + Shiki\nto 4.2.0) ",
				createVNode($$PrLink, { pr: 1360 }),
				", ",
				createVNode(_components.strong, { children: "R2" }),
				" (move diff/file highlighting to a worker\npool, off the UI thread) ",
				createVNode($$PrLink, { pr: 1363 }),
				", and ",
				createVNode(_components.strong, { children: "R3+R4" }),
				" — a CPU-throttle\ngesture harness that proved the canvas pan/zoom write-storm freezes a weak client,\nand the rAF-coalesce that fixes it ",
				createVNode($$PrLink, { pr: 1368 }),
				"."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Update — transcript export left the Pierre path",
			children: createVNode(_components.p, { children: [
				"The session HTML export now emits a plain no-JavaScript chat/full document:\nfenced code and tool payloads are escaped text, and the lightweight chat file\nomits hidden tool payloads entirely. So the Pierre/Shiki conclusions in this\nnote apply to Kolu’s live Code-tab surfaces, not to ",
				createVNode(_components.code, { children: "transcript-html" }),
				"."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Update — R1 shipped (#1360)",
			children: createVNode(_components.p, { children: [
				"The Pierre + Shiki bump landed on master. It touched ",
				createVNode(_components.strong, { children: "no source code" }),
				" — the\nbreaking-change risks flagged below were all non-issues, proven green by\n",
				createVNode(_components.code, { children: "typecheck" }),
				" + ",
				createVNode(_components.code, { children: "solid-markdown" }),
				"/",
				createVNode(_components.code, { children: "solid-pierre" }),
				" unit tests + ",
				createVNode(_components.code, { children: "nix build" }),
				". Shiki\nmoved ",
				createVNode(_components.strong, { children: "3.23.0 → 4.2.0 deliberately" }),
				": ",
				createVNode(_components.code, { children: "@pierre/diffs" }),
				" takes ",
				createVNode(_components.code, { children: "shiki" }),
				" as a regular\ndependency and ",
				createVNode(_components.code, { children: "solid-markdown" }),
				" shares that same install, so bumping only one\nwould split the workspace into ",
				createVNode(_components.em, { children: "two" }),
				" shiki copies — bumping both keeps a single\nshared ",
				createVNode(_components.code, { children: "4.2.0" }),
				". R2 then shipped on that substrate ",
				createVNode($$PrLink, { pr: 1363 }),
				"."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-10-is-workload-specific",
			children: "The 10× is workload-specific"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"OpenCode’s six techniques: (1) migrate the message timeline to ",
			createVNode(_components.strong, { children: "TanStack\nVirtual" }),
			" with chat anchoring (",
			createVNode(_components.code, { children: "anchorTo:'end'" }),
			", ",
			createVNode(_components.code, { children: "followOnAppend" }),
			"); (2) ",
			createVNode(_components.strong, { children: "flicker\n/ scroll-jump fixes" }),
			" (",
			createVNode(_components.code, { children: "overflow-anchor:none" }),
			" + a manual rAF visual-anchor, and\nan absolute — not delta — scrollbar-thumb mapping); (3) ",
			createVNode(_components.strong, { children: "bump Pierre 1.2.10 +\nShiki 4.2.0" }),
			"; (4) ",
			createVNode(_components.strong, { children: "Shiki → Web Worker" }),
			" (stream-tokenize the new suffix, reply\nwith compact ",
			createVNode(_components.code, { children: "[content, style]" }),
			" tuples); (5) ",
			createVNode(_components.strong, { children: "append-only assumptions" }),
			" (a\ntext-delta accumulator bug that was the bogus 4-FPS baseline, plus freeze-all-\nprior-messages-only-the-last-mutates); (6) ",
			createVNode(_components.strong, { children: "perf-trace CPU work" }),
			" — profile\nunder 30× throttle, optimize ",
			createVNode(_components.strong, { children: "p95/p99 frame time" }),
			", and ",
			createVNode(_components.em, { children: "log rejected\nexperiments" }),
			" (their token-batching and height-estimator ideas regressed the tail)."
		] }),
		"\n",
		createVNode(_components.p, { children: "The headline number is a dev-profiling figure on a long, growing list of\nvariable-height markdown/diff messages. That list is the thing being virtualized,\nanchored, and worker-highlighted — it’s the whole game." }),
		"\n",
		createVNode(_components.h2, {
			id: "why-most-of-it-has-no-consumer-in-kolu",
			children: "Why most of it has no consumer in Kolu"
		}),
		"\n",
		createVNode(_components.p, { children: "Kolu’s perf-relevant surfaces, colored by verdict — green = done / already\ncovered / N-A, teal = the live agent stream:" }),
		"\n",
		createVNode($$D2, {
			caption: "Kolu's perf surfaces, all wins now green. R1 (#1360) + R2 (#1363) the diff path; R3+R4 the canvas-gesture harness + rAF-coalesce (#1368). Teal = the live agent stream (no consumer for the streaming-list techniques).",
			code: `
direction: down

shiki: "shiki 4.2.0 ✓ #1360" {
style.fill: "#e6f4ea"
}
diffs: "@pierre/diffs 1.2.10 ✓ R1 #1360" {
style.fill: "#e6f4ea"
}
codeview: "solid-pierre CodeView · R2 ✓ #1363" {
style.fill: "#e6f4ea"
}
views: "client code/diff views" {
style.fill: "#e6f4ea"
}
markdown: "solid-markdown · already cached" {
style.fill: "#e6f4ea"
}
terminal: "terminal · xterm.js (live stream)" {
style.fill: "#e1f0f3"
}
canvas: "canvas pan/zoom · R4 ✓ coalesced" {
style.fill: "#e6f4ea"
}
tracer: "gesture p99 harness · R3 ✓" {
style.fill: "#e6f4ea"
}

shiki -> diffs
shiki -> markdown
diffs -> codeview: "2.3× parser + worker"
codeview -> views
tracer -> canvas: "proved the freeze"
tracer -> codeview: "large-diff render"
`
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "#1, #2 (virtualize + scroll-anchor a message list)" }),
				" — no growing list to\nvirtualize. Code/diffs are already windowed inside Pierre’s ",
				createVNode(_components.code, { children: "CodeView" }),
				"\n(inverse-sticky, binary-searched position→line, browser ",
				createVNode(_components.code, { children: "overflow-anchor" }),
				"\nalready disabled, own scrollbar). The flicker/scroll fixes live ",
				createVNode(_components.em, { children: "inside Pierre" }),
				"\n— Kolu inherited the latest of them via the 1.2.10 bump (R1, #1360)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "#5 (append-only token accumulator)" }),
				" — no streaming text-delta accumulator.\nAgent state arrives as snapshot-then-full-replacement; ",
				createVNode(_components.code, { children: "Markdown.tsx" }),
				" takes a\n",
				createVNode(_components.em, { children: "complete" }),
				" string and re-renders only when the whole string changes."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "#4 markdown worker" }),
				" — ",
				createVNode(_components.code, { children: "highlight.ts" }),
				" is already the good version: a\ndynamic-imported singleton, highlighting each ",
				createVNode(_components.strong, { children: "completed block once" }),
				" (never\nper-token). A markdown Shiki worker here would be over-engineering. The worker\nwin is the ",
				createVNode(_components.strong, { children: "diff" }),
				" path (R2), not markdown."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-transfers",
			children: "What transfers"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, {}),
					"\n",
					createVNode(_components.th, { children: "Adaptation" }),
					"\n",
					createVNode(_components.th, { children: "Impact" }),
					"\n",
					createVNode(_components.th, { children: "Effort" }),
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
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "R1" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Upgrade ",
						createVNode(_components.code, { children: "@pierre/diffs" }),
						" 1.2.1 → 1.2.10 (+ Shiki 4.2.0)"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "high"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "medium"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "done",
						children: "shipped · #1360"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "R2" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Pierre worker pool + ",
						createVNode(_components.code, { children: "shiki-js" }),
						" engine for the diff path"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "high"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "medium"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "done",
						children: "shipped · #1363"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "R3" }) }),
					"\n",
					createVNode(_components.td, { children: "CPU-throttle gesture work harness (per-event burst)" }),
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
						children: "shipped · #1368"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "R4" }) }),
					"\n",
					createVNode(_components.td, { children: "rAF-coalesce the canvas wheel pan/zoom write-storm" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "medium"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "low"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "done",
						children: "shipped · #1368"
					}) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Finding, {
			sev: "low",
			title: "R1 — Bump @pierre/diffs to 1.2.10 + Shiki 4.2.0 — SHIPPED (#1360)",
			children: createVNode(_components.p, { children: [
				"Done ",
				createVNode($$PrLink, { pr: 1360 }),
				". ",
				createVNode(_components.code, { children: "^1.2.1 → ^1.2.10" }),
				" across ",
				createVNode(_components.code, { children: "solid-pierre" }),
				", ",
				createVNode(_components.code, { children: "client" }),
				",\nand ",
				createVNode(_components.code, { children: "transcript-html" }),
				" as it existed then; ",
				createVNode(_components.code, { children: "shiki ^3.23.0 → ^4.2.0" }),
				" in\n",
				createVNode(_components.code, { children: "solid-markdown" }),
				" (single shared copy). ",
				createVNode(_components.strong, { children: "Deps-only — no source code changed." }),
				" The flagged breaking-change risks\nwere all non-issues: ",
				createVNode(_components.code, { children: "fileGap" }),
				" is used ",
				createVNode(_components.strong, { children: "nowhere" }),
				" (the ",
				createVNode(_components.code, { children: "fileGap→spacing" }),
				" rename\nnever bit), ",
				createVNode(_components.code, { children: "pierreTheme.ts" }),
				" was already on the ",
				createVNode(_components.code, { children: "--*-override" }),
				" convention, and the\n",
				createVNode(_components.code, { children: "PIERRE_DIFFS_LINE_HEIGHT=16" }),
				" virtualizer contract (#1026) held — proven green by\n",
				createVNode(_components.code, { children: "typecheck" }),
				", ",
				createVNode(_components.code, { children: "solid-markdown" }),
				"/",
				createVNode(_components.code, { children: "solid-pierre" }),
				" unit tests, and ",
				createVNode(_components.code, { children: "nix build" }),
				". Brings\nthe ≈2.3× faster ",
				createVNode(_components.code, { children: "parsePatchFiles" }),
				" and the worker substrate R2 needs. (",
				createVNode(_components.code, { children: "pnpmDeps" }),
				"\nhash refreshed; ",
				createVNode(_components.code, { children: "pierre/SKILL.md" }),
				" pin still reads 1.2.1 — a stray to fix.)"
			] })
		}),
		"\n",
		createVNode($$Finding, {
			sev: "low",
			title: "R2 — Pierre worker pool + shiki-js, for the diff path only — SHIPPED (#1363)",
			children: createVNode(_components.p, { children: [
				"Done ",
				createVNode($$PrLink, { pr: 1363 }),
				". The 1.2.10 type defs settled the open question: the\nengine is a ",
				createVNode(_components.code, { children: "CodeView" }),
				" ",
				createVNode(_components.em, { children: "option" }),
				" (",
				createVNode(_components.code, { children: "preferredHighlighter: 'shiki-js'" }),
				", in\n",
				createVNode(_components.code, { children: "CODE_VIEW_DIFF_OPTION_KEYS" }),
				"), and worker offload is the ",
				createVNode(_components.code, { children: "CodeView" }),
				" constructor’s\n",
				createVNode(_components.strong, { children: "2nd arg" }),
				" (",
				createVNode(_components.code, { children: "workerManager" }),
				"), built once via ",
				createVNode(_components.code, { children: "getOrCreateWorkerPoolSingleton" }),
				".\nSo ",
				createVNode(_components.code, { children: "solid-pierre" }),
				" now owns a session-lived worker-pool singleton (",
				createVNode(_components.code, { children: "workerPool.ts" }),
				")\nand hands it to every ",
				createVNode(_components.code, { children: "CodeView" }),
				"; plain ASTs paint synchronously while highlighted\ntokens stream back off-thread. Kolu supplies the ",
				createVNode(_components.code, { children: "workerFactory" }),
				"\n(",
				createVNode(_components.code, { children: "new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' })" }),
				"), so the worker bundles through the client’s Vite — which needed\n",
				createVNode(_components.code, { children: "worker.format: 'es'" }),
				" since Pierre’s worker code-splits its Shiki grammars (the\ndefault ",
				createVNode(_components.code, { children: "iife" }),
				" can’t). Browser-only (created in ",
				createVNode(_components.code, { children: "onMount" }),
				"), so static transcript\nexports never spawn a Worker. Pool size 2; never torn down. The\ntransitive ",
				createVNode(_components.code, { children: "@shikijs/transformers@3" }),
				" duplicate (a ",
				createVNode(_components.code, { children: "@shikijs/core@3.23.0" }),
				" beside\nthe 4.x engine) remains Pierre’s choice — worth watching if it regresses."
			] })
		}),
		"\n",
		createVNode($$Finding, {
			sev: "low",
			title: "R3 — CPU-throttle gesture-work harness — SHIPPED (#1368)",
			children: createVNode(_components.p, { children: [
				"Done ",
				createVNode($$PrLink, { pr: 1368 }),
				". Shipped as ",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/blob/master/docs/perf-investigations/scripts/gesture-p99/",
					children: createVNode(_components.code, { children: "scripts/gesture-p99/" })
				}),
				"\n(dependency-free CDP over Node’s built-in WebSocket). It drives the ",
				createVNode(_components.strong, { children: "real" }),
				" canvas\nand gates R4. Two findings turned the methodology: (1) a headless/CDP Chrome’s rAF\nisn’t vsync-capped — it fires ~1:1 with input dispatch (verified: gesture intents\n== rAF flushes, headless ",
				createVNode(_components.em, { children: "and" }),
				" headful-under-xvfb), so an rAF-paced fling can’t\nshow coalescing there; and (2) Chrome 143 dropped ",
				createVNode(_components.code, { children: "HeadlessExperimental.beginFrame" }),
				",\nso manual frame-clocking is out. The harness therefore measures the thing R4\nchanges directly — ",
				createVNode(_components.strong, { children: "per-event main-thread work" }),
				" — via a synchronous burst of K\n",
				createVNode(_components.code, { children: "WheelEvent" }),
				"s, immune to the frame scheduler. Write-up:\n",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/blob/master/docs/perf-investigations/canvas-gesture-p99.md",
					children: createVNode(_components.code, { children: "canvas-gesture-p99.md" })
				}),
				"."
			] })
		}),
		"\n",
		createVNode($$Finding, {
			sev: "medium",
			title: "R4 — rAF-coalesce the canvas wheel write-storm — SHIPPED (#1368)",
			children: createVNode(_components.p, { children: [
				"Done ",
				createVNode($$PrLink, { pr: 1368 }),
				". OpenCode’s real principle — ",
				createVNode(_components.em, { children: "per-frame work proportional to new data" }),
				" — applied to\nKolu’s ",
				createVNode(_components.strong, { children: "actual" }),
				" hot loop. ",
				createVNode(_components.code, { children: "useCanvasViewport.ts" }),
				" now accumulates the frame’s pan\ndelta (sum) and zoom factor (product toward the last anchor) and applies them once\nper ",
				createVNode(_components.code, { children: "requestAnimationFrame" }),
				" instead of per raw wheel event. Feel-neutral for the\ncases that actually occur: a ",
				createVNode(_components.strong, { children: "pure-pan" }),
				" or ",
				createVNode(_components.strong, { children: "pure-zoom" }),
				" frame lands on the\n",
				createVNode(_components.em, { children: "exact" }),
				" per-frame state the per-event path reached (",
				createVNode(_components.code, { children: "applyGestureBatch" }),
				" telescopes\nthe math, clamping per event). A ",
				createVNode(_components.strong, { children: "mixed" }),
				" pan+zoom frame — only possible when a\npointer-drag pan overlaps a ",
				createVNode(_components.code, { children: "ctrl" }),
				"+wheel zoom, since a wheel event is pan ",
				createVNode(_components.strong, { children: "xor" }),
				"\nzoom — uses a canonical zoom-then-pan order: a deliberate, bounded, non-accumulating\napproximation rather than re-walking the per-event list (which is the work R4 deletes).\nAll three cases are pinned in ",
				createVNode(_components.code, { children: "transforms.test.ts" }),
				", since canvas gestures have no\ne2e coverage. #1308 deferred this as latent/benign;\nR3 confirmed the deferral’s exact condition. On a 16-tile canvas under throttle, a\n60-event zoom burst went from an ",
				createVNode(_components.strong, { children: "865 ms main-thread freeze (≈52 dropped 60 Hz\nframes) at 6× → 1.3 ms" }),
				", with tile writes down ",
				createVNode(_components.strong, { children: "60×" }),
				" (2,880 → 48 — the\ncoalescing ratio). ",
				createVNode(_components.code, { children: "gestures.ts" }),
				" (ownership / ",
				createVNode(_components.code, { children: "preventDefault" }),
				") stays synchronous\nand untouched; only the state-write defers."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Sequencing:" }),
			" ",
			createVNode(_components.del, { children: "R1" }),
			" ✓ → ",
			createVNode(_components.del, { children: "R2" }),
			" ✓ → ",
			createVNode(_components.del, { children: "R3" }),
			" ✓ (the harness gated R4) → ",
			createVNode(_components.del, { children: "R4" }),
			" ✓ (measured, not guessed)."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "confirmed-facts--the-resolved-question",
			children: "Confirmed facts & the resolved question"
		}),
		"\n",
		createVNode(_components.p, { children: "The verification pass settled every load-bearing claim — and R1 (#1360) has since\nmoved the version facts forward:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "@pierre/diffs" }),
				" now ",
				createVNode(_components.strong, { children: "1.2.10" }),
				" across the live Pierre consumers (",
				createVNode(_components.code, { children: "client" }),
				" and\n",
				createVNode(_components.code, { children: "solid-pierre" }),
				"; ",
				createVNode(_components.code, { children: "transcript-html" }),
				" consumed it at the time but no longer does);\n",
				createVNode(_components.code, { children: "shiki" }),
				" now ",
				createVNode(_components.strong, { children: "4.2.0" }),
				" (single shared copy); ",
				createVNode(_components.code, { children: "@pierre/trees" }),
				" ",
				createVNode(_components.strong, { children: "1.0.0-beta.4" }),
				"\n(already latest, left untouched). ",
				createVNode($$Pill, {
					variant: "done",
					children: "shipped #1360"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The Shiki 4 bump was ",
				createVNode(_components.strong, { children: "deliberate, not forced" }),
				": Pierre takes ",
				createVNode(_components.code, { children: "shiki" }),
				" as a\nregular dep and ",
				createVNode(_components.code, { children: "solid-markdown" }),
				" shares it, so bumping only one would split the\nworkspace into two shiki copies. ",
				createVNode($$Pill, {
					variant: "ok",
					children: "verified"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"1.2.10 ships the three ",
				createVNode(_components.code, { children: "./worker" }),
				" exports (the R2 substrate); ",
				createVNode(_components.code, { children: "fileGap" }),
				" used\nnowhere; ",
				createVNode(_components.code, { children: "pierreTheme.ts" }),
				" already on ",
				createVNode(_components.code, { children: "--*-override" }),
				". ",
				createVNode($$Pill, {
					variant: "ok",
					children: "verified"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"shiki 4 was a no-op for our usage: ",
				createVNode(_components.code, { children: "createHighlighter" }),
				" / ",
				createVNode(_components.code, { children: "codeToHtml" }),
				"\nsignatures and the ",
				createVNode(_components.code, { children: "--shiki-light" }),
				"/",
				createVNode(_components.code, { children: "--shiki-dark" }),
				" dual-theme output unchanged.\n",
				createVNode($$Pill, {
					variant: "ok",
					children: "verified"
				})
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "The one open question — now answered",
			children: createVNode(_components.p, { children: [
				"Reading the installed 1.2.10 type defs (R2, #1363) settled it: the engine is a\n",
				createVNode(_components.code, { children: "CodeView" }),
				" ",
				createVNode(_components.em, { children: "option" }),
				" (",
				createVNode(_components.code, { children: "preferredHighlighter" }),
				", a ",
				createVNode(_components.code, { children: "CODE_VIEW_DIFF_OPTION_KEYS" }),
				" key),\nand the worker pool is the ",
				createVNode(_components.code, { children: "CodeView" }),
				" constructor’s ",
				createVNode(_components.strong, { children: "2nd argument" }),
				"\n(",
				createVNode(_components.code, { children: "workerManager" }),
				"), not an option field. The wrapper builds one\n",
				createVNode(_components.code, { children: "getOrCreateWorkerPoolSingleton" }),
				" and passes it in."
			] })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "OpenCode v2 Perf — What Kolu Can Adapt",
	"description": "OpenCode Desktop v2's \"10×\" is a streaming-markdown number. Mapped onto Kolu's actual surfaces, most of it has no consumer — but every technique that does has now shipped — R1 Pierre 1.2.10 + Shiki 4.2.0 (#1360), R2 the highlight worker pool (#1363), and R3+R4 the canvas-gesture p99 harness + rAF-coalesced pan/zoom.",
	"parents": ["analysis"],
	"status": "implemented",
	"maturity": "budding",
	"updated": "2026-06-23T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-10-is-workload-specific",
			"text": "The 10× is workload-specific"
		},
		{
			"depth": 2,
			"slug": "why-most-of-it-has-no-consumer-in-kolu",
			"text": "Why most of it has no consumer in Kolu"
		},
		{
			"depth": 2,
			"slug": "what-transfers",
			"text": "What transfers"
		},
		{
			"depth": 2,
			"slug": "confirmed-facts--the-resolved-question",
			"text": "Confirmed facts & the resolved question"
		}
	];
}
var url = "src/content/atlas/opencode-perf.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/opencode-perf.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/opencode-perf.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
