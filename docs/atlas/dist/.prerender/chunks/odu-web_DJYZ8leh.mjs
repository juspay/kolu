import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$D2 } from "./D2_CPv-UX0x.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import "./Issue_mLFqCJSR.mjs";
import { n as $$Roadmap, t as $$Milestone } from "./Milestone_yecymha0.mjs";
//#region src/content/atlas/odu-web.mdx
var S = {
	ok: {
		background: "#e3f4e9",
		color: "#1b7a3a",
		border: "1px solid #bce3c8"
	},
	run: {
		background: "#fbf1dc",
		color: "#8a5200",
		border: "1px solid #ecd9ab"
	},
	fail: {
		background: "#fdebe9",
		color: "#b3261e",
		border: "1px solid #f3c4be"
	},
	pend: {
		background: "#eef0f2",
		color: "#9197a1",
		border: "1px solid #e2e5ea"
	}
};
var Cell = (props) => createVNode("span", {
	style: {
		display: "block",
		textAlign: "center",
		borderRadius: "6px",
		padding: ".28rem .3rem",
		fontSize: ".7rem",
		fontWeight: 600,
		fontFamily: "ui-monospace,monospace",
		...S[props.k]
	},
	children: props.t
});
var Chrome = (props) => createVNode("div", {
	style: {
		margin: "1.6rem 0",
		maxWidth: "37rem",
		border: "1px solid #d9d4c6",
		borderRadius: "12px",
		overflow: "hidden",
		boxShadow: "0 3px 18px rgba(0,0,0,.09)",
		fontFamily: "ui-sans-serif,system-ui"
	},
	children: [createVNode("div", {
		style: {
			display: "flex",
			alignItems: "center",
			gap: ".45rem",
			padding: ".5rem .8rem",
			background: "#f3f0e7",
			borderBottom: "1px solid #e6e2d6"
		},
		children: [
			createVNode("span", { style: {
				width: ".7rem",
				height: ".7rem",
				borderRadius: "50%",
				background: "#ff5f56",
				display: "inline-block"
			} }),
			createVNode("span", { style: {
				width: ".7rem",
				height: ".7rem",
				borderRadius: "50%",
				background: "#ffbd2e",
				display: "inline-block"
			} }),
			createVNode("span", { style: {
				width: ".7rem",
				height: ".7rem",
				borderRadius: "50%",
				background: "#27c93f",
				display: "inline-block"
			} }),
			createVNode("code", {
				style: {
					flex: 1,
					fontSize: ".72rem",
					color: "#3a3f47",
					background: "#fff",
					border: "1px solid #e2ddcf",
					borderRadius: "7px",
					padding: ".3rem .6rem",
					marginLeft: ".3rem"
				},
				children: props.url
			})
		]
	}), props.children]
});
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		li: "li",
		p: "p",
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
			createVNode(_components.em, { children: [
				"The question that produced this note: now that ",
				createVNode(_components.a, {
					href: "./odu.html",
					children: "odu"
				}),
				" has a TUI and an MCP face, what would the web app look like — and should it replace ",
				createVNode(_components.a, {
					href: "https://github.com/juspay/vira",
					children: "juspay/vira"
				}),
				"? The answer reframes the question: the web app worth building is not a third rendering of the attach surface. It is a ",
				createVNode(_components.strong, { children: "new program above the runner" }),
				" — ledger, triggers, fleet — and the browser is merely how you look at it."
			] }),
			" ",
			createVNode($$Pill, {
				variant: "new",
				children: "proposed"
			})
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Status: ",
			createVNode($$Pill, {
				variant: "warn",
				children: "proposed"
			}),
			" · maturity ",
			createVNode($$Pill, {
				variant: "todo",
				children: "seedling"
			}),
			" · the runner this builds on is ",
			createVNode(_components.a, {
				href: "./odu.html",
				children: "odu"
			}),
			" (Phase 1 + MCP face shipped) · the app shell is ",
			createVNode(_components.a, {
				href: "./surface-app.html",
				children: "surface-app"
			}),
			" (kolu and drishti are its two consumers; odu-web would be the third)"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The idea in one paragraph",
			children: createVNode(_components.p, { children: [
				"odu today is ",
				createVNode(_components.strong, { children: "run-centric and ephemeral" }),
				": an operator — human or agent — starts a run, a coordinator owns the DAG as live state, and when the coordinator dies only the per-SHA log files survive. vira is the inverse: ",
				createVNode(_components.strong, { children: "repo-centric and persistent" }),
				" — it watches registered repos, builds on its own initiative, and keeps history behind a web UI. Each is strong exactly where the other is weak. odu-web closes that gap ",
				createVNode(_components.em, { children: "without growing the runner" }),
				": a second program that ingests forge events, spawns odu runs per repo × SHA, persists verdicts in a run ledger that outlives every coordinator, and serves the browser — including the one page CI cannot do without, the page a red check’s ",
				createVNode(_components.strong, { children: "Details" }),
				" link lands on. The runner stays the small, proven thing it is; odu-web attaches to it as just another client of the same typed surface."
			] })
		}),
		"\n",
		createVNode($$D2, {
			caption: "odu-web is a layer, not a face. The runner (bottom) is unchanged — odu-web is one more client of its typed surface, plus three things no runner client can be: a trigger ingester, a run ledger, and a browser server. The forge loop closes left to right: events in, statuses out, target_url back to the run page.",
			code: `
direction: down

forge: "forge — github.com" {
ev: "push / PR events"
st: "commit status · target_url"
}

web: "odu-web — the new program (the service)" {
trig: "triggers — webhook / poll"
ledger: "run ledger — outlives runners"
ui: "browser UI — surface-app PWA"
authz: "read-observer vs mutator gate"
}

runner: "odu runner — unchanged, one per repo × SHA run" {
surf: "nodes · nodeLog · rerun — typed surface"
}

forge -> web: "events in (Phase 3)"
web -> runner: "spawns + attaches as a client"
runner -> web: "verdicts + logs → ledger"
web -> forge: "posts status — target_url → the run page (Phase 1)"
`
		}),
		"\n",
		"\n",
		"\n",
		"\n",
		createVNode(_components.h2, {
			id: "two-products-hide-in-the-web-app",
			children: "Two products hide in “the web app”"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The first is the ",
			createVNode(_components.strong, { children: "attach face" }),
			": a browser tab rendering one live run — the TUI with rounder corners. ",
			createVNode(_components.a, {
				href: "./odu.html",
				children: "The odu note"
			}),
			" already judged this one correctly, and the judgement stands: nobody opens a tab to watch a run they kicked off from their shell, the TUI and MCP faces serve the single-operator case better, and a hosted page is the one client that drags in the authz boundary the other faces dodge. Built alone, the attach face is cost with no constituency."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The second is the ",
			createVNode(_components.strong, { children: "service face" }),
			", and it has three constituencies the runner cannot reach today:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"The PR author who never typed ",
					createVNode(_components.code, { children: "odu run" }),
					"."
				] }),
				" odu posts commit statuses; a GitHub status carries a ",
				createVNode(_components.em, { children: "Details" }),
				" link; today odu has nothing for it to point at. The moment a teammate’s check goes red, the product they need is a URL: this SHA, this node, this log."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The team asking “what is CI doing right now, everywhere.”" }), " Fan-in across lanes, hosts — and repos. A single-repo web dashboard has no reason to exist; multi-repo is what justifies the tab."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Anyone asking about yesterday." }), " The coordinator’s state dies with it; only per-SHA log files survive. History, trends, “when did this lane start flaking” — there is no client that can answer, because there is nothing durable to ask."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Every one of those is a property of a ",
			createVNode(_components.strong, { children: "layer above the runner" }),
			" — persistence, triggers, identity across runs — not of a fourth rendering of ",
			createVNode(_components.code, { children: "nodes" }),
			" · ",
			createVNode(_components.code, { children: "nodeLog" }),
			" · ",
			createVNode(_components.code, { children: "rerun" }),
			". That is the product. The attach face then falls out of it for free (Phase 2 below), instead of the other way around."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-wedge--be-the-target_url",
			children: ["The wedge — be the ", createVNode(_components.code, { children: "target_url" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The smallest shippable slice of the service face is also the highest-value one: the ",
			createVNode(_components.strong, { children: "run page" }),
			", the URL odu’s commit statuses start carrying as ",
			createVNode(_components.code, { children: "target_url" }),
			". It is read-only, history-backed, and needs neither triggers nor live attach — only a ",
			createVNode(_components.strong, { children: "run ledger" }),
			": today’s per-SHA on-disk log layout (which already survives runner death, by design) formalized into a queryable record of runs, verdicts, durations, and logs that odu-web ingests as runs complete."
		] }),
		"\n",
		createVNode(Chrome, {
			url: "odu.srid.ca/juspay/kolu/runs/26d2c2d",
			children: [
				createVNode("div", {
					style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						padding: ".7rem .95rem",
						background: "#fff",
						borderBottom: "1px solid #efeadd"
					},
					children: [createVNode("span", {
						style: {
							display: "inline-flex",
							alignItems: "baseline",
							gap: ".5rem"
						},
						children: [
							createVNode("strong", {
								style: {
									color: "#1a1c20",
									fontSize: ".95rem"
								},
								children: "juspay/kolu"
							}),
							createVNode("code", {
								style: {
									color: "#5a3ff0",
									background: "#efebff",
									borderRadius: "5px",
									padding: ".05rem .35rem",
									fontSize: ".7rem"
								},
								children: "26d2c2d"
							}),
							createVNode("span", {
								style: {
									color: "#7a8089",
									fontSize: ".74rem"
								},
								children: "fix(surface): guard stdio write streams…"
							})
						]
					}), createVNode("span", {
						style: {
							...S.fail,
							display: "inline-flex",
							alignItems: "center",
							gap: ".3rem",
							borderRadius: "6px",
							padding: ".24rem .5rem",
							fontSize: ".72rem",
							fontWeight: 700,
							fontFamily: "ui-monospace,monospace"
						},
						children: "✗ failed · 1 of 8"
					})]
				}),
				createVNode("div", {
					style: {
						padding: ".45rem .95rem",
						background: "#fbf8f0",
						borderBottom: "1px solid #efeadd",
						fontSize: ".68rem",
						color: "#8a8470",
						fontFamily: "ui-monospace,monospace"
					},
					children: [
						"↳ you arrived from GitHub — commit status ",
						createVNode("code", {
							style: { color: "#5b6470" },
							children: "ci::e2e@x86_64-linux"
						}),
						" · Details"
					]
				}),
				createVNode("div", {
					style: {
						padding: ".75rem .95rem .4rem",
						background: "#fff"
					},
					children: createVNode("div", {
						style: {
							display: "grid",
							gridTemplateColumns: "4.2rem repeat(2, 1fr)",
							gap: ".32rem",
							alignItems: "center"
						},
						children: [
							createVNode(_components.span, {}),
							createVNode("span", {
								style: {
									textAlign: "center",
									fontSize: ".64rem",
									color: "#7a8089",
									fontFamily: "ui-monospace,monospace"
								},
								children: "x86_64-linux"
							}),
							createVNode("span", {
								style: {
									textAlign: "center",
									fontSize: ".64rem",
									color: "#7a8089",
									fontFamily: "ui-monospace,monospace"
								},
								children: "aarch64-darwin"
							}),
							createVNode("code", {
								style: {
									fontSize: ".74rem",
									color: "#3a3f47",
									fontWeight: 600
								},
								children: "nix"
							}),
							createVNode(Cell, {
								k: "ok",
								t: "✓ 3m40"
							}),
							createVNode(Cell, {
								k: "ok",
								t: "✓ 4m02"
							}),
							createVNode("code", {
								style: {
									fontSize: ".74rem",
									color: "#3a3f47",
									fontWeight: 600
								},
								children: "e2e"
							}),
							createVNode(Cell, {
								k: "fail",
								t: "✗ 2m12"
							}),
							createVNode(Cell, {
								k: "ok",
								t: "✓ 2m44"
							}),
							createVNode("code", {
								style: {
									fontSize: ".74rem",
									color: "#3a3f47",
									fontWeight: 600
								},
								children: "unit"
							}),
							createVNode(Cell, {
								k: "ok",
								t: "✓ 0m31"
							}),
							createVNode(Cell, {
								k: "ok",
								t: "✓ 0m44"
							}),
							createVNode("code", {
								style: {
									fontSize: ".74rem",
									color: "#3a3f47",
									fontWeight: 600
								},
								children: "lint"
							}),
							createVNode(Cell, {
								k: "ok",
								t: "✓ 0m12"
							}),
							createVNode(Cell, {
								k: "ok",
								t: "✓ 0m14"
							})
						]
					})
				}),
				createVNode("div", {
					style: {
						margin: "0 .95rem .95rem",
						border: "1px solid #e6e2d6",
						borderRadius: "8px",
						overflow: "hidden"
					},
					children: [createVNode("div", {
						style: {
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							padding: ".4rem .6rem",
							background: "#f7f4ec",
							borderBottom: "1px solid #ece7da",
							fontSize: ".7rem",
							color: "#5b6470",
							fontFamily: "ui-monospace,monospace"
						},
						children: [createVNode(_components.span, { children: ["x86_64-linux · e2e\xA0 ", createVNode("span", {
							style: { color: "#b3261e" },
							children: "✗ failed · exit 1"
						})] }), createVNode("span", {
							style: { color: "#b9b2a0" },
							children: "⟳ rerun — operators only"
						})]
					}), createVNode("div", {
						style: {
							padding: ".55rem .7rem",
							background: "#15171f",
							color: "#c9d1e3",
							fontFamily: "ui-monospace,monospace",
							fontSize: ".7rem",
							lineHeight: 1.55,
							whiteSpace: "pre",
							overflowX: "auto"
						},
						children: `cucumber · 14 scenarios
✓ open a terminal … 2.1s
✗ reconnect after server restart
  expected pane to repaint within 5s
  at features/reconnect.feature:31`
					})]
				})
			]
		}),
		"\n",
		createVNode(_components.p, { children: "Three properties make this the wedge and not just the first feature:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "It is the first moment odu is visible to people who never invoked it." }),
				" Every hosted CI’s adoption loop runs through the Details link; odu’s gate half (statuses, branch protection) shipped in Phase 1 of ",
				createVNode(_components.a, {
					href: "./odu.html",
					children: "the odu note"
				}),
				" — this completes that loop."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "It forces the ledger, and nothing else." }), " No triggers, no live protocol in the browser, and almost no authz — a read-only page behind whatever the team already uses (tailnet, basic auth). The greyed-out rerun button in the mockup is the Phase 4 boundary, visible but inert."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "It survives everything." }), " The page renders from the ledger, not from a live coordinator — a run that finished last week and a runner that died mid-flight both have a page."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-service--a-coordinator-of-coordinators",
			children: "The service — a coordinator of coordinators"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Everything past the wedge is one program growing around the ledger. The load-bearing decision is that ",
			createVNode(_components.strong, { children: "none of it lands in the runner" }),
			". odu keeps its shape — spawn, own one DAG, serve three primitives, exit relevance when the run is done. odu-web is the thing with opinions about ",
			createVNode(_components.em, { children: "many" }),
			" runs: it ingests forge events (webhook first, vira-style polling as the fallback for forges or networks without one), resolves repo × SHA into an odu invocation exactly the way the MCP face’s ",
			createVNode(_components.code, { children: "run" }),
			" tool does today, attaches to the live coordinator as a read client, mirrors ",
			createVNode(_components.code, { children: "nodes" }),
			" and ",
			createVNode(_components.code, { children: "nodeLog" }),
			" into the browser, and writes the verdict into the ledger when the run settles."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Because the browser speaks the same ",
			createVNode(_components.code, { children: "useCell" }),
			" / ",
			createVNode(_components.code, { children: "useStream" }),
			" Solid hooks every other face rides, the live view is the part that costs the least — ",
			createVNode(_components.a, {
				href: "./surface-app.html",
				children: "surface-app"
			}),
			" already solves the app-shell problems (freshness, build identity, PWA install), with kolu and drishti as its two production consumers. A live run page looks like the wedge page with the verdict still warm:"
		] }),
		"\n",
		createVNode(Chrome, {
			url: "odu.srid.ca/juspay/kolu — live",
			children: [
				createVNode("div", {
					style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						padding: ".7rem .95rem",
						background: "#fff",
						borderBottom: "1px solid #efeadd"
					},
					children: [createVNode("span", {
						style: {
							display: "inline-flex",
							alignItems: "baseline",
							gap: ".5rem"
						},
						children: [
							createVNode("strong", {
								style: {
									color: "#1a1c20",
									fontSize: ".95rem"
								},
								children: "odu"
							}),
							createVNode("span", {
								style: {
									color: "#7a8089",
									fontSize: ".8rem"
								},
								children: "juspay/kolu"
							}),
							createVNode("code", {
								style: {
									color: "#5a3ff0",
									background: "#efebff",
									borderRadius: "5px",
									padding: ".05rem .35rem",
									fontSize: ".7rem"
								},
								children: "26d2c2d"
							})
						]
					}), createVNode("span", {
						style: {
							display: "inline-flex",
							alignItems: "center",
							gap: ".35rem",
							color: "#1b7a3a",
							fontSize: ".72rem",
							fontWeight: 600
						},
						children: createVNode(_components.p, { children: [createVNode("span", { style: {
							width: ".5rem",
							height: ".5rem",
							borderRadius: "50%",
							background: "#1b7a3a",
							display: "inline-block"
						} }), " 3 lanes · connected"] })
					})]
				}),
				createVNode("div", {
					style: {
						padding: ".75rem .95rem .4rem",
						background: "#fff"
					},
					children: createVNode("div", {
						style: {
							display: "grid",
							gridTemplateColumns: "4.2rem repeat(3, 1fr)",
							gap: ".32rem",
							alignItems: "center"
						},
						children: [
							createVNode(_components.span, {}),
							createVNode("span", {
								style: {
									textAlign: "center",
									fontSize: ".64rem",
									color: "#7a8089",
									fontFamily: "ui-monospace,monospace"
								},
								children: "x86_64-linux"
							}),
							createVNode("span", {
								style: {
									textAlign: "center",
									fontSize: ".64rem",
									color: "#7a8089",
									fontFamily: "ui-monospace,monospace"
								},
								children: "aarch64-darwin"
							}),
							createVNode("span", {
								style: {
									textAlign: "center",
									fontSize: ".64rem",
									color: "#7a8089",
									fontFamily: "ui-monospace,monospace"
								},
								children: "aarch64-linux"
							}),
							createVNode("code", {
								style: {
									fontSize: ".74rem",
									color: "#3a3f47",
									fontWeight: 600
								},
								children: "nix"
							}),
							createVNode(Cell, {
								k: "ok",
								t: "✓ 3m40"
							}),
							createVNode(Cell, {
								k: "ok",
								t: "✓ 4m02"
							}),
							createVNode(Cell, {
								k: "run",
								t: "● 1m12"
							}),
							createVNode("code", {
								style: {
									fontSize: ".74rem",
									color: "#3a3f47",
									fontWeight: 600
								},
								children: "e2e"
							}),
							createVNode(Cell, {
								k: "ok",
								t: "✓ 2m03"
							}),
							createVNode(Cell, {
								k: "run",
								t: "● 1m55"
							}),
							createVNode(Cell, {
								k: "pend",
								t: "⏸ —"
							}),
							createVNode("code", {
								style: {
									fontSize: ".74rem",
									color: "#3a3f47",
									fontWeight: 600
								},
								children: "unit"
							}),
							createVNode(Cell, {
								k: "ok",
								t: "✓ 0m31"
							}),
							createVNode(Cell, {
								k: "ok",
								t: "✓ 0m44"
							}),
							createVNode(Cell, {
								k: "pend",
								t: "⏸ —"
							}),
							createVNode("code", {
								style: {
									fontSize: ".74rem",
									color: "#3a3f47",
									fontWeight: 600
								},
								children: "lint"
							}),
							createVNode(Cell, {
								k: "ok",
								t: "✓ 0m12"
							}),
							createVNode(Cell, {
								k: "ok",
								t: "✓ 0m14"
							}),
							createVNode(Cell, {
								k: "pend",
								t: "⏸ —"
							})
						]
					})
				}),
				createVNode("div", {
					style: {
						margin: "0 .95rem .95rem",
						border: "1px solid #e6e2d6",
						borderRadius: "8px",
						overflow: "hidden"
					},
					children: [createVNode("div", {
						style: {
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							padding: ".4rem .6rem",
							background: "#f7f4ec",
							borderBottom: "1px solid #ece7da",
							fontSize: ".7rem",
							color: "#5b6470",
							fontFamily: "ui-monospace,monospace"
						},
						children: [createVNode(_components.span, { children: ["aarch64-darwin · e2e\xA0 ", createVNode("span", {
							style: { color: "#8a5200" },
							children: "● running 1m55s"
						})] }), createVNode("span", {
							style: { color: "#5a3ff0" },
							children: "⟳ rerun"
						})]
					}), createVNode("div", {
						style: {
							padding: ".55rem .7rem",
							background: "#15171f",
							color: "#c9d1e3",
							fontFamily: "ui-monospace,monospace",
							fontSize: ".7rem",
							lineHeight: 1.55,
							whiteSpace: "pre",
							overflowX: "auto"
						},
						children: `cucumber · 14 scenarios
✓ open a terminal … 2.1s
✓ split a pane … 1.4s
▸ reconnect after server restart …▍`
					})]
				})
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"And the fleet view is the same data one level up — ",
			createVNode(_components.strong, { children: "repo is just another fan-in axis" }),
			", the generalization of the lane matrix that ",
			createVNode(_components.a, {
				href: "./odu.html",
				children: "the odu note"
			}),
			" catalogued as open:"
		] }),
		"\n",
		createVNode(Chrome, {
			url: "odu.srid.ca",
			children: [createVNode("div", {
				style: {
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: ".7rem .95rem",
					background: "#fff",
					borderBottom: "1px solid #efeadd"
				},
				children: [createVNode("strong", {
					style: {
						color: "#1a1c20",
						fontSize: ".95rem"
					},
					children: "odu — fleet"
				}), createVNode("span", {
					style: {
						fontSize: ".7rem",
						color: "#7a8089",
						fontFamily: "ui-monospace,monospace"
					},
					children: "4 repos · 2 running · 11 runs today"
				})]
			}), createVNode("div", {
				style: {
					padding: ".6rem .95rem .85rem",
					background: "#fff"
				},
				children: createVNode("div", {
					style: {
						display: "grid",
						gridTemplateColumns: "1fr 5.4rem 4.6rem 5.4rem",
						gap: ".32rem .5rem",
						alignItems: "center"
					},
					children: [
						createVNode("span", {
							style: {
								fontSize: ".62rem",
								color: "#9aa0a9",
								fontFamily: "ui-monospace,monospace"
							},
							children: "repo · ref"
						}),
						createVNode("span", {
							style: {
								fontSize: ".62rem",
								color: "#9aa0a9",
								fontFamily: "ui-monospace,monospace",
								textAlign: "center"
							},
							children: "commit"
						}),
						createVNode("span", {
							style: {
								fontSize: ".62rem",
								color: "#9aa0a9",
								fontFamily: "ui-monospace,monospace",
								textAlign: "center"
							},
							children: "verdict"
						}),
						createVNode("span", {
							style: {
								fontSize: ".62rem",
								color: "#9aa0a9",
								fontFamily: "ui-monospace,monospace",
								textAlign: "center"
							},
							children: "duration"
						}),
						createVNode("span", {
							style: {
								fontSize: ".76rem",
								color: "#3a3f47"
							},
							children: [
								createVNode(_components.strong, { children: "juspay/kolu" }),
								" ",
								createVNode("span", {
									style: { color: "#7a8089" },
									children: "· master"
								})
							]
						}),
						createVNode("code", {
							style: {
								color: "#5a3ff0",
								background: "#efebff",
								borderRadius: "5px",
								padding: ".05rem .3rem",
								fontSize: ".66rem",
								textAlign: "center"
							},
							children: "26d2c2d"
						}),
						createVNode(Cell, {
							k: "run",
							t: "● running"
						}),
						createVNode(Cell, {
							k: "run",
							t: "4m12"
						}),
						createVNode("span", {
							style: {
								fontSize: ".76rem",
								color: "#3a3f47"
							},
							children: [
								createVNode(_components.strong, { children: "juspay/kolu" }),
								" ",
								createVNode("span", {
									style: { color: "#7a8089" },
									children: "· PR #1291"
								})
							]
						}),
						createVNode("code", {
							style: {
								color: "#5a3ff0",
								background: "#efebff",
								borderRadius: "5px",
								padding: ".05rem .3rem",
								fontSize: ".66rem",
								textAlign: "center"
							},
							children: "53c0889"
						}),
						createVNode(Cell, {
							k: "fail",
							t: "✗ e2e"
						}),
						createVNode(Cell, {
							k: "pend",
							t: "9m03"
						}),
						createVNode("span", {
							style: {
								fontSize: ".76rem",
								color: "#3a3f47"
							},
							children: [
								createVNode(_components.strong, { children: "juspay/odu" }),
								" ",
								createVNode("span", {
									style: { color: "#7a8089" },
									children: "· master"
								})
							]
						}),
						createVNode("code", {
							style: {
								color: "#5a3ff0",
								background: "#efebff",
								borderRadius: "5px",
								padding: ".05rem .3rem",
								fontSize: ".66rem",
								textAlign: "center"
							},
							children: "7fa40f3"
						}),
						createVNode(Cell, {
							k: "ok",
							t: "✓ green"
						}),
						createVNode(Cell, {
							k: "pend",
							t: "2m31"
						}),
						createVNode("span", {
							style: {
								fontSize: ".76rem",
								color: "#3a3f47"
							},
							children: [
								createVNode(_components.strong, { children: "srid/drishti" }),
								" ",
								createVNode("span", {
									style: { color: "#7a8089" },
									children: "· master"
								})
							]
						}),
						createVNode("code", {
							style: {
								color: "#5a3ff0",
								background: "#efebff",
								borderRadius: "5px",
								padding: ".05rem .3rem",
								fontSize: ".66rem",
								textAlign: "center"
							},
							children: "a41c9e2"
						}),
						createVNode(Cell, {
							k: "run",
							t: "● nix"
						}),
						createVNode(Cell, {
							k: "run",
							t: "1m18"
						})
					]
				})
			})]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The boundary the browser alone forces arrives on schedule, not up front: ",
			createVNode(_components.strong, { children: "read-observer vs mutator" }),
			". ",
			createVNode(_components.code, { children: "rerun" }),
			" is remote code execution, and a hosted page is the first client whose holder is not automatically the operator. The wedge and the live observer ship with mutations simply ",
			createVNode(_components.em, { children: "absent from the wire" }),
			" — the same trick ",
			createVNode(_components.code, { children: "odu mcp" }),
			" used to dodge ",
			createVNode(_components.code, { children: "run.configure" }),
			" — and Phase 4 introduces the mutator role as an explicit grant rather than retrofitting auth onto a surface that already leaked it."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "does-it-replace-vira",
			children: "Does it replace vira?"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"It should — on the timescale where the service face actually exists, and not before. ",
			createVNode(_components.a, {
				href: "https://github.com/juspay/vira",
				children: "vira"
			}),
			" is ",
			createVNode(_components.em, { children: "“no-frills CI for small teams using Nix”" }),
			": a Haskell web app with acid-state persistence, managing registered repos and building them in Nix environments. It works today; nothing here argues for switching anything off this week. The argument is structural, and it is the same one ",
			createVNode(_components.a, {
				href: "./odu.html",
				children: "the odu note"
			}),
			" ran against justci:"
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
					createVNode(_components.th, { children: "vira today" }),
					"\n",
					createVNode(_components.th, { children: "odu-web as planned" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Trigger model" }),
					"\n",
					createVNode(_components.td, { children: "watches registered repos, builds on its own initiative" }),
					"\n",
					createVNode(_components.td, { children: "Phase 3 — webhook first, polling fallback" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Persistence" }),
					"\n",
					createVNode(_components.td, { children: "acid-state database" }),
					"\n",
					createVNode(_components.td, { children: "the run ledger (Phase 1), grown from odu’s per-SHA layout" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Multi-repo" }),
					"\n",
					createVNode(_components.td, { children: "yes — its core shape" }),
					"\n",
					createVNode(_components.td, { children: "Phase 3 — repo as a fan-in axis" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Run granularity" }),
					"\n",
					createVNode(_components.td, { children: "the build, coarse" }),
					"\n",
					createVNode(_components.td, { children: "odu’s per-node DAG: statuses, logs, surgical rerun per node" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Live observation" }),
					"\n",
					createVNode(_components.td, { children: "page-grade" }),
					"\n",
					createVNode(_components.td, { children: "snapshot-then-delta surface; late attach replays everything" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Agent face" }),
					"\n",
					createVNode(_components.td, { children: "none" }),
					"\n",
					createVNode(_components.td, { children: [
						"shipped — ",
						createVNode(_components.code, { children: "odu mcp" }),
						" (",
						createVNode($$PrLink, {
							pr: 3,
							repo: "juspay/odu"
						}),
						")"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Forge gate" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: ["shipped — byte-compatible commit statuses + ", createVNode(_components.code, { children: "protect" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Stack" }),
					"\n",
					createVNode(_components.td, { children: "Haskell · htmx · acid-state" }),
					"\n",
					createVNode(_components.td, { children: [
						"TypeScript · ",
						createVNode(_components.code, { children: "@kolu/surface" }),
						" · surface-app (Solid)"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Two stacks under one author is a losing position — justci already taught that lesson here. vira’s differentiators (triggers, persistence, multi-repo web UI) are things odu-web must build ",
			createVNode(_components.em, { children: "anyway" }),
			"; odu’s differentiators (the typed live surface, per-node DAG, the MCP face) are things vira’s batch-of-builds shape cannot retrofit, for the same reason justci couldn’t. So the honest framing is ",
			createVNode(_components.strong, { children: "sunset-when-superseded" }),
			": vira keeps serving its teams until odu-web’s Phase 3 covers a Nix team’s daily loop, and Phase 4’s exit criterion below names the test rather than the wish."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "phases",
			children: "Phases"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Phase 0 lives in the runner and is already on ",
			createVNode(_components.a, {
				href: "./odu.html",
				children: "odu’s Phase 2 backlog"
			}),
			"; everything after it lives in odu-web, each phase shippable on its own."
		] }),
		"\n",
		createVNode($$Roadmap, { children: [
			createVNode($$Milestone, {
				status: "now",
				label: "Phase 0 · prerequisites in the runner",
				children: [
					"Idle attach + the long-lived runner — a coordinator you can reach with nothing running — plus run identity stable enough for a ledger to reference (repo, SHA, run, node). Both named on the odu roadmap; odu-web is the consumer that makes them load-bearing. This phase has its own work order — ",
					createVNode(_components.strong, { children: createVNode(_components.a, {
						href: "./odu-runner.html",
						children: "odu-runner"
					}) }),
					". ",
					createVNode(_components.strong, { children: "Run identity shipped" }),
					" (",
					createVNode($$PrLink, {
						pr: 28,
						repo: "juspay/odu",
						label: "juspay/odu#28"
					}),
					"): every run now writes a durable ",
					createVNode(_components.code, { children: "(repo, sha, seq)" }),
					" ",
					createVNode(_components.code, { children: "RunRecord" }),
					" to ",
					createVNode(_components.code, { children: ".ci/<sha7>/runs/<seq>.json" }),
					", listable via ",
					createVNode(_components.code, { children: "odu runs" }),
					" — ",
					createVNode(_components.em, { children: "the ledger Phase 1 reads is now real on disk." }),
					" Still ahead: the serve/run split + idle attach (R1, riding the ",
					createVNode(_components.a, {
						href: "./surface-daemon.html",
						children: "surface-daemon"
					}),
					" spine) and the lifecycle (R3)."
				]
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "Phase 1 · the ledger and the run page",
				children: [
					"Formalize the per-SHA on-disk layout into a queryable run ledger that outlives coordinators; serve the read-only per-SHA run page; flip odu’s commit statuses to carry ",
					createVNode(_components.code, { children: "target_url" }),
					". No triggers, no live wire to the browser, no new authz beyond a read gate. ",
					createVNode(_components.strong, { children: "Exit criterion: a red check on a kolu PR links to a page that names the failed node and shows its log." })
				]
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "Phase 2 · the live observer",
				children: [
					"The surface-app PWA (third consumer after kolu and drishti): odu-web attaches to live coordinators and mirrors ",
					createVNode(_components.code, { children: "nodes" }),
					" / ",
					createVNode(_components.code, { children: "nodeLog" }),
					" into the browser over the same ",
					createVNode(_components.code, { children: "useCell" }),
					" / ",
					createVNode(_components.code, { children: "useStream" }),
					" hooks the future OpenTUI face would share — “faces over one surface” becomes shared view code. Read-only: mutations stay off the wire entirely."
				]
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "Phase 3 · triggers and the fleet",
				children: [
					"Forge-event ingestion (webhook first, vira-style polling as fallback), the repo registry, runs spawned per push the way the MCP ",
					createVNode(_components.code, { children: "run" }),
					" tool spawns them today, and the multi-repo fleet dashboard. This is the line where odu crosses from tool to service — and the first phase that overlaps vira’s core."
				]
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "Phase 4 · mutators, and the vira question",
				children: [
					"The read-observer/mutator split as an explicit grant; ",
					createVNode(_components.code, { children: "rerun" }),
					" from the run page for holders of it. Then the sunset test, stated as an exit criterion: ",
					createVNode(_components.strong, { children: "when a Nix team’s daily loop — push, gate, red check, diagnose, rerun, green — runs through odu-web without reaching for vira, retire vira." }),
					" Until it passes, both live."
				]
			})
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "odu-web — the service face of odu",
	"description": "The browser face of odu is not a tab watching one live run — it is the service layer above the runner: a run ledger that outlives coordinators, the page a commit status Details link points at, forge triggers, and a multi-repo fleet dashboard. That territory belongs to juspay/vira today, so this is also the plan for whether odu-web replaces it. Proposed in five phases, with UI prototypes.",
	"parents": [
		"odu",
		"surface-app",
		"feature"
	],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-06-12T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "two-products-hide-in-the-web-app",
			"text": "Two products hide in “the web app”"
		},
		{
			"depth": 2,
			"slug": "the-wedge--be-the-target_url",
			"text": "The wedge — be the target_url"
		},
		{
			"depth": 2,
			"slug": "the-service--a-coordinator-of-coordinators",
			"text": "The service — a coordinator of coordinators"
		},
		{
			"depth": 2,
			"slug": "does-it-replace-vira",
			"text": "Does it replace vira?"
		},
		{
			"depth": 2,
			"slug": "phases",
			"text": "Phases"
		}
	];
}
var url = "src/content/atlas/odu-web.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/odu-web.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/odu-web.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Cell, Chrome, Content, Content as default, S, file, frontmatter, getHeadings, url };
