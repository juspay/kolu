import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/content/atlas/bug-shiki-grammar-load-race.mdx
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
		tr: "tr"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"The flaky-test tracker’s ",
			createVNode(_components.code, { children: "release-workflow.html" }),
			" byte-shrink row (see\n",
			createVNode(_components.a, {
				href: "./flaky-test-tracker.html",
				children: "flaky-test-tracker"
			}),
			") recurred ",
			createVNode(_components.strong, { children: "twice" }),
			" after\n",
			createVNode($$PrLink, { pr: 1853 }),
			" disabled shiki’s tokenization time budget — because the\ntime budget was the wrong mechanism. This note pins the real one, verified\nfrom scratch against the installed sources, and the fix — implemented in\n",
			createVNode($$PrLink, { pr: 1874 }),
			"."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "sg1--mechanism-a-cross-file-grammar-load-order-race",
			children: "SG1 — Mechanism: a cross-file grammar-load order race"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Shiki’s bundled ",
			createVNode(_components.code, { children: "mdx" }),
			" grammar declares its embedded languages ",
			createVNode(_components.strong, { children: "lazily" }),
			":\n",
			createVNode(_components.code, { children: "@shikijs/langs/mdx" }),
			" ships ",
			createVNode(_components.code, { children: "embeddedLangs: []" }),
			",\n",
			createVNode(_components.code, { children: "embeddedLangsLazy: [\"tsx\",\"toml\",\"yaml\",…]" }),
			". Loading ",
			createVNode(_components.code, { children: "mdx" }),
			" does ",
			createVNode(_components.strong, { children: "not" }),
			" load\n",
			createVNode(_components.code, { children: "yaml" }),
			". The embedded YAML grammar only engages after ",
			createVNode(_components.code, { children: "yaml" }),
			" is loaded for some\n",
			createVNode(_components.em, { children: "other" }),
			" reason — and when that happens, shiki re-resolves every grammar that\nlazily embeds it (",
			createVNode(_components.code, { children: "Registry.loadLanguage" }),
			"’s ",
			createVNode(_components.code, { children: "embeddedLazilyBy" }),
			" re-load,\n",
			createVNode(_components.code, { children: "@shikijs/primitive" }),
			" 4.1.0)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Astro’s shiki path (",
			createVNode(_components.code, { children: "@astrojs/markdown-remark" }),
			" 7.2.0 →\n",
			createVNode(_components.code, { children: "@astrojs/internal-helpers" }),
			" 0.10.0) loads grammars ",
			createVNode(_components.strong, { children: "per code block, on\ndemand" }),
			": ",
			createVNode(_components.code, { children: "highlight()" }),
			" checks ",
			createVNode(_components.code, { children: "getLoadedLanguages()" }),
			" and lazily\n",
			createVNode(_components.code, { children: "loadLanguage()" }),
			"s the block’s language. The highlighter instance is a\n",
			createVNode(_components.strong, { children: "module-level cache shared across every MDX file" }),
			" the build compiles, and\nvite transforms those files concurrently — so registry state at the moment any\ngiven block tokenizes depends on cross-file timing."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The Atlas content holds the minimal race pair: exactly one ",
			createVNode(_components.code, { children: "mdx" }),
			" fence\n(",
			createVNode(_components.code, { children: "release-workflow.mdx" }),
			", a changelog sample with YAML frontmatter) and exactly\none ",
			createVNode(_components.code, { children: "yaml" }),
			" fence (",
			createVNode(_components.code, { children: "roadmap-graph.mdx" }),
			")."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Transform order under vite" }),
					"\n",
					createVNode(_components.th, { children: [
						"Registry when the ",
						createVNode(_components.code, { children: "mdx" }),
						" block tokenizes"
					] }),
					"\n",
					createVNode(_components.th, { children: [createVNode(_components.code, { children: "---" }), " frontmatter renders as"] }),
					"\n",
					createVNode(_components.th, { children: "Result" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "roadmap-graph" }), " first"] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "yaml" }), " present → mdx re-resolved with embedded YAML"] }),
					"\n",
					createVNode(_components.td, { children: [
						"YAML tokens (key ",
						createVNode(_components.code, { children: "#22863A" }),
						", string ",
						createVNode(_components.code, { children: "#032F62" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: "committed dist, 24757 B" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "release-workflow" }), " first"] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "yaml" }), " absent"] }),
					"\n",
					createVNode(_components.td, { children: [
						"bold thematic breaks (",
						createVNode(_components.code, { children: "#005CC5" }),
						"), body plain"
					] }),
					"\n",
					createVNode(_components.td, { children: "flaked dist, 24721 B" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Reproduced empirically on the pinned ",
			createVNode(_components.code, { children: "shiki@4.1.0" }),
			": a highlighter with\n",
			createVNode(_components.code, { children: "langs: [\"mdx\"]" }),
			" renders the exact frontmatter sample with zero YAML tokens\nand the ",
			createVNode(_components.code, { children: "#005CC5" }),
			" bold-fence signature; with ",
			createVNode(_components.code, { children: "yaml" }),
			" present (either load\norder) it renders the committed dist’s YAML tokens. This explains everything\nthe time-budget theory couldn’t: per-box/per-run variance under a nix-pinned\nclosure, whole-block (not tail-truncated) divergence, immediate-green reruns,\nand recurrence with ",
			createVNode(_components.code, { children: "tokenizeTimeLimit: 0" }),
			" in the tree."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "sg2--fix-langs-derived-from-the-content-plus-a-fail-fast-guard",
			children: [
				"SG2 — Fix: ",
				createVNode(_components.code, { children: "langs" }),
				" derived from the content, plus a fail-fast guard"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Make grammar readiness deterministic by construction: preload every fence\nlanguage the content uses as ",
			createVNode(_components.code, { children: "shikiConfig.langs" }),
			", in ",
			createVNode(_components.strong, { children: "both" }),
			" astro\nprojects.",
			createVNode($$Footnote, { children: [
				"The website is the same class — same astro/shiki pipeline,\nand its silent degradation ships to kolu.dev unnoticed. ",
				createVNode($$PrLink, { pr: 1853 }),
				"\nfixed both, so this does too."
			] }),
			" Astro forwards ",
			createVNode(_components.code, { children: "langs" }),
			" to\n",
			createVNode(_components.code, { children: "createHighlighter()" }),
			", which loads every listed grammar — re-resolving lazy\nembedders — ",
			createVNode(_components.strong, { children: "before" }),
			" the highlighter is handed to the first code block.\nOnce every content language is preloaded, the per-block lazy-load path never\nfires mid-build, so the registry is immutable during tokenization and the\noutput is a pure function of source. Load ",
			createVNode(_components.em, { children: "order" }),
			" within the preload doesn’t\nmatter: shiki’s ",
			createVNode(_components.code, { children: "embeddedLazilyBy" }),
			" re-resolution converges to the same final\nregistry."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The list is ",
			createVNode(_components.strong, { children: "derived from the content, never hand-enumerated" }),
			": one shared\nscanner, ",
			createVNode(_components.code, { children: "scripts/fence-langs.mjs" }),
			", globs the project’s ",
			createVNode(_components.code, { children: "src/" }),
			" for fence\nopeners (indented, blockquoted, ",
			createVNode(_components.code, { children: "~~~" }),
			", four-backtick, info-string forms — all\nfixture-tested, the blockquote form red-first) and both configs call it at\nconfig-eval time. The content is the source of truth, so the list cannot\ndrift from it — a fence in a new language is preloaded on the next build by\nconstruction.",
			createVNode($$Footnote, { children: [
				"Preloading ",
				createVNode(_components.em, { children: "all" }),
				" 332 bundled grammars was measured as\nthe alternative: ~3.2 s and ~340 MB RSS per highlighter — paid on every\nbuild, three times per ",
				createVNode(_components.code, { children: "atlas::check-sync" }),
				" run, on exactly the CPU-contended\nCI boxes where the flake bites. The derived list gets the same\nzero-maintenance determinism without that tax. ",
				createVNode(_components.code, { children: "docs/atlas" }),
				" imports the\nscanner relatively; the website’s Nix sandbox copies only ",
				createVNode(_components.code, { children: "website/" }),
				", so\n",
				createVNode(_components.code, { children: "default.nix" }),
				" places a copy beside the config (the\n",
				createVNode(_components.code, { children: "kolu-server-package.json" }),
				" pattern) and ",
				createVNode(_components.code, { children: "src/shiki-config.mjs" }),
				" holds the\nwhole shiki object as plain ESM — the one module both ",
				createVNode(_components.code, { children: "astro.config.mjs" }),
				" and\nthe unit pins import."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The remaining hole is a fence ",
			createVNode(_components.strong, { children: "shape" }),
			" the scanner might not recognize, so\neach config also installs a ",
			createVNode(_components.strong, { children: "fail-fast transformer" }),
			"\n(",
			createVNode(_components.code, { children: "kolu:shiki-eager-langs-only" }),
			"): ",
			createVNode(_components.code, { children: "preprocess" }),
			" throws when a block’s language\nis neither skipped by design (shiki specials\n",
			createVNode(_components.code, { children: "plaintext" }),
			"/",
			createVNode(_components.code, { children: "text" }),
			"/",
			createVNode(_components.code, { children: "txt" }),
			"/",
			createVNode(_components.code, { children: "plain" }),
			"/",
			createVNode(_components.code, { children: "ansi" }),
			"; astro’s own excluded ",
			createVNode(_components.code, { children: "math" }),
			") nor\npreloaded. The guard is a check-after-write, not a gate — astro lazy-loads\nthe offending grammar ",
			createVNode(_components.em, { children: "before" }),
			" any transformer runs — but the throw fails the\nbuild before the order-dependent bytes can ship, and determinism of ",
			createVNode(_components.em, { children: "emitted\noutput" }),
			" is what the flake is made of, not registry purity. Every cell of the\nfailure matrix is then loud or deterministic, never racy:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Fence" }),
					"\n",
					createVNode(_components.th, { children: "Language known to shiki" }),
					"\n",
					createVNode(_components.th, { children: "Outcome" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "scanned" }),
					"\n",
					createVNode(_components.td, { children: [
						"yes (incl. decorative-but-bundled ",
						createVNode(_components.code, { children: "mermaid" }),
						"/",
						createVNode(_components.code, { children: "console" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: "preloaded — deterministic by construction" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "scanned" }),
					"\n",
					createVNode(_components.td, { children: [
						"no (typo, an unbundled name like ",
						createVNode(_components.code, { children: "pseudocode" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "createHighlighter" }),
						" fails at build start naming the language — ",
						createVNode(_components.strong, { children: "loud" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "scan-missed shape" }),
					"\n",
					createVNode(_components.td, { children: "yes" }),
					"\n",
					createVNode(_components.td, { children: ["mid-build load, then the guard throws — ", createVNode(_components.strong, { children: "loud" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "scan-missed shape" }),
					"\n",
					createVNode(_components.td, { children: "no" }),
					"\n",
					createVNode(_components.td, { children: "astro rewrites to plaintext before any transformer runs — deterministic plaintext (no grammar ever loads), console warning" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The decorative-language policy follows from rows 1–2: a decorative fence is\nenumerated like any other, and shiki ",
			createVNode(_components.em, { children: "does" }),
			" bundle ",
			createVNode(_components.code, { children: "mermaid" }),
			" and ",
			createVNode(_components.code, { children: "console" }),
			",\nso those silently preload (row 1 — a harmless extra grammar); a name shiki\ndoesn’t bundle fails the build at startup with the language named (row 2 —\nthe error carries the language, not the fence’s file, so grep the fences for\nit). Renaming a decorative fence to ",
			createVNode(_components.code, { children: "text" }),
			" is an authoring convention, not a\nbuild-enforced rule."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "kolu:shiki-no-tokenize-bail" }),
			" (",
			createVNode($$PrLink, { pr: 1853 }),
			") ",
			createVNode(_components.strong, { children: "stays" }),
			": it addresses a\nreal, distinct degradation — vscode-textmate’s over-budget bail returns\npartial tokens with a ",
			createVNode(_components.code, { children: "stoppedEarly" }),
			" flag shiki never checks — with its own\nred-first pin (8001 spans → 361 at ",
			createVNode(_components.code, { children: "tokenizeTimeLimit: 1" }),
			"). Removing it would\nneed its own argument; this fix neither depends on it nor supersedes it."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Accepted residual (documented, not chased):" }),
			" astro’s ",
			createVNode(_components.code, { children: "&lt;Code&gt;" }),
			"\ncomponent caches highlighters by ",
			createVNode(_components.em, { children: "theme" }),
			", so the website’s ",
			createVNode(_components.code, { children: "Snippet.astro" }),
			"\n(same vitesse theme pair as the markdown config) shares the markdown path’s\nhighlighter instance and loads its ",
			createVNode(_components.code, { children: "lang" }),
			" on it mid-build. Today that lang is\nonly ",
			createVNode(_components.code, { children: "ts" }),
			" — already preloaded, no lazy embeds — and the website content has\nno ",
			createVNode(_components.code, { children: "mdx" }),
			"/",
			createVNode(_components.code, { children: "markdown" }),
			" fence to re-resolve, so the cell is inert; it becomes\nracy only if a ",
			createVNode(_components.code, { children: "&lt;Code&gt;" }),
			" use introduces a language that is both\nun-preloaded and lazily embedded by a content grammar, which the soak and the\nwiring pins would surface as a diff."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "sg3--pins-red-first-then-soak-certified",
			children: "SG3 — Pins: red-first, then soak-certified"
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Deterministic red" }),
				" (unit, ",
				createVNode(_components.code, { children: "docs/atlas/build/shiki-grammar-preload.test.mjs" }),
				",\nruns under ",
				createVNode(_components.code, { children: "just atlas::check" }),
				"): build the highlighter through astro’s real\n",
				createVNode(_components.code, { children: "createShikiHighlighter" }),
				" with the ",
				createVNode(_components.em, { children: "actual" }),
				" ",
				createVNode(_components.code, { children: "astro.config.mjs" }),
				" shikiConfig\nand tokenize the release-workflow frontmatter sample as ",
				createVNode(_components.code, { children: "mdx" }),
				" ",
				createVNode(_components.strong, { children: "first" }),
				" —\nno prior yaml load. Demonstrated red on the pre-fix config (no YAML\ntokens, the ",
				createVNode(_components.code, { children: "#005CC5" }),
				" plain signature), green with the fix (YAML tokens,\nalways). Plus the mechanism-regression case (grammar presence flips the\nsignature, order-independent) and guard cases (un-preloaded language\nthrows; ",
				createVNode(_components.code, { children: "text" }),
				" passes as plaintext)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "One scanner, wired and fixture-tested" }),
				": ",
				createVNode(_components.code, { children: "fence-langs.test.mjs" }),
				" covers\nthe fence shapes (blockquoted red-first — the initial regex missed a\nfence opener behind a ",
				createVNode(_components.code, { children: ">" }),
				" blockquote marker), and each project carries a wiring assert\n(",
				createVNode(_components.code, { children: "shikiConfig.langs" }),
				" deep-equals ",
				createVNode(_components.code, { children: "fenceLangs(src/)" }),
				") so the config can\nnever quietly stop deriving. The website’s pins\n(",
				createVNode(_components.code, { children: "website/test/shiki-eager-langs.test.mjs" }),
				", theme-agnostic: distinct-color\ncounts, not github-light hexes) run in the Nix derivation’s ",
				createVNode(_components.code, { children: "checkPhase" }),
				",\nCI-gated via ",
				createVNode(_components.code, { children: "ci::nix" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Measured outcome" }),
				": rebuilding with the fix leaves the committed\n",
				createVNode(_components.code, { children: "docs/atlas/dist/" }),
				" ",
				createVNode(_components.strong, { children: "byte-identical" }),
				" — the preload deterministically\nreproduces the lucky-order rendering the committed dist happened to\ncapture (yaml present; the preloaded ",
				createVNode(_components.code, { children: "tsx" }),
				" adds nothing to the one mdx\nsample). ",
				createVNode(_components.code, { children: "atlas::check-sync" }),
				" and the website build stay green."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Byte-determinism" }),
				": N repeated ",
				createVNode(_components.code, { children: "atlas::build" }),
				"s are byte-identical\n(script-level, on a pu box — not CI-only)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Soak cert" }),
				" (the evidence ",
				createVNode($$PrLink, { pr: 1853 }),
				" never had): ≥20\nconsecutive ",
				createVNode(_components.code, { children: "just atlas::check-sync" }),
				" runs on the linux CI class where it\nflaked, plus a darwin window — N/N byte-identical or the mechanism is\nincomplete and the divergent bytes get preserved before anything else."
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
	"title": "Bug — atlas-sync shiki flake: the embedded-grammar load race",
	"description": "release-workflow.html byte-shrinks under load because whether an ```mdx code block gets embedded-YAML highlighting depends on whether some other file's ```yaml block happened to be highlighted first. Fix: derive the langs list from the content itself and preload it in both astro configs, with a fail-fast guard so a fence the scan misses can never silently reopen the race.",
	"parents": ["bug"],
	"status": "implemented",
	"maturity": "seedling",
	"updated": "2026-07-16T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "sg1--mechanism-a-cross-file-grammar-load-order-race",
			"text": "SG1 — Mechanism: a cross-file grammar-load order race"
		},
		{
			"depth": 2,
			"slug": "sg2--fix-langs-derived-from-the-content-plus-a-fail-fast-guard",
			"text": "SG2 — Fix: langs derived from the content, plus a fail-fast guard"
		},
		{
			"depth": 2,
			"slug": "sg3--pins-red-first-then-soak-certified",
			"text": "SG3 — Pins: red-first, then soak-certified"
		}
	];
}
var url = "src/content/atlas/bug-shiki-grammar-load-race.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/bug-shiki-grammar-load-race.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/bug-shiki-grammar-load-race.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
