import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$D2 } from "./D2_CPv-UX0x.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import { t as $$Cite } from "./Cite_IypTixBQ.mjs";
//#region src/content/atlas/canvas-tile-state-borders.mdx
var ProtoStyles = () => createVNode("style", { children: `
  .tb-canvas{background:#0c0c0e;border:1px solid #27272c;border-radius:12px;padding:1.15rem 1rem .95rem;margin:1.2rem 0;--rust:#d97757;--violet:#a78bfa;--teal:#5a9ea0;--repo:#5b6470;}
  .tb-canvas .lead{font:600 .68rem/1 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin:0 0 .85rem .1rem}
  .tb-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:.9rem}
  @media (max-width:640px){.tb-grid{grid-template-columns:repeat(2,1fr)}}
  .tb-cell{display:flex;flex-direction:column;gap:.45rem}
  .tb-tile{position:relative;height:82px;border-radius:9px;border:1.5px solid var(--repo);background:#161618;overflow:hidden;transition:box-shadow .2s}
  .tb-titlebar{display:flex;align-items:center;gap:.4rem;padding:.34rem .52rem;background:rgba(228,228,232,.06);border-bottom:1px solid rgba(228,228,232,.08)}
  .tb-dot{width:7px;height:7px;border-radius:50%;background:var(--repo);flex:none}
  .tb-name{font:600 .56rem/1 ui-monospace,monospace;color:#9aa0aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tb-body{padding:.5rem .55rem;font:.62rem/1.35 ui-monospace,monospace;color:#9aa0aa}
  .tb-caption{font:600 .62rem/1.25 ui-sans-serif,system-ui;color:#8b929d;text-align:center}
  .tb-caption b{color:#c7ccd6}
  /* title dot/name carry the state tone, in every language */
  .tb-working .tb-dot{background:var(--rust)} .tb-working .tb-name{color:#c69b86}
  .tb-waiting .tb-dot,.tb-alert .tb-dot{background:var(--violet)}
  .tb-waiting .tb-name,.tb-alert .tb-name{color:#b3a8d6}
  /* ── A · HALO — outer glow; loudness tracks the attention rank, motion = "needs you" ── */
  /* rank 3 · working — steady rust hum, no motion */
  .lang-halo .tb-working{box-shadow:0 0 0 1px color-mix(in oklch,var(--rust) 38%,transparent),0 0 13px -4px color-mix(in oklch,var(--rust) 72%,transparent)}
  /* rank 2 · waiting (fresh) — brighter violet, gentle slow breathe */
  .lang-halo .tb-waiting{animation:tb-wait-breathe 2.4s ease-in-out infinite}
  @keyframes tb-wait-breathe{0%,100%{box-shadow:0 0 0 1px color-mix(in oklch,var(--violet) 52%,transparent),0 0 14px -4px color-mix(in oklch,var(--violet) 58%,transparent)}50%{box-shadow:0 0 0 1.5px color-mix(in oklch,var(--violet) 88%,transparent),0 0 23px -2px var(--violet)}}
  /* rank 4 · waiting (stale / parked) — dim violet ember, static, below the working hum */
  .lang-halo .tb-waitingstale{box-shadow:0 0 0 1px color-mix(in oklch,var(--violet) 20%,transparent),0 0 8px -5px color-mix(in oklch,var(--violet) 36%,transparent)}
  /* rank 1 · alert — fast throb + expanding halo, brightest */
  .lang-halo .tb-alert{animation:tb-halo-throb 1.2s ease-in-out infinite}
  @keyframes tb-halo-throb{0%,100%{box-shadow:0 0 0 1px var(--violet),0 0 0 0 color-mix(in oklch,var(--violet) 55%,transparent),0 0 14px -3px var(--violet)}50%{box-shadow:0 0 0 1.5px var(--violet),0 0 0 6px color-mix(in oklch,var(--violet) 16%,transparent),0 0 26px -1px var(--violet)}}
  /* ── B · LIVE BORDER — the border line itself takes the state color ── */
  .lang-border .tb-working{border-color:var(--rust)}
  .lang-border .tb-waiting{animation:tb-bord-wait 2.4s ease-in-out infinite}
  @keyframes tb-bord-wait{0%,100%{border-color:color-mix(in oklch,var(--violet) 55%,#161618)}50%{border-color:var(--violet)}}
  .lang-border .tb-alert{animation:tb-bord-throb 1.2s ease-in-out infinite}
  @keyframes tb-bord-throb{0%,100%{border-color:color-mix(in oklch,var(--violet) 50%,#161618);box-shadow:0 0 0 0 transparent}50%{border-color:var(--violet);box-shadow:0 0 0 2px color-mix(in oklch,var(--violet) 24%,transparent)}}
  /* ── C · RUN / SWEEP (refined) — motion TYPE + SPEED carry the state, so the
     COLOUR is the terminal's own (--tile-c). Working "runs" (a long soft glow
     circulates, calm); needs-you "sweeps" (a sharp comet orbits) and its SPEED is
     the urgency: fastest on alert, slower on fresh-waiting, slower still as it
     goes stale. Louder states also brighten/saturate the SAME tile colour. Ring
     via the conic-mask trick. ── */
  @keyframes tb-spin{to{transform:rotate(1turn)}}
  .lang-runsweep .tb-tile{border-color:color-mix(in oklch,var(--tile-c) 42%,#161618)}
  .lang-runsweep .tb-dot{background:var(--tile-c)}
  .lang-runsweep .tb-name{color:color-mix(in oklch,var(--tile-c) 62%,#9aa0aa)}
  /* working — RUNS as MARCHING ANTS: a dashed outline streams round all four
     edges (4 edge-gradients whose background-position animates), tile colour. */
  @keyframes tb-ants{to{background-position:10px 0,-10px 100%,0 -10px,100% 10px}}
  .lang-runsweep .tb-working::after{content:"";position:absolute;inset:0;border-radius:9px;pointer-events:none;background-image:linear-gradient(90deg,var(--tile-c) 50%,transparent 0),linear-gradient(90deg,var(--tile-c) 50%,transparent 0),linear-gradient(0deg,var(--tile-c) 50%,transparent 0),linear-gradient(0deg,var(--tile-c) 50%,transparent 0);background-repeat:repeat-x,repeat-x,repeat-y,repeat-y;background-size:10px 1.6px,10px 1.6px,1.6px 10px,1.6px 10px;background-position:0 0,0 100%,0 0,100% 0;animation:tb-ants .6s linear infinite}
  /* needs-you — SWEEPS: a sharp comet via the conic-mask ring; SPEED = urgency */
  .lang-runsweep .tb-waiting::after,.lang-runsweep .tb-waitingstale::after,.lang-runsweep .tb-alert::after{content:"";position:absolute;inset:0;border-radius:9px;padding:1.7px;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;pointer-events:none}
  .lang-runsweep .tb-alert::after{background:conic-gradient(from 0deg,transparent 0deg,var(--tile-c) 30deg,transparent 80deg,transparent 360deg);filter:brightness(1.6) saturate(1.7);animation:tb-spin 1s linear infinite}
  .lang-runsweep .tb-waiting::after{background:conic-gradient(from 0deg,transparent 0deg,var(--tile-c) 36deg,transparent 92deg,transparent 360deg);filter:brightness(1.3) saturate(1.35);animation:tb-spin 2.1s linear infinite}
  .lang-runsweep .tb-waitingstale::after{background:conic-gradient(from 0deg,transparent 0deg,var(--tile-c) 34deg,transparent 90deg,transparent 360deg);filter:brightness(.95) saturate(.85);animation:tb-spin 3.8s linear infinite}
  /* ── D · TOP BAR — a thin status bar on the top edge; reads at any zoom (canvas + minimap) ── */
  .lang-bar .tb-tile::after{content:"";position:absolute;top:0;left:0;height:2.5px;width:100%;pointer-events:none;background:transparent}
  .lang-bar .tb-working::after{background:var(--rust)}                                          /* rank 3 — steady rust hum */
  .lang-bar .tb-waiting::after{background:var(--violet);animation:tb-bar-pulse 2.4s ease-in-out infinite}  /* rank 2 — gentle pulse */
  @keyframes tb-bar-pulse{0%,100%{opacity:.55}50%{opacity:1}}
  .lang-bar .tb-alert::after{background:var(--violet);animation:tb-bar-blink 1.2s ease-in-out infinite}    /* rank 1 — sharper blink */
  @keyframes tb-bar-blink{0%,100%{opacity:1}50%{opacity:.28}}
  /* the same top-bar language at MINIMAP scale — markers carry a top edge, not a corner dot */
  .mm-panel{position:relative;width:248px;height:150px;margin:.2rem auto 0;background:#0c0c0e;border:1px solid #27272c;border-radius:9px;overflow:hidden;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:20px 20px}
  .mm-tile{position:absolute;border-radius:3px;background:#1b1b1f;border:1px solid #2d2d34;overflow:hidden}
  .mm-tile::after{content:"";position:absolute;top:0;left:0;width:100%;height:2px;background:transparent}
  .mm-working::after{background:var(--rust)}
  .mm-waiting::after{background:var(--violet);animation:tb-bar-pulse 2.4s ease-in-out infinite}
  .mm-stale::after{background:color-mix(in oklch,var(--violet) 40%,transparent);width:55%}
  .mm-alert::after{background:var(--violet);animation:tb-bar-blink 1.2s ease-in-out infinite}
  .mm-active{box-shadow:0 0 0 1.5px var(--teal);z-index:2}
  .mm-view{position:absolute;border:1px dashed rgba(255,255,255,.22);border-radius:3px;pointer-events:none}
  /* focus-vs-working demo: focus = teal inner ring, state = outer treatment */
  .tb-focus{box-shadow:inset 0 0 0 1.5px var(--teal)}
  .tb-pair{display:grid;grid-template-columns:1fr 1fr;gap:.9rem;max-width:24rem}
  @media (prefers-reduced-motion:reduce){
    .tb-canvas *{animation:none!important}
    .lang-halo .tb-waiting{box-shadow:0 0 0 1.5px color-mix(in oklch,var(--violet) 80%,transparent),0 0 18px -3px var(--violet)}
    .lang-halo .tb-alert{box-shadow:0 0 0 1.5px var(--violet),0 0 0 5px color-mix(in oklch,var(--violet) 18%,transparent)}
    .lang-border .tb-waiting{border-color:var(--violet)}
    .lang-border .tb-alert{border-color:var(--violet);box-shadow:0 0 0 2px color-mix(in oklch,var(--violet) 24%,transparent)}
    .lang-runsweep .tb-waiting::after,.lang-runsweep .tb-waitingstale::after,.lang-runsweep .tb-alert::after{display:none}
    .lang-runsweep .tb-waiting{box-shadow:0 0 0 1px var(--tile-c),0 0 9px -4px var(--tile-c)}
    .lang-runsweep .tb-waitingstale{box-shadow:0 0 0 1px color-mix(in oklch,var(--tile-c) 45%,transparent)}
    .lang-runsweep .tb-alert{box-shadow:0 0 0 1.5px var(--tile-c),0 0 13px -3px var(--tile-c)}
    .lang-bar .tb-waiting::after,.lang-bar .tb-alert::after,.mm-waiting::after,.mm-alert::after{opacity:1}
  }
  ` });
