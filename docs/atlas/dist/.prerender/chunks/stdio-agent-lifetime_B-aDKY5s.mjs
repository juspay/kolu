import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import "./Callout_va3z_Xoj.mjs";
import { t as $$Footnote } from "./Footnote_Co54bi9w.mjs";
//#region src/content/atlas/stdio-agent-lifetime.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
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
		createVNode(_components.h2, {
			id: "the-defect-class-observed-in-the-field",
			children: "The defect class, observed in the field"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A fleet host (sincereintent) hit its swap alert carrying ",
			createVNode(_components.strong, { children: [
				"ten orphaned\n",
				createVNode(_components.code, { children: "drishti-agent --stdio" }),
				" processes"
			] }),
			" — 130–200\xA0MB each, up to 23 hours\nold, every one re-parented to pid\xA01 — accumulating one per\nserver⇄host reconnect (drishti#109). The same class litters CI boxes as\n",
			createVNode(_components.code, { children: "T/odu/kolu/*" }),
			" leaves: odu’s remote lane agents are stdio-served processes\ntoo.",
			createVNode($$Footnote, { children: [
				"Distinct from the SIGKILL-teardown leaf leak the flaky tracker\nrecords (no signal window at all — kolu#1851 closed the graceful half). This\nclass is the ",
				createVNode(_components.em, { children: "graceful" }),
				" case gone wrong: the link ends cleanly, EOF is\ndelivered, and the process still lives forever."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The mechanism is not a missing feature — the framework already ",
			createVNode(_components.em, { children: "documents the\nright intent" }),
			". ",
			createVNode(_components.code, { children: "frontDaemonOverStdio" }),
			"’s header calls ",
			createVNode(_components.code, { children: "serveOverStdio" }),
			" “the\n",
			createVNode(_components.strong, { children: "ephemeral" }),
			" remote agent: the ",
			createVNode(_components.code, { children: "--stdio" }),
			" process ",
			createVNode(_components.strong, { children: "is" }),
			" the server … when\nthe link drops the server (and any state it held) is gone — exactly right for\na re-run-fresh agent (mini-ci, remote-process-monitor, drishti).” But the\nimplementation hands that promise to the app: ",
			createVNode(_components.code, { children: "serveOverStdio" }),
			" ",
			createVNode(_components.strong, { children: "resolves" }),
			"\nwith ",
			createVNode(_components.code, { children: "{reason: \"end\" | \"error\"}" }),
			" when the read stream ends, and process\ntermination is the caller’s homework. Any live handle — drishti-agent’s 2s\npoll interval, a watcher, a child — keeps Node’s event loop alive after\n",
			createVNode(_components.code, { children: "main" }),
			" returns, so the failure mode of forgetting (or sequencing cleanup\nwrong) is an ",
			createVNode(_components.strong, { children: "invisible immortal orphan" }),
			" on someone else’s machine."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-principle-violations-why-this-is-the-frameworks-bug",
			children: "The principle violations (why this is the framework’s bug)"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "P5 — guarantee at the knowing endpoint." }),
				" “This process’s reason to exist\nis gone” is known at exactly one place: the serve loop that saw EOF on the\ndefault stdio. The app’s ",
				createVNode(_components.code, { children: "main" }),
				" ",
				createVNode(_components.em, { children: "cannot" }),
				" reliably make the exit guarantee —\nit doesn’t know what else holds the event loop (that is the whole reason\nthe orphans are invisible). The layer that knows must own the exit."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "P4 — illegal states unrepresentable." }),
				" “Agent process alive, link dead”\nis a constructible state today, guarded only by every app’s discipline.\nThe perfection-review question — ",
				createVNode(_components.em, { children: "would the defect class become\ninexpressible?" }),
				" — says: bind lifetime structurally, don’t document it."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Fail-fast doctrine." }),
				" Lingering after link death is a silent degradation;\nand the fix must not add an opt-out knob — “being able to override is\nnever a feature.” The two lifetimes (ephemeral vs durable) are selected by\n",
				createVNode(_components.strong, { children: "construction" }),
				", not configuration: that split already exists in the\npackage family (",
				createVNode(_components.code, { children: "serveOverStdio" }),
				" vs ",
				createVNode(_components.code, { children: "frontDaemonOverStdio" }),
				" + a socket\ndaemon), which is what makes this fix small."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-change-one-seam-discriminated-by-construction",
			children: "The change (one seam, discriminated by construction)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "serveOverStdio" }),
			" already has the discriminant in hand: whether the caller\npassed a ",
			createVNode(_components.code, { children: "transport" }),
			" override."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Default transport (",
					createVNode(_components.code, { children: "process.stdin/stdout" }),
					") — the process IS the agent."
				] }),
				"\nOn read-end/error: ",
				createVNode(_components.code, { children: "peer.close()" }),
				" (the one framework-held disposer), the\npromise settles, the caller’s synchronous continuations run, then a\n",
				createVNode(_components.code, { children: "setImmediate" }),
				" fork calls ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "process.exit(reason === \"end\" ? 0 : 1)" }) }),
				" —\nframework-owned, no knob.",
				createVNode($$Footnote, { children: [
					"As shipped in ",
					createVNode("a", {
						href: "https://github.com/juspay/kolu/pull/1858",
						children: "#1858"
					}),
					" after the lens\ngate and gauntlet reshaped the draft: the planned ",
					createVNode(_components.code, { children: "onEnd" }),
					" last-gasp hook\nwas DROPPED (speculative machinery for zero callers — every real consumer’s\npost-settle work is synchronous and the setImmediate ordering honors it);\nthe same change fixed a latent exit-code bug (benign write-EPIPE from a\ndying peer now classifies as a clean end via the codec’s own\n",
					createVNode(_components.code, { children: "isBenignWriteError" }),
					", not a nondeterministic exit 1); and codex surfaced a\nsecond orphan spelling — ",
					createVNode(_components.code, { children: "ERR_STREAM_DESTROYED" }),
					" reported only to the write\ncallback, no ‘error’ event — closed by a required ",
					createVNode(_components.code, { children: "onPeerGone" }),
					" parameter on\nthe package-internal ",
					createVNode(_components.code, { children: "framedSend" }),
					" seam (two call sites; not public\nAPI)."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Explicit ",
					createVNode(_components.code, { children: "transport" }),
					" override — a loopback/test/embedded peer."
				] }),
				" Current\nbehavior stands: resolve the value, caller owns lifetime. Tests keep\npassing untouched; exotic compositions choose this arm ",
				createVNode(_components.em, { children: "by construction" }),
				"."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The returned promise still settles (same shape) before exit on the default\narm, so a caller that today does post-settle logging keeps working — it just\ncan no longer ",
			createVNode(_components.em, { children: "forget" }),
			" to die."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "consumers-and-rollout",
			children: "Consumers and rollout"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "consumer" }),
					"\n",
					createVNode(_components.th, { children: "today" }),
					"\n",
					createVNode(_components.th, { children: "after" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "drishti-agent" }),
					"\n",
					createVNode(_components.td, { children: "never exits after settle → the drishti#109 orphans (it had NO exit to delete — that absence WAS the bug)" }),
					"\n",
					createVNode(_components.td, { children: "inherits via the pair PR (pin bump, zero app code)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "mini-ci, remote-process-monitor, fleet-top part-3" }),
					"\n",
					createVNode(_components.td, { children: "the three in-repo default-arm consumers — post-settle work audited strictly synchronous" }),
					"\n",
					createVNode(_components.td, { children: "inherit the exit; no change needed" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "odu lane agents" }),
					"\n",
					createVNode(_components.td, { children: [
						"leaves accumulate on CI boxes (",
						createVNode(_components.code, { children: "T/odu/kolu/*" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"inherits at the next kolu pin bump — an ",
						createVNode(_components.code, { children: "adoption-opportunity" }),
						" line for the odu#43 ledger"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "padi" }),
					"\n",
					createVNode(_components.td, { children: [
						"unaffected — the durable arm (",
						createVNode(_components.code, { children: "frontDaemonOverStdio" }),
						" + socket daemon); its ",
						createVNode(_components.em, { children: "front" }),
						" already dies with the relay"
					] }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Pin (red-before/green-after):" }),
			" serve a router over a real child-process\nstdio pair holding a live ",
			createVNode(_components.code, { children: "setInterval" }),
			"; kill the parent side; assert the\nchild exits within the deadline (red today: it lives forever). Plus the\noverride-arm pin: same scenario with an explicit transport resolves the value\nand does NOT exit."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Gates:" }),
			" framework change in ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" → the standard treatment —\nlens run before GO, drishti pair PR (which also closes drishti#109’s app\nside), ODU-IMPACT verdict (expected ",
			createVNode(_components.code, { children: "adoption-opportunity" }),
			", ledgered),\n",
			createVNode(_components.code, { children: "ref-surface.mdx" }),
			" update in the same PR."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "A stdio agent's lifetime belongs to the framework",
	"description": "serveOverStdio reports link death as a value and leaves process exit to every app — so a forgotten exit (or any live timer) yields an immortal orphan agent. Bind process lifetime to the link at the construction that means \"this process IS the agent,\" making the orphan unspellable.",
	"parents": ["surface-daemon", "feature"],
	"status": "implemented",
	"maturity": "seedling",
	"updated": "2026-07-16T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-defect-class-observed-in-the-field",
			"text": "The defect class, observed in the field"
		},
		{
			"depth": 2,
			"slug": "the-principle-violations-why-this-is-the-frameworks-bug",
			"text": "The principle violations (why this is the framework’s bug)"
		},
		{
			"depth": 2,
			"slug": "the-change-one-seam-discriminated-by-construction",
			"text": "The change (one seam, discriminated by construction)"
		},
		{
			"depth": 2,
			"slug": "consumers-and-rollout",
			"text": "Consumers and rollout"
		}
	];
}
var url = "src/content/atlas/stdio-agent-lifetime.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/stdio-agent-lifetime.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/stdio-agent-lifetime.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
