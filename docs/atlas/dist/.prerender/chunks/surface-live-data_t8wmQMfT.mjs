import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
//#region src/content/atlas/surface-live-data.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
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
			"A kolu ",
			createVNode(_components.strong, { children: "surface" }),
			" keeps a consumer’s view live in one of two ways. They deliver\nthe ",
			createVNode(_components.strong, { children: "same information" }),
			"; they differ in ",
			createVNode(_components.em, { children: "what crosses the wire on every change" }),
			"\nand ",
			createVNode(_components.em, { children: "who does the re-read" }),
			". That single distinction is the whole of the\n",
			createVNode(_components.a, {
				href: "remote-terminals.html#r8",
				children: "remote-terminals R8/R9"
			}),
			" fs/git move — so it’s worth a\npicture."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"We’ll use ",
			createVNode(_components.strong, { children: "git status" }),
			" (the Code tab’s changed-file list) as the running\nexample, since kolu serves it ",
			createVNode(_components.em, { children: "both" }),
			" ways."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "pattern-1--value-bearing-stream-the-server-pushes-the-whole-value",
			children: "Pattern 1 — value-bearing stream (the server pushes the whole value)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Each frame ",
			createVNode(_components.strong, { children: "is" }),
			" the data. The server re-computes the full value on every change\nand pushes it; the consumer subscribes once and renders the latest frame. Dumb\nconsumer, fat frames."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"text\"><code><span class=\"line\"><span>VALUE-BEARING STREAM — the server pushes the whole value on every change</span></span>\n<span class=\"line\"><span></span></span>\n<span class=\"line\"><span>  server                                   consumer (Code tab)</span></span>\n<span class=\"line\"><span>    │                                            │</span></span>\n<span class=\"line\"><span>  git change ──► frame: { 5 changed files } ───► render</span></span>\n<span class=\"line\"><span>    │                                            │</span></span>\n<span class=\"line\"><span>  git change ──► frame: { 6 changed files } ───► render</span></span>\n<span class=\"line\"><span>    │                                            │</span></span>\n<span class=\"line\"><span>  git change ──► frame: { 6 changed files } ───► render</span></span>\n<span class=\"line\"><span>    ▲                                            ▲</span></span>\n<span class=\"line\"><span>  every frame carries the FULL status      consumer just shows the latest frame</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"In code, it’s a ",
			createVNode(_components.code, { children: "stream" }),
			" member the consumer reads with ",
			createVNode(_components.code, { children: ".use()" }),
			":"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// koluSurface (kolu's own, in-process) — schematic</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> status</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> app.streams.gitStatus.</span><span style=\"color:#6F42C1\">use</span><span style=\"color:#24292E\">(() </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> ({ repoPath }));</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//    ^ a reactive accessor: each emission is the full GitStatusOutput, render it.</span></span></code></pre>" }),
		"\n",
		createVNode(_components.h2, {
			id: "pattern-2--procedure--pulse-then-requery-the-server-pings-ask-again",
			children: "Pattern 2 — procedure + pulse-then-requery (the server pings “ask again”)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The server exposes a ",
			createVNode(_components.strong, { children: "procedure" }),
			" (",
			createVNode(_components.code, { children: "git.getStatus" }),
			", request → response) ",
			createVNode(_components.em, { children: "and" }),
			" a\ntiny ",
			createVNode(_components.strong, { children: "pulse" }),
			" stream (",
			createVNode(_components.code, { children: "subscribeRepoChange" }),
			", whose payload is just a counter\n",
			createVNode(_components.code, { children: "{ seq }" }),
			"). The consumer calls the procedure once for a snapshot, then on each\npulse ",
			createVNode(_components.strong, { children: "re-queries" }),
			" the procedure. The pulse carries ",
			createVNode(_components.strong, { children: "no data" }),
			" — it’s a\n“something changed, ask again” tap. Smart consumer, thin frames."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"text\"><code><span class=\"line\"><span>PROCEDURE + PULSE-THEN-REQUERY — the server pings; the consumer pulls</span></span>\n<span class=\"line\"><span></span></span>\n<span class=\"line\"><span>  server                                   consumer (Code tab)</span></span>\n<span class=\"line\"><span>    │   ◄────────── getStatus() ───────────── (1) ask once</span></span>\n<span class=\"line\"><span>    │   ──────────► { 5 changed files } ─────► render</span></span>\n<span class=\"line\"><span>    │                                            │</span></span>\n<span class=\"line\"><span>  git change ─► pulse { seq: 1 } ─────────────► (2) \"something changed\"</span></span>\n<span class=\"line\"><span>    │   ◄────────── getStatus() ─────────────       re-query</span></span>\n<span class=\"line\"><span>    │   ──────────► { 6 changed files } ─────► render</span></span>\n<span class=\"line\"><span>    │                                            │</span></span>\n<span class=\"line\"><span>  git change ─► pulse { seq: 2 } ─────────────► re-query ──► render</span></span>\n<span class=\"line\"><span>    ▲                                            ▲</span></span>\n<span class=\"line\"><span>  the pulse carries NO data ({seq} only)   consumer pulls the full status</span></span>\n<span class=\"line\"><span>                                           only when it actually changed</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: "In code, two members the consumer wires together itself:" }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// terminalWorkspaceSurface (the shared surface pulam serves) — schematic</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">let</span><span style=\"color:#24292E\"> status </span><span style=\"color:#D73A49\">=</span><span style=\"color:#D73A49\"> await</span><span style=\"color:#6F42C1\"> getStatus</span><span style=\"color:#24292E\">(repoPath);              </span><span style=\"color:#6A737D\">// 1. snapshot (a procedure call)</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">for</span><span style=\"color:#D73A49\"> await</span><span style=\"color:#24292E\"> (</span><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> _</span><span style=\"color:#D73A49\"> of</span><span style=\"color:#6F42C1\"> subscribeRepoChange</span><span style=\"color:#24292E\">(repoPath)) </span><span style=\"color:#6A737D\">// 2. on each {seq} pulse…</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  status </span><span style=\"color:#D73A49\">=</span><span style=\"color:#D73A49\"> await</span><span style=\"color:#6F42C1\"> getStatus</span><span style=\"color:#24292E\">(repoPath);                </span><span style=\"color:#6A737D\">//    …re-query the procedure.</span></span></code></pre>" }),
		"\n",
		createVNode(_components.h2, {
			id: "same-information-different-wire-cost",
			children: "Same information, different wire cost"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The two are interchangeable in ",
			createVNode(_components.em, { children: "what the consumer ends up showing" }),
			". They trade\n",
			createVNode(_components.strong, { children: "bandwidth" }),
			" against ",
			createVNode(_components.strong, { children: "consumer simplicity" }),
			":"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, {}),
					"\n",
					createVNode(_components.th, { children: "value-bearing stream" }),
					"\n",
					createVNode(_components.th, { children: "procedure + pulse-then-requery" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "each change sends…" }),
					"\n",
					createVNode(_components.td, { children: ["the ", createVNode(_components.strong, { children: "full value" })] }),
					"\n",
					createVNode(_components.td, { children: ["a tiny ", createVNode(_components.strong, { children: [createVNode(_components.code, { children: "{seq}" }), " pulse"] })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "who re-reads" }),
					"\n",
					createVNode(_components.td, { children: [
						"the ",
						createVNode(_components.strong, { children: "server" }),
						" (pushes)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"the ",
						createVNode(_components.strong, { children: "consumer" }),
						" (pulls)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "consumer code" }),
					"\n",
					createVNode(_components.td, { children: "subscribe → render latest" }),
					"\n",
					createVNode(_components.td, { children: "call once → re-call on each pulse" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "frame size" }),
					"\n",
					createVNode(_components.td, { children: "fat (the whole status)" }),
					"\n",
					createVNode(_components.td, { children: "thin (a counter)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "best for" }),
					"\n",
					createVNode(_components.td, { children: "in-process / cheap wire" }),
					"\n",
					createVNode(_components.td, { children: "remote / ssh" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "in kolu" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "koluSurface" }), " (Code tab today)"] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "terminalWorkspaceSurface" }), " (the shared one)"] }),
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
				createVNode(_components.strong, { children: "Value-bearing" }),
				" is simplest for the consumer, but you stream the ",
				createVNode(_components.em, { children: "whole value" }),
				"\non every change."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Pulse-then-requery" }),
				" sends only a counter on every change; the full value\ncrosses the wire ",
				createVNode(_components.strong, { children: "only when the consumer pulls it" }),
				" — and only the slice it\nasks for."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-framework-view--both-are-stream-members-and-pollonevent-bridges-them",
			children: [
				"The framework view — both are ",
				createVNode(_components.code, { children: "stream" }),
				" members, and ",
				createVNode(_components.code, { children: "pollOnEvent" }),
				" bridges them"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"In ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			", a surface declares members of five ",
			createVNode(_components.strong, { children: "kinds" }),
			" — ",
			createVNode(_components.code, { children: "cell" }),
			",\n",
			createVNode(_components.code, { children: "collection" }),
			", ",
			createVNode(_components.code, { children: "stream" }),
			", ",
			createVNode(_components.code, { children: "event" }),
			", ",
			createVNode(_components.code, { children: "procedure" }),
			". Both patterns are assembled from\nthese:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"a ",
				createVNode(_components.strong, { children: "value-bearing stream" }),
				" is a ",
				createVNode(_components.code, { children: "stream" }),
				" member whose frames carry the value;"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "pulse-then-requery" }),
				" is a ",
				createVNode(_components.code, { children: "procedure" }),
				" member ",
				createVNode(_components.strong, { children: "+" }),
				" a ",
				createVNode(_components.code, { children: "stream" }),
				" member that\ncarries only ",
				createVNode(_components.code, { children: "{ seq }" }),
				"."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"So the lower-level shape is the procedure + pulse; the value-bearing stream is the\n",
			createVNode(_components.em, { children: "derived" }),
			" one. The framework helper ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "pollOnEvent" }) }),
			" is exactly that derivation —\nit builds a value-bearing stream ",
			createVNode(_components.strong, { children: "out of" }),
			" a procedure + a pulse:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"text\"><code><span class=\"line\"><span>pollOnEvent  ── builds a value-bearing stream from a procedure + a pulse</span></span>\n<span class=\"line\"><span></span></span>\n<span class=\"line\"><span>   read:    () => git.getStatus(repo)        ← pull the value   (the procedure)</span></span>\n<span class=\"line\"><span>   install: (cb) => subscribeRepoChange(cb)  ← when to re-pull   (the pulse)</span></span>\n<span class=\"line\"><span>   isEqual: gitStatusOutputEqual             ← drop a frame if nothing changed</span></span>\n<span class=\"line\"><span>        │</span></span>\n<span class=\"line\"><span>        ▼</span></span>\n<span class=\"line\"><span>   ┌──────────────────────────────────────────────┐</span></span>\n<span class=\"line\"><span>   │  a value-bearing stream                       │</span></span>\n<span class=\"line\"><span>   │  (re-reads on each pulse, emits only on change)│</span></span>\n<span class=\"line\"><span>   └──────────────────────────────────────────────┘</span></span></code></pre>" }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "One endpoint, two surface shapes",
			children: createVNode(_components.p, { children: [
				"kolu has a single fs/git ",
				createVNode(_components.strong, { children: "implementation" }),
				" (",
				createVNode(_components.code, { children: "createTerminalWorkspaceEndpoint" }),
				",\nR6) exposing ",
				createVNode(_components.code, { children: "getStatus" }),
				" + ",
				createVNode(_components.code, { children: "subscribeRepoChange" }),
				". ",
				createVNode(_components.code, { children: "koluSurface" }),
				" runs it through\n",
				createVNode(_components.code, { children: "pollOnEvent" }),
				" ",
				createVNode(_components.strong, { children: "in-process" }),
				" and serves value-bearing streams; the ",
				createVNode(_components.code, { children: "pulam" }),
				" daemon\nserves the ",
				createVNode(_components.strong, { children: "raw" }),
				" procedure + pulse on ",
				createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
				". Same endpoint,\ntwo surface shapes — chosen by where the consumer sits."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "why-kolu-uses-both",
			children: "Why kolu uses both"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "koluSurface" }) }),
				" (kolu’s own surface, served in-process to kolu’s own browser)\nuses ",
				createVNode(_components.strong, { children: "value-bearing streams" }),
				". In-process the full value is essentially free,\nso push it and keep the Code tab dumb."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "terminalWorkspaceSurface" }) }),
				" (the surface ",
				createVNode(_components.code, { children: "pulam" }),
				" serves, and the one a remote\nhost serves over ssh) uses ",
				createVNode(_components.strong, { children: "procedure + pulse" }),
				". Streaming a full git diff\ncontinuously over ssh is wasteful, so it sends a tiny pulse and lets the consumer\npull on demand — the deliberate choice the surface’s own header records\n(",
				createVNode(_components.code, { children: "packages/terminal-workspace/src/surface.ts:89-109" }),
				": ",
				createVNode(_components.em, { children: "“re-queries procedures\nrather than streaming full diffs over the wire”" }),
				")."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"That difference is the crux of ",
			createVNode(_components.a, {
				href: "remote-terminals.html#r8",
				children: "remote-terminals R8/R9"
			}),
			".\nkolu’s Code tab reads ",
			createVNode(_components.code, { children: "koluSurface" }),
			"’s ",
			createVNode(_components.strong, { children: "value-bearing" }),
			" streams today\n(",
			createVNode(_components.code, { children: "CodeTab.tsx" }),
			"); to read the ",
			createVNode(_components.strong, { children: "shared" }),
			" ",
			createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
			" it must switch\nto ",
			createVNode(_components.strong, { children: "pulse-then-requery" }),
			" — a real client change (re-query on the pulse instead of\nrendering pushed frames). That’s the bigger fs/git move, so it rides ",
			createVNode(_components.strong, { children: "R9" }),
			" (when\nkolu mirrors the shared surface whole), not R8."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Awareness has ",
			createVNode(_components.strong, { children: "no" }),
			" such split: it’s a ",
			createVNode(_components.code, { children: "collection" }),
			", the same ",
			createVNode(_components.em, { children: "kind" }),
			" on both (kolu’s ",
			createVNode(_components.code, { children: "terminalMetadata" }),
			" is a superset; only the awareness slice matches) —\nwhich is exactly why R8’s awareness half is the clean, do-now move and fs/git is\nthe heavier one that waits for R9."
		] })
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
	"title": "How a Surface Ships Live Data — Value-Bearing vs Pulse-Then-Requery",
	"description": "The two ways a @kolu/surface stream keeps a consumer live — push the whole value, or ping \"ask again\" — why they carry the same information at different wire cost, and why kolu uses both.",
	"parents": [
		"electricity",
		"reference",
		"surface"
	],
	"status": "accepted",
	"maturity": "budding",
	"updated": "2026-06-26T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "pattern-1--value-bearing-stream-the-server-pushes-the-whole-value",
			"text": "Pattern 1 — value-bearing stream (the server pushes the whole value)"
		},
		{
			"depth": 2,
			"slug": "pattern-2--procedure--pulse-then-requery-the-server-pings-ask-again",
			"text": "Pattern 2 — procedure + pulse-then-requery (the server pings “ask again”)"
		},
		{
			"depth": 2,
			"slug": "same-information-different-wire-cost",
			"text": "Same information, different wire cost"
		},
		{
			"depth": 2,
			"slug": "the-framework-view--both-are-stream-members-and-pollonevent-bridges-them",
			"text": "The framework view — both are stream members, and pollOnEvent bridges them"
		},
		{
			"depth": 2,
			"slug": "why-kolu-uses-both",
			"text": "Why kolu uses both"
		}
	];
}
var url = "src/content/atlas/surface-live-data.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/surface-live-data.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/surface-live-data.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
