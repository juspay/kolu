import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
//#region src/content/atlas/solid-fileview.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		hr: "hr",
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
	const { Fragment: Fragment$1 } = _components;
	if (!Fragment$1) _missingMdxReference("Fragment", true);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"The Code tab can ",
			createVNode(_components.em, { children: "open" }),
			" any file, but “open” means two things: show its\n",
			createVNode(_components.strong, { children: "source" }),
			" (syntax-highlighted text) or its ",
			createVNode(_components.strong, { children: "rendered form" }),
			" (the image, the\npage, the document). Markdown sat in the gap — a ",
			createVNode(_components.code, { children: "README.md" }),
			" opened as source,\nnever as a rendered document. The organizing idea is a ",
			createVNode(_components.strong, { children: "Source ⇄ Rendered\ntoggle" }),
			": for any file with ",
			createVNode(_components.em, { children: "both" }),
			" forms, the user picks. Markdown is the first\nlit toggle (",
			createVNode($$PrLink, { pr: 1093 }),
			", shipped); HTML and SVG join next."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "The one-line summary",
			children: createVNode(_components.p, { children: [
				"Previewing is decided at a single seam — a file is classified, the ",
				createVNode(_components.code, { children: "fsReadFile" }),
				"\nwire carries a ",
				createVNode(_components.code, { children: "kind" }),
				" discriminator, and a dispatcher routes ",
				createVNode(_components.code, { children: "kind" }),
				" to a\npresenter. The toggle is available exactly when a file has ",
				createVNode(_components.em, { children: "both" }),
				" a source and a\nrendered form. Markdown is the easy case (already ",
				createVNode(_components.code, { children: "text" }),
				" on the wire); HTML/SVG\nare the instructive case (text-backed but delivered as ",
				createVNode(_components.code, { children: "binary" }),
				"/URL today)."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The thesis — invent electricity, don't wire the house",
			children: createVNode(_components.p, { children: [
				"Lowy’s electricity analogy: a home shouldn’t generate its own power per appliance;\na utility encapsulates the volatility of ",
				createVNode(_components.em, { children: "generation" }),
				" behind a stable interface\n(the outlet), and appliances just plug in. Today kolu is pre-electricity — each\npreview format would wire its own rendering into the right-panel. This plan\n",
				createVNode(_components.strong, { children: "extracts the preview capability into standalone, kolu-agnostic packages" }),
				" — a\ngeneric file-viewer “grid” and pluggable renderer “appliances” — and leaves kolu\nplugging into the outlet. The payoff is counterintuitive: even though we ",
				createVNode(_components.em, { children: "add" }),
				" a\nfeature (the toggle + Markdown + HTML/SVG source), ",
				createVNode(_components.strong, { children: "the kolu app code gets\nsmaller" }),
				", because the render mechanics move out to reusable libraries beside\n",
				createVNode(_components.code, { children: "@kolu/solid-pierre" }),
				"."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "what-can-be-previewed-today",
			children: "What can be previewed today"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Five render strategies, chosen below the ",
			createVNode(_components.code, { children: "fsReadFile" }),
			" wire boundary by file\nextension. The classifier is deliberately node-free so server and client import\nthe ",
			createVNode(_components.em, { children: "same" }),
			" lists."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Strategy" }),
					"\n",
					createVNode(_components.th, { children: ["Wire ", createVNode(_components.code, { children: "kind" })] }),
					"\n",
					createVNode(_components.th, { children: "Renderer" }),
					"\n",
					createVNode(_components.th, { children: "Extensions" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Source text" }), " (default)"] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "text" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "BrowseFileView" }),
						" → Pierre ",
						createVNode(_components.code, { children: "CodeView" }),
						" (Shiki), wrapped in ",
						createVNode(_components.code, { children: "CommentTextSurface" }),
						" for line/range comments."
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.em, { children: "Everything not listed below." }), " Truncated past 1 MB."] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Raster image" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "binary" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "BrowsePreviewView" }),
						" → plain ",
						createVNode(_components.code, { children: "<img>" }),
						" on a checkerboard. No iframe — image bytes can’t execute."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: ".png .jpg .jpeg .gif .webp .ico" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "PDF document" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "binary" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "pdf" }), " renderer → browser-native PDF viewer."] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: ".pdf" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Sandboxed document" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "binary" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "BrowsePreviewView" }),
						" → ",
						createVNode(_components.code, { children: "allow-scripts" }),
						", opaque-origin ",
						createVNode(_components.code, { children: "<iframe>" }),
						". HTML gets the artifact-sdk comment bridge; SVG is served verbatim."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: ".html .htm .svg" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Video player" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "binary" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "video" }),
						" renderer → ",
						createVNode(_components.code, { children: "<video controls>" }),
						", range-served (",
						createVNode($$PrLink, { pr: 1219 }),
						")."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: ".mp4 .m4v .webm .mov .ogv" }) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The four binary sets are disjoint; their union is ",
			createVNode(_components.code, { children: "BINARY_PREVIEWABLE_EXTENSIONS" }),
			" —\nthe partition is structural, so a new previewable format lands in exactly one\ncategory."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-hidden-insight-kind-conflates-two-independent-questions",
			children: [
				"The hidden insight: ",
				createVNode(_components.code, { children: "kind" }),
				" conflates two independent questions"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The ",
			createVNode(_components.code, { children: "text" }),
			"/",
			createVNode(_components.code, { children: "binary" }),
			" discriminator answers “how do I fetch and render this by\ndefault.” The ",
			createVNode(_components.em, { children: "real" }),
			" structure is two orthogonal yes/no axes — and the toggle is\nmeaningful exactly at their intersection."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Format" }),
					"\n",
					createVNode(_components.th, { children: "Has a source?" }),
					"\n",
					createVNode(_components.th, { children: "Has a rendered form?" }),
					"\n",
					createVNode(_components.th, { children: "What the user gets" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["plain code ", createVNode(_components.code, { children: ".ts .rs .py" })] }),
					"\n",
					createVNode(_components.td, { children: "✓" }),
					"\n",
					createVNode(_components.td, { children: "✗" }),
					"\n",
					createVNode(_components.td, { children: "Source only (today’s default — correct)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Markdown" }),
						" ",
						createVNode(_components.code, { children: ".md" })
					] }),
					"\n",
					createVNode(_components.td, { children: "✓" }),
					"\n",
					createVNode(_components.td, { children: "✓ (client md render)" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Toggle" }), " — default Rendered"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "HTML" }),
						" ",
						createVNode(_components.code, { children: ".html .htm" })
					] }),
					"\n",
					createVNode(_components.td, { children: "✗ today" }),
					"\n",
					createVNode(_components.td, { children: "✓ (iframe)" }),
					"\n",
					createVNode(_components.td, { children: [
						"Rendered only — source needs the ",
						createVNode(_components.code, { children: "renderable" }),
						" wire kind below"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "SVG" }),
						" ",
						createVNode(_components.code, { children: ".svg" })
					] }),
					"\n",
					createVNode(_components.td, { children: "✗ today" }),
					"\n",
					createVNode(_components.td, { children: "✓ (iframe)" }),
					"\n",
					createVNode(_components.td, { children: [
						"Rendered only — source needs the ",
						createVNode(_components.code, { children: "renderable" }),
						" wire kind below"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["images ", createVNode(_components.code, { children: ".png .jpg" })] }),
					"\n",
					createVNode(_components.td, { children: "✗" }),
					"\n",
					createVNode(_components.td, { children: [
						"✓ (",
						createVNode(_components.code, { children: "<img>" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: ["Rendered only — ", createVNode(_components.em, { children: "no source exists" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["PDF ", createVNode(_components.code, { children: ".pdf" })] }),
					"\n",
					createVNode(_components.td, { children: "✗" }),
					"\n",
					createVNode(_components.td, { children: "✓ (native PDF viewer)" }),
					"\n",
					createVNode(_components.td, { children: ["Rendered only — ", createVNode(_components.em, { children: "no source exists" })] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The toggle is offered ",
			createVNode(_components.strong, { children: [
				"iff both columns are ✓ in the current ",
				createVNode(_components.code, { children: "FileData" }),
				" shape"
			] }),
			".\nThis is a property of the data the host supplies, not a per-presenter convention."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"plaintext\"><code><span class=\"line\"><span>  fsReadFile (server)                     wire kind          BrowseFileDispatcher (client)</span></span>\n<span class=\"line\"><span>  ┌───────────────────────┐   text   ┌───────────────┐   →  BrowseFileView   (Pierre CodeView)</span></span>\n<span class=\"line\"><span>  │ isBinaryPreviewable(p) │ ───────▶ │ {kind:\"text\"} │</span></span>\n<span class=\"line\"><span>  │   in previewable.ts    │   binary │ {kind:\"binary\"}│  →  BrowsePreviewView (&#x3C;img> | video | PDF viewer | sandboxed iframe)</span></span>\n<span class=\"line\"><span>  └───────────────────────┘ ───────▶ └───────────────┘</span></span>\n<span class=\"line\"><span>                                       ▲ the single switch point — add a kind here</span></span></code></pre>" }),
		"\n",
		createVNode(_components.h2, {
			id: "what-cannot-yet-be-previewed--but-should-be",
			children: "What cannot yet be previewed — but should be"
		}),
		"\n",
		createVNode(_components.p, { children: "Ranked by value ÷ cost." }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Format" }),
					"\n",
					createVNode(_components.th, { children: "Today" }),
					"\n",
					createVNode(_components.th, { children: "Should be" }),
					"\n",
					createVNode(_components.th, { children: "Cost / seam" }),
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
						createVNode(_components.strong, { children: "HTML / SVG source" }),
						" ",
						createVNode($$Pill, {
							variant: "todo",
							children: "toggle set"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: "Rendered in sandbox only." }),
					"\n",
					createVNode(_components.td, { children: "Same toggle as Markdown (text-backed)." }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Low-medium." }), " Wire must carry text alongside the URL."] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "More raster" }),
						" ",
						createVNode(_components.code, { children: ".avif .jxl .bmp .apng" })
					] }),
					"\n",
					createVNode(_components.td, { children: "Source text (garbage)." }),
					"\n",
					createVNode(_components.td, { children: [
						"Plain ",
						createVNode(_components.code, { children: "<img>" }),
						"."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Trivial — append to ",
						createVNode(_components.code, { children: "RASTER_IMAGE_EXTENSIONS" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Jupyter" }),
						" ",
						createVNode(_components.code, { children: ".ipynb" })
					] }),
					"\n",
					createVNode(_components.td, { children: "Raw JSON." }),
					"\n",
					createVNode(_components.td, { children: "Rendered cells." }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Medium-high." }), " A notebook renderer appliance. Defer."] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "CSV / TSV" }) }),
					"\n",
					createVNode(_components.td, { children: "Source text." }),
					"\n",
					createVNode(_components.td, { children: "Optional rendered table (toggle)." }),
					"\n",
					createVNode(_components.td, { children: "Medium — a virtualized table presenter." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Fonts" }),
						" ",
						createVNode(_components.code, { children: ".woff .ttf .otf" })
					] }),
					"\n",
					createVNode(_components.td, { children: "Garbage." }),
					"\n",
					createVNode(_components.td, { children: "A specimen sheet." }),
					"\n",
					createVNode(_components.td, { children: "Low-medium; niche, defer." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Audio" }),
						" ",
						createVNode(_components.code, { children: ".mp3" })
					] }),
					"\n",
					createVNode(_components.td, { children: "Garbage." }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "<audio>" }), " at the URL."] }),
					"\n",
					createVNode(_components.td, { children: [
						"Low — an ",
						createVNode(_components.code, { children: "audio" }),
						" renderer appliance. Defer. ",
						createVNode(_components.em, { children: [
							"(Video shipped — ",
							createVNode($$PrLink, { pr: 1219 }),
							", ",
							createVNode(_components.code, { children: ".mp4 .m4v .webm .mov .ogv" }),
							" via the ",
							createVNode(_components.code, { children: "video" }),
							" renderer.)"
						] })
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Non-goal:" }), " Office formats, archives — they belong to a “download / open\nexternally” affordance, not in-pane preview."] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-feature--a-source--rendered-toggle-markdown-first",
			children: "The feature — a Source ⇄ Rendered toggle, Markdown first"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "markdown-needs-no-new-wire-kind-confirmed-by-p3",
			children: [
				"Markdown needs no new wire ",
				createVNode(_components.code, { children: "kind" }),
				" ",
				createVNode($$Pill, {
					variant: "ok",
					children: "confirmed by P3"
				})
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Markdown ",
			createVNode(_components.em, { children: "is" }),
			" text — it arrives as ",
			createVNode(_components.code, { children: "{kind: \"text\", content, truncated}" }),
			". The\nrender decision is purely client-side and reversible: default ",
			createVNode(_components.strong, { children: "rendered" }),
			", one\nflip to ",
			createVNode(_components.strong, { children: "source" }),
			". So Markdown is a renderer appliance plugged into the grid,\nabove the wire. ",
			createVNode(_components.em, { children: "P3 confirmed it:" }),
			" no new ",
			createVNode(_components.code, { children: "kind" }),
			", no ",
			createVNode(_components.code, { children: "defaultMode" }),
			" — the\ndispatcher passed a one-entry ",
			createVNode(_components.code, { children: "rendered={[markdownRenderer]}" }),
			" matched by\n",
			createVNode(_components.code, { children: "isMarkdown" }),
			"; ",
			createVNode(_components.code, { children: "FileView" }),
			"’s “both forms → default Rendered, show the toggle” rule\ndid the rest."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "3a--comments-on-rendered-markdown--shipped",
			children: "3a · Comments on rendered Markdown — shipped"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"v1 shipped comments only in ",
			createVNode(_components.strong, { children: "source" }),
			" view (",
			createVNode(_components.code, { children: "CommentTextSurface" }),
			" wraps Pierre’s\n",
			createVNode(_components.code, { children: "CodeView" }),
			"); ",
			createVNode($$PrLink, { pr: 1162 }),
			" closed the seam — the rendered document now\ntakes selection-anchored comments. kolu already had ",
			createVNode(_components.em, { children: "one" }),
			" anchoring\nmodel in two surfaces: the W3C ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "TextQuoteSelector" }) }),
			" (",
			createVNode(_components.code, { children: "{quote, prefix, suffix}" }),
			")"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "extractQuote" }),
				"/",
				createVNode(_components.code, { children: "findQuote" }),
				" in ",
				createVNode(_components.code, { children: "@kolu/artifact-sdk/core" }),
				". Rendered Markdown was the\nthird surface — and the ",
				createVNode(_components.em, { children: "simplest" }),
				", because:"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"Markdown renders ",
				createVNode(_components.strong, { children: "inline in the parent document" }),
				", not in a sandboxed iframe — so there’s ",
				createVNode(_components.strong, { children: "no postMessage bridge" }),
				". A plain DOM ",
				createVNode(_components.code, { children: "Range" }),
				" feeds ",
				createVNode(_components.code, { children: "extractQuote" }),
				" directly; ",
				createVNode(_components.code, { children: "findQuote" }),
				" re-locates on rehydrate."
			] }),
			"\n",
			createVNode(_components.li, { children: "The locator is durable across re-renders by construction (text + context, not a DOM path)." }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Volatility split (Lowy), as built: the ",
			createVNode(_components.em, { children: "generic mechanism" }),
			" (subtree-scoped\nselection → locator, locator → highlight) landed in ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/artifact-sdk/core" }) }),
			",\nconsumed by kolu’s ",
			createVNode(_components.code, { children: "CommentTextSurface" }),
			"/",
			createVNode(_components.code, { children: "useTextSelection" }),
			" wrapping the rendered\nview — ",
			createVNode(_components.code, { children: "@kolu/solid-fileview" }),
			" gained only a controlled ",
			createVNode(_components.code, { children: "mode" }),
			" prop (for\ncomment-tray jumps), not the planned rendered-annotation hook. The ",
			createVNode(_components.em, { children: "comment\nfeature" }),
			" (tray, threads, persistence) stays kolu’s. One anchoring model\nacross all three surfaces, not a fourth invented for Markdown."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "3c--more-markdown-features--appliances-on-the-grid",
			children: "3c · More Markdown features — appliances on the grid"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Each lives ",
			createVNode(_components.em, { children: "inside the appliance" }),
			" (",
			createVNode(_components.code, { children: "@kolu/solid-markdown" }),
			"); the host never changes.\nGrounded against what ",
			createVNode(_components.code, { children: "marked" }),
			" ships (",
			createVNode(_components.code, { children: "{gfm: true, breaks: true}" }),
			"):"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Feature" }),
					"\n",
					createVNode(_components.th, { children: "Status today" }),
					"\n",
					createVNode(_components.th, { children: "The work" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "GFM tables / task lists" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "marked" }),
						" parses; renderer emits ",
						createVNode(_components.code, { children: "<table>" }),
						" + checkbox nodes."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Styling polish for ",
						createVNode(_components.code, { children: "document" }),
						"; verify checkboxes read as decorative."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Strikethrough / autolinks" }),
					"\n",
					createVNode(_components.td, { children: "Parsed by GFM." }),
					"\n",
					createVNode(_components.td, { children: [
						"Confirm a ",
						createVNode(_components.code, { children: "del" }),
						" case + bare URLs through ",
						createVNode(_components.code, { children: "safeHref" }),
						"; style if missing."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Syntax-highlighted code fences" }),
					"\n",
					createVNode(_components.td, { children: [
						"Shiki-highlighted (",
						createVNode($$PrLink, { pr: 1155 }),
						")."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "3b" }),
						" — shipped as a demand-loaded dynamic ",
						createVNode(_components.code, { children: "import(\"shiki\")" }),
						" in ",
						createVNode(_components.code, { children: "@kolu/solid-markdown" }),
						"’s ",
						createVNode(_components.code, { children: "highlight.ts" }),
						" (a direct dep, not via ",
						createVNode(_components.code, { children: "@kolu/solid-pierre" }),
						")."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Heading anchor links" }),
					"\n",
					createVNode(_components.td, { children: [
						"Slug ids on each heading (",
						createVNode($$PrLink, { pr: 1155 }),
						")."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Shipped via ",
						createVNode(_components.code, { children: "marked-gfm-heading-id" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Relative ",
						createVNode(_components.em, { children: "file" }),
						" links"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Clicking opens the file in the Code tab (",
						createVNode($$PrLink, { pr: 1190 }),
						")."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Shipped — kolu link policy, injected; Obsidian wikilinks followed (",
						createVNode($$PrLink, { pr: 1212 }),
						")."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Frontmatter" }),
					"\n",
					createVNode(_components.td, { children: [
						"Leading YAML block stripped (",
						createVNode($$PrLink, { pr: 1155 }),
						")."
					] }),
					"\n",
					createVNode(_components.td, { children: "Shipped — strip-and-ignore." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "KaTeX math · Mermaid" }),
					"\n",
					createVNode(_components.td, { children: "Not handled." }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.em, { children: "Optional appliances" }), " plugged into the same outlet later — no host changes. Demand-gated."] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "invent-the-grid--extract-three-packages-slim-kolu",
			children: "Invent the grid — extract three packages, slim kolu"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The naïve build wires each format into kolu’s ",
			createVNode(_components.code, { children: "right-panel/" }),
			" as a ",
			createVNode(_components.code, { children: "Switch" }),
			" arm —\nthe pre-electricity house. Two things vary independently and must be encapsulated\napart (Lowy), and neither is ",
			createVNode(_components.em, { children: "about kolu" }),
			":"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "How a document renders" }), " (marked → safe Solid nodes) — volatile in its own right (the spec, sanitization)."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The source ⇄ rendered viewer" }),
				" (the toggle, mode-availability, renderer match) — a generic mechanism any file viewer needs, with ",
				createVNode(_components.em, { children: "zero" }),
				" kolu knowledge."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"plaintext\"><code><span class=\"line\"><span>  ── kolu app (the house) ───────────┐    ── the grid: reusable packages ──────────────────────</span></span>\n<span class=\"line\"><span>   fsReadFile wire {kind, …}         │</span></span>\n<span class=\"line\"><span>        │ thin adapter (wire→props)  │     @kolu/solid-fileview  ── the outlet ──</span></span>\n<span class=\"line\"><span>        ▼                            │       &#x3C;FileView source={…} rendered={[…]} /></span></span>\n<span class=\"line\"><span>   &#x3C;FileView                         │         owns: the Source ⇄ Rendered toggle,</span></span>\n<span class=\"line\"><span>      source={pierreRenderer}  ──────┼──▶       which modes exist, registry.pick(path)</span></span>\n<span class=\"line\"><span>      rendered={[md, img, iframe]} ──┼──▶     RenderedRenderer = { match, render }  ← appliances</span></span>\n<span class=\"line\"><span>   />                                │</span></span>\n<span class=\"line\"><span>        ▲ kolu injects its renderers │     @kolu/solid-markdown  ── an appliance ──</span></span>\n<span class=\"line\"><span>          (theme, comment bridge)    │       &#x3C;Markdown variant=\"document\" />  (marked + sanitize)</span></span>\n<span class=\"line\"><span>  ───────────────────────────────────┘     @kolu/solid-pierre   ── already a package (source) ──</span></span></code></pre>" }),
		"\n",
		createVNode(_components.h3, {
			id: "the-three-packages-lowy-each-encapsulates-one-volatility",
			children: "The three packages (Lowy: each encapsulates one volatility)"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Package" }),
					"\n",
					createVNode(_components.th, { children: "Encapsulates" }),
					"\n",
					createVNode(_components.th, { children: "The outlet" }),
					"\n",
					createVNode(_components.th, { children: "What it obviates in kolu" }),
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
						createVNode(_components.code, { children: "@kolu/solid-markdown" }),
						" ",
						createVNode($$Pill, {
							variant: "todo",
							children: "new"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"marked + GFM + ",
						createVNode(_components.code, { children: "safeHref" }),
						" + md→Solid styling. Volatile: the spec, the sanitizer."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "<Markdown markdown variant=\"inline\"|\"document\" />" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"The ~250 LOC token-walk core inside ",
						createVNode(_components.code, { children: "intent/IntentMarkdown.tsx" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "@kolu/solid-fileview" }),
						" ",
						createVNode($$Pill, {
							variant: "todo",
							children: "new"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: "The toggle, mode-availability, renderer-registry pick. Knows nothing of oRPC, git, comments." }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "<FileView path source? renderedUrl? source={Renderer} rendered={Renderer[]} />" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"The render ",
						createVNode(_components.em, { children: "mechanics" }),
						" of ",
						createVNode(_components.code, { children: "BrowseFileView" }),
						" + ",
						createVNode(_components.code, { children: "BrowsePreviewView" }),
						" + ",
						createVNode(_components.code, { children: "BrowseFileDispatcher" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "@kolu/solid-fileview/renderers/{markdown,image,video,pdf,iframe}" }) }),
					"\n",
					createVNode(_components.td, { children: "Each strategy as an independent appliance. Generic, kolu-free." }),
					"\n",
					createVNode(_components.td, { children: [
						"Each is a ",
						createVNode(_components.code, { children: "RenderedRenderer" }),
						" value."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"The strategy code hand-written in ",
						createVNode(_components.code, { children: "BrowsePreviewView" }),
						"."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Decoupling the source renderer too." }),
			" ",
			createVNode(_components.code, { children: "FileView" }),
			" does ",
			createVNode(_components.em, { children: "not" }),
			" hard-depend on a\nhighlighter — the source view is an injected renderer like any other. kolu passes\none backed by ",
			createVNode(_components.code, { children: "@kolu/solid-pierre" }),
			" carrying kolu’s theme. So ",
			createVNode(_components.code, { children: "@kolu/solid-fileview" }),
			"\nhas no rendering deps at all: pure mechanism, every concrete renderer an appliance."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "html--svg-need-the-wire-to-carry-both-source-and-url",
			children: "HTML / SVG need the wire to carry both source and URL"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"HTML/SVG are text on disk but render in an ",
			createVNode(_components.code, { children: "allow-scripts" }),
			" opaque-origin iframe at\na server-built URL (and HTML splices the comment bridge at that route) — the\nrender path genuinely needs the URL. To ",
			createVNode(_components.em, { children: "also" }),
			" show source, the client needs the\ntext the iframe path never carried. A third ",
			createVNode(_components.code, { children: "fsReadFile" }),
			" variant:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#24292E\">{ </span><span style=\"color:#6F42C1\">kind</span><span style=\"color:#24292E\">: </span><span style=\"color:#032F62\">\"renderable\"</span><span style=\"color:#24292E\">, content, truncated, url }</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//        ^source view ──────────┘          └── iframe render</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"Markdown stays ",
			createVNode(_components.code, { children: "kind:\"text\"" }),
			" (no URL); images/PDF stay ",
			createVNode(_components.code, { children: "kind:\"binary\"" }),
			" (no\ncontent). The discriminator now reads off the same two axes: ",
			createVNode(_components.code, { children: "text" }),
			" =\nsource-only, ",
			createVNode(_components.code, { children: "binary" }),
			" = rendered-only, ",
			createVNode(_components.code, { children: "renderable" }),
			" = both."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "phasing--invent-the-grid-then-plug-in",
			children: "Phasing — invent the grid, then plug in"
		}),
		"\n",
		createVNode(_components.p, { children: "The first two phases are pure extraction: no new feature, no wire change, kolu\nworking throughout — and kolu’s LOC drops at each." }),
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
					createVNode(_components.th, { children: "Net kolu LOC" }),
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
						createVNode(_components.strong, { children: ["1 · Extract ", createVNode(_components.code, { children: "@kolu/solid-markdown" })] }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1079 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Lift the token-walk core out of ",
						createVNode(_components.code, { children: "IntentMarkdown.tsx" }),
						" (257→30 LOC) into a package with ",
						createVNode(_components.code, { children: "inline" }),
						"/",
						createVNode(_components.code, { children: "compact" }),
						"/",
						createVNode(_components.code, { children: "document" }),
						" variants; migrate the intent surface. Behavior-preserving."
					] }),
					"\n",
					createVNode(_components.td, { children: "↓" }),
					"\n",
					createVNode(_components.td, { children: "Low — mechanical, one call-site." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: ["2 · Extract ", createVNode(_components.code, { children: "@kolu/solid-fileview" })] }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1082 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"The toggle host + mode logic + registry + ",
						createVNode(_components.code, { children: "image" }),
						"/",
						createVNode(_components.code, { children: "iframe" }),
						" renderers. Rewrote ",
						createVNode(_components.code, { children: "right-panel/" }),
						" preview as a thin ",
						createVNode(_components.code, { children: "fsReadFile" }),
						"→",
						createVNode(_components.code, { children: "FileView" }),
						" adapter. Renders ",
						createVNode(_components.em, { children: "exactly today’s formats" }),
						". As-built: ",
						createVNode(_components.code, { children: "BrowseFileView.tsx" }),
						" kept (injected as ",
						createVNode(_components.code, { children: "SourceRenderer" }),
						"); only ",
						createVNode(_components.code, { children: "BrowsePreviewView.tsx" }),
						" went."
					] }),
					"\n",
					createVNode(_components.td, { children: "↓↓ (3 presenters → 1 adapter)" }),
					"\n",
					createVNode(_components.td, { children: ["Medium — live-surface refactor, e2e-covered. ", createVNode(_components.em, { children: [
						"(One defect caught only by the Nix build: the new package was missing from ",
						createVNode(_components.code, { children: "default.nix" }),
						"’s fileset.)"
					] })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "3 · Light the Markdown toggle" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1093 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"The first user-visible win. The ",
						createVNode(_components.code, { children: "markdown" }),
						" renderer landed ",
						createVNode(_components.em, { children: "in the library" }),
						" as ",
						createVNode(_components.code, { children: "@kolu/solid-fileview/renderers/markdown" }),
						" (wrapping the ",
						createVNode(_components.code, { children: "document" }),
						" variant). No new wire ",
						createVNode(_components.code, { children: "kind" }),
						", no ",
						createVNode(_components.code, { children: "defaultMode" }),
						" — ",
						createVNode(_components.code, { children: "FileView" }),
						" defaults to Rendered + shows the toggle whenever a file has both renderers. Server classification relocated out of ",
						createVNode(_components.code, { children: "kolu-git/previewable.ts" }),
						" into node-free ",
						createVNode(_components.code, { children: "kolu-common/preview.ts" }),
						"; ",
						createVNode(_components.code, { children: "kolu-common" }),
						" gained a ",
						createVNode(_components.code, { children: "test:unit" }),
						" runner. A tip + README landed."
					] }),
					"\n",
					createVNode(_components.td, { children: "flat" }),
					"\n",
					createVNode(_components.td, { children: "Low — the grid did the work. Hickey: 0; Lowy: 2 No-op." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "3a · Comments on rendered Markdown" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1162 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Closed the v1 seam via the shared ",
						createVNode(_components.code, { children: "TextQuoteSelector" }),
						" model over a plain DOM ",
						createVNode(_components.code, { children: "Range" }),
						" (no iframe/bridge since Markdown renders inline). As-built: subtree-scoped anchoring in ",
						createVNode(_components.code, { children: "@kolu/artifact-sdk/core" }),
						" + kolu’s ",
						createVNode(_components.code, { children: "CommentTextSurface" }),
						"/",
						createVNode(_components.code, { children: "useTextSelection" }),
						" wrapping the rendered view; ",
						createVNode(_components.code, { children: "@kolu/solid-fileview" }),
						" gained only a controlled ",
						createVNode(_components.code, { children: "mode" }),
						" prop for comment-tray jumps — the planned generic rendered-annotation hook wasn’t needed."
					] }),
					"\n",
					createVNode(_components.td, { children: "flat" }),
					"\n",
					createVNode(_components.td, { children: "Medium — anchoring to a char range in rendered output was the open problem; the selector model was the way through." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "3b · Syntax-highlighted code fences" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1155 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Fenced code in rendered Markdown via Shiki, ",
						createVNode(_components.em, { children: ["inside ", createVNode(_components.code, { children: "@kolu/solid-markdown" })] }),
						" (",
						createVNode(_components.code, { children: "highlight.ts" }),
						"). As-built: a demand-loaded dynamic ",
						createVNode(_components.code, { children: "import(\"shiki\")" }),
						" — a direct dep, not routed through ",
						createVNode(_components.code, { children: "@kolu/solid-pierre" }),
						"."
					] }),
					"\n",
					createVNode(_components.td, { children: "flat" }),
					"\n",
					createVNode(_components.td, { children: "Low." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "3c · More Markdown features" }),
						" ",
						createVNode($$Pill, {
							variant: "run",
							children: "grid"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"The appliance evolves; the host doesn’t. Shipped: GFM polish, inline HTML, light/dark theming, heading ids, frontmatter strip (",
						createVNode($$PrLink, { pr: 1155 }),
						"), relative file links opening in the Code tab (",
						createVNode($$PrLink, { pr: 1190 }),
						"), and beyond-plan Obsidian wikilinks (",
						createVNode($$PrLink, { pr: 1212 }),
						"). Remaining: optional KaTeX/Mermaid, demand-gated."
					] }),
					"\n",
					createVNode(_components.td, { children: "flat" }),
					"\n",
					createVNode(_components.td, { children: "Low; each independent." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "4 · HTML / SVG source" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Add the ",
						createVNode(_components.code, { children: "kind:\"renderable\"" }),
						" wire variant (",
						createVNode(_components.code, { children: "content + url" }),
						"); the iframe renderer gains a source side. Toggle lights for ",
						createVNode(_components.code, { children: ".html .htm .svg" }),
						" with zero new components."
					] }),
					"\n",
					createVNode(_components.td, { children: "flat" }),
					"\n",
					createVNode(_components.td, { children: "Low-medium." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "5 · Polish" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Persisted per-session toggle choice (",
						createVNode(_components.code, { children: "makePersisted" }),
						")."
					] }),
					"\n",
					createVNode(_components.td, { children: "flat" }),
					"\n",
					createVNode(_components.td, { children: "Low." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "6 · Cheap binary wins" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Append ",
						createVNode(_components.code, { children: ".avif" }),
						"/",
						createVNode(_components.code, { children: ".bmp" }),
						" to the image renderer; add audio. ",
						createVNode(_components.em, { children: "As-built start:" }),
						" the ",
						createVNode(_components.code, { children: "video" }),
						" renderer landed early (",
						createVNode($$PrLink, { pr: 1219 }),
						", ",
						createVNode(_components.code, { children: ".mp4 .m4v .webm .mov .ogv" }),
						", range-served)."
					] }),
					"\n",
					createVNode(_components.td, { children: "flat" }),
					"\n",
					createVNode(_components.td, { children: "Low." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Later" }) }),
					"\n",
					createVNode(_components.td, { children: "Notebooks, CSV/TSV table, font specimens — each a new appliance; none touches the host." }),
					"\n",
					createVNode(_components.td, { children: "flat" }),
					"\n",
					createVNode(_components.td, { children: "Medium; demand-gated." }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "files-this-touches",
			children: "Files this touches"
		}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "The grid — new reusable packages:" }) }),
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
						createVNode(_components.code, { children: "packages/solid-markdown" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1079 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"The token-walk core (",
						createVNode(_components.code, { children: "marked" }),
						" + ",
						createVNode(_components.code, { children: "safeHref" }),
						") + ",
						createVNode(_components.code, { children: "inline" }),
						"/",
						createVNode(_components.code, { children: "compact" }),
						"/",
						createVNode(_components.code, { children: "document" }),
						" variants. Its ",
						createVNode(_components.code, { children: "document" }),
						" variant now also backs the Code-tab markdown appliance."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "packages/solid-fileview" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1082 }),
						" ",
						createVNode($$PrLink, { pr: 1093 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "FileView" }),
						" host (toggle, mode-availability, registry) + the ",
						createVNode(_components.code, { children: "SourceRenderer" }),
						"/",
						createVNode(_components.code, { children: "RenderedRenderer" }),
						" contracts. Core entry has no rendering deps. Sub-path renderers ",
						createVNode(_components.code, { children: "/renderers/{image,video,pdf,iframe,markdown}" }),
						"."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "kolu — the net shrink:" }) }),
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
					createVNode(_components.td, { children: createVNode(_components.code, { children: "intent/IntentMarkdown.tsx" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "ok",
							children: "−~250 LOC"
						}),
						" A thin consumer of ",
						createVNode(_components.code, { children: "@kolu/solid-markdown" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "right-panel/BrowsePreviewView.tsx" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode($$Pill, {
						variant: "ok",
						children: "deleted"
					}), " Its img/iframe mechanics moved into the library + renderers."] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "right-panel/BrowseFileView.tsx" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "warn",
							children: "kept"
						}),
						" Not deleted — wrapped as the injected pierre ",
						createVNode(_components.code, { children: "SourceRenderer" }),
						" (carries kolu’s comment surface)."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "right-panel/BrowseIframeRenderer.tsx" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "ok",
							children: "new"
						}),
						" kolu’s iframe appliance: the library ",
						createVNode(_components.code, { children: "IframeRenderer" }),
						" + the artifact-sdk comment bridge. Comments are kolu’s volatility."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "right-panel/BrowseFileDispatcher.tsx" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "ok",
							children: "slimmed"
						}),
						" The ",
						createVNode(_components.code, { children: "fsReadFile" }),
						"→",
						createVNode(_components.code, { children: "FileView" }),
						" adapter; #1093 added a one-entry ",
						createVNode(_components.code, { children: "rendered={[markdownRenderer]}" }),
						" on the text path. A projection, not logic."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "kolu-common/preview.ts" }),
						" (was ",
						createVNode(_components.code, { children: "kolu-git/previewable.ts" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "ok",
							children: "relocated"
						}),
						" Server-side wire classification moved to node-free ",
						createVNode(_components.code, { children: "kolu-common/preview" }),
						" — out of ",
						createVNode(_components.code, { children: "kolu-git" }),
						". Gained ",
						createVNode(_components.code, { children: "isMarkdown" }),
						"/",
						createVNode(_components.code, { children: "MARKDOWN_EXTENSIONS" }),
						". P4 adds the ",
						createVNode(_components.code, { children: "renderable" }),
						" set here."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "settings/tips.ts" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "ok",
							children: "+1"
						}),
						" New ",
						createVNode(_components.code, { children: "amb-markdown-preview" }),
						" tip surfacing the toggle."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "default.nix" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "ok",
							children: "+1"
						}),
						" ",
						createVNode(_components.em, { children: "As-built:" }),
						" each new package must be added to the Nix build fileset or the Vite build fails to resolve it."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The accounting:" }),
			" two packages and a feature added, yet the kolu app tree ends\nup with ",
			createVNode(_components.em, { children: "fewer" }),
			" lines and one fewer responsibility — the electricity payoff. The\ncomplexity didn’t vanish; it moved behind an outlet and stopped being kolu’s to\nmaintain."
		] }),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Bottom line: the feature is a ",
			createVNode(_components.strong, { children: "Source ⇄ Rendered toggle" }),
			", offered wherever a\nfile has both forms. Markdown is the first lit toggle (",
			createVNode($$PrLink, { pr: 1093 }),
			") — it\ncost a single library appliance plus a one-entry renderer list, because the grid\nwas already built. As-built footnote (P3): Hickey 0 findings; Lowy 2, both No-op\n(keeping ",
			createVNode(_components.code, { children: "FsReadFileOutputSchema" }),
			" in ",
			createVNode(_components.code, { children: "kolu-git" }),
			" is volatility-correct; the\nhost-overridable ",
			createVNode(_components.code, { children: "testId" }),
			" was rejected as configuration-as-complexity)."
		] }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
