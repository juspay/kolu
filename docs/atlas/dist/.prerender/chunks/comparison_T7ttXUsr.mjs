import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
//#region src/content/atlas/comparison.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		p: "p",
		strong: "strong"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"The ",
			createVNode(_components.strong, { children: "Comparisons" }),
			" index gathers notes that hold an outside thing — another\ntool, a rival design, a whole industry paradigm — up against kolu and ask the\nsame two questions: ",
			createVNode(_components.em, { children: "what should we borrow" }),
			", and ",
			createVNode(_components.em, { children: "where do we deliberately\ndiffer" }),
			". The output is a decision with the evidence attached, not a neutral\nfeature grid: a reference implementation to learn from, a gap to close, a moat\nto defend."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"It’s the outward-looking sibling of ",
			createVNode(_components.a, {
				href: "./analysis.html",
				children: "Analysis"
			}),
			": an Analysis\nlooks ",
			createVNode(_components.em, { children: "inward" }),
			" (how does our own system behave?), a Comparison looks ",
			createVNode(_components.em, { children: "outward" }),
			"\n(how do we stand against this alternative?)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"This note is an ",
			createVNode(_components.em, { children: "index" }),
			" (",
			createVNode(_components.code, { children: "moc: true" }),
			"): a note is filed here by listing\n",
			createVNode(_components.code, { children: "comparison" }),
			" in its ",
			createVNode(_components.code, { children: "parents" }),
			", usually alongside the topical hub it also belongs\nto (e.g. ",
			createVNode(_components.code, { children: "remote-terminals" }),
			"). The graph renders it large; its card on the\n",
			createVNode(_components.a, {
				href: "./index.html",
				children: "Atlas"
			}),
			" lists its cluster."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Comparisons",
	"description": "Studies that hold an outside tool, system, or paradigm up against kolu — what to borrow, where we deliberately differ, and the decision that falls out.",
	"moc": true,
	"color": "purple",
	"order": 4,
	"maturity": "evergreen",
	"updated": "2026-06-24T00:00:00.000Z"
};
function getHeadings() {
	return [];
}
var url = "src/content/atlas/comparison.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/comparison.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/comparison.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
