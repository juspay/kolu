import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
//#region src/diagrams/e2e-graduation-layers.svg?raw
var e2e_graduation_layers_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 760 300\" font-family=\"system-ui, sans-serif\">\n  <rect width=\"760\" height=\"300\" fill=\"#0f1117\"/>\n  <defs>\n    <marker id=\"arr\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#8b95a7\"/>\n    </marker>\n    <marker id=\"arrGreen\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#2dd4a7\"/>\n    </marker>\n  </defs>\n\n  <!-- browser layer -->\n  <rect x=\"40\" y=\"30\" width=\"680\" height=\"74\" rx=\"9\" fill=\"#1a2130\" stroke=\"#e8b44c\" stroke-width=\"1.5\"/>\n  <text x=\"380\" y=\"55\" fill=\"#e6eaf2\" font-size=\"13\" font-weight=\"600\" text-anchor=\"middle\">browser e2e — 53 feature files · 492 scenarios</text>\n  <text x=\"380\" y=\"74\" fill=\"#8b95a7\" font-size=\"11\" text-anchor=\"middle\">pays per worker: Xvfb · built kolu-server · padi · kaval · Chromium · 20–60s DOM polls</text>\n  <text x=\"380\" y=\"92\" fill=\"#2dd4a7\" font-size=\"11\" text-anchor=\"middle\">~360 genuinely assert rendered UI — they stay</text>\n\n  <!-- moving arrows -->\n  <line x1=\"200\" y1=\"104\" x2=\"200\" y2=\"168\" stroke=\"#8b95a7\" stroke-width=\"1.4\" marker-end=\"url(#arr)\"/>\n  <line x1=\"380\" y1=\"104\" x2=\"380\" y2=\"168\" stroke=\"#8b95a7\" stroke-width=\"1.4\" marker-end=\"url(#arr)\"/>\n  <line x1=\"560\" y1=\"104\" x2=\"560\" y2=\"168\" stroke=\"#8b95a7\" stroke-width=\"1.4\" marker-end=\"url(#arr)\"/>\n  <text x=\"380\" y=\"130\" fill=\"#e6eaf2\" font-size=\"11.5\" font-weight=\"600\" text-anchor=\"middle\">~130 executions (~26%) graduate down</text>\n  <text x=\"380\" y=\"146\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">mostly by DELETION — the package test already exists</text>\n\n  <!-- smoke residue arrow -->\n  <path d=\"M 690 168 C 730 140 730 120 700 106\" stroke=\"#2dd4a7\" stroke-width=\"1.3\" fill=\"none\" marker-end=\"url(#arrGreen)\"/>\n  <text x=\"712\" y=\"150\" fill=\"#2dd4a7\" font-size=\"10\" text-anchor=\"middle\">thin</text>\n  <text x=\"712\" y=\"162\" fill=\"#2dd4a7\" font-size=\"10\" text-anchor=\"middle\">smokes</text>\n\n  <!-- package layer -->\n  <rect x=\"40\" y=\"170\" width=\"680\" height=\"86\" rx=\"9\" fill=\"#141925\" stroke=\"#3d4a63\" stroke-width=\"1.5\"/>\n  <text x=\"380\" y=\"192\" fill=\"#8b95a7\" font-size=\"11\" font-weight=\"600\" text-anchor=\"middle\">PACKAGE TESTS — vitest boot + at most an in-process PTY</text>\n  <rect x=\"54\" y=\"202\" width=\"120\" height=\"40\" rx=\"6\" fill=\"#1a2130\" stroke=\"#5b8def\"/>\n  <text x=\"114\" y=\"219\" fill=\"#9db4e8\" font-size=\"11\" text-anchor=\"middle\">padi</text>\n  <text x=\"114\" y=\"233\" fill=\"#8b95a7\" font-size=\"9\" text-anchor=\"middle\">sensors · lifecycle · store</text>\n  <rect x=\"182\" y=\"202\" width=\"100\" height=\"40\" rx=\"6\" fill=\"#1a2130\" stroke=\"#5b8def\"/>\n  <text x=\"232\" y=\"219\" fill=\"#9db4e8\" font-size=\"11\" text-anchor=\"middle\">kaval</text>\n  <text x=\"232\" y=\"233\" fill=\"#8b95a7\" font-size=\"9\" text-anchor=\"middle\">OSC · PTY · daemon</text>\n  <rect x=\"290\" y=\"202\" width=\"130\" height=\"40\" rx=\"6\" fill=\"#1a2130\" stroke=\"#5b8def\"/>\n  <text x=\"355\" y=\"219\" fill=\"#9db4e8\" font-size=\"11\" text-anchor=\"middle\">integrations/*</text>\n  <text x=\"355\" y=\"233\" fill=\"#8b95a7\" font-size=\"9\" text-anchor=\"middle\">agents · git · anyagent</text>\n  <rect x=\"428\" y=\"202\" width=\"130\" height=\"40\" rx=\"6\" fill=\"#1a2130\" stroke=\"#5b8def\"/>\n  <text x=\"493\" y=\"219\" fill=\"#9db4e8\" font-size=\"11\" text-anchor=\"middle\">solid-markdown +</text>\n  <text x=\"493\" y=\"233\" fill=\"#8b95a7\" font-size=\"9\" text-anchor=\"middle\">client/lib units</text>\n  <rect x=\"566\" y=\"202\" width=\"100\" height=\"40\" rx=\"6\" fill=\"#1a2130\" stroke=\"#5b8def\"/>\n  <text x=\"616\" y=\"219\" fill=\"#9db4e8\" font-size=\"11\" text-anchor=\"middle\">server</text>\n  <text x=\"616\" y=\"233\" fill=\"#8b95a7\" font-size=\"9\" text-anchor=\"middle\">HTTP routes</text>\n\n  <text x=\"380\" y=\"284\" fill=\"#5b6678\" font-size=\"10.5\" text-anchor=\"middle\">the principle: a test lives at the lowest layer that can honestly assert it</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/e2e-graduation.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		em: "em",
		h2: "h2",
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
			createVNode(_components.strong, { children: "The principle: a test lives at the lowest layer that can honestly assert it." }),
			" A browser e2e worker pays Xvfb, the built kolu-server binary, a spawned padi, a kaval daemon, and a Chromium context — then 20–60s DOM/hydration polls per scenario (",
			createVNode(_components.code, { children: "packages/tests/support/hooks.ts" }),
			"/",
			createVNode(_components.code, { children: "world.ts" }),
			"); a package integration test pays a vitest boot and at most an in-process PTY (",
			createVNode(_components.code, { children: "packages/kaval/src/inProcessPtyHost.test.ts" }),
			" precedent). Reviewed at ",
			createVNode(_components.code, { children: "ff1c0bd22" }),
			", grounded in the step implementations (not the Gherkin prose): of ",
			createVNode(_components.strong, { children: "492 scenario executions across 53 feature files, ~130 (~26%) assert behavior a package API exposes" }),
			" and graduate or collapse to a thin smoke; ",
			createVNode(_components.strong, { children: "~360 genuinely assert rendered UI and stay" }),
			". The headline: ",
			createVNode(_components.strong, { children: "graduation is mostly deletion" }),
			" — padi/kaval/solid-markdown/integrations already test most graduatable halves, and several e2e scenarios are 1:1 duplicates of existing package tests (named below). Execution is a separate future PR; this note is the reviewed map."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: e2e_graduation_layers_default,
			caption: "The move. ~130 of 492 executions graduate from the browser stack to package tests (mostly deletion — the covering test already exists), leaving thin browser smokes; ~360 rendered-UI scenarios stay."
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-classification-file-by-file",
			children: "The classification, file by file"
		}),
		"\n",
		createVNode(_components.p, { children: ["File-level: ", createVNode(_components.strong, { children: "31 browser-bound · 9 graduatable · 13 mixed." })] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Feature file" }),
					"\n",
					createVNode(_components.th, {
						style: { textAlign: "right" },
						children: "Scen."
					}),
					"\n",
					createVNode(_components.th, { children: "Classification" }),
					"\n",
					createVNode(_components.th, { children: "Target package" }),
					"\n",
					createVNode(_components.th, { children: "Seam" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "claude-code.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "20"
					}),
					"\n",
					createVNode(_components.td, { children: "GRADUATABLE (keep ~2 smokes)" }),
					"\n",
					createVNode(_components.td, { children: "padi + integrations/claude-code" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "terminalWorkspace/sensors.ts" }),
						" ",
						createVNode(_components.code, { children: "startSensors" }),
						" over real temp dirs + in-process PTY"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "codex.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "6"
					}),
					"\n",
					createVNode(_components.td, { children: "GRADUATABLE (keep 1 smoke)" }),
					"\n",
					createVNode(_components.td, { children: "padi + integrations/codex" }),
					"\n",
					createVNode(_components.td, { children: [
						"same; mock already writes real SQLite (",
						createVNode(_components.code, { children: "support/agent-mock-codex.ts" }),
						", ",
						createVNode(_components.code, { children: "node:sqlite" }),
						")"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "opencode.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "7"
					}),
					"\n",
					createVNode(_components.td, { children: "GRADUATABLE (keep 1 smoke)" }),
					"\n",
					createVNode(_components.td, { children: "padi + integrations/opencode" }),
					"\n",
					createVNode(_components.td, { children: "same" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "grok.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "6"
					}),
					"\n",
					createVNode(_components.td, { children: "GRADUATABLE (keep 1 smoke)" }),
					"\n",
					createVNode(_components.td, { children: "padi + integrations/grok" }),
					"\n",
					createVNode(_components.td, { children: "same" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "recent-agents.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "6"
					}),
					"\n",
					createVNode(_components.td, { children: "MIXED" }),
					"\n",
					createVNode(_components.td, { children: "integrations/anyagent (largely covered) + padi" }),
					"\n",
					createVNode(_components.td, { children: [
						"normalization = ",
						createVNode(_components.code, { children: "agent-cli.test.ts" }),
						" dup; OSC 633;E→MRU = padi sensors ",
						createVNode(_components.code, { children: "commandRun" }),
						"; palette UX stays"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "activity-alerts.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "5"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "window.__koluSimulateAlert" }), " hook, Badging API, switcher glow — pure client wiring"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "foreground-process.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "2"
					}),
					"\n",
					createVNode(_components.td, { children: "GRADUATABLE (keep 1 smoke)" }),
					"\n",
					createVNode(_components.td, { children: "kaval (+padi compose)" }),
					"\n",
					createVNode(_components.td, { children: ["OSC 0/2 title + foregroundPid — ALREADY in ", createVNode(_components.code, { children: "kaval/src/ptyHost.test.ts" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "cwd.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "2"
					}),
					"\n",
					createVNode(_components.td, { children: "GRADUATABLE (keep 1 smoke)" }),
					"\n",
					createVNode(_components.td, { children: "kaval (+padi compose)" }),
					"\n",
					createVNode(_components.td, { children: ["OSC 7 cwd — ALREADY in ", createVNode(_components.code, { children: "kaval/src/ptyHost.test.ts" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "kill.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "8"
					}),
					"\n",
					createVNode(_components.td, { children: "MIXED" }),
					"\n",
					createVNode(_components.td, { children: "padi/kaval" }),
					"\n",
					createVNode(_components.td, { children: [
						"PTY-exit removal + stays-gone-after-refresh = kaval inventory deltas + ",
						createVNode(_components.code, { children: "padi/reconcile.test.ts" }),
						", ",
						createVNode(_components.code, { children: "session.test.ts" }),
						"; dialogs/auto-switch stay"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "kaval-daemon.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "5"
					}),
					"\n",
					createVNode(_components.td, { children: "MIXED" }),
					"\n",
					createVNode(_components.td, { children: "padi" }),
					"\n",
					createVNode(_components.td, { children: [
						"recycle-preserves-session + fresh-pid = ",
						createVNode(_components.code, { children: "restartLocal.test.ts" }),
						" + kaval ",
						createVNode(_components.code, { children: "socketDaemon.test.ts" }),
						"; degraded/warming UI stays"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "sleeping-terminals.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "9"
					}),
					"\n",
					createVNode(_components.td, { children: "MIXED" }),
					"\n",
					createVNode(_components.td, { children: "padi" }),
					"\n",
					createVNode(_components.td, { children: [
						"sleep/wake/resume-by-id/malformed-drop/no-orphan = ",
						createVNode(_components.code, { children: "sleepWake.test.ts" }),
						" + ",
						createVNode(_components.code, { children: "reconcile.test.ts" }),
						"; dormant render/dock filters/PTY-replay-in-xterm stay"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "session-restore.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "9"
					}),
					"\n",
					createVNode(_components.td, { children: "MIXED" }),
					"\n",
					createVNode(_components.td, { children: "padi" }),
					"\n",
					createVNode(_components.td, { children: [
						"restore mechanism = ",
						createVNode(_components.code, { children: "sessionRestore.test.ts" }),
						" + ",
						createVNode(_components.code, { children: "session.test.ts" }),
						"; viewport-centering races, theme, heading UI stay"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "reconnect.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "1"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: [
						"client oRPC ",
						createVNode(_components.code, { children: "ClientRetryPlugin" }),
						" re-subscribe over the page’s own WebSocket"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "terminal.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "13"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: [
						"xterm fit/zoom/focus/client scrollback (server-mirror half already in kaval ",
						createVNode(_components.code, { children: "ptyHost.test.ts" }),
						")"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "sub-terminal.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "17"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: ["split panes/focus routing; restore-re-parent half already in ", createVNode(_components.code, { children: "sessionRestore.test.ts" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "terminal-resize.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "1"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "per-terminal cols sovereignty on mobile — client fit" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "inherit-size.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "2"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: [
						"client ",
						createVNode(_components.code, { children: "resolveReferenceLayout" }),
						" placement"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "code-tab.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "101"
					}),
					"\n",
					createVNode(_components.td, { children: "MIXED (~40 graduate/thin)" }),
					"\n",
					createVNode(_components.td, { children: "integrations/git, solid-markdown, padi, solid-browser, client units" }),
					"\n",
					createVNode(_components.td, { children: [
						"markdown cluster → ",
						createVNode(_components.code, { children: "render.test.ts" }),
						"/",
						createVNode(_components.code, { children: "wikilink.test.ts" }),
						" (+ new ",
						createVNode(_components.code, { children: "sanitize.test.ts" }),
						"); filter Outlines → ",
						createVNode(_components.code, { children: "fileSearch.ts" }),
						"/",
						createVNode(_components.code, { children: "pathReconcile.ts" }),
						" units; status/binary → ",
						createVNode(_components.code, { children: "review.test.ts" }),
						"; listAll/readFile → ",
						createVNode(_components.code, { children: "browse.test.ts" }),
						"; history → ",
						createVNode(_components.code, { children: "createBrowser" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "file-ref-link.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "15"
					}),
					"\n",
					createVNode(_components.td, { children: "MIXED (~9 graduate)" }),
					"\n",
					createVNode(_components.td, { children: [
						"client ",
						createVNode(_components.code, { children: "ui/lineRef.test.ts" }),
						" (exists)"
					] }),
					"\n",
					createVNode(_components.td, { children: "resolver variants; keep xterm hit-test/touch/re-click canaries" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "git-context.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "9"
					}),
					"\n",
					createVNode(_components.td, { children: "MIXED (mostly graduates)" }),
					"\n",
					createVNode(_components.td, { children: "integrations/git" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "resolve.ts" }),
						" + head/cwd watchers: branch, worktree naming, ",
						createVNode(_components.code, { children: ".worktrees" }),
						" collapse"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "recent-repos.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "3"
					}),
					"\n",
					createVNode(_components.td, { children: "MIXED" }),
					"\n",
					createVNode(_components.td, { children: "padi" }),
					"\n",
					createVNode(_components.td, { children: "MRU tracking graduates; palette picker render stays (1 smoke)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "worktree.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "10"
					}),
					"\n",
					createVNode(_components.td, { children: "MIXED" }),
					"\n",
					createVNode(_components.td, { children: "integrations/git + padi" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "worktree.ts" }), " create/remove, collision, validation, shared-blocker; confirm-dialog UI stays"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "worktree-agent.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "4"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND (trim to 2-3)" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "agent command written into new PTY + sub-palette; MRU/worktree seams graduate via other files" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "settings.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "4"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND (trim to 1-2)" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "popover + aria-pressed; overlaps preferences" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "preferences.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "4"
					}),
					"\n",
					createVNode(_components.td, { children: "MIXED (3 of 4 graduate)" }),
					"\n",
					createVNode(_components.td, { children: "padi" }),
					"\n",
					createVNode(_components.td, { children: "confStore write→re-read persistence; keep renderer-swap-live-tile smoke" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "terminal-intent.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "8"
					}),
					"\n",
					createVNode(_components.td, { children: "MIXED (~4 graduate)" }),
					"\n",
					createVNode(_components.td, { children: "padi + solid-markdown" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "chrome.setIntent" }),
						" persistence; links-off inert render = ",
						createVNode(_components.code, { children: "render.test.ts" }),
						" dup; editor UX stays"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "smoke.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "3"
					}),
					"\n",
					createVNode(_components.td, { children: "MIXED" }),
					"\n",
					createVNode(_components.td, { children: "server" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "/api/health" }),
						" = plain Hono route (",
						createVNode(_components.code, { children: "packages/server/src/index.ts:542" }),
						"); title + WS-open stay"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "chrome-memory.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "2"
					}),
					"\n",
					createVNode(_components.td, { children: "GRADUATABLE (mostly)" }),
					"\n",
					createVNode(_components.td, { children: "padi + kaval" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "memorySampler.ts" }),
						" ",
						createVNode(_components.code, { children: "processMemory" }),
						" cell; kaval ",
						createVNode(_components.code, { children: "surface.system.processMemory" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "clipboard.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "1"
					}),
					"\n",
					createVNode(_components.td, { children: "GRADUATABLE (thin residue)" }),
					"\n",
					createVNode(_components.td, { children: "padi" }),
					"\n",
					createVNode(_components.td, { children: [
						"upload/",
						createVNode(_components.code, { children: "scratch.write" }),
						"; paste-event origination is the only browser fact"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "file-drop.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "2"
					}),
					"\n",
					createVNode(_components.td, { children: "GRADUATABLE (thin residue)" }),
					"\n",
					createVNode(_components.td, { children: "padi" }),
					"\n",
					createVNode(_components.td, { children: [
						"upload gate incl. ",
						createVNode(_components.code, { children: ".mov" }),
						" allowlist — policy ALREADY in ",
						createVNode(_components.code, { children: "servePadi.test.ts" }),
						" (F1)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "canvas.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "48"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "tile geometry, WebGL budget, minimap, pan/zoom, maximize" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "canvas-selection.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "1"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "xterm hit-testing under CSS transform" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "dock.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "15"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: [
						"rendered dock; ranking is pure (",
						createVNode(_components.code, { children: "terminal-vocab/agentProjection.ts" }),
						") and separately unit-testable"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "workspace-switcher.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "17"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "cards/buckets render; bucket taxonomy graduable to terminal-vocab units" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "command-palette.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "23"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "palette DOM/focus/chords" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "keyboard-shortcuts.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "9"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: [
						"chords, MRU cycling, ",
						createVNode(_components.code, { children: "__wsSent" }),
						" leak-guards"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "right-panel.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "20"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "panel render; kaval-tui command-string derivation could gain a padi assertion" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "theme.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "13"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "rendered theme + localStorage" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "scroll_lock.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "10"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "xterm viewport scrollTop state machine" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "mobile-*.feature (8 files)" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "39"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "touch gestures, soft keyboard/iOS focus, drawers, swipe" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "compact-layout.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "3"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "responsive layoutMode render" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "copy-pane-text.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "3"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "client buffer serialization + navigator.clipboard" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "osc52-clipboard.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "2"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "xterm ClipboardAddon + clipboard fallback" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "terminal-screenshot.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "5"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "client canvas capture to clipboard PNG" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "render_recovery.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "1"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "xterm renderService rAF recovery" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "welcome.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "1"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "static render (could be a component test)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "recordings.feature" }),
					"\n",
					createVNode(_components.td, {
						style: { textAlign: "right" },
						children: "1"
					}),
					"\n",
					createVNode(_components.td, { children: "BROWSER-BOUND" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "marketing capture, no assertion" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-graduation-order",
			children: "The graduation order"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Speed win × risk, biggest first. The named duplicates are the deletion proof: sleeping-terminals’ malformed-record scenario is a 1:1 dup of ",
			createVNode(_components.code, { children: "sleepWake.test.ts" }),
			"; file-drop’s ",
			createVNode(_components.code, { children: ".mov" }),
			" allowlist duplicates ",
			createVNode(_components.code, { children: "servePadi.test.ts" }),
			" F1; recent-agents’ quote re-quoting duplicates ",
			createVNode(_components.code, { children: "anyagent/src/agent-cli.test.ts" }),
			"; terminal-intent’s inert-markdown duplicates ",
			createVNode(_components.code, { children: "solid-markdown/render.test.ts" }),
			"."
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Agent detection → padi sensors + integrations" }),
				" (≈35 retired, ~5 smokes). The suite’s slowest, flakiest band — every scenario pays full-stack boot plus fs-watch nudge polls under ",
				createVNode(_components.code, { children: "HYDRATION_TIMEOUT" }),
				". The pure derivations are already unit-tested (",
				createVNode(_components.code, { children: "integrations/*/index.test.ts" }),
				", ",
				createVNode(_components.code, { children: "screen.test.ts" }),
				"); the one genuinely new surface is the composition — real fs events → watcher → sensors’ ",
				createVNode(_components.code, { children: "TerminalEvent" }),
				" emission against a real PTY. Shape: kaval’s in-process PTY + ",
				createVNode(_components.code, { children: "startSensors" }),
				" + the e2e mock builders ported to a testlib (",
				createVNode(_components.code, { children: "gitRepo.testlib.ts" }),
				" precedent); the mocks already write real artifacts (real SQLite via ",
				createVNode(_components.code, { children: "node:sqlite" }),
				") with no Playwright dependency beyond a shell-PID probe an in-process PTY replaces."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Lifecycle redundancy trim → padi/kaval" }),
				" (≈16 retired from kill · kaval-daemon · sleeping-terminals · session-restore · foreground-process · cwd). Near-zero risk: the package tests already exist (",
				createVNode(_components.code, { children: "sleepWake.test.ts" }),
				", ",
				createVNode(_components.code, { children: "sessionRestore.test.ts" }),
				", ",
				createVNode(_components.code, { children: "reconcile.test.ts" }),
				", ",
				createVNode(_components.code, { children: "restartLocal.test.ts" }),
				", kaval ",
				createVNode(_components.code, { children: "ptyHost.test.ts:282/327/338" }),
				" for OSC 7 / OSC 0-2 / foregroundPid) — this is deleting re-proofs and keeping named smokes. No new code."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "code-tab markdown + filter + resolver variants" }),
				" (≈25–30). Markdown cluster → solid-markdown (dup-deletion + one new ",
				createVNode(_components.code, { children: "sanitize.test.ts" }),
				"); filter Outlines → ",
				createVNode(_components.code, { children: "fileSearch" }),
				"/",
				createVNode(_components.code, { children: "pathReconcile" }),
				" units, collapsing the 3×-mode Outlines to one mode; file-ref resolver variants → ",
				createVNode(_components.code, { children: "lineRef.test.ts" }),
				". Cheap, mechanical."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["git facts → ", createVNode(_components.code, { children: "integrations/git" })] }),
				" (≈15): git-context + code-tab status/diff/binary clusters extend ",
				createVNode(_components.code, { children: "review.test.ts" }),
				"/",
				createVNode(_components.code, { children: "browse.test.ts" }),
				"; new ",
				createVNode(_components.code, { children: "resolve.test.ts" }),
				" assertions and a new ",
				createVNode(_components.code, { children: "worktree.test.ts" }),
				" (create/remove, collision, validation, shared-worktree blocker). Moderate new-test work on well-precedented seams."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"The ",
					createVNode($$PrLink, { pr: 1751 }),
					" real-agent lane → integrations/codex + padi real-CLI test"
				] }),
				", done ",
				createVNode(_components.em, { children: "with" }),
				" W3.4 rather than after — the highest per-scenario speed win in the repo (a real ollama model turn + the browser stack + DOM polls today). See the intersection note below."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Small server stowaways:" }),
				" upload-gate residue (file-drop/clipboard — already covered, keep one smoke), chrome-memory → padi/kaval, ",
				createVNode(_components.code, { children: "/api/health" }),
				" → a server HTTP test, preferences/intent persistence → padi store tests."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-surprises",
			children: "The surprises"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The 3×-mode Scenario Outlines in code-tab multiply mode-independent behavior" }), " (filtering, selection persistence) — collapsing them to one mode is a free ~15-execution cut with zero graduation work."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "chrome-memory is a server-sampler test in UI dress:" }),
				" “RSS numbers visibly change under load” asserts ",
				createVNode(_components.code, { children: "packages/padi/src/memorySampler.ts" }),
				" publishing the ",
				createVNode(_components.code, { children: "processMemory" }),
				" cell (sampling kaval via ",
				createVNode(_components.code, { children: "surface.system.processMemory" }),
				"); the UI’s share is one aria-label smoke at most."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Two server-looking suites are genuinely browser-bound." }),
				" reconnect.feature tests the ",
				createVNode(_components.em, { children: "client’s" }),
				" oRPC ",
				createVNode(_components.code, { children: "ClientRetryPlugin" }),
				" re-subscribing over the page’s own WebSocket — no server seam exists (the steps note CDP couldn’t even simulate the drop). terminal.feature’s scrollback scenarios assert the ",
				createVNode(_components.em, { children: "client xterm buffer" }),
				", a different buffer from kaval’s already-tested server mirror — not redundant."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-1751-intersection",
			children: "The #1751 intersection"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode($$PrLink, { pr: 1751 }),
			" adds ",
			createVNode(_components.code, { children: "codex-real.feature" }),
			": a real ",
			createVNode(_components.code, { children: "codex" }),
			" CLI (pinned 0.130.0 — nixpkgs’ 0.114 predates the ",
			createVNode(_components.code, { children: "threads" }),
			" schema kolu’s detector requires) against a private ollama, asserting thinking→waiting plus artifacts at the real default paths. ",
			createVNode(_components.strong, { children: "Every assertion except the DOM readout is server-observable." }),
			" The natural home once real: an integrations/codex (or padi) package test — codex in a kaval in-process PTY with the ollama env + throwaway ",
			createVNode(_components.code, { children: "HOME" }),
			", the real watcher over the real ",
			createVNode(_components.code, { children: "~/.codex" }),
			", asserting the sensors state stream flips and the artifacts land — keeping the PR’s determinism work intact and removing Xvfb + Chromium + DOM polls from the lane that combines a real model turn with the flakiest wait in the suite. Browser residue: none beyond the mock smoke (the UI indicator is proven there; real-CLI detection is not a UI fact). This is ",
			createVNode(_components.strong, { children: "deliberately not redirected into the in-flight PR" }),
			" — it composes with the PR’s own open question (W3.4 decides whether the real lane subsumes the mocks): real lane → package test; mock lane → padi state-machine tests + one browser smoke. The codex nix pin and the linux-only constraint travel with the graduation."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "done-criteria-for-the-execution-prs",
			children: "Done-criteria for the execution PR(s)"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Step 1:" }), " a padi integration test drives every agent state-machine scenario (interrupted→waiting, fork→running_background, orphaned workflow, compact, stale-JSONL, token counting, OSC 633;E npm-shim, task progress, session-end clear) plus the two screen-scrape promotions, through a real in-process PTY; the mock builders live in a shared testlib; ≤5 agent smokes remain in e2e."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Step 2:" }), " each retired lifecycle scenario names its covering package test in the deleting PR’s description; the kept smokes are named; no new package code."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Step 3:" }),
				" ",
				createVNode(_components.code, { children: "sanitize.test.ts" }),
				" exists; the code-tab Outlines run one mode; the markdown/resolver dups are deleted with their covering tests named."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Step 4:" }),
				" ",
				createVNode(_components.code, { children: "worktree.test.ts" }),
				" covers create/remove/collision/validation/shared-blocker; git-context keeps ~2 smokes."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Step 5:" }), " the real-codex assertions run as a package test in W3.4’s lane; the browser never enters the real-model-turn path."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Globally:" }), " the suite drops ~130 scenario executions; both-platform e2e wall time is measured before/after; no rendered-UI assertion is deleted without a named replacement or a kept smoke."] }),
			"\n"
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "E2E graduation — the browser suite's package-level future",
	"description": "A completed read-only review of all 53 feature files / 492 scenarios, classified against the step implementations: ~26% of the browser suite asserts behavior a package API exposes and graduates to padi/kaval/integrations/client-unit tests — mostly by deleting re-proofs the packages already cover — while ~360 scenarios genuinely assert rendered UI and stay. The classification table, the graduation order, the surprises, the #1751 intersection, and the execution done-criteria.",
	"parents": ["analysis", "padi"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-10T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-classification-file-by-file",
			"text": "The classification, file by file"
		},
		{
			"depth": 2,
			"slug": "the-graduation-order",
			"text": "The graduation order"
		},
		{
			"depth": 2,
			"slug": "the-surprises",
			"text": "The surprises"
		},
		{
			"depth": 2,
			"slug": "the-1751-intersection",
			"text": "The #1751 intersection"
		},
		{
			"depth": 2,
			"slug": "done-criteria-for-the-execution-prs",
			"text": "Done-criteria for the execution PR(s)"
		}
	];
}
var url = "src/content/atlas/e2e-graduation.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/e2e-graduation.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/e2e-graduation.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
