import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import { t as $$Cite } from "./Cite_IypTixBQ.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
//#region src/diagrams/split-active-pane-flow.svg?raw
var split_active_pane_flow_default = "<svg viewBox=\"0 0 780 168\" xmlns=\"http://www.w3.org/2000/svg\" font-family=\"ui-sans-serif, system-ui, sans-serif\">\n  <rect x=\"8\" y=\"8\" width=\"764\" height=\"152\" rx=\"12\" fill=\"#0c0c0e\" stroke=\"#1f1f23\" />\n  <text x=\"24\" y=\"32\" fill=\"#8b929d\" font-size=\"13\" font-weight=\"600\">How the cue is driven — one existing signal, no new state</text>\n\n  <!-- Stage 1 -->\n  <rect x=\"24\" y=\"56\" width=\"156\" height=\"68\" rx=\"8\" fill=\"#161618\" stroke=\"#27272c\" />\n  <text x=\"102\" y=\"80\" fill=\"#5a9ea0\" font-size=\"12.5\" font-weight=\"600\" text-anchor=\"middle\">focusTarget</text>\n  <text x=\"102\" y=\"97\" fill=\"#9aa0aa\" font-size=\"11\" text-anchor=\"middle\">\"main\" | \"sub\"</text>\n  <text x=\"102\" y=\"112\" fill=\"#6b7280\" font-size=\"10.5\" text-anchor=\"middle\">useSubPanel store</text>\n\n  <!-- arrow 1 -->\n  <line x1=\"180\" y1=\"90\" x2=\"214\" y2=\"90\" stroke=\"#4b5563\" stroke-width=\"1.5\" />\n  <polygon points=\"214,90 206,86 206,94\" fill=\"#4b5563\" />\n\n  <!-- Stage 2 -->\n  <rect x=\"214\" y=\"56\" width=\"176\" height=\"68\" rx=\"8\" fill=\"#161618\" stroke=\"#27272c\" />\n  <text x=\"302\" y=\"80\" fill=\"#c7ccd6\" font-size=\"12.5\" font-weight=\"600\" text-anchor=\"middle\">TerminalContent</text>\n  <text x=\"302\" y=\"97\" fill=\"#9aa0aa\" font-size=\"11\" text-anchor=\"middle\">gate: focused &amp;&amp; expanded</text>\n  <text x=\"302\" y=\"112\" fill=\"#6b7280\" font-size=\"10.5\" text-anchor=\"middle\">→ pick the active pane</text>\n\n  <!-- arrow 2 -->\n  <line x1=\"390\" y1=\"90\" x2=\"424\" y2=\"90\" stroke=\"#4b5563\" stroke-width=\"1.5\" />\n  <polygon points=\"424,90 416,86 416,94\" fill=\"#4b5563\" />\n\n  <!-- Stage 3 -->\n  <rect x=\"424\" y=\"56\" width=\"160\" height=\"68\" rx=\"8\" fill=\"#161618\" stroke=\"#27272c\" />\n  <text x=\"504\" y=\"80\" fill=\"#c7ccd6\" font-size=\"12.5\" font-weight=\"600\" text-anchor=\"middle\">data-pane-focus</text>\n  <text x=\"504\" y=\"97\" fill=\"#9aa0aa\" font-size=\"11\" text-anchor=\"middle\">\"active\" | \"inactive\"</text>\n  <text x=\"504\" y=\"112\" fill=\"#6b7280\" font-size=\"10.5\" text-anchor=\"middle\">on each pane</text>\n\n  <!-- arrow 3 -->\n  <line x1=\"584\" y1=\"90\" x2=\"618\" y2=\"90\" stroke=\"#4b5563\" stroke-width=\"1.5\" />\n  <polygon points=\"618,90 610,86 610,94\" fill=\"#4b5563\" />\n\n  <!-- Stage 4 -->\n  <rect x=\"618\" y=\"56\" width=\"138\" height=\"68\" rx=\"8\" fill=\"#1a1418\" stroke=\"#a78bfa\" />\n  <text x=\"687\" y=\"80\" fill=\"#cbb9f5\" font-size=\"12.5\" font-weight=\"600\" text-anchor=\"middle\">recede</text>\n  <text x=\"687\" y=\"97\" fill=\"#9aa0aa\" font-size=\"11\" text-anchor=\"middle\">dim the inactive</text>\n  <text x=\"687\" y=\"112\" fill=\"#6b7280\" font-size=\"10.5\" text-anchor=\"middle\">opacity 0.4</text>\n\n  <text x=\"24\" y=\"148\" fill=\"#6b7280\" font-size=\"10.5\">Reuses the per-tile focus signal that already routes keystrokes; opacity on the inactive pane — its box never changes size, so xterm never refits.</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/split-active-pane.mdx
var SfStyles = () => createVNode("style", { children: `
  .sf-board{background:#0c0c0e;border:1px solid #27272c;border-radius:12px;padding:1.1rem 1rem .9rem;margin:1.2rem 0;--sf-accent:#5a9ea0;--sf-repo:#5b6470}
  .sf-lead{font:600 .68rem/1 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin:0 0 .9rem .1rem}
  .sf-row{display:flex;gap:1.1rem;flex-wrap:wrap;justify-content:center;align-items:flex-start}
  .sf-cell{display:flex;flex-direction:column;gap:.55rem;align-items:center}
  .sf-cap{font:600 .64rem/1.35 ui-sans-serif,system-ui;color:#8b929d;text-align:center;max-width:13rem}
  .sf-cap b{color:#c7ccd6}
  .sf-tile{width:218px;border-radius:9px;border:1.5px solid var(--sf-repo);background:#0e0e10;overflow:hidden;display:flex;flex-direction:column;font:11px/1.45 ui-monospace,monospace}
  .sf-titlebar{display:flex;align-items:center;gap:.4rem;padding:.32rem .5rem;background:rgba(228,228,232,.05);border-bottom:1px solid rgba(228,228,232,.07)}
  .sf-dot{width:7px;height:7px;border-radius:50%;background:var(--sf-repo);flex:none}
  .sf-name{font-weight:600;color:#9aa0aa;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sf-ctrls{color:#4b5563;letter-spacing:.18em;font-size:9px}
  .sf-pane{position:relative;padding:.5rem .6rem;color:#aab0ba}
  .sf-main{min-height:60px}
  .sf-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sf-dim{color:#6b7280}
  .sf-cur{color:#cfd3da}
  .sf-seam{height:1px;background:rgba(228,228,232,.08)}
  .sf-sub{position:relative}
  .sf-tabbar{display:flex;gap:.3rem;padding:.3rem .5rem;background:#0b0b0d;border-bottom:1px solid #1c1c20}
  .sf-tab{padding:.05rem .45rem;border-radius:4px;color:#6b7280;font-size:10px}
  .sf-tab-on{background:#1f1f23;color:#cfd3da;font-weight:600}
  .sf-subbody{padding:.5rem .6rem;min-height:34px;color:#aab0ba}
  /* the chosen cue (recede) dims the OTHER pane; rail/ring shown only as the design record */
  .sf-recede.sf-active-main .sf-sub{opacity:.4}
  .sf-recede.sf-active-sub  .sf-main{opacity:.4}
  .sf-rail.sf-active-main .sf-main{box-shadow:inset 2px 0 0 var(--sf-accent)}
  .sf-rail.sf-active-sub  .sf-sub {box-shadow:inset 2px 0 0 var(--sf-accent)}
  .sf-ring.sf-active-main .sf-main{box-shadow:inset 0 0 0 1.5px color-mix(in oklch,var(--sf-accent) 60%,transparent)}
  .sf-ring.sf-active-sub  .sf-sub {box-shadow:inset 0 0 0 1.5px color-mix(in oklch,var(--sf-accent) 60%,transparent)}
  ` });
