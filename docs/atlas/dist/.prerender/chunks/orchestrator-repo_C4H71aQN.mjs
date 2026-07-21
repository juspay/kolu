import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/diagrams/orchestrator-repo-split.svg?raw
var orchestrator_repo_split_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 880 400\" font-family=\"ui-monospace, SFMono-Regular, Menlo, monospace\">\n  <rect width=\"880\" height=\"400\" rx=\"12\" fill=\"#f6f4ee\"/>\n  <text x=\"220\" y=\"34\" text-anchor=\"middle\" font-size=\"15\" font-weight=\"700\" fill=\"#8a6d1a\">TODAY — tangled inside kolu</text>\n  <text x=\"660\" y=\"34\" text-anchor=\"middle\" font-size=\"15\" font-weight=\"700\" fill=\"#1e7a4a\">AFTER — a repo anyone clones</text>\n  <line x1=\"440\" y1=\"20\" x2=\"440\" y2=\"380\" stroke=\"#c9c2ae\" stroke-width=\"1.5\" stroke-dasharray=\"6 5\"/>\n\n  <!-- TODAY: kolu repo box containing agents/ -->\n  <rect x=\"40\" y=\"56\" width=\"360\" height=\"300\" rx=\"10\" fill=\"#fffdf6\" stroke=\"#b9b09a\" stroke-width=\"2\"/>\n  <text x=\"60\" y=\"82\" font-size=\"14\" font-weight=\"700\" fill=\"#3a3f52\">kolu repo</text>\n  <rect x=\"60\" y=\"98\" width=\"320\" height=\"150\" rx=\"8\" fill=\"#f3edda\" stroke=\"#c7a94e\" stroke-width=\"1.8\"/>\n  <text x=\"76\" y=\"122\" font-size=\"12.5\" font-weight=\"700\" fill=\"#7a5e14\">agents/ (local path-dep)</text>\n  <text x=\"76\" y=\"146\" font-size=\"11.5\" fill=\"#5c5334\">generic: orchestrator+dashboard · be</text>\n  <text x=\"76\" y=\"164\" font-size=\"11.5\" fill=\"#5c5334\">be-review · lens/codex-debate · kolu</text>\n  <text x=\"76\" y=\"182\" font-size=\"11.5\" fill=\"#5c5334\">perfection-review · a-f-p</text>\n  <text x=\"76\" y=\"212\" font-size=\"11.5\" fill=\"#a04a28\">kolu-only: surface (mixed in)</text>\n  <rect x=\"60\" y=\"264\" width=\"320\" height=\"74\" rx=\"8\" fill=\"#efe9df\" stroke=\"#b9b09a\" stroke-width=\"1.2\"/>\n  <text x=\"76\" y=\"288\" font-size=\"12.5\" font-weight=\"700\" fill=\"#3a3f52\">.apm/ (kolu's own)</text>\n  <text x=\"76\" y=\"308\" font-size=\"11.5\" fill=\"#5c5334\">atlas · release · test · evidence · ci …</text>\n  <text x=\"220\" y=\"376\" text-anchor=\"middle\" font-size=\"11\" fill=\"#a04a28\">nobody else can use the generic half</text>\n\n  <!-- AFTER: orchestrator repo + consumers -->\n  <rect x=\"480\" y=\"56\" width=\"360\" height=\"140\" rx=\"10\" fill=\"#eaf6ee\" stroke=\"#2f9e63\" stroke-width=\"2.2\"/>\n  <text x=\"500\" y=\"82\" font-size=\"14\" font-weight=\"800\" fill=\"#186a41\">orchestrator repo (new)</text>\n  <text x=\"500\" y=\"106\" font-size=\"11.5\" fill=\"#2c5c42\">orchestrator skill + dashboard · be · be-review</text>\n  <text x=\"500\" y=\"124\" font-size=\"11.5\" fill=\"#2c5c42\">lens/codex-debate · perfection-review · a-f-p</text>\n  <text x=\"500\" y=\"142\" font-size=\"11.5\" fill=\"#2c5c42\">kolu (agent-driving: MCP-first, CLI fallback)</text>\n  <text x=\"500\" y=\"168\" font-size=\"11\" font-style=\"italic\" fill=\"#186a41\">zero kolu-repo imports — talks to kolu THE PRODUCT</text>\n\n  <rect x=\"480\" y=\"240\" width=\"165\" height=\"86\" rx=\"9\" fill=\"#fffdf6\" stroke=\"#b9b09a\" stroke-width=\"1.8\"/>\n  <text x=\"562\" y=\"266\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"#3a3f52\">kolu repo</text>\n  <text x=\"562\" y=\"286\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#5c5334\">apm dep → orchestrator</text>\n  <text x=\"562\" y=\"303\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#5c5334\">keeps: surface · atlas · …</text>\n\n  <rect x=\"675\" y=\"240\" width=\"165\" height=\"86\" rx=\"9\" fill=\"#fffdf6\" stroke=\"#6a58c9\" stroke-width=\"1.8\"/>\n  <text x=\"757\" y=\"266\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"#4a3d99\">ANY user's repo</text>\n  <text x=\"757\" y=\"286\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#544a86\">clone / apm dep</text>\n  <text x=\"757\" y=\"303\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#544a86\">same setup as ours</text>\n\n  <defs><marker id=\"a\" viewBox=\"0 0 8 8\" refX=\"7\" refY=\"4\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto\"><path d=\"M0 0 L8 4 L0 8 z\" fill=\"#4a5568\"/></marker></defs>\n  <line x1=\"562\" y1=\"240\" x2=\"600\" y2=\"198\" stroke=\"#4a5568\" stroke-width=\"1.8\" marker-end=\"url(#a)\"/>\n  <line x1=\"757\" y1=\"240\" x2=\"722\" y2=\"198\" stroke=\"#4a5568\" stroke-width=\"1.8\" marker-end=\"url(#a)\"/>\n  <text x=\"660\" y=\"372\" text-anchor=\"middle\" font-size=\"11\" fill=\"#186a41\">one source of truth; kolu is just the first consumer</text>\n</svg>\n";
//#endregion
//#region src/diagrams/orchestrator-repo-stack.svg?raw
var orchestrator_repo_stack_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 880 430\" font-family=\"ui-monospace, SFMono-Regular, Menlo, monospace\">\n  <rect width=\"880\" height=\"430\" rx=\"12\" fill=\"#f6f4ee\"/>\n  <text x=\"440\" y=\"32\" text-anchor=\"middle\" font-size=\"15\" font-weight=\"700\" fill=\"#3a3f52\">any user's machine — the whole loop, five minutes after cloning</text>\n\n  <!-- human -->\n  <rect x=\"40\" y=\"64\" width=\"180\" height=\"58\" rx=\"9\" fill=\"#fffdf6\" stroke=\"#b9b09a\" stroke-width=\"1.8\"/>\n  <text x=\"130\" y=\"89\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#3a3f52\">the human</text>\n  <text x=\"130\" y=\"108\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#5c5334\">rules on forks · merges</text>\n\n  <!-- coordinator -->\n  <rect x=\"290\" y=\"64\" width=\"270\" height=\"106\" rx=\"9\" fill=\"#eef0fb\" stroke=\"#6a58c9\" stroke-width=\"2.2\"/>\n  <text x=\"425\" y=\"90\" text-anchor=\"middle\" font-size=\"13.5\" font-weight=\"800\" fill=\"#4a3d99\">coordinator agent</text>\n  <text x=\"425\" y=\"110\" text-anchor=\"middle\" font-size=\"11\" fill=\"#544a86\">a kolu terminal running /orchestrator</text>\n  <text x=\"425\" y=\"128\" text-anchor=\"middle\" font-size=\"11\" fill=\"#544a86\">briefs · goals · gates · venue rulings</text>\n  <text x=\"425\" y=\"150\" text-anchor=\"middle\" font-size=\"10.5\" font-style=\"italic\" fill=\"#6a58c9\">dashboard in the Code tab ▸ live board</text>\n\n  <!-- lanes -->\n  <rect x=\"630\" y=\"64\" width=\"210\" height=\"106\" rx=\"9\" fill=\"#fdf0e6\" stroke=\"#c2762c\" stroke-width=\"2\"/>\n  <text x=\"735\" y=\"90\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#8a4d12\">lane agents</text>\n  <text x=\"735\" y=\"110\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#7a5a34\">one terminal + worktree each</text>\n  <text x=\"735\" y=\"128\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#7a5a34\">/be → gauntlet → CI → PR</text>\n  <text x=\"735\" y=\"148\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#7a5a34\">questions = files, never dialogs</text>\n\n  <!-- the portable interface bar -->\n  <rect x=\"120\" y=\"222\" width=\"640\" height=\"52\" rx=\"9\" fill=\"#eaf6ee\" stroke=\"#2f9e63\" stroke-width=\"2.4\"/>\n  <text x=\"440\" y=\"245\" text-anchor=\"middle\" font-size=\"13.5\" font-weight=\"800\" fill=\"#186a41\">kolu mcp — the portable seam (kolu-cli PR2)</text>\n  <text x=\"440\" y=\"264\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#2c5c42\">terminals · urgency · screen.text · create/kill/sendInput(keys) · wait.outputSettled / wait.agentState</text>\n\n  <!-- kolu product -->\n  <rect x=\"220\" y=\"316\" width=\"440\" height=\"80\" rx=\"9\" fill=\"#fffdf6\" stroke=\"#b9b09a\" stroke-width=\"1.8\"/>\n  <text x=\"440\" y=\"342\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#3a3f52\">kolu the product (installed, not the repo)</text>\n  <text x=\"440\" y=\"362\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#5c5334\">padi + kaval daemons · canvas · Code tab · deep links</text>\n  <text x=\"440\" y=\"380\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#5c5334\">kaval-tui / padi-tui = the CLI fallback when MCP is absent</text>\n\n  <defs><marker id=\"b\" viewBox=\"0 0 8 8\" refX=\"7\" refY=\"4\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto\"><path d=\"M0 0 L8 4 L0 8 z\" fill=\"#4a5568\"/></marker></defs>\n  <line x1=\"220\" y1=\"93\" x2=\"290\" y2=\"93\" stroke=\"#4a5568\" stroke-width=\"1.8\" marker-end=\"url(#b)\"/>\n  <line x1=\"560\" y1=\"110\" x2=\"630\" y2=\"110\" stroke=\"#4a5568\" stroke-width=\"1.8\" marker-end=\"url(#b)\"/>\n  <text x=\"595\" y=\"100\" text-anchor=\"middle\" font-size=\"10\" fill=\"#4a5568\">dispatch</text>\n  <line x1=\"425\" y1=\"170\" x2=\"425\" y2=\"222\" stroke=\"#2f9e63\" stroke-width=\"2\" marker-end=\"url(#b)\"/>\n  <line x1=\"735\" y1=\"170\" x2=\"640\" y2=\"222\" stroke=\"#2f9e63\" stroke-width=\"2\" marker-end=\"url(#b)\"/>\n  <line x1=\"440\" y1=\"274\" x2=\"440\" y2=\"316\" stroke=\"#2f9e63\" stroke-width=\"2\" marker-end=\"url(#b)\"/>\n</svg>\n";
//#endregion
//#region src/content/atlas/orchestrator-repo.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		em: "em",
		h2: "h2",
		li: "li",
		ol: "ol",
		p: "p",
		pre: "pre",
		span: "span",
		strong: "strong",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.h2, {
			id: "user-facing-description",
			children: "User-facing description"
		}),
		"\n",
		createVNode(_components.p, { children: "A kolu user runs one clone, opens one file, and has the setup this campaign\nruns on:" }),
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
					children: createVNode(_components.span, { children: "git clone https://github.com/srid/orchestrator ~/code/orchestrator" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "# open a kolu terminal in your project, load /orchestrator, dispatch your first lane" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "# open <orchestrator>/dashboard/index.html in the Code tab → the live board" })
				})
			] })
		}),
		"\n",
		createVNode($$Svg, {
			svg: orchestrator_repo_stack_default,
			caption: "The whole loop on a stranger's machine. The skills never touch kolu's repo — they drive kolu THE PRODUCT through the MCP seam, falling back to kaval-tui/padi-tui where MCP is absent."
		}),
		"\n",
		createVNode(_components.h2, {
			id: "architecture-level-changes",
			children: "Architecture-level changes"
		}),
		"\n",
		createVNode($$Svg, {
			svg: orchestrator_repo_split_default,
			caption: "The split. agents/ stops being a kolu-internal path-dependency; the generic half becomes the orchestrator repo, kolu becomes its first consumer, and the kolu-only surface skill moves home to kolu's own .apm."
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "What moves" }),
				": ",
				createVNode(_components.code, { children: "orchestrator" }),
				" (+ dashboard assets) · ",
				createVNode(_components.code, { children: "be" }),
				" · ",
				createVNode(_components.code, { children: "be-review" }),
				" ·\n",
				createVNode(_components.code, { children: "lens-debate" }),
				" · ",
				createVNode(_components.code, { children: "codex-debate" }),
				" · ",
				createVNode(_components.code, { children: "perfection-review" }),
				" ·\n",
				createVNode(_components.code, { children: "architecture-first-principles" }),
				" · ",
				createVNode(_components.code, { children: "kolu" }),
				" (the agent-driving protocol — named\nfor the product it drives, not the repo it lives in)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "What stays" }),
				": ",
				createVNode(_components.code, { children: "surface" }),
				" (kolu-repo law → kolu’s root ",
				createVNode(_components.code, { children: ".apm/" }),
				"), and\neverything already there (atlas, release, test, evidence, ci…)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The boundary that makes it honest" }),
				": the moved skills may reference kolu\n",
				createVNode(_components.em, { children: "the product" }),
				" (MCP tools, ",
				createVNode(_components.code, { children: "kaval-tui" }),
				"/",
				createVNode(_components.code, { children: "padi-tui" }),
				" fallback verbs, Code-tab\npreview) but never kolu ",
				createVNode(_components.em, { children: "the repo" }),
				" (no paths into ",
				createVNode(_components.code, { children: "packages/" }),
				", no repo-local\nrecipes).",
				createVNode($$Footnote, { children: [
					"Today’s violations of that boundary are the extraction\nwork: skill text that hardcodes kolu worktree paths, ",
					createVNode(_components.code, { children: "just" }),
					" recipes, or the\nrepo’s CI vocabulary gets parameterized or moves to kolu’s overlay. The\n",
					createVNode(_components.code, { children: ".agency/" }),
					" overlay pattern already exists for per-repo parameterization —\nthe orchestrator repo ships the generic check, the consuming repo ships its\noverlay."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Distribution" }),
				": an apm package. kolu’s ",
				createVNode(_components.code, { children: "apm.yml" }),
				" swaps the local ",
				createVNode(_components.code, { children: "path:" }),
				"\ndependency for the git dependency — same vendoring flow (",
				createVNode(_components.code, { children: "just ai::apm" }),
				"),\nnow one repo among consumers instead of a subdirectory. A non-apm user just\nclones and points their agent at the skills directory."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "One orchestrator, many projects" }),
				" (the point of the split, srid’s\nframing): the coordinator is not per-repo. One coordinator terminal +\none skills clone + one shared AI config drives campaigns across EVERY\nproject on the machine — the board’s ",
				createVNode(_components.code, { children: "project" }),
				" field and per-project\n",
				createVNode(_components.code, { children: "orchestrator-data.js" }),
				" already assume it, and this campaign is the\nexistence proof: kolu, drishti, and odu lanes ran from one coordinator\ntoday. The kolu repo then carries no agent skills at all."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Gate" }),
				": kolu-cli ",
				createVNode(_components.strong, { children: "PR2" }),
				" (",
				createVNode(_components.code, { children: "kolu mcp" }),
				"). Before it, the skills’ only driving\ninterface is the repo-specific CLI pair; after it, MCP-first with CLI\nfallback is exactly the portability line the diagram draws."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "implementation-details",
			children: "Implementation details"
		}),
		"\n",
		createVNode(_components.p, { children: "One extraction PR per repo, in order:" }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["New repo ", createVNode(_components.code, { children: "srid/orchestrator" })] }),
				": move the generic skills + dashboard\nverbatim (git history via subtree split if cheap, else fresh with a\npointer); add its own ",
				createVNode(_components.code, { children: "apm.yml" }),
				" package manifest; CI = the skills’ own unit\ntests (the lens-debate engine tests, dashboard renderer parse) — no kolu\ncheckout anywhere in its CI."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "kolu PR" }),
				": ",
				createVNode(_components.code, { children: "apm.yml" }),
				" path-dep → git-dep; ",
				createVNode(_components.code, { children: "surface" }),
				" skill relocates to\nroot ",
				createVNode(_components.code, { children: ".apm/" }),
				"; regenerate; the two-tree rule in ",
				createVNode(_components.code, { children: "apm-workflow.md" }),
				" collapses\nto one source tree + the dependency."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "De-kolu-ification pass" }),
				" (inside PR 1): sweep the moved skills for\nrepo-paths/recipes; parameterize via the existing ",
				createVNode(_components.code, { children: ".agency/" }),
				" overlay\npattern; the orchestrator SKILL’s kolu-specific venue examples (rasam,\nsincereintent) move to kolu’s overlay."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Pin" }),
				": a smoke script in the orchestrator repo that runs the dashboard\nrenderer against a sample ",
				createVNode(_components.code, { children: "orchestrator-data.js" }),
				" and lints every SKILL.md\nfor kolu-repo path leaks (",
				createVNode(_components.code, { children: "packages/" }),
				", ",
				createVNode(_components.code, { children: "just atlas::" }),
				" …) — the boundary\nstays unspellable-ish by CI."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Risks, named: apm’s vendored-from-git-checkout behavior means kolu picks up\nskill changes only at pin bumps (today’s uncommitted-edit trap becomes a\ncross-repo version lag — accepted, that’s what versioning is); the ",
			createVNode(_components.code, { children: "kolu" }),
			"\nskill’s MCP-first rewrite lands in the kolu-cli track’s “skills adopt”\nstation, which becomes a PR in the orchestrator repo, not kolu."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "The orchestrator repo — our agent setup, cloneable by anyone",
	"description": "Extract the non-kolu-specific AI skills from agents/ into a standalone repo named orchestrator: any kolu user clones it and gets our whole multi-agent setup — coordinator, dashboard, review gauntlet — driving their terminals through kolu mcp. Gated on kolu-cli PR2.",
	"parents": ["kolu-cli", "feature"],
	"status": "proposed",
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
var url = "src/content/atlas/orchestrator-repo.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/orchestrator-repo.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/orchestrator-repo.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
