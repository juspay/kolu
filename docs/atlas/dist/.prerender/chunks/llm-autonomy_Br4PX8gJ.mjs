import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import { t as $$Cite } from "./Cite_D-1zLbJ9.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
import { n as $$Roadmap, t as $$Milestone } from "./Milestone_B0slHbDx.mjs";
//#region src/diagrams/llm-autonomy-enforcement.svg?raw
var llm_autonomy_enforcement_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 980 600\" font-family=\"ui-sans-serif, system-ui, sans-serif\" role=\"img\" aria-label=\"The proposed /be enforcement is a clockwise control loop. The /be flow runs top-to-bottom: User /be task to the §0 interview to the §1–§5 stages to Done. The §1–§5 stages WRITE the green run-state spine (.do-results.json) at each boundary; the guards cluster — an extended Stop hook and new PreToolUse hooks — READS the spine, then BLOCKS turn-end and dangerous actions and AUTO-RESUMES the stages. This closed green loop (write → read → block-and-resume) is the new backbone; it replaces the dashed grey human gate that re-drives the run by hand today with 'continue', 'run ci', 'don't kill prod', 'post evidence'.\">\n  <defs>\n    <marker id=\"lae-arrow\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#0D32B2\"/>\n    </marker>\n    <marker id=\"lae-garrow\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"8\" markerHeight=\"8\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#15803D\"/>\n    </marker>\n    <marker id=\"lae-harrow\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#9aa0aa\"/>\n    </marker>\n    <style>\n      .flow      { fill:#EDF0FD; stroke:#0D32B2; stroke-width:1.5; }\n      .spineglow { fill:#E6F4EA; }\n      .spine     { fill:#E6F4EA; stroke:#15803D; stroke-width:2.4; }\n      .guards    { fill:#EFF6F0; stroke:#15803D; stroke-width:2.4; }\n      .guardbox  { fill:#FFFFFF; stroke:#15803D; stroke-width:1.4; }\n      .ghost     { fill:#F4F4F5; stroke:#9aa0aa; stroke-width:1.4; stroke-dasharray:5 4; }\n      .title     { fill:#11203a; font-weight:700; font-size:14px; }\n      .sub       { fill:#4A5072; font-size:11px; }\n      .mono      { font-family:ui-monospace, \"SF Mono\", Menlo, monospace; }\n      .gtitle    { fill:#14532d; font-weight:700; font-size:13.5px; }\n      .gsub      { fill:#166534; font-size:11px; }\n      .gnote     { fill:#15803D; font-size:11px; font-style:italic; }\n      .gboxtitle { fill:#14532d; font-weight:700; font-size:12.5px; }\n      .gboxsub   { fill:#166534; font-size:10.5px; }\n      .htitle    { fill:#71717a; font-weight:700; font-size:12.5px; }\n      .hsub      { fill:#71717a; font-size:11px; }\n      .edge      { stroke:#0D32B2; stroke-width:1.6; fill:none; }\n      .gedge     { stroke:#15803D; stroke-width:2.4; fill:none; }\n      .elabel    { fill:#0D32B2; font-size:10.5px; font-style:italic; }\n      .glabel    { fill:#15803D; font-size:11px; font-style:italic; font-weight:700; }\n      .hedge     { stroke:#9aa0aa; stroke-width:1.6; fill:none; stroke-dasharray:5 4; }\n      .hlabel    { fill:#71717a; font-size:10.5px; font-style:italic; }\n      .legend    { fill:#3f444b; font-size:11px; }\n    </style>\n  </defs>\n\n  <!-- legend -->\n  <rect class=\"flow\"  x=\"40\"  y=\"14\" width=\"14\" height=\"12\" rx=\"2\"/>\n  <text class=\"legend\" x=\"60\" y=\"24\">today — /be flow</text>\n  <rect class=\"spine\" x=\"210\" y=\"14\" width=\"14\" height=\"12\" rx=\"2\"/>\n  <text class=\"legend\" x=\"230\" y=\"24\">proposed enforcement loop</text>\n  <rect class=\"ghost\" x=\"430\" y=\"14\" width=\"14\" height=\"12\" rx=\"2\"/>\n  <text class=\"legend\" x=\"450\" y=\"24\">human gate — to be removed</text>\n\n  <!-- ============ MAIN /be FLOW (top to bottom, left column) ============ -->\n  <rect class=\"flow\" x=\"150\" y=\"48\" width=\"220\" height=\"42\" rx=\"8\"/>\n  <text class=\"title\" x=\"260\" y=\"74\" text-anchor=\"middle\">User: <tspan class=\"mono\">/be &lt;task&gt;</tspan></text>\n\n  <rect class=\"flow\" x=\"110\" y=\"110\" width=\"300\" height=\"42\" rx=\"8\"/>\n  <text class=\"title\" x=\"260\" y=\"136\" text-anchor=\"middle\" font-size=\"12.5\">§0 Interview — the ONE sanctioned question</text>\n\n  <!-- the stages: the WRITER of the spine, emphasised as the loop's source -->\n  <rect class=\"flow\" x=\"118\" y=\"262\" width=\"284\" height=\"76\" rx=\"10\" stroke-width=\"2\"/>\n  <text class=\"title\" x=\"260\" y=\"290\" text-anchor=\"middle\">§1–§5 stages</text>\n  <text class=\"sub\"   x=\"260\" y=\"311\" text-anchor=\"middle\">setup · implement · PR · gauntlet · ci + evidence</text>\n  <text class=\"gnote\" x=\"260\" y=\"329\" text-anchor=\"middle\">writer of the spine</text>\n\n  <rect class=\"flow\" x=\"140\" y=\"520\" width=\"240\" height=\"46\" rx=\"8\"/>\n  <text class=\"title\" x=\"260\" y=\"542\" text-anchor=\"middle\" font-size=\"12.5\">Done</text>\n  <text class=\"sub\"   x=\"260\" y=\"558\" text-anchor=\"middle\">only when every guard passes</text>\n\n  <!-- ============ RUN-STATE SPINE (proposed, green backbone) ============ -->\n  <rect class=\"spineglow\" x=\"556\" y=\"92\" width=\"328\" height=\"124\" rx=\"14\" opacity=\"0.55\"/>\n  <rect class=\"spine\" x=\"562\" y=\"98\" width=\"316\" height=\"112\" rx=\"12\"/>\n  <text class=\"gtitle\" x=\"720\" y=\"126\" text-anchor=\"middle\">run-state spine</text>\n  <text class=\"gtitle mono\" x=\"720\" y=\"148\" text-anchor=\"middle\" font-size=\"12\">.do-results.json</text>\n  <text class=\"gsub mono\"  x=\"720\" y=\"172\" text-anchor=\"middle\" font-size=\"10.5\">stage · pr · ci · evidence · verified</text>\n  <text class=\"gnote\"  x=\"720\" y=\"196\" text-anchor=\"middle\">— /be does NOT write this today</text>\n\n  <!-- ============ GUARDS cluster (proposed, green) — the READER ============ -->\n  <rect class=\"guards\" x=\"562\" y=\"296\" width=\"316\" height=\"246\" rx=\"12\"/>\n  <text class=\"gtitle\" x=\"720\" y=\"322\" text-anchor=\"middle\" font-size=\"13.5\">Guards — exit codes, not prose</text>\n\n  <!-- Stop hook gate (notched = gate/guard) -->\n  <path class=\"guardbox\" d=\"M578 338 H854 a8 8 0 0 1 8 8 V414 a8 8 0 0 1 -8 8 H578 a8 8 0 0 1 -8 -8 V382 l12 -12 l-12 -12 V346 a8 8 0 0 1 8 -8 z\"/>\n  <text class=\"gboxtitle\" x=\"724\" y=\"360\" text-anchor=\"middle\">Stop hook (extend)</text>\n  <text class=\"gboxsub\"   x=\"724\" y=\"379\" text-anchor=\"middle\">block turn-end while active = working</text>\n  <text class=\"gboxsub\"   x=\"724\" y=\"396\" text-anchor=\"middle\">+ Done post-conditions:</text>\n  <text class=\"gboxsub mono\" x=\"724\" y=\"412\" text-anchor=\"middle\" font-size=\"10\">ci-green · evidence · gauntlet · repro-green</text>\n\n  <!-- PreToolUse gate (notched = gate/guard) -->\n  <path class=\"guardbox\" d=\"M578 438 H854 a8 8 0 0 1 8 8 V510 a8 8 0 0 1 -8 8 H578 a8 8 0 0 1 -8 -8 V478 l12 -12 l-12 -12 V446 a8 8 0 0 1 8 -8 z\"/>\n  <text class=\"gboxtitle\" x=\"724\" y=\"460\" text-anchor=\"middle\">PreToolUse hooks (new)</text>\n  <text class=\"gboxsub\"   x=\"724\" y=\"481\" text-anchor=\"middle\">block prod-kolu kill / prod-port bind</text>\n  <text class=\"gboxsub\"   x=\"724\" y=\"500\" text-anchor=\"middle\">block AskUserQuestion after §0</text>\n\n  <!-- ============ HUMAN GATE (today; dashed grey, being removed) ============ -->\n  <rect class=\"ghost\" x=\"30\" y=\"372\" width=\"216\" height=\"104\" rx=\"10\"/>\n  <text class=\"htitle\" x=\"138\" y=\"398\" text-anchor=\"middle\">Human — today: the gate</text>\n  <text class=\"hsub\"   x=\"138\" y=\"421\" text-anchor=\"middle\">'continue' · 'run ci'</text>\n  <text class=\"hsub\"   x=\"138\" y=\"441\" text-anchor=\"middle\">'DON'T KILL PROD'</text>\n  <text class=\"hsub\"   x=\"138\" y=\"461\" text-anchor=\"middle\">'post evidence'</text>\n\n  <!-- ===== EDGES: main /be flow (blue, top to bottom) ===== -->\n  <path class=\"edge\" d=\"M260 90 V110\" marker-end=\"url(#lae-arrow)\"/>\n  <path class=\"edge\" d=\"M260 152 V262\" marker-end=\"url(#lae-arrow)\"/>\n  <path class=\"edge\" d=\"M260 338 V520\" marker-end=\"url(#lae-arrow)\"/>\n\n  <!-- ===== EDGES: the CLOCKWISE green enforcement loop ===== -->\n  <!-- WRITE: stages -> spine (up-right) -->\n  <path class=\"gedge\" d=\"M402 280 H480 V154 H562\" marker-end=\"url(#lae-garrow)\"/>\n  <text class=\"glabel\" x=\"552\" y=\"146\" text-anchor=\"end\">1. write at each boundary</text>\n\n  <!-- READ: spine -> guards (down) -->\n  <path class=\"gedge\" d=\"M720 210 V296\" marker-end=\"url(#lae-garrow)\"/>\n  <text class=\"glabel\" x=\"730\" y=\"258\" text-anchor=\"start\">2. read</text>\n\n  <!-- BLOCK & AUTO-RESUME: guards -> stages (down-left back to source) -->\n  <path class=\"gedge\" d=\"M562 478 H470 V300 H402\" marker-end=\"url(#lae-garrow)\"/>\n  <text class=\"glabel\" x=\"412\" y=\"332\" text-anchor=\"start\">3. block &amp; auto-resume</text>\n\n  <!-- ===== EDGE: human gate (dashed grey — the path the loop replaces) ===== -->\n  <path class=\"hedge\" d=\"M210 372 V340\" marker-end=\"url(#lae-harrow)\"/>\n  <text class=\"hlabel\" x=\"100\" y=\"356\" text-anchor=\"middle\">today: manual re-drive</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/llm-autonomy.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		blockquote: "blockquote",
		code: "code",
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
			"Our PR workflow should run autonomously: one decision from the human up front,\nthen a shipped, reviewed PR with ",
			createVNode(_components.strong, { children: "zero" }),
			" further turns. ",
			createVNode(_components.strong, { children: ["Today that workflow is\n", createVNode(_components.code, { children: "/be" })] }),
			" — but the workflow will change, so this note is framed as a recurring\n",
			createVNode(_components.strong, { children: "LLM-autonomy self-improvement loop" }),
			", not a one-off ",
			createVNode(_components.code, { children: "/be" }),
			" post-mortem. This\nround measures how autonomous ",
			createVNode(_components.code, { children: "/be" }),
			" actually is, mined from the real session\nlogs, and proposes how to close the gap. The last section is the ",
			createVNode(_components.strong, { children: "runbook" }),
			" so\nwe can re-run the check against whatever drives our PRs next and watch the number\nmove."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Method: crawled every Claude Code JSONL session in a kolu worktree from the last\n~4 weeks, kept the 88 that genuinely invoked ",
			createVNode(_components.code, { children: "/be" }),
			", extracted only the\n",
			createVNode(_components.strong, { children: "human-typed turns" }),
			" (the follow-up prompts — the manual interventions), and\nfanned out a ",
			createVNode(_components.a, {
				href: "dynamic-workflow-viewer.html",
				children: "Workflow"
			}),
			" that classified all 493\ninterventions, clustered them, and ranked the fixes. Date: 2026-06-19 · window\n2026-05-30 → 2026-06-19."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "danger",
			title: "Headline",
			children: createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "/be" }), "’s autonomy is enforced only by prose."] }),
				" The one deterministic backstop in\nthe repo — the ",
				createVNode(_components.code, { children: "Stop" }),
				" hook ",
				createVNode(_components.code, { children: "do-stop-guard.sh" }),
				" — is hardwired to ",
				createVNode(_components.code, { children: "/do" }),
				":\nit reads ",
				createVNode(_components.code, { children: ".do-results.json" }),
				", which ",
				createVNode(_components.strong, { children: [
					"only ",
					createVNode(_components.code, { children: "/do" }),
					" ever writes"
				] }),
				". ",
				createVNode(_components.code, { children: "/be" }),
				"\nwrites no run-state, so it has ",
				createVNode(_components.em, { children: "zero" }),
				" machine enforcement of “don’t stop until\nshipped.” Roughly ",
				createVNode(_components.strong, { children: "200 of 493" }),
				" interventions trace to that single dead-wire.\nEvery other guardrail (no-fallbacks, don’t-kill-prod, no-mid-run-questions,\nRED-repro-first, real-evidence) is also advisory English — and the model abandons\neach under long-context pressure, so the human becomes the gate."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-autonomy-gap",
			children: "The autonomy gap"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Across 88 runs the mean autonomy score was ",
			createVNode(_components.strong, { children: "53/100" }),
			" and the median ",
			createVNode(_components.strong, { children: "54" }),
			" — a\ncoin-flip. Only ",
			createVNode(_components.strong, { children: "16 runs (18%)" }),
			" ran fully clean (the initial ",
			createVNode(_components.code, { children: "/be" }),
			" plus nothing\nelse); the largest band, 25 runs, sat at ",
			createVNode(_components.strong, { children: "0–19" }),
			" (a wall of interruptions). The\nworst — ",
			createVNode(_components.code, { children: "reload-error" }),
			" (32 interventions), ",
			createVNode(_components.code, { children: "pty-daemon-phase-b" }),
			" (20),\n",
			createVNode(_components.code, { children: "video" }),
			" (18), ",
			createVNode(_components.code, { children: "ccloading" }),
			"/",
			createVNode(_components.code, { children: "cc-scrape" }),
			" (17) — were multi-hour slogs the human\nhand-drove stage by stage."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Metric" }),
					"\n",
					createVNode(_components.th, { children: "Value" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "/be" }), " runs analyzed"] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "88" }), " (2026-05-30 → 2026-06-19)"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Total manual interventions" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "493" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Mean interventions per run" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "5.6" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Mean / median autonomy" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "53 / 54" }), " out of 100"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Fully autonomous runs (0 interventions)" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "16 of 88 (18%)" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Severity mix" }),
					"\n",
					createVNode(_components.td, { children: "112 blockers · 211 corrections · 165 nudges · 5 preferences" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Autonomy band" }),
					"\n",
					createVNode(_components.th, { children: "Runs" }),
					"\n",
					createVNode(_components.th, {}),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "100 — clean" }),
					"\n",
					createVNode(_components.td, { children: "16" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "good"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "80–99" }),
					"\n",
					createVNode(_components.td, { children: "15" }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "60–79" }),
					"\n",
					createVNode(_components.td, { children: "11" }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "40–59" }),
					"\n",
					createVNode(_components.td, { children: "12" }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "20–39" }),
					"\n",
					createVNode(_components.td, { children: "9" }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "0–19 — hand-driven" }),
					"\n",
					createVNode(_components.td, { children: "25" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "bad"
					}) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "What the clean runs have in common is the lesson." }),
			" The 16 fully-autonomous\nruns (",
			createVNode(_components.code, { children: "click-file-ref" }),
			", ",
			createVNode(_components.code, { children: "dot-in-link" }),
			", ",
			createVNode(_components.code, { children: "cc-fork" }),
			", ",
			createVNode(_components.code, { children: "sick-coat" }),
			", ",
			createVNode(_components.code, { children: "old-defect" }),
			", …)\nwere overwhelmingly ",
			createVNode(_components.strong, { children: [
				"well-specified bug issues with a pre-existing ",
				createVNode(_components.code, { children: "@skip" }),
				" e2e\nscenario"
			] }),
			" — ",
			createVNode(_components.code, { children: "/be" }),
			" had an unambiguous target and a ready-made RED test, so it ran\nend-to-end unattended. Autonomy is not a model-capability problem; it is an\n",
			createVNode(_components.strong, { children: "enforcement + specification" }),
			" problem. The fix is to make the contract\ndeterministic (exit codes, not prose) and to give every run the ground truth the\nclean runs happened to have."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: llm_autonomy_enforcement_default,
			caption: "The proposed enforcement backbone. Today the green spine and the guard boxes do not exist for /be — its stages are connected by prose only, so the run yields the turn and the human (dashed) re-drives it. The fix: /be writes a run-state spine at every stage boundary, and the existing Stop hook (extended) plus new PreToolUse hooks read it to block turn-end and dangerous actions — converting 'continue', 'run ci', 'don't kill prod', 'post evidence' from human nudges into automatic resume/refusal."
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The spine is one artifact with four jobs: ",
			createVNode(_components.strong, { children: "(1)" }),
			" Stop-guard self-resume,\n",
			createVNode(_components.strong, { children: "(2)" }),
			" post-compact / post-crash re-entry, ",
			createVNode(_components.strong, { children: "(3)" }),
			" the “interview done” marker a\nPreToolUse hook reads to block mid-run questions, and ",
			createVNode(_components.strong, { children: "(4)" }),
			" the Done\npost-condition fields. Build it once; four enforcement mechanisms hang off it."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "where-the-interventions-happen",
			children: "Where the interventions happen"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Every human follow-up was tagged against a fixed taxonomy. Two failure modes\ndominate: ",
			createVNode(_components.strong, { children: "the model builds the wrong thing" }),
			" (it never consults the project’s\nown sources of truth before coding) and ",
			createVNode(_components.strong, { children: "the model stops too early" }),
			" (no\ndeterministic “keep going”)."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Category" }),
					"\n",
					createVNode(_components.th, { children: "n" }),
					"\n",
					createVNode(_components.th, { children: "Severity" }),
					"\n",
					createVNode(_components.th, { children: "The recurring pattern" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "wrong-approach" }),
					"\n",
					createVNode(_components.td, { children: "93" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "critical"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						"Commits to a default (fallbacks, hand-rolled config, wrong package boundary) without reading conventions / ",
						createVNode(_components.code, { children: "electricity.mdx" }),
						"; no design-seam self-check before the human sees it"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "incomplete-stopped-early" }),
					"\n",
					createVNode(_components.td, { children: "85" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "critical"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Silently halts between stages; human types “continue” / “finish the /be workflow”" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "continue-or-resume-nudge" }),
					"\n",
					createVNode(_components.td, { children: "59" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "critical"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Yields after interrupts, compaction, config commands; no auto-resume" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "evidence-missing-or-wrong" }),
					"\n",
					createVNode(_components.td, { children: "46" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "critical"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Declares done with no / tests-only / unplayable / wrong-target artifact; human is the visual linter" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "requirements-clarification" }),
					"\n",
					createVNode(_components.td, { children: "40" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "high"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Launches on terse/argless prompts and a linked spec it never fully read; scope surfaces mid-run" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "tooling-env-failure" }),
					"\n",
					createVNode(_components.td, { children: "27" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "critical"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Session limits / crashes with no resumable checkpoint; codex-login & CI policy hit mid-gauntlet; orphaned pu/dev resources" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "regression-introduced" }),
					"\n",
					createVNode(_components.td, { children: "24" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "critical"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Ships unexercised changes; kills production kolu; breaks interactive controls — human is the regression detector" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "manual-verification-needed" }),
					"\n",
					createVNode(_components.td, { children: "22" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "high"
					}) }),
					"\n",
					createVNode(_components.td, { children: "“tests pass” stands in for “I watched it work”; human re-runs the repro / clicks the control / deploys" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "review-gauntlet-gap" }),
					"\n",
					createVNode(_components.td, { children: "22" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "critical"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Gauntlet doesn’t self-execute or self-verify; missing PR comments/commits; lenses miss recurring smells" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "repro-or-test-inadequate" }),
					"\n",
					createVNode(_components.td, { children: "19" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "critical"
					}) }),
					"\n",
					createVNode(_components.td, { children: "RED-repro never confirmed red for the right reason; asserts a proxy, not the user’s literal invariant" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "ci-failure" }),
					"\n",
					createVNode(_components.td, { children: "14" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "critical"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Yields before CI is green; skips master-sync, downstream PRs, per-node triage" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "overengineering-or-scope" }),
					"\n",
					createVNode(_components.td, { children: "10" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "high"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Gold-plated guards, single-use wrapper files; gauntlet doesn’t re-fire on its own later commits" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "pr-hygiene" }),
					"\n",
					createVNode(_components.td, { children: "9" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "high"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Commits sit unpushed; title/body drifts; base goes stale — “always push wtf”" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "subjective-preference" }),
					"\n",
					createVNode(_components.td, { children: "9" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "low"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						"Mostly irreducible taste that should route to ",
						createVNode(_components.code, { children: "/talk" }),
						"; a few undocumented-convention cases"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "other" }),
					"\n",
					createVNode(_components.td, { children: "10" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "low"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Branch rot (“merge latest master”), illegible review output, unverified cited issues" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "plan-feedback" }),
					"\n",
					createVNode(_components.td, { children: "4" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "low"
					}) }),
					"\n",
					createVNode(_components.td, { children: "First plan draft misses the bar (no prototype, wrong altitude) during the sanctioned §1 pause" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "The follow-up prompts themselves are the evidence — the same handful of\nfrustrations, run after run:" }),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Stopped early / nudge" }), " — “You must finish the /be workflow.” · “idiot,\nfucking build it in the PR” · “Continue from where you left off.” · “status?”\n(after an hour of silence)"] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Wrong approach" }), " — “Doesn’t parcel already support gitignore” · “Being able\nto ‘override’ is never a feature” · “solid-BROWSER’s only concern is BROWSING.\nper electricity.mdx”"] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Regression / destructive" }), " — “DO NOT FUCKING KILL PRODUCTION KOLU” · “you\nkilled production kkolu … You are suppose to run the dev server with random\nports.” · “wtf, I can no longer click on ‘Update’ button?”"] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Evidence / verification" }), " — “Your evidence is shit.” · “your mp4 doesn’t\nplay either” · “did you test your changes? … both back and fwd buttons remain\ndisabled” · “once you finish the PR, you must re-run your repro”"] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Gauntlet / CI / hygiene" }), " — “where are the codex and lowy/hicky commits?” ·\n“github says red” · “Ignore CI, I merged it.” · “always push wtf”"] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The common thread: ",
			createVNode(_components.strong, { children: "a rule the codebase already documents arrives as an angry\nmid-run interrupt" }),
			", because nothing surfaced it at the right moment or stopped\nthe model from shipping past it."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-roadmap",
			children: "The roadmap"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Fourteen deduplicated improvements, ranked by impact ÷ effort. The program is\n",
			createVNode(_components.strong, { children: "mechanical, not prose" }),
			": the top items convert the most-violated rules into\nexit-code gates. Targets are the ",
			createVNode(_components.code, { children: ".apm/" }),
			" sources (they regenerate into\n",
			createVNode(_components.code, { children: ".claude/" }),
			", ",
			createVNode(_components.code, { children: ".codex/" }),
			", ",
			createVNode(_components.code, { children: ".agents/" }),
			" via ",
			createVNode(_components.code, { children: "just ai::apm" }),
			" — never edit the generated\ncopies), ",
			createVNode(_components.code, { children: ".agency/do.md" }),
			", and ",
			createVNode(_components.code, { children: "settings.json" }),
			" hooks."
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
					createVNode(_components.th, { children: "Improvement" }),
					"\n",
					createVNode(_components.th, { children: "Lever" }),
					"\n",
					createVNode(_components.th, { children: "Effort · Impact" }),
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
						createVNode(_components.strong, { children: [
							"Wire ",
							createVNode(_components.code, { children: "/be" }),
							" into the existing Stop guard"
						] }),
						" — write the generic ",
						createVNode(_components.code, { children: ".do-results.json" }),
						" the guard already understands"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "agents/.apm/skills/be/SKILL.md" }),
						" §1/§Done; reuse ",
						createVNode(_components.code, { children: "do/scripts/do-results" }),
						". No hook change needed"
					] }),
					"\n",
					createVNode(_components.td, { children: ["S · ", createVNode(_components.strong, { children: "high" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "2" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "First PreToolUse Bash hook: hard-block prod-kolu kills & prod-port binds" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"new ",
						createVNode(_components.code, { children: ".apm" }),
						" hook → ",
						createVNode(_components.code, { children: "settings.json" }),
						" PreToolUse; cite from ",
						createVNode(_components.code, { children: "dev-server" }),
						" skill"
					] }),
					"\n",
					createVNode(_components.td, { children: ["M · ", createVNode(_components.strong, { children: "high" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["3 ", createVNode($$Pill, {
						variant: "ok",
						children: "master-sync shipped"
					})] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: [
							"Full ",
							createVNode(_components.code, { children: "/ci" }),
							" on every touched PR + master-sync at the head of §5"
						] }),
						" — §5 now fetches + merges ",
						createVNode(_components.code, { children: "origin/<default>" }),
						" before CI (kills the “merge latest master” order); the every-touched-PR half is still open"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "agents/.apm/skills/be/SKILL.md" }),
						" §5; ",
						createVNode(_components.code, { children: ".agency/do.md" }),
						" ",
						createVNode(_components.code, { children: "## CI" })
					] }),
					"\n",
					createVNode(_components.td, { children: ["S · ", createVNode(_components.strong, { children: "high" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"4 ",
						createVNode($$Pill, {
							variant: "ok",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1418 })
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Codify design philosophy as an always-loaded rule" }), " (fail-fast/no-fallbacks · electricity boundaries · reuse-existing-source) and force §2 to read it"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: ".apm/instructions/conventions.instructions.md" }),
						" → ",
						createVNode(_components.code, { children: "conventions.md" }),
						"; ",
						createVNode(_components.code, { children: "be" }),
						" §2"
					] }),
					"\n",
					createVNode(_components.td, { children: ["S · ", createVNode(_components.strong, { children: "high" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "5" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Hard-gate Done on real artifacts" }), " — extend the Stop guard with ci-green + evidence-present + gauntlet-comments-present"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "do-stop-guard.sh" }),
						" (apm source); ",
						createVNode(_components.code, { children: "/be" }),
						" writes the fields"
					] }),
					"\n",
					createVNode(_components.td, { children: ["M · ", createVNode(_components.strong, { children: "high" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "6" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: [createVNode(_components.code, { children: "## CI failure triage" }), " policy"] }), " — named flaky lanes + per-node enumerate/fix-or-waive"] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: ".agency/do.md" }) }),
					"\n",
					createVNode(_components.td, { children: ["S · ", createVNode(_components.strong, { children: "high" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "7" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Make §4 a self-driving in-process Skill chain" }), "; forbid handing reviewers back to the user"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "agents/.apm/skills/be/SKILL.md" }),
						" §4; ",
						createVNode(_components.code, { children: "be-review" })
					] }),
					"\n",
					createVNode(_components.td, { children: ["M · ", createVNode(_components.strong, { children: "high" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "8" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "§3 deliverable-coverage gate + grep-before-assert" }), " — never report a PR whose diff doesn’t match the task; never claim “no fallbacks” unchecked"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "be" }),
						" §3; ",
						createVNode(_components.code, { children: "code-police" }),
						" / ",
						createVNode(_components.code, { children: "fact-check" })
					] }),
					"\n",
					createVNode(_components.td, { children: "M · med" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "9" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Machine-checked RED→GREEN repro & observed-green before Done" }), " (tests passing ≠ verified)"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "be" }),
						" §2; Stop guard ",
						createVNode(_components.code, { children: "verified" }),
						" field"
					] }),
					"\n",
					createVNode(_components.td, { children: ["M · ", createVNode(_components.strong, { children: "high" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "10" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "§0 echoes a concrete task contract; PreToolUse blocks AskUserQuestion after §0" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "be" }), " §0; new PreToolUse hook"] }),
					"\n",
					createVNode(_components.td, { children: "M · med" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "11" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "§2 design-seam self-check" }),
						" — run lowy + hickey on the ",
						createVNode(_components.em, { children: "seam" }),
						" before building, not at §4"
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "be" }), " §2"] }),
					"\n",
					createVNode(_components.td, { children: "M · med" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "12" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Heartbeat + wall-clock budget + auto-retry" }), " on long review/ship sub-skills"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "be-review" }),
						", ",
						createVNode(_components.code, { children: "codex-debate" }),
						", ",
						createVNode(_components.code, { children: "lens-debate" }),
						", ",
						createVNode(_components.code, { children: "evidence" })
					] }),
					"\n",
					createVNode(_components.td, { children: "M · med" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "13" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Auto-classify evidence necessity" }), " from the diff; self-emit “no visual impact” so backend PRs don’t false-block"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "be" }),
						" §5; ",
						createVNode(_components.code, { children: "evidence" }),
						" §0"
					] }),
					"\n",
					createVNode(_components.td, { children: "M · med" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "14" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Lens/police hard probes for recurring smells" }), " + re-fire gauntlet on post-gauntlet commits"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "lens-debate" }),
						", ",
						createVNode(_components.code, { children: "code-police" }),
						", ",
						createVNode(_components.code, { children: "be-review" })
					] }),
					"\n",
					createVNode(_components.td, { children: "L · med" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Quick wins — do these first (all S-effort, high-impact)",
			children: createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "#1" }),
				" activates a deterministic backstop that ",
				createVNode(_components.em, { children: ["already exists but is dead for\n", createVNode(_components.code, { children: "/be" })] }),
				" — ~3 lines, zero hook/script edits, kills the single biggest intervention\nclass. ",
				createVNode(_components.strong, { children: "#3" }),
				" is pure SKILL wording and removes the 7+ “merge latest master”\norders. ",
				createVNode(_components.strong, { children: "#4" }),
				" is ~15 lines in the always-loaded rule and kills the biggest\n",
				createVNode(_components.em, { children: "correction" }),
				" class. ",
				createVNode(_components.strong, { children: "#6" }),
				" is one doc subsection. Ship #1 alone first and\nre-measure."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Systemic changes — the backbone the rest hangs off",
			children: createVNode(_components.p, { children: [
				"Re-key the Stop guard from ",
				createVNode(_components.code, { children: "/do" }),
				"-specific to ",
				createVNode(_components.strong, { children: "workflow-aware" }),
				", then extend it\nwith ",
				createVNode(_components.code, { children: "/be" }),
				" Done post-conditions (#1 → #5/#9). Introduce ",
				createVNode(_components.strong, { children: "PreToolUse hooks" }),
				" to\nthe repo (",
				createVNode(_components.code, { children: "settings.json" }),
				" has only a ",
				createVNode(_components.code, { children: "Stop" }),
				" hook today): a Bash guard for\nprod-kolu (#2) and an AskUserQuestion guard for post-§0 (#10). Make\n",
				createVNode(_components.code, { children: ".do-results.json" }),
				" the universal resume + gate substrate. Shift structural review\n",
				createVNode(_components.strong, { children: "left" }),
				" (#4 + #11) so §4 confirms instead of rebuilds. Add a no-dead-code gate\n(knip/ts-prune) to ",
				createVNode(_components.code, { children: "just check" }),
				"."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Anti-patterns — over-corrections that would hurt",
			children: createVNode(_components.ul, { children: [
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: [
						"Do NOT reintroduce any post-§0 ",
						createVNode(_components.code, { children: "AskUserQuestion" }),
						"."
					] }),
					" The corpus shows mid-run\nquestions ",
					createVNode(_components.em, { children: "are" }),
					" the failure; the fix is a sensible default + a PreToolUse block,\nnever another prompt."
				] }),
				"\n",
				createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Do NOT let the Done/evidence gate fire on pure-backend PRs" }), " — pair #5 with\nthe auto-classify in #13 or it manufactures a new false-block class."] }),
				"\n",
				createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
					"Do NOT turn no-fallbacks into a blanket grep that fails on every ",
					createVNode(_components.code, { children: "catch" }),
					" /\n",
					createVNode(_components.code, { children: "??" })
				] }), " — #8 is a cite-or-clear check for the agent, not an auto-fail."] }),
				"\n",
				createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Do NOT over-gate the Stop guard" }), " so genuine external halts (session limit,\nthe sanctioned §1 plan pause) wedge into a loop."] }),
				"\n",
				createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Do NOT parallelize the serial review gauntlet" }), " to “save time” — its serial\ndesign is deliberate (each reviewer is sole editor). Fix slowness with\nheartbeats (#12), not parallelism."] }),
				"\n"
			] })
		}),
		"\n",
		createVNode($$Roadmap, { children: [
			createVNode($$Milestone, {
				status: "now",
				label: "Round 1 — quick wins",
				children: [
					createVNode(_components.strong, { children: "#4 design-philosophy rule — shipped" }),
					" ",
					createVNode($$PrLink, { pr: 1418 }),
					" (always-loaded ",
					createVNode(_components.code, { children: "conventions.md" }),
					" §Design philosophy + ",
					createVNode(_components.code, { children: "/be" }),
					" §2 reads it). ",
					createVNode(_components.strong, { children: "#3 master-sync at §5 head — shipped" }),
					" (§5 fetches + merges ",
					createVNode(_components.code, { children: "origin/<default>" }),
					" before CI). Remaining: #1 Stop-guard wire-in · #3 the every-touched-PR ",
					createVNode(_components.code, { children: "/ci" }),
					" half · #6 CI-triage policy. Then re-run this audit and compare mean autonomy."
				]
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "Round 2 — the hook backbone",
				children: "#2 prod-kolu PreToolUse guard · #5 Done post-conditions · #9 RED→GREEN gate · #10 post-§0 question block."
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "Round 3 — review & polish",
				children: "#7 self-driving gauntlet · #11 design-seam-left · #12 heartbeats/budgets · #13 evidence auto-classify · #14 lens probes + re-review."
			})
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "re-running-this-check",
			children: "Re-running this check"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"This is meant to be a ",
			createVNode(_components.strong, { children: "recurring" }),
			" audit — run it after a batch of the fixes\nland and watch mean autonomy climb. The whole thing is one inline ",
			createVNode(_components.code, { children: "Workflow" }),
			"\nfanning out over compact per-run extracts; reproduce it like this."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"1 — Find the ",
				createVNode(_components.code, { children: "/be" }),
				" sessions (kolu worktrees, last ~4 weeks)."
			] }),
			" Logs live at\n",
			createVNode(_components.code, { children: "~/.claude/projects/-home-srid-code-kolu--worktrees-*/*.jsonl" }),
			". A real ",
			createVNode(_components.code, { children: "/be" }),
			"\ninvocation shows up as a user turn containing\n",
			createVNode(_components.code, { children: "<command-name>/be</command-name>" }),
			" (with the task in ",
			createVNode(_components.code, { children: "<command-args>" }),
			"), or a\n",
			createVNode(_components.code, { children: "Skill" }),
			" tool-use with ",
			createVNode(_components.code, { children: "\"skill\":\"be\"" }),
			". Exclude nested ",
			createVNode(_components.code, { children: "…/subagents/…" }),
			" logs. Catch\n",
			createVNode(_components.strong, { children: "continuation/resume sessions" }),
			" too — group candidate worktree ",
			createVNode(_components.em, { children: "dirs" }),
			", then take\nevery session in them within the window (a ",
			createVNode(_components.code, { children: "/be" }),
			" run often spills across resumes,\nand the resume itself is an intervention signal)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "2 — Extract only the human turns." }),
			" This is the crux: a ",
			createVNode(_components.code, { children: "\"type\":\"user\"" }),
			" entry\nis ",
			createVNode(_components.em, { children: "not" }),
			" a human prompt — most are tool results. With ",
			createVNode(_components.code, { children: "jq" }),
			", keep entries where\n",
			createVNode(_components.code, { children: "isSidechain==false" }),
			" ",
			createVNode(_components.strong, { children: "and" }),
			" ",
			createVNode(_components.code, { children: "toolUseResult==null" }),
			" ",
			createVNode(_components.strong, { children: "and" }),
			" the content is text\n(or an array with text/image blocks; ",
			createVNode(_components.code, { children: "imgs>0" }),
			" = a pasted screenshot, a strong\ncorrection signal). Drop machinery: ",
			createVNode(_components.code, { children: "<local-command-…>" }),
			" stdout/caveats,\n",
			createVNode(_components.code, { children: "<task-notification>" }),
			" blocks, and ",
			createVNode(_components.code, { children: "[Image: source:…]" }),
			" placeholders. Tag each turn\n",
			createVNode(_components.code, { children: "CMD:/name" }),
			" (slash command — its ",
			createVNode(_components.code, { children: "<command-args>" }),
			") vs ",
			createVNode(_components.code, { children: "FOLLOWUP" }),
			" (freeform). The\n",
			createVNode(_components.strong, { children: "first" }),
			" turn is the ",
			createVNode(_components.code, { children: "/be" }),
			" task; every later ",
			createVNode(_components.code, { children: "FOLLOWUP" }),
			" is a candidate\nintervention. Rank by ",
			createVNode(_components.em, { children: "genuine follow-up count" }),
			", not raw user-count, and drop\ntrivial sessions (< ~4 human turns). This run kept ",
			createVNode(_components.strong, { children: "88" }),
			" units from ~96\ncandidates."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "3 — Fan out an analysis Workflow" }),
			" (",
			createVNode(_components.code, { children: "ultracode" }),
			" makes it adversarial and deep):"
		] }),
		"\n",
		createVNode($$Roadmap, { children: [
			createVNode($$Milestone, {
				status: "now",
				label: "Analyze (1 agent / run)",
				children: [
					"Each agent reads one compact extract and classifies every intervention against the fixed taxonomy — ",
					createVNode(_components.code, { children: "category · stage · severity · preventable · quote · rootCause · howToPrevent" }),
					" — plus an ",
					createVNode(_components.code, { children: "autonomyScore" }),
					" (start 100; −25 blocker / −12 correction / −5 nudge / −3 preference; the sanctioned §1 pause and pure config commands don’t subtract). Use a JSON schema so output is validated, not parsed."
				]
			}),
			createVNode($$Milestone, {
				status: "now",
				label: "Synthesize (1 agent / category)",
				children: "Barrier: group all interventions by category in JS, then one agent per bucket distills the theme, root causes, vivid quotes, and 1–4 concrete fixes — each naming an exact lever."
			}),
			createVNode($$Milestone, {
				status: "now",
				label: "Meta (1 agent)",
				children: "Rank the deduped improvements by impact ÷ effort, separate quick wins from systemic changes, and call out anti-patterns. Compute the scorecard in JS (don’t model it)."
			})
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The micro loop — this audit, automated per run",
			children: createVNode(_components.p, { children: [
				"The sweep above is the ",
				createVNode(_components.strong, { children: "macro loop" }),
				": a periodic, hand-run pass over the whole\ncorpus. As of ",
				createVNode($$PrLink, { pr: 1448 }),
				" each run also gets a ",
				createVNode(_components.strong, { children: "micro loop" }),
				" — the\n",
				createVNode(_components.code, { children: "/self-improve" }),
				" skill that ",
				createVNode(_components.code, { children: "/be" }),
				" invokes at its very end. It runs ",
				createVNode(_components.strong, { children: "forked" }),
				" (off\n",
				createVNode(_components.code, { children: "/be" }),
				"’s context, in a throwaway worktree off latest ",
				createVNode(_components.code, { children: "master" }),
				"), mines ",
				createVNode(_components.em, { children: "that one\nsession’s" }),
				" transcript for the same intervention classes, and — only when a lesson\n",
				createVNode(_components.strong, { children: "durably recurs" }),
				" — ships a small, evidence-cited edit to the ",
				createVNode(_components.code, { children: ".apm/skills/*" }),
				"\nsources as its own draft PR. It ",
				createVNode(_components.strong, { children: "reuses this note" }),
				" (taxonomy, lever map,\nanti-patterns) rather than re-deriving them, holds the quality bar (",
				createVNode(_components.em, { children: "autonomy is\nearned by meeting it unprompted, never by weakening a gate" }),
				"), and ",
				createVNode(_components.strong, { children: "produces\nnothing by default" }),
				" — restraint over churn. The macro audit still sets the agenda\nand ranks the roadmap; the micro loop keeps each run’s lessons from evaporating\nbetween audits."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "4 — Feed the agents the levers and verify the claims." }),
			" Tell each agent ",
			createVNode(_components.em, { children: "where\nchange is possible" }),
			" (the ",
			createVNode(_components.code, { children: ".apm/" }),
			" skill sources, ",
			createVNode(_components.code, { children: "settings.json" }),
			" hooks,\n",
			createVNode(_components.code, { children: ".agency/do.md" }),
			", the rule files) so ",
			createVNode(_components.code, { children: "howToPrevent" }),
			" is actionable, not “be more\ncareful.” Then — practicing the rigor the note preaches — ",
			createVNode(_components.strong, { children: "confirm every\nload-bearing factual claim" }),
			" before publishing (this round verified\n",
			createVNode(_components.code, { children: "do-stop-guard.sh" }),
			" is ",
			createVNode(_components.code, { children: "/do" }),
			"-only ",
			createVNode($$Cite, {
				file: ".claude/hooks/agency/scripts/do-stop-guard.sh",
				lines: "1-15"
			}),
			", that ",
			createVNode(_components.code, { children: "settings.json" }),
			" has only a ",
			createVNode(_components.code, { children: "Stop" }),
			" hook, and that ",
			createVNode(_components.code, { children: "conventions.md" }),
			" has no design-philosophy section)."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Known limitations — read the score as a trend, not gospel",
			children: createVNode(_components.p, { children: [
				"Some “100” runs end mid-extract (the transcript cut off during a skill-body\nload), so a few clean scores may be incomplete rather than truly intervention-free\n(",
				createVNode(_components.code, { children: "client-commit" }),
				" is one). Skill-body markdown auto-loaded by the ",
				createVNode(_components.code, { children: "Skill" }),
				" tool can\nlook like a user turn — agents are told to ignore it. The autonomy rubric is a\nheuristic. Treat the ",
				createVNode(_components.strong, { children: "trend across audits" }),
				" as the signal; hold the extraction\nmethod constant so successive runs are comparable."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The lever map (where fixes go)",
			children: createVNode(_components.ul, { children: [
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: createVNode(_components.code, { children: "agents/.apm/skills/be/SKILL.md" }) }),
					" — the ",
					createVNode(_components.code, { children: "/be" }),
					" stages & gates (most fixes)."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: createVNode(_components.code, { children: "agents/.apm/skills/be-review/SKILL.md" }) }),
					" + the gauntlet sub-skills (",
					createVNode(_components.code, { children: "codex-debate" }),
					",\n",
					createVNode(_components.code, { children: "lens-debate" }),
					", ",
					createVNode(_components.code, { children: "simplify" }),
					", ",
					createVNode(_components.code, { children: "code-police" }),
					", ",
					createVNode(_components.code, { children: "evidence" }),
					", ",
					createVNode(_components.code, { children: "ci" }),
					", ",
					createVNode(_components.code, { children: "forge-pr" }),
					")."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: createVNode(_components.code, { children: ".apm/instructions/*.md" }) }),
					" → always-loaded ",
					createVNode(_components.code, { children: ".claude/rules/*.md" }),
					"\n(",
					createVNode(_components.code, { children: "conventions.md" }),
					" is the home for the design-philosophy rule)."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: createVNode(_components.code, { children: ".agency/do.md" }) }),
					" — the project’s check/fmt/test/ci commands + ",
					createVNode(_components.code, { children: "## PR evidence" }),
					" + ",
					createVNode(_components.code, { children: "## Documentation" }),
					" + a new ",
					createVNode(_components.code, { children: "## CI failure triage" }),
					"."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: [createVNode(_components.code, { children: "settings.json" }), " hooks"] }),
					" — the only place a rule becomes an ",
					createVNode(_components.em, { children: "exit code" }),
					": the\n",
					createVNode(_components.code, { children: "Stop" }),
					" guard (extend) and new ",
					createVNode(_components.code, { children: "PreToolUse" }),
					" guards."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					"Edit the ",
					createVNode(_components.strong, { children: [createVNode(_components.code, { children: ".apm/" }), " sources"] }),
					", then ",
					createVNode(_components.code, { children: "just ai::apm" }),
					" to regenerate; never edit the\ngenerated ",
					createVNode(_components.code, { children: ".claude/" }),
					" / ",
					createVNode(_components.code, { children: ".codex/" }),
					" / ",
					createVNode(_components.code, { children: ".agents/" }),
					" copies."
				] }),
				"\n"
			] })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "LLM Workflow Autonomy — A Self-Improvement Loop",
	"description": "A recurring audit of how autonomous our PR workflow is. Round 1 covers today's workflow, /be — 88 runs reveal where it still needs a human, the levers to close the gap, and the repeatable method to re-run the check as the workflow evolves.",
	"parents": ["analysis"],
	"status": "proposed",
	"maturity": "budding",
	"updated": "2026-06-20T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-autonomy-gap",
			"text": "The autonomy gap"
		},
		{
			"depth": 2,
			"slug": "where-the-interventions-happen",
			"text": "Where the interventions happen"
		},
		{
			"depth": 2,
			"slug": "the-roadmap",
			"text": "The roadmap"
		},
		{
			"depth": 2,
			"slug": "re-running-this-check",
			"text": "Re-running this check"
		}
	];
}
var url = "src/content/atlas/llm-autonomy.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/llm-autonomy.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/llm-autonomy.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
