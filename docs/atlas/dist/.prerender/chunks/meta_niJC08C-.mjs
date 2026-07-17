import { E as maybeRenderHead, I as createAstro, L as createComponent, N as createVNode, h as renderTemplate, l as Fragment, s as renderComponent, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import "./atlasGraph_BBFLFj6M.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import { t as $$Issue } from "./Issue_CB1XoZJT.mjs";
import { t as $$Cite } from "./Cite_D-1zLbJ9.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
import { n as $$Roadmap, t as $$Milestone } from "./Milestone_B0slHbDx.mjs";
import { t as $$Terminal } from "./Terminal_Cqh2_20m.mjs";
import { t as $$Commit } from "./Commit_DJkdIHGM.mjs";
//#region src/components/Kbd.astro
createAstro("https://astro.build");
var $$Kbd = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Kbd;
	const { keys } = Astro.props;
	const parts = keys.split("+").map((k) => k.trim()).filter(Boolean);
	return renderTemplate`${maybeRenderHead($$result)}<span class="kbd-chord" data-astro-cid-7vv3zwgx>${parts.map((k, i) => renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${i > 0 && renderTemplate`<span class="kbd-plus" data-astro-cid-7vv3zwgx>+</span>`}<kbd class="kbd" data-astro-cid-7vv3zwgx>${k}</kbd>
    ` })}`)}</span>`;
}, "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/components/Kbd.astro", void 0);
//#endregion
//#region src/components/AtlasMockup.astro
var $$AtlasMockup = createComponent(($$result, $$props, $$slots) => {
	return renderTemplate`${maybeRenderHead($$result)}<div style="font-family:ui-sans-serif,system-ui;max-width:34rem;margin:1.4rem 0;border:1px solid #e6e2d6;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06)"><div style="display:flex;align-items:center;gap:.5rem;padding:.55rem .85rem;background:#f4f1e8;border-bottom:1px solid #e6e2d6"><span style="width:11px;height:11px;border-radius:50%;background:#ff5f56;display:inline-block"></span><span style="width:11px;height:11px;border-radius:50%;background:#ffbd2e;display:inline-block"></span><span style="width:11px;height:11px;border-radius:50%;background:#27c93f;display:inline-block"></span><span style="margin-left:.5rem;font:600 .72rem/1 ui-monospace,monospace;color:#5b6470">atlas / meta.html</span></div><div style="padding:1.05rem 1.1rem;background:#fff"><div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.75rem"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#1b7a3a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V11"></path><path d="M12 11c0-3.3 2.4-5.8 5.8-5.8 0 3.3-2.4 5.8-5.8 5.8Z"></path><path d="M12 14C12 10.7 9.6 8.2 6.2 8.2 6.2 11.5 8.6 14 12 14Z"></path></svg><strong style="color:#1a1c20;font-size:.95rem">A note grows up</strong></div><div style="display:flex;align-items:center;gap:.4rem;font:.72rem/1 ui-monospace,monospace"><span style="background:#f8efd9;color:#8a5200;border:1px solid #e8d3a3;border-radius:6px;padding:.28rem .55rem">seedling</span><span style="color:#cdb47e">→</span><span style="background:#dcf0f4;color:#0b6478;border:1px solid #0b6478;border-radius:6px;padding:.28rem .55rem;box-shadow:0 0 0 2px #bfe3ea">budding</span><span style="color:#9fc0c8">→</span><span style="background:#e3f4e9;color:#1b7a3a;border:1px solid #bce3c8;border-radius:6px;padding:.28rem .55rem">evergreen</span></div></div></div>`;
}, "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/components/AtlasMockup.astro", void 0);
//#endregion
//#region src/diagrams/meta-pipeline.svg?raw
var meta_pipeline_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 760 620\" font-family=\"ui-sans-serif, system-ui, sans-serif\" role=\"img\" aria-label=\"The Atlas pipeline: MDX notes build via Astro into committed self-contained HTML, rendered both in Kolu's Code tab and the public mirror; a proposed atlasGraph + tags + Pagefind layer (green) and a later cross-repo federation tier; Claude Artifacts shown detached as a different job with no shared pipeline.\">\n  <defs>\n    <marker id=\"arrow\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0L10 5L0 10z\" fill=\"#0D32B2\"/>\n    </marker>\n    <style>\n      .container { fill:#E3E9FD; stroke:#0D32B2; stroke-width:1.5; }\n      .leaf      { fill:#F7F8FE; stroke:#0D32B2; stroke-width:1; }\n      .host      { fill:#F7F8FE; stroke:#0D32B2; stroke-width:1.5; }\n      .new       { fill:#EAF6EC; stroke:#2f8132; stroke-width:1.3; }\n      .alt       { fill:#F4F4F5; stroke:#71717a; stroke-width:1.5; stroke-dasharray:5 3; }\n      .future    { fill:#FBFBFE; stroke:#0D32B2; stroke-width:1.3; stroke-dasharray:6 4; }\n      .title     { fill:#0D32B2; font-weight:700; font-size:14px; }\n      .leaftext  { fill:#11203a; font-size:12px; }\n      .newtext   { fill:#1d4023; font-size:12px; }\n      .alttitle  { fill:#3f3f46; font-weight:700; font-size:13px; }\n      .alttext   { fill:#3f3f46; font-size:11.5px; }\n      .edge      { stroke:#0D32B2; stroke-width:2; fill:none; }\n      .fedge     { stroke:#0D32B2; stroke-width:1.6; fill:none; stroke-dasharray:6 4; }\n      .edgelabel { fill:#0D32B2; font-size:11px; font-style:italic; }\n      .legend    { fill:#11203a; font-size:11px; }\n      .muted     { fill:#71717a; font-size:11px; font-style:italic; }\n    </style>\n  </defs>\n\n  <!-- legend -->\n  <rect class=\"container\" x=\"30\" y=\"12\" width=\"14\" height=\"12\" rx=\"2\"/>\n  <text class=\"legend\" x=\"50\" y=\"22\">today</text>\n  <rect class=\"new\" x=\"104\" y=\"12\" width=\"14\" height=\"12\" rx=\"2\"/>\n  <text class=\"legend\" x=\"124\" y=\"22\">proposed</text>\n\n  <!-- TIER A: authoring -->\n  <g>\n    <rect class=\"container\" x=\"30\" y=\"40\" width=\"440\" height=\"130\" rx=\"8\"/>\n    <text class=\"title\" x=\"250\" y=\"62\" text-anchor=\"middle\">Author — docs/atlas/src/content/atlas/*.mdx</text>\n    <rect class=\"leaf\" x=\"48\" y=\"76\" width=\"404\" height=\"26\" rx=\"5\"/>\n    <text class=\"leaftext\" x=\"250\" y=\"93\" text-anchor=\"middle\">markdown / MDX + typed component kit</text>\n    <rect class=\"leaf\" x=\"48\" y=\"106\" width=\"404\" height=\"26\" rx=\"5\"/>\n    <text class=\"leaftext\" x=\"250\" y=\"123\" text-anchor=\"middle\">frontmatter: kind · maturity · status · parents</text>\n    <rect class=\"new\" x=\"48\" y=\"136\" width=\"404\" height=\"26\" rx=\"5\"/>\n    <text class=\"newtext\" x=\"250\" y=\"153\" text-anchor=\"middle\">proposed: + tags · supersedes (typed, auto-inverse relations)</text>\n  </g>\n\n  <!-- edge A -> B -->\n  <path class=\"edge\" d=\"M250 170 L250 197\" marker-end=\"url(#arrow)\"/>\n  <text class=\"edgelabel\" x=\"260\" y=\"187\" text-anchor=\"start\">just atlas::build</text>\n\n  <!-- TIER B: build -->\n  <g>\n    <rect class=\"container\" x=\"30\" y=\"198\" width=\"440\" height=\"156\" rx=\"8\"/>\n    <text class=\"title\" x=\"250\" y=\"220\" text-anchor=\"middle\">Build — Astro (self-contained project)</text>\n    <rect class=\"new\" x=\"48\" y=\"232\" width=\"404\" height=\"42\" rx=\"5\"/>\n    <text class=\"newtext\" x=\"250\" y=\"250\" text-anchor=\"middle\">proposed: atlasGraph — byTag · edges · backlinks</text>\n    <text class=\"newtext\" x=\"250\" y=\"266\" text-anchor=\"middle\" font-size=\"11\">fail-fast on any dead internal link</text>\n    <rect class=\"leaf\" x=\"48\" y=\"280\" width=\"404\" height=\"26\" rx=\"5\"/>\n    <text class=\"leaftext\" x=\"250\" y=\"297\" text-anchor=\"middle\" font-size=\"11\">render &#8594; committed dist/&lt;slug&gt;.html (inlined, relative links)</text>\n    <rect class=\"new\" x=\"48\" y=\"310\" width=\"404\" height=\"26\" rx=\"5\"/>\n    <text class=\"newtext\" x=\"250\" y=\"327\" text-anchor=\"middle\">proposed: + Pagefind static search index</text>\n    <text class=\"muted\" x=\"250\" y=\"348\" text-anchor=\"middle\">ci::atlas-sync — rebuild must match committed bytes</text>\n  </g>\n\n  <!-- edge B -> two surfaces -->\n  <path class=\"edge\" d=\"M250 354 L250 372\"/>\n  <path class=\"edge\" d=\"M135 372 L365 372\"/>\n  <path class=\"edge\" d=\"M135 372 L135 388\" marker-end=\"url(#arrow)\"/>\n  <path class=\"edge\" d=\"M365 372 L365 388\" marker-end=\"url(#arrow)\"/>\n  <text class=\"edgelabel\" x=\"258\" y=\"367\" text-anchor=\"start\">two surfaces · one build</text>\n\n  <!-- TIER C: surfaces -->\n  <g>\n    <rect class=\"host\" x=\"30\" y=\"388\" width=\"210\" height=\"62\" rx=\"8\"/>\n    <text class=\"title\" x=\"135\" y=\"412\" text-anchor=\"middle\" font-size=\"13\">Kolu Code tab</text>\n    <text class=\"leaftext\" x=\"135\" y=\"432\" text-anchor=\"middle\" font-size=\"11\">local · offline · no server</text>\n    <rect class=\"host\" x=\"260\" y=\"388\" width=\"210\" height=\"62\" rx=\"8\"/>\n    <text class=\"title\" x=\"365\" y=\"410\" text-anchor=\"middle\" font-size=\"13\">kolu.dev/atlas/</text>\n    <text class=\"leaftext\" x=\"365\" y=\"427\" text-anchor=\"middle\" font-size=\"11\">public mirror</text>\n    <text class=\"newtext\" x=\"365\" y=\"442\" text-anchor=\"middle\" font-size=\"10.5\">+ public:true gate (proposed)</text>\n  </g>\n\n  <!-- edge C -> D (future) -->\n  <path class=\"fedge\" d=\"M250 450 L250 478\" marker-end=\"url(#arrow)\"/>\n  <text class=\"muted\" x=\"258\" y=\"468\" text-anchor=\"start\">later — only when a 2nd repo exists</text>\n\n  <!-- TIER D: federation (future) -->\n  <g>\n    <rect class=\"future\" x=\"30\" y=\"478\" width=\"440\" height=\"122\" rx=\"8\"/>\n    <text class=\"title\" x=\"250\" y=\"500\" text-anchor=\"middle\">Later — scale to many projects</text>\n    <rect class=\"leaf\" x=\"48\" y=\"510\" width=\"404\" height=\"30\" rx=\"5\"/>\n    <text class=\"leaftext\" x=\"250\" y=\"529\" text-anchor=\"middle\" font-size=\"11\">Option A: + project field + slug prefix — one repo, no new machinery</text>\n    <rect class=\"leaf\" x=\"48\" y=\"546\" width=\"404\" height=\"44\" rx=\"5\"/>\n    <text class=\"leaftext\" x=\"250\" y=\"564\" text-anchor=\"middle\" font-size=\"11\">Option C: aggregator folds per-repo dist (Astro Content Layer)</text>\n    <text class=\"leaftext\" x=\"250\" y=\"580\" text-anchor=\"middle\" font-size=\"10.5\">&#8594; kolu.dev/atlas/&lt;project&gt;/&lt;slug&gt; · Pagefind catalog · Git-perm ACL</text>\n  </g>\n\n  <!-- detached: Artifacts = different job, NO arrow into the pipeline -->\n  <g>\n    <rect class=\"alt\" x=\"520\" y=\"40\" width=\"220\" height=\"150\" rx=\"8\"/>\n    <text class=\"alttitle\" x=\"630\" y=\"66\" text-anchor=\"middle\">Claude Artifacts</text>\n    <text class=\"alttext\" x=\"630\" y=\"92\" text-anchor=\"middle\">cloud single page (claude.ai)</text>\n    <text class=\"alttext\" x=\"630\" y=\"114\" text-anchor=\"middle\">governed · org-auth · versioned</text>\n    <text class=\"alttext\" x=\"630\" y=\"136\" text-anchor=\"middle\">capture-of-work — not a corpus</text>\n    <text class=\"muted\" x=\"630\" y=\"164\" text-anchor=\"middle\">&#8800; Atlas — different job,</text>\n    <text class=\"muted\" x=\"630\" y=\"179\" text-anchor=\"middle\">no shared pipeline</text>\n  </g>\n</svg>\n";
//#endregion
//#region src/content/atlas/meta.mdx
var Spark = (props) => createVNode("span", {
	style: {
		fontFamily: "var(--mono)",
		fontSize: "0.85em",
		color: "#5a3ff0",
		background: "#efebff",
		border: "1px solid #d4cbff",
		borderRadius: "5px",
		padding: "0.04em 0.4em"
	},
	children: props.children
});
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		blockquote: "blockquote",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
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
		tr: "tr",
		ul: "ul"
	}, props.components);
	const { Fragment: Fragment$1 } = _components;
	if (!Fragment$1) _missingMdxReference("Fragment", true);
	return createVNode(Fragment, { children: [
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "This is the Atlas’s note about itself" }),
				" — authored as MDX, living ",
				createVNode(_components.em, { children: "in" }),
				" the\nAtlas it describes (",
				createVNode(_components.code, { children: "docs/atlas/" }),
				"), rendered to a self-contained\n",
				createVNode(_components.code, { children: "docs/atlas/dist/meta.html" }),
				" you read in the Code tab. No dev server. It covers\nthe whole thing in one place: ",
				createVNode(_components.strong, { children: "what" }),
				" the Atlas is and the rule for what goes\nin it, ",
				createVNode(_components.strong, { children: "how" }),
				" it’s built, ",
				createVNode(_components.strong, { children: "how it compares" }),
				" to ",
				createVNode(_components.a, {
					href: "https://claude.com/blog/artifacts-in-claude-code",
					children: "Artifacts in Claude\nCode"
				}),
				" (cloud-hosted, governed\npages generated from a session — ",
				createVNode(_components.em, { children: "not" }),
				" a substitute for this), and ",
				createVNode(_components.strong, { children: "the plan" }),
				"\nto scale it without losing what makes it ours."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Svg, {
			svg: meta_pipeline_default,
			caption: "The Atlas is a build pipeline (blue = today, green = proposed): MDX → Astro → committed self-contained HTML, rendered in both Kolu's Code tab and the public mirror. Artifacts (right, detached) shares none of it — a different job by construction."
		}),
		"\n",
		createVNode(_components.h2, {
			id: "what-the-atlas-is",
			children: "What the Atlas is"
		}),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Premise: you already have a second brain — assign roles, don’t build a new\nsystem." }), " kolu’s existing stores:"] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "GitHub Issues" }), " — lightweight, living nodes."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "In-repo docs (the Atlas)" }), " — substantial, structured artifacts."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The blog" }), " — the public stream."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The Code tab" }), " — renders + annotates both."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "The one routing rule decides where a thing goes:" }),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: createVNode(_components.em, { children: "Substantial, structured artifact — or lightweight, transient node?" }) }),
			"\n"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: ["Substantial → an ", createVNode(_components.strong, { children: "Atlas note" })] }),
					"\n",
					createVNode(_components.th, { children: ["Lightweight → a ", createVNode(_components.strong, { children: "GitHub Issue" })] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Proposals, designs, features, analyses, bug investigations, history" }),
					"\n",
					createVNode(_components.td, { children: "Quick bug tickets, tasks, roadmap items, questions" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Maturity is a tag, not a divider" }),
				" — ",
				createVNode(_components.code, { children: "seedling" }),
				" → ",
				createVNode(_components.code, { children: "budding" }),
				" → ",
				createVNode(_components.code, { children: "evergreen" }),
				"; never a location, never a routing axis."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Living ≠ frozen" }), " — a long-lived plan evolves for months and is still an Atlas note, never “frozen”."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The boundary blurs by design" }), " — a concept can hold both a note and an issue."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Extract, don’t sync" }), " — when an issue thread becomes the source of truth, lift its summary into a note."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "The surfaces it sits between:" }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Surface" }),
					"\n",
					createVNode(_components.th, { children: "Where" }),
					"\n",
					createVNode(_components.th, { children: "Role" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Public" }) }),
					"\n",
					createVNode(_components.td, { children: "the blog (kolu.dev) + per-release changelog" }),
					"\n",
					createVNode(_components.td, { children: "outward-facing; one post per release" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Atlas" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "docs/atlas/" }),
						" → ",
						createVNode(_components.code, { children: "docs/atlas/dist/" })
					] }),
					"\n",
					createVNode(_components.td, { children: "the working brain; markdown/MDX notes, internal-first" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "History isn’t a third place" }),
			" — it’s the Atlas over time: a settled note is just\n",
			createVNode(_components.code, { children: "evergreen" }),
			", git is the history, the changelog is the release artifact."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "how-it-works",
			children: "How it works"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "docs/atlas/" }),
			" is its ",
			createVNode(_components.strong, { children: "own little Astro project" }),
			" — decoupled from the public\n",
			createVNode(_components.code, { children: "website/" }),
			" (different audience + cadence), with its committed ",
			createVNode(_components.code, { children: "dist/" }),
			" folded into\n",
			createVNode(_components.code, { children: "kolu.dev/atlas/" }),
			" at the website’s build."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Author markdown/MDX, get HTML" }),
				" — write ",
				createVNode(_components.code, { children: ".md" }),
				"/",
				createVNode(_components.code, { children: ".mdx" }),
				" + frontmatter; Astro renders."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "One layout + theme" }), " — no per-file CSS (the old HTML notes duplicated ~76 KB)."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Generated graph" }),
				" from frontmatter + ",
				createVNode(_components.code, { children: "parents" }),
				" — categories are ",
				createVNode(_components.code, { children: "moc" }),
				" notes, not a hand-curated map (see ",
				createVNode(_components.em, { children: "Navigation" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Self-contained committed output" }),
				" — each ",
				createVNode(_components.code, { children: "dist/<slug>.html" }),
				" inlines its styles and cross-links with relative hrefs → previews in the Code tab, no server; the same bytes serve the public mirror. Those same committed pages now also ",
				createVNode(_components.strong, { children: "unfurl as a social card" }),
				" on the public mirror — every page emits Open Graph + Twitter Card tags and a favicon, sharing one 1200×630 ",
				createVNode(_components.code, { children: "og.png" }),
				" built around the Atlas ",
				createVNode(_components.strong, { children: "logo" }),
				" (a confident “A” drawn as a tiny knowledge graph: the legs are edges, the terminals are nodes, the amber apex is the north-star hub) (",
				createVNode($$Cite, { file: "docs/atlas/src/layouts/AtlasLayout.astro" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "draft: true" }) }), " hides a half-baked note from the index but keeps it on disk for agents."] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Live since 2026-06-02",
			children: createVNode(_components.p, { children: [
				"Project + index + render route are live; this note builds green; ",
				createVNode(_components.code, { children: "dist/" }),
				" is\ncommitted (generated via ",
				createVNode(_components.code, { children: ".gitattributes" }),
				"), and an ",
				createVNode(_components.code, { children: ".apm" }),
				" rule + the\n",
				createVNode(_components.code, { children: "ci::atlas-sync" }),
				" gate keep it in sync."
			] })
		}),
		"\n",
		createVNode(_components.h3, {
			id: "format--markdown-prose--mdx-components",
			children: "Format — markdown prose + MDX components"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Prose in markdown" }), " — the default."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [createVNode(_components.code, { children: ".mdx" }), " when a note needs more"] }), " — import typed Astro/TS components, use them inline. No raw HTML, no per-note CSS."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Why markdown for prose" }),
					"\n",
					createVNode(_components.th, { children: "Evidence" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Far fewer tokens — paid on every agent read" }),
					"\n",
					createVNode(_components.td, { children: "Cloudflare: ~80% fewer tokens md vs html" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "The CLIs kolu runs prefer it" }),
					"\n",
					createVNode(_components.td, { children: ["Claude Code & OpenCode send ", createVNode(_components.code, { children: "Accept: text/markdown" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Renders where it matters" }),
					"\n",
					createVNode(_components.td, { children: [
						"github.com renders ",
						createVNode(_components.code, { children: ".md" }),
						"; the Code tab renders it (#1093)"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Caveat",
			children: createVNode(_components.p, { children: [
				"Annotating ",
				createVNode(_components.em, { children: "rendered" }),
				" markdown is source-view-only today (",
				createVNode($$PrLink, { pr: 1093 }),
				").\nRegime split: markdown for agent-ingested prose, components for visual or\ninteractive bits."
			] })
		}),
		"\n",
		createVNode(_components.h3, {
			id: "navigation--one-graph-derived-edges",
			children: "Navigation — one graph, derived edges"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "One entry point: a graph, not a tree." }),
				" The Atlas index (",
				createVNode(_components.code, { children: "./index.html" }),
				") is a force-directed graph of every note, laid out at build time and baked to a self-contained SVG. A ",
				createVNode(_components.strong, { children: "category is just a note" }),
				" marked ",
				createVNode(_components.code, { children: "moc: true" }),
				" (Bugs · Features · Analysis · Comparisons · Reference) — there is no ",
				createVNode(_components.code, { children: "kind" }),
				" enum and no synthetic nodes. Every note is filed under an index note through the one edge mechanism, ",
				createVNode(_components.code, { children: "parents" }),
				", so the graph is one connected piece (no orphans) and you add a category by writing another ",
				createVNode(_components.code, { children: "moc" }),
				" note (Comparisons was added exactly that way). A ",
				createVNode(_components.strong, { children: "title search" }),
				" filters the graph live — type a note’s title and the matching nodes stay lit while the rest dim (",
				createVNode($$Cite, { file: "docs/atlas/src/components/ForceGraph.astro" }),
				"), so finding a note doesn’t yet need the full-text index that’s still future work."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "parents" }),
					" + same-directory ",
					createVNode(_components.code, { children: "./slug.html" }),
					" links are the only edges"
				] }),
				" — a note lists one or more ",
				createVNode(_components.code, { children: "parents" }),
				" (its index note and/or topical hubs) and references siblings in prose; both become graph edges and ",
				createVNode(_components.em, { children: "Maps of Content" }),
				" clusters. No adjacency is authored beyond the links a note already has."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Flat, ancestry-free slugs" }),
				" — the filename is a handle, not a path; a note’s connections are metadata (",
				createVNode(_components.code, { children: "parents" }),
				") and prose links, not the filename."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Maps of Content = the index notes." }),
				" Below the graph, each ",
				createVNode(_components.code, { children: "moc" }),
				" note gets a card listing every note filed under it; together they name ",
				createVNode(_components.em, { children: "every" }),
				" note, so the whole Atlas is reachable with no JS. (High-degree ",
				createVNode(_components.strong, { children: "topical" }),
				" notes like ",
				createVNode(_components.code, { children: "electricity" }),
				" are emphasized in the graph itself, but only the index notes get cards.) A ",
				createVNode(_components.code, { children: "maturity" }),
				" dot rides each row; drafts are hidden from the build. A nested ToC (",
				createVNode(_components.code, { children: "<Toc>" }),
				") is auto-inserted from each note’s headings."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Backlinks are derived, never authored" }),
				" — a build pass inverts every note’s ",
				createVNode(_components.code, { children: "./slug.html" }),
				" links + ",
				createVNode(_components.code, { children: "parents" }),
				" into a ",
				createVNode(_components.em, { children: "Referenced by" }),
				" list on each page (the inbound half of the same link graph), reusing the edges the Atlas already has rather than a hand-kept ",
				createVNode(_components.code, { children: "backlinks:" }),
				" field. An internal ",
				createVNode(_components.code, { children: "./slug.html" }),
				" pointing at a missing note ",
				createVNode(_components.strong, { children: "fails the build" }),
				" — a dead note link surfaces at build time, not as a 404 in the committed dist (",
				createVNode($$PrLink, { pr: 1426 }),
				"); general/external link checking still belongs to a generic linter."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "proposals--the-contributor-intake-lane",
			children: "Proposals — the contributor intake lane"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"A proposal is an Atlas note filed under its ",
				createVNode(_components.strong, { children: "real index" }),
				" (",
				createVNode(_components.code, { children: "parents: [feature]" }),
				", ",
				createVNode(_components.code, { children: "[bug]" }),
				", …) carrying ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "status: proposed" }) }),
				" — it shows in that index’s card, flagged ",
				createVNode(_components.em, { children: "proposed" }),
				". There’s no separate proposal category; the status badge ",
				createVNode(_components.em, { children: "is" }),
				" the queue. Contributors open an Atlas PR; the flow lives in ",
				createVNode(_components.code, { children: "CONTRIBUTING.md" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Accepting = a status flip." }),
				" On acceptance a maintainer sets ",
				createVNode(_components.code, { children: "status: accepted" }),
				" (then ",
				createVNode(_components.code, { children: "implemented" }),
				"); the index parent was right from the start, so nothing moves. The note stays ",
				createVNode(_components.strong, { children: "living" }),
				" — git is the record, so there’s no frozen copy and no separate numbered log."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "proposed → accepted → implemented → superseded" }),
				" is a ",
				createVNode(_components.em, { children: "lifecycle" }),
				" (the ",
				createVNode(_components.code, { children: "status" }),
				" field); supersession links via ",
				createVNode(_components.code, { children: "parents" }),
				" + status. No ",
				createVNode(_components.code, { children: "docs/proposals/" }),
				" and no ",
				createVNode(_components.code, { children: "docs/decisions/" }),
				" dir needed."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-component-kit",
			children: "The component kit"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Because a note can be ",
			createVNode(_components.code, { children: ".mdx" }),
			", every component below is a ",
			createVNode(_components.strong, { children: "live import" }),
			" from\n",
			createVNode(_components.code, { children: "docs/atlas/src/components/" }),
			" — rendered here, not screenshotted. Props are\ntypechecked at build."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "inline-chips",
			children: "Inline chips"
		}),
		"\n",
		createVNode(_components.p, { children: "Small typed references for the prose:" }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Component" }),
					"\n",
					createVNode(_components.th, { children: "Live" }),
					"\n",
					createVNode(_components.th, { children: "Usage" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "<PrLink>" }) }), " — GitHub PR, repo baked in"] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1095 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "<PrLink pr={1095} />" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "<Issue>" }) }), " — GitHub issue"] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 951 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "<Issue n={951} />" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "<Commit>" }) }), " — short sha → commit"] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Commit, { sha: "7ec2566a" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "<Commit sha=\"7ec2566a\" />" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: createVNode(_components.code, { children: "<Cite>" }) }),
						" — a linked ",
						createVNode(_components.code, { children: "file:line" })
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Cite, {
						file: "docs/atlas/astro.config.mjs",
						lines: "14-19"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "<Cite file=\"…\" lines=\"14-19\" />" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "<Kbd>" }) }), " — a keyboard chord"] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Kbd, { keys: "Ctrl+B" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "<Kbd keys=\"Ctrl+B\" />" }) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "block-components",
			children: "Block components"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "<Callout>" }) }),
			" — a typed box with markdown inside. ",
			createVNode(_components.code, { children: "kind" }),
			": ",
			createVNode(_components.code, { children: "note · accent · good · warn · danger" }),
			". Usage: ",
			createVNode(_components.code, { children: "<Callout kind=\"warn\" title=\"…\">body</Callout>" }),
			"."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Example callout",
			children: createVNode(_components.p, { children: [
				"Markdown ",
				createVNode(_components.strong, { children: "works" }),
				" in here — including chips like ",
				createVNode($$PrLink, { pr: 1093 }),
				"."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "<Terminal>" }) }),
			" — a faux transcript. Usage:\n",
			createVNode(_components.code, { children: "<Terminal title=\"…\" lines={[\"$ cmd\", \"output\"]} />" }),
			"; in ",
			createVNode(_components.code, { children: "lines" }),
			", ",
			createVNode(_components.code, { children: "$ " }),
			" is a\nprompt + command, ",
			createVNode(_components.code, { children: "# " }),
			" a comment, anything else is output."
		] }),
		"\n",
		createVNode($$Terminal, {
			title: "kolu — just atlas::build",
			lines: [
				"$ just atlas::build",
				"✓ Completed in 1.59s.",
				"# self-contained dist/ previews in the Code tab"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "<Svg>" }),
				" + ",
				createVNode(_components.code, { children: "<D2>" })
			] }),
			" — an architecture diagram, inlined as self-contained SVG:\nhand-author the SVG (",
			createVNode(_components.code, { children: "<Svg svg={…} />" }),
			", the pipeline above) for full visual\ncontrol, or let ",
			createVNode(_components.code, { children: "<D2>" }),
			" lay one out from a graph DSL. ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "<AtlasMockup>" }) }),
			" — a\none-off, self-contained HTML + inline-SVG prototype, for when a note needs\nsomething markdown can’t draw:"
		] }),
		"\n",
		createVNode($$AtlasMockup, {}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "<Toc>" }) }),
			" — a nested, auto-inserted table of contents (the ",
			createVNode(_components.strong, { children: "Contents" }),
			" box at\nthe top), built from the note’s headings; notes never import it. ",
			createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "<Roadmap>" }),
				" +\n",
				createVNode(_components.code, { children: "<Milestone>" })
			] }),
			" — a status-marked roadmap (done ✓ · now ▸ · next ○); see\n",
			createVNode(_components.a, {
				href: "#the-roadmap",
				children: "The roadmap"
			}),
			" below for the live one."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "bring-your-own-component",
			children: "Bring your own component"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A note isn’t limited to the shared kit — but a note-local component lives ",
			createVNode(_components.strong, { children: [
				"in the\n",
				createVNode(_components.code, { children: ".mdx" }),
				" itself"
			] }),
			", never as a separate file (it keeps the note self-contained;\n",
			createVNode(_components.code, { children: "src/components/" }),
			" is reserved for components reused ",
			createVNode(_components.em, { children: "across" }),
			" notes). Two ways:"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["Inline ", createVNode(_components.code, { children: "export const" })] }),
				" at the top of the ",
				createVNode(_components.code, { children: ".mdx" }),
				". Defined here as ",
				createVNode(_components.code, { children: "Spark" }),
				", used live: ",
				createVNode(Spark, { children: "inline" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Raw inline markup" }),
				" — for a true one-off, drop JSX inline with no named component: ",
				createVNode("span", {
					style: {
						fontFamily: "ui-monospace, monospace",
						fontSize: "0.8em",
						border: "1px dashed var(--rule)",
						borderRadius: "5px",
						padding: "0.05em 0.4em",
						color: "var(--ink-dim)"
					},
					children: "raw inline JSX"
				}),
				"."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Promotion path:" }),
			" inline → shared kit, once a component proves reused (and earns\nscoped styles + typed props as a real ",
			createVNode(_components.code, { children: ".astro" }),
			")."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "two-jobs-not-substitutes",
			children: "Two jobs, not substitutes"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"With ",
			createVNode(_components.a, {
				href: "https://claude.com/blog/artifacts-in-claude-code",
				children: "Artifacts in Claude Code"
			}),
			"\nshipped, the obvious question is whether it replaces the Atlas. It doesn’t — the\nclean tell is the ",
			createVNode(_components.strong, { children: "unit each optimizes" }),
			". The Atlas optimizes the ",
			createVNode(_components.strong, { children: "corpus" }),
			" — a\nnavigable, ever-living tree of interlinked notes an agent treats as durable\nmemory, reviewed through the same PR/diff machinery as code. Artifacts optimize\nthe ",
			createVNode(_components.strong, { children: "single page" }),
			" — one session’s investigation handed as a governed,\nlink-shareable snapshot to a teammate (often a non-engineer), deliberately ",
			createVNode(_components.em, { children: "not" }),
			" a\nsearchable library."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Axis" }),
					"\n",
					createVNode(_components.th, { children: "kolu Atlas" }),
					"\n",
					createVNode(_components.th, { children: "Claude Code Artifacts" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Locality" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Source ",
						createVNode(_components.strong, { children: "and" }),
						" built ",
						createVNode(_components.code, { children: "dist/<slug>.html" }),
						" live in Git. No server, no account, no vendor to read a note."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Cloud-only on Anthropic infra at a private ",
						createVNode(_components.code, { children: "claude.ai/code/artifact/<uuid>" }),
						" URL. No self-host (cannot be forked)."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Format / agent cost" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Authored as markdown/MDX; structure from a typed kit. The ",
						createVNode(_components.em, { children: "source" }),
						" is what agents re-read — markdown token rates, the format CLIs prefer."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Generated styled HTML; Anthropic’s own docs note it’s ",
						createVNode(_components.em, { children: "more" }),
						" token-intensive to re-ingest at scale."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Render surface" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Two from one build: Kolu’s ",
						createVNode(_components.strong, { children: "Code tab" }),
						" (local, offline) and ",
						createVNode(_components.strong, { children: "kolu.dev/atlas/" }),
						"."
					] }),
					"\n",
					createVNode(_components.td, { children: "One: the claude.ai viewer behind org auth. No in-IDE embed, no public URL." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Organization" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"A graph over the notes + their ",
						createVNode(_components.code, { children: "parents" }),
						"; categories are ",
						createVNode(_components.code, { children: "moc" }),
						" notes, backlinks derived. No full-text search ",
						createVNode(_components.em, { children: "yet" }),
						"."
					] }),
					"\n",
					createVNode(_components.td, { children: "Flat single-author gallery, opaque UUID keys; “a capture of work, not an application.”" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Versioning" }) }),
					"\n",
					createVNode(_components.td, { children: "Git is the history — full blame/diff/PR review." }),
					"\n",
					createVNode(_components.td, { children: [
						"First-class in-product versions at one URL + restore; but no diff/blame, and a stray session silently ",
						createVNode(_components.em, { children: "forks" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Access control" }) }),
					"\n",
					createVNode(_components.td, { children: "None at note level — internal repo + a public mirror." }),
					"\n",
					createVNode(_components.td, { children: "Compliance-grade: private-by-default, org-auth only, never public; audit + retention + Compliance API." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Discovery at scale" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Deterministic tree at ~50 notes; ",
						createVNode(_components.strong, { children: "no full-text search UI" }),
						"."
					] }),
					"\n",
					createVNode(_components.td, { children: "Weak by design — flat galleries, no search/folders." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Audience" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Internal engineering ",
						createVNode(_components.strong, { children: "+ the agents themselves" }),
						"."
					] }),
					"\n",
					createVNode(_components.td, { children: "Cross-role org — explicitly legal, security, SRE, management." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Cost / gating" }) }),
					"\n",
					createVNode(_components.td, { children: "Free, ungated, vendor-independent." }),
					"\n",
					createVNode(_components.td, { children: [
						"Beta, Team/Enterprise only; interactive ",
						createVNode(_components.code, { children: "claude.ai" }),
						" login; extra tokens per generate."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Longevity" }) }),
					"\n",
					createVNode(_components.td, { children: "Durable, portable, offline, CI-checked. You own it forever." }),
					"\n",
					createVNode(_components.td, { children: "Vendor-bound; a retention policy auto-deletes; export the HTML to survive." }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Where the Atlas genuinely wins:" }),
			" it renders locally in Kolu with zero network;\nmarkdown/MDX is the cheapest thing an agent can re-read (~80% fewer tokens than\nHTML — Cloudflare’s figure, see ",
			createVNode(_components.em, { children: "Format" }),
			" above; it’s the format CLIs request); Git\n",
			createVNode(_components.em, { children: "is" }),
			" the history; and it’s graph-able by construction, because note-to-note edges\nalready exist as plain ",
			createVNode(_components.code, { children: "./slug.html" }),
			" links. ",
			createVNode(_components.strong, { children: "Where Artifacts win, decisively:" }),
			"\nenterprise governance, cross-role reach to people who will never open the repo,\nzero-build cloud sharing, and in-product version restore for non-git users."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Not either/or",
			children: createVNode(_components.p, { children: [
				"Kolu’s Code tab is already a real browser (",
				createVNode(_components.code, { children: "packages/solid-browser" }),
				") — it can open\nan Artifact URL today. The strongest move isn’t to compete: it’s to ",
				createVNode(_components.strong, { children: "render\nArtifacts alongside the Atlas" }),
				" (the governed snapshot you DM to legal once) and,\nlater, a sanctioned path to distill an exported Artifact ",
				createVNode(_components.em, { children: "into" }),
				" a permanent Atlas\nnote. Atlas = durable memory; Artifacts = the disposable, audited page."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "scaling-the-atlas",
			children: "Scaling the Atlas"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The worry is that the Atlas won’t survive going from one repo / ~50 notes to many\nprojects. It’s real, but mostly ",
			createVNode(_components.em, { children: "contingent" }),
			" — and the cheap within-repo wins come\nfirst."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "what-breaks-at-multi-project-scale",
			children: "What breaks at multi-project scale"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Ranked by real bite. The first cluster is critical ",
			createVNode(_components.em, { children: "only" }),
			" under a multi-team /\nseparate-repo / confidential-project future the repo hasn’t actually adopted; the\nsecond bites ",
			createVNode(_components.strong, { children: "even a single growing repo" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Contingent on going multi-repo / multi-team:" }) }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Flat slug = filename = URL." }),
				" Two projects’ ",
				createVNode(_components.code, { children: "release-workflow.mdx" }),
				" collide. Within one repo it’s a prefix convention, not a wall."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "No project axis" }),
				" (",
				createVNode($$Cite, { file: "docs/atlas/src/content.config.ts" }),
				") — project A’s and B’s bugs file under the same ",
				createVNode(_components.code, { children: "bug" }),
				" index and interleave."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Relative cross-links are load-bearing" }),
				" for ",
				createVNode(_components.em, { children: "both" }),
				" render targets (the Code-tab iframe and the ",
				createVNode(_components.code, { children: "cp -r dist" }),
				" in ",
				createVNode($$Cite, { file: "website/default.nix" }),
				"). A note in another repo isn’t a sibling file, so ",
				createVNode(_components.code, { children: "./other.html" }),
				" 404s — the sharpest real constraint on any federation, and the reason not to build it speculatively."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "No access control + unconditional public mirror." }),
				" ",
				createVNode($$Cite, { file: "website/default.nix" }),
				" folds ",
				createVNode(_components.strong, { children: "all" }),
				" of ",
				createVNode(_components.code, { children: "dist/" }),
				" into ",
				createVNode(_components.code, { children: "/atlas/" }),
				" on merge; ",
				createVNode(_components.code, { children: "draft:true" }),
				" only hides from the ",
				createVNode(_components.em, { children: "index" }),
				" (it still builds and publishes). Public-by-merge is the intended contract today — and a breach the moment a confidential project lands."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Bites even a single growing repo:" }) }),
		"\n",
		createVNode(_components.ol, {
			start: "5",
			children: [
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: [
						"Committed ",
						createVNode(_components.code, { children: "dist/" }),
						" churn"
					] }),
					" — ~71 KB of minified HTML per note; every edit re-emits the whole file, and ",
					createVNode(_components.code, { children: "ci::atlas-sync" }),
					" does a full build + a scrambled-TZ idempotency build, so CI cost scales with note count. ",
					createVNode(_components.em, { children: "This argues against inlining a heavy graph into every page." })
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "No full-text search UI" }),
					" — the graph + hub cards ",
					createVNode(_components.em, { children: "are" }),
					" the browse at ~50 notes; at a few hundred there’s no escape hatch."
				] }),
				"\n",
				createVNode(_components.li, { children: [createVNode(_components.strong, { children: "One generated entry page" }), ", no pagination — the index cards (every note listed) become an unscrollable wall at 500+."] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "The force graph turns into a hairball" }),
					" past a few hundred nodes (",
					createVNode($$Cite, { file: "docs/atlas/src/lib/graphView.ts" }),
					") — it stops being ",
					createVNode(_components.em, { children: "legible" }),
					" long before it stops building; it needs filtering / focus-by-hub / an orphan view (the graph’s own roadmap)."
				] }),
				"\n"
			]
		}),
		"\n",
		createVNode(_components.h3, {
			id: "fixing-the-treegraph",
			children: "Fixing the tree/graph"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The index notes are a lifecycle/type axis, not a topic — non-monotonic (a\n",
			createVNode(_components.code, { children: "feature" }),
			" becomes ",
			createVNode(_components.code, { children: "reference" }),
			"), so a note’s index parent changes on a lifecycle\nflip while the ",
			createVNode(_components.em, { children: "stable" }),
			" thing (topic) isn’t an axis at all.\nRight-sized redesign, by leverage-per-line:"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Derive backlinks from the existing link mechanism — shipped first" }),
				" (",
				createVNode($$PrLink, { pr: 1426 }),
				"). Edges already exist as ",
				createVNode(_components.code, { children: "./slug.html" }),
				" links; a build pass inverts them, no new wikilink syntax, and a link to a non-existent slug is a ",
				createVNode(_components.strong, { children: "fail-fast build error" }),
				". The note→note graph is ",
				createVNode(_components.strong, { children: "sparse on its own" }),
				" (most edges cluster on a few hubs like ",
				createVNode(_components.code, { children: "electricity" }),
				" and ",
				createVNode(_components.code, { children: "odu" }),
				") — so the graph view promotes the four categories to real ",
				createVNode(_components.code, { children: "moc" }),
				" notes that every note files under via ",
				createVNode(_components.code, { children: "parents" }),
				", which both densifies the graph and removes every orphan."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Add optional ",
					createVNode(_components.code, { children: "tags" }),
					", not a required ",
					createVNode(_components.code, { children: "area" }),
					"."
				] }),
				" A required topic axis forces a backward-incompatible migration of every note and imposes single-membership where the need is many-to-many. One optional field keeps “nothing unfiled” intact and adds the topic lens for free:",
				"\n",
				createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// src/content.config.ts — add ONE optional field; no migration, no index inversion</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">tags</span><span style=\"color:#24292E\">: z.</span><span style=\"color:#6F42C1\">array</span><span style=\"color:#24292E\">(z.</span><span style=\"color:#6F42C1\">string</span><span style=\"color:#24292E\">()).</span><span style=\"color:#6F42C1\">default</span><span style=\"color:#24292E\">([]),   </span><span style=\"color:#6A737D\">// many-to-many facets; derive a tag → notes map</span></span></code></pre>" }),
				"\n"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Generalize typed relations with auto-inverses." }),
				" ",
				createVNode(_components.code, { children: "parents" }),
				" → ",
				createVNode(_components.em, { children: "has-children" }),
				", ",
				createVNode(_components.code, { children: "supersedes" }),
				" → ",
				createVNode(_components.em, { children: "superseded-by" }),
				", any link → ",
				createVNode(_components.em, { children: "referenced-by" }),
				". Keep the vocabulary tiny. ",
				createVNode(_components.code, { children: "status: superseded" }),
				" is a dangling flag today; ",
				createVNode(_components.code, { children: "supersedes: <slug>" }),
				" makes the lineage a real bidirectional edge."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Graph view + Maps of Content — now shipped" }),
				" (",
				createVNode($$PrLink, { pr: 1434 }),
				"). The trap was inlining a JS graph + ",
				createVNode(_components.code, { children: "graph.json" }),
				" into ",
				createVNode(_components.em, { children: "every" }),
				" committed page (multiplying the ",
				createVNode(_components.code, { children: "dist/" }),
				" churn) and trusting the Code tab to run it. The resolution: compute the layout at build time with ",
				createVNode(_components.code, { children: "d3-force" }),
				" and bake it to ",
				createVNode(_components.strong, { children: "one" }),
				" self-contained SVG on the index page only, with a single ",
				createVNode(_components.code, { children: "is:inline" }),
				" script for interaction (no bundle). The decomplected data model came with it — a category is no longer a hardcoded ",
				createVNode(_components.code, { children: "kind" }),
				" enum but a real note marked ",
				createVNode(_components.code, { children: "moc: true" }),
				", and every note files under one through ",
				createVNode(_components.code, { children: "parents" }),
				", the single edge mechanism."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "scaling-to-many-projects",
			children: "Scaling to many projects"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Chosen path: Option A now, Option C later — not the aggregator up front." }),
			" There\nis no second repo, no confidential project, no cross-role audience today. Standing\nup an aggregator + search-catalog + resolver now is textbook Backstage-cargo-culting\nfor a small team — a direct violation of the ",
			createVNode(_components.a, {
				href: "./electricity.html",
				children: "fail-fast / no-premature-abstraction\nphilosophy"
			}),
			"."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Now, if a second project lands ",
					createVNode(_components.em, { children: "inside" }),
					" the monorepo — Option A:"
				] }),
				" one optional ",
				createVNode(_components.code, { children: "project" }),
				" field (defaulted from the repo, not authored per-note) + a slug-prefix convention in the ",
				createVNode(_components.em, { children: "existing" }),
				" single Atlas. Zero new machinery; intra-repo siblings still cross-link relatively; one scope, one cadence."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Later, only when a ",
					createVNode(_components.em, { children: "separate" }),
					" repo exists — Option C:"
				] }),
				" namespacing happens ",
				createVNode(_components.em, { children: "only at aggregation" }),
				" — a loader prefixes ids (",
				createVNode(_components.code, { children: "kolu/electricity" }),
				" vs ",
				createVNode(_components.code, { children: "infra/electricity" }),
				"), the federated URL becomes ",
				createVNode(_components.code, { children: "kolu.dev/atlas/<project>/<slug>" }),
				", search is ",
				createVNode(_components.strong, { children: "Pagefind" }),
				" (Rust-built static index, byte-deterministic), and access control ",
				createVNode(_components.strong, { children: "reuses Git permissions" }),
				" (who can clone = who can read) plus a per-repo ",
				createVNode(_components.code, { children: "public:true" }),
				" allowlist. Decide the aggregator’s ",
				createVNode(_components.strong, { children: "owner and operating cost" }),
				" before building it — federated content doesn’t auto-rebuild, so it adds a webhook/cron and a stale-catalog window the single repo never had."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "danger",
			title: "Cut outright, regardless of timing",
			children: createVNode(_components.p, { children: [
				"A “resolve to the last-published version when the target repo is absent”\nlink-resolver is a ",
				createVNode(_components.strong, { children: "fail-fast violation" }),
				" — exactly the silent\ngraceful-degradation the philosophy forbids (“being able to override is never a\nfeature”). If cross-repo links are ever needed, the fail-fast form is: a build\n",
				createVNode(_components.strong, { children: "error" }),
				" unless the target is present in the build — never a stale pointer."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"Is federated aggregation a ",
				createVNode(_components.code, { children: "@kolu/*" }),
				" package?"
			] }),
			" No. It fails all three\n",
			createVNode(_components.a, {
				href: "./electricity.html",
				children: "electricity"
			}),
			" tests: it isn’t domain-agnostic (it aggregates\nthe Atlas domain itself), it hides no ",
			createVNode(_components.em, { children: "hard" }),
			" volatility (",
			createVNode(_components.code, { children: "git clone" }),
			" +\n",
			createVNode(_components.code, { children: "getCollection()" }),
			" + ",
			createVNode(_components.code, { children: "pagefind" }),
			" is a bounded build-time pipeline; Astro’s Content\nLayer is already the receptacle), and no foreign app graduates onto it. It’s a\n",
			createVNode(_components.strong, { children: "leaf-tier Astro extension" }),
			" — and, by the same logic, so is the component kit:\nprefer vendoring it per-repo over extracting ",
			createVNode(_components.code, { children: "@kolu/atlas-kit" }),
			"."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-roadmap",
			children: "The roadmap"
		}),
		"\n",
		createVNode(_components.p, { children: "Where it’s been and where it’s going — smallest-valuable-first; each forward step\nships independently and keeps the Atlas working at every stage." }),
		"\n",
		createVNode($$Roadmap, { children: [
			createVNode($$Milestone, {
				status: "done",
				label: "Shipped",
				children: [
					"original plans + MOC + house style + the ",
					createVNode(_components.code, { children: "docs/**" }),
					" agent rule (",
					createVNode($$PrLink, { pr: 1095 }),
					"); the ",
					createVNode(_components.code, { children: "docs-moc" }),
					" gate + ",
					createVNode(_components.code, { children: "plans::check" }),
					" module (",
					createVNode($$PrLink, { pr: 1098 }),
					")."
				]
			}),
			createVNode($$Milestone, {
				status: "done",
				label: "Done",
				children: [
					"the Atlas as a self-contained ",
					createVNode(_components.code, { children: "docs/atlas/" }),
					" project — generated index, render route, committed HTML, ",
					createVNode(_components.code, { children: ".apm" }),
					" rule + ",
					createVNode(_components.code, { children: "ci::atlas-sync" }),
					" gate, and the MDX component kit. First migrated note; the original ",
					createVNode(_components.code, { children: "release-workflow" }),
					" plan re-created as the release-runbook note (",
					createVNode($$PrLink, { pr: 1208 }),
					")."
				]
			}),
			createVNode($$Milestone, {
				status: "done",
				label: "Done",
				children: [
					"the remaining ",
					createVNode(_components.code, { children: "docs/plans/*.html" }),
					" migrated to Atlas notes; ",
					createVNode(_components.code, { children: "docs/plans/" }),
					" retired; the ",
					createVNode(_components.code, { children: "/atlas" }),
					" skill shipped."
				]
			}),
			createVNode($$Milestone, {
				status: "done",
				label: "Done",
				children: [
					"derived backlinks + the fail-fast dead-link gate (",
					createVNode($$PrLink, { pr: 1426 }),
					") — render “Referenced by” from the existing ",
					createVNode(_components.code, { children: "./slug.html" }),
					" + ",
					createVNode(_components.code, { children: "parents" }),
					" edges."
				]
			}),
			createVNode($$Milestone, {
				status: "now",
				label: "Publication gate",
				children: [
					createVNode(_components.strong, { children: "Confidentiality — a correctness bug, not a feature." }),
					" Merge-to-master is public today (",
					createVNode($$Cite, { file: "website/default.nix" }),
					" copies ",
					createVNode(_components.em, { children: "all" }),
					" of ",
					createVNode(_components.code, { children: "dist/" }),
					"; ",
					createVNode(_components.code, { children: "draft" }),
					" only hides from the index). Add a per-note opt-",
					createVNode(_components.strong, { children: "in" }),
					" allowlist (fail-fast: nothing public unless it declares ",
					createVNode(_components.code, { children: "public: true" }),
					") and gate the Nix copy on it. Pure config + Nix; no schema rework. Unblocks a confidential note — or a second team — ever landing."
				]
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "tags + in-repo search",
				children: [
					"Add optional ",
					createVNode(_components.code, { children: "tags: string[]" }),
					" (no migration) and a ",
					createVNode(_components.strong, { children: "Pagefind" }),
					" index shipped ",
					createVNode(_components.em, { children: "into" }),
					" the committed ",
					createVNode(_components.code, { children: "dist/" }),
					" so search works in both the Code tab and the public mirror. Trigger it when note count nears the few-hundred where index-as-search breaks — not at 50."
				]
			}),
			createVNode($$Milestone, {
				status: "done",
				label: "Graph view + MoC hubs",
				children: [
					"Shipped as the unified entry point (",
					createVNode($$PrLink, { pr: 1434 }),
					") — a build-time ",
					createVNode(_components.code, { children: "d3-force" }),
					" layout baked to one self-contained SVG. The data model is decomplected: a category is a real note marked ",
					createVNode(_components.code, { children: "moc: true" }),
					" (no ",
					createVNode(_components.code, { children: "kind" }),
					" enum, no synthetic nodes), and every note files under one via ",
					createVNode(_components.code, { children: "parents" }),
					", so nothing is unfiled and the graph has no orphans. The index ",
					createVNode(_components.em, { children: "is" }),
					" the graph + Maps of Content; baking the layout settles the Code-tab JS question, leaving a single ",
					createVNode(_components.code, { children: "is:inline" }),
					" script and no bundle."
				]
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "Federation A → C",
				children: [
					"Option A (one ",
					createVNode(_components.code, { children: "project" }),
					" field + slug prefix) the moment a second project shares the monorepo; the Option C aggregator only when a ",
					createVNode(_components.em, { children: "separate" }),
					" repo appears, and only after its owner + cost are decided. ",
					createVNode(_components.strong, { children: "Never" }),
					" the stale-fallback resolver."
				]
			})
		] }),
		"\n",
		createVNode(_components.p, { children: "Define success up front so “won’t scale” becomes answerable: time-to-find a note,\n% reachable in ≤2 hops, agent token cost per corpus re-read (the headline\nadvantage, quantified), CI time per PR as notes grow, and zero confidential leaks." }),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"History: a 2026-06-02 adversarial research pass flipped HTML-all-the-way →\nmarkdown-first; Astro was then chosen for rendering, the Atlas extracted into a\nself-contained ",
			createVNode(_components.code, { children: "docs/atlas/" }),
			" project, and notes moved to MDX with a typed\ncomponent kit. This note is the merge of the original ",
			createVNode(_components.code, { children: "second-brain" }),
			" design\nrationale into the ",
			createVNode(_components.code, { children: "meta" }),
			" comparison + roadmap, so the Atlas’s note about itself\nlives in one place."
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
	"title": "The kolu Atlas",
	"description": "kolu's in-repo second brain — what it is, how it works, how it compares to Claude Code Artifacts, and the plan to scale it.",
	"parents": ["reference"],
	"maturity": "budding",
	"status": "implemented",
	"updated": "2026-06-19T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-the-atlas-is",
			"text": "What the Atlas is"
		},
		{
			"depth": 2,
			"slug": "how-it-works",
			"text": "How it works"
		},
		{
			"depth": 3,
			"slug": "format--markdown-prose--mdx-components",
			"text": "Format — markdown prose + MDX components"
		},
		{
			"depth": 3,
			"slug": "navigation--one-graph-derived-edges",
			"text": "Navigation — one graph, derived edges"
		},
		{
			"depth": 3,
			"slug": "proposals--the-contributor-intake-lane",
			"text": "Proposals — the contributor intake lane"
		},
		{
			"depth": 2,
			"slug": "the-component-kit",
			"text": "The component kit"
		},
		{
			"depth": 3,
			"slug": "inline-chips",
			"text": "Inline chips"
		},
		{
			"depth": 3,
			"slug": "block-components",
			"text": "Block components"
		},
		{
			"depth": 3,
			"slug": "bring-your-own-component",
			"text": "Bring your own component"
		},
		{
			"depth": 2,
			"slug": "two-jobs-not-substitutes",
			"text": "Two jobs, not substitutes"
		},
		{
			"depth": 2,
			"slug": "scaling-the-atlas",
			"text": "Scaling the Atlas"
		},
		{
			"depth": 3,
			"slug": "what-breaks-at-multi-project-scale",
			"text": "What breaks at multi-project scale"
		},
		{
			"depth": 3,
			"slug": "fixing-the-treegraph",
			"text": "Fixing the tree/graph"
		},
		{
			"depth": 3,
			"slug": "scaling-to-many-projects",
			"text": "Scaling to many projects"
		},
		{
			"depth": 2,
			"slug": "the-roadmap",
			"text": "The roadmap"
		}
	];
}
var url = "src/content/atlas/meta.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/meta.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/meta.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, Spark, file, frontmatter, getHeadings, url };
