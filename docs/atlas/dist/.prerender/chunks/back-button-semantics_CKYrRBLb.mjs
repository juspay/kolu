import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Footnote } from "./Footnote_Co54bi9w.mjs";
//#region src/content/atlas/back-button-semantics.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		em: "em",
		h2: "h2",
		li: "li",
		ol: "ol",
		p: "p",
		strong: "strong",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: "Found live by srid while dogfooding DL2 (#1864): click a deep link to a\nterminal, press mouse-back, land somewhere unrelated. Root cause split in two —\none bug (fixed), one design question (this note)." }),
		"\n",
		createVNode(_components.h2, {
			id: "the-bug-fixed-in-dl2",
			children: "The bug (fixed in DL2)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Deep-link routing pushed a browser-history entry per link while ordinary\nnavigation recorded nothing, so the history stack was a list of stale teleport\ncommands; back replayed the ",
			createVNode(_components.em, { children: "previous link" }),
			", not the previous place. Fixed by\nreflecting external hashes via ",
			createVNode(_components.code, { children: "history.replaceState" }),
			" — the URL stays durable\nand copyable, but links never push entries."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-design-question--one-button-two-meanings",
			children: "The design question — one button, two meanings"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Pointer over a Code-tab preview" }),
				": the sandbox traps mouse X1/X2; the\nin-iframe SDK forwards them and kolu drives the ",
				createVNode(_components.strong, { children: "file browser’s own\nback/forward" }),
				" — back means “previous previewed file”. A deliberate feature\n(",
				createVNode(_components.code, { children: "artifact-sdk/client/bridge.ts" }),
				" — “so the buttons behave the same over a\npreview as over the file tree”)."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Pointer anywhere else" }), ": the browser’s real back — which, post-fix, walks\nwhatever history the browser has (usually: out of kolu)."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "Two meanings selected by hover position is the confusion to kill. The options:" }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Back = browser back, everywhere." }), " Drop the preview’s X1/X2 capture; the\nfile browser keeps its own visible back/forward buttons in the Code-tab\nchrome. Cheapest; loses the (genuinely nice) mouse-back-over-preview flow."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Back = app history (“where I actually was”), everywhere — a real DL3." }),
				"\nOrdinary navigation (terminal focus, host switch, panel/file changes)\nwrites history too, so back/forward walk your real path through kolu. Needs\na definition of a ",
				createVNode(_components.em, { children: "place" }),
				createVNode($$Footnote, { children: [
					"Candidate: ",
					createVNode(_components.code, { children: "{host, terminal, right-panel tab + file}" }),
					" — exactly the state the deep-link grammar can\nalready express, which is what makes this DL3-shaped: every place is a\ndeep link, and back/forward walk deep links you actually visited."
				] }),
				"\nand touches every navigation site; the view-only law is preserved (history\nentries mirror state, never mutate it)."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Keep the split, but make it visible" }), " — status-line hint while hovering a\npreview. Recorded for honesty; weakest option."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Recommendation: ",
			createVNode(_components.strong, { children: "option 2 as the DL3 plan" }),
			" (the place-is-a-deep-link framing\nmakes it small and principled), with option 1 acceptable as an interim if DL3\ndoesn’t get scheduled. srid rules."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "What should the back button mean in kolu?",
	"description": "Today one physical button has two unrelated meanings chosen by mouse position: over a Code-tab preview it steps the file browser; anywhere else it walks browser history (until DL2's fix, a stack of stale deep-link teleports). The decision: one meaning, which one?",
	"parents": ["deep-links", "analysis"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-16T00:00:00.000Z"
};
function getHeadings() {
	return [{
		"depth": 2,
		"slug": "the-bug-fixed-in-dl2",
		"text": "The bug (fixed in DL2)"
	}, {
		"depth": 2,
		"slug": "the-design-question--one-button-two-meanings",
		"text": "The design question — one button, two meanings"
	}];
}
var url = "src/content/atlas/back-button-semantics.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/back-button-semantics.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/back-button-semantics.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
