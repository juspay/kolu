import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
//#region src/diagrams/md-preview-footnotes-reuse.svg?raw
var md_preview_footnotes_reuse_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 820 392\" font-family=\"ui-sans-serif, system-ui, sans-serif\">\n  <rect x=\"0.5\" y=\"0.5\" width=\"819\" height=\"391\" rx=\"14\" fill=\"#15171c\" stroke=\"#2a2e37\"/>\n\n  <!-- title -->\n  <text x=\"32\" y=\"36\" fill=\"#c7ccd6\" font-weight=\"650\" font-size=\"16\">Footnote popups reuse the wikilink seam — no new package</text>\n\n  <!-- legend -->\n  <rect x=\"560\" y=\"24\" width=\"15\" height=\"11\" rx=\"3\" fill=\"none\" stroke=\"#6cc070\" stroke-width=\"1.4\"/>\n  <text x=\"580\" y=\"34\" fill=\"#8b929d\" font-size=\"11.5\">exists / reused</text>\n  <rect x=\"690\" y=\"24\" width=\"15\" height=\"11\" rx=\"3\" fill=\"none\" stroke=\"#d6a35c\" stroke-width=\"1.4\" stroke-dasharray=\"4 3\"/>\n  <text x=\"710\" y=\"34\" fill=\"#8b929d\" font-size=\"11.5\">this plan</text>\n\n  <!-- trigger pill -->\n  <rect x=\"80\" y=\"54\" width=\"246\" height=\"30\" rx=\"15\" fill=\"#182230\" stroke=\"#6ea8e0\" stroke-width=\"1.4\"/>\n  <text x=\"203\" y=\"73\" text-anchor=\"middle\" fill=\"#cfe0f5\" font-weight=\"600\" font-size=\"12\">① reader clicks a [n] footnote marker</text>\n  <line x1=\"203\" y1=\"84\" x2=\"203\" y2=\"100\" stroke=\"#3a4150\" stroke-width=\"1.5\"/>\n  <path d=\"M197,94 L203,101 L209,94\" fill=\"none\" stroke=\"#3a4150\" stroke-width=\"1.4\"/>\n\n  <!-- LEFT panel: @kolu/solid-markdown (flows downward) -->\n  <rect x=\"28\" y=\"102\" width=\"350\" height=\"250\" rx=\"12\" fill=\"#12151a\" stroke=\"#2a2e37\"/>\n  <text x=\"46\" y=\"126\" fill=\"#c7ccd6\" font-weight=\"650\" font-size=\"14\">@kolu/solid-markdown</text>\n  <text x=\"46\" y=\"143\" fill=\"#8b929d\" font-size=\"10.5\">the leaf — gains exactly one callback</text>\n\n  <rect x=\"46\" y=\"152\" width=\"314\" height=\"50\" rx=\"9\" fill=\"#161a20\" stroke=\"#3f6b45\" stroke-width=\"1\"/>\n  <text x=\"60\" y=\"173\" fill=\"#c7ccd6\" font-weight=\"600\" font-size=\"12\">bindInteractions · onClick</text>\n  <text x=\"60\" y=\"190\" fill=\"#8b929d\" font-size=\"9.5\" font-family=\"ui-monospace, SFMono-Regular, monospace\">delegated — links &amp; scroll already dispatch here</text>\n\n  <line x1=\"203\" y1=\"202\" x2=\"203\" y2=\"212\" stroke=\"#3a4150\" stroke-width=\"1.5\"/>\n  <path d=\"M197,206 L203,213 L209,206\" fill=\"none\" stroke=\"#3a4150\" stroke-width=\"1.4\"/>\n\n  <rect x=\"46\" y=\"212\" width=\"314\" height=\"50\" rx=\"9\" fill=\"#161a20\" stroke=\"#3f6b45\" stroke-width=\"1\"/>\n  <text x=\"60\" y=\"233\" fill=\"#c7ccd6\" font-weight=\"600\" font-size=\"12\">querySelector('#md-footnote-n') → &lt;li&gt;</text>\n  <text x=\"60\" y=\"250\" fill=\"#8b929d\" font-size=\"9.5\" font-family=\"ui-monospace, SFMono-Regular, monospace\">the scroll branch's own lookup, reused</text>\n\n  <line x1=\"203\" y1=\"262\" x2=\"203\" y2=\"272\" stroke=\"#3a4150\" stroke-width=\"1.5\"/>\n  <path d=\"M197,266 L203,273 L209,266\" fill=\"none\" stroke=\"#3a4150\" stroke-width=\"1.4\"/>\n\n  <rect x=\"46\" y=\"272\" width=\"314\" height=\"60\" rx=\"9\" fill=\"#1d1a14\" stroke=\"#7a5e34\" stroke-width=\"1.1\" stroke-dasharray=\"4 3\"/>\n  <text x=\"60\" y=\"294\" fill=\"#e8c98f\" font-weight=\"600\" font-size=\"12.5\">onFootnote(anchor, defNode)</text>\n  <text x=\"60\" y=\"312\" fill=\"#c7ccd6\" font-size=\"10\" font-family=\"ui-monospace, SFMono-Regular, monospace\">NEW</text>\n  <text x=\"60\" y=\"326\" fill=\"#8b929d\" font-size=\"10\">the package's only added surface</text>\n\n  <!-- bridge: the callback fires outward to the host -->\n  <text x=\"410\" y=\"298\" text-anchor=\"middle\" fill=\"#8b929d\" font-size=\"9.5\">callback</text>\n  <line x1=\"378\" y1=\"304\" x2=\"436\" y2=\"304\" stroke=\"#6ea8e0\" stroke-width=\"1.6\"/>\n  <path d=\"M436,298 L444,304 L436,310\" fill=\"none\" stroke=\"#6ea8e0\" stroke-width=\"1.6\"/>\n\n  <!-- RIGHT panel: client (flows upward — result bubbles up to the visible panel) -->\n  <rect x=\"442\" y=\"102\" width=\"350\" height=\"250\" rx=\"12\" fill=\"#12151a\" stroke=\"#2a2e37\"/>\n  <text x=\"460\" y=\"126\" fill=\"#c7ccd6\" font-weight=\"650\" font-size=\"14\">client</text>\n  <text x=\"460\" y=\"143\" fill=\"#8b929d\" font-size=\"10.5\">renders the overlay — as it does for wikilinks</text>\n\n  <rect x=\"460\" y=\"152\" width=\"314\" height=\"60\" rx=\"9\" fill=\"#1d1a14\" stroke=\"#7a5e34\" stroke-width=\"1.1\" stroke-dasharray=\"4 3\"/>\n  <text x=\"474\" y=\"174\" fill=\"#e8c98f\" font-weight=\"600\" font-size=\"12.5\">footnote popover panel</text>\n  <text x=\"474\" y=\"192\" fill=\"#c7ccd6\" font-size=\"9.5\" font-family=\"ui-monospace, SFMono-Regular, monospace\">cloned &lt;li&gt; · ↩ back-refs stripped</text>\n  <text x=\"474\" y=\"206\" fill=\"#8b929d\" font-size=\"9.5\">inner links flow through host resolvers</text>\n\n  <line x1=\"617\" y1=\"222\" x2=\"617\" y2=\"212\" stroke=\"#3a4150\" stroke-width=\"1.5\"/>\n  <path d=\"M611,218 L617,211 L623,218\" fill=\"none\" stroke=\"#3a4150\" stroke-width=\"1.4\"/>\n\n  <rect x=\"460\" y=\"222\" width=\"314\" height=\"50\" rx=\"9\" fill=\"#161a20\" stroke=\"#3f6b45\" stroke-width=\"1\"/>\n  <text x=\"474\" y=\"243\" fill=\"#c7ccd6\" font-weight=\"600\" font-size=\"12\">useAnchoredPopover + &lt;Portal&gt;</text>\n  <text x=\"474\" y=\"260\" fill=\"#8b929d\" font-size=\"9.5\" font-family=\"ui-monospace, SFMono-Regular, monospace\">the wikilink menu reuses this exact hook</text>\n\n  <line x1=\"617\" y1=\"282\" x2=\"617\" y2=\"272\" stroke=\"#3a4150\" stroke-width=\"1.5\"/>\n  <path d=\"M611,278 L617,271 L623,278\" fill=\"none\" stroke=\"#3a4150\" stroke-width=\"1.4\"/>\n\n  <rect x=\"460\" y=\"282\" width=\"314\" height=\"50\" rx=\"9\" fill=\"#161a20\" stroke=\"#3f6b45\" stroke-width=\"1\"/>\n  <text x=\"474\" y=\"303\" fill=\"#c7ccd6\" font-weight=\"600\" font-size=\"12\">BrowseFileDispatcher</text>\n  <text x=\"474\" y=\"320\" fill=\"#8b929d\" font-size=\"9.5\" font-family=\"ui-monospace, SFMono-Regular, monospace\">already wires onNavigateWikilink</text>\n\n  <!-- caption -->\n  <text x=\"32\" y=\"374\" fill=\"#6b7280\" font-size=\"10.5\">Nothing new to install. The dependency arrow (client → @kolu/solid-markdown) is preserved — the overlay stays client-side, exactly as wikilink disambiguation does.</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/md-preview-footnotes.mdx
var docText = {
	fontFamily: "Georgia, 'Times New Roman', serif",
	fontSize: "0.92rem",
	lineHeight: 1.7,
	color: "#1f2328"
};
var Sup = ({ children, live }) => createVNode("sup", {
	style: {
		"font-size": "0.7em",
		"vertical-align": "super",
		color: live ? "#5a3ff0" : "#3454d1",
		"font-family": "ui-sans-serif, system-ui",
		"font-weight": 600,
		...live ? {
			outline: "2px solid #c9bdf7",
			"border-radius": "3px",
			padding: "0 2px"
		} : {}
	},
	children: [
		"[",
		children,
		"]"
	]
});
var Tag = ({ children, bg, fg, border }) => createVNode("span", {
	style: {
		display: "inline-block",
		"font-family": "ui-sans-serif, system-ui",
		"font-size": "0.72rem",
		"font-weight": 600,
		color: fg,
		background: bg,
		border: `1px solid ${border}`,
		"border-radius": "999px",
		padding: "0.1rem 0.6rem",
		"margin-bottom": "0.6rem"
	},
	children
});
var Card = ({ children }) => createVNode("div", {
	style: {
		flex: "1 1 280px",
		"min-width": "280px",
		border: "1px solid #e2e2e6",
		"border-radius": "12px",
		padding: "1rem 1.1rem",
		background: "#fbfbfd"
	},
	children
});
var ScrollPain = () => createVNode(Card, { children: [
	createVNode(Tag, {
		bg: "#fdecea",
		fg: "#b42318",
		border: "#f3c9c4",
		children: "today — scroll down, then back"
	}),
	createVNode("div", {
		style: docText,
		children: [
			"…the daemon promotes the surface only once it settles",
			createVNode(Sup, { children: "1" }),
			", which is why a cold start looks idle for a beat."
		]
	}),
	createVNode("div", {
		style: {
			margin: "0.9rem 0",
			"text-align": "center",
			color: "#b9b9c2",
			"font-family": "ui-sans-serif, system-ui",
			"font-size": "0.72rem",
			"letter-spacing": "0.08em"
		},
		children: "⌄ \xA0 scroll past the whole document \xA0 ⌄"
	}),
	createVNode("div", {
		style: {
			"border-top": "1px solid #e2e2e6",
			"padding-top": "0.5rem",
			color: "#6b7280",
			"font-family": "ui-sans-serif, system-ui",
			"font-size": "0.8rem"
		},
		children: [createVNode("strong", {
			style: { "font-size": "0.85rem" },
			children: "Footnotes"
		}), createVNode("div", {
			style: { "margin-top": "0.3rem" },
			children: ["1. The settle gate waits for the first PTY frame. ", createVNode("span", {
				style: { color: "#3454d1" },
				children: "↩"
			})]
		})]
	})
] });
var PopoverShot = () => createVNode(Card, { children: [createVNode(Tag, {
	bg: "#eef0ff",
	fg: "#3a2bb0",
	border: "#cdc4f5",
	children: "this plan — click → popover"
}), createVNode("div", {
	style: {
		position: "relative",
		...docText
	},
	children: [
		"…the daemon promotes the surface only once it settles",
		createVNode(Sup, {
			live: true,
			children: "1"
		}),
		", which is why a cold start looks idle for a beat.",
		createVNode("div", {
			style: {
				"margin-top": "0.55rem",
				width: "min(100%, 320px)",
				background: "#ffffff",
				border: "1px solid #d4cbff",
				"border-radius": "10px",
				"box-shadow": "0 8px 24px rgba(40,30,90,0.16)",
				padding: "0.7rem 0.85rem",
				"font-family": "ui-sans-serif, system-ui",
				"font-size": "0.82rem",
				color: "#2a2a33",
				"line-height": 1.5
			},
			children: [
				createVNode("span", {
					style: {
						color: "#6d4ed6",
						"font-weight": 700,
						"margin-right": "0.35rem"
					},
					children: "1"
				}),
				"The settle gate waits for the first PTY frame — see",
				createVNode("span", {
					style: {
						color: "#3454d1",
						"text-decoration": "underline",
						"text-underline-offset": "2px"
					},
					children: " the daemon note"
				}),
				".",
				createVNode("div", {
					style: {
						"margin-top": "0.5rem",
						"border-top": "1px solid #efefef",
						"padding-top": "0.4rem",
						display: "flex",
						"justify-content": "space-between",
						"align-items": "center",
						color: "#9a9aa6",
						"font-size": "0.72rem"
					},
					children: [createVNode("span", { children: "click outside · scroll to dismiss" }), createVNode("span", {
						style: { color: "#6d4ed6" },
						children: "see all ↓"
					})]
				})
			]
		})
	]
})] });
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		li: "li",
		p: "p",
		strong: "strong",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"Shipped in ",
			createVNode($$PrLink, { pr: 1514 }),
			". The document preview already\nrenders GFM footnotes (",
			createVNode(_components.code, { children: "marked-footnote" }),
			") — the reference is a superscript\n",
			createVNode(_components.code, { children: "[n]" }),
			" that links to a definitions list at the very bottom. Reading one means\nscrolling down, reading, and scrolling back to where you were. This change keeps\nthat bottom list but adds a ",
			createVNode(_components.strong, { children: "click popover" }),
			": tap the marker, read the\nfootnote in place, dismiss. It threads the ",
			createVNode(_components.em, { children: "same" }),
			" click seam the wikilink and\nrelative-link previews already use, so it added ",
			createVNode(_components.strong, { children: "no dependency and no new\npackage" }),
			". Verdict: ",
			createVNode($$Pill, { children: "~half a day, low risk" }),
			" — the decisions below\ntook the simplest branch at every fork (dismiss-on-scroll, click/tap only,\n",
			createVNode(_components.code, { children: "useAnchoredPopover" }),
			" untouched)."
		] }),
		"\n",
		"\n",
		"\n",
		"\n",
		"\n",
		"\n",
		"\n",
		createVNode(_components.h2, {
			id: "what-the-reader-sees",
			children: "What the reader sees"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A footnote marker becomes a button. Click (or tap) the small ",
			createVNode(_components.code, { children: "[1]" }),
			" — the marker\ncarries a pointer cursor and a subtle hover highlight so it reads as clickable —\nand its definition opens in a card anchored just under the marker, where your\neye already is. Click anywhere else, scroll the document, or click the marker\nagain, and it closes. The gesture is identical on a trackpad and on a phone —\nthere is no hover step, so nothing is stranded on touch."
		] }),
		"\n",
		createVNode("div", {
			style: {
				display: "flex",
				gap: "1rem",
				flexWrap: "wrap",
				margin: "1.5rem 0"
			},
			children: [createVNode(ScrollPain, {}), createVNode(PopoverShot, {})]
		}),
		"\n",
		createVNode(_components.p, { children: "The details that matter to a reader:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The bottom “Footnotes” section stays exactly as it is." }),
				" It is still the\nprintable, copyable, screen-reader-navigable record of every note — and it is\nwhere the popover reads its content from. The popover is an ",
				createVNode(_components.em, { children: "additional" }),
				" way\nin, not a replacement."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The popover keeps a “see all ↓” link." }), " A small footer link scrolls to the\nmatching entry in the bottom section and closes the popover — today’s\nscroll-to-definition, preserved as a deliberate secondary path for readers who\nwant the whole list."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Footnote bodies can be rich." }),
				" A note may run to several paragraphs or carry\na link, a ",
				createVNode(_components.code, { children: "[[wikilink]]" }),
				", inline code, or an image. The panel renders the full\nbody and scrolls if it is tall; any link inside it still opens the right way,\nbecause it rides the preview’s existing resolvers (relative links open the\nfile, wikilinks resolve vault-wide, images load through the repo route)."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				"The back-reference ",
				createVNode(_components.code, { children: "↩" }),
				" is unaffected."
			] }), " It still lives in the bottom section\nand still jumps back to the marker; it never opens a popover."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Click and tap only, for now." }),
				" Opening is a pointer gesture: the\ninterception is gated on a pointer activation, so pressing ",
				createVNode(_components.strong, { children: "Enter" }),
				" on a\nfocused marker keeps the old jump-to-definition scroll to the bottom section —\nthe accessible record — rather than opening an unmanaged popover. A\nmanaged-focus popover with a screen-reader relationship is a deliberate\nfollow-up (see §Implementation)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, { children: createVNode(_components.p, { children: [
			"Only the ",
			createVNode(_components.strong, { children: "document" }),
			" preview is in scope — and that is by construction, not a\nlimitation. The compact/inline chat slots strip the whole footnotes\n",
			createVNode(_components.code, { children: "<section>" }),
			" during sanitization, so a footnote definition does not exist in\ntheir DOM and there is nothing to pop. The feature naturally no-ops there."
		] }) }),
		"\n",
		createVNode(_components.h2, {
			id: "architecture--a-leaf-that-reuses-the-wikilink-seam",
			children: "Architecture — a leaf that reuses the wikilink seam"
		}),
		"\n",
		createVNode($$Svg, {
			svg: md_preview_footnotes_reuse_default,
			caption: "A footnote click threads the same three seams alerts and wikilinks already use. The package gains one callback; the client renders the overlay with the hook the wikilink-disambiguation menu already uses."
		}),
		"\n",
		createVNode(_components.p, { children: [
			"This is a ",
			createVNode(_components.strong, { children: "leaf" }),
			", not a new ",
			createVNode(_components.code, { children: "@kolu/*" }),
			" package. Apply the electricity test: a\nfootnote popover hides only ",
			createVNode(_components.em, { children: "bounded" }),
			" logic — pair a marker to its definition\n",
			createVNode(_components.code, { children: "<li>" }),
			" by id, then place a panel beside it. It hides no hard volatility —\nno transport, no reconnect, no persistence, no GPU-context loss — so it fails\nall three extraction tests. Nothing to receptacle; nothing to install."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The boundary it must respect is the dependency arrow." }),
			" ",
			createVNode(_components.code, { children: "@kolu/solid-markdown" }),
			"\ndepends only on ",
			createVNode(_components.code, { children: "solid-js" }),
			", ",
			createVNode(_components.code, { children: "marked*" }),
			", ",
			createVNode(_components.code, { children: "dompurify" }),
			", ",
			createVNode(_components.code, { children: "shiki" }),
			", ",
			createVNode(_components.code, { children: "yaml" }),
			", and two\ntiny leaf utils — it has ",
			createVNode(_components.em, { children: "zero" }),
			" knowledge of the client app, of Corvu, or of\n",
			createVNode(_components.code, { children: "Portal" }),
			", and the arrow points outward (client → package). The package already\nhands hard, host-specific decisions back across that arrow rather than owning\nthem: ",
			createVNode(_components.code, { children: "onNavigateRelative" }),
			" and ",
			createVNode(_components.code, { children: "onNavigateWikilink" }),
			" exist precisely because\n",
			createVNode(_components.em, { children: "resolving" }),
			" a link is host volatility. ",
			createVNode(_components.strong, { children: "Footnote popovers split along the same\nseam:" })
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Inside the package" }),
				" (",
				createVNode(_components.code, { children: "@kolu/solid-markdown" }),
				"): the delegated ",
				createVNode(_components.code, { children: "onClick" }),
				" in\n",
				createVNode(_components.code, { children: "bindInteractions" }),
				" already inspects every clicked anchor and already does the\n",
				createVNode(_components.code, { children: "el.querySelector('#…')" }),
				" lookup that scrolls an in-page anchor into view. It\ngrows one branch — recognise a footnote marker, find its definition node, and\nfire a ",
				createVNode(_components.strong, { children: [
					"new ",
					createVNode(_components.code, { children: "onFootnote(anchor, definition)" }),
					" callback"
				] }),
				". That callback is the\npackage’s ",
				createVNode(_components.em, { children: "entire" }),
				" new surface."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Inside the client" }),
				" (",
				createVNode(_components.code, { children: "BrowseFileDispatcher" }),
				"): the host catches ",
				createVNode(_components.code, { children: "onFootnote" }),
				"\nand renders the popover with ",
				createVNode(_components.code, { children: "useAnchoredPopover" }),
				" + ",
				createVNode(_components.code, { children: "<Portal>" }),
				" — the ",
				createVNode(_components.em, { children: "exact" }),
				"\nhook the wikilink-disambiguation menu already uses to anchor a panel to a\nclicked marker in this same preview. Overlay rendering — and any positioning\nlibrary — stays on the client side of the arrow, where it already lives."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The verdict is contingent on the click model (§ the Architecture⇄Implementation\nloop)." }),
			" Because we open on ",
			createVNode(_components.em, { children: "click" }),
			", the existing ",
			createVNode(_components.code, { children: "useAnchoredPopover" }),
			" fits with\nno new dependency — it is built for click-to-open, outside-click/Escape-dismiss\npanels. Had we chosen a ",
			createVNode(_components.em, { children: "hover" }),
			" hovercard, we would have needed hover-intent\ntiming plus ",
			createVNode(_components.code, { children: "floating-ui" }),
			"-style ",
			createVNode(_components.code, { children: "autoUpdate" }),
			" scroll-tracking that\n",
			createVNode(_components.code, { children: "useAnchoredPopover" }),
			" does not have, which would have pulled a positioning\ndependency (likely ",
			createVNode(_components.code, { children: "@corvu/tooltip" }),
			") into play and pressured this boundary. The\n“leaf, no new package, no new dep” verdict ",
			createVNode(_components.em, { children: "is" }),
			" the click decision; a different\ntrigger model would have produced a different shape."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "implementation--one-pr-threading-the-existing-seams",
			children: "Implementation — one PR, threading the existing seams"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"One PR, built test-first — the change is small because it is almost entirely\n",
			createVNode(_components.em, { children: "wiring into" }),
			" seams that already exist. It threads the same render → sanitize →\ninteract → host-overlay path that alerts (",
			createVNode(_components.code, { children: "data-md-alert" }),
			") and wikilinks\n(",
			createVNode(_components.code, { children: "data-md-wikilink" }),
			") already proved, so there is nothing to stage across\nreleases: the package gains one callback and the client renders one panel, in\nthe same diff."
		] }),
		"\n",
		createVNode($$Callout, { children: createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Decisions locked — build-ready." }),
			" Open on ",
			createVNode(_components.strong, { children: "click / tap only" }),
			" (keyboard +\nscreen-reader relationship are a tracked follow-up). ",
			createVNode(_components.strong, { children: "Dismiss on scroll" }),
			", so\nthe shared ",
			createVNode(_components.code, { children: "useAnchoredPopover" }),
			" stays untouched. The popover keeps a ",
			createVNode(_components.strong, { children: "“see\nall ↓”" }),
			" link to the bottom section. The marker gets a ",
			createVNode(_components.strong, { children: "pointer-cursor + hover\nhighlight" }),
			" affordance and ",
			createVNode(_components.strong, { children: "no tip" }),
			". Detection is a parser-minted\n",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "data-md-footnote" }) }),
			" flag (not structural). Scope is the ",
			createVNode(_components.strong, { children: "document" }),
			" preview\nonly."
		] }) }),
		"\n",
		createVNode(_components.h3, {
			id: "package-side--pin-the-contract-then-one-marker-and-one-callback",
			children: "Package side — pin the contract, then one marker and one callback"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"DOMPurify is brutal on footnote markup. ",
			createVNode(_components.code, { children: "marked-footnote@1.4.0" }),
			" (the version\n",
			createVNode(_components.code, { children: "^1.2.4" }),
			" actually resolves to) emits a forward ref as\n",
			createVNode(_components.code, { children: "<sup><a id=\"footnote-ref-1\" href=\"#footnote-1\" data-footnote-ref aria-describedby=\"footnote-label\">1</a></sup>" }),
			"\n— note there is ",
			createVNode(_components.strong, { children: ["no ", createVNode(_components.code, { children: "class" })] }),
			" on it (the plan’s earlier “",
			createVNode(_components.code, { children: "class=\"footnote-ref\"" }),
			"”\nwas wrong); the distinctive marker is the bare ",
			createVNode(_components.code, { children: "data-footnote-ref" }),
			" attribute, and\nthe back-ref carries ",
			createVNode(_components.code, { children: "data-footnote-backref" }),
			". The sanitizer strips ",
			createVNode(_components.code, { children: "data-footnote-*" }),
			"\nand ",
			createVNode(_components.code, { children: "aria-describedby" }),
			" and namespaces ids/",
			createVNode(_components.code, { children: "#" }),
			"-hrefs with an ",
			createVNode(_components.code, { children: "md-" }),
			" prefix, so what\nsurvives is ",
			createVNode(_components.code, { children: "<sup><a id=\"md-footnote-ref-1\" href=\"#md-footnote-1\" data-md-footnote>1</a></sup>" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The whole feature stands on that markup, and the version floats — so ",
			createVNode(_components.strong, { children: "pin the\ncontract the way this package already does" }),
			": a ",
			createVNode(_components.em, { children: "node" }),
			" render test. ",
			createVNode(_components.code, { children: "@kolu/solid-markdown" }),
			"’s\n",
			createVNode(_components.code, { children: "vitest.config.ts" }),
			" deliberately keeps a Node-only environment (“the sanitize\nlayer is covered by the browser e2e suite, not here”), and ",
			createVNode(_components.code, { children: "data-md-wikilink" }),
			" /\n",
			createVNode(_components.code, { children: "data-md-alert" }),
			" survival is e2e-covered, not unit — adding ",
			createVNode(_components.code, { children: "happy-dom" }),
			" (absent\nfrom the repo) just to unit-test sanitization would contradict that boundary. So\nthe red-first test lives in ",
			createVNode(_components.code, { children: "render.test.ts" }),
			": feed footnote markdown through\n",
			createVNode(_components.code, { children: "renderMarkdownToRawHtml" }),
			" and assert ",
			createVNode(_components.code, { children: "rewriteFootnotes" }),
			" flags exactly the forward\nrefs with ",
			createVNode(_components.code, { children: "data-md-footnote" }),
			" (the back-ref untagged, every re-cite tagged) — a\n",
			createVNode(_components.code, { children: "marked-footnote" }),
			" bump that changed the marker then fails loudly. Marker→popover\nsurvival rides the e2e. With that pinned, three small changes mint the marker and\nroute the click — the package’s only new surface:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "render.ts" }),
					" — ",
					createVNode(_components.code, { children: "rewriteFootnotes(html)" })
				] }),
				", a sibling of the existing\n",
				createVNode(_components.code, { children: "rewriteAlerts" }),
				". It runs on the ",
				createVNode(_components.em, { children: "pre-sanitize" }),
				" string, where\n",
				createVNode(_components.code, { children: "marked-footnote" }),
				"’s bare ",
				createVNode(_components.code, { children: "data-footnote-ref" }),
				" marker still\nexists (the back-ref carries the distinct ",
				createVNode(_components.code, { children: "data-footnote-backref" }),
				"), and a\nsingle regex stamps an allowlist-safe ",
				createVNode(_components.code, { children: "data-md-footnote" }),
				" flag on the forward-ref\nanchor — a ",
				createVNode(_components.em, { children: "bare flag" }),
				" like ",
				createVNode(_components.code, { children: "data-md-rel" }),
				", carrying no\nvalue; the definition is found from the anchor’s own ",
				createVNode(_components.code, { children: "href" }),
				" (the back-ref ",
				createVNode(_components.code, { children: "↩" }),
				"\nis deliberately ",
				createVNode(_components.em, { children: "not" }),
				" tagged, since its ",
				createVNode(_components.code, { children: "data-footnote-backref" }),
				" never matches).\nThis is the same move alerts make, and it sidesteps the two traps of detecting\nthe ref by structure after sanitization: a back-ref ",
				createVNode(_components.code, { children: "↩" }),
				" link also points at\n",
				createVNode(_components.code, { children: "#md-footnote-…" }),
				", and a heading literally titled “Footnote 1” would mint the\nsame ",
				createVNode(_components.code, { children: "id" }),
				". An explicit parser-minted marker is unambiguous."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "sanitize.ts" }) }),
				" — add ",
				createVNode(_components.code, { children: "data-md-footnote" }),
				" to ",
				createVNode(_components.code, { children: "DOCUMENT_ATTR" }),
				" (one line, beside\n",
				createVNode(_components.code, { children: "data-md-wikilink" }),
				" at ",
				createVNode(_components.code, { children: "sanitize.ts:197" }),
				"; security-reviewed, since it widens the\nallowlist)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "Markdown.tsx" }),
					" — ",
					createVNode(_components.code, { children: "bindInteractions" })
				] }),
				" grows a footnote branch in ",
				createVNode(_components.code, { children: "onClick" }),
				",\nplaced ",
				createVNode(_components.strong, { children: "before" }),
				" the generic ",
				createVNode(_components.code, { children: "#" }),
				"-anchor scroll branch (",
				createVNode(_components.code, { children: "Markdown.tsx:98" }),
				"):\n",
				createVNode(_components.code, { children: "target.closest('[data-md-footnote]')" }),
				" → resolve the definition via the same\n",
				createVNode(_components.code, { children: "el.querySelector('#' + CSS.escape(…))" }),
				" the scroll branch uses → ",
				createVNode(_components.code, { children: "preventDefault" }),
				"\n→ ",
				createVNode(_components.code, { children: "props.onFootnote(anchor, definition)" }),
				". The back-ref ",
				createVNode(_components.code, { children: "↩" }),
				" keeps the existing\nscroll-up behaviour. Add the ",
				createVNode(_components.code, { children: "onFootnote(anchor, definition)" }),
				" prop (mirror\n",
				createVNode(_components.code, { children: "onNavigateWikilink" }),
				", ",
				createVNode(_components.code, { children: "Markdown.tsx:153" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "markdown.css" }) }),
				" — the discoverability affordance: give\n",
				createVNode(_components.code, { children: ".kolu-md [data-md-footnote]" }),
				" a ",
				createVNode(_components.code, { children: "cursor: pointer" }),
				" and a subtle hover highlight\n(a ",
				createVNode(_components.code, { children: "color-mix" }),
				" tint, matching the stylesheet’s ",
				createVNode(_components.code, { children: "currentColor" }),
				" idiom) so the\nmarker reads as clickable. No tip is registered (the marker styling carries\nit)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "client-side--render-the-popover-reuse-useanchoredpopover",
			children: [
				"Client side — render the popover (reuse ",
				createVNode(_components.code, { children: "useAnchoredPopover" }),
				")"
			]
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "solid-fileview/src/renderers/markdown.tsx" }) }),
				" — thread ",
				createVNode(_components.code, { children: "onFootnote" }),
				" through\n",
				createVNode(_components.code, { children: "MarkdownRenderer" }),
				"’s props, mirroring ",
				createVNode(_components.code, { children: "onNavigateWikilink" }),
				" (",
				createVNode(_components.code, { children: "markdown.tsx:29" }),
				").\nNothing else changes here."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "BrowseFileDispatcher.tsx" }) }),
				" — owns the popover, because it already defines the\npreview’s resolvers (",
				createVNode(_components.code, { children: "onNavigateRelative" }),
				" / ",
				createVNode(_components.code, { children: "onNavigateWikilink" }),
				" /\n",
				createVNode(_components.code, { children: "resolveImageSrc" }),
				") and can hand the same ones to the popover’s inner links. A\n",
				createVNode(_components.code, { children: "createSignal<{ anchor, definition } | null>()" }),
				"\nset in ",
				createVNode(_components.code, { children: "onFootnote" }),
				" (mirror ",
				createVNode(_components.code, { children: "wikiMenu" }),
				", ",
				createVNode(_components.code, { children: "BrowseFileDispatcher.tsx:147" }),
				"), and a\n",
				createVNode(_components.code, { children: "FootnotePopover" }),
				" rendered via ",
				createVNode(_components.code, { children: "<Portal>" }),
				" + ",
				createVNode(_components.code, { children: "useAnchoredPopover({ triggerRef: () => fn()?.anchor, open: () => fn() != null, onDismiss: () => setFn(null), anchor: \"bottom-start\", flip: true, panelMinWidth: 320 })" }),
				" — the same recipe as\nthe ",
				createVNode(_components.code, { children: "OptionMenu" }),
				" disambiguation list (",
				createVNode(_components.code, { children: "BrowseFileDispatcher.tsx:462" }),
				"). Concrete\ndecisions baked in:",
				"\n",
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Toggle." }),
						" If ",
						createVNode(_components.code, { children: "onFootnote" }),
						" fires for the marker that is already open, close\ninstead of reopening (compare ",
						createVNode(_components.code, { children: "anchor" }),
						" identity)."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Dismiss on scroll." }),
						" While open, attach a capture-phase ",
						createVNode(_components.code, { children: "scroll" }),
						" listener on\n",
						createVNode(_components.code, { children: "document" }),
						" (",
						createVNode(_components.code, { children: "createEventListener(() => fn() ? document : undefined, \"scroll\", () => setFn(null), { capture: true })" }),
						") so a scroll in ",
						createVNode(_components.em, { children: "either" }),
						" nested\n",
						createVNode(_components.code, { children: "overflow:auto" }),
						" ancestor closes it. ",
						createVNode(_components.code, { children: "useAnchoredPopover" }),
						" is used ",
						createVNode(_components.strong, { children: "unchanged" }),
						"."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Right-edge fit." }),
						" Passing ",
						createVNode(_components.code, { children: "panelMinWidth: 320" }),
						" lets the hook’s existing\nleft-clamp keep a marker-near-the-edge panel on-screen (it has no horizontal\nshift)."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Size." }),
						" Panel ",
						createVNode(_components.code, { children: "width: min(360px, calc(100vw - 2rem))" }),
						",\n",
						createVNode(_components.code, { children: "max-height: min(50vh, 22rem)" }),
						", ",
						createVNode(_components.code, { children: "overflow: auto" }),
						"; reuse ",
						createVNode(_components.code, { children: "surface()" }),
						" for chrome\n(as ",
						createVNode(_components.code, { children: "OptionMenu" }),
						" does)."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Content." }),
						" ",
						createVNode(_components.code, { children: "definition.cloneNode(true)" }),
						", then on the ",
						createVNode(_components.em, { children: "clone" }),
						" remove three\nthings: ",
						createVNode(_components.strong, { children: "every" }),
						" ",
						createVNode(_components.code, { children: "id" }),
						" — the root ",
						createVNode(_components.code, { children: "<li>" }),
						"’s ",
						createVNode(_components.em, { children: "and" }),
						" every descendant’s (a rich\nnote body can hold a heading or raw allowed HTML the sanitizer minted an\n",
						createVNode(_components.code, { children: "md-…" }),
						" id on); the live nodes keep theirs, so a portalled clone that kept a\nduplicate id would weaken the sanitizer’s id-namespacing and make an in-page\n",
						createVNode(_components.code, { children: "#md-…" }),
						" lookup ambiguous. ",
						createVNode(_components.strong, { children: "Every" }),
						" back-ref ",
						createVNode(_components.code, { children: "↩" }),
						" (keyed on the renderer’s own\n",
						createVNode(_components.code, { children: "data-md-footnote-backref" }),
						" flag, not marked-footnote’s ",
						createVNode(_components.code, { children: "-ref-" }),
						" id scheme — so\na ",
						createVNode(_components.code, { children: "marked-footnote" }),
						" bump fails loudly in ",
						createVNode(_components.code, { children: "render.test.ts" }),
						" rather than leaving\nstray ",
						createVNode(_components.code, { children: "↩" }),
						" links), since a re-cited footnote has several. And the\n",
						createVNode(_components.code, { children: "data-md-footnote" }),
						" flag from ",
						createVNode(_components.strong, { children: "any nested" }),
						" ref markers (so they are inert in\nthe popover — see the nested-footnote risk). Re-inject the clone’s\n",
						createVNode(_components.code, { children: "innerHTML" }),
						". Images need no handling — ",
						createVNode(_components.code, { children: "resolveImageSrc" }),
						" already ran on this\nnode when the document was sanitized, so the clone carries resolved ",
						createVNode(_components.code, { children: "src" }),
						"s."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Inner links." }),
						" Bind one click listener on the popover panel that routes the\n",
						createVNode(_components.em, { children: "click-time" }),
						" links only: ",
						createVNode(_components.code, { children: "a[data-md-rel]" }),
						" → the host’s ",
						createVNode(_components.code, { children: "onNavigateRelative" }),
						",\n",
						createVNode(_components.code, { children: "a[data-md-wikilink]" }),
						" → ",
						createVNode(_components.code, { children: "onNavigateWikilink" }),
						" (the same handlers\n",
						createVNode(_components.code, { children: "BrowseFileDispatcher" }),
						" already passes to the preview). External links keep the\n",
						createVNode(_components.code, { children: "target=\"_blank\"" }),
						" the sanitizer stamped, so they need no handler. This is the\n~10-line relative/wikilink slice of ",
						createVNode(_components.code, { children: "bindInteractions" }),
						"; if duplication grates,\nexport that slice from ",
						createVNode(_components.code, { children: "@kolu/solid-markdown" }),
						" and call it here."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "“See all ↓”." }),
						" A footer link that calls\n",
						createVNode(_components.code, { children: "fn().definition.scrollIntoView({ behavior: \"smooth\", block: \"start\" })" }),
						" on the\n",
						createVNode(_components.strong, { children: "live" }),
						" ",
						createVNode(_components.code, { children: "<li>" }),
						" (not the clone — the clone’s ",
						createVNode(_components.code, { children: "id" }),
						" is gone), then ",
						createVNode(_components.code, { children: "setFn(null)" }),
						"."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Out of scope (tracked follow-up):" }),
				" a managed-focus popover with a\nscreen-reader relationship. Opening is pointer-only ",
				createVNode(_components.em, { children: "by enforcement" }),
				" — the\nfootnote branch is gated on ",
				createVNode(_components.code, { children: "click.detail > 0" }),
				", so a keyboard activation\n(Enter/Space) falls through to the in-page jump-to-definition scroll and lands\non the bottom section, which remains the accessible record. A follow-up can add\nEnter/Space-to-",
				createVNode(_components.em, { children: "open" }),
				" on the focused marker plus an ",
				createVNode(_components.code, { children: "aria-details" }),
				" link — note\nit in the PR description so it isn’t mistaken for an oversight."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "sharp-edges-and-how-each-is-handled",
			children: "Sharp edges, and how each is handled"
		}),
		"\n",
		createVNode(_components.p, { children: "Each was a real trap; none is left open." }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "useAnchoredPopover" }), " doesn’t track scroll — and that is fine, because we\ndismiss on scroll."] }),
				" The hook repositions only on open/trigger-change\n(",
				createVNode(_components.code, { children: "useAnchoredPopover.ts:135" }),
				"), and the preview sits inside ",
				createVNode(_components.em, { children: "nested" }),
				"\n",
				createVNode(_components.code, { children: "overflow:auto" }),
				" containers, so a panel anchored with ",
				createVNode(_components.code, { children: "position:fixed" }),
				" would\ndrift off the marker as the reader scrolls. ",
				createVNode(_components.strong, { children: "Decided:" }),
				" close the popover on\nscroll (the capture-phase listener above), so the hook is used unchanged and\nthere is no drift — reopen with a click. ",
				createVNode(_components.code, { children: "flip" }),
				" is vertical-only (no horizontal\nshift), so a marker near the right edge could overflow; the ",
				createVNode(_components.code, { children: "panelMinWidth: 320" }),
				"\nleft-clamp handles it. (Follow-the-marker re-anchoring was considered and\ndeclined — it is the only thing that would have touched the shared hook.)"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"The comment overlay — handled by the ",
					createVNode(_components.code, { children: "Portal" }),
					" route."
				] }),
				" The preview is wrapped\nin ",
				createVNode(_components.code, { children: "CommentTextSurface" }),
				" with a ",
				createVNode(_components.code, { children: "MutationObserver" }),
				" over its subtree, so an\n",
				createVNode(_components.em, { children: "in-flow" }),
				" popup would trip it. We mount the panel through ",
				createVNode(_components.code, { children: "<Portal>" }),
				" to\n",
				createVNode(_components.code, { children: "document.body" }),
				" (what ",
				createVNode(_components.code, { children: "useAnchoredPopover" }),
				" already expects), so it lives outside\nthe watched subtree and never perturbs comment anchoring."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Touch + the drawer." }),
				" Click-to-open already covers touch (no hover step). On\nmobile the right panel can mount inside a ",
				createVNode(_components.code, { children: "@corvu/drawer" }),
				" (",
				createVNode(_components.code, { children: "modal: true" }),
				" sets\n",
				createVNode(_components.code, { children: "body { pointer-events: none }" }),
				"); ",
				createVNode(_components.code, { children: "useAnchoredPopover" }),
				" already re-enables\n",
				createVNode(_components.code, { children: "pointer-events: auto" }),
				" on its panel (",
				createVNode(_components.code, { children: "useAnchoredPopover.ts:154" }),
				"), so the\npopover stays tappable there."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Nested footnotes — made inert by the clone." }),
				" A footnote body can cite another\nfootnote, so a ref marker can appear ",
				createVNode(_components.em, { children: "inside" }),
				" a popover. The clone strips\n",
				createVNode(_components.code, { children: "data-md-footnote" }),
				" from those nested markers (Content step above) and the\npopover’s click listener routes only ",
				createVNode(_components.code, { children: "data-md-rel" }),
				" / ",
				createVNode(_components.code, { children: "data-md-wikilink" }),
				" — so a\nnested marker is a plain, inert superscript. No popover stacking, no recursion."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "An in-page anchor inside the clone never escapes the preview." }),
				" The popover\nbinds the package’s own click dispatcher to the cloned ",
				createVNode(_components.code, { children: "<li>" }),
				", whose in-page\ntargets (a nested ref’s ",
				createVNode(_components.code, { children: "#md-footnote-…" }),
				", a ",
				createVNode(_components.code, { children: "#heading" }),
				" outside the note) live\nin the bottom list, not the clone — so the in-clone lookup misses. The\nin-page-anchor branch therefore ",
				createVNode(_components.code, { children: "preventDefault" }),
				"s ",
				createVNode(_components.strong, { children: "unconditionally" }),
				" (before\nthe target lookup), so a miss can’t fall through to a real browser hash\nnavigation that would change the app URL or scroll outside the preview from\ninside the popover. It still only scrolls when the target resolves."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Raw HTML can’t spoof the marker." }),
				" ",
				createVNode(_components.code, { children: "data-md-footnote" }),
				" is allowlisted, so a\nREADME’s raw inline HTML could pre-seed it to opt an arbitrary anchor into the\nhost callback. Like the wikilink guard, the renderer strips any\ndocument-authored ",
				createVNode(_components.code, { children: "data-md-footnote*" }),
				" token before re-minting it only beside\nmarked-footnote’s own ",
				createVNode(_components.code, { children: "data-footnote-ref" }),
				" / ",
				createVNode(_components.code, { children: "data-footnote-backref" }),
				" — so the\nmarker only ever rides the parser’s own refs (",
				createVNode(_components.code, { children: "render.test.ts" }),
				" covers the\nspoof; the e2e covers the popover behaviour)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Content re-renders don’t drop the handler." }),
				" The new branch lives in the\ndelegated listener ",
				createVNode(_components.code, { children: "bindInteractions" }),
				" binds on the stable ",
				createVNode(_components.code, { children: ".kolu-md" }),
				" root, not on\nper-marker nodes. Editing the file re-runs the ",
				createVNode(_components.code, { children: "html()" }),
				" memo and swaps the\nelement’s ",
				createVNode(_components.code, { children: "innerHTML" }),
				" in place — the root element (and its ",
				createVNode(_components.code, { children: "ref" }),
				"-bound listener)\nis not remounted — so the footnote branch keeps firing with no re-binding,\nexactly as the existing link/scroll branches do today."
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
	"title": "Markdown preview: footnotes open in a click popover",
	"description": "Click a footnote marker in the Code-tab Markdown preview and its definition opens in a dismissible popover anchored to the marker — no more scrolling to the bottom of the document and back. Reuses the wikilink-disambiguation seam; no new package, nothing to install.",
	"parents": ["solid-fileview", "feature"],
	"status": "implemented",
	"maturity": "seedling",
	"updated": "2026-06-22T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-the-reader-sees",
			"text": "What the reader sees"
		},
		{
			"depth": 2,
			"slug": "architecture--a-leaf-that-reuses-the-wikilink-seam",
			"text": "Architecture — a leaf that reuses the wikilink seam"
		},
		{
			"depth": 2,
			"slug": "implementation--one-pr-threading-the-existing-seams",
			"text": "Implementation — one PR, threading the existing seams"
		},
		{
			"depth": 3,
			"slug": "package-side--pin-the-contract-then-one-marker-and-one-callback",
			"text": "Package side — pin the contract, then one marker and one callback"
		},
		{
			"depth": 3,
			"slug": "client-side--render-the-popover-reuse-useanchoredpopover",
			"text": "Client side — render the popover (reuse useAnchoredPopover)"
		},
		{
			"depth": 3,
			"slug": "sharp-edges-and-how-each-is-handled",
			"text": "Sharp edges, and how each is handled"
		}
	];
}
var url = "src/content/atlas/md-preview-footnotes.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/md-preview-footnotes.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/md-preview-footnotes.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Card, Content, Content as default, PopoverShot, ScrollPain, Sup, Tag, docText, file, frontmatter, getHeadings, url };
