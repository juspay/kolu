import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$D2 } from "./D2_CPv-UX0x.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import { t as $$Cite } from "./Cite_IypTixBQ.mjs";
//#region src/content/atlas/solid-browser.mdx
var Chrome = () => createVNode("div", {
	style: {
		margin: "1.5rem 0",
		border: "1px solid #d9d4c6",
		borderRadius: "12px",
		overflow: "hidden",
		boxShadow: "0 2px 14px rgba(0,0,0,.07)",
		fontFamily: "ui-sans-serif,system-ui"
	},
	children: [createVNode("div", {
		style: {
			display: "flex",
			alignItems: "center",
			gap: ".55rem",
			padding: ".5rem .8rem",
			background: "#f3f0e7",
			borderBottom: "1px solid #e6e2d6"
		},
		children: [createVNode("span", {
			style: {
				display: "inline-flex",
				gap: ".3rem"
			},
			children: [createVNode("span", {
				style: {
					width: "1.6rem",
					height: "1.6rem",
					display: "grid",
					placeItems: "center",
					borderRadius: "6px",
					background: "#fff",
					border: "1px solid #ddd6c6",
					color: "#3454d1",
					font: "700 .85rem/1 ui-monospace,monospace"
				},
				children: "◀"
			}), createVNode("span", {
				style: {
					width: "1.6rem",
					height: "1.6rem",
					display: "grid",
					placeItems: "center",
					borderRadius: "6px",
					background: "#fff",
					border: "1px solid #ece7da",
					color: "#c2bdaf",
					font: "700 .85rem/1 ui-monospace,monospace",
					opacity: .4
				},
				children: "▶"
			})]
		}), createVNode("code", {
			style: {
				flex: 1,
				fontSize: ".72rem",
				color: "#3a3f47",
				background: "#fff",
				border: "1px solid #e2ddcf",
				borderRadius: "7px",
				padding: ".35rem .6rem",
				wordBreak: "break-all"
			},
			children: ["browse · docs/atlas/src/content/atlas/electricity.mdx", createVNode("span", {
				style: { color: "#a89f86" },
				children: "#L18"
			})]
		})]
	}), createVNode("div", {
		style: {
			padding: ".9rem 1rem",
			background: "#fff",
			fontSize: ".78rem",
			color: "#4a4f57",
			lineHeight: 1.55
		},
		children: [
			createVNode("strong", {
				style: { color: "#1b1f24" },
				children: "rendered Markdown"
			}),
			" — click a repo-relative link → the browser navigates → ◀ goes back to where you were, scroll and highlight intact. Same engine renders source, HTML, SVG, PDF.",
			createVNode("div", {
				style: {
					marginTop: ".6rem",
					paddingTop: ".55rem",
					borderTop: "1px dashed #e6e2d6",
					fontSize: ".74rem",
					color: "#7a8089"
				},
				children: [
					"git is not in this picture. The browser resolves ",
					createVNode("code", { children: "location → content" }),
					" through an injected resolver; kolu's resolver is the only part that knows \"repo-relative path + mode.\""
				]
			})
		]
	})]
});
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		hr: "hr",
		li: "li",
		p: "p",
		pre: "pre",
		span: "span",
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
			createVNode(_components.code, { children: "md-back-link" }),
			" · ",
			createVNode(_components.strong, { children: "phases 1 + 2 shipped" }),
			" in ",
			createVNode($$PrLink, { pr: 1191 })
		] }),
		"\n",
		"\n",
		createVNode(_components.p, { children: [
			"The question that started this was small: ",
			createVNode(_components.em, { children: "what does it take to add back/forward\nnavigation to the Code tab’s preview?" }),
			" The answer kept wanting to be “a history\nstack.” That answer is wrong — not incorrect, but ",
			createVNode(_components.strong, { children: "mis-scoped" }),
			". A history stack\nis a transformer: a working part ",
			createVNode(_components.em, { children: "inside" }),
			" a concept. The concept is the\n",
			createVNode(_components.strong, { children: "browser" }),
			", and it has been hiding in the Code tab the whole time."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The thesis — the Code tab is a browser wearing git as a costume",
			children: createVNode(_components.p, { children: [
				"Strip git off the Code tab and what remains is a general capability: ",
				createVNode(_components.strong, { children: "render a\nspace of interlinked, typed documents; follow links between them; go back and\nforward." }),
				" That is a browser engine. History is one organ of it — alongside the\nlocation model, the link interceptor, and the resolver; the ",
				createVNode(_components.em, { children: "rendering" }),
				" of any\none document is already solved by ",
				createVNode(_components.code, { children: "@kolu/solid-fileview" }),
				", which the browser\ncomposes. The electricity is not “history”; it is ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/solid-browser" }) }),
				". git\nbecomes an injected resolver, and back/forward falls out for free — a browser has\nhistory the way a heart has chambers."
			] })
		}),
		"\n",
		createVNode(Chrome, {}),
		"\n",
		createVNode(_components.h2, {
			id: "the-code-tab-is-already-a-browser",
			children: "The Code tab is already a browser"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The reframe is one move — name the ",
			createVNode(_components.em, { children: "concept" }),
			", not a mechanism inside it. Two\nobservations make that concrete."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-tell-the-renderers-are-already-extracted-the-shell-isnt",
			children: [
				"The tell: the renderers are already extracted; the ",
				createVNode(_components.em, { children: "shell" }),
				" isn’t"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"kolu already pulled the appliances out into packages — ",
			createVNode($$PrLink, { pr: 1079 }),
			"\n(",
			createVNode(_components.code, { children: "@kolu/solid-markdown" }),
			"), ",
			createVNode($$PrLink, { pr: 1082 }),
			" (",
			createVNode(_components.code, { children: "@kolu/solid-fileview" }),
			"),\n",
			createVNode(_components.code, { children: "@kolu/solid-pierre" }),
			" (source). See ",
			createVNode(_components.a, {
				href: "solid-fileview",
				children: "solid-fileview"
			}),
			" — “invent the\ngrid, slim the house.” What that effort extracted was ",
			createVNode(_components.strong, { children: "how a single document\nrenders" }),
			". What it left behind, still smeared across the client, is the layer\n",
			createVNode(_components.em, { children: "above" }),
			" a single document: ",
			createVNode(_components.strong, { children: "how you move between documents." }),
			" That layer is the\nbrowser, and today it is complected across five files:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Smeared across" }),
					"\n",
					createVNode(_components.th, { children: "Owns (a browser organ)" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "right-panel/openInCodeTab.ts" }),
						" ",
						createVNode($$Cite, {
							file: "packages/client/src/right-panel/openInCodeTab.ts",
							lines: "78-85"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"The ",
						createVNode(_components.strong, { children: "address bar" }),
						" — the single “navigate to this location” front door."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "right-panel/CodeTab.tsx" }),
						" ",
						createVNode($$Cite, {
							file: "packages/client/src/right-panel/CodeTab.tsx",
							lines: "515-542"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "handleSelect" }),
						" — the ",
						createVNode(_components.strong, { children: "navigation controller" }),
						" (apply a location to the view)."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "right-panel/markdownImageSrc.ts" }),
						" → now ",
						createVNode(_components.code, { children: "solid-browser/src/relativePath.ts" }),
						" ",
						createVNode($$Cite, { file: "packages/solid-browser/src/relativePath.ts" })
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Relative-link resolution" }), " (GitHub rules) — agnostic URI math."] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "right-panel/iframePreviewNav.ts" }),
						" → now ",
						createVNode(_components.code, { children: "solid-browser/src/previewPath.ts" }),
						" ",
						createVNode($$Cite, { file: "packages/solid-browser/src/previewPath.ts" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "In-frame link interception" }),
						" — map an iframe ",
						createVNode(_components.code, { children: "pathname" }),
						" back to a location."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "right-panel/BrowseIframeRenderer.tsx" }),
						" ",
						createVNode($$Cite, {
							file: "packages/client/src/right-panel/BrowseIframeRenderer.tsx",
							lines: "56-64"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "In-iframe link observation" }),
						" — a navigation edge ",
						createVNode(_components.em, { children: "out" }),
						" of rendered HTML (the iframe ",
						createVNode(_components.em, { children: "drawing" }),
						" is already ",
						createVNode(_components.code, { children: "@kolu/solid-fileview" }),
						"’s)."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"None of these is ",
			createVNode(_components.em, { children: "about git" }),
			", and none is ",
			createVNode(_components.em, { children: "about how a file draws" }),
			" (that’s\n",
			createVNode(_components.code, { children: "@kolu/solid-fileview" }),
			"). They are about ",
			createVNode(_components.strong, { children: "locations, links, and history" }),
			" — the\nvocabulary of a browser."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "openincodetabrequest-is-already-a-url",
			children: [createVNode(_components.code, { children: "OpenInCodeTabRequest" }), " is already a URL"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Look at the front-door request shape ",
			createVNode($$Cite, {
				file: "packages/client/src/right-panel/openInCodeTab.ts",
				lines: "31-54"
			}),
			":"
		] }),
		"\n",
		createVNode(_components.pre, {
			class: "astro-code github-light",
			style: {
				backgroundColor: "#fff",
				color: "#24292e",
				overflowX: "auto"
			},
			tabindex: "0",
			"data-language": "ts",
			children: createVNode(_components.code, { children: createVNode(_components.span, {
				class: "line",
				children: [
					createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "{ "
					}),
					createVNode(_components.span, {
						style: { color: "#6F42C1" },
						children: "ref"
					}),
					createVNode(_components.span, {
						style: { color: "#24292E" },
						children: ": { path, startLine, endLine }, repoRoot, cwd, targetMode, allowBasenameFallback }"
					})
				]
			}) })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"That is a URL. ",
			createVNode(_components.code, { children: "ref" }),
			" is the path + fragment; ",
			createVNode(_components.code, { children: "targetMode" }),
			" is which “site”\n(",
			createVNode(_components.code, { children: "browse" }),
			"/",
			createVNode(_components.code, { children: "local" }),
			"/",
			createVNode(_components.code, { children: "branch" }),
			"); ",
			createVNode(_components.code, { children: "repoRoot" }),
			"/",
			createVNode(_components.code, { children: "cwd" }),
			" are the base href. And\n",
			createVNode(_components.code, { children: "openInCodeTab()" }),
			" is already ",
			createVNode(_components.code, { children: "location.assign()" }),
			" — the single producer-side entry\nevery navigation routes through, which is ",
			createVNode(_components.em, { children: "why" }),
			" relative Markdown links\n(",
			createVNode(_components.a, {
				href: "md-preview-relative-links",
				children: "#1161"
			}),
			", ",
			createVNode($$PrLink, { pr: 1190 }),
			") and terminal ",
			createVNode(_components.code, { children: "path:N" }),
			"\nlinks and the right-click ",
			createVNode(_components.em, { children: "Open path" }),
			" menu all funnel into it. The browser is\nhalf-built; it is missing only ",
			createVNode(_components.code, { children: "history.back()" }),
			"/",
			createVNode(_components.code, { children: "forward()" }),
			" and the popstate\nsemantics over a stack of these locations."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-electricity--kolusolid-browser",
			children: ["The electricity — ", createVNode(_components.code, { children: "@kolu/solid-browser" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A standalone package. ",
			createVNode(_components.strong, { children: "As shipped" }),
			" (phases 1 + 2) it depends on\n",
			createVNode(_components.code, { children: "@kolu/url-shape" }),
			" + ",
			createVNode(_components.code, { children: "solid-js" }),
			" and nothing kolu — the dependency arrow points\n",
			createVNode(_components.strong, { children: "out" }),
			" of the client, never back in. It owns URIs, locations, links, and history\n(",
			createVNode(_components.code, { children: "createBrowser" }),
			" is the reactive history controller). It knows nothing of git,\nrepos, modes, terminals — nor of how any single format renders (that is\nfileview’s). The diagram below draws the ",
			createVNode(_components.strong, { children: "full target" }),
			" shape, including the\nparts still deferred: a ",
			createVNode(_components.code, { children: "<Browser>" }),
			" component that composes ",
			createVNode(_components.code, { children: "@kolu/solid-fileview" }),
			"\nto draw whatever a location resolves to. Today the host (",
			createVNode(_components.code, { children: "CodeTab" }),
			") keeps both\nrendering paths and consumes only the history controller + the path utilities —\nso the package depends on ",
			createVNode(_components.code, { children: "@kolu/solid-fileview" }),
			" only ",
			createVNode(_components.em, { children: [
				"once ",
				createVNode(_components.code, { children: "<Browser>" }),
				" lands"
			] }),
			",\nnot now (see the phase-2 as-built callout for why ",
			createVNode(_components.code, { children: "<Browser>" }),
			" is deferred)."
		] }),
		"\n",
		createVNode($$D2, {
			caption: "Architectural connections — the target shape. SOLID edges are shipped (CodeTab drives createBrowser; the package depends only on @kolu/url-shape + solid-js). DASHED edges (mounts <Browser>, composes <FileView>, the gitResolver injection) are DEFERRED — see the phase-2 callout. git lives only in the injected resolver.",
			code: `
direction: down

kolu: "kolu app — the consumer" {
CodeTab: "right-panel/CodeTab.tsx"
gitResolver: "gitResolver.ts (git domain) — deferred"
}

browser: "@kolu/solid-browser — the electricity" {
location
history: "createBrowser (back / forward) — shipped"
linkNav: "linkNav (resolve + intercept) — shipped"
browserComp: "<Browser> — deferred"
}

fileview: "@kolu/solid-fileview — the viewport (one FileData + toggle)"

appliances: "appliances" {
md: "@kolu/solid-markdown"
pierre: "@kolu/solid-pierre"
}

kolu.CodeTab -> browser.history: "records / replays navigation (shipped)"
kolu.CodeTab -> browser.browserComp: "mounts <Browser>, injects renderers (deferred)" {
style.stroke-dash: 4
}
kolu.gitResolver -> browser.browserComp: "resolve(location) -> FileData (deferred)" {
style.stroke-dash: 4
}
browser.browserComp -> fileview: "composes (deferred)" {
style.stroke-dash: 4
}
fileview -> appliances.md: "draws"
fileview -> appliances.pierre: "draws"
`
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Once ",
			createVNode(_components.code, { children: "<Browser>" }),
			" lands, what the host ",
			createVNode(_components.strong, { children: "injects" }),
			" is exactly the volatility kolu\nowns:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "resolve(location) → FileData" }) }),
				" — the only part that knows “repo-relative\npath + git mode → file bytes,” producing the ",
				createVNode(_components.code, { children: "{ path, source?, url? }" }),
				"\n",
				createVNode(_components.code, { children: "FileData" }),
				" that ",
				createVNode(_components.code, { children: "@kolu/solid-fileview" }),
				" draws. Swap it and the same browser\nreads HTTP, ssh, an artifact store."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"The renderers ",
					createVNode(_components.code, { children: "FileView" }),
					" draws with"
				] }),
				" — ",
				createVNode(_components.code, { children: "@kolu/solid-markdown" }),
				" / ",
				createVNode(_components.code, { children: "-pierre" }),
				"\nand the iframe/image appliances, forwarded straight through to ",
				createVNode(_components.code, { children: "<FileView>" }),
				".\nThe browser owns ",
				createVNode(_components.em, { children: "no" }),
				" renderer and ",
				createVNode(_components.em, { children: "no" }),
				" render dispatch (",
				createVNode(_components.code, { children: "match(path)" }),
				" is\nfileview’s); it decides only ",
				createVNode(_components.em, { children: "which location" }),
				" to show."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Chrome via slots" }),
				" — the file tree and ",
				createVNode(_components.code, { children: "browse/local/branch" }),
				" mode chips."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Layered on @kolu/solid-fileview — the viewport vs. the browser",
			children: createVNode(_components.p, { children: [
				"The split is clean and one-directional. ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "@kolu/solid-fileview" }), " is the\nviewport"] }),
				": hand it one ",
				createVNode(_components.code, { children: "FileData" }),
				" (path + optional ",
				createVNode(_components.code, { children: "source" }),
				" text + optional\nrendered ",
				createVNode(_components.code, { children: "url" }),
				") and a renderer list, and it draws ",
				createVNode(_components.em, { children: "that one document" }),
				" with the\nSource⇄Rendered toggle, picking a renderer by ",
				createVNode(_components.code, { children: "match(path)" }),
				". It knows nothing of\nnavigation. ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "@kolu/solid-browser" }), " is the browser around it"] }),
				": it owns ",
				createVNode(_components.em, { children: "which" }),
				"\ndocument (a location), ",
				createVNode(_components.em, { children: "where content comes from" }),
				" (",
				createVNode(_components.code, { children: "resolve(location) → FileData" }),
				"), ",
				createVNode(_components.em, { children: "history" }),
				", and ",
				createVNode(_components.em, { children: "links to other documents" }),
				" — then hands the resolved\n",
				createVNode(_components.code, { children: "FileData" }),
				" down to a ",
				createVNode(_components.code, { children: "<FileView>" }),
				". Dependency arrow: ",
				createVNode(_components.code, { children: "solid-browser → solid-fileview → solid-markdown" }),
				"/",
				createVNode(_components.code, { children: "-pierre" }),
				", acyclic; the viewport never learns\nthere’s a back button. Two volatilities stacked: fileview encapsulates ",
				createVNode(_components.em, { children: "how one\nfile is viewed" }),
				"; the browser encapsulates ",
				createVNode(_components.em, { children: "how you move through a space of\nfiles" }),
				". fileview’s own ",
				createVNode(_components.code, { children: "types.ts" }),
				" already calls ",
				createVNode(_components.code, { children: "FileView" }),
				" “the outlet the\n",
				createVNode(_components.strong, { children: "Code-browser" }),
				" preview plan describes” — this is that browser."
			] })
		}),
		"\n",
		createVNode(_components.h3, {
			id: "does-browser-clear-the-electricity-bar-where-history-didnt",
			children: "Does “browser” clear the electricity bar where “history” didn’t?"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Against ",
			createVNode(_components.a, {
				href: "electricity",
				children: "electricity"
			}),
			"’s own three tests:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Test" }),
					"\n",
					createVNode(_components.th, { children: "“history” stack" }),
					"\n",
					createVNode(_components.th, { children: createVNode(_components.code, { children: "@kolu/solid-browser" }) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["① ", createVNode(_components.strong, { children: "domain-agnostic" })] }),
					"\n",
					createVNode(_components.td, { children: [
						"✓ (but ",
						createVNode(_components.code, { children: "T" }),
						" carried no meaning)"
					] }),
					"\n",
					createVNode(_components.td, { children: "✓ — URIs/locations/links/history; git is injected, rendering is fileview’s" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["② ", createVNode(_components.strong, { children: [
						"hides a ",
						createVNode(_components.em, { children: "hard" }),
						" volatility"
					] })] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "bad",
							children: "no"
						}),
						" back/forward is a bounded algorithm — ",
						createVNode(_components.code, { children: "nonempty" }),
						"-tier leaf"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "ok",
							children: "yes"
						}),
						" resource resolution (transport) + ",
						createVNode(_components.strong, { children: "navigation across heterogeneous rendered content" }),
						" (DOM-anchor, in-iframe, tree → one location model) + GitHub-relative path semantics + history/popstate + the production-build effect-elision invariant the front door was ",
						createVNode(_components.em, { children: "built" }),
						" to dodge ",
						createVNode($$Cite, {
							file: "packages/client/src/right-panel/openInCodeTab.ts",
							lines: "9-19"
						})
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["③ ", createVNode(_components.strong, { children: "graduates — proof is real" })] }),
					"\n",
					createVNode(_components.td, { children: "meaningless standalone" }),
					"\n",
					createVNode(_components.td, { children: [
						"a docs/wiki viewer, a ",
						createVNode(_components.a, {
							href: "https://github.com/srid/drishti",
							children: "drishti"
						}),
						"-style host inspector (logs + configs over ssh, links between them), an artifact viewer — each injects its own ",
						createVNode(_components.code, { children: "resolve" }),
						" and reuses the published renderers"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Why 'browser', not 'history'",
			children: createVNode(_components.p, { children: [
				"“History” is self-undescribing — history ",
				createVNode(_components.em, { children: "of what?" }),
				" “Browser” tells you what it\nis and what you’d reuse it for without being told. A standalone history stack is\n",
				createVNode(_components.code, { children: "nonempty" }),
				"/",
				createVNode(_components.code, { children: "html-escape" }),
				"-tier: a clean leaf, but the ",
				createVNode(_components.a, {
					href: "electricity",
					children: "electricity"
				}),
				"\ntracker lists those as ",
				createVNode(_components.strong, { children: "leaves, not electricities" }),
				" precisely because they hide\nno ",
				createVNode(_components.em, { children: "hard" }),
				" volatility. The browser does — it is the same class of receptacle as\n",
				createVNode(_components.code, { children: "@kolu/surface" }),
				" (transport) or ",
				createVNode(_components.code, { children: "@kolu/solid-xterm" }),
				" (WebGL lifecycle)."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "③ is proof-pending, and the note says so",
			children: createVNode(_components.p, { children: [
				"By the tracker’s own standard, a single consumer is “a nicely-factored package,\nnot yet proven electricity” — drishti is cited there as the ",
				createVNode(_components.em, { children: "proof" }),
				" ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				"\nwas real, not its point. Until a second app actually plugs a different ",
				createVNode(_components.code, { children: "resolve" }),
				"\ninto ",
				createVNode(_components.code, { children: "@kolu/solid-browser" }),
				", this is an ",
				createVNode(_components.strong, { children: "extraction with a credible graduation\npath" }),
				", not a closed case. The honest framing is “the Code tab is a browser; here\nis the seam that lets it leave.” ",
				createVNode(_components.strong, { children: "Update (phase 2):" }),
				" ",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/tree/master/packages/solid-browser/example/docsite",
					children: createVNode(_components.code, { children: "example/docsite" })
				}),
				"\nis now a standalone second host reusing ",
				createVNode(_components.code, { children: "createBrowser" }),
				" — in-repo proof of reuse,\nexactly the bar ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				"’s own examples clear. A different ",
				createVNode(_components.em, { children: "application" }),
				"\ninjecting its own ",
				createVNode(_components.code, { children: "resolve" }),
				" remains the closing argument."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-design",
			children: "The design"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Two mechanisms carry the feature — one for ",
			createVNode(_components.em, { children: "moving" }),
			" (the seam), one for\n",
			createVNode(_components.em, { children: "remembering where you were" }),
			" (history). Both live in the engine, never in\n",
			createVNode(_components.code, { children: "CodeTab" }),
			"."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-seam--split-assign-from-record",
			children: [
				"The seam — split ",
				createVNode(_components.code, { children: "assign" }),
				" from ",
				createVNode(_components.code, { children: "record" })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Back/forward hinges on one split the front door doesn’t yet make — separating\n",
			createVNode(_components.code, { children: "applyLocation" }),
			" (assign) from ",
			createVNode(_components.code, { children: "navigate" }),
			" (assign ",
			createVNode(_components.em, { children: "and" }),
			" record):"
		] }),
		"\n",
		createVNode(_components.pre, {
			class: "astro-code github-light",
			style: {
				backgroundColor: "#fff",
				color: "#24292e",
				overflowX: "auto"
			},
			tabindex: "0",
			"data-language": "plaintext",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "applyLocation(loc)            // the existing batch(openCodeAt + reveal + setPending) — \"assign\"" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "navigate(loc)  = applyLocation(loc) + history.push(loc)   // address-bar navigation" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "back()         = applyLocation(history.back())            // traverse — NO push" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "forward()      = applyLocation(history.forward())         // traverse — NO push" })
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"This split is mandatory, not cosmetic: if ",
			createVNode(_components.code, { children: "back" }),
			"/",
			createVNode(_components.code, { children: "forward" }),
			" went through the\nrecording path you’d get the classic ",
			createVNode(_components.em, { children: "“going back creates new history”" }),
			" bug.\nTraversal must apply-without-recording — which is why the split is a ",
			createVNode(_components.strong, { children: "phase-2\n(history) concern" }),
			", not what makes the engine extractable. The ",
			createVNode(_components.em, { children: "extraction" }),
			"\n(phase 1) leans on a different property of the same ",
			createVNode(_components.code, { children: "applyLocation" }),
			": it’s the\none organ that knows about modes and the pending-highlight signal, so it stays\nkolu-side while the rest of the engine graduates."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-feature-that-rides-out-for-free--unified-backforward",
			children: "The feature that rides out for free — unified back/forward"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Back/forward rides the extraction — the engine has history because a browser\ndoes, so phase 2 is mostly ",
			createVNode(_components.em, { children: "exposure" }),
			", not invention. Settled design (from the\noriginating discussion):"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Unified history, one stack." }),
				" Because ",
				createVNode(_components.code, { children: "targetMode" }),
				" lives ",
				createVNode(_components.em, { children: "inside" }),
				" the\nlocation, back/forward cross ",
				createVNode(_components.code, { children: "browse" }),
				"/",
				createVNode(_components.code, { children: "local" }),
				"/",
				createVNode(_components.code, { children: "branch" }),
				" naturally — exactly\nbrowser behavior. The per-mode ",
				createVNode(_components.code, { children: "selectedFileByMode" }),
				"\n",
				createVNode($$Cite, {
					file: "packages/client/src/right-panel/useRightPanel.ts",
					lines: "326-344"
				}),
				"\n",
				"becomes a ",
				createVNode(_components.em, { children: "derived view" }),
				" of “current location filtered to this mode,” not the\nsource of truth."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Tree clicks count as navigation." }),
				" ",
				createVNode(_components.code, { children: "handleSelect" }),
				"\n",
				createVNode($$Cite, {
					file: "packages/client/src/right-panel/CodeTab.tsx",
					lines: "515-542"
				}),
				"\n",
				"routes through ",
				createVNode(_components.code, { children: "navigate()" }),
				", so back returns to the previously-viewed file no\nmatter how you reached the current one."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Restore where you ",
					createVNode(_components.em, { children: "were" }),
					", not just what."
				] }),
				" A faithful entry is\n",
				createVNode(_components.code, { children: "{ location, scroll }" }),
				", where ",
				createVNode(_components.code, { children: "scroll" }),
				" is captured on the way ",
				createVNode(_components.em, { children: "out" }),
				"\n(",
				createVNode(_components.code, { children: "history.replaceTop" }),
				" before pushing the next) — browsers restore the scroll\nyou left, not the line you arrived at. Cheap v1: entry = inbound ",
				createVNode(_components.code, { children: "ref" }),
				" only,\nback re-fires the highlight (the ",
				createVNode(_components.code, { children: "equals:false" }),
				" pending signal already\nre-paints ",
				createVNode($$Cite, {
					file: "packages/client/src/right-panel/openInCodeTab.ts",
					lines: "62-69"
				}),
				"); faithful v2 reads live scroll from the renderer."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Keybinds" }),
				" — ",
				createVNode(_components.code, { children: "codeTabBack" }),
				"/",
				createVNode(_components.code, { children: "codeTabForward" }),
				" in ",
				createVNode(_components.code, { children: "input/actions.ts" }),
				"\n(browser-like ",
				createVNode(_components.code, { children: "Cmd/Ctrl+[" }),
				" / ",
				createVNode(_components.code, { children: "]" }),
				"), guarded to Code-tab focus; check\n",
				createVNode(_components.code, { children: "input/prohibitedKeybinds.ts" }),
				" and add the ",
				createVNode(_components.code, { children: "keyboard.test.ts" }),
				" collision case."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "building-it",
			children: "Building it"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "files-this-touches",
			children: "Files this touches"
		}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "The electricity — a new isolated package:" }) }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Package" }),
					"\n",
					createVNode(_components.th, { children: "Contents" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "packages/solid-browser" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "phases 1 + 2"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Shipped: ",
						createVNode(_components.code, { children: "relativePath.ts" }),
						" + ",
						createVNode(_components.code, { children: "previewPath.ts" }),
						" (phase 1) and ",
						createVNode(_components.code, { children: "createBrowser.ts" }),
						" — the generic reactive ",
						createVNode(_components.strong, { children: "history" }),
						" controller (phase 2) — with 42 unit tests + a standalone ",
						createVNode(_components.a, {
							href: "https://github.com/juspay/kolu/tree/master/packages/solid-browser/example/docsite",
							children: createVNode(_components.code, { children: "example/docsite" })
						}),
						" second host. deps: ",
						createVNode(_components.code, { children: "@kolu/url-shape" }),
						" (the DOM-free ",
						createVNode(_components.code, { children: "hasOwnScheme" }),
						" leaf) + ",
						createVNode(_components.code, { children: "solid-js" }),
						" (",
						createVNode(_components.code, { children: "createBrowser" }),
						"’s reactive stack). ",
						createVNode(_components.code, { children: "<Browser>" }),
						" composing ",
						createVNode(_components.code, { children: "<FileView>" }),
						" stays ",
						createVNode(_components.strong, { children: "deferred" }),
						" (see the phase-2 as-built callout). Zero kolu imports; builds + tests standalone."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "kolu — the consumer, now just git + chrome:" }) }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "File" }),
					"\n",
					createVNode(_components.th, { children: "Change" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "right-panel/useRightPanel.ts" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "phase 2"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Hosts a per-terminal ",
						createVNode(_components.code, { children: "Browser<BrowserLocation>" }),
						" (in-memory; seeded on restore, dropped on teardown) and exposes ",
						createVNode(_components.code, { children: "recordNavigation" }),
						"/",
						createVNode(_components.code, { children: "navigateBack" }),
						"/",
						createVNode(_components.code, { children: "navigateForward" }),
						"/",
						createVNode(_components.code, { children: "canNavigateBack" }),
						"/",
						createVNode(_components.code, { children: "canNavigateForward" }),
						". ",
						createVNode(_components.code, { children: "selectedFileByMode" }),
						" ",
						createVNode(_components.strong, { children: "stays" }),
						" the render + restore truth; history is ",
						createVNode(_components.em, { children: "additive" }),
						" over it."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "right-panel/CodeTab.tsx" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "phase 2"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Records every selection (tree click, in-iframe link, resolved front-door open) into history; ◀ ▶ toolbar buttons + a scoped ",
						createVNode(_components.code, { children: "Alt+←/→" }),
						" listener re-apply earlier locations. Cheap-v1 re-highlight rides the existing front-door pipeline."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "gitResolver.ts" }),
						" · ",
						createVNode(_components.code, { children: "<Browser>" }),
						" · unified ",
						createVNode(_components.code, { children: "navigate" }),
						" ",
						createVNode($$Pill, {
							variant: "todo",
							children: "deferred"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"The ",
						createVNode(_components.code, { children: "resolve(location)→FileData" }),
						" injection, the ",
						createVNode(_components.code, { children: "<Browser>" }),
						" component, and folding the two nav paths into one ",
						createVNode(_components.code, { children: "navigate" }),
						" wait on a uniform viewport — diffs don’t fit ",
						createVNode(_components.code, { children: "FileData" }),
						", so a ",
						createVNode(_components.code, { children: "<Browser>" }),
						" would wrap only browse mode (hollow). See the phase-2 as-built callout."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "right-panel/markdownImageSrc.ts" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "phase 1"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: "Delegates resolution to the package; keeps only the file-route URL build (real composition, not a pass-through)." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "right-panel/iframePreviewNav.ts" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "deleted (phase 1)"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"The agnostic inversion moved to the package; the kolu codec is bound ",
						createVNode(_components.em, { children: "inline" }),
						" at ",
						createVNode(_components.code, { children: "BrowseIframeRenderer" }),
						"’s call site — no thin wrapper (",
						createVNode(_components.code, { children: ".agency/code-police.md" }),
						" → ",
						createVNode(_components.code, { children: "no-thin-wrapper-functions" }),
						")."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "settings/tips.ts" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "+nav"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"A discoverability tip for back/forward. (No ",
						createVNode(_components.code, { children: "input/actions.ts" }),
						" entry: the keybind is a Code-tab-scoped listener, not a global action — a global ",
						createVNode(_components.code, { children: "mod+[" }),
						" would shadow the terminal’s ESC byte on Linux.)"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "phasing--extract-first-then-light-the-feature",
			children: "Phasing — extract first, then light the feature"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Extraction comes ",
			createVNode(_components.strong, { children: "before" }),
			" the feature, deliberately. Phase 1 is a ",
			createVNode(_components.em, { children: "pure,\nbehavior-preserving lift" }),
			" — the ",
			createVNode(_components.code, { children: "solid-fileview" }),
			" pattern (extract with kolu\nworking throughout, ",
			createVNode($$PrLink, { pr: 1082 }),
			"; let features ride the extraction\nafter). The subtle point: what gets extracted in phase 1 is ",
			createVNode(_components.strong, { children: "today’s\nnavigation, which is already proven code" }),
			" — the safest possible thing to move.\nThe ",
			createVNode(_components.em, { children: "new" }),
			" behavior (history) is then added to the clean package, never bolted\nonto the client that’s about to be gutted. There is no forced dependency either\nway; this ordering is chosen for risk isolation and single-purpose diffs (a\npure-move PR, then a pure-addition PR)."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "As-built: the phase boundary moved (discovered while building phase 1)",
			children: [createVNode(_components.p, { children: [
				"Reading the code revised where phase 1 stops. The two link paths navigate\n",
				createVNode(_components.strong, { children: "differently" }),
				" today — a Markdown link goes through the ",
				createVNode(_components.code, { children: "openInCodeTab" }),
				" front\ndoor (",
				createVNode(_components.code, { children: "allowBasenameFallback: false" }),
				"); an in-iframe link goes straight to\n",
				createVNode(_components.code, { children: "onNavigate" }),
				"→",
				createVNode(_components.code, { children: "handleSelect" }),
				". ",
				createVNode(_components.strong, { children: [
					"Unifying them behind one ",
					createVNode(_components.code, { children: "navigate()" }),
					" is a\nbehavior change"
				] }),
				", and a ",
				createVNode(_components.code, { children: "<Browser>" }),
				" that merely forwards to ",
				createVNode(_components.code, { children: "<FileView>" }),
				" is a\nhollow wrapper until it owns a history stack. So phase 1 shipped the honest,\nbehavior-preserving slice — the ",
				createVNode(_components.strong, { children: "agnostic link-nav primitives" }),
				" (relative-path"
			] }), createVNode(_components.ul, { children: [
				"\n",
				createVNode(_components.li, { children: [
					"preview-path resolution), extracted and re-consumed — and the ",
					createVNode(_components.code, { children: "BrowserLocation" }),
					"\nmodel / ",
					createVNode(_components.code, { children: "createBrowser" }),
					" / ",
					createVNode(_components.code, { children: "<Browser>" }),
					" / the ",
					createVNode(_components.code, { children: "CodeTab" }),
					" rewire / unified ",
					createVNode(_components.code, { children: "navigate" }),
					"\nmoved into ",
					createVNode(_components.strong, { children: "phase 2" }),
					", ",
					createVNode(_components.em, { children: "with" }),
					" history, where they have substance. The\nlens-defensible decomposition, not the checklist one. ",
					createVNode(_components.em, { children: [
						"(The review gauntlet then\npruned even further — see the lens-debate: it dropped a speculative ",
						createVNode(_components.code, { children: "location.ts" }),
						"\nI’d shipped early and extracted ",
						createVNode(_components.code, { children: "@kolu/url-shape" }),
						" so this package never depends on\na rendering one.)"
					] })
				] }),
				"\n"
			] })]
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Phase" }),
					"\n",
					createVNode(_components.th, { children: "Ships" }),
					"\n",
					createVNode(_components.th, { children: "Risk" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "1 · Extract the primitives" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1191 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "@kolu/solid-browser" }),
						" = ",
						createVNode(_components.code, { children: "relativePath" }),
						" + ",
						createVNode(_components.code, { children: "previewPath" }),
						" over the ",
						createVNode(_components.code, { children: "@kolu/url-shape" }),
						" leaf. kolu re-consumes: ",
						createVNode(_components.code, { children: "markdownImageSrc" }),
						" delegates resolution, ",
						createVNode(_components.code, { children: "BrowseIframeRenderer" }),
						" binds the ",
						createVNode(_components.code, { children: "previewPathCodec" }),
						", ",
						createVNode(_components.code, { children: "BrowseFileDispatcher" }),
						" imports ",
						createVNode(_components.code, { children: "resolveLinkHref" }),
						". ",
						createVNode(_components.strong, { children: "Behavior-preserving" }),
						" — the two nav paths stay distinct."
					] }),
					"\n",
					createVNode(_components.td, { children: "Low — pure-move + delegation, unit- + e2e-covered." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "2 · The browser proper + back/forward" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1191 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "createBrowser<L>()" }),
						" — the generic reactive ",
						createVNode(_components.strong, { children: "history" }),
						" controller (",
						createVNode(_components.code, { children: "navigate" }),
						"/",
						createVNode(_components.code, { children: "back" }),
						"/",
						createVNode(_components.code, { children: "forward" }),
						"/",
						createVNode(_components.code, { children: "current" }),
						"/",
						createVNode(_components.code, { children: "canBack" }),
						"/",
						createVNode(_components.code, { children: "canForward" }),
						"; forward-truncation; idempotent on same entry). kolu wires it into ",
						createVNode(_components.code, { children: "useRightPanel" }),
						"/",
						createVNode(_components.code, { children: "CodeTab" }),
						": every selection is ",
						createVNode(_components.strong, { children: "recorded" }),
						", ◀ ▶ buttons + scoped ",
						createVNode(_components.code, { children: "Alt+←/→" }),
						" re-apply, cheap-v1 re-highlight rides the front door. ",
						createVNode(_components.strong, { children: "As-built deltas" }),
						" (callout below): history is ",
						createVNode(_components.em, { children: "additive" }),
						" over ",
						createVNode(_components.code, { children: "selectedFileByMode" }),
						" (still the render truth), mode-chips don’t record, ",
						createVNode(_components.code, { children: "<Browser>" }),
						"/",
						createVNode(_components.code, { children: "gitResolver" }),
						"/unified ",
						createVNode(_components.code, { children: "navigate" }),
						" deferred."
					] }),
					"\n",
					createVNode(_components.td, { children: "Medium — live-surface refactor; the audit + the #818 regression suite guard the selection invariants." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "3 · Prove ③" }),
						" ",
						createVNode($$Pill, {
							variant: "warn",
							children: "in-repo demo landed"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.a, {
							href: "https://github.com/juspay/kolu/tree/master/packages/solid-browser/example/docsite",
							children: createVNode(_components.code, { children: "example/docsite" })
						}),
						" — a standalone doc browser over its own ",
						createVNode(_components.code, { children: "{ slug }" }),
						" location — reuses ",
						createVNode(_components.code, { children: "createBrowser" }),
						" unchanged (built + tested in CI). In-repo proof of reuse, exactly the bar ",
						createVNode(_components.code, { children: "@kolu/surface" }),
						"’s examples clear; a ",
						createVNode(_components.em, { children: "different application" }),
						" injecting its own ",
						createVNode(_components.code, { children: "resolve" }),
						" (drishti, an artifact viewer) is still the closing argument."
					] }),
					"\n",
					createVNode(_components.td, { children: "Low — pure-logic reuse." }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "As-built: phase 2 — the substance is the history controller, not a <Browser> shell",
			children: [createVNode(_components.p, { children: [
				"The adversarial audit (run before writing a line) reshaped phase 2 around what the\n",
				createVNode(_components.em, { children: "real" }),
				" Code tab is. Three load-bearing corrections:"
			] }), createVNode(_components.ul, { children: [
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: [
						createVNode(_components.code, { children: "createBrowser" }),
						" is the seam, not ",
						createVNode(_components.code, { children: "<Browser>" }),
						"."
					] }),
					" Diffs (Local/Branch) render\nthrough ",
					createVNode(_components.code, { children: "BrowseDiffView" }),
					", ",
					createVNode(_components.strong, { children: "not" }),
					" ",
					createVNode(_components.code, { children: "<FileView>" }),
					" — they don’t fit ",
					createVNode(_components.code, { children: "FileData" }),
					" — so a\n",
					createVNode(_components.code, { children: "<Browser>" }),
					" that “composes ",
					createVNode(_components.code, { children: "<FileView>" }),
					"” could only ever host ",
					createVNode(_components.em, { children: "browse" }),
					" mode. The\nmode-agnostic thing worth extracting is the ",
					createVNode(_components.strong, { children: "history controller" }),
					"; it lives\n",
					createVNode(_components.em, { children: "above" }),
					" both rendering paths, in ",
					createVNode(_components.code, { children: "useRightPanel" }),
					". ",
					createVNode(_components.code, { children: "<Browser>" }),
					" stays deferred (the\nsame hollow-wrapper logic phase 1 used to defer it)."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: [
						"History records; ",
						createVNode(_components.code, { children: "selectedFileByMode" }),
						" still renders."
					] }),
					" The persisted per-mode\nselection stays the single render + restore truth; the stack is ",
					createVNode(_components.em, { children: "additive" }),
					",\nrecording the sequence so back/forward can re-apply it. ",
					createVNode(_components.code, { children: "navigate" }),
					" is\n",
					createVNode(_components.strong, { children: ["idempotent on ", createVNode(_components.code, { children: "mode+path" })] }),
					", which dissolves the re-entrancy hazards (Pierre’s\nechoed ",
					createVNode(_components.code, { children: "onSelect" }),
					", the front-door resolution effect re-firing) into harmless\nin-place refreshes — the one property that must hold is “recorded at least once\nper real destination,” which rides the e2e-covered ",
					createVNode(_components.code, { children: "setSelectedFile" }),
					"."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Cheap-v1 re-highlight reuses the front door." }),
					" The line highlight is driven by\nthe ",
					createVNode(_components.code, { children: "handled()" }),
					" resolution record, not a side signal — so back-to-a-line\nre-issues through the same ",
					createVNode(_components.code, { children: "openInCodeTab" }),
					" pipeline rather than a parallel paint\npath. Mode-chip toggles don’t record (per-mode memory already restores the file);\nonly file views are history steps. The keybind is a Code-tab-scoped ",
					createVNode(_components.code, { children: "Alt+←/→" }),
					"\nlistener (a global ",
					createVNode(_components.code, { children: "mod+[" }),
					" would shadow the terminal’s ESC byte on Linux). The\nmouse’s dedicated back/forward (X1/X2) buttons drive it too — ",
					createVNode(_components.code, { children: "button" }),
					" 3/4,\npointer-scoped to the preview in kolu and app-wide in the docsite. Over a\n",
					createVNode(_components.em, { children: "sandboxed HTML preview" }),
					" the opaque-origin iframe traps the event, so the\nin-iframe artifact-sdk forwards it to the parent (the same postMessage bridge\nthat already follows in-frame link navigation); SVG/PDF previews carry no SDK,\nso the buttons are a no-op there. The native history navigation is suppressed\neither way so the buttons reach ",
					createVNode(_components.code, { children: "createBrowser" }),
					"\n(",
					createVNode(_components.a, {
						href: "https://github.com/juspay/kolu/issues/1192",
						children: "#1192"
					}),
					")."
				] }),
				"\n"
			] })]
		}),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Bottom line: don’t extract a history stack — that’s a transformer. Extract the\n",
			createVNode(_components.strong, { children: "browser" }),
			" the Code tab already is. The renderers are packaged\n(",
			createVNode(_components.code, { children: "@kolu/solid-fileview" }),
			", which it composes); what’s left smeared across the\nclient is the location + history + link-nav shell. Pull it into\n",
			createVNode(_components.code, { children: "@kolu/solid-browser" }),
			", inject git as a resolver, and back/forward arrives for\nfree. It clears ",
			createVNode(_components.a, {
				href: "electricity",
				children: "electricity"
			}),
			"’s hard-volatility bar where “history”\ndidn’t. Phase 2 shipped the history controller + the back/forward feature, and\n",
			createVNode(_components.code, { children: "example/docsite" }),
			" is a real in-repo second consumer of it — a different\n",
			createVNode(_components.em, { children: "application" }),
			" injecting its own ",
			createVNode(_components.code, { children: "resolve" }),
			" is the closing argument."
		] }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "The Code tab is a browser → @kolu/solid-browser",
	"description": "The real electricity hiding in the Code tab isn't a history stack — it's the browser. Extract the location + history + link-navigation shell that drives @kolu/solid-fileview over a resolver; back/forward falls out for free, and git becomes an injected resolver.",
	"parents": ["electricity", "feature"],
	"status": "implemented",
	"maturity": "seedling",
	"updated": "2026-06-10T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-code-tab-is-already-a-browser",
			"text": "The Code tab is already a browser"
		},
		{
			"depth": 3,
			"slug": "the-tell-the-renderers-are-already-extracted-the-shell-isnt",
			"text": "The tell: the renderers are already extracted; the shell isn’t"
		},
		{
			"depth": 3,
			"slug": "openincodetabrequest-is-already-a-url",
			"text": "OpenInCodeTabRequest is already a URL"
		},
		{
			"depth": 2,
			"slug": "the-electricity--kolusolid-browser",
			"text": "The electricity — @kolu/solid-browser"
		},
		{
			"depth": 3,
			"slug": "does-browser-clear-the-electricity-bar-where-history-didnt",
			"text": "Does “browser” clear the electricity bar where “history” didn’t?"
		},
		{
			"depth": 2,
			"slug": "the-design",
			"text": "The design"
		},
		{
			"depth": 3,
			"slug": "the-seam--split-assign-from-record",
			"text": "The seam — split assign from record"
		},
		{
			"depth": 3,
			"slug": "the-feature-that-rides-out-for-free--unified-backforward",
			"text": "The feature that rides out for free — unified back/forward"
		},
		{
			"depth": 2,
			"slug": "building-it",
			"text": "Building it"
		},
		{
			"depth": 3,
			"slug": "files-this-touches",
			"text": "Files this touches"
		},
		{
			"depth": 3,
			"slug": "phasing--extract-first-then-light-the-feature",
			"text": "Phasing — extract first, then light the feature"
		}
	];
}
var url = "src/content/atlas/solid-browser.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/solid-browser.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/solid-browser.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Chrome, Content, Content as default, file, frontmatter, getHeadings, url };
