import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$D2 } from "./D2_CPv-UX0x.mjs";
import { t as $$Issue } from "./Issue_mLFqCJSR.mjs";
//#region src/content/atlas/pty-daemon.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		blockquote: "blockquote",
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
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: ["R2 of ", createVNode(_components.a, {
				href: "remote-terminals.html",
				children: "remote terminals"
			})] }),
			" — the local PTY survivor. Your terminals (process · scrollback · running agent) outlive a kolu deploy because they don’t live in kolu: they live in ",
			createVNode(_components.strong, { children: "kaval" }),
			" (Tamil ",
			createVNode(_components.em, { children: "kāval" }),
			" — watch, guard), a standalone daemon kolu ",
			createVNode(_components.em, { children: "dials" }),
			". kolu-server restarts every deploy; kaval keeps holding the fds. ",
			createVNode(_components.strong, { children: "Shipped end-to-end" }),
			" (R2.1 → R2.5), closing ",
			createVNode($$Issue, { n: 671 }),
			". This note is the build log; the cross-host shape lives in the ",
			createVNode(_components.a, {
				href: "remote-terminals.html",
				children: "parent"
			}),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The first build (",
			createVNode($$PrLink, { pr: 1275 }),
			") shipped the whole feature as one 40-commit PR — verified live in prod, then deliberately discarded: functional, but the architecture was ",
			createVNode(_components.em, { children: "discovered in review" }),
			", not designed. What follows is the redo — same behavior, a designed boundary, sized one PR per agent session."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "architecture--one-rule-then-a-module-map",
			children: "Architecture — one rule, then a module map"
		}),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "The one rule everything follows from: package boundary = process boundary = staleKey hash, with zero file-level exceptions." }),
				" kaval is ",
				createVNode(_components.em, { children: "exactly" }),
				" the code that runs in the daemon — the PTY primitive, the wire, the taps, the socket, and the process entry. Its staleKey is the nix hash of those package dirs, each hashed whole; the closure test walks the import graph from kaval’s entries and answers the one question the key asks — ",
				createVNode(_components.em, { children: "what would a restart gain?" }),
				" Everything that supervises from outside lives outside the hash, because changing the supervisor never changes what a restart gains."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$D2, {
			caption: "The module map. kaval = the daemon process, hashed whole (the staleKey). All spawn policy (cleanEnv · identity env · shell-init) lives client-side in kolu-server and crosses the wire as DATA — spawn {argv,env,initFiles} — never as code, which is what makes a remote kaval computable. The supervisor spine (@kolu/surface-daemon-supervisor: endpoint · waitForPidGone · restart · survivable spawn) is its own un-hashed package; what stays in kolu-server is the soul (localDriver params, reconcile). kaval-tui dials the same socket kolu does.",
			code: `direction: down
ui: "kolu web UI\\n(browser)"
brain: "kolu-server — the session brain\\n(restarts every deploy)" {
sup: "supervisor (soul: localDriver params · reconcile)\\nspine → @kolu/surface-daemon-supervisor\\nendpoint · waitForPidGone · restart · survivable spawn"
policy: "spawn policy (kolu-pty)\\ncleanEnv · identity env · shell-init"
providers: "provider DAG — FRESH each deploy"
}
kaval: "kaval — dumb-but-durable PTY daemon\\n(hashed whole = the staleKey)" {
entry: "daemonMain · pid-gate · own rcDir · serve loop"
core: "createPtyHost · taps · surface contract · unix socket"
}
tui: "kaval-tui (reference client)"
ui -> brain: "websocket surface"
brain.sup -> kaval.entry: "spawns + supervises"
brain.policy -> kaval.core: "spawn {argv, env, initFiles}"
brain.providers -> kaval.core: "raw taps"
tui -> kaval.core: "dials the socket"
`
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "kaval is a program of its own; kolu is its first client." }),
			" Like ",
			createVNode(_components.a, {
				href: "https://github.com/srid/drishti",
				children: "drishti"
			}),
			" (graduated from a monitor example) and ",
			createVNode(_components.a, {
				href: "https://github.com/juspay/odu",
				children: "odu"
			}),
			" (from ",
			createVNode(_components.code, { children: "mini-ci" }),
			"), kaval is a surface app that was trapped inside kolu-server — ",
			createVNode(_components.code, { children: "ptyHostSurface" }),
			" was already a ",
			createVNode(_components.code, { children: "defineSurface()" }),
			" all along. The layering: ",
			createVNode(_components.strong, { children: "dumb-but-durable kaval ← kolu the session brain ← kolu the web UI." }),
			" kaval holds fds, mirrors screens, serves taps — ",
			createVNode(_components.em, { children: "nothing else" }),
			". kolu stays a substantive middle tier on purpose: the #1031 postmortem is binding — daemonizing the ",
			createVNode(_components.strong, { children: "provider DAG" }),
			" served stale detection every deploy, so session persistence, reconciliation, the DAG, and all spawn policy stay kolu’s, re-run ",
			createVNode(_components.em, { children: "fresh" }),
			" against the surviving PTYs. kolu is not a ",
			createVNode(_components.em, { children: "thin" }),
			" client, but it is ",
			createVNode(_components.em, { children: "a" }),
			" client (kaval-tui today, an MCP face later)."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The shared daemon spine" }),
			" (",
			createVNode(_components.a, {
				href: "surface-daemon.html",
				children: "surface-daemon"
			}),
			") is split in two: ",
			createVNode(_components.code, { children: "@kolu/surface-daemon" }),
			" (the daemon half — atomic pid-gate, the ",
			createVNode(_components.code, { children: "daemonMain" }),
			" skeleton) and ",
			createVNode(_components.code, { children: "@kolu/surface-daemon-supervisor" }),
			" (the supervisor half — endpoint state machine, ",
			createVNode(_components.code, { children: "waitForPidGone" }),
			", composed restart, survivable-spawn driver). Both are ",
			createVNode(_components.em, { children: "our" }),
			" libraries with ",
			createVNode(_components.em, { children: "our" }),
			" consumers (kolu today, ",
			createVNode(_components.code, { children: "odu serve" }),
			" next — see ",
			createVNode(_components.a, {
				href: "odu-runner.html",
				children: "odu-runner"
			}),
			"), changed freely, ",
			createVNode(_components.strong, { children: "no backwards-compat tax" }),
			". Mechanism upstreams; only kolu’s session/terminal ",
			createVNode(_components.em, { children: "policy" }),
			" stays soul. The line every PR draws: ",
			createVNode(_components.strong, { children: [
				"the spine adopts/recycles/serializes a ",
				createVNode(_components.em, { children: "connection" }),
				"; kolu reconciles that connection’s ",
				createVNode(_components.em, { children: "contents" }),
				"."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Multi-host readiness (shapes, not the feature)." }),
			" R2 ships exactly one endpoint but is host-count-agnostic in shape, so R3 retrofits nothing: the endpoint map is keyed by ",
			createVNode(_components.code, { children: "hostId" }),
			"; daemon status is a per-host collection; adoption joins on ",
			createVNode(_components.code, { children: "id" }),
			" (→ ",
			createVNode(_components.code, { children: "(host,id)" }),
			" in R3); the ",
			createVNode(_components.code, { children: "HostLocation" }),
			" discriminator (",
			createVNode(_components.code, { children: "{kind:'local'}" }),
			" → ",
			createVNode(_components.code, { children: "{kind:'remote',hostId}" }),
			") is the dispatch seam (R3.1/#1364 inlined it). A remote pty-host is the ",
			createVNode(_components.strong, { children: "same kaval closure" }),
			" shipped by ",
			createVNode(_components.code, { children: "@kolu/surface-nix-host" }),
			" — ",
			createVNode(_components.code, { children: "nix copy" }),
			", realise, run — exactly how odu provisions its runner; R2.1’s ",
			createVNode(_components.code, { children: "system.info" }),
			" makes spawn policy computable for a host that isn’t kolu’s machine, and ",
			createVNode(_components.code, { children: "initFiles" }),
			" lets rcfiles land where kolu’s hands can’t reach."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-this-makes-impossible-by-construction",
			children: "What this makes impossible by construction"
		}),
		"\n",
		createVNode(_components.p, { children: "The production failures — four from #1034, four more paid for during #1275 — each become a failing test at the phase that owns the concept." }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Production failure" }),
					"\n",
					createVNode(_components.th, { children: "Killed at" }),
					"\n",
					createVNode(_components.th, { children: "How" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Mis-scoped staleness key" }),
					"\n",
					createVNode(_components.td, { children: "R2.2" }),
					"\n",
					createVNode(_components.td, { children: "Closure-scoped key + import-walk guard, re-rooted at the daemon entry." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Over-prompting (key nudged every deploy)" }),
					"\n",
					createVNode(_components.td, { children: "R2.4.4" }),
					"\n",
					createVNode(_components.td, { children: "Keyed on the closure hash; a server-only change leaves it bit-identical — a falsifiable test." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Data-loss restart (kill-then-pray, #1034)" }),
					"\n",
					createVNode(_components.td, { children: "R2.4.2" }),
					"\n",
					createVNode(_components.td, { children: "One composed restart; snapshot-before-kill is the capture step; the drain fires no autosave to clobber it." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Empty-canvas lie (dead daemon → “no terminals”)" }),
					"\n",
					createVNode(_components.td, { children: "R2.3" }),
					"\n",
					createVNode(_components.td, { children: [
						"Honest dead/degraded state ships ",
						createVNode(_components.em, { children: "with the door" }),
						", before any survival promise."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Lossy adoption (#1275)" }),
					"\n",
					createVNode(_components.td, { children: "R2.4.3" }),
					"\n",
					createVNode(_components.td, { children: "Whole-record adopt; a schema-key round-trip test closes the class; a non-survivor is a dropped exited shell, never an autosave-clobbered restore card." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Lazy adopt-on-spawn → duplicate terminals (#1275)" }),
					"\n",
					createVNode(_components.td, { children: "R2.4.3 · R2.5" }),
					"\n",
					createVNode(_components.td, { children: [
						"Both adopt paths adopt ",
						createVNode(_components.em, { children: "from the live snapshot, never re-spawn" }),
						", guarding on the registry so kolu’s own spawn echo is a no-op."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Identity stale after restart (#1275)" }),
					"\n",
					createVNode(_components.td, { children: "R2.3" }),
					"\n",
					createVNode(_components.td, { children: "One status owner emitting on every transition; everything derives by subscription." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Contract-skew crash-loop masked as an “App updated” loop" }),
					"\n",
					createVNode(_components.td, { children: "R2.3" }),
					"\n",
					createVNode(_components.td, { children: "Version checked over the socket on every connect, never an import-time throw; skew → controlled recycle." }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-build--five-steps-each-complete-wrt-its-own-hazards",
			children: "The build — five steps, each complete w.r.t. its own hazards"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"No feature flags — each PR ships complete to master. The refined hazard rule: ",
			createVNode(_components.strong, { children: [
				"each PR is complete w.r.t. the hazards ",
				createVNode(_components.em, { children: "it" }),
				" opens"
			] }),
			" — the inversion opens none (byte-identical refactor), and the door can open with survival ",
			createVNode(_components.em, { children: "off" }),
			", which empties its hazard set by policy."
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Step" }),
					"\n",
					createVNode(_components.th, { children: "Ships" }),
					"\n",
					createVNode(_components.th, { children: "PR" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "R2.1" }), " spawn-policy inversion"] }),
					"\n",
					createVNode(_components.td, { children: [
						"The wire becomes ",
						createVNode(_components.em, { children: "fully specified" }),
						" — ",
						createVNode(_components.code, { children: "spawn {id,argv,cwd,env,initFiles}" }),
						" + ",
						createVNode(_components.code, { children: "system.info → {shell,home,platform,rcDir}" }),
						" (contract 3.0). All kolu-isms move client-side; the daemon writes the rcfiles it’s handed and asks nothing. In-process, ",
						createVNode(_components.strong, { children: "zero user-visible change" }),
						", made at the one moment it’s free. Makes a ",
						createVNode(_components.em, { children: "remote" }),
						" kaval computable."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1292 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "R2.2" }), " the binary + its client"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "pty-host" }),
						" → ",
						createVNode(_components.strong, { children: "kaval" }),
						", ",
						createVNode(_components.code, { children: "pty-tui" }),
						" → ",
						createVNode(_components.strong, { children: "kaval-tui" }),
						", both with bins, runnable as a pair on a box where kolu was never installed. ",
						createVNode(_components.code, { children: "@kolu/surface-daemon" }),
						" born here (gate + ",
						createVNode(_components.code, { children: "daemonMain" }),
						" skeleton, hashed as a staleKey root). Full e2e: the contract corpus over ",
						createVNode(_components.em, { children: "both" }),
						" links + a coverage-ledger meta-test walking every contract key."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1301 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "R2.3" }), " the door (topology flip)"] }),
					"\n",
					createVNode(_components.td, { children: [
						"kolu-server stops serving its own pty-host socket and becomes a ",
						createVNode(_components.em, { children: "client" }),
						" of a kaval it spawns. Boot policy is ",
						createVNode(_components.strong, { children: "always-recycle" }),
						" (no survivors → no survival hazard), so every deploy exercises kill → wait-for-real-exit → respawn — ",
						createVNode(_components.em, { children: "the exact #1034 race, with zero sessions at stake" }),
						". ",
						createVNode(_components.code, { children: "@kolu/surface-daemon-supervisor" }),
						" born here. Honest degraded state + the live KAVAL rail column ship ",
						createVNode(_components.em, { children: "with" }),
						" the door."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1310 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "R2.4" }), " the survival chain"] }),
					"\n",
					createVNode(_components.td, { children: "Terminals survive a deploy. Four PRs (below)." }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "R2.5" }), " live inventory"] }),
					"\n",
					createVNode(_components.td, { children: [
						"A ",
						createVNode(_components.code, { children: "kaval-tui create" }),
						" against kolu’s own daemon now appears in kolu ",
						createVNode(_components.em, { children: "live" }),
						"."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1458 }) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "r24--survival-four-prs-not-one",
			children: "R2.4 — survival, four PRs not one"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The first build did survival as one ~1800-line PR (",
			createVNode($$PrLink, { pr: 1326 }),
			", ",
			createVNode(_components.strong, { children: "closed" }),
			"): too big to review (two blocking data-loss bugs survived its own gauntlet), the spine grew mid-implementation, and a ",
			createVNode(_components.em, { children: "misframed" }),
			" edge case dragged a race-sensitive autosave swamp into the diff that wasn’t even needed (see the crux). The redo is a shallow chain — one refactor, then one capability each."
		] }),
		"\n",
		createVNode($$D2, {
			caption: "The R2.4 chain. One pure refactor (blue) carves the seams; supervised restart (CI-testable, finishes the door's deferred Restart button) lands BEFORE adoption so adoption reuses the proven capture+restore plumbing; currency is last, CI-gated on the build-id reaching the server.",
			code: `direction: down
r1: "R2.4.1 · refactor ✓ #1330\\ncarve the seams (spine + server)" {style.fill: "#dbeafe"}
f2: "R2.4.2 · supervised restart ✓ #1337\\ncapture→drain→recycle" {style.fill: "#dcfce7"}
f3: "R2.4.3 · adoption ✓ #1344\\nsurvive a deploy" {style.fill: "#dcfce7"}
f4: "R2.4.4 · currency nudge ✓ #1353\\nCI-gated" {style.fill: "#dcfce7"}
r1 -> f2
r1 -> f3
f2 -> f3: "reuse capture+restore"
f2 -> f4
f3 -> f4
`
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "PR" }),
					"\n",
					createVNode(_components.th, { children: "Ships" }),
					"\n",
					createVNode(_components.th, { children: "Hazard killed" }),
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
						createVNode(_components.strong, { children: "R2.4.1" }),
						" ",
						createVNode($$PrLink, { pr: 1330 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Pure byte-identical refactor: split ",
						createVNode(_components.code, { children: "ensure()" }),
						" into ",
						createVNode(_components.code, { children: "liveServingHolder" }),
						"/",
						createVNode(_components.code, { children: "killLiveHolder" }),
						"/",
						createVNode(_components.code, { children: "spawnConnectHold" }),
						"; lift ",
						createVNode(_components.code, { children: "killHalfWiredPty" }),
						" (the shared reap receptacle); dedup the snapshot shape into one ",
						createVNode(_components.code, { children: "SessionSnapshot" }),
						" type. Every extraction has a live consumer (the empty→null guard moved to R2.4.2, beside ",
						createVNode(_components.em, { children: "its" }),
						" consumer — codex flagged consumerless future-API)."
					] }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "R2.4.2" }),
						" ",
						createVNode($$PrLink, { pr: 1337 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Session-preserving restart of a ",
						createVNode(_components.em, { children: "running" }),
						" daemon (pick up a new build · user-initiated) ",
						createVNode(_components.em, { children: "and" }),
						" a dead one (recover) — finishes the door’s deferred “Restart kaval” button. Spine: ",
						createVNode(_components.code, { children: "restarting" }),
						" state + ",
						createVNode(_components.code, { children: "serializeRestart" }),
						" (coalesce concurrent triggers) + ",
						createVNode(_components.code, { children: "holdRestarting" }),
						" (one honest state across the recycle). Soul: ",
						createVNode(_components.code, { children: "setSavedSessionFromSnapshot" }),
						" — an ",
						createVNode(_components.em, { children: "unconditional" }),
						" autosave-cancel so the capture survives the kill."
					] }),
					"\n",
					createVNode(_components.td, { children: "#1034 (snapshot-before-kill)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "R2.4.3" }),
						" ",
						createVNode($$PrLink, { pr: 1344 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Live PTYs survive a deploy that ",
						createVNode(_components.em, { children: "didn’t change kaval’s source" }),
						" (staleKey unchanged — the common case). Spine: ",
						createVNode(_components.code, { children: "adoptOrEnsure" }),
						" — adopt a live handshake-compatible survivor (connect, never kill), recycle only an absent/dead/genuinely-skewed one; a survivor connect is retried before concluding skew, so a daemon we merely can’t reach ",
						createVNode(_components.em, { children: "now" }),
						" keeps its PTYs. Soul: ",
						createVNode(_components.code, { children: "reconcile.ts" }),
						" + ",
						createVNode(_components.code, { children: "adoptTerminal" }),
						" (whole-record, never field-by-field)."
					] }),
					"\n",
					createVNode(_components.td, { children: "#1275 (whole-record adopt)" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "R2.4.4" }),
						" ",
						createVNode($$PrLink, { pr: 1353 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Amber ",
						createVNode(_components.strong, { children: "⬆ update pending" }),
						" on the rail when the adopted daemon is a ",
						createVNode(_components.em, { children: "build behind" }),
						" → one-click recycle. Derived at the ",
						createVNode(_components.strong, { children: "read site" }),
						" (",
						createVNode(_components.code, { children: "expectedKaval" }),
						" vs reported ",
						createVNode(_components.code, { children: "staleKey" }),
						"), gated on ",
						createVNode(_components.code, { children: "state===\"connected\"" }),
						", keyed on ",
						createVNode(_components.code, { children: "staleKey" }),
						" ",
						createVNode(_components.em, { children: "never" }),
						" the per-deploy commit. CI gate: the build-id reaches the server."
					] }),
					"\n",
					createVNode(_components.td, { children: "#1034 over-prompting" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The crux — the partial case dissolves; #1326’s swamp was a conflation." }),
			" Every #1326 bug came from treating an ",
			createVNode(_components.em, { children: "adopt-case" }),
			" non-survivor like a ",
			createVNode(_components.em, { children: "restart-case" }),
			" one. They differ:"
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Case" }),
					"\n",
					createVNode(_components.th, { children: "A non-survivor is…" }),
					"\n",
					createVNode(_components.th, { children: "Right move" }),
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
						createVNode(_components.strong, { children: "Restart" }),
						" — daemon killed, ",
						createVNode(_components.em, { children: "all" }),
						" PTYs die"
					] }),
					"\n",
					createVNode(_components.td, { children: "a terminal you still want" }),
					"\n",
					createVNode(_components.td, { children: [
						"restore it on the ",
						createVNode(_components.em, { children: "empty" }),
						" canvas (no survivors, no autosave race)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Adoption" }),
						" — daemon ",
						createVNode(_components.em, { children: "survived" }),
						", one PTY gone"
					] }),
					"\n",
					createVNode(_components.td, { children: ["an ", createVNode(_components.em, { children: "exited shell" })] }),
					"\n",
					createVNode(_components.td, { children: [
						"drop it — exactly what ",
						createVNode(_components.code, { children: "handleExit" }),
						" already does"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"So adoption’s “partial” case is trivial — ",
			createVNode(_components.strong, { children: "adopt the live, drop the exited" }),
			" — no restore card, no recycle, no autosave-durability machinery. #1326 mis-applied the restart-case restore card to the adopt case, forcing a ",
			createVNode(_components.code, { children: "pendingRestoreCard" }),
			"/union cluster that burned four codex rounds ",
			createVNode(_components.em, { children: "for a problem that doesn’t exist" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "R2.4.4’s two operands" }),
			" — both already baked into nix, the code just names and compares them at the read site: ",
			createVNode(_components.strong, { children: "reported" }),
			" = the adopted daemon’s own ",
			createVNode(_components.code, { children: "staleKey" }),
			" (already on the wire via ",
			createVNode(_components.code, { children: "daemonStatus.identity" }),
			"); ",
			createVNode(_components.strong, { children: "expected" }),
			" = the server’s ",
			createVNode(_components.code, { children: "KAVAL_BUILD_ID" }),
			" (one ",
			createVNode(_components.code, { children: "${kavalBuildId}" }),
			" nix-",
			createVNode(_components.code, { children: "--set" }),
			"s onto ",
			createVNode(_components.em, { children: "both" }),
			" the koluBin wrapper and the kaval bin), surfaced as an additive-optional ",
			createVNode(_components.code, { children: "buildInfo.expectedKaval" }),
			" — no contract bump, so no surviving daemon is force-restarted. Because the key is a content-hash of ",
			createVNode(_components.em, { children: "kaval’s daemon source closure only" }),
			", a server-/client-only deploy leaves it bit-identical and the nudge stays silent — the #1034 over-prompting fix, by construction."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "r25--live-inventory-the-two-way-reach",
			children: "R2.5 — live inventory, the two-way reach"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"R2.4.3 reconciles the daemon’s live PTYs against the saved session ",
			createVNode(_components.em, { children: "once, at boot" }),
			" — so a terminal created out-of-band (a ",
			createVNode(_components.code, { children: "kaval-tui create" }),
			" against the very daemon kolu is a client of) stayed invisible until the next restart. The contract had only ",
			createVNode(_components.em, { children: "per-terminal" }),
			" taps and a one-shot ",
			createVNode(_components.code, { children: "list" }),
			": no way to learn that ",
			createVNode(_components.em, { children: "another" }),
			" client spawned a PTY."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"R2.5 closes that with a host-global ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "inventory" }), " stream"] }),
			" on ",
			createVNode(_components.code, { children: "ptyHostSurface" }),
			" (contract 3.0 → 3.1, additive · minor — a 3.0 survivor lacking it is a hard skew, forced to recycle): snapshot-then-",
			createVNode(_components.code, { children: "created" }),
			"/",
			createVNode(_components.code, { children: "exited" }),
			". kolu-server subscribes once and feeds every unknown id into the ",
			createVNode(_components.em, { children: "existing" }),
			" adopt path, so the daemon’s ",
			createVNode(_components.code, { children: "entries" }),
			" map becomes the single source of truth and kolu’s registry a continuous projection. ",
			createVNode(_components.strong, { children: "The reach is now two-way:" }),
			" ",
			createVNode(_components.code, { children: "kaval-tui list" }),
			" reaches kolu’s terminals, and a ",
			createVNode(_components.code, { children: "kaval-tui create" }),
			" appears in kolu live. (A bare adopted PTY has no kolu OSC hooks, so its tile shows live shell + scrollback but no agent/title detection — an inherent ceiling, not a regression.)"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "design-notes-that-carry-forward",
			children: "Design notes that carry forward"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The survivor is kaval only" }),
			" — node-pty fds + the ",
			createVNode(_components.code, { children: "@xterm/headless" }),
			" mirror + the raw VT taps + a unix socket + its own process entry. A kolu-server restart re-runs the providers against the surviving PTYs, so detection is never stale while the PTYs persist. Honest cost: metadata is no longer “warm” across a restart — a brief re-detection pass, trading warm-on-reconnect for freshness-on-deploy. Only a (rare) contract change forces terminal loss; a (frequent) provider change restarts the cheap layer with PTYs untouched. This corrects #1031, which daemonized a survivor that ",
			createVNode(_components.em, { children: "held" }),
			" the providers."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The cgroup survival mechanism (spike-verified)." }),
			" On Linux/systemd kaval spawns via ",
			createVNode(_components.code, { children: "systemd-run --user" }),
			" (gated on ",
			createVNode(_components.code, { children: "fromSource" }),
			" + ",
			createVNode(_components.code, { children: "INVOCATION_ID" }),
			"), landing in its own transient cgroup — a plain detached/",
			createVNode(_components.code, { children: "setsid" }),
			" child does ",
			createVNode(_components.em, { children: "not" }),
			" survive on cgroup-v2 (",
			createVNode(_components.code, { children: "KillMode=control-group" }),
			" walks cgroup membership, the #1031 Linux failure). macOS’s detached spawn already survives launchd. Caveats: linger on, absolute daemon path, ",
			createVNode(_components.strong, { children: "per-spawn unique unit names" }),
			" (a dead unit can linger loaded). Single-instance two ways: the unit name plus the atomic pid-gate. kaval namespaces its socket+gate ",
			createVNode(_components.strong, { children: "per kolu-server instance by listen port" }),
			" (",
			createVNode(_components.code, { children: "kaval-<port>/" }),
			") since ",
			createVNode($$PrLink, { pr: 1313 }),
			", so two servers never recycle each other’s daemon."
		] }),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "tmux/dtach considered and rejected:" }), " they only keep a PTY alive — no OSC-parsed taps, no headless snapshot for lazy-attach, no home for the provider DAG. You’d still build kaval’s streaming layer next to tmux and inherit its session model on top."] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-1034-hard-constraints-binding-on-the-redo",
			children: "The #1034 hard constraints (binding on the redo)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The #1034 build (",
			createVNode($$PrLink, { pr: 1034 }),
			") shipped the nudge + a Restart command; on prod, clicking restart ",
			createVNode(_components.strong, { children: "destroyed a live 20-terminal session and couldn’t bring the daemon back" }),
			" — ",
			createVNode(_components.code, { children: "killAll" }),
			" drained all 20, the old daemon (25G RAM, thrashing box) took ~2min to exit, the respawn timed out at 30s, leaving an empty canvas indistinguishable from “no terminals.” The respawn lost the race against the slow exit. The constraints it bought:"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Restart is recoverable, never kill-then-pray" }), " — snapshot first; if respawn fails, a loud degraded state with the session preserved."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Wait for real exit" }),
				" (",
				createVNode(_components.code, { children: "kill(pid,0)" }),
				" → ESRCH) before spawning — the single-instance lock fights the restart."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Timeouts fit a loaded prod box" }), ", not an idle dev one."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Never lie about state" }), " — explicit connecting/degraded UI, never silent emptiness."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Key staleness on kaval, not the whole binary" }), " — so the nudge fires only when a restart actually gains something."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "history",
			children: "History"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "#1031 → #1034 → #1275" }), " — three dead-ends that bought the design. #1031 daemonized the provider DAG (stale detection every deploy); #1034 was the kill-then-pray postmortem above; #1275 shipped the whole feature as one 40-commit PR, verified live, then discarded for an architecture discovered in review rather than designed. Earlier prototypes (#994 remote-providers, #1010 PTY-only local daemon) seeded the thin-survivor model; the redo is their correct combination."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The kaval reframing" }),
				" (2026-06-12) — a coupling audit found four ties to kolu (no bin, daemon-side spawn policy, hardcoded socket app-name, kolu build-id env). The fix: invert the wire (R2.1), then ship the standalone binary (R2.2), then flip the topology (R2.3), then survival (R2.4). ",
				createVNode(_components.a, {
					href: "surface-daemon.html",
					children: "surface-daemon"
				}),
				" (",
				createVNode($$PrLink, { pr: 1294 }),
				") named the shared daemon spine with ",
				createVNode(_components.code, { children: "odu serve" }),
				" as its second tenant; ",
				createVNode($$PrLink, { pr: 1313 }),
				" namespaced the daemon per kolu-server instance."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "R2.1–R2.5 shipped" }),
				" (2026-06-12 → 06-14, plus R2.5 #1458) — the inversion (contract 3.0, parity tests, zero ",
				createVNode(_components.code, { children: "kolu-*" }),
				" deps), the binary (full e2e over both links + the coverage ledger), the door (the topology flip + honest degraded state), the four-PR survival chain (refactor → restart → adoption → currency nudge), and the live-inventory two-way reach. The currency nudge’s VM gate (",
				createVNode(_components.code, { children: "adopt.nix" }),
				" = no-nudge-on-no-op, a build-skew sibling of ",
				createVNode(_components.code, { children: "skew.nix" }),
				") was pu-verified green-on-correct, red-under-mutation. Per-PR detail (gauntlet finds, as-built deltas) lives on each PR."
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Open follow-ups — the MCP face, graduation",
			children: createVNode(_components.p, { children: [
				"Two post-R2 directions the reframing opened: project kaval’s surface through ",
				createVNode(_components.code, { children: "@kolu/surface-mcp" }),
				" (default-deny) so coding agents get structured terminal access without scraping; and graduation to its own repository once the contract stops churning — the drishti/odu path."
			] })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "R2 — kaval, the standalone PTY daemon",
	"description": "R2 of remote terminals over SSH — terminals survive a kolu deploy because the PTYs live in kaval, a standalone daemon kolu merely dials. One rule (package boundary = process boundary = staleKey hash), a dumb fully-specified wire, and the spawn-inversion → binary → door → survival → live-inventory chain. Shipped end-to-end.",
	"parents": ["remote-terminals", "feature"],
	"status": "accepted",
	"maturity": "budding",
	"updated": "2026-06-21T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "architecture--one-rule-then-a-module-map",
			"text": "Architecture — one rule, then a module map"
		},
		{
			"depth": 2,
			"slug": "what-this-makes-impossible-by-construction",
			"text": "What this makes impossible by construction"
		},
		{
			"depth": 2,
			"slug": "the-build--five-steps-each-complete-wrt-its-own-hazards",
			"text": "The build — five steps, each complete w.r.t. its own hazards"
		},
		{
			"depth": 3,
			"slug": "r24--survival-four-prs-not-one",
			"text": "R2.4 — survival, four PRs not one"
		},
		{
			"depth": 3,
			"slug": "r25--live-inventory-the-two-way-reach",
			"text": "R2.5 — live inventory, the two-way reach"
		},
		{
			"depth": 2,
			"slug": "design-notes-that-carry-forward",
			"text": "Design notes that carry forward"
		},
		{
			"depth": 3,
			"slug": "the-1034-hard-constraints-binding-on-the-redo",
			"text": "The #1034 hard constraints (binding on the redo)"
		},
		{
			"depth": 2,
			"slug": "history",
			"text": "History"
		}
	];
}
var url = "src/content/atlas/pty-daemon.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pty-daemon.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/pty-daemon.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
