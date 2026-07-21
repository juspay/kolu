import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
//#region src/diagrams/terminal-notes-reuse.svg?raw
var terminal_notes_reuse_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 760 432\" font-family=\"ui-sans-serif, system-ui, sans-serif\">\n  <rect x=\"0.5\" y=\"0.5\" width=\"759\" height=\"431\" rx=\"14\" fill=\"#15171c\" stroke=\"#2a2e37\"/>\n\n  <!-- title -->\n  <text x=\"40\" y=\"36\" fill=\"#c7ccd6\" font-weight=\"650\" font-size=\"16.5\">Rename <tspan fill=\"#8b929d\">intent</tspan> → <tspan fill=\"#6ea8e0\">notes</tspan>, then add three surfaces</text>\n\n  <!-- legend -->\n  <rect x=\"486\" y=\"25\" width=\"15\" height=\"11\" rx=\"3\" fill=\"none\" stroke=\"#6cc070\" stroke-width=\"1.4\"/>\n  <text x=\"506\" y=\"35\" fill=\"#8b929d\" font-size=\"11.5\">exists / reused</text>\n  <rect x=\"622\" y=\"25\" width=\"15\" height=\"11\" rx=\"3\" fill=\"none\" stroke=\"#d6a35c\" stroke-width=\"1.4\" stroke-dasharray=\"4 3\"/>\n  <text x=\"642\" y=\"35\" fill=\"#8b929d\" font-size=\"11.5\">this plan</text>\n\n  <!-- hub: the renamed field -->\n  <rect x=\"250\" y=\"58\" width=\"260\" height=\"62\" rx=\"12\" fill=\"#182230\" stroke=\"#6ea8e0\" stroke-width=\"1.6\"/>\n  <text x=\"380\" y=\"84\" text-anchor=\"middle\" fill=\"#cfe0f5\" font-weight=\"650\" font-size=\"14.5\">notes — multiline markdown</text>\n  <text x=\"380\" y=\"103\" text-anchor=\"middle\" fill=\"#8b929d\" font-size=\"10.5\" font-family=\"ui-monospace, SFMono-Regular, monospace\">renamed from intent · migrated in state.ts</text>\n\n  <!-- spine + bus -->\n  <line x1=\"380\" y1=\"120\" x2=\"380\" y2=\"152\" stroke=\"#3a4150\" stroke-width=\"1.5\"/>\n  <line x1=\"200\" y1=\"152\" x2=\"560\" y2=\"152\" stroke=\"#3a4150\" stroke-width=\"1.5\"/>\n  <line x1=\"200\" y1=\"152\" x2=\"200\" y2=\"172\" stroke=\"#3a4150\" stroke-width=\"1.5\"/>\n  <line x1=\"560\" y1=\"152\" x2=\"560\" y2=\"172\" stroke=\"#3a4150\" stroke-width=\"1.5\"/>\n  <path d=\"M194,166 L200,173 L206,166\" fill=\"none\" stroke=\"#3a4150\" stroke-width=\"1.4\"/>\n  <path d=\"M554,166 L560,173 L566,166\" fill=\"none\" stroke=\"#3a4150\" stroke-width=\"1.4\"/>\n\n  <!-- column headers -->\n  <text x=\"44\" y=\"186\" fill=\"#6cc070\" font-weight=\"650\" font-size=\"12.5\">● Already wired — reuse as-is</text>\n  <text x=\"404\" y=\"186\" fill=\"#d6a35c\" font-weight=\"650\" font-size=\"12.5\">▸ Add — three client surfaces</text>\n\n  <!-- LEFT column: existing machinery (green, solid) -->\n  <g font-family=\"ui-sans-serif, system-ui, sans-serif\">\n    <rect x=\"44\" y=\"198\" width=\"312\" height=\"44\" rx=\"9\" fill=\"#161a20\" stroke=\"#3f6b45\" stroke-width=\"1\"/>\n    <text x=\"58\" y=\"219\" fill=\"#c7ccd6\" font-weight=\"600\" font-size=\"12\">Persist + autosave</text>\n    <text x=\"58\" y=\"235\" fill=\"#8b929d\" font-size=\"10\" font-family=\"ui-monospace, SFMono-Regular, monospace\">setNotes → updateClientMetadata → state.json</text>\n\n    <rect x=\"44\" y=\"252\" width=\"312\" height=\"44\" rx=\"9\" fill=\"#161a20\" stroke=\"#3f6b45\" stroke-width=\"1\"/>\n    <text x=\"58\" y=\"273\" fill=\"#c7ccd6\" font-weight=\"600\" font-size=\"12\">Survives sleep &amp; restore</text>\n    <text x=\"58\" y=\"289\" fill=\"#8b929d\" font-size=\"10\" font-family=\"ui-monospace, SFMono-Regular, monospace\">rides the persisted base through wakeMeta</text>\n\n    <rect x=\"44\" y=\"306\" width=\"312\" height=\"44\" rx=\"9\" fill=\"#161a20\" stroke=\"#3f6b45\" stroke-width=\"1\"/>\n    <text x=\"58\" y=\"327\" fill=\"#c7ccd6\" font-weight=\"600\" font-size=\"12\">Markdown render</text>\n    <text x=\"58\" y=\"343\" fill=\"#8b929d\" font-size=\"10\" font-family=\"ui-monospace, SFMono-Regular, monospace\">@kolu/solid-markdown · NotesBlock</text>\n\n    <rect x=\"44\" y=\"360\" width=\"312\" height=\"44\" rx=\"9\" fill=\"#161a20\" stroke=\"#3f6b45\" stroke-width=\"1\"/>\n    <text x=\"58\" y=\"381\" fill=\"#c7ccd6\" font-weight=\"600\" font-size=\"12\">Shared NotesEditor</text>\n    <text x=\"58\" y=\"397\" fill=\"#8b929d\" font-size=\"10\" font-family=\"ui-monospace, SFMono-Regular, monospace\">Edit / Preview sub-tabs · extracted once</text>\n  </g>\n\n  <!-- RIGHT column: new surfaces (amber, dashed) -->\n  <g font-family=\"ui-sans-serif, system-ui, sans-serif\">\n    <rect x=\"404\" y=\"198\" width=\"312\" height=\"62\" rx=\"9\" fill=\"#1d1a14\" stroke=\"#7a5e34\" stroke-width=\"1.1\" stroke-dasharray=\"4 3\"/>\n    <text x=\"418\" y=\"219\" fill=\"#e8c98f\" font-weight=\"600\" font-size=\"12.5\">Notes tab (inline editor)</text>\n    <text x=\"418\" y=\"237\" fill=\"#c7ccd6\" font-size=\"10.5\" font-family=\"ui-monospace, SFMono-Regular, monospace\">RightPanel.tsx + NotesPanel.tsx</text>\n    <text x=\"418\" y=\"252\" fill=\"#8b929d\" font-size=\"10.5\">always-visible · debounced autosave</text>\n\n    <rect x=\"404\" y=\"272\" width=\"312\" height=\"62\" rx=\"9\" fill=\"#1d1a14\" stroke=\"#7a5e34\" stroke-width=\"1.1\" stroke-dasharray=\"4 3\"/>\n    <text x=\"418\" y=\"293\" fill=\"#e8c98f\" font-weight=\"600\" font-size=\"12.5\">Close-dialog reminder</text>\n    <text x=\"418\" y=\"311\" fill=\"#c7ccd6\" font-size=\"10.5\" font-family=\"ui-monospace, SFMono-Regular, monospace\">CloseConfirm.tsx</text>\n    <text x=\"418\" y=\"326\" fill=\"#8b929d\" font-size=\"10.5\">read-only, from the frozen snapshot</text>\n\n    <rect x=\"404\" y=\"346\" width=\"312\" height=\"62\" rx=\"9\" fill=\"#1d1a14\" stroke=\"#7a5e34\" stroke-width=\"1.1\" stroke-dasharray=\"4 3\"/>\n    <text x=\"418\" y=\"367\" fill=\"#e8c98f\" font-weight=\"600\" font-size=\"12.5\">Title-bar note icon</text>\n    <text x=\"418\" y=\"385\" fill=\"#c7ccd6\" font-size=\"10.5\" font-family=\"ui-monospace, SFMono-Regular, monospace\">TileTitleActions.tsx</text>\n    <text x=\"418\" y=\"400\" fill=\"#8b929d\" font-size=\"10.5\">body-gated → opens the Notes tab</text>\n  </g>\n</svg>\n";
//#endregion
//#region src/content/atlas/terminal-notes.mdx
var C = {
	bg: "#15171c",
	panel: "#171a20",
	chrome: "#1b1e24",
	line: "#2a2e37",
	fg: "#c7ccd6",
	dim: "#8b929d",
	faint: "#5b626d",
	blue: "#6ea8e0",
	green: "#6cc070",
	amber: "#d6a35c",
	red: "#d66c6c"
};
var Panel = (props) => createVNode("figure", {
	style: "margin:1.5rem 0",
	children: [createVNode("div", {
		style: `max-width:${props.w || "32rem"};margin:0 auto;border:1px solid ${C.line};border-radius:12px;overflow:hidden;background:${C.bg};box-shadow:0 6px 22px rgba(0,0,0,.32)`,
		children: props.children
	}), props.cap && createVNode("figcaption", {
		style: "margin-top:.55rem;text-align:center;font-size:.78rem;color:#7a8089",
		children: props.cap
	})]
});
var Note = (props) => createVNode("svg", {
	width: props.s || 13,
	height: props.s || 13,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: props.c || C.amber,
	"stroke-width": "1.7",
	"stroke-linecap": "round",
	"stroke-linejoin": "round",
	style: "flex:none",
	children: [
		createVNode("path", { d: "M6 3h8l4 4v14H6z" }),
		createVNode("path", { d: "M14 3v4h4" }),
		createVNode("path", { d: "M9 12h6" }),
		createVNode("path", { d: "M9 16h4" })
	]
});
var Skel = () => createVNode("span", { style: "width:13px;height:13px;border-radius:3px;background:#ffffff12;display:inline-block" });
var NotesTab = () => createVNode(Panel, {
	w: "19rem",
	cap: "Edit / Preview are sub-tabs — like the Code tab's modes. Edit shown; Preview swaps the pane to the rendered markdown.",
	children: [
		createVNode("div", {
			style: `display:flex;gap:.1rem;padding:.4rem .45rem 0;background:${C.chrome};border-bottom:1px solid ${C.line}`,
			children: [
				createVNode("span", {
					style: `font:600 .7rem/1 ui-sans-serif;color:${C.faint};padding:.4rem .5rem`,
					children: "Inspector"
				}),
				createVNode("span", {
					style: `font:600 .7rem/1 ui-sans-serif;color:${C.faint};padding:.4rem .5rem`,
					children: "Code"
				}),
				createVNode("span", {
					style: `font:650 .7rem/1 ui-sans-serif;color:${C.fg};padding:.4rem .5rem;border-bottom:2px solid ${C.blue}`,
					children: "Notes"
				})
			]
		}),
		createVNode("div", {
			style: `display:flex;gap:.3rem;padding:.45rem .7rem;background:${C.panel};border-bottom:1px solid ${C.line}`,
			children: [createVNode("span", {
				style: `font:600 .64rem/1 ui-sans-serif;color:${C.fg};background:#ffffff12;border:1px solid ${C.line};border-radius:6px;padding:.22rem .55rem`,
				children: "Edit"
			}), createVNode("span", {
				style: `font:600 .64rem/1 ui-sans-serif;color:${C.faint};padding:.22rem .55rem`,
				children: "Preview"
			})]
		}),
		createVNode("div", {
			style: "padding:.6rem .7rem;min-height:5.5rem",
			children: createVNode("div", {
				style: `font:.72rem/1.9 ui-monospace,monospace;color:${C.dim}`,
				children: [
					createVNode("div", {
						style: `color:${C.fg}`,
						children: "## TODO"
					}),
					createVNode("div", { children: "- [ ] fix auth bug" }),
					createVNode("div", { children: ["- [ ] ask Sri re: deploy", createVNode("span", {
						style: `color:${C.blue}`,
						children: "|"
					})] })
				]
			})
		}),
		createVNode("div", {
			style: `display:flex;align-items:center;gap:.35rem;padding:.4rem .7rem;border-top:1px solid ${C.line};background:${C.panel};font:.66rem/1 ui-sans-serif`,
			children: [createVNode("span", {
				style: `color:${C.green}`,
				children: "●"
			}), createVNode("span", {
				style: `color:${C.dim}`,
				children: "autosaved · debounced"
			})]
		})
	]
});
var TitleBar = () => createVNode(Panel, {
	w: "30rem",
	cap: "A note icon appears once a note has a body — click it → Notes tab. The first line still rides the title as the chip.",
	children: createVNode("div", {
		style: `display:flex;align-items:center;gap:.5rem;padding:.55rem .7rem;background:${C.chrome}`,
		children: [
			createVNode("span", { style: `width:9px;height:9px;border-radius:50%;background:${C.blue}` }),
			createVNode("span", {
				style: `font:650 .74rem/1 ui-sans-serif;color:${C.fg}`,
				children: "api"
			}),
			createVNode("span", {
				style: `font:.66rem/1 ui-monospace,monospace;color:${C.faint}`,
				children: "main"
			}),
			createVNode("span", {
				style: `font:.62rem/1 ui-sans-serif;color:${C.amber};background:#d6a35c1f;border:1px solid #d6a35c55;border-radius:5px;padding:.13rem .42rem`,
				children: "TODO"
			}),
			createVNode("span", {
				style: "margin-left:auto;display:flex;align-items:center;gap:.55rem",
				children: [
					createVNode(Skel, {}),
					createVNode(Skel, {}),
					createVNode("span", {
						style: `display:inline-flex;border:1px solid ${C.amber};border-radius:6px;padding:.16rem .22rem;box-shadow:0 0 0 2px #d6a35c33`,
						children: createVNode(Note, {})
					}),
					createVNode(Skel, {}),
					createVNode("span", {
						style: `font:.78rem/1 ui-sans-serif;color:${C.faint}`,
						children: "✕"
					})
				]
			})
		]
	})
});
var CloseDialog = () => createVNode(Panel, {
	w: "23rem",
	cap: "Closing deletes the notes — so the dialog shows them first, read-only, from the frozen snapshot. A last look.",
	children: createVNode("div", {
		style: `padding:.95rem 1.05rem;background:${C.panel}`,
		children: [
			createVNode("div", {
				style: `font:650 .85rem/1 ui-sans-serif;color:${C.fg};margin-bottom:.7rem`,
				children: "Close terminal?"
			}),
			createVNode("div", {
				style: `border:1px solid ${C.line};border-radius:8px;background:${C.bg};padding:.55rem .65rem;margin-bottom:.6rem`,
				children: [
					createVNode("div", {
						style: `display:flex;align-items:center;gap:.3rem;font:600 .56rem/1 ui-sans-serif;color:${C.faint};letter-spacing:.06em;margin-bottom:.4rem`,
						children: [createVNode(Note, { s: 11 }), " NOTES"]
					}),
					createVNode("div", {
						style: `font:700 .74rem/1.3 ui-sans-serif;color:${C.fg}`,
						children: "TODO"
					}),
					createVNode("div", {
						style: `font:.7rem/1.6 ui-sans-serif;color:${C.dim}`,
						children: "☐ fix auth bug · ☐ ask Sri re: deploy"
					})
				]
			}),
			createVNode("div", {
				style: `display:flex;align-items:center;gap:.4rem;font:.68rem/1 ui-monospace,monospace;color:${C.dim};background:${C.chrome};border-radius:7px;padding:.42rem .55rem;margin-bottom:.85rem`,
				children: [
					createVNode("span", { children: "⎇" }),
					createVNode("span", {
						style: `color:${C.fg}`,
						children: "kolu"
					}),
					createVNode("span", {
						style: `color:${C.faint}`,
						children: "/"
					}),
					createVNode("span", { children: "public-table" })
				]
			}),
			createVNode("div", {
				style: "display:flex;justify-content:flex-end;gap:.5rem",
				children: [createVNode("span", {
					style: `font:.7rem/1 ui-sans-serif;color:${C.dim};padding:.42rem .7rem`,
					children: "Cancel"
				}), createVNode("span", {
					style: `font:600 .7rem/1 ui-sans-serif;color:#fff;background:${C.red};border-radius:7px;padding:.42rem .7rem`,
					children: "Close terminal"
				})]
			})
		]
	})
});
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		li: "li",
		ol: "ol",
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
			"Every terminal — active or sleeping — gets a Markdown notes scratchpad. The catch:\nthe field ",
			createVNode(_components.strong, { children: "already exists" }),
			" as ",
			createVNode(_components.code, { children: "intent" }),
			" (",
			createVNode(_components.code, { children: "surface.ts:255" }),
			"), fully wired. So this\nis a ",
			createVNode(_components.strong, { children: "rename + three surfaces" }),
			", not a new feature."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: terminal_notes_reuse_default,
			caption: "The field already ships (left, green). Rename intent→notes — a one-time state.ts migration, title still shows the first line — and add three client surfaces (right, amber)."
		}),
		"\n",
		createVNode(_components.h2, {
			id: "user-facing-description",
			children: "User-facing description"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Notes live in their own ",
			createVNode(_components.strong, { children: "Notes tab" }),
			", with ",
			createVNode(_components.strong, { children: "Edit / Preview" }),
			" sub-tabs (like the\nCode tab) and autosave as you type. When a terminal has notes, a ",
			createVNode(_components.strong, { children: "note icon" }),
			"\nlights up in its title bar (→ the tab), and ",
			createVNode(_components.strong, { children: "closing" }),
			" the terminal shows the\nnotes one last time before they’re gone."
		] }),
		"\n",
		createVNode(NotesTab, {}),
		"\n",
		createVNode(TitleBar, {}),
		"\n",
		createVNode(CloseDialog, {}),
		"\n",
		createVNode(_components.h2, {
			id: "architecture-level-changes",
			children: "Architecture-level changes"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, {}),
					"\n",
					createVNode(_components.th, {}),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Storage" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"reuse ",
						createVNode(_components.code, { children: "intent" }),
						", renamed ",
						createVNode(_components.strong, { children: createVNode(_components.code, { children: "notes" }) }),
						" — persistence already done"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Home" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"dedicated ",
						createVNode(_components.strong, { children: "Notes tab" }),
						" + inline editor"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Editor" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"plain ",
						createVNode(_components.code, { children: "<textarea>" }),
						" + ",
						createVNode(_components.code, { children: "@kolu/solid-markdown" }),
						" preview (",
						createVNode(_components.strong, { children: "Edit / Preview" }),
						" tabs)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Saving" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"debounced autosave (client → ",
						createVNode(_components.code, { children: "setNotes" }),
						" → server’s 500 ms → disk)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "On close" }) }),
					"\n",
					createVNode(_components.td, { children: "deleted with the terminal; the dialog is the reminder" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Boundary" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "leaf" }),
						" — reuses the existing renderer + surface; not a ",
						createVNode(_components.code, { children: "@kolu/*" }),
						" package"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Reuse, renamed." }),
				" ",
				createVNode(_components.code, { children: "intent" }),
				" is already persist + autosave + sleep/wake + restore + render. Rename → ",
				createVNode(_components.code, { children: "notes" }),
				" (one ",
				createVNode(_components.code, { children: "state.ts" }),
				" migration); the ",
				createVNode(_components.strong, { children: "title still shows the first line" }),
				" as the chip."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "New tab arm." }),
				" Notes becomes a kind in the right-panel tab union (",
				createVNode(_components.code, { children: "RightPanelTabKindSchema" }),
				"); the editor is extracted once into a shared ",
				createVNode(_components.code, { children: "NotesEditor" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Orchestration stays at the root." }),
				" ",
				createVNode(_components.code, { children: "CloseConfirm" }),
				" renders the ",
				createVNode(_components.strong, { children: [
					"frozen ",
					createVNode(_components.code, { children: "target.meta.notes" }),
					" snapshot"
				] }),
				", never a live read — the contract that keeps the reminder from shifting under the user. Leaf components get data + callbacks; the editor singleton lives at ",
				createVNode(_components.code, { children: "App.tsx" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"A leaf, not an ",
					createVNode(_components.a, {
						href: "./electricity.html",
						children: "electricity"
					}),
					"."
				] }),
				" The axes a notes editor could own are already packages — markdown → safe-HTML is ",
				createVNode(_components.code, { children: "@kolu/solid-markdown" }),
				", live-state + persistence are ",
				createVNode(_components.a, {
					href: "./surface-app.html",
					children: createVNode(_components.code, { children: "@kolu/surface" })
				}),
				". ",
				createVNode(_components.code, { children: "NotesEditor" }),
				" just plugs into both, like ",
				createVNode(_components.code, { children: "defineMutation" }),
				" / ",
				createVNode(_components.code, { children: "@kolu/commands" }),
				" in the register."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "implementation-details",
			children: "Implementation details"
		}),
		"\n",
		createVNode(_components.p, { children: "One PR, with a test + visual evidence. In order:" }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Rename" }),
				" ",
				createVNode(_components.code, { children: "intent" }),
				" → ",
				createVNode(_components.code, { children: "notes" }),
				" across common/server/client + a ",
				createVNode(_components.code, { children: "state.ts" }),
				" migration (idempotent, optional-safe)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Extract" }),
				" ",
				createVNode(_components.code, { children: "NotesEditor" }),
				" (textarea + ",
				createVNode(_components.strong, { children: "Edit / Preview" }),
				" sub-tabs) from the modal."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Notes tab" }),
				" — add the ",
				createVNode(_components.code, { children: "notes" }),
				" tab kind (compiler-enforced 3-place union change) + ",
				createVNode(_components.code, { children: "NotesPanel" }),
				" with inline debounced autosave."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Title-bar icon" }),
				" — body-gated ",
				createVNode(_components.code, { children: "NotesIcon" }),
				" → ",
				createVNode(_components.code, { children: "rightPanel.showNotes()" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Close-dialog reminder" }),
				" — read-only, off the frozen ",
				createVNode(_components.code, { children: "target.meta.notes" }),
				" snapshot."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Three things that bite",
			children: createVNode(_components.ul, { children: [
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Migration" }),
					" must be idempotent + optional-safe — test against a ",
					createVNode(_components.em, { children: "pre-rename" }),
					" session fixture, or notes vanish on first launch."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Inline editor" }),
					" reconciles from the server only when ",
					createVNode(_components.em, { children: "not" }),
					" editing — a live ",
					createVNode(_components.code, { children: "value={meta.notes}" }),
					" clobbers keystrokes."
				] }),
				"\n",
				createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Icon gates on a non-empty body" }), " (not just any notes) so it complements the title chip instead of duplicating it."] }),
				"\n"
			] })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Terminal Notes",
	"description": "Every terminal gets a Markdown notes scratchpad — a right-panel tab, a close-dialog reminder, a title-bar icon. It reuses kolu's existing `intent` field, renamed `notes` — a rename plus migration and three client surfaces, not a feature from scratch.",
	"parents": ["feature"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-06-21T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "user-facing-description",
			"text": "User-facing description"
		},
		{
			"depth": 2,
			"slug": "architecture-level-changes",
			"text": "Architecture-level changes"
		},
		{
			"depth": 2,
			"slug": "implementation-details",
			"text": "Implementation details"
		}
	];
}
var url = "src/content/atlas/terminal-notes.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/terminal-notes.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/terminal-notes.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { C, CloseDialog, Content, Content as default, Note, NotesTab, Panel, Skel, TitleBar, file, frontmatter, getHeadings, url };
