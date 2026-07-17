import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
//#region src/content/atlas/bug.mdx
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
			createVNode(_components.strong, { children: "Bugs" }),
			" index gathers notes that diagnose a real defect and point at its\nfix. A bug note names the broken behavior, the root cause once it’s understood,\nand the direction of the repair — the reasoning, not a tracker ticket."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"This note is an ",
			createVNode(_components.em, { children: "index" }),
			" (",
			createVNode(_components.code, { children: "moc: true" }),
			"): a note is filed here by listing ",
			createVNode(_components.code, { children: "bug" }),
			" in\nits ",
			createVNode(_components.code, { children: "parents" }),
			". The graph renders it large; the notes wired to it are its cluster,\nand its card on the ",
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
	"title": "Bugs",
	"description": "Diagnosed defects and their fix direction — what's broken, the root cause, and the shape of the repair.",
	"moc": true,
	"color": "red",
	"order": 1,
	"maturity": "evergreen",
	"updated": "2026-06-19T00:00:00.000Z"
};
function getHeadings() {
	return [];
}
var url = "src/content/atlas/bug.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/bug.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/bug.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
