import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
//#region src/content/atlas/sundry.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		p: "p",
		strong: "strong"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"Most work earns a dedicated Atlas note — a bug with a root cause, a feature with\na design, an analysis with measurements. ",
			createVNode(_components.strong, { children: "Sundry is the holding pen for\neverything too small for that" }),
			": a one-line idea, a chore, a “we should look at\nthis” that would be overkill as its own note. Jot it down here so it isn’t lost,\nand when an item grows a real shape, graduate it to its own note."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-belongs-here",
			children: "What belongs here"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"An item belongs in Sundry when it’s ",
			createVNode(_components.strong, { children: "real work but not yet note-sized" }),
			" — there\nis no design to argue, no root cause to diagnose, no measurement to report. The\nbar is deliberately low: a single row with a ",
			createVNode(_components.em, { children: "what" }),
			" and a ",
			createVNode(_components.em, { children: "goal" }),
			" is enough. The\nmoment an item needs more than that — a diagram, a repro, a plan, a debate — it\nhas outgrown Sundry (see ",
			createVNode(_components.em, { children: "Graduating an item" }),
			")."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "backlog",
			children: "Backlog"
		}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: "No open items." }) }),
		"\n",
		createVNode(_components.p, { children: [
			"The item ",
			createVNode(_components.strong, { children: "Unify the two Dock activity dots" }),
			" graduated to the roadmap as\n",
			createVNode(_components.strong, { children: createVNode(_components.a, {
				href: "./remote-terminals.html#r-activity-merge",
				children: "R-activity-merge"
			}) }),
			" — it grew a real\nshape (a shared nested indicator across the Dock and pulam-web, plus retiring the\ndrifted ",
			createVNode(_components.code, { children: "#7ee787" }),
			" from #1551). The item ",
			createVNode(_components.strong, { children: "Distinguish the active terminal in a\nsplit" }),
			" graduated to its own note — ",
			createVNode(_components.a, {
				href: "./split-active-pane.html",
				children: "Distinguish the Active Terminal in a\nSplit"
			}),
			"."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "overnight-loops",
			children: "Overnight loops"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Items here are ",
			createVNode(_components.strong, { children: "self-contained enough to hand to an autonomous overnight run" }),
			" —\na clear target, a public reference to follow, and a definition of done an agent\ncan check itself against without a human in the loop."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.em, { children: "No open items." }),
			" The ",
			createVNode(_components.strong, { children: "Upgrade to Vite 8.1, repo-wide" }),
			" loop shipped in\n",
			createVNode(_components.a, {
				href: "https://github.com/juspay/kolu/pull/1543",
				children: "#1543"
			}),
			": every Vite-built surface is on\n8.1 (Rolldown/Oxc bundler), all surfaces build, and ",
			createVNode(_components.code, { children: "just dev" }),
			" runs — confirmed\nvia chrome-devtools (kolu loads, connects, creates a working terminal). The\nexperimental ",
			createVNode(_components.strong, { children: [
				"bundled dev mode was evaluated and ",
				createVNode(_components.em, { children: "not" }),
				" adopted"
			] }),
			": on 8.1.0 it\ncrashes kolu’s client with ",
			createVNode(_components.code, { children: "__reExport is not defined" }),
			" so the app never mounts —\na known cluster of ",
			createVNode(_components.code, { children: "bundledDev" }),
			" runtime-ReferenceError bugs upstream\n(",
			createVNode(_components.a, {
				href: "https://github.com/vitejs/vite/issues/22419",
				children: "vite#22419"
			}),
			",\n",
			createVNode(_components.a, {
				href: "https://github.com/vitejs/vite/issues/22012",
				children: "vite#22012"
			}),
			"); revisit when fixed.\nThe build-output experiments (chunk import map, Wasm-as-build) were left off for\n",
			createVNode(_components.code, { children: "nix build" }),
			" reproducibility; the stable features (",
			createVNode(_components.code, { children: "import.meta.glob" }),
			"\n",
			createVNode(_components.code, { children: "caseSensitive" }),
			", Wasm ESM, ",
			createVNode(_components.code, { children: "html.additionalAssetSources" }),
			") had no call sites."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "graduating-an-item",
			children: "Graduating an item"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"When a Sundry item earns a design, a repro, or a plan, it has stopped being\nsundry. Create a real note under its true index (",
			createVNode(_components.code, { children: "parents: [bug]" }),
			", ",
			createVNode(_components.code, { children: "[feature]" }),
			",\n",
			createVNode(_components.code, { children: "[analysis]" }),
			", or ",
			createVNode(_components.code, { children: "[reference]" }),
			"), move the substance there, and ",
			createVNode(_components.strong, { children: "delete the row" }),
			"\nhere — keeping a one-line prose pointer only if the link is worth following.\nSundry should stay short: a long list is a signal that items are being hoarded\ninstead of either done or promoted."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Sundry",
	"description": "A holding pen for small, miscellaneous items to work on that don't (yet) warrant their own Atlas note.",
	"parents": ["feature"],
	"maturity": "seedling",
	"updated": "2026-06-23T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-belongs-here",
			"text": "What belongs here"
		},
		{
			"depth": 2,
			"slug": "backlog",
			"text": "Backlog"
		},
		{
			"depth": 2,
			"slug": "overnight-loops",
			"text": "Overnight loops"
		},
		{
			"depth": 2,
			"slug": "graduating-an-item",
			"text": "Graduating an item"
		}
	];
}
var url = "src/content/atlas/sundry.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/sundry.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/sundry.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
