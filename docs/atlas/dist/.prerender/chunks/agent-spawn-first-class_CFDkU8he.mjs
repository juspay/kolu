import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
//#region src/content/atlas/agent-spawn-first-class.mdx
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
		createVNode(_components.h2, {
			id: "what-happened",
			children: "What happened"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"An orchestrating Claude session created terminals for three worker agents by\nrunning ",
			createVNode(_components.code, { children: "kaval-tui create -- claude …" }),
			" — that is, making ",
			createVNode(_components.strong, { children: "claude itself the\nterminal’s root process" }),
			", with no shell wrapping it. Two things silently\nbroke (",
			createVNode(_components.a, {
				href: "https://github.com/juspay/kolu/issues/1872",
				children: "#1872"
			}),
			"):"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Bug A — the Dock never showed agent activity." }),
			" Kolu decides “this terminal\nis running claude” by watching for a special marker that the ",
			createVNode(_components.em, { children: "shell" }),
			" prints\nwhenever you run a command (the OSC ",
			createVNode(_components.code, { children: "633;E" }),
			" mark, emitted by kolu’s shell\nhooks). No shell → no marker → kolu never learns what’s running. The daemon\nactually ",
			createVNode(_components.em, { children: "received" }),
			" the command line at spawn time — it just throws it away\n(",
			createVNode(_components.code, { children: "ptyHost.ts:663" }),
			" initializes ",
			createVNode(_components.code, { children: "lastCommand" }),
			" to undefined and nothing but the\nshell marker ever sets it). There’s also a second, sneakier blocker: the\n“is the shell sitting idle?” check assumes the terminal’s root process is a\nshell. When the root ",
			createVNode(_components.em, { children: "is" }),
			" the agent, that check wrongly answers “yes, idle” —\nso even if we fixed the first problem, detection would still be suppressed\n(",
			createVNode(_components.code, { children: "sensors.ts:394-402" }),
			")."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Bug B — the agents’ conversations were never saved (real data loss)." }),
			"\n",
			createVNode(_components.code, { children: "kaval-tui create" }),
			" copies the caller’s ",
			createVNode(_components.strong, { children: "entire environment" }),
			" into the new\nterminal (",
			createVNode(_components.code, { children: "create.ts:55-57" }),
			"). The orchestrator is itself a Claude session, so\nits private variables came along — including ",
			createVNode(_components.code, { children: "CLAUDE_CODE_CHILD_SESSION=1" }),
			".\nA claude that sees that variable thinks “I’m a temporary child session” and\n",
			createVNode(_components.strong, { children: "doesn’t save its conversation to disk at all" }),
			". When kaval restarted, three\nagents’ entire histories were simply gone. We proved this with a clean A/B\ntest: same spawn with those variables removed → the conversation file appears\nimmediately."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "why-terminals-created-through-kolu-never-had-this-bug",
			children: "Why terminals created through kolu never had this bug"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"When you create a terminal in kolu (or through ",
			createVNode(_components.code, { children: "kolu mcp" }),
			"), the request\nschema only has ",
			createVNode(_components.code, { children: "cwd" }),
			" and ",
			createVNode(_components.code, { children: "parentId" }),
			" — ",
			createVNode(_components.strong, { children: "there is no way to pass a command or\nan environment" }),
			" (",
			createVNode(_components.code, { children: "surface.ts:513-518" }),
			"). So every kolu terminal gets the\nrc-hooked shell (markers work), and its environment comes from the padi\ndaemon’s own clean one (no caller variables can leak). You literally cannot\nexpress either bug through the kolu face. That “missing” ",
			createVNode(_components.code, { children: "command" }),
			" parameter\nis not a gap — it’s the protection. (One nit: the ",
			createVNode(_components.code, { children: "kolu mcp" }),
			" tool description\n",
			createVNode(_components.em, { children: "claims" }),
			" it takes a command; it doesn’t, and the text should stop saying so.)"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-fix",
			children: "The fix"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The idea in one sentence: ",
			createVNode(_components.strong, { children: "“launch an agent” becomes a real operation at the\nlevel that knows it’s launching an agent" }),
			" — the faces — and the lower layers\njust stop losing information or leaking it."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Where" }),
					"\n",
					createVNode(_components.th, { children: "What changes" }),
					"\n",
					createVNode(_components.th, { children: "What becomes impossible" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "kolu mcp / kolu-tui" }), " (the faces)"] }),
					"\n",
					createVNode(_components.td, { children: "“Launch an agent” is its own verb: internally it creates a shell terminal, types the agent command into it, and waits for detection to pick it up. Creating a terminal never takes a raw command. The mcp face already works this way; the coming kolu-tui must too." }),
					"\n",
					createVNode(_components.td, { children: "Launching an agent without a shell, or with the caller’s environment — there’s simply no way to ask for it." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "kaval-tui" }), " (the CLI)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"Stop copying the caller’s environment wholesale. Build the child’s environment from a clean base, and let the caller add specific variables explicitly (",
						createVNode(_components.code, { children: "--env K=V" }),
						"). We deliberately did NOT go with “strip the known Claude variables”: that fixes only today’s agent — the next tool (codex, gemini-cli, …) has different variables and the data loss quietly returns. A clean base fixes all of them, including ones that don’t exist yet."
					] }),
					"\n",
					createVNode(_components.td, { children: "A new terminal accidentally carrying the orchestrator’s identity." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "kaval" }), " (the PTY daemon)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"One tiny change, and it’s bookkeeping, not smarts: when spawning with an explicit command, ",
						createVNode(_components.em, { children: "remember it" }),
						" (seed ",
						createVNode(_components.code, { children: "lastCommand" }),
						" from the argv it already receives). The shell marker remains the live source when commands run inside a shell."
					] }),
					"\n",
					createVNode(_components.td, { children: "A terminal whose own daemon doesn’t know what it spawned." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "padi’s sensors" }), " (only if needed later)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"If command-rooted terminals ever become visible to the workspace sensors, the “is the shell idle?” check must first ask “is the root even a shell?” — for an agent-rooted terminal, root-in-foreground means ",
						createVNode(_components.em, { children: "busy" }),
						", the exact opposite of today’s reading."
					] }),
					"\n",
					createVNode(_components.td, { children: "Misreading a running agent as an idle prompt." }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "Kaval stays what it is — a dumb PTY daemon. It gains no knowledge of agents\nand no opinions about environments; it just stops discarding a fact it was\nalready handed." }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "One thing kolu cannot fix" }),
			": Claude Code decides “don’t save this\nconversation” based on an ",
			createVNode(_components.em, { children: "inherited environment variable" }),
			". Anything that\nforwards environments — ssh, ",
			createVNode(_components.code, { children: "sudo -E" }),
			", a Makefile — can trigger the same\ndata loss with no kolu involved. Our clean-environment change protects kolu’s\npaths; the root fragility belongs upstream, and we should file it there with\nour A/B evidence."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "until-the-fix-ships-the-working-rules",
			children: "Until the fix ships (the working rules)"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"Never run ",
				createVNode(_components.code, { children: "kaval-tui create -- claude …" }),
				" (or any agent) from an agent\nsession. It hits both bugs."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Creating a shell terminal and typing ",
				createVNode(_components.code, { children: "claude" }),
				" into it is ",
				createVNode(_components.strong, { children: "not" }),
				" enough on\nits own — the shell inherited the orchestrator’s variables too. First run\n",
				createVNode(_components.code, { children: "unset CLAUDE_CODE_CHILD_SESSION CLAUDECODE CLAUDE_CODE_SESSION_ID" }),
				", then\nlaunch. (Shells restored by kaval itself after a restart are already clean.)"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The own-shell scrub (",
				createVNode(_components.code, { children: "unset CLAUDE_CODE_* …" }),
				" before launching an agent in a\nhand-tainted ",
				createVNode(_components.code, { children: "ssh" }),
				"/",
				createVNode(_components.code, { children: "sudo -E" }),
				" shell) is ",
				createVNode(_components.strong, { children: "permanent hygiene, tied to no PR" }),
				" —\nits cause is upstream (agents classifying themselves from inherited env),\nnot something any kolu change fixes. The other interim rules were deleted as\ntheir PRs shipped."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "pr-phases",
			children: "PR phases"
		}),
		"\n",
		createVNode(_components.p, { children: "Three PRs shipped, ordered by harm — and a fourth downgraded to optional sugar:" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "PR 1 — stop the data loss" }),
			" — ",
			createVNode(_components.strong, { children: ["SHIPPED as ", createVNode($$PrLink, { pr: 1880 })] }),
			" (",
			createVNode(_components.code, { children: "kaval-tui" }),
			" + ",
			createVNode(_components.code, { children: "kolu-pty" }),
			" + ",
			createVNode(_components.code, { children: "padi" }),
			" +\n",
			createVNode(_components.code, { children: "surface-daemon-supervisor" }),
			" + e2e harness + docs + skills). ONE shared\nallowlist (",
			createVNode(_components.code, { children: "SPAWN_ENV_ALLOWLIST" }),
			" in kolu-pty, pinned as data) and\ncompose-don’t-forward at every seam that reaches an ",
			createVNode(_components.em, { children: "agent" }),
			": kaval-tui’s\ncreate composers; ",
			createVNode(_components.code, { children: "cleanEnv" }),
			" (every hosted PTY — was a wholesale\n",
			createVNode(_components.code, { children: "{...process.env}" }),
			"); the supervisor’s detached spawn branch (",
			createVNode(_components.code, { children: "env = cfg.env" }),
			"\nunless ",
			createVNode(_components.code, { children: "fromSource" }),
			", parity with systemd ",
			createVNode(_components.code, { children: "--setenv" }),
			"); padi’s ",
			createVNode(_components.code, { children: "daemonEnv" }),
			"\n(expanded to a complete base so cfg.env-alone keeps macOS parity); the e2e\nharness server child. The corrected ",
			createVNode(_components.code, { children: "kolu mcp" }),
			" docstring and interim skill\nrules ride here too. Red-first pins: the #1872 leak assertion (shell AND\ncommand modes) + the allowlist/",
			createVNode(_components.code, { children: "daemonEnv" }),
			" key sets as data."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "PR 1.5 — close the last spawn seam" }),
			" — ",
			createVNode(_components.strong, { children: [
				"SHIPPED as ",
				createVNode($$PrLink, { pr: 1884 }),
				" (+ drishti#116)"
			] }),
			" (",
			createVNode(_components.code, { children: "@kolu/surface-remote" }),
			", immediate\nfast-follow). The remote connector’s localhost arm spawns with full\nenv-inherit — the one place the ssh boundary doesn’t scrub. Defense-in-depth,\nnot a present leak: with PR 1 landed, every path from a tainted daemon to an\n",
			createVNode(_components.em, { children: "agent" }),
			" is composed (the localhost child is a daemon, not an agent; its\ndownstream PTYs/kaval are composed). Makes the localhost env REQUIRED at the\ntype level so full-inherit is unspellable. Breaking surface-remote API — so\nit carries the drishti pair PR + odu verdict + ",
			createVNode(_components.code, { children: "ref-surface-remote.mdx" }),
			",\nfinalized against post-gauntlet HEAD."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "PR 2 — stop the detection loss" }),
			" — ",
			createVNode(_components.strong, { children: ["SHIPPED as ", createVNode($$PrLink, { pr: 1890 })] }),
			"\n(",
			createVNode(_components.code, { children: "kaval" }),
			" + ",
			createVNode(_components.code, { children: "padi" }),
			" + e2e + skills). ",
			createVNode(_components.strong, { children: "The premise was corrected reproduce-first,\nbefore any fix code" }),
			": a command-rooted ",
			createVNode(_components.em, { children: "claude" }),
			" turned out to be detected\nalready (its adapter resolves by pid + session file, independent of both\nlocks) — the field’s three invisible claudes were Bug B, which PR 1 fixed. The\nlocks bite the ",
			createVNode(_components.strong, { children: "command-hint path only" }),
			": codex/opencode/grok, whose kernel\nprocess name is the node shim, not the agent — 3 of 4 supported agents when\ncommand-rooted. So PR 2 is honestly the ",
			createVNode(_components.strong, { children: "shim hint-agent + bookkeeping" }),
			" fix:\nseed ",
			createVNode(_components.code, { children: "lastCommand" }),
			" (and the title) from the spawn argv on the same channel the\nshell marker uses (seed first, live marks win), and — demand-pulled from PR 3,\nits gate condition being empirically live — the padi sensor’s ",
			createVNode(_components.code, { children: "shellIdle" }),
			"\ndiscrimination via one optional ",
			createVNode(_components.code, { children: "commandRooted" }),
			" boolean, kaval → padi\nserver-side only. No ",
			createVNode(_components.code, { children: "ptyHostSurface" }),
			" contract bump (optional additive fields;\nabsence degrades to today’s reading both skew directions). Reds: an npm-shim\n",
			createVNode(_components.code, { children: "opencode" }),
			" spawned command-rooted, invisible → visible; a ",
			createVNode(_components.code, { children: "claude" }),
			" scenario\nkept green as the regression guard documenting the pid path. This PR\ndeletes PR 1’s “never ",
			createVNode(_components.code, { children: "create -- <agent>" }),
			"” skill rule for the ",
			createVNode(_components.em, { children: "detection" }),
			"\nreason; the terminal is still shell-less, so the Dock’s richer shell\naffordances stay absent — which is fine for the raw CLI path."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "PR 3 — the face verb" }),
			" — ",
			createVNode(_components.strong, { children: "DOWNGRADED to optional ergonomics; not planned." }),
			"\nThe original argument was safety: make the hand-assembled launch impossible to\nexpress. That argument dissolved when PRs 1–2 fixed both bugs ",
			createVNode(_components.em, { children: "at the\nsubstrate" }),
			", with regression pins: today ",
			createVNode(_components.code, { children: "create -- claude" }),
			" composes its\nenvironment and is detected in the Dock — the broken way is no longer broken.\nWhat a dedicated verb would still add is convenience only (returns after\ndetection confirms instead of at spawn; a shell to drop back into when the\nagent exits; one step instead of two). If kolu-tui wants that sugar someday,\nit can add it — but “we fixed the bugs, so build the thing that would have\nprevented them” is backwards once the fixes are pinned. Issue #1872 closes\nwith PR 2."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Grounding",
			children: createVNode(_components.p, { children: "Shapes and file:line anchors from a 16-agent architecture + perfection\nreview over the #1872 evidence (13 findings, 0 refuted). Each PR carries\nits own red-first pin; none depends on the others to merge." })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Agent spawn is a face verb — fixing #1872 (Dock detection + transcript loss)",
	"description": "Both #1872 bugs happen because an agent was launched through a path that doesn't know it's launching an agent. The fix: kolu's faces (mcp, the coming tui) own 'launch an agent' as a proper operation; kaval-tui builds a clean environment instead of copying the caller's; kaval itself stays a dumb PTY daemon.",
	"parents": ["bug", "kolu-cli"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-17T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-happened",
			"text": "What happened"
		},
		{
			"depth": 2,
			"slug": "why-terminals-created-through-kolu-never-had-this-bug",
			"text": "Why terminals created through kolu never had this bug"
		},
		{
			"depth": 2,
			"slug": "the-fix",
			"text": "The fix"
		},
		{
			"depth": 2,
			"slug": "until-the-fix-ships-the-working-rules",
			"text": "Until the fix ships (the working rules)"
		},
		{
			"depth": 2,
			"slug": "pr-phases",
			"text": "PR phases"
		}
	];
}
var url = "src/content/atlas/agent-spawn-first-class.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/agent-spawn-first-class.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/agent-spawn-first-class.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
