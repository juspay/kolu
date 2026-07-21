import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Cite } from "./Cite_IypTixBQ.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/diagrams/grok-cli-support.svg?raw
var grok_cli_support_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 820 420\" font-family=\"ui-sans-serif, system-ui, sans-serif\" role=\"img\" aria-label=\"Grok CLI agent support: a new kolu-grok sibling adapter reads ~/.grok session files, implements AgentAdapter, and joins the closed AgentInfo union so sensors, dock, and client chrome treat grok like claude, codex, and opencode.\">\n  <defs>\n    <marker id=\"g-arrow\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0L10 5L0 10z\" fill=\"#475569\"/>\n    </marker>\n    <style>\n      .t { fill:#0f172a; font-size:15px; font-weight:700; }\n      .s { fill:#64748b; font-size:11px; }\n      .m { font-family:ui-monospace, \"SF Mono\", Menlo, monospace; font-size:11px; fill:#334155; }\n      .box { fill:#F8FAFC; stroke:#94A3B8; stroke-width:1.5; }\n      .box-new { fill:#EEF2FF; stroke:#4F46E5; stroke-width:2; }\n      .box-leaf { fill:#ECFDF5; stroke:#059669; stroke-width:1.5; }\n      .box-disk { fill:#FFF7ED; stroke:#C2410C; stroke-width:1.5; }\n      .ht { fill:#0f172a; font-size:12.5px; font-weight:700; }\n      .hs { fill:#475569; font-size:10.5px; }\n      .badge { fill:#4F46E5; font-size:9.5px; font-weight:700; letter-spacing:0.06em; }\n      .edge { stroke:#475569; stroke-width:1.75; fill:none; marker-end:url(#g-arrow); }\n      .edge-dash { stroke:#64748b; stroke-width:1.5; stroke-dasharray:4 3; fill:none; marker-end:url(#g-arrow); }\n      .elabel { fill:#64748b; font-size:10px; font-style:italic; }\n    </style>\n  </defs>\n\n  <text class=\"t\" x=\"28\" y=\"28\">Grok CLI as a fourth full agent adapter</text>\n  <text class=\"s\" x=\"28\" y=\"48\">Same shape as codex/opencode — sibling package, closed union arm, one registry line in sensors</text>\n\n  <!-- Disk -->\n  <rect class=\"box-disk\" x=\"28\" y=\"78\" width=\"220\" height=\"196\" rx=\"10\"/>\n  <text class=\"ht\" x=\"138\" y=\"104\" text-anchor=\"middle\">~/.grok (on disk)</text>\n  <text class=\"m\" x=\"44\" y=\"128\">active_sessions.json</text>\n  <text class=\"hs\" x=\"44\" y=\"144\">pid · session_id · cwd</text>\n  <text class=\"m\" x=\"44\" y=\"172\">sessions/&lt;enc-cwd&gt;/</text>\n  <text class=\"m\" x=\"44\" y=\"188\">&lt;uuid&gt;/events.jsonl</text>\n  <text class=\"hs\" x=\"44\" y=\"204\">phase_changed · turn_*</text>\n  <text class=\"m\" x=\"44\" y=\"228\">…/summary.json</text>\n  <text class=\"hs\" x=\"44\" y=\"244\">model · title · created_at</text>\n  <text class=\"hs\" x=\"138\" y=\"262\" text-anchor=\"middle\">watch + tail — no SQLite</text>\n\n  <!-- New adapter -->\n  <rect class=\"box-new\" x=\"300\" y=\"78\" width=\"230\" height=\"196\" rx=\"10\"/>\n  <text class=\"badge\" x=\"415\" y=\"100\" text-anchor=\"middle\">NEW · kolu-grok</text>\n  <text class=\"ht\" x=\"415\" y=\"124\" text-anchor=\"middle\">packages/integrations/grok</text>\n  <text class=\"m\" x=\"318\" y=\"150\">grokAdapter : AgentAdapter</text>\n  <text class=\"hs\" x=\"318\" y=\"170\">resolveSession  (pid → active_sessions,</text>\n  <text class=\"hs\" x=\"318\" y=\"186\">               else cwd → latest uuid)</text>\n  <text class=\"hs\" x=\"318\" y=\"210\">createWatcher   tail events.jsonl</text>\n  <text class=\"hs\" x=\"318\" y=\"226\">                + summary.json</text>\n  <text class=\"hs\" x=\"318\" y=\"250\">GrokInfoSchema  kind: \"grok\"</text>\n\n  <!-- anyagent leaf -->\n  <rect class=\"box-leaf\" x=\"580\" y=\"78\" width=\"212\" height=\"100\" rx=\"10\"/>\n  <text class=\"ht\" x=\"686\" y=\"108\" text-anchor=\"middle\">anyagent (unchanged contract)</text>\n  <text class=\"hs\" x=\"598\" y=\"130\">AgentAdapter · matchesAgent</text>\n  <text class=\"hs\" x=\"598\" y=\"148\">STABLE_FLAGS · AGENT_RESUME</text>\n  <text class=\"hs\" x=\"598\" y=\"166\">AgentKindSchema += \"grok\"</text>\n\n  <!-- consumers -->\n  <rect class=\"box\" x=\"580\" y=\"198\" width=\"212\" height=\"76\" rx=\"10\"/>\n  <text class=\"ht\" x=\"686\" y=\"224\" text-anchor=\"middle\">closed union + wire</text>\n  <text class=\"hs\" x=\"598\" y=\"246\">terminal-workspace AgentInfoSchema</text>\n  <text class=\"hs\" x=\"598\" y=\"262\">client agentIcons / agentNames</text>\n\n  <!-- sensors -->\n  <rect class=\"box\" x=\"300\" y=\"310\" width=\"492\" height=\"78\" rx=\"10\"/>\n  <text class=\"ht\" x=\"546\" y=\"338\" text-anchor=\"middle\">@kolu/terminal-workspace sensors</text>\n  <text class=\"hs\" x=\"320\" y=\"360\">startAgent(claudeCodeAdapter) · startAgent(codexAdapter) · startAgent(opencodeAdapter)</text>\n  <text class=\"m\" x=\"320\" y=\"378\">+ startAgent(grokAdapter)   ← one more line; dock / pulam fold for free</text>\n\n  <!-- edges -->\n  <path class=\"edge\" d=\"M248 176 H300\"/>\n  <text class=\"elabel\" x=\"258\" y=\"168\">read</text>\n  <path class=\"edge\" d=\"M530 140 H580\"/>\n  <text class=\"elabel\" x=\"538\" y=\"132\">implements</text>\n  <path class=\"edge-dash\" d=\"M415 274 V310\"/>\n  <path class=\"edge\" d=\"M686 274 V310\"/>\n  <text class=\"elabel\" x=\"430\" y=\"298\">register</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/grok-cli-support.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		li: "li",
		ol: "ol",
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
			"xAI ships ",
			createVNode(_components.strong, { children: createVNode(_components.a, {
				href: "https://x.ai/news/grok-build-cli",
				children: "Grok Build"
			}) }),
			" — a terminal coding agent\nwhose binary is ",
			createVNode(_components.code, { children: "grok" }),
			". Kolu already treats any shell program as a terminal; what\nit ",
			createVNode(_components.em, { children: "doesn’t" }),
			" do yet is treat Grok as one of the three ",
			createVNode(_components.strong, { children: "icon-capable" }),
			" agents\n(",
			createVNode(_components.code, { children: "claude-code" }),
			" · ",
			createVNode(_components.code, { children: "codex" }),
			" · ",
			createVNode(_components.code, { children: "opencode" }),
			"): no tile chrome, no dock pip state, no\nworktree-leaf resume, no palette kind bridge. This note is the plan to add it as\na fourth full adapter, not a detection-only basename.",
			createVNode($$Footnote, { children: [
				"Detection-only agents (",
				createVNode(_components.code, { children: "aider" }),
				", ",
				createVNode(_components.code, { children: "goose" }),
				", ",
				createVNode(_components.code, { children: "gemini" }),
				", ",
				createVNode(_components.code, { children: "cursor-agent" }),
				") only enter ",
				createVNode(_components.code, { children: "STABLE_FLAGS" }),
				" so the command palette remembers them. They never join ",
				createVNode(_components.code, { children: "AgentKindSchema" }),
				" or get a state indicator. Grok is in the full-adapter set because users run it as a primary coding agent the same way they run Claude / Codex / OpenCode — the bar is parity with that trio, not with the MRU-only list."
			] })
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "What ships",
			children: createVNode(_components.p, { children: [
				"Run ",
				createVNode(_components.code, { children: "grok" }),
				" in any kolu terminal → tile chrome shows a Grok icon and live state\n(thinking / tools / waiting / awaiting you), the dock ranks it like the other\nagents, sleep/restore resumes with ",
				createVNode(_components.code, { children: "grok -c" }),
				" or ",
				createVNode(_components.code, { children: "grok --resume &lt;uuid&gt;" }),
				", and\nthe worktree agent picker can re-launch the normalized command. Implemented in\n",
				createVNode($$PrLink, { pr: 1732 }),
				"."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "shape",
			children: "Shape"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Same cut as every existing agent: a ",
			createVNode(_components.strong, { children: "sibling package" }),
			" under\n",
			createVNode(_components.code, { children: "packages/integrations/" }),
			", implementing ",
			createVNode(_components.code, { children: "anyagent" }),
			"’s ",
			createVNode(_components.code, { children: "AgentAdapter" }),
			", owning its\nown ",
			createVNode(_components.code, { children: "*InfoSchema" }),
			", and joining the closed union one layer up. No new electricity\n— session files on disk are a bounded algorithm (leaf), not a transport/reconnect\nreceptacle."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: grok_cli_support_default,
			wide: true,
			caption: "kolu-grok is a sibling of kolu-codex / kolu-opencode / kolu-claude-code. It reads ~/.grok, implements AgentAdapter, and is registered with one extra startAgent line. The anyagent contract and the closed AgentInfo union are the only shared seams that grow."
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Layer" }),
					"\n",
					createVNode(_components.th, { children: "What changes" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "kolu-grok" }) }), " (new)"] }),
					"\n",
					createVNode(_components.td, { children: "Adapter + session resolve + events tail + schemas" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: createVNode(_components.code, { children: "anyagent" }) }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "STABLE_FLAGS[\"grok\"]" }),
						", ",
						createVNode(_components.code, { children: "BASENAME_TO_KIND" }),
						", ",
						createVNode(_components.code, { children: "AGENT_RESUME" }),
						", ",
						createVNode(_components.code, { children: "AgentKindSchema" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/terminal-workspace" }) }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "AgentInfoSchema" }),
						" arm + ",
						createVNode(_components.code, { children: "startAgent(grokAdapter)" }),
						" in sensors"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "client" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "GrokIcon" }),
						", ",
						createVNode(_components.code, { children: "agentIcons" }),
						" / ",
						createVNode(_components.code, { children: "agentNames" }),
						" entries"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "e2e" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "grok.feature" }), " + fixture writer (mirrors codex/opencode)"] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "on-disk-facts-verified",
			children: "On-disk facts (verified)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Grounded in a live ",
			createVNode(_components.code, { children: "~/.grok" }),
			" install (Grok Build beta, binary\n",
			createVNode(_components.code, { children: "/home/…/.local/bin/grok" }),
			" → ",
			createVNode(_components.code, { children: "~/.grok/bin/grok" }),
			"). The marketing name is “Grok\nBuild”; the process basename and CLI entrypoint are ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "grok" }) }),
			"."
		] }),
		"\n",
		createVNode(_components.pre, {
			class: "astro-code github-light",
			style: {
				backgroundColor: "#fff",
				color: "#24292e",
				overflowX: "auto"
			},
			tabindex: "0",
			"data-language": "plaintext",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "~/.grok/" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  active_sessions.json          # [{ session_id, pid, cwd, opened_at }, …]" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  sessions/<urlencode(cwd)>/" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    <uuid>/" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "      events.jsonl              # phase_changed · tool_* · turn_started/ended" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "      summary.json              # model, title, created_at, cwd" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "      chat_history.jsonl        # full transcript (export later)" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "      updates.jsonl             # ACP-style session/update stream" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "      …" })
				})
			] })
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Session id" }),
				" is a UUID (observed as uuid-shaped; often uuidv7-like). Resume:\n",
				createVNode(_components.code, { children: "-c" }),
				" / ",
				createVNode(_components.code, { children: "--continue" }),
				" (most recent in cwd), ",
				createVNode(_components.code, { children: "-r" }),
				" / ",
				createVNode(_components.code, { children: "--resume [<SESSION_ID>]" }),
				"\n(exact)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Cwd encoding" }),
				" is full URL-encoding of the absolute path\n(",
				createVNode(_components.code, { children: "/home/…" }),
				" → ",
				createVNode(_components.code, { children: "%2Fhome%2F…" }),
				") — same idea as Claude’s project-dir encoding,\ndifferent alphabet."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Live process map" }),
				" is ",
				createVNode(_components.code, { children: "active_sessions.json" }),
				" (pid + cwd + session_id). This\nis the preferred match signal — analogous to Claude’s\n",
				createVNode(_components.code, { children: "~/.claude/sessions/<pid>.json" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "State stream" }),
				" is ",
				createVNode(_components.code, { children: "events.jsonl" }),
				". Observed ",
				createVNode(_components.code, { children: "phase_changed.phase" }),
				" values:\n",
				createVNode(_components.code, { children: "waiting_for_model" }),
				", ",
				createVNode(_components.code, { children: "streaming_reasoning" }),
				", ",
				createVNode(_components.code, { children: "streaming_text" }),
				",\n",
				createVNode(_components.code, { children: "tool_execution" }),
				", ",
				createVNode(_components.code, { children: "permission_prompt" }),
				". Turn lifecycle:\n",
				createVNode(_components.code, { children: "turn_started" }),
				" / ",
				createVNode(_components.code, { children: "turn_ended" }),
				" (",
				createVNode(_components.code, { children: "outcome: completed | cancelled" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Metadata" }),
				" lives in ",
				createVNode(_components.code, { children: "summary.json" }),
				": ",
				createVNode(_components.code, { children: "current_model_id" }),
				",\n",
				createVNode(_components.code, { children: "generated_title" }),
				" / ",
				createVNode(_components.code, { children: "session_summary" }),
				", ",
				createVNode(_components.code, { children: "created_at" }),
				", ",
				createVNode(_components.code, { children: "info.id" }),
				", ",
				createVNode(_components.code, { children: "info.cwd" }),
				"."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"There is ",
			createVNode(_components.strong, { children: "no SQLite session DB" }),
			" for the TUI path (unlike Codex / OpenCode).\nWatchers are plain ",
			createVNode(_components.code, { children: "fs.watch" }),
			" / refcounted dir watchers on JSON files — same\nfamily as Claude’s transcript tail, not the WAL path."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "state-fold",
			children: "State fold"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Map the last meaningful event after the latest ",
			createVNode(_components.code, { children: "turn_started" }),
			" (or\n",
			createVNode(_components.code, { children: "turn_ended" }),
			" if no open turn) onto the shared agent-state vocabulary. Do ",
			createVNode(_components.strong, { children: "not" }),
			"\ninvent a fifth paint class — reuse the closed set the Dock already folds."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Grok signal" }),
					"\n",
					createVNode(_components.th, { children: createVNode(_components.code, { children: "AgentInfo.state" }) }),
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
						"open ",
						createVNode(_components.code, { children: "ask_user_question" }),
						" (",
						createVNode(_components.code, { children: "tool_started" }),
						" without ",
						createVNode(_components.code, { children: "tool_completed" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "awaiting_user" }),
						" (wins over a trailing ",
						createVNode(_components.code, { children: "tool_execution" }),
						" phase)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"open turn + ",
						createVNode(_components.code, { children: "permission_prompt" }),
						" (and no later phase)"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "awaiting_user" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"open turn + ",
						createVNode(_components.code, { children: "tool_execution" }),
						" (no open ask-user tool)"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "tool_use" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"open turn + ",
						createVNode(_components.code, { children: "waiting_for_model" }),
						" / ",
						createVNode(_components.code, { children: "streaming_reasoning" }),
						" / ",
						createVNode(_components.code, { children: "streaming_text" })
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "thinking" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "turn_ended" }),
						" with no subsequent ",
						createVNode(_components.code, { children: "turn_started" })
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "waiting" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "matched session, no events yet" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "thinking" }), " (bootstrapping)"] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "running_background" }),
			" is ",
			createVNode(_components.strong, { children: "out of scope" }),
			" for v1 (Claude-only today — dynamic\nworkflow journal). Grok’s parallel subagents do not yet expose an equivalent\non-disk journal kolu can observe without screen-scrape guesswork."
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Honest nulls:" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "taskProgress: null" }),
				" — plan entries appear in ",
				createVNode(_components.code, { children: "updates.jsonl" }),
				"\n(",
				createVNode(_components.code, { children: "sessionUpdate: \"plan\"" }),
				") but are optional and shape-unstable; leave until\nthe plan event is pinned."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Filled fields:" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "sessionId" }),
				" ← ",
				createVNode(_components.code, { children: "summary.info.id" }),
				" / ",
				createVNode(_components.code, { children: "active_sessions.session_id" })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "model" }),
				" ← ",
				createVNode(_components.code, { children: "summary.current_model_id" })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "summary" }),
				" ← ",
				createVNode(_components.code, { children: "generated_title" }),
				" ?? ",
				createVNode(_components.code, { children: "session_summary" })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "startedAt" }),
				" ← parse ",
				createVNode(_components.code, { children: "created_at" }),
				" to epoch-ms"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "contextTokens" }),
				" ← ",
				createVNode(_components.code, { children: "signals.json" }),
				" ",
				createVNode(_components.code, { children: "contextTokensUsed" }),
				" (null until signals land)"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "session-match",
			children: "Session match"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Prefer the ",
			createVNode(_components.strong, { children: "pid map" }),
			", fall back to ",
			createVNode(_components.strong, { children: "cwd" }),
			":"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"If ",
				createVNode(_components.code, { children: "matchesAgent(state, \"grok\")" }),
				" is false → ",
				createVNode(_components.code, { children: "null" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Read ",
				createVNode(_components.code, { children: "active_sessions.json" }),
				". If an entry’s ",
				createVNode(_components.code, { children: "pid" }),
				" equals\n",
				createVNode(_components.code, { children: "state.foregroundPid" }),
				" → that ",
				createVNode(_components.code, { children: "session_id" }),
				" (+ cwd-encoded path for the\nevents file)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Else look under ",
				createVNode(_components.code, { children: "sessions/<urlencode(state.cwd)>/" }),
				" for the most recently\n",
				createVNode(_components.code, { children: "updated_at" }),
				" (or mtime) session directory that still has a ",
				createVNode(_components.code, { children: "summary.json" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"No row / no dir → ",
				createVNode(_components.code, { children: "null" }),
				" (watcher not created)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "externalChanges.isPresent" }),
			" is true when ",
			createVNode(_components.code, { children: "matchesAgent(…, \"grok\")" }),
			" ",
			createVNode(_components.strong, { children: "or" }),
			"\n",
			createVNode(_components.code, { children: "~/.grok" }),
			" exists — same lazy-install pattern as Codex\n(",
			createVNode($$Cite, {
				file: "packages/integrations/codex/src/agent-adapter.ts",
				lines: "42-48"
			}),
			").\n",
			createVNode(_components.code, { children: "install" }),
			" watches ",
			createVNode(_components.code, { children: "active_sessions.json" }),
			" (and optionally the sessions root)\nwith the existing refcounted dir-watcher helper so a brand-new machine that\nnever ran Grok pays zero watcher cost."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "resume--cli-allowlist",
			children: "Resume + CLI allowlist"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Extend ",
			createVNode(_components.code, { children: "anyagent" }),
			" in the three places a resume-capable agent always touches\n(",
			createVNode($$Cite, {
				file: "packages/integrations/anyagent/src/agent-cli.ts",
				lines: "52-179"
			}),
			"):"
		] }),
		"\n",
		createVNode(_components.pre, {
			class: "astro-code github-light",
			style: {
				backgroundColor: "#fff",
				color: "#24292e",
				overflowX: "auto"
			},
			tabindex: "0",
			"data-language": "ts",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// STABLE_FLAGS"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "["
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"grok\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "new"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Set"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(["
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "  \"--model\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"-m\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ","
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#032F62" },
						children: "  \"--always-approve\""
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: ","
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#032F62" },
						children: "  \"--permission-mode\""
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: ","
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#032F62" },
						children: "  \"--agent\""
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: ","
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#032F62" },
						children: "  \"--no-plan\""
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: ","
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#032F62" },
						children: "  \"--no-subagents\""
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: ","
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#032F62" },
						children: "  \"--no-alt-screen\""
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: ","
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "  \"--reasoning-effort\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"--effort\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ","
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "])],"
					})
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// BASENAME_TO_KIND / AgentKindSchema"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "grok"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"grok\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ","
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
						children: "// AGENT_RESUME"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#6F42C1" },
						children: "grok"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: ": {"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  last"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"-c\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ","
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  byId"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "id"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ") "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " `--resume ${"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "id"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "}`"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ","
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  idPattern"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "UUID_RE"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// same shell-safe UUID gate as claude/codex"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "},"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "-p" }),
			" / ",
			createVNode(_components.code, { children: "--single" }),
			" (headless one-shot) is an ",
			createVNode(_components.strong, { children: "exit-immediately" }),
			" style\ninvocation for our purposes only when the process ends — do ",
			createVNode(_components.strong, { children: "not" }),
			" special-case\nit in ",
			createVNode(_components.code, { children: "parseAgentCommand" }),
			"; if someone runs it interactively it still\nnormalizes. Prompt positionals are already stripped by the existing\npositional-drop rule."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "client-surface",
			children: "Client surface"
		}),
		"\n",
		createVNode(_components.p, { children: "Minimal, exhaustive:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "GrokIcon" }),
				" in ",
				createVNode(_components.code, { children: "packages/client/src/ui/Icons.tsx" }),
				" (simple monochrome mark that\nreads at 12–16px — no wordmark)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "agentIcons" }),
				" / ",
				createVNode(_components.code, { children: "agentNames" }),
				" grow a ",
				createVNode(_components.code, { children: "\"grok\"" }),
				" arm in\n",
				createVNode($$Cite, {
					file: "packages/client/src/ui/agentDisplay.ts",
					lines: "9-22"
				}),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "agentShortName" }),
				" already returns ",
				createVNode(_components.code, { children: "kind" }),
				" as-is for non-",
				createVNode(_components.code, { children: "claude-code" }),
				"\n(",
				createVNode($$Cite, {
					file: "packages/terminal-workspace/src/agentProjection.ts",
					lines: "57-60"
				}),
				")\n— no change."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Dock / fleet paint folds over ",
				createVNode(_components.code, { children: "AgentInfo[\"state\"]" }),
				" only — a new ",
				createVNode(_components.strong, { children: "kind" }),
				" does\nnot touch ",
				createVNode(_components.code, { children: "agentProjection" }),
				" state switches. Exhaustive ",
				createVNode(_components.code, { children: "match" }),
				" sites over\n",
				createVNode(_components.code, { children: "agent.kind" }),
				" (transcript export, any icon tables) gain one arm; TypeScript\nflags them."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "transcript-export",
			children: "Transcript export"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "loadGrokTranscript" }),
			" maps ",
			createVNode(_components.code, { children: "chat_history.jsonl" }),
			" → the shared ",
			createVNode(_components.code, { children: "Transcript" }),
			" IR\n(",
			createVNode(_components.code, { children: "user" }),
			" / ",
			createVNode(_components.code, { children: "reasoning" }),
			" / ",
			createVNode(_components.code, { children: "assistant" }),
			" / ",
			createVNode(_components.code, { children: "tool_call" }),
			" / ",
			createVNode(_components.code, { children: "tool_result" }),
			"). System\nprompts and ",
			createVNode(_components.code, { children: "synthetic_reason" }),
			" rows are dropped. User rows unwrap Grok’s\n",
			createVNode(_components.code, { children: "<user_query>…</user_query>" }),
			" harness (and drop sibling ",
			createVNode(_components.code, { children: "<image_files>" }),
			" /\ncompression-notice blocks) so the export shows the human prompt, not the wire\nenvelope. Tool basenames (",
			createVNode(_components.code, { children: "run_terminal_command" }),
			", ",
			createVNode(_components.code, { children: "read_file" }),
			",\n",
			createVNode(_components.code, { children: "search_replace" }),
			", …) normalize into the typed ",
			createVNode(_components.code, { children: "ToolInput" }),
			" union.\n",
			createVNode(_components.code, { children: "padi/src/transcript.ts" }),
			" dispatches ",
			createVNode(_components.code, { children: "kind: \"grok\"" }),
			" to this loader;\n",
			createVNode(_components.code, { children: "transcript-core" }),
			"’s ",
			createVNode(_components.code, { children: "AGENT_KINDS" }),
			" includes ",
			createVNode(_components.code, { children: "\"grok\"" }),
			"."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "tests",
			children: "Tests"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Mirror the codex/opencode pattern — ",
			createVNode(_components.strong, { children: "fixture writer, not a live Grok binary" }),
			"\nin CI:"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Unit" }),
				" (",
				createVNode(_components.code, { children: "packages/integrations/grok/" }),
				"): encode-cwd, resolve from a\nsynthetic ",
				createVNode(_components.code, { children: "active_sessions.json" }),
				" + session tree, state fold over a\nscripted ",
				createVNode(_components.code, { children: "events.jsonl" }),
				" (thinking → tool_use → waiting; permission →\nawaiting_user), ",
				createVNode(_components.code, { children: "agentInfoEqual" }),
				" stability."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "anyagent unit" }),
				": ",
				createVNode(_components.code, { children: "parseAgentCommand(\"grok -m grok-4.5 …\")" }),
				",\n",
				createVNode(_components.code, { children: "resumeAgentCommand" }),
				" for ",
				createVNode(_components.code, { children: "-c" }),
				" and ",
				createVNode(_components.code, { children: "--resume <uuid>" }),
				", refuse malformed id."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "e2e" }),
				" ",
				createVNode(_components.code, { children: "grok.feature" }),
				": fake agent process named ",
				createVNode(_components.code, { children: "grok" }),
				" + write fixture\nunder a temp ",
				createVNode(_components.code, { children: "HOME" }),
				"/",
				createVNode(_components.code, { children: "KOLU_GROK_DIR" }),
				" override if the adapter honors an env for\ntests (preferred) ",
				createVNode(_components.strong, { children: "or" }),
				" points at a tmpdir via the same test seam codex\nuses. Assert tile chrome ",
				createVNode(_components.code, { children: "kind=grok" }),
				" and state transitions after\nfixture rewrites."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Pin ",
			createVNode(_components.code, { children: "KOLU_GROK_DIR" }),
			" (or reuse ",
			createVNode(_components.code, { children: "HOME" }),
			" with only ",
			createVNode(_components.code, { children: "~/.grok" }),
			" populated) so tests never\nscan the developer’s real sessions — same isolation rule Claude tests already\nfollow for ",
			createVNode(_components.code, { children: "~/.claude" }),
			"."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "one-pr-done-criterion",
			children: "One PR, done criterion"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A single conventional-commit PR (",
			createVNode(_components.code, { children: "feat: detect Grok CLI sessions" }),
			") that:"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"Adds ",
				createVNode(_components.code, { children: "packages/integrations/grok" }),
				" (",
				createVNode(_components.code, { children: "kolu-grok" }),
				") with ",
				createVNode(_components.code, { children: "grokAdapter" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Extends ",
				createVNode(_components.code, { children: "AgentKindSchema" }),
				" + resume/allowlist tables."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Registers the adapter in ",
				createVNode(_components.code, { children: "startSensors" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: "Adds client icon + display tables." }),
			"\n",
			createVNode(_components.li, { children: [
				"Passes unit + a ",
				createVNode(_components.code, { children: "grok.feature" }),
				" e2e path that proves ",
				createVNode(_components.strong, { children: "the adapter path" }),
				"\n(fixture → ",
				createVNode(_components.code, { children: "resolveSession" }),
				" → watcher → tile ",
				createVNode(_components.code, { children: "kind" }),
				"/",
				createVNode(_components.code, { children: "state" }),
				"), not merely\n“palette remembers the string ",
				createVNode(_components.code, { children: "grok" }),
				"”."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Out of scope (explicit):" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: "Headless / ACP bot integration." }),
			"\n",
			createVNode(_components.li, { children: "Screen-scrape promotion (no evidence Grok buffers prompts off-disk the way\nClaude’s AskUserQuestion does)." }),
			"\n",
			createVNode(_components.li, { children: "Token % / plan checklist chrome." }),
			"\n",
			createVNode(_components.li, { children: "README marketing line (“claude, codex, opencode”) updates — do them in the\nsame PR only where a table already enumerates the three; no README rewrite\nfor its own sake." }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "risks",
			children: "Risks"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Risk" }),
					"\n",
					createVNode(_components.th, { children: "Mitigation" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Grok renames phases / moves home dir" }),
					"\n",
					createVNode(_components.td, { children: [
						"Zod-parse events with unknown-phase → ",
						createVNode(_components.code, { children: "thinking" }),
						"; config constant for home (",
						createVNode(_components.code, { children: "path.join(os.homedir(), \".grok\")" }),
						") + ",
						createVNode(_components.code, { children: "KOLU_GROK_DIR" }),
						" override for tests; schema tripwire test listing known phases"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "permission_prompt" }),
						" flickers under ",
						createVNode(_components.code, { children: "--always-approve" }),
						" / yolo"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Fold only the ",
						createVNode(_components.em, { children: "latest" }),
						" phase after debounce (~50–100 ms, same family as other watchers); yolo resolves permissions in the same event batch so a single read of the file tail lands on ",
						createVNode(_components.code, { children: "tool_execution" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Multiple sessions per cwd" }),
					"\n",
					createVNode(_components.td, { children: [
						"Prefer ",
						createVNode(_components.code, { children: "active_sessions" }),
						" pid match; cwd fallback takes max ",
						createVNode(_components.code, { children: "updated_at" }),
						" / mtime — document as “foreground Grok for this cwd”"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Binary named something other than ",
						createVNode(_components.code, { children: "grok" }),
						" on some installs"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Match basename ",
						createVNode(_components.code, { children: "grok" }),
						" only (verified install + help text). Do not also match ",
						createVNode(_components.code, { children: "grok-build" }),
						" unless a real process basename shows up in the wild"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Closed-union exhaustiveness across client/padi" }),
					"\n",
					createVNode(_components.td, { children: [
						"Ship the kind arm + fix every ",
						createVNode(_components.code, { children: "satisfies never" }),
						" / ",
						createVNode(_components.code, { children: ".exhaustive()" }),
						" break in the same PR; CI typecheck is the gate"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "implementation-sketch",
			children: "Implementation sketch"
		}),
		"\n",
		createVNode(_components.pre, {
			class: "astro-code github-light",
			style: {
				backgroundColor: "#fff",
				color: "#24292e",
				overflowX: "auto"
			},
			tabindex: "0",
			"data-language": "plaintext",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "packages/integrations/grok/" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  package.json                 # name: kolu-grok, exports . + ./schemas" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  src/" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    config.ts                  # KOLU_GROK_DIR override, GROK_DIR, paths" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    schemas.ts                 # GrokInfoSchema (browser-safe)" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    core.ts                    # encodeCwd, readActiveSessions, findSession, foldState" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    session-watcher.ts         # fs.watch events.jsonl + summary.json" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    agent-adapter.ts           # grokAdapter" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    index.ts                   # barrel" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "    *.test.ts" })
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: "Wire order for the implementer (so typecheck stays green):" }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.code, { children: "schemas.ts" }), " + unit tests for the fold (pure)."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.code, { children: "anyagent" }), " kind/resume/flags (compile breaks surface every switch)."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "core" }),
				" + ",
				createVNode(_components.code, { children: "session-watcher" }),
				" + ",
				createVNode(_components.code, { children: "agent-adapter" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.code, { children: "terminal-workspace" }), " schema union + sensors register."] }),
			"\n",
			createVNode(_components.li, { children: "client icon/tables." }),
			"\n",
			createVNode(_components.li, { children: "e2e fixture + feature." }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.code, { children: "just fmt" }), " + targeted unit/e2e."] }),
			"\n"
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Grok CLI as a fourth agent",
	"description": "Plan for first-class Grok Build (binary `grok`) support — a sibling AgentAdapter that detects sessions under ~/.grok, surfaces state on the dock/tile, and joins claude · codex · opencode in the closed agent union.",
	"parents": ["feature"],
	"status": "implemented",
	"maturity": "budding",
	"updated": "2026-07-09T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "shape",
			"text": "Shape"
		},
		{
			"depth": 2,
			"slug": "on-disk-facts-verified",
			"text": "On-disk facts (verified)"
		},
		{
			"depth": 2,
			"slug": "state-fold",
			"text": "State fold"
		},
		{
			"depth": 2,
			"slug": "session-match",
			"text": "Session match"
		},
		{
			"depth": 2,
			"slug": "resume--cli-allowlist",
			"text": "Resume + CLI allowlist"
		},
		{
			"depth": 2,
			"slug": "client-surface",
			"text": "Client surface"
		},
		{
			"depth": 2,
			"slug": "transcript-export",
			"text": "Transcript export"
		},
		{
			"depth": 2,
			"slug": "tests",
			"text": "Tests"
		},
		{
			"depth": 2,
			"slug": "one-pr-done-criterion",
			"text": "One PR, done criterion"
		},
		{
			"depth": 2,
			"slug": "risks",
			"text": "Risks"
		},
		{
			"depth": 2,
			"slug": "implementation-sketch",
			"text": "Implementation sketch"
		}
	];
}
var url = "src/content/atlas/grok-cli-support.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/grok-cli-support.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/grok-cli-support.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
