import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import { t as $$Cite } from "./Cite_D-1zLbJ9.mjs";
//#region src/content/atlas/release-workflow.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		em: "em",
		h2: "h2",
		hr: "hr",
		li: "li",
		ol: "ol",
		p: "p",
		strong: "strong",
		ul: "ul"
	}, props.components);
	const { Fragment: Fragment$1 } = _components;
	if (!Fragment$1) _missingMdxReference("Fragment", true);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Model — tag-on-master, rolling:" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"Ships ",
				createVNode(_components.strong, { children: "only" }),
				" as a Nix flake; users track ",
				createVNode(_components.code, { children: "master" }),
				" (",
				createVNode(_components.code, { children: "nix run github:juspay/kolu" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"A release is a ",
				createVNode(_components.strong, { children: "tag on master" }),
				" — a named point, a pin, a dated changelog entry. Nothing is published that master doesn’t already serve."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Version is picked by hand (it’s an app, no API contract): ",
				createVNode(_components.code, { children: ".0" }),
				" = milestone, a normal bump otherwise. ",
				createVNode(_components.strong, { children: [
					"Single source of truth: ",
					createVNode(_components.code, { children: "packages/server/package.json" }),
					" ",
					createVNode(_components.code, { children: "version" })
				] }),
				" (valid semver) — Nix and the server runtime both read it, so there’s nothing else to bump."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-changelog-is-website-content",
			children: "The changelog is website content"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"A ",
				createVNode(_components.strong, { children: "content collection" }),
				" beside the blog (",
				createVNode($$Cite, {
					file: "website/src/content.config.ts",
					lines: "4-14",
					label: "blog collection — same shape"
				}),
				"), not a root ",
				createVNode(_components.code, { children: "CHANGELOG.md" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"One entry per release; ",
				createVNode(_components.code, { children: "unreleased.mdx" }),
				" is the open one."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["Authored per PR by ", createVNode(_components.code, { children: "/be" })] }),
				" — its implement step appends one line under the right ",
				createVNode(_components.code, { children: "###" }),
				" heading (prose a user reads + a markdown PR link). No commit-prefix, no bump field."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "### Heads-up" }) }), " = disruptive changes (removed feature, changed default, migration), written for the user."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Conflict-free" }),
				" — ",
				createVNode(_components.code, { children: "unreleased.mdx merge=union" }),
				" in ",
				createVNode(_components.code, { children: ".gitattributes" }),
				" auto-resolves concurrent appends."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"plaintext\"><code><span class=\"line\"><span>website/src/content/changelog/</span></span>\n<span class=\"line\"><span>  unreleased.mdx     ← agent appends here, every user-facing PR</span></span>\n<span class=\"line\"><span>  1-0-0.mdx          ← stamped { version: \"1.0.0\", date: 2026-06-08 } at release</span></span></code></pre>" }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"mdx\"><code><span class=\"line\"><span style=\"color:#032F62\">---</span></span>\n<span class=\"line\"><span style=\"color:#22863A\">version</span><span style=\"color:#24292E\">: </span><span style=\"color:#032F62\">Unreleased</span></span>\n<span class=\"line\"><span style=\"color:#032F62\">---</span></span>\n<span class=\"line\"><span style=\"color:#005CC5;font-weight:bold\">### Added</span></span>\n<span class=\"line\"><span style=\"color:#E36209\">-</span><span style=\"color:#24292E\"> Compose surfaces as siblings — one canvas, no surface-app seams. (</span><span style=\"color:#032F62\">[#</span><span style=\"color:#032F62;text-decoration:underline\">1201</span><span style=\"color:#032F62\">](</span><span style=\"color:#032F62;text-decoration:underline\">https://github.com/juspay/kolu/pull/1201</span><span style=\"color:#032F62\">)</span><span style=\"color:#24292E\">)</span></span>\n<span class=\"line\"><span style=\"color:#005CC5;font-weight:bold\">### Fixed</span></span>\n<span class=\"line\"><span style=\"color:#E36209\">-</span><span style=\"color:#24292E\"> Dock pings stop pulsing once you switch to the row. (</span><span style=\"color:#032F62\">[#</span><span style=\"color:#032F62;text-decoration:underline\">1198</span><span style=\"color:#032F62\">](</span><span style=\"color:#032F62;text-decoration:underline\">https://github.com/juspay/kolu/pull/1198</span><span style=\"color:#032F62\">)</span><span style=\"color:#24292E\">)</span></span>\n<span class=\"line\"><span style=\"color:#005CC5;font-weight:bold\">### Heads-up</span></span>\n<span class=\"line\"><span style=\"color:#E36209\">-</span><span style=\"color:#032F62\"> `</span><span style=\"color:#005CC5\">KOLU_STATE_DIR</span><span style=\"color:#032F62\">`</span><span style=\"color:#24292E\"> moved under </span><span style=\"color:#032F62\">`</span><span style=\"color:#005CC5\">$XDG_CONFIG_HOME/kolu</span><span style=\"color:#032F62\">`</span><span style=\"color:#24292E\">; existing sessions auto-migrate.</span></span></code></pre>" }),
		"\n",
		createVNode(_components.h2, {
			id: "keeping-it-filled--two-checkpoints-no-ci-gate",
			children: "Keeping it filled — two checkpoints, no CI gate"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Write time" }),
				" — ",
				createVNode(_components.code, { children: "/be" }),
				" authors the entry in its implement phase (",
				createVNode($$Cite, {
					file: "agents/.apm/skills/be/SKILL.md",
					lines: "36",
					label: "be §2 — Add a changelog entry"
				}),
				"); every PR rides through ",
				createVNode(_components.code, { children: "/be" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Publish time" }),
				" — ",
				createVNode(_components.code, { children: "/release X.Y.Z" }),
				"’s go/no-go preview prints the exact ",
				createVNode(_components.code, { children: "Unreleased" }),
				" notes about to publish and waits for confirmation; a thin section is visible right before it ships."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Enough for a single-maintainer, ",
				createVNode(_components.code, { children: "/be" }),
				"-driven repo. Add a merge-blocking ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "changelog" }), " CI check"] }),
				" (diff touches ",
				createVNode(_components.code, { children: "unreleased.mdx" }),
				" or ",
				createVNode(_components.code, { children: "no-changelog" }),
				" label) only once PRs arrive from contributors who don’t run ",
				createVNode(_components.code, { children: "/be" }),
				"."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "koludev-renders-it--unreleased-included",
			children: "kolu.dev renders it — Unreleased included"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"A ",
				createVNode(_components.code, { children: "/changelog" }),
				" page maps the collection newest-first, ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "Unreleased" }), " on top"] }),
				" — shipped ",
				createVNode(_components.em, { children: "and" }),
				" upcoming, and a live preview the moment a PR merges."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The changelog ",
				createVNode(_components.strong, { children: "is" }),
				" ",
				createVNode(_components.code, { children: "website/**" }),
				", so the existing Pages deploy already fires on every edit (",
				createVNode($$Cite, {
					file: ".github/workflows/pages.yml",
					lines: "9-15",
					label: "pages.yml — on.push.paths website/**"
				}),
				") — nothing extra to wire."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "cutting-a-release",
			children: "Cutting a release"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Run ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "/release X.Y.Z" }) }),
			" (",
			createVNode($$Cite, {
				file: ".apm/skills/release/SKILL.md",
				lines: "1",
				label: "the /release skill"
			}),
			"). It does the ",
			createVNode(_components.em, { children: "what" }),
			" below and asks (via ",
			createVNode(_components.code, { children: "AskUserQuestion" }),
			") where a call is yours; everything is read-only until the explicit go/no-go."
		] }),
		"\n",
		createVNode(_components.p, { children: "Phases 1–3 are read-only; nothing is written before the go/no-go." }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Settle" }),
				" the version (editorial — ",
				createVNode(_components.code, { children: ".0" }),
				" milestone, normal bump otherwise; valid semver ",
				createVNode(_components.code, { children: "X.Y.Z" }),
				") and date."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Preflight" }),
				" — on ",
				createVNode(_components.code, { children: "master" }),
				", clean, synced, CI green on ",
				createVNode(_components.code, { children: "HEAD" }),
				" (the base the release commit builds on). Refuse otherwise."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Confirm" }),
				" — show the exact notes + version bump + tag, then go/no-go. ",
				createVNode(_components.code, { children: "No" }),
				" leaves the tree untouched."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Apply" }),
				" — promote ",
				createVNode(_components.code, { children: "unreleased.mdx" }),
				" → ",
				createVNode(_components.code, { children: "<version>.mdx" }),
				" (",
				createVNode(_components.code, { children: "{ version, date }" }),
				"), consolidating any duplicate ",
				createVNode(_components.code, { children: "###" }),
				" headings ",
				createVNode(_components.code, { children: "merge=union" }),
				" left behind into one section per heading + fresh empty Unreleased; set ",
				createVNode(_components.code, { children: "packages/server/package.json" }),
				" ",
				createVNode(_components.code, { children: "version" }),
				" (the single source — Nix + runtime both read it; nothing else to bump); commit (",
				createVNode(_components.code, { children: "release X.Y.Z" }),
				") + push ",
				createVNode(_components.code, { children: "master" }),
				". ",
				createVNode(_components.strong, { children: "No tag yet." })
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Wait" }), " for CI to go green on the pushed release commit — never tag a commit CI hasn’t passed."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Tag & publish" }),
				" — annotated tag ",
				createVNode(_components.code, { children: "vX.Y.Z" }),
				" on the green commit, push, ",
				createVNode(_components.code, { children: "gh release create" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Verify" }),
				" — tag on master, release live, ",
				createVNode(_components.code, { children: "kolu.dev/changelog" }),
				" updated; pin is ",
				createVNode(_components.code, { children: "nix run github:juspay/kolu/vX.Y.Z" }),
				"."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "wiring",
			children: "Wiring"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "changelog" }), " collection"] }),
				" — ✓ ",
				createVNode($$PrLink, { pr: 1208 }),
				" (schema, ",
				createVNode(_components.code, { children: "/changelog" }),
				" page, seeded ",
				createVNode(_components.code, { children: "unreleased.mdx" }),
				", ",
				createVNode(_components.code, { children: "merge=union" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Keep-it-filled" }),
				" — ✓ the ",
				createVNode(_components.code, { children: "/be" }),
				" implement-step entry (",
				createVNode($$Cite, {
					file: "agents/.apm/skills/be/SKILL.md",
					lines: "36"
				}),
				"); no CI gate."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Identity rail" }),
				" — ✓ version sourced once from ",
				createVNode(_components.code, { children: "packages/server/package.json" }),
				", read at runtime via ",
				createVNode(_components.code, { children: "serverVersion" }),
				" (",
				createVNode($$Cite, {
					file: "packages/server/src/hostname.ts",
					lines: "17-23",
					label: "serverVersion = pkg.version"
				}),
				") and by Nix for the artifact version (",
				createVNode($$Cite, {
					file: "default.nix",
					lines: "15-19"
				}),
				"). No env var, nothing to propagate. ",
				createVNode(_components.code, { children: "serverVersion" }),
				" is the single runtime owner — it feeds the ",
				createVNode(_components.code, { children: "buildInfo" }),
				" cell → rail (",
				createVNode(_components.code, { children: "vX.Y.Z · <hash>" }),
				"), ",
				createVNode(_components.code, { children: "--version" }),
				", the startup log, and the pty’s ",
				createVNode(_components.code, { children: "TERM_PROGRAM_VERSION" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "/release" }), " skill"] }),
				" — ✓ ",
				createVNode($$Cite, {
					file: ".apm/skills/release/SKILL.md",
					lines: "1"
				}),
				"; the steps above."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Status: ",
			createVNode(_components.code, { children: "implemented" }),
			". Surface + rail stamp + ",
			createVNode(_components.code, { children: "/release" }),
			" skill landed in ",
			createVNode($$PrLink, { pr: 1208 }),
			". First run done: ",
			createVNode(_components.code, { children: "/release 1.0.0" }),
			" cut v1.0.0 on 2026-06-08 (tag ",
			createVNode(_components.code, { children: "v1.0.0" }),
			", GitHub release, ",
			createVNode(_components.code, { children: "kolu.dev/changelog" }),
			")."
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
	"title": "kolu Release Runbook",
	"description": "Cut a release with `/release X.Y.Z` — tag master, promote the Unreleased changelog entry, GitHub release. The changelog is a website content collection the agent appends to per PR; kolu.dev renders it Unreleased-and-all.",
	"parents": ["reference"],
	"status": "implemented",
	"maturity": "seedling",
	"updated": "2026-06-10T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-changelog-is-website-content",
			"text": "The changelog is website content"
		},
		{
			"depth": 2,
			"slug": "keeping-it-filled--two-checkpoints-no-ci-gate",
			"text": "Keeping it filled — two checkpoints, no CI gate"
		},
		{
			"depth": 2,
			"slug": "koludev-renders-it--unreleased-included",
			"text": "kolu.dev renders it — Unreleased included"
		},
		{
			"depth": 2,
			"slug": "cutting-a-release",
			"text": "Cutting a release"
		},
		{
			"depth": 2,
			"slug": "wiring",
			"text": "Wiring"
		}
	];
}
var url = "src/content/atlas/release-workflow.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/release-workflow.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/release-workflow.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
