import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$D2 } from "./D2_CXsCOQdn.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import { t as $$Issue } from "./Issue_CB1XoZJT.mjs";
import { n as $$Roadmap, t as $$Milestone } from "./Milestone_B0slHbDx.mjs";
import { t as $$Terminal } from "./Terminal_Cqh2_20m.mjs";
//#region src/content/atlas/odu.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
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
	const { Fragment: Fragment$1 } = _components;
	if (!Fragment$1) _missingMdxReference("Fragment", true);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			createVNode(_components.em, { children: [
				"The plan — Phase 1 of which has shipped: grow ",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/blob/master/packages/surface/example/mini-ci/README.md",
					children: createVNode(_components.code, { children: "mini-ci" })
				}),
				" — a small CI runner that already works inside the kolu repo — into a standalone tool that takes over from ",
				createVNode(_components.a, {
					href: "https://github.com/juspay/justci",
					children: "juspay/justci"
				}),
				", the way ",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/blob/master/packages/surface/example/remote-process-monitor/README.md",
					children: "remote-process-monitor"
				}),
				" graduated into ",
				createVNode(_components.a, {
					href: "https://github.com/srid/drishti",
					children: "srid/drishti"
				}),
				". Every load-bearing claim was checked against both codebases."
			] }),
			" ",
			createVNode($$Pill, {
				variant: "new",
				children: "22-agent workflow · adversarial verification"
			})
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Status: ",
			createVNode($$Pill, {
				variant: "ok",
				children: "implemented"
			}),
			" · maturity ",
			createVNode($$Pill, {
				variant: "todo",
				children: "seedling"
			}),
			" · ",
			createVNode(_components.strong, { children: "Phase 1 shipped" }),
			" — ",
			createVNode($$PrLink, {
				pr: 1252,
				label: "odu replaced justci in this repo"
			}),
			", dogfooded by posting that very PR’s required checks · the ",
			createVNode(_components.strong, { children: "MCP agent face shipped" }),
			" (",
			createVNode($$PrLink, {
				pr: 3,
				repo: "juspay/odu",
				label: "juspay/odu#3"
			}),
			") and is consumed here; the rest of Phase 2 + graduation are the open roadmap · named ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "odu" }) }),
			" (Tamil ஓடு — “run”)"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The idea in one paragraph",
			children: createVNode(_components.p, { children: [
				"Every local CI tool you have used — ",
				createVNode(_components.code, { children: "make" }),
				", a ",
				createVNode(_components.code, { children: "just" }),
				" recipe over ssh, ",
				createVNode(_components.a, {
					href: "https://github.com/nektos/act",
					children: "act"
				}),
				", justci — shares one shape: ",
				createVNode(_components.strong, { children: "the run is a process." }),
				" It starts, prints, and exits; your window into it is whatever that process wrote to your terminal or to log files. mini-ci inverts the shape: ",
				createVNode(_components.strong, { children: "the runner is a small live server that owns your pipeline as state" }),
				", and everything else — a terminal dashboard, your coding agent, even a browser — is a ",
				createVNode(_components.em, { children: "client that attaches to it" }),
				" over plain ssh. Attach late and you get the complete current state instantly, including the full log of a node that finished an hour ago. Disconnect and nothing is lost. Rerun one failed node — not the whole pipeline — with a typed call. That single inversion is the innovation; everything else in this note is what it buys, what it costs, and the plan — ",
				createVNode(_components.strong, { children: "Phase 1 replaced justci in this very repo" }),
				" (",
				createVNode($$PrLink, { pr: 1252 }),
				")."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "what-it-is--attach-dont-scrape",
			children: "What it is — attach, don’t scrape"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"You give mini-ci a pipeline (a DAG of shell commands, JSON today) and a host — your laptop, a build box on your tailnet, anything reachable by ssh that has Nix. The runner materializes on that host and starts owning the pipeline. Here is what ",
			createVNode(_components.code, { children: "just run srid1" }),
			" paints today, live in your terminal:"
		] }),
		"\n",
		createVNode($$Terminal, {
			title: "mini-ci — just run srid1",
			lines: [
				"$ just run srid1",
				"» host: srid1 (system=x86_64-linux)",
				"» runner drv: /nix/store/p4z…-mini-ci-runner.drv",
				" ",
				"  mini-ci · remote-process-monitor          srid1  ● connected",
				" ",
				"   #  node       status        exit   time",
				"   1  surface    ✓ ok             0   2.1s",
				"   2  nix-host   ✓ ok             0   1.8s",
				"   3▸ monitor    ● running        ·   4.3s",
				" ",
				"  ── monitor ───────────────────────────────────────────",
				"  > tsc --noEmit   (142 files)",
				"  checked src/agent/main.ts  … ok",
				"  checked src/client/wire.ts … ok",
				"  ▍",
				" ",
				"  [1-3] attach    n/p cycle    r rerun    q quit"
			]
		}),
		"\n",
		createVNode(_components.p, { children: "What makes this different from watching any CI process print:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Late attach replays everything." }),
				" The protocol is ",
				createVNode(_components.em, { children: "snapshot-then-delta" }),
				": a client’s first frame is the complete current state — every node’s status, and the full buffered log of any node, even one that finished before you connected — then live updates follow. There are no log files to go find, and no “the run already exited.”"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Disconnect is free." }),
				" Close the laptop, lose wifi, kill the terminal — the runner keeps going. Reconnect re-attaches and the snapshot catches you up. (Honest scope: this is ",
				createVNode(_components.em, { children: "client" }),
				"-side resilience; if the runner process itself dies, its state dies with it — see the ledger below.)"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Rerun is surgical and live." }),
				" ",
				createVNode(_components.code, { children: "r" }),
				" resets one failed node plus its transitive dependents and reschedules them on the running DAG — no new pipeline invocation, no re-running what already passed."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The remote story is just ssh + Nix." }),
				" No runner daemon to register, no webhook infrastructure, no agent to install. The runner ships as a Nix closure (",
				createVNode(_components.code, { children: "nix copy" }),
				" of a prebuilt derivation), gets realised on the host, and runs over ",
				createVNode(_components.code, { children: "ssh host mini-ci-runner --stdio" }),
				". Your ssh key ",
				createVNode(_components.em, { children: "is" }),
				" the connection and the trust model. ",
				createVNode(_components.code, { children: "localhost" }),
				" skips the copy — same code path, no transport."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The wire is typed." }), " What crosses ssh is schema-validated state (Zod end to end), not text for you — or your agent — to parse."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "how-that-differs-from-justci",
			children: "How that differs from justci"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"justci is the strongest local-CI comparison because it is the tool this proposal would replace, and it is genuinely good at what it is: a ",
			createVNode(_components.strong, { children: "batch translator" }),
			". It compiles your ",
			createVNode(_components.code, { children: "just" }),
			" recipe DAG into a ",
			createVNode(_components.a, {
				href: "https://github.com/F1bonacc1/process-compose",
				children: "process-compose"
			}),
			" document (its own ",
			createVNode(_components.code, { children: "dump-yaml" }),
			" proves the translation is a pure function), runs it strictly — clean tree refused, HEAD pinned, GitHub commit-statuses posted per ",
			createVNode(_components.code, { children: "recipe@platform" }),
			" — and exits with a verdict. ssh, in that model, is a ",
			createVNode(_components.strong, { children: "dumb one-way pipe" }),
			": a ",
			createVNode(_components.code, { children: "git bundle" }),
			" goes out to set a remote node up, each recipe re-ssh’s to ",
			createVNode(_components.code, { children: "just --no-deps" }),
			", and only an ",
			createVNode(_components.strong, { children: "exit code" }),
			" comes back. Per-recipe output lands in ",
			createVNode(_components.code, { children: ".ci/<sha>/<plat>/<recipe>.log" }),
			" ",
			createVNode(_components.em, { children: "files" }),
			"; the progress feed carries the on-disk ",
			createVNode(_components.em, { children: "path" }),
			", never the bytes."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"So “watching a justci run” means a side channel: its ",
			createVNode(_components.code, { children: "status" }),
			" / ",
			createVNode(_components.code, { children: "monitor" }),
			" / ",
			createVNode(_components.code, { children: "logs" }),
			" subcommands shell out to a ",
			createVNode(_components.em, { children: "separate" }),
			" baked process-compose client dialed at ",
			createVNode(_components.code, { children: ".ci/pc.sock" }),
			" — and justci’s own guard exits before reaching the socket when no run is in progress. The introspection only exists ",
			createVNode(_components.em, { children: "while a batch lives" }),
			". That is not a justci bug; it is the batch shape. ",
			createVNode(_components.code, { children: "act" }),
			" replaying GitHub-Actions YAML in containers, or your own ",
			createVNode(_components.code, { children: "just" }),
			"/",
			createVNode(_components.code, { children: "make" }),
			" over ssh, have the same property: observation is welded to the one process invocation that’s printing."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			children: createVNode(_components.p, { children: [
				"mini-ci moves exactly one load-bearing axis: ",
				createVNode(_components.strong, { children: "ssh carries a typed, live, snapshot-then-delta surface instead of opaque bytes." }),
				" The pipeline state and every node’s log are ",
				createVNode(_components.em, { children: "in-band, on the same connection a client attaches to" }),
				" — observable whether or not anything is currently running, with no second binary and no socket file. Everything “more” in this note falls out of that one change."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "faces-over-one-surface",
			children: "Faces over one surface"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The runner exposes its entire capability as ",
			createVNode(_components.strong, { children: "three typed primitives" }),
			" (the next section names them), and because that surface ",
			createVNode(_components.em, { children: "is" }),
			" the whole interface, every client is a thin adapter over the same thing. A CI runner wants two of those adapters — one for the human driving it, one for the agent driving it. The same surface leaves a third — a browser dashboard — available for free; it has since grown from a latent capability into its own plan of record, ",
			createVNode(_components.a, {
				href: "./odu-web.html",
				children: "odu-web"
			}),
			"."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-human-face--the-tui-shipped",
			children: ["The human face — the TUI ", createVNode($$Pill, {
				variant: "ok",
				children: "shipped"
			})]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The live ",
			createVNode(_components.code, { children: "just run" }),
			" dashboard at the top of this note is this face: a (recipe × platform) matrix, a braille spinner, a log-tail footer, a coloured verdict, OSC-8 commit links. It is hand-rolled ANSI today — pure render functions over a repaint region — fine at 26 rows, but bespoke for every scroll pane, focus ring, and resize from here."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The plan to outgrow that is to ",
			createVNode(_components.strong, { children: ["rebuild it on ", createVNode(_components.a, {
				href: "https://opentui.com/",
				children: "OpenTUI"
			})] }),
			" ",
			createVNode($$Pill, {
				variant: "warn",
				children: "proposed"
			}),
			" — the MIT-licensed, Zig-cored terminal framework from Anomaly that powers opencode in production, with a first-class ",
			createVNode(_components.strong, { children: "SolidJS reconciler" }),
			" (",
			createVNode(_components.code, { children: "@opentui/solid" }),
			"). It swaps the bespoke ANSI layer for flexbox layout (Yoga), real components (ScrollBox, Code, Diff, Input), and tree-sitter highlighting for the log pane. The costs were ",
			createVNode(_components.strong, { children: "verified against 0.4.0" }),
			", not guessed: packaging is a non-issue — ",
			createVNode(_components.code, { children: "@opentui/core" }),
			" ships prebuilt natives for eight targets (all four kolu systems included) as esbuild-style ",
			createVNode(_components.code, { children: "optionalDependencies" }),
			", so consumers need no Zig and ",
			createVNode(_components.code, { children: "fetchPnpmDeps" }),
			" ingests them like it already ingests esbuild’s binary. The real gate is the runtime: the FFI layer is ",
			createVNode(_components.strong, { children: "bun-only today" }),
			" — under node 24, ",
			createVNode(_components.code, { children: "createCliRenderer" }),
			" throws ",
			createVNode(_components.code, { children: "OpenTUI native FFI is not available for this runtime yet" }),
			" (reproduced empirically; the native package ships ",
			createVNode(_components.code, { children: "libopentui.so" }),
			" for ",
			createVNode(_components.code, { children: "bun:ffi" }),
			", no napi addon), while the same probe renders fine under bun. Two smaller pins: ",
			createVNode(_components.code, { children: "@opentui/solid" }),
			" peer-depends on ",
			createVNode(_components.code, { children: "solid-js" }),
			" at exactly ",
			createVNode(_components.code, { children: "1.9.12" }),
			", and odu’s processes are all ",
			createVNode(_components.code, { children: "tsx" }),
			"-on-node today. So the plan is gated, not dated: prototype ",
			createVNode(_components.code, { children: "odu attach" }),
			" on it (read-only, smallest blast radius) ",
			createVNode(_components.strong, { children: "when upstream’s node support lands" }),
			" — the error message’s own “yet” — or earlier under bun for just the attach face. The pull beyond the widgets: ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			"’s reactive client hooks (",
			createVNode(_components.code, { children: "useCell" }),
			", ",
			createVNode(_components.code, { children: "useStream" }),
			") are Solid-only, so the hand-rolled TUI can’t touch them and drives the raw oRPC client instead; on ",
			createVNode(_components.code, { children: "@opentui/solid" }),
			" the terminal becomes a Solid tree over those hooks — and if the browser face below ever ships, both render the ",
			createVNode(_components.em, { children: "same" }),
			" hooks over the ",
			createVNode(_components.em, { children: "same" }),
			" surface, so “faces over one surface” becomes shared view code, not just a shared protocol."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-agent-face--mcp-shipped",
			children: ["The agent face — MCP ", createVNode($$Pill, {
				variant: "ok",
				children: "shipped"
			})]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Shipped in ",
			createVNode($$PrLink, {
				pr: 3,
				repo: "juspay/odu"
			}),
			" (through the full codex + lens + police gauntlet, odu-on-odu CI green) and consumed here — kolu pins odu and re-exposes it as ",
			createVNode(_components.code, { children: "nix run .#odu -- mcp" }),
			", with the ",
			createVNode(_components.code, { children: ".mcp.json" }),
			" entry deployed by apm. As of ",
			createVNode($$PrLink, { pr: 1271 }),
			" the MCP face is the ",
			createVNode(_components.em, { children: "only" }),
			" way kolu’s own CI is driven — the ",
			createVNode(_components.code, { children: "ci/pu/run.sh" }),
			" wrapper is gone, and the warm-pool lease became a standalone primitive (",
			createVNode(_components.code, { children: "ci/pu/lease.sh acquire/release/status" }),
			") an agent holds across tool calls. Because the runner already serves its surface over a byte pipe, an ",
			createVNode(_components.strong, { children: "MCP server is just another serve target" }),
			": ",
			createVNode(_components.code, { children: "odu mcp" }),
			" is ",
			createVNode(_components.em, { children: "in-band" }),
			" — like ",
			createVNode(_components.code, { children: "odu status" }),
			" / ",
			createVNode(_components.code, { children: "logs" }),
			" / ",
			createVNode(_components.code, { children: "attach" }),
			", it dials the ",
			createVNode(_components.code, { children: ".ci/odu.sock" }),
			" the coordinator already serves and re-exposes that surface as MCP tools (a thin adapter over the official MCP TypeScript SDK, no second protocol). This hand-built face is the validated — and deliberately partial — prior art for the ",
			createVNode(_components.em, { children: "generic" }),
			" ",
			createVNode(_components.a, {
				href: "./surface-mcp.html",
				children: "@kolu/surface-mcp"
			}),
			" package (",
			createVNode($$Issue, { n: 982 }),
			"), which would extract the surface→MCP ",
			createVNode(_components.strong, { children: "lifecycle spine" }),
			" (the subscribe/teardown dance, the zod→JSON-Schema bridge) for any surface, leaving each consumer its own tool-selection and guards. It ",
			createVNode(_components.strong, { children: "predetermines no host" }),
			": ",
			createVNode(_components.em, { children: "which" }),
			" boxes run the lanes is the coordinator’s job — a linux box leased from the warm ",
			createVNode(_components.code, { children: "kolu-ci-*" }),
			" pool, a macos host from ",
			createVNode(_components.code, { children: "hosts.json" }),
			" — exactly as for the CLI, so the ",
			createVNode(_components.code, { children: ".mcp.json" }),
			" below is identical on every machine. Claude Code, Codex, opencode, or Gemini CLI then drive your CI with structured calls instead of scraping terminal output. Declare it over stdio — the transport everything else already rides:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"jsonc\"><code><span class=\"line\"><span style=\"color:#6A737D\">// .mcp.json — Claude Code; Codex, opencode &#x26; Gemini CLI take the same shape (kolu's committed entry wraps this via the odu-mcp skill's bin/serve)</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">{ </span><span style=\"color:#005CC5\">\"mcpServers\"</span><span style=\"color:#24292E\">: { </span><span style=\"color:#005CC5\">\"odu\"</span><span style=\"color:#24292E\">: {</span></span>\n<span class=\"line\"><span style=\"color:#005CC5\">  \"type\"</span><span style=\"color:#24292E\">: </span><span style=\"color:#032F62\">\"stdio\"</span><span style=\"color:#24292E\">, </span><span style=\"color:#005CC5\">\"command\"</span><span style=\"color:#24292E\">: </span><span style=\"color:#032F62\">\"nix\"</span><span style=\"color:#24292E\">,</span></span>\n<span class=\"line\"><span style=\"color:#005CC5\">  \"args\"</span><span style=\"color:#24292E\">: [</span><span style=\"color:#032F62\">\"run\"</span><span style=\"color:#24292E\">, </span><span style=\"color:#032F62\">\"github:juspay/odu\"</span><span style=\"color:#24292E\">, </span><span style=\"color:#032F62\">\"--\"</span><span style=\"color:#24292E\">, </span><span style=\"color:#032F62\">\"mcp\"</span><span style=\"color:#24292E\">] } } }</span></span></code></pre>" }),
		"\n",
		createVNode($$Terminal, {
			title: "claude — CI over the odu MCP server",
			lines: [
				`$ claude    # odu declared in .mcp.json — stdio, in-band`,
				`# /mcp → odu · 5 tools: run get_nodes tail_log rerun_node wait_for_settle`,
				` `,
				`user: kolu CI went red on linux — find the broken node, show why, rerun it.`,
				` `,
				`→ get_nodes()                     # surface.nodes.get({})`,
				`    surface   ✓ ok       exit 0  2.1s`,
				`    nix-host  ✓ ok       exit 0  1.8s`,
				`    monitor   ✗ failed   exit 1  4.3s`,
				`→ tail_log({ id: "monitor" })     # surface.nodeLog.get({ id })`,
				`    > tsc --noEmit (142 files)`,
				`    src/client/wire.ts:88 — TS2345: 'string' not assignable to 'NodeId'`,
				` `,
				`assistant: monitor failed on a tsc error at wire.ts:88. Fixed the cast.`,
				` `,
				`→ rerun_node({ id: "monitor" })   # surface.node.rerun({ id }) — only mutation`,
				`    { ok: true }                  # resets monitor + dependents, reschedules`,
				`→ wait_for_settle({ timeoutMs: 120000 })   # blocks on the live Cell`,
				`    { passed: true, failed: [], durationMs: 4100 }`,
				` `,
				`assistant: Green ✓ — monitor passed in 4.1s. The wire.ts fix cleared it.`
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The tools are the surface, one-to-one" }),
			" — five MCP tools: three straight projections of the three primitives, one blocking wait, plus ",
			createVNode(_components.code, { children: "run" }),
			" — the entry point that spawns the pipeline coordinator:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "MCP tool" }),
					"\n",
					createVNode(_components.th, { children: "Surface call" }),
					"\n",
					createVNode(_components.th, { children: "What it returns" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "run()" }) }),
					"\n",
					createVNode(_components.td, { children: "spawns the pipeline coordinator" }),
					"\n",
					createVNode(_components.td, { children: [
						"Starts a pipeline run — since ",
						createVNode($$PrLink, { pr: 1271 }),
						", the canonical way to start a kolu CI run."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "get_nodes()" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "surface.nodes.get({})" }), " — Cell"] }),
					"\n",
					createVNode(_components.td, { children: "Every node’s status / exit / duration in one structured snapshot." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "tail_log({ id })" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "surface.nodeLog.get({ id })" }), " — Stream"] }),
					"\n",
					createVNode(_components.td, { children: "One node’s buffered output so far — even a node that finished before the agent attached." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "rerun_node({ id })" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "surface.node.rerun({ id })" }), " — Procedure"] }),
					"\n",
					createVNode(_components.td, { children: "The only mutation: reset a node + its transitive dependents and reschedule on the live DAG." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "wait_for_settle({ timeoutMs })" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"blocks on the live ",
						createVNode(_components.code, { children: "nodes" }),
						" Cell"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Returns the instant a node fails (fail-fast) or the run settles — ",
						createVNode(_components.code, { children: "{ passed, failed[], durationMs }" }),
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
			createVNode(_components.strong, { children: "Liveness rides MCP’s own mechanisms — and the agent never scrapes." }),
			" MCP is not only request/response: a client can ",
			createVNode(_components.code, { children: "resources/subscribe" }),
			" and the server pushes ",
			createVNode(_components.code, { children: "notifications/resources/updated" }),
			" on change — which maps odu’s ",
			createVNode(_components.code, { children: "nodes" }),
			" Cell ",
			createVNode(_components.em, { children: "one-to-one" }),
			", the snapshot-then-delta becoming a subscribable resource and each delta an ",
			createVNode(_components.code, { children: "updated" }),
			" (the ",
			createVNode(_components.code, { children: "nodeLog" }),
			" Stream maps the same way). So a notification-aware host gets live pushes for free. The honest floor, though, is that a notification only helps if the ",
			createVNode(_components.em, { children: "host wakes the model" }),
			" on it — and many MCP hosts run a pure turn loop, refreshing the cached resource for the ",
			createVNode(_components.em, { children: "next" }),
			" read rather than interrupting the model mid-task. So the bridge also exposes the same liveness as a ",
			createVNode(_components.strong, { children: "blocking pull" }),
			": ",
			createVNode(_components.code, { children: "wait_for_settle" }),
			" holds a tool call open against the live Cell and returns the instant a node fails (fail-fast) or the run settles — which works on ",
			createVNode(_components.em, { children: "every" }),
			" host, because the model is already ",
			createVNode(_components.em, { children: "inside" }),
			" a tool call when the answer lands. Same Cell, two projections — a push resource and a blocking tool — and ",
			createVNode(_components.strong, { children: "neither needs the raw byte stream" }),
			" process-compose’s MCP couldn’t give (#22’s “request/response only, no streaming”). The loop is then just the tools: ",
			createVNode(_components.code, { children: "wait_for_settle" }),
			" wakes on the first red → ",
			createVNode(_components.code, { children: "get_nodes" }),
			" names it → read that node’s ",
			createVNode(_components.code, { children: "tail_log" }),
			" → fix → ",
			createVNode(_components.code, { children: "rerun_node" }),
			" → ",
			createVNode(_components.code, { children: "wait_for_settle" }),
			" → confirm green (the transcript above)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"This is the one place justci ",
				createVNode(_components.em, { children: "told us itself" }),
				" the batch shape is the obstacle."
			] }),
			" ",
			createVNode($$Issue, {
				n: 22,
				repo: "juspay/justci",
				label: "MCP server for ci, done properly"
			}),
			" is justci’s own design note for an agent-controlled MCP mode. It ",
			createVNode(_components.strong, { children: "built one and reverted it" }),
			" (",
			createVNode($$PrLink, {
				pr: 18,
				repo: "juspay/justci",
				label: "reverted in the same PR"
			}),
			") because, in a batch translator, ",
			createVNode(_components.em, { children: "launching the MCP server auto-ran every recipe" }),
			" — process-compose has no serve-only / ",
			createVNode(_components.code, { children: "--no-start" }),
			" mode. A runner that owns the DAG as ",
			createVNode(_components.em, { children: "idle state" }),
			" has that separation by construction, and the snapshot-then-delta log is precisely the live event source #22 couldn’t get."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "No new authz boundary — which is exactly why MCP, not the browser, is next." }),
			" An earlier draft of this note parked the agent face behind an authn/authz split. That conflated ",
			createVNode(_components.em, { children: "agent" }),
			" access with ",
			createVNode(_components.em, { children: "multi-client" }),
			" access. ",
			createVNode(_components.code, { children: "odu mcp" }),
			" runs as the same operator, on the same machine, dialing the same ",
			createVNode(_components.code, { children: ".ci/odu.sock" }),
			" the CLI’s ",
			createVNode(_components.code, { children: "status" }),
			" / ",
			createVNode(_components.code, { children: "logs" }),
			" / ",
			createVNode(_components.code, { children: "attach" }),
			" already use; ",
			createVNode(_components.code, { children: "rerun_node" }),
			" is remote code execution, but it is RCE the operator already holds through the CLI — the agent acts ",
			createVNode(_components.em, { children: "as" }),
			" the operator, under the same ssh trust. So the single-operator MCP face needs no new trust model and lands in Phase 2 directly. A read-observer-vs-mutator authz boundary becomes load-bearing only when a ",
			createVNode(_components.em, { children: "second, untrusted" }),
			" client appears — the browser face below — which is why that face, not this one, carries the prerequisite."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-browser-face--not-an-attach-face-at-all-proposed--odu-web",
			children: ["The browser face — not an attach face at all ", createVNode($$Pill, {
				variant: "warn",
				children: ["proposed — ", createVNode(_components.a, {
					href: "./odu-web.html",
					children: "odu-web"
				})]
			})]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The same surface would drive a browser PWA without a new line of protocol — the ",
			createVNode(_components.code, { children: "useCell" }),
			" / ",
			createVNode(_components.code, { children: "useStream" }),
			" hooks are Solid, and kolu already ships ",
			createVNode(_components.a, {
				href: "./surface-app.html",
				children: "surface-app"
			}),
			" for exactly this. And this note’s original verdict still holds for the obvious reading: odu is a CLI CI runner, nobody opens a browser tab to watch a run they kicked off from their shell, and a hosted dashboard is the one client that ",
			createVNode(_components.em, { children: "does" }),
			" drag in the authz boundary the CLI and MCP faces dodge."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"What changed is the diagnosis, not the verdict. The browser face worth building is not a tab on one live run — it is the ",
			createVNode(_components.strong, { children: "service layer above the runner" }),
			": the run ledger that survives coordinators, the page a GitHub commit status’s ",
			createVNode(_components.em, { children: "Details" }),
			" link points at, forge triggers, and a multi-repo fleet view. That product — its UI prototypes, its phases, and whether it replaces ",
			createVNode(_components.a, {
				href: "https://github.com/juspay/vira",
				children: "juspay/vira"
			}),
			" — has its own plan of record: ",
			createVNode(_components.strong, { children: createVNode(_components.a, {
				href: "./odu-web.html",
				children: "odu-web"
			}) }),
			". If it ships, it is also the face that forces the read-observer/mutator split, and the face that turns OpenTUI’s “shared view code” from a bonus into the point."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-architecture--three-primitives-over-ssh",
			children: "The architecture — three primitives over ssh"
		}),
		"\n",
		createVNode($$D2, {
			caption: "The architecture as a single vertical spine. The gate half — strict runs, commit-statuses, branch protection — shipped in Phase 1 (PR #1252); the next client is the MCP agent face. Clients attach to a typed surface over ssh stdio; the runner is long-lived, owns the DAG, and runs one-per-platform (fanned in).",
			code: `
direction: down

clients: "clients — attach / detach / reconnect" {
tui: "TUI · shipped"
mcp: "MCP · shipped — agent CLIs"
pwa: "Web · odu-web — planned"
}

wire: "@kolu/surface — typed wire" {
prims: "Cell · Stream · Procedure"
link: "stdioLink · retry ∞"
}

host: "@kolu/surface-nix-host" {
sess: "HostSession"
ship: "nix copy .drv → ssh --stdio"
}

runner: "runner — long-lived, owns the DAG" {
serve: "nodes · nodeLog · rerun"
}

front: "gate half — shipped in Phase 1" {
t: "strict run on pinned SHA"
g: "commit-status · protect · per-SHA logs"
}

clients -> wire: "typed, live — TUI · MCP · Web"
wire -> host: "over ssh stdio"
host -> runner: "one per platform — fan-in"
runner -> front: "Phase 1 — shipped (PR #1252)"
`
		}),
		"\n",
		createVNode(_components.p, { children: [
			"What’s architecturally interesting is how little there is. The entire protocol is three primitives, declared once with ",
			createVNode(_components.a, {
				href: "https://kolu.dev/blog/surface-framework/",
				children: createVNode(_components.code, { children: "@kolu/surface" })
			}),
			" (kolu’s typed-reactive-state framework — declare a surface, and the contract, server wiring, and client hooks are all derived from the one declaration):"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Primitive" }),
					"\n",
					createVNode(_components.th, { children: "Call" }),
					"\n",
					createVNode(_components.th, { children: "What it carries" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Cell" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "surface.nodes.get({})" }) }),
					"\n",
					createVNode(_components.td, { children: "The whole pipeline’s state — one snapshot, then deltas as nodes change." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Stream" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "surface.nodeLog.get({ id })" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"One node’s output — a buffered snapshot frame first (so late subscribers replay from the top), then appends. A bounded tail (",
						createVNode(_components.code, { children: "MAX_LOG_CHARS" }),
						") caps memory on both ends."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Procedure" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "surface.node.rerun({ id })" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"The ",
						createVNode(_components.em, { children: "only" }),
						" mutation: reset a node + its transitive dependents and reschedule."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "Three properties of the design do most of the work:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "ssh is the only transport." }),
				" The surface multiplexes over stdio — ",
				createVNode(_components.code, { children: "ssh host mini-ci-runner --stdio" }),
				" — so there are no ports to open, no TLS to provision, no auth system besides your ssh key. The same discipline MCP servers use (nothing non-protocol on stdout) is already enforced by the serve layer."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Deployment is a Nix closure copy." }),
				" The client probes the host’s architecture, ",
				createVNode(_components.code, { children: "nix copy" }),
				"s the matching prebuilt runner derivation, realises it into the host’s store, and runs it. The host needs ssh + Nix and ",
				createVNode(_components.em, { children: "nothing else" }),
				" — and the runner version is pinned by construction. (The trade-off is real: the closure is read-only, which is why today’s default pipeline is typecheck-only — see the ledger.)"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Snapshot-then-delta makes reconnect free." }),
				" Every (re)subscription’s first frame is a fresh snapshot, and the client retries transport errors indefinitely — so a dropped ssh connection self-heals with no replay log and no session state to lose. The connection lifecycle (",
				createVNode(_components.code, { children: "copying → connecting → connected" }),
				") is itself a cell the UI renders."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"None of this is speculative: the protocol runs through the ",
			createVNode(_components.em, { children: "real" }),
			" stdio codec in ",
			createVNode(_components.code, { children: "mini-ci.test.ts" }),
			" (loopback pair → serve → link, byte-identical to the ssh path, real child processes). The tests bank: snapshot-then-delta with correct late-subscriber catch-up; race-free topological execution across every captured frame; full log replay for late subscribers to finished nodes; rerun re-running exactly the dependent closure; and a failed dependency skipping its dependents (no false greens). Plus the live end-to-end: ",
			createVNode(_components.code, { children: "just run localhost --json" }),
			" typechecks a real three-package dependency closure over a real session."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-honest-ledger--where-it-beats-justci-where-it-doesnt-yet",
			children: "The honest ledger — where it beats justci, where it doesn’t yet"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A CI tool has two halves. The ",
			createVNode(_components.strong, { children: "watch-and-drive half" }),
			" — see state, read logs, rerun, reconnect — is where the live-service shape wins outright. The ",
			createVNode(_components.strong, { children: "gate half" }),
			" — a strict run against a pinned commit whose verdict lands on the forge as commit-statuses that branch protection enforces — is what justci actually does for this repo, and mini-ci has none of it yet. One precision the dogfood decision forces: ",
			createVNode(_components.strong, { children: [createVNode(_components.em, { children: "neither" }), " tool ingests forge events"] }),
			" — a justci run starts when you, or an agent, invokes it. The trigger was never the debt; the gate is. And with the plan accepted, the second table below stops being a wishlist: ",
			createVNode(_components.strong, { children: "it is Phase 1’s work order" }),
			", scoped by exactly what justci does for kolu today."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "what-only-a-live-service-can-do",
			children: "What only a live service can do"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Live-service affordance" }),
					"\n",
					createVNode(_components.th, { children: "The justci limit it answers" }),
					"\n",
					createVNode(_components.th, { children: "Status" }),
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
						"In-band introspection (",
						createVNode(_components.code, { children: "nodes" }),
						" Cell + ",
						createVNode(_components.code, { children: "nodeLog" }),
						" Stream) on the attach connection"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"A ",
						createVNode(_components.em, { children: "separate" }),
						" baked ",
						createVNode(_components.code, { children: "pc" }),
						" client on ",
						createVNode(_components.code, { children: ".ci/pc.sock" }),
						" that exits when no run is live"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "run",
						children: "beyond"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Per-node log replay as a live stream for late subscribers" }),
					"\n",
					createVNode(_components.td, { children: [
						"Stdout scraped to ",
						createVNode(_components.code, { children: ".ci/<sha>/<plat>/<recipe>.log" }),
						" files; the feed carries only the path"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "run",
						children: "beyond"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Typed ",
						createVNode(_components.code, { children: "rerun" }),
						" of a node + dependents on the ",
						createVNode(_components.strong, { children: "live" }),
						" DAG (no new process)"
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "justci run RECIPE@PLATFORM" }), " spins up a brand-new batch"] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "run",
						children: "beyond"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Self-healing reconnect — fresh snapshot on every resubscribe, infinite retry, session respawn" }),
					"\n",
					createVNode(_components.td, { children: "No reattach to an in-flight run (side-socket introspection only)" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "run",
						children: "beyond"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Idle attach + selective start — clients connect ",
						createVNode(_components.em, { children: "before" }),
						" anything runs"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Issue, {
							n: 22,
							repo: "juspay/justci",
							label: "MCP server for ci"
						}),
						" — no serve-only mode in process-compose; justci tried and reverted (",
						createVNode($$PrLink, {
							pr: 18,
							repo: "juspay/justci"
						}),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "run",
						children: "beyond"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Faces over one surface" }),
						" — TUI (shipped) · MCP (shipped) · Web (planned — ",
						createVNode(_components.a, {
							href: "./odu-web.html",
							children: "odu-web"
						}),
						"), each a thin adapter, only the link differs"
					] }),
					"\n",
					createVNode(_components.td, { children: "No live dashboard and no agent-drivable API" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "run",
						children: "beyond"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Fan-",
						createVNode(_components.strong, { children: "in" }),
						": N platform runners into one typed dashboard"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Fan-",
						createVNode(_components.strong, { children: "out" }),
						": one ssh + log + status context per (recipe × platform), plus a ",
						createVNode($$Issue, {
							n: 47,
							repo: "juspay/justci",
							label: "sharding"
						}),
						" aggregator hack"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "todo",
						children: "open"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Typed ",
						createVNode(_components.code, { children: "cancel" }),
						" / ",
						createVNode(_components.code, { children: "cron" }),
						" / mid-run reload"
					] }),
					"\n",
					createVNode(_components.td, { children: "Sealed at preflight, pinned to a worktree SHA — foreclosed under the translator" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "todo",
						children: "open"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Concurrent-client mutation semantics (who may rerun, when)" }),
					"\n",
					createVNode(_components.td, { children: [
						"A non-question under one-run-one-driver — a ",
						createVNode(_components.strong, { children: "new problem" }),
						" the live shape creates and must own"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "todo",
						children: "open"
					}) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "phase-1s-work-order--replacing-justci-in-this-repo",
			children: "Phase 1’s work order — replacing justci in this repo"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The scope is set by what justci actually does for kolu today: the ",
			createVNode(_components.code, { children: "[metadata(\"ci\")]" }),
			" DAG in ",
			createVNode(_components.code, { children: "ci/mod.just" }),
			", the ",
			createVNode(_components.code, { children: "/ci" }),
			" skill’s CLI surface, ",
			createVNode(_components.code, { children: ".agency/do.md" }),
			"’s pool runbook, and the ",
			createVNode(_components.code, { children: "ci/pu" }),
			" warm-box lease. The work lands as a ",
			createVNode(_components.strong, { children: ["fresh package, ", createVNode(_components.code, { children: "packages/odu" })] }),
			" — the mini-ci example stays untouched as the reference substrate. Every row is ",
			createVNode($$Pill, {
				variant: "warn",
				children: "harder"
			}),
			" — net-new design + code on a proven substrate. “The framework ",
			createVNode(_components.em, { children: "can" }),
			"” is not “mini-ci ",
			createVNode(_components.em, { children: "does" }),
			".”"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "justci does this for kolu today" }),
					"\n",
					createVNode(_components.th, { children: "What mini-ci builds to take it over" }),
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
						createVNode(_components.strong, { children: "Real builds" }),
						" — kolu’s ",
						createVNode(_components.code, { children: "nix" }),
						", ",
						createVNode(_components.code, { children: "e2e" }),
						", ",
						createVNode(_components.code, { children: "smoke" }),
						" recipes are write-heavy; justci ships ",
						createVNode(_components.em, { children: "source" }),
						" (a git bundle) into a writable checkout"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "As built:" }),
						" a writable per-SHA ",
						createVNode(_components.code, { children: "git worktree" }),
						" on the host, fetched from the origin remote (odu fetches ",
						createVNode(_components.em, { children: "pushed" }),
						" SHAs over anonymous https — no git-bundle transport; ",
						createVNode(_components.code, { children: "/do" }),
						" pushes before CI anyway), with a per-slug object cache and per-run unique paths. The surface contract didn’t change: builds are just more nodes."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Runs the ",
						createVNode(_components.strong, { children: [createVNode(_components.code, { children: "just" }), " DAG"] }),
						" — the ",
						createVNode(_components.code, { children: "[metadata(\"ci\")]" }),
						" root’s reachable subgraph"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"A ",
						createVNode(_components.code, { children: "just → PipelineSpec" }),
						" translator (today the pipeline is hand-written JSON), plus offline inspection as built: ",
						createVNode(_components.code, { children: "dump" }),
						" (the resolved pipeline as JSON — there is no process-compose YAML to dump) and ",
						createVNode(_components.code, { children: "graph" }),
						" (Mermaid)."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Strict by default" }),
						" — dirty-tree refusal, HEAD pinned via ",
						createVNode(_components.code, { children: "git worktree" }),
						", logs at ",
						createVNode(_components.code, { children: ".ci/<sha>/<plat>/<recipe>.log" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"The same hygiene ",
						createVNode(_components.em, { children: "and the same on-disk per-SHA log layout" }),
						" — so a runner death never loses the verdict trail, matching justci’s durability where it matters."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Gates PRs" }),
						" — commit-status per ",
						createVNode(_components.code, { children: "recipe@platform" }),
						" + ",
						createVNode(_components.code, { children: "protect" }),
						" (branch-protection PATCH)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "As built:" }),
						" status posting on terminal transitions diffed off the fan-in ",
						createVNode(_components.code, { children: "nodes" }),
						" Cell, byte-compatible with justci’s contexts/descriptions (verified against live API data) plus one new state — infrastructure death posts ",
						createVNode(_components.code, { children: "error" }),
						"/",
						createVNode(_components.code, { children: "Errored" }),
						", so a dropped lane fails loudly instead of wedging. ",
						createVNode(_components.code, { children: "odu protect" }),
						" exists; the planned required-checks ",
						createVNode(_components.em, { children: "flip" }),
						" proved vacuous: the contexts are byte-identical, and PR #1252’s own checks satisfied the existing protection list."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Multi-platform lanes" }),
						" — ",
						createVNode(_components.code, { children: "hosts.json" }),
						" (a macos host; linux leased from the ",
						createVNode(_components.code, { children: "kolu-ci-*" }),
						" warm pool via ",
						createVNode(_components.code, { children: "flock" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Fan the DAG out per platform over one ",
						createVNode(_components.code, { children: "HostSession" }),
						" each, reusing the warm-pool lease (then ",
						createVNode(_components.code, { children: "ci/pu/run.sh" }),
						", since split into the standalone ",
						createVNode(_components.code, { children: "ci/pu/lease.sh" }),
						" by ",
						createVNode($$PrLink, { pr: 1271 }),
						")."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: [
							"The CLI the ",
							createVNode(_components.code, { children: "/ci" }),
							" skill documents"
						] }),
						" — ",
						createVNode(_components.code, { children: "run" }),
						" (+ ",
						createVNode(_components.code, { children: "recipe@platform" }),
						" selectors, ",
						createVNode(_components.code, { children: "--no-strict" }),
						" / ",
						createVNode(_components.code, { children: "--no-post" }),
						" / ",
						createVNode(_components.code, { children: "--platform" }),
						" / ",
						createVNode(_components.code, { children: "--host" }),
						"), ",
						createVNode(_components.code, { children: "status" }),
						" / ",
						createVNode(_components.code, { children: "logs" }),
						" / ",
						createVNode(_components.code, { children: "attach" }),
						", the verdict summary"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "As built:" }),
						" ",
						createVNode(_components.code, { children: "status" }),
						"/",
						createVNode(_components.code, { children: "logs" }),
						"/",
						createVNode(_components.code, { children: "attach" }),
						" are ",
						createVNode(_components.em, { children: "in-band" }),
						" — they dial ",
						createVNode(_components.code, { children: ".ci/odu.sock" }),
						", where the coordinator serves the ",
						createVNode(_components.strong, { children: "same typed surface" }),
						" every other face speaks (the contrast with ",
						createVNode(_components.code, { children: ".ci/pc.sock" }),
						" was never the socket file; it was justci’s ",
						createVNode(_components.em, { children: "separately-versioned, separately-shaped" }),
						" baked client). Idle attach — a runner you can reach with no run live — moved to Phase 2 with the long-lived-runner question. justci’s ",
						createVNode(_components.code, { children: "--tui" }),
						" is absorbed by ",
						createVNode(_components.code, { children: "odu attach" }),
						" (renamed from ",
						createVNode(_components.code, { children: "monitor" }),
						" in ",
						createVNode($$PrLink, {
							pr: 7,
							repo: "juspay/odu",
							label: "juspay/odu#7"
						}),
						"); the run output itself dropped justci-UX mimicry for a colour lane-matrix with a log-tail footer, heartbeats when piped, and OSC-8 commit links — and ",
						createVNode(_components.code, { children: "attach" }),
						" now renders that ",
						createVNode(_components.strong, { children: "same matrix" }),
						" (one shared renderer, ",
						createVNode($$PrLink, {
							pr: 9,
							repo: "juspay/odu",
							label: "juspay/odu#9"
						}),
						"), not a separate table. The ",
						createVNode(_components.code, { children: "/ci" }),
						" skill and ",
						createVNode(_components.code, { children: ".agency/do.md" }),
						" were rewritten against it."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Exit criterion:" }),
			" kolu’s branch protection is satisfied by contexts this tool posted; ",
			createVNode(_components.code, { children: "nix run github:juspay/justci" }),
			" appears nowhere in the repo; the ",
			createVNode(_components.code, { children: "/ci" }),
			" skill and ",
			createVNode(_components.code, { children: ".agency/do.md" }),
			" describe the new tool."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Deferred past the dogfood" }),
			" — none of these block replacing justci here, because justci doesn’t have them either (and the single-operator ssh trust model covers Phase 1 exactly as it covers justci): authn/authz + a read-observer vs. mutator split (required ",
			createVNode(_components.em, { children: "before" }),
			" a multi-client browser face — ",
			createVNode(_components.code, { children: "rerun" }),
			" is remote code execution; the single-operator MCP face needs no new boundary, acting as the operator under the same ssh trust); runner-restart survival of ",
			createVNode(_components.em, { children: "live" }),
			" state (per-SHA logs already survive); notifications and forge-event ingestion (beyond both tools); caching / artifact passing; the per-recipe ",
			createVNode(_components.code, { children: "[linux]" }),
			"/",
			createVNode(_components.code, { children: "[macos]" }),
			" filter (justci’s own open roadmap item); a run-history model richer than per-SHA logs."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "So is it a replacement?",
			children: createVNode(_components.p, { children: [
				"On the watch-and-drive half — ",
				createVNode(_components.strong, { children: "yes, outright, and it does more there than justci can" }),
				". On the gate half it is now a ",
				createVNode(_components.em, { children: "work order with an exit criterion" }),
				", and dogfooding it on kolu is the test: if the live shape can’t gate these PRs as reliably as justci’s strict batch does, that surfaces in weeks, on this repo — a finding, not a footnote. The humility that remains: the novelty claim is against ",
				createVNode(_components.em, { children: "local" }),
				" CI tools like justci, not against hosted CI (GitHub Actions, Buildkite, Dagger stream logs too) — the durable edge is the substrate: a typed, reconnecting, composable surface over ",
				createVNode(_components.strong, { children: "your own ssh" }),
				", with no hosted runner and nothing to install on the remote but Nix."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "shipping-it--graduation-name-roadmap",
			children: "Shipping it — graduation, name, roadmap"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The delivery path is proven, not hypothetical. remote-process-monitor — another example app in the kolu repo — graduated into the standalone ",
			createVNode(_components.a, {
				href: "https://github.com/srid/drishti",
				children: "srid/drishti"
			}),
			" by consuming the same packages this runner is built on (",
			createVNode(_components.code, { children: "@kolu/surface" }),
			", ",
			createVNode(_components.code, { children: "surface-nix-host" }),
			", and later ",
			createVNode(_components.code, { children: "surface-app" }),
			" via ",
			createVNode($$PrLink, {
				pr: 47,
				repo: "srid/drishti",
				label: "freshness by composition"
			}),
			"), pinned via ",
			createVNode(_components.code, { children: "npins" }),
			" and hydrated by ",
			createVNode(_components.code, { children: "cp -rL" }),
			". mini-ci’s own README already names the path: ",
			createVNode(_components.em, { children: "“mini-ci could graduate to its own repo the way remote-process-monitor became drishti.”" }),
			" The license is determined by composition — ",
			createVNode(_components.code, { children: "surface-app" }),
			" (needed for the PWA) is AGPL-3.0-or-later, which is already mini-ci’s license — and the ",
			createVNode(_components.a, {
				href: "./electricity.html",
				children: "electricity"
			}),
			" bar (domain-agnostic / hides hard volatility / has a second consumer) is already cleared by the underlying packages, with drishti as the proof. What graduates is the ",
			createVNode(_components.em, { children: "product" }),
			", riding infrastructure that already graduated; reusable concerns grown in the new repo (strict hygiene, the trigger model, run identity) flow back to harden the libraries."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: ["Named: ", createVNode(_components.code, { children: "odu" })] }),
			" ",
			createVNode($$Pill, {
				variant: "ok",
				children: "decided"
			}),
			" — Tamil ஓடு, the verb ",
			createVNode(_components.strong, { children: "“run”" }),
			": three letters, vowel-ending, an imperative you can type. It joins kolu (கொலு) and drishti (दृष्टि) in the one-word product line, and it is the package name from day one — ",
			createVNode(_components.strong, { children: ["Phase 1 lands in ", createVNode(_components.code, { children: "packages/odu" })] }),
			", and the standalone repo inherits the name at graduation."
		] }),
		"\n",
		createVNode($$Roadmap, { children: [
			createVNode($$Milestone, {
				status: "done",
				label: "Phase 0 · the proven substrate",
				children: [
					"Shipped: a long-lived runner owns the DAG and serves ",
					createVNode(_components.code, { children: "nodes" }),
					" + ",
					createVNode(_components.code, { children: "nodeLog" }),
					" + ",
					createVNode(_components.code, { children: "rerun" }),
					" over the real stdio transport; tests bank snapshot-then-delta, race-free topo order, late-subscriber log replay, rerun-the-closure, and no-false-greens; live e2e over a real ssh session. TUI-only, single host, read-only closure ⇒ typecheck-only."
				]
			}),
			createVNode($$Milestone, {
				status: "done",
				label: "Phase 1 · replace justci in this repo",
				children: [
					"Shipped: ",
					createVNode($$PrLink, {
						pr: 1252,
						label: "the Phase-1 PR"
					}),
					" — ",
					createVNode(_components.code, { children: "packages/odu" }),
					" built fresh per the work order (writable per-SHA workspaces, ",
					createVNode(_components.code, { children: "just" }),
					"-DAG ingestion + ",
					createVNode(_components.code, { children: "dump" }),
					"/",
					createVNode(_components.code, { children: "graph" }),
					", strict hygiene with justci’s per-SHA log layout, byte-compatible commit statuses + ",
					createVNode(_components.code, { children: "protect" }),
					", multi-platform lanes over the warm-pool lease untouched, in-band ",
					createVNode(_components.code, { children: "status" }),
					"/",
					createVNode(_components.code, { children: "logs" }),
					"/",
					createVNode(_components.code, { children: "attach" }),
					" on ",
					createVNode(_components.code, { children: ".ci/odu.sock" }),
					"), the ",
					createVNode(_components.code, { children: "/ci" }),
					" skill + ",
					createVNode(_components.code, { children: ".agency/do.md" }),
					" rewritten, the lease wrapper repointed, and the exit criterion met the strong way: ",
					createVNode(_components.strong, { children: "the PR’s own required checks were posted by odu" }),
					", with ",
					createVNode(_components.code, { children: "nix run github:juspay/justci" }),
					" gone from every live path (the justci-era ralph reports carry historical notes). Dogfooding fixed what only production could: real pipes for recipes that reopen ",
					createVNode(_components.code, { children: "/dev/stderr" }),
					", host-provided nix (a pinned client corrupts CA handling against a newer daemon), one-shot lane semantics with ",
					createVNode(_components.code, { children: "errored" }),
					" posts."
				]
			}),
			createVNode($$Milestone, {
				status: "now",
				label: "Phase 2 · the agent face",
				children: [
					createVNode(_components.strong, { children: "Shipped:" }),
					" the ",
					createVNode(_components.strong, { children: "MCP server face" }),
					" — ",
					createVNode($$PrLink, {
						pr: 3,
						repo: "juspay/odu",
						label: "juspay/odu#3"
					}),
					", ",
					createVNode(_components.code, { children: "odu mcp" }),
					" re-exposing the live surface as agent tools (",
					createVNode(_components.code, { children: "run" }),
					" · ",
					createVNode(_components.code, { children: "get_nodes" }),
					" · ",
					createVNode(_components.code, { children: "tail_log" }),
					" · ",
					createVNode(_components.code, { children: "rerun_node" }),
					" · fail-fast ",
					createVNode(_components.code, { children: "wait_for_settle" }),
					") plus subscribable resources (",
					createVNode(_components.code, { children: "odu://nodes" }),
					" · ",
					createVNode(_components.code, { children: "odu://log/{node}" }),
					", ",
					createVNode(_components.code, { children: "notifications/resources/updated" }),
					") — the agent-controlled CI justci built and reverted (",
					createVNode($$Issue, {
						n: 22,
						repo: "juspay/justci",
						label: "MCP server for ci"
					}),
					") because its batch shape had no serve-only mode. It needs ",
					createVNode(_components.strong, { children: "no new authz" }),
					": single-operator, same ssh trust as the CLI. kolu consumes it via the npins pin + the apm-deployed ",
					createVNode(_components.code, { children: ".mcp.json" }),
					". The rest of the live-service backlog rides behind it: idle-attach + selective start (the runner you reach with nothing live — now planned as ",
					createVNode(_components.a, {
						href: "./odu-runner.html",
						children: "odu-runner"
					}),
					"); the TUI rebuilt on OpenTUI’s Solid reconciler (prototype ",
					createVNode(_components.code, { children: "odu attach" }),
					" first); typed ",
					createVNode(_components.code, { children: "cancel" }),
					"/",
					createVNode(_components.code, { children: "cron" }),
					"/",
					createVNode(_components.code, { children: "reload" }),
					"; multi-platform fan-",
					createVNode(_components.strong, { children: "in" }),
					" with defined concurrent-mutation semantics; notifications + forge-event ingestion (beyond what justci ever had); runner-restart survival of live state; the per-node platform filter. The browser face — and the read-observer/mutator authz boundary it alone forces — has graduated from latent capability to its own plan of record, ",
					createVNode(_components.a, {
						href: "./odu-web.html",
						children: "odu-web"
					}),
					". Price the idle-runner lifecycle against the warm pu-box pool."
				]
			}),
			createVNode($$Milestone, {
				status: "now",
				label: "Phase 3 · graduation",
				children: [
					"Landed: ",
					createVNode($$PrLink, {
						pr: 1,
						repo: "juspay/odu",
						label: "juspay/odu#1"
					}),
					" (merged) stood the standalone repo up the drishti way — ",
					createVNode(_components.code, { children: "npins" }),
					"-pinned ",
					createVNode(_components.code, { children: "@kolu/{surface,surface-nix-host}" }),
					" extracted by overlay and hydrated as raw TypeScript (no vendoring), a zero-input flake (",
					createVNode(_components.code, { children: "nix run github:juspay/odu" }),
					"), and self-hosted CI from day one — GitHub Actions runs odu-on-odu per push (two platform lanes, strict, posting ",
					createVNode(_components.code, { children: "ci::*" }),
					" statuses with the odu built from the commit under test; first run green in 2m31s). Remaining: thread the runner derivation for repos that don’t expose ",
					createVNode(_components.code, { children: "odu-runner" }),
					" themselves, adopt ",
					createVNode(_components.code, { children: "surface-app" }),
					" (with the PWA face), a home-manager service, and extracting reusable concerns back into the libraries. The dependency then flipped: kolu deleted ",
					createVNode(_components.code, { children: "packages/odu" }),
					" and consumes the graduated repo via an npins pin re-exported through its own flake (",
					createVNode(_components.code, { children: "npins update odu" }),
					" to bump)."
				]
			})
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
	"title": "A CI runner you attach to — graduating mini-ci beyond justci",
	"description": "Every local CI tool runs your pipeline as a batch process and leaves you log files. mini-ci inverts that — the runner is a small live server that owns the pipeline as state, and your terminal and your coding agent attach to it over plain ssh. What that buys, what it costs — and Phase 1 — shipped in PR #1252 — which replaced justci in the kolu repo itself with the new package odu (Tamil for \"run\").",
	"parents": [
		"surface-app",
		"electricity",
		"feature"
	],
	"status": "implemented",
	"maturity": "seedling",
	"updated": "2026-06-12T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-it-is--attach-dont-scrape",
			"text": "What it is — attach, don’t scrape"
		},
		{
			"depth": 3,
			"slug": "how-that-differs-from-justci",
			"text": "How that differs from justci"
		},
		{
			"depth": 2,
			"slug": "faces-over-one-surface",
			"text": "Faces over one surface"
		},
		{
			"depth": 3,
			"slug": "the-human-face--the-tui-shipped",
			"text": "The human face — the TUI shipped"
		},
		{
			"depth": 3,
			"slug": "the-agent-face--mcp-shipped",
			"text": "The agent face — MCP shipped"
		},
		{
			"depth": 3,
			"slug": "the-browser-face--not-an-attach-face-at-all-proposed--odu-web",
			"text": "The browser face — not an attach face at all proposed — odu-web"
		},
		{
			"depth": 2,
			"slug": "the-architecture--three-primitives-over-ssh",
			"text": "The architecture — three primitives over ssh"
		},
		{
			"depth": 2,
			"slug": "the-honest-ledger--where-it-beats-justci-where-it-doesnt-yet",
			"text": "The honest ledger — where it beats justci, where it doesn’t yet"
		},
		{
			"depth": 3,
			"slug": "what-only-a-live-service-can-do",
			"text": "What only a live service can do"
		},
		{
			"depth": 3,
			"slug": "phase-1s-work-order--replacing-justci-in-this-repo",
			"text": "Phase 1’s work order — replacing justci in this repo"
		},
		{
			"depth": 2,
			"slug": "shipping-it--graduation-name-roadmap",
			"text": "Shipping it — graduation, name, roadmap"
		}
	];
}
var url = "src/content/atlas/odu.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/odu.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/odu.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
