import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { n as $$Roadmap, t as $$Milestone } from "./Milestone_B0slHbDx.mjs";
//#region src/content/atlas/graph-moc.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		blockquote: "blockquote",
		code: "code",
		em: "em",
		h2: "h2",
		hr: "hr",
		li: "li",
		p: "p",
		strong: "strong",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"The Atlas index ",
				createVNode(_components.em, { children: "is" }),
				" the graph."
			] }),
			" There is ",
			createVNode(_components.a, {
				href: "./index.html",
				children: "one entry point"
			}),
			": a\nforce-directed graph of every note, with a ",
			createVNode(_components.strong, { children: "Maps of Content" }),
			" strip below it. The\ngraph answers ",
			createVNode(_components.em, { children: "“what’s connected to what,”" }),
			" the index notes answer ",
			createVNode(_components.em, { children: "“where do I\nstart,”" }),
			" and together they reach every note — there is no second index to keep in\nsync."
		] }),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [
				"Open the ",
				createVNode(_components.a, {
					href: "./index.html",
					children: "Atlas"
				}),
				". Hover a node to trace its neighborhood, click to\nopen the note, type in the search box to filter by title, drag/scroll to move."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "a-category-is-just-a-note",
			children: "A category is just a note"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The old index had a hardcoded skeleton — a closed ",
			createVNode(_components.code, { children: "kind" }),
			" enum\n(",
			createVNode(_components.code, { children: "bug" }),
			"/",
			createVNode(_components.code, { children: "feature" }),
			"/",
			createVNode(_components.code, { children: "analysis" }),
			"/",
			createVNode(_components.code, { children: "reference" }),
			") baked into the schema, fabricated as\nsynthetic graph nodes, and special-cased in a metadata table. That’s one concept\nsmeared across three places, and it was closed. The graph dissolves it: each\ncategory is now a ",
			createVNode(_components.strong, { children: "real note" }),
			" marked ",
			createVNode(_components.code, { children: "moc: true" }),
			" — ",
			createVNode(_components.a, {
				href: "./bug.html",
				children: "Bugs"
			}),
			",\n",
			createVNode(_components.a, {
				href: "./feature.html",
				children: "Features"
			}),
			", ",
			createVNode(_components.a, {
				href: "./analysis.html",
				children: "Analysis"
			}),
			",\n",
			createVNode(_components.a, {
				href: "./reference.html",
				children: "Reference"
			}),
			" — and a note is filed under one through the ",
			createVNode(_components.strong, { children: "single" }),
			"\nedge mechanism, ",
			createVNode(_components.code, { children: "parents" }),
			". Nothing is synthetic; nothing is complected:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "No enum, no synthetic nodes." }),
				" An index note is a node like any other — it just\nrenders large (a labeled chip in its accent ",
				createVNode(_components.code, { children: "color" }),
				") and seeds its own card.\nWant a fifth category, Terminals or Surfaces? Write a fifth ",
				createVNode(_components.code, { children: "moc" }),
				" note. The set\nis open."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "No orphans, complete by construction." }),
				" Every note carries its index in\n",
				createVNode(_components.code, { children: "parents" }),
				", so it’s connected — the graph is one piece — and it appears in exactly\none index card. The four index cards together name every note, so the whole Atlas\nis reachable with ",
				createVNode(_components.strong, { children: "no JavaScript at all" }),
				"."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"High-degree ",
			createVNode(_components.em, { children: "topical" }),
			" notes (",
			createVNode(_components.code, { children: "electricity" }),
			", ",
			createVNode(_components.code, { children: "solid-fileview" }),
			", ",
			createVNode(_components.code, { children: "pty-daemon" }),
			", …) are\nemphasized as nodes in the graph (always-on labels), but only the explicit ",
			createVNode(_components.code, { children: "moc" }),
			"\nnotes get cards below it."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "it-reuses-the-links-the-atlas-already-has",
			children: "It reuses the links the Atlas already has"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"No special frontmatter for edges. A note’s ",
			createVNode(_components.code, { children: "parents" }),
			" — its index note plus any\ntopical hubs — and its same-directory ",
			createVNode(_components.code, { children: "./slug.html" }),
			" prose links are the ",
			createVNode(_components.em, { children: "only" }),
			"\nedges, derived by the very pass that powers the dead-link gate and the “Referenced\nby” backlinks. A node’s ",
			createVNode(_components.strong, { children: "degree" }),
			" sets its size; an index note’s accent (",
			createVNode(_components.code, { children: "color" }),
			")\ntints the notes filed under it; membership spokes (an edge touching an index note)\nare drawn faint so the topical links stay the legible foreground."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "how-the-page-stays-a-self-contained-file",
			children: "How the page stays a self-contained file"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Each Atlas page is a committed, self-contained HTML file that previews in kolu’s\nCode tab with no dev server, and the build is a pure function of source (the\n",
			createVNode(_components.code, { children: "ci::atlas-sync" }),
			" gate rebuilds under a scrambled timezone/locale and fails on any\ndrift). The graph honors both:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Layout is computed at build time" }),
				" with ",
				createVNode(_components.a, {
					href: "https://github.com/d3/d3-force",
					children: createVNode(_components.code, { children: "d3-force" })
				}),
				"\nand ",
				createVNode(_components.strong, { children: "baked" }),
				" into a static inline ",
				createVNode(_components.code, { children: "<svg>" }),
				" as rounded coordinates. Nothing lays\nout at runtime."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Determinism is engineered in:" }),
				" nodes are sorted by id and edges by pair-key\nbefore the simulation, positions are seeded by that stable index, a fixed number\nof ticks runs synchronously, and every coordinate is rounded. d3-force v3 carries\nno ",
				createVNode(_components.code, { children: "Math.random" }),
				", so the baked geometry is byte-identical on every rebuild."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"The only client JS is one ",
					createVNode(_components.code, { children: "is:inline" }),
					" script"
				] }),
				" for interaction (zoom/pan,\nhover-highlight, title search, click-to-open) — so no ",
				createVNode(_components.code, { children: "_astro" }),
				" bundle is emitted\nand the page stays one file. Nodes are real ",
				createVNode(_components.code, { children: "<a>" }),
				" links and the Maps-of-Content\ncards are plain linked lists, so the page ",
				createVNode(_components.strong, { children: "reads and navigates with JS off" }),
				"."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Why one view, decomplected",
			children: createVNode(_components.p, { children: [
				"A tree and a graph over the same notes are two things to keep in sync, and the\ntree only ever showed a skeleton the graph now expresses as real structure.\nFolding them into one entry point — driven by one data model where a category is\n",
				createVNode(_components.em, { children: "just a note" }),
				" — means a single source of truth drives the picture ",
				createVNode(_components.em, { children: "and" }),
				" the\nbrowsable index, so they can never disagree, and “navigate to any note” is\nguaranteed by construction."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "where-this-could-go",
			children: "Where this could go"
		}),
		"\n",
		createVNode($$Roadmap, { children: [
			createVNode($$Milestone, {
				status: "done",
				label: "decomplect",
				children: [
					"A category is a real ",
					createVNode(_components.code, { children: "moc" }),
					" note filed via ",
					createVNode(_components.code, { children: "parents" }),
					" (no ",
					createVNode(_components.code, { children: "kind" }),
					" enum, no synthetic nodes); graph + Maps of Content as the single index; title search; build-time d3-force baked to a self-contained SVG."
				]
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "1",
				children: "Filter/focus by index or maturity; isolate one index’s cluster in place."
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "2",
				children: "Flag weakly-linked notes (only the index edge) as a “wire these up” nudge."
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "3",
				children: "Deep-link into the graph centered on the note you came from (a “see this in context” link from each note)."
			})
		] }),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: "The index, rethought — one graph over the existing link structure, where a\ncategory is just a note. The link graph is the source of truth; this is the way to\nsee and walk it." }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Graph view + Maps of Content",
	"description": "The Atlas index is one force-directed graph over every note. A category is a real note marked moc:true, every note files under one via parents, and the Maps of Content fall straight out of the links. One entry point, everything reachable.",
	"parents": ["meta", "feature"],
	"maturity": "budding",
	"status": "implemented",
	"updated": "2026-06-19T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "a-category-is-just-a-note",
			"text": "A category is just a note"
		},
		{
			"depth": 2,
			"slug": "it-reuses-the-links-the-atlas-already-has",
			"text": "It reuses the links the Atlas already has"
		},
		{
			"depth": 2,
			"slug": "how-the-page-stays-a-self-contained-file",
			"text": "How the page stays a self-contained file"
		},
		{
			"depth": 2,
			"slug": "where-this-could-go",
			"text": "Where this could go"
		}
	];
}
var url = "src/content/atlas/graph-moc.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/graph-moc.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/graph-moc.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
