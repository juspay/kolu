import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Issue } from "./Issue_mLFqCJSR.mjs";
import { t as $$Svg } from "./Svg_DjauMHvD.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/diagrams/host-isolation-locks.svg?raw
var host_isolation_locks_default = "<svg viewBox=\"0 0 700 330\" xmlns=\"http://www.w3.org/2000/svg\" font-family=\"ui-sans-serif, system-ui, sans-serif\" font-size=\"12.5\">\n  <defs>\n    <marker id=\"hA\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#5b6472\"/>\n    </marker>\n    <marker id=\"hR\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#c0392b\"/>\n    </marker>\n    <marker id=\"hG\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\n      <path d=\"M0 0 L10 5 L0 10 z\" fill=\"#2e7d4f\"/>\n    </marker>\n  </defs>\n  <style>\n    .box{rx:9;ry:9;stroke-width:1.6}\n    .ok{fill:#e3f6e9;stroke:#2e7d4f}\n    .bad{fill:#fbe2e2;stroke:#c0392b}\n    .neut{fill:#eef1f6;stroke:#5b6472}\n    .prod{fill:#fff3d4;stroke:#b8860b}\n    .t{fill:#1c2430}\n    .h{font-weight:700}\n    .sub{fill:#5b6472;font-size:11px}\n    .subR{fill:#c0392b;font-size:11px;font-weight:700}\n    .subG{fill:#2e7d4f;font-size:11px;font-weight:700}\n  </style>\n\n  <!-- LOCK 1 (top half) -->\n  <text class=\"t h\" x=\"16\" y=\"24\" font-size=\"14\">LOCK 1 — the folder is the identity</text>\n\n  <rect class=\"box prod\" x=\"440\" y=\"40\" width=\"244\" height=\"58\"/>\n  <text class=\"t h\" x=\"562\" y=\"61\" text-anchor=\"middle\">~/.local/state/padi</text>\n  <text class=\"sub\" x=\"562\" y=\"78\" text-anchor=\"middle\">production's folder (its identity)</text>\n\n  <rect class=\"box ok\" x=\"16\" y=\"40\" width=\"180\" height=\"58\"/>\n  <text class=\"t h\" x=\"106\" y=\"61\" text-anchor=\"middle\">your real kolu</text>\n  <text class=\"sub\" x=\"106\" y=\"78\" text-anchor=\"middle\">badge: KOLU_ROLE=production</text>\n  <line x1=\"196\" y1=\"69\" x2=\"436\" y2=\"69\" stroke=\"#2e7d4f\" stroke-width=\"1.8\" marker-end=\"url(#hG)\"/>\n  <text class=\"subG\" x=\"316\" y=\"61\" text-anchor=\"middle\">binds — allowed</text>\n\n  <rect class=\"box bad\" x=\"16\" y=\"122\" width=\"180\" height=\"58\"/>\n  <text class=\"t h\" x=\"106\" y=\"143\" text-anchor=\"middle\">bare pnpm dev / padi</text>\n  <text class=\"sub\" x=\"106\" y=\"160\" text-anchor=\"middle\">no badge, no own folder</text>\n  <line x1=\"196\" y1=\"151\" x2=\"360\" y2=\"100\" stroke=\"#c0392b\" stroke-width=\"1.8\" stroke-dasharray=\"7 4\" marker-end=\"url(#hR)\"/>\n  <text class=\"subR\" x=\"300\" y=\"140\" text-anchor=\"middle\">✗ CRASH at bind:</text>\n  <text class=\"subR\" x=\"300\" y=\"154\" text-anchor=\"middle\">\"set KOLU_PADI_STATE_DIR\"</text>\n\n  <!-- LOCK 3 (bottom half) -->\n  <text class=\"t h\" x=\"16\" y=\"222\" font-size=\"14\">LOCK 3 — tests forked real daemons, uncapped, seeing prod</text>\n\n  <rect class=\"box neut\" x=\"16\" y=\"238\" width=\"180\" height=\"58\"/>\n  <text class=\"t h\" x=\"106\" y=\"259\" text-anchor=\"middle\">bare vitest</text>\n  <text class=\"sub\" x=\"106\" y=\"276\" text-anchor=\"middle\">19 real-spawn suites</text>\n\n  <rect class=\"box ok\" x=\"260\" y=\"238\" width=\"190\" height=\"58\"/>\n  <text class=\"t h\" x=\"355\" y=\"259\" text-anchor=\"middle\">describeDaemon gate</text>\n  <text class=\"sub\" x=\"355\" y=\"276\" text-anchor=\"middle\">skips: KOLU_DAEMON_TESTS unset</text>\n\n  <rect class=\"box prod\" x=\"510\" y=\"238\" width=\"174\" height=\"58\"/>\n  <text class=\"t h\" x=\"597\" y=\"259\" text-anchor=\"middle\">CI: ci::daemon node</text>\n  <text class=\"sub\" x=\"597\" y=\"276\" text-anchor=\"middle\">gate ON · leashed · capped</text>\n\n  <line x1=\"196\" y1=\"267\" x2=\"256\" y2=\"267\" stroke=\"#5b6472\" stroke-width=\"1.6\" marker-end=\"url(#hA)\"/>\n  <text class=\"subG\" x=\"226\" y=\"259\" text-anchor=\"middle\">0 forks</text>\n  <line x1=\"450\" y1=\"267\" x2=\"506\" y2=\"267\" stroke=\"#2e7d4f\" stroke-width=\"1.6\" marker-end=\"url(#hG)\"/>\n\n  <text class=\"sub\" x=\"16\" y=\"322\">+ every test worker's env is scrubbed of KAVAL_SOCKET / PADI_SOCKET — tests cannot even see the real daemons.</text>\n</svg>\n";
//#endregion
//#region src/content/atlas/host-isolation-locks.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		dd: "dd",
		del: "del",
		dl: "dl",
		dt: "dt",
		em: "em",
		h2: "h2",
		h3: "h3",
		li: "li",
		ol: "ol",
		p: "p",
		strong: "strong",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"Twice, working on kolu killed the kolu being worked in: a dev run disrupted the\nproduction service (",
			createVNode($$Issue, { n: 1334 }),
			"), and a bare ",
			createVNode(_components.code, { children: "vitest" }),
			" forked enough real\ndaemons that the OOM killer reaped the production kaval — every terminal lost\n(",
			createVNode($$Issue, { n: 1375 }),
			"). The first fix attempt (",
			createVNode($$PrLink, { pr: 1911 }),
			", ",
			createVNode(_components.strong, { children: "closed\nafter adversarial review" }),
			" 2026-07-21) framed three independent locks. Of\nthem: ",
			createVNode(_components.strong, { children: "Lock 3 shipped" }),
			" (",
			createVNode($$PrLink, { pr: 1921 }),
			", closed #1375); ",
			createVNode(_components.strong, { children: "Lock 1 was\nsuperseded" }),
			" — the live plan is ",
			createVNode(_components.a, {
				href: "./state-isolation.html",
				children: "state\nisolation"
			}),
			": no badge, no guard; the state-root\ndefault is deleted outright and the production wrapper supplies the path, so\nthe Lock-1 mechanism below is kept only as the #1911-era design record; ",
			createVNode(_components.strong, { children: "Lock 2 was rejected" }),
			" to ",
			createVNode($$Issue, { n: 1912 }),
			". This\nnote explains the two ",
			createVNode(_components.em, { children: "low-risk" }),
			" ones — Lock 1 and Lock 3 — in plain words,\nas #1911 designed them.\nThey are boot checks and test plumbing; the third, Lock 2, is the delicate one\n(it guards the daemon take-over/kill machinery itself) and is summarized at the\nend.",
			createVNode($$Footnote, { children: [
				"Lock 2 puts a role check inside the supervisor endpoint so an\nadopt, kill, or drain first reads the target daemon’s role marker and refuses to\ntouch production. It touches kolu’s most sensitive lifecycle code, which is why\nit carries most of the merge risk; the residual it deliberately does not cover\n(daemon wire verbs like ",
				createVNode(_components.code, { children: "killAll" }),
				" from interactive tools) is tracked in\n",
				createVNode($$Issue, { n: 1912 }),
				"."
			] })
		] }),
		"\n",
		createVNode($$Svg, {
			svg: host_isolation_locks_default,
			caption: "Lock 1: a process without the production badge that reaches for production's state folder crashes at bind time. Lock 3: a bare test run spawns no real daemons at all, and test processes have the real daemons' addresses scrubbed from their environment."
		}),
		"\n",
		createVNode(_components.h2, {
			id: "lock-1--a-dev-process-cant-use-productions-folder",
			children: "Lock 1 — a dev process can’t use production’s folder"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A kolu daemon’s identity ",
			createVNode(_components.strong, { children: "is its state folder" }),
			" — the path is hashed and that\ndigest names its sockets and its gate. Your real kolu lives at the well-known\ndefault (",
			createVNode(_components.code, { children: "~/.local/state/padi" }),
			"). The hole: a bare dev command — ",
			createVNode(_components.code, { children: "pnpm dev" }),
			", a\nplain ",
			createVNode(_components.code, { children: "padi" }),
			" — that isn’t told otherwise ",
			createVNode(_components.strong, { children: "defaults to the same folder" }),
			". Same\nfolder, same digest, same daemon: the dev process is now entitled to take over\nor restart ",
			createVNode(_components.em, { children: "your" }),
			" kolu. Nothing refused the crossing."
		] }),
		"\n",
		createVNode(_components.p, { children: "The lock, in three parts:" }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Production wears a badge." }),
				" The production launcher (the nix wrapper that\nstarts your daily kolu) sets ",
				createVNode(_components.code, { children: "KOLU_ROLE=production" }),
				". Nothing else ever sets\nit."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "No badge → the default folder is off-limits." }),
				" A process without the badge\nthat tries to ",
				createVNode(_components.em, { children: "bind" }),
				" production’s folder — by default, by explicit override,\nor a folder persistently marked as production",
				createVNode($$Footnote, { children: "The persistent marker\ncovers a relocated production root (the #1414 second-instance case): a\nproduction daemon stamps its state folder, and a dev process refuses to bind\na stamped folder even when pointed at it explicitly, even when no daemon is\nrunning there." }),
				" — ",
				createVNode(_components.strong, { children: "crashes immediately" }),
				", with a one-line remedy:\nset ",
				createVNode(_components.code, { children: "KOLU_PADI_STATE_DIR" }),
				" to a folder of your own."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "First-party dev flows already comply." }),
				" ",
				createVNode(_components.code, { children: "pnpm dev" }),
				" now sets a per-worktree\nprivate folder automatically, and the e2e harness always did. Day-to-day you\nnotice nothing; only a truly bare launch that ",
				createVNode(_components.em, { children: "would have collided" }),
				" now\nrefuses loudly instead."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The design law behind it: crash loudly rather than silently share — the same\nfail-fast shape ",
			createVNode(_components.code, { children: "KOLU_STATE_DIR" }),
			" already had on the server side. The asymmetry\n(server refused, padi silently defaulted) was the hole."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "lock-3--tests-cant-fork-bomb-the-box-and-cant-see-real-daemons",
			children: "Lock 3 — tests can’t fork-bomb the box, and can’t see real daemons"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Nineteen test files spawn ",
			createVNode(_components.strong, { children: "real" }),
			" daemon processes — real padi, real kaval,\nreal PTYs. Two separate dangers: a bare ",
			createVNode(_components.code, { children: "vitest" }),
			" ran them all, uncapped (the\nincident left 182 abandoned daemon dirs and an OOM-reaped production kaval); and\ntest processes ",
			createVNode(_components.strong, { children: "inherit your shell’s environment" }),
			", which carries the socket\naddresses of your real daemons — so a buggy test could dial your actual kolu."
		] }),
		"\n",
		createVNode(_components.p, { children: "The lock, in four parts:" }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Daemon tests are off by default." }),
				" Every real-spawn suite is wrapped in\n",
				createVNode(_components.code, { children: "describeDaemon" }),
				" (from the new zero-dep leaf ",
				createVNode(_components.code, { children: "@kolu/daemon-test-gate" }),
				"),\nwhich skips unless ",
				createVNode(_components.code, { children: "KOLU_DAEMON_TESTS=1" }),
				". A plain ",
				createVNode(_components.code, { children: "vitest" }),
				" on a workstation\nspawns ",
				createVNode(_components.strong, { children: "nothing" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "CI still runs everything." }),
				" A dedicated ",
				createVNode(_components.code, { children: "ci::daemon" }),
				" DAG node sets the\nflag, so coverage is a ",
				createVNode(_components.em, { children: "distinct required check" }),
				" — it cannot silently\ndisappear, and the fork-free ",
				createVNode(_components.code, { children: "unit" }),
				" lane keeps one meaning everywhere."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Opted-in runs are leashed." }),
				" ",
				createVNode(_components.code, { children: "just test-daemon" }),
				" binds every spawned daemon\nto the run’s lifetime (it dies with the run) and caps worker parallelism —\nthe fork-bomb shape is unrepresentable even when the gate is open."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Tests are blinded." }),
				" A per-worker scrub deletes the daemon-locator\nenvironment (",
				createVNode(_components.code, { children: "KAVAL_SOCKET" }),
				", ",
				createVNode(_components.code, { children: "PADI_SOCKET" }),
				", …) before any test runs, and a\nruntime guard at the spawn spine throws if an ungated test tries to fork —\nso helper indirection can’t smuggle a spawn past the gate, and even a badly\nwritten test ",
				createVNode(_components.strong, { children: "cannot see" }),
				" your real kolu, let alone kill it."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-three-ways-of-running-kolu--and-which-identity-each-gets",
			children: "The three ways of running kolu — and which identity each gets"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The locks only make sense against how kolu actually starts. There are three\nfront doors; below, ",
			createVNode(_components.strong, { children: "every path each one uses" }),
			", before → after the fix. Two\nfacts to read them with: a daemon’s ",
			createVNode(_components.em, { children: "identity" }),
			" is the digest of its ",
			createVNode(_components.strong, { children: "padi\nstate-root path" }),
			" (that digest names its sockets and gates), and the runtime\ndirs live under ",
			createVNode(_components.code, { children: "$XDG_RUNTIME_DIR" }),
			" and are wiped on reboot — the state roots\npersist."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "nix-run-githubjuspaykolu--the-production-front-door",
			children: [createVNode(_components.code, { children: "nix run github:juspay/kolu" }), " — the production front door"]
		}),
		"\n",
		createVNode(_components.dl, { children: [
			createVNode(_components.dt, { children: createVNode(_components.strong, { children: "Role badge" }) }),
			createVNode(_components.dd, { children: [
				"before: ",
				createVNode(_components.em, { children: "(no such concept)" }),
				" → after: ",
				createVNode(_components.code, { children: "KOLU_ROLE=production" }),
				", set by the wrapper — the only place that sets it."
			] }),
			createVNode(_components.dt, { children: [createVNode(_components.strong, { children: "Server state" }), " (settings, remembered hosts, prefs)"] }),
			createVNode(_components.dd, { children: [
				createVNode(_components.code, { children: [
					createVNode(_components.del, { children: "/.config/kolu/" }),
					" (",
					createVNode(_components.code, { children: "state.json" }),
					") — unchanged. An inherited ",
					createVNode(_components.code, { children: "KOLU_STATE_DIR" }),
					" still wins (the relocated-second-instance case, #1414)."
				] }),
				"\n",
				createVNode(_components.dt, { children: [
					createVNode(_components.strong, { children: "Padi state-root" }),
					" (saved session, ",
					createVNode(_components.code, { children: "padi.log" }),
					") — ",
					createVNode(_components.em, { children: "the identity anchor" })
				] }),
				"\n",
				createVNode(_components.dd, { children: [createVNode(_components.code, {}), "/.local/state/padi/"] }),
				" — unchanged path; after, production also stamps ",
				createVNode(_components.code, { children: "~/.local/state/padi/role" }),
				" (the persistent marker dev refuses to cross, even with the daemon down)."
			] }),
			createVNode(_components.dt, { children: [createVNode(_components.strong, { children: "Daemon runtime" }), " (sockets · pid gates · manifests; boot-wiped)"] }),
			createVNode(_components.dd, { children: [
				createVNode(_components.code, { children: "$XDG_RUNTIME_DIR/padi-<digest>/" }),
				" and ",
				createVNode(_components.code, { children: "kaval-<digest>/" }),
				", where ",
				createVNode(_components.code, { children: "<digest>" }),
				" = sha256 of the state-root path — so production’s digest is fixed by the path above. After: each dir also carries an ephemeral ",
				createVNode(_components.code, { children: "role" }),
				" file, written before the socket serves."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"This runs the flake’s default package, which is a thin ",
			createVNode(_components.strong, { children: "production wrapper" }),
			"\naround the real binary. The wrapper does exactly two things: it exports\n",
			createVNode(_components.code, { children: "KOLU_STATE_DIR" }),
			", defaulting to ",
			createVNode(_components.code, { children: "~/.config/kolu" }),
			" (an inherited value wins, so a\nsecond, relocated production instance stays possible",
			createVNode($$Footnote, { children: [
				"The #1414 case: a\nsecond production instance sets its own ",
				createVNode(_components.code, { children: "KOLU_STATE_DIR" }),
				" before launch and the\nwrapper honors it via its ",
				createVNode(_components.code, { children: ":-" }),
				" fallback instead of hijacking ",
				createVNode(_components.code, { children: "$HOME" }),
				". Lock 1’s\npersistent marker is what keeps such a relocated root refusable by dev\nprocesses."
			] }),
			"), and — after Lock 1 — it sets the badge:\n",
			createVNode(_components.code, { children: "KOLU_ROLE=production" }),
			". Nothing else in the repo sets that variable. The server\nthen binds the ",
			createVNode(_components.strong, { children: "default padi state root" }),
			", which is exactly what the badge\nentitles it to. Notably, the ",
			createVNode(_components.em, { children: "base" }),
			" binary underneath the wrapper deliberately\nhas ",
			createVNode(_components.strong, { children: "no" }),
			" state-dir default: anything that reaches it without going through\nthis wrapper (tests do) crashes rather than silently landing in\n",
			createVNode(_components.code, { children: "~/.config/kolu" }),
			"."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "the-home-manager-module--the-same-door-supervised",
			children: "The home-manager module — the same door, supervised"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "services.kolu" }),
			" doesn’t invent a different kolu — it execs the package you point\nit at (normally that same production wrapper) as a ",
			createVNode(_components.strong, { children: "user service" }),
			" (systemd unit\non Linux, LaunchAgent on macOS) with your ",
			createVNode(_components.code, { children: "--host" }),
			"/",
			createVNode(_components.code, { children: "--port" }),
			",\n",
			createVNode(_components.code, { children: "Restart=on-failure" }),
			", and the TUI CLIs on PATH. So every path is ",
			createVNode(_components.strong, { children: [
				"identical to\n",
				createVNode(_components.code, { children: "nix run" }),
				" above"
			] }),
			" — production folder, production badge, same padi root, same\nruntime digest. One thing worth its own line:"
		] }),
		"\n",
		createVNode(_components.dl, { children: [createVNode(_components.dt, { children: createVNode(_components.strong, { children: "What the service manager owns vs. what outlives it" }) }), createVNode(_components.dd, { children: [
			"systemd/launchd supervises only the ",
			createVNode(_components.em, { children: "server" }),
			". The padi + kaval daemons it spawns live in the boot-wiped runtime dirs and ",
			createVNode(_components.strong, { children: "outlive service restarts" }),
			" by design (the kaval-survivors feature) — which is exactly why a stray dev process able to adopt or kill them was so dangerous: they are long-lived and hold your terminals."
		] })] }),
		"\n",
		createVNode(_components.h3, {
			id: "just-dev--a-private-universe-per-worktree",
			children: [createVNode(_components.code, { children: "just dev" }), " — a private universe per worktree"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "just dev" }),
			" (and ",
			createVNode(_components.code, { children: "just dev-auto" }),
			", which picks two random free ports so a second\nworktree never collides) runs the dev server via the kolu-cli ",
			createVNode(_components.code, { children: "dev" }),
			" script."
		] }),
		"\n",
		createVNode(_components.dl, { children: [
			createVNode(_components.dt, { children: createVNode(_components.strong, { children: "Role badge" }) }),
			createVNode(_components.dd, { children: "none — and none needed: nothing here ever reaches for production’s folder." }),
			createVNode(_components.dt, { children: createVNode(_components.strong, { children: "Server state" }) }),
			createVNode(_components.dd, { children: [
				"before: ",
				createVNode(_components.em, { children: "set" }),
				" — ",
				createVNode(_components.code, { children: "<worktree>/.kolu-dev/" }),
				" (this half was already isolated). After: unchanged."
			] }),
			createVNode(_components.dt, { children: [
				createVNode(_components.strong, { children: "Padi state-root" }),
				" — ",
				createVNode(_components.em, { children: "the fix’s crux" })
			] }),
			createVNode(_components.dd, { children: [
				"before: ",
				createVNode(_components.strong, { children: ["UNSET → silently defaulted to ", createVNode(_components.code, { children: "~/.local/state/padi" })] }),
				" (production’s root) — the #1334 hole. After: ",
				createVNode(_components.code, { children: "<worktree>/.kolu-dev/padi/" }),
				", set explicitly by the dev script. A private root ⇒ a private digest ⇒ a wholly separate daemon identity."
			] }),
			createVNode(_components.dt, { children: createVNode(_components.strong, { children: "Daemon runtime" }) }),
			createVNode(_components.dd, { children: [
				createVNode(_components.code, { children: "$XDG_RUNTIME_DIR/padi-<dev-digest>/" }),
				", ",
				createVNode(_components.code, { children: "kaval-<dev-digest>/" }),
				" — namespaced to the worktree, structurally unable to collide with production’s sockets/gates."
			] })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The missing second export (",
			createVNode(_components.code, { children: "KOLU_PADI_STATE_DIR" }),
			") was the whole of #1334; Lock 1\nturns any future recurrence — a bare launch that resolves production’s root\nwithout the badge — into a crash instead of a takeover."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-you-feel-afterwards-lock-3-today-lock-1-once-its-rebuild-lands",
			children: "What you feel afterwards (Lock 3 today; Lock 1 once its rebuild lands)"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.code, { children: "vitest" }), " on your machine: fast, harmless, forks nothing."] }),
			"\n",
			createVNode(_components.li, { children: "A bare launch that would have collided with production: one clear crash line\ninstead of a silent takeover." }),
			"\n",
			createVNode(_components.li, { children: "CI: unchanged coverage, now structurally guaranteed." }),
			"\n",
			createVNode(_components.li, { children: "Your live kolu: unreachable from the dev/test world by construction." }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Why these two are the low-risk pair",
			children: createVNode(_components.p, { children: [
				"Lock 1 is a boot-time check that can only ",
				createVNode(_components.em, { children: "refuse" }),
				"; Lock 3 is almost entirely\ntest-side. Neither touches the daemon take-over/kill machinery — that is\nLock 2’s territory, and the reason ",
				createVNode($$PrLink, { pr: 1911 }),
				" can be split if the\nrisk calculus favors landing the incident-closing pair first."
			] })
		})
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Host Isolation, in Plain Words: Lock 1 and Lock 3",
	"description": "What the two low-risk locks of the #1334/#1375 fix actually do — why a bare dev command can no longer sit in production's chair, and why the test suite can no longer fork-bomb or even see your real kolu.",
	"parents": ["analysis"],
	"status": "proposed",
	"maturity": "budding",
	"updated": "2026-07-21T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "lock-1--a-dev-process-cant-use-productions-folder",
			"text": "Lock 1 — a dev process can’t use production’s folder"
		},
		{
			"depth": 2,
			"slug": "lock-3--tests-cant-fork-bomb-the-box-and-cant-see-real-daemons",
			"text": "Lock 3 — tests can’t fork-bomb the box, and can’t see real daemons"
		},
		{
			"depth": 2,
			"slug": "the-three-ways-of-running-kolu--and-which-identity-each-gets",
			"text": "The three ways of running kolu — and which identity each gets"
		},
		{
			"depth": 3,
			"slug": "nix-run-githubjuspaykolu--the-production-front-door",
			"text": "nix run github:juspay/kolu — the production front door"
		},
		{
			"depth": 3,
			"slug": "the-home-manager-module--the-same-door-supervised",
			"text": "The home-manager module — the same door, supervised"
		},
		{
			"depth": 3,
			"slug": "just-dev--a-private-universe-per-worktree",
			"text": "just dev — a private universe per worktree"
		},
		{
			"depth": 2,
			"slug": "what-you-feel-afterwards-lock-3-today-lock-1-once-its-rebuild-lands",
			"text": "What you feel afterwards (Lock 3 today; Lock 1 once its rebuild lands)"
		}
	];
}
var url = "src/content/atlas/host-isolation-locks.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/host-isolation-locks.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/host-isolation-locks.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
