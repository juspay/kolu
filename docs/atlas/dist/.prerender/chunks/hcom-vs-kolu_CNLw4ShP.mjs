import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import { t as $$Issue } from "./Issue_CB1XoZJT.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
//#region src/diagrams/hcom-vs-kolu-channel.svg?raw
var hcom_vs_kolu_channel_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 720 432\" font-family=\"ui-sans-serif, system-ui, sans-serif\" role=\"img\" aria-label=\"Two ways to wire coding agents together, side by side. Left panel, hcom: two agents, each with a hook installed into your ~/.claude config, talk through a shared SQLite event log — a real message channel with an inbox and events, delivered mid-turn through the hooks. The cost, labelled: per-tool hooks written into your config. Right panel, kolu: two agents — any agent, no setup, no hooks — read and write a shared directory of markdown files (01.md, 02.md, 03.md) by path; kolu watches that directory with parcel-watcher so a new or changed file is a push, not a poll. The files are the channel — no hooks, any agent, headless and over ssh. A footnote notes the terminal screen is used only for the prompt keystroke and for interactive UI prompts like AskUserQuestion that no log or file can carry. The conclusion the picture makes: kolu already has a channel — the filesystem — so it doesn't install hcom's.\">\n  <defs>\n    <marker id=\"hkc-a\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0L10 5L0 10z\" fill=\"#B45309\"/>\n    </marker>\n    <marker id=\"hkc-g\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0L10 5L0 10z\" fill=\"#15803D\"/>\n    </marker>\n    <style>\n      .panel   { fill:#ffffff; stroke:#e2e8f0; stroke-width:1.5; }\n      .ptitle  { font-size:18px; font-weight:700; }\n      .psub    { font-size:11.5px; }\n      .badge   { font-size:9.5px; font-weight:700; letter-spacing:0.07em; }\n      .box-t   { font-size:13px; font-weight:700; }\n      .box-s   { font-size:10px; }\n      .mono    { font-family:ui-monospace, \"SF Mono\", Menlo, monospace; }\n      .note    { font-size:11px; font-style:italic; }\n      .cap     { font-size:11.5px; }\n\n      .amber-panel { fill:#FDFBF6; stroke:#EAD9B5; }\n      .amber-box { fill:#FBF1DC; stroke:#B45309; stroke-width:1.75; }\n      .amber-log { fill:#F6E7C6; stroke:#B45309; stroke-width:2; }\n      .amber-tt  { fill:#92400E; }\n      .amber-ss  { fill:#7a4f00; }\n      .amber-edge{ stroke:#B45309; stroke-width:2.25; fill:none; }\n\n      .green-panel { fill:#F6FBF7; stroke:#CDE8D5; }\n      .green-box { fill:#E6F4EA; stroke:#15803D; stroke-width:1.75; }\n      .blue-log  { fill:#EDF0FD; stroke:#0D32B2; stroke-width:2; }\n      .green-tt  { fill:#14532D; }\n      .green-ss  { fill:#166534; }\n      .blue-tt   { fill:#0D32B2; }\n      .blue-ss   { fill:#4A5072; }\n      .green-edge{ stroke:#15803D; stroke-width:2.25; fill:none; }\n      .foot      { fill:#64748b; font-size:10px; }\n    </style>\n  </defs>\n\n  <!-- ============ hcom ============ -->\n  <rect class=\"panel amber-panel\" x=\"14\" y=\"14\" width=\"338\" height=\"404\" rx=\"11\"/>\n  <text class=\"ptitle amber-tt\" x=\"34\" y=\"47\">hcom</text>\n  <text class=\"psub amber-ss\" x=\"34\" y=\"64\">installs a channel</text>\n  <text class=\"badge amber-tt\" x=\"332\" y=\"44\" text-anchor=\"end\">OWNS NO TERMINAL</text>\n\n  <rect class=\"amber-box\" x=\"34\" y=\"82\" width=\"132\" height=\"56\" rx=\"8\"/>\n  <text class=\"box-t amber-tt\" x=\"100\" y=\"106\" text-anchor=\"middle\">agent A</text>\n  <text class=\"box-s amber-ss mono\" x=\"100\" y=\"123\" text-anchor=\"middle\">hook in ~/.claude</text>\n\n  <rect class=\"amber-box\" x=\"200\" y=\"82\" width=\"132\" height=\"56\" rx=\"8\"/>\n  <text class=\"box-t amber-tt\" x=\"266\" y=\"106\" text-anchor=\"middle\">agent B</text>\n  <text class=\"box-s amber-ss mono\" x=\"266\" y=\"123\" text-anchor=\"middle\">hook in ~/.claude</text>\n\n  <rect class=\"amber-log\" x=\"103\" y=\"214\" width=\"160\" height=\"72\" rx=\"9\"/>\n  <text class=\"box-t amber-tt\" x=\"183\" y=\"243\" text-anchor=\"middle\">shared event log</text>\n  <text class=\"box-s amber-ss mono\" x=\"183\" y=\"262\" text-anchor=\"middle\">SQLite · inbox · events</text>\n\n  <path class=\"amber-edge\" d=\"M100 138 L150 214\" marker-start=\"url(#hkc-a)\" marker-end=\"url(#hkc-a)\"/>\n  <path class=\"amber-edge\" d=\"M266 138 L216 214\" marker-start=\"url(#hkc-a)\" marker-end=\"url(#hkc-a)\"/>\n\n  <text class=\"note amber-ss\" x=\"183\" y=\"314\" text-anchor=\"middle\">delivered mid-turn — through the hooks</text>\n  <text class=\"cap amber-tt\" x=\"183\" y=\"368\" text-anchor=\"middle\" font-weight=\"700\">a real channel — the cost:</text>\n  <text class=\"cap amber-ss\" x=\"183\" y=\"386\" text-anchor=\"middle\">per-tool hooks, written into your config</text>\n\n  <!-- ============ kolu ============ -->\n  <rect class=\"panel green-panel\" x=\"368\" y=\"14\" width=\"338\" height=\"404\" rx=\"11\"/>\n  <text class=\"ptitle green-tt\" x=\"388\" y=\"47\">kolu</text>\n  <text class=\"psub green-ss\" x=\"388\" y=\"64\">uses the channel it already has</text>\n  <text class=\"badge green-tt\" x=\"686\" y=\"44\" text-anchor=\"end\">OWNS THE TERMINAL</text>\n\n  <rect class=\"green-box\" x=\"388\" y=\"82\" width=\"132\" height=\"56\" rx=\"8\"/>\n  <text class=\"box-t green-tt\" x=\"454\" y=\"106\" text-anchor=\"middle\">agent A</text>\n  <text class=\"box-s green-ss\" x=\"454\" y=\"123\" text-anchor=\"middle\">any agent · no setup</text>\n\n  <rect class=\"green-box\" x=\"554\" y=\"82\" width=\"132\" height=\"56\" rx=\"8\"/>\n  <text class=\"box-t green-tt\" x=\"620\" y=\"106\" text-anchor=\"middle\">agent B</text>\n  <text class=\"box-s green-ss\" x=\"620\" y=\"123\" text-anchor=\"middle\">any agent · no setup</text>\n\n  <rect class=\"blue-log\" x=\"457\" y=\"214\" width=\"160\" height=\"72\" rx=\"9\"/>\n  <text class=\"box-t blue-tt\" x=\"537\" y=\"240\" text-anchor=\"middle\">shared directory</text>\n  <text class=\"box-s blue-ss mono\" x=\"537\" y=\"259\" text-anchor=\"middle\">01.md · 02.md · 03.md</text>\n  <text class=\"box-s blue-ss\" x=\"537\" y=\"275\" text-anchor=\"middle\">kolu watches it → push</text>\n\n  <path class=\"green-edge\" d=\"M454 138 L504 214\" marker-start=\"url(#hkc-g)\" marker-end=\"url(#hkc-g)\"/>\n  <path class=\"green-edge\" d=\"M620 138 L570 214\" marker-start=\"url(#hkc-g)\" marker-end=\"url(#hkc-g)\"/>\n  <text class=\"note green-ss\" x=\"537\" y=\"182\" text-anchor=\"middle\">read / write by path</text>\n\n  <text class=\"cap green-tt\" x=\"537\" y=\"314\" text-anchor=\"middle\" font-weight=\"700\">files are the channel</text>\n  <text class=\"cap green-ss\" x=\"537\" y=\"332\" text-anchor=\"middle\">no hooks · any agent · headless &amp; over ssh</text>\n  <text class=\"foot\" x=\"537\" y=\"372\" text-anchor=\"middle\">screen only for what files can't carry:</text>\n  <text class=\"foot mono\" x=\"537\" y=\"388\" text-anchor=\"middle\">the prompt keystroke · AskUserQuestion</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/hcom-vs-kolu.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		li: "li",
		p: "p",
		strong: "strong",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"A read of ",
			createVNode(_components.a, {
				href: "https://github.com/aannoo/hcom",
				children: createVNode(_components.strong, { children: "hcom" })
			}),
			" — a single Rust binary that\n“hooks your coding agents together” so they message, watch, and spawn each other\nacross terminals — held against what kolu (a workspace where many coding agents\nrun in real terminals you can watch) already is. hcom is a genuinely nice design, and\nthe obvious instinct is “kolu should adopt this.” Checked against both codebases,\nthe honest verdict is the opposite: ",
			createVNode(_components.strong, { children: "kolu already has the channel hcom installs —\nthe filesystem — so it doesn’t need hcom’s." }),
			" This note is why."
		] }) }),
		"\n",
		createVNode($$Svg, {
			svg: hcom_vs_kolu_channel_default,
			caption: "Two ways to wire agents together. hcom installs a message channel (per-tool hooks + a shared event log) because it owns no terminal. kolu owns the terminal and won't touch your config — so it uses the channel every agent already speaks: a shared directory of files, watched for push. The screen is the floor only for what files can't carry.",
			wide: true
		}),
		"\n",
		createVNode(_components.h2, {
			id: "two-ways-to-wire-agents-together",
			children: "Two ways to wire agents together"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"hcom owns ",
			createVNode(_components.strong, { children: "no terminal" }),
			", so to let agents coordinate it has to ",
			createVNode(_components.em, { children: "build a channel" }),
			"\nand inject into each tool. It rides each tool’s hooks (Claude Code’s\n",
			createVNode(_components.code, { children: "PostToolUse" }),
			"/",
			createVNode(_components.code, { children: "Stop" }),
			", Gemini, Codex, …) and a ",
			createVNode(_components.strong, { children: "shared SQLite event log" }),
			", giving\nevery agent an inbox, an event feed, ",
			createVNode(_components.code, { children: "@mention" }),
			" routing, an intent\n(",
			createVNode(_components.code, { children: "request" }),
			"/",
			createVNode(_components.code, { children: "inform" }),
			"/",
			createVNode(_components.code, { children: "ack" }),
			"), and subscriptions. It’s a real coordination fabric.\nThe price is stated in hcom’s own README: its hooks ",
			createVNode(_components.em, { children: [
				"“go into config dirs under\n",
				createVNode(_components.code, { children: "~/" }),
				" on first run,”"
			] }),
			" and each of its ~10 tools needs a hand-written hook and\ntranscript parser."
		] }),
		"\n",
		createVNode(_components.p, { children: "kolu made the other choice, and its README names the two rules that force it:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Agent-agnostic" }),
				" — ",
				createVNode(_components.em, { children: "“no adapter to write, no per-agent code… run it once and\nthe next agent that ships works the same way.”" })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Auto-detected, zero setup" }),
				" — ",
				createVNode(_components.em, { children: "“the surface grows with your workflow, not with\na preferences pane.”" })
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"So kolu ",
			createVNode(_components.strong, { children: ["won’t touch your ", createVNode(_components.code, { children: "~/.claude" })] }),
			". That rules out hcom’s whole mechanism —\nand forces the interesting question: without installed hooks, how do kolu agents\ncoordinate? The answer is already in the repo, and it isn’t the terminal screen."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-filesystem-is-already-the-channel",
			children: "The filesystem is already the channel"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Kolu’s ",
			createVNode(_components.code, { children: "/debate" }),
			" skill — a port of ",
			createVNode(_components.a, {
				href: "https://github.com/srid/llm-debate",
				children: createVNode(_components.code, { children: "srid/llm-debate" })
			}),
			" —\nis the proof. Agents don’t message each other and don’t read each other’s screens.\nThey exchange arguments as ",
			createVNode(_components.strong, { children: "numbered markdown files" }),
			" in a shared directory: each\nreads the others’ turn-files and writes its own ",
			createVNode(_components.em, { children: "by path" }),
			". The skill is explicit —\n",
			createVNode(_components.em, { children: "“pass file paths, not pasted argument text — the agents read and write the shared\ndirectory directly.”" }),
			" A turn being ",
			createVNode(_components.strong, { children: "done" }),
			" is just its ",
			createVNode(_components.strong, { children: "file existing" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: "That’s the whole coordination channel, and it has every property hcom’s log has,\nwith none of the cost:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Every agent speaks it natively." }),
				" Reading and writing files needs no hook, no\nper-agent adapter, no bootstrap primer — it works for ",
				createVNode(_components.code, { children: "claude" }),
				", ",
				createVNode(_components.code, { children: "codex" }),
				", and\nwhatever ships next week, unchanged. It works ",
				createVNode(_components.strong, { children: "headless" }),
				", and it crosses\nmachines over ssh like any other file."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Push, not poll." }),
				" kolu already watches the filesystem (",
				createVNode(_components.code, { children: "@parcel/watcher" }),
				", the\n",
				createVNode(_components.code, { children: ".git/HEAD" }),
				" watcher, session-file watchers). A file appearing or changing ",
				createVNode(_components.em, { children: "is" }),
				" a\npush notification — so “react\nwhen the other agent writes its turn” needs no message bus and no wait-loop."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "It’s shared state you can read after the fact" }),
				" — the turn-files ",
				createVNode(_components.em, { children: "are" }),
				" the\ntranscript, on disk, greppable, diffable, committable. hcom rebuilds this with a\nqueryable event log; kolu gets it from the directory for free."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Map hcom’s headline features onto this and they collapse into things kolu already\nhas: an ",
			createVNode(_components.strong, { children: "inbox" }),
			" is a file the other agent writes; ",
			createVNode(_components.strong, { children: "subscriptions" }),
			" are a watch\non a path; ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "@mention" }), " addressing"] }),
			" is a filename; a ",
			createVNode(_components.strong, { children: "thread" }),
			" is a\nsubdirectory. There is no capability here that kolu lacks — only a different\nspelling of one it already uses."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-adopting-hcoms-channel-would-actually-add--and-why-it-isnt-worth-it",
			children: "What adopting hcom’s channel would actually add — and why it isn’t worth it"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Held against “shared files + a watcher,” a message-inbox API adds ",
			createVNode(_components.strong, { children: "ergonomics, not\ncapability" }),
			" — addressed messages and threads are a nicer surface over what a\ndirectory already does. Two things it does ",
			createVNode(_components.em, { children: "not" }),
			" buy, which is the whole reason\nnot to build it:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "hcom’s one genuinely unique trick is mid-turn injection" }),
				" — dropping a message\nbetween an agent’s tool calls. That is ",
				createVNode(_components.em, { children: "purchased by" }),
				" the hooks kolu refuses. And\nit isn’t wanted for the coordination kolu actually runs: turn-based work\n(",
				createVNode(_components.code, { children: "/debate" }),
				", worker-reviewer, pipeline) ",
				createVNode(_components.em, { children: "wants" }),
				" each agent to finish its turn\nbefore the next input lands. Between-turns — which files already give — is the\ncorrect semantics, not a limitation."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The one real gap it leaves open, a channel can’t close." }),
				" When an agent blocks\non an interactive UI prompt — ",
				createVNode(_components.code, { children: "AskUserQuestion" }),
				", plan approval, a permission\ndialog — that state is invisible to files ",
				createVNode(_components.em, { children: "and" }),
				" logs, and un-answerable by text."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warning",
			title: "The interactive-prompt floor — neither files nor a message bus reach it",
			children: createVNode(_components.p, { children: [
				"Claude Code’s Agent SDK buffers the ",
				createVNode(_components.code, { children: "AskUserQuestion" }),
				"/",
				createVNode(_components.code, { children: "ExitPlanMode" }),
				" message ",
				createVNode(_components.em, { children: "in\nmemory" }),
				" and flushes it to the session transcript file (the agent’s JSONL log) only\n",
				createVNode(_components.strong, { children: "after you answer" }),
				" — so a log reader (and a file-based agent) sees ",
				createVNode(_components.code, { children: "waiting" }),
				",\nnever ",
				createVNode(_components.code, { children: "awaiting_user" }),
				" (",
				createVNode($$Issue, { n: 905 }),
				").\nkolu already had to ",
				createVNode(_components.strong, { children: "read the rendered screen" }),
				" to catch it (",
				createVNode($$PrLink, { pr: 1160 }),
				"),\nmatching literal strings plus the menu’s shape — brittle by nature. And you\n",
				createVNode(_components.em, { children: "answer" }),
				" such a menu with ",
				createVNode(_components.strong, { children: "arrow keys" }),
				", not text. A message channel changes none\nof this: the agent never ",
				createVNode(_components.em, { children: "sends" }),
				" here, it’s blocked in a UI. This is the floor the\nterminal exists to cover, and it’s why driving an agent bottoms out at real\nkeystrokes."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"So the trade is: ",
			createVNode(_components.strong, { children: "ergonomics over a filesystem kolu already uses, bought with the\nper-tool hooks kolu deliberately refuses — and it still doesn’t solve the one hard\ncase." }),
			" Net negative. Don’t adopt it."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-kolu-keeps--the-channel-it-has-and-the-floor-beneath-it",
			children: "What kolu keeps — the channel it has, and the floor beneath it"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The comparison is not “kolu is missing a layer.” It’s that kolu already put each\njob where it belongs — files carry what agents ",
			createVNode(_components.em, { children: "say" }),
			", the terminal carries only\nwhat files ",
			createVNode(_components.em, { children: "can’t" }),
			" — the kind of boundary call (",
			createVNode(_components.a, {
				href: "./electricity.html",
				children: "electricity"
			}),
			",\nin kolu’s terms) that hcom’s hook-everything design has to fight."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The filesystem is the channel" }),
				" ",
				createVNode($$Pill, { children: "keep" }),
				" — content and coordination\nride shared files, watched for push. No hooks, any agent, headless, over ssh."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The terminal is the floor" }),
				" ",
				createVNode($$Pill, { children: "keep" }),
				" — kolu’s terminal CLI\n",
				createVNode(_components.a, {
					href: "./pty-daemon-tui.html",
					children: createVNode(_components.code, { children: "kaval-tui" })
				}),
				" ",
				createVNode(_components.code, { children: "send" }),
				"s the prompt; the screen is read\n",
				createVNode(_components.em, { children: "only" }),
				" for what files can’t carry (the raw prompt keystroke and the interactive\nprompts above). That’s why driving an agent is ",
				createVNode(_components.em, { children: "“press Enter,”" }),
				" not a protocol:\nit’s the one path that works for ",
				createVNode(_components.strong, { children: "any" }),
				" agent at ",
				createVNode(_components.strong, { children: "zero" }),
				" setup — the same\n",
				createVNode(_components.a, {
					href: "./herdr-vs-kolu.html",
					children: "agent-agnostic bet"
				}),
				" kolu makes everywhere, explained for a\ngeneral reader on the ",
				createVNode(_components.a, {
					href: "https://kolu.dev/kaval/",
					children: "kaval page"
				}),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Transport is surface-over-ssh, not a broker" }),
				" ",
				createVNode($$Pill, { children: "keep" }),
				" — hcom’s\ncross-device story is a shared-PSK MQTT relay its own README calls ",
				createVNode(_components.em, { children: "“shell access\non every enrolled device,”" }),
				" with no forward secrecy and no revocation. kolu’s is\n",
				createVNode(_components.a, {
					href: "./remote-terminals.html",
					children: createVNode(_components.code, { children: "@kolu/surface-nix-host" })
				}),
				" over ssh: per-connection OS\nauth, no third-party broker."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"hcom is the right design for a tool that owns no terminal and must therefore\ninstall a channel into your agents. kolu owns the terminal ",
			createVNode(_components.em, { children: "and" }),
			" the working\ndirectory, so it already has one — and keeps the setup-free floor beneath it. The\nthing worth borrowing from hcom isn’t its channel; it’s the clarity that a channel\nis what agents need. kolu answers that with the filesystem."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "hcom vs. kolu — the filesystem is the channel",
	"description": "hcom hooks coding agents together with per-tool hooks and a shared SQLite event log, so agents message, watch, and subscribe to each other. It's a fine design for a tool that owns no terminal. kolu owns the terminal and won't touch your ~/.claude — and it already has a channel every agent speaks natively, the filesystem. Agents coordinate through shared files (as /debate does), kolu watches them for push, and the screen is the floor only for what files can't carry. So the honest verdict is not to adopt hcom's channel — it's that kolu already has one.",
	"parents": ["comparison", "pulam"],
	"maturity": "seedling",
	"updated": "2026-07-01T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "two-ways-to-wire-agents-together",
			"text": "Two ways to wire agents together"
		},
		{
			"depth": 2,
			"slug": "the-filesystem-is-already-the-channel",
			"text": "The filesystem is already the channel"
		},
		{
			"depth": 2,
			"slug": "what-adopting-hcoms-channel-would-actually-add--and-why-it-isnt-worth-it",
			"text": "What adopting hcom’s channel would actually add — and why it isn’t worth it"
		},
		{
			"depth": 2,
			"slug": "what-kolu-keeps--the-channel-it-has-and-the-floor-beneath-it",
			"text": "What kolu keeps — the channel it has, and the floor beneath it"
		}
	];
}
var url = "src/content/atlas/hcom-vs-kolu.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/hcom-vs-kolu.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/hcom-vs-kolu.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
