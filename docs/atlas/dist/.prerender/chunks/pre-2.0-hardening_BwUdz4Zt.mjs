import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$Issue } from "./Issue_mLFqCJSR.mjs";
//#region src/content/atlas/pre-2.0-hardening.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		del: "del",
		em: "em",
		h2: "h2",
		h3: "h3",
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
			"One rule: fix what a user would ",
			createVNode(_components.em, { children: "feel" }),
			". ✅ done · 🔶 in flight · ⬜ not started."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "-red-alert--blocks-the-tag",
			children: "🔴 Red alert — blocks the tag"
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
					createVNode(_components.th, { children: "Issue" }),
					"\n",
					createVNode(_components.th, { children: "What the user feels" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "🔶" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1334 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Kolu’s own dev/test can ",
						createVNode(_components.strong, { children: "kill the live kolu you are using" }),
						" — daemons reaped, terminals lost. PR #1911 ",
						createVNode(_components.strong, { children: "closed after adversarial review" }),
						" (srid, 2026-07-21); rebuild plan of record: ",
						createVNode(_components.a, {
							href: "./state-isolation.html",
							children: "state isolation"
						}),
						" (SI1 gate-leak fix → SI2 the lock). Wire-verb bypass split to ",
						createVNode($$Issue, { n: 1912 }),
						"; ",
						createVNode(_components.a, {
							href: "./host-isolation-locks.html",
							children: "the locks, in plain words"
						}),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "✅" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1375 }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.del, { children: [
							"A local ",
							createVNode(_components.code, { children: "vitest" }),
							" run forks 30+ real daemons and OOM-reaps prod kaval"
						] }),
						" — real-daemon suites are ",
						createVNode(_components.strong, { children: "off by default" }),
						" now. (PR #1921)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "✅" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1754 }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.del, { children: [
							"The dock says ",
							createVNode(_components.strong, { children: "“thinking” forever" }),
							" after the agent already finished"
						] }),
						" — append-poll floor under fs.watch. (PR #1914, deliberately ",
						createVNode(_components.code, { children: "Refs" }),
						" not ",
						createVNode(_components.code, { children: "Closes" }),
						": the issue stays open until the e2e asserts descoped in PR #1751 are restored by a follow-up once #1751 merges.)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "✅" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1859 }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.del, { children: "One corrupt message makes a connection play dead while it keeps listening" }), " — “settled ⟹ stopped” holds by construction. (PR #1901)"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "✅" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1900 }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.del, { children: "Refresh yanks you to another host with a lying toast" }), " — boot honors the consumed stamp; the gone-verdict waits for an authoritative census. (PR #1903)"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "✅" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1177 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"An agent that needs you ",
						createVNode(_components.strong, { children: "always chimes" }),
						" now. (PR #1894)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "✅" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1763 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"“Connecting to local…” ",
						createVNode(_components.strong, { children: "can no longer spin forever" }),
						" — a stuck boot names its failure and offers Reload. (PR #1898)"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "pr-1911--closed-after-review-2026-07-21",
			children: "PR #1911 — closed after review (2026-07-21)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Adversarial review (11 hunters, refuter-verified) found the lock core sound\nbut only ~52% of the 1,483 added lines serving it — the rest was role markers\nnothing reads (their reader was rejected to ",
			createVNode($$Issue, { n: 1912 }),
			") plus kaval\nmachinery closing a window the PR itself opened; both ssh e2e lanes broke\ninvisibly. srid ruled: ",
			createVNode(_components.strong, { children: "close and rebuild lock-only." }),
			" The plan of record —\nSI1 (padi gate-leak fix, the one treasure extracted) then SI2 (the lock: padi"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"server + nix, zero kaval) — lives in ",
				createVNode(_components.strong, { children: createVNode(_components.a, {
					href: "./state-isolation.html",
					children: "state\nisolation"
				}) }),
				"; the full verdict is on the closed PR."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "-yellow-alert--land-next",
			children: "🟡 Yellow alert — land next"
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
					createVNode(_components.th, { children: "Issue" }),
					"\n",
					createVNode(_components.th, { children: "What the user feels" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1658 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"A bad write could ",
						createVNode(_components.strong, { children: "lose all your terminals and sessions" }),
						" — back up state on start."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1667 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Closing the last terminals can ",
						createVNode(_components.strong, { children: "focus a dead one" }),
						". Fix PR #1677 already open — land it."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1666 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Removing a worktree ",
						createVNode(_components.strong, { children: "strands its running terminal" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1680 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"On a remote mac, agent state ",
						createVNode(_components.strong, { children: "freezes silently" }),
						" until restart."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1076 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"A terminal is left ",
						createVNode(_components.strong, { children: "frozen" }),
						" (raw mode) after a TUI app exits."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1875 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"A reconnect race can ",
						createVNode(_components.strong, { children: "dial the same host twice" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1701 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Branch-mode Code tab is ",
						createVNode(_components.strong, { children: "dead over a remote host" }),
						" (“base branch not found” for one that exists)."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1715 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"A wire naming collision can ",
						createVNode(_components.strong, { children: "cross two channels’ data" }),
						" — silent landmine."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1668 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"A file deleted at the wrong moment shows ",
						createVNode(_components.strong, { children: "“Loading…” forever" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1492 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Waking a sleeping terminal ",
						createVNode(_components.strong, { children: "doesn’t resume" }),
						" a ",
						createVNode(_components.code, { children: "nix run" }),
						" agent."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "-condition-green--recurrence-guards",
			children: "🟢 Condition green — recurrence guards"
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
					createVNode(_components.th, { children: "Issue" }),
					"\n",
					createVNode(_components.th, { children: "What it prevents" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Issue, { n: 1706 }),
						" + ",
						createVNode($$Issue, { n: 1693 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Regenerated agent skills silently ",
						createVNode(_components.strong, { children: "regressing to a stale commit" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1707 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Big pastes to a Claude terminal ",
						createVNode(_components.strong, { children: "not submitting" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1885 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"A renew toast that ",
						createVNode(_components.strong, { children: "lies about success" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1339 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"An ",
						createVNode(_components.strong, { children: "opaque 30s hang" }),
						" where a one-line refusal reason exists."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Issue, { n: 1679 }),
						" + ",
						createVNode($$Issue, { n: 1695 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"The two remote-padi ",
						createVNode(_components.strong, { children: "test flakes" }),
						"."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "verify--close--fix-already-shipped-confirm-it",
			children: "Verify & close — fix already shipped, confirm it"
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
					createVNode(_components.th, { children: "Issue" }),
					"\n",
					createVNode(_components.th, { children: "The fact" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 1681 }) }),
					"\n",
					createVNode(_components.td, { children: "Gray-chip fix merged 2026-07-05 (#1687), no recurrence since. Confirm, close." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "⬜" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Issue, { n: 901 }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Kaval survivors ",
						createVNode(_components.em, { children: "are" }),
						" this feature — redeploys don’t kill PTYs. Confirm, close."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "✅" }),
					"\n",
					createVNode(_components.td, { children: "#1793" }),
					"\n",
					createVNode(_components.td, { children: "Closed — presence-only dialogs (#1892)." }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "deferred-past-20",
			children: "Deferred past 2.0"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Features (",
			createVNode($$Issue, { n: 1240 }),
			", ",
			createVNode($$Issue, { n: 1218 }),
			", ",
			createVNode($$Issue, { n: 1295 }),
			") · render\npolish (",
			createVNode($$Issue, { n: 1305 }),
			" / ",
			createVNode($$Issue, { n: 1306 }),
			") · no-current-victim ledgers\n(",
			createVNode($$Issue, { n: 1688 }),
			", ",
			createVNode($$Issue, { n: 1863 }),
			") · ",
			createVNode($$Issue, { n: 706 }),
			" full containment\n(needs a VM) · the campaign-surface build-out."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "One-thing cut",
			children: createVNode(_components.p, { children: [
				"If only one lands: ",
				createVNode(_components.strong, { children: [
					"the ",
					createVNode($$Issue, { n: 1334 }),
					" state-root lock."
				] }),
				" Everything\nelse degrades the experience; that one can eat your prod instance."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "standing-facts-coordinator",
			children: "Standing facts (coordinator)"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "#" }),
					"\n",
					createVNode(_components.th, { children: "Fact" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "1" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "CI venue law." }),
						" ",
						createVNode(_components.code, { children: "~/.config/odu/hosts.json" }),
						" on the coordinator’s machine must name real venues: ",
						createVNode(_components.code, { children: "aarch64-darwin" }),
						" → rasam (",
						createVNode(_components.code, { children: "nix-infra@rasam.tail12b27.ts.net" }),
						"); ",
						createVNode(_components.strong, { children: "no x86_64-linux venue exists yet" }),
						" — once pureintent retires from agent duty it is the natural candidate. odu ≥ #47 fails fast when the config is missing (never silent localhost). Workers must verify ",
						createVNode(_components.code, { children: "host ≠ localhost" }),
						" in run records before claiming CI."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "2" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "The watcher era should end." }),
						" ",
						createVNode($$Issue, { n: 1904 }),
						" (kolu MCP standing subscription / supervision-edge delivery) exists because hand-rolled watcher agents dropped worker reports at four seams in one day. Until it lands: every dispatched ask gets a listener attached in the same breath, re-attached after every restart."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "3" }),
					"\n",
					createVNode(_components.td, { children: "Standing law unchanged: srid merges all PRs; full /be for every code PR (docs-only exempt); no pattern kills; reproduce-first per #1690; adversarial gate before fix code, every time." }),
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
	"title": "Pre-2.0 hardening — the shortlist",
	"description": "Ship-status board for the 2.0 tag: what can hurt the user, in their words, with a mark per item. ✅ done · 🔶 in flight · ⬜ not started.",
	"parents": ["analysis", "roadmap"],
	"status": "proposed",
	"maturity": "budding",
	"updated": "2026-07-21T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "-red-alert--blocks-the-tag",
			"text": "🔴 Red alert — blocks the tag"
		},
		{
			"depth": 3,
			"slug": "pr-1911--closed-after-review-2026-07-21",
			"text": "PR #1911 — closed after review (2026-07-21)"
		},
		{
			"depth": 2,
			"slug": "-yellow-alert--land-next",
			"text": "🟡 Yellow alert — land next"
		},
		{
			"depth": 2,
			"slug": "-condition-green--recurrence-guards",
			"text": "🟢 Condition green — recurrence guards"
		},
		{
			"depth": 2,
			"slug": "verify--close--fix-already-shipped-confirm-it",
			"text": "Verify & close — fix already shipped, confirm it"
		},
		{
			"depth": 2,
			"slug": "deferred-past-20",
			"text": "Deferred past 2.0"
		},
		{
			"depth": 2,
			"slug": "standing-facts-coordinator",
			"text": "Standing facts (coordinator)"
		}
	];
}
var url = "src/content/atlas/pre-2.0-hardening.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pre-2.0-hardening.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pre-2.0-hardening.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