var STATES = [
	{
		k: "idle",
		cap: "Idle",
		tail: "/ done",
		sub: "$ ▏"
	},
	{
		k: "working",
		cap: "Working",
		tail: "",
		sub: "◐ Thinking…"
	},
	{
		k: "waiting",
		cap: "Waiting",
		tail: "· fresh",
		sub: "⏵ Waiting for input"
	},
	{
		k: "alert",
		cap: "Alert",
		tail: "(unread)",
		sub: "⏵ Awaiting input"
	}
];
var Gallery = (props) => createVNode("div", {
	class: `tb-canvas lang-${props.lang}`,
	children: [createVNode("div", {
		class: "lead",
		children: props.lead
	}), createVNode("div", {
		class: "tb-grid",
		children: STATES.map((s) => createVNode("div", {
			class: "tb-cell",
			children: [createVNode("div", {
				class: `tb-tile tb-${s.k}`,
				children: [createVNode("div", {
					class: "tb-titlebar",
					children: [createVNode("span", { class: "tb-dot" }), createVNode("span", {
						class: "tb-name",
						children: "argh · claude"
					})]
				}), createVNode("div", {
					class: "tb-body",
					children: s.sub
				})]
			}), createVNode("div", {
				class: "tb-caption",
				children: [
					createVNode("b", { children: s.cap }),
					" ",
					s.tail
				]
			})]
		}))
	})]
});
var DECAY = [
	{
		age: "just now",
		note: "rank 2 — loud",
		anim: "tb-wait-breathe 2.4s ease-in-out infinite",
		shadow: ""
	},
	{
		age: "~2h",
		note: "still above the hum",
		anim: "none",
		shadow: "0 0 0 1px color-mix(in oklch,var(--violet) 58%,transparent),0 0 16px -3px color-mix(in oklch,var(--violet) 68%,transparent)"
	},
	{
		age: "~4h",
		note: "crossing your window",
		anim: "none",
		shadow: "0 0 0 1px color-mix(in oklch,var(--violet) 36%,transparent),0 0 11px -4px color-mix(in oklch,var(--violet) 46%,transparent)"
	},
	{
		age: "stale · parked",
		note: "rank 4 — ember",
		anim: "none",
		shadow: "0 0 0 1px color-mix(in oklch,var(--violet) 18%,transparent),0 0 7px -5px color-mix(in oklch,var(--violet) 30%,transparent)"
	}
];
var DecayStrip = () => createVNode("div", {
	class: "tb-canvas lang-halo",
	children: [createVNode("div", {
		class: "lead",
		children: "Waiting · cooling with last-activity age — your activity window is the crossover"
	}), createVNode("div", {
		class: "tb-grid",
		children: DECAY.map((d) => createVNode("div", {
			class: "tb-cell",
			children: [createVNode("div", {
				class: "tb-tile tb-waiting",
				style: `animation:${d.anim}${d.shadow ? `;box-shadow:${d.shadow}` : ""}`,
				children: [createVNode("div", {
					class: "tb-titlebar",
					children: [createVNode("span", { class: "tb-dot" }), createVNode("span", {
						class: "tb-name",
						children: "argh · claude"
					})]
				}), createVNode("div", {
					class: "tb-body",
					children: ["⏵ Waiting · ", d.age]
				})]
			}), createVNode("div", {
				class: "tb-caption",
				children: [
					createVNode("b", { children: d.age }),
					createVNode("br", {}),
					d.note
				]
			})]
		}))
	})]
});
var ActiveDemo = () => createVNode("div", {
	class: "tb-canvas lang-halo",
	children: [createVNode("div", {
		class: "lead",
		children: "One active tile (teal · \"you are here\") among the ladder — the loudest border is never the active one"
	}), createVNode("div", {
		class: "tb-grid",
		children: [
			createVNode("div", {
				class: "tb-cell",
				children: [createVNode("div", {
					class: "tb-tile tb-working",
					style: "animation:none;box-shadow:inset 0 0 0 1.5px var(--teal),0 0 0 1px color-mix(in oklch,var(--rust) 20%,transparent),0 0 9px -5px color-mix(in oklch,var(--rust) 38%,transparent)",
					children: [createVNode("div", {
						class: "tb-titlebar",
						children: [createVNode("span", {
							class: "tb-dot",
							style: "background:var(--teal)"
						}), createVNode("span", {
							class: "tb-name",
							style: "color:#8fc3c4",
							children: "argh · claude"
						})]
					}), createVNode("div", {
						class: "tb-body",
						children: "◐ Thinking…"
					})]
				}), createVNode("div", {
					class: "tb-caption",
					children: [createVNode("b", { children: "Active" }), " · working — focus wins, aura muted"]
				})]
			}),
			createVNode("div", {
				class: "tb-cell",
				children: [createVNode("div", {
					class: "tb-tile tb-alert",
					children: [createVNode("div", {
						class: "tb-titlebar",
						children: [createVNode("span", { class: "tb-dot" }), createVNode("span", {
							class: "tb-name",
							children: "kaval · codex"
						})]
					}), createVNode("div", {
						class: "tb-body",
						children: "⏵ Awaiting input"
					})]
				}), createVNode("div", {
					class: "tb-caption",
					children: [createVNode("b", { children: "Alert" }), " — loudest, always inactive"]
				})]
			}),
			createVNode("div", {
				class: "tb-cell",
				children: [createVNode("div", {
					class: "tb-tile tb-waiting",
					children: [createVNode("div", {
						class: "tb-titlebar",
						children: [createVNode("span", { class: "tb-dot" }), createVNode("span", {
							class: "tb-name",
							children: "blog · claude"
						})]
					}), createVNode("div", {
						class: "tb-body",
						children: "⏵ Waiting · fresh"
					})]
				}), createVNode("div", {
					class: "tb-caption",
					children: [createVNode("b", { children: "Waiting" }), " · fresh — inactive"]
				})]
			}),
			createVNode("div", {
				class: "tb-cell",
				children: [createVNode("div", {
					class: "tb-tile tb-working",
					children: [createVNode("div", {
						class: "tb-titlebar",
						children: [createVNode("span", { class: "tb-dot" }), createVNode("span", {
							class: "tb-name",
							children: "odu · claude"
						})]
					}), createVNode("div", {
						class: "tb-body",
						children: "◐ Running tools"
					})]
				}), createVNode("div", {
					class: "tb-caption",
					children: [createVNode("b", { children: "Working" }), " — inactive hum"]
				})]
			})
		]
	})]
});
var RUNSWEEP = [
	{
		k: "alert",
		cap: "Alert",
		tail: "sweep · fastest",
		sub: "⏵ Awaiting input"
	},
	{
		k: "waiting",
		cap: "Waiting · fresh",
		tail: "sweep · medium",
		sub: "⏵ Waiting for input"
	},
	{
		k: "waitingstale",
		cap: "Waiting · stale",
		tail: "sweep · slow",
		sub: "⏵ Waiting · 6h"
	},
	{
		k: "working",
		cap: "Working",
		tail: "marching ants",
		sub: "◐ Thinking…"
	},
	{
		k: "idle",
		cap: "Idle",
		tail: "static",
		sub: "$ ▏"
	}
];
var RunSweepLadder = () => createVNode("div", {
	class: "tb-canvas lang-runsweep",
	style: "--tile-c:#5a9ea0",
	children: [createVNode("div", {
		class: "lead",
		children: "C · run vs sweep — one terminal colour (teal); motion-type + speed carry the state"
	}), createVNode("div", {
		class: "tb-grid",
		style: "grid-template-columns:repeat(5,1fr)",
		children: RUNSWEEP.map((s) => createVNode("div", {
			class: "tb-cell",
			children: [createVNode("div", {
				class: `tb-tile tb-${s.k}`,
				children: [createVNode("div", {
					class: "tb-titlebar",
					children: [createVNode("span", { class: "tb-dot" }), createVNode("span", {
						class: "tb-name",
						children: "argh · claude"
					})]
				}), createVNode("div", {
					class: "tb-body",
					children: s.sub
				})]
			}), createVNode("div", {
				class: "tb-caption",
				children: [
					createVNode("b", { children: s.cap }),
					createVNode("br", {}),
					s.tail
				]
			})]
		}))
	})]
});
var THEMECOLS = [
	{
		c: "#5a9ea0",
		n: "teal"
	},
	{
		c: "#d6a35c",
		n: "amber"
	},
	{
		c: "#6cc070",
		n: "green"
	},
	{
		c: "#6ea8e0",
		n: "blue"
	},
	{
		c: "#c98aa8",
		n: "rose"
	}
];
var RunSweepThemes = () => createVNode("div", {
	class: "tb-canvas lang-runsweep",
	children: [createVNode("div", {
		class: "lead",
		children: "…and the colour is the terminal's own — same waiting · sweep, five themes"
	}), createVNode("div", {
		class: "tb-grid",
		style: "grid-template-columns:repeat(5,1fr)",
		children: THEMECOLS.map((t) => createVNode("div", {
			class: "tb-cell",
			style: `--tile-c:${t.c}`,
			children: [createVNode("div", {
				class: "tb-tile tb-waiting",
				children: [createVNode("div", {
					class: "tb-titlebar",
					children: [createVNode("span", { class: "tb-dot" }), createVNode("span", {
						class: "tb-name",
						children: [t.n, " · agent"]
					})]
				}), createVNode("div", {
					class: "tb-body",
					children: "⏵ Waiting"
				})]
			}), createVNode("div", {
				class: "tb-caption",
				children: createVNode("b", { children: t.n })
			})]
		}))
	})]
});
var ContrastDemo = () => createVNode("div", {
	class: "tb-canvas lang-runsweep",
	children: [createVNode("div", {
		class: "lead",
		children: "Contrast — the same teal theme, colour locked against each tile's own bg"
	}), createVNode("div", {
		class: "tb-pair",
		children: [createVNode("div", {
			class: "tb-cell",
			children: [createVNode("div", {
				class: "tb-tile tb-working",
				style: "--tile-c:#79d2d4;background:#0e1316",
				children: [createVNode("div", {
					class: "tb-titlebar",
					style: "background:rgba(255,255,255,.06)",
					children: [createVNode("span", { class: "tb-dot" }), createVNode("span", {
						class: "tb-name",
						children: "dark theme"
					})]
				}), createVNode("div", {
					class: "tb-body",
					children: "◐ working"
				})]
			}), createVNode("div", {
				class: "tb-caption",
				children: [createVNode("b", { children: "Dark bg" }), " → accent lightened"]
			})]
		}), createVNode("div", {
			class: "tb-cell",
			children: [createVNode("div", {
				class: "tb-tile tb-working",
				style: "--tile-c:#0c6275;background:#f3efe4",
				children: [createVNode("div", {
					class: "tb-titlebar",
					style: "background:rgba(0,0,0,.05)",
					children: [createVNode("span", { class: "tb-dot" }), createVNode("span", {
						class: "tb-name",
						style: "color:#42606a",
						children: "light theme"
					})]
				}), createVNode("div", {
					class: "tb-body",
					style: "color:#5b6470",
					children: "◐ working"
				})]
			}), createVNode("div", {
				class: "tb-caption",
				children: [createVNode("b", { children: "Light bg" }), " → accent darkened"]
			})]
		})]
	})]
});
var MiniMap = () => createVNode("div", {
	class: "tb-canvas",
	children: [
		createVNode("div", {
			class: "lead",
			children: "D in the minimap — the same top-edge bar, scaled down (replaces today's corner dot)"
		}),
		createVNode("div", {
			class: "mm-panel",
			children: [
				createVNode("div", {
					class: "mm-tile mm-active mm-working",
					style: "left:20px;top:22px;width:66px;height:44px"
				}),
				createVNode("div", {
					class: "mm-tile mm-alert",
					style: "left:104px;top:16px;width:58px;height:40px"
				}),
				createVNode("div", {
					class: "mm-tile mm-waiting",
					style: "left:168px;top:62px;width:60px;height:40px"
				}),
				createVNode("div", {
					class: "mm-tile mm-working",
					style: "left:34px;top:84px;width:56px;height:38px"
				}),
				createVNode("div", {
					class: "mm-tile mm-stale",
					style: "left:112px;top:98px;width:52px;height:34px"
				}),
				createVNode("div", {
					class: "mm-view",
					style: "left:14px;top:14px;width:158px;height:112px"
				})
			]
		}),
		createVNode("div", {
			class: "tb-caption",
			style: "margin-top:.55rem",
			children: "teal ring = active · rust = working · violet pulse = waiting · dim/short violet = stale · blink = alert"
		})
	]
});
var FocusPair = () => createVNode("div", {
	class: "tb-canvas lang-halo",
	children: [createVNode("div", {
		class: "lead",
		children: "Focused + working — teal ring (focus) vs the working glow"
	}), createVNode("div", {
		class: "tb-pair",
		children: [createVNode("div", {
			class: "tb-cell",
			children: [createVNode("div", {
				class: "tb-tile tb-working tb-focus",
				children: [createVNode("div", {
					class: "tb-titlebar",
					children: [createVNode("span", { class: "tb-dot" }), createVNode("span", {
						class: "tb-name",
						children: "argh · claude"
					})]
				}), createVNode("div", {
					class: "tb-body",
					children: "◐ Thinking…"
				})]
			}), createVNode("div", {
				class: "tb-caption",
				children: [createVNode("b", { children: "Rust" }), " glow — clearly distinct"]
			})]
		}), createVNode("div", {
			class: "tb-cell",
			children: [createVNode("div", {
				class: "tb-tile tb-focus",
				style: "box-shadow:inset 0 0 0 1.5px var(--teal),0 0 14px -3px var(--teal)",
				children: [createVNode("div", {
					class: "tb-titlebar",
					children: [createVNode("span", {
						class: "tb-dot",
						style: "background:var(--teal)"
					}), createVNode("span", {
						class: "tb-name",
						style: "color:#8fc3c4",
						children: "argh · claude"
					})]
				}), createVNode("div", {
					class: "tb-body",
					children: "◐ Thinking…"
				})]
			}), createVNode("div", {
				class: "tb-caption",
				children: [createVNode("b", { children: "Teal" }), " glow — reads ambiguous"]
			})]
		})]
	})]
});
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		hr: "hr",
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
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"Five terminals on the canvas — which one needs you? The state exists today (a\ntitle-bar label, a dock dot), but reading a title bar isn’t a glance. Put the\nsignal on the ",
			createVNode(_components.strong, { children: "tile border" }),
			", where peripheral vision catches it across the\nwhole canvas."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "The ask",
			children: createVNode(_components.p, { children: [
				"Make running terminals visually distinct on the canvas. An ",
				createVNode(_components.strong, { children: "animating border" }),
				"\nfor ones that are working, a ",
				createVNode(_components.strong, { children: "throbbing border" }),
				" for ones with a fresh alert,\nand ",
				createVNode(_components.strong, { children: "some other border" }),
				" for ones that are waiting on you — so a sweep of the\neye tells you the state of the fleet without reading anything."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A ",
			createVNode(_components.strong, { children: "chooser" }),
			", now ",
			createVNode(_components.strong, { children: "decided" }),
			": refined Language ",
			createVNode(_components.strong, { children: "C" }),
			" (run/sweep) shipped in\n",
			createVNode($$PrLink, { pr: 1348 }),
			" — motion carries the state, in the tile’s own ",
			createVNode(_components.strong, { children: "repo\ncolour" }),
			" (the one colour used throughout), and the active tile is marked by an\noffset repo outline. The four live border languages below are kept as the design\nrecord; each renders the attention ladder (ranked by who needs you; a waiter\ncools as it ages)."
		] }),
		"\n",
		"\n",
		"\n",
		"\n",
		createVNode(ProtoStyles, {}),
		"\n",
		createVNode(_components.h2, {
			id: "the-attention-ladder",
			children: "The attention ladder"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A ",
			createVNode(_components.strong, { children: "loudness ladder ordered by who needs you" }),
			" — and ",
			createVNode(_components.strong, { children: "waiting cools as it ages" }),
			"\n(a fresh waiter outranks a busy tile; hours later it sinks below). Reuses kolu’s\nexisting ranking + ageing, no parallel scheme:"
		] }),
		"\n",
		createVNode($$D2, {
			caption: "Reuse the upstream classifiers, add one canvas-only mapper. AgentInfo.state → a bucket (agentBucket); an unread flag marks a fresh missed alert; lastActivityAt vs the activity window (useStaleCheck) ages a waiter — the three signals the dock already reads. The canvas would add its own pure tileAura(bucket, unread, stale) → tier, gathered once and read by both the tile and the minimap marker. Focus (activeId) paints the teal ring, clears unread, mutes the tile's own aura — so the loudest border is always elsewhere. No new state, no new clock.",
			code: `direction: down
state: "AgentInfo.state — thinking · tool_use · waiting · awaiting_user · running_background"
bucket: "agentBucket() — working | awaiting | none (never idle: that's buildDockModel's idleClassifier branch)"
unread: "isUnread(id) — fresh + missed (useViewState)"
stale: "lastActivityAt vs activity window — useStaleCheck() / isStale()"
tileAura: "tileAura(bucket, unread, stale) — canvas-only pure mapper → tier"
socket: "useTileAura() — gathers the three inputs once"
tile: "canvas tile aura bar (data-aura)"
mini: "minimap marker aura bar"
active: "store.activeId() — focus ring (teal); clears unread; mutes own aura"
state -> bucket
bucket -> tileAura
unread -> tileAura
stale -> tileAura
tileAura -> socket
socket -> tile
socket -> mini
active -> tile`
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Rank" }),
					"\n",
					createVNode(_components.th, { children: "State" }),
					"\n",
					createVNode(_components.th, { children: "When" }),
					"\n",
					createVNode(_components.th, { children: "Color" }),
					"\n",
					createVNode(_components.th, { children: "Border" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "1 · Alert" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "unread" }),
						" — flipped to needing you ",
						createVNode(_components.strong, { children: "while you weren’t looking" })
					] }),
					"\n",
					createVNode(_components.td, { children: ["violet ", createVNode(_components.code, { children: "--color-alert" })] }),
					"\n",
					createVNode(_components.td, { children: [
						"fast ",
						createVNode(_components.strong, { children: "throb" }),
						" + halo (~1.2s); ",
						createVNode(_components.strong, { children: "self-clears on focus" })
					] }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "2 · Waiting · fresh" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "awaiting" }), " and recent — within your activity window (esp. < 4h)"] }),
					"\n",
					createVNode(_components.td, { children: ["violet ", createVNode(_components.code, { children: "--color-alert" })] }),
					"\n",
					createVNode(_components.td, { children: [
						"gentle slow ",
						createVNode(_components.strong, { children: "breathe" }),
						", bright"
					] }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "3 · Working" }) }),
					"\n",
					createVNode(_components.td, { children: "thinking / running tools / background workflow" }),
					"\n",
					createVNode(_components.td, { children: ["rust ", createVNode(_components.code, { children: "--color-busy" })] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "steady" }), " hum — no motion"] }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "4 · Waiting · stale" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "awaiting" }), " but older than your activity window (parked)"] }),
					"\n",
					createVNode(_components.td, { children: ["violet ", createVNode(_components.code, { children: "--color-alert" })] }),
					"\n",
					createVNode(_components.td, { children: [
						"dim ",
						createVNode(_components.strong, { children: "ember" }),
						", static — cooled ",
						createVNode(_components.em, { children: "below" }),
						" the working hum"
					] }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "5 · Idle / done" }) }),
					"\n",
					createVNode(_components.td, { children: "no agent, finished, or acknowledged" }),
					"\n",
					createVNode(_components.td, { children: "repo identity" }),
					"\n",
					createVNode(_components.td, { children: "none" }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Two refinements the priority order forces",
			children: [createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: ["1 · “Waiting” splits and ", createVNode(_components.em, { children: "decays." })] }),
				" The crossover is your ",
				createVNode(_components.strong, { children: "activity window" }),
				"\n(",
				createVNode(_components.code, { children: "4h / 12h / 24h / All" }),
				", default ",
				createVNode(_components.code, { children: "All" }),
				" — ",
				createVNode($$Cite, { file: "packages/client/src/terminal/activityWindow.ts" }),
				"): a waiter sinks below the working hum once it ages past it; ",
				createVNode(_components.code, { children: "All" }),
				" (the default) disables decay, and narrowing the window is opt-in."
			] }), createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "2 · Motion = “needs you,” not “busy.”" }),
				" Alert and fresh-waiting outrank working,\nso ",
				createVNode(_components.em, { children: "motion" }),
				" — the strongest cue — is reserved for them; working is a ",
				createVNode(_components.strong, { children: "steady" }),
				"\nglow. (Flips the first instinct of an animating border for working.)"
			] })]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "waiting-cools-as-it-ages",
			children: "Waiting cools as it ages"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The same waiting tile at four ages — its glow dims and stops moving as\n",
			createVNode(_components.code, { children: "lastActivityAt" }),
			" recedes, crossing below the working hum at your activity-window\nthreshold. Same clock as the dock and minimap (",
			createVNode(_components.code, { children: "useStaleCheck" }),
			") — one vocabulary,\none persisted choice."
		] }),
		"\n",
		"\n",
		"\n",
		createVNode(DecayStrip, {}),
		"\n",
		createVNode(_components.p, { children: "First tile = live breathe; the rest are the same state cooling. The crossover is\nwherever you set the activity window — yours to tune, not hard-coded." }),
		"\n",
		createVNode(_components.h2, {
			id: "the-active-tile--where-focus-meets-the-ladder",
			children: "The active tile — where focus meets the ladder"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The ladder ranks attention demand (look ",
			createVNode(_components.strong, { children: "next" }),
			"); focus marks where you ",
			createVNode(_components.strong, { children: "are" }),
			".\nTwo axes — keep them apart:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Focus = teal" }),
				", its own channel: a teal inner ring + right-edge accent\n(",
				createVNode(_components.code, { children: "activeId" }),
				"). Teal = “you are here”; the aura = “this wants you.” Inner ring vs\nouter glow, so they don’t collide."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["The active tile is never ", createVNode(_components.em, { children: "alert" })] }),
				" — focusing clears ",
				createVNode(_components.code, { children: "unread" }),
				", so the loudest\nrung only ever lights an ",
				createVNode(_components.em, { children: "inactive" }),
				" tile. The eye-grab always points somewhere\n",
				createVNode(_components.strong, { children: "new" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Focus mutes the tile’s own aura" }),
				" (proposed ",
				createVNode(_components.code, { children: "opacity: 0.4" }),
				") so the focus\naccent dominates — you can still glimpse that it’s working/waiting."
			] }),
			"\n"
		] }),
		"\n",
		"\n",
		createVNode(ActiveDemo, {}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "One rule:" }),
			" loudness = ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "state-tier × age-decay × presence" }) }),
			". The tier picks\ncolour + motion; age-decay folds into it (stale waiter → ember, stale worker →\nnone); presence is the active mute. So the ",
			createVNode(_components.strong, { children: "brightest border is always an\ninactive, fresh, attention-class tile" }),
			" — exactly where the eye should land."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "prototypes--pick-a-language",
			children: "Prototypes — pick a language"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Four languages, live across the ladder (waiting shown ",
			createVNode(_components.em, { children: "fresh" }),
			"), each with its\nwins and costs tagged. Two tiebreakers decide it: a ",
			createVNode(_components.strong, { children: "continuous loudness ramp" }),
			"\n(so a waiter can dim) and ",
			createVNode(_components.strong, { children: "surviving the minimap" }),
			" (so canvas and map speak one\nlanguage)."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "a--halo",
			children: "A — Halo"
		}),
		"\n",
		createVNode($$Pill, {
			variant: "ok",
			children: "continuous dim-ramp"
		}),
		"\n",
		createVNode($$Pill, {
			variant: "ok",
			children: "leaves repo + focus untouched"
		}),
		"\n",
		createVNode($$Pill, {
			variant: "warn",
			children: "shrinks imperfectly to minimap"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A soft outer ",
			createVNode(_components.strong, { children: "glow" }),
			" carries state; the border line stays repo identity. A glow\nhas a ",
			createVNode(_components.em, { children: "continuous" }),
			" brightness axis — it renders the whole ranked, aging ladder\ncleanly (alert brightest → stale waiter dims to an ember; the decay strip above is\nthis language turned down)."
		] }),
		"\n",
		createVNode(Gallery, {
			lang: "halo",
			lead: "A · Halo — glow (idle ▸ working ▸ waiting·fresh ▸ alert)"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "b--live-border",
			children: "B — Live border"
		}),
		"\n",
		createVNode($$Pill, {
			variant: "ok",
			children: "most literal"
		}),
		"\n",
		createVNode($$Pill, {
			variant: "bad",
			children: "overwrites repo identity"
		}),
		"\n",
		createVNode($$Pill, {
			variant: "bad",
			children: "no room to dim"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The ",
			createVNode(_components.strong, { children: "border line itself" }),
			" takes the state colour. But it overwrites repo identity\nwhile busy (most of the time), and a solid line has nowhere to ",
			createVNode(_components.strong, { children: "dim" }),
			" to (a faint\nborder reads as a bug). Fine for a binary; awkward for a ranked, aging ladder."
		] }),
		"\n",
		createVNode(Gallery, {
			lang: "border",
			lead: "B · Live border — the line carries state"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "c--run--sweep-motion-is-the-state-colour-is-the-terminal",
			children: "C — Run / sweep: motion is the state, colour is the terminal"
		}),
		"\n",
		createVNode($$Pill, {
			variant: "ok",
			children: "most alive + theme-native"
		}),
		"\n",
		createVNode($$Pill, {
			variant: "bad",
			children: "motion on every busy tile"
		}),
		"\n",
		createVNode($$Pill, {
			variant: "bad",
			children: "no learnable colour"
		}),
		"\n",
		createVNode($$Pill, {
			variant: "bad",
			children: "reduced-motion deletes it"
		}),
		"\n",
		createVNode($$Pill, {
			variant: "warn",
			children: "needs D at minimap"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The ",
			createVNode(_components.strong, { children: "type" }),
			" and ",
			createVNode(_components.strong, { children: "speed" }),
			" of motion carry the state, freeing the colour to be the\nterminal’s own:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: ["Working ", createVNode(_components.em, { children: "runs" })] }), " — marching ants stream calmly around the edges (“busy,” asks\nnothing)."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: ["Needs-you ", createVNode(_components.em, { children: "sweeps" })] }),
				" — a comet whose ",
				createVNode(_components.strong, { children: "speed is the urgency" }),
				": alert fastest →\nfresh slower → stale slowest (decay read as a comet winding down)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The light is the tile’s ",
			createVNode(_components.strong, { children: "own theme colour" }),
			", brightened for louder states — a\nteal terminal runs teal, an amber one amber. That answers “why orange and\npurple?” — but state then lives ",
			createVNode(_components.em, { children: "only" }),
			" in motion (see costs above)."
		] }),
		"\n",
		"\n",
		"\n",
		createVNode(RunSweepLadder, {}),
		"\n",
		createVNode(_components.p, { children: [
			"Read from ",
			createVNode(_components.strong, { children: "how it moves" }),
			": ants vs comet splits working from needs-you; sweep\nspeed splits alert → fresh → stale. Colour is whatever the terminal is — the same\n",
			createVNode(_components.em, { children: "waiting · sweep" }),
			" across five themes:"
		] }),
		"\n",
		"\n",
		"\n",
		createVNode(RunSweepThemes, {}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Cost: C needs a contrast-lock",
			children: createVNode(_components.p, { children: [
				"Because the light ",
				createVNode(_components.strong, { children: "is" }),
				" the terminal’s colour on its own themed bg, a low-contrast\ntheme would let it vanish — so it can’t use the raw hue. It must derive a\n",
				createVNode(_components.strong, { children: "contrast-locked accent" }),
				" (use the theme ",
				createVNode(_components.code, { children: "fg" }),
				"/accent, or push lightness away from\nthe bg). Real per-theme machinery that A/B/D don’t need."
			] })
		}),
		"\n",
		"\n",
		createVNode(ContrastDemo, {}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The trade:" }),
			" most ",
			createVNode(_components.em, { children: "alive" }),
			" and ",
			createVNode(_components.em, { children: "theme-native" }),
			" of the set — but the costs are\nreal. Moving light on ",
			createVNode(_components.strong, { children: "every" }),
			" busy tile; no learnable fixed colour; reduced\nmotion deletes the only channel; and a comet doesn’t shrink to a legible\n",
			createVNode(_components.strong, { children: "minimap" }),
			" marker — so C falls back to D there anyway (two languages)."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "d--top-bar-reads-at-any-zoom",
			children: "D — Top bar (reads at any zoom)"
		}),
		"\n",
		createVNode($$Pill, {
			variant: "ok",
			children: "scale-invariant — one shape canvas + minimap"
		}),
		"\n",
		createVNode($$Pill, {
			variant: "ok",
			children: "calmest, zero ambient motion"
		}),
		"\n",
		createVNode($$Pill, {
			variant: "warn",
			children: "least expressive range"
		}),
		"\n",
		createVNode($$Pill, {
			variant: "warn",
			children: "easy to miss peripherally"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A thin status ",
			createVNode(_components.strong, { children: "bar on the top edge" }),
			" — steady rust (working), violet pulse\n(fresh-waiting), sharper blink (alert), nothing (idle). The calmest of the four,\nand its edge is ",
			createVNode(_components.strong, { children: "scale-invariance" }),
			": the same legible shape on a full tile ",
			createVNode(_components.em, { children: "or" }),
			" a\n40px minimap marker — the others can’t claim it (a glow or comet dissolves when\ntiny)."
		] }),
		"\n",
		createVNode(Gallery, {
			lang: "bar",
			lead: "D · Top bar — top-edge status strip"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The minimap already wants this: today it paints a ",
			createVNode(_components.strong, { children: "corner dot" }),
			". Language D\n",
			createVNode(_components.strong, { children: "unifies" }),
			" both surfaces — the same top edge, scaled down:"
		] }),
		"\n",
		"\n",
		createVNode(MiniMap, {}),
		"\n",
		createVNode(_components.p, { children: [
			"Decay survives — dim the bar’s opacity and shrink its width as a waiter ages (the\nshort faint marker above): a draining gauge. The honest cost vs Halo is ",
			createVNode(_components.strong, { children: "range" }),
			"\n— a 2.5px bar carries less nuance, and a top edge is easier to miss peripherally.\nRichness traded for one-shape-everywhere coherence."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "open-decisions",
			children: "Open decisions"
		}),
		"\n",
		createVNode(_components.p, { children: "Independent of the language — a few open choices, each with a leaning. None\nsettled." }),
		"\n",
		createVNode(_components.h3, {
			id: "working-color--rust-not-teal",
			children: "Working color — rust, not teal"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Focus already owns ",
			createVNode(_components.strong, { children: "teal" }),
			", so working can’t also be teal (teal-on-teal is\nambiguous). Working = ",
			createVNode(_components.strong, { children: "rust" }),
			" keeps three legible hues: ",
			createVNode(_components.strong, { children: "teal = you’re here ·\nrust = it’s busy · violet = it wants you." }),
			" (For A/B/D; C uses the tile’s own\ncolour.)"
		] }),
		"\n",
		"\n",
		createVNode(FocusPair, {}),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "The dock uses teal for working",
			children: createVNode(_components.p, { children: [
				"The dock pips working ",
				createVNode(_components.strong, { children: "teal" }),
				" today — rust-on-canvas would be a deliberate\ndivergence (it dodges a focus collision the dock doesn’t have). Follow-up:\nreconcile, or accept the two surfaces differ."
			] })
		}),
		"\n",
		createVNode(_components.h3, {
			id: "motion--needs-you-working-stays-steady",
			children: "Motion = needs-you (working stays steady)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Motion is reserved for the rungs that want you; ",
			createVNode(_components.strong, { children: "working is a steady hum." }),
			" Open\nlever: fully static, or a barely-there breath so it still reads “alive” — as long\nas it stays quieter than fresh-waiting."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-decay-curve--threshold",
			children: "The decay curve & threshold"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Continuous vs banded" }),
				" — a smooth ",
				createVNode(_components.code, { children: "--aura-intensity" }),
				", or reuse the existing\nage bands (",
				createVNode(_components.code, { children: "idleBucketFor" }),
				", ",
				createVNode($$Cite, { file: "packages/client/src/terminal/activityWindow.ts" }),
				") for discrete steps, zero new math."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Which window" }),
				" — reuse the persisted ",
				createVNode(_components.code, { children: "activityWindow" }),
				" (default ",
				createVNode(_components.code, { children: "All" }),
				";\nnarrowing to ",
				createVNode(_components.code, { children: "24h" }),
				"/etc. enables decay). ",
				createVNode(_components.em, { children: "Open: is a filter knob the right decay clock?" })
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Where stale lands" }), " — a dim violet ember (keeps the “it wanted you” memory),\nor demote to parked (quieter, matches the dock)."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-active-tiles-aura--mute-or-suppress",
			children: "The active tile’s aura — mute or suppress"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Mute to a whisper" }),
			" (still glimpse working/waiting on the tile you’re in) or\n",
			createVNode(_components.strong, { children: "fully suppress" }),
			" (focus ring only, calmest). Leaning: mute."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "idle--done--reduced-motion--settings",
			children: "Idle / done · reduced motion · settings"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Idle / done" }), " stays bare (repo border only)."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Reduced motion" }),
				" collapses every gallery to a static state. ⚠ For ",
				createVNode(_components.strong, { children: "C" }),
				" that\ndeletes the ",
				createVNode(_components.em, { children: "only" }),
				" channel (motion) — a real reason to weigh A/D."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Settings" }),
				" — likely on by default; a ",
				createVNode(_components.code, { children: "PreferencesSchema" }),
				" toggle is a small add."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "if-built--how-it-would-wire-in",
			children: "If built — how it would wire in"
		}),
		"\n",
		createVNode(_components.p, { children: "Small and contained: no new state machinery, because the upstream classifiers\nalready exist. The shape, whichever language wins:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A pure canvas-only mapper" }),
				" — ",
				createVNode(_components.code, { children: "tileAura(bucket, unread, stale) → tier" }),
				",\nreusing the same inputs the dock reads (",
				createVNode(_components.code, { children: "agentBucket" }),
				", the unread flag,\n",
				createVNode(_components.code, { children: "useStaleCheck" }),
				"), kept pure so it unit-tests without a Solid harness."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "One reactive socket, two surfaces" }),
				" — a ",
				createVNode(_components.code, { children: "useTileAura" }),
				" receptacle the canvas\ntile (",
				createVNode($$Cite, { file: "packages/client/src/canvas/TerminalCanvas.tsx" }),
				") and the\nminimap marker (",
				createVNode($$Cite, { file: "packages/client/src/canvas/CanvasMinimap.tsx" }),
				")\nboth read, so they can’t drift. Age from the same 60s-ticking staleness the dock\nuses (",
				createVNode($$Cite, { file: "packages/client/src/terminal/staleness.ts" }),
				") — no new timer."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The tile" }),
				" (",
				createVNode($$Cite, { file: "packages/client/src/canvas/CanvasTile.tsx" }),
				") takes\nthe tier as a prop and paints the chosen treatment; the active tile mutes its own\naura; ",
				createVNode(_components.code, { children: "prefers-reduced-motion" }),
				" falls back to a static state."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "No new state or timing — a CSS block, a small pure mapper + its socket, and the\nprop wiring on the tile and minimap." }),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Status: ",
			createVNode(_components.code, { children: "implemented" }),
			" in ",
			createVNode($$PrLink, { pr: 1348 }),
			" — refined Language ",
			createVNode(_components.strong, { children: "C" }),
			"\n(run/sweep): working “runs” as marching ants, needs-you “sweeps” a comet whose\nspeed is the urgency, alert throbs loudest, all in the tile’s own ",
			createVNode(_components.strong, { children: "repo\ncolour" }),
			" (one colour throughout — theme-derived hues, teal, and white were each\ntried and rejected). A stale waiter cools to a dim ember; a stale worker parks to\nnothing. The active tile is marked by an offset repo outline on the dark canvas\n(not a ring, glow, or chrome accent — those were tried and rejected), and\n",
			createVNode(_components.code, { children: "prefers-reduced-motion" }),
			" freezes every aura to a static ring. The pure\n",
			createVNode(_components.code, { children: "tileAura" }),
			" mapper + ",
			createVNode(_components.code, { children: "useTileAura" }),
			" socket reuse the dock’s existing classifiers;\nthe minimap keeps its own marker. Shipped after a lens (lowy ⇄ hickey) + codex\nreview gauntlet."
		] }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Canvas tiles that show their state — border prototypes",
	"description": "Five terminals on the canvas; which one needs you? Surface each session's run-state on the tile border itself — a loudness ladder ranked by attention (alert ▸ fresh-waiting ▸ working ▸ stale-waiting ▸ idle), where \"waiting\" cools with last-activity age via kolu's existing activity-window. Four live, animated visual languages to choose from.",
	"parents": ["feature"],
	"status": "implemented",
	"maturity": "seedling",
	"updated": "2026-06-13T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-attention-ladder",
			"text": "The attention ladder"
		},
		{
			"depth": 2,
			"slug": "waiting-cools-as-it-ages",
			"text": "Waiting cools as it ages"
		},
		{
			"depth": 2,
			"slug": "the-active-tile--where-focus-meets-the-ladder",
			"text": "The active tile — where focus meets the ladder"
		},
		{
			"depth": 2,
			"slug": "prototypes--pick-a-language",
			"text": "Prototypes — pick a language"
		},
		{
			"depth": 3,
			"slug": "a--halo",
			"text": "A — Halo"
		},
		{
			"depth": 3,
			"slug": "b--live-border",
			"text": "B — Live border"
		},
		{
			"depth": 3,
			"slug": "c--run--sweep-motion-is-the-state-colour-is-the-terminal",
			"text": "C — Run / sweep: motion is the state, colour is the terminal"
		},
		{
			"depth": 3,
			"slug": "d--top-bar-reads-at-any-zoom",
			"text": "D — Top bar (reads at any zoom)"
		},
		{
			"depth": 2,
			"slug": "open-decisions",
			"text": "Open decisions"
		},
		{
			"depth": 3,
			"slug": "working-color--rust-not-teal",
			"text": "Working color — rust, not teal"
		},
		{
			"depth": 3,
			"slug": "motion--needs-you-working-stays-steady",
			"text": "Motion = needs-you (working stays steady)"
		},
		{
			"depth": 3,
			"slug": "the-decay-curve--threshold",
			"text": "The decay curve & threshold"
		},
		{
			"depth": 3,
			"slug": "the-active-tiles-aura--mute-or-suppress",
			"text": "The active tile’s aura — mute or suppress"
		},
		{
			"depth": 3,
			"slug": "idle--done--reduced-motion--settings",
			"text": "Idle / done · reduced motion · settings"
		},
		{
			"depth": 2,
			"slug": "if-built--how-it-would-wire-in",
			"text": "If built — how it would wire in"
		}
	];
}
var url = "src/content/atlas/canvas-tile-state-borders.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/canvas-tile-state-borders.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/canvas-tile-state-borders.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { ActiveDemo, Content, Content as default, ContrastDemo, DECAY, DecayStrip, FocusPair, Gallery, MiniMap, ProtoStyles, RUNSWEEP, RunSweepLadder, RunSweepThemes, STATES, THEMECOLS, file, frontmatter, getHeadings, url };