var SplitTile = (props) => createVNode("div", {
	class: `sf-tile sf-${props.cue ?? "none"} sf-active-${props.active}`,
	children: [
		createVNode("div", {
			class: "sf-titlebar",
			children: [
				createVNode("span", { class: "sf-dot" }),
				createVNode("span", {
					class: "sf-name",
					children: "argh · claude"
				}),
				createVNode("span", {
					class: "sf-ctrls",
					children: "▢ ✕"
				})
			]
		}),
		createVNode("div", {
			class: "sf-pane sf-main",
			children: [
				createVNode("div", {
					class: "sf-line",
					children: "$ npm test"
				}),
				createVNode("div", {
					class: "sf-line sf-dim",
					children: "PASS · 12 passed"
				}),
				createVNode("div", {
					class: "sf-line",
					children: ["$ ", createVNode("span", {
						class: "sf-cur",
						children: "▏"
					})]
				})
			]
		}),
		createVNode("div", { class: "sf-seam" }),
		createVNode("div", {
			class: "sf-sub",
			children: [createVNode("div", {
				class: "sf-tabbar",
				children: [createVNode("span", {
					class: "sf-tab sf-tab-on",
					children: "server"
				}), createVNode("span", {
					class: "sf-tab",
					children: "logs"
				})]
			}), createVNode("div", {
				class: "sf-subbody",
				children: [createVNode("div", {
					class: "sf-line",
					children: "$ vite dev"
				}), createVNode("div", {
					class: "sf-line sf-dim",
					children: "ready in 240 ms"
				})]
			})]
		})
	]
});
function _createMdxContent(props) {
	const _components = Object.assign({
		b: "b",
		br: "br",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		hr: "hr",
		li: "li",
		ol: "ol",
		p: "p",
		strong: "strong",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"Split a tile and you get two stacked terminals — a main pane on top, a sub-panel\nbelow. You click into one, you start typing… and nothing on screen tells you\nwhich one is listening. The split already ",
			createVNode(_components.em, { children: "knows" }),
			" — it routes your keystrokes to\nthe right pane — but it keeps the secret to itself. This note graduates the\nSundry item ",
			createVNode(_components.strong, { children: "“Distinguish the active terminal in a split”" }),
			" into a plan: surface\nthat hidden signal as a quiet visual cue."
		] }),
		"\n",
		"\n",
		"\n",
		createVNode(SfStyles, {}),
		"\n",
		createVNode(_components.h2, {
			id: "user-facing-description",
			children: "User-facing description"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The pane that does ",
			createVNode(_components.strong, { children: "not" }),
			" have focus ",
			createVNode(_components.strong, { children: "recedes" }),
			" — it dims so the live pane it’s\nsitting next to reads as the foreground. A glance answers “where do my keystrokes\nland?” without reading anything, and the receded terminal’s output stays legible\nenough to keep half an eye on."
		] }),
		"\n",
		createVNode("div", {
			class: "sf-board",
			children: [createVNode("div", {
				class: "sf-lead",
				children: "Today vs. proposed — the same split, focus on the sub-panel"
			}), createVNode("div", {
				class: "sf-row",
				children: [createVNode("div", {
					class: "sf-cell",
					children: [createVNode(SplitTile, {
						active: "sub",
						cue: "none"
					}), createVNode("div", {
						class: "sf-cap",
						children: [createVNode(_components.b, { children: "Today" }), " — both panes equally bright. Which one is typing into? You can’t tell."]
					})]
				}), createVNode("div", {
					class: "sf-cell",
					children: [createVNode(SplitTile, {
						active: "sub",
						cue: "recede"
					}), createVNode("div", {
						class: "sf-cap",
						children: [createVNode(_components.b, { children: "Proposed" }), " — the inactive main pane recedes; the focused sub-panel stays forward."]
					})]
				})]
			})]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The recede ",
			createVNode(_components.em, { children: "follows" }),
			" focus. Click the main pane and it brightens while the\nsub-panel steps back; click into the split and they swap — the same motion you\nalready make, now mirrored on screen."
		] }),
		"\n",
		createVNode("div", {
			class: "sf-board",
			children: [createVNode("div", {
				class: "sf-lead",
				children: "Whichever pane has focus stays forward; the other recedes"
			}), createVNode("div", {
				class: "sf-row",
				children: [createVNode("div", {
					class: "sf-cell",
					children: [createVNode(SplitTile, {
						active: "main",
						cue: "recede"
					}), createVNode("div", {
						class: "sf-cap",
						children: [createVNode(_components.b, { children: "Main pane focused" }), " — sub-panel recedes."]
					})]
				}), createVNode("div", {
					class: "sf-cell",
					children: [createVNode(SplitTile, {
						active: "sub",
						cue: "recede"
					}), createVNode("div", {
						class: "sf-cap",
						children: [createVNode(_components.b, { children: "Sub-panel focused" }), " — main pane recedes."]
					})]
				})]
			})]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"It shows only inside the ",
			createVNode(_components.strong, { children: "tile you’re working in" }),
			" and only while the split is\n",
			createVNode(_components.strong, { children: "open" }),
			" — a collapsed split has just one terminal, so there’s nothing to\ndistinguish. The active sub-",
			createVNode(_components.em, { children: "tab" }),
			" already has its own highlight in the tab bar;\nthis is the missing, coarser signal: ",
			createVNode(_components.strong, { children: "main vs. sub" }),
			"."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "languages-considered",
			children: "Languages considered"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Three quiet, static languages were weighed; ",
			createVNode(_components.strong, { children: "recede" }),
			" was chosen. All reuse the\nsame idea (mark focus without motion), so ",
			createVNode(_components.code, { children: "prefers-reduced-motion" }),
			" needs no\nspecial case beyond making the change instant."
		] }),
		"\n",
		createVNode("div", {
			class: "sf-board",
			children: [createVNode("div", {
				class: "sf-lead",
				children: "The three languages weighed — main focused in each"
			}), createVNode("div", {
				class: "sf-row",
				children: [
					createVNode("div", {
						class: "sf-cell",
						children: [createVNode(SplitTile, {
							active: "main",
							cue: "recede"
						}), createVNode("div", {
							class: "sf-cap",
							children: [
								createVNode(_components.b, { children: "C · Recede the other" }),
								" ",
								createVNode($$Pill, {
									variant: "ok",
									children: "chosen"
								}),
								createVNode(_components.br, {}),
								"Dim the inactive pane. The strongest “which one is live?” read; touches no chrome."
							]
						})]
					}),
					createVNode("div", {
						class: "sf-cell",
						children: [createVNode(SplitTile, {
							active: "main",
							cue: "rail"
						}), createVNode("div", {
							class: "sf-cap",
							children: [
								createVNode(_components.b, { children: "A · Edge rail" }),
								createVNode(_components.br, {}),
								"A teal bar on the active pane’s edge. Smallest footprint, but a thin line is easy to miss."
							]
						})]
					}),
					createVNode("div", {
						class: "sf-cell",
						children: [createVNode(SplitTile, {
							active: "main",
							cue: "ring"
						}), createVNode("div", {
							class: "sf-cap",
							children: [
								createVNode(_components.b, { children: "B · Inset ring" }),
								createVNode(_components.br, {}),
								"An accent ring around the active pane. Clear, but boxes in the xterm grid."
							]
						})]
					})
				]
			})]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Why recede",
			children: createVNode(_components.p, { children: [
				"Reducing one pane’s presence is the loudest “the other one is live” signal of the\nthree — it works on the whole pane, not a 2px edge you can miss (",
				createVNode(_components.strong, { children: "A" }),
				"), and never\ndraws a box around the terminal grid (",
				createVNode(_components.strong, { children: "B" }),
				"). It does overlap the canvas’s\nparked-tile dim conceptually, but they can’t actually stack: the recede only fires\non the ",
				createVNode(_components.em, { children: "focused" }),
				" tile, and a focused tile is never parked — so its opacity is\nalways a clean ×0.4 of full, never of an already-dimmed tile."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "architecture-level-changes",
			children: "Architecture-level changes"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"There is almost nothing structural to change — and that’s the point. The split\n",
			createVNode(_components.strong, { children: "already tracks which pane has focus" }),
			": ",
			createVNode(_components.code, { children: "focusTarget: \"main\" | \"sub\"" }),
			" lives in the\nper-tile ",
			createVNode(_components.code, { children: "useSubPanel" }),
			" store and is read on every keystroke to route input. It’s\nclient-only state (only the split ",
			createVNode(_components.em, { children: "layout" }),
			" — ",
			createVNode(_components.code, { children: "collapsed" }),
			", ",
			createVNode(_components.code, { children: "panelSize" }),
			" — is\nserver-persisted; on restore ",
			createVNode(_components.code, { children: "focusTarget" }),
			" is reseeded locally, see\n",
			createVNode($$Cite, {
				file: "packages/client/src/terminal/useSessionRestore.ts",
				lines: "282"
			}),
			").\nThe work is to ",
			createVNode(_components.em, { children: "render" }),
			" that existing in-session signal, not to invent a new one."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: split_active_pane_flow_default,
			caption: "One existing signal drives the cue. focusTarget already exists; TerminalContent already gates on whether the tile is focused and the split expanded. We add only the last hop: tag each pane with data-pane-focus and let a Tailwind data-variant recede the inactive one."
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Reuse the source of truth, don’t fork it." }),
				" The cue reads ",
				createVNode(_components.code, { children: "focusTarget" }),
				" — the\nsame field that routes keystrokes (",
				createVNode($$Cite, { file: "packages/client/src/terminal/useSubPanel.ts" }),
				").\nA parallel “which pane looks active” flag, or a CSS ",
				createVNode(_components.code, { children: ":focus-within" }),
				" shortcut that\nre-derives the same fact a second way, would be two sources that can disagree.\nOne signal, two consumers (input routing + the cue)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A presentational leaf, not electricity." }),
				" This hides no hard volatility\n(transport, reconnect, GPU-context loss) — it’s a bounded bit of styling inside\nthe terminal module. It stays in ",
				createVNode(_components.code, { children: "TerminalContent" }),
				" (Tailwind classes on the\npanel, no separate stylesheet rule); it earns no ",
				createVNode(_components.code, { children: "@kolu/*" }),
				" package."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "No knob, no fallback." }),
				" The cue is always on whenever a split is open and\nfocused — no preference toggle (an override is a defect, not a feature) and no\ndegraded path. It either reflects ",
				createVNode(_components.code, { children: "focusTarget" }),
				" or, if that signal were ever\nabsent, the split itself would already be broken upstream."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Dim, never reflow." }),
				" The cue is ",
				createVNode(_components.code, { children: "opacity" }),
				" on the inactive pane — a compositor\nproperty that changes no box size. That matters: any size change to a pane forces\nxterm to refit its grid and resize the PTY. Opacity costs zero layout (the canvas\ntile-aura paints without reflow for the same reason)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "implementation-details",
			children: "Implementation details"
		}),
		"\n",
		createVNode(_components.p, { children: "Small and contained — one component gains a derived flag and a pair of Tailwind\ndata-variant classes, and the Sundry row graduates to this note." }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Tag each pane" }),
				" in ",
				createVNode($$Cite, { file: "packages/client/src/terminal/TerminalContent.tsx" }),
				".\nIt already computes ",
				createVNode(_components.code, { children: "shouldFocusMain()" }),
				" / ",
				createVNode(_components.code, { children: "shouldFocusSub()" }),
				" from\n",
				createVNode(_components.code, { children: "props.focused" }),
				", ",
				createVNode(_components.code, { children: "isExpanded()" }),
				", and ",
				createVNode(_components.code, { children: "focusTarget()" }),
				" — the cue keys off the same\nconditions. A ",
				createVNode(_components.code, { children: "paneFocus(pane)" }),
				" helper returns ",
				createVNode(_components.code, { children: "\"active\" | \"inactive\" | undefined" }),
				", written to a ",
				createVNode(_components.code, { children: "data-pane-focus" }),
				" attribute on each of the two\n",
				createVNode(_components.code, { children: "Resizable.Panel" }),
				"s (plus a stable ",
				createVNode(_components.code, { children: "data-pane=\"main\" | \"sub\"" }),
				" so the pane is\naddressable from tests). ",
				createVNode(_components.code, { children: "undefined" }),
				" when collapsed or when the tile isn’t\nfocused, so no background tile lights a pane."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Recede the inactive pane" }),
				" — Tailwind data-variant classes on the same\n",
				createVNode(_components.code, { children: "Resizable.Panel" }),
				" (no custom CSS, per the repo’s Tailwind-only styling rule):\n",
				createVNode(_components.code, { children: "data-[pane-focus=inactive]:opacity-40" }),
				" for the recede, plus\n",
				createVNode(_components.code, { children: "motion-safe:transition-opacity motion-safe:duration-[120ms]" }),
				" for the\ncross-fade. ",
				createVNode(_components.code, { children: "motion-safe:" }),
				" is Tailwind’s ",
				createVNode(_components.code, { children: "prefers-reduced-motion: no-preference" }),
				"\nvariant, so reduced-motion gets the change instantly."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Graduate the Sundry item" }),
				" — remove the row from\n",
				createVNode($$Cite, { file: "docs/atlas/src/content/atlas/sundry.mdx" }),
				" (per its own\n“Graduating an item” rule) and leave a one-line pointer here."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Docs + changelog" }),
				" — this note is the design of record; add an ",
				createVNode(_components.code, { children: "Added" }),
				" line to\nthe changelog. No README/marketing surface lists split-pane focus behaviour, so\nthe doc-sync is this note plus the changelog."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Test (feature, so test-first):" }),
			" an e2e scenario in\n",
			createVNode($$Cite, { file: "packages/tests/features/sub-terminal.feature" }),
			" that opens a split,\nchecks the sub-panel is active and the main pane receded, then moves focus and\nchecks they swap — asserting on ",
			createVNode(_components.code, { children: "data-pane" }),
			" + ",
			createVNode(_components.code, { children: "data-pane-focus" }),
			" ",
			createVNode(_components.em, { children: "and" }),
			" the rendered\nopacity it drives (so deleting the recede class would fail the test, not just the\nmarker flip), reusing the existing split/sub-terminal steps\n(",
			createVNode($$Cite, { file: "packages/tests/step_definitions/sub_terminal_steps.ts" }),
			")."
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.strong, { children: "Risks, and why they’re small" }) }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.em, { children: "xterm refit on a layout change" }),
				" — avoided by construction: the cue is ",
				createVNode(_components.code, { children: "opacity" }),
				",\nnot a border or size change, so no pane box changes dimensions."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.em, { children: "Compounding with the canvas parked-tile dim" }), " — can’t happen: the recede only\nfires on the focused tile, which is never parked, so opacity is always ×0.4 of a\nfull-strength tile."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.em, { children: "Mobile" }),
				" — ",
				createVNode(_components.code, { children: "TerminalContent" }),
				" is shared by the canvas and the mobile tile view, so\nthe cue appears in both with no extra work; evidence covers the mobile layout."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "scope--focused-tile-only",
			children: "Scope — focused tile only"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The cue shows only in the tile you’re in (",
			createVNode(_components.code, { children: "props.focused" }),
			"), keeping the canvas calm\nand removing any “is the dim = a parked tile?” ambiguity for tiles you’re not\nworking in. Revisit if an always-on version (read every split’s pending pane at a\nglance) proves more useful in practice."
		] }),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Status: ",
			createVNode(_components.code, { children: "accepted" }),
			" — design of record; the chosen treatment is ",
			createVNode(_components.strong, { children: "C · recede the\ninactive pane" }),
			". In review in ",
			createVNode($$PrLink, { pr: 1509 }),
			" (status flips to ",
			createVNode(_components.code, { children: "implemented" }),
			"\non merge)."
		] }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Distinguish the Active Terminal in a Split",
	"description": "When a tile is split into two stacked terminals, nothing marks which pane your keystrokes go to. Recede the pane that does NOT have focus so the live one stands out — driven by the focus signal the split already tracks, no new state.",
	"parents": ["feature"],
	"status": "accepted",
	"maturity": "seedling",
	"updated": "2026-06-22T00:00:00.000Z"
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
			"slug": "languages-considered",
			"text": "Languages considered"
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
			"depth": 3,
			"slug": "scope--focused-tile-only",
			"text": "Scope — focused tile only"
		}
	];
}
var url = "src/content/atlas/split-active-pane.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/split-active-pane.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/split-active-pane.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, SfStyles, SplitTile, file, frontmatter, getHeadings, url };
