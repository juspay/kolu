import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
//#region src/content/atlas/sleeping-terminals.mdx
var C = {
	bg: "#15171c",
	grid: "#1b1e25",
	chrome: "#1b1e24",
	panel: "#171a20",
	line: "#2a2e37",
	fg: "#c7ccd6",
	dim: "#8b929d",
	faint: "#5b626d",
	amber: "#d6a35c",
	green: "#6cc070",
	blue: "#6ea8e0",
	red: "#d66c6c",
	repoBlue: "#6ea8e0",
	repoRust: "#cf8e57",
	moon: "#8895ad",
	moonBg: "#1d2230"
};
var Frame = (props) => createVNode("figure", {
	style: "margin:1.6rem 0",
	children: [createVNode("div", {
		style: `max-width:${props.w || "40rem"};margin:0 auto;border:1px solid ${C.line};border-radius:12px;overflow:hidden;background:${C.bg};box-shadow:0 6px 22px rgba(0,0,0,.32)`,
		children: [createVNode("div", {
			style: `display:flex;align-items:center;gap:.45rem;padding:.5rem .8rem;background:${C.chrome};border-bottom:1px solid ${C.line}`,
			children: [
				createVNode("span", { style: "width:10px;height:10px;border-radius:50%;background:#ff5f56;display:inline-block" }),
				createVNode("span", { style: "width:10px;height:10px;border-radius:50%;background:#ffbd2e;display:inline-block" }),
				createVNode("span", { style: "width:10px;height:10px;border-radius:50%;background:#27c93f;display:inline-block" }),
				createVNode("span", {
					style: `margin-left:.4rem;font:600 .72rem/1 ui-monospace,monospace;color:${C.dim}`,
					children: props.title
				})
			]
		}), createVNode("div", {
			style: `padding:1rem 1.05rem;background:${C.bg};background-image:radial-gradient(${C.grid} 1px, transparent 1px);background-size:18px 18px`,
			children: props.children
		})]
	}), props.cap && createVNode("figcaption", {
		style: `margin-top:.55rem;text-align:center;font-size:.78rem;color:#7a8089`,
		children: props.cap
	})]
});
var dot = (c) => `width:9px;height:9px;border-radius:50%;background:${c};display:inline-block;flex:0 0 auto`;
var TileChrome = (props) => createVNode("div", {
	style: `flex:1 1 0;border:${props.live ? `1px solid ${C.repoBlue}` : `1.5px dashed ${C.moon}99`};border-radius:10px;overflow:hidden;background:${props.live ? C.panel : C.moonBg};box-shadow:${props.live ? `0 0 0 1.5px ${C.repoBlue}55,` : ""}0 6px 18px rgba(0,0,0,.4);opacity:${props.live ? 1 : .98}`,
	children: [createVNode("div", {
		style: `display:flex;align-items:center;gap:.45rem;padding:.4rem .6rem;border-bottom:1px solid ${C.line};background:${props.live ? "#1d2026" : "#161b27"}`,
		children: [
			createVNode("span", { style: dot(props.live ? C.repoBlue : C.moon) }),
			createVNode("span", {
				style: `font:650 .72rem/1 ui-sans-serif;color:${props.live ? C.fg : C.moon}`,
				children: "api"
			}),
			createVNode("span", {
				style: `font:.64rem/1 ui-monospace,monospace;color:${C.faint}`,
				children: props.live ? "main" : "main · asleep"
			}),
			createVNode("span", {
				style: `margin-left:auto;display:flex;gap:.35rem;align-items:center;color:${C.faint};font-size:.78rem`,
				children: props.live ? createVNode(Fragment, { children: [
					createVNode("span", {
						title: "Sleep",
						style: `color:${C.moon};border:1px solid ${C.moon}66;border-radius:5px;padding:0 .28rem;font-size:.64rem`,
						children: "☾"
					}),
					createVNode("span", { children: "▢" }),
					createVNode("span", { children: "×" })
				] }) : createVNode("span", {
					style: `font:650 .62rem/1 ui-sans-serif;color:#0e1014;background:${C.moon};border-radius:5px;padding:.18rem .45rem`,
					children: "Wake"
				})
			})
		]
	}), props.children]
});
var CanvasTiles = () => createVNode(Frame, {
	title: "kolu · canvas",
	w: "46rem",
	cap: "Two terminals, one asleep — same card, same chrome, both draggable and resizable. The sleeping one (right) is the SAME terminal record with its PTY released: a frozen last frame, dimmed, with ☾ and a Wake button. Click it to focus it like any terminal; Wake respawns its PTY and resumes the agent.",
	children: createVNode("div", {
		style: "display:flex;gap:.85rem;align-items:stretch",
		children: [createVNode(TileChrome, {
			live: true,
			children: createVNode("div", {
				style: `padding:.55rem .6rem;font:.63rem/1.5 ui-monospace,monospace;color:${C.dim};min-height:7rem`,
				children: [
					createVNode("div", {
						style: `color:${C.green}`,
						children: "● claude · working"
					}),
					createVNode("div", { children: "> running the load test to repro…" }),
					createVNode("div", {
						style: `color:${C.faint}`,
						children: "  ⎿ 1,204 reqs · 3 failures"
					}),
					createVNode("div", {
						style: `color:${C.amber}`,
						children: "↻ marching-ants aura on the border"
					})
				]
			})
		}), createVNode(TileChrome, {
			live: false,
			children: createVNode("div", {
				style: `position:relative;min-height:7rem;background:${C.panel};opacity:.6;filter:grayscale(.4)`,
				children: [createVNode("div", {
					style: `padding:.55rem .6rem;font:.6rem/1.5 ui-monospace,monospace;color:${C.faint}`,
					children: [
						createVNode("div", { children: "fix the auth race that only repros…" }),
						createVNode("div", { children: "> claude --model sonnet" }),
						createVNode("div", { children: "  ⎿ analyzing 14 files…" }),
						createVNode("div", {
							style: `color:${C.moon}`,
							children: "  ✓ wrote a failing test"
						})
					]
				}), createVNode("div", {
					style: `position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:space-between;padding:.5rem .6rem;background:linear-gradient(180deg,transparent,rgba(20,24,33,.85))`,
					children: [createVNode("span", {
						style: `font:600 .6rem/1 ui-sans-serif;color:${C.moon}`,
						children: "☾ frozen · asleep 3d"
					}), createVNode("span", {
						style: `font:600 .58rem/1 ui-sans-serif;color:${C.faint}`,
						children: "PTY released"
					})]
				})]
			})
		})]
	})
});
var DockUnified = () => createVNode(Frame, {
	title: "kolu · dock",
	w: "21rem",
	cap: "One list. A sleeping terminal is a row like any other — same group, same selection, dimmed with a ☾ state pip. Clicking it FOCUSES it (it can be the active/selected tile); a small Wake brings it back. No separate section, because there is no separate kind.",
	children: createVNode("div", {
		style: `border-left:3px solid ${C.repoRust};padding-left:.6rem`,
		children: [createVNode("div", {
			style: `font:700 .6rem/1 ui-sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${C.faint};margin:.1rem 0 .5rem`,
			children: "api"
		}), [
			{
				glyph: "●",
				gc: C.green,
				name: "load test",
				sub: "working",
				active: false,
				moon: false
			},
			{
				glyph: "◐",
				gc: C.amber,
				name: "review pr",
				sub: "awaiting you",
				active: false,
				moon: false
			},
			{
				glyph: "☾",
				gc: C.moon,
				name: "auth race",
				sub: "asleep · 3d",
				active: true,
				moon: true
			}
		].map((r) => createVNode("div", {
			style: `display:flex;align-items:center;gap:.5rem;padding:.35rem .4rem;border-radius:7px;margin-bottom:.35rem;background:${r.active ? "#222734" : C.panel};${r.active ? `box-shadow:inset 3px 0 0 ${C.moon};` : ""}opacity:${r.moon ? .85 : 1}`,
			children: [
				createVNode("span", {
					style: `color:${r.gc};font-size:.7rem`,
					children: r.glyph
				}),
				createVNode("span", {
					style: `font:600 .72rem/1.2 ui-sans-serif;color:${r.moon ? C.moon : C.fg}`,
					children: r.name
				}),
				createVNode("span", {
					style: `margin-left:auto;font:.6rem/1 ui-sans-serif;color:${C.faint}`,
					children: r.sub
				}),
				r.moon && createVNode("span", {
					style: `font:650 .56rem/1 ui-sans-serif;color:#0e1014;background:${C.moon};border-radius:4px;padding:.16rem .36rem`,
					children: "Wake"
				})
			]
		}))]
	})
});
var Layer = (props) => createVNode("div", {
	style: `border:1px solid ${props.c || C.line};border-radius:9px;padding:.5rem .6rem;background:${props.bg || C.panel}`,
	children: [createVNode("div", {
		style: `font:700 .64rem/1.3 ui-sans-serif;color:${props.tc || C.fg};margin-bottom:${props.children ? ".28rem" : "0"}`,
		children: props.title
	}), props.children && createVNode("div", {
		style: `font:.58rem/1.5 ui-monospace,monospace;color:${props.bodyc || C.dim}`,
		children: props.children
	})]
});
var Down = (props) => createVNode("div", {
	style: `text-align:center;color:${C.faint};font:.62rem/1 ui-monospace;margin:.2rem 0`,
	children: ["↓", props.label && createVNode("span", {
		style: `color:${C.dim};margin-left:.4rem`,
		children: props.label
	})]
});
var Arch = () => createVNode(Frame, {
	title: "one registry · presence reads the union · liveness narrows",
	w: "44rem",
	cap: "One registry holds the Terminal union under a stable id. Presence consumers read the union; a consumer that touches a live field must narrow state === 'active' — the compiler refuses a PTY/agent field on a bare terminal, so a sleeping terminal can sit on the canvas and in the MRU yet can never be an input or WebGL target. Sleep flips the state flag in place; the id, the layout slot, and the persisted base never move.",
	children: [
		createVNode(Layer, {
			title: "canvas · dock · minimap · arrange · cycle · switcher",
			children: "read the Terminal union — presence (exists, on canvas, focusable, draggable, has a dock row)"
		}),
		createVNode(Down, {}),
		createVNode(Layer, {
			title: "terminal registry — Terminal = active | sleeping (one store, stable id)",
			c: C.moon,
			bg: "#161b27",
			tc: C.moon,
			bodyc: C.moon,
			children: [
				"active → base + live overlay (PTY · xterm · agent)",
				createVNode("br", {}),
				"sleeping → base + sleptAt (overlay absent by type)",
				createVNode("br", {}),
				"setCanvasLayout · setTheme · rename → write the base of BOTH arms"
			]
		}),
		createVNode(Down, { label: `state === "active"  narrow` }),
		createVNode(Layer, {
			title: "live fields — PTY/xterm · agent stream · input routing",
			children: "active arm only"
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
			"You asked for ",
			createVNode(_components.strong, { children: "Sleep" }),
			": leave a Claude Code terminal blocked for days, sleep it\n(its PTY, xterm, WebGL context, and agent all released — gone, like closing it),\nand ",
			createVNode(_components.strong, { children: "wake" }),
			" it later in place with the agent resumed."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The model is one move: make the terminal a sum — ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "Terminal = active | sleeping" }) }),
			".\nA dormant terminal carries the same persisted base — cwd, git, intent, its\n",
			createVNode(_components.code, { children: "canvasLayout" }),
			" slot, the last agent command — so it keeps the canvas position, dock\norder, and persistence the live terminal had: it stays the ",
			createVNode(_components.em, { children: "same record under the\nsame id" }),
			" in the ",
			createVNode(_components.em, { children: "one" }),
			" terminal registry the canvas already iterates, just without a\nPTY. Sleep flips its ",
			createVNode(_components.code, { children: "state" }),
			" flag in place and releases the live resources; wake\nflips it back and re-spawns through the path a server reboot already uses. Three\nphased PRs; the first is a zero-behavior-change foundation."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "a-terminal-is-active-or-sleeping",
			children: "A terminal is active or sleeping"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The fold already lives in the schema. ",
			createVNode(_components.code, { children: "surface.ts" }),
			" splits a terminal’s fields into\na ",
			createVNode(_components.strong, { children: "persisted base" }),
			" (cwd · git · intent · theme · ",
			createVNode(_components.code, { children: "canvasLayout" }),
			" · the last agent\ncommand — survives a restart) and a ",
			createVNode(_components.strong, { children: "live overlay" }),
			" (agent status · foreground ·\nlive-PR · the PTY/xterm/attach handles — “never persisted; a restore must re-derive\nit”). That partition ",
			createVNode(_components.em, { children: "is" }),
			" active-vs-sleeping, so the sum maps onto bases that\nalready exist — exactly one field is added:"
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
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " ActiveTerminalSchema"
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
							style: { color: "#24292E" },
							children: "  PersistedTerminalFieldsSchema."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "merge"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(LiveTerminalFieldsSchema)   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// live overlay present"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "    ."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "extend"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ state: z."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "literal"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"active\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ") });"
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " SleepingTerminalSchema"
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
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  PersistedTerminalFieldsSchema                                   "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// base only — overlay absent by type"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "    ."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "extend"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ state: z."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "literal"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"sleeping\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "), sleptAt: z."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "number"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "() });"
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " TerminalMetadataSchema"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "                                   // the wire / collection shape"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  z."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "discriminatedUnion"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"state\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", [ActiveTerminalSchema, SleepingTerminalSchema]);"
						})
					]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Terminal"
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
							children: " ({ "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "state"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"active\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }                    "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "&"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " PersistedTerminalFields"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " &"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " LiveTerminalFields"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ")"
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
							children: " ({ "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "state"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"sleeping\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "sleptAt"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " number"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " } "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "&"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " PersistedTerminalFields"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ");"
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
						children: "// Presence reads the union; touching a live field MUST narrow."
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " placeTile"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "t"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Terminal"
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
							style: { color: "#24292E" },
							children: " t.canvasLayout;             "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// both arms — no narrow"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " routeInput"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "t"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Terminal"
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
							style: { color: "#24292E" },
							children: " {"
						})
					]
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
							children: " (t.state "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "!=="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"active\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ") "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "return"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";                             "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// compiler-forced narrow"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  send"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(t "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "/* now carries pr · agent · foreground + a live PTY */"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ");"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "};"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "sleptAt" }),
			" is the sleeping arm’s analogue of the live overlay — the only new scalar.\nAn active terminal is ",
			createVNode(_components.code, { children: "base + overlay" }),
			"; a sleeping terminal is ",
			createVNode(_components.code, { children: "base + sleptAt" }),
			".\n",
			createVNode(_components.strong, { children: [
				"Sleeping is one record whose ",
				createVNode(_components.code, { children: "state" }),
				" flag says whether its PTY is currently\nspawned"
			] }),
			" — sleep clears the overlay and sets the flag, wake re-derives the overlay\nand clears the flag, and the id never changes."
		] }),
		"\n",
		createVNode(CanvasTiles, {}),
		"\n",
		createVNode(DockUnified, {}),
		"\n",
		createVNode(_components.h2, {
			id: "presence-reads-the-union-liveness-narrows",
			children: "Presence reads the union, liveness narrows"
		}),
		"\n",
		createVNode(Arch, {}),
		"\n",
		createVNode(_components.p, { children: "Putting the discriminant on the terminal buys two structural properties:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Type-safe presence vs liveness." }),
				" A consumer that reads ",
				createVNode(_components.code, { children: "agent" }),
				"/",
				createVNode(_components.code, { children: "foreground" }),
				"/",
				createVNode(_components.code, { children: "pr" }),
				"/PTY/xterm must first narrow ",
				createVNode(_components.code, { children: "state === \"active\"" }),
				"; the compiler refuses a live field on the bare union. There is no live-only list to read from by mistake — so once a sleeping terminal ",
				createVNode(_components.em, { children: "reaches" }),
				" a presence surface (canvas, dock, minimap, arrange, cycle, switcher) it cannot be mis-rendered. ",
				createVNode(_components.strong, { children: [
					"Reaching it is a ",
					createVNode(_components.em, { children: "runtime" }),
					" fact, not a type one:"
				] }),
				" the sum stops mis-rendering, it does not by itself deliver presence — a sleeping record appears because it is the ",
				createVNode(_components.em, { children: "same entry in the one registry" }),
				" the client already subscribes to, so it rides the existing id list with nothing extra. Input routing resolves inside the active narrow, so a sleeping terminal can be the active/selected/panned-to tile yet is never an input target. The WebGL budget keys on the ",
				createVNode(_components.code, { children: "active" }),
				" arm, so a sleeping terminal holds no WebGL context."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "One persistence channel, one write sink." }),
				" ",
				createVNode(_components.code, { children: "SavedTerminal" }),
				" is already ",
				createVNode(_components.code, { children: "PersistedTerminalFields + id" }),
				" — the sleeping arm’s exact payload minus ",
				createVNode(_components.code, { children: "sleptAt" }),
				". A restored terminal and a slept terminal are the ",
				createVNode(_components.em, { children: "same on-disk shape" }),
				", distinguished only by ",
				createVNode(_components.code, { children: "state" }),
				", so the session snapshot serializes ",
				createVNode(_components.em, { children: "one" }),
				" list and the boot path rehydrates both arms through ",
				createVNode(_components.em, { children: "one" }),
				" seam. And because the record keeps its stable id, the ordinary write sinks (",
				createVNode(_components.code, { children: "setCanvasLayout" }),
				", ",
				createVNode(_components.code, { children: "setTheme" }),
				", rename) find a sleeping entry and mutate its base in place — ",
				createVNode(_components.strong, { children: "a sleeping tile drags, resizes, renames, and re-themes like any other" }),
				", with only PTY input fenced (by type, not a guard)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-phases",
			children: "The phases"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Each is one reviewable PR; each leaves ",
			createVNode(_components.code, { children: "master" }),
			" shippable."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Phase" }),
					"\n",
					createVNode(_components.th, { children: "What lands" }),
					"\n",
					createVNode(_components.th, { children: "Why separable" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "1 — Seat the sum" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Add ",
						createVNode(_components.code, { children: "state" }),
						"; flip ",
						createVNode(_components.code, { children: "TerminalMetadataSchema" }),
						" to a ",
						createVNode(_components.code, { children: "discriminatedUnion" }),
						"; presence surfaces read the ",
						createVNode(_components.code, { children: "Terminal" }),
						" union off the terminal store; ship with only the ",
						createVNode(_components.code, { children: "active" }),
						" arm constructed"
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Zero behavior change" }), " — a pure structural move that makes the narrowing seam exist before any sleep logic depends on it"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "2 — Sleep / Wake (in place)" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Populate the ",
						createVNode(_components.code, { children: "sleeping" }),
						" arm: sleep flips ",
						createVNode(_components.code, { children: "state→sleeping" }),
						" on the same record (capturing the last agent command) and releases PTY/xterm/agent; wake flips it back and re-spawns through the ",
						createVNode(_components.strong, { children: "existing session-restore path" }),
						", resuming the agent exactly as a reboot does; the sleeping tile stays a full canvas citizen"
					] }),
					"\n",
					createVNode(_components.td, { children: ["The user-facing core; reuses the proven restore path, ", createVNode(_components.strong, { children: "no separate store, no merge seam, no minted id" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "3 — Frozen screenshot body" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Capture just before sleep, write under ",
						createVNode(_components.code, { children: "KOLU_STATE_DIR" }),
						", serve through a small static image route; the reference rides the record — and the captured frame is what the live→frozen swap ",
						createVNode(_components.strong, { children: "cross-fades into" }),
						", so the sleep transition turns seamless here"
					] }),
					"\n",
					createVNode(_components.td, { children: "Isolated surface — one capture, one route, one fade" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"(The original plan had a fourth phase — “unify wake with session-restore.” The\nstable-id model makes wake ",
			createVNode(_components.strong, { children: "literally" }),
			" session-restore-of-one from the start, so\nthat unification is no longer a separate step; it is how Phase 2 is built.)"
		] }) }),
		"\n",
		createVNode(_components.h3, {
			id: "phase-1--seat-the-sum-zero-behavior-change--shipped",
			children: "Phase 1 — seat the sum (zero behavior change) · shipped"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [createVNode($$PrLink, { pr: 1449 }), "."] }),
			" ",
			createVNode(_components.code, { children: "TerminalMetadataSchema" }),
			" flipped from a flat ",
			createVNode(_components.code, { children: ".merge" }),
			" to\n",
			createVNode(_components.code, { children: "z.discriminatedUnion(\"state\", …)" }),
			" with only the ",
			createVNode(_components.code, { children: "active" }),
			" arm constructed — the UX\nstayed pixel-identical while the ",
			createVNode(_components.code, { children: "state === \"active\"" }),
			" seam every later phase leans\non came into being. The union flows on the client, where every liveness reader\nnarrows through one ",
			createVNode(_components.code, { children: "activeArm" }),
			" seam, so a live field on a bare terminal no longer\ncompiles. A ",
			createVNode(_components.code, { children: "state.ts" }),
			" migration stamps ",
			createVNode(_components.code, { children: "state: \"active\"" }),
			" on legacy records and\nbumps ",
			createVNode(_components.code, { children: "SCHEMA_VERSION" }),
			" — the one sanctioned place the default is supplied; read\nsites narrow, never coalesce."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "phase-2--sleep--wake-in-place",
			children: "Phase 2 — Sleep / Wake (in place)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [createVNode($$PrLink, { pr: 1487 }), "."] }),
			" Implemented exactly as planned: the one registry holds\nthe ",
			createVNode(_components.code, { children: "Terminal" }),
			" union under a stable id (",
			createVNode(_components.code, { children: "TerminalProcess" }),
			" is a discriminated\nprocess — the sleeping arm’s PTY handle is ",
			createVNode(_components.em, { children: "absent by type" }),
			"), sleep flips in place\npersist-before-kill, wake re-spawns on the same id and replays the ",
			createVNode(_components.strong, { children: "observed" }),
			"\n",
			createVNode(_components.code, { children: "lastAgentCommand" }),
			" through ",
			createVNode(_components.code, { children: "resumeAgentCommand" }),
			", and boot re-seeds sleeping records\n(adopt-or-reap). The dormant tile surfaces the ",
			createVNode(_components.strong, { children: "last-known context" }),
			" it was\nworking — ",
			createVNode(_components.code, { children: "cwd" }),
			" and branch ride the persisted base, while the live PR is ",
			createVNode(_components.em, { children: "snapshotted" }),
			"\nonto the sleeping arm at sleep and discarded on wake (the PR sensor re-resolves it\nlive). The journey e2e asserts the real outcomes — ",
			createVNode(_components.em, { children: "wake resumes the same\nconversation" }),
			", ",
			createVNode(_components.em, { children: "drag a dormant tile then reload" }),
			", ",
			createVNode(_components.em, { children: "reboot then wake" }),
			", ",
			createVNode(_components.em, { children: "reboot\nmid-sleep converges" }),
			" — not counts. ",
			createVNode(_components.em, { children: [
				"(An agent launched through a ",
				createVNode(_components.code, { children: "nix run …#agent" }),
				"\nwrapper — whose observed head token is ",
				createVNode(_components.code, { children: "nix" }),
				", not the agent — is not resumed on\nwake; it wakes to a bare shell, tracked as ",
				createVNode(_components.a, {
					href: "https://github.com/juspay/kolu/issues/1492",
					children: "#1492"
				}),
				".)"
			] })
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Re-planned after a first cut (PR #1466, discarded)",
			children: createVNode(_components.p, { children: [
				"The first Phase-2 implementation built the sleeping arm as an ",
				createVNode(_components.strong, { children: "immutable" }),
				" record\nminted with a ",
				createVNode(_components.strong, { children: "fresh id" }),
				" into a ",
				createVNode(_components.strong, { children: "separate store" }),
				". Hands-on testing surfaced two\nbugs in a minute — you couldn’t ",
				createVNode(_components.strong, { children: "drag" }),
				" a sleeping tile, and ",
				createVNode(_components.strong, { children: "waking" }),
				" one didn’t\nresume the agent — and an audit found ",
				createVNode(_components.strong, { children: "38 issues of the same class" }),
				" (15\nhigh-severity). Both bugs root to the same choice: an immutable record in a separate\nstore has ",
				createVNode(_components.em, { children: "no write sink" }),
				" (so drag / resize / rename / theme were disabled), and its\nthin schema ",
				createVNode(_components.em, { children: "stripped the agent" }),
				" into the live overlay (so wake resumed nothing).\nThe tests passed because they asserted invariants (a dormant body renders, a record\nsurvives reboot) instead of journeys (sleep a Claude session → wake → keep talking;\nmove a dormant tile). ",
				createVNode(_components.strong, { children: [
					"This revision keeps the ",
					createVNode(_components.em, { children: "type" }),
					" — the ",
					createVNode(_components.code, { children: "active | sleeping" }),
					" sum\nwas always right — and replaces the ",
					createVNode(_components.em, { children: "mechanism" }),
					":"
				] }),
				" one mutable record, stable id,\nflipped in place, with wake reusing the path a reboot already runs."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Populate the ",
			createVNode(_components.code, { children: "sleeping" }),
			" arm by flipping a flag, not minting a record."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: [
				"Sleep flips ",
				createVNode(_components.code, { children: "active → sleeping" }),
				" in place."
			] }),
			" It captures the agent’s resume input\n(the last agent command) onto the persisted base, flips the ",
			createVNode(_components.code, { children: "state" }),
			" flag on the\n",
			createVNode(_components.em, { children: "same record under the same id" }),
			", writes the session durably, then releases the\nPTY/xterm/WebGL/agent — ",
			createVNode(_components.em, { children: "persist before kill" }),
			", so a crash mid-sleep loses nothing.\nNo new id, no second store, no retire-the-predecessor: the record the canvas was\nalready showing simply changes state, so the tile keeps its slot, dock order,\nselection, and id with ",
			createVNode(_components.strong, { children: "zero swap" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Wake is session-restore-of-one — literally the path a reboot runs." }),
			" kolu already\nrehydrates terminals on server restart: it re-spawns the PTY in the saved cwd and\nresumes the agent with ",
			createVNode(_components.code, { children: "resumeAgentCommand" }),
			". With the fold-derived ",
			createVNode(_components.code, { children: "restoreTarget" }),
			" —\nits ",
			createVNode(_components.code, { children: "exact" }),
			" arm carrying the agent identity (juspay/kolu#1495) — that resume targets the\n",
			createVNode(_components.strong, { children: "exact" }),
			" conversation that was running on\nthis terminal — ",
			createVNode(_components.code, { children: "claude --resume <id>" }),
			", ",
			createVNode(_components.code, { children: "codex resume <id>" }),
			", ",
			createVNode(_components.code, { children: "opencode --session <id>" }),
			"\n— and falls back to the cwd-most-recent form (claude ",
			createVNode(_components.code, { children: "-c" }),
			" &c.) only when no session\nwas ever captured. Wake flips the record back to ",
			createVNode(_components.code, { children: "active" }),
			" and replays that ",
			createVNode(_components.strong, { children: "same" }),
			"\npath on the one record. So wake resumes your agent to ",
			createVNode(_components.strong, { children: "exactly the degree a reboot\ndoes" }),
			" — the bar you already trust — with no bespoke sleep-only resume. The persisted\nbase carries ",
			createVNode(_components.code, { children: "cwd" }),
			" + the last agent command + the conversation ref, which is\neverything that path needs; the in-place flip keeps them on the record by default."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "One registry, one list — no merge seam." }),
			" A sleeping terminal is the same entry\nin the one terminal registry, so it rides the ",
			createVNode(_components.em, { children: "one" }),
			" id list the client already\nsubscribes to: no second store to union, no “three snapshot reads must each include\nsleeping” seam (the first cut’s most error-prone surface). Liveness is the ",
			createVNode(_components.code, { children: "state" }),
			"\ndiscriminant that ",
			createVNode(_components.strong, { children: "one canonical classifier" }),
			" reads, so dock, minimap, switcher,\nand mobile all show a sleeping terminal coherently from a single source — no\nper-surface sleeping branch to forget."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "A sleeping tile is a first-class canvas citizen." }),
			" Because the record keeps its\nstable id, the normal write sinks find it and mutate in place — it ",
			createVNode(_components.strong, { children: "drags,\nresizes, renames, and re-themes" }),
			" like any live tile. The only thing it can’t do is\ntake PTY input, and that’s a ",
			createVNode(_components.em, { children: "type" }),
			" fact (the overlay is absent on the sleeping\narm), not a runtime lockout. ",
			createVNode(_components.em, { children: "The first cut disabled these because an immutable\nrecord had nowhere to write the change — the reset removes the lockout by removing\nthe immutability." })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Sleep is manual, Wake is explicit, navigation never wakes." }),
			" A ☾ Sleep button on\nthe tile title bar, a Sleep/Wake palette command, and a discoverability tip are the\nonly triggers — no global keybind, no auto-sleep. Landing on a sleeping tile (cycle,\nMRU, dock click, switcher, mobile swipe) ",
			createVNode(_components.strong, { children: "focuses it frozen" }),
			": it becomes the\nactive/selected tile showing its dormant body and an explicit ",
			createVNode(_components.strong, { children: "Wake" }),
			", never an\nauto-respawn — so the right panel, inspector, and theme for an active-but-sleeping\ntile fall back to the frozen, no-live-content view plus a Wake call-to-action.\nClosing a sleeping tile routes through the ",
			createVNode(_components.strong, { children: "same close-confirm dialog" }),
			", reworded\nto ",
			createVNode(_components.em, { children: "discard sleeping terminal" }),
			" and driven off the still-persisted git/worktree info\n— it removes the record (no PTY to kill) and still offers worktree removal."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Non-negotiables for Phase 2",
			children: [createVNode(_components.p, { children: "These are requirements, not nice-to-haves — each closes a failure mode the first cut\nshipped without noticing." }), createVNode(_components.ul, { children: [
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Wake must resume the agent — identical to a reboot." }),
					" Wake re-spawns through the\nexisting ",
					createVNode(_components.code, { children: "resumeAgentCommand" }),
					" path; the persisted base MUST carry ",
					createVNode(_components.code, { children: "cwd" }),
					" + the last\nagent command so that path has its inputs. The first cut classified the agent as\n“live overlay” and stripped it, so wake resumed nothing — this is what the\n",
					createVNode(_components.em, { children: "wake-resumes-the-same-conversation" }),
					" journey test below exists to catch."
				] }),
				"\n",
				createVNode(_components.li, { children: [createVNode(_components.strong, { children: "A sleeping tile drags, resizes, and renames." }), " The stable-id record has a real\nwrite sink — never disable a canvas interaction because a tile is sleeping. Only\nPTY input is fenced, and by type (the overlay is absent on the sleeping arm), not a\nguard. The first cut disabled drag/resize because its immutable record had nowhere\nto persist the change."] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: [
						"Close the splits, then sleep the top terminal — and ",
						createVNode(_components.em, { children: "say so" }),
						"."
					] }),
					" A sleeping\nrecord is a single terminal; any sub-terminals are ",
					createVNode(_components.strong, { children: "closed" }),
					" (not frozen) before\nthe flip. Confirm it so three splits don’t vanish silently. One top-terminal\nrecord carrying that terminal’s base — no orphan or dangling-child record."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Tolerate a corrupt persisted record; never let one poison the set." }),
					" A\n",
					createVNode(_components.em, { children: "malformed" }),
					" record is a saved sleeping entry that no longer validates — its base\ntruncated by a crash mid-write, hand-edited, or left by an older build. Validate\n",
					createVNode(_components.em, { children: "shape" }),
					" in the schema, then ",
					createVNode(_components.strong, { children: "drop" }),
					" a record that fails the cross-field invariant\nat the read boundary — never a fatal validator on the persisted collection, so one\nbad entry can’t break the load for every other terminal. (See the\n",
					createVNode(_components.code, { children: "persisted-schema-stays-tolerant" }),
					" code-police rule.)"
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: [
						"First-class ",
						createVNode(_components.em, { children: "and visually distinct" }),
						" in every presence surface — from ONE\nclassifier."
					] }),
					" A sleeping terminal renders — moonlit, ☾, dimmed — in the canvas,\ndock, minimap, switcher, and mobile; arrange clusters it with its repo; the cycle\ntraverses it. The ",
					createVNode(_components.strong, { children: "paint" }),
					" distinction keys on ",
					createVNode(_components.code, { children: "state === \"sleeping\"" }),
					", decoupled\nfrom the staleness / “parked” vocabulary — a ",
					createVNode(_components.em, { children: "fresh" }),
					" slept tile wears its ☾ row\nand moonlit treatment, never reading as merely idle. The first cut routed sleeping\nthrough a ",
					createVNode(_components.em, { children: "parallel" }),
					" check that the switcher/minimap/mobile classifiers never saw —\nso make the ",
					createVNode(_components.strong, { children: "one canonical bucket classifier" }),
					" branch on the discriminant, and\nverify presence on each surface (omission is a runtime fact). Mobile must render a\ndormant body, not attempt a live PTY attach. ",
					createVNode(_components.strong, { children: "The dock’s activity-window hide is\nthe one place staleness wins over the ☾" }),
					" (",
					createVNode($$PrLink, { pr: 1593 }),
					"): a tile slept\nlonger ago than the window — keyed on its ",
					createVNode(_components.code, { children: "sleptAt" }),
					" (the deliberate sleep moment),\n",
					createVNode(_components.em, { children: "not" }),
					" its last agent transition — routes to ",
					createVNode(_components.code, { children: "parked" }),
					" and drops, so the window\ncompresses yesterday’s dormant terminals too instead of letting them pile up.\nKeying on ",
					createVNode(_components.code, { children: "sleptAt" }),
					" is load-bearing: a plain shell carries ",
					createVNode(_components.code, { children: "lastActivityAt === 0" }),
					"\n(which ",
					createVNode(_components.code, { children: "isStale" }),
					" exempts), so an agent-less dormant tile would otherwise ",
					createVNode(_components.em, { children: "never" }),
					"\npark; and a just-slept tile whose agent went quiet days ago still keeps its ☾.\n",
					createVNode(_components.code, { children: "parked" }),
					" is checked ",
					createVNode(_components.em, { children: "before" }),
					" ",
					createVNode(_components.code, { children: "sleeping" }),
					" in the dock’s classifier. One\n",
					createVNode(_components.code, { children: "rowRecencyAt(meta)" }),
					" derives this recency once and the row’s “Xs ago” cell\ndisplays it too, so the age a row shows is the exact age the window acts on —\nno “why is my 3h-ago row hidden?” gap. (“Show all” re-reveals them, and the “N\nhidden by … window” footer counts them.)"
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "A sleeping tile can be the active tile." }),
					" Click/select focuses it; input routing\nnarrows to ",
					createVNode(_components.code, { children: "active" }),
					", so it is never an input target — a type fact, not a runtime\nguard. Its content panels (right panel, inspector, theme) show the frozen view +\nWake, never a live attach."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "The boot path reconciles, it doesn’t assume." }),
					" Sleep persists durably ",
					createVNode(_components.em, { children: "then" }),
					"\nkills the PTY; a crash in that window can leave a sleeping record on disk with its\nPTY briefly alive. On cold boot, reconcile each sleeping record against any\nsurviving PTY (adopt-or-reap) so the cold path converges like the adopt path — and\nthe boot/restore seed spawns ",
					createVNode(_components.em, { children: "active" }),
					" terminals only, never waking one."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "An e2e that drives the real journeys, asserting outcomes not counts." }),
					" The first\ncut’s wake scenario only ran ",
					createVNode(_components.code, { children: "echo" }),
					" and asserted a live shell — it would PASS with\na blank ",
					createVNode(_components.em, { children: "new" }),
					" Claude, which is the literal hole the agent-resume bug fell through.\nThis time: ",
					createVNode(_components.strong, { children: "(1)" }),
					" ",
					createVNode(_components.em, { children: "wake resumes the same conversation" }),
					" — capture the agent before\nsleep, wake, assert it re-runs the resume form in the right cwd and lands the prior\nconversation, not a fresh shell; ",
					createVNode(_components.strong, { children: "(2)" }),
					" ",
					createVNode(_components.em, { children: "drag a sleeping tile then reload" }),
					" — the\nmoved layout persisted; ",
					createVNode(_components.strong, { children: "(3)" }),
					" ",
					createVNode(_components.em, { children: "reboot then wake" }),
					" — the slept session survives a\nfull restart and still resumes; ",
					createVNode(_components.strong, { children: "(4)" }),
					" ",
					createVNode(_components.em, { children: "reboot mid-sleep" }),
					" — the record converges\nwith no orphan PTY. Keep the malformed-record and last-terminal (don’t clear the\nsession) scenarios. Driven like a user; a green count-only test proves nothing."
				] }),
				"\n"
			] })]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Why the order is the point",
			children: createVNode(_components.p, { children: [
				"Sleep’s machinery is small. The design work is ",
				createVNode(_components.em, { children: "where a dormant terminal lives" }),
				" —\nPhase 1 answers that with a flag instead of a layer, and everything after is a\nbody, a route, or a state flip. The first cut grew large precisely because it\ntreated a dormant terminal as a ",
				createVNode(_components.em, { children: "separate thing" }),
				" (a new id, a new store, a frozen\ncopy) instead of the ",
				createVNode(_components.em, { children: "same thing in a different state" }),
				". Smaller, because the\nstructure finally fits the thing."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "trade-offs--when-wed-revisit",
			children: "Trade-offs & when we’d revisit"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A migration is mandatory." }),
				" ",
				createVNode(_components.code, { children: "SavedTerminal" }),
				" is persisted, so adding ",
				createVNode(_components.code, { children: "state" }),
				"\nneeds the ",
				createVNode(_components.code, { children: "state.ts" }),
				" migration above. There is no shipping this as a pure\nrefactor."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "One record, mutated in place; the id is stable." }),
				" ",
				createVNode(_components.code, { children: "state" }),
				" flips on the ",
				createVNode(_components.em, { children: "same" }),
				"\nrecord across sleep/wake — sleep releases the live overlay, wake re-derives it,\nbut the id, layout slot, and dock order never move. ",
				createVNode(_components.strong, { children: "This reverses the first\ncut" }),
				", which minted a fresh id per transition (immutable records) on the theory\nthat “immutability keeps identity un-complected.” In practice that split one\nterminal’s identity across two ids and two stores, then had to re-knit them with a\nmerge seam and a write-sink lockout — ",
				createVNode(_components.em, { children: "and" }),
				" it stripped the agent session as “live\noverlay,” so wake resumed nothing. A stable id makes the normal write sink and the\nexisting restore path ",
				createVNode(_components.strong, { children: "just work" }),
				": wake is restore-one, drag is a base write,\npresence is one classifier. We’d revisit only if mutating in place ever proved to\nneed boot-hydration surgery (it doesn’t — wake replays the path reboot already\nruns)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Wake resumes the ",
					createVNode(_components.em, { children: "exact" }),
					" conversation that was running — resolved in juspay/kolu#1495."
				] }),
				"\nOriginally wake reused only the cwd-scoped ",
				createVNode(_components.code, { children: "resumeAgentCommand" }),
				" (claude ",
				createVNode(_components.code, { children: "-c" }),
				" &c.), so a\ncwd with two conversations could wake on the wrong one. The follow-on derives a\ndiscriminated ",
				createVNode(_components.code, { children: "restoreTarget" }),
				" from the fold’s state — its ",
				createVNode(_components.code, { children: "exact" }),
				" arm carries the\nagent’s native session identity (",
				createVNode(_components.code, { children: "{ kind, sessionId }" }),
				") and resumes by it\n(",
				createVNode(_components.code, { children: "claude --resume <id>" }),
				" &c.); a quit-to-shell is ",
				createVNode(_components.code, { children: "none" }),
				" (a bare shell, model B), and a\nmigrated pre-1.29 record with no captured session is the named ",
				createVNode(_components.code, { children: "legacyMostRecent" }),
				"\n(cwd-most-recent). Exactly the ",
				createVNode(_components.strong, { children: "shared" }),
				"\nimprovement to the one restore path this caveat anticipated — it benefits reboot and\nwake together, never a wake-only fork."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Wake lands a clean resumed session — no repainted scrollback." }), " Identical to a\nreboot: the conversation is back, but the prior on-screen text is not repainted.\nPhase 3’s frozen-frame capture is what shows the last visual state during the\nswap; persisting the live scrollback buffer is a separate, addable follow-on if\nthe blank-screen feel proves unacceptable."] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "When we'd revisit",
			children: createVNode(_components.p, { children: [
				"If a genuine ",
				createVNode(_components.em, { children: "non-terminal" }),
				" canvas kind ever lands — a sticky note, a web embed —\nintroduce a content-kind layer then, designed against ",
				createVNode(_components.strong, { children: "two real kinds" }),
				". Location\nis structure: the receptacle is justified the day there’s a second thing to put in\nit, and not before. (See ",
				createVNode(_components.code, { children: "electricity.mdx" }),
				" — the same trap, named three ways.)"
			] })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Sleeping terminals",
	"description": "A plan for Sleep/Wake. Model the terminal as a sum — Terminal = active or sleeping — so a dormant terminal is a STATE on one record, not a separate thing. Sleep flips that state IN PLACE on a stable id; the live PTY/agent are released but the persisted base — cwd, layout, last agent command — stays, so wake re-spawns and resumes the agent exactly the way a server reboot already does. Presence reads the union; touching a live field narrows to active.",
	"parents": ["phantom-running-background", "feature"],
	"status": "implemented",
	"maturity": "budding",
	"updated": "2026-06-21T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "a-terminal-is-active-or-sleeping",
			"text": "A terminal is active or sleeping"
		},
		{
			"depth": 2,
			"slug": "presence-reads-the-union-liveness-narrows",
			"text": "Presence reads the union, liveness narrows"
		},
		{
			"depth": 2,
			"slug": "the-phases",
			"text": "The phases"
		},
		{
			"depth": 3,
			"slug": "phase-1--seat-the-sum-zero-behavior-change--shipped",
			"text": "Phase 1 — seat the sum (zero behavior change) · shipped"
		},
		{
			"depth": 3,
			"slug": "phase-2--sleep--wake-in-place",
			"text": "Phase 2 — Sleep / Wake (in place)"
		},
		{
			"depth": 2,
			"slug": "trade-offs--when-wed-revisit",
			"text": "Trade-offs & when we’d revisit"
		}
	];
}
var url = "src/content/atlas/sleeping-terminals.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/sleeping-terminals.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/sleeping-terminals.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Arch, C, CanvasTiles, Content, Content as default, DockUnified, Down, Frame, Layer, TileChrome, dot, file, frontmatter, getHeadings, url };
