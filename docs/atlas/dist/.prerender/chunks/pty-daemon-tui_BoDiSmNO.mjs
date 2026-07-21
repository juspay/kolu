import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$D2 } from "./D2_CPv-UX0x.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import { t as $$Issue } from "./Issue_mLFqCJSR.mjs";
import { t as $$Terminal } from "./Terminal_Dk3VeK3f.mjs";
//#region src/content/atlas/pty-daemon-tui.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		li: "li",
		p: "p",
		pre: "pre",
		span: "span",
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
			createVNode(_components.strong, { children: "A terminal-side client of kolu-server’s pty-host." }),
			" kolu-server owns its PTYs ",
			createVNode(_components.em, { children: "in-process" }),
			" today; ",
			createVNode(_components.code, { children: "kaval-tui" }),
			" connects to that same in-process pty-host over a local unix socket (speaking ",
			createVNode(_components.code, { children: "ptyHostSurface" }),
			") and gives you ",
			createVNode(_components.code, { children: "list" }),
			" / ",
			createVNode(_components.code, { children: "create" }),
			" / ",
			createVNode(_components.code, { children: "snapshot" }),
			" / ",
			createVNode(_components.code, { children: "send" }),
			" / ",
			createVNode(_components.code, { children: "attach" }),
			" / ",
			createVNode(_components.code, { children: "kill" }),
			" from the terminal — no browser, ",
			createVNode(_components.strong, { children: "no daemon" }),
			". It is the CLI face of kolu and the seed of a ",
			createVNode(_components.code, { children: "tmux" }),
			"/",
			createVNode(_components.code, { children: "zmx" }),
			" replacement (",
			createVNode($$Issue, { n: 671 }),
			"), shipped in phases as a beta."
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Scoped to kaval-tui-on-the-in-process-server. The parent plan’s Phase R2 — moving the pty-host into a surviving daemon — is a separate plan this later dovetails with (see ",
			createVNode(_components.a, {
				href: "#later",
				children: "Later"
			}),
			"). Ancestry: child of the ",
			createVNode(_components.a, {
				href: "pty-daemon.html",
				children: "pty-daemon"
			}),
			" plan, sibling of the ",
			createVNode(_components.a, {
				href: "pty-daemon-chrome-bar.html",
				children: "chrome-bar rail"
			}),
			"; cf. ",
			createVNode(_components.a, {
				href: "ghostex-vs-remote-terminals.html",
				children: "Ghostex vs. kolu remote-terminals"
			}),
			"."
		] }) }),
		"\n",
		createVNode(_components.h2, {
			id: "architecture--everything-stays-in-process",
			children: "Architecture — everything stays in-process"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"No new process. kolu-server keeps owning the PTYs exactly as it does now; it just exposes the ",
			createVNode(_components.em, { children: "same" }),
			" in-process router over an additional local socket so a second client — the CLI — can reach it. ",
			createVNode(_components.strong, { children: "The web path is byte-identical." })
		] }),
		"\n",
		createVNode($$D2, {
			caption: "One process, two transports onto one router. The browser is the rich client (kolu's full contract: PTY + the provider DAG); kaval-tui is the raw client (ptyHostSurface: PTY + the VT taps), at tmux altitude. The only server change is the additive serveOverStdio socket beside the unchanged directLink web path.",
			code: `direction: down
browser: "browser (the GUI)"
tui: "kaval-tui — packages/kaval-tui"
server: "kolu-server — ONE process · all in-process · NO daemon" {
router: "servePtyHost(deps).router — node-pty fds + @xterm/headless mirror + VT taps"
web: "directLink — web path, unchanged"
sock: "serveOverStdio — NEW, additive: the SAME router on a unix socket"
backend: "LocalTerminalEndpoint — providers, sessions…"
socket: "◆ pty-host.sock ◆"
router -> web
router -> sock
web -> backend
sock -> socket
}
browser -> server.router: "ws · rich: PTY + providers + sessions"
tui -> server.socket: "ptyHostSurface · raw: PTY + taps"
`
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The split by richness." }),
			" The browser is the ",
			createVNode(_components.em, { children: "rich" }),
			" client — it speaks kolu-server’s public contract and gets the whole world (PTY plus the provider DAG: git context, agent state, PR status, session grouping). ",
			createVNode(_components.code, { children: "kaval-tui" }),
			" is the ",
			createVNode(_components.em, { children: "raw" }),
			" client — it speaks ",
			createVNode(_components.code, { children: "ptyHostSurface" }),
			" directly and gets the bare multiplexer (PTY plus the VT taps), exactly the ",
			createVNode(_components.code, { children: "tmux" }),
			" altitude. Both attach to the one in-process pty-host."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The only server change is one additive socket",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "servePtyHost(deps).router" }),
				" already exists and is already consumed in-process via ",
				createVNode(_components.code, { children: "directLink" }),
				". Phase 1 adds ",
				createVNode(_components.code, { children: "serveOverStdio({ router })" }),
				" on a unix socket beside it — the same router, a second transport. The in-process web path doesn’t change; spawning, killing, and metadata all still flow through ",
				createVNode(_components.code, { children: "LocalTerminalEndpoint" }),
				" as today. ",
				createVNode(_components.em, { children: "No PTY moves, no process is added, nothing survives a restart that didn’t before." })
			] })
		}),
		"\n",
		createVNode(_components.h3, {
			id: "why-a-second-client-at-all",
			children: "Why a second client at all"
		}),
		"\n",
		createVNode(_components.p, { children: "Two reasons, both standing on their own without any reference to daemons." }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "It’s a feature." }),
				" A persistent-while-the-server-runs terminal you drive from the shell — the CLI face of kolu, the start of the ",
				createVNode(_components.code, { children: "tmux" }),
				" replacement ",
				createVNode($$Issue, { n: 671 }),
				" has always pointed at."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "It proves the contract is consumer-agnostic." }),
				" A1 (",
				createVNode($$PrLink, { pr: 1055 }),
				") asserts ",
				createVNode(_components.code, { children: "ptyHostSurface" }),
				" is a clean seam — kolu-server talks to the pty-host through a contract, not through ",
				createVNode(_components.code, { children: "node-pty" }),
				" internals. The only real proof of that is a ",
				createVNode(_components.em, { children: "second, independent consumer" }),
				". If writing a terminal client against the surface is clean, the seam is at the right altitude (the “framework needs an end-to-end demo, not just unit tests” lesson — parent plan, lesson #3). If it’s awkward, that’s a finding worth having early."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Honest scope — client-side detach, not server survival",
			children: createVNode(_components.p, { children: [
				"Because the pty-host is in-process, restarting kolu-server (a deploy) ",
				createVNode(_components.strong, { children: "kills" }),
				" its PTYs — ",
				createVNode(_components.code, { children: "kaval-tui" }),
				" does not make terminals survive a ",
				createVNode(_components.em, { children: "server" }),
				" restart. What it does give is ",
				createVNode(_components.strong, { children: "client-side" }),
				" detach/reattach: the CLI can come and go (close the terminal, reopen, re-attach) while kolu-server keeps running and holds the PTY. Surviving a server restart is the separate daemon plan (Phase R2), not this."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-surface--850-loc-in-packageskaval-tui",
			children: ["The surface — ~850 LOC in ", createVNode(_components.code, { children: "packages/kaval-tui" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A small node CLI in its own package, ",
			createVNode(_components.code, { children: "packages/kaval-tui" }),
			", that dials the unix socket through ",
			createVNode(_components.code, { children: "unixSocketLink" }),
			" (the local-IPC member of ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			"’s link family — same base64+newline framing the daemon’s ssh stdio path uses later) and gets a typed ",
			createVNode(_components.code, { children: "ptyHostSurface" }),
			" client. No new wire, no new framing — each accepted connection is pumped through the already-tested ",
			createVNode(_components.code, { children: "serveOverStdio" }),
			"."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Subcommand" }),
					"\n",
					createVNode(_components.th, { children: "Surface call" }),
					"\n",
					createVNode(_components.th, { children: "Behaviour" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "kaval-tui list" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "terminal.list()" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"One-shot — print each live PTY’s id · pid · idle · cmd · cwd (",
						createVNode(_components.code, { children: "cmd" }),
						" = the OSC title or the foreground command), with the full entry under ",
						createVNode(_components.code, { children: "--json" }),
						". The pty-host’s inventory. ",
						createVNode(_components.em, { children: [
							"Shipped: the entry was enriched with ",
							createVNode(_components.code, { children: "title" }),
							" + ",
							createVNode(_components.code, { children: "foregroundProcess" }),
							" (contract 2.1) so this is one round-trip, not per-row tap fetches."
						] })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "kaval-tui attach <id>" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "terminalAttach.get({id})" }),
						" (stream) + ",
						createVNode(_components.code, { children: "terminal.write" }),
						" / ",
						createVNode(_components.code, { children: "terminal.resize" }),
						" + ",
						createVNode(_components.code, { children: "exit.get({id})" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Put the local tty in raw mode. First yield is the ",
						createVNode(_components.strong, { children: "scrollback snapshot" }),
						" → paint to stdout; deltas stream after. Forward stdin via ",
						createVNode(_components.code, { children: "write" }),
						"; ",
						createVNode(_components.code, { children: "SIGWINCH" }),
						" → ",
						createVNode(_components.code, { children: "resize({id, cols, rows})" }),
						". A line-start ",
						createVNode(_components.code, { children: "~." }),
						" escape detaches — the CLI exits, kolu-server keeps the PTY. When the deltas end, the ",
						createVNode(_components.code, { children: "exit" }),
						" stream discriminates “PTY died” (report the real code, quit with it) from “stream dropped” (re-attach; the fresh snapshot repaints). ",
						createVNode(_components.em, { children: "The full client-side loop — reply filter, deterministic restore, sizing — shipped with Phase 2 below." })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "kaval-tui create [-- cmd]" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "terminal.spawn({id, argv, cwd, env, initFiles})" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Mint a UUID client-side and spawn a plain ",
						createVNode(_components.code, { children: "$SHELL" }),
						" (or the given ",
						createVNode(_components.code, { children: "[-- cmd]" }),
						"), then print its id and exit — it does ",
						createVNode(_components.em, { children: "not" }),
						" auto-attach. The whole spawn input is composed client-side (the host derives nothing of its own from R2.1); ",
						createVNode(_components.code, { children: "--json" }),
						" emits the full result for scripting."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "kaval-tui snapshot <id>" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "terminal.getScreenText({id, extent?})" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"One-shot, non-interactive: dump the rendered screen as ",
						createVNode(_components.strong, { children: "plain rendered text" }),
						" (not the ",
						createVNode(_components.code, { children: "terminalAttach" }),
						" first frame — that’s serialized VT screen state for late attach, which would replay control sequences and defeat ",
						createVNode(_components.code, { children: "grep" }),
						") + a trailer line to stderr, then exit. ",
						createVNode(_components.code, { children: "extent" }),
						" is a discriminated union bounding which slice comes back — omit it (or ",
						createVNode(_components.code, { children: "{kind:\"full\"}" }),
						") for the full scrollback; ",
						createVNode(_components.code, { children: "--viewport" }),
						" sends ",
						createVNode(_components.code, { children: "{kind:\"viewport\"}" }),
						" (the host resolves it to its own ",
						createVNode(_components.code, { children: "rows" }),
						" — the CLI can’t know the daemon’s grid) and ",
						createVNode(_components.code, { children: "--tail N" }),
						" sends ",
						createVNode(_components.code, { children: "{kind:\"tail\", lines:N}" }),
						", so an agent-driving loop reads the current screen instead of ",
						createVNode(_components.code, { children: "| tail" }),
						"-ing a huge buffer. (A ",
						createVNode(_components.code, { children: "{kind:\"range\", startLine?, endLine?}" }),
						" variant rounds out the union for callers wanting an explicit line window.) The scriptable primitive the ",
						createVNode(_components.a, {
							href: "#headless-test",
							children: "headless test"
						}),
						" asserts on."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "kaval-tui send <id> [text]" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "terminal.write({id, data})" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"One-shot, non-interactive: write input to a PTY (typically a prompt to a Claude Code / Codex / opencode agent), then exit. Writes ",
						createVNode(_components.strong, { children: [
							"exactly the text OR the ",
							createVNode(_components.code, { children: "--key" }),
							"s — never both, no implicit Enter"
						] }),
						". Submitting is its ",
						createVNode(_components.strong, { children: "own" }),
						" step, because a same-breath Enter races the TUI’s paste debounce and is dropped: send the text, ",
						createVNode(_components.strong, { children: createVNode(_components.code, { children: "wait --until idle:<ms>" }) }),
						" to observe the TUI settle, then ",
						createVNode(_components.strong, { children: createVNode(_components.code, { children: "send <id> --key Enter" }) }),
						". ",
						createVNode(_components.strong, { children: createVNode(_components.code, { children: "--file <path>" }) }),
						" reads the text straight from a file (byte-exact, no ",
						createVNode(_components.code, { children: "\"$(cat)\"" }),
						" shell mangling — for a prompt with metacharacters, not as a large-paste path). Multiline / ",
						createVNode(_components.code, { children: "--file" }),
						" / piped-stdin text is wrapped in a ",
						createVNode(_components.strong, { children: "bracketed paste" }),
						" so it lands as a block, not line-by-line; ",
						createVNode(_components.code, { children: "--key" }),
						" also sends control keys (Escape, C-c, arrows). A write that can’t complete ",
						createVNode(_components.strong, { children: "fails loud in seconds" }),
						" instead of hanging. Known limitation: a ",
						createVNode(_components.strong, { children: "large" }),
						" paste that Claude Code folds into a placeholder does not reliably submit on Enter (issue #1702); the three-step flow is verified for normal-size prompts. The ",
						createVNode(_components.em, { children: "write" }),
						" half of the ",
						createVNode(_components.code, { children: "create" }),
						" → ",
						createVNode(_components.code, { children: "send" }),
						" → ",
						createVNode(_components.code, { children: "wait" }),
						" → ",
						createVNode(_components.code, { children: "send --key Enter" }),
						" → ",
						createVNode(_components.code, { children: "snapshot" }),
						" loop one agent uses to drive another."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "kaval-tui wait <id> --until <cond>" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "terminalAttach.get({id})" }),
						" (stream) + ",
						createVNode(_components.code, { children: "exit.get({id})" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.em, { children: [
							"Added later (",
							createVNode($$Issue, { n: 1629 }),
							"), beyond the R-4 phases below."
						] }),
						" Block until the terminal’s raw OUTPUT meets a condition, then exit — the hook-free done-signal for the ",
						createVNode(_components.code, { children: "create → send → wait → snapshot" }),
						" loop. ",
						createVNode(_components.code, { children: "--until idle:<ms>" }),
						" resolves on output quiescence (no byte for ",
						createVNode(_components.code, { children: "<ms>" }),
						" — the turn ended), ",
						createVNode(_components.code, { children: "--until match:<regex>" }),
						" on new output matching. Client-side debounce/scan over the ",
						createVNode(_components.strong, { children: "existing" }),
						" output tap (no contract member added); ",
						createVNode(_components.code, { children: "--timeout" }),
						" fails loud (exit 2), a terminal that exits first exits 3. The raw-output analog of ",
						createVNode(_components.code, { children: "pulam-tui wait" }),
						"’s hooked agent-state done-signal."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "kaval-tui kill <id>" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "terminal.kill({id})" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Out-of-band termination — exercises the order-safe kill path (abort the exit tap ",
						createVNode(_components.em, { children: "then" }),
						" kill) from a non-browser client."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Of the taps, attach consumes ",
			createVNode(_components.code, { children: "exit" }),
			" — stream-end discrimination plus the real exit code, which tombstones server-side so it’s retrievable even after the deltas end. The metadata taps (",
			createVNode(_components.code, { children: "cwd" }),
			" / ",
			createVNode(_components.code, { children: "title" }),
			" / ",
			createVNode(_components.code, { children: "foreground" }),
			") feed ",
			createVNode(_components.strong, { children: "no persistent status line" }),
			": that early sketch contradicted the raw-passthrough decision and was dropped (see the Phase 2 decisions below); they stay on the contract for a later richer UX. ",
			createVNode(_components.code, { children: "--json" }),
			" makes ",
			createVNode(_components.code, { children: "list" }),
			" machine-readable; ",
			createVNode(_components.code, { children: "--socket <path>" }),
			" points at a non-default server."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Contract reality check",
			children: [createVNode(_components.p, { children: [
				"The subcommand → surface mapping is shorthand; these are the exact shapes the ",
				createVNode(_components.em, { children: "current" }),
				" ",
				createVNode(_components.code, { children: "ptyHostSurface" }),
				" exposes (verified against ",
				createVNode(_components.code, { children: "@kolu/pty-host" }),
				" after A1 ",
				createVNode($$PrLink, { pr: 1055 }),
				" and the link-family unification ",
				createVNode($$PrLink, { pr: 1059 }),
				"). ",
				createVNode(_components.strong, { children: "All three phases have now landed" }),
				" — the socket + list-metadata items in Phase 1 (",
				createVNode($$PrLink, { pr: 1084 }),
				"), and the spawn-command item in Phase 3 (the R2.1 client-composed spawn, ",
				createVNode($$PrLink, { pr: 1370 }),
				")."
			] }), createVNode(_components.ul, { children: [
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: [
						createVNode(_components.code, { children: "terminal.list" }),
						" now carries the metadata — resolved in ",
						createVNode($$PrLink, { pr: 1084 }),
						"."
					] }),
					" The entry was ",
					createVNode(_components.code, { children: "{ id, pid, cwd, lastActivity }" }),
					" with no title; Phase 1 enriched it with ",
					createVNode(_components.code, { children: "title" }),
					" + ",
					createVNode(_components.code, { children: "foregroundProcess" }),
					" (contract 2.1, additive · optional), so a one-shot ",
					createVNode(_components.code, { children: "list" }),
					" shows a ",
					createVNode(_components.code, { children: "cmd" }),
					" column without per-row tap subscriptions. ",
					createVNode(_components.code, { children: "list --json" }),
					" emits a top-level array (",
					createVNode(_components.code, { children: "jq '.[]'" }),
					"-friendly)."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: [
						createVNode(_components.code, { children: "terminal.spawn" }),
						" now carries the command via ",
						createVNode(_components.code, { children: "argv" }),
						" — resolved by R2.1 (",
						createVNode($$PrLink, { pr: 1370 }),
						")."
					] }),
					" The input is ",
					createVNode(_components.code, { children: "{ id?, argv, cwd, env, initFiles, cols?, rows?, scrollback? }" }),
					": ",
					createVNode(_components.code, { children: "argv" }),
					" is the fully resolved program + args (",
					createVNode(_components.code, { children: "argv[0]" }),
					" is the shell, or the ",
					createVNode(_components.code, { children: "[-- cmd]" }),
					" passed verbatim), and the host neither chooses the shell nor appends flags — the client composes the whole input (",
					createVNode(_components.code, { children: "buildCreateInput" }),
					") and the host derives nothing of its own. So ",
					createVNode(_components.code, { children: "create [-- cmd]" }),
					" needed no extra field: a passed command becomes ",
					createVNode(_components.code, { children: "argv" }),
					", an absent one defaults to ",
					createVNode(_components.code, { children: "[$SHELL]" }),
					". The earlier “no command field” gap is closed."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "The taps are host-method names; on the wire they’re streams." }),
					" ",
					createVNode(_components.code, { children: "subscribeCwd" }),
					"/",
					createVNode(_components.code, { children: "subscribeTitle" }),
					"/",
					createVNode(_components.code, { children: "subscribeForeground" }),
					"/",
					createVNode(_components.code, { children: "exitPromise" }),
					" are ",
					createVNode(_components.code, { children: "PtyHost" }),
					" methods below the seam — a CLI client consumes the surface ",
					createVNode(_components.em, { children: "streams" }),
					" ",
					createVNode(_components.code, { children: "surface.cwd.get({id})" }),
					" / ",
					createVNode(_components.code, { children: "surface.title.get({id})" }),
					" / ",
					createVNode(_components.code, { children: "surface.foreground.get({id})" }),
					" / ",
					createVNode(_components.code, { children: "surface.exit.get({id})" }),
					". ",
					createVNode(_components.code, { children: "exit" }),
					" crosses as a one-shot ",
					createVNode(_components.em, { children: "stream" }),
					" (yields ",
					createVNode(_components.code, { children: "{ exitCode }" }),
					" once, then ends), not a ",
					createVNode(_components.code, { children: "Promise" }),
					"."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: [
						"The socket exists at a stable path — resolved in ",
						createVNode($$PrLink, { pr: 1084 }),
						"."
					] }),
					" ",
					createVNode(_components.code, { children: "servePtyHostOverUnixSocket" }),
					" chose ",
					createVNode(_components.code, { children: "$XDG_RUNTIME_DIR/kolu/pty-host.sock" }),
					" (distinct from the per-process ",
					createVNode(_components.code, { children: "kolu-<serverProcessId>/" }),
					" scratch dir), with a fixed, ",
					createVNode(_components.code, { children: "$TMPDIR" }),
					"-independent ",
					createVNode(_components.code, { children: "/tmp/kolu-$UID/pty-host.sock" }),
					" fallback off systemd — deliberately NOT ",
					createVNode(_components.code, { children: "os.tmpdir()" }),
					", which differs by launch context so server and CLI would miss each other — and a ",
					createVNode(_components.code, { children: "--socket" }),
					" override (the same flag name on server and CLI). ",
					createVNode(_components.code, { children: "getPtyHostSocketPath" }),
					" is the one resolver both share; a live-vs-stale probe stops a second server hijacking a live socket."
				] }),
				"\n"
			] })]
		}),
		"\n",
		createVNode(_components.h3, {
			id: "decisions-recorded-here-to-be-echoed-in-code-comments",
			children: "Decisions recorded here (to be echoed in code comments)"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Decision" }),
					"\n",
					createVNode(_components.th, { children: "Choice" }),
					"\n",
					createVNode(_components.th, { children: "Why" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Home" }) }),
					"\n",
					createVNode(_components.td, { children: ["a tiny separate ", createVNode(_components.code, { children: "packages/kaval-tui" })] }),
					"\n",
					createVNode(_components.td, { children: [
						"An independent CLI package, not a ",
						createVNode(_components.code, { children: "bin" }),
						" folded into ",
						createVNode(_components.code, { children: "kaval" }),
						" — keeps the kaval daemon package focused on the contract + primitive, and keeps the CLI’s own deps (raw-tty handling, arg parsing) out of the closure the A2 staleKey hashes."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Render fidelity" }) }),
					"\n",
					createVNode(_components.td, { children: "raw VT passthrough" }),
					"\n",
					createVNode(_components.td, { children: [
						"Write the pty-host’s bytes straight to stdout; do ",
						createVNode(_components.em, { children: "not" }),
						" re-render through a second ",
						createVNode(_components.code, { children: "@xterm/headless" }),
						" mirror. Simplest and truest, and it avoids a second rendering path drifting from the server’s. ",
						createVNode(_components.em, { children: "Recorded as a design-decision comment at the passthrough site." })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Detach / escape" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"ssh-style line-start ",
						createVNode(_components.code, { children: "~" }),
						" escape — ",
						createVNode(_components.strong, { children: ["never ", createVNode(_components.code, { children: "Ctrl+B" })] })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"A passthrough multiplexer must not steal any control char the inner tools need — ",
						createVNode(_components.code, { children: "Ctrl+B" }),
						" and ",
						createVNode(_components.code, { children: "Ctrl+J" }),
						" are reserved by Claude Code (",
						createVNode(_components.code, { children: "input/prohibitedKeybinds.ts" }),
						"). The escape is the unambiguous ssh model: ",
						createVNode(_components.code, { children: "~" }),
						" recognised ",
						createVNode(_components.em, { children: "only" }),
						" immediately after a newline. ",
						createVNode(_components.code, { children: "~." }),
						" detach · ",
						createVNode(_components.code, { children: "~~" }),
						" literal tilde · ",
						createVNode(_components.code, { children: "~?" }),
						" help; configurable via ",
						createVNode(_components.code, { children: "--escape" }),
						" (a single character). The ",
						createVNode(_components.code, { children: "kill" }),
						" ",
						createVNode(_components.em, { children: "subcommand" }),
						" shipped (Phase 3, ",
						createVNode($$PrLink, { pr: 1462 }),
						"), but the in-attach ",
						createVNode(_components.code, { children: "~k" }),
						" escape is still later — killing is a standalone ",
						createVNode(_components.code, { children: "kaval-tui kill <id>" }),
						" today, not a keystroke from inside attach. A literal ",
						createVNode(_components.code, { children: "~" }),
						" mid-line passes through untouched, so ",
						createVNode(_components.em, { children: "every" }),
						" inner-app chord reaches the program unmodified."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "phasing--three-beta-increments-all-in-process",
			children: "Phasing — three beta increments, all in-process"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Phases 1–3 build kaval-tui on the in-process server — each leaves Kolu working, ships on its own, and changes nothing in the web path. They’re preceded by a ",
			createVNode(_components.strong, { children: "Phase 0" }),
			" that lives ",
			createVNode(_components.em, { children: "outside" }),
			" kolu: a surface example that rehearses the whole “interactive TUI over oRPC stdio” pattern."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Phase" }),
					"\n",
					createVNode(_components.th, { children: "Ships" }),
					"\n",
					createVNode(_components.th, { children: "Server change" }),
					"\n",
					createVNode(_components.th, { children: "User-visible" }),
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
						createVNode(_components.strong, { children: "0 · surface example" }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1073 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"A minimal CI-runner TUI over oRPC stdio in ",
						createVNode(_components.code, { children: "@kolu/surface" }),
						"’s examples — the 3rd example, after the worker demo + the remote-process-monitor (→ ",
						createVNode(_components.a, {
							href: "https://github.com/srid/drishti",
							children: "drishti"
						}),
						")."
					] }),
					"\n",
					createVNode(_components.td, { children: "None — separate from kolu-server." }),
					"\n",
					createVNode(_components.td, { children: "A standalone example; proves the pattern and becomes kaval-tui’s reference skeleton." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: ["1 · ", createVNode(_components.code, { children: "list" })] }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1084 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"kolu-server serves its in-process pty-host router over a unix socket (",
						createVNode(_components.code, { children: "@kolu/surface" }),
						"’s ",
						createVNode(_components.code, { children: "serveOverUnixSocket" }),
						"); new ",
						createVNode(_components.code, { children: "@kolu/pty-tui" }),
						" with ",
						createVNode(_components.code, { children: "list" }),
						" + read-only ",
						createVNode(_components.code, { children: "snapshot" }),
						". ",
						createVNode(_components.code, { children: "list" }),
						" carries full metadata from the enriched ",
						createVNode(_components.code, { children: "terminal.list" }),
						" (contract 2.1)."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"+1 local socket listener on the existing router (",
						createVNode(_components.code, { children: "servePtyHostOverUnixSocket" }),
						"). Web path byte-identical."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"A beta CLI that ",
						createVNode(_components.em, { children: "lists" }),
						" and ",
						createVNode(_components.em, { children: "snapshots" }),
						" your live terminals — ",
						createVNode(_components.code, { children: "nix run …#kaval-tui" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: ["2 · ", createVNode(_components.code, { children: "attach" })] }),
						" ",
						createVNode($$Pill, {
							variant: "ok",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1255 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Raw-tty passthrough, snapshot-then-delta, stdin→",
						createVNode(_components.code, { children: "write" }),
						", ",
						createVNode(_components.code, { children: "SIGWINCH" }),
						"→",
						createVNode(_components.code, { children: "resize" }),
						", the ",
						createVNode(_components.code, { children: "~" }),
						"-escape detach — plus the device-query reply filter and the deterministic terminal restore the loop needs (specced below)."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"None beyond Phase 1, except one nicety, shipped: ",
						createVNode(_components.code, { children: "terminalAttach" }),
						" on a bad id is a clean ",
						createVNode(_components.code, { children: "NOT_FOUND" }),
						" (one composed ",
						createVNode(_components.code, { children: "requirePty" }),
						" guard; error shape only, no contract bump)."
					] }),
					"\n",
					createVNode(_components.td, { children: "Drive a terminal from the CLI; detach and re-attach while the server runs." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: [
						"3 · ",
						createVNode(_components.code, { children: "create" }),
						" / ",
						createVNode(_components.code, { children: "--host" }),
						" / ",
						createVNode(_components.code, { children: "kill" })
					] }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "create" }),
						" (a plain ",
						createVNode(_components.code, { children: "$SHELL" }),
						" or a given command, ",
						createVNode(_components.code, { children: "--json" }),
						") ",
						createVNode($$Pill, {
							variant: "ok",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1370 }),
						"; remote ",
						createVNode(_components.code, { children: "--host" }),
						" (reach + provision over ssh) ",
						createVNode($$Pill, {
							variant: "ok",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1373 }),
						"; ",
						createVNode(_components.code, { children: "kill <id>" }),
						" (resolve a short id, ",
						createVNode(_components.code, { children: "terminal.kill" }),
						") ",
						createVNode($$Pill, {
							variant: "ok",
							children: "shipped"
						}),
						" ",
						createVNode($$PrLink, { pr: 1462 }),
						"."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"None for ",
						createVNode(_components.code, { children: "create" }),
						"/",
						createVNode(_components.code, { children: "kill" }),
						" (the kill RPC already existed); ",
						createVNode(_components.code, { children: "--host" }),
						" adds a ",
						createVNode(_components.code, { children: "kaval --stdio" }),
						" front that relays the ssh link to the durable daemon’s socket."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Create PTYs from the CLI, reach a remote kaval over ssh (a created terminal survives the link — create on prod, attach later), and ",
						createVNode(_components.code, { children: "kill" }),
						" them: a usable raw multiplexer (beta). The remote phasing lives in ",
						createVNode(_components.a, {
							href: "kaval-sessions.html",
							children: "kaval-sessions"
						}),
						"."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Phase 1 alone is the smallest honest first ship of ",
			createVNode(_components.em, { children: "kaval-tui" }),
			" — a one-shot RPC, no raw-tty mode, the “hello world” that proves ",
			createVNode(_components.code, { children: "serveOverUnixSocket" }),
			" + ",
			createVNode(_components.code, { children: "unixSocketLink" }),
			" + the contract round-trip, at near-zero risk."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "phase-0--a-minimal-ci-runner-tui-the-3rd-surface-example-shipped-",
			children: [
				"Phase 0 — a minimal CI-runner TUI (the 3rd surface example) ",
				createVNode($$Pill, {
					variant: "ok",
					children: "shipped"
				}),
				" ",
				createVNode($$PrLink, { pr: 1073 })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Before touching kolu, prove the pattern in ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			"’s examples — the falsifiability test of lesson #3 applied to “interactive TUI over oRPC stdio,” the way the worker demo and the remote-process-monitor (which became ",
			createVNode(_components.a, {
				href: "https://github.com/srid/drishti",
				children: "drishti"
			}),
			") validated the earlier patterns. The candidate: a ",
			createVNode(_components.strong, { children: "minimal CI runner" }),
			" — justci-",
			createVNode(_components.em, { children: "flavoured" }),
			" but self-contained, deliberately ",
			createVNode(_components.em, { children: "not" }),
			" the real ",
			createVNode(_components.a, {
				href: "https://github.com/juspay/justci",
				children: "justci"
			}),
			". Just a small DAG of shell commands, runnable locally or on a single remote host."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "As built (#1073, merged)",
			children: createVNode(_components.p, { children: [
				"Shipped as ",
				createVNode(_components.code, { children: "@kolu/surface-example-mini-ci" }),
				". Two things landed differently from the original sketch, both deliberately: the remote transport ",
				createVNode(_components.em, { children: [
					"pivoted from ",
					createVNode(_components.code, { children: "git archive" }),
					" source-ship to the drishti ",
					createVNode(_components.code, { children: "HostSession" }),
					" closure-ship"
				] }),
				" (so the example exercises the very R3 transport the parent plan builds on), and the default pipeline ",
				createVNode(_components.em, { children: "runs real typecheck CI for the remote-process-monitor example" }),
				" (a ",
				createVNode(_components.code, { children: "surface" }),
				" + ",
				createVNode(_components.code, { children: "nix-host" }),
				" → ",
				createVNode(_components.code, { children: "monitor" }),
				" diamond of ",
				createVNode(_components.code, { children: "tsc --noEmit" }),
				" gates) rather than a toy ",
				createVNode(_components.code, { children: "build → test → lint" }),
				". The dashboard binds ",
				createVNode(_components.strong, { children: "plain keys" }),
				" (digits/",
				createVNode(_components.code, { children: "n" }),
				"/",
				createVNode(_components.code, { children: "p" }),
				"/",
				createVNode(_components.code, { children: "r" }),
				"/",
				createVNode(_components.code, { children: "q" }),
				"), ",
				createVNode(_components.em, { children: "not" }),
				" the ",
				createVNode(_components.code, { children: "~" }),
				"-escape — it renders structured state and owns the keyboard. One constraint to carry forward: the runner ships as a read-only nix closure, so only read-only tasks (typecheck) belong in the default pipeline."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"It’s a clean structural twin of kaval-tui: a long-lived runner owns the DAG + each node’s process + its log buffer, and streams to ephemeral TUI clients over stdio. The plan’s ",
			createVNode(_components.code, { children: "nodes.list()" }),
			" / ",
			createVNode(_components.code, { children: "node.log(id)" }),
			" / ",
			createVNode(_components.code, { children: "node.rerun(id)" }),
			" map onto the framework-idiomatic spelling — a ",
			createVNode(_components.code, { children: "nodes" }),
			" ",
			createVNode(_components.em, { children: "cell" }),
			" (",
			createVNode(_components.code, { children: "surface.nodes.get({})" }),
			") ↔ kaval-tui’s ",
			createVNode(_components.code, { children: "list" }),
			"; a ",
			createVNode(_components.code, { children: "nodeLog" }),
			" ",
			createVNode(_components.em, { children: "stream" }),
			" (snapshot-then-delta) ↔ ",
			createVNode(_components.code, { children: "attach" }),
			"; a ",
			createVNode(_components.code, { children: "node.rerun" }),
			" ",
			createVNode(_components.em, { children: "procedure" }),
			" ↔ input. That this was clean to write against the surface primitives is the finding: the seam is at the right altitude for kaval-tui to inherit. The example is now kaval-tui’s copy-paste skeleton and a permanent regression test for the pattern."
		] }),
		"\n",
		createVNode($$Terminal, {
			title: "mini-ci · pipeline remote-process-monitor · attached: monitor",
			lines: [
				"✔ surface    (2.3s)",
				"✔ nix-host   (1.9s)",
				"▶ monitor    running…  ──▶ attached  (needs: surface, nix-host)",
				"────────────────────────────────",
				"$ pnpm --filter @kolu/surface-example-remote-process-monitor typecheck",
				"  $ tsc --noEmit",
				"  ❯ type-checking…",
				"1-9 attach · n/p cycle · r rerun · q quit · ● 1 running · 2 ok · 0 pending"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Remote mode ships the runner the drishti way: a prebuilt ",
			createVNode(_components.code, { children: "mini-ci-runner" }),
			" nix closure is ",
			createVNode(_components.code, { children: "nix copy" }),
			"’d to the host, realised, then run as ",
			createVNode(_components.code, { children: "ssh host mini-ci-runner --stdio" }),
			" with the TUI attached over ",
			createVNode(_components.strong, { children: "stdio-over-ssh" }),
			" via ",
			createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
			"’s ",
			createVNode(_components.code, { children: "getHostSession({ host, binary, resolveDrvPath })" }),
			" (which owns ref-count, reconnect, watchdog, and a ",
			createVNode(_components.code, { children: "copying → connecting → connected" }),
			" state cell). ",
			createVNode(_components.code, { children: "localhost" }),
			" skips the ",
			createVNode(_components.code, { children: "nix copy" }),
			" and runs the realised binary directly — the ",
			createVNode(_components.em, { children: "same" }),
			" ",
			createVNode(_components.code, { children: "HostSession" }),
			", only the transport differs."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "phase-2--the-attach-loop-shipped-",
			children: [
				"Phase 2 — the attach loop ",
				createVNode($$Pill, {
					variant: "ok",
					children: "shipped"
				}),
				" ",
				createVNode($$PrLink, { pr: 1255 })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Recon verdict before implementation, borne out by the ship: ",
			createVNode(_components.strong, { children: "no contract bump, no server change" }),
			" — ",
			createVNode(_components.code, { children: "terminalAttach" }),
			" / ",
			createVNode(_components.code, { children: "write" }),
			" / ",
			createVNode(_components.code, { children: "resize" }),
			" / ",
			createVNode(_components.code, { children: "exit" }),
			" all exist at contract 2.1 (and the web path already consumes the same ",
			createVNode(_components.code, { children: "host.attach" }),
			" as just another subscriber on the per-PTY broadcast channel, so a CLI attach violates no exclusivity). Attach is a pure consumer; no drishti-mirror PR. The whole phase is ~300–400 LOC in ",
			createVNode(_components.code, { children: "packages/kaval-tui" }),
			" plus tests. ",
			createVNode(_components.em, { children: [
				"One delivery note: the reply filter first shipped as a move of the browser’s ",
				createVNode(_components.code, { children: "terminalResponseFilter" }),
				" into ",
				createVNode(_components.code, { children: "kolu-common" }),
				"; a blocking structural review then promoted the whole protocol policy — grammars + stripper, the headless forward/drop rule, the answered/silent device-query matrix, paste delimiters, and the snapshot-reciprocal TTY reset — into a dedicated zero-dep leaf, ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/terminal-protocol" }) }),
				", that the browser, the pty-host, and kaval-tui all import. The pty-host’s staleKey hashes it (a protocol change is observable daemon behaviour), and its device-query matrix is executed as contract tests against a real headless."
			] })
		] }),
		"\n",
		createVNode($$D2, {
			caption: "The attach loop, client-side only. Stdin bytes run through the escape machine and the reply filter before terminal.write; the attach stream pumps to stdout through the existing backpressure helper; every exit path funnels through one restore.",
			code: `direction: down
tty: "your terminal — raw mode"
cli: "kaval-tui attach — packages/kaval-tui" {
esc: "escape machine — bytes · line-start ~ · paste-aware"
filter: "reply filter — drop the tty's auto-answers (DA1/DSR/XTVERSION...)"
pump: "delta pump — writeOut backpressure"
restore: "restore — ONE path for detach · PTY exit · signals · crash"
esc -> filter
}
server: "kolu-server pty-host — unchanged"
tty -> cli.esc: "stdin bytes"
cli.filter -> server: "terminal.write (+ resize on SIGWINCH)"
server -> cli.pump: "terminalAttach: snapshot, then deltas"
cli.pump -> tty: "stdout"
cli.restore -> tty: "setRawMode(false) + reset string"
`
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The sequence: connect → version gate (both shipped in Phase 1) → ",
			createVNode(_components.strong, { children: "resize-then-attach" }),
			" → raw mode → one-shot ",
			createVNode(_components.code, { children: "↻ snapshot restored…" }),
			" notice → paint snapshot → pump until detach or stream end. Five decisions carry the design weight (echoed as code comments at their sites, per this note’s convention):"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Decision" }),
					"\n",
					createVNode(_components.th, { children: "Choice" }),
					"\n",
					createVNode(_components.th, { children: "Why" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Device-query replies" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"filter the tty’s auto-answers out of the stdin→",
						createVNode(_components.code, { children: "write" }),
						" path"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"The snapshot/deltas carry queries (DA1 · DSR/CPR · XTVERSION …) that the user’s ",
						createVNode(_components.em, { children: "real" }),
						" terminal auto-answers on stdin — but the headless mirror already answered them server-side, so forwarding the duplicate reply corrupts the inner program’s stdin (the yazi-class bug). Mirror the browser path’s suppression predicates, preserving the client-suppressed ⇒ server-answered invariant."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Terminal restore" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"one deterministic reset on ",
						createVNode(_components.em, { children: "every" }),
						" exit path"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"The snapshot replays modes onto the local terminal — alt-buffer (",
						createVNode(_components.code, { children: "?1049h" }),
						"), mouse tracking, bracketed paste (",
						createVNode(_components.code, { children: "?2004h" }),
						"), app cursor keys. Detach, PTY exit, SIGTERM/SIGHUP, and crash all run ",
						createVNode(_components.code, { children: "setRawMode(false)" }),
						" ",
						createVNode(_components.strong, { children: "+ a fixed reset string" }),
						" (alt-buffer off, mouse off, paste-wrap off, cursor visible). Restore is much more than un-raw-ing stdin."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Sizing" }) }),
					"\n",
					createVNode(_components.td, { children: "resize-then-attach; last-resize-wins across clients" }),
					"\n",
					createVNode(_components.td, { children: [
						"The snapshot serializes at the server-side grid (the browser’s last size, or the 80×24 default); resizing ",
						createVNode(_components.em, { children: "first" }),
						" renders it at the local dimensions. The contract has no size-change tap, so a concurrently-attached browser tile may show wrap artifacts until its own next resize — accepted and documented; a size tap would be contract 2.2, out of Phase 2 scope."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Status lines" }) }),
					"\n",
					createVNode(_components.td, { children: ["one-shot notices only — ", createVNode(_components.strong, { children: "no persistent footer" })] }),
					"\n",
					createVNode(_components.td, { children: [
						"A live taps-fed footer needs scroll-region ownership, which violates the raw-passthrough render-fidelity decision above (the earlier sketch self-contradicted). One line before the paint (",
						createVNode(_components.code, { children: "↻ snapshot restored…" }),
						"), one after restore on detach; the CLI owns zero pixels while attached."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Stream end & retry" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"discriminate via the ",
						createVNode(_components.code, { children: "exit" }),
						" stream; never auto-retry"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"The deltas iterator ends identically on PTY exit, server-side abort, and the silent slow-consumer drop (bounded 10k queue). On end, ask ",
						createVNode(_components.code, { children: "exit" }),
						": code present → report it, quit with it; PTY still live → re-attach, and the fresh snapshot repaints — exactly the right recovery for the drop case. Stream auto-retry would replay the snapshot mid-session, so attach opts out; if the server itself goes away the CLI restores the tty and prints an honest one-liner — manual re-dial is the only reconnect."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The escape machine’s fine print: it runs on ",
			createVNode(_components.strong, { children: "bytes" }),
			", decoding via ",
			createVNode(_components.code, { children: "string_decoder" }),
			" only at the ",
			createVNode(_components.code, { children: "write" }),
			" boundary so multibyte characters split across stdin chunks survive; session start counts as line-start (ssh behaviour); recognition is suspended inside bracketed-paste brackets so a pasted ",
			createVNode(_components.code, { children: "\\n~." }),
			" cannot detach; in raw mode ",
			createVNode(_components.code, { children: "Ctrl+C" }),
			" arrives as byte ",
			createVNode(_components.code, { children: "0x03" }),
			" and is ",
			createVNode(_components.em, { children: "forwarded" }),
			" like everything else — only external SIGTERM/SIGHUP trigger the restore-and-exit path."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Testing." }),
			" The escape machine, reply filter, and reset emission are pure functions — unit-tested with no tty (the ",
			createVNode(_components.code, { children: "render.test.ts" }),
			" pattern). The loop itself is factored over read/write streams plus a tty-ish interface and integration-tested against the real-socket harness (the ",
			createVNode(_components.code, { children: "serveOverSocket.test.ts" }),
			" pattern: in-process pty-host + ",
			createVNode(_components.code, { children: "unixSocketLink" }),
			" on a temp socket). The home-manager VM test keeps its ",
			createVNode(_components.code, { children: "list" }),
			" smoke — attach is infeasible headless."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-user-flow",
			children: "The user flow"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The interactive loop a user walks, then the same loop scripted as a headless test. The running example: a PTY ",
			createVNode(_components.code, { children: "3f9a…c21" }),
			" in ",
			createVNode(_components.code, { children: "~/code/kolu" }),
			" that becomes a Claude Code session."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "interactive-session",
			children: "Interactive session"
		}),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Is the server’s pty-host reachable?" }), " — an unreachable pty-host is a clear, immediate error, never a silent empty hang:"] }),
		"\n",
		createVNode(_components.pre, {
			class: "astro-code github-light",
			style: {
				backgroundColor: "#fff",
				color: "#24292e",
				overflowX: "auto"
			},
			tabindex: "0",
			"data-language": "text",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "$ kaval-tui list" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "kaval-tui: no pty-host socket at /run/user/1000/kolu/pty-host.sock (ECONNREFUSED)" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "          is kolu-server running? the socket appears once it boots." })
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The inventory" }),
			" — ",
			createVNode(_components.code, { children: "list" }),
			" from another shell, one row per live PTY (the status line reports the in-process pty-host):"
		] }),
		"\n",
		createVNode($$Terminal, {
			title: "kaval-tui · unixSocketLink → /run/user/1000/kolu/pty-host.sock",
			lines: [
				"$ kaval-tui list",
				"",
				"ID         PID    IDLE  CMD                        CWD",
				"3f9a…c21   12843  5s    claude: implement pty-tui  ~/code/kolu",
				"7b2e…0d4   12901  2m    zsh                        ~/code/kolu/.worktrees/…",
				"a18c…9ff   13044  1m    vim notes.md               ~/scratch",
				"● 3 live PTYs (in kolu-server, in-process) · pty-host pid 9981"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Birth → work → detach → re-attach" }),
			" (Phase 2/3). ",
			createVNode(_components.code, { children: "create" }),
			" mints a PTY and prints its id; ",
			createVNode(_components.code, { children: "attach <id>" }),
			" takes it over — everything passes through raw, the CLI owns no pixels while attached; a line-start ",
			createVNode(_components.code, { children: "~." }),
			" detaches (the server keeps the PTY); re-attach repaints the full scrollback snapshot instantly because the first yield of the attach stream ",
			createVNode(_components.em, { children: "is" }),
			" the snapshot, serialized at the local tty’s dimensions thanks to resize-then-attach."
		] }),
		"\n",
		createVNode($$Terminal, {
			title: "kaval-tui · re-attached 3f9a…c21 · claude: implement pty-tui",
			lines: [
				"↻ snapshot restored — 1,284 lines · PTY pid 12843 unchanged",
				"⏺ Bash(git status)",
				"  ⎿ On branch master — working tree clean",
				"> █",
				"~.  — detached · 3f9a…c21 stays live in kolu-server · re-attach anytime"
			]
		}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: "This is client-side detach — distinct from server survival. If kolu-server itself restarts, the in-process PTY dies; that persistence is the separate daemon plan." }) }),
		"\n",
		createVNode(_components.h3, {
			id: "headless-test--client-death-detachreattach-no-browser",
			children: "Headless test — client-death detach/reattach, no browser"
		}),
		"\n",
		createVNode(_components.p, { children: "The detach/reattach loop scripted: it asserts that the CLI client can die and a fresh one re-joins the same PTY (the server runs throughout) — fast, no browser." }),
		"\n",
		createVNode(_components.pre, {
			class: "astro-code github-light",
			style: {
				backgroundColor: "#fff",
				color: "#24292e",
				overflowX: "auto"
			},
			tabindex: "0",
			"data-language": "bash",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "#!/usr/bin/env bash"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "set"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " -euo"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " pipefail"
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "# 1 · create a PTY with a unique marker in its scrollback (create never attaches)"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "id"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "$("
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "kaval-tui"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " create"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " --json"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " --"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " bash"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " -c"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " 'echo \"MARK-$$\"; exec sleep 1d'"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " jq"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " -r"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " .id"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ")"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "pid_before"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "$("
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "kaval-tui"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " list"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " --json"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " jq"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " -r"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \".[] | select(.id=="
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "\\\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "$id"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "\\\""
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: ").pid\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ")"
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "# 2 · (no kaval-tui process is attached — simulating client death)"
					})
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "# 3 · a fresh client re-attaches by id and asserts the state is intact"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "kaval-tui"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " snapshot"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "$id"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " grep"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " -q"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"MARK-\""
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "            # scrollback preserved"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "pid_after"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "$("
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "kaval-tui"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " list"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " --json"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " jq"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " -r"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \".[] | select(.id=="
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "\\\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "$id"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "\\\""
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: ").pid\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ")"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "[ "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "$pid_before"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "$pid_after"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ]                     "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "# same PTY, not a respawn"
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "echo"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"✓ client came and went; server held the PTY (pid "
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "$pid_after"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " unchanged)\""
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"This is the kaval-tui-scoped reattach test — the client can come and go while the server holds the PTY. (Surviving a ",
			createVNode(_components.em, { children: "server" }),
			" restart is a different assertion that belongs to the daemon plan, not here.)"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "later--how-this-dovetails-with-the-daemon-plan-out-of-scope",
			children: "Later — how this dovetails with the daemon plan (out of scope)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Stated only so we don’t trip over it: when the parent plan’s Phase R2 eventually moves the pty-host out of kolu-server into a surviving ",
			createVNode(_components.code, { children: "kolu --stdio" }),
			" daemon, ",
			createVNode(_components.code, { children: "kaval-tui" }),
			"’s socket target shifts from kolu-server to the daemon — ",
			createVNode(_components.strong, { children: "with no contract change" }),
			", because both serve the same ",
			createVNode(_components.code, { children: "ptyHostSurface" }),
			". At that point the CLI’s terminals gain server-restart survival for free, and the raw-vs-rich client split is unchanged. ",
			createVNode(_components.em, { children: "But that is a separate plan; nothing in kaval-tui’s phases above depends on it, and kaval-tui ships and is useful entirely on the in-process server." })
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "kaval-tui — a CLI terminal client for kolu-server",
	"description": "A terminal-side client of kolu-server's in-process pty-host — list / create / snapshot / send / attach / kill from the shell over a unix socket, no browser and no daemon. The CLI face of kolu and the seed of a tmux replacement, shipped in beta phases.",
	"parents": ["pty-daemon", "feature"],
	"status": "accepted",
	"maturity": "budding",
	"updated": "2026-07-03T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "architecture--everything-stays-in-process",
			"text": "Architecture — everything stays in-process"
		},
		{
			"depth": 3,
			"slug": "why-a-second-client-at-all",
			"text": "Why a second client at all"
		},
		{
			"depth": 2,
			"slug": "the-surface--850-loc-in-packageskaval-tui",
			"text": "The surface — ~850 LOC in packages/kaval-tui"
		},
		{
			"depth": 3,
			"slug": "decisions-recorded-here-to-be-echoed-in-code-comments",
			"text": "Decisions recorded here (to be echoed in code comments)"
		},
		{
			"depth": 2,
			"slug": "phasing--three-beta-increments-all-in-process",
			"text": "Phasing — three beta increments, all in-process"
		},
		{
			"depth": 3,
			"slug": "phase-0--a-minimal-ci-runner-tui-the-3rd-surface-example-shipped-",
			"text": "Phase 0 — a minimal CI-runner TUI (the 3rd surface example) shipped "
		},
		{
			"depth": 3,
			"slug": "phase-2--the-attach-loop-shipped-",
			"text": "Phase 2 — the attach loop shipped "
		},
		{
			"depth": 2,
			"slug": "the-user-flow",
			"text": "The user flow"
		},
		{
			"depth": 3,
			"slug": "interactive-session",
			"text": "Interactive session"
		},
		{
			"depth": 3,
			"slug": "headless-test--client-death-detachreattach-no-browser",
			"text": "Headless test — client-death detach/reattach, no browser"
		},
		{
			"depth": 2,
			"slug": "later--how-this-dovetails-with-the-daemon-plan-out-of-scope",
			"text": "Later — how this dovetails with the daemon plan (out of scope)"
		}
	];
}
var url = "src/content/atlas/pty-daemon-tui.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pty-daemon-tui.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pty-daemon-tui.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
