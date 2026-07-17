import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
import { t as $$Footnote } from "./Footnote_Co54bi9w.mjs";
//#region src/diagrams/terminal-teams-canvas.svg?raw
var terminal_teams_canvas_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 920 430\" font-family=\"system-ui, sans-serif\">\n  <rect width=\"920\" height=\"430\" fill=\"#0f1117\"/>\n  <text x=\"30\" y=\"34\" fill=\"#8b95a7\" font-size=\"13\" font-weight=\"600\">THE CANVAS — one task, one visible team</text>\n\n  <!-- relation edges (under tiles) -->\n  <g stroke=\"#3d4a63\" stroke-width=\"2\" fill=\"none\">\n    <path d=\"M330 190 C 430 120, 480 110, 560 120\"/>\n    <path d=\"M330 220 C 440 240, 490 245, 560 240\"/>\n    <path d=\"M330 250 C 430 330, 480 340, 560 345\"/>\n  </g>\n  <g fill=\"#8b95a7\" font-size=\"10\">\n    <text x=\"435\" y=\"118\">delegates: implement</text>\n    <text x=\"440\" y=\"228\">consults: architecture</text>\n    <text x=\"437\" y=\"326\">reviews: electricity</text>\n  </g>\n\n  <!-- orchestrator tile -->\n  <rect x=\"60\" y=\"140\" width=\"270\" height=\"160\" rx=\"10\" fill=\"#141925\" stroke=\"#e8b44c\" stroke-width=\"2\"/>\n  <rect x=\"60\" y=\"140\" width=\"270\" height=\"30\" rx=\"10\" fill=\"#1a2130\"/>\n  <text x=\"75\" y=\"160\" fill=\"#f0d49b\" font-size=\"13\" font-weight=\"600\">orchestrator · RT-main</text>\n  <text x=\"75\" y=\"192\" fill=\"#c8d0de\" font-size=\"11\">holds the plan of record,</text>\n  <text x=\"75\" y=\"208\" fill=\"#c8d0de\" font-size=\"11\">dispatches briefs, verifies at the</text>\n  <text x=\"75\" y=\"224\" fill=\"#c8d0de\" font-size=\"11\">tree, rules on consults</text>\n  <text x=\"75\" y=\"252\" fill=\"#8b95a7\" font-size=\"10.5\">goal: W7 shipped · may not stop</text>\n  <text x=\"75\" y=\"266\" fill=\"#8b95a7\" font-size=\"10.5\">without report (stop-hook)</text>\n\n  <!-- teammate tiles -->\n  <g>\n    <rect x=\"560\" y=\"70\" width=\"240\" height=\"96\" rx=\"10\" fill=\"#141925\" stroke=\"#2dd4a7\" stroke-width=\"1.5\"/>\n    <rect x=\"560\" y=\"70\" width=\"240\" height=\"26\" rx=\"10\" fill=\"#1a2130\"/>\n    <text x=\"574\" y=\"88\" fill=\"#7fe3c3\" font-size=\"12\" font-weight=\"600\">implementor · worktree W7</text>\n    <text x=\"574\" y=\"112\" fill=\"#c8d0de\" font-size=\"10.5\">builds test-first on its branch;</text>\n    <text x=\"574\" y=\"126\" fill=\"#c8d0de\" font-size=\"10.5\">reports at stage boundaries</text>\n    <text x=\"574\" y=\"148\" fill=\"#8b95a7\" font-size=\"10\">state: working · 3/8 stages</text>\n\n    <rect x=\"560\" y=\"196\" width=\"240\" height=\"90\" rx=\"10\" fill=\"#141925\" stroke=\"#5b8def\" stroke-width=\"1.5\"/>\n    <rect x=\"560\" y=\"196\" width=\"240\" height=\"26\" rx=\"10\" fill=\"#1a2130\"/>\n    <text x=\"574\" y=\"214\" fill=\"#9db4e8\" font-size=\"12\" font-weight=\"600\">architect · read-only</text>\n    <text x=\"574\" y=\"238\" fill=\"#c8d0de\" font-size=\"10.5\">answers design consults with</text>\n    <text x=\"574\" y=\"252\" fill=\"#c8d0de\" font-size=\"10.5\">/architecture-first-principles</text>\n    <text x=\"574\" y=\"274\" fill=\"#8b95a7\" font-size=\"10\">state: idle · awaiting consult</text>\n\n    <rect x=\"560\" y=\"316\" width=\"240\" height=\"90\" rx=\"10\" fill=\"#141925\" stroke=\"#c07ae8\" stroke-width=\"1.5\"/>\n    <rect x=\"560\" y=\"316\" width=\"240\" height=\"26\" rx=\"10\" fill=\"#1a2130\"/>\n    <text x=\"574\" y=\"334\" fill=\"#dbb8f0\" font-size=\"12\" font-weight=\"600\">watchguard · lowy lens</text>\n    <text x=\"574\" y=\"358\" fill=\"#c8d0de\" font-size=\"10.5\">reviews each push for boundary</text>\n    <text x=\"574\" y=\"372\" fill=\"#c8d0de\" font-size=\"10.5\">violations; red-flags to orchestrator</text>\n    <text x=\"574\" y=\"394\" fill=\"#8b95a7\" font-size=\"10\">state: watching pushes</text>\n  </g>\n\n  <!-- caption strip -->\n  <rect x=\"60\" y=\"330\" width=\"270\" height=\"76\" rx=\"8\" fill=\"#141925\" stroke=\"#3d4a63\"/>\n  <text x=\"75\" y=\"352\" fill=\"#c8d0de\" font-size=\"11\">Edges are RELATIONS — typed, on the</text>\n  <text x=\"75\" y=\"368\" fill=\"#c8d0de\" font-size=\"11\">wire, persisted — generalizing today's</text>\n  <text x=\"75\" y=\"384\" fill=\"#c8d0de\" font-size=\"11\">sub-terminal parentId.</text>\n</svg>\n";
//#endregion
//#region src/diagrams/terminal-teams-roadmap.svg?raw
var terminal_teams_roadmap_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 920 300\" font-family=\"system-ui, sans-serif\">\n  <rect width=\"920\" height=\"300\" fill=\"#0f1117\"/>\n  <!-- legend -->\n  <g font-size=\"10.5\" fill=\"#8b95a7\">\n    <circle cx=\"640\" cy=\"26\" r=\"5\" fill=\"#2dd4a7\"/><text x=\"652\" y=\"30\">shipped</text>\n    <circle cx=\"722\" cy=\"26\" r=\"5\" fill=\"#e8b44c\"/><text x=\"734\" y=\"30\">small delta</text>\n    <circle cx=\"820\" cy=\"26\" r=\"5\" fill=\"#5b8def\"/><text x=\"832\" y=\"30\">new build</text>\n  </g>\n\n  <!-- feature nodes -->\n  <g>\n    <rect x=\"30\" y=\"60\" width=\"200\" height=\"58\" rx=\"9\" fill=\"#141925\" stroke=\"#2dd4a7\" stroke-width=\"1.5\"/>\n    <text x=\"44\" y=\"82\" fill=\"#7fe3c3\" font-size=\"12.5\" font-weight=\"600\">padi-tui create</text>\n    <text x=\"44\" y=\"99\" fill=\"#8b95a7\" font-size=\"10.5\">--worktree · --parent · -- argv → id</text>\n\n    <rect x=\"30\" y=\"140\" width=\"200\" height=\"58\" rx=\"9\" fill=\"#141925\" stroke=\"#2dd4a7\" stroke-width=\"1.5\"/>\n    <text x=\"44\" y=\"162\" fill=\"#7fe3c3\" font-size=\"12.5\" font-weight=\"600\">kaval-tui send / wait / snapshot</text>\n    <text x=\"44\" y=\"179\" fill=\"#8b95a7\" font-size=\"10.5\">the messaging loop (proven in campaign)</text>\n\n    <rect x=\"30\" y=\"220\" width=\"200\" height=\"58\" rx=\"9\" fill=\"#141925\" stroke=\"#2dd4a7\" stroke-width=\"1.5\"/>\n    <text x=\"44\" y=\"242\" fill=\"#7fe3c3\" font-size=\"12.5\" font-weight=\"600\">sub-terminal parentId</text>\n    <text x=\"44\" y=\"259\" fill=\"#8b95a7\" font-size=\"10.5\">a relation on the wire, rendered</text>\n\n    <rect x=\"300\" y=\"60\" width=\"200\" height=\"58\" rx=\"9\" fill=\"#141925\" stroke=\"#e8b44c\" stroke-width=\"1.5\"/>\n    <text x=\"314\" y=\"82\" fill=\"#f0d49b\" font-size=\"12.5\" font-weight=\"600\">F1 · spawn placement</text>\n    <text x=\"314\" y=\"99\" fill=\"#8b95a7\" font-size=\"10.5\">create --near &lt;tile&gt; --title &lt;role&gt;</text>\n\n    <rect x=\"300\" y=\"140\" width=\"200\" height=\"58\" rx=\"9\" fill=\"#141925\" stroke=\"#5b8def\" stroke-width=\"1.5\"/>\n    <text x=\"314\" y=\"162\" fill=\"#9db4e8\" font-size=\"12.5\" font-weight=\"600\">F2 · terminal relations</text>\n    <text x=\"314\" y=\"179\" fill=\"#8b95a7\" font-size=\"10.5\">chrome.setRelation {to, kind, label}</text>\n\n    <rect x=\"300\" y=\"220\" width=\"200\" height=\"58\" rx=\"9\" fill=\"#141925\" stroke=\"#5b8def\" stroke-width=\"1.5\"/>\n    <text x=\"314\" y=\"242\" fill=\"#9db4e8\" font-size=\"12.5\" font-weight=\"600\">F4 · /goal stop-hook</text>\n    <text x=\"314\" y=\"259\" fill=\"#8b95a7\" font-size=\"10.5\">can't stop silently; useful solo</text>\n\n    <rect x=\"570\" y=\"140\" width=\"200\" height=\"58\" rx=\"9\" fill=\"#141925\" stroke=\"#5b8def\" stroke-width=\"1.5\"/>\n    <text x=\"584\" y=\"162\" fill=\"#9db4e8\" font-size=\"12.5\" font-weight=\"600\">F3 · canvas team edges</text>\n    <text x=\"584\" y=\"179\" fill=\"#8b95a7\" font-size=\"10.5\">render F2 + role badges</text>\n  </g>\n\n  <!-- capstone -->\n  <rect x=\"700\" y=\"52\" width=\"190\" height=\"74\" rx=\"10\" fill=\"#1a2130\" stroke=\"#c07ae8\" stroke-width=\"2\"/>\n  <text x=\"716\" y=\"78\" fill=\"#dbb8f0\" font-size=\"14\" font-weight=\"700\">/team</text>\n  <text x=\"716\" y=\"96\" fill=\"#c8d0de\" font-size=\"10.5\">convene · brief · lifecycle ·</text>\n  <text x=\"716\" y=\"110\" fill=\"#c8d0de\" font-size=\"10.5\">disband — composes F1–F4</text>\n\n  <!-- arrows -->\n  <g stroke=\"#3d4a63\" stroke-width=\"1.6\" fill=\"none\">\n    <path d=\"M232 89 L 298 89\"/>\n    <path d=\"M232 249 C 265 249, 270 200, 298 178\"/>\n    <path d=\"M502 169 L 568 169\"/>\n    <path d=\"M502 89 C 590 89, 640 89, 698 89\"/>\n    <path d=\"M772 138 C 790 132, 795 128, 795 128\"/>\n    <path d=\"M502 249 C 620 245, 680 150, 700 122\"/>\n    <path d=\"M232 169 C 400 320, 660 260, 705 124\" stroke-dasharray=\"5 3\"/>\n  </g>\n  <text x=\"536\" y=\"60\" fill=\"#8b95a7\" font-size=\"10\">F1 → /team</text>\n  <text x=\"507\" y=\"160\" fill=\"#8b95a7\" font-size=\"10\">F2 → F3</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/terminal-teams.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
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
			"The surface-map campaign (PR #1714 → W7) was already a one-orchestrator-many-agents operation, run by hand: briefs over ",
			createVNode(_components.code, { children: "kaval-tui send" }),
			", claims verified at the tree, watchdogs on idle agents. Every seam it exposed is a feature below. The idea: make the crew a first-class, ",
			createVNode(_components.em, { children: "visible" }),
			" thing — teammates spawned beside the orchestrator, the team’s structure drawn on the canvas."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: terminal_teams_canvas_default,
			wide: true,
			caption: "The target: an orchestrator tile and its specialists, spawned beside it, typed relations as edges. The team is canvas structure, not tribal knowledge in one agent's context window."
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-roadmap",
			children: "The roadmap"
		}),
		"\n",
		createVNode($$Svg, {
			svg: terminal_teams_roadmap_default,
			wide: true,
			caption: "What exists, what's a delta, what's new — and /team as the composition. F1/F2/F4 are independent; F3 needs F2; each ships alone."
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Feature" }),
					"\n",
					createVNode(_components.th, { children: "What it is" }),
					"\n",
					createVNode(_components.th, { children: "Status" }),
					"\n",
					createVNode(_components.th, { children: "Campaign incident it answers" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "padi-tui create --worktree --parent -- <argv>" }), " → id; tile identical to browser-created"] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "shipped" }) }),
					"\n",
					createVNode(_components.td, { children: "(the spawn substrate)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "kaval-tui send / wait / snapshot" }), " — the messaging loop"] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "shipped" }) }),
					"\n",
					createVNode(_components.td, { children: "(the wire)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "F1" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "create --near <tile> --title <role>" }), " — spawn placed next to the orchestrator"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "delta" }),
						" on ",
						createVNode(_components.code, { children: "padi-tui create" }),
						", zero new wire surface: read the reference tile’s stored ",
						createVNode(_components.code, { children: "canvasLayout" }),
						" (the terminals collection), offset it, pass it in the EXISTING create input (",
						createVNode(_components.code, { children: "InitialTerminalMetadataSchema" }),
						" already carries optional ",
						createVNode(_components.code, { children: "canvasLayout" }),
						" — placement atomic with creation, no default-cascade race; ",
						createVNode(_components.code, { children: "repoIslands" }),
						"’ no-reshuffle rule holds)"
					] }),
					"\n",
					createVNode(_components.td, { children: "teammates lost among 40 tiles" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "F2" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Terminal ",
						createVNode(_components.strong, { children: "relations" }),
						": ",
						createVNode(_components.code, { children: "chrome.setRelation {to, kind: delegates|consults|reviews, label}" }),
						" — persisted metadata generalizing sub-terminal ",
						createVNode(_components.code, { children: "parentId" }),
						createVNode($$Footnote, { children: [
							"Why relations are kolu data, not skill state: the roster in the orchestrator’s context dies at every compaction — it did, repeatedly, during the campaign. A relation on the terminal survives compaction, reconnect, and re-keying, and renders for the human. ",
							createVNode(_components.code, { children: "parentId" }),
							" stays separate: containment ≠ collaboration."
						] })
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "new" }), " (padi surface + schema)"] }),
					"\n",
					createVNode(_components.td, { children: "the team existed only in my context window" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "F3" }) }),
					"\n",
					createVNode(_components.td, { children: "Canvas renders F2: edges + role badges, cluster on the minimap" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "new" }), " (client UI; straight lines first, no routing)"] }),
					"\n",
					createVNode(_components.td, { children: "same" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "F4" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "/goal" }),
						" — a Stop-hook contract: an agent with an unmet goal cannot end its turn without posting a report or a blocked-notice (escapes: ",
						createVNode(_components.code, { children: "done: true" }),
						", max-nag counter)"
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "new" }), " (small skill + hook; useful solo, ships first)"] }),
					"\n",
					createVNode(_components.td, { children: "the silent mid-stage stall" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "/team" }) }),
					"\n",
					createVNode(_components.td, { children: "The skill composing F1–F4: convene (spawn + relate + brief by role), messaging contract, lifecycle, disband + reap" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "new" }),
						" (upstreamable to ",
						createVNode(_components.code, { children: "srid/agency" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: "all of the above, today done by hand" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "notes-toward-team",
			children: "Notes toward /team"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Role presets are data, not code" }),
				": ",
				createVNode(_components.code, { children: "implementor:worktree" }),
				" (task brief, test-first, own branch) · ",
				createVNode(_components.code, { children: "architect:read-only" }),
				" (consults via /architecture-first-principles) · ",
				createVNode(_components.code, { children: "watchguard:lowy" }),
				" (reviews each push, red-flags to the orchestrator). A role names the skills loaded and the write posture."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The messaging contract encodes the campaign’s hardest lesson" }),
				": two-step send + Enter; large payloads as file + pointer; ",
				createVNode(_components.em, { children: "landing verified against the recipient’s transcript, never the send’s exit code" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Disband = the teardown discipline" }), ": kill by captured id, reap worktrees, drop relations. Watchdogs stay even with F4 — detection and prevention are belt and suspenders."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Done-when for /team" }),
				": a two-teammate team runs a real small task end-to-end — convened, visible on canvas, stage-reported, disbanded clean — zero manual ",
				createVNode(_components.code, { children: "kaval-tui" }),
				" by the human."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "prior-art",
			children: "Prior art"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "In-repo" }),
				": the campaign itself (the manual prototype) · ",
				createVNode(_components.code, { children: "/debate --orchestrate" }),
				" (N terminals, turn-files, orchestrator-never-argues) · ",
				createVNode(_components.code, { children: "padi-tui create" }),
				" (the spawn verb) · sub-terminal ",
				createVNode(_components.code, { children: "parentId" }),
				" (a rendered relation) · ",
				createVNode(_components.code, { children: "repoIslands" }),
				" (canvas grouping, the no-reshuffle rule)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "External" }),
				": ",
				createVNode(_components.a, {
					href: "https://code.claude.com/docs/en/agent-teams",
					children: "Claude Code agent teams"
				}),
				" — native supervisor+teammates with split-pane visibility; panes are a ",
				createVNode(_components.em, { children: "viewport" }),
				", kolu’s canvas is a ",
				createVNode(_components.em, { children: "persistent spatial structure" }),
				" (the differentiator). ",
				createVNode(_components.a, {
					href: "https://github.com/hesreallyhim/awesome-claude-code/issues/1279",
					children: "tmux-orchestrator"
				}),
				" (worktree-per-agent, two-way messaging) · ",
				createVNode(_components.a, {
					href: "https://vibecodinghub.org/tools/claude-squad",
					children: "Claude Squad"
				}),
				" · task-sizing lessons in ",
				createVNode(_components.a, {
					href: "https://addyosmani.com/blog/code-agent-orchestra/",
					children: "the code-agent orchestra"
				}),
				" / ",
				createVNode(_components.a, {
					href: "https://addyosmani.com/blog/claude-code-agent-teams/",
					children: "swarms"
				}),
				" (units small enough for check-ins → /team’s stage-boundary contract). Role frameworks (MetaGPT/ChatDev lineage) supply the decomposition; /team rejects the bespoke-runtime posture — teammates are ordinary terminals running ordinary agents."
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
	"title": "Terminal teams — a crew of agent terminals on the canvas",
	"description": "The feature roadmap toward /team: one orchestrator agent driving specialist agent terminals (implementor, architect, watchguard) with the team's structure as terminal relations rendered on the canvas. Four features, two substrates already shipped, one skill tying them together.",
	"parents": ["feature", "padi"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-08T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-roadmap",
			"text": "The roadmap"
		},
		{
			"depth": 2,
			"slug": "notes-toward-team",
			"text": "Notes toward /team"
		},
		{
			"depth": 2,
			"slug": "prior-art",
			"text": "Prior art"
		}
	];
}
var url = "src/content/atlas/terminal-teams.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/terminal-teams.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/terminal-teams.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
