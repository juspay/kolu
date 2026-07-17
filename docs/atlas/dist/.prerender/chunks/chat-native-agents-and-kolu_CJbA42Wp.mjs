import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$Phase } from "./Phase_DctZ6fpy.mjs";
import { t as $$PhaseTree } from "./PhaseTree_4mRXZwaI.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
import { t as $$Footnote } from "./Footnote_Co54bi9w.mjs";
//#region src/diagrams/chat-native-agents-stack.svg?raw
var chat_native_agents_stack_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 760 612\" font-family=\"ui-sans-serif, system-ui, sans-serif\" role=\"img\" aria-label=\"kolu in one picture, drawn as three bands with two different relationships rather than a rigid dependency tower. On top, XS — the chat app: an independent app that already runs without kolu and owns chat, presence, identity and login, and who-may-write. It integrates kolu through one seam: observe (read) plus act (write). In the middle, kolu — the terminal/file foundation: kaval owns each live terminal and serializes writes, padi watches every terminal as read-only awareness, and @kolu/surface is the typed wire over any transport. kolu runs headlessly on any machine and is model-agnostic across claude, codex, and opencode. At the bottom, any machine kolu runs on: your laptop, a server, or a remote sandbox — an Incus cluster owned by another team, naturally supported because a remote host is just another place to dial the surface. The top relationship is integration; the bottom relationship is execution; chat, presence, and login live in XS.\">\n  <defs>\n    <marker id=\"st-arrow\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0L10 5L0 10z\" fill=\"#475569\"/>\n    </marker>\n    <style>\n      .st-title  { fill:#0f172a; font-size:16px; font-weight:700; }\n      .st-sub    { fill:#64748b; font-size:11.5px; }\n      .st-mono   { font-family:ui-monospace, \"SF Mono\", Menlo, monospace; }\n\n      .amber-box { fill:#FBF1DC; stroke:#B45309; stroke-width:2; }\n      .amber-t   { fill:#92400E; font-size:15px; font-weight:700; }\n      .amber-s   { fill:#7a4f00; font-size:11.5px; }\n      .amber-badge { fill:#B45309; font-size:10px; font-weight:700; letter-spacing:0.09em; }\n\n      .blue-box  { fill:#EDF0FD; stroke:#0D32B2; stroke-width:2; }\n      .blue-leaf { fill:#F7F9FF; stroke:#9DB0EE; stroke-width:1.5; }\n      .blue-t    { fill:#0D32B2; font-size:15px; font-weight:700; }\n      .blue-s    { fill:#4A5072; font-size:11.5px; }\n      .leaf-t    { fill:#0A0F25; font-size:13px; font-weight:700; }\n      .leaf-s    { fill:#4A5072; font-size:10.5px; }\n      .blue-badge { fill:#0D32B2; font-size:10px; font-weight:700; letter-spacing:0.09em; }\n\n      .green-box { fill:#E6F4EA; stroke:#15803D; stroke-width:2; }\n      .green-t   { fill:#14532D; font-size:15px; font-weight:700; }\n      .green-s   { fill:#166534; font-size:11.5px; }\n      .green-badge { fill:#15803D; font-size:10px; font-weight:700; letter-spacing:0.09em; }\n\n      .edge      { stroke:#475569; stroke-width:2.25; fill:none; }\n      .elabel    { fill:#475569; font-size:11px; font-style:italic; }\n      .foot      { fill:#475569; font-size:11px; font-style:italic; }\n    </style>\n  </defs>\n\n  <text class=\"st-title\" x=\"40\" y=\"34\">kolu in one picture &#8212; the foundation a chat app integrates</text>\n  <text class=\"st-sub\" x=\"40\" y=\"55\">XS integrates kolu &#183; kolu runs headlessly on any machine &#8212; local or a remote sandbox</text>\n\n  <!-- TOP: XS (the app) -->\n  <rect class=\"amber-box\" x=\"110\" y=\"84\" width=\"540\" height=\"112\" rx=\"11\"/>\n  <text class=\"amber-t\" x=\"380\" y=\"112\" text-anchor=\"middle\">XS &#8212; the chat app</text>\n  <text class=\"amber-s\" x=\"380\" y=\"133\" text-anchor=\"middle\">an independent app &#8212; it already runs without kolu</text>\n  <text class=\"amber-s st-mono\" x=\"380\" y=\"162\" text-anchor=\"middle\" font-size=\"11px\">chat &#183; presence &#183; identity &amp; login &#183; who-may-write</text>\n  <text class=\"amber-badge\" x=\"632\" y=\"105\" text-anchor=\"end\">THE APP</text>\n\n  <!-- arrow XS -> kolu (integration) -->\n  <path class=\"edge\" d=\"M380 196 L380 236\" marker-end=\"url(#st-arrow)\"/>\n  <text class=\"elabel\" x=\"392\" y=\"221\" text-anchor=\"start\">integrates one seam: observe (read) + act (write)</text>\n\n  <!-- MIDDLE: kolu (the foundation) -->\n  <rect class=\"blue-box\" x=\"80\" y=\"236\" width=\"600\" height=\"192\" rx=\"12\"/>\n  <text class=\"blue-t\" x=\"380\" y=\"263\" text-anchor=\"middle\">kolu &#8212; the terminal / file foundation</text>\n  <text class=\"blue-s\" x=\"380\" y=\"283\" text-anchor=\"middle\">runs headlessly on any machine &#183; watches the terminals &#183; model-agnostic (claude &#183; codex &#183; opencode)</text>\n  <text class=\"blue-badge\" x=\"662\" y=\"257\" text-anchor=\"end\">THE FOUNDATION</text>\n\n  <rect class=\"blue-leaf\" x=\"98\" y=\"300\" width=\"186\" height=\"106\" rx=\"7\"/>\n  <text class=\"leaf-t\" x=\"191\" y=\"324\" text-anchor=\"middle\">kaval</text>\n  <text class=\"leaf-s\" x=\"191\" y=\"344\" text-anchor=\"middle\">owns each live terminal</text>\n  <text class=\"leaf-s\" x=\"191\" y=\"361\" text-anchor=\"middle\">spawn &#183; write &#183; kill &#183; resize</text>\n  <text class=\"leaf-s\" x=\"191\" y=\"382\" text-anchor=\"middle\">serializes writes &#183; last wins</text>\n\n  <rect class=\"blue-leaf\" x=\"294\" y=\"300\" width=\"186\" height=\"106\" rx=\"7\"/>\n  <text class=\"leaf-t\" x=\"387\" y=\"324\" text-anchor=\"middle\">padi</text>\n  <text class=\"leaf-s\" x=\"387\" y=\"344\" text-anchor=\"middle\">watches every terminal</text>\n  <text class=\"leaf-s\" x=\"387\" y=\"361\" text-anchor=\"middle\">agent sensors + sessions:</text>\n  <text class=\"leaf-s\" x=\"387\" y=\"378\" text-anchor=\"middle\">a &#8220;who needs me&#8221; board</text>\n\n  <rect class=\"blue-leaf\" x=\"490\" y=\"300\" width=\"172\" height=\"106\" rx=\"7\"/>\n  <text class=\"leaf-t\" x=\"576\" y=\"324\" text-anchor=\"middle\">@kolu/surface</text>\n  <text class=\"leaf-s\" x=\"576\" y=\"344\" text-anchor=\"middle\">the typed wire</text>\n  <text class=\"leaf-s\" x=\"576\" y=\"361\" text-anchor=\"middle\">over any transport:</text>\n  <text class=\"leaf-s st-mono\" x=\"576\" y=\"378\" text-anchor=\"middle\" font-size=\"10px\">socket &#183; ssh &#183; remote hosts</text>\n\n  <!-- arrow kolu -> machine (execution) -->\n  <path class=\"edge\" d=\"M380 428 L380 470\" marker-end=\"url(#st-arrow)\"/>\n  <text class=\"elabel\" x=\"392\" y=\"454\" text-anchor=\"start\">runs headlessly on &#183; dials a remote host over an authenticated link</text>\n\n  <!-- BOTTOM: any machine -->\n  <rect class=\"green-box\" x=\"150\" y=\"470\" width=\"460\" height=\"86\" rx=\"11\"/>\n  <text class=\"green-t\" x=\"380\" y=\"498\" text-anchor=\"middle\">any machine kolu runs on</text>\n  <text class=\"green-s\" x=\"380\" y=\"518\" text-anchor=\"middle\">your laptop &#183; a server &#183; a remote sandbox host</text>\n  <text class=\"green-s\" x=\"380\" y=\"536\" text-anchor=\"middle\">Incus cluster (another team) &#8212; naturally supported</text>\n  <text class=\"green-badge\" x=\"596\" y=\"491\" text-anchor=\"end\">RUNS ON</text>\n\n  <!-- footer -->\n  <text class=\"foot\" x=\"380\" y=\"586\" text-anchor=\"middle\">XS integrates kolu; kolu runs headlessly on any machine &#8212; local or a remote sandbox. Chat, presence, and login live in XS.</text>\n</svg>\n";
//#endregion
//#region src/diagrams/chat-native-agents-bridge.svg?raw
var chat_native_agents_bridge_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 760 668\" font-family=\"ui-sans-serif, system-ui, sans-serif\" role=\"img\" aria-labelledby=\"title desc\">\n  <title id=\"title\">The seam — observe out raw; act in through the coordinator</title>\n  <desc id=\"desc\">XS, the chat app, sits on top and owns identity, login, presence, and attribution. Two channels connect it to kolu below. The green OBSERVE channel flows out of padi raw and read-only: the who-needs-me board, attention pings, and deep links into kolu for depth. The blue ACT channel flows in through one door: the coordinator, an orchestrator agent running in an ordinary kolu terminal, whose inbox is the write floor and which also assists the humans' own discussion. Inside the kolu machine, the coordinator terminal drives the worker terminals with the fleet loop — create, send, wait, snapshot — while padi watches every terminal with agent sensors and owns durable sessions, and kaval owns each PTY as its single writer. Chat has no raw write verbs on workers; that absence is the design.</desc>\n  <defs>\n    <marker id=\"arrG\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"4.5\" orient=\"auto\">\n      <path d=\"M0 0 L8 4.5 L0 9 z\" fill=\"#15803D\" />\n    </marker>\n    <marker id=\"arrB\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"4.5\" orient=\"auto\">\n      <path d=\"M0 0 L8 4.5 L0 9 z\" fill=\"#0D32B2\" />\n    </marker>\n    <marker id=\"arrK\" markerWidth=\"9\" markerHeight=\"9\" refX=\"7\" refY=\"4.5\" orient=\"auto\">\n      <path d=\"M0 0 L8 4.5 L0 9 z\" fill=\"#64748b\" />\n    </marker>\n  </defs>\n\n  <rect width=\"760\" height=\"668\" fill=\"#fbfbfd\" />\n  <text x=\"40\" y=\"34\" font-size=\"17\" font-weight=\"700\" fill=\"#1a1c20\">The seam — observe out raw · act through the coordinator</text>\n  <text x=\"40\" y=\"54\" font-size=\"12\" fill=\"#5b6472\">one attributed inbox is the write floor · chat never writes to a worker terminal</text>\n\n  <!-- XS box -->\n  <rect x=\"40\" y=\"72\" width=\"680\" height=\"84\" rx=\"10\" fill=\"#ffffff\" stroke=\"#cbd2dc\" stroke-width=\"1.5\" />\n  <text x=\"60\" y=\"100\" font-size=\"14\" font-weight=\"700\" fill=\"#1a1c20\">XS — the chat app</text>\n  <text x=\"60\" y=\"120\" font-size=\"12\" fill=\"#5b6472\">owns identity · login · presence · attribution — humans discuss here, the coordinator participates</text>\n  <text x=\"60\" y=\"140\" font-size=\"12\" fill=\"#5b6472\">renders the board · pings attention · deep-links into kolu for depth</text>\n\n  <!-- OBSERVE channel (green, up) -->\n  <line x1=\"150\" y1=\"296\" x2=\"150\" y2=\"162\" stroke=\"#15803D\" stroke-width=\"2.5\" marker-end=\"url(#arrG)\" />\n  <text x=\"94\" y=\"188\" font-size=\"12.5\" font-weight=\"700\" fill=\"#15803D\">OBSERVE — raw · read-only</text>\n  <text x=\"94\" y=\"207\" font-size=\"11.5\" fill=\"#3f6212\">the board straight off padi:</text>\n  <text x=\"94\" y=\"223\" font-size=\"11.5\" fill=\"#3f6212\">working · asking you · just finished</text>\n  <text x=\"94\" y=\"239\" font-size=\"11.5\" fill=\"#3f6212\">attention pings the thread</text>\n  <text x=\"94\" y=\"255\" font-size=\"11.5\" fill=\"#3f6212\">deep links → depth in kolu itself</text>\n\n  <!-- ACT channel (blue, down into the coordinator terminal) -->\n  <line x1=\"560\" y1=\"162\" x2=\"560\" y2=\"330\" stroke=\"#0D32B2\" stroke-width=\"2.5\" marker-end=\"url(#arrB)\" />\n  <text x=\"430\" y=\"188\" font-size=\"12.5\" font-weight=\"700\" fill=\"#0D32B2\">ACT — one door</text>\n  <text x=\"430\" y=\"207\" font-size=\"11.5\" fill=\"#31437c\">thread messages, attributed,</text>\n  <text x=\"430\" y=\"223\" font-size=\"11.5\" fill=\"#31437c\">land in the coordinator's inbox —</text>\n  <text x=\"430\" y=\"239\" font-size=\"11.5\" fill=\"#31437c\">the write floor, serialized by</text>\n  <text x=\"430\" y=\"255\" font-size=\"11.5\" fill=\"#31437c\">conversation, not by locks</text>\n\n  <!-- kolu machine box -->\n  <rect x=\"40\" y=\"296\" width=\"680\" height=\"322\" rx=\"10\" fill=\"#f4f6f9\" stroke=\"#cbd2dc\" stroke-width=\"1.5\" />\n  <text x=\"60\" y=\"322\" font-size=\"13\" font-weight=\"700\" fill=\"#1a1c20\">KOLU — on one machine, or several (local + ssh remotes behind one host switcher)</text>\n\n  <!-- coordinator terminal -->\n  <rect x=\"70\" y=\"340\" width=\"290\" height=\"112\" rx=\"8\" fill=\"#ffffff\" stroke=\"#0D32B2\" stroke-width=\"2\" />\n  <text x=\"86\" y=\"364\" font-size=\"12.5\" font-weight=\"700\" fill=\"#0D32B2\">the coordinator terminal</text>\n  <text x=\"86\" y=\"382\" font-size=\"11.5\" fill=\"#3c4553\">an orchestrator agent in an ordinary PTY</text>\n  <text x=\"86\" y=\"398\" font-size=\"11.5\" fill=\"#3c4553\">/orchestrator contract: claims verified at the</text>\n  <text x=\"86\" y=\"414\" font-size=\"11.5\" fill=\"#3c4553\">tree · grounded rulings · recorded-PIDs-only</text>\n  <text x=\"86\" y=\"430\" font-size=\"11.5\" fill=\"#3c4553\">teardown · the human merges every PR</text>\n\n  <!-- fleet loop arrow -->\n  <line x1=\"360\" y1=\"396\" x2=\"428\" y2=\"396\" stroke=\"#64748b\" stroke-width=\"2\" marker-end=\"url(#arrK)\" />\n  <text x=\"394\" y=\"384\" font-size=\"10.5\" fill=\"#5b6472\" text-anchor=\"middle\">the fleet loop</text>\n  <text x=\"394\" y=\"414\" font-size=\"10.5\" fill=\"#5b6472\" text-anchor=\"middle\">create · send ·</text>\n  <text x=\"394\" y=\"428\" font-size=\"10.5\" fill=\"#5b6472\" text-anchor=\"middle\">wait · snapshot</text>\n\n  <!-- worker terminals -->\n  <rect x=\"430\" y=\"340\" width=\"260\" height=\"112\" rx=\"8\" fill=\"#ffffff\" stroke=\"#cbd2dc\" stroke-width=\"1.5\" />\n  <text x=\"446\" y=\"364\" font-size=\"12.5\" font-weight=\"700\" fill=\"#1a1c20\">worker terminals</text>\n  <text x=\"446\" y=\"382\" font-size=\"11.5\" fill=\"#3c4553\">claude · codex · opencode — one task each,</text>\n  <text x=\"446\" y=\"398\" font-size=\"11.5\" fill=\"#3c4553\">own git worktree, briefs + report-back tokens,</text>\n  <text x=\"446\" y=\"414\" font-size=\"11.5\" fill=\"#3c4553\">questions routed back to the coordinator</text>\n  <text x=\"446\" y=\"430\" font-size=\"11.5\" fill=\"#3c4553\">(never answered in their own PTY)</text>\n\n  <!-- padi bar -->\n  <rect x=\"70\" y=\"472\" width=\"620\" height=\"52\" rx=\"8\" fill=\"#ffffff\" stroke=\"#15803D\" stroke-width=\"1.5\" />\n  <text x=\"86\" y=\"493\" font-size=\"12.5\" font-weight=\"700\" fill=\"#15803D\">padi — agent sensors + durable sessions</text>\n  <text x=\"86\" y=\"511\" font-size=\"11.5\" fill=\"#3c4553\">watches every terminal without touching it · folds to the board · owns restore identity across restarts</text>\n\n  <!-- kaval bar -->\n  <rect x=\"70\" y=\"536\" width=\"620\" height=\"52\" rx=\"8\" fill=\"#ffffff\" stroke=\"#cbd2dc\" stroke-width=\"1.5\" />\n  <text x=\"86\" y=\"557\" font-size=\"12.5\" font-weight=\"700\" fill=\"#1a1c20\">kaval — owns each live PTY, the single writer</text>\n  <text x=\"86\" y=\"575\" font-size=\"11.5\" fill=\"#3c4553\">spawn · write · kill · resize — serializes input, last one wins · mirrors every screen</text>\n\n  <text x=\"380\" y=\"648\" font-size=\"11.5\" fill=\"#5b6472\" text-anchor=\"middle\">kolu authenticates nothing — the connection is the trust. Chat has no raw write verbs on workers: that absence is the design.</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/chat-native-agents-and-kolu.mdx
var PESU = [
	{
		d: 0,
		g: "▶",
		c: "next",
		l: "B0 · the round trip — a chat-driven coordinator",
		m: "ships on today's XS",
		h: "#b0"
	},
	{
		d: 0,
		g: "○",
		c: "todo",
		l: "B1 · the board — fleet status from chat",
		m: "needs B0",
		h: "#b1"
	},
	{
		d: 0,
		g: "○",
		c: "last",
		l: "B2 · the live mirror — the thread as campaign feed",
		m: "needs B0 · a policy switch, no new wire",
		h: "#b2"
	}
];
var PesuStyles = () => createVNode("style", { children: `
  .pe-frame{font-family:ui-sans-serif,system-ui,sans-serif;max-width:33rem;margin:1.5rem 0 .4rem;border:1px solid #e6e2d6;border-radius:14px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,.06);background:#fff}
  .pe-bar{display:flex;align-items:center;gap:.5rem;padding:.6rem .9rem;background:#FBF1DC;border-bottom:1px solid #ecd9b0}
  .pe-hash{font:700 .82rem/1 ui-sans-serif,system-ui;color:#92400E}
  .pe-sub{font:.72rem/1 ui-sans-serif,system-ui;color:#9a7b3a}
  .pe-badge{margin-left:auto;font:700 .56rem/1 ui-sans-serif,system-ui;letter-spacing:.1em;color:#B45309;border:1px solid #e0c690;border-radius:5px;padding:.26rem .42rem}
  .pe-thread{padding:.8rem .9rem 1rem;display:flex;flex-direction:column;gap:.9rem;background:#fcfcfd}
  .pe-msg{display:flex;gap:.6rem;align-items:flex-start}
  .pe-av{flex:none;width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;font:700 .64rem/1 ui-sans-serif,system-ui;color:#fff}
  .pe-av-h{background:#475569}
  .pe-av-b{background:#0D32B2}
  .pe-body{flex:1;min-width:0}
  .pe-meta{display:flex;align-items:center;gap:.4rem;margin-bottom:.22rem}
  .pe-meta b{color:#1a1c20;font:700 .74rem/1 ui-sans-serif,system-ui}
  .pe-tag{font:700 .52rem/1 ui-sans-serif,system-ui;letter-spacing:.08em;color:#0D32B2;background:#EDF0FD;border:1px solid #c7d2f5;border-radius:4px;padding:.16rem .3rem}
  .pe-time{color:#9aa3af;font:.66rem/1 ui-sans-serif,system-ui}
  .pe-bub{font:.8rem/1.45 ui-sans-serif,system-ui;color:#26303b}
  .pe-bub code{font:.74rem ui-monospace,monospace;background:#eef1f5;border-radius:4px;padding:.05rem .3rem;color:#334155}
  .pe-bub b{color:#0D32B2}
  .pe-term{margin-top:.5rem;border-radius:9px;overflow:hidden;border:1px solid #1e293b}
  .pe-term-bar{display:flex;align-items:center;gap:.4rem;font:600 .62rem/1 ui-monospace,monospace;color:#7c8ba1;background:#111c30;padding:.42rem .6rem;border-bottom:1px solid #1e293b}
  .pe-live{color:#34d399}
  .pe-term-body{padding:.55rem .65rem;background:#0f172a;font:.68rem/1.65 ui-monospace,monospace;color:#cbd5e1}
  .pe-ln{white-space:pre-wrap}
  .pe-ln .ok{color:#34d399}
  .pe-ln .add{color:#86efac}
  .pe-ln .dim{color:#64748b}
  .pe-ln .path{color:#93c5fd}
  .pe-add{color:#86efac}
  .pe-shot{margin-top:.5rem;border:1px solid #e2e6ea;border-radius:9px;overflow:hidden}
  .pe-shot-cap{font:600 .58rem/1 ui-sans-serif,system-ui;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;padding:.42rem .55rem;background:#f6f7f9;border-bottom:1px solid #eceff2}
  .pe-doc{background:#fbfcfd}
  .pe-doc-bar{display:flex;align-items:center;gap:.4rem;font:600 .62rem/1 ui-sans-serif,system-ui;color:#475569;padding:.46rem .6rem;background:#eef1f4;border-bottom:1px solid #e2e6ea}
  .pe-doc-dot{width:7px;height:7px;border-radius:50%;background:#15803D;flex:none}
  .pe-doc-body{padding:.6rem .7rem;display:flex;flex-direction:column;gap:.5rem}
  .pe-turn{padding-left:.5rem}
  .pe-turn-h{border-left:3px solid #475569}
  .pe-turn-a{border-left:3px solid #0D32B2}
  .pe-role{display:inline-block;font:700 .52rem/1 ui-sans-serif,system-ui;letter-spacing:.05em;border-radius:4px;padding:.16rem .32rem;color:#fff;margin-bottom:.2rem}
  .pe-role-h{background:#475569}
  .pe-role-a{background:#0D32B2}
  .pe-line{font:.72rem/1.42 ui-sans-serif,system-ui;color:#26303b}
  .pe-doc-nav{display:flex;align-items:center;gap:.45rem;padding:.42rem .7rem;border-top:1px solid #e2e6ea;font:700 .76rem/1 ui-sans-serif,system-ui;color:#0D32B2}
  .pe-doc-navlbl{font-weight:500;color:#94a3b8;font-size:.62rem}
  .pe-link{margin-top:.5rem;display:inline-flex;align-items:center;gap:.4rem;font:600 .72rem/1 ui-sans-serif,system-ui;color:#0D32B2;background:#EDF0FD;border:1px solid #c7d2f5;border-radius:8px;padding:.42rem .6rem;text-decoration:none}
  .pe-pr{margin-top:.5rem;border:1px solid #e2e6ea;border-radius:9px;background:#fff;overflow:hidden}
  .pe-pr-top{display:flex;align-items:center;gap:.45rem;padding:.55rem .65rem}
  .pe-pr-ico{color:#7c3aed;font-size:.82rem}
  .pe-pr-num{font:700 .74rem/1 ui-sans-serif,system-ui;color:#1a1c20}
  .pe-pr-title{font:.74rem/1.3 ui-sans-serif,system-ui;color:#475569;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pe-pr-stat{display:flex;align-items:center;gap:.5rem;padding:0 .65rem .5rem;font:700 .64rem/1 ui-monospace,monospace;border-bottom:1px solid #eef1f4}
  .pe-pr-stat .add{color:#15803D}
  .pe-pr-stat .del{color:#b91c1c}
  .pe-pr-stat .files{color:#94a3b8;font-weight:500}
  .pe-pr-foot{display:flex;align-items:center;gap:.6rem;padding:.5rem .65rem;background:#fafbfc}
  .pe-ci{display:inline-flex;align-items:center;gap:.34rem;font:600 .66rem/1 ui-sans-serif,system-ui;color:#15803D}
  .pe-ci .dot{width:8px;height:8px;border-radius:50%;background:#15803D}
  .pe-merge{margin-left:auto;font:700 .64rem/1 ui-sans-serif,system-ui;color:#fff;background:#15803D;border-radius:6px;padding:.36rem .56rem}
  .pe-merged{display:inline-flex;align-items:center;gap:.3rem;font:700 .64rem/1 ui-sans-serif,system-ui;color:#fff;background:#7c3aed;border-radius:5px;padding:.28rem .46rem}
  ` });
