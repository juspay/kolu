import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
//#region src/content/atlas/reference.mdx
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
			createVNode(_components.strong, { children: "Reference" }),
			" index gathers the durable notes: how a subsystem works, a\ndecision and why it was made, a design that’s been built. These are meant to\noutlast any single change — the thing you read to understand, not to do."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"This note is an ",
			createVNode(_components.em, { children: "index" }),
			" (",
			createVNode(_components.code, { children: "moc: true" }),
			"): a note is filed here by listing\n",
			createVNode(_components.code, { children: "reference" }),
			" in its ",
			createVNode(_components.code, { children: "parents" }),
			". It’s also the default home — a note with no other\nindex lands here. The graph renders it large; its card on the\n",
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
	"title": "Reference",
	"description": "Durable knowledge — designs, decisions, and how things work, meant to stay true as the code moves under it.",
	"moc": true,
	"color": "grey",
	"order": 5,
	"maturity": "evergreen",
	"updated": "2026-06-19T00:00:00.000Z"
};
function getHeadings() {
	return [];
}
var url = "src/content/atlas/reference.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/reference.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/reference.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
