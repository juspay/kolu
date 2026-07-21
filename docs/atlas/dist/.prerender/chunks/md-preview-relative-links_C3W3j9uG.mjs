import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import "./Pill_DD4u2LYa.mjs";
//#region src/content/atlas/md-preview-relative-links.mdx
var FlowMockup = () => createVNode("div", {
	style: {
		display: "flex",
		gap: "1rem",
		flexWrap: "wrap",
		margin: "1.5rem 0",
		fontFamily: "ui-sans-serif,system-ui"
	},
	children: [{
		tag: "today — broken",
		tagBg: "#fdecea",
		tagFg: "#b42318",
		border: "#f3c9c4",
		title: "[the limitations doc](packages/solid-markdown/LIMITATIONS.md)",
		steps: [
			"anchor stamped target=_blank rel=noopener",
			"browser resolves href against the app origin",
			"opens http://localhost:5173/packages/…/LIMITATIONS.md"
		],
		outcome: "✗ a fresh kolu SPA boots at a bogus route — the file never opens",
		outcomeFg: "#b42318"
	}, {
		tag: "this plan — fixed",
		tagBg: "#e3f4e9",
		tagFg: "#1b7a3a",
		border: "#bce3c8",
		title: "[the limitations doc](packages/solid-markdown/LIMITATIONS.md)",
		steps: [
			"scheme-less anchor tagged, no target=_blank",
			"click intercepted → host callback onNavigateRelative",
			"resolved vs the doc's dir → openInCodeTab front door"
		],
		outcome: "✓ LIMITATIONS.md opens in the Code tab's browse view — the app origin is never navigated",
		outcomeFg: "#1b7a3a"
	}].map((c) => createVNode("div", {
		style: {
			flex: "1 1 19rem",
			border: `1px solid ${c.border}`,
			borderRadius: "12px",
			overflow: "hidden",
			boxShadow: "0 2px 12px rgba(0,0,0,.06)"
		},
		children: [createVNode("div", {
			style: {
				padding: ".4rem .8rem",
				background: c.tagBg,
				color: c.tagFg,
				font: "600 .72rem/1 ui-monospace,monospace",
				borderBottom: `1px solid ${c.border}`
			},
			children: c.tag
		}), createVNode("div", {
			style: {
				padding: ".9rem 1rem",
				background: "#fff"
			},
			children: [
				createVNode("code", {
					style: {
						display: "block",
						fontSize: ".7rem",
						color: "#3454d1",
						background: "#f5f7ff",
						border: "1px solid #e2e8ff",
						borderRadius: "6px",
						padding: ".4rem .55rem",
						marginBottom: ".7rem",
						wordBreak: "break-all"
					},
					children: c.title
				}),
				createVNode("ol", {
					style: {
						margin: 0,
						paddingLeft: "1.1rem",
						fontSize: ".76rem",
						color: "#4a4f57",
						lineHeight: 1.5
					},
					children: c.steps.map((s) => createVNode("li", { children: s }))
				}),
				createVNode("div", {
					style: {
						marginTop: ".75rem",
						paddingTop: ".6rem",
						borderTop: "1px dashed #e6e2d6",
						fontSize: ".76rem",
						fontWeight: 600,
						color: c.outcomeFg
					},
					children: c.outcome
				})
			]
		})]
	}))
});
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		li: "li",
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
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"Plan of record · branch ",
			createVNode(_components.code, { children: "md-preview-rellink" }),
			" · ",
			createVNode(_components.a, {
				href: "https://github.com/juspay/kolu/issues/1161",
				children: "issue #1161"
			}),
			" · shipped in ",
			createVNode($$PrLink, { pr: 1190 })
		] }),
		"\n",
		"\n",
		createVNode(_components.h2, {
			id: "what-a-user-sees",
			children: "What a user sees"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"In the Code tab’s rendered Markdown preview, a repo-relative link — say\n",
			createVNode(_components.code, { children: "[the limitations doc](packages/solid-markdown/LIMITATIONS.md)" }),
			" — should open\nthat file in the Code tab, the way it does on GitHub. Today it opens a ",
			createVNode(_components.strong, { children: "new\nbrowser tab at the app origin" }),
			" (",
			createVNode(_components.code, { children: "http://localhost:5173/packages/…/LIMITATIONS.md" }),
			"),\nwhich just boots a fresh kolu SPA at a route that means nothing. The linked file\nnever opens."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Relative ",
			createVNode(_components.strong, { children: "images" }),
			" already do the right thing — a README’s ",
			createVNode(_components.code, { children: "![](docs/logo.png)" }),
			"\nrenders the real image through the per-terminal file route. Relative ",
			createVNode(_components.strong, { children: "links" }),
			"\nhave no equivalent. This plan gives them one."
		] }),
		"\n",
		createVNode(FlowMockup, {}),
		"\n",
		createVNode($$Callout, {
			kind: "danger",
			title: "Root cause",
			children: createVNode(_components.p, { children: [
				"The link pipeline never distinguishes a ",
				createVNode(_components.em, { children: "repo-relative" }),
				" href from a ",
				createVNode(_components.em, { children: "real\nexternal" }),
				" one. The scheme allowlist resolves a scheme-less path against a fake\nbase, sees ",
				createVNode(_components.code, { children: "https:" }),
				", and declares it safe; the link policy then stamps\n",
				createVNode(_components.code, { children: "target=\"_blank\" rel=\"noopener noreferrer\"" }),
				". On click the browser resolves the\nrelative href against the ",
				createVNode(_components.em, { children: "real" }),
				" document origin and opens the bogus URL. Nothing\nin the chain recognises “this is a path inside the repo.”"
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "shape-of-the-fix--wire-links-the-way-images-are-wired",
			children: "Shape of the fix — wire links the way images are wired"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The change reuses an existing seam rather than inventing one. Relative images are\nresolved by a host callback that the preview component already accepts; links get\na parallel callback, and clicks route through the ",
			createVNode(_components.strong, { children: "same front door" }),
			" every other\n“open this file in the Code tab” producer uses (terminal ",
			createVNode(_components.code, { children: "path:line" }),
			" links, the\nright-click ",
			createVNode(_components.em, { children: "Open path" }),
			" menu)."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Data flow — anchor click → file opens",
			children: createVNode(_components.p, { children: [
				"scheme-less anchor (tagged, ",
				createVNode(_components.strong, { children: "not" }),
				" ",
				createVNode(_components.code, { children: "target=_blank" }),
				") → click intercepted in the\npreview → host callback ",
				createVNode(_components.code, { children: "onNavigateRelative(href)" }),
				" → resolve href against the\n",
				createVNode(_components.strong, { children: "previewed doc’s directory" }),
				" → ",
				createVNode(_components.code, { children: "openInCodeTab({ targetMode: \"browse\" })" }),
				" → Code\ntab reveals the target file. The app origin is never navigated."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: "Three layers move, each a thin pass-through — the shape mirrors the image path\nexactly:" }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Layer" }),
					"\n",
					createVNode(_components.th, { children: "Today (images)" }),
					"\n",
					createVNode(_components.th, { children: "Added (links)" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "@kolu/solid-markdown" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"accepts ",
						createVNode(_components.code, { children: "resolveImageSrc" }),
						"; rewrites ",
						createVNode(_components.code, { children: "<img>" }),
						" src"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"tags scheme-less anchors, intercepts their click, calls a new optional ",
						createVNode(_components.code, { children: "onNavigateRelative(path)" }),
						" host callback"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "@kolu/solid-fileview" }), " renderer"] }),
					"\n",
					createVNode(_components.td, { children: ["threads ", createVNode(_components.code, { children: "resolveImageSrc" })] }),
					"\n",
					createVNode(_components.td, { children: "threads the new link callback" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "right-panel/BrowseFileDispatcher" }) }),
					"\n",
					createVNode(_components.td, { children: "resolves image src vs the doc’s dir" }),
					"\n",
					createVNode(_components.td, { children: ["resolves the href vs the doc’s dir, then calls ", createVNode(_components.code, { children: "openInCodeTab" })] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "One concept, two consumers",
			children: createVNode(_components.p, { children: [
				"Resolving a Markdown-relative ref to a repo-relative path (GitHub rules: relative\nto the doc’s own directory, root-absolute from the repo root, reject traversal\nthat escapes the repo) is ",
				createVNode(_components.strong, { children: "one" }),
				" idea. Today it lives inside the image resolver.\nThe plan factors that core out so the link path and the image path share it — the\nimage resolver keeps wrapping it into a file-route URL; the link path feeds the\nrepo-relative result to the Code-tab front door. No second copy of the\npath-normalisation rules."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "why-route-through-the-existing-front-door",
			children: "Why route through the existing front door"
		}),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.code, { children: "openInCodeTab" }), " is the single producer-side entry point for “show this file in the\nCode tab.” Reusing it means relative links inherit, for free, the behaviour the\nteam already debugged for terminal links:"] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"A href that resolves to ",
				createVNode(_components.strong, { children: "any" }),
				" repo file opens it — not just other Markdown."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"A href that resolves to ",
				createVNode(_components.strong, { children: "nothing in the repo" }),
				" surfaces a toast (the front\ndoor’s existing miss path), which is strictly better than a bogus new tab."
			] }),
			"\n",
			createVNode(_components.li, { children: "Desktop uncollapse / mobile drawer / re-click-after-collapse all already work." }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "The alternative — teaching the preview to navigate on its own — would duplicate\nthat front-door logic and re-open bugs (#1161’s sibling: the production\neffect-ordering elision the front door was built to sidestep). Rejected." }),
		"\n",
		createVNode(_components.h2, {
			id: "trade-offs--scope",
			children: "Trade-offs & scope"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "In scope",
			children: createVNode(_components.p, { children: [
				"Repo-relative links (no scheme) that resolve to a path inside the repo. Both\nMarkdown ",
				createVNode(_components.code, { children: "[]()" }),
				" links and raw inline ",
				createVNode(_components.code, { children: "<a href=…>" }),
				". External links\n(",
				createVNode(_components.code, { children: "https://" }),
				", ",
				createVNode(_components.code, { children: "mailto:" }),
				") keep today’s new-tab-with-severed-opener behaviour\nuntouched."
			] })
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Fragments on a relative path" }),
				" (",
				createVNode(_components.code, { children: "LIMITATIONS.md#known-issues" }),
				") — the path\nopens; scrolling to the heading inside the freshly-opened doc is ",
				createVNode(_components.strong, { children: "out of\nscope" }),
				" for this fix (a future follow-up, tracked as a known limitation)."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "No host callback wired" }), " (compact/inline Markdown slots, or a future embedder\nthat doesn’t pass it) — the scheme-less anchor simply doesn’t navigate rather\nthan opening a bogus tab. Document-variant preview always wires it."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "LIMITATIONS.md" }) }), " — the package’s known-limitation note that documents\ntoday’s broken behaviour is removed (or its entry retired) once this lands,\nsince the limitation no longer holds."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "test-gap-to-close",
			children: "Test gap to close"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "danger",
			title: "The existing e2e codified the bug as correct",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "code-tab.feature" }),
				"’s “applies the link policy to raw inline anchors” scenario only\nasserts a relative anchor is ",
				createVNode(_components.em, { children: "kept" }),
				" with ",
				createVNode(_components.code, { children: "target=_blank" }),
				"/",
				createVNode(_components.code, { children: "rel=noopener" }),
				" — it never\n",
				createVNode(_components.strong, { children: "clicks" }),
				" it. So it blessed the new-tab markup and was blind to the bogus\ndestination."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: "This is a bug fix, so the reproducing test comes first (red → green):" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "New scenario" }),
				" — render a doc with a repo-relative link, ",
				createVNode(_components.strong, { children: "click it" }),
				", assert\nthe target file opens in the Code tab’s browse view ",
				createVNode(_components.strong, { children: "and" }),
				" that the app origin\nwas never navigated. This is the failing test that captures #1161."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Correct the existing scenario" }),
				" — a scheme-less anchor is no longer expected\nto carry ",
				createVNode(_components.code, { children: "target=_blank" }),
				"; it’s expected to be tagged for interception. The\nunsafe-scheme (",
				createVNode(_components.code, { children: "javascript:" }),
				") and genuine-external assertions stay."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Unit" }),
				" — the factored-out Markdown-relative-path resolver gets table tests\nshared in spirit with the image resolver’s cases (doc-dir relative,\nroot-absolute, ",
				createVNode(_components.code, { children: ".." }),
				"-escape rejected, percent-decode)."
			] }),
			"\n"
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Markdown preview: repo-relative links open the target file",
	"description": "Plan — make a repo-relative Markdown link open the linked file in the Code tab (mirroring how relative images already resolve) instead of booting a bogus app SPA in a new browser tab.",
	"parents": ["solid-fileview", "bug"],
	"status": "implemented",
	"maturity": "seedling",
	"updated": "2026-06-04T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-a-user-sees",
			"text": "What a user sees"
		},
		{
			"depth": 2,
			"slug": "shape-of-the-fix--wire-links-the-way-images-are-wired",
			"text": "Shape of the fix — wire links the way images are wired"
		},
		{
			"depth": 2,
			"slug": "why-route-through-the-existing-front-door",
			"text": "Why route through the existing front door"
		},
		{
			"depth": 2,
			"slug": "trade-offs--scope",
			"text": "Trade-offs & scope"
		},
		{
			"depth": 2,
			"slug": "test-gap-to-close",
			"text": "Test gap to close"
		}
	];
}
var url = "src/content/atlas/md-preview-relative-links.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/md-preview-relative-links.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/md-preview-relative-links.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, FlowMockup, file, frontmatter, getHeadings, url };
