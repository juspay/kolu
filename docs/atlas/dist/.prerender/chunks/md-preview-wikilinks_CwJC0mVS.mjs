import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$D2 } from "./D2_CXsCOQdn.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
//#region src/content/atlas/md-preview-wikilinks.mdx
var LinkProto = () => {
	const ext = {
		color: "#3454d1",
		textDecoration: "underline",
		textUnderlineOffset: "2px"
	};
	const wiki = {
		color: "#6d4ed6",
		textDecoration: "none",
		borderBottom: "1px solid #cdbef2",
		paddingBottom: "1px",
		fontWeight: 500
	};
	const Brk = ({ children }) => createVNode("span", {
		style: wiki,
		children: [
			createVNode("span", {
				style: {
					color: "#b3a3ec",
					marginRight: "1px"
				},
				children: "⟦"
			}),
			children,
			createVNode("span", {
				style: {
					color: "#b3a3ec",
					marginLeft: "1px"
				},
				children: "⟧"
			})
		]
	});
	const rows = [
		{
			src: "[the limitations doc](LIMITATIONS.md)",
			label: "regular markdown link",
			note: "underlined link-blue — unchanged",
			render: createVNode("a", {
				style: ext,
				children: "the limitations doc"
			})
		},
		{
			src: "[[Architecture]]",
			label: "wikilink",
			note: "violet, bracketed — reads as an internal note reference",
			render: createVNode(Brk, { children: "Architecture" })
		},
		{
			src: "[[Architecture|the arch doc]]",
			label: "wikilink · aliased",
			note: "alias is the visible text; same style",
			render: createVNode(Brk, { children: "the arch doc" })
		}
	];
	return createVNode("div", {
		style: {
			margin: "1.5rem 0",
			border: "1px solid #e6e2d6",
			borderRadius: "12px",
			overflow: "hidden",
			boxShadow: "0 2px 12px rgba(0,0,0,.06)",
			fontFamily: "ui-sans-serif,system-ui"
		},
		children: [createVNode("div", {
			style: {
				display: "flex",
				alignItems: "center",
				gap: ".5rem",
				padding: ".55rem .85rem",
				background: "#f4f1e8",
				borderBottom: "1px solid #e6e2d6"
			},
			children: [
				createVNode("span", { style: {
					width: "11px",
					height: "11px",
					borderRadius: "50%",
					background: "#ff5f56"
				} }),
				createVNode("span", { style: {
					width: "11px",
					height: "11px",
					borderRadius: "50%",
					background: "#ffbd2e"
				} }),
				createVNode("span", { style: {
					width: "11px",
					height: "11px",
					borderRadius: "50%",
					background: "#27c93f"
				} }),
				createVNode("span", {
					style: {
						marginLeft: ".5rem",
						font: "600 .72rem/1 ui-monospace,monospace",
						color: "#5b6470"
					},
					children: "Code tab · rendered Markdown preview"
				})
			]
		}), createVNode("div", {
			style: { background: "#fff" },
			children: rows.map((r, i) => createVNode("div", {
				style: {
					display: "grid",
					gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
					gap: "1rem",
					alignItems: "baseline",
					padding: ".7rem 1rem",
					borderTop: i === 0 ? "none" : "1px solid #f0ece2"
				},
				children: [createVNode("div", { children: [createVNode("code", {
					style: {
						fontSize: ".72rem",
						color: "#3454d1",
						background: "#f5f7ff",
						border: "1px solid #e2e8ff",
						borderRadius: "6px",
						padding: ".15rem .4rem",
						wordBreak: "break-all"
					},
					children: r.src
				}), createVNode("div", {
					style: {
						fontSize: ".68rem",
						color: "#8a8f97",
						marginTop: ".35rem",
						textTransform: "uppercase",
						letterSpacing: ".03em"
					},
					children: r.label
				})] }), createVNode("div", { children: [createVNode("div", {
					style: { fontSize: ".9rem" },
					children: r.render
				}), createVNode("div", {
					style: {
						fontSize: ".72rem",
						color: "#6a6f77",
						marginTop: ".3rem",
						lineHeight: 1.4
					},
					children: r.note
				})] })]
			}))
		})]
	});
};
var AmbiguityProto = () => createVNode("div", {
	style: {
		margin: "1.5rem 0",
		padding: "1.4rem 1.1rem 1.8rem",
		border: "1px solid #e6e2d6",
		borderRadius: "12px",
		background: "#fff",
		fontFamily: "ui-sans-serif,system-ui",
		boxShadow: "0 2px 12px rgba(0,0,0,.06)"
	},
	children: [createVNode("div", {
		style: {
			fontSize: ".9rem",
			color: "#1a1c20",
			position: "relative",
			display: "inline-block"
		},
		children: [
			"open the",
			" ",
			createVNode("span", {
				style: {
					color: "#6d4ed6",
					fontWeight: 500,
					borderBottom: "1px solid #cdbef2"
				},
				children: [
					createVNode("span", {
						style: { color: "#b3a3ec" },
						children: "⟦"
					}),
					"Note",
					createVNode("span", {
						style: { color: "#b3a3ec" },
						children: "⟧"
					})
				]
			}),
			" ",
			"doc",
			createVNode("div", {
				style: {
					position: "absolute",
					top: "1.7rem",
					left: "2.9rem",
					minWidth: "12rem",
					background: "#fff",
					border: "1px solid #e2dcd0",
					borderRadius: "8px",
					boxShadow: "0 8px 24px rgba(0,0,0,.14)",
					padding: ".25rem",
					zIndex: 1
				},
				children: ["a/Note.md", "b/Note.md"].map((p) => createVNode("div", {
					style: {
						font: ".72rem/1.2 ui-monospace,monospace",
						color: "#3a3f47",
						padding: ".4rem .55rem",
						borderRadius: "5px",
						cursor: "pointer",
						background: p === "a/Note.md" ? "#f1ecff" : "transparent"
					},
					children: p
				}))
			})
		]
	}), createVNode("div", {
		style: {
			marginTop: "4.2rem",
			fontSize: ".72rem",
			color: "#6a6f77"
		},
		children: [
			"Click on an ambiguous ",
			createVNode("code", { children: "[[Note]]" }),
			" (two ",
			createVNode("code", { children: "Note.md" }),
			") → a menu anchored to the link lists the matching files; pick one to open it."
		]
	})]
});
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		em: "em",
		h2: "h2",
		li: "li",
		p: "p",
		strong: "strong",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"Plan of record · shipped in ",
			createVNode($$PrLink, { pr: 1212 }),
			" · builds directly on the\nrelative-link work (the ",
			createVNode(_components.code, { children: "bug" }),
			" note ",
			createVNode(_components.em, { children: "“repo-relative links open the target\nfile”" }),
			", shipped in PR #1190). Verdict: ",
			createVNode($$Pill, { children: "~half a day, low risk" }),
			"."
		] }),
		"\n",
		"\n",
		"\n",
		createVNode(_components.h2, {
			id: "how-wikilinks-render-and-resolve",
			children: "How wikilinks render and resolve"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A wikilink is not a regular link with different syntax — it should ",
			createVNode(_components.em, { children: "look" }),
			" like a\ndifferent kind of reference. Regular Markdown links keep today’s link-blue\nunderline; a wikilink gets its own ",
			createVNode(_components.strong, { children: "violet, bracketed" }),
			" treatment that reads as\n“internal note reference,” uniformly, whether or not it resolves."
		] }),
		"\n",
		createVNode(LinkProto, {}),
		"\n",
		createVNode(_components.p, { children: [
			"Resolution is ",
			createVNode(_components.strong, { children: "lazy — on click" }),
			", never at render time. The preview doesn’t\npre-check every ",
			createVNode(_components.code, { children: "[[…]]" }),
			" against the file list to grey out dead ones; it renders\nthem all alike and resolves the one you actually click. That keeps the renderer a\npure presenter (no file-list dependency threaded into it) and matches how the\nrelative-link path already works."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Ambiguity is surfaced, not failed",
			children: createVNode(_components.p, { children: [
				"A terminal ",
				createVNode(_components.code, { children: "path:N" }),
				" click that hits an ambiguous basename fails closed (it can’t\nask which file you meant). A wikilink ",
				createVNode(_components.em, { children: "can" }),
				" ask: clicking ",
				createVNode(_components.code, { children: "[[Setup]]" }),
				" when two\n",
				createVNode(_components.code, { children: "Setup.md" }),
				" exist in different folders opens a small ",
				createVNode(_components.strong, { children: "disambiguation menu\nanchored to the link" }),
				" — the candidate paths, one click to open. A unique hit\nopens straight away; a miss toasts."
			] })
		}),
		"\n",
		createVNode(AmbiguityProto, {}),
		"\n",
		createVNode(_components.h2, {
			id: "the-hard-part--the-vault-index--already-ships",
			children: "The hard part — the vault index — already ships"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The obvious worry with Obsidian wikilinks is ",
			createVNode(_components.strong, { children: "resolution" }),
			": ",
			createVNode(_components.code, { children: "[[Architecture]]" }),
			"\nis ",
			createVNode(_components.em, { children: "pathless" }),
			" — it finds ",
			createVNode(_components.code, { children: "Architecture.md" }),
			" by basename, scanning the whole repo,\nwith no directory hint. That sounds like it needs a new file index."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"It doesn’t. ",
			createVNode(_components.code, { children: "fsListAll" }),
			" already streams ",
			createVNode(_components.code, { children: "git ls-files --cached --others --exclude-standard" }),
			" into the client (",
			createVNode(_components.code, { children: "integrations/git/src/browse.ts" }),
			"),\nmaterialised as ",
			createVNode(_components.code, { children: "treePaths()" }),
			" in ",
			createVNode(_components.code, { children: "CodeTab.tsx" }),
			" — a live, gitignore-respecting,\nNFC-normalised list of every repo path, already the back-end of the “open this\nfile” front door."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "What the resolver actually does",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "resolveWikilink(target, repoPaths)" }),
				" (",
				createVNode(_components.code, { children: "@kolu/solid-markdown" }),
				"’s ",
				createVNode(_components.code, { children: "wikilink.ts" }),
				",\nbeside its parser) matches the target’s basename against that list — ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: ".md" }), "\nimplied, Obsidian-style"] }),
				": a bare ",
				createVNode(_components.code, { children: "[[Architecture]]" }),
				" matches ",
				createVNode(_components.code, { children: "Architecture" }),
				" or\n",
				createVNode(_components.code, { children: "Architecture.md" }),
				", and ",
				createVNode(_components.em, { children: "nothing else" }),
				" (a same-stemmed ",
				createVNode(_components.code, { children: "Architecture.feature" }),
				" is\n",
				createVNode(_components.strong, { children: "not" }),
				" a match — matching any extension would make near every wikilink\nspuriously ambiguous). An explicit extension (",
				createVNode(_components.code, { children: "[[logo.png]]" }),
				") matches verbatim; a\nqualified ",
				createVNode(_components.code, { children: "[[docs/Note]]" }),
				" narrows to that directory. It returns ",
				createVNode(_components.code, { children: "unique" }),
				" /\n",
				createVNode(_components.code, { children: "none" }),
				" / ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "ambiguous" }), " with the candidate list"] }),
				" — the one thing the terminal\nresolver throws away (it collapses ambiguity to ",
				createVNode(_components.code, { children: "null" }),
				"), because surfacing the\ncandidates is what powers the menu."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Where it lives — by feature, not by topic",
			children: createVNode(_components.p, { children: [
				"The wikilink ",
				createVNode(_components.em, { children: "resolver" }),
				" lives in ",
				createVNode(_components.code, { children: "@kolu/solid-markdown" }),
				" next to its ",
				createVNode(_components.em, { children: "parser" }),
				": a\nwikilink is a Markdown construct, and the resolution rules (",
				createVNode(_components.code, { children: ".md" }),
				" implied,\nalias/heading, ambiguity-surfacing) are defined by the wikilink grammar — nothing\noutside Markdown resolves one. It’s a pure, node-pure, host-called export (like\n",
				createVNode(_components.code, { children: "url-policy" }),
				"’s ",
				createVNode(_components.code, { children: "safeHref" }),
				"), so it does not couple the renderer to the file list.\nIt is ",
				createVNode(_components.strong, { children: "not" }),
				" in ",
				createVNode(_components.code, { children: "@kolu/solid-browser" }),
				": that package’s concern is ",
				createVNode(_components.em, { children: "browsing" }),
				"\n(location, history, link interception, GitHub-relative path math). Its\n",
				createVNode(_components.code, { children: "resolveLinkHref" }),
				" — directory-relative ",
				createVNode(_components.code, { children: "[](…)" }),
				" resolution with no file list — is\na ",
				createVNode(_components.em, { children: "different concept" }),
				" that genuinely is a browsing concern and stays there. Two\nlink resolvers, two packages, split by feature rather than bundled under the word\n“link.”"
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-pieces",
			children: "The pieces"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The relative-link work (PR #1190) cut most of the seam: a tagged anchor, a host\ncallback, and the ",
			createVNode(_components.code, { children: "openInCodeTab" }),
			" front door. Wikilinks add a ",
			createVNode(_components.em, { children: "parser" }),
			" in front\nof it and a ",
			createVNode(_components.em, { children: "resolver + menu" }),
			" behind it."
		] }),
		"\n",
		createVNode($$D2, {
			caption: "The wikilink feature — parser, resolver, and host callback — lives wholly in @kolu/solid-markdown; the client dispatcher only wires it to the menu and the existing open-in-Code-tab front door. The marked extension mints a distinct data-md-wikilink anchor; resolveWikilink does the pathless, .md-implied vault match and surfaces candidates instead of collapsing to null. The sanitizer gains one allowlisted marker (and a guard that strips it from any escaping href); the front door and the file list are untouched.",
			code: `direction: down
md: "@kolu/solid-markdown — the wikilink feature" {
ext: "markedWikilink() — parses [[Note]] [[a|b]] [[a#h]] ![[embed]] → data-md-wikilink anchor"
res: "resolveWikilink(target, repoPaths) — pathless, .md-implied vault match → unique | none | ambiguous"
cb: "onNavigateWikilink(target, anchorEl) host callback"
}
disp: "client / BrowseFileDispatcher — host branch" {
menu: "unique ⇒ open · none ⇒ toast · ambiguous ⇒ OptionMenu anchored to the link"
}
front: "openInCodeTab — front door (existing)"
list: "treePaths() — fsListAll / git ls-files (existing)"
md.ext -> md.cb: "click"
md.cb -> disp.menu: "target + anchor"
disp.menu -> md.res: "target + repo vault"
md.res -> disp.menu: "resolution"
disp.menu -> front: "chosen path"
list -> disp.menu: "vault paths"
`
		}),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "markedWikilink() — desugar, don't reinvent",
			children: createVNode(_components.p, { children: [
				"A small inline tokenizer extension beside ",
				createVNode(_components.code, { children: "marked-alert" }),
				" / ",
				createVNode(_components.code, { children: "marked-footnote" }),
				" in\n",
				createVNode(_components.code, { children: "solid-markdown/src/render.ts" }),
				" (document variant only). It parses ",
				createVNode(_components.code, { children: "[[Target]]" }),
				",\n",
				createVNode(_components.code, { children: "[[Target|Alias]]" }),
				", ",
				createVNode(_components.code, { children: "[[Target#Heading]]" }),
				" and emits\n",
				createVNode(_components.code, { children: "<a href=\"Target\" data-md-wikilink>Alias</a>" }),
				". The marker is allowlisted so it\nsurvives DOMPurify; the link policy keys on it to skip the relative-link\ntreatment, and the click handler routes to the wikilink callback. The ",
				createVNode(_components.code, { children: "![[…]]" }),
				"\nembed form is parsed too — only to render it ",
				createVNode(_components.strong, { children: "inert" }),
				" (literal text), never\nexpanded."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Why a ",
			createVNode(_components.em, { children: "separate" }),
			" ",
			createVNode(_components.code, { children: "onNavigateWikilink" }),
			" callback rather than reusing\n",
			createVNode(_components.code, { children: "onNavigateRelative" }),
			": the two differ on two axes — the resolution model (pathless\nvault vs. the doc’s directory) and the need for the ",
			createVNode(_components.strong, { children: "clicked element" }),
			", so the\nhost can anchor the disambiguation menu to it. The menu itself is no new\nmachinery — it reuses ",
			createVNode(_components.code, { children: "OptionMenu" }),
			" + ",
			createVNode(_components.code, { children: "useAnchoredPopover" }),
			", the same anchored\noption-list the Dock and minimap pickers use. ",
			createVNode(_components.code, { children: "repoPaths" }),
			" is threaded from\n",
			createVNode(_components.code, { children: "CodeTab" }),
			" (which owns ",
			createVNode(_components.code, { children: "treePaths()" }),
			") down to the dispatcher, since the front door\nresolves internally and never exposes the candidate set the menu needs."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "scope",
			children: "Scope"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "In scope",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "[[Note]]" }),
				", ",
				createVNode(_components.code, { children: "[[Note|Alias]]" }),
				", ",
				createVNode(_components.code, { children: "[[Note#Heading]]" }),
				" — rendered distinctly, resolved\npathless and vault-wide on click, with an inline menu for ambiguous basenames and\na toast for misses."
			] })
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "![[embeds]]" }), " (transclusion) — no."] }),
				" Inlining a note’s body or an image is\n",
				createVNode(_components.em, { children: "not" }),
				" a link; it’s a render-time content splice with its own recursion, cycle,\nand sizing concerns. ",
				createVNode(_components.code, { children: "![[…]]" }),
				" is left as inert literal text, never expanded."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Heading scroll-after-open — out of scope." }),
				" A ",
				createVNode(_components.code, { children: "[[Note#Heading]]" }),
				" opens the\nfile; scrolling to ",
				createVNode(_components.code, { children: "#Heading" }),
				" ",
				createVNode(_components.em, { children: "inside" }),
				" it is not handled here — the same gap the\nrelative-link fix left for ",
				createVNode(_components.code, { children: "[]()" }),
				" fragments."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "why-this-stays-simple",
			children: "Why this stays simple"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "One concept, isolated volatility",
			children: createVNode(_components.p, { children: [
				"Wikilinks don’t fork the renderer. They’re a ",
				createVNode(_components.em, { children: "second parser" }),
				" (the ",
				createVNode(_components.code, { children: "[[…]]" }),
				" syntax)\nfeeding a ",
				createVNode(_components.em, { children: "second resolution model" }),
				" (pathless basename) into the ",
				createVNode(_components.strong, { children: "same" }),
				"\nopen-in-Code-tab front door. The genuinely new volatility — “how does this\ntoken’s target become a path, and what happens when it’s ambiguous?” — is\nisolated to one marked extension, one resolver, and one dispatcher branch. The\nsanitizer’s only contact is mechanical, not conceptual: it allowlists the\n",
				createVNode(_components.code, { children: "data-md-wikilink" }),
				" marker so the parser’s tag survives, and guards it (the marker\nis honored only for a safe, scheme-less, non-fragment href; an ",
				createVNode(_components.em, { children: "escaping" }),
				" one —\nexternal URL, unsafe scheme, or ",
				createVNode(_components.code, { children: "#frag" }),
				" — is stripped of the marker and falls\nthrough to the normal link policy). A README’s raw HTML can still mint the marker\non a safe internal path, and that’s deliberately kept: it just routes through the\nhost’s pathless resolver instead of the directory-relative one, and both stay\ninternal — neither escapes the app origin. The sanitizer never learns what a\nwikilink ",
				createVNode(_components.em, { children: "means" }),
				". The file list and the front door are untouched."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: "The earlier instinct to call resolution “moderate effort” was wrong: it assumed a\nfile index that turned out to already ship. With that corrected, the whole\nfeature — distinct rendering, pathless resolution, and the ambiguity menu — is a\nhalf-day, low-risk change. Transclusion is a deliberate no; heading-scroll is out\nof scope." })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Markdown preview: Obsidian-style [[wikilinks]]",
	"description": "Support [[Note]] / [[Note|alias]] / [[Note#heading]] wikilinks in the Code-tab Markdown preview — a distinct rendered style, pathless vault-wide resolution on click, and an inline disambiguation menu when a basename is ambiguous.",
	"parents": ["solid-fileview", "feature"],
	"status": "implemented",
	"maturity": "seedling",
	"updated": "2026-06-06T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "how-wikilinks-render-and-resolve",
			"text": "How wikilinks render and resolve"
		},
		{
			"depth": 2,
			"slug": "the-hard-part--the-vault-index--already-ships",
			"text": "The hard part — the vault index — already ships"
		},
		{
			"depth": 2,
			"slug": "the-pieces",
			"text": "The pieces"
		},
		{
			"depth": 2,
			"slug": "scope",
			"text": "Scope"
		},
		{
			"depth": 2,
			"slug": "why-this-stays-simple",
			"text": "Why this stays simple"
		}
	];
}
var url = "src/content/atlas/md-preview-wikilinks.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/md-preview-wikilinks.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/md-preview-wikilinks.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { AmbiguityProto, Content, Content as default, LinkProto, file, frontmatter, getHeadings, url };
