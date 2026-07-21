import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
//#region src/content/atlas/mobile-keybar-two-row.mdx
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
			"Implemented in ",
			createVNode($$PrLink, { pr: 1181 }),
			". Branch ",
			createVNode(_components.code, { children: "mobile-keybar-two-row" }),
			". Plan of\nrecord for the ",
			createVNode(_components.code, { children: "/be" }),
			" run — ",
			createVNode(_components.strong, { children: "Option B (fixed six-column grid)" }),
			" shipped, current\nkey order kept. (As shipped, the column count is derived —\n",
			createVNode(_components.code, { children: "COLS = ceil(controls / 2)" }),
			" — and applied via an inline ",
			createVNode(_components.code, { children: "grid-template-columns" }),
			",\nnot a literal ",
			createVNode(_components.code, { children: "grid-cols-6" }),
			" class, which Tailwind would purge.)"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "The ask",
			children: createVNode(_components.p, { children: [
				"On a phone the soft key bar (",
				createVNode(_components.code, { children: "MobileKeyBar.tsx" }),
				") is a single horizontally\nscrolling row, so the keys past the fold (",
				createVNode(_components.code, { children: "^C" }),
				", ",
				createVNode(_components.code, { children: "/" }),
				", ",
				createVNode(_components.code, { children: "⏎" }),
				") require a sideways\nswipe to reach. Make it ",
				createVNode(_components.strong, { children: "two rows" }),
				" so every key is visible at once — no\nhorizontal scrolling."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "today",
			children: "Today"
		}),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.code, { children: "MobileKeyBar.tsx:88-89" }), " renders all twelve controls in one flex row that scrolls\nsideways:"] }),
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
			children: createVNode(_components.code, { children: createVNode(_components.span, {
				class: "line",
				children: createVNode(_components.span, { children: "class=\"flex gap-1 px-2 py-1.5 bg-surface-1 border-t border-edge overflow-x-auto\"" })
			}) })
		}),
		"\n",
		createVNode(_components.p, { children: "The twelve controls, in DOM order, are the two sticky modifiers then ten keys:" }),
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
					"\n",
					createVNode(_components.th, {}),
					"\n",
					createVNode(_components.th, {}),
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
					createVNode(_components.td, { children: "Ctrl" }),
					"\n",
					createVNode(_components.td, { children: "Alt" }),
					"\n",
					createVNode(_components.td, { children: "Esc" }),
					"\n",
					createVNode(_components.td, { children: "Tab" }),
					"\n",
					createVNode(_components.td, { children: "⇧Tab" }),
					"\n",
					createVNode(_components.td, { children: "↑" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "↓" }),
					"\n",
					createVNode(_components.td, { children: "←" }),
					"\n",
					createVNode(_components.td, { children: "→" }),
					"\n",
					createVNode(_components.td, { children: "^C" }),
					"\n",
					createVNode(_components.td, { children: "/" }),
					"\n",
					createVNode(_components.td, { children: "⏎" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Each button is ",
			createVNode(_components.code, { children: "shrink-0 min-w-[2.5rem]" }),
			" (",
			createVNode(_components.code, { children: "KEY_CLASS" }),
			", line 65-66), so at ~40px +\ngaps the row is ~520px wide and overflows a ~360px portrait viewport — hence the\nscroll."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "approach--two-candidate-layouts",
			children: "Approach — two candidate layouts"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode($$Pill, {
				variant: "good",
				children: "Recommended"
			}),
			" ",
			createVNode(_components.strong, { children: [
				"Option B — fixed ",
				createVNode(_components.code, { children: "grid-cols-6" }),
				"."
			] }),
			"\nReplace ",
			createVNode(_components.code, { children: "flex … overflow-x-auto" }),
			" with ",
			createVNode(_components.code, { children: "grid grid-cols-6 gap-1" }),
			". Twelve controls\nflow row-major into exactly ",
			createVNode(_components.strong, { children: "two rows of six" }),
			", regardless of viewport width.\nDrop ",
			createVNode(_components.code, { children: "shrink-0 min-w-[2.5rem]" }),
			" from ",
			createVNode(_components.code, { children: "KEY_CLASS" }),
			" so each cell stretches to fill its\ncolumn (the grid track sets the width now). The existing DOM order gives:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Ctrl" }),
					"\n",
					createVNode(_components.th, { children: "Alt" }),
					"\n",
					createVNode(_components.th, { children: "Esc" }),
					"\n",
					createVNode(_components.th, { children: "Tab" }),
					"\n",
					createVNode(_components.th, { children: "⇧Tab" }),
					"\n",
					createVNode(_components.th, { children: "↑" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "↓" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "←" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "→" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "^C" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "/" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "⏎" }) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "Guarantees the “two rows” ask on every screen; no scroll container at all." }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"Option A — ",
				createVNode(_components.code, { children: "flex-wrap" }),
				"."
			] }),
			" Swap ",
			createVNode(_components.code, { children: "overflow-x-auto" }),
			" → ",
			createVNode(_components.code, { children: "flex-wrap" }),
			", keep\n",
			createVNode(_components.code, { children: "min-w-[2.5rem]" }),
			". Smaller diff, buttons keep their natural width and wrap. But the\nrow count is viewport-dependent — two on a typical phone, possibly three on a very\nnarrow one — so it doesn’t ",
			createVNode(_components.em, { children: "guarantee" }),
			" two rows. Rejected for not meeting the ask\nprecisely."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Layout details to settle",
			children: createVNode(_components.ul, { children: [
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Key order / grouping." }),
					" Option B keeps the current order, which leaves the\narrow cluster split (",
					createVNode(_components.code, { children: "↑" }),
					" ends row 1; ",
					createVNode(_components.code, { children: "↓ ← →" }),
					" start row 2). Acceptable and\nzero-churn, but if a tidier grouping is wanted we can reorder ",
					createVNode(_components.code, { children: "KEYS" }),
					"/",
					createVNode(_components.code, { children: "MODS" }),
					" so\neach row reads coherently (e.g. modifiers + nav on row 1, arrows + send on row\n2). Default: keep current order."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Button height." }),
					" Two rows roughly doubles the bar height. ",
					createVNode(_components.code, { children: "py-1.5" }),
					" per button\nis unchanged; the bar grows by one button-row. Fine for a bottom accessory bar."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					"The ",
					createVNode(_components.code, { children: "onTouchStart" }),
					" swipe guard and the per-button ",
					createVNode(_components.code, { children: "onPointerDown" }),
					" /\n",
					createVNode(_components.code, { children: "preventDefault" }),
					" (keep xterm focused) are layout-agnostic and stay as-is."
				] }),
				"\n"
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "files",
			children: "Files"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "packages/client/src/MobileKeyBar.tsx" }),
				" — container class swap (",
				createVNode(_components.code, { children: "flex … overflow-x-auto" }),
				"\n→ ",
				createVNode(_components.code, { children: "grid grid-cols-6" }),
				"); trim ",
				createVNode(_components.code, { children: "shrink-0 min-w-[2.5rem]" }),
				" from ",
				createVNode(_components.code, { children: "KEY_CLASS" }),
				". ~2 lines."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "test-strategy-feature--new-behavior",
			children: "Test strategy (feature / new behavior)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Add an e2e assertion to the existing ",
			createVNode(_components.code, { children: "mobile-soft-keyboard.feature" }),
			" + steps\n(",
			createVNode(_components.code, { children: "mobile_soft_keyboard_steps.ts" }),
			") that pins the new layout:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "No horizontal overflow:" }),
				" the ",
				createVNode(_components.code, { children: "[data-testid=\"mobile-key-bar\"]" }),
				" element has\n",
				createVNode(_components.code, { children: "scrollWidth <= clientWidth" }),
				" (the bug today is ",
				createVNode(_components.code, { children: "scrollWidth > clientWidth" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Two rows:" }),
				" the twelve ",
				createVNode(_components.code, { children: "mobile-key-*" }),
				" buttons resolve to exactly ",
				createVNode(_components.strong, { children: [
					"two\ndistinct ",
					createVNode(_components.code, { children: "offsetTop" }),
					" values"
				] }),
				" (row-major grid ⇒ all keys live on one of two\nbaselines)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "This is the covering test for the change; it fails red against the current\nsingle-row bar and green after the grid swap." }),
		"\n",
		createVNode(_components.h2, {
			id: "evidence",
			children: "Evidence"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Per ",
			createVNode(_components.code, { children: ".agency/do.md" }),
			" ",
			createVNode(_components.code, { children: "## PR evidence" }),
			" — visible UI impact, so a screenshot of the\nmobile key bar showing all twelve keys in two rows with nothing clipped. Captured\nvia the ",
			createVNode(_components.code, { children: "/evidence" }),
			" e2e-recording path on a ",
			createVNode(_components.code, { children: "pu" }),
			" box (mobile viewport)."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "out-of-scope",
			children: "Out of scope"
		}),
		"\n",
		createVNode(_components.p, { children: "Key set, escape sequences, sticky-modifier behavior, haptics, and the swipe guard\nare unchanged — this is purely a reflow of the existing controls." })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Mobile key bar — two rows, no horizontal scroll",
	"description": "Reflow the mobile soft key bar from a single overflow-x row into two rows so every key is reachable without horizontal scrolling. Plan + layout options + test/evidence strategy.",
	"parents": ["mobile-architecture-review", "feature"],
	"maturity": "budding",
	"status": "implemented",
	"updated": "2026-06-10T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "today",
			"text": "Today"
		},
		{
			"depth": 2,
			"slug": "approach--two-candidate-layouts",
			"text": "Approach — two candidate layouts"
		},
		{
			"depth": 2,
			"slug": "files",
			"text": "Files"
		},
		{
			"depth": 2,
			"slug": "test-strategy-feature--new-behavior",
			"text": "Test strategy (feature / new behavior)"
		},
		{
			"depth": 2,
			"slug": "evidence",
			"text": "Evidence"
		},
		{
			"depth": 2,
			"slug": "out-of-scope",
			"text": "Out of scope"
		}
	];
}
var url = "src/content/atlas/mobile-keybar-two-row.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/mobile-keybar-two-row.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/mobile-keybar-two-row.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
