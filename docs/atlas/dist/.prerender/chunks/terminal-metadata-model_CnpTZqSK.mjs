import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
//#region src/diagrams/terminal-metadata-model.svg?raw
var terminal_metadata_model_default = "<svg viewBox=\"0 0 880 600\" xmlns=\"http://www.w3.org/2000/svg\" font-family=\"ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif\">\n  <defs>\n    <marker id=\"v\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#15803d\"/></marker>\n    <marker id=\"s\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"3\" orient=\"auto\"><path d=\"M0,0 L7,3 L0,6 Z\" fill=\"#64748b\"/></marker>\n  </defs>\n\n  <text x=\"440\" y=\"24\" text-anchor=\"middle\" font-size=\"14.5\" font-weight=\"700\" fill=\"#334155\">two served collections · <tspan fill=\"#15803d\">joined at the reader</tspan> · never fused server-side  <tspan font-size=\"11\" fill=\"#94a3b8\">(landed: PR #1594)</tspan></text>\n\n  <!-- producers -->\n  <text x=\"144\" y=\"48\" text-anchor=\"middle\" font-size=\"11\" font-weight=\"700\" fill=\"#475569\">kaval — the PTY</text>\n  <rect x=\"28\" y=\"56\" width=\"232\" height=\"92\" rx=\"9\" fill=\"#f1f5f9\" stroke=\"#64748b\" stroke-width=\"1.5\"/>\n  <text x=\"44\" y=\"79\" font-size=\"12.5\" font-weight=\"700\" fill=\"#334155\">live Entry state</text>\n  <text x=\"44\" y=\"97\" font-size=\"10.5\" fill=\"#475569\">cwd · title · foreground · command · exit</text>\n  <text x=\"44\" y=\"113\" font-size=\"9.5\" fill=\"#64748b\">OSC 7 / 0;2 / 633;E · tcgetpgrp</text>\n  <text x=\"44\" y=\"132\" font-size=\"9.5\" fill=\"#64748b\">(untouched by this PR · feeds the sensors)</text>\n\n  <text x=\"396\" y=\"48\" text-anchor=\"middle\" font-size=\"11\" font-weight=\"700\" fill=\"#b06d12\">sensors — @kolu/terminal-workspace</text>\n  <rect x=\"280\" y=\"56\" width=\"232\" height=\"92\" rx=\"9\" fill=\"#fff6e8\" stroke=\"#d98a1f\" stroke-width=\"1.5\"/>\n  <text x=\"296\" y=\"79\" font-size=\"12.5\" font-weight=\"700\" fill=\"#8a5a12\">derive + relay</text>\n  <text x=\"296\" y=\"97\" font-size=\"10.5\" fill=\"#7a4f10\">git · pr · agent · lastAgentCommand …</text>\n  <text x=\"296\" y=\"113\" font-size=\"9.5\" fill=\"#b07d2a\">cwd → git → pr · relay cwd/foreground</text>\n  <text x=\"296\" y=\"132\" font-size=\"9.5\" fill=\"#b07d2a\">local endpoint now · pulam at R9</text>\n\n  <text x=\"736\" y=\"48\" text-anchor=\"middle\" font-size=\"11\" font-weight=\"700\" fill=\"#5a3ff0\">kolu — the UI author</text>\n  <rect x=\"620\" y=\"56\" width=\"232\" height=\"92\" rx=\"9\" fill=\"#efebff\" stroke=\"#5a3ff0\" stroke-width=\"1.5\"/>\n  <text x=\"636\" y=\"79\" font-size=\"12.5\" font-weight=\"700\" fill=\"#3a2bb8\">authored, persisted</text>\n  <text x=\"636\" y=\"97\" font-size=\"10.5\" fill=\"#352a7a\">location · theme · panels · intent</text>\n  <text x=\"636\" y=\"113\" font-size=\"9.5\" fill=\"#6b5fd0\">+ state = active | sleeping · sleptAt</text>\n\n  <line x1=\"260\" y1=\"100\" x2=\"278\" y2=\"100\" stroke=\"#64748b\" stroke-width=\"1.4\" marker-end=\"url(#s)\"/>\n\n  <!-- two served collections -->\n  <line x1=\"396\" y1=\"148\" x2=\"300\" y2=\"208\" stroke=\"#d98a1f\" stroke-width=\"1.5\" marker-end=\"url(#s)\"/>\n  <line x1=\"180\" y1=\"148\" x2=\"250\" y2=\"208\" stroke=\"#64748b\" stroke-width=\"1.2\" marker-end=\"url(#s)\"/>\n  <line x1=\"736\" y1=\"148\" x2=\"715\" y2=\"208\" stroke=\"#5a3ff0\" stroke-width=\"1.5\" marker-end=\"url(#s)\"/>\n\n  <rect x=\"110\" y=\"210\" width=\"320\" height=\"96\" rx=\"10\" fill=\"#fff6e8\" stroke=\"#d98a1f\" stroke-width=\"1.8\"/>\n  <text x=\"270\" y=\"234\" text-anchor=\"middle\" font-size=\"13.5\" font-weight=\"700\" fill=\"#8a5a12\">terminalWorkspace.awareness</text>\n  <text x=\"270\" y=\"253\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"700\" fill=\"#7a4f10\">AwarenessValue</text>\n  <text x=\"270\" y=\"271\" text-anchor=\"middle\" font-size=\"10\" fill=\"#7a4f10\">cwd·git·pr·agent·foreground·lastActivityAt·</text>\n  <text x=\"270\" y=\"285\" text-anchor=\"middle\" font-size=\"10\" fill=\"#7a4f10\">lastAgentCommand·agentSession  (8 fields)</text>\n  <text x=\"270\" y=\"300\" text-anchor=\"middle\" font-size=\"9\" fill=\"#b06d12\">served raw · single-writer store</text>\n\n  <rect x=\"560\" y=\"210\" width=\"290\" height=\"96\" rx=\"10\" fill=\"#efebff\" stroke=\"#5a3ff0\" stroke-width=\"1.8\"/>\n  <text x=\"705\" y=\"234\" text-anchor=\"middle\" font-size=\"13.5\" font-weight=\"700\" fill=\"#3a2bb8\">kolu.authored</text>\n  <text x=\"705\" y=\"253\" text-anchor=\"middle\" font-size=\"12\" font-weight=\"700\" fill=\"#352a7a\">AuthoredTerminal</text>\n  <text x=\"705\" y=\"271\" text-anchor=\"middle\" font-size=\"10\" fill=\"#352a7a\">location · client chrome ·</text>\n  <text x=\"705\" y=\"285\" text-anchor=\"middle\" font-size=\"10\" fill=\"#352a7a\">active | sleeping discriminant</text>\n  <text x=\"705\" y=\"300\" text-anchor=\"middle\" font-size=\"9\" fill=\"#6b5fd0\">served raw · names NO awareness field</text>\n\n  <!-- join -->\n  <line x1=\"270\" y1=\"306\" x2=\"360\" y2=\"372\" stroke=\"#15803d\" stroke-width=\"1.6\" marker-end=\"url(#v)\"/>\n  <line x1=\"705\" y1=\"306\" x2=\"560\" y2=\"372\" stroke=\"#15803d\" stroke-width=\"1.6\" marker-end=\"url(#v)\"/>\n\n  <rect x=\"225\" y=\"374\" width=\"430\" height=\"128\" rx=\"12\" fill=\"#eefcf2\" stroke=\"#15803d\" stroke-width=\"2\"/>\n  <text x=\"440\" y=\"399\" text-anchor=\"middle\" font-size=\"14.5\" font-weight=\"700\" fill=\"#15803d\">composeTerminalMetadata(authored, awareness)</text>\n  <text x=\"440\" y=\"419\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"#334155\">= TerminalMetadata  ·  active | sleeping</text>\n  <line x1=\"250\" y1=\"430\" x2=\"630\" y2=\"430\" stroke=\"#bfe6cd\"/>\n  <text x=\"440\" y=\"449\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#475569\">active   → &#123; ...awareness, ...authored &#125;   (full live overlay)</text>\n  <text x=\"440\" y=\"465\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#475569\">sleeping → &#123; ...persisted(awareness), ...authored &#125;   (frozen pr)</text>\n  <text x=\"440\" y=\"487\" text-anchor=\"middle\" font-size=\"10\" font-style=\"italic\" fill=\"#3f9b63\">the ONE join — at the READER (useTerminalMetadata) and at SAVE (snapshotSession)</text>\n\n  <!-- two consumers of the join -->\n  <text x=\"250\" y=\"525\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#5a3ff0\">↳ client read · ~20 getMetadata consumers</text>\n  <text x=\"630\" y=\"525\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#64748b\">↳ disk · SavedTerminal (live overlay stripped)</text>\n\n  <!-- footnote -->\n  <rect x=\"40\" y=\"548\" width=\"800\" height=\"44\" rx=\"9\" fill=\"#ffffff\" stroke=\"#cbd5e1\" stroke-width=\"1.1\" stroke-dasharray=\"5 4\"/>\n  <text x=\"440\" y=\"566\" text-anchor=\"middle\" font-size=\"10.5\" font-weight=\"700\" fill=\"#475569\">No server-side fused collection.</text>\n  <text x=\"440\" y=\"582\" text-anchor=\"middle\" font-size=\"10\" fill=\"#64748b\">`surfaceCtx.collections.terminalMetadata` is a compile error (pinned by surface.test.ts). R9 = swap awareness's backing remote-side behind the same seam.</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/terminal-metadata-model.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		p: "p",
		strong: "strong",
		table: "table",
		tbody: "tbody",
		td: "td",
		th: "th",
		thead: "thead",
		tr: "tr"
	}, props.components);
	const { Fragment: Fragment$1 } = _components;
	if (!Fragment$1) _missingMdxReference("Fragment", true);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "A terminal’s facts are split across two served collections, joined at the reader." }),
			" The ",
			createVNode(_components.strong, { children: "snapshot" }),
			" half — ",
			createVNode(_components.code, { children: "AwarenessValue" }),
			", the eight sensor fields — is served raw on ",
			createVNode(_components.code, { children: "terminalWorkspace.awareness" }),
			". The ",
			createVNode(_components.strong, { children: "authored" }),
			" half — ",
			createVNode(_components.code, { children: "AuthoredTerminal" }),
			", kolu’s own UI + the ",
			createVNode(_components.code, { children: "active | sleeping" }),
			" discriminant — is served raw on ",
			createVNode(_components.code, { children: "kolu.authored" }),
			". The client’s ",
			createVNode(_components.code, { children: "useTerminalMetadata" }),
			" subscribes to ",
			createVNode(_components.strong, { children: "both" }),
			" and joins them with ",
			createVNode(_components.code, { children: "composeTerminalMetadata" }),
			" into a ",
			createVNode(_components.code, { children: "TerminalMetadata" }),
			"; ",
			createVNode(_components.code, { children: "snapshotSession" }),
			" reuses the ",
			createVNode(_components.strong, { children: "same" }),
			" join to author the on-disk ",
			createVNode(_components.code, { children: "SavedTerminal" }),
			". ",
			createVNode(_components.strong, { children: "Nothing fuses the two server-side" }),
			" — ",
			createVNode(_components.code, { children: "surfaceCtx.collections.terminalMetadata" }),
			" is a compile error (pinned by ",
			createVNode(_components.code, { children: "surface.test.ts" }),
			"). This shipped in ",
			createVNode(_components.strong, { children: "PR #1594" }),
			"."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Further superseded — under padi, the reader-join itself retires (2026-07-01)",
			children: createVNode(_components.p, { children: [
				"The two-collections-joined-at-the-reader shape existed because ",
				createVNode(_components.strong, { children: "two processes wrote the two halves" }),
				" (kolu authored; the sensors observed). Under the ",
				createVNode(_components.a, {
					href: "padi.html",
					children: "padi architecture"
				}),
				" one process — padi, the per-host workspace daemon — writes both, so padi serves a single composed ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "terminals" }) }),
				" collection (",
				createVNode(_components.code, { children: "composeTerminalMetadata" }),
				" moves server-side; disk persistence keeps the same compose) and the client join deletes in phase W1. The authored/snapshot ",
				createVNode(_components.strong, { children: "split survives as padi-internal types" }),
				" — the fence keeping the producer unable to write memory — it just stops being a wire shape. Read this note as the record of the R8 join."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Superseded shape — the awareness-derive-store cutover reshaped the snapshot half",
			children: createVNode(_components.p, { children: [
				"The reader-side ",
				createVNode(_components.strong, { children: "join" }),
				" documented below (two collections, joined at the reader; no server-side fusion) still stands. But the ",
				createVNode(_components.strong, { children: "snapshot-half type" }),
				" shown throughout this note is ",
				createVNode(_components.strong, { children: "pre-cutover" }),
				". The ",
				createVNode(_components.a, {
					href: "awareness-derive-store.html",
					children: "awareness-derive-store cutover"
				}),
				" (now landed) renamed ",
				createVNode(_components.code, { children: "AwarenessValue" }),
				" → ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "TerminalSnapshot" }) }),
				", ",
				createVNode(_components.strong, { children: "deleted" }),
				" the ",
				createVNode(_components.code, { children: "agentSession" }),
				" field (the restore target is now the fold-derived discriminated ",
				createVNode(_components.code, { children: "restoreTarget" }),
				" on the authored record — its ",
				createVNode(_components.code, { children: "exact" }),
				" arm carries the identity), moved kolu’s two remembered facts (",
				createVNode(_components.code, { children: "lastActivityAt" }),
				" · ",
				createVNode(_components.code, { children: "lastAgentCommand" }),
				") onto ",
				createVNode(_components.code, { children: "kolu.authored" }),
				", and made ",
				createVNode(_components.code, { children: "pr" }),
				" ",
				createVNode(_components.strong, { children: "persisted" }),
				" (restore-relevant, like ",
				createVNode(_components.code, { children: "git" }),
				") — so the “frozen pr on the sleeping arm” special case described below is ",
				createVNode(_components.strong, { children: "gone" }),
				". Read the type tables as history; the converged types live in ",
				createVNode(_components.a, {
					href: "awareness-derive-store.html",
					children: "the awareness design"
				}),
				"."
			] })
		}),
		"\n",
		createVNode($$Svg, {
			svg: terminal_metadata_model_default,
			caption: "Two collections served raw — terminalWorkspace.awareness (AwarenessValue, 8 sensor fields) and kolu.authored (AuthoredTerminal, kolu's UI + discriminant) — joined by composeTerminalMetadata at the reader (useTerminalMetadata) and at save (snapshotSession) into a TerminalMetadata. No server-side fusion; R9 swaps awareness's backing behind the same seam."
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-shipped-types",
			children: "The shipped types"
		}),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">//  snapshot half  ── @kolu/terminal-workspace, served as `terminalWorkspace.awareness`</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">type</span><span style=\"color:#6F42C1\"> AwarenessValue</span><span style=\"color:#D73A49\">   =</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">cwd</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">git</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">pr</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">agent</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">foreground</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#E36209\">                          lastAgentCommand</span><span style=\"color:#D73A49\">?</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">agentSession</span><span style=\"color:#D73A49\">?</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">lastActivityAt</span><span style=\"color:#24292E\"> }   </span><span style=\"color:#6A737D\">// 8 fields</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//  authored half  ── @kolu/common, served as `kolu.authored`</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">type</span><span style=\"color:#6F42C1\"> AuthoredTerminal</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">location</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">themeName</span><span style=\"color:#D73A49\">?</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">parentId</span><span style=\"color:#D73A49\">?</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">canvasLayout</span><span style=\"color:#D73A49\">?</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#E36209\">                          subPanel</span><span style=\"color:#D73A49\">?</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">rightPanel</span><span style=\"color:#D73A49\">?</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">intent</span><span style=\"color:#D73A49\">?</span><span style=\"color:#24292E\"> } </span><span style=\"color:#D73A49\">&#x26;</span><span style=\"color:#24292E\"> ( { </span><span style=\"color:#E36209\">state</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\">\"active\"</span><span style=\"color:#24292E\"> }</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">                          |</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">state</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\">\"sleeping\"</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">sleptAt</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">pr</span><span style=\"color:#D73A49\">?</span><span style=\"color:#24292E\"> } )</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//  the join  ── NOT served · computed at the reader and at save · a z.infer type, not a value</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">type</span><span style=\"color:#6F42C1\"> TerminalMetadata</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> ActiveTerminal</span><span style=\"color:#D73A49\"> |</span><span style=\"color:#6F42C1\"> SleepingTerminal</span><span style=\"color:#6A737D\">       // = compose(authored, awareness)</span></span></code></pre>" }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"text\"><code><span class=\"line\"><span>composeTerminalMetadata(authored, awareness):</span></span>\n<span class=\"line\"><span>  active    →  { ...awareness, ...authored }                 // authored wins; full live overlay</span></span>\n<span class=\"line\"><span>  sleeping  →  { ...persisted(awareness), ...authored }       // live half (pr·agent·foreground)</span></span>\n<span class=\"line\"><span>                                                              // dropped; authored's frozen pr is</span></span>\n<span class=\"line\"><span>                                                              // the only pr a sleeping tile shows</span></span></code></pre>" }),
		"\n",
		createVNode(_components.h2, {
			id: "where-the-facts-come-from",
			children: "Where the facts come from"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "half" }),
					"\n",
					createVNode(_components.th, { children: "type" }),
					"\n",
					createVNode(_components.th, { children: "fields" }),
					"\n",
					createVNode(_components.th, { children: "producer" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "snapshot" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "AwarenessValue" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "cwd" }),
						" · ",
						createVNode(_components.code, { children: "git" }),
						" · ",
						createVNode(_components.code, { children: "pr" }),
						" · ",
						createVNode(_components.code, { children: "agent" }),
						" · ",
						createVNode(_components.code, { children: "foreground" }),
						" · ",
						createVNode(_components.code, { children: "lastAgentCommand" }),
						" · ",
						createVNode(_components.code, { children: "agentSession" }),
						" · ",
						createVNode(_components.code, { children: "lastActivityAt" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "sensors" }),
						" derive ",
						createVNode(_components.code, { children: "git" }),
						"/",
						createVNode(_components.code, { children: "pr" }),
						"/",
						createVNode(_components.code, { children: "agent" }),
						" and ",
						createVNode(_components.strong, { children: "relay" }),
						" kaval’s ",
						createVNode(_components.code, { children: "cwd" }),
						"/",
						createVNode(_components.code, { children: "foreground" }),
						"/",
						createVNode(_components.code, { children: "command" }),
						". ",
						createVNode(_components.code, { children: "cwd" }),
						" originates at ",
						createVNode(_components.strong, { children: "kaval" }),
						" (OSC 7); kaval is untouched by this PR."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "authored" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "AuthoredTerminal" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "location" }),
						" · ",
						createVNode(_components.code, { children: "themeName" }),
						" · ",
						createVNode(_components.code, { children: "parentId" }),
						" · ",
						createVNode(_components.code, { children: "canvasLayout" }),
						" · ",
						createVNode(_components.code, { children: "subPanel" }),
						" · ",
						createVNode(_components.code, { children: "rightPanel" }),
						" · ",
						createVNode(_components.code, { children: "intent" }),
						" + ",
						createVNode(_components.code, { children: "state" }),
						"/",
						createVNode(_components.code, { children: "sleptAt" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "kolu" }),
						" authors it; ",
						createVNode(_components.code, { children: "location" }),
						" set once at spawn; ",
						createVNode(_components.code, { children: "state" }),
						" is the ",
						createVNode(_components.code, { children: "active" }),
						"|",
						createVNode(_components.code, { children: "sleeping" }),
						" discriminant."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "cwd is kaval's, not pulam's",
			children: createVNode(_components.p, { children: [
				"The sensors don’t ",
				createVNode(_components.em, { children: "know" }),
				" ",
				createVNode(_components.code, { children: "cwd" }),
				" — they ",
				createVNode(_components.strong, { children: "relay" }),
				" it. It originates at kaval’s OSC 7 tap, flows through the sensor’s ",
				createVNode(_components.code, { children: "cwd" }),
				" channel, lands in ",
				createVNode(_components.code, { children: "AwarenessValue.cwd" }),
				", and the sensors ",
				createVNode(_components.strong, { children: "derive" }),
				" ",
				createVNode(_components.code, { children: "git" }),
				" from it (",
				createVNode(_components.code, { children: "cwd → git → pr" }),
				"). So ",
				createVNode(_components.code, { children: "AwarenessValue" }),
				" is itself a ",
				createVNode(_components.em, { children: "bundle" }),
				": kaval-relayed facts (",
				createVNode(_components.code, { children: "cwd" }),
				", ",
				createVNode(_components.code, { children: "foreground" }),
				") plus sensor-derived ones (",
				createVNode(_components.code, { children: "git" }),
				", ",
				createVNode(_components.code, { children: "pr" }),
				", ",
				createVNode(_components.code, { children: "agent" }),
				")."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "active-vs-sleeping",
			children: "Active vs Sleeping"
		}),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"text\"><code><span class=\"line\"><span>  ACTIVE                                       SLEEPING</span></span>\n<span class=\"line\"><span>  ─────────────────────────────                ─────────────────────────────────</span></span>\n<span class=\"line\"><span>  PTY alive · sensors live                     PTY killed · live sensors stop</span></span>\n<span class=\"line\"><span>  awareness updates each tick                  entry + awareness KEPT (frozen)</span></span>\n<span class=\"line\"><span>  join = { ...awareness, ...authored }         authored flipped to sleeping IN PLACE</span></span>\n<span class=\"line\"><span>  full live overlay (pr·agent·fg)              join = persisted(awareness) + authored</span></span>\n<span class=\"line\"><span>                                               frozen pr only · pr·agent·fg dropped</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"Sleep flips the authored arm to ",
			createVNode(_components.code, { children: "sleeping" }),
			" ",
			createVNode(_components.strong, { children: "in place" }),
			" and keeps the (now frozen) ",
			createVNode(_components.code, { children: "awareness" }),
			" entry — so the reader join still resolves. Dropping awareness happens only on ",
			createVNode(_components.strong, { children: "removal" }),
			" (exit / kill / discard, via ",
			createVNode(_components.code, { children: "finalizeRemoval" }),
			"), never on sleep. Sleep also ",
			createVNode(_components.strong, { children: "kills" }),
			" the PTY (",
			createVNode(_components.code, { children: "releaseSleptPty" }),
			" → ",
			createVNode(_components.code, { children: "terminal.kill" }),
			"); ",
			createVNode(_components.strong, { children: "wake re-spawns" }),
			" a fresh PTY and resumes (",
			createVNode(_components.code, { children: "claude --resume <id>" }),
			"). The “PTY survives the daemon and gets re-adopted” path is a ",
			createVNode(_components.strong, { children: "different" }),
			" event — a kolu-server ",
			createVNode(_components.strong, { children: "restart" }),
			" (",
			createVNode(_components.code, { children: "adoptLocalOrphan" }),
			")."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "persistence--author-a-snapshot-reuse-the-join",
			children: "Persistence — author a snapshot, reuse the join"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "persist = author · disk and read can't diverge",
			children: createVNode(_components.p, { children: [
				"The two live collections are ",
				createVNode(_components.strong, { children: "push-only" }),
				" — nothing in them hits disk; ",
				createVNode(_components.strong, { children: "the registry is the store" }),
				". At sleep/session-save, ",
				createVNode(_components.code, { children: "snapshotSession" }),
				" runs the ",
				createVNode(_components.strong, { children: "same" }),
				" ",
				createVNode(_components.code, { children: "composeTerminalMetadata(entry.meta, entry.awareness)" }),
				" and parses it through ",
				createVNode(_components.code, { children: "SavedTerminalSchema" }),
				", which ",
				createVNode(_components.strong, { children: "strips the live overlay" }),
				" (",
				createVNode(_components.code, { children: "pr" }),
				"/",
				createVNode(_components.code, { children: "agent" }),
				"/",
				createVNode(_components.code, { children: "foreground" }),
				"). So the on-disk ",
				createVNode(_components.code, { children: "SavedTerminal" }),
				" carries the ",
				createVNode(_components.strong, { children: "persisted" }),
				" awareness half (",
				createVNode(_components.code, { children: "cwd" }),
				" · ",
				createVNode(_components.code, { children: "git" }),
				" · ",
				createVNode(_components.code, { children: "lastAgentCommand" }),
				" · ",
				createVNode(_components.code, { children: "agentSession" }),
				" · ",
				createVNode(_components.code, { children: "lastActivityAt" }),
				") ",
				createVNode(_components.strong, { children: "+" }),
				" kolu’s authored fields, and a restored tile shows ",
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "cwd" }),
					"/",
					createVNode(_components.code, { children: "git" }),
					" from that snapshot"
				] }),
				" while ",
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "agent" }),
					"/",
					createVNode(_components.code, { children: "pr" }),
					"/",
					createVNode(_components.code, { children: "foreground" }),
					" re-derive"
				] }),
				" on wake. Because disk and the client read share the ",
				createVNode(_components.em, { children: "one" }),
				" join, they cannot diverge."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "identity",
			children: "Identity"
		}),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"text\"><code><span class=\"line\"><span>key  =  ( location , TerminalId )</span></span>\n<span class=\"line\"><span></span></span>\n<span class=\"line\"><span>  TerminalId   a uuid · minted by kolu-server, passed verbatim to kaval, keys BOTH collections</span></span>\n<span class=\"line\"><span>  location     { kind:\"local\" } | { kind:\"remote\", hostId }   — lives in AuthoredTerminal</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"The same id value flows through all three (kaval’s ",
			createVNode(_components.code, { children: "PtyId" }),
			" ",
			createVNode(_components.em, { children: "is" }),
			" the terminal id). The ",
			createVNode(_components.strong, { children: "types" }),
			" stay distinct on purpose: ",
			createVNode(_components.code, { children: "TerminalId = z.string().uuid()" }),
			", while kaval’s ",
			createVNode(_components.code, { children: "PtyId = string" }),
			" (opaque, un-branded). This PR ",
			createVNode(_components.strong, { children: "does not" }),
			" brand them together — kaval stays id-opaque (it neither mints nor interprets ids), so the coupling lives only at kolu’s boundary."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "naming--the-shipped-names-vs-the-proposals",
			children: "Naming — the shipped names vs the proposals"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The three slots below are real and stable; only their ",
			createVNode(_components.strong, { children: "names" }),
			" are open. The shipped names work but don’t read as a family (",
			createVNode(_components.code, { children: "…Value" }),
			" / ",
			createVNode(_components.code, { children: "…Terminal" }),
			" / ",
			createVNode(_components.code, { children: "…Metadata" }),
			")."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "slot" }),
					"\n",
					createVNode(_components.th, { children: "what it is" }),
					"\n",
					createVNode(_components.th, { children: createVNode(_components.strong, { children: "shipped (#1594)" }) }),
					"\n",
					createVNode(_components.th, { children: ["role → ", createVNode(_components.code, { children: "Terminal" })] }),
					"\n",
					createVNode(_components.th, { children: "symmetric halves" }),
					"\n",
					createVNode(_components.th, { children: "producer-named" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "snapshot half" }),
					"\n",
					createVNode(_components.td, { children: "8 sensor fields" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "AwarenessValue" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "AwarenessValue" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "ObservedTerminal" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "PulamMeta" }), " ⚠"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "authored half" }),
					"\n",
					createVNode(_components.td, { children: "kolu’s own" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "AuthoredTerminal" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "AuthoredTerminal" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "AuthoredTerminal" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "KoluMeta" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "the join" }),
					"\n",
					createVNode(_components.td, { children: "authored ⋈ observed" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "TerminalMetadata" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: createVNode(_components.code, { children: "Terminal" }) }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: createVNode(_components.code, { children: "Terminal" }) }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "TerminalMeta" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.em, { children: "(kaval PTY facts)" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.em, { children: "not in this PR" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "PtyListEntry" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "PtyListEntry" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "PtyListEntry" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "KavalMeta" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "reads as" }) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "mixed suffixes" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.em, { children: [
						"a ",
						createVNode(_components.code, { children: "Terminal" }),
						" is ",
						createVNode(_components.code, { children: "AuthoredTerminal" }),
						" ⋈ ",
						createVNode(_components.code, { children: "AwarenessValue" })
					] }) }),
					"\n",
					createVNode(_components.td, { children: "fully parallel pair" }),
					"\n",
					createVNode(_components.td, { children: "producer-coupled" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "churn" }) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "shipped, 0" }),
					"\n",
					createVNode(_components.td, { children: [
						"~63 refs · ",
						createVNode(_components.code, { children: "Terminal" }),
						" is free"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"~63 + ~85 refs + ",
						createVNode(_components.code, { children: "awareness" }),
						" collection + pulam"
					] }),
					"\n",
					createVNode(_components.td, { children: "large + a future lie" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Name by role, not producer",
			children: createVNode(_components.p, { children: [
				"Producer names (",
				createVNode(_components.code, { children: "PulamMeta" }),
				", ",
				createVNode(_components.code, { children: "KavalMeta" }),
				") bake in ",
				createVNode(_components.strong, { children: "who" }),
				" makes the data — but that producer is ",
				createVNode(_components.strong, { children: "volatile" }),
				": R9 makes the awareness producer differ by host — local in-process sensors vs a remote ",
				createVNode(_components.code, { children: "pulam" }),
				" daemon — so ",
				createVNode(_components.code, { children: "PulamMeta" }),
				" would be a lie for every local terminal. Role names (",
				createVNode(_components.code, { children: "Awareness" }),
				", ",
				createVNode(_components.code, { children: "Observed" }),
				", ",
				createVNode(_components.code, { children: "Authored" }),
				") name ",
				createVNode(_components.strong, { children: "what" }),
				" the data is and survive the swap. That alone rules out the producer-named column."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Recommendation:" }),
			" rename the ",
			createVNode(_components.strong, { children: "join" }),
			" ",
			createVNode(_components.code, { children: "TerminalMetadata" }),
			" → ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "Terminal" }) }),
			" (the name is free; ~63 refs) and leave the two halves as ",
			createVNode(_components.code, { children: "AuthoredTerminal" }),
			" / ",
			createVNode(_components.code, { children: "AwarenessValue" }),
			". It buys the model sentence — ",
			createVNode(_components.em, { children: [
				"“a ",
				createVNode(_components.code, { children: "Terminal" }),
				" is its authored half joined with its snapshot half”"
			] }),
			" — for the lowest churn, without the cross-package ",
			createVNode(_components.code, { children: "AwarenessValue" }),
			" rename the symmetric column drags in."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "one-surface-two-homes--serveterminalworkspace",
			children: ["One surface, two homes — ", createVNode(_components.code, { children: "serveTerminalWorkspace" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The ",
			createVNode(_components.code, { children: "terminalWorkspace.awareness" }),
			" collection is served by ",
			createVNode(_components.strong, { children: "two homes" }),
			" — kolu-server (in-process) and the ",
			createVNode(_components.code, { children: "pulam" }),
			" daemon (remote, over ssh) — but assembled in ",
			createVNode(_components.strong, { children: "one place" }),
			". ",
			createVNode(_components.code, { children: "@kolu/terminal-workspace/serveTerminalWorkspace" }),
			" owns the surface skeleton (the ",
			createVNode(_components.code, { children: "version" }),
			" handshake cell + the fs/git procedures and watcher streams, off ",
			createVNode(_components.code, { children: "serveFsGit" }),
			"); each home injects only its ",
			createVNode(_components.strong, { children: "two volatile backings" }),
			":"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "backing" }),
					"\n",
					createVNode(_components.th, { children: "kolu-server" }),
					"\n",
					createVNode(_components.th, { children: "pulam" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "awareness" }), " source"] }),
					"\n",
					createVNode(_components.td, { children: [
						"projects off its ",
						createVNode(_components.strong, { children: "registry" }),
						" (",
						createVNode(_components.code, { children: ".awareness" }),
						" per entry)"
					] }),
					"\n",
					createVNode(_components.td, { children: ["reads its ", createVNode(_components.strong, { children: "own store" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "activity" }), " source"] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "quietActivity" }), " — no raw byte tap yet"] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "live" }), ", over its activity tracker"] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"It’s the volatility-boundary twin of ",
			createVNode(_components.code, { children: "serveFsGit" }),
			": the factory hides the assembly, only the backing varies. So a second home — or R9 turning kolu’s ",
			createVNode(_components.code, { children: "activity" }),
			" live — is a ",
			createVNode(_components.strong, { children: "backing injection" }),
			", never a second hand-assembled copy (pinned by ",
			createVNode(_components.code, { children: "serveTerminalWorkspace.test.ts" }),
			")."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Superseded — the converged design splits observing from remembering",
			children: createVNode(_components.p, { children: [
				"The createPulam framing this section once carried is ",
				createVNode(_components.strong, { children: "superseded" }),
				", and the cutover has ",
				createVNode(_components.strong, { children: "landed" }),
				". The settled architecture (",
				createVNode(_components.a, {
					href: "awareness-derive-store.html",
					children: "the awareness design"
				}),
				", from a 3-agent debate) is ",
				createVNode(_components.strong, { children: "observe vs. remember" }),
				": a ",
				createVNode(_components.em, { children: "memoryless producer" }),
				" per host emits ",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				" events (",
				createVNode(_components.strong, { children: "no" }),
				" memory); ",
				createVNode(_components.em, { children: "kolu alone folds" }),
				" them. The consequence for this model: kolu’s ",
				createVNode(_components.strong, { children: "two" }),
				" remembered facts — ",
				createVNode(_components.code, { children: "lastActivityAt" }),
				" · ",
				createVNode(_components.code, { children: "lastAgentCommand" }),
				" — plus the fold-derived discriminated ",
				createVNode(_components.code, { children: "restoreTarget" }),
				" ",
				createVNode(_components.strong, { children: ["move onto ", createVNode(_components.code, { children: "kolu.authored" })] }),
				" (the old ",
				createVNode(_components.code, { children: "agentSession" }),
				" field is gone — the identity now rides the ",
				createVNode(_components.code, { children: "exact" }),
				" arm of ",
				createVNode(_components.code, { children: "restoreTarget" }),
				"), so the served ",
				createVNode(_components.code, { children: "snapshots" }),
				" collection everywhere carries only a ",
				createVNode(_components.code, { children: "TerminalSnapshot" }),
				". The reader-join keeps its shape (",
				createVNode(_components.code, { children: "authored ⋈ snapshots" }),
				"); it just takes the memory fields from the authored half. ",
				createVNode(_components.em, { children: "(The type tables above still show the pre-cutover shape; the converged types live in the awareness note.)" })
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "next--r9-converged-the-producer-observes-kolu-remembers",
			children: "Next — R9 (converged: the producer observes, kolu remembers)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"R8’s reader-join stays. The awareness architecture is settled: a ",
			createVNode(_components.strong, { children: "memoryless producer" }),
			" emits per-field observations and ",
			createVNode(_components.em, { children: "cannot spell" }),
			" the memory fields, by type; ",
			createVNode(_components.strong, { children: "kolu’s fold" }),
			" owns the memory, stamps recency with kolu’s clock, and writes the memory fields to ",
			createVNode(_components.code, { children: "kolu.authored" }),
			"."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"text\"><code><span class=\"line\"><span>S1   memoryless producer:  taps → TerminalEvent events  (TerminalSnapshot: cwd·git·pr·agent·foreground)</span></span>\n<span class=\"line\"><span>S2   kolu's fold:          { cache, memory, live } patches · kolu's clock · memory → kolu.authored</span></span>\n<span class=\"line\"><span>R9.0 kolu runs the producer IN-PROCESS and folds            (R9·lib / createPulam dissolved)</span></span>\n<span class=\"line\"><span>R9.3 kolu SUBSCRIBES a remote producer's event stream into the SAME fold  (no reconcile)</span></span>\n<span class=\"line\"><span>     UNCHANGED:  the reader join (composeTerminalMetadata) · disk persistence</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"Full design — types, API, diagrams: ",
			createVNode(_components.a, {
				href: "awareness-derive-store.html",
				children: "the awareness design"
			}),
			"; plan (superseded): ",
			createVNode(_components.a, {
				href: "remote-terminals.html#finale",
				children: "the finale record"
			}),
			"."
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
	"title": "The Terminal Model — two collections, one reader-side join (and what to name them)",
	"description": "A terminal's facts are split across two served collections — the snapshot half (AwarenessValue, 8 sensor fields) and the authored half (AuthoredTerminal, kolu's own UI). The client joins them at read time via composeTerminalMetadata into a TerminalMetadata; the same join authors the on-disk SavedTerminal. There is no server-side fused record (landed in PR",
	"parents": ["remote-terminals", "reference"],
	"status": "proposed",
	"maturity": "budding",
	"updated": "2026-07-01T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-shipped-types",
			"text": "The shipped types"
		},
		{
			"depth": 2,
			"slug": "where-the-facts-come-from",
			"text": "Where the facts come from"
		},
		{
			"depth": 2,
			"slug": "active-vs-sleeping",
			"text": "Active vs Sleeping"
		},
		{
			"depth": 2,
			"slug": "persistence--author-a-snapshot-reuse-the-join",
			"text": "Persistence — author a snapshot, reuse the join"
		},
		{
			"depth": 2,
			"slug": "identity",
			"text": "Identity"
		},
		{
			"depth": 2,
			"slug": "naming--the-shipped-names-vs-the-proposals",
			"text": "Naming — the shipped names vs the proposals"
		},
		{
			"depth": 2,
			"slug": "one-surface-two-homes--serveterminalworkspace",
			"text": "One surface, two homes — serveTerminalWorkspace"
		},
		{
			"depth": 2,
			"slug": "next--r9-converged-the-producer-observes-kolu-remembers",
			"text": "Next — R9 (converged: the producer observes, kolu remembers)"
		}
	];
}
var url = "src/content/atlas/terminal-metadata-model.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/terminal-metadata-model.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/terminal-metadata-model.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
