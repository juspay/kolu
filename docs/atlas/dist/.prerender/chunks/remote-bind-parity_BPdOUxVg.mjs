import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/diagrams/remote-bind-parity-map.svg?raw
var remote_bind_parity_map_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 960 300\" font-family=\"inherit\" role=\"img\" aria-label=\"The remote-bind parity tail: 494 scenarios split into pass, skips, and four failure classes, each with a destination\"><defs><marker id=\"a2\" viewBox=\"0 0 8 8\" refX=\"7\" refY=\"4\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M 0 0 L 8 4 L 0 8 z\" fill=\"currentColor\" opacity=\"0.7\"/></marker></defs><rect x=\"28\" y=\"26\" width=\"180\" height=\"60\" rx=\"8\" fill=\"#22a06b\" fill-opacity=\"0.12\" stroke=\"#22a06b\" stroke-width=\"1.4\"/><text x=\"118.0\" y=\"43\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"700\" fill=\"currentColor\">444 pass over the bind</text><text x=\"118.0\" y=\"58\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">the suite mostly works</text><text x=\"118.0\" y=\"70\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">remotely already</text><rect x=\"28\" y=\"106\" width=\"180\" height=\"60\" rx=\"8\" fill=\"#3b82f6\" fill-opacity=\"0.12\" stroke=\"#3b82f6\" stroke-width=\"1.4\"/><text x=\"118.0\" y=\"123\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"700\" fill=\"currentColor\">9 skipped — R1</text><text x=\"118.0\" y=\"138\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">branch-mode Code tab</text><text x=\"118.0\" y=\"150\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">#1701, counted markers</text><rect x=\"28\" y=\"186\" width=\"180\" height=\"74\" rx=\"8\" fill=\"#d64545\" fill-opacity=\"0.1\" stroke=\"#d64545\" stroke-width=\"1.4\"/><text x=\"118.0\" y=\"203\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"700\" fill=\"currentColor\">~30 fail — the tail</text><text x=\"118.0\" y=\"218\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">pre-existing, never seen:</text><text x=\"118.0\" y=\"230\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">earlier runs died on zombies</text><text x=\"118.0\" y=\"242\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">+ git identity first</text><rect x=\"320\" y=\"26\" width=\"180\" height=\"56\" rx=\"8\" fill=\"#d64545\" fill-opacity=\"0.1\" stroke=\"#d64545\" stroke-width=\"1.4\"/><text x=\"410.0\" y=\"43\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"700\" fill=\"currentColor\">R2 · load-interaction</text><text x=\"410.0\" y=\"58\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">all 21 PASS in isolation —</text><text x=\"410.0\" y=\"70\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">fail only under full-suite load</text><rect x=\"320\" y=\"100\" width=\"180\" height=\"56\" rx=\"8\" fill=\"#c08a2d\" fill-opacity=\"0.1\" stroke=\"#c08a2d\" stroke-width=\"1.4\"/><text x=\"410.0\" y=\"117\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"700\" fill=\"currentColor\">R3 · meaningless remotely</text><text x=\"410.0\" y=\"132\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">kaval-daemon local-lifecycle</text><text x=\"410.0\" y=\"144\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">scenarios (5)</text><rect x=\"320\" y=\"174\" width=\"180\" height=\"56\" rx=\"8\" fill=\"#a855f7\" fill-opacity=\"0.1\" stroke=\"#a855f7\" stroke-width=\"1.4\"/><text x=\"410.0\" y=\"191\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"700\" fill=\"currentColor\">R4 · creation races → R2</text><text x=\"410.0\" y=\"206\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">&quot;created but no new id&quot;</text><text x=\"410.0\" y=\"218\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">load-bin, not a race, not L10</text><rect x=\"320\" y=\"244\" width=\"180\" height=\"44\" rx=\"8\" fill=\"#8b8b8b\" fill-opacity=\"0.08\" stroke=\"#8b8b8b\" stroke-width=\"1.4\"/><text x=\"410.0\" y=\"261\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"700\" fill=\"currentColor\">plain flakes</text><text x=\"410.0\" y=\"276\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">fail locally too</text><rect x=\"620\" y=\"26\" width=\"300\" height=\"56\" rx=\"8\" fill=\"#d64545\" fill-opacity=\"0.1\" stroke=\"#d64545\" stroke-width=\"1.4\"/><text x=\"770.0\" y=\"43\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"700\" fill=\"currentColor\">ONE dig: find the load source</text><text x=\"770.0\" y=\"58\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">slow -&gt; scenario-scoped widen, with numbers</text><text x=\"770.0\" y=\"70\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">broken -&gt; a product bug like #1701</text><rect x=\"620\" y=\"100\" width=\"300\" height=\"56\" rx=\"8\" fill=\"#c08a2d\" fill-opacity=\"0.1\" stroke=\"#c08a2d\" stroke-width=\"1.4\"/><text x=\"770.0\" y=\"117\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"700\" fill=\"currentColor\">decide the remote STORY, each</text><text x=\"770.0\" y=\"132\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">skip-with-reason is fine only once the</text><text x=\"770.0\" y=\"144\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">remote answer is named (e.g. #1686 covers it)</text><rect x=\"620\" y=\"174\" width=\"300\" height=\"56\" rx=\"8\" fill=\"#a855f7\" fill-opacity=\"0.1\" stroke=\"#a855f7\" stroke-width=\"1.4\"/><text x=\"770.0\" y=\"191\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"700\" fill=\"currentColor\">covered by R2&apos;s load dig</text><text x=\"770.0\" y=\"206\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">remote-race -&gt; bug · flake -&gt; L10</text><rect x=\"620\" y=\"244\" width=\"300\" height=\"44\" rx=\"8\" fill=\"#8b8b8b\" fill-opacity=\"0.08\" stroke=\"#8b8b8b\" stroke-width=\"1.4\"/><text x=\"770.0\" y=\"261\" text-anchor=\"middle\" font-size=\"11.5\" font-weight=\"700\" fill=\"currentColor\">ledger L10 (flaky debt)</text><text x=\"770.0\" y=\"276\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"currentColor\" opacity=\"0.8\">already tracked there</text><path d=\"M 208 216 L 312 54\" stroke=\"currentColor\" stroke-width=\"1.3\" fill=\"none\" opacity=\"0.65\" marker-end=\"url(#a2)\"/><text x=\"264.0\" y=\"129.0\" text-anchor=\"middle\" font-size=\"9\" fill=\"currentColor\" opacity=\"0.7\">triage</text><path d=\"M 208 222 L 312 128\" stroke=\"currentColor\" stroke-width=\"1.3\" fill=\"none\" opacity=\"0.65\" marker-end=\"url(#a2)\"/><path d=\"M 208 228 L 312 202\" stroke=\"currentColor\" stroke-width=\"1.3\" fill=\"none\" opacity=\"0.65\" marker-end=\"url(#a2)\"/><path d=\"M 208 234 L 312 266\" stroke=\"currentColor\" stroke-width=\"1.3\" fill=\"none\" opacity=\"0.65\" marker-end=\"url(#a2)\"/><path d=\"M 500 54 L 612 54\" stroke=\"currentColor\" stroke-width=\"1.3\" fill=\"none\" opacity=\"0.65\" marker-end=\"url(#a2)\"/><path d=\"M 500 128 L 612 128\" stroke=\"currentColor\" stroke-width=\"1.3\" fill=\"none\" opacity=\"0.65\" marker-end=\"url(#a2)\"/><path d=\"M 500 202 L 612 202\" stroke=\"currentColor\" stroke-width=\"1.3\" fill=\"none\" opacity=\"0.65\" marker-end=\"url(#a2)\"/><path d=\"M 500 266 L 612 266\" stroke=\"currentColor\" stroke-width=\"1.3\" fill=\"none\" opacity=\"0.65\" marker-end=\"url(#a2)\"/></svg>";
//#endregion
//#region src/content/atlas/remote-bind-parity.mdx
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
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "What this note is." }),
			" W3.4 built the CI machinery to run kolu’s FULL e2e suite (494 scenarios) against a genuinely remote padi — and the first clean run told the truth: ",
			createVNode(_components.strong, { children: "444 pass, 9 are one known bug, and ~30 more fail for reasons nobody had ever seen" }),
			", because every earlier run died on infrastructure (the zombie leak, the missing git identity) before reaching a clean full pass. Those ~30 are ",
			createVNode(_components.strong, { children: "pre-existing" }),
			" — no recent merge caused them. This note holds the whole tail in one place so each item can be worked separately; when everything here is closed, “kolu fully works over a remote bind” is simply true, and the W3.4 gate (#1689) turns on with a green that means something. (Plan of record: ",
			createVNode(_components.a, {
				href: "padi.html",
				children: "padi"
			}),
			"; the future features this gates: ",
			createVNode(_components.a, {
				href: "remote-terminals-future.html",
				children: "remote-terminals-future"
			}),
			".)",
			createVNode($$Footnote, { children: [
				"Run data: merged head ",
				createVNode(_components.code, { children: "4481401" }),
				" — 494 scenarios, 444 passed, 9 skipped (all branch-mode, ",
				createVNode(_components.code, { children: "REMOTE-SKIP-1701" }),
				" markers, the parity counter validates them), 41 failed; the pre-merge run failed 39+9-overlapping, so the delta is flaky variance, not the merge. Spread: 21 features — code-tab 12, canvas 9, kaval-daemon 5, activity-alerts 4, worktree / sleeping-terminals / mobile-soft-keyboard / file-ref-link 3 each, long tail. Box B’s padi stayed healthy throughout (no crashes, no convergence errors, zombies flat)."
			] })
		] }),
		"\n",
		createVNode($$Svg, {
			svg: remote_bind_parity_map_default,
			wide: true,
			caption: "The first honest full-suite run over the bind, triaged. Each failure class has a different destination — the one forbidden move is a blanket skip or a blanket timeout-widen, either of which would bury real bugs."
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The standing rule for every item here (learned three times this week):" }),
			" first decide ",
			createVNode(_components.strong, { children: "slow vs broken vs meaningless-remotely" }),
			" by reproducing in isolation — never widen a timeout to make a red go away (the branch-mode “timeout” was a real product bug; a widen would have buried it), and never skip without a named reason and a tracked issue."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "r1--branch-mode-code-tab-a-base-ref-that-exists-reads-as-missing-the-known-one--1701",
			children: ["R1 — branch-mode Code tab: a base ref that exists reads as missing ", createVNode(_components.em, { children: "(the known one — #1701)" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Open a branch-mode diff over the bind and the tree never hydrates: ",
			createVNode(_components.code, { children: "getStatus" }),
			" returns ",
			createVNode(_components.code, { children: "BASE_BRANCH_NOT_FOUND" }),
			" for ",
			createVNode(_components.code, { children: "origin/master" }),
			" even though the ref ",
			createVNode(_components.strong, { children: "provably exists" }),
			" on the remote box (verified against the live failing repo — all three ref lookups resolve). Suspected mechanism (labeled hypothesis in the issue): the status subscription fires early, correctly errors before the clone lands the ref, and the git-refs watcher never re-fires it over the bind — the third member of the ",
			createVNode(_components.strong, { children: "watcher-over-remote genus" }),
			" (see R5). 9 scenarios carry counted ",
			createVNode(_components.code, { children: "REMOTE-SKIP-1701" }),
			" markers; they un-skip the day #1701’s fix lands. ",
			createVNode(_components.strong, { children: "Destination: its own repro-first PR." })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "r2--the-timeout-cluster-verdict--one-load-interaction-zero-hidden-bugs-facts-2026-07-05",
			children: ["R2 — the timeout cluster: VERDICT — one load-interaction, zero hidden bugs ", createVNode(_components.em, { children: "(facts 2026-07-05)" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Every suspected scenario was run ALONE over the bind: ",
			createVNode(_components.strong, { children: "code-tab 12/12 pass, canvas 9/9 pass" }),
			" — none slow, none broken. They fail only under full-suite load. The feared second bug wave does not exist. The 20 “zombies” seen after a full run were ",
			createVNode(_components.strong, { children: "sshd-session children, not padi’s" }),
			" — the #1692 pin holds; padi is clean. What remains is ONE dig: find the load source — box A harness accumulation (a long-lived kolu-server + per-scenario chromium across 494 scenarios) vs box B subscription/stream backlog — which needs a resource-sampled full run, not isolation. ",
			createVNode(_components.strong, { children: "Destination: one instrumented full run; then either a harness fix or a backlog fix. No widening — the scenarios are innocent." })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "r3--scenarios-that-are-meaningless-on-a-remote-bind-the-local-daemon-lifecycle-class",
			children: "R3 — scenarios that are meaningless on a remote bind: the local-daemon-lifecycle class"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Per-scenario facts are in ",
			createVNode(_components.em, { children: "(2026-07-05)" }),
			", and they split three ways: ",
			createVNode(_components.strong, { children: "(a) rewritable for remote TODAY" }),
			" — ",
			createVNode(_components.code, { children: ":58" }),
			" (restart-live) and ",
			createVNode(_components.code, { children: ":94" }),
			" (recycle-with-split): every observable has a working remote equivalent (",
			createVNode(_components.code, { children: "recycleKaval" }),
			" procedure · ",
			createVNode(_components.code, { children: "daemonStatus" }),
			" collection · ",
			createVNode(_components.code, { children: "hostInventory" }),
			"’s gatePid, all proven over a real hop in ",
			createVNode(_components.code, { children: "remotePadiSsh.test.ts" }),
			"); ",
			createVNode(_components.code, { children: ":94" }),
			"’s only local coupling is a vestigial pid-capture it never asserts. ",
			createVNode(_components.strong, { children: "(b) blocked on a missing fault-injection primitive" }),
			" — ",
			createVNode(_components.code, { children: ":10" }),
			" (kill-to-degraded) and ",
			createVNode(_components.code, { children: ":32" }),
			" (restart-degraded) SIGKILL the local kaval by pid to ",
			createVNode(_components.em, { children: "induce" }),
			" the degraded state; no padiSurface member kills-and-leaves-dead the bound kaval (",
			createVNode(_components.code, { children: "recycleKaval" }),
			" always respawns) — the ",
			createVNode(_components.em, { children: "observation" }),
			" side already works remotely, only the inducer is missing. Product decision: add a test-only remote kill-fault primitive, or skip these two with that reason. ",
			createVNode(_components.strong, { children: "(c) needs a remote-binding variant" }),
			" — ",
			createVNode(_components.code, { children: ":20" }),
			" asserts the LOCAL-binding UI contract (one group, local-scan count 0); over a remote bind the dialog intentionally shows two labeled groups, so a remote variant of the scenario is expressible today. ",
			createVNode(_components.strong, { children: "Destination: rewrite (a) now · decide (b)’s primitive · write (c)’s variant." })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "r4--terminal-creation-races-verdict--folded-into-r2s-load-bin-facts-2026-07-05",
			children: ["R4 — terminal-creation races: VERDICT — folded into R2’s load bin ", createVNode(_components.em, { children: "(facts 2026-07-05)" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Reproduced 5× over the bind and 5× locally, in isolation: ",
			createVNode(_components.strong, { children: "25/25 remote pass, 25/25 local pass" }),
			". Not a remote race, not even flaky in isolation — it appears only under full-suite load, same as R2. ",
			createVNode(_components.strong, { children: "Destination: R2’s load dig covers it; not L10." })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "r5--the-watcher-over-remote-genus-the-meta-finding--worth-more-than-any-single-fix",
			children: ["R5 — the watcher-over-remote genus ", createVNode(_components.em, { children: "(the meta-finding — worth more than any single fix)" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Three separate incidents this week share one shape — ",
			createVNode(_components.em, { children: "a watcher that works locally misbehaves once the daemon is remote or long-lived" }),
			": ",
			createVNode(_components.strong, { children: "#1680" }),
			" (codex WAL ",
			createVNode(_components.code, { children: "fs.watch" }),
			" dies on darwin, agent state freezes), ",
			createVNode(_components.strong, { children: "#1691 → fixed by #1692" }),
			" (the parcel watchman-probe leaked a zombie per subscribe), and now ",
			createVNode(_components.strong, { children: "#1701" }),
			" (the git-refs watcher not re-firing status). Three is a pattern: our file/ref watchers were all written under a locality assumption the remote bind breaks. This entry is the audit: enumerate every watcher in the padi stack (agent-state sensors · git refs · repo pulses · session files), and for each, answer ",
			createVNode(_components.em, { children: "what happens when its event is late, lost, or on another machine" }),
			" — before the fourth incident finds us. ",
			createVNode(_components.strong, { children: [
				"The audit is DONE ",
				createVNode(_components.em, { children: "(2026-07-05)" }),
				" — every watcher enumerated, and the headline finding is stark: exactly ONE watcher in the entire stack has a steady-state reconcile poll (the one #1680’s fix added); everything else recovers only if another fs event happens to arrive."
			] }),
			" Three primitives only (",
			createVNode(_components.code, { children: "fs.watch" }),
			" for most; ",
			createVNode(_components.code, { children: "@parcel/watcher" }),
			" for the working tree alone; no chokidar/polling anywhere). The no-backstop list, ranked by remote/long-lived exposure:"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Git ref-landings that bypass the reflog" }),
				" — a raw ",
				createVNode(_components.code, { children: "update-ref" }),
				", a direct ",
				createVNode(_components.code, { children: "refs/heads/*" }),
				" write, or a ",
				createVNode(_components.strong, { children: "packed-refs rewrite" }),
				" is watched by NO git watcher (HEAD/reflog/index/working-tree all miss it), so ",
				createVNode(_components.code, { children: "getStatus" }),
				"/",
				createVNode(_components.code, { children: "getDiff" }),
				" never re-fire. ",
				createVNode(_components.strong, { children: "This structurally corroborates #1701’s mechanism" }),
				": over the bind, a clone writes ",
				createVNode(_components.code, { children: "refs/remotes/origin/master" }),
				" + packed-refs directly (no reflog append) → the reflog watcher never fires → the early ",
				createVNode(_components.code, { children: "BASE_BRANCH_NOT_FOUND" }),
				" is never corrected. Hypothesis now mechanism-confirmed."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.code, { children: "subscribeGitInfo" }), "’s head-mode watches only HEAD+config — a commit-on-branch over the bind never refreshes the GitInfo/PR pill; no periodic re-resolve."] }),
			"\n",
			createVNode(_components.li, { children: [
				"The codex/opencode WAL watchers handle inode replacement but have ",
				createVNode(_components.strong, { children: "no timer poll" }),
				" — #1680’s darwin shape can recur on the remote side; the reconcile-poll pattern was never propagated here."
			] }),
			"\n",
			createVNode(_components.li, { children: "The claude transcript watcher: steady thinking/tool_use states have no self-firing recheck (the 1s poll reads the screen, not the transcript)." }),
			"\n",
			createVNode(_components.li, { children: "The claude subagents/fork watcher: install-kick only — a missed fork artifact keeps an idle main mislabeled." }),
			"\n",
			createVNode(_components.li, { children: "Working-tree/HEAD/index: install-time reconcile tick, no steady poll — lower risk only because their axes overlap." }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Destination: propagate #1680’s reconcile-poll pattern to the ranked list (1 and 3 first — 1 likely IS #1701’s fix), as its own repro-first PR series." }) }),
		"\n",
		createVNode(_components.h2, {
			id: "done--when-this-note-is-empty",
			children: "Done — when this note is empty"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: "Every R2 scenario is binned with numbers or filed as a bug; every filed bug is fixed and its skips removed." }),
			"\n",
			createVNode(_components.li, { children: "Every R3 scenario has its remote story recorded (remote counterpart written, or permanent reasoned skip)." }),
			"\n",
			createVNode(_components.li, { children: "R4 resolved to bug-or-flake; #1680 and #1701 closed; the R5 audit done." }),
			"\n",
			createVNode(_components.li, { children: [
				"Then: ",
				createVNode(_components.strong, { children: "#1689’s node runs the full suite over the bind with only permanent, reasoned skips — two consecutive greens, gating every PR." }),
				" That green is the definition of “kolu fully works over a remote bind.”"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: "(Status: W3.4 / #1689 is deliberately parked (srid, 2026-07-05) — the node’s machinery is done and proven (pair-lease, build-identity guard, mock-agent-in-terminal, parity counter); it waits for this note’s tail so its gate is honest from day one. Work items here are dispatched separately, like the parked cleanups in the padi note.)" }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Remote bind — what's left before it fully works",
	"description": "The definitive list of everything standing between today and \"kolu fully works over a remote bind\" — found by W3.4's full-suite run, held here as a working ledger so each item can be attacked separately.",
	"parents": ["bug", "padi"],
	"maturity": "seedling",
	"updated": "2026-07-05T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "r1--branch-mode-code-tab-a-base-ref-that-exists-reads-as-missing-the-known-one--1701",
			"text": "R1 — branch-mode Code tab: a base ref that exists reads as missing (the known one — #1701)"
		},
		{
			"depth": 2,
			"slug": "r2--the-timeout-cluster-verdict--one-load-interaction-zero-hidden-bugs-facts-2026-07-05",
			"text": "R2 — the timeout cluster: VERDICT — one load-interaction, zero hidden bugs (facts 2026-07-05)"
		},
		{
			"depth": 2,
			"slug": "r3--scenarios-that-are-meaningless-on-a-remote-bind-the-local-daemon-lifecycle-class",
			"text": "R3 — scenarios that are meaningless on a remote bind: the local-daemon-lifecycle class"
		},
		{
			"depth": 2,
			"slug": "r4--terminal-creation-races-verdict--folded-into-r2s-load-bin-facts-2026-07-05",
			"text": "R4 — terminal-creation races: VERDICT — folded into R2’s load bin (facts 2026-07-05)"
		},
		{
			"depth": 2,
			"slug": "r5--the-watcher-over-remote-genus-the-meta-finding--worth-more-than-any-single-fix",
			"text": "R5 — the watcher-over-remote genus (the meta-finding — worth more than any single fix)"
		},
		{
			"depth": 2,
			"slug": "done--when-this-note-is-empty",
			"text": "Done — when this note is empty"
		}
	];
}
var url = "src/content/atlas/remote-bind-parity.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/remote-bind-parity.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/remote-bind-parity.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