var PesuThread = () => createVNode("div", {
	class: "pe-frame",
	role: "img",
	"aria-label": "An XS chat thread driven by the pesu bot, replaying real merged PR #1544. Sridhar asks the bot to make session export a lightweight chat log — a picker for Chat log, Full transcript, or Both, plain HTML with no hidden tool payloads. The coordinator dispatches claude in a kolu terminal and the thread streams the live session: it adds the export picker dialog, single-sources the export-mode enum, renders a plain conversation ledger, and deletes about twelve hundred lines of the old Pierre and markdown renderer, then fmt and tests pass. The bot posts screenshot evidence — the rendered chat-log document with role colours and prompt-jump controls — and a link to connect to the live terminal. It reports the slash-be review gauntlet caught and fixed a stored XSS in the shared export, then posts pull request #1544 with plus 1254 and minus 2652 across 28 files and CI green on both platforms. Sridhar replies merge it, and the bot reports #1544 merged to master with the terminal parked.",
	children: [createVNode("div", {
		class: "pe-bar",
		children: [
			createVNode("span", {
				class: "pe-hash",
				children: "XS · #kolu-dev"
			}),
			createVNode("span", {
				class: "pe-sub",
				children: "thread — lightweight chat-log export"
			}),
			createVNode("span", {
				class: "pe-badge",
				children: "PESU BOT"
			})
		]
	}), createVNode("div", {
		class: "pe-thread",
		children: [
			createVNode("div", {
				class: "pe-msg",
				children: [createVNode("span", {
					class: "pe-av pe-av-h",
					children: "SR"
				}), createVNode("div", {
					class: "pe-body",
					children: [createVNode("div", {
						class: "pe-meta",
						children: [createVNode("b", { children: "Sridhar" }), createVNode("span", {
							class: "pe-time",
							children: "14:31"
						})]
					}), createVNode("div", {
						class: "pe-bub",
						children: [
							"@kolu run ",
							createVNode("b", { children: "claude" }),
							" on ",
							createVNode("code", { children: "kolu" }),
							" — make session export a lightweight ",
							createVNode("b", { children: "chat log" }),
							": a picker for Chat log / Full transcript / Both, plain HTML, no hidden tool payloads. Open a PR."
						]
					})]
				})]
			}),
			createVNode("div", {
				class: "pe-msg",
				children: [createVNode("span", {
					class: "pe-av pe-av-b",
					children: "k"
				}), createVNode("div", {
					class: "pe-body",
					children: [
						createVNode("div", {
							class: "pe-meta",
							children: [
								createVNode("b", { children: "kolu·bot" }),
								createVNode("span", {
									class: "pe-tag",
									children: "BOT"
								}),
								createVNode("span", {
									class: "pe-time",
									children: "14:31"
								})
							]
						}),
						createVNode("div", {
							class: "pe-bub",
							children: [
								"▶ Coordinator dispatched ",
								createVNode("b", { children: "claude" }),
								" in ",
								createVNode("code", { children: "kolu·e7f2" }),
								". Streaming the worker here."
							]
						}),
						createVNode("div", {
							class: "pe-term",
							children: [createVNode("div", {
								class: "pe-term-bar",
								children: [createVNode("span", { children: "kolu·e7f2 · claude" }), createVNode("span", {
									class: "pe-live",
									children: "● live"
								})]
							}), createVNode("div", {
								class: "pe-term-body",
								children: [
									createVNode("div", {
										class: "pe-ln",
										children: [
											createVNode("span", {
												class: "dim",
												children: "●"
											}),
											" Edit ",
											createVNode("span", {
												class: "path",
												children: "client/src/ExportSessionDialog.tsx"
											})
										]
									}),
									createVNode("div", {
										class: "pe-ln",
										children: [createVNode("span", { class: "dim" }), "picker — Chat log · Full transcript · Both"]
									}),
									createVNode("div", {
										class: "pe-ln",
										children: [
											createVNode("span", {
												class: "add",
												children: "+ New"
											}),
											"\xA0",
											createVNode("span", {
												class: "path",
												children: "transcript-core/src/mode.ts"
											}),
											"\xA0",
											createVNode("span", {
												class: "dim",
												children: "— single-source the mode enum"
											})
										]
									}),
									createVNode("div", {
										class: "pe-ln",
										children: [
											createVNode("span", {
												class: "dim",
												children: "●"
											}),
											" Edit ",
											createVNode("span", {
												class: "path",
												children: "transcript-html/src/index.tsx"
											}),
											"\xA0",
											createVNode("span", {
												class: "dim",
												children: "— plain conversation ledger"
											})
										]
									}),
									createVNode("div", {
										class: "pe-ln",
										children: createVNode("span", {
											class: "dim",
											children: "− Del  components · markdown · pierre renderers (−1,200 lines)"
										})
									}),
									createVNode("div", {
										class: "pe-ln",
										children: [createVNode("span", {
											class: "ok",
											children: "✔"
										}), " just fmt && just check"]
									}),
									createVNode("div", {
										class: "pe-ln",
										children: [
											createVNode("span", {
												class: "ok",
												children: "✔"
											}),
											" pnpm test ",
											createVNode("span", {
												class: "dim",
												children: "— transcript + exportTranscriptHtml green"
											})
										]
									})
								]
							})]
						})
					]
				})]
			}),
			createVNode("div", {
				class: "pe-msg",
				children: [createVNode("span", {
					class: "pe-av pe-av-b",
					children: "k"
				}), createVNode("div", {
					class: "pe-body",
					children: [
						createVNode("div", {
							class: "pe-meta",
							children: [
								createVNode("b", { children: "kolu·bot" }),
								createVNode("span", {
									class: "pe-tag",
									children: "BOT"
								}),
								createVNode("span", {
									class: "pe-time",
									children: "14:36"
								})
							]
						}),
						createVNode("div", {
							class: "pe-bub",
							children: "Chat-log export renders clean — evidence attached."
						}),
						createVNode("div", {
							class: "pe-shot",
							children: [createVNode("div", {
								class: "pe-shot-cap",
								children: "screenshot · exported chat log"
							}), createVNode("div", {
								class: "pe-doc",
								children: [
									createVNode("div", {
										class: "pe-doc-bar",
										children: [createVNode("span", { class: "pe-doc-dot" }), "Chat log — session export · kolu"]
									}),
									createVNode("div", {
										class: "pe-doc-body",
										children: [createVNode("div", {
											class: "pe-turn pe-turn-h",
											children: [createVNode("span", {
												class: "pe-role pe-role-h",
												children: "HUMAN"
											}), createVNode("div", {
												class: "pe-line",
												children: "Make session export a plain chat log — drop the hidden tool payloads."
											})]
										}), createVNode("div", {
											class: "pe-turn pe-turn-a",
											children: [createVNode("span", {
												class: "pe-role pe-role-a",
												children: "CLAUDE"
											}), createVNode("div", {
												class: "pe-line",
												children: "Done. Chat log is human + AI messages only, high-contrast HTML, no renderer app."
											})]
										})]
									}),
									createVNode("div", {
										class: "pe-doc-nav",
										children: ["↑ ↓", createVNode("span", {
											class: "pe-doc-navlbl",
											children: "jump between prompts"
										})]
									})
								]
							})]
						}),
						createVNode("a", {
							class: "pe-link",
							children: "↪ Connect to the live terminal & test it yourself"
						})
					]
				})]
			}),
			createVNode("div", {
				class: "pe-msg",
				children: [createVNode("span", {
					class: "pe-av pe-av-b",
					children: "k"
				}), createVNode("div", {
					class: "pe-body",
					children: [
						createVNode("div", {
							class: "pe-meta",
							children: [
								createVNode("b", { children: "kolu·bot" }),
								createVNode("span", {
									class: "pe-tag",
									children: "BOT"
								}),
								createVNode("span", {
									class: "pe-time",
									children: "14:41"
								})
							]
						}),
						createVNode("div", {
							class: "pe-bub",
							children: [
								"PR opened. The ",
								createVNode("code", { children: "/be" }),
								" review gauntlet caught + fixed a ",
								createVNode("b", { children: "stored XSS" }),
								" in the shared export (raw HTML passthrough) — escaped, test added."
							]
						}),
						createVNode("div", {
							class: "pe-pr",
							children: [
								createVNode("div", {
									class: "pe-pr-top",
									children: [
										createVNode("span", {
											class: "pe-pr-ico",
											children: "⬗"
										}),
										createVNode("span", {
											class: "pe-pr-num",
											children: "#1544"
										}),
										createVNode("span", {
											class: "pe-pr-title",
											children: "Make session export a lightweight chat log"
										})
									]
								}),
								createVNode("div", {
									class: "pe-pr-stat",
									children: [
										createVNode("span", {
											class: "add",
											children: "+1,254"
										}),
										createVNode("span", {
											class: "del",
											children: "−2,652"
										}),
										createVNode("span", {
											class: "files",
											children: "· 28 files"
										})
									]
								}),
								createVNode("div", {
									class: "pe-pr-foot",
									children: [createVNode("span", {
										class: "pe-ci",
										children: [createVNode("span", { class: "dot" }), "CI green · both platforms"]
									}), createVNode("span", {
										class: "pe-merge",
										children: "Merge"
									})]
								})
							]
						})
					]
				})]
			}),
			createVNode("div", {
				class: "pe-msg",
				children: [createVNode("span", {
					class: "pe-av pe-av-h",
					children: "SR"
				}), createVNode("div", {
					class: "pe-body",
					children: [createVNode("div", {
						class: "pe-meta",
						children: [createVNode("b", { children: "Sridhar" }), createVNode("span", {
							class: "pe-time",
							children: "14:42"
						})]
					}), createVNode("div", {
						class: "pe-bub",
						children: "lgtm — @kolu merge it."
					})]
				})]
			}),
			createVNode("div", {
				class: "pe-msg",
				children: [createVNode("span", {
					class: "pe-av pe-av-b",
					children: "k"
				}), createVNode("div", {
					class: "pe-body",
					children: [createVNode("div", {
						class: "pe-meta",
						children: [
							createVNode("b", { children: "kolu·bot" }),
							createVNode("span", {
								class: "pe-tag",
								children: "BOT"
							}),
							createVNode("span", {
								class: "pe-time",
								children: "14:42"
							})
						]
					}), createVNode("div", {
						class: "pe-bub",
						children: [
							createVNode("span", {
								class: "pe-merged",
								children: "✓ Merged"
							}),
							" \xA0#1544 → ",
							createVNode("code", { children: "master" }),
							". Terminal ",
							createVNode("code", { children: "kolu·e7f2" }),
							" parked — reopen any time."
						]
					})]
				})]
			})
		]
	})]
});
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
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"A read of Anthropic’s ",
			createVNode(_components.a, {
				href: "https://www.anthropic.com/news/introducing-claude-tag",
				children: createVNode(_components.strong, { children: "Claude Tag" })
			}),
			"\n(Claude joins the team chat as a tagged teammate) and AI researcher\n",
			createVNode(_components.a, {
				href: "https://x.com/karpathy/status/2069547676849557725",
				children: "Andrej Karpathy’s framing of it"
			}),
			"\nas “the 3rd major redesign of LLM UIUX,” held against what kolu is. Throughout, ",
			createVNode(_components.strong, { children: "XS" }),
			"\nstands for any chat app (a Slack-style team chat where the agents already live), and ",
			createVNode(_components.strong, { children: "pesu" }),
			" (Tamil பேசு, “to speak”) is a minimal XS bot — the first\nthing to run kolu’s own development inside chat."
		] }) }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The short version",
			children: createVNode(_components.p, { children: [
				"kolu is the ",
				createVNode(_components.strong, { children: "foundation a chat app integrates" }),
				" — it runs real terminals on machines you\ncontrol and watches what happens inside them. ",
				createVNode(_components.strong, { children: "kolu runs claude, codex, or opencode under\nany front end, on infrastructure you own." }),
				" The integration is a ",
				createVNode(_components.strong, { children: "mirror of the\ncoordinator" }),
				": observing comes straight off the daemons (the who-needs-me board), and\nacting goes through one door — an orchestrator agent in an ordinary kolu terminal. XS —\nthe chat app — keeps everything social: identity, login, presence, attribution. kolu\nauthenticates nothing; the connection is the trust."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-shift-the-agent-moved-into-the-chat",
			children: "The shift: the agent moved into the chat"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Karpathy isn’t describing a chatbot you ask questions. He’s describing a coworker:\na persistent agent that lives where the team already works, holds the org’s tools\nand context, and runs tasks on its own while you do something else. You @-tag it,\nwalk away, and it pings you when it needs you. Anthropic shipped this shape as Claude\nTag — one shared Claude per channel, tasks it pursues “over hours or days,” an audit\nlog of every task and who asked for it. The proof-point is blunt: ",
			createVNode(_components.em, { children: "“65% of our product\nteam’s code is created by our internal version.”" }),
			" The work moves into chat, and the\nhuman’s job shifts from driving keystrokes to managing agents."
		] }),
		"\n",
		createVNode(_components.p, { children: "In that world the terminal specializes. Chat keeps gaining\nricher rendering — diffs, highlighting, even little editors — but it stays async text\nover request and response. It is not a live process you can step into. The terminal is\nwhere you drop to a shell, answer an interactive prompt, watch raw output, drive a\ndebugger. Chat owns the breadth; the terminal owns the depth — and kolu is what makes\nthe depth real." }),
		"\n",
		createVNode(_components.h2, {
			id: "kolu-in-one-picture",
			children: "kolu in one picture"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"At its core kolu does two things: it ",
			createVNode(_components.strong, { children: "runs real terminals on computers you\ncontrol, and watches what’s happening inside them." }),
			" That core is three parts:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "kaval" }),
				" owns each live terminal — start an agent, type into it, resize it, kill it.\nIt is also the single point that ",
				createVNode(_components.em, { children: "serializes" }),
				" writes: when input arrives, last one wins."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "padi" }), " is the per-host workspace daemon above it: its agent sensors watch every\nterminal without touching it, folding the raw noise into a simple board — which agent\nis working, which is asking you something, which just finished — and it owns the\ndurable session: what each terminal ran, the agent’s resume identity, restore across\nrestarts and even an unclean daemon death."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/surface" }) }), " is the typed wire that carries both over any connection — a local\nsocket, or ssh to another machine. Remote hosts are a shipped, first-class part of the\napp: add a host and its terminals sit behind a host switcher, on desktop and mobile."] }),
			"\n"
		] }),
		"\n",
		createVNode($$Svg, {
			svg: chat_native_agents_stack_default,
			caption: "Not a rigid stack. XS is its own app and integrates kolu through one seam; kolu runs headlessly on whatever machine you point it at — your laptop, a server, or a remote sandbox. Chat, presence, and login stay in XS."
		}),
		"\n",
		createVNode(_components.p, { children: "Two things sit either side of kolu, and the relationship with each is different:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "XS is independent." }), " It already runs without kolu. Integrating kolu is simply what\nlets a chat thread reach into a real terminal — XS gains the depth, kolu gains a front\ndoor. Everything social stays in XS."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The machine is wherever kolu runs." }),
				" kolu runs ",
				createVNode(_components.strong, { children: "headlessly on any box" }),
				" — your laptop,\na server, or a remote sandboxed host. Remote sandboxes (an Incus cluster, another team’s\nproject) are something it ",
				createVNode(_components.strong, { children: "naturally supports" }),
				": a remote host is just another place to\ndial the same surface."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"So the picture is not a tower of dependencies. XS ",
			createVNode(_components.em, { children: "integrates" }),
			" kolu; kolu ",
			createVNode(_components.em, { children: "runs on" }),
			"\nwhatever machine you choose. The arrow is integration one way and execution the other."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-moat-model-agnostic-open-yours",
			children: "The moat: model-agnostic, open, yours"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"kolu and a chat app divide cleanly. kolu owns the live process, the files, and the\ndurable session. XS owns identity, login, presence, and who-may-write. A foundation that\nreaches up and grows chat stops being a neutral base ",
			createVNode(_components.em, { children: "any" }),
			" chat app can integrate and\nbecomes one more single-vendor app. Holding that line isn’t caution — it’s the moat."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The moat — our competitive advantage",
			children: createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "kolu runs claude, codex, or opencode under any chat app, on infrastructure you control." }),
				"\nThat is the bet on open standards and open source, and it is exactly what a single-vendor\nstack can’t match. Claude Tag is one vendor’s model, with the shell and files hidden inside\na cloud sandbox you don’t own. kolu keeps the model ",
				createVNode(_components.strong, { children: "swappable" }),
				", the shell and files\n",
				createVNode(_components.strong, { children: "real" }),
				", and the host ",
				createVNode(_components.strong, { children: "yours" }),
				" — so the chat app on top is a choice, never a lock-in."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "What an agent actually is (Andreessen)",
			children: [createVNode(_components.p, { children: [
				"Marc Andreessen, ",
				createVNode(_components.a, {
					href: "https://www.youtube.com/watch?v=knx2wrILP1M",
					children: "on what decades of agent research quietly converged on"
				}),
				":\n",
				createVNode(_components.em, { children: "“an agent is … a language model, and above that a bash shell … and then a file\nsystem, and the state is stored in files,”" }),
				" plus cron — and ",
				createVNode(_components.em, { children: "“every part of that\nother than the model is something we already completely know.”" }),
				" The kicker:\n",
				createVNode(_components.em, { children: "“your agent is now actually independent of the model … you can swap out a different\nLLM underneath.”" })
			] }), createVNode(_components.p, { children: [
				"That is kolu’s architecture, line for line: the ",
				createVNode(_components.strong, { children: "shell" }),
				" is the interface to every\ntool (kolu ",
				createVNode(_components.em, { children: "watches" }),
				" it, doesn’t wrap it), the ",
				createVNode(_components.strong, { children: "files" }),
				" are the durable state, and\nthe ",
				createVNode(_components.strong, { children: "model is the swappable chip" }),
				" (claude · codex · opencode). A chat app that\nhard-codes one vendor’s model and hides the shell and files inside a cloud sandbox\ngives up exactly the durable substance kolu keeps."
			] })]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-seam-observe-out-raw-act-through-the-coordinator",
			children: "The seam: observe out raw, act through the coordinator"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"XS integrates kolu through one seam with two deliberately asymmetric halves: ",
			createVNode(_components.strong, { children: "observe\nflows out raw; act flows in through one door — the coordinator." }),
			" kolu authenticates\nnothing: the connection ",
			createVNode(_components.em, { children: "is" }),
			" the trust — an owner-only socket locally, an ssh link to a\nremote host — so identity, login, and presence stay in XS."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The ",
			createVNode(_components.strong, { children: "coordinator" }),
			" is an orchestrator agent running in an ordinary kolu terminal — the\nsame shape kolu’s own development runs on: one agent that provisions worker terminals,\ndispatches briefs, answers the workers’ questions, and verifies their claims at the tree.\nIts behavioral contract is the ",
			createVNode(_components.code, { children: "/orchestrator" }),
			" skill: rulings run through the review\nlenses with named grounding, teardown kills only recorded PIDs, the human merges every\nPR. The chat bot is a ",
			createVNode(_components.strong, { children: "mirror of that coordinator" }),
			": it binds one thread to that one\nterminal, renders the coordinator’s reports into the thread, and relays the thread’s\nmessages back in — attributed per XS identity — using the same drive loop the coordinator\nitself uses on workers."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: chat_native_agents_bridge_default,
			caption: "The seam. OBSERVE (green) flows out raw and read-only — the board straight off padi. ACT (blue) flows in through one door: the coordinator, an orchestrator agent in an ordinary kolu terminal, which drives the workers with the fleet loop. Chat never writes to a worker terminal."
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Surface" }),
					"\n",
					createVNode(_components.th, { children: "Half" }),
					"\n",
					createVNode(_components.th, { children: "Reuses" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "the board" }),
					"\n",
					createVNode(_components.td, { children: "out · read-only" }),
					"\n",
					createVNode(_components.td, { children: [
						"padi’s agent sensors — which agent is working / asking you / just finished (",
						createVNode(_components.code, { children: "padi-tui wait" }),
						"’s buckets), rendered into the thread on demand with no coordinator hop"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "attention" }),
					"\n",
					createVNode(_components.td, { children: "out · read-only" }),
					"\n",
					createVNode(_components.td, { children: ["per-terminal urgency through the notify seam — the bot pings the thread instead of the desktop", createVNode($$Footnote, { children: "Unprompted posts ride the installed app’s own API: POST /api/apps/chat/postMessage with a conversationId targets a thread, authenticated by the app’s bearer token — the same call pesu answers messages with, so pinging needs no extra machinery." })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "deep links" }),
					"\n",
					createVNode(_components.td, { children: "out" }),
					"\n",
					createVNode(_components.td, { children: "a kolu URL to the exact terminal — depth on demand: step in, answer the interactive prompt, debug, in kolu itself" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "the coordinator bridge" }),
					"\n",
					createVNode(_components.td, { children: "in + out" }),
					"\n",
					createVNode(_components.td, { children: "one terminal’s screen and input — send a message, wait for the turn to end, read the reply: the identical agent-drives-agent loop kolu already ships" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Chat gets ",
			createVNode(_components.strong, { children: "no raw act verbs on workers" }),
			" — that absence is the design, not a gap:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The write floor dissolves." }), " “At most one writer per terminal” machinery exists only\nif chat can touch live terminals. With one door, the floor is the coordinator’s inbox:\nthread messages queue into a conversation and are handled in turn, attributed.\nSerialization by conversation, not by locks."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Guarantees live at the knowing endpoint." }), " The coordinator is the one place that\nknows campaign state — what is in flight, which merge goes first, what a change must\nnot break — so “who does what next” is decided there, never in a thread reacting to a\nscreen."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Discipline is inherited, not re-implemented." }),
				" Everything the orchestrator contract\nenforces — claims verified at the tree, grounded rulings, no pattern kills, the human\nmerging — applies to chat traffic automatically, because chat traffic ",
				createVNode(_components.em, { children: "is" }),
				" coordinator\ntraffic."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-same-door-assists-the-humans-own-discussion",
			children: "The same door assists the humans’ own discussion"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Because a message to the thread and a message to the coordinator are the same thing,\nthe coordinator is also a ",
			createVNode(_components.strong, { children: "participant in the conversation between humans" }),
			" — the\nteammate shape, not just command-and-control. Several people argue a design in the\nthread; the coordinator contributes exactly what its contract makes it good at: the\nclaim checked against the actual tree before anyone builds on it, the ruling with its\ngrounding named so the humans can audit the reasoning rather than defer to it, and the\nrunning record of what was decided and why. AI-assisted discussion among humans falls\nout of the coordinator pattern for free — no second bot, no separate “assistant” mode,\none attributed inbox."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-xs-apps-platform-as-grounded",
			children: "The XS apps platform, as grounded"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The contract pesu builds against — read from the xyne-spaces source (2026-07-13), not\nits docs, because XS has ",
			createVNode(_components.strong, { children: "three separate integration systems" }),
			" that are easy to\nconflate: the ",
			createVNode(_components.em, { children: "bot catalog" }),
			" (backend-native bots, its own mention/thread semantics),\n",
			createVNode(_components.em, { children: "incoming webhooks" }),
			" (URL-embedded-secret message drops), and the ",
			createVNode(_components.strong, { children: "apps platform" }),
			" —\ninstalled apps with a webhook URL, a JWT token, and a signing secret. pesu is an\ninstalled app; only this third system applies."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "What an installed app is." }), " Its own per-workspace user (name and avatar from the app\nrecord), addressable by @mention, DM-able. Created from the dashboard; the webhook URL,\nbearer token, and signing secret are per-install credentials."] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Events — XS → the app’s webhook URL." }),
			" One POST per event,\n",
			createVNode(_components.code, { children: "{eventType, payload, timestamp}" }),
			", fired on exactly three chat triggers:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Event" }),
					"\n",
					createVNode(_components.th, { children: "Fires when" }),
					"\n",
					createVNode(_components.th, { children: "Payload notes" }),
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
					createVNode(_components.td, { children: "the app is explicitly @mentioned in a channel" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "conversationId" }),
						" (thread), ",
						createVNode(_components.code, { children: "channelId" }),
						", ",
						createVNode(_components.code, { children: "messageId" }),
						", sender ",
						createVNode(_components.code, { children: "userId" }),
						" + ",
						createVNode(_components.code, { children: "senderName" }),
						", body as ",
						createVNode(_components.code, { children: "content" }),
						" (HTML) + ",
						createVNode(_components.code, { children: "cleanContent" }),
						" (text), attachments"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "DIRECT_MESSAGE" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.em, { children: "every" }), " message in a 1:1 DM with the app"] }),
					"\n",
					createVNode(_components.td, { children: ["same shape but ", createVNode(_components.strong, { children: ["no ", createVNode(_components.code, { children: "senderName" })] })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "USER_MENTIONED" }) }),
					"\n",
					createVNode(_components.td, { children: "a human is @mentioned in a channel the app is in" }),
					"\n",
					createVNode(_components.td, { children: ["observer signal; adds ", createVNode(_components.code, { children: "mentionedUserIds" })] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Plain, unmentioned channel messages are ",
			createVNode(_components.strong, { children: "never delivered" }),
			" — there is no\nfollow-the-thread for apps (that behavior lives in the bot catalog only). No payload\ncarries a sender email; ",
			createVNode(_components.code, { children: "GET /api/apps/user/info" }),
			" resolves it."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Authentication, both directions, one secret." }),
			" Deliveries carry ",
			createVNode(_components.code, { children: "X-Xyne-Signature" }),
			" —\nHMAC-SHA256 (hex) of the raw JSON body with the app’s signing secret; there is no\ntimestamp or replay scheme, so verification is a constant-time HMAC compare and replay\nis an accepted, recorded risk. The bearer token is a JWT signed HS256 ",
			createVNode(_components.em, { children: "with that same\nsecret" }),
			", payload ",
			createVNode(_components.code, { children: "{appId, userId}" }),
			", no expiry — it lives until regenerated."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"The app API — the app → XS, ",
				createVNode(_components.code, { children: "Authorization: Bearer" }),
				"."
			] }),
			" All under ",
			createVNode(_components.code, { children: "/api/apps" }),
			":"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "POST chat/postMessage" }),
				" — text, markdown, or structured content; target by\n",
				createVNode(_components.code, { children: "channelId" }),
				"/",
				createVNode(_components.code, { children: "channelName" }),
				", or by ",
				createVNode(_components.code, { children: "conversationId" }),
				" to reply ",
				createVNode(_components.strong, { children: "into a thread" }),
				"; posts\nas the app’s user."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.code, { children: "POST chat/updateMessage" }), " — edit a posted message in place (the growing-reply UX)."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.code, { children: "POST chat/agentProgress" }), " — an ephemeral typing/progress indicator."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "GET chat/channelHistory" }),
				" · ",
				createVNode(_components.code, { children: "GET chat/conversationReplies" }),
				" — read back (catch-up\nafter downtime)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "POST channel/openDm" }),
				" — open a DM with a user; ",
				createVNode(_components.code, { children: "GET user/info" }),
				" — id → name/email."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Operational facts." }),
			" Message content caps at 40,000 characters. Event delivery is\nfire-and-forget: no retries, failures logged server-side only — an app that was down\nmissed those events (the read APIs recover). No effective rate limit is configured on\nthe app API routes; cadence discipline (e.g. ≤1 ",
			createVNode(_components.code, { children: "updateMessage" }),
			"/s) is the app’s own\nmanners."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-first-proof-pesu-in-the-kolu-tree",
			children: "The first proof: pesu, in the kolu tree"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"pesu integrates through XS’s ",
			createVNode(_components.strong, { children: "apps platform" }),
			" — the shape the installed “kolu” app\nalready has: XS pushes ",
			createVNode(_components.strong, { children: "signed events" }),
			" to a webhook URL pesu serves, and pesu talks\nback through XS’s ",
			createVNode(_components.strong, { children: "app API" }),
			" with a bearer token. pesu itself is a small daemon in the\nkolu source tree (",
			createVNode(_components.code, { children: "packages/pesu" }),
			" — an app-tier sibling of kolu-server: it imports\nkolu’s packages, nothing imports it), running beside kolu on the machine you own. Both\ndirections below are grounded in the XS source."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "In — events, signed." }),
				" XS POSTs ",
				createVNode(_components.code, { children: "{eventType, payload, timestamp}" }),
				" to pesu’s URL on\nexactly three chat triggers: ",
				createVNode(_components.code, { children: "APP_MENTIONED" }),
				" (an explicit @kolu in a channel),\n",
				createVNode(_components.code, { children: "DIRECT_MESSAGE" }),
				" (every message in a 1:1 DM with the app), and ",
				createVNode(_components.code, { children: "USER_MENTIONED" }),
				"\n(observer). The payload carries the thread id (",
				createVNode(_components.code, { children: "conversationId" }),
				"), the channel, the\nsender’s user id, and the message body as both HTML and plain text. Every delivery is\nauthenticated by ",
				createVNode(_components.code, { children: "X-Xyne-Signature" }),
				" — HMAC-SHA256 of the raw body with the app’s\nsigning secret — which pesu verifies with a constant-time compare before touching the\npayload.",
				createVNode($$Footnote, { children: [
					"Three facts to design around, from the XS source: the payload never\nincludes the sender’s email (and the DM payload omits even the display name) — pesu\nresolves people through ",
					createVNode(_components.code, { children: "GET /api/apps/user/info" }),
					" and caches them; delivery is\nfire-and-forget with no retries, so pesu answers 200 immediately and works async, and\na delivery missed while pesu is down is lost (the read APIs — ",
					createVNode(_components.code, { children: "channelHistory" }),
					",\n",
					createVNode(_components.code, { children: "conversationReplies" }),
					" — allow catch-up); and there is no replay protection on the\nsignature, an accepted risk recorded here."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Out — the app API, one bearer token." }),
				" ",
				createVNode(_components.code, { children: "POST /api/apps/chat/postMessage" }),
				" posts to a\nchannel or — with ",
				createVNode(_components.code, { children: "conversationId" }),
				" — into a thread; ",
				createVNode(_components.code, { children: "updateMessage" }),
				" edits a message\nin place; ",
				createVNode(_components.code, { children: "agentProgress" }),
				" shows a live typing indicator; ",
				createVNode(_components.code, { children: "channelHistory" }),
				" /\n",
				createVNode(_components.code, { children: "conversationReplies" }),
				" read back. This one API is ",
				createVNode(_components.em, { children: "both halves of the mirror" }),
				": the\nreply to a message and the unprompted post are the same call — ",
				createVNode(_components.strong, { children: "B2 ships no wire B0\ndoesn’t already have" }),
				"; it is a policy switch (relay the coordinator’s\nbetween-message turns), not new machinery."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The one honest UX gap, stated:" }),
			" the apps platform delivers a channel message only on\nan explicit @mention — the follow-the-thread behavior (replying in a bot’s thread\nwithout re-mentioning) exists only in XS’s separate bot-catalog system, not for\ninstalled apps. B0’s home is the ",
			createVNode(_components.strong, { children: "dedicated kolu channel" }),
			" that already exists: each\ninstruction there @mentions kolu (the DM path works too, ceremony-free, since events\nfor it come free). Two recorded options if the per-message @mention comes to grate: an\nXS-side feature request for app thread-follow (the right fix), or a pesu-side poller\nover the dedicated channel’s ",
			createVNode(_components.code, { children: "channelHistory" }),
			" — viable precisely because in that one\nchannel ",
			createVNode(_components.em, { children: "every" }),
			" message is for the coordinator — not built until wanted."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Does the coordinator get chat verbs of its own?" }),
			" No — the coordinator stays\nchat-unaware, which keeps the mirror agent-CLI-agnostic and the bridge passive.\nStructured output doesn’t need coordinator agency either: ",
			createVNode(_components.code, { children: "postMessage" }),
			" takes plain\ntext, markdown, and structured payloads, so rendering is pesu’s concern. An MCP face\n(pesu’s verbs as a ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			", re-exposed via ",
			createVNode(_components.code, { children: "@kolu/surface-mcp" }),
			") stays a\nrecorded option whose sole revival condition is a coordinator demonstrably needing to\n",
			createVNode(_components.em, { children: "initiate" }),
			" a chat action the transcript mirror cannot express."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Each phase is ",
			createVNode(_components.strong, { children: "one PR, end to end" }),
			" — it ships nothing that isn’t consumed within it\n(the padi plan’s law, held here). Every PR below is a complete, usable product on its\nown."
		] }),
		"\n",
		createVNode($$PhaseTree, {
			title: "ROADMAP — pesu (the XS bridge) · one end-to-end PR per phase",
			phases: PESU
		}),
		"\n",
		"\n",
		createVNode("a", { id: "b0" }),
		"\n",
		createVNode(_components.h3, {
			id: "b0--the-round-trip",
			children: "B0 — the round trip"
		}),
		"\n",
		createVNode($$Phase, {
			id: "B0",
			name: "the bridge daemon — a chat-driven coordinator over the installed app",
			status: "next"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "What you see:" }),
			" in the dedicated kolu channel, ",
			createVNode(_components.strong, { children: "“@kolu ‹ask›”" }),
			" talks to the\ncoordinator — your message lands in its terminal prefixed with your name; the answer\nappears in the thread as one message that grows while it works, with a typing indicator\nduring the turn. (DMing the app works identically, with no @ needed.) ",
			createVNode(_components.strong, { children: "B0 is\nsingle-operator by design:" }),
			" a configured allowlist of one — srid — and a message from\nanyone else gets a one-line visible decline, never silence and never a relayed turn.\nMulti-operator attribution is already built into the write-in (every message carries its\nsender), so widening later is a config change, not a code change."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The turn, end to end:" }),
			" verify ",
			createVNode(_components.code, { children: "X-Xyne-Signature" }),
			" (constant-time) → 200 immediately →\nenqueue on the FIFO inbox (the write floor — one turn in flight, ever) → resolve the\ncoordinator terminal ",
			createVNode(_components.strong, { children: "by title" }),
			" via the kaval client (ids re-key across kaval\nrestarts; titles survive) → resolve the sender via ",
			createVNode(_components.code, { children: "user/info" }),
			" (cached) → attributed\ntwo-step write-in, snapshot-verified → ",
			createVNode(_components.code, { children: "agentProgress" }),
			" on → as the reply grows in the\ncoordinator’s transcript, read it through the ",
			createVNode(_components.strong, { children: "shipped loaders" }),
			"\n(",
			createVNode(_components.code, { children: "kolu-claude-code" }),
			" / ",
			createVNode(_components.code, { children: "kolu-codex" }),
			" / ",
			createVNode(_components.code, { children: "kolu-grok" }),
			" / ",
			createVNode(_components.code, { children: "kolu-opencode" }),
			", dispatched on the\nagent kind padi publishes — the same dispatch ",
			createVNode(_components.code, { children: "padi/transcript.ts" }),
			" does, so B0 is\nmodel-agnostic on day one) → ",
			createVNode(_components.code, { children: "postMessage" }),
			" once, then ",
			createVNode(_components.code, { children: "updateMessage" }),
			" at a civil cadence\nso the thread shows one growing message → the turn-end bucket flips → final update,\ntyping off. A fault posts as a visible reply — never silence. Replies split at XS’s\n40,000-character message cap."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "The code tree" }), " (no transcript module — the loaders already exist):"] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"plaintext\"><code><span class=\"line\"><span>packages/pesu/src/</span></span>\n<span class=\"line\"><span>  bin.ts            # entry: config → webhook server + turn engine</span></span>\n<span class=\"line\"><span>  config.ts         # XS base URL · listen port · coordinator title ·</span></span>\n<span class=\"line\"><span>                    #   env NAMES for the signing secret + bearer token</span></span>\n<span class=\"line\"><span>  webhook.ts        # the receiver: HMAC verify, event parse, immediate 200</span></span>\n<span class=\"line\"><span>  xyneApi.ts        # the bearer client: postMessage · updateMessage ·</span></span>\n<span class=\"line\"><span>                    #   agentProgress · user/info (+ user cache)</span></span>\n<span class=\"line\"><span>  inbox.ts          # the FIFO turn queue — the write floor</span></span>\n<span class=\"line\"><span>  coordinator.ts    # terminal-by-title · attributed write-in · turn-end via</span></span>\n<span class=\"line\"><span>                    #   padi's buckets · reply text via the loaders</span></span>\n<span class=\"line\"><span>  attribution.ts    # \"from Sridhar: \" prefix formatting</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Hard requirements, in the PR:" }),
			" a ",
			createVNode(_components.strong, { children: "stable public URL" }),
			" for the webhook — the\nrecommended shape for a home-manager host: pesu binds ",
			createVNode(_components.code, { children: "127.0.0.1:<port>" }),
			" as a systemd\nuser service, fronted by ",
			createVNode(_components.strong, { children: "Tailscale Funnel" }),
			" (",
			createVNode(_components.code, { children: "tailscale funnel" }),
			"), which gives a\nstable ",
			createVNode(_components.code, { children: "https://<host>.<tailnet>.ts.net" }),
			" hostname with TLS terminated by tailscaled —\nno extra daemon, survives restarts, and the hostname registered in XS never changes (a\ncloudflared ",
			createVNode(_components.em, { children: "named" }),
			" tunnel is the fallback if Funnel is unavailable; quick-tunnels\nrotate their hostname per run and silently orphan the registration). Secrets reach pesu\n",
			createVNode(_components.strong, { children: "only as environment variables" }),
			" — never the repo, the PR, logs, or an agent\ntranscript; the sender allowlist rejects non-operators visibly; a forged-signature\nrequest is rejected (pinned by a test); a coordinator-busy message queues and answers\nin order."
		] }),
		"\n",
		createVNode("a", { id: "b1" }),
		"\n",
		createVNode(_components.h3, {
			id: "b1--the-board",
			children: "B1 — the board"
		}),
		"\n",
		createVNode($$Phase, {
			id: "B1",
			name: "@kolu status — fleet status from chat",
			status: "todo",
			needs: ["B0"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "What you see:" }),
			" ",
			createVNode(_components.strong, { children: "“@kolu status”" }),
			" (or the same in the DM) answers with a table —\nevery terminal, which agent is in it, and whether it is working, asking for someone, or\njust finished — read straight off padi’s sensors, no coordinator hop. The glance you\ncurrently need the kolu canvas for, from your phone."
		] }),
		"\n",
		createVNode("a", { id: "b2" }),
		"\n",
		createVNode(_components.h3, {
			id: "b2--the-live-mirror",
			children: "B2 — the live mirror"
		}),
		"\n",
		createVNode($$Phase, {
			id: "B2",
			name: "unprompted posts over the same app API — the thread becomes the campaign feed",
			status: "todo",
			needs: ["B0"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "What you see:" }),
			" the thread updates ",
			createVNode(_components.strong, { children: "on its own" }),
			". A worker finishes and the\ncoordinator’s report appears; a ruling goes out and you read it as it happens; an agent\nneeds a human and the thread gets pinged — each post carrying a link that opens the\nexact terminal in kolu when you want the depth. Mechanically this is B0’s ",
			createVNode(_components.code, { children: "postMessage" }),
			"\nwith a ",
			createVNode(_components.code, { children: "conversationId" }),
			" and the transcript relay switched on for between-message turns —\nno new wire, which is why it is the roadmap’s smallest PR."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The discussion-assist patterns — the coordinator contributing grounded answers to a\ndebate between humans — are coordinator behavior, the ",
			createVNode(_components.code, { children: "/orchestrator" }),
			" skill’s\nterritory, and deliberately not a pesu PR."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "The milestone is concrete: run kolu’s own development from a thread (B0 + B1)." }), createVNode(PesuStyles, {})] }),
		"\n",
		createVNode(PesuThread, {}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"The target user story, end to end — here replaying a real merged change,\n",
			createVNode(_components.a, {
				href: "https://github.com/juspay/kolu/pull/1544",
				children: createVNode(_components.strong, { children: "PR #1544" })
			}),
			", which made session export a\nlightweight chat log: start an agent from a thread, watch it work, get screenshot evidence,\njump into the live terminal to try it, then take the PR to green and merge — all without\nleaving chat. The first milestone lights up the ",
			createVNode(_components.strong, { children: "observe" }),
			" half (the stream and the\nevidence); attaching to test and merging from chat ride the act-in verbs that follow."
		] }) }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The call",
			children: createVNode(_components.p, { children: [
				"kolu is the foundation a chat app integrates — real terminals, durable sessions, an\nhonest read, and one disciplined door for writes: the coordinator. XS owns identity; kolu\nowns the substance; the coordinator owns the discipline — and lends it to the humans’\nown discussion. Build the bridge, prove it with the ",
				createVNode(_components.code, { children: "pesu" }),
				" bot running kolu’s own\ndevelopment in the open, and let any chat app be the front door."
			] })
		})
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
	"title": "kolu under any chat app",
	"description": "The coding agent has moved into the chat. kolu is the open, model-agnostic terminal/file foundation any chat app integrates — and the model is a mirror of the coordinator: observe flows out raw (the who-needs-me board), act flows in through one disciplined orchestrator agent, and the same door makes the coordinator a grounded participant in the humans' own discussion. The first proof is an XS bot binding a thread to the coordinator that already runs kolu's own development.",
	"parents": ["comparison", "remote-terminals"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-13T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-shift-the-agent-moved-into-the-chat",
			"text": "The shift: the agent moved into the chat"
		},
		{
			"depth": 2,
			"slug": "kolu-in-one-picture",
			"text": "kolu in one picture"
		},
		{
			"depth": 2,
			"slug": "the-moat-model-agnostic-open-yours",
			"text": "The moat: model-agnostic, open, yours"
		},
		{
			"depth": 2,
			"slug": "the-seam-observe-out-raw-act-through-the-coordinator",
			"text": "The seam: observe out raw, act through the coordinator"
		},
		{
			"depth": 3,
			"slug": "the-same-door-assists-the-humans-own-discussion",
			"text": "The same door assists the humans’ own discussion"
		},
		{
			"depth": 2,
			"slug": "the-xs-apps-platform-as-grounded",
			"text": "The XS apps platform, as grounded"
		},
		{
			"depth": 2,
			"slug": "the-first-proof-pesu-in-the-kolu-tree",
			"text": "The first proof: pesu, in the kolu tree"
		},
		{
			"depth": 3,
			"slug": "b0--the-round-trip",
			"text": "B0 — the round trip"
		},
		{
			"depth": 3,
			"slug": "b1--the-board",
			"text": "B1 — the board"
		},
		{
			"depth": 3,
			"slug": "b2--the-live-mirror",
			"text": "B2 — the live mirror"
		}
	];
}
var url = "src/content/atlas/chat-native-agents-and-kolu.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/chat-native-agents-and-kolu.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/chat-native-agents-and-kolu.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, PESU, PesuStyles, PesuThread, file, frontmatter, getHeadings, url };
