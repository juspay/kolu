import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$Footnote } from "./Footnote_D9yrIxmz.mjs";
//#region src/content/atlas/session-timer-unref.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
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
			"The ",
			createVNode(_components.a, {
				href: "surface-lifetime-audit.html",
				children: "surface lifetime audit"
			}),
			" confirmed (weakened)\nthat ",
			createVNode(_components.code, { children: "makeSession" }),
			" “promises a hold for the parent’s lifetime but binds to\nnothing”: an ",
			createVNode(_components.strong, { children: "abandoned" }),
			" session — one whose consumer dropped every reference\nwithout ",
			createVNode(_components.code, { children: "destroy()" }),
			", or whose useful work is done — keeps redialing forever,\nand its ref’d reconnect timer ",
			createVNode(_components.strong, { children: "pins the Node event loop" }),
			", so a host process\nthat reaches the end of its main script never exits. The codebase already\nknows this hazard defensively: ",
			createVNode(_components.code, { children: "dialAgentOnce.ts" }),
			" must ",
			createVNode(_components.code, { children: "destroy()" }),
			" the session\non every pre-",
			createVNode(_components.code, { children: "Connection" }),
			" failure precisely because “its ref-counted reconnect\nloop/watchdog timer leaks for any caller that catches the rejection.” The fix\nis not a blanket ",
			createVNode(_components.code, { children: "unref()" }),
			" — one timer in this file exists to settle a\ncaller’s promise and may ",
			createVNode(_components.strong, { children: "not" }),
			" be unref’d away. This note is the per-timer\ncensus with the verdict and argument for each. Implemented in\n",
			createVNode($$PrLink, { pr: 1873 }),
			"."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-census--every-timer-in-packagessurface-remotesrc-at-head",
			children: [
				"The census — every timer in ",
				createVNode(_components.code, { children: "packages/surface-remote/src" }),
				", at HEAD"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"All non-test timers in the package live in ",
			createVNode(_components.code, { children: "session.ts" }),
			". ",
			createVNode(_components.code, { children: "controlMaster.ts" }),
			"\nhas none (its ",
			createVNode(_components.code, { children: "ControlPersist=10m" }),
			" is ssh’s own lifecycle, outside Node’s\nloop), and the connectors (",
			createVNode(_components.code, { children: "sshConnector" }),
			"/",
			createVNode(_components.code, { children: "dialAgentOnce" }),
			") arm none — their\nchildren are event-loop holds, but bounded ones (ssh’s ",
			createVNode(_components.code, { children: "ConnectTimeout" }),
			" /\n",
			createVNode(_components.code, { children: "ServerAlive" }),
			" opts, ~30s), so an in-flight dial can only ",
			createVNode(_components.em, { children: "delay" }),
			" exit, never\nprevent it.",
			createVNode($$Footnote, { children: [
				"Grounded by grep over ",
				createVNode(_components.code, { children: "packages/surface-remote/src" }),
				"\n(non-test): ",
				createVNode(_components.code, { children: "setTimeout" }),
				"/",
				createVNode(_components.code, { children: "setInterval" }),
				" occur only in ",
				createVNode(_components.code, { children: "session.ts" }),
				"; ",
				createVNode(_components.code, { children: ".unref(" }),
				"\noccurs nowhere. The one ",
				createVNode(_components.code, { children: "setImmediate" }),
				" (",
				createVNode(_components.code, { children: "dialAgentOnce.ts" }),
				") holds the loop for\na single turn."
			] })
		] }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Timer" }),
					"\n",
					createVNode(_components.th, { children: "Armed when" }),
					"\n",
					createVNode(_components.th, { children: "Holds the loop today" }),
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
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "pendingTimer" }),
						" — reconnect backoff (",
						createVNode(_components.code, { children: "scheduleReconnect" }),
						" → ",
						createVNode(_components.code, { children: "armTimer" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"after every failed dial / link death; ≤60s each, re-armed on a retrying ",
						createVNode(_components.code, { children: "\"network\"" }),
						" cause (a budget-exhausted silent step instead takes the give-up branch and arms NO timer, #1908)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "YES — the immortalizer." }),
						" Between dials it is often the ",
						createVNode(_components.em, { children: "sole" }),
						" handle; an abandoned pinned session re-arms it eternally"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "unref" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "pendingTimer" }),
						" — connect watchdog (",
						createVNode(_components.code, { children: "attempt" }),
						", non-admit path, same slot)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"transport up, awaiting first RPC; ≤",
						createVNode(_components.code, { children: "connectTimeoutMs" }),
						" (30s), fires once"
					] }),
					"\n",
					createVNode(_components.td, { children: "transiently; while it’s armed the live transport (ssh child / socket) usually holds the loop anyway" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "unref" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "clockProbeTimer" }), " — clock-offset retry cadence"] }),
					"\n",
					createVNode(_components.td, { children: [
						"after a genuine ",
						createVNode(_components.code, { children: "system.clockNow" }),
						" probe failure while ",
						createVNode(_components.code, { children: "connected" }),
						"; 10s, repeating"
					] }),
					"\n",
					createVNode(_components.td, { children: "yes while armed" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "unref" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "clockProbeDeadlineTimer" }), " — in-flight clock-probe deadline"] }),
					"\n",
					createVNode(_components.td, { children: "while a clock probe RPC is in flight; ≤8s, self-clearing" }),
					"\n",
					createVNode(_components.td, { children: "yes while in flight (bounded)" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "unref" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "withHandshakeTimeout" }), "’s timer — admit-handshake bound"] }),
					"\n",
					createVNode(_components.td, { children: [
						"admit path, while ",
						createVNode(_components.code, { children: "admit(client)" }),
						"’s hello is in flight; ≤",
						createVNode(_components.code, { children: "connectTimeoutMs" }),
						", self-clearing"
					] }),
					"\n",
					createVNode(_components.td, { children: "yes while in flight (bounded)" }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "MUST FIRE — keep ref’d" }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"liveness heartbeat (",
						createVNode(_components.code, { children: "createHeartbeat" }),
						", ",
						createVNode(_components.code, { children: "@kolu/surface" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: "born at first connect, session-scoped" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "no" }),
						" — already ",
						createVNode(_components.code, { children: "unref()" }),
						"s both its interval and its probe timer"
					] }),
					"\n",
					createVNode(_components.td, { children: "already correct; census row only" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-verdict-line--internal-effect-vs-caller-promised-settle",
			children: "The verdict line — internal effect vs. caller-promised settle"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The honest test for each timer is ",
			createVNode(_components.em, { children: "who its firing serves" }),
			":"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Unref the four whose effect is internal — owning one named semantics\nchange." }),
				" The backoff redial, the connect watchdog’s teardown, and both\nclock-probe timers drive session-internal state (a redial, a force-cycle, a\nframe re-stamp). An ",
				createVNode(_components.code, { children: "unref()" }),
				"’d timer still fires normally whenever anything\nelse holds the loop — a server socket, stdin, a live transport — so a\n",
				createVNode(_components.strong, { children: "held" }),
				" session in a living process reconnects exactly as before; only a\nsession that is the ",
				createVNode(_components.em, { children: "last thing standing" }),
				" stops keeping the corpse warm.\nThe backoff timer’s own fire-guard already concedes this: it returns without\nredialing when ",
				createVNode(_components.code, { children: "refCount === 0" }),
				". But “internal effect” is not the whole\ntruth for the backoff: ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "ClientCursor.next()" }) }),
				" (",
				createVNode(_components.code, { children: "waitForNextClient.ts" }),
				", an\nexported wait ",
				createVNode(_components.code, { children: "hostFanout" }),
				"’s pump parks on) is settled across a reconnect\ngap ",
				createVNode(_components.em, { children: "only by the backoff firing" }),
				" — its own comment says so — which is a\ncaller-visible settle by derivation. The backoff’s unref is therefore\njustified not because nothing awaits it, but because the class of things\nthat await it — onState-derived cursor waits — are ",
				createVNode(_components.strong, { children: "pump loops" }),
				" whose\nprocesses hold the loop by other means (every grounded cursor consumer runs\ninside a server process), and a pump whose process has ",
				createVNode(_components.em, { children: "nothing else left" }),
				"\nis precisely the abandoned shape this fix targets: it ",
				createVNode(_components.strong, { children: "should" }),
				" die with\nits process. This is a deliberate, documented semantics change — a parked\n",
				createVNode(_components.code, { children: "cursor.next()" }),
				" is not a process hold — stated in the Reference lifetime\ncontract, never silent."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "withHandshakeTimeout" }), " may not be unref’d."] }),
				" Its firing rejects a promise\nthat ",
				createVNode(_components.code, { children: "attempt()" }),
				" → ",
				createVNode(_components.code, { children: "clientPromise" }),
				" → ",
				createVNode(_components.code, { children: "pin()" }),
				" propagates to an ",
				createVNode(_components.strong, { children: "awaiting\ncaller" }),
				" — and a pending ",
				createVNode(_components.code, { children: "await" }),
				" holds no event-loop handle, so if this\ntimer were unref’d and happened to be the last handle, the process would\nexit ",
				createVNode(_components.em, { children: "silently mid-await" }),
				" instead of delivering the timeout rejection the\nAPI promised. This is exactly the brief’s “pending op’s timeout that\nsettles a caller’s promise” class. It cannot immortalize anything: it is\nbounded (≤30s), self-clearing, armed at most once per dial — and the moment\nit fires, the next hold is the ",
				createVNode(_components.em, { children: "unref’d" }),
				" backoff, which is the process’s\nexit window."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"One deliberate asymmetry, stated so the lens gate can weigh it: the connect\nwatchdog (unref) and the handshake timeout (ref’d) look like twins, but they\ndiffer on the verdict line — by the time the watchdog ",
			createVNode(_components.strong, { children: "fires" }),
			", ",
			createVNode(_components.code, { children: "attempt()" }),
			"\nhas already ",
			createVNode(_components.strong, { children: "returned" }),
			" the client (they arm in the same tick, ",
			createVNode(_components.code, { children: "attempt" }),
			"’s\ntail; ",
			createVNode(_components.code, { children: "pin()" }),
			" is settled, so the watchdog’s firing is observable only via\n",
			createVNode(_components.code, { children: "onState" }),
			"), whereas the handshake timeout fires while ",
			createVNode(_components.code, { children: "pin()" }),
			" is still\n",
			createVNode(_components.strong, { children: "pending" }),
			" — it can, and must, reject a pending ",
			createVNode(_components.code, { children: "pin()" }),
			". Settling a caller’s\nparked continuation is a guaranteed effect; a passive state transition is not."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Exit safety when an unref’d backoff ",
			createVNode(_components.em, { children: "does" }),
			" fire rests on one invariant, stated\nhere so a refactor can’t silently break it: the dial chain reaches the\ntransport’s first event-loop handle without parking on a handle-free await —\n",
			createVNode(_components.code, { children: "launchAttempt" }),
			" → ",
			createVNode(_components.code, { children: "attempt" }),
			" → ",
			createVNode(_components.code, { children: "connectOnce" }),
			" runs microtask-chained to its\nfirst child spawn, and a caller-supplied resolve step that does real work (a\nnix-instantiate child, fs I/O) holds its own handle. A future async-dial\nrefactor that parks on a bare promise between the timer firing and the first\nspawn would reopen a silent mid-dial exit window for a held session."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "pins-red-first",
			children: "Pins (red-first)"
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The immortalization red." }),
				" A real child process (",
				createVNode(_components.code, { children: "node --import" }),
				"\ntsx-loader, the ",
				createVNode(_components.code, { children: "kaval" }),
				" ",
				createVNode(_components.code, { children: "socketDaemon.test.ts" }),
				" precedent — vitest itself\nholds the loop, so this cannot be pinned in-process) creates a session over\na never-connecting connector, ",
				createVNode(_components.code, { children: "pin()" }),
				"s it, drops every reference without\n",
				createVNode(_components.code, { children: "destroy()" }),
				", and lets its main script end. Today: the child hangs on the\nbackoff timer (test times it out → red). After: exits cleanly, bounded."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Guarantee preservation." }),
				" (a) The existing suite — reconnect, recheck,\nliveness, clock-probe, admit-timeout tests — stays green unchanged: the\nrunner holds the loop, so every unref’d timer still fires. (b) The\nmust-fire pin: a child process whose ",
				createVNode(_components.code, { children: "pin()" }),
				" awaits an admit hello that\nnever settles still ",
				createVNode(_components.em, { children: "receives the timeout rejection" }),
				" (prints the delivered\nmarker, having lived at least the timeout, then exits ",
				createVNode(_components.code, { children: "0" }),
				" naturally through\nthe unref’d-backoff exit window — that clean exit is itself part of the\npin) rather than exiting silently at 0ms — proving the handshake timer\nstayed ref’d even as the sole handle."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"Existing surface-remote suite green (the fake-timer tests exercise\n",
				createVNode(_components.code, { children: ".unref()" }),
				" on sinon fake timers, which support it; verified at build)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "shape-of-the-change",
			children: "Shape of the change"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"One PR. One ",
			createVNode(_components.code, { children: ".unref()" }),
			" call site in ",
			createVNode(_components.code, { children: "session.ts" }),
			" — inside ",
			createVNode(_components.code, { children: "armInternalTimer" }),
			",\nthe file-local seam (a lens-gauntlet refinement of the original three-direct-\ncalls shape) that all three internal-timer arms route through (",
			createVNode(_components.code, { children: "armTimer" }),
			", the\n",
			createVNode(_components.code, { children: "clockProbeTimer" }),
			" arm, the ",
			createVNode(_components.code, { children: "clockProbeDeadlineTimer" }),
			" arm), leaving\n",
			createVNode(_components.code, { children: "withHandshakeTimeout" }),
			"’s must-fire timer as the file’s only bare ref’d\n",
			createVNode(_components.code, { children: "setTimeout" }),
			" — a census pinned ",
			createVNode(_components.em, { children: "structurally" }),
			" by a source-level test (exactly\ntwo bare ",
			createVNode(_components.code, { children: "setTimeout(" }),
			" sites in the file). The seam is direct Node ",
			createVNode(_components.code, { children: ".unref()" }),
			",\nno browser guard: the package is Node-only (",
			createVNode(_components.code, { children: "tsconfig" }),
			" ",
			createVNode(_components.code, { children: "types: [\"node\"]" }),
			", it\nspawns ssh children); the browser-safe ",
			createVNode(_components.code, { children: "unrefTimer" }),
			" dance in ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			"’s\nheartbeat exists because ",
			createVNode(_components.em, { children: "that" }),
			" package is shared with the browser leg, which\nthis one is not (and widening that helper into an export would compel a\ndrishti PR for six lines — the ",
			createVNode(_components.code, { children: "controlMaster.ts" }),
			" precedent declines the same\ntrade). Plus a\n",
			createVNode(_components.code, { children: "tsx" }),
			" devDependency in ",
			createVNode(_components.code, { children: "surface-remote" }),
			" for the child-process pins — a\nlinks-only lockfile delta (",
			createVNode(_components.code, { children: "tsx@4.21.0" }),
			" was already fetched for other\nworkspace packages), so the pinned ",
			createVNode(_components.code, { children: "fetchPnpmDeps" }),
			" hash needed ",
			createVNode(_components.strong, { children: "no" }),
			" refresh\n(verified by a green ",
			createVNode(_components.code, { children: "nix build" }),
			" against the changed lockfile) — doc sync\n(",
			createVNode(_components.code, { children: "ref-surface-remote.mdx" }),
			" lifetime contract + changelog), and the audit note’s\n",
			createVNode(_components.code, { children: "makeSession" }),
			" row flipped to point here."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "consumer-gate-grounded-at-their-pins",
			children: "Consumer gate (grounded at their pins)"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "drishti" }),
				" (grepped at master ",
				createVNode(_components.code, { children: "f3609d0" }),
				" and the pending pair tip\n",
				createVNode(_components.code, { children: "7e358fd" }),
				", same shape at both): ",
				createVNode(_components.code, { children: "makeSession" }),
				" lives in\n",
				createVNode(_components.code, { children: "packages/app/src/server/hostRegistry.ts" }),
				" — a warm host pool inside the app\nserver, whose HTTP/socket listeners hold the loop; its ",
				createVNode(_components.code, { children: "hostFanout" }),
				"-style\npumps park on cursor waits ",
				createVNode(_components.em, { children: "inside that held process" }),
				". No dependence on\nsession timers as process holds; no API delta (signatures unchanged).\nVerdict: ",
				createVNode(_components.strong, { children: "no behavioral impact — no drishti pair PR needed" }),
				" (final call\nre-checked at final HEAD per the surface rule)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "odu" }),
				" (grepped at master ",
				createVNode(_components.code, { children: "914c388" }),
				" and the pending pin-bump tip\n",
				createVNode(_components.code, { children: "647d348" }),
				", same shape at both): ",
				createVNode(_components.code, { children: "makeSession" }),
				" in ",
				createVNode(_components.code, { children: "src/coordinator/lane.ts" }),
				",\nwhich already ",
				createVNode(_components.code, { children: "unref?.()" }),
				"s its ",
				createVNode(_components.em, { children: "own" }),
				" lane deadline — the coordinator\ndeliberately refuses to let lane timers hold it alive, and it bounds connect\nattempts itself (",
				createVNode(_components.code, { children: "MAX_CONNECT_ATTEMPTS" }),
				" → lane death), never relying on\neternal session backoff. Verdict: ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "none" }) }),
				" for the odu ledger (this\nchange aligns the session with odu’s own posture)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "kaval-tui / padi-tui" }),
				" (this repo, one-shot CLIs): both dial through\n",
				createVNode(_components.code, { children: "dialAgentOnce" }),
				" (",
				createVNode(_components.code, { children: "hostConnect.ts" }),
				" in each), which ",
				createVNode(_components.code, { children: "pin()" }),
				"s once, ",
				createVNode(_components.code, { children: "destroy()" }),
				"s\nthe session on every pre-",
				createVNode(_components.code, { children: "Connection" }),
				" failure, and never parks on a cursor\nwait — a live dial’s ssh child holds the loop; a failed dial is destroyed\nbefore the CLI exits. Verdict: ",
				createVNode(_components.strong, { children: "no behavioral impact" }),
				" (and the\ndefensively-documented leak ",
				createVNode(_components.code, { children: "dialAgentOnce" }),
				" guards against is exactly what\nthis change retires)."
			] }),
			"\n"
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Session timers must not immortalize the host process",
	"description": "Per-timer census of makeSession's un-unref'd timers with honest unref-vs-must-fire verdicts — an abandoned session must let its host process exit; timers that settle a caller's promise stay ref'd.",
	"parents": ["bug", "surface-lifetime-audit"],
	"status": "implemented",
	"maturity": "seedling",
	"updated": "2026-07-16T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-census--every-timer-in-packagessurface-remotesrc-at-head",
			"text": "The census — every timer in packages/surface-remote/src, at HEAD"
		},
		{
			"depth": 2,
			"slug": "the-verdict-line--internal-effect-vs-caller-promised-settle",
			"text": "The verdict line — internal effect vs. caller-promised settle"
		},
		{
			"depth": 2,
			"slug": "pins-red-first",
			"text": "Pins (red-first)"
		},
		{
			"depth": 2,
			"slug": "shape-of-the-change",
			"text": "Shape of the change"
		},
		{
			"depth": 2,
			"slug": "consumer-gate-grounded-at-their-pins",
			"text": "Consumer gate (grounded at their pins)"
		}
	];
}
var url = "src/content/atlas/session-timer-unref.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/session-timer-unref.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/session-timer-unref.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
