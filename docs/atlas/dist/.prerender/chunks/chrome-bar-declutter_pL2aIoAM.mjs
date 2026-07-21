import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$D2 } from "./D2_CPv-UX0x.mjs";
import "./Pill_DD4u2LYa.mjs";
import { t as $$Cite } from "./Cite_IypTixBQ.mjs";
//#region src/content/atlas/chrome-bar-declutter.mdx
var CbStyles = () => createVNode("style", { children: `
  .cb-stage{position:relative;background:#fcfcfd;border:1px solid #e6e2d6;border-radius:12px;padding:1.5rem 1.25rem 1.1rem;margin:1.3rem 0;background-image:linear-gradient(#eef0f3 1px,transparent 1px),linear-gradient(90deg,#eef0f3 1px,transparent 1px);background-size:22px 22px;box-shadow:0 2px 12px rgba(0,0,0,.05)}
  .cb-row{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
  .cb-logo{display:flex;flex-direction:column;align-items:center;gap:2px;flex:none}
  .cb-logo i{display:block;height:3px;border-radius:2px}
  .cb-pill{display:inline-flex;align-items:stretch;border:1px solid #d0d0d8;background:rgba(232,232,236,.72);border-radius:9px;padding:2px;font:500 12px/1 ui-monospace,monospace}
  .cb-seg{display:inline-flex;align-items:center;gap:6px;padding:4px 8px}
  .cb-div{width:1px;align-self:center;height:15px;background:rgba(184,184,194,.75);margin:0 2px}
  .cb-lbl{font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:#8a8a96}
  .cb-dot{width:7px;height:7px;border-radius:50%;flex:none}
  .cb-ok{background:#16a34a}.cb-warn{background:#ca8a04}.cb-bad{background:#dc2626}.cb-unk{background:rgba(138,138,150,.5)}
  .cb-ver{color:#5c5c66;font-variant-numeric:tabular-nums}
  .cb-sha{color:#5c5c66;border-bottom:1px dotted #b8b8c2}
  .cb-key{font-size:10px;color:#8a8a96;border-bottom:1px dotted rgba(138,138,150,.55)}
  .cb-up{font-size:10px;color:#8a8a96;font-variant-numeric:tabular-nums}
  .cb-eq{color:#9098a2;font-size:13px;line-height:1}
  .cb-chip{font-size:9px;color:#ca8a04;border:1px solid rgba(202,138,4,.45);border-radius:999px;padding:2px 6px;white-space:nowrap}
  .cb-aff{color:#a0a0a8;font-size:12px;padding:0 2px}
  .cb-btn{border-radius:6px;background:rgba(220,220,228,.5)}
  .cb-dup{background:rgba(202,138,4,.16);border-radius:3px;box-shadow:0 0 0 1px rgba(202,138,4,.3)}
  .cb-cap{margin-top:.7rem;font:600 .72rem/1.4 ui-sans-serif,system-ui;color:#6b7280}
  .cb-cap b{color:#262a2e}
  .cb-cap .ok{color:#16a34a}.cb-cap .am{color:#b8860b}.cb-cap .rd{color:#dc2626}
  .cb-grid{display:grid;grid-template-columns:1fr 1fr;gap:.95rem;margin:1.3rem 0}
  @media (max-width:640px){.cb-grid{grid-template-columns:1fr}}
  .cb-card{border:1px solid #e6e2d6;border-radius:11px;padding:1rem .95rem;background:#fcfcfd;background-image:linear-gradient(#eef0f3 1px,transparent 1px),linear-gradient(90deg,#eef0f3 1px,transparent 1px);background-size:20px 20px}
  .cb-mini{font:600 .62rem/1 ui-monospace,monospace;letter-spacing:.05em;text-transform:uppercase;color:#9098a2;margin:0 0 .6rem}
  @media (prefers-reduced-motion:reduce){.cb-stage *,.cb-card *{animation:none!important}}
  ` });
