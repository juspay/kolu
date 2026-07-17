import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$Cite } from "./Cite_D-1zLbJ9.mjs";
import { n as $$Roadmap, t as $$Milestone } from "./Milestone_B0slHbDx.mjs";
//#region src/content/atlas/cite-code-browser.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
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
			createVNode(_components.strong, { children: "Goal." }),
			" Inside kolu’s Code-tab preview, clicking a ",
			createVNode(_components.code, { children: "<Cite>" }),
			" ref jumps to that\nfile at the line ",
			createVNode(_components.strong, { children: "in the Code browser tree" }),
			" (with Pierre’s line highlight) —\nnot a GitHub blob in a new tab. Outside kolu (GitHub, a plain browser), it stays\nan ordinary blob link."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "why-defer-not-drop--this-is-wiring-not-new-infra",
			children: "Why defer, not drop — this is wiring, not new infra"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Three pieces already exist; the feature just connects them, and ",
			createVNode(_components.code, { children: "<Cite>" }),
			" is the\nsingle producer, so it’s a localized change:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "<Cite>" }),
				" centralizes every ",
				createVNode(_components.code, { children: "file:line" }),
				" ref"
			] }), " → one component + one host handler."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Opening a ",
					createVNode(_components.code, { children: "file:line" }),
					" is solved"
				] }),
				" — ",
				createVNode($$Cite, {
					file: "packages/client/src/right-panel/openInCodeTab.ts",
					lines: "71"
				}),
				" exposes ",
				createVNode(_components.code, { children: "openInCodeTab({ ref, repoRoot, targetMode })" }),
				", which opens a ",
				createVNode(_components.code, { children: "path:line" }),
				" in the Code tab with the line highlighted (already used by terminal-link clicks and the right-click “Open path:N” menu)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The iframe↔host bridge already exists" }),
				" — ",
				createVNode($$Cite, {
					file: "packages/artifact-sdk/src/client/bridge.ts",
					lines: "103"
				}),
				" (",
				createVNode(_components.code, { children: "observeIframeNavigation" }),
				") carries in-iframe events to the host, and ",
				createVNode($$Cite, {
					file: "packages/solid-browser/src/previewPath.ts",
					lines: "30"
				}),
				" (",
				createVNode(_components.code, { children: "pathFromPreviewPathname" }),
				", from ",
				createVNode(_components.code, { children: "@kolu/solid-browser" }),
				") maps a preview URL back to a repo path — that’s how the preview already follows links (",
				createVNode($$Cite, {
					file: "packages/client/src/right-panel/BrowseIframeRenderer.tsx",
					lines: "50"
				}),
				")."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "mechanism--two-options",
			children: "Mechanism — two options"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A — dedicated bridge message (preferred)." }),
				" Add a ",
				createVNode(_components.code, { children: "kolu-artifact-sdk:open-source { path, line }" }),
				" message. ",
				createVNode(_components.code, { children: "<Cite>" }),
				" posts it on click; the host handler calls ",
				createVNode(_components.code, { children: "openInCodeTab" }),
				". Keeps “open source in the tree” separate from the existing “navigate/swap the previewed file” semantics."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "B — piggyback on navigation." }),
				" ",
				createVNode(_components.code, { children: "<Cite>" }),
				" links into the file route with ",
				createVNode(_components.code, { children: "#Lnn" }),
				"; reuse ",
				createVNode(_components.code, { children: "observeIframeNavigation" }),
				" + parse the line. Cheaper, but overloads the preview-swap path with a second meaning (needs a discriminator)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Key insight — progressive enhancement",
			children: createVNode(_components.p, { children: [
				"Because ",
				createVNode(_components.code, { children: "<Cite>" }),
				" is the single producer, keep the GitHub-blob ",
				createVNode(_components.code, { children: "href" }),
				" as the\ndefault (works on GitHub and in any browser) and only intercept the click when\nthe kolu bridge is detected. No dead links when a note is read outside kolu."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Open questions",
			children: createVNode(_components.ul, { children: [
				"\n",
				createVNode(_components.li, { children: [
					"Does the server inject the artifact-sdk into ",
					createVNode(_components.em, { children: "arbitrary" }),
					" previewed HTML (so a ",
					createVNode(_components.code, { children: "<Cite>" }),
					" click can reach the bridge), or only opt-in pages? Check the iframe preview route."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					"Line ranges: ",
					createVNode(_components.code, { children: "LineRef" }),
					" already supports ",
					createVNode(_components.code, { children: "path:line-end" }),
					", so ",
					createVNode(_components.code, { children: "#L489-L509" }),
					" maps directly."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					"Which ",
					createVNode(_components.code, { children: "repoRoot" }),
					" to pass ",
					createVNode(_components.code, { children: "openInCodeTab" }),
					" — the previewed file’s per-terminal git root."
				] }),
				"\n"
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "roadmap",
			children: "Roadmap"
		}),
		"\n",
		createVNode($$Roadmap, { children: [
			createVNode($$Milestone, {
				status: "next",
				label: "1",
				children: [
					"Confirm the artifact-sdk is injected into Atlas previews and a ",
					createVNode(_components.code, { children: "<Cite>" }),
					" click can reach the bridge."
				]
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "2",
				children: [
					"Add ",
					createVNode(_components.code, { children: "open-source { path, line }" }),
					" to the artifact-sdk bridge (both ends)."
				]
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "3",
				children: [
					"Host handler maps it to ",
					createVNode(_components.code, { children: "openInCodeTab({ ref, repoRoot, targetMode: \"browse\" })" }),
					"."
				]
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "4",
				children: [createVNode(_components.code, { children: "<Cite>" }), " progressive enhancement — blob href by default; intercept + post when the bridge is present."]
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "5",
				children: [
					"Test (analogous to ",
					createVNode(_components.code, { children: "file-ref-link.feature" }),
					"): click a cite in a previewed note → the tree opens the file + line highlight."
				]
			})
		] }),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Seedling plan — deferred from the component-kit work. The kit’s ",
			createVNode(_components.code, { children: "<Cite>" }),
			" is what\nmakes this a localized change rather than a cross-cutting one."
		] }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Cite → open in the Code browser",
	"description": "Make <Cite> refs open the cited file in kolu's Code-tab tree (line-highlighted) when a note is previewed inside kolu — wiring three pieces that already exist.",
	"parents": ["solid-fileview", "feature"],
	"maturity": "seedling",
	"status": "proposed",
	"updated": "2026-06-10T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "why-defer-not-drop--this-is-wiring-not-new-infra",
			"text": "Why defer, not drop — this is wiring, not new infra"
		},
		{
			"depth": 2,
			"slug": "mechanism--two-options",
			"text": "Mechanism — two options"
		},
		{
			"depth": 2,
			"slug": "roadmap",
			"text": "Roadmap"
		}
	];
}
var url = "src/content/atlas/cite-code-browser.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/cite-code-browser.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/cite-code-browser.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
