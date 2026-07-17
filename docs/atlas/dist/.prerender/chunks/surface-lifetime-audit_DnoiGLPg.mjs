import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Footnote } from "./Footnote_Co54bi9w.mjs";
//#region src/content/atlas/surface-lifetime-audit.mdx
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
			"The stdio-orphan discovery (",
			createVNode(_components.a, {
				href: "stdio-agent-lifetime.html",
				children: "stdio-agent-lifetime"
			}),
			",\ndrishti#109) posed a generalizable question: ",
			createVNode(_components.strong, { children: "for every resource the surface\nstack creates or holds, who enforces its death — the framework, the consumer’s\ndiscipline, or nobody?" }),
			" This note records the answer: a 3-phase adversarial\nsweep (seam inventory → constructible-orphan + promise-gap hunts → refuters)\nover surface links, surface-daemon, surface-remote, kaval, and padi."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-census",
			children: "The census"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "29 lifetime seams: 10 framework-owned · 13 consumer-homework · 4 unenforced." }),
			"\nThe framework-owned column is genuinely strong where it exists — server-side\nsubscriptions abort with their transport by construction (",
			createVNode(_components.code, { children: "peer.close()" }),
			" →\nevery handler signal), per-connection serves die with their peer, the\nhalf-open-wire watchdog is unspellable through the blessed ",
			createVNode(_components.code, { children: "surfaceClient" }),
			"\nfactories, and ",
			createVNode(_components.code, { children: ".use()" }),
			" subscriptions die with their reactive owner. The\ndefect surface is the other 17 seams, where a documented death is somebody’s\nhomework.",
			createVNode($$Footnote, { children: [
				"Full seam-by-seam inventory with file:line contracts in\nthe sweep artifact (workflow ",
				createVNode(_components.code, { children: "wf_55dd0375-f90" }),
				", 10 agents, journal in the\ncoordinator session). This note records the census, the confirmed findings,\nand the dispositions — not all 29 rows."
			] })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "confirmed-siblings-dispositioned",
			children: "Confirmed siblings, dispositioned"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "kaval graceful shutdown reaped nothing — ALREADY FIXED." }),
				" The sweep\n(running on a pre-#1851 tree) confirmed the daemon’s ",
				createVNode(_components.code, { children: ".finally" }),
				" close was\ninert for PTY subtrees; verification against current master shows\n",
				createVNode("a", {
					href: "https://github.com/juspay/kolu/pull/1851",
					children: "#1851"
				}),
				"’s composed\nclose (“disposes every live PTY … the daemon owning its runtime’s lifetime\nby construction”) landed the exact fix the finding proposes. Disposition:\n",
				createVNode(_components.strong, { children: "fixed, no action" }),
				" — and a good calibration point: the hunt independently\nre-derived a bug the flake campaign had just root-caused."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "dialAgentOnce" }), " delegates remote death entirely to the agent’s EOF\nself-exit."] }),
				" ",
				createVNode(_components.code, { children: "dispose()" }),
				" kills only the local ssh child; no tty is\nallocated (",
				createVNode(_components.code, { children: "ssh --" }),
				" without ",
				createVNode(_components.code, { children: "-t" }),
				"), so no SIGHUP ever reaches the remote,\nand the ControlMaster tunnel lingers ~10\xA0min. Today that makes the\nremote agent’s death pure convention — the drishti#109 mechanism from the\ndialer’s side. Disposition: ",
				createVNode(_components.strong, { children: ["mostly absorbed by\n", createVNode(_components.a, {
					href: "stdio-agent-lifetime.html",
					children: "stdio-agent-lifetime"
				})] }),
				" (EOF self-exit becomes\nframework-owned at the agent); the ",
				createVNode(_components.strong, { children: "residual belt" }),
				" — dialer-side bounded\nkill (agent reports its pid at handshake; ",
				createVNode(_components.code, { children: "dispose()" }),
				" issues ",
				createVNode(_components.code, { children: "ssh host kill <pid>" }),
				") for the wedged-agent case EOF can’t reach — is a recorded\nfollow-up, demand-gated on a field sighting post-STDIO1."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "makeSession" }), " promises a hold “for the parent’s lifetime” but binds to\nnothing"] }),
				" (weakened-confirmed): an abandoned, undestroyed session respawns\nssh children forever, and its non-unref’d reconnect timer pins the event\nloop — the seed’s shape plus process churn. Disposition: ",
				createVNode(_components.strong, { children: "follow-up" }),
				" —\nminimum honest fix is ",
				createVNode(_components.code, { children: "unref()" }),
				" on the arm/probe timers (an abandoned\nsession then can’t immortalize its host process); the fuller parent-binding\n(boundToPid-style auto-destroy) waits for a real consumer bite."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-pattern-the-minors-share",
			children: "The pattern the minors share"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Ten minor findings, one shape: ",
			createVNode(_components.strong, { children: "the framework mints a disposer and documents\nwhen it must be called, then hopes." }),
			" ",
			createVNode(_components.code, { children: "serveOverUnixSocket" }),
			"’s ",
			createVNode(_components.code, { children: "close()" }),
			"\nstopped accepting but left established per-connection serves (and their\ntimers) running — fixed by ",
			createVNode("a", {
				href: "https://github.com/juspay/kolu/pull/1870",
				children: "#1870"
			}),
			", which made\n",
			createVNode(_components.code, { children: "close()" }),
			" run the full teardown (stop accepting → disconnect established\npeers → release the inode); ",
			createVNode(_components.code, { children: "createLiveSignal" }),
			"’s watchdog outlives a discarded socket unless the\nconsumer remembers ",
			createVNode(_components.code, { children: "dispose()" }),
			"; surface-daemon’s ",
			createVNode(_components.code, { children: "daemonMain" }),
			" resolves\n",
			createVNode(_components.code, { children: "DaemonExit" }),
			" and leaves process exit to every new bin — ",
			createVNode(_components.em, { children: "the seed’s homework,\nre-assigned at the daemon layer" }),
			"; kaval’s ",
			createVNode(_components.strong, { children: "ungraceful" }),
			" arm (SIGKILL/OOM) has\nno reaper at all (the known flake-campaign follow-up — #1851 closed the\ngraceful half); ",
			createVNode(_components.code, { children: "inProcessPtyHost" }),
			" promises rc-file cleanup that an optional\nconsumer hook enforces. Individually small; collectively the same P5 verdict\nas the seed — the knowing endpoint delegates."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-unifying-mechanism--tenure-not-transports-srids-reframe",
			children: "The unifying mechanism — tenure, not transports (srid’s reframe)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The census’s real payoff is that the 17 non-framework-owned cells are ",
			createVNode(_components.strong, { children: "one\nmissing concept expressed 17 times" }),
			", not 17 problems: a serving process’s\n",
			createVNode(_components.strong, { children: "tenure" }),
			" — what holds it alive, and the ordered teardown that must run when\nthe last hold releases — ",
			createVNode(_components.em, { children: "regardless of how it was started" }),
			" (stdio, ssh,\nunix socket). The transports differ only in the holds:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "assembly" }),
					"\n",
					createVNode(_components.th, { children: "holds" }),
					"\n",
					createVNode(_components.th, { children: "teardown chain today" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "stdio/ssh agent" }),
					"\n",
					createVNode(_components.td, { children: "the one link" }),
					"\n",
					createVNode(_components.td, { children: ["framework-owned after ", createVNode(_components.a, {
						href: "stdio-agent-lifetime.html",
						children: "stdio-agent-lifetime"
					})] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "socket daemon" }),
					"\n",
					createVNode(_components.td, { children: [
						"gate + policy (idle timeout, state-root watcher, parent pid — the ",
						createVNode(_components.code, { children: "boundToPid" }),
						" shape)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"framework-owned: ",
						createVNode(_components.code, { children: "close()" }),
						" stops accepting ",
						createVNode(_components.strong, { children: "and disconnects established peer serves" }),
						" (",
						createVNode("a", {
							href: "https://github.com/juspay/kolu/pull/1870",
							children: "#1870"
						}),
						"); dispose surface → exit owned by ",
						createVNode(_components.code, { children: "daemonProcessMain" }),
						" (",
						createVNode("a", {
							href: "https://github.com/juspay/kolu/pull/1862",
							children: "#1862"
						}),
						")"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "daemonMain" }), " bins"] }),
					"\n",
					createVNode(_components.td, { children: [
						"already modeled (",
						createVNode(_components.code, { children: "DaemonExit" }),
						" resolves on drain/idle/watch)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"framework-owned: ",
						createVNode(_components.code, { children: "daemonProcessMain" }),
						" owns the exit (",
						createVNode("a", {
							href: "https://github.com/juspay/kolu/pull/1862",
							children: "#1862"
						}),
						")"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The follow-up this recommends: ",
			createVNode(_components.strong, { children: ["one shared piece of machinery in\n", createVNode(_components.code, { children: "@kolu/surface-daemon" })] }),
			" where a daemon declares what holds it alive, and the\nframework runs the whole shutdown sequence (",
			createVNode(_components.em, { children: "stop accepting → disconnect\nremaining clients → release resources → exit the process" }),
			") when the last hold\nreleases. But not yet — the house rule says don’t build shared machinery\nuntil two real things need it. So, in order: ",
			createVNode(_components.strong, { children: "(1)" }),
			" the stdio-agent fix\n(#1858) ships now as a direct fix, no new abstraction. ",
			createVNode(_components.strong, { children: "(2)" }),
			" When we fix\nthe same “returns done-as-a-value instead of exiting” problem in the daemon\nbinaries (",
			createVNode(_components.code, { children: "daemonMain" }),
			"), that’s the second place needing identical logic —\nTHAT is when the shared machinery gets built, extracted from the two working\nfixes — shipped as ",
			createVNode(_components.code, { children: "daemonProcessMain" }),
			" (",
			createVNode("a", {
				href: "https://github.com/juspay/kolu/pull/1862",
				children: "#1862"
			}),
			"). ",
			createVNode(_components.strong, { children: "(3)" }),
			" The\nunix-socket gap (closing a daemon doesn’t disconnect already-connected\nclients) — shipped by ",
			createVNode("a", {
				href: "https://github.com/juspay/kolu/pull/1870",
				children: "#1870"
			}),
			", with one honest\ndeviation from this plan’s wording: the disconnect needed ",
			createVNode(_components.strong, { children: "no new\nmachinery at all" }),
			". A closure-scoped index of accepted sockets plus\n",
			createVNode(_components.code, { children: "destroy()" }),
			" lets each connection’s ",
			createVNode(_components.em, { children: "existing" }),
			" settle chain (the step-1\nteardown) do the whole job, and the ordered chain slots into ",
			createVNode(_components.code, { children: "daemonMain" }),
			"’s\nexisting ",
			createVNode(_components.code, { children: "close()" }),
			" call — reuse of the machinery’s ",
			createVNode(_components.em, { children: "chain" }),
			", not a new named\npiece of it."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-this-buys",
			children: "What this buys"
		}),
		"\n",
		createVNode(_components.p, { children: "The census turns future lifetime questions from archaeology into lookup: a\nnew consumer (kolu-cli’s faces, a fourth stdio agent) can be checked against\nthe 17 non-framework-owned seams it touches, and each fix flips rows from\nhomework to owned — with the tenure harness as the move that flips whole\ncolumns. The refuter discipline mattered: two over-claimed variants died in\nverification, and the one stale finding (kaval) was caught by checking the\nsweep’s tree against merged master before reporting." })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Surface lifetime audit — who enforces \"X dies when Y dies\"",
	"description": "A 29-seam sweep of the surface stack's lifetime contracts, hunting siblings of the stdio-orphan class — 10 framework-owned, 13 consumer-homework, 4 unenforced; two real siblings confirmed, one already fixed by",
	"parents": ["stdio-agent-lifetime", "analysis"],
	"status": "implemented",
	"maturity": "budding",
	"updated": "2026-07-16T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-census",
			"text": "The census"
		},
		{
			"depth": 2,
			"slug": "confirmed-siblings-dispositioned",
			"text": "Confirmed siblings, dispositioned"
		},
		{
			"depth": 2,
			"slug": "the-pattern-the-minors-share",
			"text": "The pattern the minors share"
		},
		{
			"depth": 2,
			"slug": "the-unifying-mechanism--tenure-not-transports-srids-reframe",
			"text": "The unifying mechanism — tenure, not transports (srid’s reframe)"
		},
		{
			"depth": 2,
			"slug": "what-this-buys",
			"text": "What this buys"
		}
	];
}
var url = "src/content/atlas/surface-lifetime-audit.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/surface-lifetime-audit.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/surface-lifetime-audit.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
