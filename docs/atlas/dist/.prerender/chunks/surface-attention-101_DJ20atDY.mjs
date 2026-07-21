import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
import "./Footnote_D9yrIxmz.mjs";
//#region src/diagrams/surface-attention-101-pieces.svg?raw
var surface_attention_101_pieces_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 980 500\" font-family=\"system-ui, sans-serif\">\n  <rect width=\"980\" height=\"500\" fill=\"#0f1117\"/>\n  <defs>\n    <marker id=\"arr\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#8b95a7\"/>\n    </marker>\n    <marker id=\"arrGreen\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#2dd4a7\"/>\n    </marker>\n    <marker id=\"arrAmber\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#e8b44c\"/>\n    </marker>\n  </defs>\n\n  <!-- ══ PHASE 1 band ══ -->\n  <text x=\"30\" y=\"32\" fill=\"#8b95a7\" font-size=\"13\" font-weight=\"600\">PHASE 1 — THE SURFACE REFACTOR PR (paired kolu · drishti · odu adoptions)</text>\n  <rect x=\"30\" y=\"44\" width=\"920\" height=\"112\" rx=\"10\" fill=\"#141925\" stroke=\"#3d4a63\" stroke-width=\"1.5\"/>\n\n  <rect x=\"46\" y=\"60\" width=\"288\" height=\"80\" rx=\"6\" fill=\"#1a2130\" stroke=\"#5b8def\"/>\n  <text x=\"190\" y=\"82\" fill=\"#9db4e8\" font-size=\"11.5\" font-weight=\"600\" text-anchor=\"middle\">@kolu/surface — the Dynamic, completed</text>\n  <text x=\"190\" y=\"101\" fill=\"#e6eaf2\" font-size=\"10.5\" text-anchor=\"middle\">updated(({prev, next}) =&gt; void)</text>\n  <text x=\"190\" y=\"118\" fill=\"#8b95a7\" font-size=\"10\" text-anchor=\"middle\">fires iff the value CHANGES; a first frame</text>\n  <text x=\"190\" y=\"132\" fill=\"#8b95a7\" font-size=\"10\" text-anchor=\"middle\">is a value, not a change</text>\n\n  <rect x=\"346\" y=\"60\" width=\"288\" height=\"80\" rx=\"6\" fill=\"#1a2130\" stroke=\"#5b8def\"/>\n  <text x=\"490\" y=\"82\" fill=\"#9db4e8\" font-size=\"11.5\" font-weight=\"600\" text-anchor=\"middle\">@kolu/surface-remote — no fabrication</text>\n  <text x=\"490\" y=\"101\" fill=\"#e6eaf2\" font-size=\"10.5\" text-anchor=\"middle\">no frame until the authority's first real one</text>\n  <text x=\"490\" y=\"118\" fill=\"#8b95a7\" font-size=\"10\" text-anchor=\"middle\">\"undefined until the first frame\" end-to-end;</text>\n  <text x=\"490\" y=\"132\" fill=\"#8b95a7\" font-size=\"10\" text-anchor=\"middle\">the default belongs to the ONE writer</text>\n\n  <rect x=\"646\" y=\"60\" width=\"288\" height=\"80\" rx=\"6\" fill=\"#1a2130\" stroke=\"#5b8def\"/>\n  <text x=\"790\" y=\"82\" fill=\"#9db4e8\" font-size=\"11.5\" font-weight=\"600\" text-anchor=\"middle\">the reactive bridge — phase 0</text>\n  <text x=\"790\" y=\"101\" fill=\"#e6eaf2\" font-size=\"10.5\" text-anchor=\"middle\">derived.cell · scan · source</text>\n  <text x=\"790\" y=\"118\" fill=\"#8b95a7\" font-size=\"10\" text-anchor=\"middle\">declarations over the backend signal graph;</text>\n  <text x=\"790\" y=\"132\" fill=\"#8b95a7\" font-size=\"10\" text-anchor=\"middle\">engine: @preact/signals-core → @solidjs/signals</text>\n\n  <!-- phase 1 → phase 2 -->\n  <line x1=\"490\" y1=\"156\" x2=\"490\" y2=\"186\" stroke=\"#8b95a7\" stroke-width=\"1.3\" marker-end=\"url(#arr)\"/>\n  <text x=\"502\" y=\"176\" fill=\"#5b6678\" font-size=\"10.5\">phase 2 rides the completed primitives</text>\n\n  <!-- ══ PHASE 2 band ══ -->\n  <text x=\"30\" y=\"208\" fill=\"#8b95a7\" font-size=\"13\" font-weight=\"600\">PHASE 2 — W5: ATTENTION</text>\n  <text x=\"30\" y=\"224\" fill=\"#5b6678\" font-size=\"10.5\" font-style=\"italic\">level state: \"what needs you now\" — one writer per host, an ordinary per-entry cell</text>\n\n  <!-- writers -->\n  <rect x=\"30\" y=\"240\" width=\"180\" height=\"52\" rx=\"8\" fill=\"#1a2130\" stroke=\"#2dd4a7\" stroke-width=\"1.5\"/>\n  <text x=\"120\" y=\"261\" fill=\"#e6eaf2\" font-size=\"12\" text-anchor=\"middle\">padi, per host</text>\n  <text x=\"120\" y=\"278\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">declared fold → urgency cell (existing)</text>\n\n  <rect x=\"30\" y=\"330\" width=\"180\" height=\"66\" rx=\"8\" fill=\"#1a2130\" stroke=\"#e8b44c\" stroke-width=\"1.5\"/>\n  <text x=\"120\" y=\"351\" fill=\"#e6eaf2\" font-size=\"12\" text-anchor=\"middle\">drishti server, per host</text>\n  <text x=\"120\" y=\"368\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">metrics ring · threshold +</text>\n  <text x=\"120\" y=\"383\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">hysteresis → alerts cell (new)</text>\n\n  <!-- framework middle -->\n  <rect x=\"250\" y=\"236\" width=\"400\" height=\"112\" rx=\"6\" fill=\"#1a2130\" stroke=\"#5b8def\"/>\n  <text x=\"450\" y=\"258\" fill=\"#9db4e8\" font-size=\"12\" font-weight=\"600\" text-anchor=\"middle\">@kolu/surface-map — watchByEntry (eager)</text>\n  <text x=\"450\" y=\"277\" fill=\"#e6eaf2\" font-size=\"11\" text-anchor=\"middle\">scopedByEntry's membership kernel, eager policy</text>\n  <text x=\"450\" y=\"294\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">raise = pure set-diff over updated's {prev, next} pairs</text>\n  <text x=\"450\" y=\"311\" fill=\"#e6eaf2\" font-size=\"11\" text-anchor=\"middle\">get(key): live | stale — chips read this</text>\n  <text x=\"450\" y=\"328\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">deliberately no total() — aggregation is app policy</text>\n\n  <rect x=\"250\" y=\"362\" width=\"400\" height=\"92\" rx=\"6\" fill=\"#1a2130\" stroke=\"#5b8def\"/>\n  <text x=\"450\" y=\"384\" fill=\"#9db4e8\" font-size=\"12\" font-weight=\"600\" text-anchor=\"middle\">@kolu/surface-app — notify</text>\n  <text x=\"450\" y=\"403\" fill=\"#e6eaf2\" font-size=\"11\" text-anchor=\"middle\">the origin's ONE service worker</text>\n  <text x=\"450\" y=\"420\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">tag-keyed show/close: same tag replaces, never stacks</text>\n  <text x=\"450\" y=\"437\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">onClick hands {host, itemId} back — the app routes</text>\n\n  <!-- apps right -->\n  <rect x=\"690\" y=\"236\" width=\"260\" height=\"112\" rx=\"8\" fill=\"#1a2130\" stroke=\"#2dd4a7\" stroke-width=\"1.5\"/>\n  <text x=\"820\" y=\"258\" fill=\"#e6eaf2\" font-size=\"12.5\" font-weight=\"600\" text-anchor=\"middle\">kolu</text>\n  <text x=\"820\" y=\"278\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">chips: att.get(host) — dimmed when stale</text>\n  <text x=\"820\" y=\"295\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">badge: Σ items over LIVE hosts</text>\n  <text x=\"820\" y=\"312\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">OS notification per item id</text>\n  <text x=\"820\" y=\"332\" fill=\"#2dd4a7\" font-size=\"10.5\" text-anchor=\"middle\">click ⇒ switchHost + focusTerminal</text>\n\n  <rect x=\"690\" y=\"362\" width=\"260\" height=\"92\" rx=\"8\" fill=\"#1a2130\" stroke=\"#e8b44c\" stroke-width=\"1.5\"/>\n  <text x=\"820\" y=\"384\" fill=\"#e6eaf2\" font-size=\"12.5\" font-weight=\"600\" text-anchor=\"middle\">drishti</text>\n  <text x=\"820\" y=\"404\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">badge: COUNT of hosts with any live alert</text>\n  <text x=\"820\" y=\"421\" fill=\"#8b95a7\" font-size=\"10.5\" text-anchor=\"middle\">(its own fold — NOT a sum)</text>\n  <text x=\"820\" y=\"441\" fill=\"#e8b44c\" font-size=\"10.5\" text-anchor=\"middle\">click ⇒ expandHost</text>\n\n  <!-- arrows: writers → framework -->\n  <line x1=\"210\" y1=\"266\" x2=\"248\" y2=\"278\" stroke=\"#2dd4a7\" stroke-width=\"1.3\" marker-end=\"url(#arrGreen)\"/>\n  <line x1=\"210\" y1=\"363\" x2=\"248\" y2=\"330\" stroke=\"#e8b44c\" stroke-width=\"1.3\" marker-end=\"url(#arrAmber)\"/>\n\n  <!-- arrows: framework → apps -->\n  <line x1=\"650\" y1=\"285\" x2=\"688\" y2=\"285\" stroke=\"#2dd4a7\" stroke-width=\"1.3\" marker-end=\"url(#arrGreen)\"/>\n  <line x1=\"650\" y1=\"404\" x2=\"688\" y2=\"404\" stroke=\"#e8b44c\" stroke-width=\"1.3\" marker-end=\"url(#arrAmber)\"/>\n  <text x=\"669\" y=\"272\" fill=\"#5b6678\" font-size=\"10\" text-anchor=\"middle\">raised</text>\n  <text x=\"669\" y=\"391\" fill=\"#5b6678\" font-size=\"10\" text-anchor=\"middle\">raised</text>\n\n  <!-- footer -->\n  <text x=\"490\" y=\"484\" fill=\"#5b6678\" font-size=\"11\" text-anchor=\"middle\">the framework hands facts (change pairs · raised ids · live/stale values); every aggregation, pixel, and click meaning stays in the app</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/surface-attention-101.mdx
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
			"This is the third primer in the series. ",
			createVNode(_components.a, {
				href: "surface-hosting-101.html",
				children: "The hosting side"
			}),
			" taught how ",
			createVNode(_components.strong, { children: "one" }),
			" surface crosses a machine; ",
			createVNode(_components.a, {
				href: "surface-map-101.html",
				children: "the client half"
			}),
			" taught ",
			createVNode(_components.strong, { children: "many" }),
			" keyed surfaces over one socket. This note teaches the layer ",
			createVNode(_components.a, {
				href: "padi.html#w5",
				children: "padi W5"
			}),
			" adds on top: turning a per-host fact (“these terminals need you”, “this host’s CPU is in trouble”) into ",
			createVNode(_components.strong, { children: "attention you can trust" }),
			" — a chip count, an app badge, an OS notification — without anyone hand-diffing frames. It shipped with W5 as one PR (",
			createVNode(_components.a, {
				href: "https://github.com/juspay/kolu/pull/1759",
				children: "kolu#1759"
			}),
			", merged 2026-07-11; the paired drishti PR, ",
			createVNode(_components.a, {
				href: "https://github.com/srid/drishti/pull/93",
				children: "srid/drishti#93"
			}),
			", is still in review). The work landed in ",
			createVNode(_components.strong, { children: "two phases" }),
			" inside it: first a surface refactor that completes the framework’s primitives, then W5 itself riding them."
		] }),
		"\n",
		createVNode($$Svg, {
			svg: surface_attention_101_pieces_default,
			wide: true,
			caption: "Two phases. Phase 1 completes the primitives: the cell reader gains updated() (change pairs, fired iff the value changes), mirrors stop fabricating first frames, and derived members become declarations over the backend signal graph (the reactive bridge's phase 0). Phase 2 builds attention on those: one writer per host publishes a level-state cell (kolu's urgency exists on master; drishti's alerts is W5's one new member); watchByEntry raises new item ids by set-diffing updated pairs; notify delivers at the origin's one service worker; each app keeps its own aggregation and click semantics."
		}),
		"\n",
		createVNode(_components.h2, {
			id: "surfaces-primitives-are-frp-under-other-names",
			children: "Surface’s primitives are FRP, under other names"
		}),
		"\n",
		createVNode(_components.p, { children: "A surface’s four member kinds are the classic FRP vocabulary — reflex’s, to name the canonical one:" }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "surface member" }),
					"\n",
					createVNode(_components.th, { children: "reflex name" }),
					"\n",
					createVNode(_components.th, { children: "the contract" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "stream" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "Behavior" }) }),
					"\n",
					createVNode(_components.td, { children: "derived, read-only, sampled at will" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "event" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "Event" }) }),
					"\n",
					createVNode(_components.td, { children: "an occurrence, not a value — no snapshot; a handler fires per occurrence" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "collection" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "Incremental" }) }),
					"\n",
					createVNode(_components.td, { children: "changes travel as patches, never whole-value replaces" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "cell" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "half" }),
						" a ",
						createVNode(_components.code, { children: "Dynamic" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"the current value — ",
						createVNode(_components.em, { children: "without" }),
						" the change event"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The first three rows are the documented contracts (",
			createVNode(_components.a, {
				href: "/surface/why-surfaces/#why-four-primitives-not-one",
				children: "why four primitives, not one"
			}),
			"). The fourth row is the gap this design closes. A reflex ",
			createVNode(_components.code, { children: "Dynamic" }),
			" is a current value ",
			createVNode(_components.strong, { children: "plus" }),
			" an ",
			createVNode(_components.code, { children: "Event" }),
			" of its changes, bound by one law: ",
			createVNode(_components.strong, { children: "the value changes if and only if the event fires" }),
			". A cell gives its consumers only the value half. So every consumer that needs “it changed” rebuilds the event half by hand — hold the last frame, diff each new one against it — and that hand-rebuilding is exactly where connection-state bugs breed: a hand-differ can’t tell a fabricated frame from an asserted one, keeps its memory per browser window, and misreads reconnect snapshots as fresh news. Completing the ",
			createVNode(_components.code, { children: "Dynamic" }),
			" — once, in the framework, under the law — is phase 1."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "phase-1--the-primitives-completed",
			children: "Phase 1 — the primitives, completed"
		}),
		"\n",
		createVNode(_components.p, { children: "Phase 1 is a surface refactor PR of its own, landing with paired kolu, drishti, and odu adoption PRs. Three pieces." }),
		"\n",
		createVNode(_components.h3, {
			id: "the-cell-reader-gains-updated-kolusurface",
			children: [
				"The cell reader gains ",
				createVNode(_components.code, { children: "updated" }),
				" (@kolu/surface)"
			]
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
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "interface"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Subscription"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "T"
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
							children: " Accessor"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "T"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " undefined"
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
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "  // pending / error / complete as today, plus:"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "  updated"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "handler"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "change"
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
							children: "prev"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " T"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "next"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " T"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }) "
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
							children: ")"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Dispose"
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
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "  // fires exactly when the value CHANGES (equals-deduped at the producer);"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "  // a first frame is a value, not a change — it never fires;"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "  // a reconnect snapshot equal to the last-seen value never fires;"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "  // one that differs fires exactly once, prev = the last-seen value."
					})
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
			"This is the missing half of the ",
			createVNode(_components.code, { children: "Dynamic" }),
			", and the comments are the law, spelled out per case. The ",
			createVNode(_components.code, { children: "{prev, next}" }),
			" pairs are derived ",
			createVNode(_components.strong, { children: "once, in the framework" }),
			" — deduped by equality at the producer, so an equal write is not a change anywhere downstream. A consumer that needs “what changed” subscribes ",
			createVNode(_components.code, { children: "updated" }),
			" and receives honest pairs; a consumer that needs “what is” keeps calling the accessor. Nobody diffs frames, because the framework already knows which frames are changes — that is the ",
			createVNode(_components.em, { children: "point" }),
			" of the law: “fires iff the value changes” is a property of the primitive, testable once, instead of a hope re-implemented at every call site."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The two subtle cases in the comment block deserve their names. ",
			createVNode(_components.strong, { children: "A first frame is a value, not a change" }),
			" — when a subscription comes up, learning the current truth is not news that something ",
			createVNode(_components.em, { children: "happened" }),
			"; treating it as news is how every “notification storm on page load” starts. ",
			createVNode(_components.strong, { children: "An equal reconnect snapshot never fires" }),
			" — a link flap ends with the authority replaying current truth; if that truth equals what you last saw, nothing changed, and ",
			createVNode(_components.code, { children: "updated" }),
			" stays silent."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "a-mirror-never-fabricates-a-value-kolusurface-remote",
			children: "A mirror never fabricates a value (@kolu/surface-remote)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The reader’s law is only as good as the frames feeding it, and mirroring has one dishonest habit to remove: a re-served cell’s first frame is the ",
			createVNode(_components.strong, { children: "declared spec default" }),
			", served before the authority has said anything — and that fabricated frame is byte-indistinguishable from a value the authority asserted."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Run the failure it causes. kolu-server restarts. A still-open page reconnects and reads padi’s urgency cell: ",
			createVNode(_components.code, { children: "{ awaitingIds: [] }" }),
			" — the declared default, asserted by ",
			createVNode(_components.strong, { children: "nobody" }),
			" — because the mirror needed something to show, so it showed the default. Then the authority’s real value lands: the same two terminals that have needed you for an hour. Any hand-diff sees “empty → two ids” and fires ",
			createVNode(_components.strong, { children: "duplicate OS notifications" }),
			" for old news. The consumer did nothing wrong; the wire handed it a fabrication and called it truth."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The fix is subtraction: ",
			createVNode(_components.strong, { children: "a mirrored cell serves no frame until the authority’s first real one." }),
			" The cell reader already models “no frame yet” — the accessor is ",
			createVNode(_components.code, { children: "T | undefined" }),
			" until the first frame — so the fix makes that ",
			createVNode(_components.code, { children: "undefined" }),
			" ",
			createVNode(_components.strong, { children: "true end-to-end" }),
			": undefined means ",
			createVNode(_components.em, { children: "the authority hasn’t spoken" }),
			", never ",
			createVNode(_components.em, { children: "here’s a guess" }),
			". The declared default belongs to the ",
			createVNode(_components.strong, { children: "one writer" }),
			" (the serving endpoint materializes it when it has nothing better); mirrors relay truth or stay silent. With both pieces in place the change event cannot be triggered by fabrication — there is nothing to compare against until truth arrives, and the first truth is a value, not a change."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "a-derived-member-is-declared-not-hand-wired-the-reactive-bridge-phase-0",
			children: "A derived member is declared, not hand-wired (the reactive bridge, phase 0)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The third piece generalizes the first two: a ",
			createVNode(_components.strong, { children: "derived" }),
			" member — a cell whose value is a projection of some other live thing — becomes a ",
			createVNode(_components.em, { children: "declaration" }),
			" over a backend ",
			createVNode(_components.strong, { children: "signal graph" }),
			", instead of a ",
			createVNode(_components.code, { children: ".set()" }),
			" a human remembers to wire. The graph’s engine lives behind one module, ",
			createVNode(_components.code, { children: "reactor.ts" }),
			" in ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" (its deep import lint-banned everywhere else; the engine is ",
			createVNode(_components.strong, { children: "decided" }),
			" — ",
			createVNode(_components.code, { children: "@preact/signals-core" }),
			" now, ",
			createVNode(_components.code, { children: "@solidjs/signals" }),
			" the named swap target, per ",
			createVNode(_components.a, {
				href: "surface-reactor-engine.html",
				children: "the engine note"
			}),
			"), and reactor.ts exports only the sanctioned shapes: ",
			createVNode(_components.code, { children: "derived.cell(nodeOrFn)" }),
			", the free-standing ",
			createVNode(_components.code, { children: "scan(source, initial, step)" }),
			", and ",
			createVNode(_components.code, { children: "source(...)" }),
			" for external input (push or poll). Three guarantees ride every declaration: ",
			createVNode(_components.strong, { children: "one writer, structural" }),
			" (a derived member has no ctx entry and no wire write verbs — a second writer is unrepresentable); ",
			createVNode(_components.strong, { children: [
				"dedup at the member’s spec ",
				createVNode(_components.code, { children: "equals" }),
				", once"
			] }),
			" — the same gate that makes ",
			createVNode(_components.code, { children: "updated()" }),
			"’s law true; ",
			createVNode(_components.strong, { children: "the framework’s reconnect story" }),
			" — on the wire a derived cell is an ordinary cell, so consumers can’t tell it was derived."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"W5 shipped exactly ",
			createVNode(_components.strong, { children: "phase 0" }),
			" of this — the constructors above, riding existing seams, with drishti’s alerts as the first consumer. The full design — the model, the laws, the worked examples, the later phases — is ",
			createVNode(_components.a, {
				href: "surface-reactive-bridge.html",
				children: "the reactive bridge"
			}),
			"."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "phase-2--attention-riding-the-completed-primitives",
			children: "Phase 2 — attention, riding the completed primitives"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Attention is level state" }),
			": ",
			createVNode(_components.em, { children: "what needs you now" }),
			" — a plain value, in an ordinary per-entry cell, written by the ",
			createVNode(_components.strong, { children: "one endpoint per host that can actually know it" }),
			". For kolu that endpoint already exists, and so does the cell: ",
			createVNode(_components.strong, { children: "W5 mints no kolu wire member" }),
			". The per-terminal fact lives in padi’s composed ",
			createVNode(_components.code, { children: "terminals" }),
			" collection (",
			createVNode(_components.code, { children: "PadiTerminalSchema" }),
			", discriminated on ",
			createVNode(_components.code, { children: "state" }),
			" — the active arm carries the agent state, and “awaiting the user” is a metadata fact), and its cross-host projection is ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "cells.urgency" }) }),
			" (",
			createVNode(_components.code, { children: "packages/padi/src/surface.ts" }),
			"): ",
			createVNode(_components.code, { children: "PadiUrgencySchema = { awaitingIds: TerminalId[] }" }),
			", padi’s registry fold the sole writer, read-only on the client. The contract is deliberately spare — ids and ",
			createVNode(_components.strong, { children: "no recency" }),
			" (nothing cross-host ever compares two hosts’ clocks), and ",
			createVNode(_components.strong, { children: "no count field" }),
			" (a count that could disagree with ",
			createVNode(_components.code, { children: "awaitingIds" }),
			" would be a second source of truth for one fact, so every read site derives it as ",
			createVNode(_components.code, { children: "awaitingIds.length" }),
			" — the host strip’s chips already do exactly this). For drishti the endpoint is the server, because the server holds the metrics history — threshold plus hysteresis need history, so they live there, never in the browser — and ",
			createVNode(_components.em, { children: "its" }),
			" cell does not exist yet: ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "alerts" }), " is the one new wire member in W5"] }),
			" (drishti’s surface today carries system/process/cpu/net metric cells and no threshold fact in any member)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"In W5, kolu’s urgency is ",
			createVNode(_components.strong, { children: "consume-only" }),
			": its production is unchanged (the re-production as a declared ",
			createVNode(_components.code, { children: "derived.cell(($) => recomputeUrgency($.terminals()))" }),
			" is bridge phase 1, sequenced after W5). drishti’s alerts is born as a declared ",
			createVNode(_components.strong, { children: "scan published as a cell" }),
			" (",
			createVNode(_components.code, { children: "derived.cell(scan(...))" }),
			"), because hysteresis is ",
			createVNode(_components.em, { children: "carried state" }),
			": “crossed 80 to raise, fell below 70 to clear” is undecidable from the current sample alone — the in/out level plus the recent window rides the scan. A scan can seed its state from a persistent store when survival is wanted; the alerts scan deliberately passes none — a fresh process re-derives its level from fresh samples, and the declaration makes that choice visible."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Why does the tiny ",
			createVNode(_components.code, { children: "urgency" }),
			" member exist at all, when the ",
			createVNode(_components.code, { children: "terminals" }),
			" collection already holds the truth? Because of ",
			createVNode(_components.a, {
				href: "padi.html#w7",
				children: "W7’s K1 ruling"
			}),
			": wire subscriptions stay ",
			createVNode(_components.strong, { children: "active-host-only" }),
			" — a background host keeps no full metadata subscription. ",
			createVNode(_components.code, { children: "urgency" }),
			" is the deliberately tiny projection kept hot per host, so hearing from every host costs a list of ids, not a fleet of ",
			createVNode(_components.code, { children: "terminals" }),
			" mirrors."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Why a cell and not an event member? Check the contracts table: an event is an occurrence with ",
			createVNode(_components.strong, { children: "no snapshot" }),
			" — a “terminal started awaiting” event fired while the browser is closed, or while the link is flapping, is simply ",
			createVNode(_components.em, { children: "gone" }),
			". Attention must survive exactly those windows: the whole feature is “hear about the host you are ",
			createVNode(_components.em, { children: "not" }),
			" watching”. The ",
			createVNode(_components.code, { children: "urgency" }),
			" cell replays current truth — the full ",
			createVNode(_components.code, { children: "awaitingIds" }),
			" — on every (re)connect, and phase 1’s ",
			createVNode(_components.code, { children: "updated" }),
			" tells you honestly whether that replay changed anything. Level state plus honest change detection is the entire wire story."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "watchbyentry--the-eager-watcher-kolusurface-map",
			children: [createVNode(_components.code, { children: "watchByEntry" }), " — the eager watcher (@kolu/surface-map)"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.a, {
				href: "surface-map-101.html",
				children: "map-101"
			}),
			" taught ",
			createVNode(_components.code, { children: "scopedByEntry" }),
			", whose membership kernel — ",
			createVNode(_components.em, { children: [
				"entries fold · codec identity · ",
				createVNode(_components.code, { children: "keyArray" }),
				" per-key roots · dispose-on-exit"
			] }),
			" — decides when a host’s world exists. Attention needs the same lifecycle with the opposite laziness: ",
			createVNode(_components.code, { children: "scopedByEntry" }),
			" builds a key’s world on first ",
			createVNode(_components.strong, { children: "activation" }),
			" (background hosts you never visit cost nothing — right for client state), while an attention watcher must be ",
			createVNode(_components.strong, { children: "eager" }),
			", because a background host is precisely the one you need to hear from. One kernel, two policies; the kernel is shared, never re-derived."
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
							children: " watchByEntry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "A"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "client"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "cell"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "items"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "onRaise"
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
							children: "  get"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "key"
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
							children: " \"live\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
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
							children: "value"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " A"
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
							style: { color: "#005CC5" },
							children: " undefined"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// chips read this"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "};  "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// deliberately NO total(): aggregation is app policy (the two consumers disagree)"
					})]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "watchByEntry" }),
			" subscribes every entry’s cell eagerly and detects raises with a ",
			createVNode(_components.strong, { children: [
				"pure set-diff over the framework’s ",
				createVNode(_components.code, { children: "updated" }),
				" pairs"
			] }),
			": for each change, ",
			createVNode(_components.code, { children: "items(next) ∖ items(prev)" }),
			" are the newly-raised ids. That one line is the payoff of phase 1 — no hand-held previous frame, no cross-stream classification, no per-window memory: the change-iff-fired law upstream is what makes a plain set-diff trustworthy. The app’s sole obligation is the ",
			createVNode(_components.code, { children: "items" }),
			" extractor returning ",
			createVNode(_components.strong, { children: "stable ids" }),
			" (a terminal id, ",
			createVNode(_components.code, { children: "\"cpu\"" }),
			"); stability is what makes “same item, not a new one” decidable at all. Point reads answer honestly: a host whose link is down keeps its last value, marked ",
			createVNode(_components.code, { children: "stale" }),
			" — chips dim rather than lie."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The missing method is a teaching point of its own: there is ",
			createVNode(_components.strong, { children: ["no ", createVNode(_components.code, { children: "total()" })] }),
			", because the two real consumers disagree about what “total” means — kolu sums ",
			createVNode(_components.em, { children: "items" }),
			" across live hosts (12 terminals need you); drishti counts ",
			createVNode(_components.em, { children: "hosts in trouble" }),
			" (3 machines are alerting — summing their alert items would be noise). When the framework can’t pick without taking a side, it hands facts and the app folds. Same rule as ",
			createVNode(_components.a, {
				href: "surface-map-101.html",
				children: "map-101’s moral"
			}),
			": keyed volatility in the framework, policy in the app."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "delivery-at-the-origins-one-service-worker-kolusurface-app",
			children: "Delivery at the origin’s one service worker (@kolu/surface-app)"
		}),
		"\n",
		createVNode(_components.p, { children: "The last hop — actually showing an OS notification from a PWA — is short but mined. Two landmines, both real-world:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "getRegistration()" }),
					", not ",
					createVNode(_components.code, { children: ".ready" }),
					"."
				] }),
				" ",
				createVNode(_components.code, { children: "navigator.serviceWorker.ready" }),
				" resolves only when an active service worker exists — in any context where none registers (a dev server, a degraded boot), it ",
				createVNode(_components.strong, { children: "hangs forever" }),
				", and your notification path silently never runs. ",
				createVNode(_components.code, { children: "getRegistration()" }),
				" answers honestly, including “there isn’t one”, which you can handle."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"The service worker shows it, never ",
					createVNode(_components.code, { children: "new Notification()" }),
					"."
				] }),
				" In an installed (standalone) PWA, the page-context constructor throws ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "Illegal constructor" }) }),
				" — notifications must go through ",
				createVNode(_components.code, { children: "registration.showNotification()" }),
				". Code that works in a browser tab dies precisely when the user commits to the app."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Both are why delivery is a framework piece at all: one ",
			createVNode(_components.code, { children: "notify" }),
			" seam at the origin’s ",
			createVNode(_components.strong, { children: "one" }),
			" service worker, instead of N windows each attempting their own delivery:"
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
						children: "// @kolu/surface-app — delivery at the origin's ONE service worker (never per window):"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "notify."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "show"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ tag: "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "`${"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "host"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "}/${"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "itemId"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "}`"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", title, data: { host, itemId } });  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// same tag replaces, never stacks"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "notify."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "onClick"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(({ "
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
							children: "itemId"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }) "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "/* the app routes */"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " });"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The ",
			createVNode(_components.strong, { children: "tag" }),
			" carries the multi-window discipline: two open windows must not both ping you, and with a tag-keyed ",
			createVNode(_components.code, { children: "show" }),
			" they can’t — the OS ",
			createVNode(_components.em, { children: "replaces" }),
			" the same-tag notification instead of stacking a duplicate. And the click payload comes back to ",
			createVNode(_components.code, { children: "onClick" }),
			" as plain data (",
			createVNode(_components.code, { children: "{ host, itemId }" }),
			") that ",
			createVNode(_components.strong, { children: "the app routes" }),
			" — the framework does not know what clicking attention ",
			createVNode(_components.em, { children: "means" }),
			"."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-two-consumers-worked",
			children: "The two consumers, worked"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"kolu (padi W5 — the phase this design serves; ",
			createVNode(_components.strong, { children: "nothing minted" }),
			", the member exists on master):"
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
						children: "// padi — no new member, no production change in W5: cells.urgency ships today"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// (packages/padi/src/surface.ts). Its re-production as a declaration —"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// derived.cell(($) => recomputeUrgency($.terminals())) — is bridge PHASE 1,"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// sequenced after W5; cell, equals (urgencyEqual), and consumers unchanged."
					})
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// client — chips, badge, notification:"
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
							children: " att"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " watchByEntry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(padiMap, "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "e"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " =>"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " e.cells.urgency, "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "v"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " =>"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " v.awaitingIds,"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  ("
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
							children: "raised"
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
							children: " raised."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "forEach"
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
							children: " =>"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "    notify."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "show"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ tag: "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "`${"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "host"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "}/${"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "id"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "}`"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", title: "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "`terminal awaiting on ${"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "hostLabel"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "host"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: ")"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "}`"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ","
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "                  data: { host, id } })));"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// chip(host): att.get(host) — count = value.awaitingIds.length, dimmed when stale"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// badge: Σ awaitingIds.length over LIVE hosts — kolu's own one-line fold"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "notify."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "onClick"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(({ "
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
							children: "id"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }) "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "switchHost"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(host); "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "focusTerminal"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(id); });"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"drishti (the paired consumer — ",
			createVNode(_components.strong, { children: "the one new wire member" }),
			", since no member carries its threshold facts today):"
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
						children: "// server — the one writer, declared (bridge phase 0's first consumer):"
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
							children: " metrics"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " source"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "<"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "MetricsFrame"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">(("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "emit"
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
							children: " installMetricsTap"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(emit));"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "cells.alerts "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " derived."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "cell"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "scan"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(metrics, noAlerts, applyHysteresis));"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// no store — the alert level must not survive restarts;"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// step returning the prev reference ⇒ no publish"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// a held level publishes nothing (alerts' spec equals), so updated()"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// fires only on a genuine raise/clear"
					})
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// client:"
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
							children: " att"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " watchByEntry"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(hostMap, "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "e"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " =>"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " e.cells.alerts, "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "v"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " =>"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " v.items."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "map"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "i"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " =>"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " i.id),"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  ("
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
							children: "raised"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "v"
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
							children: " raised."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "forEach"
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
							children: " =>"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "    notify."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "show"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ tag: "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "`${"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "host"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "}/${"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "id"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "}`"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", title: "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "labelOf"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(v, id), data: { host, id } })));"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// badge: count of hosts with any live alert — drishti's own fold, NOT a sum"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "notify."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "onClick"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(({ "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "host"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }) "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "=>"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " expandHost"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(host));"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Read the two against each other and the boundary shows itself: the ",
			createVNode(_components.strong, { children: "wire member’s provenance" }),
			" differs (kolu consumes an existing projection; drishti mints W5’s one new member), the ",
			createVNode(_components.strong, { children: "writer" }),
			" differs (a stateless collection fold vs a stateful hysteresis scan — two folds that merely ",
			createVNode(_components.em, { children: "rhyme" }),
			", deliberately not unified), the ",
			createVNode(_components.strong, { children: "value shape" }),
			" differs (bare ids vs labeled items), the ",
			createVNode(_components.strong, { children: "aggregation" }),
			" differs (a sum vs a count), the ",
			createVNode(_components.strong, { children: "click" }),
			" differs (switch+focus vs expand). What’s identical is everything in between — the honest frames, the change pairs, the watcher, the tag-keyed delivery — which is exactly the slice the framework takes."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-stays-app-side-and-why",
			children: "What stays app-side, and why"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Deliberately outside the framework: the ",
			createVNode(_components.strong, { children: "domain folds and value shapes" }),
			" (unifying two folds that merely rhyme would complect two domains into one type), ",
			createVNode(_components.strong, { children: "every aggregation" }),
			" (the two consumers’ honest disagreement is the proof it’s policy), the ",
			createVNode(_components.strong, { children: "pixels" }),
			" (chips, badges, cards), and the ",
			createVNode(_components.strong, { children: "click semantics" }),
			". The framework’s whole contract is: honest frames in — change pairs, raised ids, live/stale values out."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "The surface framework's attention pieces, taught",
	"description": "A plain-words primer on the two-phase design behind W5's cross-host attention. Phase 1 is a surface refactor: the cell reader gains updated() — the missing half of an FRP Dynamic, change pairs under the change-iff-fired law — mirrors stop fabricating first frames, and derived members become declarations over the backend signal graph (the reactive bridge's phase 0). Phase 2 builds attention on top: level-state cells with one writer per host (kolu consumes padi's existing urgency cell; drishti's alerts is the one new wire member), the eager watchByEntry watcher in @kolu/surface-map whose raise detection is a set-diff over updated pairs, and tag-keyed service-worker delivery in @kolu/surface-app. kolu and drishti are the two consumers.",
	"parents": [
		"pedagogy",
		"padi",
		"surface"
	],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-11T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "surfaces-primitives-are-frp-under-other-names",
			"text": "Surface’s primitives are FRP, under other names"
		},
		{
			"depth": 2,
			"slug": "phase-1--the-primitives-completed",
			"text": "Phase 1 — the primitives, completed"
		},
		{
			"depth": 3,
			"slug": "the-cell-reader-gains-updated-kolusurface",
			"text": "The cell reader gains updated (@kolu/surface)"
		},
		{
			"depth": 3,
			"slug": "a-mirror-never-fabricates-a-value-kolusurface-remote",
			"text": "A mirror never fabricates a value (@kolu/surface-remote)"
		},
		{
			"depth": 3,
			"slug": "a-derived-member-is-declared-not-hand-wired-the-reactive-bridge-phase-0",
			"text": "A derived member is declared, not hand-wired (the reactive bridge, phase 0)"
		},
		{
			"depth": 2,
			"slug": "phase-2--attention-riding-the-completed-primitives",
			"text": "Phase 2 — attention, riding the completed primitives"
		},
		{
			"depth": 3,
			"slug": "watchbyentry--the-eager-watcher-kolusurface-map",
			"text": "watchByEntry — the eager watcher (@kolu/surface-map)"
		},
		{
			"depth": 3,
			"slug": "delivery-at-the-origins-one-service-worker-kolusurface-app",
			"text": "Delivery at the origin’s one service worker (@kolu/surface-app)"
		},
		{
			"depth": 2,
			"slug": "the-two-consumers-worked",
			"text": "The two consumers, worked"
		},
		{
			"depth": 2,
			"slug": "what-stays-app-side-and-why",
			"text": "What stays app-side, and why"
		}
	];
}
var url = "src/content/atlas/surface-attention-101.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-attention-101.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-attention-101.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
