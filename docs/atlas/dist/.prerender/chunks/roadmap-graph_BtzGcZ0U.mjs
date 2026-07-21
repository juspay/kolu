import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/content/atlas/roadmap-graph.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		li: "li",
		ol: "ol",
		p: "p",
		pre: "pre",
		span: "span",
		strong: "strong",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"This is infrastructure for exactly one operating model: ",
			createVNode(_components.a, {
				href: "https://kolu.dev/agent-fleets",
				children: createVNode(_components.strong, { children: "agent fleets" })
			}),
			" — one coordinator (running /orchestrator) dispatching worktree’d implementing agents, the human one layer up. The graph is ",
			createVNode(_components.strong, { children: "the coordinator’s dispatch substrate" }),
			", not a project-management tool: its one reader is the coordinator, a ripe node becomes a brief becomes a lane, and the human touches it at exactly two points — ",
			createVNode(_components.strong, { children: "judgment gates" }),
			" (the decisions only the human can make, surfaced as a queue) and ",
			createVNode(_components.strong, { children: "merges" }),
			". The SR campaign proved the thesis: when the graph is explicit (ids, dep edges, gates), the coordinator dispatches work without the human ordering it. What failed was that the graph’s ",
			createVNode(_components.em, { children: "facts" }),
			" lived in prose and the coordinator’s head — “what’s dispatchable?” hand-recomputed, gates checked by memory, odu’s drift invisible for a whole campaign. The cure is not a tracker; it is ",
			createVNode(_components.strong, { children: "one small file of inputs, and everything else computed" }),
			".",
			createVNode($$Footnote, { children: [
				"The schema below is the ",
				createVNode(_components.em, { children: "second" }),
				" draft: a lens run (",
				createVNode(_components.code, { children: "wf_f751c3e0-f75" }),
				", 13 raw → 10 confirmed findings) gutted the first. The three biggest kills: a single ",
				createVNode(_components.code, { children: "status" }),
				" field had ",
				createVNode(_components.strong, { children: "two writers" }),
				" (a sync tool could silently flip SR10’s dated decline to “shipped”); ",
				createVNode(_components.code, { children: "ships[]" }),
				" was specced as forge-derived, but the run verified ",
				createVNode(_components.strong, { children: "all ten campaign PRs carry zero PR-closes-issue edges" }),
				" — the edge doesn’t exist to walk; and storing ",
				createVNode(_components.code, { children: "ripe" }),
				"/",
				createVNode(_components.code, { children: "shipped" }),
				" at all was a cached derivation read back as truth (P1). Every field below exists in its corrected, one-writer form because of that run."
			] })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "user-facing-description",
			children: "User-facing description"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Per the fleet model’s three layers, “user” splits in two. ",
			createVNode(_components.strong, { children: "The human sees:" }),
			" the judgment-gate queue (",
			createVNode(_components.code, { children: "ripe" }),
			"’s ",
			createVNode(_components.code, { children: "JUDGMENT" }),
			" rows — DL2 below — are ",
			createVNode(_components.em, { children: "your" }),
			" inbox) and the merge queue; nothing else requires you. ",
			createVNode(_components.strong, { children: "The coordinator operates:" }),
			" ",
			createVNode(_components.code, { children: "ripe" }),
			" answers “what do I dispatch next,” each ripe node’s ",
			createVNode(_components.code, { children: "note:" }),
			" section is the brief’s plan-of-record, dispatch makes a lane (terminal + worktree + token — live facts the coordinator holds, never committed to the graph), a merged ",
			createVNode(_components.code, { children: "Ships:" }),
			" PR flips delivery. One file: ",
			createVNode(_components.code, { children: "docs/atlas/src/data/roadmap.yaml" }),
			" — ",
			createVNode(_components.strong, { children: "inputs only" }),
			", one writer per field:"
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
			"data-language": "yaml",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "- "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "id"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "SR8.b"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "  title"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "incremental per-key urgency fold"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "  note"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "surface-runtime-boundary#sr8b"
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "          # prose design; lint asserts it resolves"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "  deps"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": ["
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "SR8"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "]"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "  state"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": { "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "parked"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ",                       "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "# HUMAN-owned lifecycle union:"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "           gate"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": { "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "fact"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ",                 "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "#   active | parked | declined"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "                   text"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "a real workload where the scan matters"
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
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "                   check"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "roadmap/checks/sr8b.sh"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " } }"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "  ships"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": []                                    "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "# HUMAN-asserted PR list; sync only VERIFIES"
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
							style: { color: "#24292E" },
							children: "- "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "id"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "DL2"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "  title"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "the address bar follows focus"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "  note"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "deep-links"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "  deps"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": ["
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "DL1"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "]"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "  state"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": { "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "parked"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "gate"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": { "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "judgment"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "text"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"srid's go — history noise + IDs-on-screenshare accepted\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " } }"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#22863A" },
						children: "  ships"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: ": []"
					})]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "- "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "id"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "SR10"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "  title"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "the padi registry as signalMap"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "  note"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "surface-runtime-boundary#sr10"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "  deps"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": ["
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "SR7"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "SR8"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "SR9"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "]"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "  state"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": { "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "declined"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "date"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "2026-07-15"
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
					children: [
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "           revive"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": [{ "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "fact"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "text"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "a second writable-keyed-store consumer"
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
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "                    { "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "gate-of"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "id"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "SR8.b"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " },       "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "# cross-node edge, machine-visible"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "                    { "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "kind"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "fact"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#22863A" },
							children: "text"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ": "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "a stale-tile incident"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }] }"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#22863A" },
						children: "  ships"
					}), createVNode(_components.span, {
						style: { color: "#24292E" },
						children: ": []"
					})]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Nothing derived is ever written back." }),
			" ",
			createVNode(_components.code, { children: "ripe" }),
			", ",
			createVNode(_components.code, { children: "in-flight" }),
			", ",
			createVNode(_components.code, { children: "shipped" }),
			" are computed at every read from ",
			createVNode(_components.code, { children: "deps" }),
			" + ",
			createVNode(_components.code, { children: "ships" }),
			" + forge merge-state + the gate verdict:"
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
			"data-language": "plaintext",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "$ just roadmap::ripe          # forge snapshot: 2026-07-15T16:20Z (12m old)" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "RIPE      DL1        deps ✓ (—)          gate —            in-flight: #1840" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "RIPE      liveness   deps ✓ (SR8.c ✓)    gate —" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "JUDGMENT  DL2        deps ✓ (DL1 …)      awaiting: srid's go" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "PARKED    SR8.b      deps ✓ (SR8 ✓)      gate closed (sr8b.sh)" })
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, { children: "DECLINED  SR10       2026-07-15          3 revive triggers (1 = gate-of SR8.b)" })
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The plan notes stop hand-carrying the same facts: ",
			createVNode(_components.strong, { children: "the SR sequence table is generated from this yaml" }),
			" (an Astro component renders the whole table — id, title, deps, computed state chip stamped “as of ",
			createVNode(_components.code, { children: "<sync date>" }),
			"”, pairing column",
			createVNode($$Footnote, { children: "Renamed from the old table’s “gate” column (“drishti pair”/“none”) — that word now means exactly one thing: a ripeness precondition. The pairing requirement is a different fact and keeps its own name." }),
			"); prose keeps what prose is for — the design, the reasoning, the honest costs."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "architecture-level-changes",
			children: "Architecture-level changes"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "One writer per field (P3), the run’s headline fix:" }),
				" humans own ",
				createVNode(_components.code, { children: "state" }),
				" (a discriminated union — ",
				createVNode(_components.code, { children: "parked" }),
				" ",
				createVNode(_components.em, { children: "requires" }),
				" a gate, ",
				createVNode(_components.code, { children: "declined" }),
				" ",
				createVNode(_components.em, { children: "requires" }),
				" date+revive: the contradictions are unspellable, P4) and assert ",
				createVNode(_components.code, { children: "ships" }),
				"; ",
				createVNode(_components.code, { children: "roadmap::sync" }),
				" owns exactly two things — the forge merge-verdict ",
				createVNode(_components.em, { children: "cache" }),
				" for asserted PRs and one ",
				createVNode(_components.code, { children: "synced: {at}" }),
				" timestamp. Sync can never demote an adjudication; a human can never fake a merge."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Staleness is honest (P3, whose-clock):" }),
				" every rendered state chip carries “as of ",
				createVNode(_components.code, { children: "<synced.at>" }),
				"”; ",
				createVNode(_components.code, { children: "ripe" }),
				" prints the snapshot age. No freshness knob — just the date, the corpus’s own ",
				createVNode(_components.code, { children: "checked 2026-07-15" }),
				" pattern."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Gate checks are tristate and fail-fast (SR4’s doctrine applied):" }),
				" a valid verdict is exit 0 + stdout ",
				createVNode(_components.code, { children: "open" }),
				"|",
				createVNode(_components.code, { children: "closed" }),
				"; ",
				createVNode(_components.em, { children: "anything else" }),
				" (missing script, nonzero, garbage) ",
				createVNode(_components.strong, { children: "aborts" }),
				" ",
				createVNode(_components.code, { children: "ripe" }),
				" with the node id — a bit-rotted check can never silently read as “gate closed”. CI executes every declared check once per run, so breakage fails at commit time. A ",
				createVNode(_components.code, { children: "kind: fact" }),
				" gate without a ",
				createVNode(_components.code, { children: "check" }),
				" is a lint error (it’s a judgment wearing a fact label)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Cross-node edges are machine-visible (P5):" }),
				" ",
				createVNode(_components.code, { children: "gate-of" }),
				"/",
				createVNode(_components.code, { children: "revival" }),
				" references (SR10 ⇄ SR8.b’s mutual edge, today spelled only in English) join the graph; the lint rejects a dep or gate reference to a declined node unless the referencing arm declares it, and asserts both directions of a mutual reference resolve."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The lint closes the referential edges:" }),
				" dangling dep ids; ",
				createVNode(_components.code, { children: "note:" }),
				" anchors that don’t resolve in the rendered output; one PR number asserted under two nodes; plus the union’s own requirements. Sibling to ",
				createVNode(_components.code, { children: "atlas::check-sync" }),
				", same CI posture."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "GitHub keeps what it owns:" }),
				" issues stay the substrate for bugs and ledgers (odu#43); the yaml doesn’t mirror the forge — it holds the judgment facts the forge ",
				createVNode(_components.em, { children: "can’t" }),
				" express (gates, dated declines, revive triggers) and asserts the PR edge the forge provably doesn’t have."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "implementation-details",
			children: "Implementation details"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "rm1--the-file-the-commands-the-generated-table-one-pr",
			children: "RM1 — the file, the commands, the generated table (one PR)"
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.code, { children: "roadmap.yaml" }), " seeded with the live graph (the SR ledger, SR8.b, SR10, DL1/DL2, the liveness fix, pesu B0/B1) — a transcription pass, no invention."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "just roadmap::ripe" }),
				" (compute frontier; tristate gate protocol; snapshot-age header) and ",
				createVNode(_components.code, { children: "just roadmap::sync" }),
				" (verify asserted ships against the forge; write the merge-verdict cache + ",
				createVNode(_components.code, { children: "synced.at" }),
				"; committed, so the Atlas build stays deterministic — no network at build time)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The lint (",
				createVNode(_components.code, { children: "ci::roadmap" }),
				"), covering every check named above, wired beside ",
				createVNode(_components.code, { children: "atlas-sync" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The Astro component: the SR sequence table generated from data; the hand-authored ships/gate cells deleted from the markdown (the drift pair dies); per-node state chips available to any note via the ",
				createVNode(_components.code, { children: "note:" }),
				" back-edge."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"PR-body convention going forward: a ",
				createVNode(_components.code, { children: "Ships: <track-id>" }),
				" line, so assertion is one grep — recorded in the conventions, not enforced retroactively."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "prior-art-in-repo--pr-760s-task-management-proposal",
			children: "Prior art in-repo — PR #760’s task-management proposal"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The open contributor proposal (",
			createVNode("a", {
				href: "https://github.com/juspay/kolu/pull/760",
				children: "#760"
			}),
			", pre-Atlas era) independently articulated this note’s governing law — ",
			createVNode(_components.em, { children: "“Kolu has agency over IO; Kolu has no agency over semantics: the user is the brain, Kolu is the hands”" }),
			" — and its mockup’s “terminal canvas with task tags” is RM2’s node-to-lane-terminal link, converged on from the other direction. The scopes are complementary, not competing: #760 is a ",
			createVNode(_components.strong, { children: "user’s personal intent" }),
			" layer (freeform kanban lanes, obsidian-format markdown — right for human tasks), this note is the ",
			createVNode(_components.strong, { children: "repo’s adjudicated work graph" }),
			" (a fixed lifecycle union, machine-checkable gates — right for dispatch). If both ship, the repo’s roadmap renders as one project board in that UI."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "rm2--the-live-surface-gated-on-srids-go-after-rm1-soaks",
			children: ["RM2 — the live surface ", createVNode(_components.em, { children: "(gated on srid’s go, after RM1 soaks)" })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The fleet page’s shape, rendered: serve the computed graph as a surface collection and join it with padi’s live agent-state — the frontier on the canvas, each node deep-linking (DL1’s grammar) to its note section and, when its lane is live, its terminal with the real ",
			createVNode(_components.code, { children: "working" }),
			"/",
			createVNode(_components.code, { children: "awaiting" }),
			"/",
			createVNode(_components.code, { children: "waiting" }),
			" state beside it. Observation flows out freely (the human watches the whole fleet through the graph); action still flows in through the coordinator’s one door. The hand-maintained dashboard shrinks to what only the coordinator knows (in-flight conversation state); everything the graph and padi know renders itself."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "The Roadmap Graph",
	"description": "The coordinator's dispatch substrate for agent fleets — one yaml of inputs (deps, gates, human lifecycle, asserted ships), everything else computed: ripe answers what the coordinator dispatches next, a node becomes a brief becomes a lane, and the human's whole view is the judgment-gate queue plus the merge queue.",
	"parents": ["feature"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-15T00:00:00.000Z"
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
		},
		{
			"depth": 3,
			"slug": "rm1--the-file-the-commands-the-generated-table-one-pr",
			"text": "RM1 — the file, the commands, the generated table (one PR)"
		},
		{
			"depth": 3,
			"slug": "prior-art-in-repo--pr-760s-task-management-proposal",
			"text": "Prior art in-repo — PR #760’s task-management proposal"
		},
		{
			"depth": 3,
			"slug": "rm2--the-live-surface-gated-on-srids-go-after-rm1-soaks",
			"text": "RM2 — the live surface (gated on srid’s go, after RM1 soaks)"
		}
	];
}
var url = "src/content/atlas/roadmap-graph.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/roadmap-graph.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/roadmap-graph.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
