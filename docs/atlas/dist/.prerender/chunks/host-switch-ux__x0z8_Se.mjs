import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$D2 } from "./D2_CXsCOQdn.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import { t as $$Cite } from "./Cite_D-1zLbJ9.mjs";
import { t as $$Footnote } from "./Footnote_Co54bi9w.mjs";
//#region src/content/atlas/host-switch-ux.mdx
var HS = () => createVNode("style", { children: `
  .hs-win{max-width:44rem;margin:1.4rem 0;border:1px solid #e6e2d6;border-radius:14px;overflow:hidden;box-shadow:0 6px 22px rgba(40,20,60,.12);font-family:ui-sans-serif,system-ui}
  .hs-title{display:flex;align-items:center;gap:.5rem;padding:.5rem .8rem;background:linear-gradient(90deg,#a21caf,#9333ea);color:#fff}
  .hs-title .tl{width:11px;height:11px;border-radius:50%;display:inline-block}
  .hs-title b{margin-left:.5rem;font:600 .74rem/1 ui-sans-serif,system-ui;letter-spacing:.01em;opacity:.96}
  /* the canvas the bar sits on — a real grid, so "fit with the canvas" is visible */
  .cv{background:#faf8fd;background-image:linear-gradient(#ece7f3 1px,transparent 1px),linear-gradient(90deg,#ece7f3 1px,transparent 1px);background-size:26px 26px}
  /* ── baseline bar ── */
  .hs-bar{display:flex;align-items:flex-end;gap:.45rem;padding:.5rem .6rem 0;background:#f6f1f8;border-bottom:1px solid #e4d8ea;min-height:44px}
  .hs-logo{display:flex;flex-direction:column;gap:2px;padding-bottom:8px;flex:none}
  .hs-logo i{display:block;height:3px;border-radius:2px}
  .hs-tab{display:inline-flex;align-items:center;gap:.4rem;height:30px;padding:0 .35rem 0 .55rem;margin-bottom:-1px;border:1px solid #ddd4e2;border-bottom-color:transparent;border-radius:7px 7px 0 0;background:#ece5f0;color:#5f5866;font:500 .74rem/1 ui-sans-serif,system-ui;white-space:nowrap}
  .hs-tab.active{border-color:rgba(162,28,175,.5);background:rgba(162,28,175,.10);color:#1a1c20}
  .hs-dot{width:8px;height:8px;border-radius:50%;flex:none}
  .hs-ok{background:#16a34a}.hs-warn{background:#ca8a04}.hs-bad{background:#dc2626}.hs-idle{background:#9aa0aa}
  .hs-dm{width:20px;height:20px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font:700 9px/1 ui-monospace,monospace}
  .hs-padi{background:#e3f4e9;color:#1b7a3a;border:1px solid #bce3c8}
  .hs-kaval{background:#1f2430;color:#7dd3a8}
  .hs-badge{min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:rgba(202,138,4,.92);color:#231a00;font:700 10px/16px ui-monospace,monospace;text-align:center;flex:none}
  .hs-x{width:18px;height:22px;display:inline-flex;align-items:center;justify-content:center;border-radius:5px;color:#a99fb0;font-size:11px}
  .hs-add{width:26px;height:26px;margin-bottom:2px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;color:#9a8fa4;font-size:16px;flex:none}
  /* ── polished bar: frosted glass, hue accent, seam dissolves into canvas ── */
  .gbar{position:relative;display:flex;align-items:flex-end;gap:.5rem;padding:.55rem .7rem 0;min-height:46px;background:rgba(252,250,254,.66);backdrop-filter:blur(12px) saturate(1.3);-webkit-backdrop-filter:blur(12px) saturate(1.3);box-shadow:inset 0 1px 0 rgba(255,255,255,.7),0 1px 0 rgba(120,80,150,.08)}
  .gtab{position:relative;display:inline-flex;align-items:center;gap:.45rem;height:32px;padding:0 .4rem 0 .62rem;border-radius:10px 10px 0 0;color:#6a6274;font:600 .76rem/1 ui-sans-serif,system-ui;white-space:nowrap;transition:background .18s,color .18s,box-shadow .18s}
  .gtab:not(.on):hover{background:rgba(255,255,255,.5);color:#3a3442}
  .gtab.on{color:#241f2c;background:#fbf9fe;box-shadow:0 -1px 0 var(--hue) inset,0 -8px 14px -10px var(--hue),0 -.5px 0 rgba(0,0,0,.04)}
  /* the active tab's belly: a slab of the same surface that bleeds 8px into the canvas so there's no seam */
  .belly{position:absolute;left:0;right:0;bottom:-8px;height:9px;background:#fbf9fe}
  .huedot{width:9px;height:9px;border-radius:50%;flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--hue) 22%,transparent)}
  .gdm{width:19px;height:19px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font:700 9px/1 ui-monospace,monospace;opacity:.9}
  .gx{width:17px;height:20px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;color:#b3a9bd;font-size:11px}
  .gadd{width:28px;height:28px;margin-bottom:3px;display:inline-flex;align-items:center;justify-content:center;border-radius:9px;color:#9a8fa4;font-size:16px;background:rgba(255,255,255,.4);flex:none}
  /* ── room paradigm ── */
  .room{position:relative;height:180px;overflow:hidden}
  .room .halo{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% -20%,color-mix(in srgb,var(--hue) 26%,transparent),transparent 60%);pointer-events:none}
  .room .edge{position:absolute;inset:0;box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--hue) 30%,transparent),inset 0 0 40px color-mix(in srgb,var(--hue) 12%,transparent);pointer-events:none}
  .presence{position:absolute;top:12px;left:50%;transform:translateX(-50%);display:inline-flex;align-items:center;gap:.5rem;padding:.34rem .7rem;border-radius:999px;background:rgba(255,255,255,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 4px 14px rgba(50,20,70,.14),inset 0 0 0 1px rgba(255,255,255,.6);font:600 .76rem/1 ui-sans-serif,system-ui;color:#2a2533}
  .bloom{position:absolute;top:52px;left:50%;transform:translateX(-50%);width:200px;padding:.35rem;border-radius:12px;background:rgba(255,255,255,.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 16px 34px rgba(50,20,70,.2),inset 0 0 0 1px rgba(255,255,255,.6)}
  .rchip{display:flex;align-items:center;gap:.5rem;padding:.4rem .55rem;border-radius:8px;font:600 .76rem/1 ui-sans-serif,system-ui;color:#3a3442}
  .rchip.on{background:color-mix(in srgb,var(--hue) 14%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--hue) 34%,transparent)}
  .rbar{width:3px;height:16px;border-radius:2px;background:var(--hue);flex:none}
  /* ── host-map paradigm ── */
  .mc{position:relative;padding:1.1rem;display:flex;gap:.85rem;justify-content:center;align-items:stretch}
  .mcard{position:relative;width:150px;border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 4px 14px rgba(40,20,60,.12);transition:transform .18s,box-shadow .18s}
  .mcard.on{transform:translateY(-6px) scale(1.03);box-shadow:0 12px 26px rgba(40,20,60,.2),0 0 0 2px var(--hue)}
  .mcard.await{box-shadow:0 6px 18px rgba(202,138,4,.28),0 0 0 2px rgba(202,138,4,.65)}
  .mhead{display:flex;align-items:center;gap:.4rem;padding:.4rem .55rem;font:700 .68rem/1 ui-sans-serif,system-ui;color:#2c2735;border-bottom:1px solid #eee7f2;background:color-mix(in srgb,var(--hue) 7%,#fff)}
  .mbody{height:78px;padding:.5rem .55rem;font:500 8.5px/1.5 ui-monospace,monospace;color:#8a8296;background:#fcfbfe}
  .fl{height:5px;border-radius:2px;background:#e7e1ef;margin-bottom:4px}
  .mtile{position:absolute;border-radius:3px;box-shadow:inset 0 0 0 1px rgba(120,80,150,.25)}
  /* ── shared bits ── */
  .hs-kbd{display:inline-flex;align-items:center;height:17px;padding:0 5px;border:1px solid #d6ccdf;border-bottom-width:2px;border-radius:5px;background:#fbf8fd;color:#6b6472;font:600 10px/1 ui-monospace,monospace}
  .hs-cap{padding:.75rem .95rem .9rem;background:#fff;font:500 .74rem/1.55 ui-sans-serif,system-ui;color:#5b6470;border-top:1px solid #eee}
  .hs-cap b{color:#262a2e}.hs-cap .ok{color:#16a34a}.hs-cap .am{color:#b8860b}.hs-cap code{font-size:.9em;background:#f2eef6;padding:.05rem .3rem;border-radius:4px}
  .hs-pal{max-width:26rem;margin:0 auto;background:rgba(255,255,255,.9);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-radius:12px;box-shadow:0 18px 40px rgba(60,20,80,.2),inset 0 0 0 1px rgba(255,255,255,.6);overflow:hidden}
  .hs-search{display:flex;align-items:center;gap:.5rem;padding:.6rem .75rem;border-bottom:1px solid #eee6f0;color:#8a8296;font:500 .8rem/1 ui-sans-serif,system-ui}
  .hs-search .cur{color:#1a1c20}
  .hs-sec{padding:.35rem .8rem .2rem;font:700 .58rem/1 ui-sans-serif,system-ui;letter-spacing:.08em;text-transform:uppercase;color:#a79bb2}
  .hs-row{display:flex;align-items:center;gap:.55rem;padding:.42rem .7rem;margin:.1rem .35rem;border-radius:8px}
  .hs-row.sel{background:rgba(162,28,175,.10);box-shadow:inset 0 0 0 1px rgba(162,28,175,.28)}
  .hs-row .nm{font:600 .8rem/1.2 ui-sans-serif,system-ui;color:#26222c}
  .hs-row .sub{font:500 .66rem/1.2 ui-sans-serif,system-ui;color:#948aa0}
  .hs-row .grow{flex:1;min-width:0}
  .hs-drop{max-width:22rem;margin:.2rem 0;background:#fff;border:1px solid #ddd4e2;border-radius:9px;box-shadow:0 10px 26px rgba(60,20,80,.14);overflow:hidden}
  .hs-in{display:flex;align-items:center;gap:.4rem;padding:.5rem .65rem;border-bottom:1px solid #eee6f0;font:500 .78rem/1 ui-monospace,monospace;color:#26222c}
  .hs-in .ghost{color:#b4a9c0}
  .hs-opt{display:flex;align-items:center;gap:.55rem;padding:.4rem .7rem;font:500 .76rem/1 ui-monospace,monospace;color:#4a4453}
  .hs-opt.sel{background:rgba(162,28,175,.08)}
  .hs-opt .tag{margin-left:auto;font:600 .58rem/1 ui-sans-serif,system-ui;letter-spacing:.04em;text-transform:uppercase;color:#a79bb2;background:#f2eef6;padding:.15rem .4rem;border-radius:4px}
  @media (prefers-reduced-motion:reduce){.hs-win *{transition:none!important;animation:none!important}}
  ` });
