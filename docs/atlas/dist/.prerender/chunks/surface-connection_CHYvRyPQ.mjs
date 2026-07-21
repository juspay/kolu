import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$D2 } from "./D2_CPv-UX0x.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import "./Cite_IypTixBQ.mjs";
//#region src/content/atlas/surface-connection.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		hr: "hr",
		li: "li",
		p: "p",
		pre: "pre",
		span: "span",
		strong: "strong",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"The stale-tab handshake (",
			createVNode($$PrLink, { pr: 1231 }),
			") upstreamed the ",
			createVNode(_components.em, { children: "gate" }),
			" into ",
			createVNode(_components.a, {
				href: "./surface-app.html",
				children: "@kolu/surface-app"
			}),
			" — the ",
			createVNode(_components.code, { children: "pid" }),
			" param, the ",
			createVNode(_components.code, { children: "4001" }),
			" close code, ",
			createVNode(_components.code, { children: "rejectStaleProcess" }),
			", ",
			createVNode(_components.code, { children: "retireSocket" }),
			", the lifecycle. But it left the ",
			createVNode(_components.strong, { children: "connection assembly itself" }),
			" — the ",
			createVNode(_components.code, { children: "pid" }),
			"-echo plumbing, the ",
			createVNode(_components.code, { children: "new PartySocket(...)" }),
			" construction, and the server-side upgrade gate — ",
			createVNode(_components.strong, { children: "hand-rolled in each consumer" }),
			", byte-for-byte identical between kolu and ",
			createVNode(_components.a, {
				href: "https://github.com/srid/drishti",
				children: "drishti"
			}),
			". This change lifts that last duplicated layer into ",
			createVNode(_components.strong, { children: "three composable primitives" }),
			", so a consumer brings only its URL, its socket topology, and its lifecycle ownership — never the plumbing."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Status: ",
			createVNode($$Pill, {
				variant: "done",
				children: "implemented"
			}),
			" · kolu ",
			createVNode($$PrLink, { pr: 1234 }),
			" · paired drishti PR · follow-up to ",
			createVNode($$PrLink, { pr: 1231 }),
			"."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			children: createVNode(_components.p, { children: [
				"Each upstreaming round of this saga found the same thing: a slice both consumers hand-roll. ",
				createVNode($$PrLink, { pr: 1201 }),
				" lifted surface ",
				createVNode(_components.em, { children: "composition" }),
				"; ",
				createVNode($$PrLink, { pr: 1154 }),
				" lifted the ",
				createVNode(_components.em, { children: "app shell" }),
				"; ",
				createVNode($$PrLink, { pr: 1231 }),
				" lifted the ",
				createVNode(_components.em, { children: "handshake gate" }),
				". What was left is the ",
				createVNode(_components.strong, { children: "connection plumbing" }),
				" — the ",
				createVNode(_components.code, { children: "pid" }),
				"-echo, the partysocket construction, and the server upgrade gate. It is the last hand-rolled seam, and it failed the same “both apps re-type it” test."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "danger",
			title: "The boundary moved — smaller — once grounded in real source",
			children: [
				createVNode(_components.p, { children: [
					"The first cut of this plan proposed a god-factory (",
					createVNode(_components.code, { children: "createSurfaceConnection" }),
					") bundling socket + clients + lifecycle, plus a server ",
					createVNode(_components.code, { children: "serveSurfaceWebSocket(adapter)" }),
					" with ",
					createVNode(_components.strong, { children: "node and bun adapters" }),
					". Reading drishti’s ",
					createVNode(_components.em, { children: "actual" }),
					" post-#1231 source — not assuming it — broke all three premises:"
				] }),
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "There is no node-vs-bun axis." }),
						" drishti’s server uses the ",
						createVNode(_components.em, { children: "same" }),
						" ",
						createVNode(_components.code, { children: "ws" }),
						" ",
						createVNode(_components.code, { children: "WebSocketServer" }),
						" + ",
						createVNode(_components.code, { children: "@hono/node-server" }),
						" + ",
						createVNode(_components.code, { children: "@orpc/server/ws" }),
						" stack as kolu (it merely ",
						createVNode(_components.em, { children: "runs" }),
						" under Bun). One stack, no adapter."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "The two consumers own the lifecycle in different places" }),
						" — kolu derives it in ",
						createVNode(_components.code, { children: "rpc.ts" }),
						"; drishti via ",
						createVNode(_components.code, { children: "<SurfaceAppProvider>" }),
						". A factory that bundles the lifecycle fits neither."
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "drishti runs MANY sockets sharing ONE echo" }),
						" — per-host sockets + one admin socket, all echoing the admin socket’s observed ",
						createVNode(_components.code, { children: "processId" }),
						". A per-connection factory can’t own a cross-connection echo."
					] }),
					"\n"
				] }),
				createVNode(_components.p, { children: [
					"So the real shared duplication is ",
					createVNode(_components.em, { children: "narrower" }),
					" than the god-factory: it’s the ",
					createVNode(_components.strong, { children: "echo" }),
					", the ",
					createVNode(_components.strong, { children: "socket construction" }),
					", and the ",
					createVNode(_components.strong, { children: "server gate" }),
					" — three small things, not one big one. Same lesson as ",
					createVNode($$PrLink, { pr: 1231 }),
					", where verified drishti facts overturned the first lens verdict: ",
					createVNode(_components.strong, { children: "decompose on what’s actually duplicated, not on what looks tidy." })
				] })
			]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-duplication-both-consumers-hand-rolled",
			children: "The duplication both consumers hand-rolled"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Client" }),
			" — kolu’s ",
			createVNode(_components.code, { children: "wire.ts" }),
			", and drishti’s ",
			createVNode(_components.code, { children: "makeSocket" }),
			" (called once per host + once for the admin socket):"
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
						children: "// the pid-echo mutable + URL threading — hand-rolled in BOTH wire.ts files"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "let"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " lastServerProcessId"
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
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " null"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
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
							style: { color: "#D73A49" },
							children: "export"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " function"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " rememberServerProcessId"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "id"
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
							children: ") { lastServerProcessId "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " id; }"
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
							style: { color: "#005CC5" },
							children: " ws"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " new"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " PartySocket"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(() "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  lastServerProcessId "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "?"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " `${"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "base"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "}?${"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "SERVER_PROCESS_ID_PARAM"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "}=${"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "lastServerProcessId"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "}`"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " :"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " base);"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// …and, for a socket no lifecycle watches (drishti's per-host), the self-retire:"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "ws."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "addEventListener"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"close\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "e"
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
							children: " (e.code "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "==="
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " STALE_PROCESS_CLOSE_CODE"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ") "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "retireSocket"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(ws);"
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
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Server" }),
			" — kolu’s single ",
			createVNode(_components.code, { children: "/rpc/ws" }),
			" connection handler, and drishti’s host-dispatching ",
			createVNode(_components.code, { children: "httpServer.on(\"upgrade\")" }),
			" — ",
			createVNode(_components.em, { children: [
				"both on the same ",
				createVNode(_components.code, { children: "ws" }),
				" stack"
			] }),
			", differing only in dispatch:"
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
							style: { color: "#24292E" },
							children: "ws."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "on"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"error\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", …);                                    "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// FIRST — or a post-close peer error crashes"
						})
					]
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
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "rejectStaleProcess"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(url.searchParams."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "get"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "SERVER_PROCESS_ID_PARAM"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "), liveProcessId)) {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  ws."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "close"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "STALE_PROCESS_CLOSE_CODE"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"stale server process\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "); "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "return"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// gate BEFORE upgrade"
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
			"The error-handler-before-gate ordering is the footgun the gauntlet caught on ",
			createVNode($$PrLink, { pr: 1231 }),
			" — and drishti’s hand-rolled upgrade handler ",
			createVNode(_components.strong, { children: "didn’t have it" }),
			", installing its ",
			createVNode(_components.code, { children: "error" }),
			" listeners ",
			createVNode(_components.em, { children: "after" }),
			" the gate’s early return. A latent crash, exactly the kind a shared owner removes for good."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-three-primitives",
			children: "The three primitives"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The seam splits cleanly into three independently-owned concerns. Two are framework-free client transport (",
			createVNode(_components.code, { children: "@kolu/surface-app/connect" }),
			"); one is the server gate (",
			createVNode(_components.code, { children: "@kolu/surface-app/server" }),
			"). None bundles the lifecycle or the clients — those stay with the consumer, because ",
			createVNode(_components.em, { children: "that" }),
			" is where the two genuinely differ."
		] }),
		"\n",
		createVNode($$D2, {
			caption: "Three primitives, each one concern. The echo and socket are client transport; the gate is server. The lifecycle (createServerLifecycle / SurfaceAppProvider) and the clients (surfaceClients) stay with the consumer — kolu and drishti own those differently, so they don't graduate.",
			code: `direction: down
consumer: "consumer (kolu · drishti)" {
cfg: "URL(s) · socket topology · lifecycle ownership · clients assembly"
}
connect: "@kolu/surface-app/connect (framework-free)" {
echo: "createProcessIdEcho() — the shared pid echo (one per app; drishti shares it across N sockets)"
sock: "createSurfaceSocket() — new PartySocket(echo'd URL thunk) + optional self-retire"
}
server: "@kolu/surface-app/server" {
gate: "gateStaleSocket(ws, url, liveProcessId) — error-handler-first · rejectStaleProcess · close(4001)"
}
stays: "stays with the consumer (differs per app)" {
lc: "lifecycle — kolu: rpc.ts · drishti: SurfaceAppProvider"
cl: "clients — surfaceClients(link, surfaces)"
}
consumer.cfg -> connect: "url + topology"
consumer.cfg -> server: "live processId"
consumer.cfg -> stays: "owns directly"
connect.echo -> connect.sock: "appended on every reconnect"
connect.echo -> stays.lc: "lifecycle.onProcessId → echo.remember"
`
		}),
		"\n",
		createVNode(_components.h3, {
			id: "createprocessidecho--createsurfacesocket-kolusurface-appconnect",
			children: [
				createVNode(_components.code, { children: "createProcessIdEcho" }),
				" + ",
				createVNode(_components.code, { children: "createSurfaceSocket" }),
				" ",
				createVNode($$Pill, {
					variant: "hi",
					children: "@kolu/surface-app/connect"
				})
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The echo owns the ",
			createVNode(_components.code, { children: "pid" }),
			" threading; the socket owns the ",
			createVNode(_components.code, { children: "new PartySocket(...)" }),
			" with that echo’d URL plus the optional stale-close self-retire. kolu builds one socket (private echo); drishti builds many sharing one echo."
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
						children: "// kolu — one socket, private echo"
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
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "ws"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "echo"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " } "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " createSurfaceSocket"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ url: wsBaseUrl });"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "export"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " rememberServerProcessId"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " echo.remember;   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// fed to rpc.ts's lifecycle"
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
						children: "// drishti — ONE shared echo across per-host + admin sockets"
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
							children: " echo"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " createProcessIdEcho"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "();"
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
							children: " makeSocket"
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
							children: "host"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "retire"
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
							style: { color: "#6F42C1" },
							children: " createSurfaceSocket"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  url"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": () "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " `…/rpc/ws?host=${"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "host"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "}`"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ",   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// echo appends &pid= on top"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  echo,                                  "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// shared — fed by the admin socket's lifecycle"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  socketOptions: { connectionTimeout: "
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "60_000"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " },"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  retireOnStaleClose: retire,            "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// per-host sockets self-retire (no provider watches them)"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "}).ws;"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The echo’s ",
			createVNode(_components.code, { children: "appendTo" }),
			" respects an existing query string (drishti’s ",
			createVNode(_components.code, { children: "?host=" }),
			" → ",
			createVNode(_components.code, { children: "&pid=" }),
			"), so both URL shapes work. The ",
			createVNode(_components.code, { children: "pid" }),
			" mutable, the URL threading, and the self-retire listener are now the library’s — the three lines each consumer used to own."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "gatestalesocket-kolusurface-appserver",
			children: [
				createVNode(_components.code, { children: "gateStaleSocket" }),
				" ",
				createVNode($$Pill, {
					variant: "new",
					children: "@kolu/surface-app/server"
				})
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The server gate, in the ",
			createVNode(_components.em, { children: "one" }),
			" correct order — error-handler-first baked in so no consumer can re-introduce the crash. It works for both topologies because it’s just the gate, not the dispatch."
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
						children: "// kolu — single handler"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#D73A49" },
						children: "if"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: " ("
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#6F42C1" },
						children: "  gateStaleSocket"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "(ws, url, serverProcessId, {"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "    onError"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "e"
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
							children: " connLog."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "error"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ err: e }),"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "    onReject"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "pid"
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
							children: " connLog."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "info"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ pid }),"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  })"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: ")"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#D73A49" },
						children: "  return"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: ";"
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
						children: "// drishti — first line of the host-dispatched upgrade"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#D73A49" },
						children: "if"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: " ("
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#6F42C1" },
						children: "  gateStaleSocket"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "(ws, url, admin.processId, {"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "    onReject"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": () "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " log"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"rejecting stale ws\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "),"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  })"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: ")"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#D73A49" },
						children: "  return"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: ";"
					})]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "liveProcessId" }),
			" is ",
			createVNode(_components.code, { children: "surfaceAppServer().processId" }),
			" — the same id the ",
			createVNode(_components.code, { children: "identity.info" }),
			" probe reports, so the gate and the probe single-source. drishti ",
			createVNode(_components.em, { children: "gains" }),
			" the error-ordering fix it never had."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-stays-per-consumer",
			children: "What stays per-consumer"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The parts that genuinely differ — which is exactly why they ",
			createVNode(_components.em, { children: "don’t" }),
			" graduate:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Lifecycle ownership" }),
				" — kolu derives ",
				createVNode(_components.code, { children: "createServerLifecycle" }),
				" in ",
				createVNode(_components.code, { children: "rpc.ts" }),
				"; drishti delegates to ",
				createVNode(_components.code, { children: "<SurfaceAppProvider>" }),
				"’s turnkey ",
				createVNode(_components.code, { children: "{ ws, probe }" }),
				" source. The echo’s ",
				createVNode(_components.code, { children: "remember" }),
				" plugs into either via ",
				createVNode(_components.code, { children: "onProcessId" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Socket topology" }), " — kolu: one socket. drishti: per-host sockets (self-retiring) + one admin socket (provider-retired), all sharing the one echo."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The clients assembly" }),
				" — ",
				createVNode(_components.code, { children: "surfaceClients(websocketLink(ws), surfaces)" }),
				" is already a one-liner from ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				"; it stays at the consumer."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The overlay chrome" }),
				" — surface-app provides the ",
				createVNode(_components.em, { children: "model" }),
				" (",
				createVNode(_components.code, { children: "useSurfaceApp().updateReady()" }),
				" / ",
				createVNode(_components.code, { children: "reload()" }),
				"); each app renders its own card."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-lens-question--committing-to-partysocket",
			children: "The lens question — committing to partysocket"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"This makes ",
			createVNode(_components.code, { children: "@kolu/surface-app" }),
			" ",
			createVNode(_components.strong, { children: "explicitly" }),
			" partysocket+oRPC: ",
			createVNode(_components.code, { children: "createSurfaceSocket" }),
			" is the one ",
			createVNode(_components.code, { children: "new PartySocket(...)" }),
			" in the package, and partysocket is now a declared dependency."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Consistent, not a reversal",
			children: createVNode(_components.p, { children: [
				"The fact-grounded lowy ⇄ hickey debate on ",
				createVNode($$PrLink, { pr: 1231 }),
				" already conceded the point: ",
				createVNode(_components.code, { children: "retireSocket" }),
				"’s body is partysocket+oRPC-specific, and that is ",
				createVNode(_components.em, { children: "fine because the package is scoped to that stack, proven by two consumers" }),
				". The commitment was already ",
				createVNode(_components.strong, { children: "de-facto true" }),
				" — surface-app shipped ",
				createVNode(_components.code, { children: "retireSocket" }),
				", which only works on a partysocket. The new primitives just make it honest. The escape hatch stays: a future non-partysocket consumer drops to ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				"’s ",
				createVNode(_components.code, { children: "websocketLink" }),
				" + surface-app’s ",
				createVNode(_components.code, { children: "createServerLifecycle" }),
				" and hand-builds, exactly as both apps did before. ",
				createVNode(_components.em, { children: "Extract the turnkey; keep the parts." })
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "status",
			children: "Status"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"One phase, shipped as a kolu PR + a paired drishti PR — the ③ proof every step, mirroring ",
			createVNode($$PrLink, { pr: 1201 }),
			" and ",
			createVNode($$PrLink, { pr: 1231 }),
			"."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "kolu" }),
				" ",
				createVNode($$PrLink, { pr: 1234 }),
				" — adds ",
				createVNode(_components.code, { children: "@kolu/surface-app/connect" }),
				" (",
				createVNode(_components.code, { children: "createProcessIdEcho" }),
				", ",
				createVNode(_components.code, { children: "createSurfaceSocket" }),
				", ",
				createVNode(_components.code, { children: "retireOnStaleClose" }),
				") + ",
				createVNode(_components.code, { children: "gateStaleSocket" }),
				" in ",
				createVNode(_components.code, { children: "/server" }),
				"; rewires ",
				createVNode(_components.code, { children: "wire.ts" }),
				" and the server gate; unit-tests the echo, the self-retire, and the gate. ",
				createVNode($$Pill, {
					variant: "done",
					children: "implemented"
				})
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "drishti" }),
				" — adopts all three: one shared echo across its per-host + admin sockets, the per-host self-retire via ",
				createVNode(_components.code, { children: "retireOnStaleClose" }),
				", and ",
				createVNode(_components.code, { children: "gateStaleSocket" }),
				" in its upgrade handler (gaining the error-ordering fix). ",
				createVNode($$Pill, {
					variant: "done",
					children: "implemented"
				})
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "The one-line answer",
			children: createVNode(_components.p, { children: [
				"surface-app already owns the handshake; now it owns the ",
				createVNode(_components.em, { children: "handshake’s plumbing" }),
				" too. Lift the three lines both apps re-typed — the ",
				createVNode(_components.code, { children: "pid" }),
				" echo, the socket, the gate — so a consumer brings only its URL, its topology, and its lifecycle, and inherits the reconnect, the echo, and the crash-proof gate for free."
			] })
		}),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: [
			"Origin: follow-up to ",
			createVNode($$PrLink, { pr: 1231 }),
			". Model: ",
			createVNode(_components.a, {
				href: "./surface-app.html",
				children: "@kolu/surface-app"
			}),
			" · ",
			createVNode(_components.a, {
				href: "./electricity.html",
				children: "electricity"
			}),
			". ③ proof: ",
			createVNode(_components.a, {
				href: "https://github.com/srid/drishti",
				children: "srid/drishti"
			}),
			"."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "surface-connection — the WebSocket connection, owned upstream",
	"description": "Lift the partysocket + oRPC connection assembly both kolu and drishti hand-rolled — the pid-echo, the socket construction, and the server upgrade gate — into three composable @kolu/surface-app primitives, leaving each app only its URL, socket topology, and lifecycle ownership.",
	"parents": [
		"surface-app",
		"feature",
		"surface"
	],
	"status": "implemented",
	"maturity": "budding",
	"updated": "2026-06-08T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-duplication-both-consumers-hand-rolled",
			"text": "The duplication both consumers hand-rolled"
		},
		{
			"depth": 2,
			"slug": "the-three-primitives",
			"text": "The three primitives"
		},
		{
			"depth": 3,
			"slug": "createprocessidecho--createsurfacesocket-kolusurface-appconnect",
			"text": "createProcessIdEcho + createSurfaceSocket @kolu/surface-app/connect"
		},
		{
			"depth": 3,
			"slug": "gatestalesocket-kolusurface-appserver",
			"text": "gateStaleSocket @kolu/surface-app/server"
		},
		{
			"depth": 2,
			"slug": "what-stays-per-consumer",
			"text": "What stays per-consumer"
		},
		{
			"depth": 2,
			"slug": "the-lens-question--committing-to-partysocket",
			"text": "The lens question — committing to partysocket"
		},
		{
			"depth": 2,
			"slug": "status",
			"text": "Status"
		}
	];
}
var url = "src/content/atlas/surface-connection.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-connection.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-connection.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
