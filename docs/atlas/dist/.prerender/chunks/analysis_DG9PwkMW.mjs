import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
//#region src/content/atlas/analysis.mdx
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
			createVNode(_components.strong, { children: "Analysis" }),
			" index gathers notes that investigate how the system behaves:\na measurement, a profiling pass, a root-cause dig that isn’t yet a fix. The\noutput is a conclusion you can act on, with the evidence attached. (A study held\nup ",
			createVNode(_components.em, { children: "against an alternative" }),
			" — what to adopt from another tool or paradigm, where\nwe differ — is a ",
			createVNode(_components.a, {
				href: "./comparison.html",
				children: "Comparison"
			}),
			", not an Analysis.)"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"This note is an ",
			createVNode(_components.em, { children: "index" }),
			" (",
			createVNode(_components.code, { children: "moc: true" }),
			"): a note is filed here by listing ",
			createVNode(_components.code, { children: "analysis" }),
			"\nin its ",
			createVNode(_components.code, { children: "parents" }),
			". The graph renders it large; the notes wired to it are its\ncluster, and its card on the ",
			createVNode(_components.a, {
				href: "./index.html",
				children: "Atlas"
			}),
			" lists them all."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Analysis",
	"description": "Investigations into how the system actually behaves — measurements, profiling, root-cause digs, and the conclusions they support.",
	"moc": true,
	"color": "gold",
	"order": 3,
	"maturity": "evergreen",
	"updated": "2026-06-19T00:00:00.000Z"
};
function getHeadings() {
	return [];
}
var url = "src/content/atlas/analysis.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/analysis.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/analysis.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
