import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$D2 } from "./D2_CPv-UX0x.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import { t as $$Issue } from "./Issue_mLFqCJSR.mjs";
//#region src/content/atlas/herdr-vs-kolu.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		hr: "hr",
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
		createVNode(_components.p, { children: [
			createVNode(_components.em, { children: [
				"A study of ",
				createVNode(_components.a, {
					href: "https://github.com/ogulcancelik/herdr",
					children: "ogulcancelik/herdr"
				}),
				" (cloned @ HEAD) read through kolu’s remote-terminals plan (",
				createVNode($$Issue, { n: 951 }),
				" and the ",
				createVNode(_components.code, { children: "pty-daemon" }),
				" / ",
				createVNode(_components.code, { children: "kaval-tui" }),
				" / ",
				createVNode(_components.code, { children: "chrome-bar" }),
				" docs). Sibling to the"
			] }),
			" ",
			createVNode(_components.strong, { children: "Ghostex vs. kolu remote-terminals" }),
			" ",
			createVNode(_components.em, { children: "analysis. Every load-bearing claim below was fact-checked against both codebases — herdr citations all verified; three kolu-side claims were corrected (noted inline)." }),
			" ",
			createVNode($$Pill, {
				variant: "new",
				children: "13-agent workflow + adversarial critique"
			})
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Headline",
			children: createVNode(_components.p, { children: [
				"herdr makes the ",
				createVNode(_components.strong, { children: "same bet kolu chose" }),
				": a first-party process owns every PTY, with thin clients attaching over a unix socket. That is the opposite of Ghostex (external mux owns PTY lifetime) — so ",
				createVNode(_components.strong, { children: "herdr sits on kolu’s side of that line and is a shipped, battle-tested implementation of exactly the problems R2.4 is about to build" }),
				": survival across restart, transactional recovery, lazy snapshot-attach, even live fd handoff. Ghostex told us the seam is ",
				createVNode(_components.em, { children: "natural" }),
				"; herdr shows us the ",
				createVNode(_components.em, { children: "mechanism" }),
				" for the survivor we already decided to build. Two of kolu’s plans — ",
				createVNode(_components.strong, { children: "kaval-tui" }),
				" and ",
				createVNode(_components.strong, { children: "agents-orchestrate-kolu" }),
				" — are essentially herdr, already shipped. The highest-value output is two ideas the plans didn’t cover — and one of them, ",
				createVNode(_components.strong, { children: "native agent-session resume" }),
				", kolu now ships too (juspay/kolu#1495 adopted herdr’s injection-safe by-id model). That leaves ",
				createVNode(_components.strong, { children: "multi-client resize arbitration" }),
				" as the standing gap: kolu has no arbiter today — resize is last-write-wins, so two differently-sized web clients already thrash; kaval-tui attach, now shipped, drives the PTY from its own terminal size and only sharpens the mismatch."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Both projects are ",
			createVNode(_components.strong, { children: "AGPL-3.0-or-later" }),
			", so herdr’s open-source code is license-compatible with kolu — porting is permitted under the AGPL’s terms, not blocked. The reason most recommendations are ",
			createVNode(_components.em, { children: "techniques and design" }),
			" rather than verbatim code is the stack gap (herdr is Rust; kolu is TypeScript/SolidJS), not licensing."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"herdr is a ~107K-LOC ",
			createVNode(_components.strong, { children: "Rust TUI agent multiplexer" }),
			": one binary, a long-lived background server that owns every PTY (one ghostty VT emulator + one OS-thread PTY actor per pane), thin clients that attach/detach over a unix socket. Workspaces → tabs → panes. An agent-awareness sidebar rolls each workspace up to its most urgent state (",
			createVNode(_components.code, { children: "blocked / working / done / idle" }),
			"). A second socket exposes a JSON API so ",
			createVNode(_components.em, { children: "agents themselves" }),
			" can create panes, read output, and ",
			createVNode(_components.code, { children: "wait" }),
			" for state. Named sessions, remote-over-SSH, 14+ agent integrations, and an experimental zero-downtime live handoff."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-architectural-contrast",
			children: "The architectural contrast"
		}),
		"\n",
		createVNode($$D2, {
			caption: "Module correspondence. SOLID edges = herdr validates a decision kolu already made, or a direct borrow. DASHED edges = a gap or an explicit non-goal. herdr owns one long-lived server; kolu's R2 inverts the survivor to kaval (the package renamed from @kolu/pty-host in R2.2) while the provider DAG runs fresh in kolu-server.",
			code: `
direction: down

herdr: "herdr — Rust TUI multiplexer (first-party server owns the PTYs)" {
server: "background server (server/headless.rs)"
pty: "PTY actor per pane (pty/actor.rs)"
handoff: "live handoff — SCM_RIGHTS fd-pass (server/handoff.rs)"
detect: "agent detect + socket API (detect/, api/)"
resume: "native resume — claude --resume (agent_resume.rs)"
fg: "foreground_client_id — shared geometry (server/headless.rs)"
}

kolu: "kolu — SolidJS web ADE (R2: kaval is the survivor)" {
ptyhost: "kaval (node-pty + @xterm/headless mirror)"
server2: "kolu-server — provider DAG, runs fresh"
surface: "@kolu/surface (oRPC links: ws / stdio / direct)"
tui: "kaval-tui (raw client) — shipped: list / snapshot / attach (spawn/kill = Phase 3, planned)"
recovery: "R2.4 recovery (capture -> drain -> respawn) — planned"
}

herdr.server -> kolu.ptyhost: "validates: thin survivor owns PTYs (A2)"
herdr.pty -> kolu.surface: "validates: snapshot-on-attach (A3)"
herdr.handoff -> kolu.recovery: "borrow DISCIPLINE; reject fd-pass (A1 / A7)" {
style.stroke-dash: 4
}
herdr.detect -> kolu.server2: "Done=unseen rollup + optional hooks (U1 / U2)"
herdr.resume -> kolu.ptyhost: "adopted: native session resume (G1, juspay/kolu#1495)"
herdr.fg -> kolu.tui: "GAP: resize arbitration (G2)" {
style.stroke-dash: 4
}
`
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Concern" }),
					"\n",
					createVNode(_components.th, { children: createVNode(_components.strong, { children: "herdr" }) }),
					"\n",
					createVNode(_components.th, { children: createVNode(_components.strong, { children: "kolu (built + planned)" }) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Who owns PTY lifetime" }),
					"\n",
					createVNode(_components.td, { children: [
						"First-party long-lived ",
						createVNode(_components.strong, { children: "server" }),
						" owns every master fd; clients are stateless front-ends."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Same bet." }),
						" R2 makes ",
						createVNode(_components.code, { children: "kaval" }),
						" the thin survivor; the volatile provider DAG runs fresh in kolu-server."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Survive restart" }),
					"\n",
					createVNode(_components.td, { children: [
						"Server outlives clients; full restart restores from a snapshot; ",
						createVNode(_components.code, { children: "resume_agents_on_restore" }),
						" respawns agents."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"kaval-tui = client detach/reattach; R2.4 = daemon survives ",
						createVNode(_components.code, { children: "systemctl restart" }),
						" via cgroup-escape + reattach-by-id. The ",
						createVNode($$Issue, { n: 1034 }),
						" hazard lives here."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Recovery on owner restart" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "Transactional" }), ": old owner stays alive and re-binds sockets until the new one acks; one bool gates who may signal children; injected-failure tested."] }),
					"\n",
					createVNode(_components.td, { children: [
						"R2.4’s composed ",
						createVNode(_components.code, { children: "captureSession → drainTerminals → respawn → finalize" }),
						" with ",
						createVNode(_components.code, { children: "waitForPidGone" }),
						" — designed to never repeat the “kill-then-pray” loss."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Late / lazy attach" }),
					"\n",
					createVNode(_components.td, { children: [
						"A ",
						createVNode(_components.strong, { children: "live screen snapshot" }),
						", never a byte replay: reset baseline → re-render the live emulator into one full frame."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Same:" }),
						" ",
						createVNode(_components.code, { children: "ptyHost.ts" }),
						" subscribes then serializes a ",
						createVNode(_components.code, { children: "snapshot | delta" }),
						" union (~4KB)."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Renderer" }),
					"\n",
					createVNode(_components.td, { children: "Server diffs a cell-grid → ANSI. No web terminal." }),
					"\n",
					createVNode(_components.td, { children: [
						"Raw VT → ",
						createVNode(_components.code, { children: "xterm.js" }),
						" in the browser; the headless mirror is for snapshot + taps only."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "architecture--what-to-adopt",
			children: "Architecture — what to adopt"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "A1 · Transactional handoff discipline → R2.4 recovery",
			children: [createVNode(_components.p, { children: [
				createVNode($$Pill, {
					variant: "good",
					children: "high"
				}),
				" ",
				createVNode($$Pill, {
					variant: "new",
					children: "direct"
				}),
				" \xA0 herdr’s restart is choreographed: the ",
				createVNode(_components.strong, { children: ["old owner stays alive and re-binds its sockets until the new one acks ", createVNode(_components.code, { children: "owned" })] }),
				", and ",
				createVNode(_components.strong, { children: "exactly one boolean" }),
				" (",
				createVNode(_components.code, { children: "preserve_processes_on_drop" }),
				") decides who may signal children — so a failed migration is a structural no-op and double-kill is impossible. Tested with ",
				createVNode(_components.em, { children: "injected import failures" }),
				". ",
				createVNode(_components.em, { children: "(herdr src/pane.rs:555 (flag), :689-702 (Drop); server/headless.rs:734-828; tests/live_handoff.rs:1279,:1359,:1442.)" })
			] }), createVNode(_components.p, { children: [
				"Borrow the ",
				createVNode(_components.strong, { children: "discipline, not the mechanism" }),
				": make “who may kill these PTYs” a single structural flag (kolu’s ",
				createVNode(_components.code, { children: "killAndUnwatch" }),
				" ordering is already that shape) and write the injected-respawn-failure test ",
				createVNode(_components.strong, { children: "RED first" }),
				". One adaptation: herdr’s rollback ",
				createVNode(_components.em, { children: "resurrects" }),
				" the old process; kolu’s forced path ",
				createVNode(_components.em, { children: "kills" }),
				" the daemon, so kolu’s rollback analog is ",
				createVNode(_components.strong, { children: "restore-from-snapshot" }),
				" (",
				createVNode(_components.code, { children: "setSavedSession" }),
				" winning the autosave-cancel race), not resurrect."
			] })]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "A2 · Thin-survivor + single-owner kill invariant",
			children: createVNode(_components.p, { children: [
				createVNode($$Pill, {
					variant: "good",
					children: "high"
				}),
				" ",
				createVNode($$Pill, {
					variant: "new",
					children: "direct"
				}),
				" \xA0 herdr holds PTYs in a registry ",
				createVNode(_components.em, { children: "outside" }),
				" AppState; client detach never touches it. ",
				createVNode(_components.em, { children: "(herdr runtime_registry.rs:11; pane.rs:555,:689-702.)" }),
				" This independently confirms R2’s correction over ",
				createVNode($$Issue, { n: 1031 }),
				". kolu already has the right shape — ",
				createVNode(_components.code, { children: "teardownProviders" }),
				" aborts the exit tap ",
				createVNode(_components.em, { children: "before" }),
				" the kill so an intentional kill can’t double-publish ",
				createVNode(_components.code, { children: "terminalExit" }),
				", over a module-scoped long-lived registry. ",
				createVNode(_components.em, { children: "(verified: packages/server/src/terminalEndpoint/local.ts:535,:558-563; terminal-registry.ts:33.)" }),
				" Make the single-ownership bit explicit so a kolu-server restart can never reach the daemon’s PTYs — the win is the audit property (one flag, one owner), since Node has no ",
				createVNode(_components.code, { children: "Drop" }),
				"."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "A3 · Snapshot-on-attach — promote to an invariant test",
			children: createVNode(_components.p, { children: [
				createVNode($$Pill, {
					variant: "good",
					children: "medium"
				}),
				" ",
				createVNode($$Pill, {
					variant: "new",
					children: "direct"
				}),
				" \xA0 herdr brings a connecting client current from the ",
				createVNode(_components.em, { children: "live emulator screen" }),
				", never by replaying history (reset baseline → one full frame). ",
				createVNode(_components.em, { children: "(herdr render_stream.rs:31-36; headless.rs:1639.)" }),
				" kolu does the same — ",
				createVNode(_components.code, { children: "attach()" }),
				" subscribes ",
				createVNode(_components.em, { children: "before" }),
				" it serializes, both synchronously, so each chunk lands in exactly one of snapshot/deltas. ",
				createVNode(_components.em, { children: "(verified: packages/kaval/src/ptyHost.ts:501-509.)" }),
				" Add an invariant test (subscribe-during-burst sees no gap/overlap), and cap R5 migration-only replay at a small bound like herdr’s 8KB/pane. ",
				createVNode(_components.strong, { children: [
					"The keyboard-protocol question (G3) was answered in ",
					createVNode($$PrLink, { pr: 1255 }),
					":"
				] }),
				" ",
				createVNode(_components.code, { children: "@kolu/terminal-protocol" }),
				"’s ",
				createVNode(_components.code, { children: "SNAPSHOT_TTY_RESET" }),
				" is the reciprocal of SerializeAddon 0.14.x’s mode vocabulary (alt-screen, mouse, bracketed paste; kitty keyboard is ",
				createVNode(_components.em, { children: "not" }),
				" serialized by 0.14.x — audit on every xterm bump)."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "A4 · Two-axis honest-state → R2.4's DaemonStatus / DegradedCanvas",
			children: createVNode(_components.p, { children: [
				createVNode($$Pill, {
					variant: "todo",
					children: "medium"
				}),
				" ",
				createVNode($$Pill, {
					variant: "new",
					children: "direct"
				}),
				" \xA0 herdr never renders a dead link as emptiness — a disconnect reason of ",
				createVNode(_components.code, { children: "detached" }),
				" maps to a “run ",
				createVNode(_components.code, { children: "herdr …" }),
				" to reattach” hint, and per-client render baselines are tracked independently. ",
				createVNode(_components.em, { children: "(herdr src/client/mod.rs:226-241.)" }),
				" (The ",
				createVNode(_components.code, { children: "getDaemonHandle" }),
				"-throws / ",
				createVNode(_components.code, { children: "daemonStatusSnapshot" }),
				"-never-throws split is ",
				createVNode(_components.em, { children: "kolu’s own planned-R2.4 vocabulary" }),
				" — not yet built, not herdr code; herdr’s contribution is the principle.) A third independent system reaching the pane⟂session split kolu committed to from Ghostex — adopt the two-axis shape literally with ",
				createVNode(_components.code, { children: "disconnected → pty UNKNOWN-grey" }),
				" (never a false green), and add herdr’s inline-recovery-action detail."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "A5 · kaval-tui = CLI-is-the-API, over a stable socket path",
			children: createVNode(_components.p, { children: [
				createVNode($$Pill, {
					variant: "warn",
					children: "medium"
				}),
				" ",
				createVNode($$Pill, {
					variant: "warn",
					children: "adapt"
				}),
				" \xA0 herdr’s CLI subcommands are tiny 1:1 wrappers that write one typed request; the client-protocol socket path is ",
				createVNode(_components.em, { children: "derived" }),
				" from the API socket path (one override configures both) and chmod’d ",
				createVNode(_components.code, { children: "0600" }),
				". ",
				createVNode(_components.em, { children: "(herdr socket_paths.rs:50-66,:12; ipc.rs:78-82.)" }),
				" kaval-tui resolved its socket path the herdr way in Phase 1 (",
				createVNode($$PrLink, { pr: 1084 }),
				"): ",
				createVNode(_components.code, { children: "getPtyHostSocketPath" }),
				" defaults to ",
				createVNode(_components.code, { children: "$XDG_RUNTIME_DIR/kolu/pty-host.sock" }),
				" (else ",
				createVNode(_components.code, { children: "/tmp/kolu-$UID/pty-host.sock" }),
				"), so ",
				createVNode(_components.code, { children: "kaval-tui list" }),
				" finds the server without its pid and R2.4’s daemon retargets with no contract change. kolu’s UUID terminal ids ",
				createVNode(_components.em, { children: [
					"(verified: ptyHost.ts:27,:281 ",
					createVNode(_components.code, { children: "randomUUID" }),
					")"
				] }),
				" are ",
				createVNode(_components.strong, { children: "strictly better" }),
				" than herdr’s recycled compact ids, so do ",
				createVNode(_components.em, { children: "not" }),
				" import herdr’s “ids compact, re-read them” warning."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "danger",
			title: "A7 · SCM_RIGHTS live fd-passing — explicit NON-GOAL",
			children: createVNode(_components.p, { children: [
				createVNode($$Pill, {
					variant: "bad",
					children: "drop"
				}),
				" ",
				createVNode($$Pill, {
					variant: "bad",
					children: "category-mismatch"
				}),
				" \xA0 herdr passes live master fds via ",
				createVNode(_components.code, { children: "sendmsg" }),
				"/",
				createVNode(_components.code, { children: "recvmsg" }),
				" ancillary messages because ",
				createVNode(_components.em, { children: "its whole server restarts" }),
				". ",
				createVNode(_components.em, { children: [
					"(herdr server/handoff.rs:370-454,:26 ",
					createVNode(_components.code, { children: "MAX_FDS_PER_HANDOFF=64" }),
					"; handoff_runtime.rs:5-21.)"
				] }),
				" kolu inverts this: kaval ",
				createVNode(_components.strong, { children: "is" }),
				" the survivor and stays alive across a deploy, so there is no fd to move on the common path. node-pty exposes no master-fd handle. It would matter ",
				createVNode(_components.em, { children: "only" }),
				" for upgrading the daemon binary itself — which the cgroup-survival design deliberately makes rare. ",
				createVNode(_components.strong, { children: "Write it down as a named non-goal" }),
				" so a future contributor who reads this note doesn’t reintroduce the ",
				createVNode($$Issue, { n: 1034 }),
				" race for marginal benefit. (A6 remote-over-SSH: borrow herdr’s reattach-hint UX, not the transport. The earlier “C1 pool-key leak” R9 blocker is ",
				createVNode(_components.strong, { children: "stale" }),
				" — ",
				createVNode(_components.code, { children: "hostSession.ts:735" }),
				" already keys on ",
				createVNode(_components.code, { children: "(host, binary)" }),
				" with ",
				createVNode(_components.code, { children: ".drv" }),
				" excluded, fixed ",
				createVNode($$Issue, { n: 1054 }),
				".)"
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "ux--what-to-adopt",
			children: "UX — what to adopt"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "U1 · Unified attention rollup with 'Done = finished-but-unseen'",
			children: [createVNode(_components.p, { children: [
				createVNode($$Pill, {
					variant: "good",
					children: "high"
				}),
				" ",
				createVNode($$Pill, {
					variant: "warn",
					children: "adapt"
				}),
				" \xA0 herdr’s highest-value UX idea: a 4th state ",
				createVNode(_components.code, { children: "Done = (Idle, seen=false)" }),
				" and a ",
				createVNode(_components.em, { children: "single" }),
				" ",
				createVNode(_components.code, { children: "pane_attention_priority" }),
				" (Blocked > Done-unseen > Working > Idle-seen) that feeds the sidebar dot, tab/workspace rollup, mobile summary, navigator, ",
				createVNode(_components.em, { children: "and" }),
				" the ",
				createVNode(_components.code, { children: "wait agent-status" }),
				" API — defined once, never drifts. ",
				createVNode(_components.em, { children: "(herdr aggregate.rs:66-74; api_helpers.rs:70-81.)" }),
				" Add a per-terminal ",
				createVNode(_components.code, { children: "seen" }),
				" bit keyed off canvas focus/visibility, derived in the ",
				createVNode(_components.strong, { children: "live-metadata layer (not persisted" }),
				" — avoid the autosave firehose), feeding the dock badge, a palette “jump to next unreviewed,” and later the kaval-tui ",
				createVNode(_components.code, { children: "list" }),
				" column."
			] }), createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "Caveat:" }),
				" kolu’s existing ",
				createVNode(_components.code, { children: "unread" }),
				" attention bit ",
				createVNode(_components.em, { children: [
					"(verified: useViewState.ts:14,:71 — ",
					createVNode(_components.code, { children: "\"unread\" \\| \"badge-only\"" }),
					", keyed by terminal id, cleared in ",
					createVNode(_components.code, { children: "activate()" }),
					")"
				] }),
				" is a ",
				createVNode(_components.em, { children: "separate" }),
				" signal from agent-turn-finished. Keep them as distinct inputs to one rollup rather than overloading ",
				createVNode(_components.code, { children: "unread" }),
				" — conflating them regresses the badge."
			] })]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "U2 · Agent-state model — 'blocked' equivalent now ships via screen scrape",
			children: createVNode(_components.p, { children: [
				createVNode($$Pill, {
					variant: "todo",
					children: "medium"
				}),
				" ",
				createVNode($$Pill, {
					variant: "warn",
					children: "adapt"
				}),
				" \xA0 herdr’s detection breadth (process-name + output heuristics + socket-API hooks across 14 agents) validates kolu’s agent-agnostic philosophy. The claude-code state enum is ",
				createVNode(_components.code, { children: "thinking \\| tool_use \\| waiting \\| awaiting_user \\| running_background" }),
				" — still ",
				createVNode(_components.strong, { children: ["no literal ", createVNode(_components.code, { children: "blocked" })] }),
				" — but kolu now produces the blocked-equivalent: ",
				createVNode(_components.code, { children: "awaiting_user" }),
				" fires via the ",
				createVNode($$Issue, { n: 905 }),
				" screen-scrape recovery, which recognizes AskUserQuestion and tool-permission prompts on the ",
				createVNode(_components.em, { children: "rendered screen" }),
				" (",
				createVNode(_components.code, { children: "screen.ts" }),
				") while the dialog is visible. ",
				createVNode(_components.em, { children: "(verified: packages/integrations/claude-code/src/schemas.ts:35-55.)" }),
				" Adopt ",
				createVNode(_components.code, { children: "working/idle/done-unseen" }),
				" ",
				createVNode(_components.strong, { children: "now" }),
				", and map ",
				createVNode(_components.code, { children: "awaiting_user" }),
				" into the rollup as Blocked. The hook side-channel herdr uses (PreToolUse/PermissionRequest → state, with defensive discipline: temp-file stdin, short timeout, swallow-all, ",
				createVNode(_components.code, { children: "exit 0" }),
				") is ",
				createVNode(_components.em, { children: "exactly" }),
				" what ",
				createVNode($$Issue, { n: 905 }),
				" proposed — kolu shipped that signal recovery, though via the screen scrape rather than hooks."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "danger",
			title: "U4 · Copy-mode · prefix-keys · BSP mouse-resize · themes — do not port",
			children: createVNode(_components.p, { children: [
				createVNode($$Pill, {
					variant: "bad",
					children: "category-mismatch"
				}),
				" \xA0 Vim copy-mode and the prefix-key scheme are TUI-only — worse, porting a prefix scheme would ",
				createVNode(_components.strong, { children: "actively break Claude Code and readline inside kolu PTYs" }),
				" (Ctrl+B / Ctrl+J are reserved in ",
				createVNode(_components.code, { children: "input/prohibitedKeybinds.ts" }),
				"). BSP mouse-resize is already covered by solid-dnd/Corvu. kolu already exceeds herdr’s 18 themes. ",
				createVNode(_components.em, { children: [
					"(U3: fold herdr’s ",
					createVNode(_components.code, { children: "prefix+g" }),
					" navigator with single-key state filters into the command palette as a body-group; add an urgency exception to notification suppression and a parent/child worktree provenance tag — reject the prefix-key flows.)"
				] })
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "gaps-herdr-surfaced",
			children: "Gaps herdr surfaced"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The two highest-leverage herdr ideas the plans never covered. One — native session resume — was ",
			createVNode(_components.strong, { children: "clean and real, and kolu has since shipped it" }),
			" (G1, juspay/kolu#1495); the other is a pre-existing condition the plans still don’t arbitrate and ",
			createVNode(_components.strong, { children: "remains open" }),
			" (G2)."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "G1 · Native agent-session resume (claude --resume <id>) — shipped",
			children: createVNode(_components.p, { children: [
				createVNode($$Pill, {
					variant: "good",
					children: "shipped"
				}),
				" ",
				createVNode($$Pill, {
					variant: "good",
					children: "high"
				}),
				" \xA0 herdr restores a finished agent by replaying its ",
				createVNode(_components.strong, { children: "native session id" }),
				" through a strict data-not-shell-text argv — an allowlisted ",
				createVNode(_components.code, { children: "{source, agent, kind, value}" }),
				" ref validated for length caps, no control chars, absolute paths, so a hostile id can’t shell-inject. ",
				createVNode(_components.em, { children: "(herdr agent_resume.rs:99-140, :160-169.)" }),
				" kolu originally launched only the ",
				createVNode(_components.strong, { children: [
					"continue form (",
					createVNode(_components.code, { children: "claude -c" }),
					" / ",
					createVNode(_components.code, { children: "codex resume --last" }),
					" via ",
					createVNode(_components.code, { children: "resumeAgentCommand" }),
					") — most-recent-conversation-in-cwd"
				] }),
				", so two terminals sharing a cwd could resume the wrong conversation. ",
				createVNode(_components.strong, { children: "juspay/kolu#1495 adopted herdr’s model:" }),
				" kolu’s fold derives a discriminated ",
				createVNode(_components.code, { children: "restoreTarget" }),
				" from its state — the ",
				createVNode(_components.code, { children: "exact" }),
				" arm carries the live ",
				createVNode(_components.code, { children: "agent.sessionId" }),
				" as a self-describing ",
				createVNode(_components.code, { children: "{ kind, sessionId }" }),
				" identity (the ",
				createVNode(_components.code, { children: "kind" }),
				" paired with the session id so it can never be aimed at the wrong CLI), gated to the conversation-identity change so the ~150 ms agent firehose never re-arms autosave. Wake and restore — the two twin consumers of the one restore path — feed the ",
				createVNode(_components.code, { children: "restoreTarget" }),
				" to ",
				createVNode(_components.code, { children: "resumeFormFor" }),
				", which for an ",
				createVNode(_components.code, { children: "exact" }),
				" target calls ",
				createVNode(_components.code, { children: "resumeAgentCommand" }),
				" to render the by-id form (",
				createVNode(_components.code, { children: "claude --resume <id>" }),
				" · ",
				createVNode(_components.code, { children: "codex resume <id>" }),
				" · ",
				createVNode(_components.code, { children: "opencode --session <id>" }),
				"), shape-gates the id (UUID / ",
				createVNode(_components.code, { children: "ses_…" }),
				", length-capped, shell-inert) and ",
				createVNode(_components.code, { children: "shellJoin" }),
				"-quotes it before the splice. The three arms are disjoint: ",
				createVNode(_components.code, { children: "none" }),
				" (a quit-to-shell, or a never-launched terminal) → a ",
				createVNode(_components.strong, { children: "bare shell" }),
				", the strict #1492 behavior for new records — absence is never read as most-recent; ",
				createVNode(_components.code, { children: "legacyMostRecent" }),
				" (a migrated pre-1.29 record that never captured a session id) → the cwd-most-recent form, so already-saved one-agent-per-worktree sessions never regress; and a same-agent ",
				createVNode(_components.code, { children: "exact" }),
				" ref whose id fails its gate → no resume at all (a bare shell), never the most-recent — a broken id claim must not silently land the user in a stranger’s conversation."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "G2 · Multi-client geometry arbitration — no arbiter today",
			children: createVNode(_components.p, { children: [
				createVNode($$Pill, {
					variant: "warn",
					children: "pre-existing gap"
				}),
				" ",
				createVNode($$Pill, {
					variant: "good",
					children: "high"
				}),
				" \xA0 ",
				createVNode(_components.strong, { children: "Verified:" }),
				" kolu has ",
				createVNode(_components.em, { children: "no" }),
				" resize arbitration. ",
				createVNode(_components.code, { children: "ptyHost.ts:567" }),
				" is last-write-wins (no per-client size, no foreground concept), the router forwards it directly, and each client drives resize from its own xterm grid via a ",
				createVNode(_components.code, { children: "ResizeObserver" }),
				" ",
				createVNode(_components.em, { children: "(Terminal.tsx:361)" }),
				". Because ",
				createVNode(_components.code, { children: "attach()" }),
				" fans out to multiple concurrent subscribers ",
				createVNode(_components.em, { children: "(channel.ts)" }),
				", ",
				createVNode(_components.strong, { children: ["two differently-sized clients already thrash ", createVNode(_components.em, { children: "today" })] }),
				" in the pure-web case — a desktop browser + a phone over ",
				createVNode(_components.code, { children: "--host 0.0.0.0" }),
				" — so this is ",
				createVNode(_components.em, { children: "not" }),
				" introduced by kaval-tui. kaval-tui (shipped in ",
				createVNode($$PrLink, { pr: 1255 }),
				") resizes the PTY to its own terminal’s grid on attach and on every local resize, making the mismatch sharper. The plan endorses the shared-PTY case (“feature, not bug”) and has kaval-tui issue ",
				createVNode(_components.code, { children: "SIGWINCH → resize" }),
				", but never specs an arbiter. herdr solved exactly this with a single ",
				createVNode(_components.code, { children: "foreground_client_id" }),
				" whose size drives shared geometry. ",
				createVNode(_components.em, { children: "(herdr headless.rs:115,:492-525; effective = foreground/most-recent client.)" }),
				" ",
				createVNode(_components.strong, { children: [
					"Phase 2 shipped (",
					createVNode($$PrLink, { pr: 1255 }),
					") with the policy documented as last-resize-wins (",
					createVNode(_components.code, { children: "attach.ts" }),
					") — a true arbiter (foreground client / fit-to-smallest, plus the size-change tap ",
					createVNode(_components.code, { children: "attach.ts" }),
					" names) remains open."
				] })
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "G3 · Smaller gaps worth a look",
			children: [createVNode($$Pill, {
				variant: "todo",
				children: "investigate"
			}), createVNode(_components.ul, { children: [
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Two-tier persistence + privacy:" }),
					" herdr splits structural ",
					createVNode(_components.code, { children: "session.json" }),
					" (always written, no bytes) from opt-in, deletable ",
					createVNode(_components.code, { children: "session-history.json" }),
					" (scrollback). kolu’s ",
					createVNode(_components.code, { children: "@xterm/headless" }),
					" snapshot is live-memory only, so a ",
					createVNode(_components.em, { children: "cold" }),
					" daemon restart loses all scrollback. Decide whether an opt-in scrollback-to-disk tier is wanted."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Keyboard-protocol / alt-screen preservation:" }),
					" herdr carries kitty-keyboard / bracketed-paste bytes across migration because the child won’t re-emit them. Resolved by ",
					createVNode($$PrLink, { pr: 1255 }),
					": ",
					createVNode(_components.code, { children: "@kolu/terminal-protocol" }),
					" (",
					createVNode(_components.code, { children: "snapshotReset.ts" }),
					", ",
					createVNode(_components.code, { children: "bracketedPaste.ts" }),
					") enumerates and resets exactly the modes ",
					createVNode(_components.code, { children: "SerializeAddon" }),
					" emits — remaining caveat: an xterm/serialize upgrade that starts serializing kitty-keyboard must extend the reset. (Pairs with A3.)"
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Control ⟂ data channel invariant:" }),
					" herdr keeps a reliable unbounded control channel separate from the droppable render channel. kolu drops the whole subscriber on overflow ",
					createVNode(_components.em, { children: "(channel.ts)" }),
					". Resolved by R5 (",
					createVNode($$PrLink, { pr: 1591 }),
					"): the attach contract now emits a distinguishable ",
					createVNode(_components.code, { children: "overflow" }),
					" control frame (vs a PTY ",
					createVNode(_components.code, { children: "exit" }),
					") when the host sheds a slow subscriber, so the consumer re-attaches for a fresh snapshot instead of mistaking the drop for a dead terminal — “control-plane events never ride the droppable substrate” made explicit on this seam."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Retryable-error working-hold:" }),
					" herdr treats provider 5xx/overload as continued ",
					createVNode(_components.em, { children: "Working" }),
					" with a grace before flipping, so transient API failures don’t flicker the pane to done. kolu has no equivalent."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Non-interactive TTY-guard for kaval-tui:" }),
					" herdr hard-requires an interactive TTY for destructive prompts. kaval-tui runs agent-driven and in CI — attach (with its ",
					createVNode(_components.code, { children: "~." }),
					" escape) already hard-requires a TTY (shipped in Phase 2: non-tty fails loud, pointing at ",
					createVNode(_components.code, { children: "snapshot" }),
					"); define the equivalent contract for ",
					createVNode(_components.code, { children: "kill" }),
					"/",
					createVNode(_components.code, { children: "spawn" }),
					" before Phase 3."
				] }),
				"\n"
			] })]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "what-to-do-next",
			children: "What to do next"
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R2.4, now (low risk):" }),
				" adopt the transactional handoff ",
				createVNode(_components.em, { children: "discipline" }),
				" (A1), the single-owner kill invariant (A2), the snapshot invariant test (A3), the two-axis honest-state + inline-recovery-hint (A4). Add the SCM_RIGHTS non-goal note (A7)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Close G2 (multi-client resize arbitration)" }),
				" — Phase 2 shipped with documented last-resize-wins; an arbiter (and the size-change tap ",
				createVNode(_components.code, { children: "attach.ts" }),
				" already names) is still open."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "kaval-tui:" }),
				" A5’s socket path and G3’s attach TTY-guard shipped (",
				createVNode($$PrLink, { pr: 1084 }),
				", ",
				createVNode($$PrLink, { pr: 1255 }),
				"); carry the non-tty contract forward to Phase 3’s ",
				createVNode(_components.code, { children: "kill" }),
				"/",
				createVNode(_components.code, { children: "spawn" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "UX:" }),
				" ship the attention rollup with ",
				createVNode(_components.code, { children: "Done = unseen" }),
				" (U1), keeping ",
				createVNode(_components.code, { children: "unread" }),
				"-bytes distinct from turn-finished; fold the navigator into the palette (U3)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"G1 (native ",
					createVNode(_components.code, { children: "--resume" }),
					") shipped"
				] }),
				" (",
				createVNode($$Issue, { n: 1495 }),
				"): the live ",
				createVNode(_components.code, { children: "agent.sessionId" }),
				" is persisted as a ",
				createVNode(_components.code, { children: "{ kind, id }" }),
				" ref and replayed by id on wake/restore — the clearest adoptable, now done."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"U2’s ",
					createVNode(_components.code, { children: "blocked" }),
					" signal:"
				] }),
				" ",
				createVNode($$Issue, { n: 905 }),
				" shipped (screen-scrape ",
				createVNode(_components.code, { children: "awaiting_user" }),
				") — remaining: map ",
				createVNode(_components.code, { children: "awaiting_user" }),
				" into the U1 rollup as Blocked. ",
				createVNode(_components.strong, { children: "Later:" }),
				" R9 reattach-hint UX (A6)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Net: herdr is the reference implementation for the survivor kolu already chose to build — most of its architecture ",
			createVNode(_components.strong, { children: "validates" }),
			" R2 rather than redirecting it, with one battle-tested checklist to harden R2.4 (A1) and one explicit non-goal to write down (A7). The durable surprises were two gaps it surfaced: native session resume (now shipped by exact id, juspay/kolu#1495) and multi-client resize arbitration (still latent in an already-endorsed feature)."
		] }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "herdr vs. kolu — what to adopt",
	"description": "A shipped Rust agent-multiplexer (herdr) makes the same first-party-owns-the-PTYs bet kolu's remote-terminals plan chose — so it's a reference implementation of R2.4, not a competitor. One handoff-discipline borrow, several validations; of the two gaps it surfaced, native resume now ships (juspay/kolu#1495) and resize arbitration remains open. Claims fact-checked against both codebases.",
	"parents": ["comparison", "remote-terminals"],
	"maturity": "budding",
	"updated": "2026-06-19T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-architectural-contrast",
			"text": "The architectural contrast"
		},
		{
			"depth": 2,
			"slug": "architecture--what-to-adopt",
			"text": "Architecture — what to adopt"
		},
		{
			"depth": 2,
			"slug": "ux--what-to-adopt",
			"text": "UX — what to adopt"
		},
		{
			"depth": 2,
			"slug": "gaps-herdr-surfaced",
			"text": "Gaps herdr surfaced"
		},
		{
			"depth": 2,
			"slug": "what-to-do-next",
			"text": "What to do next"
		}
	];
}
var url = "src/content/atlas/herdr-vs-kolu.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/herdr-vs-kolu.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/herdr-vs-kolu.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
