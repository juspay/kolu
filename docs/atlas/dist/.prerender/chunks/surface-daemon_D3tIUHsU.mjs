import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$D2 } from "./D2_CPv-UX0x.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import { n as $$Roadmap, t as $$Milestone } from "./Milestone_yecymha0.mjs";
//#region src/content/atlas/surface-daemon.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
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
			createVNode(_components.em, { children: [
				"Two plans of record arrived at the same machinery from opposite ends in the same week: ",
				createVNode(_components.a, {
					href: "./pty-daemon.html",
					children: "kaval"
				}),
				" R2.2/R2.3 designs a daemon entry, single-instance gate, handshake, and client-side supervisor for the PTY daemon; ",
				createVNode(_components.a, {
					href: "./odu-runner.html",
					children: "odu-runner"
				}),
				" R1/R3 sketches the same four things for the CI coordinator. This note is the deduplication — named before either hand-rolls a second copy."
			] }),
			" ",
			createVNode($$Pill, {
				variant: "done",
				children: "accepted"
			})
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Status: ",
			createVNode($$Pill, {
				variant: "done",
				children: "accepted"
			}),
			" — the daemon half shipped as ",
			createVNode(_components.code, { children: "@kolu/surface-daemon" }),
			" ",
			createVNode(_components.strong, { children: "in kaval R2.2" }),
			" (",
			createVNode($$PrLink, { pr: 1301 }),
			"); the supervisor half is born as ",
			createVNode(_components.code, { children: "@kolu/surface-daemon-supervisor" }),
			" ",
			createVNode(_components.strong, { children: "in kaval R2.3" }),
			" (revised 2026-06-12; the ",
			createVNode(_components.a, {
				href: "./pty-daemon.html",
				children: "pty-daemon"
			}),
			" brief carries both); the durable stdio ",
			createVNode(_components.strong, { children: "front" }),
			" ",
			createVNode(_components.code, { children: "frontDaemonOverStdio" }),
			" lands in ",
			createVNode(_components.strong, { children: "kaval-sessions R3.4" }),
			" (",
			createVNode($$PrLink, { pr: 1374 }),
			") · maturity ",
			createVNode($$Pill, {
				variant: "todo",
				children: "seedling"
			}),
			" · first consumer: kaval (R2.2/R2.3) · second consumer: odu serve (R1/R3) — the second tenant that proves the ",
			createVNode(_components.a, {
				href: "./electricity.html",
				children: "electricity"
			}),
			" bar by construction (S2)"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "The idea in one paragraph",
			children: createVNode(_components.p, { children: [
				"A “surface daemon” is a recurring shape in this codebase: a long-lived process that owns a unix socket, serves a typed ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				", and is supervised from outside by a client that must never lie about its state. kaval is one; ",
				createVNode(_components.code, { children: "odu serve" }),
				" is the next; drishti’s agent is a cousin. The shape decomposes cleanly into a ",
				createVNode(_components.strong, { children: "spine" }),
				" that is identical across them — atomic pid-gate, a ",
				createVNode(_components.code, { children: "daemonMain" }),
				" skeleton (gate → serve → SIGTERM teardown), a ",
				createVNode(_components.code, { children: "system.version" }),
				"/build-id handshake fragment, an endpoint supervisor (state machine + spawn/respawn drivers + a composed restart), and a durable stdio ",
				createVNode(_components.strong, { children: "front" }),
				" (",
				createVNode(_components.code, { children: "frontDaemonOverStdio" }),
				" — reach the daemon over ssh and outlive the link, the durable counterpart to ",
				createVNode(_components.code, { children: "serveOverStdio" }),
				") — and a ",
				createVNode(_components.strong, { children: "soul" }),
				" that must never be shared: what the daemon holds, whether that state survives restarts, and when the process is allowed to die. The extraction already started without a name: kolu-tui’s ",
				createVNode($$PrLink, { pr: 1084 }),
				" moved the unix-socket transport pair, ",
				createVNode(_components.code, { children: "getRuntimeSocketPath" }),
				", and ",
				createVNode(_components.code, { children: "isContractVersionCompatible" }),
				" into ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				", and kaval’s own follow-ups callout lists the rest. This note gives the rest its destination and its trigger."
			] })
		}),
		"\n",
		createVNode($$D2, {
			caption: "Mechanism below the line, policy above it. Both daemons ride the same spine — the daemon half runs inside each daemon process, the supervisor half runs inside whatever spawns and watches it (kolu-server for kaval; the odu CLI / odu-web for odu serve). The wire-adjacent handshake fragment lands in @kolu/surface itself, joining what PR #1084 already moved there.",
			code: `
direction: down

programs: "the souls — policy, never shared" {
kaval: "kaval — holds live PTY fds; survival is the point (R2.4)"
odu: "odu serve — holds replaceable runs; trail + seq-bump rerun"
}

spine: "the spine — two packages\\n(daemon half @kolu/surface-daemon: born R2.2\\nsupervisor half @kolu/surface-daemon-supervisor: born R2.3)" {
daemon: "daemon half — pid-gate · daemonMain skeleton"
sup: "supervisor half — endpoint states · drivers · waitForPidGone · restart compose"
}

surface: "@kolu/surface — the wire (shipped)" {
prior: "unix-socket pair · getRuntimeSocketPath · isContractVersionCompatible — PR #1084"
next: "handshake fragment — system.version · build-id"
}

programs -> spine: "consume mechanism, keep policy"
spine -> surface: "serves and dials the same wire"
`
		}),
		"\n",
		createVNode(_components.h2, {
			id: "two-daemons-one-spine",
			children: "Two daemons, one spine"
		}),
		"\n",
		createVNode(_components.p, { children: "The correspondence is one-to-one, and kaval’s column is the more battle-hardened — every row carries a #1034/#1275 scar and a designed answer:" }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Lifecycle concern" }),
					"\n",
					createVNode(_components.th, { children: "kaval (R2.2/R2.3 — designed, hazard-annotated)" }),
					"\n",
					createVNode(_components.th, { children: "odu serve (R1/R3 — sketched)" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Process entry" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "daemonMain" }), ": pid-gate → serve loop → SIGTERM teardown"] }),
					"\n",
					createVNode(_components.td, { children: [
						"“",
						createVNode(_components.code, { children: "odu serve" }),
						" owns the socket” — same sequence, unnamed"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Single instance" }),
					"\n",
					createVNode(_components.td, { children: [
						"Atomic pid-gate — write-temp + ",
						createVNode(_components.code, { children: "link(2)" }),
						", liveness-probe on ",
						createVNode(_components.code, { children: "EEXIST" }),
						", stale-unlink-retry"
					] }),
					"\n",
					createVNode(_components.td, { children: "Implied, undesigned" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Socket" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "$XDG_RUNTIME_DIR/kaval/kaval.sock" }), "; app-name parameterized in R2.1"] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: ".ci/odu.sock" }), ", per-repo"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Skew safety" }),
					"\n",
					createVNode(_components.td, { children: [
						"Contract handshake on every connect; ",
						createVNode(_components.strong, { children: "never" }),
						" an import-time throw"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Needed identically — a pinned ",
						createVNode(_components.code, { children: "nix run" }),
						" client against a newer resident server"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Supervision" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "endpoint.ts" }),
						": ",
						createVNode(_components.code, { children: "connecting → connected → degraded → dead" }),
						", status emitted on every transition, keyed by hostId"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"odu’s connection cell (",
						createVNode(_components.code, { children: "copying → connecting → connected" }),
						") — same idea, fewer states"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Spawn/respawn" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "systemd-run --user" }),
						" + per-spawn unique units / macOS detached+unref; ",
						createVNode(_components.code, { children: "waitForPidGone" }),
						" (ESRCH poll, load-aware ceiling)"
					] }),
					"\n",
					createVNode(_components.td, { children: "R3’s home-manager mode needs exactly this" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Restart" }),
					"\n",
					createVNode(_components.td, { children: "One composed sequence, steps non-optional in the type, serialized" }),
					"\n",
					createVNode(_components.td, { children: "R3’s “kill the server mid-run — nothing wedges”" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Honest death" }),
					"\n",
					createVNode(_components.td, { children: "Degraded state visibly distinct from “you have no terminals”" }),
					"\n",
					createVNode(_components.td, { children: "“errored in the trail, restart serves history”" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Staleness" }),
					"\n",
					createVNode(_components.td, { children: "staleKey = nix hash of the daemon closure; “what would a restart gain?”" }),
					"\n",
					createVNode(_components.td, { children: [
						"Unaddressed — but a resident ",
						createVNode(_components.code, { children: "odu serve" }),
						" under odu-web is a daemon that can fall a build behind, same question"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The asymmetry in maturity is the sequencing argument: kaval’s spine is ",
			createVNode(_components.em, { children: "designed against eight production failures already paid for" }),
			" (the impossible-by-construction table in ",
			createVNode(_components.a, {
				href: "./pty-daemon.html",
				children: "pty-daemon"
			}),
			"), and R2.3’s staged-prod gate will soak the exact restart race (#1034) that odu serve would otherwise rediscover. The spine should be born there, not invented twice."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "mechanism-vs-policy--what-stays-per-program",
			children: "Mechanism vs policy — what stays per-program"
		}),
		"\n",
		createVNode(_components.p, { children: "The extraction is safe only because the line between spine and soul is sharp. Three asymmetries between the two consumers are load-bearing, and the spine must parameterize around them rather than absorb them:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Survivor semantics." }),
				" kaval holds ",
				createVNode(_components.em, { children: "irreplaceable kernel state" }),
				" — live PTY fds that cannot be reconstructed; R2.4’s survival, adoption, and reconciliation are its whole point. odu serve holds ",
				createVNode(_components.em, { children: "replaceable orchestration state" }),
				" — the per-SHA trail is durable on disk, runs are append-only, and a lost in-flight run is a ",
				createVNode(_components.code, { children: "seq" }),
				"-bump rerun. ",
				createVNode(_components.strong, { children: "R2.4 is not spine." }),
				" Adoption, ",
				createVNode(_components.code, { children: "reconcile.ts" }),
				", the schema round-trip — none of it transfers, and odu-runner’s “live-state resurrection stays out of scope” must survive the deduplication."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Scope." }), " kaval is a per-user machine singleton; odu serve is per-repo — many sockets, one per checkout. The pid-gate takes a scope key; neither program’s choice leaks into the mechanism."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Lifecycle policy." }),
				" odu-runner’s idle-timeout auto-serve is a legitimate mode for a CI coordinator and a catastrophic one for a PTY daemon (an idle-timeout kaval kills your terminals). The ",
				createVNode(_components.code, { children: "daemonMain" }),
				" skeleton exposes lifetime as a parameter (",
				createVNode(_components.code, { children: "forever" }),
				" | ",
				createVNode(_components.code, { children: "idleTimeout(ms)" }),
				" | ",
				createVNode(_components.code, { children: "boundToPid(pid)" }),
				"); each program picks, neither inherits. ",
				createVNode(_components.code, { children: "boundToPid" }),
				" is the ",
				createVNode(_components.em, { children: "test/smoke" }),
				" constructor — a daemon detached+unref’d for survival must still die with the RUN that spawned it, so it watches that pid and exits when it is gone; production selects ",
				createVNode(_components.code, { children: "forever" }),
				" by the deliberate absence of the bind (never a weakened production daemon)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: "Same mechanism, opposite policies — which is precisely the evidence the mechanism is real. A spine that worked for only one lifetime policy or one scope would just be kaval’s internals wearing a package name." }),
		"\n",
		createVNode(_components.h2, {
			id: "where-each-piece-lands",
			children: "Where each piece lands"
		}),
		"\n",
		createVNode(_components.p, { children: "Two destinations, split by what the code touches:" }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Piece" }),
					"\n",
					createVNode(_components.th, { children: "Destination" }),
					"\n",
					createVNode(_components.th, { children: "Why there" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "system.version" }), " / build-id handshake fragment"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "@kolu/surface" }),
						" ",
						createVNode(_components.em, { children: "(at S1)" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Wire-adjacent — it joins ",
						createVNode(_components.code, { children: "isContractVersionCompatible" }),
						" and the unix-socket pair that ",
						createVNode($$PrLink, { pr: 1084 }),
						" already moved; every surface client/server pair wants it, daemon or not."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Atomic pid-gate (acquire + read sides)" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "@kolu/surface-daemon" }),
						" ",
						createVNode(_components.em, { children: "(born there, R2.2)" })
					] }),
					"\n",
					createVNode(_components.td, { children: "Runs inside the daemon process (acquire) and the supervisor (read); pure lifecycle, no wire. Both sides of one file format, one home from day one." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "daemonMain" }), " skeleton — gate → serve → teardown, lifetime parameter"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "@kolu/surface-daemon" }),
						" ",
						createVNode(_components.em, { children: "(born there, R2.2)" })
					] }),
					"\n",
					createVNode(_components.td, { children: "The entry every surface daemon repeats; each program supplies its surface and its policy knobs." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Endpoint supervisor — state machine, driver ops (",
						createVNode(_components.code, { children: "spawn" }),
						"/",
						createVNode(_components.code, { children: "waitForPidGone" }),
						"), composed restart"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"a ",
						createVNode(_components.strong, { children: "separate" }),
						" ",
						createVNode(_components.code, { children: "@kolu/surface-daemon-supervisor" }),
						" package ",
						createVNode(_components.em, { children: "(born there, R2.3 — revised 2026-06-12)" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Runs in the ",
						createVNode(_components.em, { children: "client" }),
						" process (kolu-server; the odu CLI or odu-web), and is on a ",
						createVNode(_components.strong, { children: "different volatility axis" }),
						" from the daemon half — see the decision below. Shared types (",
						createVNode(_components.code, { children: "DaemonExit" }),
						", the gate’s file format) cross a one-directional ",
						createVNode(_components.code, { children: "workspace:*" }),
						" edge: the supervisor imports them from ",
						createVNode(_components.code, { children: "@kolu/surface-daemon" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Survivable-spawn mechanism — the ",
						createVNode(_components.code, { children: "INVOCATION_ID" }),
						" gate (under a systemd service → ",
						createVNode(_components.code, { children: "systemd-run --user" }),
						"; otherwise, macOS included → detached+unref), per-spawn unique unit names, absolute-path discipline"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "@kolu/surface-daemon-supervisor" }),
						" ",
						createVNode(_components.em, { children: [
							"(the package’s default ",
							createVNode(_components.code, { children: "DriverOps" }),
							" implementation, born R2.3)"
						] })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Host-platform volatility, not program volatility — the program supplies only values: ",
						createVNode(_components.code, { children: "{binPath, args, env, unitPrefix}" }),
						". kolu’s ",
						createVNode(_components.code, { children: "localDriver.ts" }),
						" shrinks to that parameter bundle."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"One honest trap, inherited from kaval’s one rule: ",
			createVNode(_components.strong, { children: "the supervisor’s package boundary IS the staleKey boundary." }),
			" From R2.2, ",
			createVNode(_components.code, { children: "@kolu/surface-daemon" }),
			" (the daemon half) is hashed ",
			createVNode(_components.strong, { children: "whole" }),
			" into kaval’s key, as a third root beside ",
			createVNode(_components.code, { children: "terminal-protocol" }),
			" (the closure test’s existing multi-root pattern: every root’s non-test files hashed, and the import walk from the daemon entry must reach exactly that set). Whole-package hashing is correct because everything in the package is part of the one daemon ",
			createVNode(_components.em, { children: "binary" }),
			" a restart loads — the serve half ",
			createVNode(_components.em, { children: "in" }),
			" the daemon process, and the durable stdio front (",
			createVNode(_components.code, { children: "frontDaemonOverStdio" }),
			", R3.4) in the per-link proxy reached from that binary’s ",
			createVNode(_components.code, { children: "--stdio" }),
			" dispatch — so the package’s ",
			createVNode(_components.strong, { children: "standing invariant: only daemon-binary code (serve + front) lives here, never the supervisor." }),
			" A supervisor file ",
			createVNode(_components.em, { children: "inside" }),
			" this package would flip kaval’s key on every supervisor-only edit — the over-prompting failure A2 killed, reborn."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The decision (settled 2026-06-12; see ",
			createVNode(_components.a, {
				href: "#a-separate-supervisor-package-not-a-supervisor-subpath",
				children: "the decision"
			}),
			"): the supervisor is a ",
			createVNode(_components.strong, { children: "separate package" }),
			" ",
			createVNode(_components.code, { children: "@kolu/surface-daemon-supervisor" }),
			", ",
			createVNode(_components.em, { children: "not" }),
			" a ",
			createVNode(_components.code, { children: "/supervisor" }),
			" subpath of this one — and it is born that way ",
			createVNode(_components.strong, { children: "in R2.3" }),
			" (revised the same day; the deferral to an S1 extraction failed its own audit, recorded below). The package boundary ",
			createVNode(_components.strong, { children: "is" }),
			" the hash boundary, with nothing to configure — kaval hashes the daemon package and not the supervisor one, and the closure test’s reachable-from-daemon-entry set stays correct by construction (supervisor code is reached only from server, never from ",
			createVNode(_components.code, { children: "bin.ts" }),
			"/",
			createVNode(_components.code, { children: "index.ts" }),
			"). The rejected alternative — a ",
			createVNode(_components.code, { children: "/supervisor" }),
			" subpath — would force ",
			createVNode(_components.code, { children: "default.nix" }),
			"’s fileFilter to carve ",
			createVNode(_components.code, { children: "src/daemon/**" }),
			" out of ",
			createVNode(_components.code, { children: "src/**" }),
			", a subdir glob that silently mis-scopes the key when a file lands in the wrong subdir: #1034’s first row, simulated by hand where a package boundary gives it for free."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "a-separate-supervisor-package-not-a-supervisor-subpath",
			children: [
				"A separate supervisor package, not a ",
				createVNode(_components.code, { children: "/supervisor" }),
				" subpath"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Recorded as a decision so it isn’t relitigated. The two halves — daemon (this package) and supervisor (",
			createVNode(_components.code, { children: "endpoint" }),
			"/",
			createVNode(_components.code, { children: "waitForPidGone" }),
			"/",
			createVNode(_components.code, { children: "restart" }),
			", its own package from R2.3) — could ship as one package with two entries, or as two packages. ",
			createVNode(_components.strong, { children: "Two packages" }),
			", because:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "They are on different volatility axes by construction." }),
				" The entire staleKey design exists to guarantee a supervisor change does ",
				createVNode(_components.em, { children: "not" }),
				" flip the daemon’s key. Two things that must change independently are two modules (Parnas/Lowy); a package is the strongest module boundary there is. The subpath is a ",
				createVNode(_components.em, { children: "weaker" }),
				" encoding of that same boundary — a ",
				createVNode(_components.code, { children: "fileFilter" }),
				" glob simulating what the package gives for free, and the glob is the fragile part."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The hash boundary falls out for free" }), " (the trap paragraph above): package boundary = hash boundary, no subdir glob to drift."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Shared types ride a normal one-directional edge" }),
				" — the supervisor imports ",
				createVNode(_components.code, { children: "DaemonExit" }),
				" and the gate’s file-format primitives (",
				createVNode(_components.code, { children: "gatePid" }),
				"/",
				createVNode(_components.code, { children: "isHolderLive" }),
				") from ",
				createVNode(_components.code, { children: "@kolu/surface-daemon" }),
				". No circular dependency, no third “common” package."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Reasons that were considered and rejected: ",
			createVNode(_components.em, { children: [
				"“it matches how ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				" ships server+client halves”"
			] }),
			" — circular; surface splits for the same shared-types reason, so this isn’t an independent argument. ",
			createVNode(_components.em, { children: "“surface-daemon graduates as a unit”" }),
			" — false; surface-daemon is spine/",
			createVNode(_components.a, {
				href: "./electricity.html",
				children: "electricity"
			}),
			" that stays in the monorepo (only ",
			createVNode(_components.a, {
				href: "./pty-daemon.html",
				children: "kaval"
			}),
			" graduates, the drishti/odu path). ",
			createVNode(_components.em, { children: "“the subpath skips the new-package checklist”" }),
			" — the weakest reason, and it’s paid for with the fragile glob. The one thing that could flip the decision: if R2.3 reveals the daemon and supervisor halves can’t be cleanly separated by imports (a circular type dependency) — but R2.2’s gate-format split (",
			createVNode(_components.code, { children: "gatePid" }),
			"/",
			createVNode(_components.code, { children: "isHolderLive" }),
			" as daemon primitives the supervisor ",
			createVNode(_components.em, { children: "composes" }),
			", not a supervisor reader living daemon-side) already keeps that seam clean, and a circular dep would mean the spine/soul line itself is wrong, a louder alarm than packaging."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Timing, revised 2026-06-12 (R2.3 planning):" }),
			" the original sequencing had the supervisor gestate in ",
			createVNode(_components.code, { children: "server/src/ptyHost/" }),
			" through R2.3/R2.4 and extract here at S1. That deferral failed a three-front audit. ",
			createVNode(_components.em, { children: "“Wait for the API to settle”" }),
			" is a backwards-compat argument, and a private workspace package with one downstream — edited in the same PR — carries no compat obligation; R2.4 reshaping the package costs exactly what R2.4 reshaping a server directory costs. ",
			createVNode(_components.em, { children: "“Wait for the second consumer”" }),
			" lost to the precedent sitting one section up: the daemon half was born as a package in R2.2 with one consumer, and the supervisor’s parameter surface is already designed against both consumers in this note. And the risk, quantified: ~five scaffolding files plus one ",
			createVNode(_components.code, { children: "default.nix" }),
			" fileset line, with ",
			createVNode(_components.strong, { children: "zero hash surface" }),
			" — the supervisor package is deliberately ",
			createVNode(_components.em, { children: "not" }),
			" a staleKey root, so there is no closure-test or build-id wiring to get wrong (that asymmetry is this decision’s whole point, and it cuts in ",
			createVNode(_components.em, { children: "favor" }),
			" of early birth). What early birth buys: the spine/soul line enforced by the package boundary from the first commit — a zero-",
			createVNode(_components.code, { children: "kolu-*" }),
			"-deps allowlist, with ",
			createVNode(_components.code, { children: "localDriver.ts" }),
			" physically outside — instead of by reviewer vigilance; the #1275 lesson (its package was extracted mid-PR under review pressure) applied in advance. So ",
			createVNode(_components.strong, { children: [
				"R2.3 births ",
				createVNode(_components.code, { children: "@kolu/surface-daemon-supervisor" }),
				" directly"
			] }),
			", and S1 shrinks to one move: the handshake fragment into ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			"."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-daemon-halfs-public-api--by-example",
			children: "The daemon half’s public API — by example"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"What R2.2 actually exports: two modules, small enough to read whole. The ",
			createVNode(_components.em, { children: "shape" }),
			" is normative — it encodes the mechanism/policy line, with every program-specific choice arriving as an argument — while the names may shift in R2.2’s review."
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
						children: "// @kolu/surface-daemon — the daemon half (all of it, R2.2)"
					})
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "/** Structural, so the package carries zero kolu-* deps (the kaval pattern). */"
					})
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
							children: " type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " LogFn"
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
							children: "msg"
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
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "fields"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "?:"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " object"
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
							style: { color: "#D73A49" },
							children: "export"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Logger"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "debug"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " LogFn"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "info"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " LogFn"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "warn"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " LogFn"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "error"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " LogFn"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " };"
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
						children: "// ── pidGate.ts — the daemon side + the file format both sides share ─────"
					})
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
							children: " type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " GateResult"
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
							children: " \"acquired\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "release"
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
							children: " }   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// we hold it; release at teardown"
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
							children: " \"held\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "pid"
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
							children: " }               "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// a LIVE process holds it"
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
							children: " \"dir-not-private\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "dir"
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
							children: " };   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// refuse: gate dir isn't owner-only"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "/** Atomic: validate the gate dir is owner-only, write pid to a temp file,"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: " *  link(2) into place; on EEXIST read the gate, liveness-probe, steal if stale. */"
					})
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
							children: " acquirePidGate"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "gatePath"
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
							children: ")"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " GateResult"
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
						children: "/** The gate's file format, single-sourced as two daemon-running primitives —"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: " *  the pid parse and the liveness probe. R2.3's supervisor COMPOSES these where it"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: " *  lives (`isHolderLive(gatePid(path))`), so no supervisor reader sits in this"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: " *  daemon-hashed package. */"
					})
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
							children: " gatePid"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "gatePath"
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
							children: ")"
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
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " undefined"
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
							children: " isHolderLive"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "pid"
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
							children: ")"
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
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// ── daemonMain.ts — the skeleton: gate → serve → teardown ───────────────"
					})
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
							children: " type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " DaemonLifetime"
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
							children: " \"forever\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }                       "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// kaval: an idle PTY daemon still holds your terminals"
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
							children: " \"idleTimeout\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "ms"
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
							style: { color: "#6F42C1" },
							children: "isIdle"
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
							children: " boolean"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " } "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// odu serve: a quiet coordinator may exit"
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
							children: " \"boundToPid\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "pid"
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
							children: "pollMs"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "?:"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " number"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " }; "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// test/smoke: die with the RUN that spawned you (poll kill(pid,0); pollMs is a test-only seam)"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// The serializable projection a daemon PUBLISHES about itself (closures/test-seams dropped),"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// so a UI can show which lifetime it runs under — kaval on `system.version`, padi on its `identity` cell."
					})
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
							children: " type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " DaemonLifetimeInfo"
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
							children: " \"forever\""
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
							children: " \"idleTimeout\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "ms"
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
							children: " \"boundToPid\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "pid"
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
							children: "export"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " function"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " lifetimeInfo"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "l"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " DaemonLifetime"
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
							children: " DaemonLifetimeInfo"
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
							children: " type"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " DaemonExit"
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
							children: " \"already-running\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "pid"
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
							children: " }  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// single-instance: this is SUCCESS, the caller exits 0"
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
							children: " \"shutdown\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "reason"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"signal\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"abort\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"idle\""
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " |"
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: " \"pid-gone\""
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
							children: "export"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " function"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " daemonMain"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "spec"
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
							style: { color: "#E36209" },
							children: "  gatePath"
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
							children: ";       "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// the scope key: per-user for kaval, per-repo for odu serve"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  socketPath"
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
							children: "  router"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " SurfaceRouter"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// any @kolu/surface router — served over the unix-socket listener PR #1084 moved there"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  lifetime"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " DaemonLifetime"
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
							children: "  log"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: ":"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " Logger"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";            "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// one structured boot line; every transition logged"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#E36209" },
							children: "  signal"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "?:"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " AbortSignal"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ";   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// tests drive teardown without real signals"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "})"
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
							children: "DaemonExit"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ">;  "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// never calls process.exit — the bin maps DaemonExit to a code"
						})
					]
				})
			] })
		}),
		"\n",
		createVNode(_components.p, { children: "The two consumers, side by side — same mechanism, opposite policies, all arriving as arguments:" }),
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
						children: "// packages/kaval/src/bin.ts — kaval's entire entry (R2.2)"
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
							children: " lifetime"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " { kind: "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"forever\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: " } "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "as"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " const"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "; "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// resolved ONCE (boundToPid under a test run)"
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
							children: " exit"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " ="
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " await"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " daemonMain"
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
							style: { color: "#24292E" },
							children: "  gatePath:   "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "join"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "kavalRuntimeDir"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(), "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"kaval.pid\""
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
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  socketPath: cli.socket "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "??"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " getPtyHostSocketPath"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "("
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "undefined"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"kaval\""
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
						style: { color: "#6A737D" },
						children: "  // the serving side gets the projection to publish on system.version…"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  router:     "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "servePtyHost"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "({ log, rcDir: "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "kavalRcDir"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(), lifetime: "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "lifetimeInfo"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(lifetime) }).router,"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  lifetime,   "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// …and daemonMain gets the SAME value that governs the daemon — no drift"
					})]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  log,"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "}); "
					}), createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// \"held by a live daemon\" and \"shutdown\" are both clean exits"
					})]
				}),
				"\n",
				createVNode(_components.span, { class: "line" }),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: createVNode(_components.span, {
						style: { color: "#6A737D" },
						children: "// odu serve (S2, projected) — the second tenant, by substitution only"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "await"
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: " daemonMain"
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
							style: { color: "#24292E" },
							children: "  gatePath:   "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "join"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(repoRoot, "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\".ci/odu.pid\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "),   "
						}),
						createVNode(_components.span, {
							style: { color: "#6A737D" },
							children: "// per-repo scope"
						})
					]
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  socketPath: "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "join"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "(repoRoot, "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\".ci/odu.sock\""
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
						children: "  router:     oduRunnerRouter,"
					})
				}),
				"\n",
				createVNode(_components.span, {
					class: "line",
					children: [
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "  lifetime:   { kind: "
						}),
						createVNode(_components.span, {
							style: { color: "#032F62" },
							children: "\"idleTimeout\""
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", ms: "
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: "30"
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: " *"
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " 60_000"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: ", "
						}),
						createVNode(_components.span, {
							style: { color: "#6F42C1" },
							children: "isIdle"
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
							children: " runsInFlight"
						}),
						createVNode(_components.span, {
							style: { color: "#24292E" },
							children: "() "
						}),
						createVNode(_components.span, {
							style: { color: "#D73A49" },
							children: "==="
						}),
						createVNode(_components.span, {
							style: { color: "#005CC5" },
							children: " 0"
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
					children: createVNode(_components.span, {
						style: { color: "#24292E" },
						children: "  log,"
					})
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
			"As load-bearing as what’s exported is what is ",
			createVNode(_components.strong, { children: "deliberately absent" }),
			": no env application (R2.1 removed the daemon’s env role), no spawn/respawn or ",
			createVNode(_components.code, { children: "waitForPidGone" }),
			" (supervisor half — ",
			createVNode(_components.code, { children: "@kolu/surface-daemon-supervisor" }),
			", its own package from R2.3), no survival, adoption, or reconciliation (kaval R2.4’s soul, never spine), and no ",
			createVNode(_components.code, { children: "process.exit" }),
			" inside the mechanism (the gate-race tests run it in-process)."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "phases",
			children: "Phases"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The trigger discipline matters more than the speed: each half is a package from birth (daemon: R2.2; supervisor: R2.3 — revised 2026-06-12 from a post-soak S1 extraction, the timing paragraph above). What soaks in production before the second tenant arrives is the ",
			createVNode(_components.em, { children: "mechanism itself" }),
			" (R2.3’s recycle, R2.4’s restart), not its directory location; odu serve (S2) then consumes a boundary that already exists."
		] }),
		"\n",
		createVNode($$Roadmap, { children: [
			createVNode($$Milestone, {
				status: "done",
				label: "S0 · the daemon half is born as the package (kaval R2.2)",
				children: [
					createVNode(_components.strong, { children: [
						"Shipped in ",
						createVNode($$PrLink, { pr: 1301 }),
						" (2026-06-12)."
					] }),
					" kaval R2.2 created ",
					createVNode(_components.code, { children: "@kolu/surface-daemon" }),
					" itself, holding the daemon half — ",
					createVNode(_components.code, { children: "acquirePidGate" }),
					" plus the gate’s file-format primitives (",
					createVNode(_components.code, { children: "gatePid" }),
					"/",
					createVNode(_components.code, { children: "isHolderLive" }),
					") the supervisor composes, and the ",
					createVNode(_components.code, { children: "daemonMain" }),
					" skeleton (gate → serve → SIGTERM teardown; lifetime ",
					createVNode(_components.code, { children: "forever | idleTimeout(ms)" }),
					") — with kaval’s entry a ~20-line composition over it. Rationale: review isolation (the mechanism is reviewed once, as a package) and one home for the gate’s file format. The package is hashed whole into kaval’s staleKey (third root), so its standing invariant is ",
					createVNode(_components.em, { children: "only daemon-running code lives here" }),
					" — no supervisor reader; the supervisor ",
					createVNode(_components.em, { children: "composes" }),
					" the daemon primitives where it lives. kaval’s R2.2 e2e (the contract corpus over a real daemon’s socket + the gate-race choreography with real processes) is the spine’s first soak harness."
				]
			}),
			createVNode($$Milestone, {
				status: "done",
				label: "S0.5 · the supervisor half is born as its own package (kaval R2.3 — shipped, #1310)",
				children: [
					createVNode(_components.strong, { children: [
						"Shipped in ",
						createVNode($$PrLink, { pr: 1310 }),
						" (2026-06-12)."
					] }),
					" Revised 2026-06-12 (was: gestate in ",
					createVNode(_components.code, { children: "server/src/ptyHost/" }),
					", extract at S1 — the timing paragraph above records why the deferral fell). R2.3 births ",
					createVNode(_components.code, { children: "@kolu/surface-daemon-supervisor" }),
					" holding endpoint states · driver ops · ",
					createVNode(_components.code, { children: "waitForPidGone" }),
					" · the composed restart · the survivable-spawn default driver (the ",
					createVNode(_components.code, { children: "INVOCATION_ID" }),
					" gate, unique unit names, detached+unref off-systemd), parameterized over driver ops and the surface client; kaval’s ",
					createVNode(_components.em, { children: "values" }),
					" stay in ",
					createVNode(_components.code, { children: "packages/server" }),
					" (",
					createVNode(_components.code, { children: "localDriver.ts" }),
					", soul — now a parameter bundle: binary · dev-flag filter · ",
					createVNode(_components.code, { children: "--setenv" }),
					" values · paths · unit prefix). Not a staleKey root — zero hash surface by construction. Like its daemon sibling, the package carries a README with the mechanism/soul line, the API table, and a usage example (kolu-server’s composition, ",
					createVNode(_components.code, { children: "odu serve" }),
					"’s projected beside it). R2.3’s recycle-on-every-deploy then soaks the restart race in production with zero sessions at stake. R2.4.2 (",
					createVNode($$PrLink, { pr: 1337 }),
					") then ",
					createVNode(_components.strong, { children: "extended the package after birth" }),
					" — ",
					createVNode(_components.code, { children: "serializeRestart" }),
					" (coalesce concurrent restart triggers onto one in-flight recycle) and the transient ",
					createVNode(_components.code, { children: "restarting" }),
					" state held across the recycle (",
					createVNode(_components.code, { children: "holdRestarting" }),
					") landed in ",
					createVNode(_components.code, { children: "@kolu/surface-daemon-supervisor" }),
					", the first supervisor mechanism added ",
					createVNode(_components.em, { children: "post-birth" }),
					" and a live proof the boundary holds: kaval’s staleKey stayed bit-identical across it (a supervisor-only change, correctly invisible to the daemon hash). ",
					createVNode(_components.strong, { children: "Exit: a daemon-package edit flips kaval’s staleKey while a supervisor-package edit does not — by package boundary, not by a glob." })
				]
			}),
			createVNode($$Milestone, {
				status: "done",
				label: "S0.7 · the durable stdio front lands (kaval-sessions R3.4)",
				children: [
					createVNode(_components.strong, { children: [
						"Shipped in ",
						createVNode($$PrLink, { pr: 1374 }),
						" (2026-06-15)."
					] }),
					" kaval-sessions R3.4 upstreamed kaval’s ",
					createVNode(_components.code, { children: "kaval --stdio" }),
					" durable-fronting bridge into the package as ",
					createVNode(_components.code, { children: "frontDaemonOverStdio" }),
					" — the durable counterpart to ",
					createVNode(_components.code, { children: "@kolu/surface" }),
					"’s ",
					createVNode(_components.code, { children: "serveOverStdio" }),
					": adopt-or-spawn the gate-held daemon and raw-byte-relay an ssh-stdio link onto its socket, so a remote session survives the link (",
					createVNode(_components.code, { children: "dtach" }),
					"/",
					createVNode(_components.code, { children: "abduco" }),
					" for any surface daemon). Plus ",
					createVNode(_components.code, { children: "reExecAsDetachedDaemon" }),
					", the same-binary spawn strategy that carries the single-process ",
					createVNode(_components.code, { children: "node --import" }),
					" re-exec invariant (so ",
					createVNode(_components.code, { children: "SIGTERM" }),
					" reaches the daemon, not a swallowing ",
					createVNode(_components.code, { children: "tsx" }),
					" fork). kaval’s ",
					createVNode(_components.code, { children: "--stdio" }),
					" shrank to a thin composition (resolve the socket path + supply the daemon-spawn); the front is reached from ",
					createVNode(_components.code, { children: "bin.ts" }),
					"’s ",
					createVNode(_components.code, { children: "--stdio" }),
					" dispatch, so it joins the package’s hashed daemon-binary closure with no staleKey mis-scope — and the standing invariant broadens from ",
					createVNode(_components.em, { children: "daemon-process" }),
					" code to ",
					createVNode(_components.em, { children: "daemon-binary" }),
					" code (serve + front). ",
					createVNode(_components.strong, { children: "Exit: the durable remote transport is a named library primitive — not kaval-private — before R9 dials the remote kaval over it." })
				]
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "S1 · the post-R2 handshake move",
				children: [
					"One move left (the supervisor extraction moved into R2.3, where the package is born): the ",
					createVNode(_components.code, { children: "system.version" }),
					"/build-id handshake fragment into ",
					createVNode(_components.code, { children: "@kolu/surface" }),
					", joining the unix-socket pair and ",
					createVNode(_components.code, { children: "isContractVersionCompatible" }),
					" that ",
					createVNode($$PrLink, { pr: 1084 }),
					" already moved. ",
					createVNode(_components.strong, { children: "Exit: kaval and kolu-server serve and check the same handshake fragment, kaval’s e2e green with zero behavior change." })
				]
			}),
			createVNode($$Milestone, {
				status: "next",
				label: "S2 · odu serve, the second tenant",
				children: [
					"odu-runner R1 builds ",
					createVNode(_components.code, { children: "odu serve" }),
					" on the spine (per-repo scope key, idle-timeout lifetime as one supported mode); R3 reuses the supervisor half for the home-manager unit and crash semantics. The ",
					createVNode(_components.a, {
						href: "./electricity.html",
						children: "electricity"
					}),
					" bar — domain-agnostic, hides hard volatility, second consumer — passes by construction rather than by argument. ",
					createVNode(_components.strong, { children: "Exit: odu-runner R1’s “attach with nothing running” ships without odu defining a pid-gate, an entry sequence, or a handshake of its own." })
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
	"title": "@kolu/surface-daemon — one spine for kaval and odu serve",
	"description": "kaval (the PTY daemon) and odu serve (the long-lived CI coordinator) need the identical lifecycle machinery — pid-gated entry, a unix socket that outlives clients, a contract handshake on every connect, an endpoint state machine, spawn/respawn drivers. This note names that shared spine, says what is mechanism (extract) versus policy (keep per-program), and sequences it: the daemon half is born as the package in kaval R2.2; the supervisor half is born as its own `@kolu/surface-daemon-supervisor` package in kaval R2.3 (package boundary = staleKey boundary = spine/soul line); S1 moves the handshake fragment into `@kolu/surface`; odu serve consumes the whole as the second tenant (S2).",
	"parents": [
		"pty-daemon",
		"electricity",
		"feature",
		"surface"
	],
	"status": "accepted",
	"maturity": "seedling",
	"updated": "2026-06-15T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "two-daemons-one-spine",
			"text": "Two daemons, one spine"
		},
		{
			"depth": 2,
			"slug": "mechanism-vs-policy--what-stays-per-program",
			"text": "Mechanism vs policy — what stays per-program"
		},
		{
			"depth": 2,
			"slug": "where-each-piece-lands",
			"text": "Where each piece lands"
		},
		{
			"depth": 2,
			"slug": "a-separate-supervisor-package-not-a-supervisor-subpath",
			"text": "A separate supervisor package, not a /supervisor subpath"
		},
		{
			"depth": 2,
			"slug": "the-daemon-halfs-public-api--by-example",
			"text": "The daemon half’s public API — by example"
		},
		{
			"depth": 2,
			"slug": "phases",
			"text": "Phases"
		}
	];
}
var url = "src/content/atlas/surface-daemon.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-daemon.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface-daemon.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