var Logo = () => createVNode("span", {
	class: "cb-logo",
	"aria-label": "kolu",
	role: "img",
	children: [
		createVNode("i", { style: "width:9px;background:#7c3aed" }),
		createVNode("i", { style: "width:13px;background:#2563eb" }),
		createVNode("i", { style: "width:17px;background:#16a34a" }),
		createVNode("i", { style: "width:21px;background:#ca8a04" }),
		createVNode("i", { style: "width:25px;background:#dc2626" })
	]
});
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		b: "b",
		code: "code",
		em: "em",
		h2: "h2",
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
			"The rail is ",
			createVNode(_components.strong, { children: "too crowded" }),
			" — and most of it is the ",
			createVNode(_components.em, { children: "same fact, repeated" }),
			". In a\nclean deploy the server, this browser’s bundle, and the kaval daemon are all\nbuilt from one HEAD, so the rail prints ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "d07ea54" }), " three times"] }),
			" behind three\nlabels. ",
			createVNode($$Cite, { file: "packages/client/src/ui/IdentityRail.tsx" }),
			" Shipped in ",
			createVNode($$PrLink, { pr: 1359 }),
			"."
		] }),
		"\n",
		"\n",
		"\n",
		createVNode(CbStyles, {}),
		"\n",
		createVNode(_components.h2, {
			id: "the-crowding--three-shas-for-one-bit",
			children: "The crowding — three SHAs for one bit"
		}),
		"\n",
		createVNode("div", {
			class: "cb-stage",
			children: [createVNode("div", {
				class: "cb-row",
				children: [createVNode(Logo, {}), createVNode("span", {
					class: "cb-pill",
					children: [
						createVNode("span", {
							class: "cb-seg",
							children: [
								createVNode("span", {
									class: "cb-lbl",
									children: "srv"
								}),
								createVNode("span", { class: "cb-dot cb-ok" }),
								createVNode("span", {
									class: "cb-ver",
									children: "v1.1.0"
								}),
								createVNode("span", {
									class: "cb-sha cb-dup",
									children: "d07ea54"
								})
							]
						}),
						createVNode("span", { class: "cb-div" }),
						createVNode("span", {
							class: "cb-seg",
							children: [createVNode("span", {
								class: "cb-lbl",
								children: "client"
							}), createVNode("span", {
								class: "cb-sha cb-dup",
								children: "d07ea54"
							})]
						}),
						createVNode("span", { class: "cb-div" }),
						createVNode("span", {
							class: "cb-seg",
							children: [
								createVNode("span", {
									class: "cb-lbl",
									children: "kaval"
								}),
								createVNode("span", { class: "cb-dot cb-ok" }),
								createVNode("span", {
									class: "cb-sha cb-dup",
									children: "d07ea54"
								}),
								createVNode("span", {
									class: "cb-key",
									children: "98eeac0"
								}),
								createVNode("span", {
									class: "cb-up",
									children: "1h 50m"
								})
							]
						})
					]
				})]
			}), createVNode("div", {
				class: "cb-cap",
				children: [
					"Before — ",
					createVNode(_components.b, { children: "d07ea54" }),
					" printed ",
					createVNode(_components.b, { children: "three times" }),
					" (highlighted), plus a closure hash and three labels: ~10 tokens to say ",
					createVNode("span", {
						class: "ok",
						children: "in sync · alive"
					}),
					"."
				]
			})]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The three columns exist to flag ",
			createVNode(_components.strong, { children: "disagreement" }),
			" — ",
			createVNode(_components.code, { children: "client ≠ srv" }),
			" (a stale cached\nbundle), ",
			createVNode(_components.code, { children: "kaval ⬆ update" }),
			" (the daemon a build behind). When everything agrees —\nthe ~95% case — that machinery just repeats one identity. Only ",
			createVNode(_components.code, { children: "98eeac0" }),
			" (kaval’s\nnix closure hash) is genuinely distinct, and it’s a content hash, not a\nGitHub-navigable commit."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "This revisits a decision we deliberately deferred",
			children: createVNode(_components.p, { children: [
				"The original rail chose ",
				createVNode(_components.strong, { children: "“always explicit columns… no collapse-when-equal”" }),
				" —\nbut only ",
				createVNode(_components.em, { children: "“until the feature stabilizes”" }),
				" (",
				createVNode(_components.a, {
					href: "pty-daemon-chrome-bar.html",
					children: "pty-daemon-chrome-bar"
				}),
				",\ndecisions). Since then B2 split kaval into its own daemon, B3.2 added the inline\nrestart, and B3.4 (",
				createVNode($$PrLink, { pr: 1353 }),
				") lit the ",
				createVNode(_components.code, { children: "⬆ update" }),
				" nudge. The feature has\nstabilized — so cutting the redundant repeats is now on the table."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "show-the-commit-once",
			children: "Show the commit once"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Keep the three familiar columns and the labeled ",
			createVNode(_components.strong, { children: "kaval" }),
			" panel button — just\nstop repeating the commit. It shows ",
			createVNode(_components.strong, { children: "once" }),
			", in ",
			createVNode(_components.code, { children: "srv" }),
			" (the canonical identity).\n",
			createVNode(_components.code, { children: "client" }),
			" collapses to a muted ",
			createVNode(_components.strong, { children: "≡" }),
			" (“same build as the server”), and ",
			createVNode(_components.code, { children: "kaval" }),
			"\ndrops its duplicate commit + closure-hash down into its panel, keeping only its\nlive dot · uptime on the strip."
		] }),
		"\n",
		createVNode("div", {
			class: "cb-stage",
			children: [createVNode("div", {
				class: "cb-row",
				children: [createVNode(Logo, {}), createVNode("span", {
					class: "cb-pill",
					children: [
						createVNode("span", {
							class: "cb-seg",
							children: [
								createVNode("span", {
									class: "cb-lbl",
									children: "srv"
								}),
								createVNode("span", { class: "cb-dot cb-ok" }),
								createVNode("span", {
									class: "cb-ver",
									children: "v1.1.0"
								}),
								createVNode("span", {
									class: "cb-sha",
									children: "d07ea54"
								})
							]
						}),
						createVNode("span", { class: "cb-div" }),
						createVNode("span", {
							class: "cb-seg",
							children: [createVNode("span", {
								class: "cb-lbl",
								children: "client"
							}), createVNode("span", {
								class: "cb-eq",
								children: "≡"
							})]
						}),
						createVNode("span", { class: "cb-div" }),
						createVNode("span", {
							class: "cb-seg cb-btn",
							children: [
								createVNode("span", {
									class: "cb-lbl",
									children: "kaval"
								}),
								createVNode("span", { class: "cb-dot cb-ok" }),
								createVNode("span", {
									class: "cb-up",
									children: "1h 50m"
								})
							]
						})
					]
				})]
			}), createVNode("div", {
				class: "cb-cap",
				children: [
					createVNode(_components.b, { children: "After" }),
					" — the commit shows ",
					createVNode(_components.b, { children: "once" }),
					". ",
					createVNode("span", {
						style: "color:#9098a2",
						children: "≡"
					}),
					" = client matches srv; ",
					createVNode(_components.b, { children: "kaval" }),
					" stays the labeled button (shaded) → its panel (build commit · ",
					createVNode(_components.code, { children: "98eeac0" }),
					" · restart · ",
					createVNode(_components.code, { children: "kaval-tui" }),
					"). One dot per axis: srv’s carries ",
					createVNode(_components.code, { children: "data-ws-status" }),
					", kaval’s ",
					createVNode(_components.code, { children: "data-daemon-state" }),
					"."
				]
			})]
		}),
		"\n",
		createVNode(_components.p, { children: "No new affordance, no hover-to-reveal, no disclosure triangle — the rail reads the\nsame as before, just without the echo. Every dropped fact stays reachable: the\nclient commit in the About dialog, kaval’s commit + closure-hash in its panel." }),
		"\n",
		createVNode(_components.h2, {
			id: "divergence-spells-itself-out",
			children: "Divergence spells itself out"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The dedup only collapses what’s ",
			createVNode(_components.em, { children: "redundant" }),
			". The moment a column actually\ndisagrees it expands back to its own commit + an actionable chip — automatically,\nnothing to click. These are the signals the three columns existed for."
		] }),
		"\n",
		createVNode("div", {
			class: "cb-grid",
			children: [
				createVNode("div", {
					class: "cb-card",
					children: [
						createVNode("p", {
							class: "cb-mini",
							children: "client behind server"
						}),
						createVNode("div", {
							class: "cb-row",
							children: [createVNode(Logo, {}), createVNode("span", {
								class: "cb-pill",
								children: [
									createVNode("span", {
										class: "cb-seg",
										children: [
											createVNode("span", {
												class: "cb-lbl",
												children: "srv"
											}),
											createVNode("span", { class: "cb-dot cb-ok" }),
											createVNode("span", {
												class: "cb-ver",
												children: "v1.1.0"
											}),
											createVNode("span", {
												class: "cb-sha",
												children: "d07ea54"
											})
										]
									}),
									createVNode("span", { class: "cb-div" }),
									createVNode("span", {
										class: "cb-seg",
										children: [
											createVNode("span", {
												class: "cb-lbl",
												children: "client"
											}),
											createVNode("span", {
												class: "cb-sha",
												children: "a1b2c3d"
											}),
											createVNode("span", {
												class: "cb-chip",
												children: "≠ srv"
											})
										]
									})
								]
							})]
						}),
						createVNode("div", {
							class: "cb-cap",
							children: [
								createVNode("span", {
									class: "am",
									children: "≠ srv"
								}),
								" — the ",
								createVNode(_components.b, { children: "≡" }),
								" gives way to the client’s own SHA + a one-click reload nudge. ",
								createVNode(_components.code, { children: "clientStale()" })
							]
						})
					]
				}),
				createVNode("div", {
					class: "cb-card",
					children: [
						createVNode("p", {
							class: "cb-mini",
							children: "kaval a build behind"
						}),
						createVNode("div", {
							class: "cb-row",
							children: [createVNode(Logo, {}), createVNode("span", {
								class: "cb-pill",
								children: [
									createVNode("span", {
										class: "cb-seg",
										children: [
											createVNode("span", {
												class: "cb-lbl",
												children: "srv"
											}),
											createVNode("span", { class: "cb-dot cb-ok" }),
											createVNode("span", {
												class: "cb-ver",
												children: "v1.1.0"
											}),
											createVNode("span", {
												class: "cb-sha",
												children: "d07ea54"
											})
										]
									}),
									createVNode("span", { class: "cb-div" }),
									createVNode("span", {
										class: "cb-seg cb-btn",
										children: [
											createVNode("span", {
												class: "cb-lbl",
												children: "kaval"
											}),
											createVNode("span", { class: "cb-dot cb-ok" }),
											createVNode("span", {
												class: "cb-up",
												children: "1h 50m"
											}),
											createVNode("span", {
												class: "cb-chip",
												children: "⬆ update"
											})
										]
									})
								]
							})]
						}),
						createVNode("div", {
							class: "cb-cap",
							children: [
								createVNode("span", {
									class: "am",
									children: "⬆ update"
								}),
								" on the kaval button — click it → panel with running-vs-expected + Restart. ",
								createVNode(_components.code, { children: "kavalUpdatePending()" })
							]
						})
					]
				}),
				createVNode("div", {
					class: "cb-card",
					children: [
						createVNode("p", {
							class: "cb-mini",
							children: "daemon stopped"
						}),
						createVNode("div", {
							class: "cb-row",
							children: [createVNode(Logo, {}), createVNode("span", {
								class: "cb-pill",
								children: [
									createVNode("span", {
										class: "cb-seg",
										children: [
											createVNode("span", {
												class: "cb-lbl",
												children: "srv"
											}),
											createVNode("span", { class: "cb-dot cb-ok" }),
											createVNode("span", {
												class: "cb-ver",
												children: "v1.1.0"
											}),
											createVNode("span", {
												class: "cb-sha",
												children: "d07ea54"
											})
										]
									}),
									createVNode("span", { class: "cb-div" }),
									createVNode("span", {
										class: "cb-seg cb-btn",
										children: [
											createVNode("span", {
												class: "cb-lbl",
												children: "kaval"
											}),
											createVNode("span", { class: "cb-dot cb-bad" }),
											createVNode("span", {
												style: "color:#dc2626;font-size:10px",
												children: "not running"
											})
										]
									})
								]
							})]
						}),
						createVNode("div", {
							class: "cb-cap",
							children: [
								createVNode("span", {
									class: "rd",
									children: "red dot"
								}),
								" + state label replace the uptime; pairs with the degraded canvas. ",
								createVNode(_components.code, { children: "DAEMON_STATE_PRESENTATION[state].label" })
							]
						})
					]
				}),
				createVNode("div", {
					class: "cb-card",
					children: [
						createVNode("p", {
							class: "cb-mini",
							children: "server unreachable"
						}),
						createVNode("div", {
							class: "cb-row",
							children: [createVNode(Logo, {}), createVNode("span", {
								class: "cb-pill",
								children: [
									createVNode("span", {
										class: "cb-seg",
										children: [
											createVNode("span", {
												class: "cb-lbl",
												children: "srv"
											}),
											createVNode("span", { class: "cb-dot cb-bad" }),
											createVNode("span", {
												class: "cb-ver",
												children: "v1.1.0"
											}),
											createVNode("span", {
												class: "cb-sha",
												children: "d07ea54"
											})
										]
									}),
									createVNode("span", { class: "cb-div" }),
									createVNode("span", {
										class: "cb-seg",
										children: [createVNode("span", {
											class: "cb-lbl",
											children: "client"
										}), createVNode("span", {
											class: "cb-eq",
											children: "≡"
										})]
									})
								]
							})]
						}),
						createVNode("div", {
							class: "cb-cap",
							children: [
								createVNode("span", {
									class: "rd",
									children: "red srv dot"
								}),
								" — the WS liveness dot (the e2e ",
								createVNode(_components.code, { children: "data-ws-status" }),
								" hook), distinct from a red kaval dot. ",
								createVNode(_components.code, { children: "wsDot(props.status)" })
							]
						})
					]
				})
			]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "what-moves-where--nothing-is-lost",
			children: "What moves where — nothing is lost"
		}),
		"\n",
		createVNode($$D2, {
			caption: "The same per-column accessors the rail reads today. The server commit is the one shown; clientStale() decides whether client renders a muted ≡ or fans out to its own commit + ≠srv badge; the kaval column stays a button onto KavalInfoDialog, which is now the home for kaval's build commit + closure-hash (its dot + uptime stay on the strip, with ⬆update / a state label when it diverges). srvDot/statusStyles are deduped behind one shared wsDot helper used by both the desktop rail and the mobile connection dot.",
			code: `direction: down
srv: "srv column — wsDot dot · version · Commit (the ONE commit)"
client: "client column — clientStale()?"
eq: "≡  (matches srv)"
diverge: "client's own Commit + ≠ srv badge"
kaval: "kaval column (button) — kavalDot dot · uptime · ⬆update?"
dialog: "KavalInfoDialog — build commit · 98eeac0 · restart · kaval-tui"
wsdot: "wsDot — shared by srv dot + mobile connection dot"
srv -> wsdot
client -> eq: "false"
client -> diverge: "true (clientStale)"
kaval -> dialog: "click"
`
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Current element" }),
					"\n",
					createVNode(_components.th, { children: "Where it lives now" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "server commit" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "the one shown" }), " (srv column), a GitHub link"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "client commit (when it matches)" }),
					"\n",
					createVNode(_components.td, { children: [
						"a muted ",
						createVNode(_components.strong, { children: "≡" }),
						" — its real SHA is in the About dialog"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "client commit (when stale)" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "inline" }),
						", beside the ",
						createVNode(_components.code, { children: "≠ srv" }),
						" chip"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "kaval commit" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "KavalInfoDialog" }), " (off the strip)"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["kaval closure hash ", createVNode(_components.code, { children: "98eeac0" })] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "KavalInfoDialog" }), " (it’s a content hash, not navigable)"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["kaval dot · uptime · ", createVNode(_components.code, { children: "⬆ update" })] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "inline" }), " on the kaval button (unchanged)"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "srv WS-tone map (was duplicated in mobile chrome)" }),
					"\n",
					createVNode(_components.td, { children: [
						"one shared ",
						createVNode(_components.strong, { children: createVNode(_components.code, { children: "wsDot" }) }),
						" in ",
						createVNode(_components.code, { children: "useDaemonStatus.ts" })
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Scope — a surgical edit on the existing rail",
			children: createVNode(_components.p, { children: [
				"This keeps ",
				createVNode($$Cite, { file: "packages/client/src/ui/IdentityRail.tsx" }),
				"’s three-column\nshape and the kaval-column-is-a-button affordance untouched; it only stops\nrepeating the commit and relocates kaval’s build identity into the panel that\nalready shows it. The one shared helper extracted along the way (",
				createVNode(_components.code, { children: "wsDot" }),
				") dedups\nthe desktop and mobile connection dots. The load-bearing e2e hooks stay where the\nscenarios expect them: ",
				createVNode(_components.code, { children: "data-ws-status" }),
				" on the srv dot, ",
				createVNode(_components.code, { children: "data-daemon-state" }),
				" on the\nkaval dot, exactly one element each."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "what-we-tried-first--and-backed-off",
			children: "What we tried first — and backed off"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The first cut went further: ",
			createVNode(_components.strong, { children: "collapse to a single worst-of health dot + one\ncommit" }),
			", with the per-source split behind a hover tooltip and a ",
			createVNode(_components.code, { children: "▸" }),
			" disclosure\nthat opened the kaval panel. Driving it live killed it on two counts:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The hover/dropdown breakdown was machinery for a non-problem." }),
				" At rest it\nreveals ",
				createVNode(_components.code, { children: "d07ea54 / d07ea54 / d07ea54" }),
				" — the exact redundancy the collapse\nremoved. The one case where the split matters (divergence) already fans out\ninline on its own, so nothing needs un-hiding."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"A ",
					createVNode(_components.code, { children: "▸" }),
					" reads as “expand,” not “open a modal.”"
				] }),
				" Clicking the disclosure\ntriangle opened the kaval ",
				createVNode(_components.em, { children: "dialog" }),
				" — and that modal’s full-screen backdrop then\nsat on top of an unrelated “App updated → Reload” card and ate the click. A\ndisclosure that doesn’t disclose is a broken affordance."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "So the shipped design keeps the familiar columns and the labeled kaval button, and\njust deletes the echo. Two further-out options, for the record:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Most minimal" }),
				" — ",
				createVNode(_components.code, { children: "srv ● v1.1.0 d07ea54" }),
				" only, kaval reached via the command\npalette. Cleanest, but drops ",
				createVNode(_components.code, { children: "kaval-tui" }),
				" discoverability at rest."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Full collapse + dropdown" }), " — the first cut above. Rejected: the dropdown\nun-hides the redundancy, and the triangle misreads as a disclosure."] }),
			"\n"
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "ChromeBar declutter — show the commit once",
	"description": "The srv·client·kaval identity rail printed the same commit three times in the happy path. Keep the three familiar columns, but show the shared commit once (in srv), collapse client to a muted ≡ when it matches, and move kaval's duplicate commit + closure-hash into its panel — so the rail stays recognizable while the redundancy is gone, and divergence still spells itself out inline.",
	"parents": ["pty-daemon-chrome-bar", "feature"],
	"status": "implemented",
	"maturity": "budding",
	"updated": "2026-06-14T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-crowding--three-shas-for-one-bit",
			"text": "The crowding — three SHAs for one bit"
		},
		{
			"depth": 2,
			"slug": "show-the-commit-once",
			"text": "Show the commit once"
		},
		{
			"depth": 2,
			"slug": "divergence-spells-itself-out",
			"text": "Divergence spells itself out"
		},
		{
			"depth": 2,
			"slug": "what-moves-where--nothing-is-lost",
			"text": "What moves where — nothing is lost"
		},
		{
			"depth": 2,
			"slug": "what-we-tried-first--and-backed-off",
			"text": "What we tried first — and backed off"
		}
	];
}
var url = "src/content/atlas/chrome-bar-declutter.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/chrome-bar-declutter.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/chrome-bar-declutter.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { CbStyles, Content, Content as default, Logo, file, frontmatter, getHeadings, url };