var Logo = () => createVNode("span", {
	class: "hs-logo",
	"aria-hidden": "true",
	children: [
		createVNode("i", { style: "width:12px;background:#a21caf" }),
		createVNode("i", { style: "width:16px;background:#7c3aed" }),
		createVNode("i", { style: "width:20px;background:#16a34a" })
	]
});
var Padi = () => createVNode("span", {
	class: "hs-dm hs-padi",
	title: "Padi",
	children: "P"
});
var Kaval = () => createVNode("span", {
	class: "hs-dm hs-kaval",
	title: "Kaval",
	children: ">_"
});
function _createMdxContent(props) {
	const _components = Object.assign({
		b: "b",
		code: "code",
		em: "em",
		h2: "h2",
		i: "i",
		li: "li",
		p: "p",
		span: "span",
		strong: "strong",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"Kolu renders each host as a browser-style tab — click to switch, ",
			createVNode(_components.code, { children: "+" }),
			" to add over\nssh, ",
			createVNode(_components.code, { children: "✕" }),
			" to drop. ",
			createVNode($$Cite, { file: "packages/client/src/host/HostSelectorStrip.tsx" }),
			" It’s\na ",
			createVNode(_components.em, { children: "good" }),
			" start: the metaphor needs no manual, health is legible before you switch,\nand the strip degrades to an overflow menu as it narrows. But it’s stuck on two\naxes. It ",
			createVNode(_components.strong, { children: "looks" }),
			" like a toolbar bolted above the canvas — hard borders, flat\nfills, an opaque band with a seam. And it never leaves the ",
			createVNode(_components.strong, { children: "tab-row box" }),
			": every\nidea is still “a row of tabs.” This note fixes the first cut on both — craft, then\nparadigm."
		] }),
		"\n",
		"\n",
		"\n",
		"\n",
		createVNode(HS, {}),
		"\n",
		createVNode(_components.h2, {
			id: "the-bar-today",
			children: "The bar today"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Three hosts as tabs. Each carries a connection dot, the name, a fixed-width\n",
			createVNode(_components.strong, { children: "Padi · Kaval" }),
			" slot (so a sick remote shows red ",
			createVNode(_components.em, { children: "before" }),
			" you switch), an optional\namber ",
			createVNode(_components.strong, { children: "awaiting" }),
			" count, and — for guests — a remove ",
			createVNode(_components.code, { children: "✕" }),
			". A click writes\n",
			createVNode(_components.code, { children: "activeHost" }),
			" and the canvas re-keys; no reload.",
			createVNode($$Footnote, { children: [
				"The switch is a synchronous\nsignal write — ",
				createVNode(_components.code, { children: "setActiveHost(props.host)" }),
				" in ",
				createVNode($$Cite, { file: "packages/client/src/host/HostSelectorStrip.tsx" }),
				"; ",
				createVNode(_components.code, { children: "useEntry(activeHost)" }),
				" re-keys the per-host canvas. Nothing reflows because every tab reserves the same daemon-slot width whether active or not."
			] })
		] }),
		"\n",
		createVNode("div", {
			class: "hs-win",
			children: [
				createVNode("div", {
					class: "hs-title",
					children: [
						createVNode("span", {
							class: "tl",
							style: "background:#ff5f56"
						}),
						createVNode("span", {
							class: "tl",
							style: "background:#ffbd2e"
						}),
						createVNode("span", {
							class: "tl",
							style: "background:#27c93f"
						}),
						createVNode(_components.b, { children: "Kolu [pureintent] — Kolu [srid@zest]" })
					]
				}),
				createVNode("div", {
					class: "hs-bar",
					children: [
						createVNode(Logo, {}),
						createVNode("span", {
							class: "hs-tab",
							children: [
								createVNode("span", { class: "hs-dot hs-ok" }),
								"local",
								createVNode(Padi, {}),
								createVNode(Kaval, {})
							]
						}),
						createVNode("span", {
							class: "hs-tab active",
							children: [
								createVNode("span", { class: "hs-dot hs-ok" }),
								"srid@zest",
								createVNode(Padi, {}),
								createVNode(Kaval, {}),
								createVNode("span", {
									class: "hs-x",
									children: "✕"
								})
							]
						}),
						createVNode("span", {
							class: "hs-tab",
							children: [
								createVNode("span", { class: "hs-dot hs-ok" }),
								"sincereintent",
								createVNode("span", {
									class: "hs-badge",
									children: "2"
								}),
								createVNode(Padi, {}),
								createVNode(Kaval, {}),
								createVNode("span", {
									class: "hs-x",
									children: "✕"
								})
							]
						}),
						createVNode("span", {
							class: "hs-add",
							children: "+"
						})
					]
				}),
				createVNode("div", {
					class: "cv",
					style: "height:34px"
				}),
				createVNode("div", {
					class: "hs-cap",
					children: createVNode(_components.p, { children: [
						"Faithful to the shipped strip. Health reads well — the ",
						createVNode("b", {
							class: "ok",
							children: "green"
						}),
						" dots and the amber ",
						createVNode("b", {
							class: "am",
							children: "2"
						}),
						" say ",
						createVNode(_components.code, { children: "sincereintent" }),
						" has agents waiting. But look at the seam: a hard ",
						createVNode(_components.b, { children: "opaque band" }),
						" with a 1px border sits ",
						createVNode(_components.i, { children: "on top of" }),
						" the canvas grid, not part of it."
					] })
				})
			]
		}),
		"\n",
		createVNode(_components.p, { children: "Three problems the first cut left standing:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "It reads as a toolbar, not part of the workspace." }),
				" Opaque fill, hard border, a\nvisible seam against the canvas. Nothing about it says “this ",
				createVNode(_components.em, { children: "is" }),
				" the canvas’s\nframe.”"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "It never leaves the tab-row box." }),
				" Every host is a rectangle in a row; add enough\nand it overflows into a ",
				createVNode(_components.code, { children: "⋯" }),
				" menu. The row is the ceiling."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Switching is mouse-only, and the keyboard tier is taken." }),
				" ",
				createVNode(_components.code, { children: "⌘1–9" }),
				" is positional\n",
				createVNode(_components.em, { children: "terminal" }),
				" switch, ",
				createVNode(_components.code, { children: "Ctrl+Tab" }),
				" cycles terminals, ",
				createVNode(_components.code, { children: "⌘T" }),
				"/",
				createVNode(_components.code, { children: "⌘N" }),
				" make one — hosts get\nnothing.",
				createVNode($$Footnote, { children: [
					"Confirmed in ",
					createVNode($$Cite, { file: "packages/client/src/input/actions.ts" }),
					": the ",
					createVNode(_components.code, { children: "switchTo1…9" }),
					" block binds ",
					createVNode(_components.code, { children: "{ key: String(i), mod: true }" }),
					" to dock-row terminal switch, and ",
					createVNode(_components.code, { children: "Ctrl+Tab" }),
					" (",
					createVNode(_components.code, { children: "shiftOptional" }),
					") cycles terminals. The palette (",
					createVNode($$Cite, { file: "packages/client/src/commands.tsx" }),
					") registers no host action. So a host keyboard path can’t borrow the number row — that tier belongs to terminals."
				] })
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "make-the-box-beautiful",
			children: "Make the box beautiful"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Before changing the paradigm, fix the ",
			createVNode(_components.em, { children: "craft" }),
			" — same tab metaphor, but it stops\nlooking bolted-on. Four moves: ",
			createVNode(_components.strong, { children: "frost the band" }),
			" so the canvas grid shows through\n(it becomes a lens over the workspace, not a lid); give each host its ",
			createVNode(_components.strong, { children: "own hue" }),
			" —\na coloured focus ring on the dot and, on the active tab, a soft hue underglow — so a\nhost feels like a ",
			createVNode(_components.em, { children: "place" }),
			", not a label; ",
			createVNode(_components.strong, { children: "dissolve the seam" }),
			" by letting the active\ntab’s belly bleed into the canvas (the connected-tab metaphor done right — no border\nline between “active host” and “its canvas”); and ",
			createVNode(_components.strong, { children: "cross-fade on switch" }),
			" (150 ms\nhue + belly slide) so hopping hosts feels like moving, not repainting."
		] }),
		"\n",
		createVNode("div", {
			class: "hs-win",
			children: [createVNode("div", {
				class: "cv",
				children: [createVNode("div", {
					class: "gbar",
					children: [
						createVNode(Logo, {}),
						createVNode("span", {
							class: "gtab",
							style: "--hue:#64748b",
							children: [createVNode("span", {
								class: "huedot",
								style: "background:#64748b"
							}), "local"]
						}),
						createVNode("span", {
							class: "gtab on",
							style: "--hue:#7c3aed",
							children: [
								createVNode("span", { class: "belly" }),
								createVNode("span", {
									class: "huedot",
									style: "background:#7c3aed"
								}),
								"srid@zest",
								createVNode("span", {
									class: "gdm hs-padi",
									children: "P"
								}),
								createVNode("span", {
									class: "gdm hs-kaval",
									children: ">_"
								}),
								createVNode("span", {
									class: "gx",
									children: "✕"
								})
							]
						}),
						createVNode("span", {
							class: "gtab",
							style: "--hue:#0d9488",
							children: [
								createVNode("span", {
									class: "huedot",
									style: "background:#0d9488"
								}),
								"sincereintent",
								createVNode("span", {
									class: "hs-badge",
									children: "2"
								})
							]
						}),
						createVNode("span", {
							class: "gadd",
							children: "+"
						})
					]
				}), createVNode("div", { style: "height:56px" })]
			}), createVNode("div", {
				class: "hs-cap",
				children: createVNode(_components.p, { children: [
					"Same tabs, real craft. The band is ",
					createVNode(_components.b, { children: "frosted glass" }),
					" — the grid reads straight through it. Each host owns a ",
					createVNode(_components.b, { children: "hue" }),
					" (",
					createVNode("span", {
						style: "color:#64748b",
						children: "slate"
					}),
					" · ",
					createVNode("span", {
						style: "color:#7c3aed",
						children: "violet"
					}),
					" · ",
					createVNode("span", {
						style: "color:#0d9488",
						children: "teal"
					}),
					"); the active tab glows in its hue and its ",
					createVNode(_components.b, { children: "belly dissolves into the canvas" }),
					" — no seam. A switch cross-fades the hue and slides the belly. Resting tabs are quiet; the active one is rich."
				] })
			})]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "The hue already existed — we just spent it better",
			children: createVNode(_components.p, { children: [
				"The starting point (before this note shipped): kolu derived a per-hostname theme\ncolour and tinted the whole window chrome with it — a faint whole-bar wash read off\n",
				createVNode(_components.code, { children: "themeColor()" }),
				" in ",
				createVNode($$Cite, { file: "packages/client/src/ChromeBar.tsx" }),
				". The\nshipped design promotes that colour to a ",
				createVNode(_components.em, { children: "per-host" }),
				" identity — one hue per tab, the\nactive hue underglowing the belly — and makes the header itself ",
				createVNode(_components.strong, { children: "neutral" }),
				" (the\ncolour lives on the tabs, not a same-hue band that swallowed them). The seed→palette\nfunction now lives in ",
				createVNode($$Cite, { file: "packages/common/src/hostHue.ts" }),
				" as the single\nsource of truth shared by the server’s PWA ",
				createVNode(_components.code, { children: "theme-color" }),
				" and the client’s\ntab/canvas hue; each chip just carries a ",
				createVNode(_components.code, { children: "–hue" }),
				" custom property.\n",
				createVNode(_components.code, { children: "color-mix" }),
				" and ",
				createVNode(_components.code, { children: "backdrop-filter" }),
				" are the whole toolkit."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "out-of-the-box--the-host-as-a-room",
			children: "Out of the box · the host as a room"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Now leave the row. A host isn’t a document you tab between — it’s a ",
			createVNode(_components.strong, { children: "place" }),
			" you’re\n",
			createVNode(_components.em, { children: "inside" }),
			". So drop the tab strip and let the active host own the whole window: its hue\nwashes the canvas edges in a soft halo, and identity collapses to ",
			createVNode(_components.strong, { children: "one" }),
			" thing — a\n",
			createVNode(_components.strong, { children: "presence pill" }),
			" floating at the top (“you are in ",
			createVNode(_components.code, { children: "srid@zest" }),
			"”). Click it (or ",
			createVNode(_components.code, { children: "⌘K" }),
			")\nand it ",
			createVNode(_components.strong, { children: "blooms" }),
			" into a vertical list of rooms, each in its own hue, that you\n",
			createVNode(_components.em, { children: "teleport" }),
			" between with a full-window hue cross-fade. No row to overflow: ten hosts\nis a scroll, not a ",
			createVNode(_components.code, { children: "⋯" }),
			" menu."
		] }),
		"\n",
		createVNode("div", {
			class: "hs-win",
			children: [createVNode("div", {
				class: "cv room",
				style: "--hue:#7c3aed",
				children: [
					createVNode("div", { class: "halo" }),
					createVNode("div", { class: "edge" }),
					createVNode("div", {
						class: "presence",
						children: [
							createVNode("span", {
								class: "huedot",
								style: "background:#7c3aed"
							}),
							"srid@zest",
							createVNode("span", {
								style: "color:#a79bb2",
								children: "▾"
							})
						]
					}),
					createVNode("div", {
						class: "bloom",
						children: [
							createVNode("div", {
								class: "rchip",
								style: "--hue:#64748b",
								children: [
									createVNode("span", {
										class: "rbar",
										style: "background:#64748b"
									}),
									createVNode("span", {
										class: "huedot",
										style: "background:#64748b"
									}),
									"local"
								]
							}),
							createVNode("div", {
								class: "rchip on",
								style: "--hue:#7c3aed",
								children: [
									createVNode("span", { class: "rbar" }),
									createVNode("span", {
										class: "huedot",
										style: "background:#7c3aed"
									}),
									"srid@zest"
								]
							}),
							createVNode("div", {
								class: "rchip",
								style: "--hue:#0d9488",
								children: [
									createVNode("span", {
										class: "rbar",
										style: "background:#0d9488"
									}),
									createVNode("span", {
										class: "huedot",
										style: "background:#0d9488"
									}),
									"sincereintent",
									createVNode("span", {
										class: "hs-badge",
										style: "margin-left:auto",
										children: "2"
									})
								]
							})
						]
					})
				]
			}), createVNode("div", {
				class: "hs-cap",
				children: createVNode(_components.p, { children: [
					"The active host ",
					createVNode(_components.b, { children: "is the environment" }),
					" — a violet halo bleeds in from the top edge, so you always feel ",
					createVNode(_components.i, { children: "where you are" }),
					" without reading a label. Identity is one ",
					createVNode(_components.b, { children: "presence pill" }),
					"; clicking it blooms the room list. Switching cross-fades the whole halo to the next hue. This is the strongest “fit with the canvas” answer: the host isn’t chrome above the canvas, it ",
					createVNode(_components.i, { children: "tints" }),
					" the canvas."
				] })
			})]
		}),
		"\n",
		createVNode(_components.p, { children: ["The trade: with no persistent row, a sick remote can’t shout from the corner of your\neye — you’d learn it’s red only on opening the bloom.", createVNode($$Footnote, { children: [
			"Mitigation, and the reason the “room” and the “orb rail” pair: keep a thin vertical rail of host ",
			createVNode(_components.i, { children: "coins" }),
			" (each host’s hue, pulsing amber when it’s awaiting you) flush against the canvas edge as the room’s ",
			createVNode(_components.em, { children: "resting" }),
			" state. It’s the ambient-attention channel the pill alone lacks — the pill answers “where am I,” the rail answers “who needs me,” and clicking either opens the same bloom."
		] })] }),
		"\n",
		createVNode(_components.h2, {
			id: "out-of-the-box--the-host-map",
			children: "Out of the box · the host map"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The second paradigm leans all the way into what kolu already is: an infinite canvas\nwith a ",
			createVNode(_components.strong, { children: "camera per host" }),
			". So make switching ",
			createVNode(_components.em, { children: "navigation of one continuous space" }),
			".\n",
			createVNode(_components.code, { children: "⌘K" }),
			" (or a pinch/zoom-out past the canvas edge) pulls the camera back to a ",
			createVNode(_components.strong, { children: "host\nmap" }),
			" — every host a live-preview card of its real tiles in miniature, laid out\nspatially, the active one lifted, an awaiting one glowing amber. Pick one and the\ncamera ",
			createVNode(_components.strong, { children: "flies in" }),
			". Switching stops being “click a tab” and becomes “fly to a\nplace.”"
		] }),
		"\n",
		createVNode("div", {
			class: "hs-win",
			children: [createVNode("div", {
				class: "cv mc",
				children: [
					createVNode("div", {
						class: "mcard",
						style: "--hue:#64748b",
						children: [createVNode("div", {
							class: "mhead",
							children: [createVNode("span", {
								class: "huedot",
								style: "background:#64748b"
							}), "local"]
						}), createVNode("div", {
							class: "mbody",
							children: [
								createVNode("div", {
									class: "fl",
									style: "width:80%"
								}),
								createVNode("div", {
									class: "fl",
									style: "width:55%"
								}),
								createVNode("div", {
									class: "fl",
									style: "width:68%"
								})
							]
						})]
					}),
					createVNode("div", {
						class: "mcard on",
						style: "--hue:#7c3aed",
						children: [createVNode("div", {
							class: "mhead",
							children: [createVNode("span", {
								class: "huedot",
								style: "background:#7c3aed"
							}), "srid@zest"]
						}), createVNode("div", {
							class: "mbody",
							style: "position:relative",
							children: [
								createVNode("span", {
									class: "mtile",
									style: "left:8px;top:8px;width:52px;height:30px;background:#f3eefb"
								}),
								createVNode("span", {
									class: "mtile",
									style: "left:66px;top:8px;width:64px;height:44px;background:#efeaf9"
								}),
								createVNode("span", {
									class: "mtile",
									style: "left:8px;top:44px;width:52px;height:24px;background:#f5f1fc"
								})
							]
						})]
					}),
					createVNode("div", {
						class: "mcard await",
						style: "--hue:#0d9488",
						children: [createVNode("div", {
							class: "mhead",
							children: [
								createVNode("span", {
									class: "huedot",
									style: "background:#0d9488"
								}),
								"sincereintent",
								createVNode("span", {
									class: "hs-badge",
									style: "margin-left:auto",
									children: "2"
								})
							]
						}), createVNode("div", {
							class: "mbody",
							children: [
								createVNode("div", {
									class: "fl",
									style: "width:70%;background:#f4e6c8"
								}),
								createVNode("div", {
									class: "fl",
									style: "width:88%"
								}),
								createVNode("div", {
									class: "fl",
									style: "width:48%;background:#f4e6c8"
								})
							]
						})]
					})
				]
			}), createVNode("div", {
				class: "hs-cap",
				children: createVNode(_components.p, { children: [
					"Zoom out and every host is a ",
					createVNode(_components.b, { children: "live thumbnail" }),
					" of its actual canvas — you recognize a machine by ",
					createVNode(_components.i, { children: "what’s on it" }),
					", not a name string. The active card is ",
					createVNode(_components.b, { children: "lifted" }),
					" in its hue; ",
					createVNode(_components.code, { children: "sincereintent" }),
					" ",
					createVNode(_components.b, { children: "glows amber" }),
					" because it’s waiting. Click → the camera ",
					createVNode(_components.b, { children: "flies in" }),
					". Reuses kolu’s per-host canvas + camera (",
					createVNode(_components.code, { children: "cameraSwap" }),
					", ",
					createVNode(_components.code, { children: "useCanvasViewport" }),
					") rather than inventing chrome."
				] })
			})]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Why this one is deeply kolu-native",
			children: createVNode(_components.p, { children: [
				"Kolu already keeps a per-host canvas and a camera it swaps on switch\n(",
				createVNode($$Cite, { file: "packages/client/src/canvas/cameraSwap.ts" }),
				", ",
				createVNode($$Cite, { file: "packages/client/src/canvas/viewport/useCanvasViewport.ts" }),
				").\nThe host map isn’t a new surface — it’s the ",
				createVNode(_components.em, { children: "zoomed-out" }),
				" state of the space that’s\nalready there. The live thumbnails are the same tile tree the canvas renders, drawn\nsmall. The cost is a real-preview render at map scale; the payoff is that “switch\nhost” and “navigate the canvas” become one gesture, not two mental models."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-interaction-underneath",
			children: "The interaction underneath"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Whatever the surface — polished tabs, room bloom, or host map — the ",
			createVNode(_components.em, { children: "keyboard" }),
			" story\nis the same, and it isn’t a new invention: kolu ",
			createVNode(_components.strong, { children: "already" }),
			" ships this exact pattern\nfor workspaces. ",
			createVNode(_components.code, { children: "⌘⇧K" }),
			" opens the workspace switcher, which is literally\n",
			createVNode(_components.code, { children: "commandPalette.openGroup(\"Search workspaces\")" }),
			" ",
			createVNode($$Cite, { file: "packages/client/src/useActionContext.ts" }),
			" —\na scoped palette group, not a bespoke modal. Host switching mirrors it one-for-one:\n",
			createVNode(_components.code, { children: "⌘⇧H" }),
			" (",
			createVNode(_components.strong, { children: "H for host" }),
			") → ",
			createVNode(_components.code, { children: "commandPalette.openGroup(\"Switch host\")" }),
			", fuzzy-matched and\n",
			createVNode(_components.strong, { children: "sorted by who’s awaiting you" }),
			"; ",
			createVNode(_components.code, { children: "Enter" }),
			" picks. ",
			createVNode(_components.code, { children: "⌘⇧H" }),
			" is free and follows the\n",
			createVNode(_components.code, { children: "Mod+Shift+<letter>" }),
			" convention the codebase already names for exactly this.",
			createVNode($$Footnote, { children: [
				createVNode($$Cite, { file: "packages/client/src/input/actions.ts" }),
				" line 281 calls out “the ",
				createVNode(_components.code, { children: "Mod+Shift+<letter>" }),
				" convention used by ",
				createVNode(_components.code, { children: "openWorkspaceSwitcher" }),
				",” and a grep confirms no ",
				createVNode(_components.code, { children: "KeyH" }),
				" / ",
				createVNode(_components.code, { children: "⌘⇧H" }),
				" binding exists in ",
				createVNode(_components.code, { children: "actions.ts" }),
				" or ",
				createVNode(_components.code, { children: "prohibitedKeybinds.ts" }),
				". So host switching gets a chord that’s free, precedented, and mnemonic — no invented combo, no hedge."
			] })
		] }),
		"\n",
		createVNode("div", {
			class: "hs-win",
			children: [createVNode("div", {
				class: "cv",
				style: "padding:1.1rem",
				children: createVNode("div", {
					class: "hs-pal",
					children: [
						createVNode("div", {
							class: "hs-search",
							children: [
								createVNode(_components.span, { children: "Switch host" }),
								createVNode("span", {
									style: "margin-left:auto",
									children: createVNode("span", {
										class: "hs-kbd",
										children: "⌘⇧H"
									})
								}),
								createVNode("span", {
									class: "cur",
									children: "z▏"
								})
							]
						}),
						createVNode("div", {
							class: "hs-sec",
							children: "Needs you"
						}),
						createVNode("div", {
							class: "hs-row",
							children: [
								createVNode("span", {
									class: "huedot",
									style: "background:#0d9488"
								}),
								createVNode("span", {
									class: "grow",
									children: [createVNode("div", {
										class: "nm",
										children: "sincereintent"
									}), createVNode("div", {
										class: "sub",
										children: "2 agents awaiting · padi ok · kaval ok"
									})]
								}),
								createVNode("span", {
									class: "hs-badge",
									children: "2"
								})
							]
						}),
						createVNode("div", {
							class: "hs-sec",
							children: "All hosts"
						}),
						createVNode("div", {
							class: "hs-row sel",
							children: [
								createVNode("span", {
									class: "huedot",
									style: "background:#7c3aed"
								}),
								createVNode("span", {
									class: "grow",
									children: [createVNode("div", {
										class: "nm",
										children: [
											"srid@",
											createVNode(_components.b, { children: "z" }),
											"est"
										]
									}), createVNode("div", {
										class: "sub",
										children: "active · padi ok · kaval ok"
									})]
								}),
								createVNode("span", {
									class: "hs-kbd",
									children: "↵"
								})
							]
						}),
						createVNode("div", {
							class: "hs-row",
							children: [createVNode("span", {
								class: "huedot",
								style: "background:#64748b"
							}), createVNode("span", {
								class: "grow",
								children: [createVNode("div", {
									class: "nm",
									children: "local"
								}), createVNode("div", {
									class: "sub",
									children: "padi ok · kaval ok"
								})]
							})]
						})
					]
				})
			}), createVNode("div", {
				class: "hs-cap",
				children: createVNode(_components.p, { children: [
					createVNode(_components.code, { children: "⌘⇧H" }),
					" → type → ",
					createVNode(_components.code, { children: "↵" }),
					" — the ",
					createVNode(_components.b, { children: [
						"same switcher pattern as ",
						createVNode(_components.code, { children: "⌘⇧K" }),
						" workspaces"
					] }),
					", just a different group. Awaiting hosts float to a ",
					createVNode(_components.b, { children: "Needs you" }),
					" group; the fuzzy match bolds the hit (",
					createVNode(_components.code, { children: "z" }),
					" → srid@",
					createVNode(_components.b, { children: "z" }),
					"est). No per-host number caps — those chords are terminals’. It’s ",
					createVNode(_components.b, { children: "additive to the palette" }),
					", so there’s almost no new UI to build."
				] })
			})]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"And one smaller fix worth pairing anywhere: the ",
			createVNode(_components.code, { children: "+" }),
			" should ",
			createVNode(_components.strong, { children: [
				"autocomplete from\n",
				createVNode(_components.code, { children: "~/.ssh/config" }),
				" and recents"
			] }),
			" with a live reachability dot, instead of a blank field\nyou type into from memory — and the destructive ",
			createVNode(_components.code, { children: "✕" }),
			" should leave the resting surface\nfor a right-click / overflow action."
		] }),
		"\n",
		createVNode("div", {
			class: "hs-win",
			children: [createVNode("div", {
				class: "cv",
				style: "padding:1.1rem;display:flex;justify-content:center",
				children: createVNode("div", {
					class: "hs-drop",
					children: [
						createVNode("div", {
							class: "hs-in",
							children: [
								createVNode("span", {
									style: "color:#9333ea",
									children: "+"
								}),
								"srid@z",
								createVNode("span", {
									class: "ghost",
									children: "est"
								})
							]
						}),
						createVNode("div", {
							class: "hs-opt sel",
							children: [
								createVNode("span", { class: "hs-dot hs-ok" }),
								"srid@zest",
								createVNode("span", {
									class: "tag",
									children: "recent"
								})
							]
						}),
						createVNode("div", {
							class: "hs-opt",
							children: [
								createVNode("span", { class: "hs-dot hs-ok" }),
								"srid@pu-box",
								createVNode("span", {
									class: "tag",
									children: "ssh config"
								})
							]
						}),
						createVNode("div", {
							class: "hs-opt",
							children: [
								createVNode("span", { class: "hs-dot hs-idle" }),
								"root@fly-edge",
								createVNode("span", {
									class: "tag",
									children: "ssh config"
								})
							]
						})
					]
				})
			}), createVNode("div", {
				class: "hs-cap",
				children: [
					"The ",
					createVNode(_components.code, { children: "+" }),
					" completes as you type — ",
					createVNode(_components.code, { children: "~/.ssh/config" }),
					" entries and recents, each with a reachability dot (grey = untried). No memorized host string, no blind ssh."
				]
			})]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "what-id-ship-and-where-it-wires-in",
			children: "What I’d ship, and where it wires in"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The moves stack, they don’t compete. ",
			createVNode(_components.strong, { children: "Ship the craft first" }),
			" (§2) — frosted band,\nper-host hue, seam dissolve, cross-fade — because it’s pure CSS on the strip that\nexists and it makes every later paradigm look right. ",
			createVNode(_components.strong, { children: "Then the palette switcher" }),
			"\n(§5) for the keyboard win. The two paradigms are bigger bets: the ",
			createVNode(_components.strong, { children: "host map" }),
			" (§4)\nis the one I’d chase, because it’s not new chrome — it’s the zoomed-out state of a\ncanvas kolu already has, so it earns its complexity. The ",
			createVNode(_components.strong, { children: "room" }),
			" (§3) is the boldest\nvisual but the riskiest (it removes the always-visible attention channel; it needs\nthe orb rail to be honest). None of it invents host state: the switch stays one\n",
			createVNode(_components.code, { children: "activeHost" }),
			" write, and the host list + urgency counts already stream into the strip."
		] }),
		"\n",
		createVNode($$D2, {
			caption: "Every surface — polished tabs, room bloom, host map, palette — is a front-end onto one seam. They all read padiMap.entries (host list) and each entry's urgency cell (awaiting count) — the exact reads HostSelectorStrip makes today — and pick with the same setActiveHost. The ⌘⇧H switcher is the ⌘⇧K workspace switcher's exact pattern: commandPalette.openGroup(...). The per-host hue reuses the existing themeColor() derivation; the host map additionally rides the canvas camera kolu already swaps. No new store, no new stream, no invented chord.",
			code: `direction: down
tabs: "Polished tabs (§2)"
room: "Room bloom (§3)"
map: "Host map (§4) — rides canvas camera"
pal: "⌘⇧H switcher (§5) — mirrors ⌘⇧K workspace"
grp: "commandPalette.openGroup('Switch host')"
entries: "padiMap.entries — host list"
urg: "entry.cells.urgency — awaiting count"
hue: "themeColor() — per-host hue"
set: "setActiveHost(host)"
cam: "cameraSwap / useCanvasViewport"
canvas: "useEntry(activeHost) re-keys the canvas"
tabs -> hue
room -> hue
map -> cam
pal -> grp
grp -> entries: "reads"
grp -> urg: "sorts by"
tabs -> set
room -> set
map -> set
grp -> set
set -> canvas
`
		}),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Status — the craft pass shipped",
			children: createVNode(_components.p, { children: [
				"The ",
				createVNode(_components.strong, { children: "craft pass (§2)" }),
				" shipped in ",
				createVNode($$PrLink, { pr: 1743 }),
				": per-host identity hue on\nthe tabs ",
				createVNode(_components.em, { children: "and" }),
				" a faint wash across the canvas floor, a neutral borderless header,\nthe seam dissolve, the daemon glyphs quieting at rest, a dots grid, and a house\nglyph disambiguating the local host. The ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "⌘⇧H" }), " switcher (§5)"] }),
				" shipped as\nproposed — a fuzzy “Switch host” palette group mirroring ",
				createVNode(_components.code, { children: "⌘⇧K" }),
				", reached by the\nchord or a search icon in the host bar. That PR also ",
				createVNode(_components.strong, { children: "ungated" }),
				" remote hosts (the\n“+” is always present, alpha-warned at point of use). The two paradigms — ",
				createVNode(_components.strong, { children: "the\nroom" }),
				" (§3) and ",
				createVNode(_components.strong, { children: "the host map" }),
				" (§4) — remain open directions, as does the\nswitcher’s awaiting-you sort. The hue derivation landed as the shared\n",
				createVNode($$Cite, { file: "packages/common/src/hostHue.ts" }),
				" the PWA\ntheme-color also draws from."
			] })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Host switching — UI prototypes",
	"description": "The host tab bar is a solid browser-tab metaphor, but it reads as a toolbar bolted above the canvas, switching is mouse-only, and it never leaves the tab-row box. This note renders the bar as it is, then pushes on two axes the first cut missed — visual craft (frosted glass, per-host hue, a seam that dissolves into the canvas, motion) and paradigm (the host as a coloured room; a zoom-out host map that rides kolu's canvas camera) — each as a faithful mockup grounded in the seams the code already exposes.",
	"parents": ["pty-daemon-chrome-bar", "feature"],
	"status": "implemented",
	"maturity": "budding",
	"updated": "2026-07-09T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-bar-today",
			"text": "The bar today"
		},
		{
			"depth": 2,
			"slug": "make-the-box-beautiful",
			"text": "Make the box beautiful"
		},
		{
			"depth": 2,
			"slug": "out-of-the-box--the-host-as-a-room",
			"text": "Out of the box · the host as a room"
		},
		{
			"depth": 2,
			"slug": "out-of-the-box--the-host-map",
			"text": "Out of the box · the host map"
		},
		{
			"depth": 2,
			"slug": "the-interaction-underneath",
			"text": "The interaction underneath"
		},
		{
			"depth": 2,
			"slug": "what-id-ship-and-where-it-wires-in",
			"text": "What I’d ship, and where it wires in"
		}
	];
}
var url = "src/content/atlas/host-switch-ux.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/host-switch-ux.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/host-switch-ux.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, HS, Kaval, Logo, Padi, file, frontmatter, getHeadings, url };
