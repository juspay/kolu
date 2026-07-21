import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/diagrams/kaval-skew-fix-design-flow.svg?raw
var kaval_skew_fix_design_flow_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1240 620\" font-family=\"ui-sans-serif,system-ui\" font-size=\"13\">\n  <defs>\n    <marker id=\"arr\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0,0 L10,5 L0,10 z\" fill=\"#5b6470\"/>\n    </marker>\n    <marker id=\"arrg\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0,0 L10,5 L0,10 z\" fill=\"#1b7a3a\"/>\n    </marker>\n  </defs>\n\n  <!-- ══ Row 1: the skew FACT's typed path ══ -->\n  <text x=\"20\" y=\"24\" font-weight=\"700\" fill=\"#1a1c20\" font-size=\"14\">The skew fact — typed at the mint, typed at every hop</text>\n\n  <!-- A: mint -->\n  <rect x=\"20\" y=\"40\" width=\"252\" height=\"112\" rx=\"10\" fill=\"#e3f4e9\" stroke=\"#1b7a3a\" stroke-width=\"1.5\"/>\n  <text x=\"34\" y=\"64\" font-weight=\"700\" fill=\"#1b7a3a\">MINT · connect.ts:97</text>\n  <text x=\"34\" y=\"86\" font-family=\"ui-monospace,monospace\" font-size=\"12\" fill=\"#1a1c20\">DaemonContractSkewError</text>\n  <text x=\"34\" y=\"106\" font-family=\"ui-monospace,monospace\" font-size=\"12\" fill=\"#1b7a3a\">+ daemonVersion</text>\n  <text x=\"34\" y=\"124\" font-family=\"ui-monospace,monospace\" font-size=\"12\" fill=\"#1b7a3a\">+ requiredVersion</text>\n  <text x=\"34\" y=\"143\" font-size=\"11\" fill=\"#5b6470\">SK2 — message derived from fields</text>\n\n  <line x1=\"272\" y1=\"96\" x2=\"316\" y2=\"96\" stroke=\"#1b7a3a\" stroke-width=\"1.5\" marker-end=\"url(#arrg)\"/>\n\n  <!-- B: state sum -->\n  <rect x=\"320\" y=\"40\" width=\"286\" height=\"112\" rx=\"10\" fill=\"#fff\" stroke=\"#0b6478\" stroke-width=\"1.5\"/>\n  <text x=\"334\" y=\"64\" font-weight=\"700\" fill=\"#0b6478\">STATE · supervisor endpoint</text>\n  <text x=\"334\" y=\"86\" font-family=\"ui-monospace,monospace\" font-size=\"12\" fill=\"#1a1c20\">… | degraded | dead |</text>\n  <text x=\"334\" y=\"106\" font-family=\"ui-monospace,monospace\" font-size=\"12\" fill=\"#0b6478\" font-weight=\"700\">incompatible{dv, rv}</text>\n  <text x=\"334\" y=\"126\" font-size=\"11\" fill=\"#b3261e\">today: catch→dead (endpoint.ts:431),</text>\n  <text x=\"334\" y=\"142\" font-size=\"11\" fill=\"#b3261e\">refuse→degraded (:741) — the collapse</text>\n\n  <line x1=\"606\" y1=\"96\" x2=\"650\" y2=\"96\" stroke=\"#1b7a3a\" stroke-width=\"1.5\" marker-end=\"url(#arrg)\"/>\n\n  <!-- C: wire -->\n  <rect x=\"654\" y=\"40\" width=\"256\" height=\"112\" rx=\"10\" fill=\"#fff\" stroke=\"#0b6478\" stroke-width=\"1.5\"/>\n  <text x=\"668\" y=\"64\" font-weight=\"700\" fill=\"#0b6478\">WIRE · daemonStatus</text>\n  <text x=\"668\" y=\"86\" font-size=\"12\" fill=\"#1a1c20\">DaemonStatusSchema — a third</text>\n  <text x=\"668\" y=\"104\" font-size=\"12\" fill=\"#1a1c20\">object arm (vocab.ts:577)</text>\n  <text x=\"668\" y=\"126\" font-family=\"ui-monospace,monospace\" font-size=\"11\" fill=\"#0b6478\">{state:\"incompatible\",</text>\n  <text x=\"668\" y=\"142\" font-family=\"ui-monospace,monospace\" font-size=\"11\" fill=\"#0b6478\"> daemonVersion, requiredVersion}</text>\n\n  <line x1=\"910\" y1=\"96\" x2=\"954\" y2=\"96\" stroke=\"#1b7a3a\" stroke-width=\"1.5\" marker-end=\"url(#arrg)\"/>\n\n  <!-- D: derivation -->\n  <rect x=\"958\" y=\"40\" width=\"262\" height=\"112\" rx=\"10\" fill=\"#e3f4e9\" stroke=\"#1b7a3a\" stroke-width=\"1.5\"/>\n  <text x=\"972\" y=\"64\" font-weight=\"700\" fill=\"#1b7a3a\">DERIVE · kavalAttention()</text>\n  <text x=\"972\" y=\"86\" font-size=\"12\" fill=\"#1a1c20\">kavalCurrency.ts — the ONE</text>\n  <text x=\"972\" y=\"104\" font-size=\"12\" fill=\"#1a1c20\">version-comparison site (SK5)</text>\n  <text x=\"972\" y=\"126\" font-family=\"ui-monospace,monospace\" font-size=\"11\" fill=\"#1b7a3a\">none | stale{run,exp}</text>\n  <text x=\"972\" y=\"142\" font-family=\"ui-monospace,monospace\" font-size=\"11\" fill=\"#1b7a3a\">     | incompatible{dv,rv}</text>\n\n  <!-- ══ Row 2: one chrome, three readouts ══ -->\n  <line x1=\"1000\" y1=\"152\" x2=\"760\" y2=\"216\" stroke=\"#5b6470\" stroke-width=\"1.2\" marker-end=\"url(#arr)\"/>\n  <line x1=\"1060\" y1=\"152\" x2=\"960\" y2=\"216\" stroke=\"#5b6470\" stroke-width=\"1.2\" marker-end=\"url(#arr)\"/>\n  <line x1=\"1120\" y1=\"152\" x2=\"1128\" y2=\"216\" stroke=\"#5b6470\" stroke-width=\"1.2\" marker-end=\"url(#arr)\"/>\n\n  <rect x=\"654\" y=\"220\" width=\"200\" height=\"76\" rx=\"10\" fill=\"#fdf6ec\" stroke=\"#8a5200\" stroke-width=\"1.2\"/>\n  <text x=\"668\" y=\"244\" font-weight=\"700\" font-size=\"12\" fill=\"#8a5200\">canvas skew card</text>\n  <text x=\"668\" y=\"262\" font-size=\"11\" fill=\"#1a1c20\">DegradedCanvas gains the</text>\n  <text x=\"668\" y=\"278\" font-size=\"11\" fill=\"#1a1c20\">incompatible arm — no Restart</text>\n\n  <rect x=\"874\" y=\"220\" width=\"200\" height=\"76\" rx=\"10\" fill=\"#fdf6ec\" stroke=\"#8a5200\" stroke-width=\"1.2\"/>\n  <text x=\"888\" y=\"244\" font-weight=\"700\" font-size=\"12\" fill=\"#8a5200\">KavalInfoDialog banner</text>\n  <text x=\"888\" y=\"262\" font-size=\"11\" fill=\"#1a1c20\">same slot as \"newer build</text>\n  <text x=\"888\" y=\"278\" font-size=\"11\" fill=\"#1a1c20\">available\" — two axes, one chrome</text>\n\n  <rect x=\"1094\" y=\"220\" width=\"126\" height=\"76\" rx=\"10\" fill=\"#fdf6ec\" stroke=\"#8a5200\" stroke-width=\"1.2\"/>\n  <text x=\"1108\" y=\"244\" font-weight=\"700\" font-size=\"12\" fill=\"#8a5200\">host-chip pip</text>\n  <text x=\"1108\" y=\"262\" font-size=\"11\" fill=\"#1a1c20\">+ tooltip, same</text>\n  <text x=\"1108\" y=\"278\" font-size=\"11\" fill=\"#1a1c20\">derivation</text>\n\n  <!-- ══ Row 3: recovery, a total function ══ -->\n  <line x1=\"937\" y1=\"296\" x2=\"937\" y2=\"336\" stroke=\"#5b6470\" stroke-width=\"1.2\" marker-end=\"url(#arr)\"/>\n\n  <rect x=\"654\" y=\"340\" width=\"566\" height=\"118\" rx=\"10\" fill=\"#fff\" stroke=\"#1b7a3a\" stroke-width=\"1.5\"/>\n  <text x=\"668\" y=\"364\" font-weight=\"700\" fill=\"#1b7a3a\">RECOVERY · a total function of the axis — SK5</text>\n  <text x=\"668\" y=\"388\" font-size=\"12\" fill=\"#1a1c20\"><tspan font-weight=\"700\">stale</tspan> → lifecycle.recycleKaval (RestartKavalButton — converge the build from</text>\n  <text x=\"668\" y=\"404\" font-size=\"12\" fill=\"#1a1c20\">the padi's own closure)</text>\n  <text x=\"668\" y=\"428\" font-size=\"12\" fill=\"#1a1c20\"><tspan font-weight=\"700\">incompatible · any host</tspan> → confirm → hosts.renewDaemon → binder renew(): drain →</text>\n  <text x=\"668\" y=\"444\" font-size=\"12\" fill=\"#1a1c20\">re-realise closure → re-exec → converge recycles kaval. <tspan fill=\"#b3261e\">Respawn already failed; change the closure.</tspan></text>\n\n  <!-- ══ Left-bottom: the RPC error leg ══ -->\n  <text x=\"20\" y=\"214\" font-weight=\"700\" fill=\"#1a1c20\" font-size=\"14\">The RPC leg — declared, not flattened</text>\n\n  <rect x=\"20\" y=\"230\" width=\"280\" height=\"96\" rx=\"10\" fill=\"#fff\" stroke=\"#0b6478\" stroke-width=\"1.5\"/>\n  <text x=\"34\" y=\"254\" font-weight=\"700\" fill=\"#0b6478\">HANDLER · recycleKaval</text>\n  <text x=\"34\" y=\"274\" font-size=\"12\" fill=\"#1a1c20\">servePadi.ts:443 — catch skew,</text>\n  <text x=\"34\" y=\"292\" font-family=\"ui-monospace,monospace\" font-size=\"11\" fill=\"#0b6478\">throw errors.KAVAL_CONTRACT_SKEW</text>\n  <text x=\"34\" y=\"308\" font-size=\"11\" fill=\"#5b6470\">SK3 (ad-hoc) → SK6 (declared)</text>\n\n  <line x1=\"300\" y1=\"278\" x2=\"344\" y2=\"278\" stroke=\"#1b7a3a\" stroke-width=\"1.5\" marker-end=\"url(#arrg)\"/>\n\n  <rect x=\"348\" y=\"230\" width=\"258\" height=\"96\" rx=\"10\" fill=\"#fff\" stroke=\"#0b6478\" stroke-width=\"1.5\"/>\n  <text x=\"362\" y=\"254\" font-weight=\"700\" fill=\"#0b6478\">CONTRACT · defineSurface</text>\n  <text x=\"362\" y=\"274\" font-family=\"ui-monospace,monospace\" font-size=\"11\" fill=\"#1a1c20\">ProcedureSpec.errors → oc.errors()</text>\n  <text x=\"362\" y=\"292\" font-size=\"12\" fill=\"#1a1c20\">declared union on the wire (SK6)</text>\n  <text x=\"362\" y=\"308\" font-size=\"11\" fill=\"#5b6470\">oRPC 1.13.13 — API exists at the pin</text>\n\n  <line x1=\"477\" y1=\"326\" x2=\"477\" y2=\"366\" stroke=\"#1b7a3a\" stroke-width=\"1.5\" marker-end=\"url(#arrg)\"/>\n\n  <rect x=\"348\" y=\"370\" width=\"258\" height=\"88\" rx=\"10\" fill=\"#e3f4e9\" stroke=\"#1b7a3a\" stroke-width=\"1.5\"/>\n  <text x=\"362\" y=\"394\" font-weight=\"700\" fill=\"#1b7a3a\">CLIENT · discriminated catch</text>\n  <text x=\"362\" y=\"414\" font-family=\"ui-monospace,monospace\" font-size=\"11\" fill=\"#1a1c20\">isDefinedError(e) → e.data:</text>\n  <text x=\"362\" y=\"430\" font-family=\"ui-monospace,monospace\" font-size=\"11\" fill=\"#1a1c20\">{daemonVersion, requiredVersion}</text>\n  <text x=\"362\" y=\"448\" font-size=\"11\" fill=\"#5b6470\">feeds the same kavalAttention chrome</text>\n\n  <!-- the killed path -->\n  <rect x=\"20\" y=\"370\" width=\"280\" height=\"88\" rx=\"10\" fill=\"#fbeaea\" stroke=\"#b3261e\" stroke-width=\"1.2\" stroke-dasharray=\"5 4\"/>\n  <text x=\"34\" y=\"394\" font-weight=\"700\" fill=\"#b3261e\">KILLED · the flatten</text>\n  <text x=\"34\" y=\"414\" font-family=\"ui-monospace,monospace\" font-size=\"11\" fill=\"#b3261e\">plain Error → toORPCError →</text>\n  <text x=\"34\" y=\"430\" font-family=\"ui-monospace,monospace\" font-size=\"11\" fill=\"#b3261e\">\"INTERNAL_SERVER_ERROR\"</text>\n  <text x=\"34\" y=\"448\" font-size=\"11\" fill=\"#b3261e\">today's toast — the P5 defect</text>\n  <line x1=\"30\" y1=\"380\" x2=\"290\" y2=\"448\" stroke=\"#b3261e\" stroke-width=\"2\"/>\n\n  <!-- footer strip: log bridge -->\n  <rect x=\"20\" y=\"490\" width=\"1200\" height=\"106\" rx=\"10\" fill=\"#f4f1e8\" stroke=\"#e6e2d6\" stroke-width=\"1.2\"/>\n  <text x=\"34\" y=\"514\" font-weight=\"700\" fill=\"#1a1c20\">SK1 · the log bridge — the crash that hid everything</text>\n  <text x=\"34\" y=\"538\" font-size=\"12\" fill=\"#1a1c20\">makeSession's <tspan font-family=\"ui-monospace,monospace\">onLog?: (line, severity) =&gt; void</tspan> becomes <tspan font-family=\"ui-monospace,monospace\">log?: Logger</tspan> (the @kolu/log shape). emit calls <tspan font-family=\"ui-monospace,monospace\">opts.log[severity]({ line }, label)</tspan> —</text>\n  <text x=\"34\" y=\"558\" font-size=\"12\" fill=\"#1a1c20\">a receiver-bound call, so the consumer-side unbound-pino ternary (remotePadiBinding.ts:697, padiBinding.ts:605) has no spellable form left.</text>\n  <text x=\"34\" y=\"578\" font-size=\"12\" fill=\"#b3261e\">The compensating per-line try/catch (session.ts:567) is DELETED — its reason to exist is gone; keeping it would hide the next regression.</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/kaval-skew-fix-design.mdx
var SkewCardMock = () => createVNode("div", {
	style: "max-width:30rem;margin:1.2rem auto;border:1px solid #e6e2d6;border-radius:12px;padding:1.2rem 1.3rem;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.06);font-family:ui-sans-serif,system-ui",
	children: [
		createVNode("div", {
			style: "display:flex;align-items:center;gap:.5rem",
			children: [createVNode("span", { style: "width:10px;height:10px;border-radius:50%;background:#b3261e;display:inline-block" }), createVNode("strong", {
				style: "color:#1a1c20;font-size:.95rem",
				children: "kaval is incompatible with this kolu"
			})]
		}),
		createVNode("p", {
			style: "margin:.6rem 0 0;font:.78rem/1.5 ui-monospace,monospace;color:#5b6470",
			children: [
				"this host's kaval speaks ",
				createVNode("span", {
					style: "color:#b3261e;font-weight:700",
					children: "5.0"
				}),
				" · your kolu needs ",
				createVNode("span", {
					style: "color:#1b7a3a;font-weight:700",
					children: "5.2"
				})
			]
		}),
		createVNode("p", {
			style: "margin:.45rem 0 0;font-size:.8rem;color:#5b6470;line-height:1.5",
			children: "Restarting can't fix this — the host's kaval binary is from an older kolu install. Updating re-realises the host's closure and starts a correct-version kaval."
		}),
		createVNode("button", {
			type: "button",
			style: "margin-top:.85rem;border:1px solid #0b6478;background:#0b6478;color:#fff;border-radius:8px;padding:.45rem .9rem;font-size:.8rem;font-weight:600;cursor:default",
			children: "Update & restart kaval…"
		}),
		createVNode("p", {
			style: "margin:.5rem 0 0;font-size:.7rem;color:#8a8f98",
			children: "opens a confirm (the existing Restart-confirm pattern): drains padi, re-provisions the closure, starts a correct-version kaval — terminals on this host restart"
		})
	]
});
var DialogBannerMock = () => createVNode("div", {
	style: "max-width:30rem;margin:1rem auto;font-family:ui-sans-serif,system-ui",
	children: [
		createVNode("div", {
			style: "border:1px solid rgba(179,38,30,.4);background:rgba(179,38,30,.08);border-radius:8px;padding:.6rem .8rem;font-size:.75rem;line-height:1.5",
			children: [createVNode("p", {
				style: "margin:0;font-weight:600;color:#b3261e",
				children: "Incompatible — needs update"
			}), createVNode("p", {
				style: "margin:.25rem 0 0;font:.7rem/1.5 ui-monospace,monospace;color:#5b6470",
				children: "kaval speaks 5.0 · kolu needs 5.2"
			})]
		}),
		createVNode("div", {
			style: "border:1px solid rgba(138,82,0,.4);background:rgba(138,82,0,.08);border-radius:8px;padding:.6rem .8rem;font-size:.75rem;line-height:1.5;margin-top:.5rem",
			children: [createVNode("p", {
				style: "margin:0;font-weight:600;color:#8a5200",
				children: "Newer Kaval build available"
			}), createVNode("p", {
				style: "margin:.25rem 0 0;font:.7rem/1.5 ui-monospace,monospace;color:#5b6470",
				children: "running a1b2c3d · expected e4f5a6b"
			})]
		}),
		createVNode("p", {
			style: "margin:.5rem 0 0;font-size:.7rem;color:#8a8f98;text-align:center",
			children: "the KavalInfoDialog banner slot — the two axes, distinctly labeled, one chrome (only one shows at a time: a skewed kaval is never connected, so the axes are mutually exclusive by construction)"
		})
	]
});
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
		createVNode($$PrLink, { pr: 1876 }),
		"\n",
		createVNode(_components.p, { children: [
			"This note is the build plan for the two-tier fix ruled in\n",
			createVNode(_components.a, {
				href: "/atlas/bug-remote-kaval-contract-skew.html",
				children: "the bug note"
			}),
			": ",
			createVNode(_components.strong, { children: "one PR, two\ncommits" }),
			" — commit 1 repairs the instances (SK1–SK3), commit 2 makes the class\ninexpressible (SK4–SK6). Work items carry the ",
			createVNode(_components.strong, { children: "SK" }),
			" track prefix (new; no\ncollisions in the Atlas). Every file:line below was re-grounded at\n",
			createVNode(_components.code, { children: "kaval-skew" }),
			" HEAD (",
			createVNode(_components.code, { children: "318f17437" }),
			")."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: kaval_skew_fix_design_flow_default,
			wide: true,
			caption: "The skew fact stays typed at every hop: minted with version fields (SK2), carried as a first-class state (SK4), derived once (SK5), recovered per axis. The RPC leg is declared, not flattened (SK3→SK6). SK1 unblocks the diagnostics that hid all of it."
		}),
		"\n",
		createVNode(_components.h2, {
			id: "how-this-honors-the-design-philosophy",
			children: "How this honors the design philosophy"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Fail fast, no fallbacks" }),
				" — the compensating per-line ",
				createVNode(_components.code, { children: "try/catch" }),
				" around the\nlog sink is ",
				createVNode(_components.em, { children: "deleted" }),
				", not kept as a belt-and-braces (SK1); ",
				createVNode(_components.code, { children: "recycleKaval" }),
				" on\nskew refuses typed rather than retrying (one attempt is diagnosis; a retry\nloop is a lie); an undeclared handler throw still surfaces loudly as\n",
				createVNode(_components.code, { children: "INTERNAL_SERVER_ERROR" }),
				" — we kill the ",
				createVNode(_components.em, { children: "flattening of declared errors" }),
				", not the\ncrash-loudly path."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Electricity boundaries" }),
				" — every framework move lands in the package that\nowns the volatility: the logger seam in ",
				createVNode(_components.code, { children: "@kolu/surface-remote" }),
				", the state sum\nin ",
				createVNode(_components.code, { children: "@kolu/surface-daemon-supervisor" }),
				", the error channel in ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				".\nNothing domain-specific leaks into them; kolu-side code only consumes."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Reuse the existing source of truth" }),
				" — the ",
				createVNode(_components.code, { children: "Logger" }),
				" shape comes from\n",
				createVNode(_components.code, { children: "@kolu/log" }),
				" (not a new interface, not a pino dep); the skew UX extends the\n",
				createVNode(_components.em, { children: "existing" }),
				" kaval-currency surface (",
				createVNode(_components.code, { children: "kavalCurrency.ts" }),
				" → ",
				createVNode(_components.code, { children: "KavalInfoDialog" }),
				"\nbanner → host-chip pip) instead of a parallel skew card; the remote recovery\nreuses the binder’s existing drain→re-dial→re-realise pipeline. ",
				createVNode(_components.strong, { children: "The reuse\nruling is itself fortification" }),
				": one badge/dialog surface fed by typed status\narms cannot disagree with itself, where a second “your kaval needs attention”\nsurface with its own predicate/copy/action would be this bug’s shape — a\nclaim downstream of the truth, free to drift false — rebuilt in the UI. Any\nduplicated presentation surface or duplicated version-comparison logic is a\ndefect of the same severity as a fallback."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "gate-criteria-binding",
			children: "Gate criteria (binding)"
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The skew card" }),
				" — the user sees both versions (“this host’s kaval speaks\n5.0, your kolu needs 5.2”) carried as ",
				createVNode(_components.strong, { children: "typed fields end-to-end" }),
				" (padi\nthrow → status arm → client); no consumer ever re-parses message prose."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The card offers the working recovery" }),
				" — one action that stops the old\nkaval and starts a correct-version one, via the ",
				createVNode(_components.strong, { children: "binder’s reprovision\npath" }),
				" (re-realise the host closure → fresh kaval), never the recycle path\n(by ",
				createVNode(_components.code, { children: "incompatible" }),
				"’s construction a recycle from the current closure has\nalready been tried and skewed — see SK5). To the user: ",
				createVNode(_components.em, { children: "“Update &\nrestart kaval.”" }),
				" The “working” claim is ",
				createVNode(_components.strong, { children: "proven on the incident\ntopology" }),
				" in the evidence, not inferred (see Gates)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Faithful propagation" }),
				" — every hop from surface to UI preserves the typed\nskew; no ",
				createVNode(_components.code, { children: "INTERNAL_SERVER_ERROR" }),
				" flattening anywhere on the path."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "commit-1--the-repairs",
			children: "Commit 1 — the repairs"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "sk1--the-log-bridge-a-receiver-bound-logger-seam",
			children: "SK1 — the log bridge: a receiver-bound Logger seam"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The crash is an ",
			createVNode(_components.strong, { children: "unbound pino method" }),
			": ",
			createVNode(_components.code, { children: "(severity === \"error\" ? log.error : … : log.info)({…}, \"…\")" }),
			" extracts a bare function reference, so pino runs with\n",
			createVNode(_components.code, { children: "this === undefined" }),
			" and throws on every line — in both consumers\n(",
			createVNode(_components.code, { children: "packages/server/src/padi/remotePadiBinding.ts:697" }),
			",\n",
			createVNode(_components.code, { children: "packages/server/src/padi/padiBinding.ts:605" }),
			"). The structural fix moves\nseverity dispatch ",
			createVNode(_components.em, { children: "inside" }),
			" the session so the hazard has no spellable form:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "MakeSessionOptions.onLog" }),
					" is replaced by ",
					createVNode(_components.code, { children: "log?: Logger" })
				] }),
				"\n(",
				createVNode(_components.code, { children: "packages/surface-remote/src/session.ts:416" }),
				"), the ",
				createVNode(_components.code, { children: "Logger" }),
				" type imported\nfrom ",
				createVNode(_components.code, { children: "@kolu/log" }),
				" (",
				createVNode(_components.code, { children: "packages/log/src/index.ts:24" }),
				" — the workspace’s single\nauthoritative shape, zero-dep, structurally compatible with pino child\nloggers).",
				createVNode($$Footnote, { children: [
					createVNode(_components.code, { children: "@kolu/surface-remote" }),
					" already carries workspace deps\n(",
					createVNode(_components.code, { children: "@kolu/surface" }),
					", ",
					createVNode(_components.code, { children: "@kolu/surface-map" }),
					", ",
					createVNode(_components.code, { children: "@kolu/shell-quote" }),
					"), so depending on\n",
					createVNode(_components.code, { children: "@kolu/log" }),
					" doesn’t break any graduation rule. ",
					createVNode(_components.code, { children: "@kolu/surface-daemon" }),
					"\nre-declares the shape locally to stay workspace-dep-free; surface-remote has\nno such constraint."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "emit" }),
					" becomes ",
					createVNode(_components.code, { children: "opts.log[severity]({ line }, label)" })
				] }),
				" — an indexed call on\nthe receiver, ",
				createVNode(_components.code, { children: "this" }),
				" bound by construction. Absent ",
				createVNode(_components.code, { children: "log" }),
				", the current raw\n",
				createVNode(_components.code, { children: "process.stderr.write(line)" }),
				" default is ",
				createVNode(_components.strong, { children: "unchanged" }),
				" (odu’s\n",
				createVNode(_components.code, { children: "src/coordinator/display.ts:26" }),
				" depends on surface-remote’s default\ndiagnostics reaching raw stderr with the ",
				createVNode(_components.code, { children: "[host:…]" }),
				" prefix)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"The per-line ",
					createVNode(_components.code, { children: "try/catch" }),
					" (",
					createVNode(_components.code, { children: "session.ts:567–574" }),
					") is deleted"
				] }),
				", along with\nits covering test (",
				createVNode(_components.code, { children: "hostSession.test.ts:143–176" }),
				", “contains a throwing onLog\nsink”) — the sink it compensated for no longer exists; keeping it would hide\nthe next regression. Stated blast radius: a ",
				createVNode(_components.em, { children: "throwing" }),
				" consumer ",
				createVNode(_components.code, { children: "Logger" }),
				" now\ncrashes the session loop instead of being swallowed per line — that is\nfail-fast-correct (a broken logger is a defect to surface, not to spam\nstderr around), and the receiver-bound internal dispatch removes the one\nthrow source the catch was built for."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "dialAgentOnce" }), " forwards the new option"] }),
				" (",
				createVNode(_components.code, { children: "dialAgentOnce.ts:143–148, 183" }),
				"): its ",
				createVNode(_components.code, { children: "onLog?: (line) => void" }),
				" becomes ",
				createVNode(_components.code, { children: "log?: Logger" }),
				" pass-through."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Consumers" }),
				": ",
				createVNode(_components.code, { children: "padiBinding" }),
				" passes ",
				createVNode(_components.code, { children: "log" }),
				"; ",
				createVNode(_components.code, { children: "remotePadiBinding" }),
				" passes\n",
				createVNode(_components.code, { children: "log.child({ host })" }),
				" — the ",
				createVNode(_components.code, { children: "{host}" }),
				" field the old sink attached now rides\nchild bindings. The line-prefix labels (",
				createVNode(_components.code, { children: "[host:x local]" }),
				"…) stay baked into\n",
				createVNode(_components.code, { children: "line" }),
				" (tests assert them; ",
				createVNode(_components.code, { children: "hostSession.test.ts:125" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Tests" }),
				": ",
				createVNode(_components.code, { children: "hostSession.test.ts" }),
				", ",
				createVNode(_components.code, { children: "clockProbe.test.ts" }),
				" (the severity-routing\nassertion at :161 becomes a Logger-stub assertion), ",
				createVNode(_components.code, { children: "probingEpisode" }),
				",\n",
				createVNode(_components.code, { children: "currentState" }),
				", ",
				createVNode(_components.code, { children: "remotePadiSsh.test.ts:235" }),
				" — sinks become 4-method stubs."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Red-first pin" }),
				": a session driven with a ",
				createVNode(_components.strong, { children: "real pino logger" }),
				" (prototype\nmethods) logs every diagnostic line without a throw; red today when the\nconsumer-shaped ternary is exercised.",
				createVNode($$Footnote, { children: [
					"The red repro lives at the new\nseam’s level: drive ",
					createVNode(_components.code, { children: "makeSession" }),
					"’s emit path with a genuine pino child\nlogger. Under the current API the equivalent consumer lambda throws per line\n(",
					createVNode(_components.code, { children: "Cannot read properties of undefined (reading 'Symbol(pino.msgPrefix)')" }),
					"),\nwhich the deleted ",
					createVNode(_components.code, { children: "try/catch" }),
					" converts into stderr spam + dropped logs — the\nbug note’s defect C."
				] })
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "sk2--the-error-carries-its-versions",
			children: "SK2 — the error carries its versions"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "DaemonContractSkewError" }),
			"\n(",
			createVNode(_components.code, { children: "packages/surface-daemon-supervisor/src/endpoint.ts:82" }),
			") today takes a prose\nmessage; both mint sites already hold the two versions as values and bake them\ninto the string. The class gains the facts:"
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
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "new"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " DaemonContractSkewError"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ subject: "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"pty-host\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", daemonVersion, requiredVersion })"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// .message derived: `${subject} contract skew: daemon speaks ${daemonVersion}, needs ${requiredVersion}`"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "readonly daemonVersion" }),
				" / ",
				createVNode(_components.code, { children: "readonly requiredVersion" }),
				" fields; ",
				createVNode(_components.strong, { children: "message\nderived from the fields" }),
				" (parse-don’t-validate — no consumer ever regexes\nthe prose). ",
				createVNode(_components.code, { children: "subject" }),
				" keeps the two mint flavors legible\n(",
				createVNode(_components.code, { children: "connect.ts:97" }),
				" “pty-host”; ",
				createVNode(_components.code, { children: "dial.ts:152" }),
				" “padiSurface”) while staying a\nfield, not free prose."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Mint sites updated: ",
				createVNode(_components.code, { children: "packages/padi/src/ptyHost/connect.ts:97" }),
				",\n",
				createVNode(_components.code, { children: "packages/padi/src/dial.ts:152" }),
				", plus the three test mints in\n",
				createVNode(_components.code, { children: "endpoint.test.ts" }),
				" (:624, :778, :1042)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Exported-API change → ",
				createVNode(_components.code, { children: "ref-surface-supervisor.mdx" }),
				" same commit. Neither\ndrishti nor odu imports the class (grounded grep at both pins — zero hits)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "sk3--typed-rethrow-at-the-knowing-endpoint",
			children: "SK3 — typed rethrow at the knowing endpoint"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "recycleKaval" }),
			"’s catch (",
			createVNode(_components.code, { children: "packages/padi/src/servePadi.ts:443–458" }),
			") rethrows a\nplain error, which oRPC’s ",
			createVNode(_components.code, { children: "toORPCError" }),
			" collapses to ",
			createVNode(_components.code, { children: "INTERNAL_SERVER_ERROR" }),
			" —\nthe toast the user saw. Mirroring the existing ",
			createVNode(_components.code, { children: "fileGoneAsNotFound" }),
			" pattern\n(",
			createVNode(_components.code, { children: "servePadi.ts:124" }),
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
					children: [createVNode(_components.span, {
						style: { color: "#D73A49" },
						children: "catch"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: " (err) {"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  if"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "isContractSkewError"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(err)) {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    throw"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " new"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " ORPCError"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"KAVAL_CONTRACT_SKEW\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "      message: err.message,"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "      data: { daemonVersion: err.daemonVersion, requiredVersion: err.requiredVersion },"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "    });"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  }"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  …existing journal line "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "+"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " rethrow…"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "}"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"The handler performs ",
				createVNode(_components.strong, { children: "one" }),
				" recycle attempt (it already does —\n",
				createVNode(_components.code, { children: "restartLocalDaemon" }),
				" is single-shot); on skew it now ",
				createVNode(_components.em, { children: "refuses typed" }),
				". No\nretry loop is added anywhere."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The client toast (",
				createVNode(_components.code, { children: "useDaemonRestart.ts:62–67" }),
				") shows ",
				createVNode(_components.code, { children: "err.message" }),
				" — with\nSK3 alone the user already reads the real cause instead of “Internal server\nerror”. Commit 2 (SK6) upgrades this same code from an ad-hoc string to a\n",
				createVNode(_components.em, { children: "declared" }),
				" error; SK5 replaces the affordance that led here."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Red-first pin" }),
				": unit test — when ",
				createVNode(_components.code, { children: "restartLocalDaemon" }),
				" rejects with a\n",
				createVNode(_components.code, { children: "DaemonContractSkewError" }),
				", the ",
				createVNode(_components.code, { children: "recycleKaval" }),
				" rejection is an ",
				createVNode(_components.code, { children: "ORPCError" }),
				"\nwith ",
				createVNode(_components.code, { children: "code: \"KAVAL_CONTRACT_SKEW\"" }),
				" and both versions in ",
				createVNode(_components.code, { children: "data" }),
				"; red today\n(plain rethrow)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "commit-2--the-skew-becomes-a-state-with-one-honest-surface",
			children: "Commit 2 — the skew becomes a state with one honest surface"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "sk4--incompatible-a-first-class-daemon-state",
			children: [
				"SK4 — ",
				createVNode(_components.code, { children: "incompatible" }),
				": a first-class daemon state"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The discrimination already exists inside the endpoint (",
			createVNode(_components.code, { children: "SurvivorConnect = adopted | skew | unreachable" }),
			", ",
			createVNode(_components.code, { children: "endpoint.ts:476–479" }),
			") — it just dies before\nthe status surface: a recycle whose ",
			createVNode(_components.em, { children: "fresh spawn" }),
			" still skews is caught by a\nskew-blind catch and emitted ",
			createVNode(_components.code, { children: "dead" }),
			" (",
			createVNode(_components.code, { children: "endpoint.ts:427–433" }),
			"), and the padi\nbinder’s refuse arm emits ",
			createVNode(_components.code, { children: "degraded" }),
			" (",
			createVNode(_components.code, { children: "endpoint.ts:741" }),
			"). Extend, don’t\ninvent:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Seam" }),
					"\n",
					createVNode(_components.th, { children: "Change" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "endpointStates.ts" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "ENDPOINT_STATES" }),
						" gains ",
						createVNode(_components.code, { children: "\"incompatible\"" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "EndpointStatus" }), " (endpoint.ts:57)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"third arm: ",
						createVNode(_components.code, { children: "{ state: \"incompatible\"; daemonVersion; requiredVersion }" }),
						" (versions from SK2’s fields)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "spawnConnectHold" }), " catch (endpoint.ts:427)"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "isContractSkewError(err)" }),
						" → emit ",
						createVNode(_components.code, { children: "incompatible" }),
						" with versions; else ",
						createVNode(_components.code, { children: "dead" }),
						" as today"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "refuse arm (endpoint.ts:734–742)" }),
					"\n",
					createVNode(_components.td, { children: [
						"emits ",
						createVNode(_components.code, { children: "incompatible" }),
						" (was ",
						createVNode(_components.code, { children: "degraded" }),
						") — same verdict, now named"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "restart-hold coercion (endpoint.ts:307)" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "incompatible" }),
						" passes through un-coerced, like ",
						createVNode(_components.code, { children: "dead" }),
						" — it is a terminal verdict, not a transition"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "daemonStatus.ts:105" }), " fold"] }),
					"\n",
					createVNode(_components.td, { children: "threads the versions onto the wire object" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "DaemonStatusSchema" }), " (vocab.ts:577)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"a ",
						createVNode(_components.strong, { children: "third object arm" }),
						" carrying both versions; ",
						createVNode(_components.code, { children: "NON_CONNECTED_ENDPOINT_STATES" }),
						" (vocab.ts:563) excludes ",
						createVNode(_components.code, { children: "\"incompatible\"" }),
						" so the payload is spellable"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "padiBinding.ts:479" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"the session-loop condition gains the arm (",
						createVNode(_components.code, { children: "degraded || dead || incompatible" }),
						")"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "Client-side totality — every site the state-flow survey found, made exhaustive\nrather than fallthrough:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "DAEMON_STATE_PRESENTATION" }),
				" (daemonPresentation.ts:32) — compile-forced new\nrow (tone ",
				createVNode(_components.code, { children: "down" }),
				", label ",
				createVNode(_components.code, { children: "incompatible" }),
				")."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "toKavalPresence" }),
				" (daemonPresentation.ts:285) — explicit ",
				createVNode(_components.code, { children: "incompatible" }),
				" arm;\ntoday’s code would fall through to a ",
				createVNode(_components.strong, { children: "lying “warming” pulse" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "liveDownState" }),
				"’s cast (daemonPresentation.ts:191) + ",
				createVNode(_components.code, { children: "CanvasMode" }),
				"/\n",
				createVNode(_components.code, { children: "CanvasFacts" }),
				" literals (canvasModeResolver.ts:41,122) + ",
				createVNode(_components.code, { children: "DegradedCanvas" }),
				"’s\nprop (",
				createVNode(_components.code, { children: "\"dead\" | \"degraded\"" }),
				", DegradedCanvas.tsx:27) — the down union widens\nto carry the full status so the canvas can state versions; the ",
				createVNode(_components.strong, { children: ["Restart\nverb renders only on ", createVNode(_components.code, { children: "dead | degraded" })] }),
				" — affordances become a total\nfunction of the state sum, so “a restart offered against a daemon a restart\ncan’t fix” is unspellable."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "daemonConnected()" }),
				" (useDaemonStatus.ts:333) — must read ",
				createVNode(_components.strong, { children: "false" }),
				" on\n",
				createVNode(_components.code, { children: "incompatible" }),
				" (today it would read true: not warming, not in the down\nunion)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Command palette (commands.tsx:516) — “Restart kaval” excluded on\n",
				createVNode(_components.code, { children: "incompatible" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "ConnectCanvas" }),
				" (ConnectCanvas.tsx:68) — reads\n",
				createVNode(_components.code, { children: "DAEMON_STATE_PRESENTATION[state].canvasLabel" }),
				"; the new row gives it honest\ncopy for free, but the site is on the totality list so the label choice is\ndeliberate, not inherited."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Red-first pins" }),
			": supervisor unit — a recycle whose fresh spawn throws skew\nemits ",
			createVNode(_components.code, { children: "{state: \"incompatible\", daemonVersion, requiredVersion}" }),
			", never ",
			createVNode(_components.code, { children: "dead" }),
			"\n(red today at endpoint.ts:431); client unit — ",
			createVNode(_components.code, { children: "incompatible" }),
			" presents ",
			createVNode(_components.code, { children: "down" }),
			"\nwith no restart verb (red today: warming fallthrough + enabled button)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"The honest version bump — ",
				createVNode(_components.code, { children: "PADI_SURFACE_VERSION" }),
				" 4.0 → 4.1."
			] }),
			" The third\n",
			createVNode(_components.code, { children: "DaemonStatusSchema" }),
			" arm is a new ",
			createVNode(_components.strong, { children: "emitted wire variant" }),
			", and the repo’s own\nversioning doctrine (surface.ts:180–208: “the version is an honest statement\nof the wire SHAPE”; 3.1 stayed minor ",
			createVNode(_components.em, { children: "only because" }),
			" it had “no reshape, no\nrequired field, no emitted variant”) requires the minor bump. The two skew\ndirections both converge: a ",
			createVNode(_components.strong, { children: "new binder against an old padi" }),
			" (4.0 < 4.1)\nfails ",
			createVNode(_components.code, { children: "isContractVersionCompatible" }),
			"’s minor rule (define.ts:1090 — reported\nminor must be ≥ expected), so the padi convergence policy drains-and-replaces\nthe old padi before any status is consumed; an ",
			createVNode(_components.strong, { children: "old binder against a new\npadi" }),
			" is version-compatible (4.1 ≥ 4.0) but build-mismatched, so the build\naxis drains-and-replaces padi ",
			createVNode(_components.em, { children: "first" }),
			" — the old client schema never sits long\nenough against a padi that could emit the arm it can’t parse. That paragraph\nis the answer to “who reports the skew of the skew-reporter”. The symmetry\nteaches the rule: #1865 folded an orphan 4.1 bump ",
			createVNode(_components.em, { children: "back" }),
			" because there was\n",
			createVNode(_components.strong, { children: "no" }),
			" emitted delta; here the bump is required because there ",
			createVNode(_components.strong, { children: "is" }),
			"\none.",
			createVNode($$Footnote, { children: [
				"Doctrine precedents in surface.ts’s version log: 3.0/4.0 majors\nfor reshapes and removals (“only a major flips ",
				createVNode(_components.code, { children: "isContractVersionCompatible" }),
				"\nto refuse the skew”); 3.1 minor for purely-optional adds. A new emitted\nvariant sits exactly at the minor line: additive for a newer client, but a\nshape an older client must never be left facing — which the build-axis\nconvergence guarantees."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Red-first pins (SK4, completing the set):" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"refuse arm — ",
				createVNode(_components.code, { children: "adoptOrSpawnOrRefuse" }),
				" on a skewed survivor emits\n",
				createVNode(_components.code, { children: "{state: \"incompatible\", daemonVersion, requiredVersion}" }),
				" ",
				createVNode(_components.strong, { children: "and" }),
				" the\nbinder’s ",
				createVNode(_components.code, { children: "onStatus" }),
				" still resolves the dial’s ",
				createVNode(_components.code, { children: "closed" }),
				"\n(",
				createVNode(_components.code, { children: "padiBinding.ts:479" }),
				" — the ",
				createVNode(_components.code, { children: "|| incompatible" }),
				" arm is load-bearing; without\nit the session loop stops reconciling)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"restart-hold — an ",
				createVNode(_components.code, { children: "incompatible" }),
				" emit under ",
				createVNode(_components.code, { children: "restartHold" }),
				" is ",
				createVNode(_components.strong, { children: "not" }),
				"\ncoerced to ",
				createVNode(_components.code, { children: "restarting" }),
				" (endpoint.ts:307): a terminal verdict must never be\nrepainted as progress."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"palette — “Restart kaval” is omitted from the command palette on\n",
				createVNode(_components.code, { children: "incompatible" }),
				" (commands.tsx:516)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "ENDPOINT_STATES" }),
			"/",
			createVNode(_components.code, { children: "EndpointStatus" }),
			" are exported API →\n",
			createVNode(_components.code, { children: "ref-surface-supervisor.mdx" }),
			" + ",
			createVNode(_components.code, { children: "surface-daemon-invariants.mdx" }),
			" (the “failures\nreport dead before they throw” invariant gains the skew carve-out) same\ncommit. Neither drishti nor odu imports the supervisor package (grounded grep,\nzero hits)."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "sk5--one-attention-surface-per-axis-recovery",
			children: "SK5 — one attention surface, per-axis recovery"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The problem is already half-solved in the UI" }),
			" — kolu has a kaval-attention\nsurface: ",
			createVNode(_components.code, { children: "kavalStale" }),
			" (kavalCurrency.ts:31, the pure currency derivation), the\n",
			createVNode(_components.code, { children: "KavalInfoDialog" }),
			" banner (“Newer Kaval build available”, KavalInfoDialog.tsx:256–277,\nhosting the session-preserving ",
			createVNode(_components.code, { children: "RestartKavalButton" }),
			"), and the host-chip pip +\ntooltip (HostDaemonChips.tsx:353–361). The skew presentation is ",
			createVNode(_components.strong, { children: "this same\nsurface extended with the contract axis" }),
			" — not a parallel card. Two grounded\ngaps bridge it:"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "(1) Predicate." }),
			" ",
			createVNode(_components.code, { children: "kavalStale" }),
			" requires ",
			createVNode(_components.code, { children: "state === \"connected\"" }),
			" (a\nbuild-behind daemon is honestly connected) — a contract-skewed kaval ",
			createVNode(_components.strong, { children: "never\nconnects" }),
			", so the skew reaches the surface via SK4’s ",
			createVNode(_components.code, { children: "incompatible" }),
			" status\narm, not via ",
			createVNode(_components.code, { children: "kavalStale" }),
			". The join is a new single derivation in\n",
			createVNode(_components.code, { children: "kavalCurrency.ts" }),
			", superseding bare ",
			createVNode(_components.code, { children: "kavalStale" }),
			" at every read site:"
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
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " KavalAttention"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  |"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"none\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  |"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"stale\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "running"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "expected"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }          "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// currency axis — \"newer build available\""
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  |"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"incompatible\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "daemonVersion"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "requiredVersion"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " string"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }; "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// contract axis — \"incompatible, needs update\""
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#6F42C1" },
						children: "kavalAttention"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "(expected, status, live): KavalAttention"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// live-floored like kavalStale; incompatible read from the TYPED status arm — never message prose"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Both axes light the ",
			createVNode(_components.strong, { children: "one" }),
			" badge/dialog/pip, distinctly labeled, one chrome:\namber for ",
			createVNode(_components.code, { children: "stale" }),
			", the down tone for ",
			createVNode(_components.code, { children: "incompatible" }),
			". The two version pairs\nrender from typed fields (",
			createVNode(_components.code, { children: "staleKey" }),
			"/",
			createVNode(_components.code, { children: "navigableCommit" }),
			" for currency;\n",
			createVNode(_components.code, { children: "daemonVersion" }),
			"/",
			createVNode(_components.code, { children: "requiredVersion" }),
			" for contract). All three readouts — dialog\nbanner, chip pip/tooltip, and the canvas card below — call this one function;\n",
			createVNode(_components.strong, { children: "no second version-comparison site exists anywhere in the client" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "(2) Action per axis — two rows, no host split." }),
			" One dialog slot, wired per\naxis; ",
			createVNode(_components.code, { children: "incompatible" }),
			" gets ",
			createVNode(_components.strong, { children: "one" }),
			" action on ",
			createVNode(_components.strong, { children: "both" }),
			" hosts:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Axis" }),
					"\n",
					createVNode(_components.th, { children: "Action" }),
					"\n",
					createVNode(_components.th, { children: "Why it works" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "stale" }), " (any host)"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "RestartKavalButton" }),
						" → ",
						createVNode(_components.code, { children: "lifecycle.recycleKaval" }),
						" (unchanged)"
					] }),
					"\n",
					createVNode(_components.td, { children: "respawn from the padi’s own closure is exactly “converge the build”" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "incompatible" }), " (any host)"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "“Update & restart kaval”" }),
						" (confirm) → ",
						createVNode(_components.code, { children: "hosts.renewDaemon(host)" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"by the time ",
						createVNode(_components.code, { children: "incompatible" }),
						" renders, a respawn from the host’s current closure has ",
						createVNode(_components.strong, { children: "already been tried and skewed" }),
						" — the arm’s only producer is the fresh-spawn-still-skews catch (endpoint.ts:427–433; a skewed ",
						createVNode(_components.em, { children: "adopted survivor" }),
						" is recycled silently by ",
						createVNode(_components.code, { children: "adoptOrEnsure" }),
						" + ",
						createVNode(_components.code, { children: "onContractSkew: recycle" }),
						" and never reaches the UI). The only action left that changes anything is the one that changes the ",
						createVNode(_components.strong, { children: "closure" }),
						": renew."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"A local plain-restart row would offer a recovery the server has already\nproven failed — defect B relocated to the local axis — so it does not exist.\nLocal renew is the same verb through the same seam: drain the local padi →\nthe binder respawns it from the server’s own build → its converge policy\nrecycles kaval from the new ",
			createVNode(_components.code, { children: "KOLU_KAVAL_BIN" }),
			". It strictly dominates a plain\nrestart and also heals the stale-bound-padi edge cases. The action is\ndestructive to the host’s terminals (padi drains, kaval recycles), so the\ncard’s button carries a ",
			createVNode(_components.strong, { children: "confirm affordance" }),
			" — the same pattern as the\nexisting Restart confirm — whose copy states that this host’s terminals\nrestart."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "hosts.renewDaemon" }),
			" is the one new RPC: a host-keyed sibling of\n",
			createVNode(_components.code, { children: "hosts.reconnect" }),
			" (router.ts:105–108) that forwards to that host’s\n",
			createVNode(_components.code, { children: "padiSession.renew()" }),
			" (padiSession.ts:138 — the binder-owned drain: padi\npersists + exits → the reconnect loop re-dials → ",
			createVNode(_components.code, { children: "provisionAgent" }),
			" re-realises\nthe ",
			createVNode(_components.strong, { children: "current" }),
			" drv (",
			createVNode(_components.code, { children: "nixCopy.ts:138" }),
			", resolved fresh at the top of every dial,\n",
			createVNode(_components.code, { children: "sshConnector.ts:71–74" }),
			") → the ",
			createVNode(_components.code, { children: "--stdio" }),
			" front re-execs padi from the new\nclosure (",
			createVNode(_components.code, { children: "stdioBridge.ts:13–18" }),
			") → the new padi’s converge policy\nauto-recycles the old kaval from its new ",
			createVNode(_components.code, { children: "KOLU_KAVAL_BIN" }),
			"\n(",
			createVNode(_components.code, { children: "KAVAL_CONVERGENCE_POLICY.onContractSkew: recycle" }),
			", ptyHost/index.ts:71–75);\non the local host the same drain respawns padi from the server’s own build\nconstant, same converge, same fresh kaval). Every step of that pipeline\nalready exists and is the ",
			createVNode(_components.em, { children: "only" }),
			" path that changes the closure; the RPC\nmerely exposes it host-keyed."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Scope line:" }),
			" the ",
			createVNode(_components.em, { children: "padi" }),
			"-axis contract skew (",
			createVNode(_components.code, { children: "dial.ts:152" }),
			", subject\n“padiSurface”) is deliberately out of scope for this card — it already has\nits own verdict channel (",
			createVNode(_components.code, { children: "skew-refused" }),
			" → ",
			createVNode(_components.code, { children: "contract-skew-refused" }),
			" host-down\ncard), and the two flavors cannot collide on the kaval card today (a\nskew-refused padi never serves the ",
			createVNode(_components.code, { children: "daemonStatus" }),
			" collection this card reads).",
			createVNode($$Footnote, { children: [
				"Why not a new\n",
				createVNode(_components.code, { children: "PadiConvergence" }),
				" arm (“kaval-skew”) instead? Because the fact already has a\nper-host wire home — the re-served padiSurface ",
				createVNode(_components.code, { children: "daemonStatus" }),
				" collection\n(state ",
				createVNode(_components.code, { children: "incompatible" }),
				", SK4) — and the binder’s ",
				createVNode(_components.code, { children: "convergence()" }),
				" fact reaches\nthe browser only via the legacy local-hardcoded ",
				createVNode(_components.code, { children: "daemonInventory" }),
				" cell\n(useDaemonInventory.ts:41–50 flags the gap). Mirroring the same fact onto a\nsecond channel would create two authorities for one truth — the P3 defect this\nPR exists to kill. One authority per fact: ",
				createVNode(_components.strong, { children: "padi reports the skew" }),
				" (the\nstatus arm), ",
				createVNode(_components.strong, { children: "only the binder can fix it" }),
				" (the renew verb). The convergence\n",
				createVNode(_components.em, { children: "vocabulary" }),
				" is reused where it lives: ",
				createVNode(_components.code, { children: "renew()" }),
				" is the binder’s existing\nconvergence enactment, and the card’s copy speaks the same “converge” language\nas ",
				createVNode(_components.code, { children: "hostDownCopy.ts" }),
				"."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The UX flow" }),
			" (canvas card = the widened ",
			createVNode(_components.code, { children: "DegradedCanvas" }),
			" arm; dialog =\nthe extended banner):"
		] }),
		"\n",
		"\n",
		"\n",
		createVNode(SkewCardMock, {}),
		"\n",
		createVNode(DialogBannerMock, {}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Red-first pin" }),
			": client unit/e2e — on ",
			createVNode(_components.code, { children: "incompatible" }),
			" (any host) the canvas\ncard shows both versions and offers ",
			createVNode(_components.em, { children: "Update & restart kaval" }),
			" behind a\nconfirm — never the plain ",
			createVNode(_components.em, { children: "Restart kaval" }),
			". Red today: the canvas shows “kaval\ndidn’t start” + a Restart that loops forever."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "sk6--a-declared-error-channel-on-definesurface",
			children: ["SK6 — a declared error channel on ", createVNode(_components.code, { children: "defineSurface" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The framework move that kills “a typed daemon error arrives as an opaque\n",
			createVNode(_components.code, { children: "INTERNAL_SERVER_ERROR" }),
			"” as a class. The pinned oRPC (",
			createVNode(_components.code, { children: "1.13.13" }),
			", every\n",
			createVNode(_components.code, { children: "@orpc/*" }),
			" in pnpm-lock.yaml) carries the full contract-level typed-error API —\n",
			createVNode(_components.code, { children: ".errors()" }),
			" on every builder stage, handler-side ",
			createVNode(_components.code, { children: "opts.errors" }),
			" constructor\nmaps, client-side ",
			createVNode(_components.code, { children: "isDefinedError" }),
			"/",
			createVNode(_components.code, { children: "safe" }),
			" — and kolu uses none of it:\n",
			createVNode(_components.code, { children: "ProcedureSpec" }),
			" (define.ts:227) has no error slot, so a procedure ",
			createVNode(_components.em, { children: "cannot\ndeclare" }),
			" its failure modes."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "ProcedureSpec" }),
					" gains ",
					createVNode(_components.code, { children: "errors?" })
				] }),
				": ",
				createVNode(_components.code, { children: "Record<CODE, { data?: ZodType; message?: string }>" }),
				" — additive and optional, so every existing spec literal\ncompiles unchanged (verified against drishti’s and odu’s spec shapes at\ntheir pins, including drishti’s ",
				createVNode(_components.code, { children: "procedures: mirroredAgentSurface.spec.procedures" }),
				"\nspec-object reuse)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Runtime + type oracles move in lockstep" }),
				" (the define.ts:779 drift-watch):\n",
				createVNode(_components.code, { children: "procedureContractEntry" }),
				" (define.ts:408) applies ",
				createVNode(_components.code, { children: ".errors()" }),
				"; the four\n",
				createVNode(_components.code, { children: "buildProcedure*" }),
				" oracles (define.ts:845–859) and ",
				createVNode(_components.code, { children: "ProcedureContract" }),
				"\n(define.ts:604) thread the error map so the contract type carries it."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Server half is nearly free" }),
				": ",
				createVNode(_components.code, { children: "implementSurface" }),
				" already spreads oRPC’s\nhandler opts (",
				createVNode(_components.code, { children: "server.ts:2500" }),
				"), so a declaring procedure’s handler receives\nthe typed ",
				createVNode(_components.code, { children: "opts.errors.KAVAL_CONTRACT_SKEW({ data })" }),
				" constructors with no\nsurface plumbing."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Client half" }),
				": ",
				createVNode(_components.code, { children: "BoundProcedure" }),
				" (surfaceClient.ts:354) currently erases\nthe rejection type; it gains the declared union so a catch narrows with\n",
				createVNode(_components.code, { children: "isDefinedError(e)" }),
				" to a discriminated ",
				createVNode(_components.code, { children: "{ code, data }" }),
				". ",
				createVNode(_components.code, { children: "mirrorRemoteSurface" }),
				"’s\nforwarders and surface-map’s folded contract pass declared errors through\nuntouched (both forward the raw oRPC callable — grounded; the relay\n“re-throws genuine application errors UNCHANGED”, client.ts:116)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Adoption in this PR" }),
				": ",
				createVNode(_components.code, { children: "padiSurface.lifecycle.recycleKaval" }),
				" declares\n",
				createVNode(_components.code, { children: "KAVAL_CONTRACT_SKEW" }),
				" with ",
				createVNode(_components.code, { children: "data: { daemonVersion, requiredVersion }" }),
				"; the\nSK3 handler moves from the ad-hoc ",
				createVNode(_components.code, { children: "new ORPCError(…)" }),
				" to\n",
				createVNode(_components.code, { children: "opts.errors.KAVAL_CONTRACT_SKEW(…)" }),
				"; ",
				createVNode(_components.code, { children: "useDaemonRestart" }),
				"’s catch\ndiscriminates and feeds the same typed pair the SK5 chrome renders."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Honest scope." }),
				" Declared-error adoption for the ",
				createVNode(_components.em, { children: "other" }),
				" existing surfaces\n(surface-map’s ",
				createVNode(_components.code, { children: "MAP_KEY_UNKNOWN" }),
				"/",
				createVNode(_components.code, { children: "MAP_ENTRY_FAILED" }),
				"/",
				createVNode(_components.code, { children: "MAP_KEY_NON_CANONICAL" }),
				"\nad-hoc codes, padi’s remaining lifecycle verbs, kaval’s ",
				createVNode(_components.code, { children: "ptyHostSurface" }),
				") is\na stated migration path, not this PR — each is a mechanical\n",
				createVNode(_components.code, { children: "errors:" }),
				"-declaration + handler move on an already-built channel. And a\nTypeScript limit, stated plainly: TS cannot type ",
				createVNode(_components.code, { children: "throw" }),
				" statements, so “an\nundeclared plain-Error throw is a compile error” is achievable only for the\n",
				createVNode(_components.em, { children: "client’s" }),
				" catch-narrowing and the ",
				createVNode(_components.em, { children: "handler’s" }),
				" constructor path — an\nundeclared throw still reaches the client as ",
				createVNode(_components.code, { children: "INTERNAL_SERVER_ERROR" }),
				" at\nruntime. That remaining path is the fail-fast crash-loudly channel, which is\ncorrect; what the channel kills is the flattening of errors a procedure\n",
				createVNode(_components.em, { children: "meant" }),
				" to be actionable.",
				createVNode($$Footnote, { children: [
					"Full “inexpressible” would need a lint\nforbidding bare ",
					createVNode(_components.code, { children: "throw" }),
					" in surface handlers — worth considering once more\nthan one surface has adopted the channel; deliberately out of scope\nhere."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "ProcedureSpec" }),
				"/",
				createVNode(_components.code, { children: "defineSurface" }),
				" are exported API → ",
				createVNode(_components.code, { children: "ref-surface.mdx" }),
				" same\ncommit."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Red-first pins" }),
			": type-level (",
			createVNode(_components.code, { children: ".test-d.ts" }),
			") — a declaring procedure’s\nclient rejection narrows via ",
			createVNode(_components.code, { children: "isDefinedError" }),
			" to the declared\n",
			createVNode(_components.code, { children: "{daemonVersion, requiredVersion}" }),
			" data, ",
			createVNode(_components.strong, { children: [
				"and ",
				createVNode(_components.code, { children: "errors?" }),
				" is threaded through\nall four ",
				createVNode(_components.code, { children: "buildProcedure*" }),
				" oracles"
			] }),
			" (define.ts:845–859, the define.ts:779\ndrift-watch) — not just the shape ",
			createVNode(_components.code, { children: "recycleKaval" }),
			" happens to use; runtime —\nthe declared error ",
			createVNode(_components.strong, { children: "crosses the incident hop" }),
			": minted by a handler ",
			createVNode(_components.em, { children: "behind" }),
			"\n",
			createVNode(_components.code, { children: "surface-map" }),
			"’s keyed proxy + ",
			createVNode(_components.code, { children: "mirrorRemoteSurface" }),
			" (the exact path the field\nfailure flattened at, server.ts:534) and arrives at the client\n",
			createVNode(_components.code, { children: "defined: true" }),
			" with data intact, while an undeclared plain throw still\narrives as ",
			createVNode(_components.code, { children: "INTERNAL_SERVER_ERROR" }),
			". That pin is the incident as a permanent\nregression test."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "gates--consumers-docs-evidence",
			children: "Gates — consumers, docs, evidence"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Consumer gate" }),
			" (",
			createVNode(_components.code, { children: ".claude/rules/surface.md" }),
			"), grounded greps at both pins:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Consumer" }),
					"\n",
					createVNode(_components.th, { children: "Exposure" }),
					"\n",
					createVNode(_components.th, { children: "Verdict" }),
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
						"drishti (",
						createVNode(_components.code, { children: "hostRegistry.ts:92" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "makeSession" }),
						" — passes ",
						createVNode(_components.strong, { children: "no" }),
						" ",
						createVNode(_components.code, { children: "onLog" }),
						"; specs don’t spell ",
						createVNode(_components.code, { children: "errors" }),
						"; no supervisor import"
					] }),
					"\n",
					createVNode(_components.td, { children: "pair PR = pin bump to final kolu HEAD, no code change expected; CI green required" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"odu (",
						createVNode(_components.code, { children: "lane.ts:69" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "makeSession" }),
						" — no ",
						createVNode(_components.code, { children: "onLog" }),
						"; depends on the ",
						createVNode(_components.strong, { children: "default stderr sink" }),
						" (",
						createVNode(_components.code, { children: "display.ts:26" }),
						"), which SK1 preserves; no supervisor import"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"SK1/SK2/SK4: ",
						createVNode(_components.code, { children: "none" }),
						" · SK6: ",
						createVNode(_components.code, { children: "adoption-opportunity" }),
						" (declared errors for ",
						createVNode(_components.code, { children: "node.rerun" }),
						"/",
						createVNode(_components.code, { children: "run.cancel" }),
						") → ledger odu#43"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Docs, same PR" }),
			": ",
			createVNode(_components.code, { children: "ref-surface-remote.mdx" }),
			" (SK1 — also fixes the stale\n“info for the expected-absent case” line at :154–157; the code emits ",
			createVNode(_components.code, { children: "debug" }),
			"),\n",
			createVNode(_components.code, { children: "ref-surface-supervisor.mdx" }),
			" (SK2, SK4), ",
			createVNode(_components.code, { children: "surface-daemon-invariants.mdx" }),
			"\n(SK4), ",
			createVNode(_components.code, { children: "ref-surface.mdx" }),
			" (SK6), ",
			createVNode(_components.code, { children: "packages/padi/README.md" }),
			" +\n",
			createVNode(_components.code, { children: "packages/kaval/README.md" }),
			" if the daemon-topology prose mentions restart\nsemantics (grep at build time), changelog: one ",
			createVNode(_components.code, { children: "fixed" }),
			" entry (the user-facing\nskew UX) + one ",
			createVNode(_components.code, { children: "changed" }),
			" entry (the surface framework’s declared error\nchannel)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Evidence — prove the recovery, not just the card." }),
			" The remote-host skew is\nexactly what the ",
			createVNode(_components.code, { children: "remote-host-testing" }),
			" harness exists for, and gate criterion\n2’s “the working recovery” must be ",
			createVNode(_components.em, { children: "shown working" }),
			" on the ",
			createVNode(_components.strong, { children: "incident\ntopology" }),
			": a current-contract padi + an ",
			createVNode(_components.strong, { children: "ancient adoptable kaval survivor" }),
			"\non the box (the field trace’s shape — the “needs 5.2” constant was compiled\ninto the remote padi that threw, so the padi was current and the kaval was\nthe graveyard survivor). Capture: (before) the dead-end Restart loop /\nopaque toast; (after) the ",
			createVNode(_components.code, { children: "incompatible" }),
			" card with both versions, then\n",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "hosts.renewDaemon" }), " actually converging the host"] }),
			" — a fresh\ncorrect-version kaval connects and the canvas comes back. CI: linux pu lease"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: "darwin per coordinator arbitration." }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Evidence captured (PR #1876) — and a D2 recipe correction",
			children: [
				createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Reproduce-first surfaced two dead ends in the naïve manufacture" }), ", both\nbanked as positive facts:"] }),
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: [
							"A ",
							createVNode(_components.code, { children: "KOLU_KAVAL_BIN" }),
							" env override can’t produce the skew"
						] }),
						" — the built\nwrapper ",
						createVNode(_components.em, { children: "force" }),
						"-",
						createVNode(_components.code, { children: "export" }),
						"s it (a plain ",
						createVNode(_components.code, { children: "export" }),
						", overriding inherited env),\nso an ambient override never reaches padi’s kaval spawn."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "Planting an old kaval at the adopt-hint socket self-heals" }),
						" — a\n",
						createVNode(_components.em, { children: "current" }),
						" padi that adopts a 5.0 survivor recycles it (",
						createVNode(_components.code, { children: "onSkew → recycle → spawnConnectHold" }),
						") and respawns its ",
						createVNode(_components.strong, { children: "baked" }),
						" current kaval, converging\nwith no ",
						createVNode(_components.code, { children: "incompatible" }),
						" ever reaching the UI. So the card appears ",
						createVNode(_components.strong, { children: "only" }),
						"\nwhen padi’s ",
						createVNode(_components.em, { children: "own closure" }),
						" is stale — which delimits exactly when\n",
						createVNode(_components.code, { children: "renewDaemon" }),
						" (re-realise the closure) is the right recovery."
					] }),
					"\n"
				] }),
				createVNode(_components.p, { children: [
					"A genuine ",
					createVNode(_components.code, { children: "incompatible" }),
					" therefore needs padi’s ",
					createVNode(_components.strong, { children: "baked" }),
					" kaval to be old.\nThe capture wires the real ",
					createVNode(_components.code, { children: "packages/kaval" }),
					" build from ",
					createVNode(_components.strong, { children: createVNode(_components.code, { children: "c9fd9a2bf" }) }),
					" (the\nlast 5.0-era commit, before the 5.0→5.2 bump in ",
					createVNode(_components.code, { children: "557e08a86" }),
					"/#1783) into\npadi’s closure, so the current padi spawns a genuine 5.0 kaval → the real\n",
					createVNode(_components.code, { children: "connectKaval" }),
					"→",
					createVNode(_components.code, { children: "spawnConnectHold" }),
					" skew → ",
					createVNode(_components.code, { children: "incompatible(5.0, 5.2)" }),
					". Captured\nin a real browser: the card with both typed versions + “Update & restart\nkaval”; then ",
					createVNode(_components.code, { children: "hosts.renewDaemon" }),
					" → drain → re-realise (to the real 5.2\nkaval) → the chip flips to ",
					createVNode(_components.strong, { children: "running · contract v5.2" }),
					" and the canvas\nreturns. Both frames on the PR’s ",
					createVNode(_components.code, { children: "## Evidence" }),
					" comment."
				] })
			]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "What commit 2 does NOT do",
			children: createVNode(_components.p, { children: [
				"No override knobs, no config to re-enable Restart on a skewed daemon, no\nretry loops, no fallback path that hides a skew as ",
				createVNode(_components.code, { children: "degraded" }),
				". A skewed\ndaemon is ",
				createVNode(_components.code, { children: "incompatible" }),
				", the UI says so with both versions, and the one\nrecovery offered is the one the evidence proves works on the incident\ntopology."
			] })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Design — kaval contract skew: two commits to kill the class",
	"description": "The build-ready design for the remote-kaval contract-skew fix: commit 1 repairs the three defects at their seams (log bridge, version-bearing error, typed rethrow); commit 2 fortifies the surface framework (an incompatible daemon state, one kaval-attention surface with per-axis recovery, a declared error channel on defineSurface).",
	"parents": ["bug-remote-kaval-contract-skew", "surface"],
	"status": "implemented",
	"maturity": "seedling",
	"updated": "2026-07-16T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "how-this-honors-the-design-philosophy",
			"text": "How this honors the design philosophy"
		},
		{
			"depth": 2,
			"slug": "gate-criteria-binding",
			"text": "Gate criteria (binding)"
		},
		{
			"depth": 2,
			"slug": "commit-1--the-repairs",
			"text": "Commit 1 — the repairs"
		},
		{
			"depth": 3,
			"slug": "sk1--the-log-bridge-a-receiver-bound-logger-seam",
			"text": "SK1 — the log bridge: a receiver-bound Logger seam"
		},
		{
			"depth": 3,
			"slug": "sk2--the-error-carries-its-versions",
			"text": "SK2 — the error carries its versions"
		},
		{
			"depth": 3,
			"slug": "sk3--typed-rethrow-at-the-knowing-endpoint",
			"text": "SK3 — typed rethrow at the knowing endpoint"
		},
		{
			"depth": 2,
			"slug": "commit-2--the-skew-becomes-a-state-with-one-honest-surface",
			"text": "Commit 2 — the skew becomes a state with one honest surface"
		},
		{
			"depth": 3,
			"slug": "sk4--incompatible-a-first-class-daemon-state",
			"text": "SK4 — incompatible: a first-class daemon state"
		},
		{
			"depth": 3,
			"slug": "sk5--one-attention-surface-per-axis-recovery",
			"text": "SK5 — one attention surface, per-axis recovery"
		},
		{
			"depth": 3,
			"slug": "sk6--a-declared-error-channel-on-definesurface",
			"text": "SK6 — a declared error channel on defineSurface"
		},
		{
			"depth": 2,
			"slug": "gates--consumers-docs-evidence",
			"text": "Gates — consumers, docs, evidence"
		}
	];
}
var url = "src/content/atlas/kaval-skew-fix-design.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-skew-fix-design.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/kaval-skew-fix-design.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, DialogBannerMock, SkewCardMock, file, frontmatter, getHeadings, url };
