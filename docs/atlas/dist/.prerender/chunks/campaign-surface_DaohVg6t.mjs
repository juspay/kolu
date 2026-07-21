import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/content/atlas/campaign-surface.mdx
var Chip = ({ bg, fg, children }) => createVNode("span", {
	style: {
		background: bg,
		color: fg,
		borderRadius: "4px",
		padding: "0 5px",
		fontSize: "9.5px",
		fontWeight: 600,
		whiteSpace: "nowrap"
	},
	children
});
var Dot = ({ c }) => createVNode("span", { style: {
	width: "7px",
	height: "7px",
	borderRadius: "50%",
	background: c,
	display: "inline-block",
	flexShrink: 0
} });
var GNode = (props) => createVNode("div", {
	style: {
		paddingLeft: props.pad,
		display: "flex",
		flexDirection: "column",
		gap: "1px"
	},
	children: [createVNode("div", {
		style: {
			display: "flex",
			alignItems: "center",
			gap: "6px"
		},
		children: [
			createVNode("span", {
				style: {
					color: "#c9c4b8",
					fontSize: "10px"
				},
				children: props.edge
			}),
			createVNode(Dot, { c: props.dot }),
			createVNode("span", {
				style: {
					fontWeight: 600,
					fontSize: "11.5px",
					color: "#1a1c20"
				},
				children: props.name
			}),
			createVNode("span", {
				style: {
					marginLeft: "auto",
					display: "flex",
					gap: "4px"
				},
				children: [props.note && createVNode(Chip, {
					bg: "#eef1e9",
					fg: "#5a6b4f",
					children: ["▤ ", props.note]
				}), props.pr && createVNode(Chip, {
					bg: props.prBg,
					fg: props.prFg,
					children: props.pr
				})]
			})
		]
	}), createVNode("div", {
		style: {
			fontSize: "10px",
			color: "#8a8f98",
			paddingLeft: "34px"
		},
		children: props.sub
	})]
});
var GraphMock = () => createVNode("div", {
	style: {
		maxWidth: "370px",
		margin: "1rem auto",
		border: "1px solid #d8d4c9",
		borderRadius: "12px",
		overflow: "hidden",
		fontFamily: "ui-sans-serif,system-ui",
		boxShadow: "0 2px 14px rgba(0,0,0,.07)"
	},
	children: [createVNode("div", {
		style: {
			display: "flex",
			borderBottom: "1px solid #e5e1d8",
			background: "#faf9f5",
			fontSize: "11px",
			fontWeight: 600
		},
		children: [
			createVNode("span", {
				style: {
					padding: "7px 12px",
					color: "#8a8f98"
				},
				children: "Inspector"
			}),
			createVNode("span", {
				style: {
					padding: "7px 12px",
					color: "#8a8f98"
				},
				children: "Code"
			}),
			createVNode("span", {
				style: {
					padding: "7px 12px",
					color: "#1a1c20",
					borderBottom: "2px solid #0b6478"
				},
				children: "Board"
			})
		]
	}), createVNode("div", {
		style: {
			padding: "10px",
			display: "flex",
			flexDirection: "column",
			gap: "7px",
			background: "#f6f5f0"
		},
		children: [
			createVNode("div", {
				style: {
					display: "flex",
					gap: "8px",
					alignItems: "center",
					fontSize: "10px",
					color: "#5b6470"
				},
				children: [
					createVNode(Dot, { c: "#e0a030" }),
					" 1 asking you ",
					createVNode(Dot, { c: "#3aa657" }),
					" 3 working ",
					createVNode(Dot, { c: "#b0b0b0" }),
					" 1 idle"
				]
			}),
			createVNode(GNode, {
				pad: "0px",
				edge: "",
				dot: "#3aa657",
				name: "RT-fable · coordinator",
				pr: "atlas #1878",
				prBg: "#e8f3ec",
				prFg: "#1b7a3a",
				sub: "claude · working — the act door (supervisor)"
			}),
			createVNode(GNode, {
				pad: "16px",
				edge: "└─",
				dot: "#e0a030",
				name: "spawn-detection",
				note: "agent-spawn",
				pr: "PR draft",
				prBg: "#fdf3e7",
				prFg: "#8a5200",
				sub: "claude · awaiting your answer — 12m"
			}),
			createVNode(GNode, {
				pad: "32px",
				edge: "└─",
				dot: "#3aa657",
				name: "codex split",
				pr: "debate r2",
				prBg: "#f0f0ee",
				prFg: "#8a8f98",
				sub: "codex · working — parentId edge, observed"
			}),
			createVNode(GNode, {
				pad: "16px",
				edge: "└─",
				dot: "#3aa657",
				name: "philosophy-restore",
				pr: "#1889 merged",
				prBg: "#e8f3ec",
				prFg: "#1b7a3a",
				sub: "claude · idle — lane retiring to shipped"
			}),
			createVNode(GNode, {
				pad: "0px",
				edge: "",
				dot: "#b0b0b0",
				name: "scratch",
				pr: "no PR",
				prBg: "#f0f0ee",
				prFg: "#8a8f98",
				sub: "plain shell · unattributed — hangs off the repo root"
			}),
			createVNode("details", {
				style: {
					fontSize: "10px",
					color: "#8a8f98"
				},
				children: createVNode("summary", {
					style: {
						cursor: "pointer",
						letterSpacing: ".2em",
						textTransform: "uppercase",
						fontSize: "9px"
					},
					children: "shipped · 15"
				})
			})
		]
	})]
});
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
		createVNode(_components.h2, {
			id: "why-the-scribe-problem-and-the-atlas-problem",
			children: "Why: the scribe problem, and the Atlas problem"
		}),
		"\n",
		createVNode(_components.p, { children: "Running kolu’s development as a multi-agent campaign uses three disconnected\nartifacts today, and each has a structural defect." }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The dashboard is hand-written." }),
			" A JSON file the coordinator agent updates\nafter every event, rendered by a static HTML skill asset. It violates the\nphilosophy twice — the interface is supposed to be ",
			createVNode(_components.em, { children: "built by observing what\nusers already do" }),
			", and facts like ",
			createVNode(_components.em, { children: "branch/PR/CI status derive from the\nterminal’s cwd" }),
			". Hand-maintained derived state drifts (stale boards, notes\ndisagreeing with the board, links dying on terminal re-key), and keeping it\nhonest required a Stop hook whose only job is to nag the scribe."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The Atlas is a static-site generator bolted onto the repo." }),
			" Measured, this\nrepo: ",
			createVNode(_components.strong, { children: "196 MB" }),
			" of ",
			createVNode(_components.code, { children: "node_modules" }),
			", a 4,404-line lockfile, 23 components, an\nAstro config and build recipes — ",
			createVNode(_components.em, { children: "per repo that wants a knowledge base" }),
			".\n",
			createVNode(_components.strong, { children: "6.9 MB of generated HTML is committed" }),
			", and ",
			createVNode(_components.strong, { children: "1,151 commits" }),
			" have touched\n",
			createVNode(_components.code, { children: "dist/" }),
			"; a CI gate (",
			createVNode(_components.code, { children: "atlas-sync" }),
			") exists purely to police the generated\nartifact. Every note edit is a branch → PR → build → stage-dist → check-sync →\nmerge ceremony. The adoption verdict is already in: ",
			createVNode(_components.strong, { children: "drishti and odu never\nset it up" }),
			" — the per-repo cost lost."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The decisive fact: ",
			createVNode(_components.strong, { children: "kolu already ships its own markdown renderer" }),
			" —\n",
			createVNode(_components.code, { children: "@kolu/solid-markdown" }),
			" (rendering, highlighting, URL policy) — wired into the\nclient today, including the Code tab’s file dispatcher. The committed-HTML\npipeline existed so notes were “reviewable in the Code tab without a dev\nserver”; kolu since became that renderer. The generator is vestigial."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-model-its-actors-all-the-way-down",
			children: "The model: it’s actors all the way down"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The ",
			createVNode(_components.a, {
				href: "https://www.brianstorti.com/the-actor-model/",
				children: "actor model"
			}),
			": an actor is\nthe primitive unit of computation with ",
			createVNode(_components.strong, { children: "private state and no shared memory" }),
			";\nit has a ",
			createVNode(_components.strong, { children: "mailbox" }),
			" and processes messages ",
			createVNode(_components.strong, { children: "one at a time" }),
			"; on a message it\nmay ",
			createVNode(_components.strong, { children: "create more actors, send messages, or decide its own next state" }),
			";\n",
			createVNode(_components.strong, { children: "supervisors" }),
			" monitor actors and reset crashed ones to a stable state\n(“let it crash”); everything has an ",
			createVNode(_components.strong, { children: "address" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: "kolu’s campaign is already this, piece for piece:" }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Actor model" }),
					"\n",
					createVNode(_components.th, { children: "kolu, today" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "actor: private state, no shared memory" }),
					"\n",
					createVNode(_components.td, { children: [
						"a ",
						createVNode(_components.strong, { children: "terminal" }),
						": its PTY, its session — nothing shared"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "address" }),
					"\n",
					createVNode(_components.td, { children: "the terminal UUID" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "mailbox, one message at a time" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "kaval serializes all input" }), " — “when input arrives, last one wins” is the single-writer mailbox; the coordinator’s own inbox is serialization-by-conversation"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "create actors / send messages / decide next state" }),
					"\n",
					createVNode(_components.td, { children: [
						"the coordinator ",
						createVNode(_components.strong, { children: "spawns terminals" }),
						" (",
						createVNode(_components.code, { children: "lifecycle_create" }),
						"), ",
						createVNode(_components.strong, { children: "sends briefs" }),
						" (",
						createVNode(_components.code, { children: "sendInput" }),
						"), and revises its plan"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "supervisor resets a crashed actor to stable state" }),
					"\n",
					createVNode(_components.td, { children: [
						"the falsify-and-redirect loop: a wrong brief → stand down, ",
						createVNode(_components.code, { children: "/compact" }),
						" (reset to stable), re-brief. And ",
						createVNode(_components.strong, { children: "the daemons already do it literally" }),
						": padi adopt-or-recycles its kaval; the binder drains and re-provisions padi"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "hierarchy — everything is an actor" }),
					"\n",
					createVNode(_components.td, { children: "coordinator → worker terminals → split terminals (codex debates); padi → kaval beneath them" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "inside-the-coordinator-the-receive-loop",
			children: "Inside the coordinator: the receive loop"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The coordinator is not special machinery — it is ",
			createVNode(_components.strong, { children: "one more actor" }),
			", an agent\nin an ordinary kolu terminal, and its behavior is exactly the actor triad,\nobservable in kolu’s own development campaigns:"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Its mailbox" }),
			" is its conversation. Everything arrives as messages into one\nserialized stream — the human’s directives, workers’ reports, gate-workflow\nresults — and is processed ",
			createVNode(_components.strong, { children: "one at a time, in order" }),
			". There is no other\ninput path: a worker cannot interrupt a ruling in progress; two workers’\nescalations queue. (This is why chat integration is cheap: a thread bound to\nthe coordinator is just more mailbox.)"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Its private state" }),
			" is the campaign: what is in flight, what each gate\nruled, who holds which CI box, what must merge first. Some of it is durable —\nwritten into notes ",
			createVNode(_components.em, { children: "as decisions" }),
			" — and the rest is deliberately ephemeral\nconversation state, reset on compaction. No other actor can read it; workers\nknow only what they are told in briefs."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "On each message it does the triad" }), ", nothing else:"] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Message arriving" }),
					"\n",
					createVNode(_components.th, { children: "create actors" }),
					"\n",
					createVNode(_components.th, { children: "send messages" }),
					"\n",
					createVNode(_components.th, { children: "decide next state" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "human: “dispatch X”" }),
					"\n",
					createVNode(_components.td, { children: [
						"cut ",
						createVNode(_components.code, { children: "worktree = branch = lane" }),
						", create the terminal"
					] }),
					"\n",
					createVNode(_components.td, { children: "the brief (symptom + hypotheses-to-falsify, never mechanism-as-fact)" }),
					"\n",
					createVNode(_components.td, { children: "X is in flight, gate pending" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "worker: gate request (a design file + pointer, blocking)" }),
					"\n",
					createVNode(_components.td, { children: "adversarial review swarm (its own short-lived actors)" }),
					"\n",
					createVNode(_components.td, { children: "the ruling: GO / deltas / redirect" }),
					"\n",
					createVNode(_components.td, { children: [
						"the design is ratified — or the ",
						createVNode(_components.em, { children: "coordinator’s own premise" }),
						" is falsified and its state revises"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "worker: escalation (“the brief is wrong”)" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "verify against the tree, then a corrected ruling" }),
					"\n",
					createVNode(_components.td, { children: [
						"supervision runs ",
						createVNode(_components.strong, { children: "both ways" }),
						": a child’s message can crash the parent’s belief"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "worker: CI red (report-before-rerun)" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "venue arbitration, rerun approval or stop" }),
					"\n",
					createVNode(_components.td, { children: "box leases update" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "worker: merge-ready" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: [
						"relay to the human (the coordinator ",
						createVNode(_components.strong, { children: "never merges" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: "the lane is done-pending-human" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "human: “merged” / “close it”" }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "stand-down to the worker" }),
					"\n",
					createVNode(_components.td, { children: "the lane retires" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "As a supervisor it practices let-it-crash, not defensive repair." }),
			" A worker\nwhose premise is falsified or whose context is corrupted is not patched in\nplace — it is stood down, ",
			createVNode(_components.strong, { children: "reset to a stable state" }),
			" (",
			createVNode(_components.code, { children: "/compact" }),
			", or a fresh\nterminal), and re-briefed. The reset is cheap because the durable state was\nnever in the actor: it is in the files (the branch, the note, the PR)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "And it is itself supervised." }),
			" Above the coordinator sits the human — the\nroot of the tree, who merges every PR and can crash-and-redirect the\ncoordinator’s own plans (this note exists because of exactly such a message).\nBelow the terminals runs the ",
			createVNode(_components.em, { children: "other" }),
			" supervision tree — binder → padi →\nkaval, adopt-or-recycle — so the full picture is two supervision hierarchies\nmeeting at the terminal: one governing ",
			createVNode(_components.strong, { children: "work" }),
			", one governing ",
			createVNode(_components.strong, { children: "process\nlifetimes" }),
			", both actor-shaped."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"This is not an analogy to adopt — it is a description of what shipped. The\nconsequence for the Board: a campaign is not a ",
			createVNode(_components.em, { children: "list" }),
			" of lanes, it is a\n",
			createVNode(_components.strong, { children: "supervision graph of terminal-actors" }),
			", and most of its edges are already\nrecorded: ",
			createVNode(_components.code, { children: "parentId" }),
			" is a field of terminal creation (splits carry their\nparent today), and a terminal created through the kolu MCP knows which\nsession asked for it.",
			createVNode($$Footnote, { children: [
				"The remaining edge — “which terminal ",
				createVNode(_components.em, { children: "drives" }),
				"\nwhich” when input arrives over a CLI rather than the MCP — is not recorded\ntoday. The graph renders what is observed and nothing more; an unattributed\nlane simply hangs off the repo root. Observation can grow (input provenance\nis knowable at the MCP face), but the Board never guesses."
			] })
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "implementation-what-kolu-builds-vs-what-it-observes",
			children: "Implementation: what kolu builds vs what it observes"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The agent-agnostic principle draws the implementation line sharply: ",
			createVNode(_components.strong, { children: "kolu\nimplements the actor substrate; the coordinator’s brain is never product\ncode." }),
			" The coordinator is whatever agent CLI runs in that terminal — its\ndiscipline (briefs, gates, rulings) is a prompt contract (the ",
			createVNode(_components.code, { children: "/bridge" }),
			"\nskill), swappable like any agent. kolu’s job is to make the substrate real\nand observed:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Model concept" }),
					"\n",
					createVNode(_components.th, { children: "Implementing component" }),
					"\n",
					createVNode(_components.th, { children: "Status" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "actor, address, mailbox" }),
					"\n",
					createVNode(_components.td, { children: "a kaval terminal: UUID + serialized input (“last one wins”)" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "shipped" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "create-an-actor (+ parent edge)" }),
					"\n",
					createVNode(_components.td, { children: [
						"padi ",
						createVNode(_components.code, { children: "lifecycle.create" }),
						" with ",
						createVNode(_components.code, { children: "parentId" })
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "shipped" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "creator attribution (who spawned whom via the act door)" }),
					"\n",
					createVNode(_components.td, { children: "record the calling session on MCP-created terminals — one server-side field" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.em, { children: "small addition" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "observe: working / asking / idle, which agent" }),
					"\n",
					createVNode(_components.td, { children: "padi’s agent sensors" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "shipped" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "observe: branch → PR → CI per lane" }),
					"\n",
					createVNode(_components.td, { children: "the server’s existing cwd-derivation for terminal chrome" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "shipped — reused, not duplicated" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "the campaign graph" }),
					"\n",
					createVNode(_components.td, { children: [
						"a ",
						createVNode(_components.strong, { children: "derived collection in kolu-server" }),
						" joining the rows above, keyed by repo root — no new daemon, no new store, the same derive-don’t-write shape as every other cell"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.em, { children: "new, small" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "the Board tab" }),
					"\n",
					createVNode(_components.td, { children: [
						"a client view subscribing to ",
						createVNode(_components.code, { children: "campaign(repoOf(cwd))" }),
						" — the third right-panel tab"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.em, { children: "new" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "note rendering" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "@kolu/solid-markdown" }),
						" + standard marked extensions (alerts + footnotes ",
						createVNode(_components.strong, { children: "shipped" }),
						"; add: live ",
						createVNode(_components.code, { children: "#1234" }),
						" pills via the server’s forge access, directive syntax, the ",
						createVNode(_components.code, { children: "html" }),
						" fence → the existing sandboxed preview iframe)"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.em, { children: "P0, small" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "durable knowledge" }),
					"\n",
					createVNode(_components.td, { children: "plain files in git — no new store, no schema" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "shipped" }), " (it’s a filesystem)"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "reset-to-stable (let it crash)" }),
					"\n",
					createVNode(_components.td, { children: "the agent CLI’s own compaction / a fresh terminal" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "shipped" }), " — nothing to build"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "the attention flow — a blocking ask can’t exist without a listener" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"padi delivers ",
						createVNode(_components.code, { children: "[kolu] worker <id> (<intent>) needs you" }),
						" into the SUPERVISOR terminal’s mailbox (the ",
						createVNode(_components.code, { children: "parentId" }),
						"/creator edge names it; kaval’s serialized input is the transport), fired only when ",
						createVNode(_components.strong, { children: [
							"agent-state is ",
							createVNode(_components.code, { children: "awaiting" }),
							"/",
							createVNode(_components.code, { children: "waiting" }),
							" AND raw PTY output settled ≥ N s"
						] }),
						" (the conjunction — agent-idle alone false-fires on subagent/background churn). Only agent-terminal supervisors are notified, never a human shell."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.em, { children: [
						"new, small — both signals shipped (",
						createVNode(_components.code, { children: "wait_agentState" }),
						" + ",
						createVNode(_components.code, { children: "wait_outputSettled" }),
						"); the edge and the mailbox exist"
					] }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "the chat mirror" }),
					"\n",
					createVNode(_components.td, { children: [
						"pesu: ",
						createVNode(_components.code, { children: "postMessage" }),
						" out, ",
						createVNode(_components.code, { children: "sendInput" }),
						" in — the chat-native note’s bridge"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.em, { children: "P3, per that note" }) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Read the Status column’s shape: ",
			createVNode(_components.strong, { children: "most rows are shipped." }),
			" The feature is\nthree small derived/rendering additions on an actor substrate kolu already\nis — which is exactly what the model-not-analogy claim predicts. What is\n",
			createVNode(_components.em, { children: "never" }),
			" on the list: a coordinator engine, a workflow DSL, a state machine\nfor campaigns — the brain stays an agent, the campaign state stays files\nand observation."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-attention-flow-as-its-own-class-kill",
			children: "The attention flow, as its own class-kill"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The recurring failure this design must end: ",
			createVNode(_components.strong, { children: [
				"a worker blocks on the\ncoordinator, and the ask waits to be ",
				createVNode(_components.em, { children: "discovered" }),
				" rather than ",
				createVNode(_components.em, { children: "delivered" }),
				"."
			] }),
			"\nObserve pulls the coordinator (a merge, a human message re-invoke it); a\nworker quietly entering “await coordinator” pushes nothing — so a gate request\nis the one event most likely to rot, and in practice it did, twice, overnight."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Patches that add a ",
			createVNode(_components.em, { children: "listener" }),
			" (a watcher process, a Stop hook, a discipline)\nall fail the bar identically: the listener is a ",
			createVNode(_components.strong, { children: "separate, optional act" }),
			", so\n“dispatch a worker without arming its notification” stays spellable. P4’s\ntarget is to make ask-without-listener unrepresentable — which happens only\nwhen the ask and the listener are ",
			createVNode(_components.strong, { children: "the same fact" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"They already are, latent: the supervision edge (",
			createVNode(_components.code, { children: "parentId" }),
			" / creator\nattribution) records exactly who should hear a worker’s ask, and the mailbox\n(serialized terminal input — the coordinator’s real inbox) is exactly how to\ndeliver it. So the notification is not a thing you ",
			createVNode(_components.em, { children: "attach" }),
			"; it is what the\nedge ",
			createVNode(_components.em, { children: "means" }),
			". A worker going blocked delivers into its supervisor’s mailbox by\nconstruction — the supervisor is re-invoked like any message, no watcher, no\npoll, nothing to forget. ",
			createVNode(_components.strong, { children: "Dispatching a worker creates its notification path\nbecause the edge is the subscription" }),
			" (P5: padi is the knowing endpoint for\n“who needs whom”; delivery rides the one door)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The signal must be the ",
			createVNode(_components.strong, { children: "conjunction" }),
			", not agent-state alone: a coding\nagent’s subagents and background tasks flap its detected state to idle while\nthe terminal is still working. Fire only when ",
			createVNode(_components.em, { children: [
				"agent-state is ",
				createVNode(_components.code, { children: "awaiting" }),
				"/",
				createVNode(_components.code, { children: "waiting" })
			] }),
			" ",
			createVNode(_components.strong, { children: "and" }),
			" ",
			createVNode(_components.em, { children: "raw PTY output has settled" }),
			" for a debounce window —\nboth already shipped as ",
			createVNode(_components.code, { children: "wait_agentState" }),
			" and ",
			createVNode(_components.code, { children: "wait_outputSettled" }),
			"\n(“terminal-activity idle”, distinct from agent-state idle). Guard: notify only\nsupervisors that are themselves agent terminals — never inject into a human’s\nshell."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.em, { children: "Interim, until this ships:" }),
			" every dispatch carrying an “ask me” gate arms\n",
			createVNode(_components.code, { children: "wait --until idle:<ms>" }),
			" (the same conjunction) as a background task in the\nsame turn — the harness re-invokes the coordinator when it fires. The ask and\nits listener created together, never apart."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-board--a-third-right-panel-tab-shaped-like-the-graph",
			children: "The Board — a third right-panel tab, shaped like the graph"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The right panel today has two tabs (",
			createVNode(_components.code, { children: "inspector" }),
			" | ",
			createVNode(_components.code, { children: "code" }),
			"). The Board is the\nthird: the repo’s supervision graph, live."
		] }),
		"\n",
		"\n",
		"\n",
		createVNode(GraphMock, {}),
		"\n",
		createVNode(_components.h3, {
			id: "scoping-whose-board-is-this",
			children: "Scoping: whose board is this?"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The right panel is per-terminal, so the Board uses the association the Code\ntab already uses: ",
			createVNode(_components.strong, { children: "the terminal’s cwd names the repo, and the repo is the\ncampaign." }),
			" cwd → repo root → every worktree of that repo → their terminals,\nbranches, PRs, sensor states, parent edges. Two same-repo terminals see the\nsame board (a per-terminal ",
			createVNode(_components.em, { children: "viewport" }),
			" on repo-scoped content); a drishti\nterminal sees drishti’s campaign — multi-project coordination with zero\nconfiguration; a repo-less terminal sees an honest empty tab. No campaign\nregistry, no picker."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Every element is ",
			createVNode(_components.strong, { children: "already observed" }),
			": the lanes are terminals (cwd →\nworktree); the dots and sub-lines are padi’s agent sensors; the PR/CI chips\nare the cwd → branch → PR derivation the server already does for terminal\nchrome; the ▤ chip is the branch ↔ note-slug convention; the tree edges are\n",
			createVNode(_components.code, { children: "parentId" }),
			" + MCP creator attribution; ",
			createVNode(_components.em, { children: "shipped" }),
			" is merged-PRs-whose-branch-\nhad-a-lane. ",
			createVNode(_components.strong, { children: "Nobody writes any of it, so none of it can go stale." })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "knowledge-plain-markdown-rendered-by-the-product",
			children: "Knowledge: plain markdown, rendered by the product"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Notes become ",
			createVNode(_components.strong, { children: "plain GFM files" }),
			" — no imports, no JSX, no build, no committed\ndist, no sync gate. The rich vocabulary survives as renderer capabilities in\n",
			createVNode(_components.code, { children: "@kolu/solid-markdown" }),
			", shipped once in the product:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Today (MDX component)" }),
					"\n",
					createVNode(_components.th, { children: "Tomorrow (plain file + smarter renderer)" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "<Callout>" }), " (76 uses)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"GitHub-native alerts: ",
						createVNode(_components.code, { children: "> [!NOTE]" }),
						" / ",
						createVNode(_components.code, { children: "[!WARNING]" })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "<PrLink>" }),
						" / ",
						createVNode(_components.code, { children: "<Issue>" }),
						" (90 uses)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"a bare ",
						createVNode(_components.code, { children: "#1234" }),
						" — the renderer resolves it to a ",
						createVNode(_components.strong, { children: "live status pill" }),
						" (draft/open/merged/closed, CI). Notes stop containing outcomes, so they cannot go stale"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "<Footnote>" }), " (29)"] }),
					"\n",
					createVNode(_components.td, { children: "GFM footnotes" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "<Svg>" }), " (37)"] }),
					"\n",
					createVNode(_components.td, { children: ["an ordinary image link to a committed ", createVNode(_components.code, { children: ".svg" })] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "<Pill>" }),
						" / ",
						createVNode(_components.code, { children: "<D>" }),
						" / ",
						createVNode(_components.code, { children: "<Cite>" })
					] }),
					"\n",
					createVNode(_components.td, { children: "inline conventions the renderer styles" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "<PhaseTree>" }),
						" / ",
						createVNode(_components.code, { children: "<Terminal>" }),
						" / ",
						createVNode(_components.code, { children: "<Roadmap>" })
					] }),
					"\n",
					createVNode(_components.td, { children: "fenced blocks with a language tag the renderer upgrades — the mermaid pattern" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"GitHub renders the same files acceptably (alerts and footnotes are\nGitHub-native), so “reviewable anywhere” ",
			createVNode(_components.em, { children: "improves" }),
			" — today’s MDX shows as\nsource on github.com. And any repo gets the whole experience by containing\n",
			createVNode(_components.code, { children: ".md" }),
			" files, which drishti and odu already do. Zero setup, every repo, every\nhost."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The write path" }),
			": git remains the store — durable, versioned, offline (the\nfiles-are-the-state doctrine). What dies is the ",
			createVNode(_components.em, { children: "ceremony" }),
			": with no build\nartifacts, a note edit is a one-file diff, and kolu itself can be the editor\n(the act door; ",
			createVNode(_components.code, { children: "scratch.write" }),
			" is the wire precedent) committing to a branch\nor straight to master ",
			createVNode(_components.strong, { children: "per repo policy" }),
			" — the format no longer forces a\npipeline on anyone."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "how-ui-prototypes-live-in-notes",
			children: "How UI prototypes live in notes"
		}),
		"\n",
		createVNode(_components.p, { children: "This note’s own mockups are JSX — which plain markdown forbids. The ladder,\neach rung a plain-file citizen:" }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "ASCII sketches" }), " in plain fences — structure and layout, terminal-native,\nrenders everywhere, zero tooling. The default for thinking."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "SVG files" }), " — the designed-mockup standard. Text, diffable, committed\nbeside the note, embedded as an ordinary image; agents author SVG fluently.\n(The Atlas already leans on SVG diagrams — 37 uses.)"] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"An ",
					createVNode(_components.code, { children: "html" }),
					" fence the renderer upgrades to a sandboxed live preview"
				] }),
				" — the\nhigh-fidelity rung. The fence’s source stays visible as code on GitHub;\nin kolu it renders inside the ",
				createVNode(_components.strong, { children: "existing opaque-origin sandboxed preview\niframe" }),
				" (the Code-tab preview machinery, already shipped and\ne2e-hardened). Interactive prototypes with zero new infrastructure."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Screenshots" }), " — for as-built states, small and compressed, the evidence\nflow’s conventions."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "This note’s mockups migrate to rung 3 verbatim — they are already plain\nHTML-with-inline-styles wearing JSX syntax." }),
		"\n",
		createVNode(_components.h2, {
			id: "the-flows",
			children: "The flows"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Dispatch." }),
			" The coordinator cuts ",
			createVNode(_components.code, { children: "worktree = branch = lane" }),
			", creates a\nterminal (a child actor — the parent edge recorded at birth), briefs it. The\nlane appears on the graph by observation. Zero writes."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Attention." }),
			" An agent flips to ",
			createVNode(_components.em, { children: "asking-you" }),
			" → amber dot, who-needs-me\ncount, notify seam (desktop today, the pesu thread tomorrow). Click the lane\n→ you are in the terminal. Answer, step out."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Reading the plan." }),
			" The lane’s ▤ chip opens its note in the Code tab; the\nnote’s ",
			createVNode(_components.code, { children: "#1234" }),
			" pills show live outcomes. One click from ",
			createVNode(_components.em, { children: "what" }),
			" to ",
			createVNode(_components.em, { children: "why" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Shipping." }), " The human merges (unchanged). The chip flips because GitHub\nsays so; the note’s pill flips identically — same fact, two renderings; the\nlane retires to shipped when its terminal closes."] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Failure." }),
			" Let it crash: a falsified brief or a wedged agent doesn’t get\ndefensive programming — the supervisor (coordinator) stands the actor down,\nresets it to a stable state (",
			createVNode(_components.code, { children: "/compact" }),
			", or a fresh terminal), and re-briefs.\nThe graph shows the reset for what it is: the same address, a new incarnation."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Chat." }), " pesu renders this same graph into the thread and pings on\nattention — the chat-native note’s “mirror of the coordinator,” now with its\ndata source shipped rather than invented."] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "What stays conversational (deliberately off-board)." }),
			" Gate rulings, CI\nvenue arbitration, box leases — supervisor knowledge with no observable\nsubstrate. They live in dialogue and in notes ",
			createVNode(_components.em, { children: "as decisions" }),
			", never on the\nboard ",
			createVNode(_components.em, { children: "as state" }),
			". Putting them on a board is what created the scribe."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-this-deletes",
			children: "What this deletes"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.code, { children: "orchestrator-data.js" }), " and the same-turn update ritual"] }),
			"\n",
			createVNode(_components.li, { children: "the static dashboard HTML skill asset, and the board-freshness Stop hook" }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "the entire per-repo Astro pipeline" }),
				": 196 MB node_modules, the lockfile,\nthe build, 6.9 MB committed dist, the ",
				createVNode(_components.code, { children: "atlas-sync" }),
				" CI gate"
			] }),
			"\n",
			createVNode(_components.li, { children: "hand-stamped statuses in notes, and their drift" }),
			"\n",
			createVNode(_components.li, { children: "terminal-UUID note links that die on re-key" }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "phases",
			children: "Phases"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Phase" }),
					"\n",
					createVNode(_components.th, { children: "Scope" }),
					"\n",
					createVNode(_components.th, { children: "Deletes" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "P0 — the renderer learns three tricks" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"live ",
						createVNode(_components.code, { children: "#1234" }),
						" pills, ",
						createVNode(_components.code, { children: "[!NOTE]" }),
						" alerts, footnotes, the fence upgrades (phase-tree, html-preview via the existing sandboxed iframe) — all in ",
						createVNode(_components.code, { children: "@kolu/solid-markdown" })
					] }),
					"\n",
					createVNode(_components.td, { children: "nothing yet; unlocks everything" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "P1 — notes go plain" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"migrate the 104 notes MDX → GFM (mechanical for the 10-component vocabulary); delete the Astro pipeline; the ",
						createVNode(_components.code, { children: "/atlas" }),
						" skill shrinks to “write markdown here”"
					] }),
					"\n",
					createVNode(_components.td, { children: "the 196 MB, the dist, the sync gate, the ceremony" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "P2 — the Board tab" }) }),
					"\n",
					createVNode(_components.td, { children: "the derived campaign graph on the server (terminals ⋈ worktrees ⋈ branches ⋈ PRs ⋈ CI ⋈ sensors ⋈ parent edges, reusing the existing cwd-derivation machinery) + the right-panel tab" }),
					"\n",
					createVNode(_components.td, { children: "the dashboard file, its HTML, the freshness hook" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "P3 — the thread mirror" }) }),
					"\n",
					createVNode(_components.td, { children: "pesu renders the graph + attention pings (the chat-native note’s own plan)" }),
					"\n",
					createVNode(_components.td, { children: "nothing — it completes the picture" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Philosophy check",
			children: createVNode(_components.p, { children: [
				"Two tests for every element. ",
				createVNode(_components.strong, { children: "Agent-agnostic" }),
				": the graph watches\nterminals and forges — a lane running codex or opencode renders\nidentically, and a plain shell is a first-class node. ",
				createVNode(_components.strong, { children: "Auto-detected,\nzero setup" }),
				": if any element needs someone to ",
				createVNode(_components.em, { children: "write state" }),
				" for it, it is\ndesigned wrong — redesign it to observe, or move it to a note as a\ndecision."
			] })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "The campaign surface — plain-file knowledge, an observed board, a graph of terminal-actors",
	"description": "Unify Atlas notes, the hand-maintained orchestrator dashboard, and the coming chat bot into one zero-setup surface: notes become plain markdown rendered live by kolu itself (the Astro pipeline is deleted, not improved), campaign state becomes a Board tab derived from what kolu already observes, and the board's true shape is the supervision graph of terminals — because kolu's terminals already are actors in the actor-model sense.",
	"parents": ["feature", "chat-native-agents-and-kolu"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-18T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "why-the-scribe-problem-and-the-atlas-problem",
			"text": "Why: the scribe problem, and the Atlas problem"
		},
		{
			"depth": 2,
			"slug": "the-model-its-actors-all-the-way-down",
			"text": "The model: it’s actors all the way down"
		},
		{
			"depth": 3,
			"slug": "inside-the-coordinator-the-receive-loop",
			"text": "Inside the coordinator: the receive loop"
		},
		{
			"depth": 3,
			"slug": "implementation-what-kolu-builds-vs-what-it-observes",
			"text": "Implementation: what kolu builds vs what it observes"
		},
		{
			"depth": 3,
			"slug": "the-attention-flow-as-its-own-class-kill",
			"text": "The attention flow, as its own class-kill"
		},
		{
			"depth": 2,
			"slug": "the-board--a-third-right-panel-tab-shaped-like-the-graph",
			"text": "The Board — a third right-panel tab, shaped like the graph"
		},
		{
			"depth": 3,
			"slug": "scoping-whose-board-is-this",
			"text": "Scoping: whose board is this?"
		},
		{
			"depth": 2,
			"slug": "knowledge-plain-markdown-rendered-by-the-product",
			"text": "Knowledge: plain markdown, rendered by the product"
		},
		{
			"depth": 2,
			"slug": "how-ui-prototypes-live-in-notes",
			"text": "How UI prototypes live in notes"
		},
		{
			"depth": 2,
			"slug": "the-flows",
			"text": "The flows"
		},
		{
			"depth": 2,
			"slug": "what-this-deletes",
			"text": "What this deletes"
		},
		{
			"depth": 2,
			"slug": "phases",
			"text": "Phases"
		}
	];
}
var url = "src/content/atlas/campaign-surface.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/campaign-surface.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/campaign-surface.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Chip, Content, Content as default, Dot, GNode, GraphMock, file, frontmatter, getHeadings, url };
