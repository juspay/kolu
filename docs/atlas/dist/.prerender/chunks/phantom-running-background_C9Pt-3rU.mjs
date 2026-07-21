import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
//#region src/content/atlas/phantom-running-background.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		hr: "hr",
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
			"Diagnosis & fix plan · ",
			createVNode(_components.strong, { children: ["implemented in ", createVNode($$PrLink, { pr: 1109 })] }),
			" · introduced by\n",
			createVNode($$PrLink, { pr: 1015 }),
			" · the background-task sibling of ",
			createVNode(_components.a, {
				href: "https://github.com/juspay/kolu/issues/1017",
				children: "#1017"
			}),
			"\n· verified against the live ",
			createVNode(_components.code, { children: "reload-html" }),
			" transcript, the on-disk task artifacts,\nand a 13-agent design/adversarial-verify pass."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Shipped (#1109)",
			children: createVNode(_components.p, { children: [
				"Both layers — the pure ",
				createVNode(_components.code, { children: "deriveState" }),
				" narrowing (promote only ",
				createVNode(_components.code, { children: "runId" }),
				"-bearing\n",
				createVNode(_components.code, { children: "Workflow" }),
				" runs) ",
				createVNode(_components.em, { children: "and" }),
				" the watcher-side ",
				createVNode(_components.code, { children: "liveOutstandingTasks" }),
				" gate, which drops a\n",
				createVNode(_components.code, { children: "Workflow" }),
				" once kolu can no longer observe it live (journal reads terminal, or\nits liveness anchor aged past ",
				createVNode(_components.code, { children: "WORKFLOW_JOURNAL_STALE_MS" }),
				"). ",
				createVNode(_components.strong, { children: "Hardened in codex\nreview" }),
				" on two real gaps: (1) a one-shot ",
				createVNode(_components.em, { children: "stale-deadline timer" }),
				"\n(",
				createVNode(_components.code, { children: "nextWorkflowStaleDeadline" }),
				") re-derives when wall-clock crosses the threshold\nwith no fs-event; (2) the anchor (",
				createVNode(_components.code, { children: "workflowStaleAnchorMs" }),
				" — journal mtime →\n",
				createVNode(_components.code, { children: "workflows/" }),
				"-dir mtime → null, ",
				createVNode(_components.em, { children: "never" }),
				" ",
				createVNode(_components.code, { children: "now" }),
				") gives a missing/churned-path\njournal a ",
				createVNode(_components.em, { children: "bounded" }),
				" grace that genuinely expires. The reported Bash orphan and\nthe Workflow-orphan-after-restart both close. Covered by flipped + new unit tests\nand three e2e scenarios (",
				createVNode(_components.code, { children: "background_bash" }),
				", ",
				createVNode(_components.code, { children: "orphaned_workflow" }),
				",\n",
				createVNode(_components.code, { children: "journalless_workflow" }),
				")."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "danger",
			title: "Root cause",
			children: [createVNode(_components.p, { children: [
				"The ",
				createVNode(_components.code, { children: "waiting → running_background" }),
				" promotion is ",
				createVNode(_components.em, { children: "unconditional" }),
				". A background\nlaunch marker with no matching completion is treated as “a task is still\nrunning” — forever — and the completion can never arrive once the Claude process\nthat launched it is gone."
			] }), createVNode(_components.p, { children: [
				createVNode(_components.code, { children: "deriveState" }),
				" promotes ",
				createVNode(_components.code, { children: "waiting" }),
				" to ",
				createVNode(_components.code, { children: "running_background" }),
				" whenever\n",
				createVNode(_components.code, { children: "outstandingBackgroundTasks(lines)" }),
				" is non-empty (",
				createVNode(_components.code, { children: "core.ts:383-386" }),
				"), with no\nliveness/staleness gate. The completion ",
				createVNode(_components.code, { children: "<task-notification>" }),
				" is only ever written\nby the ",
				createVNode(_components.em, { children: "live" }),
				" Claude child when the backgrounded process exits. Claude\nauto-backgrounded a ",
				createVNode(_components.code, { children: "just ai::apm" }),
				" Bash command after a timeout, then the user\n",
				createVNode(_components.strong, { children: "restarted Claude" }),
				" — orphaning that child. Its completion can never be written,\nthe launch line is permanent, so the set stays non-empty and the spinner is\npermanent. Restarting re-reads the same stale JSONL and re-derives the identical\nverdict."
			] })]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "the-report-reproduced",
			children: "The report, reproduced"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"kolu showed the ",
			createVNode(_components.code, { children: "reload-html" }),
			" worktree with the spinning “working” pip, and it\nstayed lit after the user restarted Claude. The transcript tells the story:"
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
			"data-language": "bash",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#6F42C1" },
						children: "$"
					}), createVNode(_components.span, {
						style: { color: "#032F62" },
						children: " F=~/.claude/projects/-home-srid-code-kolu--worktrees-reload-html/c43efadd-….jsonl"
					})]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "# newest real assistant message → end_turn (this alone = \"waiting\", no spinner)"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "{"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "\"type\""
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "\"assistant\""
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: ","
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "\"stop_reason\""
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "\"end_turn\""
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: ","
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "\"ts\""
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "\"2026-06-01T22:29:26.464Z\""
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "}"
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
						children: "# but line 1177 launched a background command, and it never completed:"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "$"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " grep"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " -o"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " 'Command running in background with ID: [a-z0-9]*'"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "$F"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\""
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "Command"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " running"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " in"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " background"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " with"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " ID:"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " bi8olsr8z"
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "          # `just ai::apm >/tmp/apm2.log 2>&1`, auto-backgrounded"
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
							style: { color: "#6F42C1" },
							children: "$"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " grep"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " -c"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " 'task-id>bi8olsr8z'"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "$F"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\""
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#6F42C1" },
						children: "0"
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "                                                          # ← zero completions for this id, anywhere in 3.6 MB"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "$"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " grep"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " -oE"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " '<status>completed</status>'"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "$F"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " wc"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " -l"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#6F42C1" },
						children: "17"
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "                                                         # 17 completions exist — all for OTHER task ids"
					})]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The decisive corroboration that the task is ",
			createVNode(_components.em, { children: "dead" }),
			", not running: ",
			createVNode(_components.strong, { children: "after" }),
			" the\n20:52 launch the agent serviced two more human turns (“Merged! I’ll test it next\nPRs” at 21:13, “ok” at 22:29) and ended each with ",
			createVNode(_components.code, { children: "stop_reason=\"end_turn\"" }),
			", 96.7\nminutes apart. A genuine busy-wait does not sit there servicing new prompts."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "how-the-promotion-is-wired",
			children: "How the promotion is wired"
		}),
		"\n",
		createVNode(_components.p, { children: "Nothing on this path consults wall-clock time or process liveness:" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "tail 256 KB of JSONL" }),
			" → ",
			createVNode(_components.code, { children: "outstandingBackgroundTasks" }),
			" → ",
			createVNode(_components.code, { children: "[bi8olsr8z]" }),
			" (never completes) → ",
			createVNode(_components.code, { children: "deriveState" }),
			" → ",
			createVNode(_components.code, { children: "waiting → running_background" }),
			" → ",
			createVNode(_components.code, { children: "isWorkingState" }),
			" → ",
			createVNode(_components.code, { children: "working" }),
			" bucket → ",
			createVNode(_components.code, { children: "working" }),
			" pip → ",
			createVNode(_components.code, { children: "animate-spin" }),
			" (",
			createVNode(_components.code, { children: "RowPips.tsx:143-144" }),
			")"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The promotion exists for a real feature — ",
			createVNode(_components.strong, { children: "dynamic-workflow fan-out" }),
			": when the\nagent launches a background task and yields its turn (",
			createVNode(_components.code, { children: "end_turn" }),
			") while genuinely\nbusy-waiting, bare ",
			createVNode(_components.code, { children: "waiting" }),
			" would wrongly read as idle. The defect is that it has\n",
			createVNode(_components.strong, { children: "no exit condition other than a completion marker an orphaned task can never\nproduce" }),
			"."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-was-verified",
			children: "What was verified"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Claim" }),
					"\n",
					createVNode(_components.th, { children: "Status" }),
					"\n",
					createVNode(_components.th, { children: "Source" }),
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
						createVNode(_components.code, { children: "deriveState" }),
						" promotes ",
						createVNode(_components.code, { children: "waiting" }),
						"→",
						createVNode(_components.code, { children: "running_background" }),
						" unconditionally on any outstanding task"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "bad",
						children: "the bug"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "core.ts:383-386" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "outstandingBackgroundTasks" }), " reconciles launched − completed from JSONL markers; no staleness check"] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "good",
						children: "true"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "core.ts:441-487" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"For orphaned ",
						createVNode(_components.code, { children: "bi8olsr8z" }),
						" the completion is absent (",
						createVNode(_components.code, { children: "grep -c" }),
						" ⇒ 0); the launch line is permanent"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "good",
						children: "true"
					}) }),
					"\n",
					createVNode(_components.td, { children: ["transcript line 1177; ", createVNode(_components.code, { children: "core.ts:458-462" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Newest real message is ",
						createVNode(_components.code, { children: "end_turn" }),
						"; two genuine human turns were serviced ",
						createVNode(_components.em, { children: "after" }),
						" the launch"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "good",
						children: "true"
					}) }),
					"\n",
					createVNode(_components.td, { children: ["lines 1177/1212/1241; ", createVNode(_components.code, { children: "core.ts:349-352" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Every line carries an ISO timestamp — staleness is computable in the existing pass" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "good",
						children: "true"
					}) }),
					"\n",
					createVNode(_components.td, { children: "launch 20:52:46Z vs newest 22:29:26Z" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"The on-disk ",
						createVNode(_components.code, { children: "tasks/bi8olsr8z.output" }),
						" is ",
						createVNode(_components.strong, { children: "0 bytes" }),
						", mtime ",
						createVNode(_components.em, { children: "precedes" }),
						" the launch, no sidecar"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "good",
						children: "true"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "/tmp/claude-1000/…/tasks/" }) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "provenance--the-pr-that-introduced-it-and-the-issue-it-predicted",
			children: "Provenance — the PR that introduced it, and the issue it predicted"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Introduced by ",
			createVNode($$PrLink, { pr: 1015 }),
			" (“Detect Claude Code’s running-in-background\nstate for dynamic workflows”, ",
			createVNode(_components.code, { children: "c1e8613b · 2026-05-28" }),
			"), the same commit that added\n",
			createVNode(_components.code, { children: "running_background" }),
			", ",
			createVNode(_components.code, { children: "outstandingBackgroundTasks" }),
			", and the launch-marker regexes."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The backgrounded-Bash/Agent promotion was deliberate." }),
				" #1015: “The Bash/Agent coverage was added after dog-fooding caught a session busy-waiting on backgrounded CI still reading as ",
				createVNode(_components.code, { children: "waiting" }),
				".” So the “narrow the trigger” fix below is a genuine product regression, not a free simplification."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"#1015 predicted this exact bug class and filed ",
					createVNode(_components.a, {
						href: "https://github.com/juspay/kolu/issues/1017",
						children: "#1017"
					}),
					" — since closed by ",
					createVNode($$PrLink, { pr: 1115 }),
					"."
				] }),
				" “An ",
				createVNode(_components.em, { children: "abandoned" }),
				" session with a stale trailing entry reads as ",
				createVNode(_components.code, { children: "running" }),
				" (needs an mtime/liveness heuristic).” Our bug is the background-task manifestation of #1017."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The twist that makes this its own issue",
			children: createVNode(_components.p, { children: [
				"#1017’s open questions carve out one explicit exception: ",
				createVNode(_components.em, { children: [
					"“a backgrounded task\nlegitimately keeps the session ‘working’ while quiet, so ",
					createVNode(_components.strong, { children: "staleness must not\noverride an outstanding-background-task signal" }),
					".”"
				] }),
				" That assumption is precisely\nwhat our bug breaks — here the outstanding-background-task signal is ",
				createVNode(_components.em, { children: "itself" }),
				" the\nstale thing. So the fix isn’t “add staleness ",
				createVNode(_components.em, { children: "around" }),
				" the promotion”; it’s ",
				createVNode(_components.strong, { children: "make\nthe background-task signal staleness-aware from the inside" }),
				" so the set it returns\nis already self-expiring."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Precedent + north star: ",
			createVNode($$PrLink, { pr: 1019 }),
			" closed the sibling\n",
			createVNode(_components.a, {
				href: "https://github.com/juspay/kolu/issues/1018",
				children: "#1018"
			}),
			" with a ",
			createVNode(_components.em, { children: "structural transcript\nmarker" }),
			" (",
			createVNode(_components.code, { children: "isInterruptMarker" }),
			" → ",
			createVNode(_components.code, { children: "waiting" }),
			") rather than a timer — the shape of the\nhuman-turn guard. ",
			createVNode(_components.a, {
				href: "https://github.com/juspay/kolu/issues/1011",
				children: "#1011"
			}),
			" (structured\nagent-status side-channel via Claude Code hooks, OPEN) would moot every transcript\nheuristic here; until it lands, the transcript is the only source of truth."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "four-fix-candidates--and-why-two-are-traps",
			children: "Four fix candidates — and why two are traps"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Each design was handed to an adversarial verifier told to refute it against the\nreal data. Two look obvious and are ",
			createVNode(_components.strong, { children: "wrong on this exact transcript" }),
			":"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Candidate" }),
					"\n",
					createVNode(_components.th, { children: "Idea" }),
					"\n",
					createVNode(_components.th, { children: "Verdict" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Liveness gate" }), " (kolu owns the PTY)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"Veto the promotion if the launching Claude process is dead, via the session file’s ",
						createVNode(_components.code, { children: "(pid, procStart)" }),
						" against ",
						createVNode(_components.code, { children: "/proc" }),
						"."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "bad",
							children: "fails — 2/2"
						}),
						" A restart ",
						createVNode(_components.em, { children: [
							"reuses the same ",
							createVNode(_components.code, { children: "sessionId" }),
							" and JSONL"
						] }),
						" and re-keys the session file to the ",
						createVNode(_components.strong, { children: "new, live" }),
						" foreground pid. “Is the session alive?” returns true → spinner survives. Linux-only besides."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "On-disk probe" }), " (poll the .output file)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"Treat a task as dead if its ",
						createVNode(_components.code, { children: "tasks/<id>.output" }),
						" is stale / has no fd-holder."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "bad",
							children: "fails — 2/2"
						}),
						" The command ",
						createVNode(_components.em, { children: "redirected output away" }),
						" (",
						createVNode(_components.code, { children: ">/tmp/apm2.log" }),
						"). The file is 0 bytes, mtime precedes the launch — the probe reads “dead” for live and dead alike, and would prematurely clear the pip for ",
						createVNode(_components.em, { children: "any" }),
						" redirecting background command."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Ordering guard" }), " (transcript-only)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"Drop a task if a genuine human turn appears ",
						createVNode(_components.em, { children: "after" }),
						" its launch marker."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "warn",
							children: "correct, but narrow — 6/2"
						}),
						" Fixes this bug deterministically and is restart-robust. But as the ",
						createVNode(_components.em, { children: "sole" }),
						" fix it breaks a supported case: a genuinely-running CI run + interleaved human prompt would be wrongly de-promoted. Adopted as a ",
						createVNode(_components.em, { children: "fallback" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Staleness veto" }), " (transcript-relative)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"Drop a task whose launch predates the transcript’s ",
						createVNode(_components.em, { children: "newest" }),
						" timestamp by more than ",
						createVNode(_components.code, { children: "STALE_BG_MS" }),
						"."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "good",
							children: "correct & non-breaking — 6/2"
						}),
						" 96.7 min > threshold ⇒ dropped. Anchored to the transcript’s newest line (not ",
						createVNode(_components.code, { children: "Date.now()" }),
						"), immune to clock skew. Weakness: arbitrary magic number; a fully-quiet orphan never advances ",
						createVNode(_components.code, { children: "newestTs" }),
						"."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The two “obvious” process-liveness fixes are exactly the ones to avoid — they\nmeasure an available-but-wrong signal. After a restart, Claude is ",
			createVNode(_components.em, { children: "alive yet\nidle" }),
			"; only the ",
			createVNode(_components.strong, { children: "transcript’s own record" }),
			" carries the discriminating fact, and\nit survives the restart."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "recommended-fix--only-promote-a-backed-outstanding-task",
			children: [
				"Recommended fix — only promote a ",
				createVNode(_components.em, { children: "backed" }),
				" outstanding task"
			]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Promote only when an outstanding task carries a runId",
			children: createVNode(_components.p, { children: [
				"i.e. a genuine ",
				createVNode(_components.code, { children: "Workflow" }),
				" fan-out, whose run journal kolu already watches on\ndisk. A bare backgrounded ",
				createVNode(_components.code, { children: "Bash" }),
				"/",
				createVNode(_components.code, { children: "Agent" }),
				" (",
				createVNode(_components.code, { children: "runId: null" }),
				") has no observable backing\nsignal, so it no longer lights the pip. The reported bug vanishes outright — no\nthreshold, no timestamp parsing, no heuristic classifier. The principled line:\n",
				createVNode(_components.strong, { children: [
					"kolu should claim “working” only when it can actually ",
					createVNode(_components.em, { children: "see" }),
					" the work."
				] }),
				" Removing\nan over-broad trigger beats bolting two heuristics onto it (Hickey: subtract,\ndon’t add)."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: "The entire behavioral change is one predicate at the promotion site:" }),
		"\n",
		createVNode(_components.pre, {
			class: "astro-code github-light",
			style: {
				backgroundColor: "#fff",
				color: "#24292e",
				overflowX: "auto"
			},
			tabindex: "0",
			"data-language": "diff",
			children: createVNode(_components.code, { children: [
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "// packages/integrations/claude-code/src/core.ts — deriveState (383-386)"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  let state = stateAndModel.state;"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  if (state === \"waiting\") {"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "    const bg = outstanding ?? outstandingBackgroundTasks(lines);"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#B31D28" },
						children: [createVNode(_components.span, {
							style: { userSelect: "none" },
							children: "-"
						}), "   if (bg.length > 0) state = \"running_background\";"]
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#22863A" },
						children: [createVNode(_components.span, {
							style: { userSelect: "none" },
							children: "+"
						}), "   if (bg.some((t) => t.runId !== null)) state = \"running_background\";  // Workflow runs only — Bash/Agent have no journal"]
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  }"
					})
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "outstandingBackgroundTasks" }),
			" stays a faithful “launched − completed” set; only the\n",
			createVNode(_components.em, { children: "promotion policy" }),
			" narrows — the correct Lowy seam, because what shifts is “what\ncounts as working” (",
			createVNode(_components.code, { children: "deriveState" }),
			"’s concern). The ",
			createVNode(_components.code, { children: "BackgroundTask.runId" }),
			" field that\nalready distinguishes the two does all the work; no new state, no new inputs."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "What it costs, honestly",
			children: [createVNode(_components.p, { children: "Two departures from #1015’s behavior:" }), createVNode(_components.ul, { children: [
				"\n",
				createVNode(_components.li, { children: [
					"A backgrounded ",
					createVNode(_components.code, { children: "Bash" }),
					"/",
					createVNode(_components.code, { children: "Agent" }),
					" the agent is genuinely busy-waiting on now reads as ",
					createVNode(_components.code, { children: "waiting" }),
					" — re-opening the case #1015 added Bash/Agent coverage for. ",
					createVNode(_components.em, { children: [
						"Mitigant: a busy-wait that actively polls emits ",
						createVNode(_components.code, { children: "tool_use" }),
						"/",
						createVNode(_components.code, { children: "thinking" }),
						" turns and already reads as working; only a pure end-turn-and-wait loses the pip."
					] })
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Residual — closed in this PR." }),
					" A ",
					createVNode(_components.code, { children: "Workflow" }),
					" (",
					createVNode(_components.code, { children: "runId != null" }),
					") orphaned by a restart would otherwise still stick. ",
					createVNode(_components.code, { children: "#1109" }),
					" closes it with ",
					createVNode(_components.code, { children: "liveOutstandingTasks" }),
					": drop a workflow whose journal is terminal or stale past ",
					createVNode(_components.code, { children: "WORKFLOW_JOURNAL_STALE_MS" }),
					" (2 min) — an ",
					createVNode(_components.em, { children: "authoritative" }),
					" journal check, not a wall-clock guess."
				] }),
				"\n"
			] })]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "alternative--the-transcript-only-veto-keep-bashagent-spinning",
			children: "Alternative — the transcript-only veto (keep Bash/Agent spinning)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"If a detached ",
			createVNode(_components.code, { children: "Bash" }),
			"/",
			createVNode(_components.code, { children: "Agent" }),
			" busy-wait ",
			createVNode(_components.em, { children: "must" }),
			" keep lighting the pip (preserving\n#1015 exactly), the fallback makes the outstanding-set self-expiring instead of\nnarrowing the trigger — a layered, transcript-only veto inside\n",
			createVNode(_components.code, { children: "outstandingBackgroundTasks" }),
			". Heavier (a magic threshold + a small classifier) but\nbehavior-preserving for the live case:"
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
						children: "// core.ts — outstandingBackgroundTasks (441-487), sketch of the layered veto"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " launched"
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
							children: " Map"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "();      "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// taskId → { runId, index, atMs }"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " completed"
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
							children: " Set"
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
							children: "  let"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " newestMs "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " null"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";             "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// newest timestamp across ALL entries (metadata too)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  let"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " lastHumanTurn "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " -"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "1"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";          "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// index of the newest genuine human prompt"
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
							children: "  lines."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "forEach"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "raw"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "i"
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
							children: "    let"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " entry; "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "try"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { entry "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " JSON"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "parse"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(raw); } "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "catch"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "return"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; }"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " ms"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " Date."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "parse"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(entry.timestamp "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "??"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ");                 "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// NaN-safe"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    if"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "!"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "Number."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "isNaN"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(ms)) newestMs "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " Math."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "max"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(newestMs "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "??"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ms, ms);"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    if"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " (entry.type "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "==="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"queue-operation\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ") { "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "/* …completed.add(id)… */"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " return"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; }"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    if"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " (entry.type "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "!=="
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"user\""
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
							children: "    if"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "isGenuineHumanTurn"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(entry)) lastHumanTurn "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " i;             "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// real prompt, not machinery"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "    // …launched.set(taskId, { runId, index: i, atMs }) …"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  });"
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
							children: "  const"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " out"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " [];"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "  for"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ("
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "const"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " ["
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "taskId"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", { "
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "runId"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "index"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "atMs"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }] "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "of"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " launched) {"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    if"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " (completed."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "has"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(taskId)) "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "continue"
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
							children: "    if"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " (atMs "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "!=="
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " null"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " &&"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " newestMs "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "!=="
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " null"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " &&"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " newestMs "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "-"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " atMs "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ">"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " STALE_BG_MS"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ") "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "continue"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// staleness"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "    if"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " (lastHumanTurn "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ">"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " index) "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "continue"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";                                                "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// human spoke after"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "    out."
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "push"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ taskId, runId });"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  }"
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
						children: " out;"
					})]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "isGenuineHumanTurn" }),
			" reuses ",
			createVNode(_components.code, { children: "isInterruptMarker" }),
			" + ",
			createVNode(_components.code, { children: "toolResultBlock" }),
			": a ",
			createVNode(_components.code, { children: "user" }),
			"\nentry is a real prompt only if it carries no ",
			createVNode(_components.code, { children: "tool_result" }),
			" block, isn’t an\ninterrupt marker, and its text doesn’t start with ",
			createVNode(_components.code, { children: "<" }),
			" (filters injected\n",
			createVNode(_components.code, { children: "<command-*>" }),
			" / ",
			createVNode(_components.code, { children: "<task-notification>" }),
			" strings). Both vetoes ",
			createVNode(_components.strong, { children: "fail safe" }),
			" (absent\ntimestamp ⇒ not-stale; classifier defaults to “machinery” on ambiguity), so older\nfixtures keep today’s behavior. ",
			createVNode(_components.em, { children: [
				"This is the fallback, not the lead: it carries\nthe ",
				createVNode(_components.code, { children: "STALE_BG_MS" }),
				" magic number and a heuristic classifier — accidental complexity\nthe recommended narrowing doesn’t have."
			] })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "test-plan--close-both-coverage-gaps",
			children: "Test plan — close both coverage gaps"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The bug shipped because ",
			createVNode(_components.strong, { children: "neither" }),
			" layer exercises a launch that never\ncompletes: every promotion unit test supplies a completion marker, and the\n",
			createVNode(_components.code, { children: "running_background" }),
			" e2e scenario ",
			createVNode(_components.em, { children: "mocks the final state" }),
			" rather than deriving it."
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Unit (recommended fix):" }),
				" ",
				createVNode(_components.code, { children: "deriveState([bashLaunch('bi8olsr8z'), endTurn])" }),
				" ⇒ ",
				createVNode(_components.code, { children: "waiting" }),
				"; flip the now-wrong “promotes a backgrounded Bash” assertion to ⇒ ",
				createVNode(_components.code, { children: "waiting" }),
				"; ",
				createVNode(_components.code, { children: "deriveState([bgLaunch('t1','wf_1'), endTurn])" }),
				" ⇒ ",
				createVNode(_components.code, { children: "running_background" }),
				" (workflow still promotes); workflow completion still clears."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "E2e:" }),
				" add “a backgrounded Bash launch does not spin” driving the ",
				createVNode(_components.em, { children: "real" }),
				" watcher + ",
				createVNode(_components.code, { children: "deriveState" }),
				"; keep the existing ",
				createVNode(_components.code, { children: "running_background" }),
				" scenario green but make its launch a ",
				createVNode(_components.strong, { children: "Workflow" }),
				" so it proves the legitimate fan-out still spins."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "open-risks--residuals",
			children: "Open risks & residuals"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "If we ship the recommended fix:" }),
			" a detached ",
			createVNode(_components.code, { children: "Bash" }),
			"/",
			createVNode(_components.code, { children: "Agent" }),
			" busy-wait no longer\nlights the pip (deliberate; recoverable via the alternative veto scoped to\n",
			createVNode(_components.code, { children: "runId == null" }),
			"). The Workflow-orphan residual is closed by ",
			createVNode(_components.code, { children: "liveOutstandingTasks" }),
			"\ngating on a fresh, non-terminal journal. Not a data-level fix — the launch marker\nstays in the transcript forever; only the promotion policy reads it differently."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "If we ship the alternative veto:" }),
			" ",
			createVNode(_components.code, { children: "STALE_BG_MS" }),
			" is policy and can’t distinguish\nan orphaned-and-talked-past task from a genuine long run; a quiet-idle orphan with\nno further lines persists until the next write; the human-vs-machinery classifier\nkeys off injected ",
			createVNode(_components.code, { children: "user" }),
			" strings and must stay in sync with the format."
		] }),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Shipped in ",
			createVNode($$PrLink, { pr: 1109 }),
			": the trigger-narrowing (",
			createVNode(_components.code, { children: "deriveState" }),
			" promotes\nonly ",
			createVNode(_components.code, { children: "runId != null" }),
			") plus the journal-liveness gate (",
			createVNode(_components.code, { children: "liveOutstandingTasks" }),
			") —\nclosing both the Bash orphan and the Workflow-orphan-after-restart. Grounded by a\n13-agent design pass: 4 candidate fixes × adversarial verification over the live\ntranscript, the on-disk artifacts, and the #1015 / #1017 / #1018→#1019 history."
		] }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Phantom running_background — Claude shows \"running\" forever",
	"description": "Why the spinner survives a Claude restart — an orphaned background-launch marker has no completion, so the waiting→running_background promotion never decays. Diagnosis + fix.",
	"parents": ["bug"],
	"maturity": "budding",
	"updated": "2026-06-10T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-report-reproduced",
			"text": "The report, reproduced"
		},
		{
			"depth": 2,
			"slug": "how-the-promotion-is-wired",
			"text": "How the promotion is wired"
		},
		{
			"depth": 2,
			"slug": "what-was-verified",
			"text": "What was verified"
		},
		{
			"depth": 2,
			"slug": "provenance--the-pr-that-introduced-it-and-the-issue-it-predicted",
			"text": "Provenance — the PR that introduced it, and the issue it predicted"
		},
		{
			"depth": 2,
			"slug": "four-fix-candidates--and-why-two-are-traps",
			"text": "Four fix candidates — and why two are traps"
		},
		{
			"depth": 2,
			"slug": "recommended-fix--only-promote-a-backed-outstanding-task",
			"text": "Recommended fix — only promote a backed outstanding task"
		},
		{
			"depth": 2,
			"slug": "alternative--the-transcript-only-veto-keep-bashagent-spinning",
			"text": "Alternative — the transcript-only veto (keep Bash/Agent spinning)"
		},
		{
			"depth": 2,
			"slug": "test-plan--close-both-coverage-gaps",
			"text": "Test plan — close both coverage gaps"
		},
		{
			"depth": 2,
			"slug": "open-risks--residuals",
			"text": "Open risks & residuals"
		}
	];
}
var url = "src/content/atlas/phantom-running-background.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/phantom-running-background.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/phantom-running-background.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
