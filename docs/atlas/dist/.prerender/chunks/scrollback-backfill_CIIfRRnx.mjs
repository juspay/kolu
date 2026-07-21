import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Cite } from "./Cite_IypTixBQ.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/diagrams/scrollback-backfill-architecture.svg?raw
var scrollback_backfill_architecture_default = "<svg viewBox=\"0 0 940 500\" width=\"100%\" role=\"img\" aria-label=\"Two paths between kaval's 10,000-line RAM mirror and the browser's live xterm. The hot attach path: a bounded snapshot of roughly 500 to 1000 lines paints the terminal instantly, replacing the W9-era full 10k replay. The backfill loop: when the user scrolls near the top, the client fetches the next older raw chunk from a new kaval history read verb, replays it through a scratch headless terminal whose real parser handles wrapping, SGR, and wide characters, then the fail-loud scrollbackBackfill.ts leaf steals the scratch terminal's BufferLine objects, splices them into the top of the live buffer, shifts ydisp, ybase, and savedY by the inserted count, and fires two renderer pokes — the visible content never moves, the scrollbar thumb just shrinks. The whole reach into xterm privates is a pinned contract of roughly six symbols guarded by a tripwire test.\" style=\"max-width:940px;font:13px ui-sans-serif,system-ui,sans-serif\">\n  <defs>\n    <marker id=\"sbArrow\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"var(--ink-muted,#8a8f98)\" />\n    </marker>\n    <marker id=\"sbHot\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"var(--good-stroke,#15803D)\" />\n    </marker>\n    <marker id=\"sbCold\" viewBox=\"0 0 10 10\" refX=\"8.5\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"var(--struct-stroke,#0D32B2)\" />\n    </marker>\n  </defs>\n\n  <!-- kaval boundary -->\n  <rect x=\"16\" y=\"40\" width=\"300\" height=\"430\" rx=\"12\" fill=\"none\" stroke=\"var(--ink-muted,#b6bcc6)\" stroke-width=\"1.3\" stroke-dasharray=\"5 5\" />\n  <text x=\"28\" y=\"60\" font-size=\"10.5\" font-weight=\"700\" fill=\"var(--ink-muted,#8a8f98)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">kaval daemon (per PTY)</text>\n\n  <!-- browser boundary -->\n  <rect x=\"340\" y=\"40\" width=\"584\" height=\"430\" rx=\"12\" fill=\"none\" stroke=\"var(--ink-muted,#b6bcc6)\" stroke-width=\"1.3\" stroke-dasharray=\"5 5\" />\n  <text x=\"352\" y=\"60\" font-size=\"10.5\" font-weight=\"700\" fill=\"var(--ink-muted,#8a8f98)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">browser client</text>\n\n  <!-- kaval: 10k RAM mirror -->\n  <rect x=\"44\" y=\"84\" width=\"244\" height=\"96\" rx=\"8\" fill=\"var(--surface,#F7F8FE)\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"1.5\" />\n  <text x=\"166\" y=\"110\" text-anchor=\"middle\" font-weight=\"700\" fill=\"var(--ink,#11203a)\">headless xterm mirror</text>\n  <text x=\"166\" y=\"128\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"var(--struct-sub,#4A5072)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">10,000 lines · RAM</text>\n  <text x=\"166\" y=\"144\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">DEFAULT_MIRROR_SCROLLBACK · ptyHost.ts:52</text>\n  <text x=\"166\" y=\"164\" text-anchor=\"middle\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">unchanged by this plan</text>\n\n  <!-- browser: live xterm -->\n  <rect x=\"600\" y=\"84\" width=\"300\" height=\"96\" rx=\"8\" fill=\"var(--good-fill,#eff6f0)\" stroke=\"var(--good-stroke,#15803D)\" stroke-width=\"2.5\" />\n  <text x=\"750\" y=\"110\" text-anchor=\"middle\" font-weight=\"700\" fill=\"var(--ink,#1a1d21)\">live xterm</text>\n  <text x=\"750\" y=\"128\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"var(--good-text,#166534)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">@xterm/xterm 6.1.0-beta.225 · WebGL</text>\n  <text x=\"750\" y=\"144\" text-anchor=\"middle\" font-size=\"10\" fill=\"var(--good-text,#166534)\">client scrollback ≥ mirror + snapshot</text>\n  <text x=\"750\" y=\"164\" text-anchor=\"middle\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--good-text,#166534)\">baked invariant — asserted at startup</text>\n\n  <!-- HOT PATH: bounded attach snapshot -->\n  <path d=\"M288 120 L600 120\" fill=\"none\" stroke=\"var(--good-stroke,#15803D)\" stroke-width=\"2.5\" marker-end=\"url(#sbHot)\" />\n  <text x=\"444\" y=\"104\" text-anchor=\"middle\" font-size=\"11\" font-weight=\"700\" fill=\"var(--good-text,#166534)\">attach: bounded snapshot · ~500–1000 lines</text>\n  <text x=\"444\" y=\"138\" text-anchor=\"middle\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--good-text,#166534)\">kills the W9 full-10k replay per switch</text>\n\n  <!-- TRIGGER: scroll near top -->\n  <path d=\"M690 180 L690 214 L150 214 L150 262\" fill=\"none\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"1.5\" stroke-dasharray=\"6 4\" marker-end=\"url(#sbCold)\" />\n  <text x=\"430\" y=\"206\" text-anchor=\"middle\" font-size=\"10.5\" font-style=\"italic\" fill=\"var(--struct-sub,#4A5072)\">user scrolls near top — ydisp &lt; ~2× rows → fetch next older chunk</text>\n\n  <!-- kaval: history read verb -->\n  <rect x=\"48\" y=\"268\" width=\"204\" height=\"92\" rx=\"8\" fill=\"var(--surface,#EDF0FD)\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"2.5\" />\n  <text x=\"150\" y=\"294\" text-anchor=\"middle\" font-weight=\"700\" font-size=\"12\" fill=\"var(--ink,#11203a)\">history read verb</text>\n  <text x=\"150\" y=\"312\" text-anchor=\"middle\" font-size=\"10\" font-weight=\"600\" fill=\"var(--struct-stroke,#0D32B2)\">NEW — the one new wire surface</text>\n  <text x=\"150\" y=\"330\" text-anchor=\"middle\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\">older raw chunk from the mirror</text>\n\n  <!-- raw chunk arrow -->\n  <path d=\"M252 314 L312 314\" fill=\"none\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"1.5\" marker-end=\"url(#sbCold)\" />\n  <text x=\"282\" y=\"302\" text-anchor=\"middle\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">raw chunk</text>\n\n  <!-- browser: scratch headless terminal -->\n  <rect x=\"312\" y=\"268\" width=\"236\" height=\"92\" rx=\"8\" fill=\"var(--surface,#F7F8FE)\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"1.5\" />\n  <text x=\"430\" y=\"294\" text-anchor=\"middle\" font-weight=\"700\" font-size=\"12\" fill=\"var(--ink,#11203a)\">scratch headless terminal</text>\n  <text x=\"430\" y=\"312\" text-anchor=\"middle\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\">the real parser: wrap · SGR · wide chars</text>\n  <text x=\"430\" y=\"328\" text-anchor=\"middle\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\">replayed at the live terminal's cols</text>\n  <text x=\"430\" y=\"346\" text-anchor=\"middle\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">9,000 lines → 38 ms</text>\n\n  <!-- stolen BufferLines arrow -->\n  <path d=\"M548 314 L620 314\" fill=\"none\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"1.5\" marker-end=\"url(#sbCold)\" />\n  <text x=\"584\" y=\"294\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">stolen</text>\n  <text x=\"584\" y=\"306\" text-anchor=\"middle\" font-size=\"9.5\" fill=\"var(--struct-sub,#4A5072)\">BufferLines</text>\n\n  <!-- browser: scrollbackBackfill.ts leaf -->\n  <rect x=\"620\" y=\"240\" width=\"284\" height=\"160\" rx=\"8\" fill=\"var(--surface,#F7F8FE)\" stroke=\"var(--ink-muted,#8a8f98)\" stroke-width=\"1.5\" />\n  <text x=\"762\" y=\"264\" text-anchor=\"middle\" font-weight=\"700\" font-size=\"12\" fill=\"var(--ink,#1a1d21)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">scrollbackBackfill.ts</text>\n  <text x=\"762\" y=\"282\" text-anchor=\"middle\" font-size=\"10\" font-weight=\"600\" fill=\"var(--ink,#1a1d21)\">leaf beside xtermInternals.ts — but FAIL-LOUD</text>\n  <text x=\"762\" y=\"302\" text-anchor=\"middle\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">lines.splice(0, 0, …stolen rows)</text>\n  <text x=\"762\" y=\"318\" text-anchor=\"middle\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">ydisp · ybase · savedY += M</text>\n  <text x=\"762\" y=\"334\" text-anchor=\"middle\" font-size=\"10\" fill=\"var(--struct-sub,#4A5072)\" font-family=\"ui-monospace,'SF Mono',Menlo,monospace\">_onScroll.fire(ydisp) · refresh(0, rows−1)</text>\n  <text x=\"762\" y=\"354\" text-anchor=\"middle\" font-size=\"10\" font-weight=\"600\" fill=\"var(--ink,#1a1d21)\">throws on missing headroom</text>\n  <text x=\"762\" y=\"372\" text-anchor=\"middle\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">clearSelection() first · skipped on alt buffer</text>\n  <text x=\"762\" y=\"388\" text-anchor=\"middle\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">11,394 rows spliced → 1.7 ms</text>\n\n  <!-- prepend-in-place arrow -->\n  <path d=\"M840 240 L840 186\" fill=\"none\" stroke=\"var(--struct-stroke,#0D32B2)\" stroke-width=\"2.5\" marker-end=\"url(#sbCold)\" />\n  <text x=\"830\" y=\"210\" text-anchor=\"end\" font-size=\"10\" font-weight=\"600\" fill=\"var(--struct-stroke,#0D32B2)\">prepend in place —</text>\n  <text x=\"830\" y=\"226\" text-anchor=\"end\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--struct-sub,#4A5072)\">view never moves, thumb shrinks</text>\n\n  <!-- contract footer (browser side) -->\n  <text x=\"632\" y=\"432\" text-anchor=\"middle\" font-size=\"10.5\" font-weight=\"700\" fill=\"var(--ink,#1a1d21)\">pinned internals contract — ~6 symbols, tripwire-tested</text>\n  <text x=\"632\" y=\"448\" text-anchor=\"middle\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">an xterm bump that moves one symbol is red CI, not a corrupted terminal</text>\n\n  <!-- kaval footer -->\n  <text x=\"166\" y=\"424\" text-anchor=\"middle\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">the 10 k RAM mirror is the horizon —</text>\n  <text x=\"166\" y=\"440\" text-anchor=\"middle\" font-size=\"9.5\" font-style=\"italic\" fill=\"var(--ink-muted,#8a8f98)\">#1577's memory goal stays open</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/scrollback-backfill.mdx
var SbStyles = () => createVNode("style", { children: `
  .sb-board{background:#0c0c0e;border:1px solid #27272c;border-radius:12px;padding:1.1rem 1rem .9rem;margin:1.2rem 0}
  .sb-lead{font:600 .68rem/1 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin:0 0 .9rem .1rem}
  .sb-row{display:flex;gap:1.1rem;flex-wrap:wrap;justify-content:center;align-items:flex-start}
  .sb-cell{display:flex;flex-direction:column;gap:.55rem;align-items:center}
  .sb-cap{font:600 .64rem/1.35 ui-sans-serif,system-ui;color:#8b929d;text-align:center;max-width:15rem}
  .sb-cap b{color:#c7ccd6}
  .sb-term{width:232px;border-radius:9px;border:1.5px solid #5b6470;background:#0e0e10;overflow:hidden;display:flex;font:11px/1.5 ui-monospace,monospace}
  .sb-body{flex:1;padding:.5rem .6rem;min-height:118px}
  .sb-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#aab0ba}
  .sb-dim{color:#565d68}
  .sb-new{color:#7fa8e8}
  .sb-cur{color:#cfd3da}
  .sb-track{width:7px;background:#141417;position:relative;flex:none}
  .sb-thumb{position:absolute;left:1.5px;width:4px;border-radius:2px;background:#4b5563}
  ` });
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		b: "b",
		code: "code",
		em: "em",
		h2: "h2",
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
			"Today a cross-host switch (or a page reload) pays for history up front: kaval\nserializes its ",
			createVNode(_components.strong, { children: "whole" }),
			" 10,000-line mirror and the client writes it all back\ninto xterm before the terminal is usable — the full-scrollback replay the\n",
			createVNode(_components.a, {
				href: "padi.html#w9",
				children: "W9 ship"
			}),
			" pinned as the cost of active-host-only rendering. This\nnote is the ratified direction that kills that cost without giving up history:\n",
			createVNode(_components.strong, { children: "attach with a bounded snapshot, then backfill older lines into the live\nterminal’s own scrollback as the user scrolls up." }),
			" A green prototype grounds\nevery claim here (6/6 tests, branch ",
			createVNode(_components.code, { children: "xterm-prepend-spike" }),
			", commit\n",
			createVNode(_components.code, { children: "b3cfa37d1" }),
			"). Shipped in ",
			createVNode($$PrLink, { pr: 1783 }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"One decision from the prototype changed under implementation, recorded here for\nhonesty: the plan sketched a ",
			createVNode(_components.code, { children: "have" }),
			"-from-bottom (recent-relative) history cursor,\nbut that cannot keep the seam where backfill meets existing content correct —\nit compares the host’s produced-line count against the client’s received count,\nwhich differ by the in-flight delta lag, so live output appending mid-fetch would\nduplicate or skip rows at the seam. The shipped cursor is instead an ",
			createVNode(_components.strong, { children: "absolute\nmirror-line index" }),
			", seeded from the attach snapshot’s ",
			createVNode(_components.code, { children: "topLine" }),
			" and anchored on\nan eviction origin the host tracks off the mirror’s ",
			createVNode(_components.code, { children: "onTrim" }),
			"; a fetch then serves\nstrictly ",
			createVNode(_components.em, { children: "above" }),
			" the client’s content regardless of in-flight output. A width\nchange (reflow renumbers absolute rows) makes backfill ",
			createVNode(_components.strong, { children: "deliberately halt" }),
			"\nuntil the next snapshot re-seeds — the loaded history reflows correctly, only\nfurther loading waits."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Follow-up — the foreign-reflow residual (deliberate, honest, rare)." }),
			" The halt\ncomes in two shapes. A ",
			createVNode(_components.em, { children: "local" }),
			" width resize pauses the controller directly. A\n",
			createVNode(_components.em, { children: "foreign" }),
			" width reflow — a second client resizing the ",
			createVNode(_components.strong, { children: "shared" }),
			" mirror at a\ndifferent width, this client’s own columns unchanged — is caught by a per-mirror\n",
			createVNode(_components.strong, { children: "reflow generation" }),
			" the host stamps on the snapshot and every fetch echoes:\nonce it moves, the host serves a typed ",
			createVNode(_components.code, { children: "stale" }),
			" reply and the client halts rather\nthan splice a renumbered band. That generation bumps ",
			createVNode(_components.strong, { children: "only" }),
			" on a real width\nchange and on a full RIS reset (which likewise renumbers the mirror); a\nheight-only or same-dims resize renumbers nothing and must never halt backfill.\nThe residual left in place is narrow and by design: after a genuine foreign-width\nreflow, ",
			createVNode(_components.em, { children: "deeper" }),
			" backfill stops until the next natural snapshot re-seeds. It is\n",
			createVNode(_components.strong, { children: "halt-not-corrupt and honest" }),
			" — the reply is typed, nothing is corrupted, and\nthe user keeps their buffer ",
			createVNode(_components.em, { children: "and every already-backfilled row" }),
			"; only further\nloading waits. Its structural cure is a ",
			createVNode(_components.strong, { children: "reflow-invariant (logical-line)\ncursor" }),
			" that keeps backfilling across a reflow — the named follow-up. A\nre-attach-on-",
			createVNode(_components.code, { children: "stale" }),
			" bandaid was considered and ",
			createVNode(_components.strong, { children: "rejected" }),
			": it would repaint\nthe screen and discard the backfilled history the user may be reading — trading a\nrare quiet halt for a rare visible loss — and the reflow-invariant cursor would\ndelete it anyway."
		] }),
		"\n",
		"\n",
		createVNode(SbStyles, {}),
		"\n",
		createVNode(_components.h2, {
			id: "user-facing-description",
			children: "User-facing description"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Switching to a host — or reloading the page — paints the terminal\n",
			createVNode(_components.strong, { children: "instantly" }),
			". Only the recent screenful (roughly 500–1,000 lines) is sent from kaval to the browser;\nyou’re typing into a live prompt while the 10,000 lines behind it stay on the\nhost. The full-replay stall you pay today on every cross-host switch\n(",
			createVNode(_components.a, {
				href: "padi.html#w9",
				children: "the W9 cost"
			}),
			") disappears."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Then scrolling up ",
			createVNode(_components.strong, { children: "just works" }),
			". As you approach the top of what’s loaded,\nkolu quietly fetches the next older chunk from the host and splices it into\nthe terminal’s ",
			createVNode(_components.strong, { children: "own" }),
			" scrollback — the same buffer, the same scrollbar, the\nsame select/copy/search you already have. There is no separate history viewer\nand no pager: srid explicitly killed that shape.",
			createVNode($$Footnote, { children: [
				"A separate\ncopy-mode pager — the shape ",
				createVNode($$PrLink, { pr: 1577 }),
				" proposed for deep history —\nwas rejected for this purpose: the user only cares about the ",
				createVNode(_components.em, { children: "actual terminal\nscrollback" }),
				", not a second view with its own keys and its own scroll\nposition."
			] }),
			" The view never jumps while it happens: the lines you’re\nlooking at stay exactly where they are, and the only tell is the scrollbar\nthumb shrinking as more history appears above you. Keep scrolling and it keeps\nfilling, up to the full 10,000 lines kaval already holds."
		] }),
		"\n",
		createVNode("div", {
			class: "sb-board",
			children: [createVNode("div", {
				class: "sb-lead",
				children: "Attach, then scroll — the same terminal throughout"
			}), createVNode("div", {
				class: "sb-row",
				children: [createVNode("div", {
					class: "sb-cell",
					children: [createVNode("div", {
						class: "sb-term",
						children: [createVNode("div", {
							class: "sb-body",
							children: [
								createVNode("div", {
									class: "sb-line sb-dim",
									children: "…lint · 0 warnings"
								}),
								createVNode("div", {
									class: "sb-line",
									children: "$ just test"
								}),
								createVNode("div", {
									class: "sb-line sb-dim",
									children: "PASS · 42 passed (6.1s)"
								}),
								createVNode("div", {
									class: "sb-line",
									children: "$ git push"
								}),
								createVNode("div", {
									class: "sb-line sb-dim",
									children: "→ origin master"
								}),
								createVNode("div", {
									class: "sb-line",
									children: ["$ ", createVNode("span", {
										class: "sb-cur",
										children: "▏"
									})]
								})
							]
						}), createVNode("div", {
							class: "sb-track",
							children: createVNode("div", {
								class: "sb-thumb",
								style: "bottom:3px;height:78%"
							})
						})]
					}), createVNode("div", {
						class: "sb-cap",
						children: [createVNode(_components.b, { children: "Attach — instant." }), " Only the recent screenful is sent from kaval; the prompt is live immediately."]
					})]
				}), createVNode("div", {
					class: "sb-cell",
					children: [createVNode("div", {
						class: "sb-term",
						children: [createVNode("div", {
							class: "sb-body",
							children: [
								createVNode("div", {
									class: "sb-line sb-new",
									children: "$ nix build .#kolu"
								}),
								createVNode("div", {
									class: "sb-line sb-new",
									children: "building 214 derivations…"
								}),
								createVNode("div", {
									class: "sb-line sb-new",
									children: "copying 38 paths…"
								}),
								createVNode("div", {
									class: "sb-line sb-dim",
									children: "…lint · 0 warnings"
								}),
								createVNode("div", {
									class: "sb-line",
									children: "$ just test"
								}),
								createVNode("div", {
									class: "sb-line sb-dim",
									children: "PASS · 42 passed (6.1s)"
								})
							]
						}), createVNode("div", {
							class: "sb-track",
							children: createVNode("div", {
								class: "sb-thumb",
								style: "top:14px;height:34%"
							})
						})]
					}), createVNode("div", {
						class: "sb-cap",
						children: [createVNode(_components.b, { children: "Scroll up — history streams in." }), " Older lines (blue) splice in above; the lines you were reading don’t move — only the thumb shrinks."]
					})]
				})]
			})]
		}),
		"\n",
		createVNode(_components.p, { children: "The backfilled history is real terminal content, not a facsimile: colors\nsurvive, wrapped lines re-wrap correctly when you resize, wide characters\nland on the right cells — because the bytes are replayed through xterm’s own\nparser before they’re spliced in." }),
		"\n",
		createVNode(_components.h2, {
			id: "architecture-level-changes",
			children: "Architecture-level changes"
		}),
		"\n",
		createVNode($$Svg, {
			svg: scrollback_backfill_architecture_default,
			wide: true,
			caption: "The hot path (green) and the backfill loop (blue). Attach sends a bounded snapshot from kaval's 10k RAM mirror. Scrolling near the top fetches the next older raw chunk over a new kaval read verb, replays it through a scratch headless terminal — the real parser, so wraps/SGR/wide chars are exact — then scrollbackBackfill.ts steals the scratch BufferLine objects, splices them into the top of the live buffer, shifts the registers by the inserted count, and fires two renderer pokes. No terminal emulator ships this: xterm.js upstream declined lazy scrollback twice (#948, #2060) and VS Code full-replays — kolu goes first, which is exactly why the reach into internals is a pinned, tripwire-tested contract."
		}),
		"\n",
		createVNode(_components.p, { children: "The moving parts, in the order a chunk travels:" }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "kaval’s mirror stays exactly what it is" }),
				" — a headless xterm holding\n10,000 lines in RAM (",
				createVNode($$Cite, {
					file: "packages/kaval/src/ptyHost.ts",
					lines: "52"
				}),
				").\nAttach stops serializing all of it and sends a ",
				createVNode(_components.strong, { children: "bounded snapshot" }),
				"\n(~500–1,000 lines). This plan deliberately does ",
				createVNode(_components.em, { children: "not" }),
				" touch the mirror’s\nmemory footprint.",
				createVNode($$Footnote, { children: [
					"The heap-OOM problem ",
					createVNode($$PrLink, { pr: 1577 }),
					" set\nout to solve — 10,000-line RAM mirrors per PTY — is ",
					createVNode(_components.strong, { children: "not" }),
					" addressed\nhere: the mirror stays 10k in RAM, and that memory goal remains open.\nThis note’s business is the attach cost and in-place scrollback,\nnothing else."
				] })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "One new wire surface" }),
				": a kaval ",
				createVNode(_components.strong, { children: "history read verb" }),
				" that returns the\nnext older raw chunk from the mirror, cursor-paged. That is the only\naddition to the wire — and it gets a second consumer in the same PR: a\n",
				createVNode(_components.code, { children: "kaval-tui history <terminal>" }),
				" subcommand (ratified in-scope 2026-07-12),\nreading a terminal’s older output without attaching. Agent-orchestration\nworkflows currently work around ",
				createVNode(_components.code, { children: "snapshot" }),
				"’s current-screen-only limit by\npassing report files; this closes that gap and doubles as incident\nforensics. Two consumers from day one also keeps the verb honest — it\nmust serve a plain pager, not just the browser’s backfill loop."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A scratch headless terminal" }),
				" in the client replays the chunk at the\nlive terminal’s column width. This is the trick that makes backfilled\nhistory ",
				createVNode(_components.em, { children: "real" }),
				": the actual xterm parser computes wrapping, ",
				createVNode(_components.code, { children: "isWrapped" }),
				"\ncontinuations, SGR attributes, and wide-character cells — no hand-rolled\nVT interpretation anywhere. A resize (or maximize — the same event)\n",
				createVNode(_components.em, { children: "after" }),
				" a backfill is the proven case: the spike’s reflow oracle shows\nprepended history re-wraps row-for-row identically to natively-written\nhistory. A resize landing ",
				createVNode(_components.em, { children: "mid-backfill" }),
				" gets an explicit guard: at splice\ntime the module compares the live terminal’s columns against fetch-time —\nchanged means ",
				createVNode(_components.strong, { children: "discard" }),
				" the scratch result rather than splice stale-width\nlines. A ",
				createVNode(_components.em, { children: "local" }),
				" width change goes further and ",
				createVNode(_components.strong, { children: "pauses" }),
				" the controller\n(the absolute cursor a reflow renumbered is no longer valid) until the next\nsnapshot re-seeds it; the loaded history still reflows correctly, only\nfurther loading waits. (The original sketch re-replayed at the new width\ninstead; that path was dropped for the simpler halt-not-corrupt pause —\nsee the follow-up note near the top.)"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "scrollbackBackfill.ts" }), " steals the result"] }),
				": the scratch terminal’s\n",
				createVNode(_components.code, { children: "BufferLine" }),
				" objects are plain data, so the module splices them into the\ntop of the live buffer’s ",
				createVNode(_components.code, { children: "CircularList" }),
				", shifts ",
				createVNode(_components.code, { children: "ydisp" }),
				"/",
				createVNode(_components.code, { children: "ybase" }),
				"/",
				createVNode(_components.code, { children: "savedY" }),
				"\nby the inserted count ",
				createVNode(_components.em, { children: "M" }),
				", and pokes the renderer exactly twice —\n",
				createVNode(_components.code, { children: "_onScroll.fire(ydisp)" }),
				" and ",
				createVNode(_components.code, { children: "refresh(0, rows−1)" }),
				". Because ",
				createVNode(_components.code, { children: "ydisp" }),
				" grew by\nthe same ",
				createVNode(_components.em, { children: "M" }),
				" as the content above it, the scroll math means ",
				createVNode(_components.strong, { children: "the visible\ncontent does not move" }),
				"; the thumb shrinks, and markers and decorations\nshift for free.",
				createVNode($$Footnote, { children: [
					"Code-read against 6.1.0-beta.225:\n",
					createVNode(_components.code, { children: "_onScroll.fire" }),
					" cascades ",
					createVNode(_components.code, { children: "selectionService.refresh" }),
					" +\n",
					createVNode(_components.code, { children: "viewport.queueSync" }),
					", with no feedback loop (the diff is 0, a no-op);\nmarkers shift via ",
					createVNode(_components.code, { children: "Buffer.addMarker" }),
					"’s ",
					createVNode(_components.code, { children: "onInsert" }),
					" handler and the\n",
					createVNode(_components.code, { children: "DecorationService" }),
					" listens to ",
					createVNode(_components.code, { children: "onInsert" }),
					" too. The ",
					createVNode(_components.code, { children: "refresh" }),
					" rebuilds the\nWebGL atlas from ",
					createVNode(_components.code, { children: "ydisp..ydisp+rows" }),
					" — content-identical, flicker-free.\nThe one gap found: ",
					createVNode(_components.code, { children: "SelectionService" }),
					" listens only to ",
					createVNode(_components.code, { children: "onTrim" }),
					", not\n",
					createVNode(_components.code, { children: "onInsert" }),
					", so an active selection’s rows would go stale by ",
					createVNode(_components.em, { children: "M" }),
					" — hence\nthe MVP clears the selection before each prepend."
				] })
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "Three boundary decisions, stated as verdicts:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"\n",
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: [
						"A leaf, not electricity — but a ",
						createVNode(_components.em, { children: "fail-loud" }),
						" leaf."
					] }),
					" It hides no transport,\nno reconnect, no persistence — a bounded algorithm over xterm’s buffer, so on\nits own it earned no package. It has since graduated into\n",
					createVNode(_components.a, {
						href: "xterm-kit",
						children: createVNode(_components.code, { children: "@kolu/xterm-kit" })
					}),
					" — not as electricity in its own right, but as\none part of the accumulated xterm machinery that package owns — where it lives\nat ",
					createVNode(_components.code, { children: "packages/xterm-kit/src/scrollbackBackfill.ts" }),
					" (the ",
					createVNode(_components.code, { children: "/backfill" }),
					" entry, which\nconstructs the ",
					createVNode(_components.code, { children: "@xterm/xterm" }),
					" scratch), a sibling of the pinned-internals door\n",
					createVNode($$Cite, { file: "packages/xterm-kit/src/internals.ts" }),
					". It inverts that sibling’s\nphilosophy: ",
					createVNode(_components.code, { children: "internals.ts" }),
					" degrades to a no-op when a private symbol is\nmissing, which is right for cosmetic reads — and ",
					createVNode(_components.strong, { children: "wrong here" }),
					", because\na silent partial prepend corrupts a terminal. The prototype demonstrated\nthe failure live: without the guard, a splice past ",
					createVNode(_components.code, { children: "maxLength" }),
					" silently\ntrims the oldest rows while the register arithmetic still assumes they\nexist. Every missing symbol and every headroom shortfall ",
					createVNode(_components.strong, { children: "throws" }),
					"."
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"\n",
				createVNode(_components.p, { children: [createVNode(_components.strong, { children: "The internals dependency is a pinned contract, not a hope." }), " The whole\nreach into xterm privates is ~6 symbols:"] }),
				"\n",
				createVNode(_components.table, { children: [
					"\n",
					createVNode(_components.thead, { children: [
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.th, { children: "pinned symbol" }),
							"\n",
							createVNode(_components.th, { children: "role" }),
							"\n"
						] }),
						"\n"
					] }),
					"\n",
					createVNode(_components.tbody, { children: [
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.td, { children: createVNode(_components.code, { children: "term._core" }) }),
							"\n",
							createVNode(_components.td, { children: "the door into internals" }),
							"\n"
						] }),
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.td, { children: createVNode(_components.code, { children: "_core._bufferService._onScroll.fire" }) }),
							"\n",
							createVNode(_components.td, { children: "renderer poke 1" }),
							"\n"
						] }),
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.td, { children: createVNode(_components.code, { children: "_core.buffers.normal" }) }),
							"\n",
							createVNode(_components.td, { children: "the live normal buffer" }),
							"\n"
						] }),
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.td, { children: [
								createVNode(_components.code, { children: "buffer.lines" }),
								" — ",
								createVNode(_components.code, { children: "CircularList" }),
								": ",
								createVNode(_components.code, { children: "length" }),
								" / ",
								createVNode(_components.code, { children: "maxLength" }),
								" / ",
								createVNode(_components.code, { children: "get" }),
								" / ",
								createVNode(_components.code, { children: "splice" }),
								" / ",
								createVNode(_components.code, { children: "onInsert" }),
								" / ",
								createVNode(_components.code, { children: "onTrim" })
							] }),
							"\n",
							createVNode(_components.td, { children: "line storage; the splice point" }),
							"\n"
						] }),
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.td, { children: [
								createVNode(_components.code, { children: "buffer.ydisp" }),
								" / ",
								createVNode(_components.code, { children: "ybase" }),
								" / ",
								createVNode(_components.code, { children: "savedY" }),
								" / ",
								createVNode(_components.code, { children: "y" })
							] }),
							"\n",
							createVNode(_components.td, { children: ["the registers shifted by += ", createVNode(_components.em, { children: "M" })] }),
							"\n"
						] }),
						"\n",
						createVNode(_components.tr, { children: [
							"\n",
							createVNode(_components.td, { children: [
								createVNode(_components.code, { children: "IBufferLine.isWrapped" }),
								" / ",
								createVNode(_components.code, { children: ".translateToString" })
							] }),
							"\n",
							createVNode(_components.td, { children: "wrap continuation + text oracle" }),
							"\n"
						] }),
						"\n"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.p, { children: [
					"A ",
					createVNode(_components.strong, { children: "contract-pin test" }),
					" (symbol existence + splice-fires-",
					createVNode(_components.code, { children: "onInsert" }),
					") is the\ntripwire: an xterm version bump that moves any symbol turns into ",
					createVNode(_components.strong, { children: "red CI" }),
					",\nnot user-facing corruption. Churn risk is low — every pinned symbol is\nshape-identical between ",
					createVNode(_components.code, { children: "@xterm/headless" }),
					" 6.0.0 and the client’s\nexact-pinned ",
					createVNode(_components.code, { children: "@xterm/xterm" }),
					" 6.1.0-beta.225 (pnpm overrides, with webgl\n0.20.0-beta.224)."
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"\n",
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "kolu goes first, knowingly." }),
					" There is no prior art to copy: xterm.js\nupstream declined infinite/lazy scrollback twice, and VS Code restores\nterminals by serialize-plus-full-replay — precisely the cost this plan\nremoves.",
					createVNode($$Footnote, { children: "xterm.js #948 and #2060 — “up the scrollback” was the\nofficial answer, and a VTE maintainer’s paging design was declined.\nVS Code’s persistent terminals do a full serialize + replay on restore,\nnot lazy backfill." }),
					" Wanting what no emulator ships is ",
					createVNode(_components.em, { children: "why" }),
					" the\ninternals reach exists — and why it’s fenced by the contract table above\nrather than scattered through the codebase."
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "implementation-details",
			children: "Implementation details"
		}),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "One PR" }), ", five steps — the work threads existing seams (attach, the\nterminal module, kaval’s verbs) and nothing here can ship usefully alone:"] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The module" }),
				" — ",
				createVNode(_components.code, { children: "scrollbackBackfill.ts" }),
				" (shipped under\n",
				createVNode(_components.code, { children: "packages/client/src/terminal/" }),
				"; later graduated verbatim into\n",
				createVNode(_components.code, { children: "packages/xterm-kit/src/" }),
				" — see ",
				createVNode(_components.a, {
					href: "xterm-kit",
					children: "xterm-kit"
				}),
				")\nexporting ",
				createVNode(_components.code, { children: "prependScrollback(term, rawChunk, servedRows): PrependResult" }),
				" — a\ndiscriminated ",
				createVNode(_components.code, { children: "{ kind: \"inserted\"; rows } | { kind: \"skipped\" }" }),
				", so the\ncaller can never conflate “consumed, inserted ",
				createVNode(_components.em, { children: "M" }),
				" rows” with “not consumed”\n(an alt-buffer or late-splice skip that must not advance the backfill\ncursor). Steps exactly as the prototype’s ",
				createVNode(_components.code, { children: "prependHistory" }),
				", plus\n",
				createVNode(_components.code, { children: "term.clearSelection()" }),
				" before the splice and a ",
				createVNode(_components.code, { children: "skipped" }),
				" when the alt buffer\nis active. Fail-loud throughout."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The scratch terminal" }),
				" — the shipped ",
				createVNode(_components.code, { children: "defaultScratch" }),
				" is an ",
				createVNode(_components.strong, { children: "unopened" }),
				"\n",
				createVNode(_components.code, { children: "@xterm/xterm" }),
				" ",
				createVNode(_components.code, { children: "Terminal" }),
				" (same version, so ",
				createVNode(_components.code, { children: "BufferLine" }),
				" internals match the\nlive buffer’s; no renderer, no DOM — it just parses bytes into a buffer). Its\none load-bearing assumption — an unopened ",
				createVNode(_components.code, { children: "write()" }),
				" parses into the buffer\n",
				createVNode(_components.em, { children: "and" }),
				" fires its callback — is ",
				createVNode(_components.strong, { children: "pinned by a contract test" }),
				" (the SHIPPED\nexport, exercised directly), so a caret-range ",
				createVNode(_components.code, { children: "@xterm/xterm" }),
				" bump that defers\npre-open parsing turns red in CI rather than into silent corruption. (No\nfallback to ",
				createVNode(_components.code, { children: "@xterm/headless" }),
				" shipped: promoting it to a client runtime dep\nwould put a second parser in the bundle — weighed and declined.)"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The wiring" }),
				" — attach sends the bounded snapshot; an ",
				createVNode(_components.code, { children: "onScroll" }),
				" handler\nfetches the next older chunk from kaval’s new history read verb whenever\n",
				createVNode(_components.code, { children: "ydisp" }),
				" drops under ",
				createVNode(_components.strong, { children: "~2× rows" }),
				", prepends it, and stops when the mirror\nis exhausted."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The sizing invariant, baked" }),
				" — client scrollback ≥ kaval’s\n",
				createVNode(_components.code, { children: "DEFAULT_MIRROR_SCROLLBACK" }),
				" (10,000,\n",
				createVNode($$Cite, {
					file: "packages/kaval/src/ptyHost.ts",
					lines: "52"
				}),
				") + snapshot size,\n",
				createVNode(_components.strong, { children: "asserted at startup" }),
				"; and the throw-on-overflow guard stays in the\nsplice path. No knob, no clamp-and-continue: headroom is a build-time\nfact, so a violation is a crash, not a degrade."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The contract-pin tests, lifted from the spike" }),
				" into both packages —\nkaval (against ",
				createVNode(_components.code, { children: "@xterm/headless" }),
				") and client (against ",
				createVNode(_components.code, { children: "@xterm/xterm" }),
				") —\nso a pin bump that moves a pinned symbol fails CI loudly on both sides."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "kaval-tui history <terminal>" }) }),
				" — the read verb’s second consumer, in\nthis same PR: cursor-paged dump of a terminal’s older mirror contents to\nstdout (newest-first paging, a ",
				createVNode(_components.code, { children: "--lines N" }),
				" bound), no attach, no TTY\ntaken. Ships with a smoke-level test against a real kaval."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Risks, ranked" }), " — each with the mitigation that ships in the same PR:"] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "#" }),
					"\n",
					createVNode(_components.th, { children: "risk" }),
					"\n",
					createVNode(_components.th, { children: "mitigation" }),
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
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Silent eviction on missing headroom" }),
						" — the one true corruption mode: splicing past ",
						createVNode(_components.code, { children: "maxLength" }),
						" silently trims the oldest rows while the register shift assumes they exist. Demonstrated live in the spike."
					] }),
					"\n",
					createVNode(_components.td, { children: "Fully guarded: the fail-fast throw-on-overflow check + the baked sizing invariant (step 4) make the state unreachable." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "2" }),
					"\n",
					createVNode(_components.td, { children: "Private-symbol churn on an xterm upgrade." }),
					"\n",
					createVNode(_components.td, { children: "Low (every symbol stable across 6.0.0 → 6.1.0-beta.225; versions exact-pinned); the contract-pin tests convert any move into red CI." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "3" }),
					"\n",
					createVNode(_components.td, { children: "Scratch-replay fidelity edges — OSC-8 link ids dangle, addon-image placements are lost in backfilled rows." }),
					"\n",
					createVNode(_components.td, { children: "Cosmetic by construction; accepted (see the deliberately-not list)." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "4" }),
					"\n",
					createVNode(_components.td, { children: [
						"Browser-only behaviors unverified headlessly — the unopened-",
						createVNode(_components.code, { children: "Terminal" }),
						" ",
						createVNode(_components.code, { children: "write()" }),
						", one-frame scrollbar jitter, a prepend racing a pending write."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"The unopened ",
						createVNode(_components.code, { children: "write()" }),
						" is now ",
						createVNode(_components.strong, { children: ["pinned by a contract test against the shipped ", createVNode(_components.code, { children: "defaultScratch" })] }),
						" (turns red on an ",
						createVNode(_components.code, { children: "@xterm/xterm" }),
						" bump that defers pre-open parsing); the remaining jitter/race edges are verified by eyeball + e2e."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "5" }),
					"\n",
					createVNode(_components.td, { children: "Selection UX — an active selection is cleared by a prepend." }),
					"\n",
					createVNode(_components.td, { children: [
						"Accepted for MVP; preserving it needs ",
						createVNode(_components.code, { children: "_selectionService._model" }),
						", a later extension."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Deliberately not in scope:" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"No backfill while the ",
				createVNode(_components.strong, { children: "alt buffer" }),
				" is active (full-screen apps have no\nscrollback to extend)."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Selection is not preserved" }), " across a backfill — cleared in the MVP."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "OSC-8 links render plain" }), " in backfilled rows."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "No recreation of history at its original recorded widths" }),
				" — the replay\nwraps at the ",
				createVNode(_components.em, { children: "current" }),
				" cols, and the spike’s reflow oracle shows that’s\nexactly what native history does too."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "No infinite or disk-backed scrollback" }), " — kaval’s 10k RAM mirror is the\nhorizon of this plan."] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "The prototype this plan stands on",
			children: createVNode(_components.p, { children: [
				"Branch ",
				createVNode(_components.code, { children: "xterm-prepend-spike" }),
				", commit ",
				createVNode(_components.code, { children: "b3cfa37d1" }),
				"\n(",
				createVNode(_components.code, { children: "packages/kaval/src/xtermPrepend.spike.test.ts" }),
				") — ",
				createVNode(_components.strong, { children: "6/6 vitest green" }),
				"\nagainst ",
				createVNode(_components.code, { children: "@xterm/headless" }),
				" in ~170\xA0ms. The load-bearing proof is the\n",
				createVNode(_components.strong, { children: "reflow oracle" }),
				": prepended history reflows ",
				createVNode(_components.strong, { children: "row-for-row identical" }),
				" to\nnatively-written history across shrink, grow, row-count change, and further\nwrites — so backfilled scrollback is indistinguishable from scrollback that\nwas always there. Also proven: storage coherence with appends still working\nand ",
				createVNode(_components.code, { children: "onScroll" }),
				" firing shifted; a scrolled-up viewport anchor staying put; SGR\nattributes surviving; the fail-fast overflow guard (and the corruption when\nit’s removed); and the contract-pin tripwire itself. Performance: a\n9,000-line scratch replay costs ",
				createVNode(_components.strong, { children: "38\xA0ms" }),
				", and stealing + splicing +\nshifting 11,394 rows costs ",
				createVNode(_components.strong, { children: "1.7\xA0ms" }),
				" — a one-shot 10k backfill would be\nfine, so the incremental scroll-driven chunks are nowhere near a budget."
			] })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Scrollback Backfill — Bounded Attach, Real Scrollback",
	"description": "Attach paints instantly from a small snapshot; scrolling up backfills older history into the terminal's own scrollback via a pinned xterm-internals prepend — no pager, no view jump, up to the full 10k lines kaval holds.",
	"parents": ["feature"],
	"status": "implemented",
	"maturity": "budding",
	"updated": "2026-07-12T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "user-facing-description",
			"text": "User-facing description"
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
		}
	];
}
var url = "src/content/atlas/scrollback-backfill.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/scrollback-backfill.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/scrollback-backfill.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, SbStyles, file, frontmatter, getHeadings, url };
