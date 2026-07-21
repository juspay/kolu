import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import "./Callout_9cdgbDOy.mjs";
import { t as $$Phase } from "./Phase_Ctvqq2QS.mjs";
import { t as $$PhaseTree } from "./PhaseTree_DI8OxotU.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
import "./Footnote_D9yrIxmz.mjs";
//#region src/diagrams/chat-native-agents-loop.svg?raw
var chat_native_agents_loop_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 820 400\" font-family=\"ui-sans-serif, system-ui, sans-serif\" role=\"img\" aria-label=\"Architecture: Xyne Spaces talks HTTPS to pesu. pesu dials padi over a unix socket. padi owns kaval PTYs and loaders that read agent session files. Agent assistant events return through pesu to Xyne Spaces via postMessage. The kolu PWA is off the critical path and only used via deep link.\">\n  <defs>\n    <marker id=\"arr\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0L10 5L0 10z\" fill=\"#475569\"/>\n    </marker>\n    <marker id=\"arrd\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0L10 5L0 10z\" fill=\"#94a3b8\"/>\n    </marker>\n    <style>\n      .t   { fill:#0f172a; font-size:14px; font-weight:700; }\n      .s   { fill:#64748b; font-size:11px; }\n      .box { stroke-width:2; }\n      .xs  { fill:#FBF1DC; stroke:#B45309; }\n      .pe  { fill:#F3E8FF; stroke:#6D28D9; }\n      .pa  { fill:#EDF0FD; stroke:#0D32B2; }\n      .kv  { fill:#E0E7FF; stroke:#3730A3; }\n      .ag  { fill:#ECFDF5; stroke:#047857; }\n      .pw  { fill:#F8FAFC; stroke:#94a3b8; stroke-dasharray:4 3; }\n      .h   { font-size:12.5px; font-weight:700; }\n      .hx  { fill:#92400E; }\n      .hp  { fill:#5B21B6; }\n      .hb  { fill:#0D32B2; }\n      .hk  { fill:#312E81; }\n      .ha  { fill:#065F46; }\n      .hw  { fill:#64748b; }\n      .d   { fill:#475569; font-size:10px; }\n      .edge { stroke:#475569; stroke-width:1.6; fill:none; }\n      .dash { stroke:#94a3b8; stroke-width:1.4; fill:none; stroke-dasharray:5 3; }\n      .el  { fill:#334155; font-size:10px; font-weight:600; }\n      .eld { fill:#64748b; font-size:9.5px; font-style:italic; }\n      .mono { font-family:ui-monospace, Menlo, monospace; font-size:9.5px; fill:#475569; }\n    </style>\n  </defs>\n\n  <text class=\"t\" x=\"20\" y=\"24\">component wire — messages only, one thread per terminal</text>\n  <text class=\"s\" x=\"20\" y=\"42\">pesu is a padi client (like padi-tui / kolu mcp), not a path through kolu-server</text>\n\n  <!-- Xyne Spaces -->\n  <rect class=\"box xs\" x=\"20\" y=\"70\" width=\"160\" height=\"180\" rx=\"10\"/>\n  <text class=\"h hx\" x=\"100\" y=\"96\" text-anchor=\"middle\">Xyne Spaces</text>\n  <text class=\"mono\" x=\"100\" y=\"118\" text-anchor=\"middle\">apps platform</text>\n  <text class=\"d\" x=\"100\" y=\"148\" text-anchor=\"middle\">threads · identity</text>\n  <text class=\"d\" x=\"100\" y=\"168\" text-anchor=\"middle\">webhook out</text>\n  <text class=\"d\" x=\"100\" y=\"188\" text-anchor=\"middle\">postMessage in</text>\n  <text class=\"d\" x=\"100\" y=\"218\" text-anchor=\"middle\">@mention / DM</text>\n\n  <!-- pesu -->\n  <rect class=\"box pe\" x=\"240\" y=\"70\" width=\"170\" height=\"180\" rx=\"10\"/>\n  <text class=\"h hp\" x=\"325\" y=\"96\" text-anchor=\"middle\">pesu</text>\n  <text class=\"mono\" x=\"325\" y=\"118\" text-anchor=\"middle\">packages/pesu</text>\n  <text class=\"d\" x=\"325\" y=\"148\" text-anchor=\"middle\">HMAC webhook</text>\n  <text class=\"d\" x=\"325\" y=\"168\" text-anchor=\"middle\">binds: thread→term</text>\n  <text class=\"d\" x=\"325\" y=\"188\" text-anchor=\"middle\">author gate</text>\n  <text class=\"d\" x=\"325\" y=\"208\" text-anchor=\"middle\">assistant filter</text>\n  <text class=\"d\" x=\"325\" y=\"228\" text-anchor=\"middle\">XS API + padi dial</text>\n\n  <!-- host cluster -->\n  <rect class=\"box pa\" x=\"480\" y=\"58\" width=\"320\" height=\"250\" rx=\"12\"/>\n  <text class=\"h hb\" x=\"640\" y=\"80\" text-anchor=\"middle\">host — padi surface</text>\n\n  <rect class=\"box pa\" x=\"500\" y=\"96\" width=\"130\" height=\"88\" rx=\"8\"/>\n  <text class=\"h hb\" x=\"565\" y=\"122\" text-anchor=\"middle\">padi</text>\n  <text class=\"mono\" x=\"565\" y=\"144\" text-anchor=\"middle\">lifecycle.*</text>\n  <text class=\"mono\" x=\"565\" y=\"162\" text-anchor=\"middle\">loaders</text>\n\n  <rect class=\"box kv\" x=\"650\" y=\"96\" width=\"130\" height=\"88\" rx=\"8\"/>\n  <text class=\"h hk\" x=\"715\" y=\"122\" text-anchor=\"middle\">kaval</text>\n  <text class=\"mono\" x=\"715\" y=\"144\" text-anchor=\"middle\">PTY</text>\n  <text class=\"mono\" x=\"715\" y=\"162\" text-anchor=\"middle\">serialize write</text>\n\n  <rect class=\"box ag\" x=\"500\" y=\"204\" width=\"280\" height=\"84\" rx=\"8\"/>\n  <text class=\"h ha\" x=\"640\" y=\"232\" text-anchor=\"middle\">agent + session files</text>\n  <text class=\"mono\" x=\"640\" y=\"254\" text-anchor=\"middle\">claude · codex · opencode · grok</text>\n  <text class=\"d\" x=\"640\" y=\"274\" text-anchor=\"middle\">JSONL / SQLite on disk</text>\n\n  <!-- PWA off path -->\n  <rect class=\"box pw\" x=\"20\" y=\"300\" width=\"160\" height=\"64\" rx=\"10\"/>\n  <text class=\"h hw\" x=\"100\" y=\"326\" text-anchor=\"middle\">kolu PWA</text>\n  <text class=\"d\" x=\"100\" y=\"348\" text-anchor=\"middle\">depth via deep link only</text>\n\n  <!-- XS <-> pesu -->\n  <path class=\"edge\" d=\"M190 120 L230 120\" marker-end=\"url(#arr)\"/>\n  <text class=\"el\" x=\"210\" y=\"110\" text-anchor=\"middle\">webhook</text>\n  <path class=\"edge\" d=\"M230 190 L190 190\" marker-end=\"url(#arr)\"/>\n  <text class=\"el\" x=\"210\" y=\"210\" text-anchor=\"middle\">postMessage</text>\n\n  <!-- pesu -> padi -->\n  <path class=\"edge\" d=\"M420 130 L490 130\" marker-end=\"url(#arr)\"/>\n  <text class=\"el\" x=\"455\" y=\"118\" text-anchor=\"middle\">create</text>\n  <text class=\"el\" x=\"455\" y=\"146\" text-anchor=\"middle\">sendInput</text>\n\n  <!-- padi -> kaval -->\n  <path class=\"edge\" d=\"M630 140 L650 140\" marker-end=\"url(#arr)\"/>\n\n  <!-- kaval down to agent -->\n  <path class=\"edge\" d=\"M715 184 L715 204\" marker-end=\"url(#arr)\"/>\n\n  <!-- transcript return dashed -->\n  <path class=\"dash\" d=\"M500 246 L430 246 L430 200 L420 200\" marker-end=\"url(#arrd)\"/>\n  <text class=\"eld\" x=\"458\" y=\"238\" text-anchor=\"middle\">streams.transcriptChat</text>\n  <text class=\"eld\" x=\"458\" y=\"252\" text-anchor=\"middle\">snapshot → deltas</text>\n\n  <!-- deep link -->\n  <path class=\"dash\" d=\"M100 260 L100 290\" marker-end=\"url(#arrd)\"/>\n  <text class=\"eld\" x=\"118\" y=\"280\">deep link</text>\n\n  <text class=\"s\" x=\"410\" y=\"385\" text-anchor=\"middle\">threadId maps only inside pesu · agent never sees XS</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/chat-native-agents-and-kolu.mdx
var PT = [
	{
		d: 0,
		g: "▶",
		c: "prog",
		l: "CT1 · streams.transcriptChat (padi)",
		m: "surface stream · no XS",
		h: "#ct1"
	},
	{
		d: 0,
		g: "○",
		c: "last",
		l: "CH1 · Conversation section in Inspector",
		m: "needs CT1 · real right-panel chrome",
		h: "#ch1"
	},
	{
		d: 0,
		g: "○",
		c: "last",
		l: "PE0 · pesu inbound — create + type",
		m: "needs CH1 proven · XS",
		h: "#pe0"
	},
	{
		d: 0,
		g: "○",
		c: "last",
		l: "PE1 · pesu outbound — stream → postMessage",
		m: "needs CT1 + PE0",
		h: "#pe1"
	},
	{
		d: 0,
		g: "○",
		c: "last",
		l: "PE2 · deep link + turn UX",
		m: "needs PE0",
		h: "#pe2"
	}
];
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		div: "div",
		em: "em",
		h2: "h2",
		h3: "h3",
		h4: "h4",
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
	const { KoluShellMockup } = _components;
	if (!KoluShellMockup) _missingMdxReference("KoluShellMockup", true);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "One conversation ↔ one kolu terminal." }),
			" User text → terminal input; agent\n",
			createVNode(_components.strong, { children: "messages" }),
			" (not tools/edits) → conversation. The chat surface can be the\n",
			createVNode(_components.strong, { children: "kolu UI" }),
			" first, then ",
			createVNode(_components.strong, { children: "Xyne Spaces via pesu" }),
			" — same pipe, different face."
		] }),
		"\n",
		createVNode(_components.p, { children: "pesu is the XS bridge only; config is env/systemd next to pesu, not the web app." }),
		"\n",
		createVNode(_components.h2, {
			id: "components",
			children: "Components"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Three processes on the chat side of the wall; four on the machine side. The\nbrowser PWA is ",
			createVNode(_components.strong, { children: "not" }),
			" on the critical path — same class of client as\n",
			createVNode(_components.code, { children: "padi-tui" }),
			" / ",
			createVNode(_components.code, { children: "kolu mcp" }),
			"."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Component" }),
					"\n",
					createVNode(_components.th, { children: "Process" }),
					"\n",
					createVNode(_components.th, { children: "Job in this design" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "Xyne Spaces" }) }),
					"\n",
					createVNode(_components.td, { children: "XS cloud" }),
					"\n",
					createVNode(_components.td, { children: "Threads, identity, @mention/DM delivery, message store" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "XS apps platform" }) }),
					"\n",
					createVNode(_components.td, { children: "part of XS" }),
					"\n",
					createVNode(_components.td, { children: [
						"Signed ",
						createVNode(_components.strong, { children: "webhook" }),
						" out; ",
						createVNode(_components.strong, { children: "app API" }),
						" in (",
						createVNode(_components.code, { children: "postMessage" }),
						", ",
						createVNode(_components.code, { children: "updateMessage" }),
						", ",
						createVNode(_components.code, { children: "user/info" }),
						")"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "pesu" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"new daemon beside kolu (",
						createVNode(_components.code, { children: "packages/pesu" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: "HTTP webhook receiver + bind store + padi client + XS API client" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "padi" }) }),
					"\n",
					createVNode(_components.td, { children: "workspace daemon" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "padiSurface" }),
						": ",
						createVNode(_components.code, { children: "lifecycle.*" }),
						", loaders, ",
						createVNode(_components.strong, { children: "new chat transcript stream" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "kaval" }) }),
					"\n",
					createVNode(_components.td, { children: "PTY daemon under padi" }),
					"\n",
					createVNode(_components.td, { children: "Owns the live PTY; serializes writes" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "agent CLI" }) }),
					"\n",
					createVNode(_components.td, { children: "child in the PTY" }),
					"\n",
					createVNode(_components.td, { children: "claude / codex / opencode / grok — writes its own session files" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "transcript loaders" }) }),
					"\n",
					createVNode(_components.td, { children: "in-process in padi today" }),
					"\n",
					createVNode(_components.td, { children: [
						"Vendor file → ",
						createVNode(_components.code, { children: "transcript-core" }),
						" IR (",
						createVNode(_components.code, { children: "user" }),
						" · ",
						createVNode(_components.code, { children: "assistant" }),
						" · ",
						createVNode(_components.code, { children: "tool_*" }),
						" · …)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "kolu PWA" }) }),
					"\n",
					createVNode(_components.td, { children: "browser" }),
					"\n",
					createVNode(_components.td, { children: "Tile = PTY; CH1 = Conversation in Inspector; deep link" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
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
					children: createVNode(_components.span, { children: "Xyne Spaces ──HTTPS──► pesu ──unix socket──► padi ──unix socket──► kaval ──PTY──► agent" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "     ▲                   │                      │" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "     │                   │                      └── loaders ← session files on disk" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "     └──── HTTPS API ────┘                      └── streams.transcriptChat → chat frames" })
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"pesu dials padi with the same kit as other non-browser faces\n(",
			createVNode(_components.code, { children: "@kolu/padi/dial" }),
			" → digest-keyed socket, control-core handshake, contract\nskew fail-fast). It does ",
			createVNode(_components.strong, { children: "not" }),
			" go through kolu-server."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: chat_native_agents_loop_default,
			caption: "Process boundaries. Solid arrows: create + sendInput + postMessage. Dashed: chat transcript stream (CT1) from loaders through pesu."
		}),
		"\n",
		createVNode(_components.h2, {
			id: "surface-primitives-why-ct1-is-a-stream",
			children: "Surface primitives (why CT1 is a stream)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "padiSurface" }),
			" is declared with the five ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" member kinds. The live\nconversation path has to pick one deliberately — a one-shot is not a stream."
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
					createVNode(_components.th, { children: "Shape" }),
					"\n",
					createVNode(_components.th, { children: "Fit for chat log?" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: createVNode(_components.code, { children: "streams" }) }) }),
					"\n",
					createVNode(_components.td, { children: [
						"input → async iterator; ",
						createVNode(_components.strong, { children: "snapshot-then-deltas" }),
						" (or full replace each frame); reconnect re-subscribes via ",
						createVNode(_components.code, { children: "STREAM_RETRY" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Yes — CT1." }),
						" Per-terminal ",
						createVNode(_components.code, { children: "{ id }" }),
						", first frame = chat-filtered snapshot, later = new/growing messages"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: createVNode(_components.code, { children: "procedures" }) }) }),
					"\n",
					createVNode(_components.td, { children: "request → one response" }),
					"\n",
					createVNode(_components.td, { children: [
						"One-shot only. Today’s ",
						createVNode(_components.code, { children: "transcript.exportHtml" }),
						". Fine for export/dump; live only if a consumer polls+diffs — not the product path"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: createVNode(_components.code, { children: "events" }) }) }),
					"\n",
					createVNode(_components.td, { children: "discrete fires" }),
					"\n",
					createVNode(_components.td, { children: "No backlog on subscribe — wrong for conversation history" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: createVNode(_components.code, { children: "cells" }) }) }),
					"\n",
					createVNode(_components.td, { children: "standing single value" }),
					"\n",
					createVNode(_components.td, { children: "Not per-terminal append-heavy log" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: createVNode(_components.code, { children: "collections" }) }) }),
					"\n",
					createVNode(_components.td, { children: "keyed set + deltas" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "terminals" }), " is already the entity set; the message list is not a second keyspace"] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Client consume:" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"Kolu UI (CH1): ",
				createVNode(_components.code, { children: "client.streams.transcriptChat.use(() => ({ id: focusedTerminal() }))" }),
				" — enrolled in surface health by default."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"pesu (PE1): same stream over the dialed client (async iterator + stream-retry context). Unenrolled only if a single terminal’s re-sub must not flicker a global health fact (same carve-out class as ",
				createVNode(_components.code, { children: "terminalAttach" }),
				")."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Re-serve forwarding:" }),
			" ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "delta" }) }),
			" (fail-through) — same class as ",
			createVNode(_components.code, { children: "activity" }),
			" / ",
			createVNode(_components.code, { children: "terminalAttach" }),
			". A mid-chain disconnect must terminate the downstream stream so a snapshot is only ever the first frame of a ",
			createVNode(_components.em, { children: "fresh" }),
			" stream, never spliced into a half-open one."
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Rejected alternatives (recorded):" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: "Procedure-first CT1 + poll — works as a stopgap, lies about the product (we want live)." }),
			"\n",
			createVNode(_components.li, { children: "Cell of “last assistant text” — loses history and multi-bubble turns." }),
			"\n",
			createVNode(_components.li, { children: "Event of “assistant said X” — reconnect drops everything already spoken." }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "bind-state-pesu-local",
			children: "Bind state (pesu-local)"
		}),
		"\n",
		createVNode(_components.p, { children: "pesu holds the only new durable fact:" }),
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
			children: createVNode(_components.code, { children: createVNode(_components.span, {
				class: "line",
				children: createVNode(_components.span, { children: "threadId  →  { terminalId, authorUserId, hostKey? }" })
			}) })
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Create on miss" }),
				" — first webhook for an unbound thread runs\n",
				createVNode(_components.code, { children: "lifecycle.create" }),
				" (+ agent launch), then stores the row."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Author gate" }),
				" — later webhooks must match ",
				createVNode(_components.code, { children: "authorUserId" }),
				" (v1: one\nallowlisted operator). Mismatch → visible decline via ",
				createVNode(_components.code, { children: "postMessage" }),
				", never\nsilence, never ",
				createVNode(_components.code, { children: "sendInput" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: "Not in kolu’s conf store; not in XS. Survives pesu restart if persisted\nnext to pesu (file/env scope TBD; start with on-disk JSON beside the daemon)." }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "interaction-first-message",
			children: "Interaction: first message"
		}),
		"\n",
		createVNode(_components.p, { children: "End-to-end create + first prompt." }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Step" }),
					"\n",
					createVNode(_components.th, { children: "From → to" }),
					"\n",
					createVNode(_components.th, { children: "What moves" }),
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
					createVNode(_components.td, { children: "User → XS" }),
					"\n",
					createVNode(_components.td, { children: [
						"DM or ",
						createVNode(_components.code, { children: "@bot" }),
						" text in a channel"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "2" }),
					"\n",
					createVNode(_components.td, { children: "XS → pesu" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "POST" }),
						" webhook: ",
						createVNode(_components.code, { children: "APP_MENTIONED" }),
						" or ",
						createVNode(_components.code, { children: "DIRECT_MESSAGE" }),
						". Payload: ",
						createVNode(_components.code, { children: "conversationId" }),
						", ",
						createVNode(_components.code, { children: "userId" }),
						", ",
						createVNode(_components.code, { children: "cleanContent" }),
						", ",
						createVNode(_components.code, { children: "messageId" }),
						". Header: ",
						createVNode(_components.code, { children: "X-Xyne-Signature" }),
						" (HMAC of raw body)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "3" }),
					"\n",
					createVNode(_components.td, { children: "pesu" }),
					"\n",
					createVNode(_components.td, { children: [
						"Verify HMAC (constant-time) → ",
						createVNode(_components.strong, { children: "200 immediately" }),
						" → work async (XS does not retry)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "4" }),
					"\n",
					createVNode(_components.td, { children: "pesu → XS" }),
					"\n",
					createVNode(_components.td, { children: [
						"optional ",
						createVNode(_components.code, { children: "user/info" }),
						" to resolve display name; cache"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "5" }),
					"\n",
					createVNode(_components.td, { children: "pesu → padi" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "lifecycle.create({ cwd? })" }),
						" → ",
						createVNode(_components.code, { children: "{ id: terminalId }" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "6" }),
					"\n",
					createVNode(_components.td, { children: "padi → kaval" }),
					"\n",
					createVNode(_components.td, { children: "spawn PTY (shell)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "7" }),
					"\n",
					createVNode(_components.td, { children: "pesu → padi" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "lifecycle.sendInput({ id, data: \"<agent argv>\\\\r\" })" }),
						" — same initial-command path as ",
						createVNode(_components.code, { children: "padi-tui create -- claude …" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "8" }),
					"\n",
					createVNode(_components.td, { children: "pesu → padi" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "lifecycle.sendInput({ id, data: \"<user text>\\\\r\" })" }), " — first agent prompt"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "9" }),
					"\n",
					createVNode(_components.td, { children: "pesu" }),
					"\n",
					createVNode(_components.td, { children: ["persist bind ", createVNode(_components.code, { children: "conversationId → { terminalId, authorUserId }" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "10" }),
					"\n",
					createVNode(_components.td, { children: "pesu → XS" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "postMessage" }),
						" into ",
						createVNode(_components.code, { children: "conversationId" }),
						": ack + deep link to open that terminal in kolu"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "Agent is unaware of chat. It only sees PTY input." }),
		"\n",
		createVNode(_components.h2, {
			id: "interaction-later-user-messages",
			children: "Interaction: later user messages"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Step" }),
					"\n",
					createVNode(_components.th, { children: "From → to" }),
					"\n",
					createVNode(_components.th, { children: "What moves" }),
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
					createVNode(_components.td, { children: "XS → pesu" }),
					"\n",
					createVNode(_components.td, { children: "same webhook shape" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "2" }),
					"\n",
					createVNode(_components.td, { children: "pesu" }),
					"\n",
					createVNode(_components.td, { children: [
						"lookup bind by ",
						createVNode(_components.code, { children: "conversationId" }),
						"; reject if author ≠ stored"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "3" }),
					"\n",
					createVNode(_components.td, { children: "pesu → padi" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "lifecycle.sendInput({ id: terminalId, data: \"<text>\\\\r\" })" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "4" }),
					"\n",
					createVNode(_components.td, { children: "kaval" }),
					"\n",
					createVNode(_components.td, { children: "write bytes into that PTY (last-writer-wins at kaval)" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "No second terminal. No coordinator hop. Thread is the mailbox for one PTY." }),
		"\n",
		createVNode(_components.h2, {
			id: "interaction-agent--conversation-transcript-stream",
			children: "Interaction: agent → conversation (transcript stream)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Return half — ",
			createVNode(_components.strong, { children: "CT1 is the wire for this." }),
			" Today: loaders + ",
			createVNode(_components.code, { children: "transcript.exportHtml" }),
			"\n(procedure). Missing: a live surface stream of chat-filtered events."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Step" }),
					"\n",
					createVNode(_components.th, { children: "Component" }),
					"\n",
					createVNode(_components.th, { children: "What" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "A" }),
					"\n",
					createVNode(_components.td, { children: "agent CLI" }),
					"\n",
					createVNode(_components.td, { children: "appends to vendor session store (Claude JSONL, Codex/OpenCode SQLite, …)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "B" }),
					"\n",
					createVNode(_components.td, { children: "padi" }),
					"\n",
					createVNode(_components.td, { children: [
						"loaders → IR; filter to chat (",
						createVNode(_components.code, { children: "user" }),
						" / ",
						createVNode(_components.code, { children: "assistant" }),
						" — same cut as HTML chat-log mode)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "C" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: createVNode(_components.code, { children: "streams.transcriptChat" }) }) }),
					"\n",
					createVNode(_components.td, { children: [
						"input ",
						createVNode(_components.code, { children: "{ id }" }),
						"; first yield = full chat snapshot; later = deltas (new messages or growing assistant text)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "D" }),
					"\n",
					createVNode(_components.td, { children: "CH1 / PE1" }),
					"\n",
					createVNode(_components.td, { children: [
						"UI paints bubbles; pesu ",
						createVNode(_components.code, { children: "postMessage" }),
						" / ",
						createVNode(_components.code, { children: "updateMessage" }),
						" into the XS thread"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "Reconnect: client re-subscribes → fresh snapshot replaces stale state (surface\nstream invariant). No poll loop as the design." }),
		"\n",
		createVNode(_components.h2, {
			id: "what-each-api-is-and-is-not",
			children: "What each API is (and is not)"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "xyne-spaces--pesu-webhook",
			children: "Xyne Spaces → pesu (webhook)"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Event" }),
					"\n",
					createVNode(_components.th, { children: "When" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "APP_MENTIONED" }) }),
					"\n",
					createVNode(_components.td, { children: "explicit @bot in a channel" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "DIRECT_MESSAGE" }) }),
					"\n",
					createVNode(_components.td, { children: "every message in the bot DM" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Plain channel messages without @ are ",
			createVNode(_components.strong, { children: "not" }),
			" delivered to installed apps.\npesu answers 200 first; failures after that are pesu’s problem (post a visible\nerror into the thread)."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "pesu--xyne-spaces-app-api-bearer-jwt",
			children: "pesu → Xyne Spaces (app API, bearer JWT)"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Call" }),
					"\n",
					createVNode(_components.th, { children: "Use" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "POST …/chat/postMessage" }) }),
					"\n",
					createVNode(_components.td, { children: "new bot turn (or first ack)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "POST …/chat/updateMessage" }) }),
					"\n",
					createVNode(_components.td, { children: "grow one message while an assistant turn streams" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "POST …/chat/agentProgress" }) }),
					"\n",
					createVNode(_components.td, { children: "optional typing indicator during a turn" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "GET …/user/info" }) }),
					"\n",
					createVNode(_components.td, { children: "resolve sender id → name" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "pesu--kolu--padi-padisurface",
			children: [
				"pesu / kolu → padi (",
				createVNode(_components.code, { children: "padiSurface" }),
				")"
			]
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Member" }),
					"\n",
					createVNode(_components.th, { children: "Kind" }),
					"\n",
					createVNode(_components.th, { children: "Use" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "lifecycle.create" }) }),
					"\n",
					createVNode(_components.td, { children: "procedure" }),
					"\n",
					createVNode(_components.td, { children: [
						"new terminal (optional ",
						createVNode(_components.code, { children: "cwd" }),
						")"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "lifecycle.sendInput" }) }),
					"\n",
					createVNode(_components.td, { children: "procedure" }),
					"\n",
					createVNode(_components.td, { children: "agent launch line + every user message" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "transcriptChat" }) }), " (name TBD)"] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "stream" }) }),
					"\n",
					createVNode(_components.td, { children: "chat-filtered frames for one terminal — CT1" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "transcript.exportHtml" }) }),
					"\n",
					createVNode(_components.td, { children: "procedure" }),
					"\n",
					createVNode(_components.td, { children: "unchanged export path; not the live face" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"pesu does ",
			createVNode(_components.strong, { children: "not" }),
			" call kaval directly. padi owns the terminal id space and\nawareness; kaval is an implementation detail behind ",
			createVNode(_components.code, { children: "lifecycle.*" }),
			"."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "out-of-scope-for-this-wire",
			children: "Out of scope for this wire"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: "Fleet board / who-needs-me in chat" }),
			"\n",
			createVNode(_components.li, { children: "Coordinator multi-worker campaigns" }),
			"\n",
			createVNode(_components.li, { children: "Routing chat traffic through kolu-server for pesu" }),
			"\n",
			createVNode(_components.li, { children: "Bot secrets in the web UI" }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "pesu-internal-shape",
			children: "pesu internal shape"
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
					children: createVNode(_components.span, { children: "packages/pesu/" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  bin.ts          # listen + dial padi + load binds" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  webhook.ts      # HMAC verify, parse, 200, enqueue" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  xyneApi.ts      # postMessage · updateMessage · user/info" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  binds.ts        # threadId → terminalId (+ author)" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  turns.ts        # create-on-miss · author gate · sendInput" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  mirror.ts       # subscribe transcriptChat → postMessage" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "  config.ts       # XS base URL, secrets via env, agent argv, cwd, allowlist" })
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Same layering idea as ",
			createVNode(_components.code, { children: "padi-tui" }),
			": thin composition over existing padi surface\nmembers; no second terminal protocol."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "build-order--not-pesu-first",
			children: "Build order — not pesu first"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Full pesu needs XS credentials, webhooks, and a public URL. The ",
			createVNode(_components.strong, { children: "interesting\nhalf of the product" }),
			" does not: a conversation face on one terminal over the\n",
			createVNode(_components.strong, { children: "transcript stream" }),
			" + ",
			createVNode(_components.code, { children: "sendInput" }),
			". That is useful in kolu alone — and it is\nwhat ",
			createVNode(_components.code, { children: "/bridge" }),
			" does by hand via MCP (",
			createVNode(_components.code, { children: "sendInput" }),
			", wait for agent state, read\noutput), but as a real UI instead of a skill loop."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Do first" }),
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
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "CT1 + CH1" }) }),
					"\n",
					createVNode(_components.td, { children: "Ship the live message pipe as a kolu feature; no XS" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "PE0" }) }),
					"\n",
					createVNode(_components.td, { children: "Chat can create/drive a terminal from XS (half duplex still useful)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "PE1" }) }),
					"\n",
					createVNode(_components.td, { children: "Same stream, second consumer (post into XS)" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Not in this tree: multi-agent campaign board / bridge dashboard as product UI\n— that is a different note (",
			createVNode(_components.a, {
				href: "campaign-surface.html",
				children: "campaign surface"
			}),
			"). Here\nwe only productize the ",
			createVNode(_components.strong, { children: "1:1 conversation" }),
			" that pesu will also use."
		] }),
		"\n",
		"\n",
		createVNode($$PhaseTree, {
			title: "ROADMAP — conversation face, then pesu",
			phases: PT
		}),
		"\n",
		createVNode("a", { id: "ct1" }),
		"\n",
		createVNode(_components.h3, {
			id: "ct1--streamstranscriptchat",
			children: ["CT1 — ", createVNode(_components.code, { children: "streams.transcriptChat" })]
		}),
		"\n",
		createVNode($$Phase, {
			id: "CT1",
			name: "padi surface stream: chat-filtered transcript frames",
			status: "next"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Today:" }),
			" ",
			createVNode(_components.code, { children: "procedures.transcript.exportHtml" }),
			" — one-shot HTML. Loaders already\nproduce a vendor-neutral IR."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Ship:" }),
			" a new ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "streams" }) }),
			" member on ",
			createVNode(_components.code, { children: "padiSurface" }),
			" (name TBD; call it\n",
			createVNode(_components.code, { children: "transcriptChat" }),
			" here):"
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
					children: createVNode(_components.span, { children: "input:  { id: terminalId }" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "output: chat-filtered frames" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "        // prefer explicit snapshot | delta (attach-style)," })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "        // or full message list each frame (activity-style)" })
				})
			] })
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"Filter = HTML ",
				createVNode(_components.strong, { children: "chat log" }),
				" mode: ",
				createVNode(_components.code, { children: "user" }),
				" + ",
				createVNode(_components.code, { children: "assistant" }),
				" only (no tools, edits,\nreasoning dumps)."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Snapshot-then-deltas" }), " so reconnect replaces state; never deltas-only."] }),
			"\n",
			createVNode(_components.li, { children: [
				"Forwarding policy: ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "delta" }) }),
				" (fail-through)."
			] }),
			"\n",
			createVNode(_components.li, { children: "Implement by watching the same session files sensors already touch; re-run\n(or incremental) loaders; emit when chat-visible text changes." }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "exportHtml" }),
			" stays as the export procedure. A dump procedure is optional and\nis ",
			createVNode(_components.strong, { children: "not" }),
			" CT1."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Done when:" }), " a Solid consumer and a raw dial client can both subscribe to\none terminal’s chat frames live, and a reconnect delivers a coherent snapshot."] }),
		"\n",
		createVNode("a", { id: "ch1" }),
		"\n",
		createVNode(_components.h3, {
			id: "ch1--conversation-in-the-right-panel-inspector",
			children: "CH1 — conversation in the right panel (Inspector)"
		}),
		"\n",
		createVNode($$Phase, {
			id: "CH1",
			name: "live chat log in the Inspector next to Compose",
			status: "todo",
			needs: ["CT1"]
		}),
		"\n",
		createVNode(_components.h4, {
			id: "what-kolu-is-today-do-not-invent-chrome",
			children: "What kolu is today (do not invent chrome)"
		}),
		"\n",
		createVNode(_components.p, { children: "Real shell, as shipped:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Canvas tile" }),
				" = the PTY (title bar + xterm). Agent TUI, tools, raw output\nlive ",
				createVNode(_components.strong, { children: "here" }),
				" — always."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Right panel" }),
				" tabs = ",
				createVNode(_components.strong, { children: "Inspector | Code" }),
				" only\n(",
				createVNode(_components.code, { children: "RightPanelTabKind" }),
				", ",
				createVNode(_components.code, { children: "data-testid=\"right-panel-tab-*\"" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Inspector" }),
				" already has ",
				createVNode(_components.strong, { children: "Compose" }),
				" (",
				createVNode(_components.code, { children: "ComposeSection" }),
				"): mono draft box,\n",
				createVNode(_components.strong, { children: "Send →" }),
				", copy ",
				createVNode(_components.em, { children: "“Inserts into the terminal — press Enter there to submit”" }),
				".\nThen Directory / Git / Agent / Attach sections (",
				createVNode(_components.code, { children: "Section" }),
				" + uppercase labels)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"CH1 does ",
			createVNode(_components.strong, { children: "not" }),
			" put Terminal|Chat on the tile. The tile stays a terminal."
		] }),
		"\n",
		createVNode(_components.h4, {
			id: "what-you-get-prototype",
			children: "What you get (prototype)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"One new ",
			createVNode(_components.strong, { children: "Conversation" }),
			" section ",
			createVNode(_components.strong, { children: "above Compose" }),
			" in the same Inspector —\nlive chat-filtered transcript for ",
			createVNode(_components.em, { children: "this" }),
			" terminal. Compose stays the write\npath; the tile still shows the agent working with tools."
		] }),
		"\n",
		createVNode(KoluShellMockup, {}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "You do (today’s chrome)" }),
					"\n",
					createVNode(_components.th, { children: "What happens after CH1" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["Open right panel → ", createVNode(_components.strong, { children: "Inspector" })] }),
					"\n",
					createVNode(_components.td, { children: "Same tab bar as now" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["Scroll ", createVNode(_components.strong, { children: "Conversation" })] }),
					"\n",
					createVNode(_components.td, { children: "Human / AI messages from CT1 — no tool_call noise" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Compose" }),
						" + ",
						createVNode(_components.strong, { children: "Send →" }),
						" (⌘↵)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Same control as today: ",
						createVNode(_components.code, { children: "sendInput" }),
						" into the tile’s PTY"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["Watch the ", createVNode(_components.strong, { children: "tile" })] }),
					"\n",
					createVNode(_components.td, { children: "Agent TUI / tools still there when you want depth" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h4, {
			id: "open-product-call-compose",
			children: "Open product call (Compose)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Compose today ",
			createVNode(_components.strong, { children: "inserts, does not submit" }),
			" (see ",
			createVNode(_components.code, { children: "composeSend" }),
			" / docs). Chat\nusers often expect Send = full turn. Decide in CH1:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: "keep insert (honest with current Compose), or" }),
			"\n",
			createVNode(_components.li, { children: "optional “submit” (trailing Enter) for conversation mode only — must not\nbreak the paste-race rule Compose exists for." }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h4, {
			id: "not-this",
			children: "Not this"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Already in kolu" }),
					"\n",
					createVNode(_components.th, { children: "CH1" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Compose alone" }),
					"\n",
					createVNode(_components.td, { children: "write without a live read of the conversation" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Export HTML chat log" }),
					"\n",
					createVNode(_components.td, { children: "offline snapshot, not live in the panel" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Fake “Chat tab on the tile”" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "not" }), " kolu — rejected"] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h4, {
			id: "under-the-chrome",
			children: "Under the chrome"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Conversation body ← ",
			createVNode(_components.code, { children: "streams.transcriptChat" }),
			" (CT1). Compose → existing\n",
			createVNode(_components.code, { children: "lifecycle.sendInput" }),
			". Placement = ",
			createVNode(_components.code, { children: "MetadataInspector" }),
			" section, not new\ntile modes."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Done when:" }), " with Inspector open you can follow the conversation without\nexport or reading tool spam in the panel, while the tile remains the real\nPTY; reconnect does not double-paint messages."] }),
		"\n",
		createVNode("a", { id: "pe0" }),
		"\n",
		createVNode(_components.h3, {
			id: "pe0--pesu-inbound",
			children: "PE0 — pesu inbound"
		}),
		"\n",
		createVNode($$Phase, {
			id: "PE0",
			name: "XS webhook → create terminal + sendInput",
			status: "todo",
			needs: ["CH1"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "What you get:" }),
			" first DM/@mention creates terminal+agent, stores\n",
			createVNode(_components.code, { children: "threadId → terminalId" }),
			", later messages (author only) go in via ",
			createVNode(_components.code, { children: "sendInput" }),
			".\nAck + deep link into kolu. Replies still read in kolu (CH1) until PE1."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Done when:" }), " phone → XS → agent is running on your machine; you can continue\nin kolu’s conversation face."] }),
		"\n",
		createVNode("a", { id: "pe1" }),
		"\n",
		createVNode(_components.h3, {
			id: "pe1--pesu-outbound",
			children: "PE1 — pesu outbound"
		}),
		"\n",
		createVNode($$Phase, {
			id: "PE1",
			name: "subscribe transcriptChat → XS postMessage",
			status: "todo",
			needs: ["CT1", "PE0"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"pesu subscribes to the ",
			createVNode(_components.strong, { children: "same" }),
			" CT1 stream for the bound terminal; posts new\n",
			createVNode(_components.code, { children: "assistant" }),
			" texts into the thread. ",
			createVNode(_components.code, { children: "updateMessage" }),
			" / ",
			createVNode(_components.code, { children: "agentProgress" }),
			" optional\nhere or PE2. No second transcript path."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Done when:" }), " agent replies appear in the XS thread without tools/edits, and\nsurvive pesu reconnect without duplicate history storms (snapshot replace)."] }),
		"\n",
		createVNode("a", { id: "pe2" }),
		"\n",
		createVNode(_components.h3, {
			id: "pe2--deep-link--turn-ux",
			children: "PE2 — deep link + turn UX"
		}),
		"\n",
		createVNode($$Phase, {
			id: "PE2",
			name: "open terminal in PWA; growing reply; typing indicator",
			status: "todo",
			needs: ["PE0"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Polish only — no new architecture. Deep link on create; grow one bot message\nwhile a turn streams; ",
			createVNode(_components.code, { children: "agentProgress" }),
			" while working."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "done-criterion-full-tree",
			children: "Done criterion (full tree)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"DM the bot → terminal under padi/kaval → first prompt is yours → assistant\nreplies in the XS thread (messages only) ",
			createVNode(_components.strong, { children: "and" }),
			" the same conversation is\nlive in kolu’s chat face over ",
			createVNode(_components.strong, { children: "one" }),
			" padi stream → deep link opens that\nterminal."
		] }),
		"\n",
		createVNode(_components.p, { children: "/** CH1 mockup grounded in real kolu chrome: canvas tile (PTY) + right panel" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: "Inspector | Code, with a new Conversation section above Compose. Colors" }),
			"\n",
			createVNode(_components.li, { children: "approximate dark surface-0 / surface-1 / edge / fg tokens. */\nexport const KoluShellMockup = () => (" }),
			"\n"
		] }),
		"\n",
		createVNode("div", {
			role: "img",
			"aria-label": "Kolu desktop shell mockup. Left: canvas tile with title bar claude on kolu and a dark xterm body showing tool calls. Right: right panel tab bar Inspector and Code with Inspector active, new Conversation section with human and AI messages, then existing Compose section with draft textarea and Send button, then Directory section.",
			style: "margin:1.25rem 0;max-width:44rem;border:1px solid #2a2e37;border-radius:10px;overflow:hidden;background:#0e1014;box-shadow:0 6px 22px rgba(0,0,0,.35);font-family:ui-sans-serif,system-ui,sans-serif;display:flex;min-height:22rem",
			children: [createVNode("div", {
				style: "flex:1.35;min-width:0;display:flex;flex-direction:column;border-right:1px solid #2a2e37",
				children: [createVNode("div", {
					style: "display:flex;align-items:center;gap:.4rem;height:1.75rem;padding:0 .5rem;background:#161a20;border-bottom:1px solid #2a2e37",
					children: [
						createVNode("span", { style: "width:6px;height:6px;border-radius:50%;background:#d6a35c;flex:none" }),
						createVNode("span", {
							style: "font:600 .68rem/1 ui-monospace,Menlo,monospace;color:#c7ccd6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
							children: "claude · ~/code/kolu"
						}),
						createVNode("span", {
							style: "margin-left:auto;font:.58rem/1 ui-sans-serif;color:#5b626d",
							children: "tile = PTY"
						})
					]
				}), createVNode("div", {
					style: "flex:1;padding:.55rem .6rem;background:#0a0c10;font:500 .62rem/1.55 ui-monospace,Menlo,monospace;color:#8b929d",
					children: [
						createVNode(_components.div, { children: [
							createVNode("span", {
								style: "color:#5b626d",
								children: "●"
							}),
							" Edit ",
							createVNode("span", {
								style: "color:#7eb0e8",
								children: "ExportSessionDialog.tsx"
							})
						] }),
						createVNode("div", {
							style: "color:#5b626d",
							children: ["  ", "picker — Chat log · Full · Both"]
						}),
						createVNode(_components.div, { children: [createVNode("span", {
							style: "color:#6cc070",
							children: "+"
						}), " write mode.ts"] }),
						createVNode(_components.div, { children: [createVNode("span", {
							style: "color:#5b626d",
							children: "●"
						}), " Bash just check"] }),
						createVNode("div", {
							style: "color:#6cc070",
							children: "✔ green"
						}),
						createVNode("div", {
							style: "margin-top:.5rem;color:#5b626d",
							children: "agent TUI stays on the tile"
						})
					]
				})]
			}), createVNode("div", {
				style: "flex:1;min-width:11.5rem;max-width:15.5rem;display:flex;flex-direction:column;background:#12151a",
				children: [createVNode("div", {
					style: "display:flex;align-items:center;height:2rem;background:#161a20;border-bottom:1px solid #2a2e37;flex:none",
					children: [createVNode("span", {
						style: "height:100%;padding:0 .75rem;font:500 .7rem/2rem ui-sans-serif;color:#c7ccd6;background:#12151a;border-bottom:2px solid #6ea8e0",
						children: "Inspector"
					}), createVNode("span", {
						style: "height:100%;padding:0 .75rem;font:500 .7rem/2rem ui-sans-serif;color:#5b626d",
						children: "Code"
					})]
				}), createVNode("div", {
					style: "flex:1;overflow:hidden;display:flex;flex-direction:column",
					children: [
						createVNode("div", {
							style: "padding:.65rem .7rem;border-bottom:1px solid #2a2e37;border-left:2px solid #6ea8e0",
							children: [
								createVNode("div", {
									style: "font:700 .58rem/1 ui-sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#5b626d;margin-bottom:.45rem",
									children: "Conversation"
								}),
								createVNode("div", {
									style: "font:.62rem/1.4 ui-sans-serif;color:#8b929d;margin-bottom:.35rem",
									children: createVNode(_components.p, { children: [
										createVNode("span", {
											style: "font:700 .55rem/1 ui-sans-serif;letter-spacing:.04em;color:#6ea8e0",
											children: "HUMAN"
										}),
										"\n",
										" ",
										"Make session export a lightweight chat log…"
									] })
								}),
								createVNode("div", {
									style: "font:.62rem/1.4 ui-sans-serif;color:#c7ccd6;margin-bottom:.35rem",
									children: createVNode(_components.p, { children: [
										createVNode("span", {
											style: "font:700 .55rem/1 ui-sans-serif;letter-spacing:.04em;color:#6cc070",
											children: "CLAUDE"
										}),
										"\n",
										" ",
										"Picker + chat-only export. Opening PR when green."
									] })
								}),
								createVNode("div", {
									style: "font:.58rem/1 ui-sans-serif;color:#5b626d",
									children: "live · tools omitted (CT1 filter)"
								})
							]
						}),
						createVNode("div", {
							style: "padding:.65rem .7rem;border-bottom:1px solid #2a2e37",
							children: [
								createVNode("div", {
									style: "font:700 .58rem/1 ui-sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#5b626d;margin-bottom:.45rem",
									children: "Compose"
								}),
								createVNode("div", {
									style: "border:1px solid #2a2e37;border-radius:6px;background:rgba(22,26,32,.5);padding:.4rem .5rem;min-height:3.2rem;font:500 .62rem/1.4 ui-monospace,Menlo,monospace;color:#5b626d",
									children: createVNode(_components.p, { children: "Draft a prompt for the agent… ⌘⏎ to send" })
								}),
								createVNode("div", {
									style: "display:flex;align-items:center;justify-content:space-between;margin-top:.4rem;gap:.4rem",
									children: [createVNode("span", {
										style: "font:.55rem/1.25 ui-sans-serif;color:#5b626d",
										children: "Inserts into the terminal — press Enter there to submit"
									}), createVNode("span", {
										style: "flex:none;border:1px solid rgba(110,168,224,.3);background:rgba(110,168,224,.15);border-radius:6px;padding:.28rem .55rem;font:600 .62rem/1 ui-sans-serif;color:#6ea8e0",
										children: "Send →"
									})]
								})
							]
						}),
						createVNode("div", {
							style: "padding:.65rem .7rem;border-bottom:1px solid #2a2e37",
							children: [createVNode("div", {
								style: "font:700 .58rem/1 ui-sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#5b626d;margin-bottom:.35rem",
								children: "Directory"
							}), createVNode("div", {
								style: "font:500 .6rem/1.35 ui-monospace,Menlo,monospace;color:#c7ccd6;word-break:break-all",
								children: "/home/srid/code/kolu"
							})]
						}),
						createVNode("div", {
							style: "padding:.5rem .7rem;font:.55rem/1.3 ui-sans-serif;color:#5b626d",
							children: "Git · Agent · Attach… unchanged below"
						})
					]
				})]
			})]
		}),
		"\n",
		createVNode(_components.p, { children: ");" })
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
	"title": "Chat threads as terminals",
	"description": "Architectural wire: Xyne Spaces ↔ pesu ↔ padi/kaval — one thread per terminal, messages only. CT1 is a padi surface stream; kolu conversation face first, then pesu.",
	"parents": ["feature", "comparison"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-21T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "components",
			"text": "Components"
		},
		{
			"depth": 2,
			"slug": "surface-primitives-why-ct1-is-a-stream",
			"text": "Surface primitives (why CT1 is a stream)"
		},
		{
			"depth": 2,
			"slug": "bind-state-pesu-local",
			"text": "Bind state (pesu-local)"
		},
		{
			"depth": 2,
			"slug": "interaction-first-message",
			"text": "Interaction: first message"
		},
		{
			"depth": 2,
			"slug": "interaction-later-user-messages",
			"text": "Interaction: later user messages"
		},
		{
			"depth": 2,
			"slug": "interaction-agent--conversation-transcript-stream",
			"text": "Interaction: agent → conversation (transcript stream)"
		},
		{
			"depth": 2,
			"slug": "what-each-api-is-and-is-not",
			"text": "What each API is (and is not)"
		},
		{
			"depth": 3,
			"slug": "xyne-spaces--pesu-webhook",
			"text": "Xyne Spaces → pesu (webhook)"
		},
		{
			"depth": 3,
			"slug": "pesu--xyne-spaces-app-api-bearer-jwt",
			"text": "pesu → Xyne Spaces (app API, bearer JWT)"
		},
		{
			"depth": 3,
			"slug": "pesu--kolu--padi-padisurface",
			"text": "pesu / kolu → padi (padiSurface)"
		},
		{
			"depth": 3,
			"slug": "out-of-scope-for-this-wire",
			"text": "Out of scope for this wire"
		},
		{
			"depth": 2,
			"slug": "pesu-internal-shape",
			"text": "pesu internal shape"
		},
		{
			"depth": 2,
			"slug": "build-order--not-pesu-first",
			"text": "Build order — not pesu first"
		},
		{
			"depth": 3,
			"slug": "ct1--streamstranscriptchat",
			"text": "CT1 — streams.transcriptChat"
		},
		{
			"depth": 3,
			"slug": "ch1--conversation-in-the-right-panel-inspector",
			"text": "CH1 — conversation in the right panel (Inspector)"
		},
		{
			"depth": 4,
			"slug": "what-kolu-is-today-do-not-invent-chrome",
			"text": "What kolu is today (do not invent chrome)"
		},
		{
			"depth": 4,
			"slug": "what-you-get-prototype",
			"text": "What you get (prototype)"
		},
		{
			"depth": 4,
			"slug": "open-product-call-compose",
			"text": "Open product call (Compose)"
		},
		{
			"depth": 4,
			"slug": "not-this",
			"text": "Not this"
		},
		{
			"depth": 4,
			"slug": "under-the-chrome",
			"text": "Under the chrome"
		},
		{
			"depth": 3,
			"slug": "pe0--pesu-inbound",
			"text": "PE0 — pesu inbound"
		},
		{
			"depth": 3,
			"slug": "pe1--pesu-outbound",
			"text": "PE1 — pesu outbound"
		},
		{
			"depth": 3,
			"slug": "pe2--deep-link--turn-ux",
			"text": "PE2 — deep link + turn UX"
		},
		{
			"depth": 2,
			"slug": "done-criterion-full-tree",
			"text": "Done criterion (full tree)"
		}
	];
}
var url = "src/content/atlas/chat-native-agents-and-kolu.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/chat-native-agents-and-kolu.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/chat-native-agents-and-kolu.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, PT, file, frontmatter, getHeadings, url };
