import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
//#region src/content/atlas/feature.mdx
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
			createVNode(_components.strong, { children: "Features" }),
			" index gathers notes that propose a capability kolu doesn’t have\nyet: the design, the motivation, and enough of a plan to build it. A contributor\nproposal lands here too, carrying ",
			createVNode(_components.code, { children: "status: proposed" }),
			" until a maintainer flips it."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"This note is an ",
			createVNode(_components.em, { children: "index" }),
			" (",
			createVNode(_components.code, { children: "moc: true" }),
			"): a note is filed here by listing ",
			createVNode(_components.code, { children: "feature" }),
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
	"title": "Features",
	"description": "Proposed capabilities — designs for things kolu doesn't do yet, with the reasoning and the plan to build them.",
	"moc": true,
	"color": "teal",
	"order": 2,
	"maturity": "evergreen",
	"updated": "2026-06-19T00:00:00.000Z"
};
function getHeadings() {
	return [];
}
var url = "src/content/atlas/feature.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/feature.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/feature.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
