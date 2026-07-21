import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Issue } from "./Issue_mLFqCJSR.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/diagrams/state-isolation-lock.svg?raw
var state_isolation_lock_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 980 330\" font-family=\"ui-sans-serif, system-ui, sans-serif\" font-size=\"14\">\n  <defs>\n    <marker id=\"arr\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M 0 0 L 10 5 L 0 10 z\" fill=\"#64748b\"/>\n    </marker>\n    <marker id=\"arr-g\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M 0 0 L 10 5 L 0 10 z\" fill=\"#16a34a\"/>\n    </marker>\n    <marker id=\"arr-r\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M 0 0 L 10 5 L 0 10 z\" fill=\"#dc2626\"/>\n    </marker>\n  </defs>\n\n  <!-- who supplies the path -->\n  <g>\n    <rect x=\"30\" y=\"36\" width=\"250\" height=\"60\" rx=\"8\" fill=\"#f59e0b\" fill-opacity=\"0.12\" stroke=\"#f59e0b\" stroke-width=\"1.5\"/>\n    <text x=\"155\" y=\"60\" text-anchor=\"middle\" fill=\"#b45309\" font-weight=\"600\">production: the nix wrapper</text>\n    <text x=\"155\" y=\"80\" text-anchor=\"middle\" fill=\"#b45309\" font-size=\"11\">KOLU_PADI_STATE_DIR=&#36;{…:-~/.local/state/padi}</text>\n\n    <rect x=\"30\" y=\"112\" width=\"250\" height=\"60\" rx=\"8\" fill=\"#f59e0b\" fill-opacity=\"0.12\" stroke=\"#f59e0b\" stroke-width=\"1.5\"/>\n    <text x=\"155\" y=\"136\" text-anchor=\"middle\" fill=\"#b45309\" font-weight=\"600\">remote: same wrapper, in the</text>\n    <text x=\"155\" y=\"156\" text-anchor=\"middle\" fill=\"#b45309\" font-size=\"11\">nix closure the binder ships (remote $HOME)</text>\n\n    <rect x=\"30\" y=\"188\" width=\"250\" height=\"60\" rx=\"8\" fill=\"#f59e0b\" fill-opacity=\"0.12\" stroke=\"#f59e0b\" stroke-width=\"1.5\"/>\n    <text x=\"155\" y=\"212\" text-anchor=\"middle\" fill=\"#b45309\" font-weight=\"600\">dev / tests: private paths</text>\n    <text x=\"155\" y=\"232\" text-anchor=\"middle\" fill=\"#b45309\" font-size=\"11\">.kolu-dev/padi · tmp dirs · --state-root</text>\n  </g>\n\n  <line x1=\"280\" y1=\"66\" x2=\"366\" y2=\"130\" stroke=\"#64748b\" stroke-width=\"1.5\" marker-end=\"url(#arr)\"/>\n  <line x1=\"280\" y1=\"142\" x2=\"366\" y2=\"146\" stroke=\"#64748b\" stroke-width=\"1.5\" marker-end=\"url(#arr)\"/>\n  <line x1=\"280\" y1=\"218\" x2=\"366\" y2=\"162\" stroke=\"#64748b\" stroke-width=\"1.5\" marker-end=\"url(#arr)\"/>\n\n  <!-- the resolution -->\n  <rect x=\"370\" y=\"100\" width=\"290\" height=\"92\" rx=\"10\" fill=\"#8b5cf6\" fill-opacity=\"0.10\" stroke=\"#8b5cf6\" stroke-width=\"2\"/>\n  <text x=\"515\" y=\"130\" text-anchor=\"middle\" fill=\"#6d28d9\" font-weight=\"700\">binding resolution</text>\n  <text x=\"515\" y=\"152\" text-anchor=\"middle\" fill=\"#6d28d9\" font-size=\"12\">REQUIRES a path — there is no default</text>\n  <text x=\"515\" y=\"171\" text-anchor=\"middle\" fill=\"#6d28d9\" font-size=\"12\">in the code (mirrors KOLU_STATE_DIR)</text>\n\n  <!-- outcomes -->\n  <rect x=\"700\" y=\"70\" width=\"250\" height=\"60\" rx=\"8\" fill=\"#16a34a\" fill-opacity=\"0.10\" stroke=\"#16a34a\" stroke-width=\"1.5\"/>\n  <text x=\"825\" y=\"94\" text-anchor=\"middle\" fill=\"#15803d\" font-weight=\"600\">path supplied → binds</text>\n  <text x=\"825\" y=\"114\" text-anchor=\"middle\" fill=\"#15803d\" font-size=\"12\">the path was chosen out loud</text>\n  <line x1=\"660\" y1=\"126\" x2=\"694\" y2=\"106\" stroke=\"#16a34a\" stroke-width=\"1.8\" marker-end=\"url(#arr-g)\"/>\n\n  <rect x=\"700\" y=\"162\" width=\"250\" height=\"60\" rx=\"8\" fill=\"#dc2626\" fill-opacity=\"0.10\" stroke=\"#dc2626\" stroke-width=\"1.5\"/>\n  <text x=\"825\" y=\"186\" text-anchor=\"middle\" fill=\"#b91c1c\" font-weight=\"600\">no path → CRASH</text>\n  <text x=\"825\" y=\"206\" text-anchor=\"middle\" fill=\"#b91c1c\" font-size=\"12\">one line naming KOLU_PADI_STATE_DIR</text>\n  <line x1=\"660\" y1=\"166\" x2=\"694\" y2=\"186\" stroke=\"#dc2626\" stroke-width=\"1.8\" marker-end=\"url(#arr-r)\"/>\n\n  <!-- out of scope -->\n  <rect x=\"30\" y=\"276\" width=\"920\" height=\"38\" rx=\"8\" fill=\"none\" stroke=\"#94a3b8\" stroke-width=\"1.5\" stroke-dasharray=\"6 4\"/>\n  <text x=\"490\" y=\"299\" text-anchor=\"middle\" fill=\"#64748b\" font-size=\"12\">no KOLU_ROLE · no role.ts · no markers · kaval untouched — deferred: wire verbs (#1912) · remote-dev residual · half-relocated refusal</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/state-isolation.mdx
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
			"A daemon’s identity is the digest of its state-root, and\n",
			createVNode(_components.code, { children: "resolvePadiStateRoot()" }),
			" silently defaults to production’s root — so a bare\n",
			createVNode(_components.code, { children: "pnpm dev" }),
			" / ",
			createVNode(_components.code, { children: "vitest" }),
			" / ",
			createVNode(_components.code, { children: "padi" }),
			" computes production’s identity and the\nadopt/kill machinery can then act on the live kolu (",
			createVNode($$Issue, { n: 1334 }),
			";\n",
			createVNode(_components.a, {
				href: "./host-isolation-locks.html",
				children: "background"
			}),
			"). The first fix,\n",
			createVNode($$PrLink, { pr: 1911 }),
			", was closed after review for shipping the guard inside\nhalf a PR of machinery.",
			createVNode($$Footnote, { children: "Review scars this plan keeps: no role stamps\nwithout a reader (that killed #1911); zero kaval changes; both ssh e2e lanes\nbroke invisibly because CI has no ssh. Full verdict on the closed\nPR." }),
			" This is the rebuild — resized twice by srid/grok’s challenges\n(PR #1930 thread): first lock-only, then ",
			createVNode(_components.strong, { children: "no lock at all where deleting the\ndefault suffices" }),
			". Work items carry the ",
			createVNode(_components.strong, { children: "SI" }),
			" prefix for reference: SI1 a\nsmall prerequisite bug fix, SI2 the fix itself."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-fix--there-is-no-default",
			children: "The fix — there is no default"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The path is chosen out loud, or the process dies." }),
			" Mirror the server’s own\n",
			createVNode(_components.code, { children: "KOLU_STATE_DIR" }),
			" pattern exactly: binding resolution ",
			createVNode(_components.strong, { children: "requires" }),
			"\n",
			createVNode(_components.code, { children: "KOLU_PADI_STATE_DIR" }),
			" / ",
			createVNode(_components.code, { children: "--state-root" }),
			" and crashes with one line when absent;\nthe production nix wrapper supplies the default\n(",
			createVNode(_components.code, { children: "KOLU_PADI_STATE_DIR=\"${KOLU_PADI_STATE_DIR:-$HOME/.local/state/padi}\"" }),
			",\nbeside its existing ",
			createVNode(_components.code, { children: "KOLU_STATE_DIR" }),
			" line); dev and tests keep setting the\nprivate paths they already set. The remote padi is a nix-realised closure the\nbinder ships, so the ",
			createVNode(_components.strong, { children: "same wrapper supplies the remote default remote-side" }),
			"\n— no signal needs to cross the wire."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: state_isolation_lock_default,
			wide: true,
			caption: "No guard, no badge: the default is deleted from code. Whoever launches padi supplies the path — the production wrapper (locally and inside the shipped remote closure), or a dev/test's private dir — and an unsupplied path is a one-line crash."
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Why this beats #1911’s guarded default: a guard refuses the accident at the\nthree call sites it covers and relocates it to the fourth; deleting the\ndefault makes the accident ",
			createVNode(_components.strong, { children: "unspellable" }),
			" — there is nothing left to\ninherit.",
			createVNode($$Footnote, { children: [
				"Two mechanics verified at the tree: the PTY spawn allowlist\nwholesale-scrubs the ",
				createVNode(_components.code, { children: "KOLU_*" }),
				" namespace from hosted shells\n(",
				createVNode(_components.code, { children: "integrations/pty/src/shell.ts" }),
				", ",
				createVNode(_components.code, { children: "koluInternalEnv" }),
				"), so the wrapper’s export\ncannot leak into a terminal kolu hosts; and the remote ",
				createVNode(_components.code, { children: "padi" }),
				" runs from a\nprovisioned nix closure (",
				createVNode(_components.code, { children: "surface-remote/src/dialAgentOnce.ts" }),
				" — “executable\nname inside the realised closure”), so wrapping it is entirely kolu’s to do.\nWith those two, ",
				createVNode(_components.code, { children: "KOLU_ROLE" }),
				" — and the role module, markers, ",
				createVNode(_components.code, { children: "--role" }),
				"\nthreading — do no remaining work; the earlier “keep the env var” ruling\ncompared the wrong alternative (deriving role from the config dir) and is\nsuperseded."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Named residuals, accepted (today’s behavior, unchanged):" }),
			" a ",
			createVNode(_components.em, { children: "deliberate" }),
			"\n",
			createVNode(_components.code, { children: "KOLU_PADI_STATE_DIR" }),
			" pointed at production’s path is the same footgun as\n",
			createVNode(_components.code, { children: "rm" }),
			" on the real tree — out of the accident threat model; a dev kolu-server\nbinding a ",
			createVNode(_components.em, { children: "remote" }),
			" host without ",
			createVNode(_components.code, { children: "KOLU_REMOTE_PADI_STATE_DIR" }),
			" reaches the\nremote wrapper’s default — deferred with ",
			createVNode($$Issue, { n: 1912 }),
			"’s wire-verb work;\na half-relocated production (relocated ",
			createVNode(_components.code, { children: "KOLU_STATE_DIR" }),
			", unset padi root)\nsilently keeps the default padi root — “wrapper sets both or refuses” is an\noptional later hardening."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "si1--padi-releases-its-boot-gate-on-a-startup-throw",
			children: "SI1 — padi releases its boot gate on a startup throw"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A normal small bug fix, listed only because SI2 touches the same startup code\nand lands on top of it. On master, padi acquires its single-instance gate,\nthen runs several throwable boot steps; on a throw the gate is never\nreleased, so an in-process retry reads “already running” forever. Fix:\nrelease the gate in the catch after awaiting the partial runtime’s close\n(",
			createVNode(_components.code, { children: "Promise.allSettled" }),
			", not a hand-rolled settle); test trigger\nmaster-reachable (e.g. malformed ",
			createVNode(_components.code, { children: "KOLU_DAEMON_BIND_PID" }),
			"). Done when a boot\nthrow leaves the gate file gone and a same-process re-acquire succeeds."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "si2--delete-the-default",
			children: "SI2 — delete the default"
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
					createVNode(_components.th, { children: "Contract" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "stateRoot.ts" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"The ",
						createVNode(_components.strong, { children: "bind-path" }),
						" resolution loses its default: unset + no override → one-line crash naming ",
						createVNode(_components.code, { children: "KOLU_PADI_STATE_DIR" }),
						" (the ",
						createVNode(_components.code, { children: "state.ts" }),
						" pattern). Read-only discovery (",
						createVNode(_components.code, { children: "resolveRunningPadiSocket" }),
						", the TUIs) is untouched."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "default.nix" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"The kolu wrapper exports ",
						createVNode(_components.code, { children: "KOLU_PADI_STATE_DIR=\"${KOLU_PADI_STATE_DIR:-$HOME/.local/state/padi}\"" }),
						" beside its ",
						createVNode(_components.code, { children: "KOLU_STATE_DIR" }),
						" line; the padi package shipped to remotes gets the same wrapper."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "stdioBridge" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Made ",
						createVNode(_components.code, { children: "async" }),
						" so the missing-path crash reaches ",
						createVNode(_components.code, { children: "bin.ts" }),
						"’s one error channel as the clean one-line message."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Entrypoint sweep" }),
					"\n",
					createVNode(_components.td, { children: [
						"Every dev/test/e2e path that boots a binder without the var gets it set (most already do: ",
						createVNode(_components.code, { children: "kolu-cli" }),
						" dev, ",
						createVNode(_components.code, { children: "justfile" }),
						", server tests). The crash is the detector — any missed one fails loud, never binds production."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Docs" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "padi --help" }), ": the root is required (the production wrapper supplies the default); README claims exactly what shipped — no adopt/SIGTERM language."] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Done when" }),
			", beyond green CI: ",
			createVNode(_components.code, { children: "just e2e-ssh" }),
			" ",
			createVNode(_components.strong, { children: "run once and passing" }),
			" — CI\nhas no ssh; #1911 shipped 38/38 green with both ssh lanes broken (under this\nshape the lanes should pass via the remote closure’s wrapper — prove it) —\nand the ",
			createVNode($$Issue, { n: 1334 }),
			" repro re-run: a bare ",
			createVNode(_components.code, { children: "pnpm dev" }),
			" / ",
			createVNode(_components.code, { children: "vitest" }),
			" /\n",
			createVNode(_components.code, { children: "padi" }),
			" beside a live production kolu dies naming the missing var."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "deferred-until-a-real-residual-shows",
			children: "Deferred until a real residual shows"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Wire-verb guard" }),
				" (",
				createVNode($$Issue, { n: 1912 }),
				"): ",
				createVNode(_components.code, { children: "kill" }),
				"/",
				createVNode(_components.code, { children: "killAll" }),
				"/",
				createVNode(_components.code, { children: "restart" }),
				" on a\nlive socket, plus the remote-dev-binder residual above. Any role/badge\nvocabulary, if ever needed, lands there ",
				createVNode(_components.strong, { children: "with" }),
				" its reader."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Persistent markers, relocated-root hardening" }),
				" (",
				createVNode($$Issue, { n: 1414 }),
				"): only\nif the half-relocated footgun proves real."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Sequencing",
			children: createVNode(_components.p, { children: [
				"SI1 (plain bug fix) → SI2 (closes ",
				createVNode($$Issue, { n: 1334 }),
				"). srid merges each;\nreview depth per PR is srid’s call."
			] })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "State Isolation — Plan of Record",
	"description": "Dev/test can never sit in production's chair: delete the padi state-root default; the path is chosen out loud or the process dies. No role vocabulary. Rebuilt after PR #1911 was closed.",
	"parents": ["bug"],
	"status": "proposed",
	"maturity": "budding",
	"updated": "2026-07-21T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-fix--there-is-no-default",
			"text": "The fix — there is no default"
		},
		{
			"depth": 2,
			"slug": "si1--padi-releases-its-boot-gate-on-a-startup-throw",
			"text": "SI1 — padi releases its boot gate on a startup throw"
		},
		{
			"depth": 2,
			"slug": "si2--delete-the-default",
			"text": "SI2 — delete the default"
		},
		{
			"depth": 2,
			"slug": "deferred-until-a-real-residual-shows",
			"text": "Deferred until a real residual shows"
		}
	];
}
var url = "src/content/atlas/state-isolation.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/state-isolation.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/state-isolation.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
