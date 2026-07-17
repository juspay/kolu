import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import { t as $$Cite } from "./Cite_D-1zLbJ9.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
import { t as $$Footnote } from "./Footnote_Co54bi9w.mjs";
//#region src/diagrams/surface-runtime-boundary-architecture.svg?raw
var surface_runtime_boundary_architecture_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1360 820\" role=\"img\" aria-labelledby=\"title desc\">\n  <title id=\"title\">The campaign plan: kernel moves land where the volatility already lives</title>\n  <desc id=\"desc\">Six kernel moves land in the packages that already own their volatility: the supervised SurfaceRuntime, bound procedures, and one-shot adoptions in @kolu/surface beside the shipped reactor bridge; membership ids, total failure, and the typed connection key in @kolu/surface-map; the delta-aware mirror and clock-at-admit in @kolu/surface-remote. Kolu, Drishti, and Odu each delete hand-rolled machinery. A faint bottom strip records what stays out of the plan by design: the Feed member kind, the surface-suite package, the Odu lease stack, and createLiveQuery.</desc>\n  <defs>\n    <marker id=\"arrow\" markerWidth=\"10\" markerHeight=\"10\" refX=\"8\" refY=\"5\" orient=\"auto\" markerUnits=\"strokeWidth\">\n      <path d=\"M0,0 L10,5 L0,10 z\" fill=\"var(--ink-faint)\" />\n    </marker>\n    <style>\n      .box { fill: var(--surface); stroke: var(--rule); stroke-width: 2; }\n      .core { fill: var(--code-bg); stroke: var(--amber); stroke-width: 2.5; }\n      .map { fill: var(--surface); stroke: var(--gold); stroke-width: 2.5; }\n      .remote { fill: var(--surface); stroke: var(--teal); stroke-width: 2.5; }\n      .bridge { fill: var(--surface); stroke: var(--green); stroke-width: 2; stroke-dasharray: none; }\n      .consumer { fill: var(--paper); stroke: var(--rule); stroke-width: 2; }\n      .ghost { fill: none; stroke: var(--rule-soft); stroke-width: 1.5; stroke-dasharray: 6 5; }\n      .title { fill: var(--ink); font: 650 22px ui-sans-serif, system-ui, sans-serif; }\n      .label { fill: var(--ink); font: 650 17px ui-sans-serif, system-ui, sans-serif; }\n      .small { fill: var(--ink-dim); font: 14px ui-sans-serif, system-ui, sans-serif; }\n      .tiny { fill: var(--ink-muted); font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }\n      .arrow { fill: none; stroke: var(--ink-faint); stroke-width: 2.2; marker-end: url(#arrow); }\n      .rule { stroke: var(--rule-soft); stroke-width: 1.5; }\n      .tag { fill: var(--amber); font: 650 12px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .04em; }\n      .tagmap { fill: var(--gold); font: 650 12px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .04em; }\n      .tagremote { fill: var(--teal); font: 650 12px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .04em; }\n      .pr { fill: var(--ink-muted); font: 650 12px ui-monospace, SFMono-Regular, Menlo, monospace; }\n    </style>\n  </defs>\n\n  <text x=\"40\" y=\"38\" class=\"title\">The kernel lands where the volatility already lives — no new package</text>\n  <text x=\"40\" y=\"64\" class=\"small\">Six kernel moves, then the bridge spine. Each consumer deletes the machinery it hand-rolled. The bottom strip is what stays out of the plan, and why.</text>\n\n  <rect x=\"40\" y=\"100\" width=\"400\" height=\"420\" rx=\"18\" class=\"core\" />\n  <text x=\"65\" y=\"135\" class=\"tag\">@kolu/surface</text>\n\n  <rect x=\"65\" y=\"155\" width=\"350\" height=\"88\" rx=\"10\" class=\"box\" />\n  <text x=\"85\" y=\"184\" class=\"label\">SurfaceRuntime</text>\n  <text x=\"360\" y=\"184\" class=\"pr\">PR 1</text>\n  <text x=\"85\" y=\"208\" class=\"small\">final router · done · idempotent close()</text>\n  <text x=\"85\" y=\"230\" class=\"tiny\">no caller re-learns oRPC finalization</text>\n\n  <rect x=\"65\" y=\"255\" width=\"350\" height=\"66\" rx=\"10\" class=\"box\" />\n  <text x=\"85\" y=\"284\" class=\"label\">Bound procedures</text>\n  <text x=\"360\" y=\"284\" class=\"pr\">PR 2</text>\n  <text x=\"85\" y=\"308\" class=\"small\">client.procedures.&lt;ns&gt;.&lt;verb&gt; — no casts</text>\n\n  <rect x=\"65\" y=\"333\" width=\"350\" height=\"66\" rx=\"10\" class=\"box\" />\n  <text x=\"85\" y=\"362\" class=\"label\">One-shot adoptions</text>\n  <text x=\"360\" y=\"362\" class=\"pr\">PR 6</text>\n  <text x=\"85\" y=\"386\" class=\"small\">firstFrameOrThrow + existing app primitives</text>\n\n  <rect x=\"65\" y=\"411\" width=\"350\" height=\"92\" rx=\"10\" class=\"bridge\" />\n  <text x=\"85\" y=\"440\" class=\"label\">reactor.ts — the bridge</text>\n  <text x=\"340\" y=\"440\" class=\"pr\">PR 7–10</text>\n  <text x=\"85\" y=\"464\" class=\"small\">source · scan · computed · derived.cell/.collection · $ · batch</text>\n  <text x=\"85\" y=\"486\" class=\"tiny\">phase 0 shipped in W5 (#1759); spine sequenced here</text>\n\n  <rect x=\"480\" y=\"100\" width=\"400\" height=\"200\" rx=\"18\" class=\"map\" />\n  <text x=\"505\" y=\"135\" class=\"tagmap\">@kolu/surface-map</text>\n  <rect x=\"505\" y=\"155\" width=\"350\" height=\"60\" rx=\"10\" class=\"box\" />\n  <text x=\"525\" y=\"182\" class=\"label\">Membership time</text>\n  <text x=\"800\" y=\"182\" class=\"pr\">PR 3</text>\n  <text x=\"525\" y=\"204\" class=\"small\">opaque membershipId per add · typed connection key</text>\n  <rect x=\"505\" y=\"227\" width=\"350\" height=\"60\" rx=\"10\" class=\"box\" />\n  <text x=\"525\" y=\"254\" class=\"label\">Total failure</text>\n  <text x=\"800\" y=\"254\" class=\"pr\">PR 4</text>\n  <text x=\"525\" y=\"276\" class=\"small\">failureOf required + schema-valid — no fabricated arm</text>\n\n  <rect x=\"480\" y=\"320\" width=\"400\" height=\"200\" rx=\"18\" class=\"remote\" />\n  <text x=\"505\" y=\"355\" class=\"tagremote\">@kolu/surface-remote</text>\n  <rect x=\"505\" y=\"375\" width=\"350\" height=\"60\" rx=\"10\" class=\"box\" />\n  <text x=\"525\" y=\"402\" class=\"label\">Delta-aware mirror</text>\n  <text x=\"800\" y=\"402\" class=\"pr\">PR 5</text>\n  <text x=\"525\" y=\"424\" class=\"small\">mirror + reServe consume collection deltas</text>\n  <rect x=\"505\" y=\"447\" width=\"350\" height=\"60\" rx=\"10\" class=\"box\" />\n  <text x=\"525\" y=\"474\" class=\"label\">Clock at admit</text>\n  <text x=\"800\" y=\"474\" class=\"pr\">PR 3</text>\n  <text x=\"525\" y=\"496\" class=\"small\">clockNow reserved member — rides the membership PR</text>\n\n  <path d=\"M440 300 C455 300 465 300 480 300 M880 200 C905 200 915 175 940 175\" class=\"arrow\" />\n  <path d=\"M440 200 C700 60 700 60 940 155\" class=\"arrow\" />\n  <path d=\"M880 420 C905 420 915 420 940 420\" class=\"arrow\" />\n  <path d=\"M880 255 C910 255 915 290 940 290\" class=\"arrow\" />\n\n  <rect x=\"940\" y=\"100\" width=\"380\" height=\"150\" rx=\"16\" class=\"consumer\" />\n  <text x=\"965\" y=\"135\" class=\"label\">kolu (each PR migrates it)</text>\n  <text x=\"965\" y=\"163\" class=\"small\">deletes: the PadiRpc cast · connectionRearm ·</text>\n  <text x=\"965\" y=\"185\" class=\"small\">the \"padi\" string key · manual finalization</text>\n  <text x=\"965\" y=\"212\" class=\"tiny\">bridge PRs delete urgency riders, samplers,</text>\n  <text x=\"965\" y=\"230\" class=\"tiny\">serveHostMap plumbing (worked examples 1–4)</text>\n\n  <rect x=\"940\" y=\"270\" width=\"380\" height=\"120\" rx=\"16\" class=\"consumer\" />\n  <text x=\"965\" y=\"305\" class=\"label\">drishti (paired PR per rule)</text>\n  <text x=\"965\" y=\"333\" class=\"small\">deletes: processesSnapshot parallel stream ·</text>\n  <text x=\"965\" y=\"355\" class=\"small\">wire procedure casts · offsetOf stub · reconciles</text>\n\n  <rect x=\"940\" y=\"410\" width=\"380\" height=\"110\" rx=\"16\" class=\"consumer\" />\n  <text x=\"965\" y=\"445\" class=\"label\">odu (adopts at its next pin)</text>\n  <text x=\"965\" y=\"473\" class=\"small\">deletes: 3× manual router finalization · synthetic</text>\n  <text x=\"965\" y=\"495\" class=\"small\">logs collection — lease shapes stay odu-local</text>\n\n  <rect x=\"40\" y=\"560\" width=\"1280\" height=\"220\" rx=\"18\" class=\"ghost\" />\n  <text x=\"65\" y=\"595\" class=\"tiny\">DELIBERATELY NOT IN THIS PLAN (reasoning in the note)</text>\n  <text x=\"65\" y=\"628\" class=\"small\">Feed member kind → already the bridge: feedState ≡ scan · delta projection ≡ derived.collection diff — append-heavy wire (terminal bytes, logs) is a named bridge design question, not a fourth member kind</text>\n  <text x=\"65\" y=\"660\" class=\"small\">@kolu/surface-suite → deferred: a thin composition leaf earns no receptacle; its two real moves (final router, typed connection key) landed in the kernel; sole revival condition: the surface-app dependency direction</text>\n  <text x=\"65\" y=\"692\" class=\"small\">SurfaceLease / LeaseOpen / surfaceClientFromLeases / projectSurface / SurfacePort → odu-local shapes: five concepts, one caller — graduate at a second consumer; SurfacePort dies with the stack</text>\n  <text x=\"65\" y=\"724\" class=\"small\">createLiveQuery → obsolete: W9's per-host ownership (hostCodeTab.ts) superseded the string-keyed singleton; the createResource instinct may refine inside that ownership shape</text>\n  <text x=\"65\" y=\"756\" class=\"small\">notificationSurfaceApp / bootSurfaceApp → needs grounding against W5's shipped notify seam before any PR is cut; the server-authored capability discriminant survives as the candidate</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/surface-runtime-boundary.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
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
	const { Fragment: Fragment$1 } = _components;
	if (!Fragment$1) _missingMdxReference("Fragment", true);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"Surface declarations are the source of truth for data shape, and they stop one layer too early. Kolu, Drishti, and Odu each receive a typed declaration and then rebuild some combination of router finalization, procedure clients, membership identity, failure vocabulary, or protocol projection by hand. The cures land where the volatility already lives: every move completes an existing package — no new package — and the derivation-shaped remainder is ",
			createVNode(_components.a, {
				href: "surface-reactive-bridge.html",
				children: "the reactive bridge"
			}),
			"’s spine, scheduled here as the same campaign’s back half."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Decision",
			children: createVNode(_components.p, { children: [
				"Ship a six-move kernel in the existing packages — supervised ",
				createVNode(_components.code, { children: "SurfaceRuntime" }),
				", bound procedures, opaque membership ids, total schema-valid failure, a delta-aware mirror, and one-shot adoptions — then the reactive bridge’s remaining spine as the same campaign’s back half. Deliberately out: no ",
				createVNode(_components.code, { children: "Feed" }),
				" member kind (the bridge’s ",
				createVNode(_components.code, { children: "scan" }),
				" + ",
				createVNode(_components.code, { children: "derived.collection" }),
				" already express it), no ",
				createVNode(_components.code, { children: "@kolu/surface-suite" }),
				" package, no framework lease stack (it stays Odu-local), no client-side live-query adapter (W9’s per-host ownership shape governs). Distinct lifetimes keep distinct constructors and types — never mode flags or inferred ownership."
			] })
		}),
		"\n",
		createVNode($$Svg, {
			svg: surface_runtime_boundary_architecture_default,
			wide: true,
			caption: "The plan at a glance. The kernel lands where the volatility already lives — @kolu/surface, surface-map, surface-remote — beside the already-shipped reactor bridge; each consumer deletes the machinery it hand-rolled; the faint strip records what stays out of the plan, and why."
		}),
		"\n",
		createVNode(_components.h2, {
			id: "what-a-user-gets",
			children: "What a user gets"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Almost nothing visible — deliberately. This is a pure consolidation, and its invariant governs: every PR is byte-identical on screen, pinned by the e2e suite and the seal test — and its dual is the sorting rule: a feature (any user-visible behavior change) never rides one of these PRs; it ships standalone. What a user gets is defect ",
			createVNode(_components.em, { children: "classes" }),
			" dying rather than defects being fixed one at a time:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: ["A remote host that is removed and re-added (or whose authority restarts) can never resurrect a stale subscription — the class kolu currently suppresses with a hand-rolled generation rearm.", createVNode($$Footnote, { children: [
				"The rearm: ",
				createVNode(_components.code, { children: "createRejoinKeyedSub" }),
				" in ",
				createVNode($$Cite, {
					file: "packages/client/src/host/connectionRearm.ts",
					lines: "35-64",
					rev: "2b83737fd8f3"
				}),
				" bumps a generation signal on membership re-join and re-keys the subscription effect. It works; the point of SR3 is that no consumer should have to know to write it."
			] })] }),
			"\n",
			createVNode(_components.li, { children: [
				"A failed host chip can never read a cause the framework invented: today an absent cause is filled with ",
				createVNode(_components.code, { children: "\"other\"" }),
				" by generic map code.",
				createVNode($$Footnote, { children: [
					createVNode($$Cite, {
						file: "packages/surface-map/src/server.ts",
						lines: "200",
						rev: "2b83737fd8f3"
					}),
					" and a second site at ",
					createVNode($$Cite, {
						file: "packages/surface-map/src/server.ts",
						lines: "301",
						rev: "2b83737fd8f3"
					}),
					"."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"A registry writer can never ",
				createVNode(_components.em, { children: "forget" }),
				" to republish a derived fact (urgency, alerts, overview counts) — the bridge tracks the edge instead of trusting a convention."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The costs stay honest: the bridge’s ",
				createVNode(_components.a, {
					href: "surface-reactive-bridge.html#the-honest-costs",
					children: "ten named costs"
				}),
				" are carried into this plan unchanged, and its open question 4 (a permanently broken derivation looks healthy) remains open — srid rules on it inside the bridge track, not here."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-kernel--six-moves-each-where-the-volatility-already-lives",
			children: "The kernel — six moves, each where the volatility already lives"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The structural verdict: none of these needs a new package. Each move completes a receptacle that already owns the volatility, and each is proven by what it lets a consumer ",
			createVNode(_components.em, { children: "delete" }),
			"."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "sr1--a-runtime-you-can-serve",
			children: "SR1 — A runtime you can serve"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "implementSurface" }),
			" still returns an intermediate fragment — ",
			createVNode(_components.code, { children: "{ router: { surface: … }, ctx }" }),
			" — and every consumer must know the one correct oRPC finalization step.",
			createVNode($$Footnote, { children: [
				"The fragment return: ",
				createVNode($$Cite, {
					file: "packages/surface/src/server.ts",
					lines: "1958-1962",
					rev: "2b83737fd8f3"
				}),
				". The three re-learnings: kolu finalizes via ",
				createVNode(_components.code, { children: "implement(servedContract)" }),
				" in ",
				createVNode($$Cite, {
					file: "packages/server/src/surface.ts",
					lines: "85-99",
					rev: "2b83737fd8f3"
				}),
				"; drishti wraps the fragment in ",
				createVNode($$Cite, {
					repo: "srid/drishti",
					rev: "e22339f9a435",
					file: "packages/agent/src/main.ts",
					lines: "404-409"
				}),
				"; odu does it twice, in ",
				createVNode($$Cite, {
					repo: "juspay/odu",
					rev: "c3f24013daae",
					file: "src/runner/runner.ts",
					lines: "339"
				}),
				" and ",
				createVNode($$Cite, {
					repo: "juspay/odu",
					rev: "c3f24013daae",
					file: "src/coordinator/run.ts",
					lines: "469"
				}),
				". Odu already reaches ",
				createVNode(_components.code, { children: "implementSurface" }),
				", so its finalization is down to one line per site — but it is still a caller obligation the framework should own."
			] }),
			" The runtime becomes a directly servable, supervised resource:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#D73A49\">interface</span><span style=\"color:#6F42C1\"> SurfaceRuntime</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">S</span><span style=\"color:#D73A49\"> extends</span><span style=\"color:#6F42C1\"> SurfaceSpec</span><span style=\"color:#24292E\">> {</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  readonly</span><span style=\"color:#E36209\"> router</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> Router</span><span style=\"color:#24292E\">;       </span><span style=\"color:#6A737D\">// final top-level router</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  readonly</span><span style=\"color:#E36209\"> ctx</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> SurfaceCtx</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">S</span><span style=\"color:#24292E\">>;</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  readonly</span><span style=\"color:#E36209\"> done</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> Promise</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#005CC5\">void</span><span style=\"color:#24292E\">>;  </span><span style=\"color:#6A737D\">// rejects on an owned runtime fault</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  close</span><span style=\"color:#24292E\">()</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> Promise</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#005CC5\">void</span><span style=\"color:#24292E\">>;        </span><span style=\"color:#6A737D\">// idempotent; releases every owned source</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">  // package-private mount material for composition</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">}</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"Async cell connectors receive an abort signal and return a disposer; reactor subscriptions, map subscriptions, and re-served pumps all join ",
			createVNode(_components.code, { children: "done" }),
			" and ",
			createVNode(_components.code, { children: "close" }),
			". A ",
			createVNode(_components.code, { children: "close" }),
			" that ignores today’s ",
			createVNode(_components.code, { children: "cell.connect" }),
			", reactor, or ",
			createVNode(_components.code, { children: "reServeSurface.done" }),
			" would be ceremonial and is not acceptable. The ordinary constructor owns ",
			createVNode(_components.code, { children: "inMemoryChannelByName()" }),
			" internally; kolu’s shared publisher stays a distinct, explicit constructor (",
			createVNode(_components.code, { children: "implementSurfaceOnPublisher" }),
			") because its cross-channel microtask order is load-bearing — two ownership promises, not an override knob."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "sr2--procedures-join-the-typed-dual",
			children: "SR2 — Procedures join the typed dual"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Cells, collections, streams, and events receive bound client capabilities; procedures alone remain behind raw ",
			createVNode(_components.code, { children: "rpc" }),
			", so every consumer casts.",
			createVNode($$Footnote, { children: [
				"The asymmetry: ",
				createVNode($$Cite, {
					file: "packages/surface/src/solid/surfaceClient.ts",
					lines: "309-324",
					rev: "2b83737fd8f3"
				}),
				" — four bound member kinds plus a generic ",
				createVNode(_components.code, { children: "rpc" }),
				" field. Kolu recovers ",
				createVNode(_components.code, { children: "PadiRpc" }),
				" with a cast in ",
				createVNode($$Cite, {
					file: "packages/client/src/wire.ts",
					lines: "202-207",
					rev: "2b83737fd8f3"
				}),
				" (a second cast at line 402); drishti casts ",
				createVNode(_components.code, { children: "HostRpc" }),
				" and ",
				createVNode(_components.code, { children: "AdminScopedRpc" }),
				" slices in ",
				createVNode($$Cite, {
					repo: "srid/drishti",
					rev: "e22339f9a435",
					file: "packages/app/src/client/wire.ts",
					lines: "124-155"
				}),
				"."
			] }),
			" Every declared procedure appears at ",
			createVNode(_components.code, { children: "client.procedures.<namespace>.<verb>" }),
			" and on a map entry; the casts and their copied callable shapes delete."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "sr3--membership-is-time-and-time-is-a-fact",
			children: "SR3 — Membership is time, and time is a fact"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A key that leaves and returns is a ",
			createVNode(_components.em, { children: "new member" }),
			" even when its spelling is unchanged. ",
			createVNode(_components.code, { children: "serveSurfaceMap" }),
			" stamps ",
			createVNode(_components.code, { children: "crypto.randomUUID()" }),
			" as an opaque ",
			createVNode(_components.code, { children: "membershipId" }),
			" on every add — never reused across map-server restart, published on every status arm — and clients key every cached owner on ",
			createVNode(_components.code, { children: "{encodedKey, membershipId}" }),
			", so same-key remove/re-add and authority restart rebuild subscriptions by construction:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#D73A49\">type</span><span style=\"color:#6F42C1\"> EntryStatus</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">Failure</span><span style=\"color:#24292E\">> </span><span style=\"color:#D73A49\">=</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  |</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">kind</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\"> \"warming\"</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">membershipId</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> string</span><span style=\"color:#24292E\"> }</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  |</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">kind</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\"> \"connected\"</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">membershipId</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> string</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">clockOffset</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> number</span><span style=\"color:#D73A49\"> |</span><span style=\"color:#005CC5\"> null</span><span style=\"color:#24292E\"> }</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  |</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">kind</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\"> \"failed\"</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">membershipId</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> string</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">failure</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> Failure</span><span style=\"color:#24292E\"> };</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"Readiness is ",
			createVNode(_components.strong, { children: "link-liveness, not clock-measured" }),
			": an entry is ",
			createVNode(_components.code, { children: "connected" }),
			" the moment its link is live. The clock offset is a ",
			createVNode(_components.em, { children: "separate fact" }),
			" on that arm, with honest null-absence — ",
			createVNode(_components.code, { children: "clockOffset: number | null" }),
			", where ",
			createVNode(_components.code, { children: "null" }),
			" has one meaning (not-yet-measured; the reader renders “—”). A connected entry with ",
			createVNode(_components.code, { children: "clockOffset: null" }),
			" stays fully ",
			createVNode(_components.code, { children: "connected" }),
			", never demoted; the offset probe surfaces loudly and retries on its own cadence until it lands, so a failed probe never silently strands a null. And the padi-specific ",
			createVNode(_components.code, { children: "control.core.clockNow" }),
			" stays ",
			createVNode(_components.strong, { children: "frozen-forever" }),
			" beside the new framework-reserved ",
			createVNode(_components.code, { children: "system.clockNow" }),
			" — the frozen control core never versions, so old binders keep crossing skew on it while new kolu measures via ",
			createVNode(_components.code, { children: "system.clockNow" }),
			" only."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"W11 already proved the doctrine’s sibling on the server side: the remembered fleet became its own ordered fact (",
			createVNode(_components.code, { children: "persistedMembership" }),
			"), never derived from the live pool’s keys, exactly because retire deliberately desyncs live from remembered.",
			createVNode($$Footnote, { children: [
				createVNode($$Cite, {
					file: "packages/surface-remote/src/hostFanout.ts",
					lines: "486",
					rev: "2b83737fd8f3"
				}),
				" inside ",
				createVNode(_components.code, { children: "buildRemotePool" }),
				", shipped by W11 (",
				createVNode($$PrLink, { pr: 1775 }),
				"). Membership identity is the client-side twin of the same insight: identity is a fact in its own right, not a projection of key spelling."
			] }),
			" This PR kills kolu’s ",
			createVNode(_components.code, { children: "createRejoinKeyedSub" }),
			" and its test outright."
		] }),
		"\n",
		createVNode(_components.p, { children: "Two riders land here because they touch the same admit/connection seam:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The typed connection key." }),
				" Kolu reconnects its map by the string ",
				createVNode(_components.code, { children: "\"padi\"" }),
				" and drishti by ",
				createVNode(_components.code, { children: "\"hosts\"" }),
				" — a stringly sibling key at every connection site.",
				createVNode($$Footnote, { children: [
					"Kolu: ",
					createVNode($$Cite, {
						file: "packages/client/src/wire.ts",
						lines: "158",
						rev: "2b83737fd8f3"
					}),
					"; drishti: ",
					createVNode($$Cite, {
						repo: "srid/drishti",
						rev: "e22339f9a435",
						file: "packages/app/src/client/wire.ts",
						lines: "97"
					}),
					". The server-side dual — the widened ",
					createVNode(_components.code, { children: "as any" }),
					" contract splice — is kolu’s ",
					createVNode($$Cite, {
						file: "packages/server/src/surface.ts",
						lines: "85-99",
						rev: "2b83737fd8f3"
					}),
					" plus the router splice in ",
					createVNode($$Cite, {
						file: "packages/server/src/index.ts",
						lines: "484-516",
						rev: "2b83737fd8f3"
					}),
					", repeated by drishti in ",
					createVNode($$Cite, {
						repo: "srid/drishti",
						rev: "e22339f9a435",
						file: "packages/app/src/server/admin-router.ts",
						lines: "187-208"
					}),
					". This was the deferred suite package’s one real client-side move; it lands here as a typed key derived from the declaration, without the package."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "clockNow" }), " as a framework-reserved member."] }),
				" ",
				createVNode(_components.code, { children: "makeSession" }),
				" measures the clock offset at admit automatically (the reserved-member pattern ",
				createVNode(_components.code, { children: "system.identity" }),
				" already shipped), the ",
				createVNode(_components.code, { children: "offsetOf" }),
				" injection point ceases to be a caller obligation, and drishti’s ",
				createVNode(_components.code, { children: "offsetOf: () => 0" }),
				" stub deletes. It rides the membership PR because both rework the same admit seam."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "sr4--failure-is-domain-data-never-fabricated",
			children: "SR4 — Failure is domain data, never fabricated"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The map’s TypeScript cause narrows while its wire schema accepts any string, and the server fills an absent cause with ",
			createVNode(_components.code, { children: "\"other\"" }),
			".",
			createVNode($$Footnote, { children: [
				"The narrowing: ",
				createVNode($$Cite, {
					file: "packages/surface-map/src/define.ts",
					lines: "70-73",
					rev: "2b83737fd8f3"
				}),
				" against the loose wire arm at ",
				createVNode($$Cite, {
					file: "packages/surface-map/src/define.ts",
					lines: "94-102",
					rev: "2b83737fd8f3"
				}),
				" (",
				createVNode(_components.code, { children: "cause: z.string()" }),
				" at line 100). The fabrications: ",
				createVNode($$Cite, {
					file: "packages/surface-map/src/server.ts",
					lines: "200",
					rev: "2b83737fd8f3"
				}),
				" and ",
				createVNode($$Cite, {
					file: "packages/surface-map/src/server.ts",
					lines: "301",
					rev: "2b83737fd8f3"
				}),
				"."
			] }),
			" ",
			createVNode(_components.code, { children: "SurfaceMap" }),
			" takes a real failure schema, and ",
			createVNode(_components.code, { children: "failureOf" }),
			" is required and total:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> padiHostMap</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> defineSurfaceMap</span><span style=\"color:#24292E\">({</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  key: HostKeySchema,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  codec: hostKeyCodec,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  entry: padiEntrySurface,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  failure: PadiEntryFailureSchema,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">serveHostMap</span><span style=\"color:#24292E\">(padiHostMap, pool, {</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">  // A verdict, not a fabrication: a schema-valid failure, or `null` = \"this down</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">  // state is not a standing failure — keep the entry warming\" (a live host's normal</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">  // reconnect window). A terminal give-up that yields `null` is a classification</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">  // defect and fails loud (`UnclassifiedHostFailureError`), never a bucketed catch-all.</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  failureOf</span><span style=\"color:#24292E\">(</span><span style=\"color:#E36209\">host</span><span style=\"color:#24292E\">, </span><span style=\"color:#E36209\">session</span><span style=\"color:#24292E\">, </span><span style=\"color:#E36209\">downState</span><span style=\"color:#24292E\">)</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> PadiEntryFailure</span><span style=\"color:#D73A49\"> |</span><span style=\"color:#005CC5\"> null</span><span style=\"color:#24292E\"> {</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">    return</span><span style=\"color:#6F42C1\"> classifyPadiFailure</span><span style=\"color:#24292E\">(host, session, downState);</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  },</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"The migration starts from Padi’s real producers — contract skew, cross-supervisor, the two drv failures, unconverged, link failure, and the structural cases currently collapsed into ",
			createVNode(_components.code, { children: "other" }),
			" — and gives every structural producer a named arm. ",
			createVNode(_components.code, { children: "failureOf" }),
			" is total but not exhaustively non-null: its ",
			createVNode(_components.code, { children: "null" }),
			" is a single-meaning “keep warming” verdict for a transient drop (never a fabricated cause), while an ",
			createVNode(_components.em, { children: "unclassifiable" }),
			" terminal failure throws — neither Padi nor the framework may publish a renamed catch-all. A schema validates this value; it never derives one."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "sr5--one-protocol-across-the-wire",
			children: "SR5 — One protocol across the wire"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A collection should stay one protocol when it crosses a network. Drishti’s process fact is both a Surface collection and a second snapshot/delta stream ",
			createVNode(_components.em, { children: "because" }),
			" the remote mirror fans collections into ",
			createVNode(_components.code, { children: "keys" }),
			" plus one ",
			createVNode(_components.code, { children: "get" }),
			" stream per key.",
			createVNode($$Footnote, { children: [
				"The fan-out: ",
				createVNode($$Cite, {
					file: "packages/surface/src/mirrorRemoteSurface.ts",
					lines: "415-443",
					rev: "2b83737fd8f3"
				}),
				" — and the sweep confirms no collection-level ",
				createVNode(_components.code, { children: "deltas" }),
				" verb is consumed anywhere yet. Drishti’s resulting dual: the collection and the parallel ",
				createVNode(_components.code, { children: "processesSnapshot" }),
				" stream declared together in ",
				createVNode($$Cite, {
					repo: "srid/drishti",
					rev: "e22339f9a435",
					file: "packages/common/src/surface.ts",
					lines: "259-291"
				}),
				", the extra stream implemented in ",
				createVNode($$Cite, {
					repo: "srid/drishti",
					rev: "e22339f9a435",
					file: "packages/agent/src/main.ts",
					lines: "252-262"
				}),
				", the parent reducer in ",
				createVNode($$Cite, {
					repo: "srid/drishti",
					rev: "e22339f9a435",
					file: "packages/app/src/server/router.ts",
					lines: "409-434"
				}),
				"."
			] }),
			" ",
			createVNode(_components.code, { children: "mirrorRemoteSurface" }),
			" selects a collection’s declared ",
			createVNode(_components.code, { children: "deltas" }),
			" verb and folds the initial snapshot plus batches into its existing sink; ",
			createVNode(_components.code, { children: "reServeSurface" }),
			" inherits that path and returns a normal supervised ",
			createVNode(_components.code, { children: "SurfaceRuntime" }),
			"; relay loss crosses oRPC as a named retryable transport end."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Parent-owned additions remain causally separate from mirroring: ",
			createVNode(_components.code, { children: "extendSurface(mirroredSurface(agentSurface), historySurface)" }),
			" composes a local runtime onto a re-served one, with post-commit observation instead of a second mirror — so drishti deletes its inert agent-side ",
			createVNode(_components.code, { children: "metricHistory" }),
			" stub and keeps its retention as local policy.",
			createVNode($$Footnote, { children: [
				"The stub, marked inert in its own comment: ",
				createVNode($$Cite, {
					repo: "srid/drishti",
					rev: "e22339f9a435",
					file: "packages/agent/src/main.ts",
					lines: "263-278"
				}),
				", declared at ",
				createVNode($$Cite, {
					repo: "srid/drishti",
					rev: "e22339f9a435",
					file: "packages/common/src/surface.ts",
					lines: "292-298"
				}),
				"; the parent’s real ring + bus serve it at ",
				createVNode($$Cite, {
					repo: "srid/drishti",
					rev: "e22339f9a435",
					file: "packages/app/src/server/router.ts",
					lines: "193-216"
				}),
				"."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"This PR reworks the re-serve internals, so two standing cleanups in them ride along as side effects: the opaque-client navigation casts in ",
			createVNode(_components.code, { children: "reServeSurface.ts" }),
			" collapse into one typed helper with one justification, and the hand-rolled additive in-memory collection shape gets a single implementation."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "sr6--adopt-before-you-mint",
			children: "SR6 — Adopt before you mint"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Some cleanup is adoption rather than invention, and it needs no new framework API. One-shot reads keep the existing non-empty first-frame contract (",
			createVNode(_components.code, { children: "firstFrameOrThrow" }),
			") instead of open-coding iterator advancement; socket acceptance, connection presentation, attention, and combined health all have existing primitives consumers should reach before the framework grows another concept.",
			createVNode($$Footnote, { children: [
				createVNode(_components.code, { children: "firstFrameOrThrow" }),
				": ",
				createVNode($$Cite, {
					file: "packages/surface/src/firstFrame.ts",
					lines: "42-48",
					rev: "2b83737fd8f3"
				}),
				". The primitives to adopt: ",
				createVNode(_components.code, { children: "acceptSurfaceSocket" }),
				" in ",
				createVNode($$Cite, {
					file: "packages/surface-app/src/server.ts",
					lines: "597-640",
					rev: "2b83737fd8f3"
				}),
				", ",
				createVNode(_components.code, { children: "presentingDown" }),
				" in ",
				createVNode($$Cite, {
					file: "packages/surface-app/src/solid/index.ts",
					lines: "674-677",
					rev: "2b83737fd8f3"
				}),
				", ",
				createVNode(_components.code, { children: "setAttention" }),
				" in ",
				createVNode($$Cite, {
					file: "packages/surface-app/src/solid/index.ts",
					lines: "584-602",
					rev: "2b83737fd8f3"
				}),
				"; drishti already computes combined health from its two siblings via ",
				createVNode(_components.code, { children: "surfaceClientsHealth" }),
				" (",
				createVNode($$Cite, {
					repo: "srid/drishti",
					rev: "e22339f9a435",
					file: "packages/app/src/client/App.tsx",
					lines: "461-466"
				}),
				")."
			] }),
			" This is consumer-side; it shipped as its own PR (",
			createVNode($$PrLink, { pr: 1829 }),
			"), and the grounded sweep found most named sites already adopted — the sequence-table row records the honest per-site outcome."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "deliberately-not-in-this-plan",
			children: "Deliberately not in this plan"
		}),
		"\n",
		createVNode(_components.p, { children: "Several shapes that could plausibly belong here are out by design. The rule: a concept earns a slot only where its promise cannot be expressed by what is already ratified or shipped. The reasoning is recorded so it is not relitigated per-PR." }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "not in the plan" }),
					"\n",
					createVNode(_components.th, { children: "why" }),
					"\n",
					createVNode(_components.th, { children: "where the residue lives" }),
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
						"a ",
						createVNode(_components.code, { children: "Feed" }),
						" member kind — a state-owning frame producer with a ",
						createVNode(_components.code, { children: "snapshot | delta" }),
						" wire union"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"it is the bridge’s ",
						createVNode(_components.code, { children: "scan" }),
						" wearing a wire protocol"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "feedState({initial, reduce})" }),
						" + ",
						createVNode(_components.code, { children: "commit" }),
						" ≡ ",
						createVNode(_components.code, { children: "scan(source, initial, step)" }),
						" published via ",
						createVNode(_components.code, { children: "derived.cell" }),
						" — one atomic update-and-publish; the delta projection ≡ ",
						createVNode(_components.code, { children: "derived.collection" }),
						"’s diff-by-",
						createVNode(_components.code, { children: "equals" }),
						" → wire patches. The genuinely unserved residue — the ",
						createVNode(_components.strong, { children: "append-heavy wire member" }),
						" (terminal bytes, CI logs) — is a named bridge-track design question, not a fourth member kind"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "@kolu/surface-suite" }) }),
					"\n",
					createVNode(_components.td, { children: "a thin composition leaf earns no receptacle" }),
					"\n",
					createVNode(_components.td, { children: [
						"its two real moves were never suite-shaped: the final router is SR1, the typed connection key is SR3. Sole revival condition: ",
						createVNode(_components.code, { children: "@kolu/surface-app" }),
						" needing to depend on a suite value (the dependency-direction question) — that reopens the package question with a real consumer in hand"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"a framework lease stack — ",
						createVNode(_components.code, { children: "SurfaceLease" }),
						", ",
						createVNode(_components.code, { children: "LeaseOpen" }),
						", ",
						createVNode(_components.code, { children: "surfaceClientFromLeases" }),
						", ",
						createVNode(_components.code, { children: "projectSurface" }),
						", ",
						createVNode(_components.code, { children: "SurfacePort" })
					] }),
					"\n",
					createVNode(_components.td, { children: "five concepts for one caller fails prove-then-extract" }),
					"\n",
					createVNode(_components.td, { children: [
						"Odu fixes its MCP projection with these shapes in its own tree (they are the right shapes: the stable client is projected Surface B, every A-lease pinned and released, unavailability a typed arm); they graduate to the framework at a second consumer. ",
						createVNode(_components.code, { children: "SurfacePort" }),
						" — a TS2590 workaround — dies with the stack"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "createLiveQuery" }), " — a string-keyed client query adapter"] }),
					"\n",
					createVNode(_components.td, { children: "W9’s per-host ownership shape supersedes it" }),
					"\n",
					createVNode(_components.td, { children: [
						"one retained query world per host, paused/resumed/disposed by membership, in ",
						createVNode(_components.code, { children: "right-panel/hostCodeTab.ts" }),
						". One instinct survives ",
						createVNode(_components.em, { children: "inside" }),
						" that ownership shape: prefer ",
						createVNode(_components.code, { children: "createResource" }),
						" over a hand-rolled async engine"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "notificationSurfaceApp" }),
						" / ",
						createVNode(_components.code, { children: "bootSurfaceApp" })
					] }),
					"\n",
					createVNode(_components.td, { children: "the notify seam already exists" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "createNotify" }),
						" with a feature-detected worker discriminant (shipped in W5), consumed by kolu and drishti. A server-",
						createVNode(_components.em, { children: "authored" }),
						" capability discriminant (boot parses a no-store payload; workerless can never produce the notify arm) remains a candidate — it must be grounded against that shipped seam before any PR is cut"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "Three of these deserve their sentence of reasoning in full:" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The Feed↔scan equivalence, stated." }),
			" A state-owning ",
			createVNode(_components.code, { children: "feedState" }),
			" makes “mutate, then remember to publish” unspellable as a paired obligation — which is exactly ",
			createVNode(_components.code, { children: "scan" }),
			"’s promise, with the stop-hold error doctrine already specified in the bridge’s law table. The wire union (",
			createVNode(_components.code, { children: "snapshot | delta" }),
			") as a ",
			createVNode(_components.em, { children: "member kind" }),
			" adds nothing for state-shaped data — the bridge’s ",
			createVNode(_components.code, { children: "derived.collection" }),
			" already promises “membership changes become wire frames.” For append-shaped data (a terminal’s bytes, a CI log) a signal is the wrong substrate ",
			createVNode(_components.em, { children: "by the bridge’s own law" }),
			" — a signal conflates same-batch frames, and an append consumer must see every one. So the append-heavy wire member is real, unserved, and ",
			createVNode(_components.em, { children: "off the graph by design" }),
			": snapshot-then-append with a bounded per-subscriber queue, abort-on-overflow so retry restarts from a fresh snapshot, and a retryable relay end. The live defect class it must kill is in the tree three ways today: odu’s log tail yields its snapshot before installing the subscriber, kolu re-arms terminal attach with a client-local reattach loop, and the padi relay’s forwarding policy is a hand-maintained per-member table.",
			createVNode($$Footnote, { children: [
				"Odu: ",
				createVNode($$Cite, {
					repo: "juspay/odu",
					rev: "c3f24013daae",
					file: "src/common/logTail.ts",
					lines: "59-66"
				}),
				" — ",
				createVNode(_components.code, { children: "yield snapshot" }),
				" at 64 ",
				createVNode(_components.em, { children: "before" }),
				" the bus subscribe at 65, the lost-update window. Kolu client: ",
				createVNode(_components.code, { children: "consumeReattachingStream" }),
				" in ",
				createVNode($$Cite, {
					file: "packages/client/src/terminal/reattachingStream.ts",
					lines: "21-48",
					rev: "2b83737fd8f3"
				}),
				". The table: ",
				createVNode(_components.code, { children: "PADI_FORWARDING_POLICY" }),
				" at ",
				createVNode($$Cite, {
					file: "packages/padi/src/surface.ts",
					lines: "939",
					rev: "2b83737fd8f3"
				}),
				". Whether the answer is a new off-graph member kind or a completion of the existing stream role is precisely the design question — decided inside the bridge track where the other wire laws live. The standing framework-backpressure question closes with this design if it ships a framework-owned subscriber bound: today the re-serve bounds its per-subscriber channels (HWM 4096, loud overflow) but the framework’s underlying oRPC receive queue is unbounded for an unpaced sender — gated on a measured slow-consumer incident or a load test, either way."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Why there is no suite package, though its moves ship." }),
			" Kolu’s splice is real and ugly — a server-only widened contract with ",
			createVNode(_components.code, { children: "as any" }),
			" casts, a hand-spliced router, and a string key at the client — and drishti repeats all three. But every line of that ugliness is ",
			createVNode(_components.em, { children: "addressing" }),
			", not topology: once the runtime returns a final router (SR1) and the map connection key is typed from the declaration (SR3), the splice collapses without any value describing “the topology” existing anywhere. A ",
			createVNode(_components.code, { children: "defineSurfaceSuite" }),
			" would then be three lines of object literal wearing a package — the thin-composition-leaf shape the electricity tests exist to reject."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Why no client query adapter." }),
			" The Code tab’s queries live in a per-host owner (",
			createVNode(_components.code, { children: "buildHostCodeTab" }),
			"), born inside ",
			createVNode(_components.code, { children: "scopedByEntry" }),
			", paused while backgrounded, resumed from the held value, disposed on membership exit — and the old free-floating constructors were retired so component-owned retention is ",
			createVNode(_components.em, { children: "unspellable" }),
			". Only two ",
			createVNode(_components.code, { children: "createPolledQuery" }),
			" instances remain, both inside that owner.",
			createVNode($$Footnote, { children: [
				createVNode($$Cite, {
					file: "packages/client/src/right-panel/hostCodeTab.ts",
					lines: "85",
					rev: "2b83737fd8f3"
				}),
				" (",
				createVNode(_components.code, { children: "buildHostCodeTab" }),
				"), the shared owner at line 258; the two surviving ",
				createVNode(_components.code, { children: "createPolledQuery" }),
				" call sites at lines 119 and 197."
			] }),
			" A string-keyed singleton cache — stable keys, abort-latest, stream-driven invalidation, held outside any owner — would ",
			createVNode(_components.em, { children: "reintroduce" }),
			" the class that ownership shape deleted. The surviving insight — prefer Solid’s ",
			createVNode(_components.code, { children: "createResource" }),
			" to a hand-rolled async engine — applies inside the owner, if at all, and the existing ",
			createVNode(_components.code, { children: "createPolledQuery" }),
			" regression suite stays the acceptance bar for touching it."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-pr-sequence",
			children: "The PR sequence"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Kernel first (track prefix ",
			createVNode(_components.strong, { children: "SR" }),
			" — surface runtime) — each PR independently landable, each proven by a deletion, sequenced so no PR depends on an unshipped sibling. Then the bridge spine, whose technical content lives in ",
			createVNode(_components.a, {
				href: "surface-reactive-bridge.html",
				children: "the bridge note"
			}),
			" and whose work is numbered here, as SR7–SR10 — the one numbering scheme. Every ",
			createVNode(_components.code, { children: "@kolu/surface*" }),
			" PR ships with a paired drishti PR pinned to final kolu HEAD per ",
			createVNode(_components.code, { children: ".claude/rules/surface.md" }),
			". Odu is not schedulable from this repo: it pins kolu by npins, so its adoptions land at its pin bumps — the campaign’s bump shipped as ",
			createVNode(_components.a, {
				href: "https://github.com/juspay/odu/pull/44",
				children: "odu#44"
			}),
			" (pin → ",
			createVNode(_components.code, { children: "07397fa2" }),
			", #1836/SR9, with the SR-series adaptations including SR1’s two hand-finalization deletions); the standing accounting for future drift is the per-PR odu-impact verdict + the ledger (",
			createVNode(_components.a, {
				href: "https://github.com/juspay/odu/issues/43",
				children: "odu#43"
			}),
			") per ",
			createVNode(_components.code, { children: ".claude/rules/surface.md" }),
			"."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "id" }),
					"\n",
					createVNode(_components.th, { children: "what lands" }),
					"\n",
					createVNode(_components.th, { children: "the deletion that proves it" }),
					"\n",
					createVNode(_components.th, { children: "gate" }),
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
						createVNode(_components.strong, { children: "SR1" }),
						" (",
						createVNode($$PrLink, { pr: 1805 }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"supervised ",
						createVNode(_components.code, { children: "SurfaceRuntime" }),
						" — final router, ",
						createVNode(_components.code, { children: "done" }),
						", idempotent ",
						createVNode(_components.code, { children: "close" }),
						"; ",
						createVNode(_components.code, { children: "implementSurfaceOnPublisher" }),
						" stays distinct (with an ",
						createVNode(_components.code, { children: "implementSurfacesOnPublisher" }),
						" plural twin)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"kolu’s ",
						createVNode(_components.code, { children: "implement(servedContract)" }),
						" ",
						createVNode(_components.strong, { children: "surface-finalization" }),
						" step; drishti’s fragment wrap; odu’s two wraps (landed at the bump, ",
						createVNode(_components.a, {
							href: "https://github.com/juspay/odu/pull/44",
							children: "odu#44"
						}),
						"). Done only when every serving site observes ",
						createVNode(_components.code, { children: "runtime.done" }),
						" and owns shutdown",
						createVNode($$Footnote, { children: [
							"The headline shrank in the build, the negative property did not. kolu’s ",
							createVNode(_components.code, { children: "implement(servedContract)" }),
							" is ",
							createVNode(_components.strong, { children: "not" }),
							" fully deleted — it stays as the app-router ",
							createVNode(_components.em, { children: "builder" }),
							" (binding ",
							createVNode(_components.code, { children: "server" }),
							"/",
							createVNode(_components.code, { children: "daemon" }),
							"/",
							createVNode(_components.code, { children: "hosts" }),
							" and re-adapting the re-served ",
							createVNode(_components.code, { children: "padi" }),
							" map fragment for the wire matcher, which requires a contract that declares ",
							createVNode(_components.code, { children: "surface.padi" }),
							"). What deleted is its ",
							createVNode(_components.em, { children: "surface-finalization" }),
							" role, which moved into ",
							createVNode(_components.code, { children: "implementSurfacesOnPublisher" }),
							". So the campaign property holds verbatim — “no production consumer imports oRPC ",
							createVNode(_components.code, { children: "implement" }),
							" ",
							createVNode(_components.strong, { children: "merely" }),
							" to finalize a Surface” — because kolu’s remaining ",
							createVNode(_components.code, { children: "implement" }),
							" is the app-router builder, not mere finalization. This was learned the hard way: CI’s e2e caught a deterministic wire-matcher 404 (",
							createVNode(_components.code, { children: "serveHostMap" }),
							" returns a matcher-meta-less fragment; a padi-less builder drops every ",
							createVNode(_components.code, { children: "/surface/padi/*" }),
							" route) that the ",
							createVNode(_components.code, { children: "directLink" }),
							"-based ",
							createVNode(_components.code, { children: "padiBinding" }),
							" integration test structurally could not see — directLink navigates the router object, never the matcher. The lesson is now a pin: ",
							createVNode(_components.code, { children: "packages/server/src/router.test.ts" }),
							" asserts the assembled ",
							createVNode(_components.code, { children: "appRouter" }),
							"’s ",
							createVNode(_components.code, { children: "StandardRPCMatcher" }),
							" tree routes ",
							createVNode(_components.code, { children: "/surface/padi/*" }),
							", the evidence class structural navigation cannot provide."
						] })
					] }),
					"\n",
					createVNode(_components.td, { children: "drishti pair" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "SR2" }),
						" ",
						createVNode($$PrLink, { pr: 1815 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"bound procedures at ",
						createVNode(_components.code, { children: "client.procedures.<ns>.<verb>" }),
						" and on map entries; plus ",
						createVNode(_components.code, { children: "BoundStream.unenrolled" }),
						" / ",
						createVNode(_components.code, { children: "BoundCollection.unenrolledKeys" }),
						" for the un-enrolled carve-out reach"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"kolu’s ",
						createVNode(_components.code, { children: "PadiRpc" }),
						" casts (both sites); drishti’s ",
						createVNode(_components.code, { children: "HostRpc" }),
						"/",
						createVNode(_components.code, { children: "AdminScopedRpc" }),
						" casts"
					] }),
					"\n",
					createVNode(_components.td, { children: "drishti pair" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "SR3" }),
						" ",
						createVNode($$PrLink, { pr: 1811 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"opaque ",
						createVNode(_components.code, { children: "membershipId" }),
						" per map add; typed map connection key; ",
						createVNode(_components.code, { children: "clockNow" }),
						" reserved member + offset-at-admit"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "connectionRearm.ts" }),
						" + test; the ",
						createVNode(_components.code, { children: "\"padi\"" }),
						"/",
						createVNode(_components.code, { children: "\"hosts\"" }),
						" string keys and the ",
						createVNode(_components.code, { children: "as any" }),
						" contract/router splices; drishti’s ",
						createVNode(_components.code, { children: "offsetOf: () => 0" }),
						" stub. Done only when same-key remove/re-add ",
						createVNode(_components.em, { children: "and" }),
						" authority restart rebuild subscriptions keyed on ",
						createVNode(_components.code, { children: "{encodedKey, membershipId}" })
					] }),
					"\n",
					createVNode(_components.td, { children: "drishti pair" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "SR4" }),
						" ",
						createVNode($$PrLink, { pr: 1804 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"failure schema on ",
						createVNode(_components.code, { children: "defineSurfaceMap" }),
						"; required, total ",
						createVNode(_components.code, { children: "failureOf" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"both ",
						createVNode(_components.code, { children: "\"other\"" }),
						" fabrication sites in the map server; the loose ",
						createVNode(_components.code, { children: "z.string()" }),
						" cause on the wire"
					] }),
					"\n",
					createVNode(_components.td, { children: "drishti pair" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "SR5" }),
						" ",
						createVNode($$PrLink, { pr: 1822 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"mirror + ",
						createVNode(_components.code, { children: "reServeSurface" }),
						" consume declared collection ",
						createVNode(_components.code, { children: "deltas" }),
						"; named retryable relay end; ",
						createVNode(_components.code, { children: "extendSurface" }),
						" for parent-owned additions (the re-serve cast/collection dedup rides along)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"drishti’s ",
						createVNode(_components.code, { children: "processesSnapshot" }),
						" stream, parent reducer, and inert ",
						createVNode(_components.code, { children: "metricHistory" }),
						" stub; the mirror’s per-key stream fan-out for delta-declaring collections"
					] }),
					"\n",
					createVNode(_components.td, { children: "drishti pair" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "SR6" }),
						" (",
						createVNode($$PrLink, { pr: 1829 }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"adoption sweep — ",
						createVNode(_components.code, { children: "firstFrameOrUndefined" }),
						" at two open-coded one-shot reads (kaval-tui ",
						createVNode(_components.code, { children: "readExitCode" }),
						" over the ",
						createVNode(_components.code, { children: "exit" }),
						" stream, server ",
						createVNode(_components.code, { children: "readPadiMemoryOnce" }),
						" over ",
						createVNode(_components.code, { children: "processMemory" }),
						"), pinned by an AST guard; kaval-tui ",
						createVNode(_components.code, { children: "consumeExit" }),
						" stays open-coded as a documented non-adoption (its ",
						createVNode(_components.code, { children: "settle" }),
						" must fire before the awaited iterator-close in a ",
						createVNode(_components.code, { children: "Promise.all" }),
						" race); the other named primitives (",
						createVNode(_components.code, { children: "acceptSurfaceSocket" }),
						", ",
						createVNode(_components.code, { children: "presentingDown" }),
						", ",
						createVNode(_components.code, { children: "setAttention" }),
						", ",
						createVNode(_components.code, { children: "surfaceClientsHealth" }),
						") grounded as already-adopted or deliberate divergences, not force-adopted"
					] }),
					"\n",
					createVNode(_components.td, { children: "the open-coded iterator advances (consumer-side; rode no sibling branch)" }),
					"\n",
					createVNode(_components.td, { children: "none" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "SR7" }),
						" (",
						createVNode($$PrLink, { pr: 1823 }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"bridge: the ",
						createVNode(_components.code, { children: "$" }),
						" read face, ",
						createVNode(_components.code, { children: "computed" }),
						", ",
						createVNode(_components.code, { children: "batch" }),
						", post-equals mirror pokes"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"padi urgency’s ",
						createVNode(_components.code, { children: "publishUrgency" }),
						" + both riders + the prose invariant (",
						createVNode(_components.a, {
							href: "surface-reactive-bridge.html#the-worked-examples",
							children: "worked example 1"
						}),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: "drishti pair" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "SR8" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"bridge: ",
						createVNode(_components.code, { children: "derived.collection" }),
						" + ",
						createVNode(_components.code, { children: "source" }),
						"’s poll shape; the poll-on-change client core moves into ",
						createVNode(_components.code, { children: "@kolu/surface" }),
						" beside ",
						createVNode(_components.code, { children: "pollOnEvent" }),
						" as its named dual",
						createVNode($$Footnote, { children: [
							"The move’s shape: a framework-free core (subscribe to the ",
							createVNode(_components.code, { children: "{seq}" }),
							" pulse → re-run the procedure → equality-dedupe → emit) exported beside ",
							createVNode(_components.code, { children: "pollOnEvent" }),
							"; the SolidJS ergonomics (",
							createVNode(_components.code, { children: ".pending()" }),
							", the #818 selection-stability guard) stay in ",
							createVNode(_components.code, { children: "packages/client" }),
							". Done when the core is importable from ",
							createVNode(_components.code, { children: "@kolu/surface" }),
							" with zero Solid imports and the Code tab is byte-identical (the existing e2e + the #818 guard test pin it). The once-planned ",
							createVNode(_components.code, { children: "writeWrappedValue" }),
							" copy-deletion is already satisfied — the copy was consolidated in #805 before SR8; L1’s live deliverable is the core extraction alone."
						] }),
						" ",
						createVNode(_components.strong, { children: "Named obligation (from SR7):" }),
						" resolve the ",
						createVNode(_components.strong, { children: "urgency compose-fold regression" }),
						" — SR7 wired ",
						createVNode(_components.code, { children: "urgency: derived.cell(($) => recomputeUrgency($.terminals()))" }),
						" off the ",
						createVNode(_components.em, { children: "composed" }),
						" collection, so every firehose poke re-composes every live terminal (O(M)→O(M²)/cycle vs the pre-SR7 raw-registry reads; see ",
						createVNode(_components.a, {
							href: "surface-reactive-bridge.html#the-worked-examples",
							children: ["SR7 ", createVNode($$PrLink, { pr: 1823 })]
						}),
						"). The fix, precisely located (the keyed reconciler is a ",
						createVNode(_components.em, { children: "wire" }),
						" dedup — it diffs a whole-map read, after the recompose): the ",
						createVNode(_components.strong, { children: [
							"incremental ",
							createVNode(_components.code, { children: "$" }),
							" sibling read"
						] }),
						" — the framework maintains the composed per-key map in the existing ",
						createVNode(_components.code, { children: "wrappedUpsert" }),
						"/",
						createVNode(_components.code, { children: "wrappedRemove" }),
						", so a cycle costs M composes, one per poke — proven by a compose-count gate (24 vs 600/cycle at M=24). ",
						createVNode(_components.strong, { children: "SR8 is that regression’s proving case" }),
						" and cannot ship without it."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"two of the three hand-rolled samplers (padi memory, hostInventory; kolu-server parked as ",
						createVNode(_components.a, {
							href: "#sr8a",
							children: "SR8.a"
						}),
						"); drishti’s keyed poll-reconciles; ",
						createVNode(_components.strong, { children: "the urgency compose-fold regression (SR7)" })
					] }),
					"\n",
					createVNode(_components.td, { children: "drishti pair" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "SR9" }),
						" (",
						createVNode($$PrLink, { pr: 1836 }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"bridge: ",
						createVNode(_components.code, { children: "reactiveFamily" }),
						" + ",
						createVNode(_components.code, { children: "derived.registry" }),
						" — the ",
						createVNode(_components.code, { children: "serveHostMap" }),
						" reshape (worked example 4), ",
						createVNode(_components.strong, { children: "extended: one connection authority." }),
						" Both connection views — the dot’s ",
						createVNode(_components.code, { children: "EntryStatus" }),
						" ",
						createVNode(_components.em, { children: "and" }),
						" the word — derive from the one ",
						createVNode(_components.code, { children: "reactiveFamily<SessionState>" }),
						" source; the fine connection payload rides the entry (equals-gated), the ",
						createVNode(_components.code, { children: "connection" }),
						" cell / ",
						createVNode(_components.code, { children: "connectionPipe.ts" }),
						" / the ",
						createVNode(_components.code, { children: "mirroredSurface" }),
						" seam are deleted from the tree, and the word derives client-side via the exported pure ",
						createVNode(_components.code, { children: "projectConnection" }),
						". The joint invariant — ",
						createVNode(_components.em, { children: [
							"for any ",
							createVNode(_components.code, { children: "SessionState" }),
							", ",
							createVNode(_components.code, { children: "EntryStatus === connected" }),
							" ⟺ ",
							createVNode(_components.code, { children: "connection.phase === connected" })
						] }),
						" — is enforced server-side pre-publication and pinned by a contract test plus a joint-render pin at drishti’s sole ",
						createVNode(_components.code, { children: "entry.state()" }),
						" seam (drishti has no browser harness by design; the delivery-divergence class died with the second channel, so the pin realizes the “settled frame agreement” done-criterion). Fixed the live bug (",
						createVNode(_components.a, {
							href: "https://github.com/srid/drishti/issues/102",
							children: "srid/drishti#102"
						}),
						", green dot + permanent “connecting”) — srid live-confirmed on a real deployment before merge"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"~60 lines of serveHostMap plumbing (drishti’s clone already died in #92); the second independent connection projection/subscription — ",
						createVNode(_components.code, { children: "connectionPipe.ts" }),
						" and the dot-vs-word split (fixed srid/drishti#102, pair ",
						createVNode(_components.a, {
							href: "https://github.com/srid/drishti/pull/105",
							children: "srid/drishti#105"
						}),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: "drishti pair" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "SR10" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"the padi registry as ",
						createVNode(_components.code, { children: "signalMap" }),
						" — the campaign’s one ",
						createVNode(_components.em, { children: "adjudicated" }),
						" row; the full question, the defect in code, and the decision live in ",
						createVNode(_components.a, {
							href: "#sr10",
							children: "its own section below"
						})
					] }),
					"\n",
					createVNode(_components.td, { children: "per the adjudication" }),
					"\n",
					createVNode(_components.td, { children: "per the adjudication" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Ordering constraints, honestly stated: SR1–SR6 are mutually independent (land in any order); SR7 needs only shipped phase 0; SR8 needs 7 (",
			createVNode(_components.code, { children: "$" }),
			" and the poke seams); SR9 needs 8 (the collection wire form); SR10 needs 7–9 (it is their evidence). The ",
			createVNode(_components.strong, { children: "named design questions" }),
			" that are deliberately ",
			createVNode(_components.em, { children: "not" }),
			" PRs here: the append-heavy wire member (above, where the framework-backpressure question also closes if it ships a bound); the bridge’s open questions, ruled inside its track; the server-authored notify discriminant (needs grounding first). One unratified candidate stands beside the plan, srid’s to revive: a repeatable typing-latency lane as this plan’s net — the keystroke→echo pipe these PRs rebuild was measured once at W2.2 (+1.3 ms p99 against a +5 ms budget, method in ",
			createVNode(_components.a, {
				href: "padi-latency-baseline.html",
				children: "the baseline note"
			}),
			"), and a ",
			createVNode(_components.code, { children: "just bench" }),
			"-style lane rerunning that method before/after would replace a months-old one-off with a standing budget check. The parked padi-area cleanups (each with its own gate) live in ",
			createVNode(_components.a, {
				href: "padi.html#parked",
				children: "the padi note"
			}),
			" and are untouched by this plan."
		] }),
		"\n",
		createVNode("a", { id: "sr8a" }),
		"\n",
		createVNode(_components.h3, {
			id: "sr8a--serve-after-boot-then-the-third-sampler",
			children: "SR8.a — serve after boot, then the third sampler"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"SR8 (",
			createVNode($$PrLink, { pr: 1832 }),
			") converted two of the three hand-rolled samplers; kolu-server’s ",
			createVNode(_components.code, { children: "processMemory" }),
			" is this parked continuation. The blocker is ordering: kolu’s surface is served eagerly at ",
			createVNode(_components.code, { children: "surface.ts" }),
			" module load, while the sampler’s read (",
			createVNode(_components.code, { children: "readPadiMemoryOnce" }),
			") and its ",
			createVNode(_components.code, { children: "padiSession.onState" }),
			" force-resample exist only after ",
			createVNode(_components.code, { children: "index.ts" }),
			"’s async boot — a derived poll cell can’t wire the resample, and losing it is a real regression (the rail freezes a stale MB for up to ~5 s on a padi drop). The late-bind registrar seam that would force it into SR8 was rejected as an override-knob. ",
			createVNode(_components.strong, { children: "The work, one PR:" }),
			" move the kolu surface serve into ",
			createVNode(_components.code, { children: "index.ts" }),
			" post-",
			createVNode(_components.code, { children: "padiSession" }),
			" (a router/serve assembly restructure), then convert the sampler. Build-time grounding found a ",
			createVNode(_components.strong, { children: "second" }),
			" kolu-server hand-roll of the identical shape — ",
			createVNode(_components.code, { children: "startDaemonInventorySampler" }),
			" (",
			createVNode(_components.code, { children: "padi/daemonInventory.ts" }),
			"), outside the campaign’s three-sampler ledger — and it converts in the same PR, so the negative property ships with ",
			createVNode(_components.strong, { children: "zero allowlist" }),
			": no hand-rolled ",
			createVNode(_components.code, { children: "setInterval" }),
			" sampler remains in kolu-server. ",
			createVNode(_components.strong, { children: "Gate:" }),
			" none beyond scheduling it — the gate ",
			createVNode(_components.em, { children: "is" }),
			" the restructure. Provenance: issue #1831, closed into this entry."
		] }),
		"\n",
		createVNode("a", { id: "sr8b" }),
		"\n",
		createVNode(_components.h3, {
			id: "sr8b--the-incremental-per-key-urgency-fold",
			children: "SR8.b — the incremental per-key urgency fold"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"SR8 resolved its named obligation (compose count O(M²)→O(M), gate-proven 600→24/cycle at M=24), and its wall-clock evidence disclosed the honest remainder: ",
			createVNode(_components.code, { children: "recomputeUrgency" }),
			" still scans the whole terminals map per poke — a cheap residual O(M²); the win plateaus at ~14× (278→19 ms/cycle at M=1536) instead of growing. ",
			createVNode(_components.strong, { children: "The work:" }),
			" a lawful incremental fold — only the poked key updates its urgency contribution, surviving removes — never a cached scan. ",
			createVNode(_components.strong, { children: "Gate:" }),
			" a real workload where the scan matters (live M is ~16–24 today, where it is noise) — with SR10 declined, the “keyed machinery makes it free” branch closes; a SR10 revival reopens it. Provenance: issue #1834, closed into this entry; evidence on ",
			createVNode($$PrLink, { pr: 1832 }),
			"."
		] }),
		"\n",
		createVNode("a", { id: "sr10" }),
		"\n",
		createVNode(_components.h3, {
			id: "sr10--the-padi-registry-as-signalmap-the-adjudication",
			children: "SR10 — the padi registry as signalMap: the adjudication"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Padi’s terminal registry is an ordinary in-memory ",
			createVNode(_components.code, { children: "Map" }),
			" (",
			createVNode(_components.code, { children: "terminal-registry.ts:95" }),
			"), and ",
			createVNode(_components.strong, { children: "the registry IS the store" }),
			" — the ",
			createVNode(_components.code, { children: "terminals" }),
			" collection is served straight off it. When code changes a terminal it must ",
			createVNode(_components.em, { children: "remember to call" }),
			" one of five named publish seams (",
			createVNode(_components.code, { children: "metadata.ts:96-243" }),
			", all funneling into two ctx writes) so the change becomes a wire frame. SR10 asks: rebuild the registry as a ",
			createVNode(_components.code, { children: "signalMap" }),
			" — a writable reactive store — so publishing is automatic and forgetting has no spelling?"
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "The defect the convention leaves expressible, in code." }), " Nothing rejects this today — no type, no lint, no crash:"] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// any future padi feature, any file:</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> entry</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> requireMutableTerminal</span><span style=\"color:#24292E\">(id);</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// ^ the registry's accessor for mutation handlers (terminal-registry.ts:277):</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//   looks the id up and returns the LIVE TerminalProcess object itself —</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//   whoever holds it can assign to entry.meta/entry.snapshot directly.</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">entry.meta.lastActivityAt </span><span style=\"color:#D73A49\">=</span><span style=\"color:#24292E\"> Date.</span><span style=\"color:#6F42C1\">now</span><span style=\"color:#24292E\">();   </span><span style=\"color:#6A737D\">// mutates the registry in place</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// ...forgot: publishComposedTerminal(id)  ← the convention. Nothing enforces it.</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"Two consequences, the second subtler: the tile shows stale info forever, ",
			createVNode(_components.strong, { children: "and" }),
			" ",
			createVNode(_components.code, { children: "materializeSiblingView" }),
			"’s per-key cache (SR8’s perf fix, sole-writer-coupled at ",
			createVNode(_components.code, { children: "servePadi.ts:305-314" }),
			") still holds the ",
			createVNode(_components.em, { children: "old" }),
			" composed record — so server-side derived readers (",
			createVNode(_components.code, { children: "urgency" }),
			") go stale too. The cache made a forgotten publish ",
			createVNode(_components.em, { children: "quieter" }),
			", not louder. Under ",
			createVNode(_components.code, { children: "signalMap" }),
			", mutation and publish are the same act, so the forgetting is unspellable:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// there is no bare entry to mutate; this is the ONLY write:</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">terminals.</span><span style=\"color:#6F42C1\">update</span><span style=\"color:#24292E\">(id, (</span><span style=\"color:#E36209\">t</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> ({ </span><span style=\"color:#D73A49\">...</span><span style=\"color:#24292E\">t, meta: { </span><span style=\"color:#D73A49\">...</span><span style=\"color:#24292E\">t.meta, lastActivityAt: now } }));</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "What SR7–SR9 already banked" }), " (the marginal-value ledger from the SR10-ADJ decision package), in code:"] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// SR7 — a DERIVED fact can't be forgotten: the graph tracks the edge, no</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// writer calls anything (servePadi.ts:251):</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">urgency</span><span style=\"color:#24292E\">: derived.</span><span style=\"color:#6F42C1\">cell</span><span style=\"color:#24292E\">((</span><span style=\"color:#E36209\">$</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> recomputeUrgency</span><span style=\"color:#24292E\">($.</span><span style=\"color:#6F42C1\">terminals</span><span style=\"color:#24292E\">())),</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// SR8 — the fold stays O(M) on the firehose: $.terminals() reads a per-key</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// materialized cache instead of re-composing all M (servePadi.ts:314):</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">terminals</span><span style=\"color:#24292E\">: { </span><span style=\"color:#6A737D\">/* … */</span><span style=\"color:#6F42C1\"> materializeSiblingView</span><span style=\"color:#24292E\">: </span><span style=\"color:#005CC5\">true</span><span style=\"color:#24292E\"> },</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// gate-proven: urgencyComposeCost.test.ts — 24 composes/cycle at M=24, vs 600.</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// SR8 + SR9 — the keyed machinery exists:</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">processes</span><span style=\"color:#24292E\">: derived.</span><span style=\"color:#6F42C1\">collection</span><span style=\"color:#24292E\">(</span><span style=\"color:#6F42C1\">source</span><span style=\"color:#24292E\">({ read, install })),   </span><span style=\"color:#6A737D\">// wire reconciler</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> hosts</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> reactiveFamily</span><span style=\"color:#24292E\">({ members, attach, onEvict }); </span><span style=\"color:#6A737D\">// serveHostMap (SR9)</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "What remains open only because the registry is imperative:" }), " the five seams as a named-call convention (the snippet above), and SR8.b’s incremental fold staying parked. Everything else the row once implied is in the ledger above."] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The cost, honestly — what a conversion must re-path, in code." }),
			" SR9 reshaped a ",
			createVNode(_components.em, { children: "projection" }),
			" of an external authority (the host pool); the registry ",
			createVNode(_components.strong, { children: "is" }),
			" the authority:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// the store to replace IS the source of truth (terminal-registry.ts:95):</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> terminals</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#D73A49\"> new</span><span style=\"color:#6F42C1\"> Map</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">TerminalId</span><span style=\"color:#24292E\">, </span><span style=\"color:#6F42C1\">TerminalProcess</span><span style=\"color:#24292E\">>();</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// in-place mutation on the ~150 ms firehose, once per live terminal</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// (metadata.ts:154) — every such site must route through the new store's</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// write so the change edge fires:</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">entry.snapshot </span><span style=\"color:#D73A49\">=</span><span style=\"color:#24292E\"> observation;</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// ~17 synchronous readers that must keep working WITHOUT reactivity —</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// they need a pull face (keys/has/get), not signals:</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">getTerminal</span><span style=\"color:#24292E\">(id); </span><span style=\"color:#6F42C1\">registryMap</span><span style=\"color:#24292E\">(compose); </span><span style=\"color:#6F42C1\">terminalEntries</span><span style=\"color:#24292E\">(); </span><span style=\"color:#6F42C1\">snapshotFor</span><span style=\"color:#24292E\">(id);</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">parkedTerminalIds</span><span style=\"color:#24292E\">(); </span><span style=\"color:#6F42C1\">requireActiveTerminal</span><span style=\"color:#24292E\">(); </span><span style=\"color:#6F42C1\">drainTerminals</span><span style=\"color:#24292E\">(); </span><span style=\"color:#6A737D\">/* … */</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// park/restore/sleep/wake walk the raw map (terminal-registry.ts:149-173) —</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// the restore's parked→active flip is the restore-idempotency token and must</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// survive a store whose writes now also emit wire frames:</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">hasParkedTerminals</span><span style=\"color:#24292E\">();</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"…plus ",
			createVNode(_components.code, { children: "signalMap" }),
			" itself must be ",
			createVNode(_components.strong, { children: "built" }),
			" (",
			createVNode(_components.code, { children: "reactor.ts:19" }),
			" — “Still ahead: SR10’s ",
			createVNode(_components.code, { children: "signalMap" }),
			"”) ",
			createVNode(_components.em, { children: "and" }),
			" ",
			createVNode(_components.strong, { children: "served" }),
			" — and SR8.c’s live evidence is that even a two-cell conversion surfaced type-acceptance subtleties.",
			createVNode($$Footnote, { children: [
				createVNode(_components.strong, { children: "Why a new primitive — doesn’t Solid ship one?" }),
				" Client-side, yes (",
				createVNode(_components.code, { children: "createStore" }),
				"/",
				createVNode(_components.code, { children: "reconcile" }),
				", ",
				createVNode(_components.code, { children: "@solid-primitives" }),
				"’ reactive map) and kolu uses them there. But padi is a Node daemon where Solid is banned by a pinned test (",
				createVNode(_components.code, { children: "noSolidInDaemon.test.ts" }),
				" — “a UI reactive framework has no business in a PTY daemon’s closure”; padi imports zero ",
				createVNode(_components.code, { children: "solid-js" }),
				"), and the server graph’s ratified engine is ",
				createVNode(_components.code, { children: "@preact/signals-core" }),
				" behind ",
				createVNode(_components.code, { children: "reactor.ts" }),
				" (",
				createVNode(_components.code, { children: "@solidjs/signals" }),
				" is the named swap target, not a today option) — two reactive graphs in one process is the complecting the reactor boundary exists to prevent. And the genuinely new part isn’t the reactive map (small; ",
				createVNode(_components.code, { children: "reactiveFamily" }),
				"’s in-place-latest + version-signal pattern is the precedent) — it’s the ",
				createVNode(_components.strong, { children: "wire half" }),
				" no library can ship: served as ",
				createVNode(_components.code, { children: "derived.collection" }),
				" with per-key frames and equals gating, the synchronous pull face, the ",
				createVNode(_components.code, { children: "poke" }),
				" form, the boot-walk connect, the durability laws. Roughly 20% map, 80% kolu’s own wire contract."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "What the converted world would look like" }), " (the after, sketched honestly):"] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// terminal-registry.ts — the registry IS the reactive store now:</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> terminals</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> signalMap</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">TerminalId</span><span style=\"color:#24292E\">, </span><span style=\"color:#6F42C1\">TerminalProcess</span><span style=\"color:#24292E\">>();</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// the 17 synchronous readers survive on the pull face, unchanged signatures:</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">export</span><span style=\"color:#D73A49\"> const</span><span style=\"color:#6F42C1\"> getTerminal</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> (</span><span style=\"color:#E36209\">id</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> TerminalId</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> terminals.</span><span style=\"color:#6F42C1\">get</span><span style=\"color:#24292E\">(id);</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">export</span><span style=\"color:#D73A49\"> const</span><span style=\"color:#6F42C1\"> terminalEntries</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> () </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> terminals.</span><span style=\"color:#6F42C1\">entries</span><span style=\"color:#24292E\">();</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// requireMutableTerminal is DELETED — the raw-entry door the defect walks</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// through cannot exist: nothing hands out a live object to mutate silently.</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// metadata.ts — the five seams SURVIVE as the domain vocabulary; only the</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// ritual line dies. Cold paths use the immutable update:</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">export</span><span style=\"color:#D73A49\"> function</span><span style=\"color:#6F42C1\"> updateMemory</span><span style=\"color:#24292E\">(</span><span style=\"color:#E36209\">id</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> TerminalId</span><span style=\"color:#24292E\">, </span><span style=\"color:#E36209\">facts</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> MemoryFacts</span><span style=\"color:#24292E\">) {</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  terminals.</span><span style=\"color:#6F42C1\">update</span><span style=\"color:#24292E\">(id, (</span><span style=\"color:#E36209\">t</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> ({ </span><span style=\"color:#D73A49\">...</span><span style=\"color:#24292E\">t, meta: { </span><span style=\"color:#D73A49\">...</span><span style=\"color:#24292E\">t.meta, </span><span style=\"color:#D73A49\">...</span><span style=\"color:#24292E\">facts } }));</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">  // no publishComposedTerminal(id) — the write IS the wire frame</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">}</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// the ~150 ms firehose CANNOT afford a spread per poke (the alloc cost SR7/SR8</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// fought), so the hot seam uses the in-place poke form — mutate, then the store</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// bumps that key's version (the reactiveFamily precedent: in-place `latest` +</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// a version-signal change edge):</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">export</span><span style=\"color:#D73A49\"> function</span><span style=\"color:#6F42C1\"> commitSnapshot</span><span style=\"color:#24292E\">(</span><span style=\"color:#E36209\">id</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> TerminalId</span><span style=\"color:#24292E\">, </span><span style=\"color:#E36209\">observation</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> Snapshot</span><span style=\"color:#24292E\">) {</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  terminals.</span><span style=\"color:#6F42C1\">poke</span><span style=\"color:#24292E\">(id, (</span><span style=\"color:#E36209\">t</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> { t.snapshot </span><span style=\"color:#D73A49\">=</span><span style=\"color:#24292E\"> observation; });</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">}</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// servePadi.ts — the collection is declared FROM the store; the wire member</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// stops being convention-published:</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">terminals</span><span style=\"color:#24292E\">: derived.</span><span style=\"color:#6F42C1\">collection</span><span style=\"color:#24292E\">(terminals.</span><span style=\"color:#6F42C1\">map</span><span style=\"color:#24292E\">(composePadiTerminal)),</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// downstream derivations unchanged:</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">urgency</span><span style=\"color:#24292E\">: derived.</span><span style=\"color:#6F42C1\">cell</span><span style=\"color:#24292E\">((</span><span style=\"color:#E36209\">$</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> recomputeUrgency</span><span style=\"color:#24292E\">($.</span><span style=\"color:#6F42C1\">terminals</span><span style=\"color:#24292E\">())),</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"Three honest observations about the after: the seams don’t vanish — ",
			createVNode(_components.code, { children: "updateMemory" }),
			"/",
			createVNode(_components.code, { children: "commitSnapshot" }),
			"/etc. survive as the domain verbs, and what vanishes is the ",
			createVNode(_components.em, { children: "forgettable line" }),
			" inside them plus ",
			createVNode(_components.code, { children: "requireMutableTerminal" }),
			" (the door itself); the store must ship ",
			createVNode(_components.strong, { children: "both" }),
			" write forms (",
			createVNode(_components.code, { children: "update" }),
			" for cold paths, ",
			createVNode(_components.code, { children: "poke" }),
			" for the firehose) or the conversion trades the forgotten-publish class for an allocation regression; and ",
			createVNode(_components.code, { children: "terminals.map(composePadiTerminal)" }),
			" has to subsume ",
			createVNode(_components.code, { children: "materializeSiblingView" }),
			"’s per-key caching internally — compose-once-per-poke, gate-pinned by the existing ",
			createVNode(_components.code, { children: "urgencyComposeCost" }),
			" harness."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Adjudicated — DECLINED, dated 2026-07-15" }),
			" (srid’s explicit call, after the full code-first review of this section: the defect snippet, the banked ledger, the cost re-path, the converted-world sketch, the second-consumer sweep, and the engine question). Not a permanent no — a decline ",
			createVNode(_components.strong, { children: "with two teeth" }),
			":"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The confinement pin ships now" }),
				" (rides SR8.c as one small commit): an AST guard in the SR6 pattern pinning ",
				createVNode(_components.em, { children: ["registry-entry mutation happens only inside ", createVNode(_components.code, { children: "metadata.ts" })] }),
				" — so a future write path is forced into the one file where the seams live, or fails CI. The declined class stays expressible but becomes ",
				createVNode(_components.strong, { children: "un-sprawlable" }),
				": bounded to one reviewed file, not loose in the tree."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Revive when any one holds:" }),
				" a second consumer needs a writable reactive keyed store (prove-then-extract — ",
				createVNode(_components.strong, { children: "checked 2026-07-15, none exists" }),
				": drishti’s one instance of the shape already rides the graduated ",
				createVNode(_components.code, { children: "serveHostMap" }),
				"; odu’s two near-misses both fail honestly — the MCP ",
				createVNode(_components.code, { children: "LogsStore" }),
				" is a projection of the coordinator’s stream, and the runner’s ",
				createVNode(_components.code, { children: "PipelineState.nodes" }),
				" is a true keyed store whose writes are already atomic set+publish through one helper, ",
				createVNode(_components.code, { children: "runner.ts:89-97" }),
				" — the forgotten-publish hazard does not occur in either repo; the most plausible ",
				createVNode(_components.em, { children: "future" }),
				" consumer is a live ",
				createVNode(_components.code, { children: "odu runs --watch" }),
				" over the on-disk ledger, if that feature is ever built); OR SR8.b’s workload gate trips (live M grows past where the scan is noise); OR a silently-stale-tile incident lands from a forgotten seam."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The convention-published members persist alongside derived ones — the bridge’s honest cost #10, accepted with a fence rather than denied. The deleted-world doc sweep’s residue rides ",
			createVNode(_components.strong, { children: "SR8.c" }),
			" (the plan’s last-shipping PR) as its tail commit.",
			createVNode($$Footnote, { children: [
				"Comments and READMEs across the stack still cite the deleted ",
				createVNode(_components.code, { children: "packages/pulam*" }),
				" packages as context (31 non-test src files, re-verified 2026-07-15; ",
				createVNode(_components.code, { children: "rg -i 'pulam' packages/*/src --type ts -g '!*test*'" }),
				" plus package READMEs). Update each to the padi-era truth or delete; Atlas notes are exempt (historical record). Done when the grep returns only deliberate historical references, each commented as such. Hygiene never ships standalone — it rides the last PR as one tail commit."
			] })
		] }),
		"\n",
		createVNode("a", { id: "sr8c" }),
		"\n",
		createVNode(_components.h3, {
			id: "sr8c--members-have-one-home",
			children: "SR8.c — members have one home"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Shipped" }),
			" (",
			createVNode($$PrLink, { pr: 1838 }),
			", pin-pair ",
			createVNode(_components.a, {
				href: "https://github.com/srid/drishti/pull/106",
				children: "srid/drishti#106"
			}),
			"): all three moves + the SR10 confinement pin (",
			createVNode(_components.code, { children: "registryMutationConfinement.test.ts" }),
			", zero outside mutations found) + the pulam doc-sweep tail. With it, every row of this plan is resolved — shipped, parked-with-gate, or declined-dated."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"SR8.a shipped with a composition defect srid caught post-merge: ",
			createVNode(_components.code, { children: "implementKoluSurface(pollCells: KoluDerivedCells)" }),
			" splits kolu’s member table across two files ",
			createVNode(_components.strong, { children: "by dependency timing" }),
			" — ",
			createVNode(_components.code, { children: "index.ts" }),
			"’s boot builds the framework’s ",
			createVNode(_components.code, { children: "derived.cell(source(...))" }),
			" inline and injects the ",
			createVNode(_components.em, { children: "constructed artifacts" }),
			", while store cells wire in ",
			createVNode(_components.code, { children: "surface.ts" }),
			". The design that cures it was lens-run before authoring",
			createVNode($$Footnote, { children: [
				"Two Workflow runs over the proposed shape — ",
				createVNode(_components.code, { children: "wf_4d7b4b25-995" }),
				" (C2/C3/C6 + adversarial refute, 15 raw → 4 confirmed) and ",
				createVNode(_components.code, { children: "wf_f51bacc4-d06" }),
				" (overlay-parameterized C3 ladder + C1). The runs ",
				createVNode(_components.em, { children: "refuted the initial framework diagnosis" }),
				": ",
				createVNode(_components.code, { children: "implementSurfaces" }),
				" has carried per-entry spec types since #1197/#1201 (",
				createVNode(_components.code, { children: "SurfaceDepsFor<S>" }),
				", tsc-probed — full inline inference, zero casts); the “any-specs / cast at the entry boundary” story survives only in a stale comment (",
				createVNode(_components.code, { children: "packages/server/src/surface.ts:217-220" }),
				") contradicted five lines down, and ",
				createVNode(_components.code, { children: "Omit<ImplementSurfaceDeps<…>, \"channel\">" }),
				" is a provable no-op (",
				createVNode(_components.code, { children: "channel" }),
				" left the interface in #1805). The originally-proposed framework signature change + drishti pair would have been churn on a healthy API."
			] }),
			" — three moves, one PR:"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Hygiene — delete the fossils." }),
				" The two vestigial ",
				createVNode(_components.code, { children: "Omit<ImplementSurfaceDeps<…>, \"channel\">" }),
				" spells (",
				createVNode(_components.code, { children: "packages/server/src/surface.ts:223-226" }),
				" ",
				createVNode(_components.strong, { children: "and" }),
				" ",
				createVNode(_components.code, { children: "packages/padi/src/controlCore.ts:21-24" }),
				" — line-wrapped, a naive single-line grep misses both); the lying “any-specs / cast at the entry boundary” comment; the unnecessary ",
				createVNode(_components.code, { children: "{ input: … }" }),
				" hand-annotations in ",
				createVNode(_components.code, { children: "implementSurfaces.test.ts" }),
				". Out-of-line deps consts keep a clean ",
				createVNode(_components.code, { children: "ImplementSurfaceDeps<typeof spec>" }),
				" annotation (structurally required by TS for a standalone const — no builder API chases this)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The inversion — one home, one writer." }),
				" ",
				createVNode(_components.code, { children: "implementKoluSurface" }),
				" takes plain domain-named dependencies (",
				createVNode(_components.code, { children: "readPadiMemoryOnce" }),
				" / ",
				createVNode(_components.code, { children: "readDaemonInventoryOnce" }),
				" / a payload-typed ",
				createVNode(_components.code, { children: "onState" }),
				" / ",
				createVNode(_components.code, { children: "padiIdentity" }),
				") and builds ",
				createVNode(_components.strong, { children: "all" }),
				" members inside ",
				createVNode(_components.code, { children: "surface.ts" }),
				" — the framework ",
				createVNode(_components.code, { children: "source(...)" }),
				" nodes are assembled there (never a kolu-named parallel poll-spec type — that would duplicate ",
				createVNode(_components.code, { children: "PollSourceOptions" }),
				" one layer up). ",
				createVNode(_components.code, { children: "padiLink" }),
				" + ",
				createVNode(_components.code, { children: "processStartedAt" }),
				" convert to ",
				createVNode(_components.strong, { children: "push-source" }),
				" derived cells on the single ",
				createVNode(_components.code, { children: "onState" }),
				" subscription, retiring their hand-rolled in-memory stores and the exported-ctx write path (",
				createVNode(_components.code, { children: "index.ts:999/:1005" }),
				") — “graph is the one writer” completed. Explicitly NOT the deferred ",
				createVNode(_components.em, { children: "poll" }),
				" arm: the reactor defers poll reads by a microtask, the exact stale-read hazard ",
				createVNode(_components.code, { children: "captureLatest" }),
				" exists for — verify push-emit timing is synchronous at build, and STOP if it is not. ",
				createVNode(_components.code, { children: "KoluDerivedCells" }),
				" dies; ",
				createVNode(_components.code, { children: "index.ts" }),
				" imports no reactor primitives."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The one genuinely-lower move (the real framework half, drishti-paired):" }),
				" graduate the cadence fuse — kolu-server’s ",
				createVNode(_components.code, { children: "everyMsOrOnState" }),
				" (",
				createVNode(_components.code, { children: "pollCadence.ts:29" }),
				") and padi’s byte-same ",
				createVNode(_components.code, { children: "everyMsOrOnDaemonChange" }),
				" (",
				createVNode(_components.code, { children: "servePadi.ts:168" }),
				") — to ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				"’s reactor beside ",
				createVNode(_components.code, { children: "everyMs" }),
				" (two proven consumers, zero kolu concepts; the SR8.a-recorded follow-up lands here). Both twins delete; ",
				createVNode(_components.code, { children: "ref-surface.mdx" }),
				" updates. Do ",
				createVNode(_components.strong, { children: "not" }),
				" ship SR8.c with the duplicate pair still standing."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "captureLatest" }),
			" was deliberately ",
			createVNode(_components.strong, { children: "kept at app policy" }),
			" through this move — one consumer; its deeper cure (surface-remote’s honest liveness during connecting) shipped separately as ",
			createVNode($$PrLink, { pr: 1852 }),
			": the seam grew ",
			createVNode(_components.code, { children: "Session.currentState()" }),
			", the honest synchronous point-read twin of ",
			createVNode(_components.code, { children: "onState" }),
			", and the memory-rail gate reads ",
			createVNode(_components.code, { children: "phase === \"connected\"" }),
			" off it, so ",
			createVNode(_components.code, { children: "captureLatest" }),
			" and ",
			createVNode(_components.code, { children: "pollCadence.ts" }),
			" are gone. The corrected mechanism there also falsified this note’s implicit framing — ",
			createVNode(_components.code, { children: "onState" }),
			" delivery is microtask-deferred, so ",
			createVNode(_components.code, { children: "captureLatest" }),
			"’s “same synchronous frame” guarantee was an accident of ordering, and the retired ",
			createVNode(_components.code, { children: "currentClient() !== null" }),
			" gate actually leaked stale-live through whole reconnect backoff windows, not just one microtask. The build’s gauntlet surfaced two further reactor-depth candidates, ",
			createVNode(_components.strong, { children: "recorded with gates, not done" }),
			": a ",
			createVNode(_components.strong, { children: "hot push-source" }),
			" (replay the current level to a late subscriber — would retire the shared-source seed invariant the build instead enforces fail-fast at boot; gate: a second late-subscriber consumer, or that boot assert ever firing in the wild) and ",
			createVNode(_components.strong, { children: "poll-seed totality lifted into the reactor" }),
			" (log-skip-continue on the T+0 read, retiring per-cell total-wrappers; gate: a second total-wrapper appearing). Both are ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" changes with drishti drag — prove-then-extract holds them. Done-criteria, grep-shaped: no ",
			createVNode(_components.code, { children: "Omit<ImplementSurfaceDeps" }),
			" spelling anywhere (multiline-aware grep); no local cadence-fuse in kolu-server or padi (the reactor export is the only spelling); ",
			createVNode(_components.code, { children: "index.ts" }),
			" imports no ",
			createVNode(_components.code, { children: "derived" }),
			"/",
			createVNode(_components.code, { children: "source" }),
			"; behavior-neutral — e2e + seal. ",
			createVNode(_components.strong, { children: "Gate:" }),
			" none — schedulable. Provenance: srid’s post-merge finding on ",
			createVNode($$PrLink, { pr: 1835 }),
			" + the two lens runs."
		] }),
		"\n",
		createVNode("a", { id: "sr11" }),
		"\n",
		createVNode(_components.h3, {
			id: "sr11--a-member-declares-its-client-policy-shipped---merged-2026-07-16",
			children: ["SR11 — a member declares its client policy ", createVNode(_components.em, { children: [
				"(shipped — ",
				createVNode($$PrLink, { pr: 1847 }),
				", merged 2026-07-16)"
			] })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The campaign gave the ",
			createVNode(_components.strong, { children: "producer" }),
			" side its DSL — a member declares its schema, its ",
			createVNode(_components.code, { children: "equals" }),
			", its derivation, and the framework mints the serving. The ",
			createVNode(_components.strong, { children: "consumer" }),
			" side never got the same treatment: client ",
			createVNode(_components.em, { children: "policy" }),
			" — which ",
			createVNode(_components.code, { children: "onError" }),
			", floor-on-liveness or not, ",
			createVNode(_components.code, { children: "authority" }),
			", coalescing, an ",
			createVNode(_components.code, { children: "initial" }),
			" — is still spelled per use-site, ~22 sites today, and the code confesses the pattern (",
			createVNode(_components.code, { children: "useDaemonStatus.ts:192" }),
			": ",
			createVNode(_components.em, { children: [
				"“Same singleton ",
				createVNode(_components.code, { children: "app.cells.X.use(...)" }),
				" pattern as ",
				createVNode(_components.code, { children: "processMemory" }),
				"”"
			] }),
			").",
			createVNode($$Footnote, { children: [
				"Surfaced by the LLM-and-DSLs discussion (the Fowler article read): kolu’s honest app-glue DSL opening is not a string mini-language or a codegen step — the spec and the interpreter already live in the same language; what’s missing is the declaration carrying the ",
				createVNode(_components.em, { children: "consumer" }),
				" half. Grounded 2026-07-15 against ",
				createVNode(_components.code, { children: "wire.ts" }),
				", ",
				createVNode(_components.code, { children: "HostDaemonChips.tsx" }),
				", ",
				createVNode(_components.code, { children: "useDaemonStatus.ts" }),
				"."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Before — real sites, quoted." }), " Every consumer re-decides policy at the call:"] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// wire.ts:277 — preferences</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> preferences</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> app.cells.preferences.</span><span style=\"color:#6F42C1\">use</span><span style=\"color:#24292E\">({</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  authority: </span><span style=\"color:#032F62\">\"local\"</span><span style=\"color:#24292E\">,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  initial: </span><span style=\"color:#005CC5\">DEFAULT_PREFERENCES</span><span style=\"color:#24292E\">,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  coalesceMs: </span><span style=\"color:#005CC5\">150</span><span style=\"color:#24292E\">,                 </span><span style=\"color:#6A737D\">// the #1041 drag-frame debounce</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  onError</span><span style=\"color:#24292E\">: (</span><span style=\"color:#E36209\">err</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> toast.</span><span style=\"color:#6F42C1\">error</span><span style=\"color:#24292E\">(</span><span style=\"color:#032F62\">`Preferences error: ${</span><span style=\"color:#24292E\">err</span><span style=\"color:#032F62\">.</span><span style=\"color:#24292E\">message</span><span style=\"color:#032F62\">}`</span><span style=\"color:#24292E\">),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// HostDaemonChips.tsx:146 — processMemory, per host</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">return</span><span style=\"color:#24292E\"> padiMap.</span><span style=\"color:#6F42C1\">entry</span><span style=\"color:#24292E\">(host).cells.processMemory.</span><span style=\"color:#6F42C1\">use</span><span style=\"color:#24292E\">({</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  onError</span><span style=\"color:#24292E\">: (</span><span style=\"color:#E36209\">err</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> toast.</span><span style=\"color:#6F42C1\">error</span><span style=\"color:#24292E\">(</span><span style=\"color:#032F62\">`Padi/kaval memory error: ${</span><span style=\"color:#24292E\">err</span><span style=\"color:#032F62\">.</span><span style=\"color:#24292E\">message</span><span style=\"color:#032F62\">}`</span><span style=\"color:#24292E\">),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "After — the policy moves into the declaration" }), " (common/surface.ts, beside schema + equals), and the framework mints the hook:"] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// common — policy is DATA: a closed discriminated union, never a string.</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// (A toast FUNCTION can't live in common; the declaration carries the typed</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// intent, the client owns the one interpreter of each arm.)</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">type</span><span style=\"color:#6F42C1\"> ClientErrorPolicy</span><span style=\"color:#D73A49\"> =</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  |</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">kind</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\"> \"toast\"</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">label</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> string</span><span style=\"color:#24292E\"> }       </span><span style=\"color:#6A737D\">// label is payload, kind is checked</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  |</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">kind</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\"> \"log\"</span><span style=\"color:#24292E\"> }                        </span><span style=\"color:#6A737D\">// observable but silent to the user</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  |</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">kind</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\"> \"membership\"</span><span style=\"color:#24292E\"> };                </span><span style=\"color:#6A737D\">// routes to the host-membership handler</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">processMemory</span><span style=\"color:#24292E\">: {</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  schema</span><span style=\"color:#24292E\">: ProcessMemorySchema,</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  equals</span><span style=\"color:#24292E\">: processMemoryMbEqual,</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  client</span><span style=\"color:#24292E\">: { </span><span style=\"color:#6F42C1\">onError</span><span style=\"color:#24292E\">: { </span><span style=\"color:#6F42C1\">kind</span><span style=\"color:#24292E\">: </span><span style=\"color:#032F62\">\"toast\"</span><span style=\"color:#24292E\">, </span><span style=\"color:#6F42C1\">label</span><span style=\"color:#24292E\">: </span><span style=\"color:#032F62\">\"Padi/kaval memory\"</span><span style=\"color:#24292E\"> } },</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">},</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">preferences</span><span style=\"color:#24292E\">: {</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  schema</span><span style=\"color:#24292E\">: PreferencesSchema,</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  client</span><span style=\"color:#24292E\">: { </span><span style=\"color:#6F42C1\">authority</span><span style=\"color:#24292E\">: </span><span style=\"color:#032F62\">\"local\"</span><span style=\"color:#24292E\">, </span><span style=\"color:#6F42C1\">initial</span><span style=\"color:#24292E\">: </span><span style=\"color:#005CC5\">DEFAULT_PREFERENCES</span><span style=\"color:#24292E\">,</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">            coalesceMs</span><span style=\"color:#24292E\">: </span><span style=\"color:#005CC5\">150</span><span style=\"color:#24292E\">,</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">            onError</span><span style=\"color:#24292E\">: { </span><span style=\"color:#6F42C1\">kind</span><span style=\"color:#24292E\">: </span><span style=\"color:#032F62\">\"toast\"</span><span style=\"color:#24292E\">, </span><span style=\"color:#6F42C1\">label</span><span style=\"color:#24292E\">: </span><span style=\"color:#032F62\">\"Preferences\"</span><span style=\"color:#24292E\"> } },</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">},</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// client — ONE interpreter per arm, registered once (satisfies-never fenced,</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// so a new policy kind FORCES a decision here):</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#6F42C1\"> interpretErrorPolicy</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> (</span><span style=\"color:#E36209\">p</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> ClientErrorPolicy</span><span style=\"color:#24292E\">, </span><span style=\"color:#E36209\">err</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> Error</span><span style=\"color:#24292E\">)</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> void</span><span style=\"color:#D73A49\"> =></span><span style=\"color:#24292E\"> {</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  switch</span><span style=\"color:#24292E\"> (p.kind) {</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">    case</span><span style=\"color:#032F62\"> \"toast\"</span><span style=\"color:#24292E\">: toast.</span><span style=\"color:#6F42C1\">error</span><span style=\"color:#24292E\">(</span><span style=\"color:#032F62\">`${</span><span style=\"color:#24292E\">p</span><span style=\"color:#032F62\">.</span><span style=\"color:#24292E\">label</span><span style=\"color:#032F62\">} error: ${</span><span style=\"color:#24292E\">err</span><span style=\"color:#032F62\">.</span><span style=\"color:#24292E\">message</span><span style=\"color:#032F62\">}`</span><span style=\"color:#24292E\">); </span><span style=\"color:#D73A49\">return</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">    case</span><span style=\"color:#032F62\"> \"log\"</span><span style=\"color:#24292E\">: log.</span><span style=\"color:#6F42C1\">warn</span><span style=\"color:#24292E\">(err); </span><span style=\"color:#D73A49\">return</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">    case</span><span style=\"color:#032F62\"> \"membership\"</span><span style=\"color:#24292E\">: </span><span style=\"color:#6F42C1\">onHostMembershipError</span><span style=\"color:#24292E\">(err); </span><span style=\"color:#D73A49\">return</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">    default</span><span style=\"color:#24292E\">: p </span><span style=\"color:#D73A49\">satisfies</span><span style=\"color:#005CC5\"> never</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  }</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">};</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// the use-site shrinks to the read; policy is unrepeatable:</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> mem</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> padiMap.</span><span style=\"color:#6F42C1\">entry</span><span style=\"color:#24292E\">(host).cells.processMemory.</span><span style=\"color:#6F42C1\">use</span><span style=\"color:#24292E\">();</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"What it deletes: the 22-site policy class, the same way ",
			createVNode(_components.code, { children: "derived.cell" }),
			" deleted the publish seams — a future consumer ",
			createVNode(_components.em, { children: "can’t" }),
			" re-decide a member’s error routing or floor, because there is no options bag left to spell it in. The open design questions a lens run must settle before this is a PR: the exact arms of the policy union and their interpreter’s home (the sketch’s shape — typed union in ",
			createVNode(_components.code, { children: "common" }),
			", one ",
			createVNode(_components.code, { children: "satisfies never" }),
			"-fenced interpreter in the client — is the P4-correct skeleton; an earlier draft spelled it as a ",
			createVNode(_components.code, { children: "\"toast:…\"" }),
			" string, which srid caught as one string doing two jobs, discriminant + payload, unrejectable by the checker — the union is the fix, recorded here so it isn’t re-litigated); per-site ",
			createVNode(_components.em, { children: "legitimate" }),
			" divergence (a site that genuinely wants a different floor must become a declared variant, not an override knob); and whether ",
			createVNode(_components.code, { children: "initial" }),
			"/",
			createVNode(_components.code, { children: "authority" }),
			" are policy or wiring. ",
			createVNode(_components.strong, { children: "Gate:" }),
			" lens-run-first (the design-bearing trigger applies in full) + srid’s ratification; drishti-paired (a ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" declaration-shape change). Until ruled, the 22 sites stand — they are correct, just repetitious."
		] }),
		"\n",
		createVNode(_components.p, { children: "The campaign is complete only when these negative properties hold — each is a grep or a test, not a judgment call:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"No production consumer imports oRPC ",
				createVNode(_components.code, { children: "implement" }),
				" merely to finalize a Surface; no serving API accepts private mount material; child failure reaches ",
				createVNode(_components.code, { children: "done" }),
				"; repeated ",
				createVNode(_components.code, { children: "close" }),
				" is harmless."
			] }),
			"\n",
			createVNode(_components.li, { children: "No production consumer casts a declared Surface procedure or copies its callable client shape." }),
			"\n",
			createVNode(_components.li, { children: [
				"Kolu and Drishti contain no ",
				createVNode(_components.code, { children: "as any" }),
				" contract/map splice and no string sibling key at any connection site."
			] }),
			"\n",
			createVNode(_components.li, { children: "A map member cannot enter failed state without a schema-valid domain failure; no framework fallback cause exists." }),
			"\n",
			createVNode(_components.li, { children: [
				"A map add always gets a never-reused membership id; every owner and cache switches on it; ",
				createVNode(_components.code, { children: "connectionRearm.ts" }),
				" does not exist."
			] }),
			"\n",
			createVNode(_components.li, { children: "A failed map entry never collapses an app-wide gate — readiness stays per entry." }),
			"\n",
			createVNode(_components.li, { children: "Drishti has one process protocol and no inert parent-owned member on the agent." }),
			"\n",
			createVNode(_components.li, { children: "A derived member has no ctx entry and no write verbs (the bridge’s one-writer law, held from phase 0 on)." }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Each framework PR updates the affected package README and reference note with the change that introduces its API (and the pass verifies the two daemon/supervisor README dependency claims against their real consumers",
			createVNode($$Footnote, { children: [
				createVNode($$Cite, {
					file: "packages/surface-daemon/README.md",
					lines: "8-9",
					rev: "2b83737fd8f3"
				}),
				" and ",
				createVNode($$Cite, {
					file: "packages/surface-daemon-supervisor/README.md",
					lines: "8-9",
					rev: "2b83737fd8f3"
				}),
				" both claim zero ",
				createVNode(_components.code, { children: "kolu-*" }),
				" dependencies; the claims are unverified against the code that consumes them, not known-false — the docs pass settles them."
			] }),
			"); each runs package tests and full CI, and every drishti pair runs its own CI against the exact kolu commit it pins."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "The boundary test",
			children: createVNode(_components.p, { children: "If a caller is choosing active hosts, retention windows, alert text, or what a failed CI lane means, it is application policy. If a caller is reconstructing router topology, subscription ordering, membership identity, attempt ownership, retry boundaries, or protocol disposal, the framework stopped too early." })
		})
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
	"title": "A Complete Surface Runtime",
	"description": "The plan of record for the surface-framework consolidation: the kernel of runtime, membership, and mirror moves, then the reactive-bridge spine, sequenced as one PR list.",
	"parents": [
		"feature",
		"padi",
		"surface"
	],
	"status": "implemented",
	"maturity": "budding",
	"updated": "2026-07-15T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-a-user-gets",
			"text": "What a user gets"
		},
		{
			"depth": 2,
			"slug": "the-kernel--six-moves-each-where-the-volatility-already-lives",
			"text": "The kernel — six moves, each where the volatility already lives"
		},
		{
			"depth": 3,
			"slug": "sr1--a-runtime-you-can-serve",
			"text": "SR1 — A runtime you can serve"
		},
		{
			"depth": 3,
			"slug": "sr2--procedures-join-the-typed-dual",
			"text": "SR2 — Procedures join the typed dual"
		},
		{
			"depth": 3,
			"slug": "sr3--membership-is-time-and-time-is-a-fact",
			"text": "SR3 — Membership is time, and time is a fact"
		},
		{
			"depth": 3,
			"slug": "sr4--failure-is-domain-data-never-fabricated",
			"text": "SR4 — Failure is domain data, never fabricated"
		},
		{
			"depth": 3,
			"slug": "sr5--one-protocol-across-the-wire",
			"text": "SR5 — One protocol across the wire"
		},
		{
			"depth": 3,
			"slug": "sr6--adopt-before-you-mint",
			"text": "SR6 — Adopt before you mint"
		},
		{
			"depth": 2,
			"slug": "deliberately-not-in-this-plan",
			"text": "Deliberately not in this plan"
		},
		{
			"depth": 2,
			"slug": "the-pr-sequence",
			"text": "The PR sequence"
		},
		{
			"depth": 3,
			"slug": "sr8a--serve-after-boot-then-the-third-sampler",
			"text": "SR8.a — serve after boot, then the third sampler"
		},
		{
			"depth": 3,
			"slug": "sr8b--the-incremental-per-key-urgency-fold",
			"text": "SR8.b — the incremental per-key urgency fold"
		},
		{
			"depth": 3,
			"slug": "sr10--the-padi-registry-as-signalmap-the-adjudication",
			"text": "SR10 — the padi registry as signalMap: the adjudication"
		},
		{
			"depth": 3,
			"slug": "sr8c--members-have-one-home",
			"text": "SR8.c — members have one home"
		},
		{
			"depth": 3,
			"slug": "sr11--a-member-declares-its-client-policy-shipped---merged-2026-07-16",
			"text": "SR11 — a member declares its client policy (shipped — , merged 2026-07-16)"
		}
	];
}
var url = "src/content/atlas/surface-runtime-boundary.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/surface-runtime-boundary.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/surface-runtime-boundary.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
