import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import { t as $$Cite } from "./Cite_IypTixBQ.mjs";
//#region src/content/atlas/code-tab-browse-git-status.mdx
var CodeTreePrototype = () => {
	const fg = "#c7ccd6", amber = "#d6a35c", green = "#6cc070";
	const rows = [
		{
			d: 0,
			name: "docs/atlas",
			folder: true,
			dot: green
		},
		{
			d: 1,
			name: "code-tab-browse-git-status.mdx",
			color: green,
			s: "U"
		},
		{
			d: 0,
			name: "packages",
			folder: true,
			dot: amber
		},
		{
			d: 1,
			name: "client/src/right-panel",
			folder: true,
			dot: amber
		},
		{
			d: 2,
			name: "BrowseDiffView.tsx"
		},
		{
			d: 2,
			name: "CodeTab.tsx",
			color: amber,
			s: "M"
		},
		{
			d: 1,
			name: "client/src/ui",
			folder: true,
			dot: amber
		},
		{
			d: 2,
			name: "pierreAdapters.ts",
			color: amber,
			s: "M"
		},
		{
			d: 1,
			name: "common/src",
			folder: true,
			dot: amber
		},
		{
			d: 2,
			name: "surface.ts",
			color: amber,
			s: "M",
			branch: true
		},
		{
			d: 1,
			name: "tests/step_definitions",
			folder: true,
			dot: amber
		},
		{
			d: 2,
			name: "code_tab_steps.ts",
			color: amber,
			s: "M"
		},
		{
			d: 0,
			name: "README.md"
		},
		{
			d: 0,
			name: "package.json"
		}
	];
	const chip = (label, active) => createVNode("span", {
		style: `padding:.2rem .55rem;border-radius:6px;font:600 .68rem/1 ui-sans-serif,system-ui;${active ? "background:#2d4a8a;color:#dbe7ff;border:1px solid #3b82f6" : "color:#8b929d;border:1px solid transparent"}`,
		children: label
	});
	const swatch = (letter, color, word) => createVNode("span", { children: [
		createVNode("b", {
			style: `color:${color}`,
			children: letter
		}),
		" ",
		word
	] });
	return createVNode("div", {
		style: "margin:1.5rem 0;max-width:30rem;border:1px solid #2a2e37;border-radius:12px;overflow:hidden;background:#15171c;box-shadow:0 4px 18px rgba(0,0,0,.28)",
		children: [
			createVNode("div", {
				style: "display:flex;align-items:center;gap:.45rem;padding:.5rem .8rem;background:#1b1e24;border-bottom:1px solid #2a2e37",
				children: [
					createVNode("span", { style: "width:10px;height:10px;border-radius:50%;background:#ff5f56;display:inline-block" }),
					createVNode("span", { style: "width:10px;height:10px;border-radius:50%;background:#ffbd2e;display:inline-block" }),
					createVNode("span", { style: "width:10px;height:10px;border-radius:50%;background:#27c93f;display:inline-block" }),
					createVNode("span", {
						style: "margin-left:.4rem;font:600 .72rem/1 ui-monospace,monospace;color:#8b929d",
						children: "kolu · Code"
					})
				]
			}),
			createVNode("div", {
				style: "display:flex;align-items:center;gap:.35rem;padding:.45rem .7rem;background:#171a20;border-bottom:1px solid #2a2e37",
				children: [
					chip("All files", true),
					chip("Local", false),
					chip("Branch", false),
					createVNode("span", { style: "flex:1" }),
					createVNode("span", {
						style: "font:.66rem/1 ui-sans-serif,system-ui;color:#5b626d;border:1px solid #2a2e37;border-radius:6px;padding:.2rem .5rem",
						children: "Filter…"
					})
				]
			}),
			createVNode("div", {
				style: "padding:.4rem 0",
				children: rows.map((r) => createVNode("div", {
					style: `display:flex;align-items:center;padding:.17rem .8rem;padding-left:${.7 + r.d * 1.15}rem;font:.76rem/1.4 ui-monospace,monospace`,
					children: [
						createVNode("span", {
							style: `flex:1;color:${r.color || (r.folder ? r.dot || "#aeb4be" : fg)}`,
							children: [
								r.folder ? createVNode("span", {
									style: "color:#5b626d",
									children: "▾ "
								}) : null,
								r.name,
								r.dot ? createVNode("span", {
									style: `color:${r.dot};margin-left:.4rem`,
									children: "•"
								}) : null
							]
						}),
						r.branch ? createVNode("span", {
							style: "font:600 .58rem/1 ui-sans-serif,system-ui;color:#828893;border:1px solid #3a3f49;border-radius:4px;padding:.08rem .32rem;margin-right:.45rem",
							children: "via branch"
						}) : null,
						r.s ? createVNode("span", {
							style: `color:${r.color};font-weight:700`,
							children: r.s
						}) : null
					]
				}))
			}),
			createVNode("div", {
				style: "display:flex;flex-wrap:wrap;gap:.75rem;padding:.55rem .8rem;background:#171a20;border-top:1px solid #2a2e37;font:.64rem/1 ui-sans-serif,system-ui;color:#8b929d",
				children: [
					swatch("M", "#d6a35c", "modified"),
					swatch("A", "#6cc070", "added"),
					swatch("U", "#6cc070", "untracked"),
					swatch("R", "#6ea8e0", "renamed"),
					swatch("D", "#d66c6c", "deleted")
				]
			})
		]
	});
};
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		em: "em",
		h2: "h2",
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
			"Shipped in ",
			createVNode($$PrLink, { pr: 1185 }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Before this, the ",
			createVNode(_components.strong, { children: "All files" }),
			" view was the only Code-tab mode with no git\nsignal — you switched to Local/Branch to see what changed, losing whole-repo\ncontext. Now it looks like:"
		] }),
		"\n",
		createVNode(CodeTreePrototype, {}),
		"\n",
		createVNode(_components.h2, {
			id: "behavior",
			children: "Behavior"
		}),
		"\n",
		createVNode(_components.p, { children: "Each row reflects the union of two questions, the more immediate one winning:" }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Row color" }),
					"\n",
					createVNode(_components.th, { children: "Source" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "“editing now” (incl. new files)" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "working tree" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "“this branch changed it” (committed, now clean)" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "branch base" }),
						" — tagged ",
						createVNode(_components.code, { children: "via branch" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "both" }),
					"\n",
					createVNode(_components.td, { children: [
						"working tree ",
						createVNode(_components.strong, { children: "wins" }),
						" ",
						createVNode($$Pill, {
							variant: "good",
							children: "prefer Local"
						})
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "unchanged" }),
					"\n",
					createVNode(_components.td, { children: "none" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Branch is best-effort: a repo with no ",
			createVNode(_components.code, { children: "origin/<default>" }),
			" has no base, so that\nlayer is simply absent and the view falls back to the always-available\nworking-tree layer (no error toast in this passive view)."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "architecture",
			children: "Architecture"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"One derivation (",
			createVNode(_components.code, { children: "treeGitStatus" }),
			") already is the sole source of row decoration;\nthe change only widens what it reads in browse mode. No new contract, no server\nor schema change — both git-status streams already exist; All files just\nsubscribes to both and overlays them client-side."
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
					children: createVNode(_components.span, { children: "  Local / Branch ─────────▶ status.files ───┐" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  All files ──┬─ local ───▶ overlay(local,  ├─▶ treeGitStatus ─▶ <FileTree> ─▶ Pierre" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "              └─ branch ──▶   branch) ← new ─┘                    data-item-git-status" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "                 local wins on conflict" })
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Folder tint." }),
			" Pierre marks every ancestor of a changed file with\n",
			createVNode(_components.code, { children: "data-item-contains-git-change" }),
			" but only paints a half-opacity dot, and exposes\nno ",
			createVNode(_components.code, { children: "--trees-*" }),
			" variable to tint the folder itself. So ",
			createVNode(_components.code, { children: "solid-pierre" }),
			"’s\n",
			createVNode(_components.code, { children: "<FileTree>" }),
			" gains a generic ",
			createVNode(_components.code, { children: "shadowCss" }),
			" escape hatch — a constructable\nstylesheet appended to Pierre’s shadow root — and kolu owns the one rule\n(",
			createVNode(_components.code, { children: "pierreTreesShadowCss" }),
			") that colors the folder name\n(",
			createVNode(_components.code, { children: "[data-item-section='content']" }),
			") in the modified color. The boundary stays\nclean: the wrapper offers the ",
			createVNode(_components.em, { children: "capability" }),
			" (domain-agnostic), the host supplies\nthe ",
			createVNode(_components.em, { children: "rule" }),
			" (which knows Pierre’s row anatomy)."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "tests",
			children: "Tests"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Unit" }), " — the overlay rule: local wins on a shared path; branch-only keeps its color; untracked preserved; empty ⇒ none."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "E2E" }),
				" — in All files, a modified file’s row carries ",
				createVNode(_components.code, { children: "data-item-git-status" }),
				" and an unchanged row carries none; and an ancestor folder of a change is marked ",
				createVNode(_components.code, { children: "data-item-contains-git-change" }),
				" ",
				createVNode(_components.strong, { children: "and" }),
				" computes a different name color than a clean sibling — proving the injected tint lands (",
				createVNode($$Cite, {
					file: "packages/tests/step_definitions/code_tab_steps.ts",
					lines: "1"
				}),
				")."
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
	"title": "Git-status indicators in the Code-tab \"All files\" view",
	"description": "Browsing the whole repo should still tell you what's changed. Gives the Code-tab \"All files\" view the same git-status colors Local/Branch already show, by overlaying a local-status layer (primary) on a branch-status layer (fallback). Shipped in #1185.",
	"parents": ["solid-fileview", "feature"],
	"maturity": "seedling",
	"status": "implemented",
	"updated": "2026-06-10T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "behavior",
			"text": "Behavior"
		},
		{
			"depth": 2,
			"slug": "architecture",
			"text": "Architecture"
		},
		{
			"depth": 2,
			"slug": "tests",
			"text": "Tests"
		}
	];
}
var url = "src/content/atlas/code-tab-browse-git-status.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/code-tab-browse-git-status.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/code-tab-browse-git-status.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { CodeTreePrototype, Content, Content as default, file, frontmatter, getHeadings, url };
