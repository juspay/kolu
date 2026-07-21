import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
//#region src/content/atlas/surface-hosting-roadblocks.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		blockquote: "blockquote",
		code: "code",
		em: "em",
		h2: "h2",
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
		createVNode(_components.p, { children: [
			"The agent inventoried all three consumers and raised four design questions before writing code. All four are now resolved (srid). The headline: ",
			createVNode(_components.strong, { children: [
				"the reserved ",
				createVNode(_components.code, { children: "system.identity" }),
				" member is bundled into this same PR"
			] }),
			" (its value is a null-free ",
			createVNode(_components.code, { children: "SurfaceIdentity" }),
			" sum — see roadblock 5) — so identity lands on the base ",
			createVNode(_components.code, { children: "Session" }),
			" role directly, no two-step. (This is NOT “universal hello” — that name was borrowed from padi’s ",
			createVNode(_components.em, { children: "daemon" }),
			" control-core ",
			createVNode(_components.code, { children: "hello()" }),
			"; the honest name is ",
			createVNode(_components.code, { children: "system.identity" }),
			", the identity twin of the framework’s existing reserved ",
			createVNode(_components.code, { children: "system.live" }),
			".)"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "1-systemidentity-is-in-this-pr--identity-on-the-base-session-role",
			children: [
				"1. ",
				createVNode(_components.code, { children: "system.identity" }),
				" is IN this PR — identity on the base ",
				createVNode(_components.code, { children: "Session" }),
				" role"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The framework already auto-attaches a reserved ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "system" }), " namespace"] }),
			" to every surface (",
			createVNode(_components.code, { children: "packages/surface/src/liveness.ts" }),
			": ",
			createVNode(_components.code, { children: "defineSurface" }),
			" carries ",
			createVNode(_components.code, { children: "surface.system.live" }),
			", which ",
			createVNode(_components.code, { children: "implementSurface" }),
			" auto-answers; ",
			createVNode(_components.code, { children: "define.ts" }),
			" even anticipates a ",
			createVNode(_components.code, { children: "system.version" }),
			"-style member). We add ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "system.identity" }) }),
			" to that same reserved namespace — the identity twin of ",
			createVNode(_components.code, { children: "system.live" }),
			". Originally scoped out as “a behavior-preserving refactor can’t add a contract member.” srid’s ruling: ",
			createVNode(_components.strong, { children: "bundle it." }),
			" This is a coordinated three-repo PR — every server and consumer moves together — so the cross-deploy-drift danger doesn’t apply, and ",
			createVNode(_components.code, { children: "system.live" }),
			" already proves the exact pattern."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"What it means concretely — one more reserved member in the ",
			createVNode(_components.code, { children: "system" }),
			" namespace, framework-served on ",
			createVNode(_components.strong, { children: "every" }),
			" surface:"
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
							children: "function"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " defineSurface"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "members"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ") {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  return"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " implement"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "..."
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "members, system: { live, identity } }); "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// `identity` is the NEW reserved member; `live` already exists in the same `system` namespace"
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
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// The MEMBER is auto-served on every surface (zero code). The DATA source is supplied by the"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// server that has a reader — see roadblock 5 for the A/B on where the four fields come from."
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"So ",
			createVNode(_components.code, { children: "identity()" }),
			" lives on the base role, and it is ",
			createVNode(_components.strong, { children: "never null-forever" }),
			" — because every server truly answers:"
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
							children: "interface"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Session"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "Client"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "> {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  pin"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Promise"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "Client"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">;"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  currentClient"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Promise"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "Client"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "> "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "|"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " null"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  isDestroyed"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " boolean"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  onState"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "cb"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ")"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " () "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " void"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  markConnected"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " void"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  destroy"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " void"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  reconnect"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " void"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";                      "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// universal to sessions (roadblock 2)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  recheck"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " void"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  identity"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " SurfaceIdentity"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";            "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// universal, TOTAL — a null-free sum; \"no link\" is a kind, not null"
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
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "interface"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " DaemonSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "Client"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "> "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "extends"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Session"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "Client"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "> {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  convergence"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " DaemonConvergence"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " null"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// ONLY supervision is daemon-specific"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  readonly"
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: " preservation"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " PreservationStrategy"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  renew"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Promise"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "void"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">;"
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
		createVNode(_components.p, { children: [
			"The one real cost of bundling, named honestly — ",
			createVNode(_components.strong, { children: "every surface’s contract test changes" }),
			", and here’s why that test exists:"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "What the contract set-equality test is FOR — and why bundling trips all of them",
			children: [
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
									style: { color: "#6F42C1" },
									children: "test"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: "("
								}),
								createVNode(_components.span, {
									style: { color: "#032F62" },
									children: "\"laneSurface members\""
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: ", () "
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
									style: { color: "#6F42C1" },
									children: "  expect"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: "("
								}),
								createVNode(_components.span, {
									style: { color: "#6F42C1" },
									children: "memberNames"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: "(laneSurface))."
								}),
								createVNode(_components.span, {
									style: { color: "#6F42C1" },
									children: "toEqual"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: "("
								}),
								createVNode(_components.span, {
									style: { color: "#D73A49" },
									children: "new"
								}),
								createVNode(_components.span, {
									style: { color: "#6F42C1" },
									children: " Set"
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: "(["
								}),
								createVNode(_components.span, {
									style: { color: "#032F62" },
									children: "\"progress\""
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: ", "
								}),
								createVNode(_components.span, {
									style: { color: "#032F62" },
									children: "\"logLine\""
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: ", "
								}),
								createVNode(_components.span, {
									style: { color: "#032F62" },
									children: "\"result\""
								}),
								createVNode(_components.span, {
									style: { color: "#24292E" },
									children: "]));"
								})
							]
						}),
						"\n",
						createVNode(_components.span, {
							class: "line",
							children: createVNode(_components.span, {
								style: { color: "#24292E" },
								children: "});"
							})
						})
					] })
				}),
				createVNode(_components.p, { children: [
					"A surface is a ",
					createVNode(_components.strong, { children: "contract between two processes" }),
					" (one serves, one consumes, often on different machines). ",
					createVNode(_components.strong, { children: "The set of members IS the contract." }),
					" This test freezes that set so a member can never be added or dropped ",
					createVNode(_components.em, { children: "by accident" }),
					" — any change fails the test and forces a human to ratify it deliberately."
				] }),
				createVNode(_components.p, { children: [
					"Adding ",
					createVNode(_components.code, { children: "system.identity" }),
					" to the reserved ",
					createVNode(_components.code, { children: "system" }),
					" namespace changes every surface’s member set, so ",
					createVNode(_components.strong, { children: "every one of these tests updates to include it." }),
					" That is not a problem to route around — it is the test doing its job: each update is the deliberate, reviewed ratification of the (intended) contract change. Mechanical churn across three repos, all in this PR, all moving together."
				] })
			]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "2-fleet-verbs-go-on-session-srids-call--cleaner",
			children: [
				"2. Fleet verbs go on ",
				createVNode(_components.code, { children: "Session" }),
				" (srid’s call — cleaner)"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"You asked why ",
			createVNode(_components.code, { children: "reconnect()" }),
			"/",
			createVNode(_components.code, { children: "recheck()" }),
			" can’t just be on ",
			createVNode(_components.code, { children: "Session" }),
			". They can, and they should — same reason the role is ",
			createVNode(_components.code, { children: "Session" }),
			" not ",
			createVNode(_components.code, { children: "ReconnectingSession" }),
			": every session reconnects (a one-shot is a ",
			createVNode(_components.em, { children: "dial" }),
			", not a session), so the manual triggers of that universal capability belong on the role. That’s why they’re already in the ",
			createVNode(_components.code, { children: "Session" }),
			" interface above — no ",
			createVNode(_components.code, { children: "Session & { reconnect; recheck }" }),
			" intersection."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Whether a ",
			createVNode(_components.strong, { children: "registry" }),
			" surfaces ",
			createVNode(_components.code, { children: "registry.reconnect(host)" }),
			" is still a per-registry choice (S2) — the session always has the method; the registry exposes a fleet verb only when built with ",
			createVNode(_components.code, { children: "controls" }),
			" (drishti’s fleet does; kolu’s future pool need not):"
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
						style: { color: "#6F42C1" },
						children: "buildHostRegistry"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "({"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  buildEntry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "host"
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
							children: " ({ session: "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "makeSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ connectOnce: "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "sshConnector"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ host }) }), handler }),"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  controls: { "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "reconnect"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "s"
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
							children: " s."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "reconnect"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(), "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "recheck"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "s"
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
							children: " s."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "recheck"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "() }, "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// trivial passthrough now"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "});"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// controls supplied ⇒ registry.reconnect(host)/recheckAll() EXIST (typed). Omitted ⇒ they don't."
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"(",
			createVNode(_components.code, { children: "reServeSurface" }),
			" consumes ",
			createVNode(_components.code, { children: "Session" }),
			" and carries ",
			createVNode(_components.code, { children: "reconnect" }),
			"/",
			createVNode(_components.code, { children: "recheck" }),
			" it never calls — harmless, since they’re ",
			createVNode(_components.em, { children: "guaranteed present" }),
			", not optional-maybe-absent. The registry’s own slot stays minimal ",
			createVNode(_components.code, { children: "DestroyableSession { destroy() }" }),
			".)"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "3-the-name-surfaceidentity-srids-call--the-better-one",
			children: [
				"3. The name: ",
				createVNode(_components.code, { children: "SurfaceIdentity" }),
				" (srid’s call — the better one)"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"You proposed ",
			createVNode(_components.code, { children: "SurfaceIdentity" }),
			"; it’s better than ",
			createVNode(_components.code, { children: "ServerIdentity" }),
			", and ",
			createVNode(_components.code, { children: "system.identity" }),
			" is exactly why: identity is literally a ",
			createVNode(_components.strong, { children: "reserved member of every surface" }),
			", so the value is ",
			createVNode(_components.em, { children: "“the identity a surface carries”" }),
			" — named for the framework’s core noun, and dodging the overloaded word “server” (kolu-",
			createVNode(_components.em, { children: "server" }),
			" means something else)."
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
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// @kolu/surface — a SUM, no nulls (final shape; see roadblock 5)"
					})
				}),
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
							children: " SurfaceIdentity"
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
							children: " \"disconnected\""
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
							children: " \"anonymous\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";  "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "startedAt"
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
							children: " \"identified\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "startedAt"
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
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "baked"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " BakedIdentity"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " };"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "interface"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " BakedIdentity"
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
							style: { color: "#E36209" },
							children: "  contractVersion"
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
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  buildId"
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
							children: ";                                             "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// content hash — convergence CURRENCY (staleKey)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  commit"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
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
							children: " \"commit\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "sha"
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
							children: " } "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "|"
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
							children: " \"dev\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " };  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// navigable vs dev — a SUM, distinct from buildId"
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
		createVNode(_components.p, { children: [
			"Lives in ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/surface" }) }),
			" (the base package — it’s a universal surface member now). The colliding ",
			createVNode(_components.code, { children: "kolu-common ServerIdentity" }),
			" (the PWA identity) is kolu’s to rename; the framework name is perfect, the app moves."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "4-scope--the-framework-happens-in-full-only-kolus-pool-defers",
			children: [
				"4. Scope — the framework happens in full; only kolu’s ",
				createVNode(_components.em, { children: "pool" }),
				" defers"
			]
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "In THIS three-PR refactor" }),
					"\n",
					createVNode(_components.th, { children: "Out (its own later PR)" }),
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
						createVNode(_components.code, { children: "Session" }),
						" (identity · reconnect · recheck) / ",
						createVNode(_components.code, { children: "DaemonSession" }),
						" (convergence · renew · preservation) roles + all renames"
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: [
						"kolu-server GROWING a ",
						createVNode(_components.code, { children: "buildHostRegistry" }),
						" pool"
					] }), " (the W4 switch)"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: createVNode(_components.code, { children: "system.identity" }) }),
						" — the new reserved member (twin of ",
						createVNode(_components.code, { children: "system.live" }),
						"), framework-stamped on every surface; ",
						createVNode(_components.code, { children: "identity()" }),
						" on the base role; every contract test updated"
					] }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "makeSession" }),
						" + ",
						createVNode(_components.code, { children: "sshConnector" }),
						" + ",
						createVNode(_components.code, { children: "endpointConnector" })
					] }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: [
						"S1/S2: ",
						createVNode(_components.code, { children: "buildHostRegistry" }),
						" → ",
						createVNode(_components.code, { children: "DestroyableSession" }),
						" slot + typed ",
						createVNode(_components.code, { children: "controls" })
					] }) }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"S10: delete ",
						createVNode(_components.code, { children: "getHostSession" }),
						" + the global pool + evict/destroyAll"
					] }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Migrate the three existing consumers: kolu single-padi arm · drishti fleet · odu lanes (odu owns its own teardown)" }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "5-systemidentity--where-does-the-data-come-from-needs-your-call",
			children: [
				"5. ",
				createVNode(_components.code, { children: "system.identity" }),
				" — where does the DATA come from? (needs your call)"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "No nulls anywhere" }),
			" (srid — make illegal states unrepresentable; don’t lean on ",
			createVNode(_components.code, { children: "null" }),
			"). Every state of “who is the far end” is a named arm of ONE sum; the reader is forced to branch, and impossible states (identified-but-no-",
			createVNode(_components.code, { children: "startedAt" }),
			" · ",
			createVNode(_components.code, { children: "baked" }),
			"-while-disconnected · a commit that might-be-dev-might-be-error) simply can’t be written:"
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
							children: " BuildCommit"
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
							style: { color: "#D73A49" },
							children: "readonly"
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: " kind"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"commit\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "readonly"
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: " sha"
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
							children: " }   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// a navigable commit — link to it"
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
							style: { color: "#D73A49" },
							children: "readonly"
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: " kind"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"dev\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " };                           "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// built from an uncommitted tree — no navigable commit"
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
							children: "interface"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " BakedIdentity"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " {           "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// the server-DECLARED triple — always whole (matches readBakedIdentity)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  contractVersion"
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
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  buildId"
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
							children: ";"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  commit"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " BuildCommit"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";              "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// a SUM, never `string | null` — dev-vs-real is explicit"
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
							children: " SurfaceIdentity"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "              // ONE sum. NO null. every state named."
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
							children: " \"disconnected\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }                                          "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// no live link — nothing to identify"
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
							children: " \"anonymous\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "startedAt"
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
							children: " }                          "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// connected; server declared no build"
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
							children: " \"identified\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "startedAt"
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
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "baked"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " BakedIdentity"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " };  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// connected; declared its build"
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
						children: "// on the Session role:"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "identity"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(): SurfaceIdentity;        "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// TOTAL — never null; the caller matches on `.kind`"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: "Why this is the honest shape:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"No ",
					createVNode(_components.code, { children: "null" }),
					" doing double duty."
				] }),
				" The hack was ",
				createVNode(_components.code, { children: "identity(): … | null" }),
				" (null = no link) ",
				createVNode(_components.em, { children: "plus" }),
				" ",
				createVNode(_components.code, { children: "baked: … | null" }),
				" (null = no build) — two nulls, two meanings, a reader guessing which. Now each is a named ",
				createVNode(_components.code, { children: "kind" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Impossible states can’t be written." }),
				" ",
				createVNode(_components.code, { children: "startedAt" }),
				" exists only on the connected arms; ",
				createVNode(_components.code, { children: "baked" }),
				" only on ",
				createVNode(_components.code, { children: "identified" }),
				"; ",
				createVNode(_components.code, { children: "commit" }),
				" is never a bare string that might secretly mean “dev”. No contradiction is constructible."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "padi" }),
				" (the sole reader) matches ",
				createVNode(_components.code, { children: "disconnected | identified" }),
				"; ",
				createVNode(_components.code, { children: "anonymous" }),
				" honestly covers drishti/odu"
			] }), " (connected, declared nothing) — no fake, no sentinel."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Load-bearing fact:" }),
			" only kolu-server’s padi arm ever ",
			createVNode(_components.em, { children: "reads" }),
			" ",
			createVNode(_components.code, { children: ".identity()" }),
			". drishti + odu never do. So only ",
			createVNode(_components.strong, { children: "padi" }),
			" declares a ",
			createVNode(_components.code, { children: "baked" }),
			"."
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
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// ── OPTION A (recommended) — implementSurface takes an optional identity; only padi wires it ──"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#6F42C1" },
						children: "implementSurface"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "(surface, deps, { identity?: SurfaceIdentity });"
					})]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// padi — the one server whose identity is read — declares its baked identity:"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#6F42C1" },
						children: "implementSurface"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "(padiSurface, deps, {"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  identity: { contractVersion: "
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "PADI_SURFACE_VERSION"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "..."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "readBakedIdentity"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"PADI\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ") }, "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// → framework serves { kind:\"identified\", startedAt, baked }"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "});"
					})
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// drishti-agent / odu-runner — omit it → the framework serves { kind:\"anonymous\", startedAt }. No sentinel; nobody reads it:"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#6F42C1" },
						children: "implementSurface"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "(laneSurface, deps);"
					})]
				})
			] })
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
			"data-language": "ts",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// ── OPTION B — truly zero-code, but a 3-repo-wide ripple for ZERO readers today ──"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "defineSurface"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(members, { contractVersion });   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// every defineSurface call changes"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// + every server's nix wrapper bakes framework-standard SURFACE_BUILD_ID / SURFACE_COMMIT"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// + padi's existing PADI_* must ALSO bake the standard names"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Why A:" }),
			" identity stays a ",
			createVNode(_components.em, { children: "universal capability" }),
			" (member on every surface, ",
			createVNode(_components.code, { children: "identity()" }),
			" on base role) while the ",
			createVNode(_components.em, { children: "source" }),
			" is wired only where read (padi). B builds baked-var machinery for identity on drishti/odu that ",
			createVNode(_components.strong, { children: "has no reader" }),
			" — a receptacle for population zero. A doesn’t foreclose B later."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Two consequences to reconcile:" }),
			" (1) the L3 convergence kit’s ",
			createVNode(_components.code, { children: "buildId === \"\"" }),
			" “off-nix” check becomes ",
			createVNode(_components.code, { children: "baked === null" }),
			" — the same sentinel-removal one layer down. (2) the dialog’s build-commit line branches on the ",
			createVNode(_components.code, { children: "BuildCommit" }),
			" sum — ",
			createVNode(_components.code, { children: "kind:\"commit\"" }),
			" → a navigable link, ",
			createVNode(_components.code, { children: "kind:\"dev\"" }),
			" → a “dev build” badge (no more null-means-maybe-dev-maybe-error)."
		] }),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [createVNode(_components.strong, { children: [
				"A (with the ",
				createVNode(_components.code, { children: "Maybe" }),
				"-typed identity above)?"
			] }), " — needs your call. Agent is building everything else meanwhile."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "6-the-convergence-kits-buildid----ruled-fix-it-here-srid",
			children: [
				"6. The convergence kit’s ",
				createVNode(_components.code, { children: "buildId === \"\"" }),
				" — RULED: fix it here (srid)"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Surfaced mid-build. There are ",
			createVNode(_components.strong, { children: "two separate “what build is padi?” paths, on two different wires" }),
			" — and only one is in this PR’s scope:"
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
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// PATH 1 — the READOUT (this PR fully converts it to the null-free sum):"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "session."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "identity"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "()   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// → { kind:\"identified\", startedAt, baked:{ …, commit: BuildCommit } }"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "//   the dialogs read this; commit branches: {kind:\"commit\"} → link · {kind:\"dev\"} → badge.  ✅ done here."
					})
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// PATH 2 — the CONVERGENCE decision (a DIFFERENT wire: control-core hello, not system.identity):"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// packages/surface-daemon-supervisor/.../decide.ts"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "if"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " (baked.buildId "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "==="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"\""
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
							style: { color: "#032F62" },
							children: " \"adopt\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// \"\" = off-nix, can't judge builds — the OLD sentinel"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "//   reads ConvergenceIdentity {contractVersion, buildId} off control.core.hello()."
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "//   NOT touched by the readout refactor. This is the exact hack L26 targets."
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: "Two options:" }),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "srid RULED (a) — the sentinel dies in THIS PR (2026-07-05)." }),
				" ",
				createVNode(_components.em, { children: "Why it was still there:" }),
				" the null-free ",
				createVNode(_components.code, { children: "SurfaceIdentity" }),
				" sum lives on the ",
				createVNode(_components.code, { children: "system.identity" }),
				" wire (what the dialogs read); the convergence decision reads padi’s build off a DIFFERENT wire (",
				createVNode(_components.code, { children: "control.core.hello" }),
				" → ",
				createVNode(_components.code, { children: "ConvergenceIdentity" }),
				"), which the readout refactor never reached — so the ",
				createVNode(_components.code, { children: "buildId === \"\"" }),
				" sentinel sat untouched. srid’s point: shipping the clean design while the SAME-data sentinel survives one wire over is the exact “two ways to say the same thing” incoherence the refactor exists to kill. ",
				createVNode(_components.strong, { children: "It must not survive the PR that establishes the rule." })
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The fix (a):" }),
			" make the convergence identity null-free too — off-nix becomes a ",
			createVNode(_components.em, { children: "typed" }),
			" absence (a ",
			createVNode(_components.code, { children: "kind" }),
			"/null), never ",
			createVNode(_components.code, { children: "\"\"" }),
			"; ",
			createVNode(_components.code, { children: "decide.ts" }),
			" matches that instead of ",
			createVNode(_components.code, { children: "=== \"\"" }),
			". Behavior-preserving shape swap (the agent confirmed), touching surface-daemon-supervisor + control-core hello + ",
			createVNode(_components.code, { children: "probePadiForConvergence" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "One thing for the agent to report, not decide:" }),
			" the deeper coherence win is convergence consuming the SAME identity representation as the readout (one identity, not two) — but convergence may ",
			createVNode(_components.em, { children: "need" }),
			" its own ",
			createVNode(_components.code, { children: "control.core.hello" }),
			" wire (pre-handshake, version-agnostic — it runs before the surface is established). So: kill the sentinel now (make ",
			createVNode(_components.code, { children: "ConvergenceIdentity" }),
			" null-free on its existing wire); and tell the coordinator whether unifying the two identity paths is safe or whether the control-core wire is load-bearing for pre-handshake convergence. If unification would force a behavior change, STOP — that’s a separate decision."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "L26 no longer owns this instance" }),
			" (this PR does); L26 keeps the ",
			createVNode(_components.em, { children: "other" }),
			", scattered null/sentinel instances + the lint."
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: "(Q1 identity-sourcing and Q2 endpointConnector-is-a-kolu-leaf were pure confirmations of the ratified design — resolved, not open.)" }) }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Unification question RESOLVED (agent report, 2026-07-05): the two identity wires do NOT unify — the control-core wire is load-bearing." }),
			" Convergence must read a running daemon’s identity ",
			createVNode(_components.em, { children: "pre-handshake and across a contract skew" }),
			" (",
			createVNode(_components.code, { children: "controlCore.ts" }),
			": “the version-agnostic side channel — a binder dials the running daemon and reads its identity at ANY skew”); deciding whether to drain a skewed daemon is the whole point. ",
			createVNode(_components.code, { children: "system.identity" }),
			" lives on the ",
			createVNode(_components.em, { children: "surface" }),
			", which needs a compatible handshake — unreachable exactly during a skew. So they’re not the “two ways to say the same thing” smell — they’re a ",
			createVNode(_components.strong, { children: "justified volatility separation" }),
			" (a version-agnostic side channel vs a surface readout). The fix kills the ",
			createVNode(_components.code, { children: "\"\"" }),
			" sentinel on ",
			createVNode(_components.strong, { children: "both" }),
			" wires ",
			createVNode(_components.em, { children: "independently" }),
			": the readout gets ",
			createVNode(_components.code, { children: "SurfaceIdentity" }),
			"; the convergence wire gets its own null-free ",
			createVNode(_components.code, { children: "DaemonBuild = { kind:\"known\"; id } | { kind:\"off-nix\" }" }),
			" (",
			createVNode(_components.code, { children: "decide.ts" }),
			" matches ",
			createVNode(_components.code, { children: ".kind === \"off-nix\"" }),
			", not ",
			createVNode(_components.code, { children: "=== \"\"" }),
			"), right-sized for what convergence needs (it judges builds by id; it doesn’t display commits). ",
			createVNode(_components.strong, { children: "Do not merge the wires" }),
			" — that would break skew-convergence; a future deeper unification would require the control core itself to carry a version-agnostic identity (a bigger, separate cut)."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "7-the-two-arms-dont-share-padiadmit--they-share-the-decision-build-time-ruled-a",
			children: [
				"7. The two arms don’t share ",
				createVNode(_components.code, { children: "padiAdmit" }),
				" — they share the DECISION (build-time; RULED (a))"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"S9’s prose said “both arms share ",
			createVNode(_components.code, { children: "padiAdmit" }),
			"”. Building it revealed that quietly assumed both transports converge POST-connect — but they don’t, and the difference is real, rooted in the transports:"
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
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// REMOTE (ssh): hands you a RAW client → converge AFTER connect. `admit` IS that seam:"
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
							style: { color: "#005CC5" },
							children: " remotePadi"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " makeSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ connectOnce: "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "sshConnector"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ binary: "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"padi\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }), admit: padiAdmit });"
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
						children: "// LOCAL (supervisor Endpoint): converges AS it connects, BY DESIGN —"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "//   endpoint.adoptOrSpawnOrRefuse() = probe → decide → drain-enact → THEN connect."
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "//   There is no \"raw adopt-or-spawn without the check\" method. So NO post-connect admit:"
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
							style: { color: "#005CC5" },
							children: " localPadi"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " makeSession"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ connectOnce: "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "endpointConnector"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(endpoint) });  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// admit omitted — self-converged"
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
						children: "// The REAL dedup both arms share (this is what S9 was actually after):"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "//   • ONE PADI_CONVERGENCE_POLICY / decide()      • drainViaControlCore"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "//   • the daemon-member spread { ...base, convergence, renew, preservation }"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Ruling: (a)." }),
			" Local convergence stays pre-connect inside ",
			createVNode(_components.code, { children: "endpointConnector" }),
			" (the ",
			createVNode(_components.code, { children: "Endpoint" }),
			" is UNCHANGED — honors Q3’s “don’t touch surface-daemon-supervisor”); the remote arm carries ",
			createVNode(_components.code, { children: "admit: padiAdmit" }),
			". This is not a divergence from S9 — it’s the correct use of S9’s ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "admit?" }), " optional"] }),
			": the local connector already converges, so it has no post-connect hook to pass. It preserves both arms’ exact convergence timing, still deletes ",
			createVNode(_components.code, { children: "BoundPadi" }),
			" + the wrapper classes, and still collapses to closures + spread + one policy + one drain — S9’s whole intent."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Rejected ",
			createVNode(_components.strong, { children: "(b)" }),
			" (rip out the ",
			createVNode(_components.code, { children: "Endpoint" }),
			", force a shared post-connect admit): it deletes a working mechanism to rebuild local adopt-or-spawn from scratch, risks a local-convergence timing change (briefly connecting to an about-to-be-drained padi), and brushes the Q3 boundary — a bigger, riskier change for a ",
			createVNode(_components.em, { children: "literal" }),
			" symmetry the transports don’t support."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "status-of-the-four--all-resolved",
			children: "Status of the four — all resolved"
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "system.identity" }), " BUNDLED"] }),
				" — the new reserved ",
				createVNode(_components.code, { children: "system" }),
				"-namespace member (twin of ",
				createVNode(_components.code, { children: "system.live" }),
				"); ",
				createVNode(_components.code, { children: "identity()" }),
				" on the base ",
				createVNode(_components.code, { children: "Session" }),
				" role; no separate follow-up. ✅ srid’s call. (Name: ",
				createVNode(_components.code, { children: "system.identity" }),
				", NOT “universal hello”.)"
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "reconnect" }),
				"/",
				createVNode(_components.code, { children: "recheck" }),
				" on ",
				createVNode(_components.code, { children: "Session" })
			] }), " — ✅ srid’s call."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "SurfaceIdentity" }),
				" in ",
				createVNode(_components.code, { children: "@kolu/surface" })
			] }), " (rename kolu’s collider) — ✅ srid’s call."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Scope" }),
				": full framework reshape in (incl. ",
				createVNode(_components.code, { children: "system.identity" }),
				" + ",
				createVNode(_components.code, { children: "buildHostRegistry" }),
				" S1/S2); only kolu-server’s ",
				createVNode(_components.em, { children: "pool adoption" }),
				" (W4) out. ✅ confirmed."
			] }),
			"\n"
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Surface hosting — the four build-time roadblocks, in code",
	"description": "The implementing agent inventoried all three consumers (kolu · drishti · odu) and hit four design questions before writing code. Each answered here in code, refined with srid; the ratified answers fold into the plan.",
	"parents": [
		"reference",
		"padi",
		"surface"
	],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-05T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "1-systemidentity-is-in-this-pr--identity-on-the-base-session-role",
			"text": "1. system.identity is IN this PR — identity on the base Session role"
		},
		{
			"depth": 2,
			"slug": "2-fleet-verbs-go-on-session-srids-call--cleaner",
			"text": "2. Fleet verbs go on Session (srid’s call — cleaner)"
		},
		{
			"depth": 2,
			"slug": "3-the-name-surfaceidentity-srids-call--the-better-one",
			"text": "3. The name: SurfaceIdentity (srid’s call — the better one)"
		},
		{
			"depth": 2,
			"slug": "4-scope--the-framework-happens-in-full-only-kolus-pool-defers",
			"text": "4. Scope — the framework happens in full; only kolu’s pool defers"
		},
		{
			"depth": 2,
			"slug": "5-systemidentity--where-does-the-data-come-from-needs-your-call",
			"text": "5. system.identity — where does the DATA come from? (needs your call)"
		},
		{
			"depth": 2,
			"slug": "6-the-convergence-kits-buildid----ruled-fix-it-here-srid",
			"text": "6. The convergence kit’s buildId === \"\" — RULED: fix it here (srid)"
		},
		{
			"depth": 2,
			"slug": "7-the-two-arms-dont-share-padiadmit--they-share-the-decision-build-time-ruled-a",
			"text": "7. The two arms don’t share padiAdmit — they share the DECISION (build-time; RULED (a))"
		},
		{
			"depth": 2,
			"slug": "status-of-the-four--all-resolved",
			"text": "Status of the four — all resolved"
		}
	];
}
var url = "src/content/atlas/surface-hosting-roadblocks.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-hosting-roadblocks.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-hosting-roadblocks.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
