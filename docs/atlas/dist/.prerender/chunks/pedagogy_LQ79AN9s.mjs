import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
//#region src/content/atlas/pedagogy.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		em: "em",
		p: "p",
		strong: "strong"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"The ",
			createVNode(_components.strong, { children: "Pedagogy" }),
			" index gathers the teaching notes. A pedagogy note differs from a\n",
			createVNode(_components.a, {
				href: "reference.html",
				children: "reference"
			}),
			" note in its ",
			createVNode(_components.em, { children: "contract with the reader" }),
			": reference\nrecords how a thing works for someone who already has the map; pedagogy ",
			createVNode(_components.strong, { children: "builds\nthe map" }),
			" — ground-up, plain words first, jargon glossed at first use, diagrams\nthat carry meaning, and it earns its keep by ending at a ",
			createVNode(_components.strong, { children: "real decision or bug" }),
			"\nthe reader can now judge for themselves."
		] }),
		"\n",
		createVNode(_components.p, { children: "House rules for writing one: teach one slice, not the world; every concept\narrives with the problem that makes it necessary; prefer a true story (a bug, a\nfork, a review fight) as the finale — teaching without a point is a tour." })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Pedagogy",
	"description": "Notes that TEACH a part of the system from the ground up, in plain words — written so a reader (human or agent) can go from cold to judging real design decisions.",
	"moc": true,
	"color": "teal",
	"order": 6,
	"maturity": "evergreen",
	"updated": "2026-07-06T00:00:00.000Z"
};
function getHeadings() {
	return [];
}
var url = "src/content/atlas/pedagogy.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/pedagogy.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/pedagogy.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
