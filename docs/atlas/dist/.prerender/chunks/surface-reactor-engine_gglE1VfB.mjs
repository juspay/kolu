import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import "./PrLink_DpwCuibs.mjs";
//#region src/content/atlas/surface-reactor-engine.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
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
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The decision." }),
			" ",
			createVNode(_components.a, {
				href: "surface-reactive-bridge.html",
				children: "The reactive bridge"
			}),
			"’s engine is ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "@preact/signals-core" }) }),
			", behind ",
			createVNode(_components.code, { children: "reactor.ts" }),
			", now; ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "@solidjs/signals" }), " is the named swap target"] }),
			" once Solid 2.0 and its ecosystem stabilize; kolu’s ",
			createVNode(_components.strong, { children: "frontend stays on Solid 1.9" }),
			". Despite the name, ",
			createVNode(_components.code, { children: "@preact/signals-core" }),
			" imports nothing from preact — it is a framework-free graph library (zero deps, no DOM/global reach, fully synchronous) that happens to live in preact’s monorepo; choosing it couples kolu to nothing React-shaped. And because ",
			createVNode(_components.code, { children: "reactor.ts" }),
			" is a demonstrated two-way door (below), ",
			createVNode(_components.strong, { children: "today’s choice is maintenance posture and default semantics, not architecture" }),
			". Everything here is grounded in source reads and live Node probes (Node 24.14.1, 2026-07-10)."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "why-preact-wins-today",
			children: "Why preact wins today"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"It is the only candidate that passes every bridge law with zero patches in ",
			createVNode(_components.code, { children: "reactor.ts" }),
			": explicit nested ",
			createVNode(_components.code, { children: "batch()" }),
			" with ",
			createVNode(_components.strong, { children: "promptly" }),
			" reads (a signal modified within a batch reads updated — kolu’s read-your-writes law); a throwing computed ",
			createVNode(_components.strong, { children: "caches and rethrows on every read" }),
			" until a dependency changes, then recovers (probed) — loud, never swallowed; effect disposers + cleanup + per-signal ",
			createVNode(_components.code, { children: "watched" }),
			"/",
			createVNode(_components.code, { children: "unwatched" }),
			" hooks (a direct fit for “a member knows when it has subscribers”) and GC-able unreferenced subgraphs — built for long-lived processes. The one gap — no custom ",
			createVNode(_components.code, { children: "equals" }),
			" option — is a non-cost: the bridge’s law already places equals at the single writer’s publish gate inside the framework (",
			createVNode(_components.code, { children: "server.ts:198-207" }),
			"); the engine never needs to own it."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-eliminations-one-line-each",
			children: "The eliminations, one line each"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "@vue/reactivity" }), " (standalone):"] }),
				" exports ",
				createVNode(_components.strong, { children: [
					"no ",
					createVNode(_components.code, { children: "batch" }),
					"/",
					createVNode(_components.code, { children: "flush" })
				] }),
				" — Vue’s batching lives in ",
				createVNode(_components.code, { children: "@vue/runtime-core" }),
				"’s scheduler, so reactor.ts would hand-roll exactly the frame the engine was supposed to own."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "alien-signals" }), ":"] }),
				" a throwing computed’s ",
				createVNode(_components.strong, { children: ["second read silently returns ", createVNode(_components.code, { children: "undefined" })] }),
				" (probed) — the ",
				createVNode(_components.code, { children: "caught-error-must-not-collapse-to-empty" }),
				" defect class, verbatim; an effect throw aborts the rest of the flush queue."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "@reactively/core" }), ":"] }),
				" dead (last publish 2023) and ",
				createVNode(_components.strong, { children: "no effect disposal API at all" }),
				" — the algorithm’s lineage moved to ",
				createVNode(_components.code, { children: "@solidjs/signals" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"TC39 ",
					createVNode(_components.code, { children: "signal-polyfill" }),
					":"
				] }),
				" the README’s first line forbids production use; Stage 1 since April 2024 with no advancement; no effect, no batch (build both on ",
				createVNode(_components.code, { children: "subtle.Watcher" }),
				"). And ",
				createVNode(_components.strong, { children: "Solid 2.0 is not built on it" }),
				" — 2.0’s core is ",
				createVNode(_components.code, { children: "@solidjs/signals" }),
				", its own API and repo; Solid is a design participant in the proposal, not an implementer (cited in the comparison’s sources)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "solid-js 1.x deep-imported into Node:" }),
				" the ",
				createVNode(_components.code, { children: "node" }),
				" condition routes to ",
				createVNode(_components.code, { children: "dist/server.js" }),
				" whose ",
				createVNode(_components.code, { children: "createEffect" }),
				" is a no-op; the ",
				createVNode(_components.code, { children: "dist/solid.js" }),
				" workaround risks ",
				createVNode(_components.strong, { children: "two disjoint silent reactive graphs in one process" }),
				" (one plain ",
				createVNode(_components.code, { children: "'solid-js'" }),
				" import, yours or transitive, loads the server build alongside) — the worst failure mode under fail-fast, and an unsupported configuration."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-solid-20-findings",
			children: "The Solid 2.0 findings"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "solid-js@2.0.0-beta.17" }),
				" itself is still browser/SSR-shaped: the node build’s ",
				createVNode(_components.code, { children: "createEffect" }),
				" passes the apply half as ",
				createVNode(_components.code, { children: "undefined" }),
				" — a live probe ran the effect ",
				createVNode(_components.strong, { children: "zero" }),
				" times. The framework package is not the daemon’s engine even in 2.0."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The ecosystem peer-excludes 2.x today: corvu → ",
				createVNode(_components.code, { children: "^1.8" }),
				", solid-sonner → ",
				createVNode(_components.code, { children: "^1.6.0" }),
				", the ",
				createVNode(_components.code, { children: "@solid-primitives/*" }),
				" kolu uses → ",
				createVNode(_components.code, { children: "^1.6.12" }),
				", ",
				createVNode(_components.code, { children: "@solidjs/testing-library" }),
				"’s range unsatisfied by a ",
				createVNode(_components.code, { children: "2.0.0-beta.x" }),
				" prerelease. The UI stack kolu’s conventions prefer does not install against the beta — frontend migration is blocked on the ecosystem, not just kolu’s own code."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"But ",
					createVNode(_components.code, { children: "@solidjs/signals" }),
					" passes the full standalone Node probe"
				] }),
				" — ",
				createVNode(_components.code, { children: "createRoot" }),
				" + ",
				createVNode(_components.code, { children: "createSignal" }),
				" + ",
				createVNode(_components.code, { children: "createMemo" }),
				" + ",
				createVNode(_components.code, { children: "createEffect(compute, apply)" }),
				" + ",
				createVNode(_components.code, { children: "flush()" }),
				", equality-cascade stop, root disposal. ",
				createVNode(_components.strong, { children: "One engine on both sides is the named future" }),
				": daemon imports ",
				createVNode(_components.code, { children: "@solidjs/signals" }),
				", browser imports ",
				createVNode(_components.code, { children: "solid-js@2" }),
				" wrapping the same core — one algorithm, one semantics, two entry packages. Its one semantic caveat survives the swap: 2.0 defers writes (reads are stale until ",
				createVNode(_components.code, { children: "flush()" }),
				"), so reactor.ts adds a ",
				createVNode(_components.code, { children: "flush()" }),
				"-at-publish rule to preserve the promptly law — one rule, law-tested."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-two-way-door-demonstrated",
			children: "The two-way door, demonstrated"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The same four-primitive contract — ",
			createVNode(_components.code, { children: "signal" }),
			" · ",
			createVNode(_components.code, { children: "computed" }),
			" (glitch-free lazy pull + equality-cascade stop) · ",
			createVNode(_components.code, { children: "effect" }),
			" (with disposal) · ",
			createVNode(_components.code, { children: "batch" }),
			" — was exercised on five engines in this comparison with only surface-syntax differences. The wrapper owns the three things engines disagree on — ",
			createVNode(_components.strong, { children: "equals gating, error policy, flush discipline" }),
			" — so those laws are pinned by reactor.ts’s own tests, not by engine behavior. A later swap to ",
			createVNode(_components.code, { children: "@solidjs/signals" }),
			" is mechanical: rename the calls, add the ",
			createVNode(_components.code, { children: "flush()" }),
			"-at-publish rule, run the law tests."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-probed-comparison",
			children: "The probed comparison"
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
					createVNode(_components.th, { children: createVNode(_components.strong, { children: "@preact/signals-core" }) }),
					"\n",
					createVNode(_components.th, { children: "@vue/reactivity" }),
					"\n",
					createVNode(_components.th, { children: "alien-signals" }),
					"\n",
					createVNode(_components.th, { children: "@reactively/core" }),
					"\n",
					createVNode(_components.th, { children: "signal-polyfill (TC39)" }),
					"\n",
					createVNode(_components.th, { children: "solid-js 1.x deep-import" }),
					"\n",
					createVNode(_components.th, { children: "@solidjs/signals 2.0β" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Node viability (probed)" }),
					"\n",
					createVNode(_components.td, { children: "✅ zero deps, no globals" }),
					"\n",
					createVNode(_components.td, { children: "✅ (+@vue/shared)" }),
					"\n",
					createVNode(_components.td, { children: "✅ zero deps" }),
					"\n",
					createVNode(_components.td, { children: "✅" }),
					"\n",
					createVNode(_components.td, { children: "✅" }),
					"\n",
					createVNode(_components.td, { children: [
						"⚠️ works via ",
						createVNode(_components.code, { children: "dist/solid.js" }),
						"; dual-graph trap, unsupported"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"✅ core pkg; ",
						createVNode(_components.code, { children: "solid-js" }),
						" itself still server-stubbed"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Glitch-free + batch" }),
					"\n",
					createVNode(_components.td, { children: [
						"✅ probed; explicit nested ",
						createVNode(_components.code, { children: "batch()" }),
						", promptly reads"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"✅ probed; ",
						createVNode(_components.strong, { children: "no batch export" }),
						" — hand-roll scheduler"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"✅ probed; ",
						createVNode(_components.code, { children: "startBatch/endBatch" }),
						", sync flush"
					] }),
					"\n",
					createVNode(_components.td, { children: ["✅ algorithm; manual ", createVNode(_components.code, { children: "stabilize()" })] }),
					"\n",
					createVNode(_components.td, { children: ["graph yes; ", createVNode(_components.strong, { children: "no effect/batch — build on Watcher" })] }),
					"\n",
					createVNode(_components.td, { children: "✅ (browser build)" }),
					"\n",
					createVNode(_components.td, { children: ["✅ probed; implicit microtask batch, ", createVNode(_components.strong, { children: ["reads stale until ", createVNode(_components.code, { children: "flush()" })] })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Equality-cascade stop / spec-equals" }),
					"\n",
					createVNode(_components.td, { children: [
						"✅ stop probed; no ",
						createVNode(_components.code, { children: "equals" }),
						" opt → gate in reactor (where kolu’s law puts it anyway)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"✅ stop probed; no ",
						createVNode(_components.code, { children: "equals" }),
						" opt"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"✅; no ",
						createVNode(_components.code, { children: "equals" }),
						", ",
						createVNode(_components.code, { children: "prev" }),
						" param workaround"
					] }),
					"\n",
					createVNode(_components.td, { children: ["✅ custom ", createVNode(_components.code, { children: "equals" })] }),
					"\n",
					createVNode(_components.td, { children: ["✅ spec ", createVNode(_components.code, { children: "equals" })] }),
					"\n",
					createVNode(_components.td, { children: [
						"✅ solid ",
						createVNode(_components.code, { children: "equals" }),
						" opt"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"✅ solid ",
						createVNode(_components.code, { children: "equals" }),
						" opt"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Effect disposal / long-lived ownership" }),
					"\n",
					createVNode(_components.td, { children: "✅ disposer + cleanup + watched/unwatched hooks; GC-able subgraphs" }),
					"\n",
					createVNode(_components.td, { children: [
						"✅ ",
						createVNode(_components.code, { children: "effectScope" }),
						" (probed)"
					] }),
					"\n",
					createVNode(_components.td, { children: "✅ disposer + scope" }),
					"\n",
					createVNode(_components.td, { children: ["❌ ", createVNode(_components.strong, { children: "no dispose API" })] }),
					"\n",
					createVNode(_components.td, { children: "⚠️ DIY on Watcher" }),
					"\n",
					createVNode(_components.td, { children: ["✅ ", createVNode(_components.code, { children: "createRoot" })] }),
					"\n",
					createVNode(_components.td, { children: [
						"✅ ",
						createVNode(_components.code, { children: "createRoot" }),
						" (probed)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Error propagation" }),
					"\n",
					createVNode(_components.td, { children: [
						"✅ cached + ",
						createVNode(_components.strong, { children: "rethrown every read" }),
						", recovers (probed) — fail-fast"
					] }),
					"\n",
					createVNode(_components.td, { children: "✅ throws at reader/setter (probed)" }),
					"\n",
					createVNode(_components.td, { children: [
						"❌ ",
						createVNode(_components.strong, { children: ["swallows: 2nd read returns ", createVNode(_components.code, { children: "undefined" })] }),
						" (probed)"
					] }),
					"\n",
					createVNode(_components.td, { children: "❌ none" }),
					"\n",
					createVNode(_components.td, { children: "✅ ERRORED rethrow" }),
					"\n",
					createVNode(_components.td, { children: "solid semantics" }),
					"\n",
					createVNode(_components.td, { children: "solid semantics" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Maintenance" }),
					"\n",
					createVNode(_components.td, { children: "✅ Preact team, commit 3 days ago, stable 1.x" }),
					"\n",
					createVNode(_components.td, { children: "✅ Vue team; 3.6 swaps internals" }),
					"\n",
					createVNode(_components.td, { children: "✅ active; StackBlitz; Vue 3.6 basis" }),
					"\n",
					createVNode(_components.td, { children: "❌ dead (2023)" }),
					"\n",
					createVNode(_components.td, { children: "❌ 17 mo stale; “do not use in production”" }),
					"\n",
					createVNode(_components.td, { children: "✅ solid team (but usage unsupported)" }),
					"\n",
					createVNode(_components.td, { children: "⚠️ beta, active daily" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Size/deps" }),
					"\n",
					createVNode(_components.td, { children: "259 KB unpacked, 0 deps (min ~4 KB)" }),
					"\n",
					createVNode(_components.td, { children: "343 KB + 1 dep" }),
					"\n",
					createVNode(_components.td, { children: "47 KB, 0 deps" }),
					"\n",
					createVNode(_components.td, { children: "11 KB, 0 deps" }),
					"\n",
					createVNode(_components.td, { children: "142 KB, 0 deps" }),
					"\n",
					createVNode(_components.td, { children: "1 MB pkg" }),
					"\n",
					createVNode(_components.td, { children: "357 KB, 0 deps" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "reactor.ts adaptation" }),
					"\n",
					createVNode(_components.td, { children: [
						"trivial (",
						createVNode(_components.code, { children: ".value" }),
						"↔fn, equals gate)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"medium (",
						createVNode(_components.strong, { children: "write the scheduler" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: ["small + ", createVNode(_components.strong, { children: "must add error discipline" })] }),
					"\n",
					createVNode(_components.td, { children: "large (disposal, scheduler)" }),
					"\n",
					createVNode(_components.td, { children: [
						"large (",
						createVNode(_components.strong, { children: "write effect+batch" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: "none, but fragile" }),
					"\n",
					createVNode(_components.td, { children: [
						"none API-wise; add ",
						createVNode(_components.code, { children: "flush()" }),
						"-at-publish"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Future alignment" }),
					"\n",
					createVNode(_components.td, { children: "neutral; easy to leave" }),
					"\n",
					createVNode(_components.td, { children: "3.6 internals churn behind stable API" }),
					"\n",
					createVNode(_components.td, { children: "becomes Vue’s core" }),
					"\n",
					createVNode(_components.td, { children: "lineage moved to @solidjs/signals" }),
					"\n",
					createVNode(_components.td, { children: "Stage 1, yrs away" }),
					"\n",
					createVNode(_components.td, { children: "dead end (2.0 replaces it)" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "the named future target" }) }),
					"\n"
				] }),
				"\n"
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
	"title": "The reactor engine — decided",
	"description": "The ratified engine decision for the reactive bridge: @preact/signals-core behind reactor.ts now; @solidjs/signals the named swap target once Solid 2.0 and its ecosystem stabilize; kolu's frontend stays on Solid 1.9. Grounded in a live-Node-probed comparison of six engines — today's choice is maintenance posture, not architecture, because reactor.ts is a proven two-way door.",
	"parents": [
		"reference",
		"padi",
		"surface"
	],
	"status": "accepted",
	"maturity": "seedling",
	"updated": "2026-07-10T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "why-preact-wins-today",
			"text": "Why preact wins today"
		},
		{
			"depth": 2,
			"slug": "the-eliminations-one-line-each",
			"text": "The eliminations, one line each"
		},
		{
			"depth": 2,
			"slug": "the-solid-20-findings",
			"text": "The Solid 2.0 findings"
		},
		{
			"depth": 2,
			"slug": "the-two-way-door-demonstrated",
			"text": "The two-way door, demonstrated"
		},
		{
			"depth": 2,
			"slug": "the-probed-comparison",
			"text": "The probed comparison"
		}
	];
}
var url = "src/content/atlas/surface-reactor-engine.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/surface-reactor-engine.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/surface-reactor-engine.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
