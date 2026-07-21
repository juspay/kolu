import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$D2 } from "./D2_CPv-UX0x.mjs";
import "./Pill_DD4u2LYa.mjs";
import { t as $$Terminal } from "./Terminal_Dk3VeK3f.mjs";
//#region src/content/atlas/pulam-tui.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		li: "li",
		ol: "ol",
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
			createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "pulam-tui" }),
				" is the raw client of the ",
				createVNode(_components.a, {
					href: "pulam.html",
					children: "pulam"
				}),
				" daemon — kaval-tui’s sibling, one layer up."
			] }),
			" Where ",
			createVNode(_components.a, {
				href: "pty-daemon-tui.html",
				children: "kaval-tui"
			}),
			" is the thin shell client of the kaval ",
			createVNode(_components.em, { children: "PTY" }),
			" daemon (",
			createVNode(_components.code, { children: "list" }),
			" / ",
			createVNode(_components.code, { children: "attach" }),
			" / ",
			createVNode(_components.code, { children: "kill" }),
			" over a socket, no browser), ",
			createVNode(_components.code, { children: "pulam-tui" }),
			" is the thin shell client of the pulam ",
			createVNode(_components.em, { children: "awareness" }),
			" daemon: ",
			createVNode(_components.code, { children: "status" }),
			" / ",
			createVNode(_components.code, { children: "watch" }),
			" over the same socket-or-ssh transport. The rich, leave-it-on-a-second-monitor fleet view is ",
			createVNode(_components.strong, { children: createVNode(_components.a, {
				href: "pulam-web.html",
				children: "pulam-web"
			}) }),
			"’s job now — so ",
			createVNode(_components.code, { children: "pulam-tui" }),
			" sheds the ",
			createVNode(_components.strong, { children: "Bun + OpenTUI" }),
			" machinery it grew for that view and reverts to what kaval-tui has always been: a scriptable, single-daemon CLI face."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "What changed — the fleet board moved to the browser",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "pulam-tui" }),
				" ",
				createVNode(_components.em, { children: "was" }),
				" a full OpenTUI dashboard (a Bun binary, a per-arch Zig renderer via ",
				createVNode(_components.code, { children: "Bun.dlopen" }),
				", a live multi-host ",
				createVNode(_components.code, { children: "fleet" }),
				" board). That was the right call ",
				createVNode(_components.strong, { children: "while the TUI was the only rich fleet view" }),
				" — but ",
				createVNode(_components.a, {
					href: "pulam-web.html",
					children: "pulam-web"
				}),
				" (shipped through R-pulamweb-3) is now the browser fleet dashboard, and it is the better home for “what is every agent doing, across every host.” So the TUI’s expensive half is redundant. This note strips ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" back to a raw single-daemon client; the multi-host ",
				createVNode(_components.code, { children: "fleet" }),
				" board, the OpenTUI render, and the Bun runtime all leave. (It is ",
				createVNode(_components.strong, { children: "OpenTUI" }),
				" — the lib that ",
				createVNode(_components.em, { children: "powers" }),
				" opencode — plus ",
				createVNode(_components.strong, { children: "Bun" }),
				" that go; ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" never depended on opencode itself.)"
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "user-facing-description",
			children: "User-facing description"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Three verbs against one daemon — ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "status" }) }),
			" (a one-shot snapshot), ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "watch" }) }),
			" (a live follow), and ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "wait" }) }),
			" (block until a terminal’s agent reaches a state, then exit) — each scriptable with ",
			createVNode(_components.code, { children: "--json" }),
			", and ",
			createVNode(_components.code, { children: "watch" }),
			" optionally narrowed to a single terminal id. No alt-screen, no full-screen UI: ",
			createVNode(_components.code, { children: "pulam-tui" }),
			" prints to your terminal and exits, or streams line-by-line, exactly the way kaval-tui’s ",
			createVNode(_components.code, { children: "list" }),
			" / ",
			createVNode(_components.code, { children: "snapshot" }),
			" do. ",
			createVNode(_components.code, { children: "wait" }),
			" is the awareness analog of a blocking read: it’s the ",
			createVNode(_components.strong, { children: "done-signal" }),
			" an agent uses to drive another agent — prompt a Claude Code / Codex / opencode in a kaval terminal, then ",
			createVNode(_components.code, { children: "wait --until awaiting,waiting" }),
			" for its turn to end before reading the reply. (That’s the precise, agent-state done-signal for ",
			createVNode(_components.strong, { children: "hooked" }),
			" terminals; for a raw ",
			createVNode(_components.code, { children: "kaval-tui create" }),
			"’d agent with no hooks, ",
			createVNode(_components.a, {
				href: "pty-daemon-tui.html",
				children: createVNode(_components.code, { children: "kaval-tui wait --until idle:<ms>" })
			}),
			" is the hook-free counterpart — it keys on raw output quiescence instead of agent state.)"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "wait" }),
			" matches the agent’s state ",
			createVNode(_components.strong, { children: "the instant it connects" }),
			" (it replays the current value), so a robust driver waits in ",
			createVNode(_components.strong, { children: "two phases" }),
			" — ",
			createVNode(_components.code, { children: "--until working" }),
			" to confirm the prompt was picked up, ",
			createVNode(_components.em, { children: "then" }),
			" ",
			createVNode(_components.code, { children: "--until awaiting,waiting" }),
			" for the turn to end — rather than a lone post-",
			createVNode(_components.code, { children: "send" }),
			" wait that the ",
			createVNode(_components.em, { children: "previous" }),
			" turn’s stale ",
			createVNode(_components.code, { children: "waiting" }),
			"/",
			createVNode(_components.code, { children: "awaiting" }),
			" would satisfy immediately. It fails loud on a ",
			createVNode(_components.code, { children: "--timeout <ms>" }),
			" (exit 2) and on the terminal ",
			createVNode(_components.strong, { children: "exiting" }),
			" before the state lands (exit 3 — the agent you were driving died), so a stuck or dead agent can’t hang the loop."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The surface mapping — each command is a thin read over the ",
			createVNode(_components.code, { children: "terminalWorkspaceSurface" }),
			" the daemon serves:"
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
					createVNode(_components.th, { children: "Surface read" }),
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
					createVNode(_components.td, { children: createVNode(_components.code, { children: "pulam-tui status" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "snapshots" }), " collection (one-shot)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"Print one row per terminal — ",
						createVNode(_components.code, { children: "repo·branch · PR · agent · foreground" }),
						" — then exit. The awareness snapshot as a plain text table. (No recency/",
						createVNode(_components.code, { children: "idle" }),
						" column: pulam serves the memoryless ",
						createVNode(_components.code, { children: "TerminalSnapshot" }),
						", which has no ",
						createVNode(_components.code, { children: "lastActivityAt" }),
						" — recency is kolu’s remembered fact.) (No working-tree ",
						createVNode(_components.em, { children: "dirty" }),
						" count: that needs ",
						createVNode(_components.code, { children: "git.getStatus" }),
						", which the single-daemon snapshot deliberately doesn’t call — it’s pulam-web’s drill-in.)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "pulam-tui status --json" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "snapshots" }), " collection (one-shot)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"Emit the flat ",
						createVNode(_components.code, { children: "[{ id, ...TerminalSnapshot }]" }),
						" array and exit. The machine-readable face."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "pulam-tui watch" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "snapshots" }),
						" collection + ",
						createVNode(_components.code, { children: "activity" }),
						" stream (subscribe)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Follow ",
						createVNode(_components.strong, { children: "every terminal" }),
						" on the daemon: print a line each time any terminal’s awareness changes (agent state, branch, foreground), with a trailing ",
						createVNode(_components.code, { children: "●" }),
						" when it’s moving bytes right now, until ",
						createVNode(_components.code, { children: "Ctrl+C" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "pulam-tui watch --json" }) }),
					"\n",
					createVNode(_components.td, { children: "same" }),
					"\n",
					createVNode(_components.td, { children: "One JSON object per line (newline-delimited) per update, across all terminals — the streaming scriptable feed." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "pulam-tui watch <id>" }) }),
					"\n",
					createVNode(_components.td, { children: "same, filtered to one id" }),
					"\n",
					createVNode(_components.td, { children: [
						"The same live follow, narrowed to a single terminal. ",
						createVNode(_components.code, { children: "--json" }),
						" likewise."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "pulam-tui wait <id> --until <state>" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "snapshots" }), " collection (subscribe, one terminal)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"Block until that terminal’s agent enters a target bucket — ",
						createVNode(_components.code, { children: "working" }),
						" / ",
						createVNode(_components.code, { children: "awaiting" }),
						" / ",
						createVNode(_components.code, { children: "waiting" }),
						" (the shared ",
						createVNode(_components.code, { children: "agentBucket" }),
						" fold; ",
						createVNode(_components.code, { children: "awaiting,waiting" }),
						" = its turn ended), then exit. The done-signal for scripting an agent that drives another agent. ",
						createVNode(_components.code, { children: "--timeout <ms>" }),
						" caps it (fails loud, exit 2); ",
						createVNode(_components.code, { children: "--json" }),
						" emits ",
						createVNode(_components.code, { children: "{ id, agent }" }),
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
			"Flags mirror kaval-tui exactly: ",
			createVNode(_components.code, { children: "--socket <path>" }),
			" points at a local daemon (default ",
			createVNode(_components.code, { children: "$XDG_RUNTIME_DIR/pulam/awareness.sock" }),
			"); ",
			createVNode(_components.code, { children: "--host <ssh>" }),
			" dials and Nix-provisions a single remote pulam over ssh. The two are mutually exclusive, and there is ",
			createVNode(_components.strong, { children: "no multi-host mode" }),
			" — one invocation, one daemon. (Watching the whole ",
			createVNode(_components.em, { children: "fleet" }),
			" across hosts is what you open ",
			createVNode(_components.a, {
				href: "pulam-web.html",
				children: "pulam-web"
			}),
			" for.)"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "workflows",
			children: "Workflows"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Glance — what is every terminal in, right now." }),
			" ",
			createVNode(_components.code, { children: "status" }),
			" prints the snapshot and exits:"
		] }),
		"\n",
		createVNode($$Terminal, {
			title: "pulam-tui · unixSocketLink → /run/user/1000/pulam/awareness.sock",
			lines: [
				"$ pulam-tui status",
				"",
				"ID        REPO·BRANCH         PR            AGENT             FOREGROUND  IDLE",
				"a3f10000  kolu·feat/dial-ssh  #1412 open ✓  claude · working  node          4s",
				"b7c20000  drishti·master      —             codex · waiting   codex         1s",
				"c9d40000  kolu·fix/fold       #1408 open ✗  —                 nvim         12m"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Follow the whole daemon live." }),
			" ",
			createVNode(_components.code, { children: "watch" }),
			" (no id) streams every terminal’s changes as they land — leave it running in a spare pane. Each line is ",
			createVNode(_components.code, { children: "HH:MM:SS  id  repo·branch  agent · state" }),
			", with a trailing ",
			createVNode(_components.code, { children: "●" }),
			" when that terminal is moving bytes right now:"
		] }),
		"\n",
		createVNode($$Terminal, {
			title: "pulam-tui · watch",
			lines: [
				"$ pulam-tui watch",
				"14:02:11  a3f10000  kolu·feat/dial-ssh  claude · working  ●",
				"14:02:19  b7c20000  drishti·master      codex · waiting",
				"14:02:30  a3f10000  kolu·feat/dial-ssh  claude · awaiting",
				"14:05:48  c9d40000  (gone)",
				"^C"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Follow one terminal." }),
			" Narrow to an id (the short id from ",
			createVNode(_components.code, { children: "status" }),
			", or a unique prefix) when you only care about one agent:"
		] }),
		"\n",
		createVNode($$Terminal, {
			title: "pulam-tui · watch a3f10000",
			lines: [
				"$ pulam-tui watch a3f10000",
				"14:02:11  a3f10000  kolu·feat/dial-ssh  claude · working  ●",
				"14:02:30  a3f10000  kolu·feat/dial-ssh  claude · awaiting",
				"^C"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Script it." }),
			" ",
			createVNode(_components.code, { children: "--json" }),
			" turns either verb into a feed — pipe ",
			createVNode(_components.code, { children: "status --json" }),
			" through ",
			createVNode(_components.code, { children: "jq" }),
			", or alert off a ",
			createVNode(_components.code, { children: "watch --json" }),
			" line (NDJSON, one object per line):"
		] }),
		"\n",
		createVNode($$Terminal, {
			title: "pulam-tui · scripted",
			lines: [
				"$ pulam-tui status --json | jq -r '.[] | select(.agent.kind==\"claude-code\" and .agent.state==\"awaiting_user\") | .id'",
				"c9d40000-1111-4222-8333-444455556666",
				"",
				"$ pulam-tui watch --json | jq -rc 'select(.agent.state==\"awaiting_user\") | \"\\(.id) needs you\"'",
				"a3f10000-1111-4222-8333-444455556666 needs you",
				"# {\"id\":\"a3f10000-…\",\"live\":false,\"cwd\":\"/code/kolu\",\"git\":{\"repoName\":\"kolu\",\"branch\":\"feat/dial-ssh\"},\"agent\":{\"kind\":\"claude-code\",\"state\":\"awaiting_user\"},\"pr\":{…}}"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Reach a remote daemon." }),
			" ",
			createVNode(_components.code, { children: "--host" }),
			" dials and Nix-provisions one pulam over ssh — same two verbs, no kolu-server:"
		] }),
		"\n",
		createVNode($$Terminal, {
			title: "pulam-tui · status --host prod",
			lines: [
				"$ pulam-tui status --host prod",
				"",
				"ID        REPO·BRANCH        PR            AGENT             FOREGROUND  IDLE",
				"d4e20000  infra·deploy       —             —                 ansible       8s",
				"f1a80000  kolu·fix/heap-oom  #1427 open ✓  claude · working  node          2s"
			]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "architecture-level-changes",
			children: "Architecture-level changes"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The whole point is the ",
			createVNode(_components.strong, { children: "raw-vs-rich split" }),
			", the same one kaval-tui draws against its daemon: the daemon is durable and serves the full typed surface; the ",
			createVNode(_components.code, { children: "-tui" }),
			" client is the bare, scriptable face, and the ",
			createVNode(_components.em, { children: "browser" }),
			" is the rich one. ",
			createVNode(_components.code, { children: "pulam-tui" }),
			" reading awareness is the exact analog of kaval-tui reading PTYs."
		] }),
		"\n",
		createVNode($$D2, {
			caption: "One daemon, two clients, split by richness — the kaval picture, one layer up. pulam serves the whole terminalWorkspaceSurface; pulam-web (browser) is the rich client that fans out over N hosts and renders the fleet dashboard; pulam-tui is the raw client — one daemon, status + watch + wait, scriptable. pulam-tui no longer needs Bun or OpenTUI: it is a plain Node/tsx CLI over @kolu/surface's link family, dialing one --socket or one --host.",
			code: `direction: down
classes: {
cli: { style.fill: "#eef0f2"; style.stroke: "#d9dde2"; style.font-color: "#475569" }
web: { style.fill: "#e7eefb"; style.stroke: "#c3d4f3"; style.font-color: "#2563eb" }
tool: { style.fill: "#fbf1dc"; style.stroke: "#ecd9ab"; style.font-color: "#b45309" }
pty: { style.fill: "#e6f4ea"; style.stroke: "#bce3c8"; style.font-color: "#15803d" }
}
tui: "pulam-tui (raw client)\\nNode · tsx · status + watch + wait · ONE daemon" { class: cli }
web: "pulam-web (rich client)\\nbrowser · fans out N hosts · the fleet board" { class: web }
pulam: "pulam (daemon)\\nruns the sensors · serves terminalWorkspaceSurface" { class: tool }
kaval: "kaval\\ndurable PTY · taps" { class: pty }
tui -> pulam: "dials · awareness + activity (--socket | --host)"
web -> pulam: "mirrors over ws (rich fleet)"
pulam -> kaval: "taps"
`
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "pulam-tui" }), " reverts to a leaf — and loses no electricity proof by doing so."] }),
			" The original note justified the OpenTUI fleet board as the awareness analog of ",
			createVNode(_components.a, {
				href: "electricity.html",
				children: "drishti"
			}),
			": a second consumer that proves pulam’s ",
			createVNode(_components.em, { children: "own" }),
			" surface is a receptacle other apps plug into. That proof now stands on ",
			createVNode(_components.strong, { children: "pulam-web" }),
			" — a second consumer, and the ",
			createVNode(_components.em, { children: "better" }),
			" one, reading the same surface the same way kolu’s browser will. With the electricity carried elsewhere, the TUI no longer has to be rich to earn its keep; it can be the bare scriptable client and nothing is lost. The renderer that the old note called “electricity, but already OpenTUI” is simply not needed in the TUI anymore — the rich render lives in the browser, where it belongs."
		] }),
		"\n",
		createVNode(_components.p, { children: "What leaves the package, and why it was only ever there for the fleet board:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"The Bun runtime → back to Node (",
					createVNode(_components.code, { children: "tsx" }),
					")."
				] }),
				" OpenTUI’s renderer is a native Zig core loaded via ",
				createVNode(_components.code, { children: "Bun.dlopen" }),
				", so the dashboard needed Bun. With no dashboard, Node is enough — matching kaval-tui’s ",
				createVNode(_components.code, { children: "tsx src/main.ts" }),
				" and the pulam daemon’s own runtime."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"OpenTUI (",
					createVNode(_components.code, { children: "@opentui/core" }),
					", ",
					createVNode(_components.code, { children: "@opentui/solid" }),
					") + the per-arch Zig lib."
				] }),
				" The whole SolidJS-into-terminal render layer (",
				createVNode(_components.code, { children: "render.ts" }),
				", the live clock, the breathing alert strip) goes; ",
				createVNode(_components.code, { children: "status" }),
				" prints a table and exits."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "bun2nix and its scaffolding." }),
				" ",
				createVNode(_components.code, { children: "bun.lock" }),
				" / the autogenerated ",
				createVNode(_components.code, { children: "bun.nix" }),
				" / the per-arch Zig closure / the pnpm-workspace exclusion that kept the Bun manifest out of pnpm’s glob — all of it existed to package the Bun viewer. It is replaced by the same plain Node packaging kaval-tui uses."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"The multi-host ",
					createVNode(_components.code, { children: "fleet" }),
					" subcommand."
				] }),
				" The N-host fan-out, the ",
				createVNode(_components.code, { children: "(host, terminalId)" }),
				" aggregate, the ",
				createVNode(_components.code, { children: "FleetSink" }),
				" / ",
				createVNode(_components.code, { children: "startFleet" }),
				" / multi-host ",
				createVNode(_components.code, { children: "RepoWatchSet" }),
				", the ",
				createVNode(_components.code, { children: "--by" }),
				" / ",
				createVNode(_components.code, { children: "--no-local" }),
				" / ",
				createVNode(_components.code, { children: "--ssh-config" }),
				" flags — the entire aggregation surface moves to ",
				createVNode(_components.a, {
					href: "pulam-web.html",
					children: "pulam-web"
				}),
				", which already owns it. ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" dials one daemon."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "What stays — the thin-client spine, shared with kaval-tui:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The single-daemon dial." }),
				" ",
				createVNode(_components.code, { children: "--socket" }),
				" for a local daemon and ",
				createVNode(_components.code, { children: "--host" }),
				" for one remote pulam over ssh, both through ",
				createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
				"’s ",
				createVNode(_components.code, { children: "dialAgentOnce" }),
				" — the ",
				createVNode(_components.em, { children: "same" }),
				" one-shot primitive kaval-tui’s ",
				createVNode(_components.code, { children: "--host" }),
				" rides. ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" and kaval-tui stay thin wrappers over one shared dial."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"The awareness read + ",
					createVNode(_components.code, { children: "--json" }),
					"."
				] }),
				" The one-shot ",
				createVNode(_components.code, { children: "awareness" }),
				"-collection dump (today’s ",
				createVNode(_components.code, { children: "--json" }),
				") is already exactly what ",
				createVNode(_components.code, { children: "status" }),
				" needs; it keeps that path and grows the human table beside it."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "implementation-details",
			children: "Implementation details"
		}),
		"\n",
		createVNode(_components.p, { children: "A subtractive change, mostly: delete the viewer, keep the dial, rename the snapshot. The decisions, to be echoed as code comments at their sites (the kaval-tui convention):" }),
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
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Runtime" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "tsx" }), ", not Bun"] }),
					"\n",
					createVNode(_components.td, { children: [
						"The daemon already runs Node; with OpenTUI gone there is nothing left that needs Bun’s ",
						createVNode(_components.code, { children: "dlopen" }),
						". One runtime across daemon + CLI, and a smaller closure (no per-arch Zig)."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Render" }) }),
					"\n",
					createVNode(_components.td, { children: "plain line output, no alt-screen" }),
					"\n",
					createVNode(_components.td, { children: [
						"A raw status client owns zero pixels — it prints rows and exits, or streams lines. The rich, full-screen render is ",
						createVNode(_components.a, {
							href: "pulam-web.html",
							children: "pulam-web"
						}),
						"’s. This mirrors kaval-tui’s raw-passthrough render-fidelity decision."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Scope" }) }),
					"\n",
					createVNode(_components.td, { children: "one daemon, no fleet" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "--socket" }),
						" ",
						createVNode(_components.em, { children: "or" }),
						" one ",
						createVNode(_components.code, { children: "--host" }),
						"; the multi-host aggregation is pulam-web’s. Keeping a degraded text-mode fleet in the TUI would duplicate pulam-web for no gain — the glance view is the browser’s."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Commands" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "status" }),
						" (snapshot) / ",
						createVNode(_components.code, { children: "watch" }),
						" (live) / ",
						createVNode(_components.code, { children: "wait" }),
						" (block until a state), each with ",
						createVNode(_components.code, { children: "--json" }),
						"; ",
						createVNode(_components.code, { children: "watch" }),
						" takes an optional ",
						createVNode(_components.code, { children: "<id>" }),
						", ",
						createVNode(_components.code, { children: "wait" }),
						" a required ",
						createVNode(_components.code, { children: "<id>" }),
						" + ",
						createVNode(_components.code, { children: "--until" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "status" }),
						" is the awareness snapshot (kaval-tui’s ",
						createVNode(_components.code, { children: "list" }),
						"/",
						createVNode(_components.code, { children: "snapshot" }),
						" analog); ",
						createVNode(_components.code, { children: "watch" }),
						" is the streaming verb pulam adds over kaval-tui’s one-shot-only model — bare ",
						createVNode(_components.code, { children: "watch" }),
						" follows every terminal, ",
						createVNode(_components.code, { children: "watch <id>" }),
						" narrows to one. ",
						createVNode(_components.code, { children: "wait" }),
						" rides the same awareness subscription but exits on the first frame whose agent enters a ",
						createVNode(_components.code, { children: "--until" }),
						" bucket (the shared ",
						createVNode(_components.code, { children: "agentBucket" }),
						" fold) — the done-signal for agent-drives-agent scripting (",
						createVNode(_components.code, { children: "send" }),
						" a prompt, ",
						createVNode(_components.code, { children: "wait" }),
						" for the turn to end, ",
						createVNode(_components.code, { children: "snapshot" }),
						" the reply). The natural CLI expression of the awareness/activity stream."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "The steps:" }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Strip the viewer." }),
				" Remove ",
				createVNode(_components.code, { children: "@opentui/*" }),
				", the ",
				createVNode(_components.code, { children: "render.ts" }),
				" OpenTUI tree, the live clock, and the ",
				createVNode(_components.code, { children: "fleet" }),
				" subcommand from ",
				createVNode(_components.code, { children: "packages/pulam-tui" }),
				". Drop the Bun manifest (",
				createVNode(_components.code, { children: "bun.lock" }),
				" / ",
				createVNode(_components.code, { children: "bun.nix" }),
				" / the Zig closure) and the pnpm-workspace exclusion; repoint ",
				createVNode(_components.code, { children: "package.json" }),
				"’s ",
				createVNode(_components.code, { children: "start" }),
				" to ",
				createVNode(_components.code, { children: "tsx src/bin.ts" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Keep the dial, rename the snapshot." }),
				" The existing single-endpoint awareness consume (today rendered by the OpenTUI list, dumped by ",
				createVNode(_components.code, { children: "--json" }),
				") becomes ",
				createVNode(_components.code, { children: "status" }),
				" / ",
				createVNode(_components.code, { children: "status --json" }),
				" over ",
				createVNode(_components.code, { children: "--socket" }),
				" | ",
				createVNode(_components.code, { children: "--host" }),
				" (",
				createVNode(_components.code, { children: "dialAgentOnce" }),
				"). No surface change — ",
				createVNode(_components.code, { children: "status" }),
				" is a one-shot read of the ",
				createVNode(_components.code, { children: "snapshots" }),
				" collection the daemon already serves."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Add ",
					createVNode(_components.code, { children: "watch" }),
					"."
				] }),
				" Subscribe to the ",
				createVNode(_components.code, { children: "snapshots" }),
				" collection plus the ",
				createVNode(_components.code, { children: "activity" }),
				" stream and print each update — a line in default mode, one JSON object per line under ",
				createVNode(_components.code, { children: "--json" }),
				" — until ",
				createVNode(_components.code, { children: "Ctrl+C" }),
				". Bare ",
				createVNode(_components.code, { children: "watch" }),
				" follows every terminal; an optional ",
				createVNode(_components.code, { children: "<id>" }),
				" filters to one. A pure consumer; no contract bump."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Repackage like kaval-tui." }),
				" The Nix derivation drops ",
				createVNode(_components.code, { children: "bun2nix" }),
				" for the plain Node packaging ",
				createVNode(_components.code, { children: "packages/kaval-tui" }),
				" uses; ",
				createVNode(_components.code, { children: "nix run …#pulam-tui" }),
				" and the dev recipe follow kaval-tui’s wholesale."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Consequence — pulam-tui leaves the three-surface paint mirror",
			children: createVNode(_components.p, { children: [
				"The ",
				createVNode(_components.code, { children: "dock-fleet-mirror" }),
				" instruction pins a three-surface agent-state contract — kolu’s Dock, ",
				createVNode(_components.code, { children: "pulam-tui" }),
				", and ",
				createVNode(_components.code, { children: "pulam-web" }),
				" all painting from the shared ",
				createVNode(_components.code, { children: "@kolu/terminal-workspace/agentProjection" }),
				" fold. Dropping the TUI’s fleet render takes ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" out of that set: the contract becomes ",
				createVNode(_components.strong, { children: "Dock + pulam-web" }),
				" (the two surfaces that still render sorted, colour-coded agent state). The ",
				createVNode(_components.code, { children: "status" }),
				" table can still read awareness, but it is an unsorted snapshot — the needs-you-first sort, the paint classes, and the breathing alert are pulam-web’s. Update the ",
				createVNode(_components.code, { children: "dock-fleet-mirror" }),
				" rule to a two-surface contract as part of this change."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "history",
			children: "History"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Shipped" }),
				" (2026-06-26, ",
				createVNode($$PrLink, { pr: 1582 }),
				") — with ",
				createVNode(_components.a, {
					href: "pulam-web.html",
					children: "pulam-web"
				}),
				" shipped as the browser fleet dashboard (R-pulamweb-3, ",
				createVNode($$PrLink, { pr: 1535 }),
				"), the OpenTUI/Bun fleet board in ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" was redundant. This reverts ",
				createVNode(_components.code, { children: "pulam-tui" }),
				" to a ",
				createVNode(_components.a, {
					href: "pty-daemon-tui.html",
					children: "kaval-tui"
				}),
				"-style raw client — ",
				createVNode(_components.code, { children: "status" }),
				" and ",
				createVNode(_components.code, { children: "watch" }),
				" (all terminals, or one by id) over one daemon, Node/",
				createVNode(_components.code, { children: "tsx" }),
				" instead of Bun, no OpenTUI, no multi-host fleet. Split out of ",
				createVNode(_components.a, {
					href: "pulam.html",
					children: "pulam"
				}),
				"’s R4.5 (the fleet board) and its “Why this stays a TUI” / “Why Bun” sections, which this supersedes; the daemon note keeps the daemon story and points here for the client."
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
	"title": "pulam-tui — the thin CLI client for the pulam daemon",
	"description": "Now that pulam-web carries the rich fleet dashboard, pulam-tui no longer needs to be a full-blown TUI. It sheds Bun + OpenTUI and reverts to a kaval-tui-style raw client — status / status --json / watch <id> / watch <id> --json / wait <id> --until <state> against one pulam daemon over a unix socket or ssh. The CLI face of pulam; the multi-host fleet board moves wholesale to the browser.",
	"parents": ["pulam", "feature"],
	"status": "implemented",
	"maturity": "budding",
	"updated": "2026-06-26T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "user-facing-description",
			"text": "User-facing description"
		},
		{
			"depth": 3,
			"slug": "workflows",
			"text": "Workflows"
		},
		{
			"depth": 2,
			"slug": "architecture-level-changes",
			"text": "Architecture-level changes"
		},
		{
			"depth": 2,
			"slug": "implementation-details",
			"text": "Implementation details"
		},
		{
			"depth": 2,
			"slug": "history",
			"text": "History"
		}
	];
}
var url = "src/content/atlas/pulam-tui.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pulam-tui.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pulam-tui.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