function _missingMdxReference(id, component) {
	throw new Error("Expected " + (component ? "component" : "object") + " `" + id + "` to be defined: you likely forgot to import, pass, or provide it.");
}
var frontmatter = {
	"title": "Code browser preview → @kolu/solid-fileview",
	"description": "Invent the grid, slim the house — a Source ⇄ Rendered file-view toggle built on reusable leaf packages. Markdown is the first lit toggle; HTML/SVG next.",
	"parents": ["electricity", "feature"],
	"maturity": "budding",
	"updated": "2026-07-09T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-can-be-previewed-today",
			"text": "What can be previewed today"
		},
		{
			"depth": 3,
			"slug": "the-hidden-insight-kind-conflates-two-independent-questions",
			"text": "The hidden insight: kind conflates two independent questions"
		},
		{
			"depth": 2,
			"slug": "what-cannot-yet-be-previewed--but-should-be",
			"text": "What cannot yet be previewed — but should be"
		},
		{
			"depth": 2,
			"slug": "the-feature--a-source--rendered-toggle-markdown-first",
			"text": "The feature — a Source ⇄ Rendered toggle, Markdown first"
		},
		{
			"depth": 3,
			"slug": "markdown-needs-no-new-wire-kind-confirmed-by-p3",
			"text": "Markdown needs no new wire kind confirmed by P3"
		},
		{
			"depth": 3,
			"slug": "3a--comments-on-rendered-markdown--shipped",
			"text": "3a · Comments on rendered Markdown — shipped"
		},
		{
			"depth": 3,
			"slug": "3c--more-markdown-features--appliances-on-the-grid",
			"text": "3c · More Markdown features — appliances on the grid"
		},
		{
			"depth": 2,
			"slug": "invent-the-grid--extract-three-packages-slim-kolu",
			"text": "Invent the grid — extract three packages, slim kolu"
		},
		{
			"depth": 3,
			"slug": "the-three-packages-lowy-each-encapsulates-one-volatility",
			"text": "The three packages (Lowy: each encapsulates one volatility)"
		},
		{
			"depth": 3,
			"slug": "html--svg-need-the-wire-to-carry-both-source-and-url",
			"text": "HTML / SVG need the wire to carry both source and URL"
		},
		{
			"depth": 2,
			"slug": "phasing--invent-the-grid-then-plug-in",
			"text": "Phasing — invent the grid, then plug in"
		},
		{
			"depth": 2,
			"slug": "files-this-touches",
			"text": "Files this touches"
		}
	];
}
var url = "src/content/atlas/solid-fileview.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/solid-fileview.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/solid-fileview.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
