import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
//#region src/content/atlas/dynamic-workflow-viewer.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
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
	const { Fragment: Fragment$1 } = _components;
	if (!Fragment$1) _missingMdxReference("Fragment", true);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"Analysis of a live ",
			createVNode(_components.code, { children: "do-wf" }),
			" run in ",
			createVNode(_components.code, { children: "drishti/.worktrees/hm" }),
			", generalized to the\nreal case: ",
			createVNode(_components.strong, { children: "a session holds many workflow runs at once — some running, some\nfinished" }),
			". Two-phase proposal, revised after hickey + lowy."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "danger",
			title: "Headline",
			children: createVNode(_components.p, { children: [
				"kolu already knew a workflow was running — it just couldn’t say ",
				createVNode(_components.em, { children: "which" }),
				" one or\n",
				createVNode(_components.em, { children: "how many" }),
				" agents. The running state worked (it comes from the transcript, not\nthe journal). The ",
				createVNode(_components.em, { children: "enrichment" }),
				" was what was broken (until ",
				createVNode($$PrLink, { pr: 1124 }),
				",\nmerged 2026-06-02): ",
				createVNode(_components.code, { children: "deriveWorkflowProgress()" }),
				" read a journal file that no\nlonger exists, returned ",
				createVNode(_components.code, { children: "null" }),
				", so the name/fan-out badge stayed dark. The part\nthat still stands: the model is single-run — even with the reader fixed, it\ncollapses a session’s whole history to one entry. ",
				createVNode(_components.em, { children: [
					"(verified against the\npre-#1124 reader: it read one dead ",
					createVNode(_components.code, { children: "workflows/<runId>.json" }),
					"; state was set\nseparately.)"
				] })
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Precisely what failed (fixed in #1124)",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "deriveState" }),
				" promoted ",
				createVNode(_components.code, { children: "waiting → running_background" }),
				" purely from the\nmain-transcript launch marker via ",
				createVNode(_components.code, { children: "outstandingBackgroundTasks()" }),
				" — ",
				createVNode(_components.strong, { children: "no journal\nread" }),
				". So the spinner + “Running in background” label already rendered. The\njournal was read ",
				createVNode(_components.em, { children: "only" }),
				" to fill the ",
				createVNode(_components.code, { children: "workflow" }),
				" field, and ",
				createVNode(_components.code, { children: "agentWorkflow()" }),
				"\nneeds ",
				createVNode(_components.em, { children: "both" }),
				" ",
				createVNode(_components.code, { children: "state===running_background" }),
				" ",
				createVNode(_components.em, { children: "and" }),
				" ",
				createVNode(_components.code, { children: "workflow!=null" }),
				". State was\ntrue; ",
				createVNode(_components.code, { children: "workflow" }),
				" was null → the ",
				createVNode(_components.code, { children: "do-wf · 5 agents" }),
				" badge and the “Workflow”\ninspector row were the only things dark. ",
				createVNode($$PrLink, { pr: 1124 }),
				" repointed the\nreader and made the promotion journal-aware, so the ",
				createVNode(_components.code, { children: "workflow" }),
				" field is now\npopulated during a live run."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "multiplicity-is-the-normal-case-verified",
			children: "Multiplicity is the normal case (verified)"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Session" }),
					"\n",
					createVNode(_components.th, { children: "Workflow runs" }),
					"\n",
					createVNode(_components.th, { children: "Fan-out" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "agency/…/cc-workflow" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "2" }),
						" runs (",
						createVNode(_components.code, { children: "wf_84c9119d" }),
						", ",
						createVNode(_components.code, { children: "wf_e6f94ccf" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: "4 agents, 14 agents" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "kolu/…/modest-runner" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "3" }), " runs"] }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "drishti/…/hm (live)" }) }),
					"\n",
					createVNode(_components.td, { children: "1 run, in flight" }),
					"\n",
					createVNode(_components.td, { children: "6 started / 5 done" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"So the UI target is a ",
			createVNode(_components.strong, { children: "list" }),
			" of runs per session, each with its own status and\ntimeline — not a single badge value."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-a-dynamic-workflow-writes-and-where-status-lives",
			children: "What a dynamic workflow writes, and where status lives"
		}),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"plaintext\"><code><span class=\"line\"><span>~/.claude/projects/&#x3C;encoded-cwd>/&#x3C;session>.jsonl              # main transcript — launch markers + completion notifications</span></span>\n<span class=\"line\"><span>~/.claude/projects/&#x3C;encoded-cwd>/&#x3C;session>/</span></span>\n<span class=\"line\"><span>├── workflows/scripts/&#x3C;name>-&#x3C;runId>.js                       # persisted script — meta.name + meta.phases[]</span></span>\n<span class=\"line\"><span>└── subagents/workflows/</span></span>\n<span class=\"line\"><span>    ├── wf_84c9119d-127/  journal.jsonl + agent-*.jsonl       # run 1</span></span>\n<span class=\"line\"><span>    └── wf_e6f94ccf-a1f/  journal.jsonl + agent-*.jsonl       # run 2 …</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"The three discrepancies vs. kolu’s reader at the time (all verified; since fixed\nby ",
			createVNode($$PrLink, { pr: 1124 }),
			"):"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "kolu assumes" }),
					"\n",
					createVNode(_components.th, { children: "On disk" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["One journal at ", createVNode(_components.code, { children: "<session>/workflows/<runId>.json" })] }),
					"\n",
					createVNode(_components.td, { children: ["Many at ", createVNode(_components.code, { children: "<session>/subagents/workflows/<runId>/journal.jsonl" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: ["Snapshot object ", createVNode(_components.code, { children: "{workflowName,status,agentCount}" })] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Event log" }),
						": ",
						createVNode(_components.code, { children: "{type:\"started\",agentId}" }),
						" / ",
						createVNode(_components.code, { children: "{type:\"result\",agentId,result:{status,…}}" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Name + status live in the journal" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "name" }),
						" only in the script meta; ",
						createVNode(_components.strong, { children: "workflow-level status is NOT in the journal at all" })
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "The subtle one — status is a transcript fact, not a journal fact",
			children: createVNode(_components.p, { children: [
				"The journal records per-",
				createVNode(_components.em, { children: "agent" }),
				" started/result, never a “workflow finished”\nevent. In the live drishti run, 5 agents ",
				createVNode(_components.em, { children: "resulted" }),
				" while the workflow is still\ngoing (between phases). So “all started agents resulted ⇒ completed” reports\n",
				createVNode(_components.strong, { children: "false completions between phases" }),
				". The authoritative signal is in the main\ntranscript: a ",
				createVNode(_components.code, { children: "<task-notification>" }),
				" carrying ",
				createVNode(_components.code, { children: "<status>completed</status>" }),
				", keyed\nby the launch ",
				createVNode(_components.code, { children: "Task ID" }),
				", linked to the ",
				createVNode(_components.code, { children: "Run ID" }),
				" in the same launch marker. kolu\nalready pairs Task↔Run IDs at ",
				createVNode(_components.code, { children: "core.ts:419, 478" }),
				"."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "proposal--two-phases-each-shippable-alone",
			children: "Proposal — two phases, each shippable alone"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "phase-1--repoint-the-reader-name--fan-out-count-appear-shipped",
			children: ["Phase 1 — repoint the reader (name + fan-out count appear) ", createVNode($$Pill, {
				variant: "done",
				children: "shipped"
			})]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Shipped in ",
			createVNode($$PrLink, { pr: 1124 }),
			" (merged 2026-06-02; hardening follow-ups in\n",
			createVNode($$PrLink, { pr: 1130 }),
			" and ",
			createVNode($$PrLink, { pr: 1157 }),
			"). Bug-fix-shaped, almost entirely\nin ",
			createVNode(_components.code, { children: "core.ts" }),
			"; no UI change. They already consume\n",
			createVNode(_components.code, { children: "ClaudeWorkflow {name,status,agents}" }),
			" (",
			createVNode(_components.code, { children: "agentDisplay.ts:42-44" }),
			",\n",
			createVNode(_components.code, { children: "TerminalMeta.tsx:78-80" }),
			", ",
			createVNode(_components.code, { children: "MetadataInspector.tsx:194-205" }),
			"):"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				"Point the journal path at ",
				createVNode(_components.code, { children: "subagents/workflows/<runId>/journal.jsonl" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Read the event log: ",
				createVNode(_components.code, { children: "agents" }),
				" = distinct ",
				createVNode(_components.code, { children: "started" }),
				" agentIds; ",
				createVNode(_components.code, { children: "name" }),
				" from the script meta."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Status comes from the transcript, not the journal." }),
				" A run is ",
				createVNode(_components.code, { children: "running" }),
				" iff its taskId is still in ",
				createVNode(_components.code, { children: "outstandingBackgroundTasks()" }),
				"; ",
				createVNode(_components.code, { children: "completed" }),
				"/",
				createVNode(_components.code, { children: "failed" }),
				" once its terminal ",
				createVNode(_components.code, { children: "<task-notification>" }),
				" is seen. No new “all-agents-done” heuristic."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "phase-2--a-list-of-workflow-runs-with-live-timelines-in-the-inspector-tab",
			children: "Phase 2 — a list of workflow runs with live timelines, in the Inspector tab"
		}),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Rendered prototype" }), " — a session’s runs, newest first; running auto-expanded,\nfinished collapsed to a summary you can open:"] }),
		"\n",
		createVNode("div", {
			style: {
				background: "#161b22",
				border: "1px solid #30363d",
				borderRadius: "10px",
				overflow: "hidden",
				margin: "1.2rem 0",
				fontSize: "13px",
				color: "#e6edf3",
				fontFamily: "ui-sans-serif,system-ui"
			},
			children: [createVNode("div", {
				style: {
					display: "flex",
					borderBottom: "1px solid #30363d",
					background: "#1c2128"
				},
				children: [createVNode("div", {
					style: {
						padding: "9px 16px",
						color: "#e6edf3",
						boxShadow: "inset 0 -2px 0 #58a6ff",
						fontSize: "12.5px"
					},
					children: "Inspector"
				}), createVNode("div", {
					style: {
						padding: "9px 16px",
						color: "#9198a1",
						fontSize: "12.5px"
					},
					children: "Code"
				})]
			}), createVNode("div", {
				style: { padding: "14px 16px" },
				children: [
					createVNode("div", {
						style: {
							display: "flex",
							gap: "10px",
							padding: "5px 0"
						},
						children: [createVNode("span", {
							style: {
								color: "#9198a1",
								minWidth: "96px"
							},
							children: "Kind"
						}), createVNode(_components.span, { children: "claude-code" })]
					}),
					createVNode("div", {
						style: {
							display: "flex",
							gap: "10px",
							padding: "5px 0"
						},
						children: [createVNode("span", {
							style: {
								color: "#9198a1",
								minWidth: "96px"
							},
							children: "State"
						}), createVNode("span", {
							style: {
								color: "#d29922",
								border: "1px solid #d29922",
								borderRadius: "10px",
								padding: "1px 7px",
								fontSize: "11px",
								fontFamily: "ui-monospace,monospace"
							},
							children: "running in background"
						})]
					}),
					createVNode("div", {
						style: {
							display: "flex",
							gap: "10px",
							padding: "5px 0"
						},
						children: [createVNode("span", {
							style: {
								color: "#9198a1",
								minWidth: "96px"
							},
							children: "Workflows"
						}), createVNode("span", {
							style: { color: "#9198a1" },
							children: "3 runs · 1 running"
						})]
					}),
					createVNode("div", {
						style: {
							marginTop: "8px",
							display: "flex",
							flexDirection: "column",
							gap: "8px"
						},
						children: [
							createVNode("div", {
								style: {
									border: "1px solid #30363d",
									borderRadius: "8px",
									overflow: "hidden"
								},
								children: [createVNode("div", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: "8px",
										padding: "8px 11px",
										background: "#1c2128"
									},
									children: [
										createVNode("span", { style: {
											width: "7px",
											height: "7px",
											borderRadius: "50%",
											background: "#d29922",
											boxShadow: "0 0 0 3px rgba(210,153,34,.18)"
										} }),
										createVNode("span", {
											style: {
												fontFamily: "ui-monospace,monospace",
												color: "#bc8cff"
											},
											children: "do-wf"
										}),
										createVNode("span", {
											style: {
												color: "#d29922",
												border: "1px solid #d29922",
												borderRadius: "10px",
												padding: "1px 7px",
												fontSize: "11px",
												fontFamily: "ui-monospace,monospace"
											},
											children: "running"
										}),
										createVNode("span", {
											style: {
												color: "#6e7681",
												fontSize: "11.5px"
											},
											children: "6 agents · 4m elapsed"
										}),
										createVNode("span", {
											style: {
												color: "#6e7681",
												marginLeft: "auto",
												fontSize: "11px"
											},
											children: "▾"
										})
									]
								}), createVNode("div", {
									style: {
										padding: "8px 12px 12px",
										borderLeft: "2px solid #30363d",
										margin: "8px 0 0 14px"
									},
									children: [
										createVNode("div", {
											style: {
												display: "flex",
												alignItems: "center",
												gap: "8px",
												padding: "5px 0 5px 12px",
												marginLeft: "-14px",
												borderLeft: "2px solid #3fb950"
											},
											children: [createVNode("span", {
												style: {
													fontWeight: 600,
													fontSize: "12.5px"
												},
												children: "Sync · Research · Implement"
											}), createVNode("span", {
												style: {
													color: "#6e7681",
													fontSize: "11.5px"
												},
												children: "done"
											})]
										}),
										createVNode("div", {
											style: {
												display: "flex",
												alignItems: "center",
												gap: "8px",
												padding: "5px 0 5px 12px",
												marginLeft: "-14px",
												borderLeft: "2px solid #d29922"
											},
											children: [
												createVNode("span", { style: {
													width: "7px",
													height: "7px",
													borderRadius: "50%",
													background: "#d29922"
												} }),
												createVNode("span", {
													style: {
														fontWeight: 600,
														fontSize: "12.5px"
													},
													children: "Check"
												}),
												createVNode("span", {
													style: {
														color: "#6e7681",
														fontSize: "11.5px"
													},
													children: "static-correctness gate"
												})
											]
										}),
										createVNode("div", {
											style: {
												display: "flex",
												alignItems: "center",
												gap: "9px",
												padding: "4px 0 4px 26px",
												fontSize: "12px"
											},
											children: [
												createVNode("span", {
													style: {
														fontFamily: "ui-monospace,monospace",
														color: "#58a6ff",
														minWidth: "96px"
													},
													children: "a9b4…61c0"
												}),
												createVNode("div", {
													style: {
														flex: 1,
														height: "6px",
														background: "#010409",
														borderRadius: "3px",
														overflow: "hidden"
													},
													children: createVNode("div", { style: {
														height: "100%",
														width: "20%",
														marginLeft: "80%",
														background: "#d29922"
													} })
												}),
												createVNode("span", {
													style: {
														color: "#6e7681",
														fontFamily: "ui-monospace,monospace"
													},
													children: "…"
												})
											]
										}),
										createVNode("div", {
											style: {
												display: "flex",
												alignItems: "center",
												gap: "8px",
												padding: "5px 0 5px 12px",
												marginLeft: "-14px",
												borderLeft: "2px solid #30363d"
											},
											children: [createVNode("span", {
												style: {
													color: "#9198a1",
													fontWeight: 600,
													fontSize: "12.5px"
												},
												children: "Docs · Format · Commit · Review · …"
											}), createVNode("span", {
												style: {
													color: "#6e7681",
													fontSize: "11.5px"
												},
												children: "9 phases pending"
											})]
										})
									]
								})]
							}),
							createVNode("div", {
								style: {
									border: "1px solid #30363d",
									borderRadius: "8px",
									overflow: "hidden"
								},
								children: [createVNode("div", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: "8px",
										padding: "8px 11px",
										background: "#1c2128"
									},
									children: [
										createVNode("span", { style: {
											width: "7px",
											height: "7px",
											borderRadius: "50%",
											background: "#3fb950"
										} }),
										createVNode("span", {
											style: {
												fontFamily: "ui-monospace,monospace",
												color: "#bc8cff"
											},
											children: "deep-research"
										}),
										createVNode("span", {
											style: {
												color: "#3fb950",
												border: "1px solid #3fb950",
												borderRadius: "10px",
												padding: "1px 7px",
												fontSize: "11px",
												fontFamily: "ui-monospace,monospace"
											},
											children: "completed"
										}),
										createVNode("span", {
											style: {
												color: "#6e7681",
												fontSize: "11.5px"
											},
											children: "14 agents · 6m12s"
										}),
										createVNode("span", {
											style: {
												color: "#6e7681",
												marginLeft: "auto",
												fontSize: "11px"
											},
											children: "▸"
										})
									]
								}), createVNode("div", {
									style: {
										padding: "6px 12px 10px 26px",
										color: "#6e7681",
										fontSize: "11.5px"
									},
									children: "finished 12m ago · click to expand timeline & per-agent transcripts"
								})]
							}),
							createVNode("div", {
								style: {
									border: "1px solid #30363d",
									borderRadius: "8px",
									overflow: "hidden"
								},
								children: [createVNode("div", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: "8px",
										padding: "8px 11px",
										background: "#1c2128"
									},
									children: [
										createVNode("span", { style: {
											width: "7px",
											height: "7px",
											borderRadius: "50%",
											background: "#f85149"
										} }),
										createVNode("span", {
											style: {
												fontFamily: "ui-monospace,monospace",
												color: "#bc8cff"
											},
											children: "do-wf"
										}),
										createVNode("span", {
											style: {
												color: "#f85149",
												border: "1px solid #f85149",
												borderRadius: "10px",
												padding: "1px 7px",
												fontSize: "11px",
												fontFamily: "ui-monospace,monospace"
											},
											children: "failed"
										}),
										createVNode("span", {
											style: {
												color: "#6e7681",
												fontSize: "11.5px"
											},
											children: "4 agents · 1m03s"
										}),
										createVNode("span", {
											style: {
												color: "#6e7681",
												marginLeft: "auto",
												fontSize: "11px"
											},
											children: "▸"
										})
									]
								}), createVNode("div", {
									style: {
										padding: "6px 12px 10px 26px",
										color: "#6e7681",
										fontSize: "11.5px"
									},
									children: "failed at Check (1 agent failed) · click to expand"
								})]
							})
						]
					}),
					createVNode("div", {
						style: {
							color: "#6e7681",
							fontSize: "11px",
							marginTop: "10px"
						},
						children: "▸ click an agent → opens its transcript (reuses parseClaudeCodeJsonl → TranscriptEvent[] renderer)"
					})
				]
			})]
		}),
		"\n",
		createVNode(_components.p, { children: "Wiring (shaped by the review pass below):" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "On-demand fetch, returning a list." }),
				" A new RPC ",
				createVNode(_components.code, { children: "loadWorkflowRuns(session)" }),
				" ",
				createVNode(_components.em, { children: "enumerates" }),
				" ",
				createVNode(_components.code, { children: "subagents/workflows/wf_*/" }),
				" and returns ",
				createVNode(_components.code, { children: "WorkflowRun[]" }),
				" — each ",
				createVNode(_components.code, { children: "{runId, name, status, startedEpoch, endedEpoch, agents[]}" }),
				". Mirrors the existing ",
				createVNode(_components.code, { children: "exportTranscriptHtml" }),
				"/",
				createVNode(_components.code, { children: "loadClaudeCodeTranscript" }),
				" pull pattern."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Live metadata stays scalar." }),
				" ",
				createVNode(_components.code, { children: "ClaudeCodeInfo" }),
				" still carries only the single running-run summary (plus optionally a small “N runs” count) — the full list is never on the firehose."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Per-agent transcript reuses the canonical seam." }),
				" ",
				createVNode(_components.code, { children: "agent-<id>.jsonl" }),
				" is a normal transcript → ",
				createVNode(_components.code, { children: "parseClaudeCodeJsonl()" }),
				" → ",
				createVNode(_components.code, { children: "TranscriptEvent[]" }),
				" → existing ",
				createVNode(_components.code, { children: "kolu-transcript-html" }),
				" renderer. No parallel event schema."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-the-hickey--lowy-pass-changed",
			children: "What the hickey + lowy pass changed"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Reuse the transcript IR seam (lowy headline)",
			children: createVNode(_components.p, { children: [
				"Claude JSONL is already normalized to ",
				createVNode(_components.code, { children: "TranscriptEvent[]" }),
				" with sub-agent\nboundaries. The per-agent transcript view consumes that; only the journal (a\ndistinct runtime format) gets its own tiny reader."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Keep ClaudeWorkflow scalar; never put the run list on live metadata",
			children: createVNode(_components.p, { children: [
				"A list of full runs on the firehose would bloat every metadata tick and multiply\nthe unenforced “",
				createVNode(_components.code, { children: "workflow" }),
				" non-null only while ",
				createVNode(_components.code, { children: "running_background" }),
				"” invariant\nalready split across a write gate and a read gate. Fetched on demand instead."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "No new right-panel tab (lowy)",
			children: createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "RightPanelTabKindSchema = z.enum([\"inspector\",\"code\"])" }),
				" is a wire contract with\npersisted ",
				createVNode(_components.code, { children: "activeTab" }),
				" + session restore — adding a kind is a protocol change. The\nrun list lives inside the existing Inspector tab."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Two honest gaps",
			children: createVNode(_components.p, { children: [
				"(1) The journal doesn’t tag each agent with its phase — grouping is inferred from\nstart order against ",
				createVNode(_components.code, { children: "meta.phases" }),
				", reliable for a sequential pipeline like\n",
				createVNode(_components.code, { children: "do-wf" }),
				" but not arbitrary ",
				createVNode(_components.code, { children: "parallel()" }),
				" fan-out. Fallback: a flat agent timeline +\nthe declared phase strip; the real fix is the runtime stamping ",
				createVNode(_components.code, { children: "phase" }),
				" into the\njournal (upstream). (2) Status for an ",
				createVNode(_components.em, { children: "old" }),
				" completed run needs the terminal\nnotification, which may have scrolled out of the transcript tail — so the status\nscan must read the full transcript (or treat dir-present + not-outstanding as\ncompleted)."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "cut-line",
			children: "Cut line"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Phase 1 shipped in ",
			createVNode($$PrLink, { pr: 1124 }),
			" (2026-06-02): a small correction that\nmade the already-built surface work for the first time, showing the active run.\nPhase 2 — the multi-run list + timelines in the Inspector — is what remains, and\nis independently reviewable. When ready, drive it with ",
			createVNode(_components.code, { children: "/do" }),
			"."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
function _missingMdxReference(id, component) {
	throw new Error("Expected " + (component ? "component" : "object") + " `" + id + "` to be defined: you likely forgot to import, pass, or provide it.");
}
var frontmatter = {
	"title": "Workflow viewer",
	"description": "Integrating Claude Code dynamic-workflow JSONL into kolu — surfacing fan-out runs on the tile chrome and an Inspector run-list with live timelines.",
	"parents": ["feature"],
	"maturity": "budding",
	"updated": "2026-06-10T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "multiplicity-is-the-normal-case-verified",
			"text": "Multiplicity is the normal case (verified)"
		},
		{
			"depth": 2,
			"slug": "what-a-dynamic-workflow-writes-and-where-status-lives",
			"text": "What a dynamic workflow writes, and where status lives"
		},
		{
			"depth": 2,
			"slug": "proposal--two-phases-each-shippable-alone",
			"text": "Proposal — two phases, each shippable alone"
		},
		{
			"depth": 3,
			"slug": "phase-1--repoint-the-reader-name--fan-out-count-appear-shipped",
			"text": "Phase 1 — repoint the reader (name + fan-out count appear) shipped"
		},
		{
			"depth": 3,
			"slug": "phase-2--a-list-of-workflow-runs-with-live-timelines-in-the-inspector-tab",
			"text": "Phase 2 — a list of workflow runs with live timelines, in the Inspector tab"
		},
		{
			"depth": 2,
			"slug": "what-the-hickey--lowy-pass-changed",
			"text": "What the hickey + lowy pass changed"
		},
		{
			"depth": 2,
			"slug": "cut-line",
			"text": "Cut line"
		}
	];
}
var url = "src/content/atlas/dynamic-workflow-viewer.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/dynamic-workflow-viewer.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/dynamic-workflow-viewer.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
