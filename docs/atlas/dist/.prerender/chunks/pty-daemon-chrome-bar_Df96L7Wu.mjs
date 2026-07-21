import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$D2 } from "./D2_CPv-UX0x.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import { t as $$Commit } from "./Commit_CU-zj10t.mjs";
//#region src/content/atlas/pty-daemon-chrome-bar.mdx
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
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The UI design for A2’s deliverable #3" }),
			" — the consolidated connection + build/commit readout in the ChromeBar, shipped with A2 in ",
			createVNode($$PrLink, { pr: 1063 }),
			" as ",
			createVNode(_components.code, { children: "packages/client/src/ui/IdentityRail.tsx" }),
			". Built in its ",
			createVNode(_components.strong, { children: "final two-column shape from day one" }),
			" — ",
			createVNode(_components.code, { children: "srv" }),
			" (the server you’re connected to) and ",
			createVNode(_components.code, { children: "pty" }),
			" (the pty-host serving your terminals) — even though in A2 they’re the same process. That coincidence is the point: it’s the live proof A2’s identity plumbing works, and it means ",
			createVNode(_components.a, {
				href: "pty-daemon.html",
				children: "Phase R2"
			}),
			" only has to let the columns ",
			createVNode(_components.em, { children: "diverge" }),
			", never re-lay-out. The original prototype was rendered with the live dark-theme tokens from ",
			createVNode(_components.code, { children: "packages/client/src/index.css" }),
			" against the real ",
			createVNode(_components.code, { children: "ChromeBar.tsx" }),
			" layout."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Updated through R2.3 — the rail is now three columns",
			children: createVNode(_components.p, { children: [
				"This note is A2’s original ",
				createVNode(_components.strong, { children: "two-column" }),
				" design (",
				createVNode(_components.code, { children: "srv · pty" }),
				", coinciding in-process). ",
				createVNode(_components.strong, { children: [
					"R2.3 (",
					createVNode($$PrLink, { pr: 1310 }),
					") overtook that shape."
				] }),
				" The ",
				createVNode(_components.code, { children: "pty" }),
				" column was renamed ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "kaval" }) }),
				" — the daemon is now a separate, spawned process, so the column carries the supervisor’s ",
				createVNode(_components.em, { children: "honest" }),
				" daemon state (",
				createVNode(_components.code, { children: "connected" }),
				"/",
				createVNode(_components.code, { children: "degraded" }),
				"/",
				createVNode(_components.code, { children: "dead" }),
				", not the WebSocket’s) and an uptime from its ",
				createVNode(_components.code, { children: "startedAt" }),
				" — and a third ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "client" }) }),
				" column was added (this browser’s JS build, flagging ",
				createVNode(_components.code, { children: "≠ srv" }),
				" when a stale cached bundle is served against a freshly deployed server). So the live rail is ",
				createVNode(_components.strong, { children: ["three columns ", createVNode(_components.code, { children: "srv · client · kaval" })] }),
				": R2.3 ",
				createVNode(_components.em, { children: "did" }),
				" re-lay-out and migrate the component, which the “final two-column shape from day one / never re-lay-out / no migration” framing below predates. ",
				createVNode(_components.strong, { children: [
					"R2.4.2 (",
					createVNode($$PrLink, { pr: 1337 }),
					")"
				] }),
				" then made the ",
				createVNode(_components.code, { children: "kaval" }),
				" column’s down state actionable — the inline ",
				createVNode(_components.strong, { children: "Restart kaval" }),
				" button. ",
				createVNode(_components.strong, { children: [
					"R2.4.4 (",
					createVNode($$PrLink, { pr: 1353 }),
					")"
				] }),
				" lit the long-dormant ",
				createVNode(_components.strong, { children: "⬆ update" }),
				" state — an amber nudge when the daemon is a build behind what the server would spawn — with the running-vs-expected detail, the two builds’ clickable git commits + a path-scoped “what changed in kaval” history link, and the daemon’s socket path in the dialog. ",
				createVNode(_components.strong, { children: "Later still" }),
				", each of the three columns gained a live ",
				createVNode(_components.strong, { children: "memory" }),
				" figure beside its identity: ",
				createVNode(_components.code, { children: "srv" }),
				" shows the kolu-server’s RSS, ",
				createVNode(_components.code, { children: "client" }),
				" this browser’s used JS heap (Chromium-only — ",
				createVNode(_components.code, { children: "performance.memory" }),
				"), and ",
				createVNode(_components.code, { children: "kaval" }),
				" the daemon’s RSS. The server samples its own and the daemon’s RSS on a fixed cadence and publishes both on a dedicated ",
				createVNode(_components.code, { children: "processMemory" }),
				" cell (kept off the lifecycle-transition ",
				createVNode(_components.code, { children: "daemonStatus" }),
				" collection so the fast-moving metric and the discrete state changes don’t share one channel); the daemon’s RSS rides its own dedicated ",
				createVNode(_components.code, { children: "system.processMemory" }),
				" verb — an atomic procedure (additive pty-host contract bump 3.1 → 3.2), kept separate from ",
				createVNode(_components.code, { children: "system.heartbeat" }),
				"’s pure liveness round-trip so process-memory observability and liveness change for unrelated reasons. The client adds its own JS-heap figure locally, refreshed off the shared 1 s clock — no extra timer. ",
				createVNode(_components.strong, { children: "Later" }),
				", each daemon’s dialog gained a ",
				createVNode(_components.strong, { children: "lifetime" }),
				" row: the daemon publishes its serialized ",
				createVNode(_components.code, { children: "DaemonLifetimeInfo" }),
				" (",
				createVNode(_components.code, { children: "@kolu/surface-daemon" }),
				") — kaval as an ",
				createVNode(_components.strong, { children: "optional" }),
				" field on its ",
				createVNode(_components.code, { children: "system.version" }),
				" handshake, padi as an ",
				createVNode(_components.strong, { children: "optional" }),
				" field on its ",
				createVNode(_components.code, { children: "identity" }),
				" cell — which reads ",
				createVNode(_components.code, { children: "forever" }),
				" for a durable production daemon and ",
				createVNode(_components.code, { children: "bound to run pid N" }),
				" under a test/smoke run (the boundToPid lifetime that dies with its run). Both were added ",
				createVNode(_components.strong, { children: "without a contract bump" }),
				" (constraint (1) below, exactly as ",
				createVNode(_components.code, { children: "identity" }),
				" was): a cosmetic readout must never force-restart a survivor daemon — bumping the pty-host contract would make a pre-field kaval a skew, and a skewed kaval is ",
				createVNode(_components.em, { children: "recycled" }),
				" (its live PTYs killed); leaving the field optional keeps the survivor adopted, and its row reads “—” until the next restart reports it. The current shape lives in ",
				createVNode(_components.a, {
					href: "pty-daemon.html",
					children: "pty-daemon"
				}),
				"; the design rationale below stands as A2’s record."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-design-call--two-explicit-columns-in-a2",
			children: "The design call — two explicit columns in A2"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The R2 plan originally deferred the daemon chip to R2, reasoning that an always-green “daemon connected” chip would lie about an absent daemon. But in A2 the pty-host isn’t absent — it’s ",
			createVNode(_components.strong, { children: "in-process" }),
			". So a two-column ",
			createVNode(_components.code, { children: "srv · pty" }),
			" readout where the columns coincide is the literal truth, not a lie. Better still, it’s the cleanest acceptance signal A2 could have:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "It’s the acceptance test." }),
				" A one-sided readout would show the server’s commit and call it done — exercising none of A2’s actual wire work. The two-column rail forces the whole path to light up: server boots → fetches ",
				createVNode(_components.code, { children: "system.version()" }),
				" → relays ",
				createVNode(_components.code, { children: ".identity" }),
				" onto ",
				createVNode(_components.code, { children: "server.info" }),
				" → client renders the ",
				createVNode(_components.code, { children: "pty" }),
				" column. ",
				createVNode(_components.strong, { children: "The columns matching is the green test; a mismatch in A2 means the plumbing R2 depends on is broken." })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The dot was already “srv”." }),
				" The standalone WebSocket status dot represents the client↔server link — i.e. ",
				createVNode(_components.code, { children: "srv" }),
				" liveness. Consolidating it into the rail removes a redundant indicator and gives ",
				createVNode(_components.code, { children: "pty" }),
				" a parallel slot for its own liveness (in-process now, daemon-handle in R2)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "What’s genuinely inert until R2: only the divergence" }),
				" — the ",
				createVNode(_components.code, { children: "outdated" }),
				" / ",
				createVNode(_components.code, { children: "dead" }),
				" states — because nothing can diverge from itself. Those branches are wired in A2 (the rail is divergence-capable) but cannot fire until ",
				createVNode(_components.code, { children: "pty" }),
				" is a separate surviving process. The only A2 cost is a few dead ",
				createVNode(_components.code, { children: "classList" }),
				" branches — paid down to zero the moment R2 lands, with no re-layout and no migration of the client component."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The rail sits in the ",
			createVNode(_components.strong, { children: "left identity cluster" }),
			" where the bare WebSocket dot used to be: it’s identity + liveness, not an action, so it groups with the logo, not the right-hand control cluster."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "wiring--three-hops",
			children: "Wiring — three hops"
		}),
		"\n",
		createVNode(_components.p, { children: "The rail is thin presentation, but the data takes three hops, because the client speaks kolu-server’s surface (over the WebSocket), not the pty-host’s:" }),
		"\n",
		createVNode($$D2, {
			caption: "A2 adds identity to the pty-host's system.version; kolu-server reads it once at boot and relays it onto its existing server.info (beside its OWN commit); the rail renders both columns from one client fact.",
			code: `direction: down
pty: "pty-host contract — ptyHostSurface" {
v: "system.version → { contractVersion, pid, startedAt, identity? }"
}
server: "kolu-server" {
info: "server.info → { commit (srv), ptyHost? (relayed identity) }"
}
client: "client — IdentityRail.tsx" {
rail: "srv ● <commit>  ·  pty ● <commit> <staleKey>  ≡ in-process"
}
pty.v -> server.info: "fetched once at boot (in-process = always fresh)"
server.info -> client.rail: "the existing one-shot server.info"
`
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
					createVNode(_components.th, { children: createVNode(_components.code, { children: "srv" }) }),
					"\n",
					createVNode(_components.th, { children: createVNode(_components.code, { children: "pty" }) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "liveness dot" }),
					"\n",
					createVNode(_components.td, { children: "WebSocket status (the consolidated dot)" }),
					"\n",
					createVNode(_components.td, { children: "in-process (A2) → daemon handle (R2)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "commit" }),
					"\n",
					createVNode(_components.td, { children: ["server’s ", createVNode(_components.code, { children: "KOLU_COMMIT_HASH" })] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "identity.navigableCommit" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "build" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "identity.staleKey" }), " (closure hash)"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "source" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "server.info" }), " (existing)"] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "system.version" }), " → relayed"] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Only ",
			createVNode(_components.code, { children: "pty" }),
			" carries a ",
			createVNode(_components.em, { children: "build" }),
			": the staleKey is the ",
			createVNode(_components.code, { children: "@kolu/pty-host" }),
			" closure hash, and it’s the only thing whose staleness matters across a restart — the server always restarts on deploy, so it has no “survives” staleness, just a commit."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Three constraints baked in: ",
			createVNode(_components.strong, { children: "(1)" }),
			" ",
			createVNode(_components.code, { children: "identity" }),
			" is ",
			createVNode(_components.strong, { children: "optional on the wire" }),
			" so an R2-phase older daemon isn’t force-restarted just to add a diagnostic (",
			createVNode(_components.code, { children: "PTY_HOST_CONTRACT_VERSION" }),
			" unbumped); ",
			createVNode(_components.strong, { children: "(2)" }),
			" ",
			createVNode(_components.code, { children: "currentBuildId" }),
			"/",
			createVNode(_components.code, { children: "currentCommitHash" }),
			" re-export as ",
			createVNode(_components.strong, { children: "values" }),
			", not ",
			createVNode(_components.code, { children: "import type" }),
			" — the regression that collapsed the typed client to ",
			createVNode(_components.code, { children: "unknown" }),
			"; ",
			createVNode(_components.strong, { children: "(3)" }),
			" the commit href is the ",
			createVNode(_components.strong, { children: "full SHA" }),
			" (display ",
			createVNode(_components.code, { children: "slice(0,7)" }),
			"), matching the recovered ",
			createVNode($$Commit, { sha: "3fd7ea63" }),
			" renderer and avoiding ambiguous-prefix edge cases."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "states",
			children: "States"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"In A2 the rail’s live axis is the WebSocket connection (the dot it absorbed). ",
			createVNode(_components.code, { children: "pty" }),
			" follows ",
			createVNode(_components.code, { children: "srv" }),
			" because it’s the same process — when the link is down the client can’t know anything, so ",
			createVNode(_components.code, { children: "pty" }),
			" reads ",
			createVNode(_components.em, { children: "unknown" }),
			", not a false green."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "State" }),
					"\n",
					createVNode(_components.th, { children: "Phase" }),
					"\n",
					createVNode(_components.th, { children: "Rendering" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Connected" }) }),
					"\n",
					createVNode(_components.td, { children: "live in A2" }),
					"\n",
					createVNode(_components.td, { children: [
						"WebSocket open · ",
						createVNode(_components.code, { children: "srv ≡ pty" }),
						" · both commits + build resolved · the ",
						createVNode(_components.code, { children: "≡ in-process" }),
						" tag"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Connecting / reconnecting" }) }),
					"\n",
					createVNode(_components.td, { children: "live in A2" }),
					"\n",
					createVNode(_components.td, { children: [
						"re-handshaking — both dots pulse amber, identity dimmed until the first yield (",
						createVNode(_components.code, { children: "srv connecting… · pty —" }),
						")"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Disconnected" }) }),
					"\n",
					createVNode(_components.td, { children: "live in A2" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "srv" }),
						" red; ",
						createVNode(_components.code, { children: "pty" }),
						" ",
						createVNode(_components.em, { children: "unknown" }),
						" (grey) — honest: with the link down we can’t claim pty state"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Update pending" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "done",
						children: "live · R2.4.4"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "kaval" }),
						" build ≠ the build the server would spawn → amber ",
						createVNode(_components.code, { children: "⬆ update" }),
						" via the read-site ",
						createVNode(_components.code, { children: "kavalStale(expected, reported, state)" }),
						" derivation, comparing the server’s ",
						createVNode(_components.code, { children: "buildInfo.expectedKaval.staleKey" }),
						" against the connected daemon’s reported ",
						createVNode(_components.code, { children: "daemonStatus.identity.staleKey" }),
						" (R2.4.4, ",
						createVNode($$PrLink, { pr: 1353 }),
						"). The nudge #1034 over-fired now fires only here."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Daemon dead" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "done",
						children: "live · R2.3"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "kaval" }),
						" handle closed → red (",
						createVNode(_components.code, { children: "daemon dead — restart" }),
						"). Pairs with the honest degraded canvas; never the empty-canvas lie. R2.4.2 (#1337) added the inline ",
						createVNode(_components.strong, { children: "Restart kaval" }),
						" button."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"No “dev / no-commit” state exists — kolu and kaval run ",
			createVNode(_components.strong, { children: "only under nix" }),
			", which always bakes both the server’s ",
			createVNode(_components.code, { children: "KOLU_COMMIT_HASH" }),
			" and kaval’s ",
			createVNode(_components.code, { children: "KAVAL_BUILD_ID" }),
			" / ",
			createVNode(_components.code, { children: "KAVAL_COMMIT_HASH" }),
			". There is no off-nix fallback to render."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "decisions-resolved-with-the-maintainer",
			children: "Decisions (resolved with the maintainer)"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Coincidence rendering" }),
				" — always two explicit columns + the ",
				createVNode(_components.code, { children: "≡ in-process" }),
				" tag; verbose/explicit is favoured until the feature stabilizes, no collapse-when-equal. ",
				createVNode(_components.strong, { children: "Revisited once the feature stabilized" }),
				" (R2.3/R2.4.4 shipped): the rail now shows the shared commit ",
				createVNode(_components.em, { children: "once" }),
				" instead of three times — ",
				createVNode(_components.code, { children: "client" }),
				" collapses to a muted ",
				createVNode(_components.code, { children: "≡" }),
				" when it matches, and ",
				createVNode(_components.code, { children: "kaval" }),
				"’s duplicate commit + closure-hash move into its panel — keeping the three columns but cutting the echo. See ",
				createVNode(_components.a, {
					href: "chrome-bar-declutter.html",
					children: "chrome-bar-declutter"
				}),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Labels" }),
				" — ",
				createVNode(_components.code, { children: "srv" }),
				" / ",
				createVNode(_components.code, { children: "pty" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Identity values" }),
				" — nix is first-class, no fallback: both values are nix-injected on the ",
				createVNode(_components.code, { children: "koluBin" }),
				" wrapper; no dev-derivation, no placeholder dance, no ",
				createVNode(_components.code, { children: "|| \"\"" }),
				" softening."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Closure scope" }),
				" — no severing, no excluded deps. The staleKey hashes the pty-host package’s own source closure — naturally tight (provider churn elsewhere can’t over-prompt) and complete for the package’s own wire+behaviour. The build-time test guards the one real regression: a wire/behaviour dependency landing ",
				createVNode(_components.em, { children: "outside" }),
				" the hashed package (the #1034 mis-scope) — it walks ",
				createVNode(_components.code, { children: "index.ts" }),
				"’s transitive imports and fails on any reached module that’s neither in-package nor on a small allowlist of stable framework/leaf deps."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"This design revised the parent plan’s “daemon chip lands in R2” stance: the identity + connection rail consolidates in ",
			createVNode(_components.strong, { children: "A2" }),
			" (honest, in-process), and ",
			createVNode(_components.strong, { children: "R2 adds only the divergence semantics" }),
			" to the existing ",
			createVNode(_components.code, { children: "pty" }),
			" column."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "ChromeBar identity rail (srv · client · kaval)",
	"description": "The consolidated connection + build/commit readout in the ChromeBar. A2 shipped it as two coinciding columns (srv = server, pty = the in-process pty-host); R2.3 overtook that shape — renaming pty → kaval as a separate spawned daemon and adding a client-bundle column — so the live rail is three columns (srv · client · kaval). This note keeps A2's original design rationale, annotated where R2.3 took over.",
	"parents": ["pty-daemon", "feature"],
	"status": "implemented",
	"maturity": "budding",
	"updated": "2026-06-21T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-design-call--two-explicit-columns-in-a2",
			"text": "The design call — two explicit columns in A2"
		},
		{
			"depth": 2,
			"slug": "wiring--three-hops",
			"text": "Wiring — three hops"
		},
		{
			"depth": 2,
			"slug": "states",
			"text": "States"
		},
		{
			"depth": 2,
			"slug": "decisions-resolved-with-the-maintainer",
			"text": "Decisions (resolved with the maintainer)"
		}
	];
}
var url = "src/content/atlas/pty-daemon-chrome-bar.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pty-daemon-chrome-bar.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pty-daemon-chrome-bar.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
