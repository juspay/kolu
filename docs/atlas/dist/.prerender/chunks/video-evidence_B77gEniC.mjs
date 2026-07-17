import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
//#region src/content/atlas/video-evidence.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
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
	const { Fragment: Fragment$1 } = _components;
	if (!Fragment$1) _missingMdxReference("Fragment", true);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"Let ",
			createVNode(_components.code, { children: "/do" }),
			" attach ",
			createVNode(_components.em, { children: "video" }),
			" to a PR — not just screenshots — for changes about\nmotion (animations, transitions, multi-step interactions). The ",
			createVNode(_components.strong, { children: "delivery" }),
			" layer\n(GIF inline + a shared GitHub-Pages player, hosted on each project’s\n",
			createVNode(_components.code, { children: "evidence-assets" }),
			" release) already shipped — see ",
			createVNode(_components.em, { children: "History" }),
			" below. The question\nthis page answered: ",
			createVNode(_components.strong, { children: "where to drive capture from" }),
			". For kolu: the e2e Cucumber\nharness, not a hand-rolled script — shipped in ",
			createVNode($$PrLink, { pr: 1099 }),
			"."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "capture-source--reuse-the-cucumber-harness",
			children: "Capture source — reuse the Cucumber harness"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Capture has been driven two ways: the chrome-devtools MCP screencast, and a\nbespoke Playwright ",
			createVNode(_components.code, { children: "capture.mjs" }),
			" on an ephemeral ",
			createVNode(_components.code, { children: "pu" }),
			" box. Both ",
			createVNode(_components.em, { children: "hand-drive the\nUI" }),
			", re-implementing clicks the e2e step library already owns."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Drive capture from the existing Cucumber + Playwright e2e harness",
			children: createVNode(_components.p, { children: [
				"Kolu already owns the whole scaffold — a custom ",
				createVNode(_components.code, { children: "KoluWorld extends World" }),
				", the\n",
				createVNode(_components.code, { children: "browser.newContext()" }),
				" call in ",
				createVNode(_components.code, { children: "support/hooks.ts" }),
				", the ~880-line\n",
				createVNode(_components.code, { children: "code-tab.feature" }),
				" step library, and the ",
				createVNode(_components.code, { children: "html:reports/report.html" }),
				" formatter in\n",
				createVNode(_components.code, { children: "cucumber.js" }),
				". Wiring Playwright’s ",
				createVNode(_components.code, { children: "recordVideo" }),
				" into the test context is a few\nlines and ",
				createVNode(_components.em, { children: "deletes" }),
				" the parallel UI-driving logic ",
				createVNode(_components.code, { children: "capture.mjs" }),
				" re-implements by\nhand."
			] })
		}),
		"\n",
		createVNode(_components.h3, {
			id: "the-ecosystem-does-exactly-this--two-models",
			children: "The ecosystem does exactly this — two models"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"One dominant, framework-agnostic path: capture media in a hook, push it into the\nrun via the runner’s attach API (",
			createVNode(_components.code, { children: "this.attach" }),
			" in cucumber-js), let a formatter\nrender it. The only real variation is ",
			createVNode(_components.em, { children: "when capture fires" }),
			":"
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
					createVNode(_components.th, { children: "Explicit-attach" }),
					"\n",
					createVNode(_components.th, { children: "Record-everything" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Trigger" }),
					"\n",
					createVNode(_components.td, { children: "hook/step calls capture (often failure-gated)" }),
					"\n",
					createVNode(_components.td, { children: "framework records implicitly from config" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Granularity" }),
					"\n",
					createVNode(_components.td, { children: "per-step / per-scenario / per-failure" }),
					"\n",
					createVNode(_components.td, { children: "per spec (coarse)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Green-run cost" }),
					"\n",
					createVNode(_components.td, { children: "~zero if failure-gated" }),
					"\n",
					createVNode(_components.td, { children: "pays on every test unless pruned" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Examples" }),
					"\n",
					createVNode(_components.td, { children: [
						"cucumber-js ",
						createVNode(_components.code, { children: "this.attach" }),
						"; Serenity BDD; Playwright trace"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Cypress ",
						createVNode(_components.code, { children: "video:true" }),
						"; ",
						createVNode(_components.code, { children: "wdio-video-reporter" })
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Even Cypress retreated from record-everything: video is ",
			createVNode(_components.strong, { children: "off by default" }),
			" since\nCypress 13 (Aug 2023), citing CI cost. For evidence of a ",
			createVNode(_components.em, { children: "known, deliberate" }),
			"\nchange (kolu’s case), explicit-attach of one scenario is the right model."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "per-ecosystem-condensed",
			children: "Per-ecosystem, condensed"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Stack" }),
					"\n",
					createVNode(_components.th, { children: "Capture" }),
					"\n",
					createVNode(_components.th, { children: "Surfaced via" }),
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
						createVNode(_components.strong, { children: "cucumber-js + Playwright" }),
						" ",
						createVNode($$Pill, {
							variant: "new",
							children: "kolu"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "recordVideo" }),
						" on ",
						createVNode(_components.code, { children: "newContext" }),
						"; ",
						createVNode(_components.code, { children: "page.screenshot()" }),
						"; optional ",
						createVNode(_components.code, { children: "context.tracing" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "this.attach" }),
						" → html formatter, or save ",
						createVNode(_components.code, { children: ".webm" }),
						" + upload"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "cucumber-js + Cypress" }),
					"\n",
					createVNode(_components.td, { children: "auto 1 video/feature; auto failure shot" }),
					"\n",
					createVNode(_components.td, { children: "screenshots auto-embedded; video = sidecar mp4" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "WebdriverIO + Cucumber" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "wdio-video-reporter" }), " stitches frames via ffmpeg"] }),
					"\n",
					createVNode(_components.td, { children: "auto-embeds into Allure" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "cucumber-jvm + Serenity BDD" }),
					"\n",
					createVNode(_components.td, { children: ["auto screenshot-", createVNode(_components.em, { children: "per-step" })] }),
					"\n",
					createVNode(_components.td, { children: "“living documentation” HTML" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Playwright Trace Viewer" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "context.tracing.start/stop" }),
						" → ",
						createVNode(_components.code, { children: "trace.zip" })
					] }),
					"\n",
					createVNode(_components.td, { children: "open in trace.playwright.dev; link from PR" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-kolu-wiring--shipped-in-",
			children: ["The kolu wiring — shipped in ", createVNode($$PrLink, { pr: 1099 })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "1" }),
			" — ",
			createVNode(_components.code, { children: "recordVideo" }),
			" is env-gated on the existing context (it is a ",
			createVNode(_components.em, { children: "context" }),
			" option, verified — not a ",
			createVNode(_components.code, { children: "launch()" }),
			" option):"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// support/hooks.ts — inside newScenarioPage(), extending the existing newContext call</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> context</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#D73A49\"> await</span><span style=\"color:#24292E\"> browser.</span><span style=\"color:#6F42C1\">newContext</span><span style=\"color:#24292E\">({</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  viewport, baseURL, ignoreHTTPSErrors: </span><span style=\"color:#005CC5\">true</span><span style=\"color:#24292E\">,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  permissions: [</span><span style=\"color:#032F62\">\"clipboard-write\"</span><span style=\"color:#24292E\">, </span><span style=\"color:#032F62\">\"clipboard-read\"</span><span style=\"color:#24292E\">],</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  ...</span><span style=\"color:#24292E\">(rawVideoDir </span><span style=\"color:#6A737D\">// set only under KOLU_EVIDENCE</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">    ?</span><span style=\"color:#24292E\"> { recordVideo: { dir: rawVideoDir, size: </span><span style=\"color:#005CC5\">EVIDENCE_VIEWPORT</span><span style=\"color:#24292E\"> } } </span><span style=\"color:#6A737D\">// 1280×720</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">    :</span><span style=\"color:#24292E\"> {}),                                     </span><span style=\"color:#6A737D\">// normal runs pay nothing</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "2" }),
			" — the file is finalized ",
			createVNode(_components.em, { children: "only" }),
			" on ",
			createVNode(_components.code, { children: "context.close()" }),
			" (verified). Grab the handle ",
			createVNode(_components.em, { children: "before" }),
			" closing, read ",
			createVNode(_components.em, { children: "after" }),
			":"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// support/hooks.ts — extending the existing After hook</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> video</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#005CC5\"> this</span><span style=\"color:#24292E\">.page?.</span><span style=\"color:#6F42C1\">video</span><span style=\"color:#24292E\">();             </span><span style=\"color:#6A737D\">// handle BEFORE close</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">if</span><span style=\"color:#24292E\"> (</span><span style=\"color:#005CC5\">this</span><span style=\"color:#24292E\">.context) </span><span style=\"color:#D73A49\">await</span><span style=\"color:#005CC5\"> this</span><span style=\"color:#24292E\">.context.</span><span style=\"color:#6F42C1\">close</span><span style=\"color:#24292E\">();  </span><span style=\"color:#6A737D\">// flushes the .webm</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">if</span><span style=\"color:#24292E\"> (video </span><span style=\"color:#D73A49\">&#x26;&#x26;</span><span style=\"color:#24292E\"> process.env.</span><span style=\"color:#005CC5\">KOLU_EVIDENCE</span><span style=\"color:#24292E\">) {</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  const</span><span style=\"color:#005CC5\"> webm</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#D73A49\"> await</span><span style=\"color:#24292E\"> video.</span><span style=\"color:#6F42C1\">path</span><span style=\"color:#24292E\">();            </span><span style=\"color:#6A737D\">// valid only post-close</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">  // leave on disk → feed the SAME ffmpeg → GIF/mp4 → evidence-assets flow (History)</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">}</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "3" }), " — run one scenario, reusing the step library:"] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"bash\"><code><span class=\"line\"><span style=\"color:#24292E\">KOLU_EVIDENCE</span><span style=\"color:#D73A49\">=</span><span style=\"color:#032F62\">1</span><span style=\"color:#6F42C1\"> just</span><span style=\"color:#032F62\"> test-quick</span><span style=\"color:#032F62\"> features/code-tab.feature</span><span style=\"color:#005CC5\"> --name</span><span style=\"color:#032F62\"> \"Editing an HTML file refreshes the iframe preview live\"</span></span></code></pre>" }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "The real legibility trap isn't speed — it's animation",
			children: createVNode(_components.p, { children: [
				"“Machine-speed video” is trivially fixable: ",
				createVNode(_components.code, { children: "ffmpeg setpts" }),
				" post-hoc, or\n",
				createVNode(_components.code, { children: "chromium.launch({ slowMo })" }),
				" + a trailing dwell. The genuine gotcha: ",
				createVNode(_components.code, { children: "hooks.ts" }),
				"\ninjects ",
				createVNode(_components.code, { children: "transition-duration:0s" }),
				" / ",
				createVNode(_components.code, { children: "prefers-reduced-motion: reduce" }),
				" for test\ndeterminism. If the evidence is ",
				createVNode(_components.em, { children: "about motion" }),
				", an evidence run must ",
				createVNode(_components.strong, { children: "skip that\nanimations-off init script" }),
				" under ",
				createVNode(_components.code, { children: "KOLU_EVIDENCE" }),
				" — else you film the effect\nwith its motion suppressed."
			] })
		}),
		"\n",
		createVNode(_components.h3, {
			id: "corrections-the-verification-pass-forced",
			children: "Corrections the verification pass forced"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Per-",
					createVNode(_components.em, { children: "page" }),
					", not per-context, never per-step."
				] }),
				" ",
				createVNode(_components.code, { children: "recordVideo" }),
				" writes one ",
				createVNode(_components.code, { children: ".webm" }),
				" per page; kolu opens one page per scenario → one file per scenario. There is ",
				createVNode(_components.em, { children: "no" }),
				" per-step video (screenshots can be per-step; video can’t)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "this.attach" }), " takes an options object now"] }),
				" — ",
				createVNode(_components.code, { children: "this.attach(buf, { mediaType, fileName })" }),
				"; the bare-string form is legacy-compat. ",
				createVNode(_components.code, { children: "KoluWorld extends World" }),
				" inherits ",
				createVNode(_components.code, { children: "attach" }),
				"; it’s unavailable in ",
				createVNode(_components.code, { children: "BeforeAll" }),
				"/",
				createVNode(_components.code, { children: "AfterAll" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				"Don’t base64-inline a ",
				createVNode(_components.code, { children: ".webm" }),
				" into ",
				createVNode(_components.code, { children: "report.html" })
			] }), " (bloat) — externalize, or skip the report and upload the clip (what the delivery layer already does)."] }),
			"\n",
			createVNode(_components.li, { children: [
				"Comparison nits: ",
				createVNode(_components.code, { children: "@wdio/video-reporter" }),
				" (scoped) doesn’t exist — it’s the unscoped ",
				createVNode(_components.code, { children: "wdio-video-reporter" }),
				"; ",
				createVNode(_components.code, { children: "playwright-video" }),
				" is abandoned-in-practice. Neither affects kolu."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-design--shipped-as-written-in-",
			children: ["The design — shipped as written in ", createVNode($$PrLink, { pr: 1099 })]
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"Env-gate ",
				createVNode(_components.code, { children: "recordVideo" }),
				" (+ optional ",
				createVNode(_components.code, { children: "slowMo" }),
				", + skip the animations-off init) in ",
				createVNode(_components.code, { children: "support/hooks.ts" }),
				" under ",
				createVNode(_components.code, { children: "KOLU_EVIDENCE" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Pick (or author) a scenario reusing existing steps and select it by ",
				createVNode(_components.code, { children: "--name" }),
				" — no hand-driven clicks, no feature-file edit."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Grab the ",
				createVNode(_components.code, { children: ".webm" }),
				" in ",
				createVNode(_components.code, { children: "After" }),
				"; hand it to the ",
				createVNode(_components.strong, { children: "unchanged" }),
				" ffmpeg → GIF/mp4 → ",
				createVNode(_components.code, { children: "evidence-assets" }),
				" release → Pages-player flow (History). Capture ",
				createVNode(_components.em, { children: "source" }),
				" changes; delivery is identical."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Point the harness at the pu-served packaged binary via the existing ",
				createVNode(_components.code, { children: "KOLU_SERVER=<url>" }),
				" support (it already accepts a running-server URL) — the one piece of genuinely new plumbing."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Trace Viewer (",
			createVNode(_components.code, { children: "context.tracing" }),
			") is the richer-but-not-inline alternative for\ndeep-debug artifacts; it can’t render in a PR, so it complements an inline GIF\nrather than replacing it."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "history--what-shipped",
			children: "History — what shipped"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The ",
			createVNode(_components.strong, { children: "delivery + embedding layer is solved and durable" }),
			", and the capture\n",
			createVNode(_components.em, { children: "source" }),
			" now rides the Cucumber harness (",
			createVNode($$PrLink, { pr: 1099 }),
			") — the design\nabove is the shipped design."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "PR" }),
					"\n",
					createVNode(_components.th, { children: "What it shipped" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.a, {
						href: "https://github.com/juspay/nix-chrome-devtools-mcp/pull/2",
						children: "nix-chrome-devtools-mcp#2"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						"Screencast capability: the launcher runs ",
						createVNode(_components.code, { children: "nix shell …#ffmpeg" }),
						" and passes ",
						createVNode(_components.code, { children: "--experimentalScreencast=true" }),
						", exposing the MCP’s ",
						createVNode(_components.code, { children: "screencast_start/stop" }),
						". No host install."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1033 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"The original “video evidence” feature: MCP-screencast capture + the embedding solution + the 3-repo split + the ",
						createVNode(_components.code, { children: ".agency/do.md" }),
						" video procedure + this plan."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1037 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Moved capture ",
						createVNode(_components.em, { children: "off-machine" }),
						": PR evidence runs on an ephemeral ",
						createVNode(_components.code, { children: "pu" }),
						" box via a bespoke Playwright ",
						createVNode(_components.code, { children: "capture.mjs" }),
						"; extracted the reusable ",
						createVNode(_components.code, { children: "pu" }),
						" + ",
						createVNode(_components.code, { children: "evidence" }),
						" skills. ",
						createVNode(_components.em, { children: [
							"This is the capture path ",
							createVNode($$PrLink, { pr: 1099 }),
							" replaced."
						] })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1080 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Let Codex load the ",
						createVNode(_components.code, { children: "pu" }),
						" + ",
						createVNode(_components.code, { children: "evidence" }),
						" skills."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1099 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Capture moved onto the Cucumber harness: env-gated ",
						createVNode(_components.code, { children: "KOLU_EVIDENCE" }),
						" ",
						createVNode(_components.code, { children: "recordVideo" }),
						" in ",
						createVNode(_components.code, { children: "support/hooks.ts" }),
						", scenario selected by ",
						createVNode(_components.code, { children: "--name" }),
						", retiring ",
						createVNode(_components.code, { children: "capture.mjs" }),
						" for kolu."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1213 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Built on that path for the kolu.dev demo: ",
						createVNode(_components.code, { children: "KOLU_X11CAP" }),
						", a separate marketing-grade x11grab screencast mode (",
						createVNode(_components.code, { children: "screencast/engine.ts" }),
						")."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-durable-constraint-github-video-embedding",
			children: "The durable constraint: GitHub video embedding"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			children: [
				createVNode(_components.p, { children: [
					"GitHub auto-mounts a ",
					createVNode(_components.code, { children: "<video>" }),
					" player ",
					createVNode(_components.strong, { children: "only" }),
					" for files uploaded through the web\ncomposer (a ",
					createVNode(_components.code, { children: "user-attachments" }),
					" URL needing a session cookie + CSRF — ",
					createVNode(_components.code, { children: "gh" }),
					"/PAT\ncan’t mint it). A release-hosted or git-committed ",
					createVNode(_components.code, { children: "raw." }),
					" mp4 renders as a\n",
					createVNode(_components.em, { children: "download link" }),
					", and a hand-authored ",
					createVNode(_components.code, { children: "<video>" }),
					" tag is stripped by the comment\nsanitizer. Hence two outputs:"
				] }),
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Animated GIF" }),
						" — embeds inline via ",
						createVNode(_components.code, { children: "![](release-url)" }),
						" (a GIF is an image to GitHub). The at-a-glance proof."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "MP4 + Pages player" }),
						" — a real ",
						createVNode(_components.code, { children: "<video>" }),
						" on the shared ",
						createVNode(_components.code, { children: "juspay/video-evidence" }),
						" Pages page (",
						createVNode(_components.code, { children: "evidence.html?repo=<owner/repo>&v=<file>" }),
						", org-allowlisted); the comment links to it for HD + audio + seeking."
					] }),
					"\n"
				] }),
				createVNode(_components.p, { children: [
					"Clips live on ",
					createVNode(_components.em, { children: "each project’s own" }),
					" ",
					createVNode(_components.code, { children: "evidence-assets" }),
					" release; the\n",
					createVNode(_components.code, { children: "video-evidence" }),
					" repo holds only the parametrized player — one artifact, reused\nacross projects."
				] })
			]
		}),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"bash\"><code><span class=\"line\"><span style=\"color:#6A737D\"># the delivery half of the /do evidence flow — unchanged regardless of capture source</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">ffmpeg</span><span style=\"color:#005CC5\"> -i</span><span style=\"color:#032F62\"> clip.webm</span><span style=\"color:#005CC5\"> -vf</span><span style=\"color:#032F62\"> \"fps=12,scale=900:-1:flags=lanczos\"</span><span style=\"color:#005CC5\"> -loop</span><span style=\"color:#005CC5\"> 0</span><span style=\"color:#032F62\"> clip.gif</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">gh</span><span style=\"color:#032F62\"> release</span><span style=\"color:#032F62\"> upload</span><span style=\"color:#032F62\"> evidence-assets</span><span style=\"color:#032F62\"> clip.gif</span><span style=\"color:#032F62\"> clip.mp4</span><span style=\"color:#005CC5\"> --clobber</span><span style=\"color:#6A737D\">          # this project's release</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\"># comment: ![](…/evidence-assets/&#x3C;slug>.gif)</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">#          ▶ HD: …/video-evidence/evidence.html?repo=juspay/kolu&#x26;v=&#x3C;slug>.mp4</span></span></code></pre>" }),
		"\n",
		createVNode(_components.h2, {
			id: "follow-up",
			children: "Follow-up"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: "Picking up a new MCP launcher requires a Claude restart (the MCP server is spawned at session start)." }),
			"\n"
		] })
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
	"title": "Video evidence for PRs",
	"description": "Screencast capture + a shared Pages player — the substrate the evidence skill and per-release demos build on. Capture now rides the existing Cucumber harness.",
	"parents": ["reference"],
	"maturity": "evergreen",
	"updated": "2026-06-10T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "capture-source--reuse-the-cucumber-harness",
			"text": "Capture source — reuse the Cucumber harness"
		},
		{
			"depth": 3,
			"slug": "the-ecosystem-does-exactly-this--two-models",
			"text": "The ecosystem does exactly this — two models"
		},
		{
			"depth": 3,
			"slug": "per-ecosystem-condensed",
			"text": "Per-ecosystem, condensed"
		},
		{
			"depth": 3,
			"slug": "the-kolu-wiring--shipped-in-",
			"text": "The kolu wiring — shipped in "
		},
		{
			"depth": 3,
			"slug": "corrections-the-verification-pass-forced",
			"text": "Corrections the verification pass forced"
		},
		{
			"depth": 3,
			"slug": "the-design--shipped-as-written-in-",
			"text": "The design — shipped as written in "
		},
		{
			"depth": 2,
			"slug": "history--what-shipped",
			"text": "History — what shipped"
		},
		{
			"depth": 3,
			"slug": "the-durable-constraint-github-video-embedding",
			"text": "The durable constraint: GitHub video embedding"
		},
		{
			"depth": 2,
			"slug": "follow-up",
			"text": "Follow-up"
		}
	];
}
var url = "src/content/atlas/video-evidence.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/video-evidence.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/video-evidence.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
