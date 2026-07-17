import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import "./Cite_D-1zLbJ9.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
//#region src/diagrams/surface-app-multiplex.svg?raw
var surface_app_multiplex_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 960 720\" font-family=\"ui-sans-serif, system-ui, sans-serif\" role=\"img\" aria-label=\"Two independent surfaces — surfaceApp (blue) and admin (amber) — each declared standalone, keyed by its registration name through a thin plural layer, and multiplexed down into one shared WS transport that carries both lineages' wire keys.\">\n  <defs>\n    <marker id=\"sam-arrow-app\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#0D32B2\"/>\n    </marker>\n    <marker id=\"sam-arrow-admin\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#B45309\"/>\n    </marker>\n    <style>\n      .sam-paper    { fill:#ffffff; }\n      .sam-banner   { fill:#1a1c20; font-size:13px; font-weight:700; }\n      .sam-bannersub{ fill:#6b7178; font-size:11px; }\n      .sam-tier     { fill:#9aa0a6; font-size:11px; font-weight:700; letter-spacing:0.06em; }\n\n      /* surfaceApp lineage — brand blue */\n      .sam-app-box   { fill:#EDF0FD; stroke:#0D32B2; stroke-width:2; }\n      .sam-app-key   { fill:#E3E9FD; stroke:#0D32B2; stroke-width:2; }\n      .sam-app-title { fill:#0A0F25; font-size:14px; font-weight:700; }\n      .sam-app-sub   { fill:#4A5072; font-size:11.5px; }\n      .sam-app-edge  { stroke:#0D32B2; stroke-width:2; fill:none; }\n      .sam-app-tag   { fill:#11203a; font-size:11px; font-weight:700; }\n\n      /* admin lineage — amber/gold */\n      .sam-adm-box   { fill:#FFFBF1; stroke:#B45309; stroke-width:2; }\n      .sam-adm-key   { fill:#FBF1DC; stroke:#B45309; stroke-width:2; }\n      .sam-adm-title { fill:#7a4f00; font-size:14px; font-weight:700; }\n      .sam-adm-sub   { fill:#92400E; font-size:11.5px; }\n      .sam-adm-edge  { stroke:#B45309; stroke-width:2; fill:none; }\n      .sam-adm-tag   { fill:#92400E; font-size:11px; font-weight:700; }\n\n      /* shared transport — green, the one wire */\n      .sam-wire      { fill:#E6F4EA; stroke:#15803D; stroke-width:2.5; }\n      .sam-wire-t    { fill:#14532d; font-size:14px; font-weight:700; }\n      .sam-wire-sub  { fill:#166534; font-size:11px; }\n\n      .sam-mono      { font-family:ui-monospace, \"SF Mono\", Menlo, monospace; }\n      .sam-key-lbl   { fill:#1a1c20; font-size:11px; font-weight:700; }\n    </style>\n  </defs>\n\n  <rect class=\"sam-paper\" x=\"0\" y=\"0\" width=\"960\" height=\"720\"/>\n\n  <!-- two lineage lanes: surfaceApp (left, blue) · admin (right, amber) -->\n  <text class=\"sam-banner\" x=\"36\" y=\"34\">Many independent surfaces, ONE transport</text>\n  <text class=\"sam-bannersub\" x=\"36\" y=\"52\">colour = surface lineage — follow each hue down into the single shared wire</text>\n\n  <!-- ================= TIER 1: app declares standalone surfaces ================= -->\n  <text class=\"sam-tier\" x=\"36\" y=\"86\">DECLARE — each a complete standalone surface (defineSurface)</text>\n\n  <!-- surfaceApp -->\n  <rect class=\"sam-app-box\" x=\"60\" y=\"100\" width=\"380\" height=\"92\" rx=\"10\"/>\n  <text class=\"sam-app-title sam-mono\" x=\"80\" y=\"128\">surfaceAppSurface</text>\n  <text class=\"sam-app-sub\" x=\"80\" y=\"150\">buildInfo cell</text>\n  <text class=\"sam-app-sub\" x=\"80\" y=\"170\">+ identity.info probe</text>\n\n  <!-- admin -->\n  <rect class=\"sam-adm-box\" x=\"520\" y=\"100\" width=\"380\" height=\"92\" rx=\"10\"/>\n  <text class=\"sam-adm-title sam-mono\" x=\"540\" y=\"128\">adminSurface</text>\n  <text class=\"sam-adm-sub\" x=\"540\" y=\"150\">hosts collection</text>\n  <text class=\"sam-adm-sub\" x=\"540\" y=\"170\">+ hosts procedures</text>\n\n  <!-- keying edges, each tagged with its registration name -->\n  <path class=\"sam-app-edge\" d=\"M250 192 L250 268\" marker-end=\"url(#sam-arrow-app)\"/>\n  <rect class=\"sam-app-key\" x=\"158\" y=\"216\" width=\"184\" height=\"28\" rx=\"14\"/>\n  <text class=\"sam-key-lbl sam-mono\" x=\"250\" y=\"234\" text-anchor=\"middle\" fill=\"#0A0F25\">key 'surfaceApp'</text>\n\n  <path class=\"sam-adm-edge\" d=\"M710 192 L710 268\" marker-end=\"url(#sam-arrow-admin)\"/>\n  <rect class=\"sam-adm-key\" x=\"630\" y=\"216\" width=\"160\" height=\"28\" rx=\"14\"/>\n  <text class=\"sam-key-lbl sam-mono\" x=\"710\" y=\"234\" text-anchor=\"middle\" fill=\"#7a4f00\">key 'admin'</text>\n\n  <!-- ================= TIER 2: thin plural layer keys + namespaces ================= -->\n  <text class=\"sam-tier\" x=\"36\" y=\"296\">KEY &amp; NAMESPACE — implementSurfaces / surfaceClients (one shared surfaces map)</text>\n\n  <rect class=\"sam-app-key\" x=\"60\" y=\"308\" width=\"380\" height=\"86\" rx=\"10\"/>\n  <text class=\"sam-app-title sam-mono\" x=\"80\" y=\"334\">surfaceApp →</text>\n  <text class=\"sam-app-sub sam-mono\" x=\"80\" y=\"356\">surface.surfaceApp.*</text>\n  <text class=\"sam-app-sub\" x=\"80\" y=\"376\">channel bus namespaced by key</text>\n\n  <rect class=\"sam-adm-key\" x=\"520\" y=\"308\" width=\"380\" height=\"86\" rx=\"10\"/>\n  <text class=\"sam-adm-title sam-mono\" x=\"540\" y=\"334\">admin →</text>\n  <text class=\"sam-adm-sub sam-mono\" x=\"540\" y=\"356\">surface.admin.*</text>\n  <text class=\"sam-adm-sub\" x=\"540\" y=\"376\">channel bus namespaced by key</text>\n\n  <!-- both lineages converge into the one wire -->\n  <path class=\"sam-app-edge\" d=\"M250 394 L250 460 L380 460 L380 524\" marker-end=\"url(#sam-arrow-app)\"/>\n  <path class=\"sam-adm-edge\" d=\"M710 394 L710 460 L580 460 L580 524\" marker-end=\"url(#sam-arrow-admin)\"/>\n  <rect class=\"sam-app-key\" x=\"318\" y=\"446\" width=\"324\" height=\"28\" rx=\"14\"/>\n  <text class=\"sam-key-lbl\" x=\"480\" y=\"464\" text-anchor=\"middle\" fill=\"#11203a\">one router · one ctx · keyed map → one link</text>\n\n  <!-- ================= TIER 3: one multiplexed WS transport (stadium / bus) ================= -->\n  <text class=\"sam-tier\" x=\"36\" y=\"552\">MULTIPLEX — a single WS transport carries them all</text>\n\n  <!-- the shared wire: a stadium / bus -->\n  <rect class=\"sam-wire\" x=\"60\" y=\"564\" width=\"840\" height=\"120\" rx=\"60\"/>\n  <text class=\"sam-wire-t sam-mono\" x=\"92\" y=\"598\">one WS transport</text>\n  <text class=\"sam-wire-sub\" x=\"92\" y=\"618\">multiplexed — every surface keyed by its registration name</text>\n\n  <!-- w1 — surfaceApp keys ride the wire (blue) -->\n  <rect class=\"sam-app-key\" x=\"92\" y=\"630\" width=\"430\" height=\"40\" rx=\"20\"/>\n  <text class=\"sam-app-tag\" x=\"108\" y=\"654\">w1</text>\n  <text class=\"sam-app-sub sam-mono\" x=\"140\" y=\"648\">surface.surfaceApp.buildInfo ·</text>\n  <text class=\"sam-app-sub sam-mono\" x=\"140\" y=\"664\">surface.surfaceApp.identity.info</text>\n\n  <!-- w2 — admin keys ride the same wire (amber) -->\n  <rect class=\"sam-adm-key\" x=\"540\" y=\"630\" width=\"328\" height=\"40\" rx=\"20\"/>\n  <text class=\"sam-adm-tag\" x=\"556\" y=\"654\">w2</text>\n  <text class=\"sam-adm-sub sam-mono\" x=\"588\" y=\"656\">surface.admin.hosts…</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/surface-app.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		hr: "hr",
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
			"A library for a specific class of ",
			createVNode(_components.a, {
				href: "https://kolu.dev/blog/surface-framework/",
				children: "@kolu/surface"
			}),
			" app: the ones that are really ",
			createVNode(_components.strong, { children: "desktop applications you run against your own server" }),
			" (kolu, ",
			createVNode(_components.a, {
				href: "https://github.com/srid/drishti",
				children: "drishti"
			}),
			", the next one). Where surface is the live reactive ",
			createVNode(_components.em, { children: "wire" }),
			", surface-app is the ",
			createVNode(_components.em, { children: "app shell" }),
			" around it — delivered fresh, installed like a desktop app, and always aware of its relationship to the server it’s bound to."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Status: ",
			createVNode($$Pill, {
				variant: "done",
				children: "implemented"
			}),
			" · shipped in kolu ",
			createVNode($$PrLink, { pr: 1154 }),
			" (",
			createVNode(_components.code, { children: "packages/surface-app" }),
			") · adopted by drishti (",
			createVNode(_components.a, {
				href: "https://github.com/srid/drishti/pull/47",
				children: "srid/drishti#47"
			}),
			") · renamed from surface-pwa."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			children: createVNode(_components.p, { children: [
				"A self-hosted, always-connected app must guarantee that a ",
				createVNode(_components.strong, { children: "returning client converges to the build you deployed" }),
				", and must keep the user oriented to ",
				createVNode(_components.strong, { children: "which server it’s bound to and whether it’s still in step with it" }),
				" — visibly, and one-tap recoverable. surface-app owns that so the app never re-derives it."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "what-it-is",
			children: "What it is"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "the-class-of-app-it-serves",
			children: "The class of app it serves"
		}),
		"\n",
		createVNode(_components.p, { children: "This is not a library for “any web app that can be installed.” It’s for a specific, recognizable shape — the one kolu and drishti share:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "You run the server." }),
				" Your machine, your homelab, your tailnet — not a CDN, not multi-tenant SaaS. Identity is per named host (",
				createVNode(_components.code, { children: "Kolu [host]" }),
				", drishti’s per-host tabs)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Always-connected." }),
				" The live WebSocket ",
				createVNode(_components.em, { children: "is" }),
				" the app; there is no meaningful offline mode. This is why there’s no caching service worker — not as an opinion, but by nature."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Desktop-class." }), " Installed, long-lived, feels native — an app window, not a browser tab you re-find."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "You’re usually the deployer." }),
				" You redeploy your own server often, so a long-lived installed client going stale against a just-deployed server is the ",
				createVNode(_components.em, { children: "defining" }),
				" pain — the four-times-relitigated bug (",
				createVNode($$PrLink, { pr: 696 }),
				", ",
				createVNode($$PrLink, { pr: 1125 }),
				", ",
				createVNode($$PrLink, { pr: 1135 }),
				", ",
				createVNode($$PrLink, { pr: 1149 }),
				")."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"That class is almost the opposite of a generic PWA (public, multi-tenant, CDN-served, offline-capable, SEO-shaped) — which is why “pwa” was the wrong word and the name is now ",
			createVNode(_components.strong, { children: "surface-app" }),
			"."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Layer" }),
					"\n",
					createVNode(_components.th, { children: "What it owns" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "@kolu/surface — the wire" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"The Cell / Collection / Stream / Event / Procedure lattice. How ",
						createVNode(_components.em, { children: "data" }),
						" reaches the app."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "@kolu/surface-app — the app shell" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Fresh delivery · server identity · connection & update lifecycle · desktop install. How the ",
						createVNode(_components.em, { children: "app itself" }),
						" reaches the user and stays in step with the server."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-unifying-insight",
			children: "The unifying insight"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			children: createVNode(_components.p, { children: [
				"For this class, ",
				createVNode(_components.strong, { children: "build-skew, connection status, and server identity are one question" }),
				": ",
				createVNode(_components.em, { children: "“what is my relationship to the server I’m bound to, right now?”" }),
				" A generic PWA library treats freshness as a caching detail. surface-app treats it as a facet of the app’s identity — and that’s why delivery, the ",
				createVNode(_components.code, { children: "≠ srv" }),
				" signal, the reconnecting overlay, and the per-host name all belong to one shell."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-contract",
			children: "The contract"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "five-invariants",
			children: "Five invariants"
		}),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "#1 is load-bearing" }), "; the rest are graceful degradation."] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "One mutable entry point; everything else immutable." }),
				" The shell (",
				createVNode(_components.code, { children: "index.html" }),
				") is the ",
				createVNode(_components.em, { children: "only" }),
				" never-cached resource (",
				createVNode(_components.code, { children: "Cache-Control: no-store" }),
				"); every content-hashed asset is ",
				createVNode(_components.code, { children: "immutable" }),
				"; a missing ",
				createVNode(_components.code, { children: "/assets/*" }),
				" hash ",
				createVNode(_components.strong, { children: "404" }),
				"s rather than falling through to the shell. The one document that names the bundle is always re-fetched, so staleness is ",
				createVNode(_components.em, { children: "structurally impossible" }),
				". (",
				createVNode(_components.code, { children: "immutable" }),
				" presumes content-hashed names; unhashed shell assets stay ",
				createVNode(_components.code, { children: "no-cache" }),
				".)"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Build identity is first-class and single-sourced — and rides the shell, never a hashed asset." }),
				" Client and server stamp the ",
				createVNode(_components.em, { children: "same" }),
				" commit; the server exposes it. Bundler-agnostic: server reads ",
				createVNode(_components.code, { children: "SURFACE_APP_COMMIT" }),
				" from env; the client commit rides the ",
				createVNode(_components.code, { children: "no-store" }),
				" shell as ",
				createVNode(_components.code, { children: "window.__SURFACE_APP_COMMIT__" }),
				" (injected by the ",
				createVNode(_components.code, { children: "surfaceApp()" }),
				" Vite plugin or ",
				createVNode(_components.code, { children: "buildSurfaceClient" }),
				" for Bun, and read via ",
				createVNode(_components.code, { children: "shellCommit()" }),
				") — ",
				createVNode(_components.em, { children: "never" }),
				" a bundler define baked into a content-hashed ",
				createVNode(_components.code, { children: "/assets/*" }),
				" file. A define would pin the sha inside a year-",
				createVNode(_components.code, { children: "immutable" }),
				" bundle whose ",
				createVNode(_components.em, { children: "name" }),
				" doesn’t change on a stamp-only deploy, so the rewritten bytes never re-fetch and every returning browser stays stuck on the old stamp, looping the update prompt forever (the bug fixed in ",
				createVNode($$PrLink, { pr: 1324 }),
				"); the always-fresh shell carries identity instead. The env-var ",
				createVNode(_components.em, { children: "name" }),
				" and the flake-rev resolution are single-sourced for nix consumers in ",
				createVNode(_components.code, { children: "nix/commit-stamp.nix" }),
				" (kept equal to ",
				createVNode(_components.code, { children: "resolveCommit" }),
				"’s ",
				createVNode(_components.code, { children: "DEFAULT_COMMIT_ENV_VAR" }),
				"), so a nix-built client and the server wrapper stamp from the same var — no hardcoded literal downstream."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Skew is visible and recoverable, on every form factor." }),
				" When client ≠ server, a ",
				createVNode(_components.em, { children: "durable" }),
				" indicator shows and a reload that lands fresh is one tap away — desktop rail ",
				createVNode(_components.em, { children: "and" }),
				" mobile."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A service worker is an opt-in you own end-to-end — or, for this class, none." }),
				" A SW intercepts navigations ",
				createVNode(_components.em, { children: "in front of" }),
				" the network, so the cache contract (#1) can’t reach it; gate on ",
				createVNode(_components.code, { children: "window.isSecureContext" }),
				", never ",
				createVNode(_components.code, { children: "location.protocol === \"https:\"" }),
				". An always-connected app has no offline mode, so surface-app ships no caching worker and actively retires any it finds; the one opt-in is a fetch-less notification worker (",
				createVNode(_components.code, { children: "installFreshStatic({ serviceWorker: \"notify\" })" }),
				" + ",
				createVNode(_components.code, { children: "registerServiceWorker()" }),
				", ",
				createVNode($$PrLink, { pr: 1216 }),
				") that registers no fetch handler, so the cache contract (#1) never sees it — kolu opts in for OS notifications."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The client always knows its relationship to the server it’s bound to." }),
				" Which host, which build, and the live status (connected / reconnecting / server-restarted / stale-build) are first-class — surfaced as a ",
				createVNode(_components.em, { children: "model" }),
				" the app renders. This is the invariant that makes surface-app an ",
				createVNode(_components.em, { children: "app shell" }),
				", not just a cache policy."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The old triage rule (",
			createVNode(_components.em, { children: "normal reload stale, hard reload fresh → a cached shell or a service worker; confirm in the browser, not by reasoning about the origin" }),
			") is a debugging heuristic, not an encoded invariant — it lives in the library’s README review checklist."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-app-shells-parts",
			children: "The app shell’s parts"
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Fresh delivery" }),
				" — cache policy (no-store shell · immutable hashed assets · no-cache ",
				createVNode(_components.code, { children: "sw.js" }),
				" · 404 asset-miss) + static-serve + SPA fallback."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Server & build identity" }),
				" — which host + which build the client is bound to; per-host name/theme; the ",
				createVNode(_components.code, { children: "buildInfo" }),
				" cell (extensible interface)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Connection & update lifecycle" }),
				" — surface-app ",
				createVNode(_components.em, { children: "derives" }),
				" the lifecycle (",
				createVNode(_components.code, { children: "connecting → connected → disconnected → reconnected / restarted" }),
				", + ",
				createVNode(_components.code, { children: "stale-build" }),
				") from the WebSocket transport’s open/close plus a server-identity probe (",
				createVNode(_components.code, { children: "processId" }),
				" tells a transient drop from a restart) — lifting kolu’s generic ",
				createVNode(_components.code, { children: "rpc.ts" }),
				" wholesale, so ",
				createVNode(_components.strong, { children: "kolu deletes its lifecycle layer and drishti gets the WS indicator for free" }),
				". The app passes the ",
				createVNode(_components.code, { children: "ws" }),
				" handle and renders its own chrome from the model — the ",
				createVNode(_components.strong, { children: "instant" }),
				" header dot from ",
				createVNode(_components.code, { children: "useSurfaceApp().status()" }),
				", but the ",
				createVNode(_components.strong, { children: "full-screen “Disconnected” overlay" }),
				" from the grace-windowed ",
				createVNode(_components.code, { children: "presentingDown()" }),
				" (",
				createVNode(_components.code, { children: "status() === \"down\"" }),
				" held back ~1s so a sub-second forced reconnect — the half-open watchdog recovering, a Wi-Fi roam — never flashes the alarm, while a sustained outage still surfaces) — no hand-wired connection state. (Commit (skew) and processId (restart) stay distinct axes — ",
				createVNode(_components.code, { children: "buildInfo" }),
				" is commit-only; the restart probe is its own.) Since ",
				createVNode($$PrLink, { pr: 1231 }),
				" the server also gates the WS handshake by processId (",
				createVNode(_components.code, { children: "rejectStaleProcess" }),
				" / ",
				createVNode(_components.code, { children: "STALE_PROCESS_CLOSE_CODE" }),
				"), so a stale tab is told to reload instead of storm-reconnecting."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Desktop install & feel" }),
				" — the manifest as ",
				createVNode(_components.em, { children: "app-window identity" }),
				" (per-host name/theme/icons) and an attention model that fans out to App Badging (installed Chromium, Win/macOS) → document title (",
				createVNode(_components.code, { children: "setAttention(n)" }),
				", best-effort, degrades per browser). Install state now ships in the model — ",
				createVNode(_components.code, { children: "isInstalled" }),
				" / ",
				createVNode(_components.code, { children: "canInstallPwa" }),
				" on ",
				createVNode(_components.code, { children: "SurfaceAppModel" }),
				" (",
				createVNode($$PrLink, { pr: 1199 }),
				"); the one-click prompt UI lives in ",
				createVNode(_components.code, { children: "@kolu/solid-pwa-install" }),
				". A canvas favicon remains a documented future affordance. (Badging needs a trusted secure context; the core works without — see below.)"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Service-worker stance" }),
				" — never ship a ",
				createVNode(_components.em, { children: "caching" }),
				" worker; retire legacy ones (",
				createVNode(_components.code, { children: "retireServiceWorker()" }),
				" + self-destructing ",
				createVNode(_components.code, { children: "sw.js" }),
				", the default), or opt into the fetch-less notification worker (",
				createVNode(_components.code, { children: "serviceWorker: \"notify\"" }),
				" + ",
				createVNode(_components.code, { children: "registerServiceWorker()" }),
				", ",
				createVNode($$PrLink, { pr: 1216 }),
				") for OS notifications."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Commit propagation" }),
				" — one resolver (",
				createVNode(_components.code, { children: "SURFACE_APP_COMMIT" }),
				" env → ",
				createVNode(_components.code, { children: "git rev-parse --short HEAD" }),
				" → ",
				createVNode(_components.code, { children: "\"dev\"" }),
				") feeding a Vite plugin (which injects the commit onto the ",
				createVNode(_components.code, { children: "no-store" }),
				" shell as ",
				createVNode(_components.code, { children: "window.__SURFACE_APP_COMMIT__" }),
				", plus its type declaration) and the server cell. The client reads it via ",
				createVNode(_components.code, { children: "shellCommit()" }),
				"; it is never a bundler define in a hashed asset (see invariant #2). No app ever writes a sha literal."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "secure-context-for-the-desktop-layer-https",
			children: "Secure context for the desktop layer (HTTPS)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Two layers, two requirements. The ",
			createVNode(_components.strong, { children: "freshness core" }),
			" (delivery, skew over the wire, reload) works on plain HTTP and ",
			createVNode(_components.code, { children: "ws://" }),
			" — no secure context needed, so kolu on a plain-HTTP LAN keeps working. The ",
			createVNode(_components.strong, { children: "desktop-feel layer" }),
			" (install, Badging) is gated on ",
			createVNode(_components.code, { children: "window.isSecureContext" }),
			", which a self-hosted app reached by bare hostname or private/tailnet IP over plain HTTP does ",
			createVNode(_components.em, { children: "not" }),
			" have. The confirmed facts (citations in ",
			createVNode(_components.a, {
				href: "../../cache-bug.md",
				children: "cache-bug.md"
			}),
			"):"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Install no longer needs a service worker" }), " — Chrome dropped that requirement (108 mobile / 112 desktop); a valid manifest over a secure context is installable. So invariant #4 (ship no SW) and “be installable” don’t conflict."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "…but the in-page Install button is best-effort." }),
				" Chrome’s automatic ",
				createVNode(_components.code, { children: "beforeinstallprompt" }),
				" still references a fetch handler, so without a SW it may not fire. ",
				createVNode(_components.em, { children: "Manual" }),
				" install (browser menu / address-bar icon) always works. → wire the prompt as progressive enhancement, detect already-installed via ",
				createVNode(_components.code, { children: "display-mode: standalone" }),
				" (+ iOS ",
				createVNode(_components.code, { children: "navigator.standalone" }),
				"), and fall back to “install from your browser menu” / iOS “Add to Home Screen” copy. Chromium-only; Safari/Firefox degrade."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "localhost" }), " is exempt"] }),
				" (",
				createVNode(_components.code, { children: "localhost" }),
				" / ",
				createVNode(_components.code, { children: "127.0.0.1" }),
				" / ",
				createVNode(_components.code, { children: "*.localhost" }),
				", port-independent) — local dev just works. LAN IPs and bare hostnames over HTTP are not secure contexts."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"So the desktop layer needs a ",
			createVNode(_components.em, { children: "trusted" }),
			" HTTPS origin. The recommended paths:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Path" }),
					"\n",
					createVNode(_components.th, { children: "Trusted, no warning?" }),
					"\n",
					createVNode(_components.th, { children: "Per-device setup" }),
					"\n",
					createVNode(_components.th, { children: "Auto-renew" }),
					"\n",
					createVNode(_components.th, { children: "Best for" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "tailscale serve" }) }),
					"\n",
					createVNode(_components.td, { children: ["✓ — real LE cert on ", createVNode(_components.code, { children: "*.ts.net" })] }),
					"\n",
					createVNode(_components.td, { children: "none (every tailnet device)" }),
					"\n",
					createVNode(_components.td, { children: "✓" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "recommended (tailnet)"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "mkcert / local CA" }) }),
					"\n",
					createVNode(_components.td, { children: "✓ where the CA is installed" }),
					"\n",
					createVNode(_components.td, { children: "per device" }),
					"\n",
					createVNode(_components.td, { children: "n/a (~825d)" }),
					"\n",
					createVNode(_components.td, { children: "single LAN device" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: ["Caddy ", createVNode(_components.code, { children: "tls internal" })] }) }),
					"\n",
					createVNode(_components.td, { children: "✓ where the CA is installed" }),
					"\n",
					createVNode(_components.td, { children: "per device" }),
					"\n",
					createVNode(_components.td, { children: "✓" }),
					"\n",
					createVNode(_components.td, { children: "multi-service LAN" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: [
						"self-signed (",
						createVNode(_components.code, { children: "@kolu/dev-tls" }),
						")"
					] }) }),
					"\n",
					createVNode(_components.td, { children: "✗ — warns (click-through)" }),
					"\n",
					createVNode(_components.td, { children: "per device, every time" }),
					"\n",
					createVNode(_components.td, { children: "at startup" }),
					"\n",
					createVNode(_components.td, { children: "localhost dev only" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Decisions:" }),
			" (1) surface-app does ",
			createVNode(_components.em, { children: "not" }),
			" provide TLS — cert acquisition is a different volatility (deployment/infra), so it stays out. surface-app feature-detects ",
			createVNode(_components.code, { children: "isSecureContext" }),
			" and, when the desktop layer is unavailable, surfaces an ",
			createVNode(_components.em, { children: "actionable hint" }),
			" (not a hard block — the core still works): “reachable, but install/badge need HTTPS — try ",
			createVNode(_components.code, { children: "tailscale serve" }),
			".” (2) kolu’s existing self-signed generator (",
			createVNode(_components.code, { children: "packages/server/src/tls.ts" }),
			", the ",
			createVNode(_components.code, { children: "selfsigned" }),
			" package) is to be extracted into a tiny optional ",
			createVNode(_components.code, { children: "@kolu/dev-tls" }),
			" for the localhost/dev escape hatch only — a deferred follow-up. (3) The trusted recipes are documented, not implemented. This also closes the saga loop: a real cert via ",
			createVNode(_components.code, { children: "tailscale serve" }),
			" gives a genuine secure context — removing any reason for the Chrome insecure-origin flag that orphaned the service worker in the first place."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-pieces",
			children: "The pieces"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Piece" }),
					"\n",
					createVNode(_components.th, { children: "The question it answers" }),
					"\n",
					createVNode(_components.th, { children: "Entrypoint" }),
					"\n",
					createVNode(_components.th, { children: "Inv." }),
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
						createVNode(_components.code, { children: "installSurfaceApp" }),
						" · ",
						createVNode(_components.code, { children: "installFreshStatic" }),
						" · ",
						createVNode(_components.code, { children: "installPwaManifest" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"“Serve the SPA fresh, the manifest, AND ",
						createVNode(_components.code, { children: "/sw.js" }),
						" (retirement, or the opt-in fetch-less notification worker via ",
						createVNode(_components.code, { children: "serviceWorker: \"notify\"" }),
						") — one composed call.”"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "/server"
					}) }),
					"\n",
					createVNode(_components.td, { children: "#1,2,4" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "buildInfoServer()" }),
						" · ",
						createVNode(_components.code, { children: "surfaceAppServer()" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"“The buildInfo cell’s server impl (+ the ",
						createVNode(_components.code, { children: "identity.info" }),
						" probe impl) — the deps bundle for the surface-app sibling entry in ",
						createVNode(_components.code, { children: "implementSurfaces" }),
						"; commit auto-resolved.”"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "/server"
					}) }),
					"\n",
					createVNode(_components.td, { children: "#2,5" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "surfaceAppSurface" }),
						" · ",
						createVNode(_components.code, { children: "surfaceAppSurfaceWith" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"“surface-app’s complete standalone surface (buildInfo cell + ",
						createVNode(_components.code, { children: "identity.info" }),
						" probe) — served as a sibling via ",
						createVNode(_components.code, { children: "implementSurfaces" }),
						" / ",
						createVNode(_components.code, { children: "surfaceClients" }),
						" / ",
						createVNode(_components.code, { children: "composeSurfaceContracts" }),
						".”"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "dx",
						children: "/surface"
					}) }),
					"\n",
					createVNode(_components.td, { children: "#2,5" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "buildInfo" }),
						" · ",
						createVNode(_components.code, { children: "defineBuildInfo" })
					] }),
					"\n",
					createVNode(_components.td, { children: "“The buildInfo cell definition — composed into the surface-app surface; extensible.”" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "dx",
						children: "/surface"
					}) }),
					"\n",
					createVNode(_components.td, { children: "#2,5" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "useSurfaceApp()" }),
						" · ",
						createVNode(_components.code, { children: "SurfaceAppProvider" }),
						" · ",
						createVNode(_components.code, { children: "retireServiceWorker()" })
					] }),
					"\n",
					createVNode(_components.td, { children: "“The headless model (status/presentingDown/stale/server/reload/setAttention) + SW retirement. You render the UI.”" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "/solid"
					}) }),
					"\n",
					createVNode(_components.td, { children: "#3,4,5" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "surfaceApp()" }),
						" vite plugin · ",
						createVNode(_components.code, { children: "buildSurfaceClient()" }),
						" · ",
						createVNode(_components.code, { children: "resolveCommit()" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"“Build the client fresh: content-hashed ",
						createVNode(_components.code, { children: "/assets/*" }),
						", the commit injected onto the no-store shell as ",
						createVNode(_components.code, { children: "window.__SURFACE_APP_COMMIT__" }),
						" (read via ",
						createVNode(_components.code, { children: "shellCommit()" }),
						", never a hashed-asset define), the no-store shell rewrite — Vite plugin or Bun helper. Resolve the commit once (env→git→dev).”"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "/vite · /bun"
					}) }),
					"\n",
					createVNode(_components.td, { children: "#1,2" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "cacheControlFor" }),
						" · ",
						createVNode(_components.code, { children: "clientIsStale" }),
						" · ",
						createVNode(_components.code, { children: "SW_SOURCE" })
					] }),
					"\n",
					createVNode(_components.td, { children: "“The pure, framework-free kernels.”" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "utils/"
					}) }),
					"\n",
					createVNode(_components.td, { children: "#1,2" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Historical: ‘The design’ + ‘The API’ below describe the merge-era seams — now removed",
			children: createVNode(_components.p, { children: [
				"The next two sections (",
				createVNode(_components.strong, { children: "The design" }),
				", ",
				createVNode(_components.strong, { children: "The API" }),
				") document the original\n",
				createVNode(_components.strong, { children: "merge" }),
				" approach — ",
				createVNode(_components.code, { children: "composeSurfaces" }),
				", ",
				createVNode(_components.code, { children: "surfaceAppServer" }),
				" + ",
				createVNode(_components.code, { children: "implementSurfaceApp" }),
				",\nthe dup-key throw, the app-visible ",
				createVNode(_components.code, { children: "connect" }),
				", and the old ",
				createVNode(_components.code, { children: "surfaceApp.info" }),
				"\nprobe path. That approach is ",
				createVNode(_components.strong, { children: "gone" }),
				". surface-app is now served as a ",
				createVNode(_components.em, { children: "sibling" }),
				"\nsurface (",
				createVNode(_components.code, { children: "implementSurfaces" }),
				" / ",
				createVNode(_components.code, { children: "surfaceClients" }),
				" / ",
				createVNode(_components.code, { children: "composeSurfaceContracts" }),
				",\nprobe at ",
				createVNode(_components.code, { children: "identity.info" }),
				") — see ",
				createVNode(_components.a, {
					href: "#composing-surfaces--multiple-surfaces-one-transport",
					children: "Composing surfaces"
				}),
				",\nwhich is ",
				createVNode(_components.strong, { children: "implemented" }),
				" and is the current API of record. The merge-era prose\nis kept below only as design history."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-design-historical-merge-era",
			children: ["The design ", createVNode($$Pill, {
				variant: "run",
				children: "historical (merge era)"
			})]
		}),
		"\n",
		createVNode(_components.h3, {
			id: "the-headless-model",
			children: "The headless model"
		}),
		"\n",
		createVNode(_components.p, { children: "Everything the app shell knows about its server is one hook; the app renders whatever chrome it wants from it. The library provides the model, the apps (kolu, drishti) define the UI — a future PR may consolidate the UI back into surface-app if a shared shape proves out." }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> app</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> useSurfaceApp</span><span style=\"color:#24292E\">();   </span><span style=\"color:#6A737D\">// the relationship to the server you're bound to:</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">app.</span><span style=\"color:#6F42C1\">status</span><span style=\"color:#24292E\">()        </span><span style=\"color:#6A737D\">// \"live\" | \"reconnecting\" | \"restarted\" | \"down\"</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">app.</span><span style=\"color:#6F42C1\">stale</span><span style=\"color:#24292E\">()         </span><span style=\"color:#6A737D\">// boolean — running bundle is behind the server's build</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">app.</span><span style=\"color:#6F42C1\">server</span><span style=\"color:#24292E\">()        </span><span style=\"color:#6A737D\">// T | undefined — what am I bound to (default { commit }; kolu extends)</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">app.clientCommit    </span><span style=\"color:#6A737D\">// string — this bundle's baked-in commit</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">app.</span><span style=\"color:#6F42C1\">reload</span><span style=\"color:#24292E\">()        </span><span style=\"color:#6A737D\">// land the deployed build</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">app.</span><span style=\"color:#6F42C1\">setAttention</span><span style=\"color:#24292E\">(n) </span><span style=\"color:#6A737D\">// OS app badge if installed (best-effort) + document.title — degrades per browser</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"Build-skew is one ",
			createVNode(_components.code, { children: "status" }),
			" among connection states — the insight made concrete. ",
			createVNode(_components.code, { children: "status()" }),
			" is ",
			createVNode(_components.strong, { children: "derived by the library" }),
			" from the ",
			createVNode(_components.code, { children: "ws" }),
			" handle (open/close) + a ",
			createVNode(_components.code, { children: "processId" }),
			" probe (reconnected vs restarted) — this is kolu’s ",
			createVNode(_components.code, { children: "rpc.ts" }),
			" lifecycle, encapsulated, so the WS indicator + dim overlay that kolu renders today drop straight into drishti. The shape is extensible: kolu’s ",
			createVNode(_components.code, { children: "server()" }),
			" also carries pty-host info (its second staleness axis); drishti’s is just ",
			createVNode(_components.code, { children: "{ host, commit, name }" }),
			". As shipped, ",
			createVNode(_components.code, { children: "createServerLifecycle({ ws, probe })" }),
			" derives it in-library; the example proves it end-to-end — ",
			createVNode(_components.code, { children: "live → down → restarted" }),
			" on a real server restart."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "build-identity-is-an-interface",
			children: "Build identity is an interface"
		}),
		"\n",
		createVNode(_components.p, { children: "What “the build” means is the one thing apps vary. Default is the commit; kolu adds a pty-host axis; the staleness predicate is part of the interface. Apps extend rather than fork:" }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// default — drishti uses exactly this</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">export</span><span style=\"color:#D73A49\"> const</span><span style=\"color:#005CC5\"> buildInfo</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> defineBuildInfo</span><span style=\"color:#24292E\">({</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  schema: z.</span><span style=\"color:#6F42C1\">object</span><span style=\"color:#24292E\">({ commit: z.</span><span style=\"color:#6F42C1\">string</span><span style=\"color:#24292E\">() }),</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  isStale</span><span style=\"color:#24292E\">: (</span><span style=\"color:#E36209\">srv</span><span style=\"color:#24292E\">, </span><span style=\"color:#E36209\">cli</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> clientIsStale</span><span style=\"color:#24292E\">(srv.commit, cli.commit),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// kolu extends — adds the pty-host axis without losing the commit one</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">defineBuildInfo</span><span style=\"color:#24292E\">({ schema: z.</span><span style=\"color:#6F42C1\">object</span><span style=\"color:#24292E\">({ commit: z.</span><span style=\"color:#6F42C1\">string</span><span style=\"color:#24292E\">(), ptyHost: PtyHostRefSchema }),</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  isStale</span><span style=\"color:#24292E\">: (</span><span style=\"color:#E36209\">srv</span><span style=\"color:#24292E\">, </span><span style=\"color:#E36209\">cli</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> clientIsStale</span><span style=\"color:#24292E\">(srv.commit, cli.commit) </span><span style=\"color:#D73A49\">||</span><span style=\"color:#6F42C1\"> ptyHostDiverged</span><span style=\"color:#24292E\">(srv.ptyHost, cli.ptyHost) });</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"The matching ",
			createVNode(_components.em, { children: "server impl" }),
			" is a fragment too: ",
			createVNode(_components.code, { children: "buildInfoServer()" }),
			" (commit auto-resolved) spreads into ",
			createVNode(_components.code, { children: "implementSurface" }),
			"; kolu passes its pty-host source. Definition ⊕ impl are ",
			createVNode(_components.em, { children: "composed" }),
			", never hand-written in the app."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "compose-dont-hand-wire",
			children: "Compose, don’t hand-wire"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The spike’s failing — fairly called out in review — was making the ",
			createVNode(_components.em, { children: "example" }),
			" re-implement what the ",
			createVNode(_components.em, { children: "library" }),
			" should own: a hand-written ",
			createVNode(_components.code, { children: "buildInfo" }),
			" store, a hand-rolled ",
			createVNode(_components.code, { children: "/sw.js" }),
			" route, a hardcoded commit string, a per-app ",
			createVNode(_components.code, { children: "__SURFACE_APP_COMMIT__" }),
			" define and its type. The fix is the principle surface itself follows: the library ships ",
			createVNode(_components.strong, { children: "fragments" }),
			", an app is their ",
			createVNode(_components.strong, { children: "composition" }),
			", and there is ",
			createVNode(_components.strong, { children: "no bespoke glue" }),
			". Build identity is one concept with composable faces the app stitches together — never re-derives:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Face" }),
					"\n",
					createVNode(_components.th, { children: "Library fragment" }),
					"\n",
					createVNode(_components.th, { children: "App composes…" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "definition" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "buildInfo" }), " (cell schema)"] }),
					"\n",
					createVNode(_components.td, { children: ["into ", createVNode(_components.code, { children: "defineSurface" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "restart probe" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "serverIdentity" }),
						" (procedure, ",
						createVNode(_components.code, { children: "surfaceApp.info" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: ["into ", createVNode(_components.code, { children: "defineSurface" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "surface merge" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "surfaceAppSurface" }),
						" / ",
						createVNode(_components.code, { children: "surfaceAppSurfaceWith" }),
						" + ",
						createVNode(_components.code, { children: "composeSurfaces" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "one" }),
						" merge of cell + probe into ",
						createVNode(_components.code, { children: "defineSurface" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "server impl" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "surfaceAppServer()" }),
						" + ",
						createVNode(_components.code, { children: "implementSurfaceApp()" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "one" }),
						" call (owns ",
						createVNode(_components.code, { children: "buildInfo.connect" }),
						")"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "client model" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "useSurfaceApp()" }) }),
					"\n",
					createVNode(_components.td, { children: ["under ", createVNode(_components.code, { children: "<SurfaceAppProvider>" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "client build + commit" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "surfaceApp()" }),
						" Vite plugin · ",
						createVNode(_components.code, { children: "buildSurfaceClient()" }),
						" (Bun) · ",
						createVNode(_components.code, { children: "resolveCommit()" })
					] }),
					"\n",
					createVNode(_components.td, { children: "into the client build & server boot" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "nix commit stamp" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "nix/commit-stamp.nix" }),
						" (",
						createVNode(_components.code, { children: "envVar" }),
						" · ",
						createVNode(_components.code, { children: "revFromSelf" }),
						" · ",
						createVNode(_components.code, { children: "exportLine" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: "into the flake / derivation / server wrapper" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"And the commit is ",
			createVNode(_components.strong, { children: "resolved once" }),
			" — ",
			createVNode(_components.code, { children: "SURFACE_APP_COMMIT" }),
			" env, else ",
			createVNode(_components.code, { children: "git rev-parse --short HEAD" }),
			", else ",
			createVNode(_components.code, { children: "\"dev\"" }),
			" (which ",
			createVNode(_components.code, { children: "clientIsStale" }),
			" already treats as never-stale) — then fed to both the client define and the server cell. No app writes a sha."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "danger",
			title: "✗ the spike — the example re-implemented the library's job (what review flagged)",
			children: createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// server — a hand-written cell store, and a hand-rolled /sw.js route</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">cells</span><span style=\"color:#24292E\">: { </span><span style=\"color:#6F42C1\">buildInfo</span><span style=\"color:#24292E\">: { </span><span style=\"color:#6F42C1\">store</span><span style=\"color:#24292E\">: { </span><span style=\"color:#6F42C1\">get</span><span style=\"color:#24292E\">: () </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> ({ commit: </span><span style=\"color:#005CC5\">SERVER_COMMIT</span><span style=\"color:#24292E\"> }), </span><span style=\"color:#6F42C1\">set</span><span style=\"color:#24292E\">() {} } } }</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">app.</span><span style=\"color:#6F42C1\">get</span><span style=\"color:#24292E\">(</span><span style=\"color:#032F62\">\"/sw.js\"</span><span style=\"color:#24292E\">, (</span><span style=\"color:#E36209\">c</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> c.</span><span style=\"color:#6F42C1\">body</span><span style=\"color:#24292E\">(</span><span style=\"color:#005CC5\">SW_SOURCE</span><span style=\"color:#24292E\">, </span><span style=\"color:#005CC5\">200</span><span style=\"color:#24292E\">, { </span><span style=\"color:#032F62\">\"content-type\"</span><span style=\"color:#24292E\">: </span><span style=\"color:#032F62\">\"text/javascript\"</span><span style=\"color:#24292E\"> }));</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// vite.config — a sha literal (!) and a per-app define</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> clientCommit</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> process.env.</span><span style=\"color:#005CC5\">CLIENT_COMMIT</span><span style=\"color:#D73A49\"> ||</span><span style=\"color:#032F62\"> \"c11e7700\"</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">define</span><span style=\"color:#24292E\">: { </span><span style=\"color:#6F42C1\">__SURFACE_APP_COMMIT__</span><span style=\"color:#24292E\">: </span><span style=\"color:#005CC5\">JSON</span><span style=\"color:#24292E\">.</span><span style=\"color:#6F42C1\">stringify</span><span style=\"color:#24292E\">(clientCommit) }</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// env.d.ts — the global's type, redeclared per app</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">declare</span><span style=\"color:#D73A49\"> const</span><span style=\"color:#005CC5\"> __SURFACE_APP_COMMIT__</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> string</span><span style=\"color:#24292E\">;</span></span></code></pre>" })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "✓ composed — the app stitches fragments and owns none of it",
			children: createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// surface — ONE merge: the buildInfo cell + the surfaceApp.info probe + your own spec</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> surface</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> defineSurface</span><span style=\"color:#24292E\">(</span><span style=\"color:#6F42C1\">composeSurfaces</span><span style=\"color:#24292E\">(surfaceAppSurface, { cells: {</span><span style=\"color:#6A737D\">/* yours */</span><span style=\"color:#24292E\">}, procedures: {</span><span style=\"color:#6A737D\">/* yours */</span><span style=\"color:#24292E\">} }));</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// server — ONE call: merges the surface-app impls, runs implementSurface, flows buildInfo.connect; then serve shell + manifest + /sw.js</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#24292E\"> { </span><span style=\"color:#005CC5\">router</span><span style=\"color:#24292E\">, </span><span style=\"color:#005CC5\">ctx</span><span style=\"color:#24292E\"> } </span><span style=\"color:#D73A49\">=</span><span style=\"color:#6F42C1\"> implementSurfaceApp</span><span style=\"color:#24292E\">(surface, </span><span style=\"color:#6F42C1\">surfaceAppServer</span><span style=\"color:#24292E\">(), { channel, cells: {</span><span style=\"color:#6A737D\">/* yours */</span><span style=\"color:#24292E\">}, procedures: {</span><span style=\"color:#6A737D\">/* yours */</span><span style=\"color:#24292E\">} });</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">installSurfaceApp</span><span style=\"color:#24292E\">(app, { clientDist, manifest });</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// vite.config — one plugin resolves the commit (git/env), injects the define, ships its type</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">plugins</span><span style=\"color:#24292E\">: [</span><span style=\"color:#6F42C1\">solid</span><span style=\"color:#24292E\">(), </span><span style=\"color:#6F42C1\">surfaceApp</span><span style=\"color:#24292E\">()]</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// env.d.ts — deleted. no define, no sha literal, no hand-rolled routes, no hand-spread fragments.</span></span></code></pre>" })
		}),
		"\n",
		createVNode(_components.p, { children: "Every removed line was the app doing the library’s job; every surviving line composes a fragment. That’s the whole principle." }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The composition seams are a stopgap for the merge",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "composeSurfaces" }),
				", ",
				createVNode(_components.code, { children: "surfaceAppServer" }),
				" + ",
				createVNode(_components.code, { children: "implementSurfaceApp" }),
				", the dup-key throw, and the app-visible ",
				createVNode(_components.code, { children: "connect" }),
				" all exist because surface-app is ",
				createVNode(_components.strong, { children: "merged into" }),
				" the app’s one surface — and its ",
				createVNode(_components.code, { children: "buildInfo" }),
				" cell (flat) + ",
				createVNode(_components.code, { children: "surfaceApp.info" }),
				" probe (two-level) don’t merge as one unit. The fix isn’t to make merging smarter; it’s to ",
				createVNode(_components.strong, { children: "stop merging" }),
				": surface-app is already a complete surface, so serve it as a ",
				createVNode(_components.strong, { children: "sibling" }),
				", not a fragment to splice in. That dissolves all four seams with ",
				createVNode(_components.em, { children: "no" }),
				" change to ",
				createVNode(_components.code, { children: "SurfaceSpec" }),
				". ",
				createVNode(_components.strong, { children: [
					"This is now the plan of record — see ",
					createVNode(_components.a, {
						href: "#composing-surfaces--multiple-surfaces-one-transport",
						children: "Composing surfaces"
					}),
					" below."
				] })
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-api-historical-merge-era",
			children: ["The API ", createVNode($$Pill, {
				variant: "run",
				children: "historical (merge era)"
			})]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"One package, sub-path entrypoints mirroring @kolu/surface’s ",
			createVNode(_components.code, { children: "exports" }),
			" map. Pure kernels under ",
			createVNode(_components.code, { children: "utils/" }),
			". The ",
			createVNode(_components.code, { children: "composeSurfaces" }),
			" / ",
			createVNode(_components.code, { children: "implementSurfaceApp" }),
			" / ",
			createVNode(_components.code, { children: "surfaceApp.info" }),
			" snippets in this section are the ",
			createVNode(_components.strong, { children: "superseded merge API" }),
			" — the current sibling API is in ",
			createVNode(_components.a, {
				href: "#composing-surfaces--multiple-surfaces-one-transport",
				children: "Composing surfaces"
			}),
			"."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "server-kolusurface-appserver",
			children: ["/server ", createVNode($$Pill, {
				variant: "new",
				children: "@kolu/surface-app/server"
			})]
		}),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#24292E\"> {</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  implementSurfaceApp,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  installSurfaceApp,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  surfaceAppServer,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">} </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"@kolu/surface-app/server\"</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// `implementSurfaceApp` — the server-side counterpart to `composeSurfaces`: ONE</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// call merges the fragment's buildInfo cell + `surfaceApp.info` probe impls into</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// your own deps, runs implementSurface, and flows `buildInfo.connect` internally.</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// The app passes only its OWN cells/procedures — no hand-spread, no seed→connect.</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#24292E\"> { </span><span style=\"color:#005CC5\">router</span><span style=\"color:#24292E\">, </span><span style=\"color:#005CC5\">ctx</span><span style=\"color:#24292E\"> } </span><span style=\"color:#D73A49\">=</span><span style=\"color:#6F42C1\"> implementSurfaceApp</span><span style=\"color:#24292E\">(surface, </span><span style=\"color:#6F42C1\">surfaceAppServer</span><span style=\"color:#24292E\">(), {</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  channel,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  cells: { </span><span style=\"color:#6A737D\">/* yours only */</span><span style=\"color:#24292E\"> },</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  procedures: { </span><span style=\"color:#6A737D\">/* yours only */</span><span style=\"color:#24292E\"> },</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// one call serves the shell fresh + the manifest + /sw.js (retirement). Granular pieces exported too.</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">installSurfaceApp</span><span style=\"color:#24292E\">(app, { clientDist, manifest: { name: </span><span style=\"color:#032F62\">`Kolu [${</span><span style=\"color:#24292E\">host</span><span style=\"color:#032F62\">}]`</span><span style=\"color:#24292E\">, themeColor, icons } });</span></span></code></pre>" }),
		"\n",
		createVNode(_components.h3, {
			id: "surface--compose-the-librarys-surface-kolusurface-appsurface",
			children: ["/surface — compose the library’s surface ", createVNode($$Pill, {
				variant: "dx",
				children: "@kolu/surface-app/surface"
			})]
		}),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#24292E\"> { surfaceAppSurface, composeSurfaces } </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"@kolu/surface-app/surface\"</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// ONE merge: the buildInfo cell + the `surfaceApp.info` restart probe, composed</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// with your own spec. (`surfaceAppSurfaceWith(myBuildInfoDef)` for an extender.)</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">export</span><span style=\"color:#D73A49\"> const</span><span style=\"color:#005CC5\"> surface</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> defineSurface</span><span style=\"color:#24292E\">(</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  composeSurfaces</span><span style=\"color:#24292E\">(surfaceAppSurface, { cells: { </span><span style=\"color:#6A737D\">/* yours … */</span><span style=\"color:#24292E\"> }, procedures: { </span><span style=\"color:#6A737D\">/* yours … */</span><span style=\"color:#24292E\"> } }),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">);</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "composeSurfaces" }),
			" ships in ",
			createVNode(_components.code, { children: "@kolu/surface-app" }),
			" (a field-wise merge of two ",
			createVNode(_components.code, { children: "SurfaceSpec" }),
			"s — cells/collections/streams/events shallow, procedures two-level, throwing on a duplicate key). surface-app’s contributions are namespaced under ",
			createVNode(_components.code, { children: "surfaceApp" }),
			" (probe at ",
			createVNode(_components.code, { children: "surface.surfaceApp.info" }),
			") so they never collide with the app’s own keys — the app wires the cell + probe as ",
			createVNode(_components.strong, { children: "one" }),
			" fragment, not two separate spreads."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "solid--behaviour--headless-model-kolusurface-appsolid",
			children: ["/solid — behaviour + headless model ", createVNode($$Pill, {
				variant: "hi",
				children: "@kolu/surface-app/solid"
			})]
		}),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"tsx\"><code><span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#24292E\"> { retireServiceWorker, SurfaceAppProvider, useSurfaceApp } </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"@kolu/surface-app/solid\"</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">retireServiceWorker</span><span style=\"color:#24292E\">();</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// pass your control-plane client + this bundle's baked commit (the bundler define):</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#005CC5\">SurfaceAppProvider</span><span style=\"color:#6F42C1\"> controlPlane</span><span style=\"color:#D73A49\">=</span><span style=\"color:#24292E\">{app} </span><span style=\"color:#6F42C1\">clientCommit</span><span style=\"color:#D73A49\">=</span><span style=\"color:#24292E\">{__SURFACE_APP_COMMIT__}> …your app… &#x3C;/</span><span style=\"color:#005CC5\">SurfaceAppProvider</span><span style=\"color:#24292E\">></span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// then render your own chrome from useSurfaceApp() — README has the snippets.</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"No styled components ship: a tailwind app (kolu) and a different-CSS app (drishti) render their own from the same model. ",
			createVNode(_components.code, { children: "controlPlane" }),
			" takes one client; a many-client app passes its control-plane client, since the model is global."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "vite--bun--the-client-build-owned-upstream-kolusurface-appvite--bun",
			children: ["/vite · /bun — the client build, owned upstream ", createVNode($$Pill, {
				variant: "md",
				children: "@kolu/surface-app/vite · /bun"
			})]
		}),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// Vite path — the plugin resolves + injects the commit</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#24292E\"> { surfaceApp } </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"@kolu/surface-app/vite\"</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">plugins</span><span style=\"color:#24292E\">: [</span><span style=\"color:#6F42C1\">solid</span><span style=\"color:#24292E\">(), </span><span style=\"color:#6F42C1\">surfaceApp</span><span style=\"color:#24292E\">()]   </span><span style=\"color:#6A737D\">// injects __SURFACE_APP_COMMIT__ + ships its type — no define, no env.d.ts, no sha literal.</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// Bun path — buildSurfaceClient owns hash-naming + the define + the no-store shell rewrite</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">import</span><span style=\"color:#24292E\"> { buildSurfaceClient } </span><span style=\"color:#D73A49\">from</span><span style=\"color:#032F62\"> \"@kolu/surface-app/bun\"</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">await</span><span style=\"color:#6F42C1\"> buildSurfaceClient</span><span style=\"color:#24292E\">({ entrypoint, distDir, htmlTemplate, entryHtmlPlaceholder, plugins, extraAssets, publicDir });</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"Both stamp the same commit via ",
			createVNode(_components.code, { children: "resolveCommit" }),
			" (env → git → ",
			createVNode(_components.code, { children: "\"dev\"" }),
			"). The Bun consumer (drishti) ",
			createVNode(_components.em, { children: "composes" }),
			" ",
			createVNode(_components.code, { children: "buildSurfaceClient" }),
			" rather than hand-rolling ",
			createVNode(_components.code, { children: "Bun.build" }),
			" + hashing + shell rewrite — the content-hashed ",
			createVNode(_components.code, { children: "/assets/*" }),
			" layout (the prerequisite for ",
			createVNode(_components.code, { children: "immutable" }),
			") is the library’s job, not the app’s. One resolver, one source of truth."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "using-it--kolu--drishti",
			children: "Using it — kolu & drishti"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Both are SolidJS + Hono on ",
			createVNode(_components.code, { children: "@hono/node-server" }),
			", both vendor ",
			createVNode(_components.code, { children: "@kolu/*" }),
			" via npins (zero flake inputs), so adding surface-app is one overlay line each. ",
			createVNode(_components.strong, { children: "Same model + same UX" }),
			"; kolu only differs by extending build identity for its pty-host axis."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"tsx\"><code><span class=\"line\"><span style=\"color:#6A737D\">// drishti — surface: ONE merge of surface-app's fragment (cell + surfaceApp.info probe) + its own</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">export</span><span style=\"color:#D73A49\"> const</span><span style=\"color:#005CC5\"> adminSurface</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> defineSurface</span><span style=\"color:#24292E\">(</span><span style=\"color:#6F42C1\">composeSurfaces</span><span style=\"color:#24292E\">(surfaceAppSurface, { collections: { hosts }, procedures: { hosts } }));</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// drishti — server: ONE call composes the surface-app impls (buildInfo cell + surfaceApp.info probe)</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// into the app's own deps, runs implementSurface, and flows the cell's connect (commit auto-resolved; /sw.js served by the lib)</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#24292E\"> { </span><span style=\"color:#005CC5\">router</span><span style=\"color:#24292E\">, </span><span style=\"color:#005CC5\">ctx</span><span style=\"color:#24292E\"> } </span><span style=\"color:#D73A49\">=</span><span style=\"color:#6F42C1\"> implementSurfaceApp</span><span style=\"color:#24292E\">(adminSurface, </span><span style=\"color:#6F42C1\">surfaceAppServer</span><span style=\"color:#24292E\">(), { channel, collections: { hosts }, procedures: { hosts } });</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">installSurfaceApp</span><span style=\"color:#24292E\">(app, { clientDist, manifest: { name: </span><span style=\"color:#032F62\">\"drishti\"</span><span style=\"color:#24292E\">, themeColor: </span><span style=\"color:#032F62\">\"#0e7490\"</span><span style=\"color:#24292E\">, icons } });</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// drishti — vite: one plugin resolves + injects the commit</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">plugins</span><span style=\"color:#24292E\">: [</span><span style=\"color:#6F42C1\">solid</span><span style=\"color:#24292E\">(), </span><span style=\"color:#6F42C1\">surfaceApp</span><span style=\"color:#24292E\">()]</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// drishti — client: provider (this bundle's baked commit) + your own chrome from useSurfaceApp()</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">retireServiceWorker</span><span style=\"color:#24292E\">();</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#005CC5\">SurfaceAppProvider</span><span style=\"color:#6F42C1\"> controlPlane</span><span style=\"color:#D73A49\">=</span><span style=\"color:#24292E\">{adminClient} </span><span style=\"color:#6F42C1\">clientCommit</span><span style=\"color:#D73A49\">=</span><span style=\"color:#24292E\">{__SURFACE_APP_COMMIT__}> &#x3C;</span><span style=\"color:#005CC5\">Header</span><span style=\"color:#24292E\">>drishti &#x3C;</span><span style=\"color:#005CC5\">DrishtiStatus</span><span style=\"color:#24292E\">/>&#x3C;/</span><span style=\"color:#005CC5\">Header</span><span style=\"color:#24292E\">> &#x3C;/</span><span style=\"color:#005CC5\">SurfaceAppProvider</span><span style=\"color:#24292E\">></span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"Zero hardcoded commits, defines, stores, or ",
				createVNode(_components.code, { children: "/sw.js" }),
				" routes"
			] }),
			" — every line composes a library fragment. kolu is identical but passes its pty-host source to ",
			createVNode(_components.code, { children: "buildInfoServer" }),
			" + the extended ",
			createVNode(_components.code, { children: "defineBuildInfo" }),
			". To ",
			createVNode(_components.em, { children: "see" }),
			" skew in dev, boot the server with ",
			createVNode(_components.code, { children: "SURFACE_APP_COMMIT=<other>" }),
			" — a real deploy-simulating override, not a sha baked into the client."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"drishti’s adoption (",
			createVNode(_components.a, {
				href: "https://github.com/srid/drishti/pull/47",
				children: "srid/drishti#47"
			}),
			") landed the content-hashed ",
			createVNode(_components.code, { children: "Bun.build" }),
			" prerequisite first — its old ",
			createVNode(_components.code, { children: "Bun.build" }),
			" emitted unhashed filenames (",
			createVNode(_components.code, { children: "main.js" }),
			"), which can’t be cached ",
			createVNode(_components.code, { children: "immutable" }),
			" (#1) — then sourced ",
			createVNode(_components.code, { children: "@kolu/surface-app" }),
			" hermetically through Nix and ported the identity rail onto the shared model."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "ui--example-not-shipped",
			children: "UI — example, not shipped"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The library ships the headless model, not styled components. These are the chrome you’d build from ",
			createVNode(_components.code, { children: "useSurfaceApp()" }),
			" — kolu in tailwind, drishti in its own CSS. The README carries the wiring."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "A server-identity rail" }),
			" — host · build, live status, and skew + reload as one state. A single row showing the server build (",
			createVNode(_components.code, { children: "d5aed3c" }),
			") versus the client build (",
			createVNode(_components.code, { children: "617b80d" }),
			"), a durable ",
			createVNode(_components.code, { children: "≠ srv" }),
			" chip when they diverge, and a ",
			createVNode(_components.code, { children: "⟳ Reload" }),
			" button:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"plaintext\"><code><span class=\"line\"><span>● SRV d5aed3c · CLIENT 617b80d   [≠ srv]   ⟳ Reload</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "A prominent one-tap recovery prompt" }), " (durable, not a transient toast):"] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"plaintext\"><code><span class=\"line\"><span>⟳  A new version is available</span></span>\n<span class=\"line\"><span>   This tab is running an older build (617b80d → d5aed3c).        [ Reload ]</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"On mobile the rail collapses to the chip + reload; the prompt becomes a bottom banner. Both are built from the same ",
			createVNode(_components.code, { children: "useSurfaceApp()" }),
			" model, so kolu’s reflect pty divergence and drishti’s reflect commit skew with no change to the library."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "composing-surfaces--multiple-surfaces-one-transport",
			children: "Composing surfaces — multiple surfaces, one transport"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Status: ",
			createVNode($$Pill, {
				variant: "done",
				children: "implemented"
			}),
			" · ",
			createVNode($$PrLink, { pr: 1201 }),
			" · ",
			createVNode(_components.a, {
				href: "https://github.com/juspay/kolu/issues/1197",
				children: "kolu#1197"
			}),
			" · dissolves the four composition seams above ",
			createVNode(_components.strong, { children: ["without touching ", createVNode(_components.code, { children: "SurfaceSpec" })] }),
			". surface-app shrinks; only a thin plural layer is added to surface core."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			children: createVNode(_components.p, { children: [
				"The mistake was trying to ",
				createVNode(_components.strong, { children: "merge" }),
				" surface-app ",
				createVNode(_components.em, { children: "into" }),
				" the app’s spec. surface-app is ",
				createVNode(_components.em, { children: "already" }),
				" a complete, valid surface on its own — a ",
				createVNode(_components.code, { children: "buildInfo" }),
				" cell + an ",
				createVNode(_components.code, { children: "info" }),
				" probe. So don’t merge it; ",
				createVNode(_components.strong, { children: "serve it as a sibling" }),
				". An app serves a keyed ",
				createVNode(_components.em, { children: "map" }),
				" of independent surfaces, multiplexed over its one transport — and the four seams, which were all glue for the merge, simply have nothing to do."
			] })
		}),
		"\n",
		createVNode(_components.h3, {
			id: "the-xy-unwind",
			children: "The XY unwind"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The issue (#1197) prescribed nested sub-surfaces (",
			createVNode(_components.code, { children: "mounts" }),
			") — recurse a whole ",
			createVNode(_components.code, { children: "Surface" }),
			" inside ",
			createVNode(_components.code, { children: "SurfaceSpec" }),
			". That solves the stated Y (one merged spec) but at the cost of making the core spec recursive and changing every derivation. The real X — ",
			createVNode(_components.em, { children: "a library can’t be handed over as one unit because its cell is flat and its probe is two-level" }),
			" — dissolves once you stop merging: a standalone surface ",
			createVNode(_components.strong, { children: "is" }),
			" one unit, and “compose” just means “serve more than one.” ",
			createVNode(_components.code, { children: "SurfaceSpec" }),
			", ",
			createVNode(_components.code, { children: "defineSurface" }),
			", the contract derivation, the client proxy, and the channel-key construction are all ",
			createVNode(_components.strong, { children: "untouched" }),
			"."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-seam",
			children: "The seam"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Each surface is defined exactly as today — no new field. surface core gains a thin plural layer — ",
			createVNode(_components.code, { children: "composeSurfaceContracts" }),
			" (contract), ",
			createVNode(_components.code, { children: "implementSurfaces" }),
			" (server), ",
			createVNode(_components.code, { children: "surfaceClients" }),
			" (client) — each reading ",
			createVNode(_components.strong, { children: [
				"one shared keyed ",
				createVNode(_components.code, { children: "surfaces" }),
				" map"
			] }),
			", so the keys can’t drift across the three."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// each is a normal, standalone surface — ZERO change to defineSurface / derivation / client proxy</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> surfaceAppSurface</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> defineSurface</span><span style=\"color:#24292E\">({ cells: { buildInfo }, procedures: { identity: { info } } });</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> adminSurface</span><span style=\"color:#D73A49\">      =</span><span style=\"color:#6F42C1\"> defineSurface</span><span style=\"color:#24292E\">({ collections: { hosts }, procedures: { hosts } });</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// ONE keyed map — the single (browser-safe) source of which surfaces exist under which keys</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> surfaces</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> { surfaceApp: surfaceAppSurface, admin: adminSurface };</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> contract</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> composeSurfaceContracts</span><span style=\"color:#24292E\">(surfaces);   </span><span style=\"color:#6A737D\">// → { surface: { surfaceApp, admin } }</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// SERVER — reuse `surfaces`; add only the server-only deps, keyed the same way (no { surface, deps } wrapper)</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#24292E\"> { </span><span style=\"color:#005CC5\">router</span><span style=\"color:#24292E\">, </span><span style=\"color:#005CC5\">ctx</span><span style=\"color:#24292E\"> } </span><span style=\"color:#D73A49\">=</span><span style=\"color:#6F42C1\"> implementSurfaces</span><span style=\"color:#24292E\">(surfaces, { channel }, {</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  surfaceApp: </span><span style=\"color:#6F42C1\">surfaceAppServer</span><span style=\"color:#24292E\">(),   </span><span style=\"color:#6A737D\">// the lib's deps bundle; its async buildInfo connect fires in the runtime</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  admin:      adminImpl,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// CLIENT — reuse `surfaces`; one connection split into a per-key client bundle</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> c</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> surfaceClients</span><span style=\"color:#24292E\">(link, surfaces);</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">c.surfaceApp.cells.buildInfo.</span><span style=\"color:#6F42C1\">use</span><span style=\"color:#24292E\">();   </span><span style=\"color:#6A737D\">// surface.surfaceApp.buildInfo</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">c.admin.collections.hosts.</span><span style=\"color:#6F42C1\">use</span><span style=\"color:#24292E\">();      </span><span style=\"color:#6A737D\">// surface.admin.hosts...</span></span></code></pre>" }),
		"\n",
		createVNode($$Svg, {
			svg: surface_app_multiplex_default,
			caption: "Independent surfaces are multiplexed over one transport; the plural layer keys each by its registration name. SurfaceSpec and every derivation are untouched."
		}),
		"\n",
		createVNode(_components.h3, {
			id: "what-it-dissolves",
			children: "What it dissolves"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Seam today" }),
					"\n",
					createVNode(_components.th, { children: "After" }),
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
						createVNode(_components.code, { children: "composeSurfaces" }),
						" / ",
						createVNode(_components.code, { children: "ComposedSurfaceSpec" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "gone" }),
						" — no merge; the surfaces are siblings ",
						createVNode(_components.em, { children: [
							"(the name ",
							createVNode(_components.code, { children: "ComposedSurfaceSpec" }),
							" was later reintroduced by SR5 for an unrelated concept — ",
							createVNode(_components.code, { children: "extendSurface" }),
							"’s flat spec merge; see ",
							createVNode(_components.a, {
								href: "surface-runtime-boundary",
								children: "surface-runtime-boundary"
							}),
							")"
						] })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "assertNoOverride" }), " dup-key throw"] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "gone" }), " — each surface is its own top key; nothing to collide"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "implementSurfaceApp()" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "gone" }),
						" — ",
						createVNode(_components.code, { children: "implementSurfaces(surfaces, base, deps)" }),
						" takes each surface’s deps in a keyed map; ",
						createVNode(_components.code, { children: "surfaceAppServer()" }),
						" survives as surface-app’s per-key deps bundle"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"app-visible ",
						createVNode(_components.code, { children: "connect" }),
						" (republish late ",
						createVNode(_components.code, { children: "buildInfo" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "gone" }),
						" — ",
						createVNode(_components.code, { children: "connect?" }),
						" is a cell-impl dep the runtime fires once after wiring"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The plural layer wraps the ",
			createVNode(_components.strong, { children: "existing" }),
			" singular walk once per surface, handling the two real mechanics:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// 1. namespace each surface's channel bus by its key so two surfaces' `buildInfo:changed` can't collide</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">walkSurface</span><span style=\"color:#24292E\">(t.surface[key], surface, { </span><span style=\"color:#D73A49\">...</span><span style=\"color:#24292E\">deps, </span><span style=\"color:#6F42C1\">channel</span><span style=\"color:#24292E\">: (</span><span style=\"color:#E36209\">n</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#6F42C1\"> baseChannel</span><span style=\"color:#24292E\">(</span><span style=\"color:#032F62\">`${</span><span style=\"color:#24292E\">key</span><span style=\"color:#032F62\">}/${</span><span style=\"color:#24292E\">n</span><span style=\"color:#032F62\">}`</span><span style=\"color:#24292E\">) })</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// 2. key each surface's router + ctx under its registration name (instead of the hardcoded single `surface`)</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"surface-app’s ",
			createVNode(_components.code, { children: "/surface" }),
			" and ",
			createVNode(_components.code, { children: "/server" }),
			" entrypoints lose ",
			createVNode(_components.code, { children: "composeSurfaces" }),
			", ",
			createVNode(_components.code, { children: "surfaceAppServer" }),
			", ",
			createVNode(_components.code, { children: "implementSurfaceApp" }),
			", ",
			createVNode(_components.code, { children: "assertNoOverride" }),
			"; the ",
			createVNode(_components.code, { children: "surfaceAppSurface" }),
			" definition + its server impl stay (now served as a sibling). The headless model, ",
			createVNode(_components.code, { children: "installSurfaceApp" }),
			", and the client build are untouched."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "why-this-is-the-right-boundary",
			children: "Why this is the right boundary"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Hickey (simplicity):" }),
				" siblings don’t complect — there is ",
				createVNode(_components.em, { children: "no merge at all" }),
				", so the four merge-glue constructs have nothing to do. One namespacing mechanism (the registration key), zero recursion in the spec."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Lowy (volatility):" }),
				" the unit of contribution is ",
				createVNode(_components.em, { children: "a whole surface" }),
				", encapsulated; a new library (",
				createVNode(_components.code, { children: "surface-auth" }),
				") is just another entry in the map. Smallest blast radius — the core derivation, the client proxy, and channel-key construction don’t move; only a thin plural layer is added."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "connect" }) }),
				" is a ",
				createVNode(_components.em, { children: "separate" }),
				" volatility (a cell’s value arriving async at boot). It stays internal to each surface’s own ",
				createVNode(_components.code, { children: "implementSurface" }),
				", never folded into composition and never app-visible."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "why-the-wire-break-is-free",
			children: "Why the wire break is free"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Wire paths gain the surface key (",
			createVNode(_components.code, { children: "surface.buildInfo" }),
			" → ",
			createVNode(_components.code, { children: "surface.surfaceApp.buildInfo" }),
			"; channel ",
			createVNode(_components.code, { children: "buildInfo:changed" }),
			" → ",
			createVNode(_components.code, { children: "surfaceApp/buildInfo:changed" }),
			"). A hard break for a long-lived client — ",
			createVNode(_components.strong, { children: [
				"except this is the one app class where client and server ship together and a skewed client is ",
				createVNode(_components.em, { children: "designed" }),
				" to reload to the deployed build"
			] }),
			" (invariant #1). No compat shim: kolu, the surface examples, and drishti all re-derive in lockstep with the server they ship beside."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "scope--migration",
			children: "Scope & migration"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" change that ",
			createVNode(_components.strong, { children: "adds" }),
			" ",
			createVNode(_components.code, { children: "composeSurfaceContracts" }),
			" + ",
			createVNode(_components.code, { children: "implementSurfaces" }),
			" + ",
			createVNode(_components.code, { children: "surfaceClients" }),
			" and leaves ",
			createVNode(_components.code, { children: "SurfaceSpec" }),
			" / ",
			createVNode(_components.code, { children: "defineSurface" }),
			" / the contract derivation / the client proxy alone. All three read one shared keyed ",
			createVNode(_components.code, { children: "surfaces" }),
			" map. Then every consumer splits its one merged surface into siblings:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "kolu" }),
				" — its ",
				createVNode(_components.code, { children: "surfaceApp" }),
				" surface (extending build identity for the pty-host axis, as today) becomes a sibling of its ",
				createVNode(_components.code, { children: "kolu" }),
				" surface; deletes its ",
				createVNode(_components.code, { children: "composeSurfaces" }),
				" / ",
				createVNode(_components.code, { children: "implementSurfaceApp" }),
				" calls. ",
				createVNode(_components.code, { children: "app = clients.kolu" }),
				" keeps every existing call site unchanged."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "the surface examples" }),
				" — re-expressed as sibling surfaces against the plural API (a ",
				createVNode(_components.code, { children: "surfaceApp" }),
				" sibling + the example’s own ",
				createVNode(_components.code, { children: "demo" }),
				" sibling)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "drishti" }),
				" (",
				createVNode(_components.a, {
					href: "https://github.com/srid/drishti",
					children: "srid/drishti"
				}),
				") — adopts the plural API in a paired PR (the ",
				createVNode(_components.code, { children: "(should include drishti PR)" }),
				" ask): a ",
				createVNode(_components.code, { children: "surfaces = { admin: adminSurface, surfaceApp: surfaceAppSurface }" }),
				" map in ",
				createVNode(_components.code, { children: "admin-surface.ts" }),
				", ",
				createVNode(_components.code, { children: "implementSurfaces(surfaces, …)" }),
				" in ",
				createVNode(_components.code, { children: "admin-router.ts" }),
				", ",
				createVNode(_components.code, { children: "clients.surfaceApp.cells.buildInfo" }),
				" and the ",
				createVNode(_components.code, { children: "surfaceAppProbe(clients.surfaceApp)" }),
				" identity probe on the client."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "A pure refactor in behavior — no on-screen change, no new user-facing surface — so existing surface + surface-app tests are the safety net (extended to cover the plural layer’s per-key channel namespacing and router/ctx keying)." }),
		"\n",
		createVNode(_components.h2, {
			id: "rationale--status",
			children: "Rationale & status"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "what-it-absorbs",
			children: "What it absorbs"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"The ",
					createVNode(_components.code, { children: "no-cache" }),
					"-isn’t-enough shell"
				] }),
				" — a 1970 ",
				createVNode(_components.code, { children: "Last-Modified" }),
				" earns years of heuristic freshness and replays on normal reload. → ",
				createVNode(_components.code, { children: "no-store" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The asset-miss that becomes HTML" }),
				" — caches the wrong MIME ",
				createVNode(_components.code, { children: "immutable" }),
				" for a year. → 404 the miss."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["The SW gate on ", createVNode(_components.code, { children: "protocol === \"https:\"" })] }),
				" — misses ",
				createVNode(_components.code, { children: "localhost" }),
				" + flag-secured origins, orphaning a worker. → ",
				createVNode(_components.code, { children: "isSecureContext" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The un-retired worker" }),
				" — gating new registration leaves an existing SW intercepting navigations. → ",
				createVNode(_components.code, { children: "retireServiceWorker()" }),
				" + self-destruct ",
				createVNode(_components.code, { children: "sw.js" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The transient update signal" }), " — a “restarted” event a backgrounded tab misses. → the durable skew backstop in the model."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "why-no-offline--no-service-worker",
			children: "Why no offline / no service worker"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"For this class a ",
			createVNode(_components.em, { children: "caching" }),
			" worker is ",
			createVNode(_components.strong, { children: "definitionally" }),
			" wrong, not an opinion — and the rationale ships so the next engineer doesn’t re-add one. The sanctioned exception is the fetch-less notification worker (",
			createVNode($$PrLink, { pr: 1216 }),
			"): it registers no fetch handler, so the interception downside below can’t reach it; the lifecycle liability still applies, which is why surface-app owns the worker end-to-end (it self-destructs any caches it finds)."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "No offline to gain." }), " A surface app needs its live WebSocket — no wire, no app."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "No speed to gain." }),
				" Hashed assets are already ",
				createVNode(_components.code, { children: "immutable" }),
				"-cached; a precache just adds a stale-prone layer."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Real downside." }),
				" A SW is a second interception layer ",
				createVNode(_components.code, { children: "no-store" }),
				" can’t reach; owning its lifecycle is a standing liability (the whole saga)."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Install survives without it" }), " — Chrome dropped the service-worker requirement for installability (108 mobile / 112 desktop); a valid manifest over a secure context installs. (The automatic in-page prompt is best-effort without a SW — manual browser-menu install always works.)"] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "direction",
			children: "Direction"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Surface-native." }),
				" Depends on ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				" and rides it for the build-identity model."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Batteries-included behaviour, headless UI." }), " Owns delivery, identity, commit stamping, SW retirement, install affordance, and the relationship-to-server model; apps render the chrome. The README ships the wiring."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Interfaces where it varies" }),
				" — build identity (default ",
				createVNode(_components.code, { children: "{ commit }" }),
				"; kolu extends)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Settled questions." }),
				" Install needs no service worker; cert/TLS lives outside surface-app; the desktop layer is secure-context-gated with graceful degradation. The connection-lifecycle model ships in-library as ",
				createVNode(_components.code, { children: "createServerLifecycle" }),
				"; the client build ships as ",
				createVNode(_components.code, { children: "surfaceApp()" }),
				" (Vite) / ",
				createVNode(_components.code, { children: "buildSurfaceClient()" }),
				" (Bun); and surface-app ships its contribution as a ",
				createVNode(_components.strong, { children: "complete standalone surface" }),
				" (",
				createVNode(_components.code, { children: "surfaceAppSurface" }),
				" / ",
				createVNode(_components.code, { children: "surfaceAppSurfaceWith" }),
				", with the ",
				createVNode(_components.code, { children: "identity.info" }),
				" probe) — served as a ",
				createVNode(_components.em, { children: "sibling" }),
				" via ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				"’s ",
				createVNode(_components.code, { children: "implementSurfaces" }),
				" / ",
				createVNode(_components.code, { children: "surfaceClients" }),
				" / ",
				createVNode(_components.code, { children: "composeSurfaceContracts" }),
				", not merged into the app’s own surface. (The earlier merge approach — ",
				createVNode(_components.code, { children: "composeSurfaces" }),
				" + ",
				createVNode(_components.code, { children: "implementSurfaceApp" }),
				" — was dissolved; see ",
				createVNode(_components.a, {
					href: "#composing-surfaces--multiple-surfaces-one-transport",
					children: "Composing surfaces"
				}),
				".) One follow-up remains deferred: whether ",
				createVNode(_components.code, { children: "@kolu/dev-tls" }),
				" is extracted as its own optional package."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A living library, not a finished one." }),
				" The boundary is settled, but the ",
				createVNode(_components.em, { children: "composition surface" }),
				" keeps tightening as more apps adopt it — each “compose, don’t hand-wire” seam was added because drishti’s adoption surfaced a place an app was still hand-rolling the library’s job. The first cut (",
				createVNode(_components.code, { children: "buildSurfaceClient" }),
				", ",
				createVNode(_components.code, { children: "nix/commit-stamp.nix" }),
				", and the now-removed merge seams ",
				createVNode(_components.code, { children: "composeSurfaces" }),
				" / ",
				createVNode(_components.code, { children: "implementSurfaceApp" }),
				") is now superseded by the sibling model — surface-app is ",
				createVNode(_components.em, { children: "just a sibling surface" }),
				", so the merge glue dissolved entirely. Expect the pattern to continue: a third consumer will find the next seam to lift upstream."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "name",
			children: "Name"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode($$Pill, {
				variant: "ok",
				children: "@kolu/surface-app"
			}),
			" — “the app shell for a surface wire.” Dropped “pwa”: it connotes ",
			createVNode(_components.em, { children: "offline / installable-for-offline" }),
			", the opposite of this always-connected class."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "phasing",
			children: "Phasing"
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["Build ", createVNode(_components.code, { children: "@kolu/surface-app" })] }),
				" (",
				createVNode(_components.code, { children: "packages/surface-app" }),
				" in the kolu monorepo) — ",
				createVNode(_components.code, { children: "/server" }),
				", ",
				createVNode(_components.code, { children: "/surface" }),
				", ",
				createVNode(_components.code, { children: "/solid" }),
				" (behaviour + headless ",
				createVNode(_components.code, { children: "useSurfaceApp()" }),
				"), ",
				createVNode(_components.code, { children: "/lifecycle" }),
				", ",
				createVNode(_components.code, { children: "/vite" }),
				", ",
				createVNode(_components.code, { children: "utils/" }),
				", commit-stamp helper, and the desktop-feel affordances behind the secure-context gate. Rewired kolu, extending build identity for pty-host. Shipped the README (no-SW rationale + triage checklist + UI-wiring snippets). Registered in the ",
				createVNode(_components.a, {
					href: "./electricity.html",
					children: "electricities tracker"
				}),
				". ",
				createVNode($$Pill, {
					variant: "done",
					children: "done"
				}),
				" — kolu ",
				createVNode($$PrLink, { pr: 1154 }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Adopt in drishti" }),
				" (separate PRs, drishti repo) — first a small PR for content-hashed ",
				createVNode(_components.code, { children: "Bun.build" }),
				" output; then port drishti onto the library (default identity, same UX). ",
				createVNode($$Pill, {
					variant: "done",
					children: "done"
				}),
				" — ",
				createVNode(_components.a, {
					href: "https://github.com/srid/drishti/pull/47",
					children: "srid/drishti#47"
				}),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["Extract ", createVNode(_components.code, { children: "@kolu/dev-tls" })] }),
				" — pull kolu’s self-signed generator (",
				createVNode(_components.code, { children: "packages/server/src/tls.ts" }),
				") into a tiny optional package for the localhost/dev escape hatch; document the trusted recipes (",
				createVNode(_components.code, { children: "tailscale serve" }),
				" / mkcert / Caddy). surface-app itself only feature-detects the secure context and hints. ",
				createVNode($$Pill, {
					variant: "run",
					children: "deferred"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Blog post" }),
				" — sibling to ",
				createVNode(_components.a, {
					href: "https://kolu.dev/blog/surface-framework/",
					children: "surface-framework"
				}),
				", seeded by ",
				createVNode(_components.a, {
					href: "../../cache-bug.md",
					children: "cache-bug.md"
				}),
				". ",
				createVNode($$Pill, {
					variant: "run",
					children: "deferred"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["Compose surfaces as siblings in ", createVNode(_components.code, { children: "@kolu/surface" })] }),
				" — ",
				createVNode(_components.code, { children: "implementSurfaces" }),
				" / ",
				createVNode(_components.code, { children: "surfaceClients" }),
				" serve a keyed map of standalone surfaces over one transport, so surface-app is ",
				createVNode(_components.em, { children: "just a sibling surface" }),
				" and ",
				createVNode(_components.code, { children: "composeSurfaces" }),
				" / ",
				createVNode(_components.code, { children: "implementSurfaceApp" }),
				" / the dup-key throw / the app-visible ",
				createVNode(_components.code, { children: "connect" }),
				" all dissolve — with ",
				createVNode(_components.strong, { children: ["no change to ", createVNode(_components.code, { children: "SurfaceSpec" })] }),
				". A thin plural layer on surface core (paired drishti adoption to follow). Plan of record: ",
				createVNode(_components.a, {
					href: "#composing-surfaces--multiple-surfaces-one-transport",
					children: "Composing surfaces"
				}),
				". ",
				createVNode($$Pill, {
					variant: "done",
					children: "implemented"
				}),
				" — kolu ",
				createVNode($$PrLink, { pr: 1201 }),
				" · ",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/issues/1197",
					children: "kolu#1197"
				}),
				"."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "The one-line answer",
			children: createVNode(_components.p, { children: [
				"Stop re-deriving the app shell per self-hosted app. Do for the installed, always-connected client what surface did for the wire — own delivery, server identity, the connection/update model, and desktop install as importable code; extend by interface where apps differ; and let drishti ",
				createVNode(_components.code, { children: "import" }),
				" instead of re-learn."
			] })
		}),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: [
			"Origin: ",
			createVNode($$PrLink, { pr: 1149 }),
			". Model: ",
			createVNode(_components.a, {
				href: "https://kolu.dev/blog/surface-framework/",
				children: "@kolu/surface"
			}),
			". Bug saga + design history (incl. the surface-pwa → surface-app pivot): ",
			createVNode(_components.a, {
				href: "../../cache-bug.md",
				children: "cache-bug.md"
			}),
			". Sibling: ",
			createVNode(_components.a, {
				href: "./electricity.html",
				children: "electricity.html"
			}),
			". · Shipped 2026-06-04."
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
	"title": "surface-app — the app shell for surface apps",
	"description": "A library for the class of @kolu/surface app that is really a desktop application you run against your own server — fresh delivery, server/build identity, the connection/update lifecycle, and desktop install, all owned by one shell.",
	"parents": [
		"electricity",
		"reference",
		"surface"
	],
	"maturity": "evergreen",
	"status": "implemented",
	"updated": "2026-07-02T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-it-is",
			"text": "What it is"
		},
		{
			"depth": 3,
			"slug": "the-class-of-app-it-serves",
			"text": "The class of app it serves"
		},
		{
			"depth": 3,
			"slug": "the-unifying-insight",
			"text": "The unifying insight"
		},
		{
			"depth": 2,
			"slug": "the-contract",
			"text": "The contract"
		},
		{
			"depth": 3,
			"slug": "five-invariants",
			"text": "Five invariants"
		},
		{
			"depth": 3,
			"slug": "the-app-shells-parts",
			"text": "The app shell’s parts"
		},
		{
			"depth": 3,
			"slug": "secure-context-for-the-desktop-layer-https",
			"text": "Secure context for the desktop layer (HTTPS)"
		},
		{
			"depth": 3,
			"slug": "the-pieces",
			"text": "The pieces"
		},
		{
			"depth": 2,
			"slug": "the-design-historical-merge-era",
			"text": "The design historical (merge era)"
		},
		{
			"depth": 3,
			"slug": "the-headless-model",
			"text": "The headless model"
		},
		{
			"depth": 3,
			"slug": "build-identity-is-an-interface",
			"text": "Build identity is an interface"
		},
		{
			"depth": 3,
			"slug": "compose-dont-hand-wire",
			"text": "Compose, don’t hand-wire"
		},
		{
			"depth": 2,
			"slug": "the-api-historical-merge-era",
			"text": "The API historical (merge era)"
		},
		{
			"depth": 3,
			"slug": "server-kolusurface-appserver",
			"text": "/server @kolu/surface-app/server"
		},
		{
			"depth": 3,
			"slug": "surface--compose-the-librarys-surface-kolusurface-appsurface",
			"text": "/surface — compose the library’s surface @kolu/surface-app/surface"
		},
		{
			"depth": 3,
			"slug": "solid--behaviour--headless-model-kolusurface-appsolid",
			"text": "/solid — behaviour + headless model @kolu/surface-app/solid"
		},
		{
			"depth": 3,
			"slug": "vite--bun--the-client-build-owned-upstream-kolusurface-appvite--bun",
			"text": "/vite · /bun — the client build, owned upstream @kolu/surface-app/vite · /bun"
		},
		{
			"depth": 3,
			"slug": "using-it--kolu--drishti",
			"text": "Using it — kolu & drishti"
		},
		{
			"depth": 3,
			"slug": "ui--example-not-shipped",
			"text": "UI — example, not shipped"
		},
		{
			"depth": 2,
			"slug": "composing-surfaces--multiple-surfaces-one-transport",
			"text": "Composing surfaces — multiple surfaces, one transport"
		},
		{
			"depth": 3,
			"slug": "the-xy-unwind",
			"text": "The XY unwind"
		},
		{
			"depth": 3,
			"slug": "the-seam",
			"text": "The seam"
		},
		{
			"depth": 3,
			"slug": "what-it-dissolves",
			"text": "What it dissolves"
		},
		{
			"depth": 3,
			"slug": "why-this-is-the-right-boundary",
			"text": "Why this is the right boundary"
		},
		{
			"depth": 3,
			"slug": "why-the-wire-break-is-free",
			"text": "Why the wire break is free"
		},
		{
			"depth": 3,
			"slug": "scope--migration",
			"text": "Scope & migration"
		},
		{
			"depth": 2,
			"slug": "rationale--status",
			"text": "Rationale & status"
		},
		{
			"depth": 3,
			"slug": "what-it-absorbs",
			"text": "What it absorbs"
		},
		{
			"depth": 3,
			"slug": "why-no-offline--no-service-worker",
			"text": "Why no offline / no service worker"
		},
		{
			"depth": 3,
			"slug": "direction",
			"text": "Direction"
		},
		{
			"depth": 3,
			"slug": "name",
			"text": "Name"
		},
		{
			"depth": 3,
			"slug": "phasing",
			"text": "Phasing"
		}
	];
}
var url = "src/content/atlas/surface-app.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/surface-app.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/surface-app.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
