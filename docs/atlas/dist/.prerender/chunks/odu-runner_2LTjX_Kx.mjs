import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$D2 } from "./D2_CXsCOQdn.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import { t as $$Issue } from "./Issue_CB1XoZJT.mjs";
import { n as $$Roadmap, t as $$Milestone } from "./Milestone_B0slHbDx.mjs";
import { t as $$Terminal } from "./Terminal_Cqh2_20m.mjs";
//#region src/content/atlas/odu-runner.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
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
			createVNode(_components.em, { children: [
				createVNode(_components.a, {
					href: "./odu-web.html",
					children: "odu-web"
				}),
				" opens with “Phase 0 · prerequisites in the runner” and points back at ",
				createVNode(_components.a, {
					href: "./odu.html",
					children: "odu"
				}),
				"’s backlog. This note is that phase given its own work order: what the runner must become before a service can sit on top of it — and why each piece is the runner’s job rather than the service’s."
			] }),
			" ",
			createVNode($$Pill, {
				variant: "done",
				children: "accepted · R2 shipped"
			})
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Status: ",
			createVNode($$Pill, {
				variant: "done",
				children: "accepted"
			}),
			" · maturity ",
			createVNode($$Pill, {
				variant: "todo",
				children: "seedling"
			}),
			" · ",
			createVNode(_components.strong, { children: "R2 (run identity) shipped" }),
			" — ",
			createVNode($$PrLink, {
				pr: 28,
				repo: "juspay/odu",
				label: "juspay/odu#28"
			}),
			", consumed here via the ",
			createVNode(_components.code, { children: "npins update odu" }),
			" bump in this PR; ",
			createVNode(_components.strong, { children: "R1 (serve/run split)" }),
			" rides the ",
			createVNode(_components.a, {
				href: "./surface-daemon.html",
				children: "surface-daemon"
			}),
			" spine (sequenced behind kaval B1/B2) and ",
			createVNode(_components.strong, { children: "R3 (lifecycle)" }),
			" follows it · consumer: ",
			createVNode(_components.a, {
				href: "./odu-web.html",
				children: "odu-web"
			}),
			" Phase 1 (the ledger R2 just built) and Phase 2 (the live observer, still waiting on R1’s idle attach)"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The idea in one paragraph",
			children: createVNode(_components.p, { children: [
				"odu’s coordinator is ",
				createVNode(_components.strong, { children: "run-scoped" }),
				": ",
				createVNode(_components.code, { children: "odu run" }),
				" spawns it, it binds ",
				createVNode(_components.code, { children: ".ci/odu.sock" }),
				", owns one DAG, and when the run settles it exits — taking the socket and every answer with it. Each face papers over this differently: the TUI lives inside the run, the MCP face’s ",
				createVNode(_components.code, { children: "run" }),
				" tool ",
				createVNode(_components.em, { children: "spawns" }),
				" the coordinator it then talks to, and ",
				createVNode(_components.code, { children: "status" }),
				" with nothing live has nothing to dial. A service cannot paper over it: odu-web needs a thing that is ",
				createVNode(_components.em, { children: "there" }),
				" — attachable while idle, listing runs that finished, addressing each by an identity stable enough to put in a ledger and a URL. The fix is one inversion, the same one odu itself made against justci: ",
				createVNode(_components.strong, { children: "the socket stops belonging to the run; runs become things the long-lived server owns." }),
				" ",
				createVNode(_components.code, { children: "run" }),
				" becomes a procedure on the surface, runs gain a ",
				createVNode(_components.code, { children: "(repo, sha, seq)" }),
				" identity, and the lifecycle question — who keeps the server alive, at what cost — gets priced explicitly against the warm pu-box pool instead of inherited accidentally."
			] })
		}),
		"\n",
		createVNode($$D2, {
			caption: "Phase 0 as one inversion. Faces (top) attach to a long-lived server that owns the socket and a runs collection; per-run execution (the proven DAG machinery) is unchanged underneath, spawned into the server instead of being the process. Verdicts flow out to the per-SHA trail odu-web's ledger ingests.",
			code: `
direction: down

faces: "faces — TUI · MCP · odu-web (its Phase 2)"

serve: "odu serve — the long-lived coordinator" {
sock: ".ci/odu.sock — outlives any run"
runs: "runs cell — identity: repo × sha × seq"
proc: "run — a procedure on the surface"
}

exec: "per-run execution — unchanged" {
dag: "DAG · nodes · nodeLog · rerun"
lanes: "platform lanes over HostSession"
}

trail: "per-SHA logs + verdicts — the trail odu-web ingests"

faces -> serve: "attach any time — idle included"
serve -> exec: "spawns runs into itself"
exec -> trail: "on settle — survives the server"
`
		}),
		"\n",
		createVNode(_components.h2, {
			id: "serve-dont-spawn--the-socket-outlives-the-run",
			children: "Serve, don’t spawn — the socket outlives the run"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Today the answer to “is CI okay?” depends on whether a process happens to be alive. ",
			createVNode(_components.code, { children: "odu status" }),
			", ",
			createVNode(_components.code, { children: "logs" }),
			", ",
			createVNode(_components.code, { children: "attach" }),
			", and the MCP face all dial ",
			createVNode(_components.code, { children: ".ci/odu.sock" }),
			" — in-band, typed, the whole point — but the coordinator serving that socket exists only between ",
			createVNode(_components.code, { children: "run" }),
			"’s first node and its verdict. ",
			createVNode(_components.a, {
				href: "./odu.html",
				children: "The odu note"
			}),
			" flagged this honestly at Phase 1 (“idle attach — a runner you can reach with no run live — moved to Phase 2 with the long-lived-runner question”) and the MCP face inherited the shape: its ",
			createVNode(_components.code, { children: "run" }),
			" tool ",
			createVNode(_components.em, { children: "spawns the coordinator" }),
			", which is why ",
			createVNode(_components.code, { children: "run" }),
			" is an MCP tool at all rather than just another surface call."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The split: ",
			createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "odu serve" }),
				" owns the socket; ",
				createVNode(_components.code, { children: "run" }),
				" becomes a procedure on the surface."
			] }),
			" The CLI UX does not change — ",
			createVNode(_components.code, { children: "odu run" }),
			" ensures a server (starting one if absent) and invokes the procedure; ",
			createVNode(_components.code, { children: "attach" }),
			" connects whether anything is running or not. What changes is what attach shows when nothing is live:"
		] }),
		"\n",
		createVNode($$Terminal, {
			title: "odu attach — idle, nothing running",
			lines: [
				"$ odu attach",
				"» dialing .ci/odu.sock … connected (idle — 0 running)",
				" ",
				"  odu · juspay/kolu                        ● serving",
				" ",
				"  recent runs",
				"   seq  sha       ref          verdict      when",
				"   47   26d2c2d   master       ✓ green      2h ago",
				"   46   53c0889   PR #1291     ✗ e2e        5h ago",
				"   45   b01c635   master       ✓ green      1d ago",
				" ",
				"  r run HEAD    [enter] open a run    q quit"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Two design facts make this cheap rather than risky. First, the serve-only failure mode is already banked knowledge: justci built an MCP server and reverted it (",
			createVNode($$Issue, {
				n: 22,
				repo: "juspay/justci",
				label: "MCP server for ci"
			}),
			", ",
			createVNode($$PrLink, {
				pr: 18,
				repo: "juspay/justci"
			}),
			") because launching its server ",
			createVNode(_components.em, { children: "auto-ran every recipe" }),
			" — a runner that owns the DAG as idle state has start/serve separation by construction, and Phase 0 merely promotes that property from “by construction” to “by contract.” Second, the execution half doesn’t move: the DAG machinery, platform lanes over ",
			createVNode(_components.code, { children: "HostSession" }),
			", status posting, and per-SHA logs are the proven substrate — they get ",
			createVNode(_components.em, { children: "spawned into" }),
			" the server instead of ",
			createVNode(_components.em, { children: "being" }),
			" the process."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The MCP face simplifies as a side effect: ",
			createVNode(_components.code, { children: "run" }),
			" stops being the odd tool that forks a process and becomes the same thin projection as the other four — and ",
			createVNode(_components.code, { children: "wait_for_settle" }),
			" can finally outlive the thing it waits on without holding the coordinator’s stdio hostage."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "run-identity--the-tuple-a-ledger-can-hold",
			children: "Run identity — the tuple a ledger can hold"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"odu’s surface today is implicitly singular: ",
			createVNode(_components.em, { children: "the" }),
			" ",
			createVNode(_components.code, { children: "nodes" }),
			" cell, ",
			createVNode(_components.em, { children: "the" }),
			" ",
			createVNode(_components.code, { children: "nodeLog" }),
			" stream — correct while the coordinator and the run are the same object, meaningless the moment one server hosts run 46 and run 47. ",
			createVNode(_components.a, {
				href: "./odu-web.html",
				children: "odu-web"
			}),
			"’s ledger and run pages need to reference runs from outside any process lifetime, which sets the requirement: identity must be ",
			createVNode(_components.strong, { children: "mintable by the runner, durable in the trail, and meaningful in a URL" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The tuple is ",
			createVNode(_components.code, { children: "(repo, sha, seq)" }),
			" — ",
			createVNode(_components.code, { children: "seq" }),
			" because the same SHA runs more than once (a rerun after an infra flake is a ",
			createVNode(_components.em, { children: "new run" }),
			", not a mutation of the old one’s history) — and ",
			createVNode(_components.code, { children: "node" }),
			" addresses within a run. On the surface this lands as one new collection and a scope parameter on the existing primitives:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Surface call" }),
					"\n",
					createVNode(_components.th, { children: "Today" }),
					"\n",
					createVNode(_components.th, { children: "After Phase 0" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "runs.get({})" }) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n",
					createVNode(_components.td, { children: "New cell: every run the server knows — identity, ref, verdict, timestamps. The idle-attach screen and odu-web’s ledger ingest are both projections of it." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "nodes.get({})" }) }),
					"\n",
					createVNode(_components.td, { children: "The run’s nodes" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "nodes.get({ run? })" }), " — defaults to the latest run, so every shipped face keeps working unmodified."] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "nodeLog.get({ id })" }) }),
					"\n",
					createVNode(_components.td, { children: "The run’s node log" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "nodeLog.get({ run?, id })" }), " — same default."] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "node.rerun({ id })" }) }),
					"\n",
					createVNode(_components.td, { children: "Reset + reschedule" }),
					"\n",
					createVNode(_components.td, { children: [
						"Unchanged semantics, latest-run scope; rerunning a ",
						createVNode(_components.em, { children: "finished" }),
						" run’s node means starting a new run (a ",
						createVNode(_components.code, { children: "seq" }),
						" bump), keeping history append-only."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The defaulting rule is the compatibility story: latest-run scope is exactly today’s behavior, so the TUI, the ",
			createVNode(_components.code, { children: "/ci" }),
			" skill, and the MCP tools are correct on day one, and grow ",
			createVNode(_components.code, { children: "run" }),
			" parameters at leisure. The append-only rule is the ledger story: odu-web never has to model “history changed,” only “a run was added” — which is also what keeps the per-SHA on-disk trail (already durable past runner death, by Phase 1 design) a faithful serialization of the same identity rather than a second bookkeeping scheme."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "lifecycle-and-pricing--who-keeps-it-alive",
			children: "Lifecycle and pricing — who keeps it alive"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A long-lived process is a cost, and ",
			createVNode(_components.a, {
				href: "./odu.html",
				children: "the odu note"
			}),
			" priced the warning into its own roadmap: ",
			createVNode(_components.em, { children: "“price the idle-runner lifecycle against the warm pu-box pool.”" }),
			" The pool (",
			createVNode(_components.code, { children: "kolu-ci-1..8" }),
			", leased via ",
			createVNode(_components.code, { children: "ci/pu/lease.sh" }),
			") already solved the adjacent problem — keep the ",
			createVNode(_components.em, { children: "expensive" }),
			" thing warm (a Nix store on a Linux box) so the ",
			createVNode(_components.em, { children: "cheap" }),
			" thing (a run) starts fast. Phase 0 should not blur that: the coordinator is not the expensive thing. It is a small node process serving a socket, and its lifecycle has three honest options, not one:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Foreground, operator-owned" }),
				" — ",
				createVNode(_components.code, { children: "odu serve" }),
				" in a terminal (or under the kolu app), dying with the session. Zero new infrastructure; idle attach works while you work. The right default for the single-operator loop, and Phase 0’s exit bar."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Supervised, machine-owned" }),
				" — a home-manager / systemd unit, already named on odu’s graduation roadmap. The right shape ",
				createVNode(_components.em, { children: "under odu-web" }),
				", where the server and the service share a host and the unit is the service’s substrate, not the operator’s."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "On-demand with durable trail" }),
				" — no resident process at all: ",
				createVNode(_components.code, { children: "run" }),
				" auto-starts a server that lingers (idle timeout) and exits, because the ledger — not the live server — is what answers history questions. This is the honest fallback that keeps “no daemon to register” true for casual consumers of ",
				createVNode(_components.code, { children: "nix run github:juspay/odu" }),
				"."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-kaval-overlap--shared-spine-different-soul",
			children: "The kaval overlap — shared spine, different soul"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.a, {
				href: "./pty-daemon.html",
				children: "kaval"
			}),
			" — the PTY daemon kolu is splitting out in four PRs (",
			createVNode($$PrLink, {
				pr: 1291,
				label: "the plan"
			}),
			") — needs the identical machinery: a pid-gated entry, a unix socket that outlives its clients, a contract handshake on every connect, an endpoint state machine, spawn/respawn drivers, a composed restart. That convergence now has its own plan of record — ",
			createVNode(_components.strong, { children: createVNode(_components.a, {
				href: "./surface-daemon.html",
				children: "surface-daemon"
			}) }),
			" — which names the shared ",
			createVNode(_components.strong, { children: "spine" }),
			", sequences its extraction into ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			"(",
			createVNode(_components.code, { children: "-daemon" }),
			") after kaval’s B2 has soaked in production, and lists ",
			createVNode(_components.code, { children: "odu serve" }),
			" as the second consumer that clears the ",
			createVNode(_components.a, {
				href: "./electricity.html",
				children: "electricity"
			}),
			" bar. The practical consequence for this note: ",
			createVNode(_components.strong, { children: "R1 and R3 consume that spine rather than hand-rolling a copy" }),
			" — they sequence behind kaval B1/B2 — while ",
			createVNode(_components.strong, { children: "R2 (run identity) has no kaval dependency at all" }),
			" and is the piece ",
			createVNode(_components.a, {
				href: "./odu-web.html",
				children: "odu-web"
			}),
			" Phase 1 actually blocks on, so it can land first."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"What does ",
			createVNode(_components.em, { children: "not" }),
			" transfer is the soul. kaval holds irreplaceable kernel state — live PTY fds — so its survival phase (B3: adoption, reconciliation) is its whole point. odu serve holds replaceable orchestration state: the trail is durable, runs are append-only, a lost run is a ",
			createVNode(_components.code, { children: "seq" }),
			"-bump rerun. So none of B3 crosses over, and this note’s “live-state resurrection stays out of scope” survives the deduplication. Same mechanism, opposite policies — which is exactly the evidence the mechanism belongs in a library."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Crash semantics follow the same line the gate half already drew: a dying lane posts ",
			createVNode(_components.code, { children: "error" }),
			"/",
			createVNode(_components.code, { children: "Errored" }),
			" rather than wedging (shipped in Phase 1 of the odu plan), and a dying ",
			createVNode(_components.em, { children: "server" }),
			" must degrade the same way — in-flight runs marked errored in the trail, finished runs untouched, restart resuming an empty-but-serving state. ",
			createVNode(_components.strong, { children: [
				"Runner-restart survival of ",
				createVNode(_components.em, { children: "live" }),
				" state stays out of scope"
			] }),
			", exactly as the odu ledger scoped it: the durable artifact is the trail, and resurrection of a half-run DAG buys complexity that a ",
			createVNode(_components.code, { children: "seq" }),
			"-bump rerun buys back for free."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "phases",
			children: "Phases"
		}),
		"\n",
		createVNode(_components.p, { children: "Each lands alone; together they retire odu-web’s Phase 0 row." }),
		"\n",
		createVNode($$Roadmap, { children: [
			createVNode($$Milestone, {
				status: "done",
				label: "R2 · run identity — shipped",
				children: [
					createVNode(_components.strong, { children: "Shipped" }),
					" in ",
					createVNode($$PrLink, {
						pr: 28,
						repo: "juspay/odu",
						label: "juspay/odu#28"
					}),
					" (through the full lens + codex + simplify + police gauntlet, odu-on-odu CI green) and consumed here via ",
					createVNode(_components.code, { children: "npins update odu" }),
					". Every terminal run writes a durable ",
					createVNode(_components.code, { children: "RunRecord" }),
					" — ",
					createVNode(_components.code, { children: "(repo, sha, seq)" }),
					" identity + tri-state ",
					createVNode(_components.code, { children: "outcome" }),
					" (",
					createVNode(_components.code, { children: "passed" }),
					"/",
					createVNode(_components.code, { children: "failed" }),
					"/",
					createVNode(_components.code, { children: "incomplete" }),
					") + timing + lane→host map + a per-node snapshot — to ",
					createVNode(_components.code, { children: ".ci/<sha7>/runs/<seq>.json" }),
					", on natural completion, each linger drain, ",
					createVNode(_components.strong, { children: "and" }),
					" the shared shutdown (so a cancelled/interrupted run records too, marked ",
					createVNode(_components.code, { children: "incomplete" }),
					"). ",
					createVNode(_components.code, { children: "odu runs [-o json]" }),
					" lists the ledger straight off disk — the first command that works against an idle checkout — and the agent face gained a read-only ",
					createVNode(_components.code, { children: "runs" }),
					" MCP tool over the same trail. ",
					createVNode(_components.strong, { children: "Scope refined in the build:" }),
					" the original sketch’s ",
					createVNode(_components.em, { children: "live" }),
					" ",
					createVNode(_components.code, { children: "runs" }),
					" cell + run-scope params on ",
					createVNode(_components.code, { children: "nodes" }),
					"/",
					createVNode(_components.code, { children: "nodeLog" }),
					"/",
					createVNode(_components.code, { children: "rerun" }),
					" were deliberately ",
					createVNode(_components.strong, { children: "not" }),
					" built — they’re meaningless until R1’s long-lived multi-run server exists, so R2 delivered the durable on-disk ledger (the rows a service face reads) instead, exactly the “applies to today’s run-scoped coordinator unchanged” path. ",
					createVNode(_components.strong, { children: "Exit met:" }),
					" a CLI ",
					createVNode(_components.code, { children: "odu run" }),
					" and an MCP-spawned run land in one ",
					createVNode(_components.code, { children: "odu runs" }),
					" list with stable ",
					createVNode(_components.code, { children: "sha#seq" }),
					" ids — the ids ",
					createVNode(_components.a, {
						href: "./odu-web.html",
						children: "odu-web"
					}),
					" Phase 1 puts in ledger rows and ",
					createVNode(_components.code, { children: "target_url" }),
					"s. ",
					createVNode(_components.code, { children: "seq" }),
					" makes a rerun of one commit a new record, not an overwrite."
				]
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "R1 · the serve/run split — rides the kaval spine",
				children: [
					createVNode(_components.code, { children: "odu serve" }),
					" owns ",
					createVNode(_components.code, { children: ".ci/odu.sock" }),
					"; ",
					createVNode(_components.code, { children: "run" }),
					" becomes a surface procedure; the CLI keeps its exact UX by ensuring a server before invoking it. The MCP face’s ",
					createVNode(_components.code, { children: "run" }),
					" tool becomes a thin projection like its siblings. The entry — pid-gate (per-repo scope key), serve loop, handshake-on-connect — comes from the spine (",
					createVNode(_components.a, {
						href: "./surface-daemon.html",
						children: "surface-daemon"
					}),
					"; both halves are packages from birth, kaval B1/B2), so this sequences behind kaval B2 and S1’s handshake move. ",
					createVNode(_components.strong, { children: [
						"Exit: ",
						createVNode(_components.code, { children: "odu attach" }),
						" connects with nothing running"
					] }),
					" and shows a (possibly empty) runs list — without odu defining a pid-gate, entry sequence, or handshake of its own."
				]
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "R3 · lifecycle, crash semantics, pricing",
				children: [
					"The three lifecycle modes made real: foreground default, the home-manager unit (graduation roadmap item), idle-timeout auto-serve as the no-daemon fallback — lifetime is a spine parameter, the mode choice is this program’s policy. The supervisor half (endpoint states, ",
					createVNode(_components.code, { children: "waitForPidGone" }),
					", composed restart) likewise comes from ",
					createVNode(_components.a, {
						href: "./surface-daemon.html",
						children: "surface-daemon"
					}),
					". Server death marks in-flight runs errored in the trail and restarts clean. The pricing note written against the warm pu-box pool: what stays warm, what spawns, and why the coordinator is never the expensive half. ",
					createVNode(_components.strong, { children: "Exit: kill the server mid-run — the trail shows errored, restart serves history, nothing wedges." })
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
	"title": "odu-runner — a runner you can reach with nothing running",
	"description": "Phase 0 of odu-web, owned by the runner: split serve from run so the socket outlives any single pipeline, give runs an identity a ledger can hold (repo × sha × seq × node), and decide who keeps the long-lived coordinator alive — priced against the warm pu-box pool. Everything odu-web consumes; nothing odu-web should have to build.",
	"parents": ["odu", "feature"],
	"status": "accepted",
	"maturity": "seedling",
	"updated": "2026-06-12T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "serve-dont-spawn--the-socket-outlives-the-run",
			"text": "Serve, don’t spawn — the socket outlives the run"
		},
		{
			"depth": 2,
			"slug": "run-identity--the-tuple-a-ledger-can-hold",
			"text": "Run identity — the tuple a ledger can hold"
		},
		{
			"depth": 2,
			"slug": "lifecycle-and-pricing--who-keeps-it-alive",
			"text": "Lifecycle and pricing — who keeps it alive"
		},
		{
			"depth": 3,
			"slug": "the-kaval-overlap--shared-spine-different-soul",
			"text": "The kaval overlap — shared spine, different soul"
		},
		{
			"depth": 2,
			"slug": "phases",
			"text": "Phases"
		}
	];
}
var url = "src/content/atlas/odu-runner.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/odu-runner.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/odu-runner.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
