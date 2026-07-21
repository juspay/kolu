import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
//#region src/diagrams/be-workflow.svg?raw
var be_workflow_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"\n     viewBox=\"0 0 1500 1320\" font-family=\"ui-sans-serif, system-ui, sans-serif\" role=\"img\"\n     aria-label=\"The /be workflow: one interview up front, then autonomous — set up, implement test-first, open a draft PR, run the four-reviewer serial gauntlet, ship CI and evidence in parallel on a pu box, then report and self-improve. Every skill node links to its SKILL.md on GitHub.\">\n  <defs>\n    <marker id=\"arrow\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-end\">\n      <path d=\"M0,0 L10,5 L0,10 z\" fill=\"#5b6472\"/>\n    </marker>\n    <marker id=\"arrowSerial\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-end\">\n      <path d=\"M0,0 L10,5 L0,10 z\" fill=\"#b5316f\"/>\n    </marker>\n    <style>\n      .phase   { stroke-width:2; }\n      .pnum    { font-size:13px; font-weight:700; fill:#ffffff; }\n      .ptitle  { font-size:19px; font-weight:700; fill:#11203a; }\n      .psub    { font-size:12.5px; fill:#6b7280; }\n      .chip    { fill:#F7F8FE; stroke:#c9d2f5; stroke-width:1; }\n      .skill   { font-size:13.5px; font-weight:700; fill:#0D32B2; }\n      .skilln  { font-size:11px; fill:#6b7280; }\n      .tool    { font-size:13.5px; font-weight:700; fill:#11203a; }\n      .flow    { stroke:#5b6472; stroke-width:2; fill:none; }\n      .link    { stroke:#b6bdc9; stroke-width:1.4; fill:none; }\n      .serial  { stroke:#b5316f; stroke-width:2.2; fill:none; }\n      .ttl     { font-size:30px; font-weight:800; fill:#11203a; }\n      .ttlsub  { font-size:14.5px; fill:#6b7280; }\n      a:hover .chip { stroke:#0D32B2; stroke-width:1.8; }\n      a { cursor:pointer; }\n    </style>\n  </defs>\n\n  <rect x=\"0\" y=\"0\" width=\"1500\" height=\"1320\" fill=\"#ffffff\"/>\n\n  <!-- ============ Title ============ -->\n  <text class=\"ttl\"    x=\"60\" y=\"54\">/be — kolu's autonomous build pipeline</text>\n  <text class=\"ttlsub\" x=\"62\" y=\"80\">One interview up front, then fully autonomous to a shipped, reviewed PR.  Every blue node is a skill — click it to open its SKILL.md on GitHub.</text>\n\n  <!-- ============ Spine flow arrows ============ -->\n  <path class=\"flow\" d=\"M540,154 L540,192\" marker-end=\"url(#arrow)\"/>\n  <path class=\"flow\" d=\"M540,264 L540,302\" marker-end=\"url(#arrow)\"/>\n  <path class=\"flow\" d=\"M540,374 L540,412\" marker-end=\"url(#arrow)\"/>\n  <path class=\"flow\" d=\"M540,484 L540,522\" marker-end=\"url(#arrow)\"/>\n  <path class=\"flow\" d=\"M540,738 L540,798\" marker-end=\"url(#arrow)\"/>\n  <path class=\"flow\" d=\"M540,1058 L540,1118\" marker-end=\"url(#arrow)\"/>\n\n  <!-- ============ §0 Interview ============ -->\n  <rect class=\"phase\" x=\"330\" y=\"88\" width=\"420\" height=\"66\" rx=\"12\" fill=\"#fdf3e3\" stroke=\"#b76e00\"/>\n  <circle cx=\"356\" cy=\"121\" r=\"13\" fill=\"#b76e00\"/>\n  <text class=\"pnum\"   x=\"356\" y=\"125\" text-anchor=\"middle\">0</text>\n  <text class=\"ptitle\" x=\"380\" y=\"116\">Interview — the differentiator</text>\n  <text class=\"psub\"   x=\"380\" y=\"138\">the one &amp; only place /be asks you anything</text>\n\n  <!-- AskUserQuestion (built-in tool, no link) -->\n  <path class=\"link\" d=\"M750,121 L800,121\"/>\n  <rect class=\"chip\" x=\"800\" y=\"94\" width=\"340\" height=\"54\" rx=\"8\"/>\n  <text class=\"tool\"   x=\"818\" y=\"116\">AskUserQuestion  (batched, once)</text>\n  <text class=\"skilln\" x=\"818\" y=\"135\">Plan first?  ·  Task kind</text>\n\n  <!-- ============ §1 Set up ============ -->\n  <rect class=\"phase\" x=\"330\" y=\"192\" width=\"420\" height=\"72\" rx=\"12\" fill=\"#E3E9FD\" stroke=\"#0D32B2\"/>\n  <circle cx=\"356\" cy=\"228\" r=\"13\" fill=\"#0D32B2\"/>\n  <text class=\"pnum\"   x=\"356\" y=\"232\" text-anchor=\"middle\">1</text>\n  <text class=\"ptitle\" x=\"380\" y=\"221\">Set up</text>\n  <text class=\"psub\"   x=\"380\" y=\"242\">git fetch · branch off origin/HEAD · read .agency/do.md</text>\n  <text class=\"psub\"   x=\"380\" y=\"258\">feature branch only — never commit to master</text>\n\n  <a xlink:href=\"https://github.com/juspay/kolu/blob/master/.apm/skills/atlas/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <path class=\"link\" d=\"M750,228 L800,228\"/>\n    <rect class=\"chip\" x=\"800\" y=\"204\" width=\"340\" height=\"50\" rx=\"8\"/>\n    <text class=\"skill\"  x=\"818\" y=\"226\">/atlas</text>\n    <text class=\"skilln\" x=\"818\" y=\"244\">plan-of-record note (optional · \"plan first\")</text>\n  </a>\n\n  <!-- ============ §2 Implement ============ -->\n  <rect class=\"phase\" x=\"330\" y=\"302\" width=\"420\" height=\"72\" rx=\"12\" fill=\"#EAF6EC\" stroke=\"#2f8132\"/>\n  <circle cx=\"356\" cy=\"338\" r=\"13\" fill=\"#2f8132\"/>\n  <text class=\"pnum\"   x=\"356\" y=\"342\" text-anchor=\"middle\">2</text>\n  <text class=\"ptitle\" x=\"380\" y=\"331\">Implement — test-first</text>\n  <text class=\"psub\"   x=\"380\" y=\"352\">repro red→green (bug) · cover (feature) · sync docs</text>\n  <text class=\"psub\"   x=\"380\" y=\"368\">honor design philosophy · changelog · check + fmt</text>\n\n  <path class=\"link\" d=\"M750,338 L800,338\"/>\n  <a xlink:href=\"https://github.com/juspay/kolu/blob/master/.apm/skills/test/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"800\" y=\"302\" width=\"160\" height=\"32\" rx=\"8\"/>\n    <text class=\"skill\" x=\"816\" y=\"323\">/test</text>\n  </a>\n  <a xlink:href=\"https://github.com/juspay/kolu/blob/master/.apm/skills/dev-server/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"968\" y=\"302\" width=\"172\" height=\"32\" rx=\"8\"/>\n    <text class=\"skill\" x=\"984\" y=\"323\">/dev-server</text>\n  </a>\n  <a xlink:href=\"https://github.com/juspay/skills/blob/main/skills/nix-typescript/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"800\" y=\"342\" width=\"160\" height=\"32\" rx=\"8\"/>\n    <text class=\"skill\" x=\"816\" y=\"363\">/nix-typescript</text>\n  </a>\n  <a xlink:href=\"https://github.com/juspay/project-unknown/blob/main/.apm/skills/pu/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"968\" y=\"342\" width=\"172\" height=\"32\" rx=\"8\"/>\n    <text class=\"skill\" x=\"984\" y=\"363\">/pu  (heavy work)</text>\n  </a>\n\n  <!-- ============ §3 Open PR ============ -->\n  <rect class=\"phase\" x=\"330\" y=\"412\" width=\"420\" height=\"72\" rx=\"12\" fill=\"#f0eafb\" stroke=\"#6b3fb5\"/>\n  <circle cx=\"356\" cy=\"448\" r=\"13\" fill=\"#6b3fb5\"/>\n  <text class=\"pnum\"   x=\"356\" y=\"452\" text-anchor=\"middle\">3</text>\n  <text class=\"ptitle\" x=\"380\" y=\"441\">Open the PR (draft)</text>\n  <text class=\"psub\"   x=\"380\" y=\"462\">before any review — findings land on a real PR</text>\n  <text class=\"psub\"   x=\"380\" y=\"478\">backfill changelog link · finalize plan note</text>\n\n  <path class=\"link\" d=\"M750,448 L800,448\"/>\n  <a xlink:href=\"https://github.com/srid/agency/blob/master/.apm/skills/forge-pr/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"800\" y=\"424\" width=\"160\" height=\"48\" rx=\"8\"/>\n    <text class=\"skill\" x=\"816\" y=\"453\">/forge-pr</text>\n  </a>\n  <a xlink:href=\"https://github.com/juspay/kolu/blob/master/.apm/skills/atlas/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"968\" y=\"424\" width=\"172\" height=\"48\" rx=\"8\"/>\n    <text class=\"skill\"  x=\"984\" y=\"446\">/atlas</text>\n    <text class=\"skilln\" x=\"984\" y=\"463\">status: implemented</text>\n  </a>\n\n  <!-- ============ §4 Review gauntlet ============ -->\n  <rect class=\"phase\" x=\"330\" y=\"522\" width=\"420\" height=\"66\" rx=\"12\" fill=\"#fbe9f1\" stroke=\"#b5316f\"/>\n  <circle cx=\"356\" cy=\"555\" r=\"13\" fill=\"#b5316f\"/>\n  <text class=\"pnum\"   x=\"356\" y=\"559\" text-anchor=\"middle\">4</text>\n  <text class=\"ptitle\" x=\"380\" y=\"550\">Review gauntlet</text>\n  <text class=\"psub\"   x=\"380\" y=\"572\">four reviewers, SERIAL — each sole editor, commits in turn</text>\n\n  <a xlink:href=\"https://github.com/juspay/kolu/blob/master/agents/.apm/skills/be-review/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <path class=\"link\" d=\"M750,555 L800,555\"/>\n    <rect class=\"chip\" x=\"800\" y=\"531\" width=\"340\" height=\"48\" rx=\"8\"/>\n    <text class=\"skill\"  x=\"818\" y=\"553\">/be-review</text>\n    <text class=\"skilln\" x=\"818\" y=\"570\">orchestrates the four · pushes once · then comments</text>\n  </a>\n\n  <!-- gauntlet feeder -->\n  <path class=\"serial\" d=\"M540,588 L540,608 L150,608 L150,636\" marker-end=\"url(#arrowSerial)\"/>\n\n  <!-- 4 serial reviewers -->\n  <a xlink:href=\"https://github.com/juspay/kolu/blob/master/agents/.apm/skills/lens-debate/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"50\" y=\"636\" width=\"200\" height=\"56\" rx=\"8\" stroke=\"#b5316f\"/>\n    <text class=\"skill\"  x=\"68\" y=\"660\">/lens-debate</text>\n    <text class=\"skilln\" x=\"68\" y=\"678\">boundaries ⇄ simplicity</text>\n  </a>\n  <path class=\"serial\" d=\"M250,664 L320,664\" marker-end=\"url(#arrowSerial)\"/>\n  <a xlink:href=\"https://github.com/juspay/kolu/blob/master/agents/.apm/skills/codex-debate/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"320\" y=\"636\" width=\"200\" height=\"56\" rx=\"8\" stroke=\"#b5316f\"/>\n    <text class=\"skill\"  x=\"338\" y=\"660\">/codex-debate</text>\n    <text class=\"skilln\" x=\"338\" y=\"678\">codex ⇄ claude, to consensus</text>\n  </a>\n  <path class=\"serial\" d=\"M520,664 L590,664\" marker-end=\"url(#arrowSerial)\"/>\n  <!-- /simplify is a built-in Claude Code skill → links to the docs, not a repo -->\n  <a xlink:href=\"https://docs.claude.com/en/docs/claude-code/slash-commands\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"590\" y=\"636\" width=\"200\" height=\"56\" rx=\"8\" stroke=\"#b5316f\"/>\n    <text class=\"skill\"  x=\"608\" y=\"660\">/simplify</text>\n    <text class=\"skilln\" x=\"608\" y=\"678\">reuse · efficiency · altitude</text>\n  </a>\n  <path class=\"serial\" d=\"M790,664 L860,664\" marker-end=\"url(#arrowSerial)\"/>\n  <a xlink:href=\"https://github.com/srid/agency/blob/master/.apm/skills/code-police/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"860\" y=\"636\" width=\"200\" height=\"56\" rx=\"8\" stroke=\"#b5316f\"/>\n    <text class=\"skill\"  x=\"878\" y=\"660\">/code-police</text>\n    <text class=\"skilln\" x=\"878\" y=\"678\">--no-elegance in gauntlet</text>\n  </a>\n\n  <!-- lens sub-lenses -->\n  <path class=\"link\" d=\"M110,692 L110,708\"/>\n  <path class=\"link\" d=\"M190,692 L190,708\"/>\n  <a xlink:href=\"https://kolu.dev/blog/hickey-lowy\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"40\" y=\"708\" width=\"100\" height=\"30\" rx=\"8\"/>\n    <text class=\"skill\" x=\"56\" y=\"728\">/lowy</text>\n  </a>\n  <a xlink:href=\"https://kolu.dev/blog/hickey-lowy\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"150\" y=\"708\" width=\"110\" height=\"30\" rx=\"8\"/>\n    <text class=\"skill\" x=\"166\" y=\"728\">/hickey</text>\n  </a>\n\n  <!-- police sub-passes -->\n  <path class=\"link\" d=\"M920,692 L920,708\"/>\n  <a xlink:href=\"https://github.com/srid/agency/blob/master/.apm/skills/fact-check/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"860\" y=\"708\" width=\"135\" height=\"30\" rx=\"8\"/>\n    <text class=\"skill\" x=\"876\" y=\"728\">/fact-check</text>\n  </a>\n  <rect class=\"chip\" x=\"1005\" y=\"708\" width=\"170\" height=\"30\" rx=\"8\" stroke-dasharray=\"4 3\"/>\n  <text class=\"skilln\" x=\"1021\" y=\"728\">elegance — skipped</text>\n\n  <!-- gauntlet return to spine -->\n  <path class=\"serial\" d=\"M1060,664 L1130,664 L1130,762 L540,762 L540,798\" marker-end=\"url(#arrowSerial)\"/>\n\n  <!-- performance pass note -->\n  <a xlink:href=\"https://github.com/juspay/kolu/blob/master/.apm/skills/perf-diagnose/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"1180\" y=\"636\" width=\"270\" height=\"56\" rx=\"8\"/>\n    <text class=\"skill\"  x=\"1198\" y=\"660\">perf pass → atlas/performance</text>\n    <text class=\"skilln\" x=\"1198\" y=\"678\">if a perf-sensitive surface changed</text>\n  </a>\n\n  <!-- ============ §5 Ship ============ -->\n  <rect class=\"phase\" x=\"330\" y=\"798\" width=\"420\" height=\"66\" rx=\"12\" fill=\"#fbf3df\" stroke=\"#9a6a00\"/>\n  <circle cx=\"356\" cy=\"831\" r=\"13\" fill=\"#9a6a00\"/>\n  <text class=\"pnum\"   x=\"356\" y=\"835\" text-anchor=\"middle\">5</text>\n  <text class=\"ptitle\" x=\"380\" y=\"826\">Ship — CI ∥ evidence</text>\n  <text class=\"psub\"   x=\"380\" y=\"848\">run concurrently on a pu box · join before Done</text>\n\n  <!-- split into two parallel lanes -->\n  <path class=\"flow\" d=\"M540,864 L540,880 L320,880 L320,904\" marker-end=\"url(#arrow)\"/>\n  <path class=\"flow\" d=\"M540,864 L540,880 L900,880 L900,904\" marker-end=\"url(#arrow)\"/>\n\n  <!-- CI lane -->\n  <rect class=\"phase\" x=\"120\" y=\"904\" width=\"400\" height=\"120\" rx=\"12\" fill=\"#fcfcfe\" stroke=\"#9a6a00\"/>\n  <text class=\"ptitle\" x=\"140\" y=\"934\" font-size=\"16\">CI pipeline (backgrounded first)</text>\n  <a xlink:href=\"https://github.com/juspay/odu/blob/master/.apm/skills/ci/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"140\" y=\"948\" width=\"170\" height=\"56\" rx=\"8\"/>\n    <text class=\"skill\"  x=\"156\" y=\"972\">/ci</text>\n    <text class=\"skilln\" x=\"156\" y=\"990\">odu run → settle → rerun</text>\n  </a>\n  <a xlink:href=\"https://github.com/juspay/odu/blob/master/.apm/skills/odu-mcp/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"322\" y=\"948\" width=\"180\" height=\"56\" rx=\"8\"/>\n    <text class=\"skill\"  x=\"338\" y=\"972\">/odu-mcp</text>\n    <text class=\"skilln\" x=\"338\" y=\"990\">drive CI via MCP face</text>\n  </a>\n\n  <!-- Evidence lane -->\n  <rect class=\"phase\" x=\"700\" y=\"904\" width=\"400\" height=\"120\" rx=\"12\" fill=\"#fcfcfe\" stroke=\"#9a6a00\"/>\n  <text class=\"ptitle\" x=\"720\" y=\"934\" font-size=\"16\">Evidence (concurrent)</text>\n  <a xlink:href=\"https://github.com/juspay/kolu/blob/master/.apm/skills/evidence/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"720\" y=\"948\" width=\"170\" height=\"56\" rx=\"8\"/>\n    <text class=\"skill\"  x=\"736\" y=\"972\">/evidence</text>\n    <text class=\"skilln\" x=\"736\" y=\"990\">screenshot / video on pu</text>\n  </a>\n  <a xlink:href=\"https://github.com/juspay/kolu/blob/master/.apm/skills/dev-server/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"902\" y=\"948\" width=\"180\" height=\"56\" rx=\"8\"/>\n    <text class=\"skill\"  x=\"918\" y=\"972\">/dev-server</text>\n    <text class=\"skilln\" x=\"918\" y=\"990\">venue gate (local vs pu)</text>\n  </a>\n\n  <!-- pu underpins ship -->\n  <a xlink:href=\"https://github.com/juspay/project-unknown/blob/main/.apm/skills/pu/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <rect class=\"chip\" x=\"1140\" y=\"948\" width=\"200\" height=\"56\" rx=\"8\"/>\n    <text class=\"skill\"  x=\"1156\" y=\"972\">/pu</text>\n    <text class=\"skilln\" x=\"1156\" y=\"990\">ephemeral host for both</text>\n  </a>\n  <path class=\"link\" d=\"M520,976 L700,976\"/>\n  <path class=\"link\" d=\"M1100,976 L1140,976\"/>\n\n  <!-- lanes join into Done -->\n  <path class=\"flow\" d=\"M320,1024 L320,1042 L540,1042 L540,1118\" marker-end=\"url(#arrow)\"/>\n  <path class=\"flow\" d=\"M900,1024 L900,1042 L540,1042\"/>\n\n  <!-- ============ Done ============ -->\n  <rect class=\"phase\" x=\"330\" y=\"1118\" width=\"420\" height=\"68\" rx=\"12\" fill=\"#EAF6EC\" stroke=\"#2f8132\"/>\n  <circle cx=\"356\" cy=\"1152\" r=\"13\" fill=\"#2f8132\"/>\n  <path d=\"M350,1152 l4,4 l8,-9\" stroke=\"#ffffff\" stroke-width=\"2.4\" fill=\"none\"/>\n  <text class=\"ptitle\" x=\"380\" y=\"1146\">Done</text>\n  <text class=\"psub\"   x=\"380\" y=\"1167\">report PR · gauntlet outcome · CI status</text>\n  <text class=\"psub\"   x=\"380\" y=\"1182\">never merge — the human reviews &amp; merges</text>\n\n  <a xlink:href=\"https://github.com/juspay/kolu/blob/master/.apm/skills/self-improve/SKILL.md\" target=\"_blank\" rel=\"noopener\">\n    <path class=\"link\" d=\"M750,1152 L800,1152\"/>\n    <rect class=\"chip\" x=\"800\" y=\"1126\" width=\"340\" height=\"52\" rx=\"8\"/>\n    <text class=\"skill\"  x=\"818\" y=\"1148\">/self-improve  (forked)</text>\n    <text class=\"skilln\" x=\"818\" y=\"1166\">mine the session → sharpen the skill-set</text>\n  </a>\n\n  <!-- ============ Legend ============ -->\n  <g transform=\"translate(60,1235)\">\n    <text class=\"psub\" x=\"0\" y=\"0\" font-size=\"13\">Legend:</text>\n    <rect class=\"chip\" x=\"60\" y=\"-13\" width=\"20\" height=\"18\" rx=\"4\"/>\n    <text class=\"psub\" x=\"88\" y=\"0\" font-size=\"12.5\">skill (links to SKILL.md)</text>\n    <line x1=\"280\" y1=\"-4\" x2=\"320\" y2=\"-4\" class=\"flow\" marker-end=\"url(#arrow)\"/>\n    <text class=\"psub\" x=\"330\" y=\"0\" font-size=\"12.5\">phase flow</text>\n    <line x1=\"430\" y1=\"-4\" x2=\"470\" y2=\"-4\" class=\"serial\" marker-end=\"url(#arrowSerial)\"/>\n    <text class=\"psub\" x=\"480\" y=\"0\" font-size=\"12.5\">serial gauntlet</text>\n    <line x1=\"610\" y1=\"-4\" x2=\"650\" y2=\"-4\" class=\"link\"/>\n    <text class=\"psub\" x=\"660\" y=\"0\" font-size=\"12.5\">attached skill / tool</text>\n    <text class=\"psub\" x=\"840\" y=\"0\" font-size=\"12.5\">Autonomy propagates to every subagent · heavy work runs on a pu box.</text>\n  </g>\n</svg>\n";
//#endregion
//#region src/content/atlas/be-workflow.mdx
var SKILL_URL = {
	atlas: "https://github.com/juspay/kolu/blob/master/.apm/skills/atlas/SKILL.md",
	test: "https://github.com/juspay/kolu/blob/master/.apm/skills/test/SKILL.md",
	"dev-server": "https://github.com/juspay/kolu/blob/master/.apm/skills/dev-server/SKILL.md",
	"be-review": "https://github.com/juspay/kolu/blob/master/agents/.apm/skills/be-review/SKILL.md",
	"lens-debate": "https://github.com/juspay/kolu/blob/master/agents/.apm/skills/lens-debate/SKILL.md",
	"codex-debate": "https://github.com/juspay/kolu/blob/master/agents/.apm/skills/codex-debate/SKILL.md",
	evidence: "https://github.com/juspay/kolu/blob/master/.apm/skills/evidence/SKILL.md",
	"self-improve": "https://github.com/juspay/kolu/blob/master/.apm/skills/self-improve/SKILL.md",
	do: "https://github.com/srid/agency/blob/master/.apm/skills/do/SKILL.md",
	"forge-pr": "https://github.com/srid/agency/blob/master/.apm/skills/forge-pr/SKILL.md",
	"code-police": "https://github.com/srid/agency/blob/master/.apm/skills/code-police/SKILL.md",
	"fact-check": "https://github.com/srid/agency/blob/master/.apm/skills/fact-check/SKILL.md",
	ci: "https://github.com/juspay/odu/blob/master/.apm/skills/ci/SKILL.md",
	"odu-mcp": "https://github.com/juspay/odu/blob/master/.apm/skills/odu-mcp/SKILL.md",
	"nix-typescript": "https://github.com/juspay/skills/blob/main/skills/nix-typescript/SKILL.md",
	pu: "https://github.com/juspay/project-unknown/blob/main/.apm/skills/pu/SKILL.md"
};
var Skill = (props) => {
	const href = SKILL_URL[props.name];
	if (!href) throw new Error(`be-workflow: no SKILL_URL for "${props.name}"`);
	return createVNode("a", {
		href,
		style: {
			fontFamily: "var(--mono)",
			fontWeight: 600,
			whiteSpace: "nowrap"
		},
		children: ["/", props.name]
	});
};
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		blockquote: "blockquote",
		code: "code",
		em: "em",
		h2: "h2",
		li: "li",
		ol: "ol",
		p: "p",
		strong: "strong",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		"\n",
		"\n",
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "/be" }), " is how kolu ships."] }),
				" You type ",
				createVNode(_components.code, { children: "/be <task>" }),
				", answer a couple of\nquestions, and walk away — the agent takes it from a fresh branch to a draft\nPR that has already survived a four-reviewer gauntlet, with green CI and visual\nevidence attached. This note is the map of that pipeline: what each phase does,\nwhich skill runs it, and how they hand off. ",
				createVNode(_components.strong, { children: "Every blue node in the diagram is\na link" }),
				" — to the skill’s canonical ",
				createVNode(_components.code, { children: "SKILL.md" }),
				" in whichever repo it lives\n(kolu, ",
				createVNode(_components.a, {
					href: "https://github.com/srid/agency/tree/master/.apm/skills",
					children: "agency"
				}),
				", odu),\nor to deeper reading where there is some."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Svg, {
			svg: be_workflow_default,
			wide: true,
			caption: "The /be pipeline. The spine (top to bottom) is the six phases; skills attach to the right of each. The magenta loop is the review gauntlet — four reviewers run strictly one after another, each the sole editor of the branch while it runs. Ship fans into two parallel lanes (CI and evidence) that rejoin before Done. Click any skill node to open its source."
		}),
		"\n",
		createVNode(_components.h2, {
			id: "how-be-differs-from-do",
			children: "How /be differs from /do"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "/be" }),
			" is the Claude-Code-native descendant of ",
			createVNode(Skill, { name: "do" }),
			". Both run\n",
			createVNode(_components.strong, { children: "fully autonomously" }),
			" start to finish — ",
			createVNode(_components.code, { children: "/do" }),
			" is “mostly autonomous” by design\nand asks nothing along the way either, so autonomy is ",
			createVNode(_components.em, { children: "not" }),
			" what sets them apart.\nTwo things actually do:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"It’s built for Claude Code’s ",
					createVNode(_components.a, {
						href: "https://code.claude.com/docs/en/workflows",
						children: "dynamic workflows"
					}),
					"."
				] }),
				"\nThat’s the reason ",
				createVNode(_components.code, { children: "/be" }),
				" exists as its own skill. A dynamic workflow is a script\nClaude Code’s runtime executes to orchestrate many subagents at scale. ",
				createVNode(_components.code, { children: "/do" }),
				" is\nharness-agnostic; ",
				createVNode(_components.code, { children: "/be" }),
				" is optimized for Claude Code so its review gauntlet can\nrun as dynamic workflows — the debate skills ",
				createVNode(Skill, { name: "be-review" }),
				" drives\n(",
				createVNode(Skill, { name: "lens-debate" }),
				", ",
				createVNode(Skill, { name: "codex-debate" }),
				") each fan out\ndozens of subagents from a workflow script, which ",
				createVNode(_components.code, { children: "/do" }),
				"’s flow has no way to\nexpress."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "It opens with a short interview." }),
				" Before any work, ",
				createVNode(_components.code, { children: "/be" }),
				" asks a single\nbatched ",
				createVNode(_components.code, { children: "AskUserQuestion" }),
				" — the one and only moment it asks you anything — to\npin down a few choices up front rather than guessing."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "/be" }),
			" lives in kolu today, but it’s meant to be ",
			createVNode(_components.strong, { children: "upstreamed" }),
			" — to\n",
			createVNode(_components.a, {
				href: "https://github.com/srid/agency",
				children: "agency"
			}),
			" (where ",
			createVNode(_components.code, { children: "/do" }),
			" and most review skills\nalready live) or another home — so it can decouple from kolu and be used\nanywhere. The kolu-specific pieces it leans on (the ",
			createVNode(Skill, { name: "pu" }),
			" box,\n",
			createVNode(Skill, { name: "dev-server" }),
			", the Atlas) are the seams that work would tease apart."
		] }),
		"\n",
		createVNode(_components.p, { children: "The interview covers two things:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Plan first?" }),
				" Write the plan as an ",
				createVNode(_components.a, {
					href: "/atlas/meta.html",
					children: "Atlas note"
				}),
				" for review\nbefore implementing, or go straight to code. Default: straight, unless the task\nis large or ambiguous."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Task kind" }), " — bug · feature · refactor. This picks the test strategy: a bug\nneeds a red-then-green reproduction; a feature needs a covering test written\nfirst; a refactor leans on existing coverage."] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			type: "note",
			children: createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "Autonomy doesn’t inherit — it’s propagated." }),
				" Every subagent ",
				createVNode(_components.code, { children: "/be" }),
				" delegates to\nis told ",
				createVNode(_components.em, { children: "execute now, don’t wait for confirmation" }),
				". A subagent starts without the\ninterview’s “no stopping” contract, so a prompt that merely describes a plan gets\na plan back instead of done work. The directive is baked into each delegation."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-six-phases",
			children: "The six phases"
		}),
		"\n",
		createVNode(_components.p, { children: "The spine of the diagram is six phases, run in order. The first is the interview\nabove; the rest are fully autonomous." }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Set up" }),
				" — ",
				createVNode(_components.code, { children: "git fetch" }),
				", branch off ",
				createVNode(_components.code, { children: "origin/HEAD" }),
				" (never commit to master),\nand read ",
				createVNode(_components.code, { children: ".agency/do.md" }),
				" for the project’s check / fmt / test / ci commands.\nIf “plan first” was chosen, the plan of record is an Atlas note authored via\n",
				createVNode(Skill, { name: "atlas" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Implement" }),
				" — test-first. A bug is ",
				createVNode(_components.em, { children: "reproduced red" }),
				" before it’s theorized\nabout, then fixed until the repro flips green — via the ",
				createVNode(Skill, { name: "test" }),
				"\nharness when a failing e2e can express it. Heavy work (builds, the dev server,\nreproductions) runs off-machine on a ",
				createVNode(Skill, { name: "pu" }),
				" box, launched through\n",
				createVNode(Skill, { name: "dev-server" }),
				", because production kolu lives on the same\nmachine. A lockfile change refreshes the Nix FOD hash via\n",
				createVNode(Skill, { name: "nix-typescript" }),
				". Docs and the changelog are synced in the same\ncommit."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Open the PR" }),
				" — a draft PR, written with ",
				createVNode(Skill, { name: "forge-pr" }),
				", ",
				createVNode(_components.em, { children: "before\nany review" }),
				", so every reviewer’s findings land as comments on a real PR. The\nchangelog link is backfilled and, if there’s a plan note, it’s finalized to\n",
				createVNode(_components.code, { children: "status: implemented" }),
				" via ",
				createVNode(Skill, { name: "atlas" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Review gauntlet" }),
				" — the heart of ",
				createVNode(_components.code, { children: "/be" }),
				" (next section). Skip entirely with\n",
				createVNode(_components.code, { children: "/be --skip-gauntlet …" }),
				" (draft PR → Ship with no reviewers)."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Ship" }), " — CI and evidence, in parallel (section after next)."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Done" }),
				" — report the PR, the gauntlet outcome (or that the gauntlet was\nskipped), and CI status. ",
				createVNode(_components.code, { children: "/be" }),
				" ",
				createVNode(_components.em, { children: "never merges" }),
				"; the human reviews the commits\nand merges when satisfied. Then it runs ",
				createVNode(Skill, { name: "self-improve" }),
				" to mine\nthe session for recurring friction."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-review-gauntlet",
			children: "The review gauntlet"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Phase 4 is ",
			createVNode(Skill, { name: "be-review" }),
			", which runs four reviewers ",
			createVNode(_components.strong, { children: "serially" }),
			" —\neach the ",
			createVNode(_components.strong, { children: "sole editor of the branch while it runs" }),
			". Serial, not parallel, by\ndesign: two reviewers writing the same worktree at once would see torn,\nhalf-edited state. Running one at a time means every reviewer reads a clean,\ncommitted tree and applies its own fixes directly — no snapshot machinery, no\nseparate apply pass."
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(Skill, { name: "lens-debate" }),
				" — two structural lenses,\n",
				createVNode(_components.a, {
					href: "https://kolu.dev/blog/hickey-lowy",
					children: "lowy"
				}),
				" (volatility-based boundaries) and\n",
				createVNode(_components.a, {
					href: "https://kolu.dev/blog/hickey-lowy",
					children: "hickey"
				}),
				" (structural simplicity), review\nindependently; the reviews are then reconciled (findings both lenses raised\nwith compatible conclusions — and unopposed solo findings — settle with zero\ndebate turns) and only genuinely contested findings are cross-examined to\nconsensus, in parallel per-file threads, before the agreed fixes are applied.\nBoth lenses — and why kolu reviews with them — are explained in the blog post\n",
				createVNode(_components.a, {
					href: "https://kolu.dev/blog/hickey-lowy",
					children: "Hickey & Lowy"
				}),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(Skill, { name: "codex-debate" }),
				" — codex (reviewer) and a Claude author debate the\ndiff to consensus, each round auto-committing its ",
				createVNode(_components.code, { children: "fix(…)" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.a, {
					href: "https://docs.claude.com/en/docs/claude-code/slash-commands",
					children: "/simplify"
				}),
				" — the\nself-applying reuse, simplification, and efficiency pass over the changed code.\n",
				createVNode(_components.em, { children: "(A built-in Claude Code skill, so this links to its docs rather than a repo.)" })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(Skill, { name: "code-police" }),
				" — its rule-checklist and ",
				createVNode(Skill, { name: "fact-check" }),
				"\npasses, applying their fixes. It runs ",
				createVNode(_components.code, { children: "--no-elegance" }),
				" here, because the\nelegance pass would just re-invoke ",
				createVNode(_components.code, { children: "/simplify" }),
				", which step 3 already ran over\nthis same tree."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "be-review" }),
			" commits each step locally but ",
			createVNode(_components.strong, { children: "pushes once at the end, then posts\nthe PR comments" }),
			" — so no comment ever advertises a commit that’s still\nlocal-only. If the diff touches a perf-sensitive surface, a performance pass\nchecks it against the ",
			createVNode(_components.a, {
				href: "/atlas/performance.html",
				children: "performance map"
			}),
			" and updates that\nnote when a win is banked or a new one surfaces."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "ship-in-parallel-then-close-the-loop",
			children: "Ship in parallel, then close the loop"
		}),
		"\n",
		createVNode(_components.p, { children: "Phase 5 runs two independent lanes at once — there’s no reason to wait for green\nbefore capturing:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "CI" }),
				" — ",
				createVNode(Skill, { name: "ci" }),
				" kicks off the pipeline first, backgrounded, driven\nthrough the ",
				createVNode(_components.a, {
					href: "https://kolu.dev/blog/odu/",
					children: "odu"
				}),
				" MCP face (",
				createVNode(Skill, { name: "odu-mcp" }),
				"): ",
				createVNode(_components.code, { children: "run" }),
				" → wait for settle →\nread the red node’s log → rerun. It reacts to failures the moment they land."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Evidence" }),
				" — ",
				createVNode(Skill, { name: "evidence" }),
				" captures on-screen behavior (a\nscreenshot or a video) for any change with a visible effect, then posts it under\nan ",
				createVNode(_components.code, { children: "## Evidence" }),
				" comment. Even a backend bug fix demonstrates the now-fixed\nbehavior."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Both lanes run on a ",
			createVNode(Skill, { name: "pu" }),
			" box, never locally — a prior run piled\nlocal builds beside production kolu and the OOM-killer took production down. The\nlanes rejoin before Done: CI must be green on the final ",
			createVNode(_components.code, { children: "HEAD" }),
			" ",
			createVNode(_components.em, { children: "and" }),
			" evidence\nposted."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"After Done, ",
			createVNode(_components.code, { children: "/be" }),
			" closes the loop with ",
			createVNode(Skill, { name: "self-improve" }),
			", which runs\n",
			createVNode(_components.strong, { children: "forked" }),
			" (off the main context) to mine this session’s transcript for every\npoint a human had to intervene. It produces nothing unless a lesson durably\nrecurs; when one does, it ships a small fix to the skill sources on its ",
			createVNode(_components.em, { children: "own" }),
			"\ndraft PR for a human to review — never on the ",
			createVNode(_components.code, { children: "/be" }),
			" branch, never merged."
		] }),
		"\n",
		createVNode($$Callout, {
			type: "note",
			children: createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "This note is kept in sync with the skills it describes." }),
				" The skill sources\nlive under ",
				createVNode(_components.code, { children: ".apm/" }),
				" (kolu-local) and the reusable ",
				createVNode(_components.code, { children: "agents/.apm/" }),
				" package; an\ninstruction file (",
				createVNode(_components.code, { children: ".apm/instructions/be-workflow-atlas.instructions.md" }),
				") reminds\nanyone editing ",
				createVNode(_components.code, { children: "agents/.apm/skills/be/**" }),
				" or ",
				createVNode(_components.code, { children: "agents/.apm/skills/be-review/**" }),
				" to revisit this note and its\ndiagram so the map never drifts from the pipeline."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"This note shipped in ",
			createVNode($$PrLink, { pr: 1565 }),
			"."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "The /be Workflow",
	"description": "How kolu takes a task to a shipped, reviewed PR — one interview up front, then a fully autonomous pipeline of skills. The whole flow, every skill in place, in one diagram.",
	"parents": ["reference", "llm-autonomy"],
	"status": "implemented",
	"maturity": "budding",
	"updated": "2026-07-21T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "how-be-differs-from-do",
			"text": "How /be differs from /do"
		},
		{
			"depth": 2,
			"slug": "the-six-phases",
			"text": "The six phases"
		},
		{
			"depth": 2,
			"slug": "the-review-gauntlet",
			"text": "The review gauntlet"
		},
		{
			"depth": 2,
			"slug": "ship-in-parallel-then-close-the-loop",
			"text": "Ship in parallel, then close the loop"
		}
	];
}
var url = "src/content/atlas/be-workflow.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/be-workflow.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/be-workflow.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, SKILL_URL, Skill, file, frontmatter, getHeadings, url };
