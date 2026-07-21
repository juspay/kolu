import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
import { t as $$Issue } from "./Issue_mLFqCJSR.mjs";
//#region src/content/atlas/ghostex-vs-remote-terminals.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		hr: "hr",
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
				"What Ghostex’s PTY-persistence choice does and doesn’t teach the in-progress kolu plan (",
				createVNode(_components.a, {
					href: "remote-terminals.html",
					children: "remote-terminals"
				}),
				" + ",
				createVNode(_components.a, {
					href: "pty-daemon.html",
					children: "pty-daemon"
				}),
				" — read as ",
				createVNode(_components.code, { children: "docs/plans" }),
				" HTML at the time, since migrated to those Atlas notes). Sources read this turn: ",
				createVNode(_components.code, { children: "/tmp/Ghostex" }),
				" @ HEAD and both kolu plan docs."
			] }),
			" ",
			createVNode($$Pill, {
				variant: "new",
				children: "/lowy + /hickey folded in"
			}),
			" — my first three recommendations were largely ",
			createVNode(_components.em, { children: "wrong" }),
			"; this is the post-review version, and the headline below says what I retracted."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Headline",
			children: createVNode(_components.p, { children: [
				"Ghostex makes the opposite bet to kolu: it ",
				createVNode(_components.strong, { children: "never owns PTY lifetime in the app" }),
				" — an external multiplexer (forked zmx, default) owns it, the native pane is a pure attach/detach projection, and remote access is the ",
				createVNode(_components.em, { children: "same" }),
				" mux session reached over SSH. That genuinely dissolves kolu’s whole ",
				createVNode(_components.code, { children: "#1034" }),
				" restart-hazard class. ",
				createVNode(_components.strong, { children: ["But it does not argue kolu should stop building ", createVNode(_components.code, { children: "kaval" })] }),
				" (the daemon, renamed from ",
				createVNode(_components.code, { children: "@kolu/pty-host" }),
				" in R2.2) — Ghostex had to ",
				createVNode(_components.em, { children: "fork" }),
				" zmx to get the metadata IPC it needed, so it now owns a whole mux codebase ",
				createVNode(_components.em, { children: "plus" }),
				" a user-session model kolu doesn’t want. For kolu’s typed-metadata + zero-provider-survivor requirements, greenfield is ",
				createVNode(_components.em, { children: "less" }),
				" total scope, not more. The real, durable gift from Ghostex is narrower and concrete: its ",
				createVNode(_components.strong, { children: "honest-state vocabulary" }),
				" (pane-state ⟂ session-state), which is exactly the model kolu’s R2 phase needs to never repeat the empty-canvas lie — and which Ghostex reached independently, corroborating kolu’s reattach-by-id as a natural decomposition."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "what-ghostex-is-the-relevant-parts",
			children: "What Ghostex is (the relevant parts)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A native macOS app: web sidebar in a ",
			createVNode(_components.code, { children: "WKWebView" }),
			", every terminal a real embedded ",
			createVNode(_components.strong, { children: ["Ghostty ", createVNode(_components.code, { children: "SurfaceView" })] }),
			" (Metal), not xterm.js. The native host owns PTY creation for live panes; node-pty is explicitly slated for removal once Ghostty owns all PTYs. ",
			createVNode(_components.em, { children: "(docs/native-ghostty-handover.md “Code To Remove”, shared/terminal-host-protocol.ts:1-6.)" })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Persistence is a ",
			createVNode(_components.strong, { children: "pluggable provider" }),
			", decoupled from the app process entirely:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "SessionPersistenceProvider = \"off\" | \"tmux\" | \"zmx\" | \"zellij\"" }),
				", default ",
				createVNode(_components.code, { children: "zmx" }),
				". ",
				createVNode(_components.em, { children: "(shared/ghostex-settings.ts:53, :456.)" })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"The mux owns the PTY. A native pane can be ",
				createVNode(_components.em, { children: "unmounted while the provider session still exists" }),
				" — that orthogonality is a first-class part of the state model (see below). ",
				createVNode(_components.em, { children: "(shared/session-grid-contract-sidebar.ts:188-203.)" })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				"They ",
				createVNode(_components.strong, { children: "forked zmx" }),
				" as a pinned submodule because “native zmx pane refresh depends on a first-party zmx IPC protocol that older PATH installs do not implement” — i.e. stock mux couldn’t give them repaint / metadata / full-replay. ",
				createVNode(_components.em, { children: "(.gitmodules (zmx).)" })
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Remote = persistence, same mechanism." }),
			" Android/iOS/TUI connect to the Mac over SSH and ",
			createVNode(_components.em, { children: "attach to the very same named mux session" }),
			" that provides local survival; the phone asks the Mac-side ",
			createVNode(_components.code, { children: "ghostex" }),
			" CLI for session inventory + attach commands. First Android release is “ZMX only,” with a warm pool of recently-tapped sessions and an app-owned SSHJ transport. ",
			createVNode(_components.em, { children: "(docs/android-handover.md “Current State”; AllFeatures.md:77, :186.)" })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-architectural-contrast",
			children: "The architectural contrast"
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
					createVNode(_components.th, { children: createVNode(_components.strong, { children: "Ghostex" }) }),
					"\n",
					createVNode(_components.th, { children: createVNode(_components.strong, { children: "kolu (planned)" }) }),
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
					createVNode(_components.td, { children: "External mux (forked zmx / tmux / zellij). App is a pure attach/detach client." }),
					"\n",
					createVNode(_components.td, { children: [
						"First-party ",
						createVNode(_components.code, { children: "kaval" }),
						" daemon the app spawns and supervises (own cgroup, survives ",
						createVNode(_components.code, { children: "systemctl restart" }),
						")."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Survive app/server restart" }),
					"\n",
					createVNode(_components.td, { children: "Free — the app never owned the PTY, so a restart is never a daemon restart. No hazard." }),
					"\n",
					createVNode(_components.td, { children: [
						"Engineered — pid-gate, cgroup-escape, reattach-by-id, recovery sequence. The ",
						createVNode(_components.code, { children: "#1034" }),
						" hazard class lives ",
						createVNode(_components.em, { children: "here" }),
						"."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Metadata / repaint / replay IPC" }),
					"\n",
					createVNode(_components.td, { children: [
						"Custom — required ",
						createVNode(_components.strong, { children: "forking zmx" }),
						" to add it. Now owns mux source + IPC + a user-session model."
					] }),
					"\n",
					createVNode(_components.td, { children: "Custom — typed oRPC surface + build-time staleness hash + a provider DAG that runs fresh in kolu-server off the daemon’s stream. Owns only a headless PTY." }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Local-survival vs remote-reach" }),
					"\n",
					createVNode(_components.td, { children: [
						"One primitive: a ",
						createVNode(_components.strong, { children: "named durable session" }),
						". Remote = ",
						createVNode(_components.code, { children: "ssh mac → attach <name>" }),
						". (Still two transports underneath: zmx + SSH.)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"One ",
						createVNode(_components.code, { children: "TerminalEndpoint" }),
						" interface (was ",
						createVNode(_components.code, { children: "TerminalBackend" }),
						", renamed in #1364) behind one stable unix socket. ",
						createVNode(_components.em, { children: [
							"(The original “two implementations — loopback now, ssh in R3” prediction was superseded: there is no ",
							createVNode(_components.code, { children: "RemoteTerminalEndpoint" }),
							"; a single ",
							createVNode(_components.code, { children: "TerminalEndpoint" }),
							" is bound to whichever endpoint is dialed — see ",
							createVNode(_components.a, {
								href: "remote-terminals.html",
								children: "remote-terminals"
							}),
							" R3 / ",
							createVNode(_components.a, {
								href: "kaval-sessions.html",
								children: "kaval-sessions"
							}),
							".)"
						] })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Terminal renderer" }),
					"\n",
					createVNode(_components.td, { children: "Native Ghostty/Metal. No web terminal." }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "@xterm/headless" }), " mirror in the daemon + xterm in the client."] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Honest liveness state" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "nativePaneState" }),
						" (mounted/unmounted) ⟂ ",
						createVNode(_components.code, { children: "providerSessionState" }),
						" (exists/missing/persistence-disabled/unknown), derived ",
						createVNode(_components.code, { children: "isLive" }),
						". ",
						createVNode(_components.em, { children: "(docs/terminology.md)" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Being built into B (status chip, degraded canvas) — the lesson ",
						createVNode(_components.code, { children: "#1034" }),
						" paid for."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-survives-review--the-actual-influence",
			children: "What survives review — the actual influence"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "1 · Borrow Ghostex's honest-state vocabulary verbatim — keep",
			children: [createVNode(_components.p, { children: [
				"Ghostex’s split — ",
				createVNode(_components.code, { children: "nativePaneState" }),
				" orthogonal to ",
				createVNode(_components.code, { children: "providerSessionState" }),
				", with an explicit ",
				createVNode(_components.code, { children: "persistence-disabled" }),
				" value ",
				createVNode(_components.em, { children: "distinct" }),
				" from ",
				createVNode(_components.code, { children: "unknown" }),
				" (off ≠ probe-not-done) — is precisely the model that makes “no pane mounted” un-confusable with “no session.” That is the exact confusion that rendered kolu’s empty canvas during #1034. kolu’s B-phase ",
				createVNode(_components.code, { children: "DaemonStatus" }),
				" + ",
				createVNode(_components.code, { children: "DegradedCanvas" }),
				" should adopt this two-axis shape and the off-vs-unknown distinction directly. ",
				createVNode(_components.em, { children: [
					"(Ghostex session-grid-contract-sidebar.ts:202-204; kolu ",
					createVNode(_components.a, {
						href: "pty-daemon.html",
						children: "pty-daemon"
					}),
					" hard constraint #4.)"
				] })
			] }), createVNode(_components.p, { children: [
				createVNode(_components.em, { children: "And it corroborates kolu’s deepest bet." }),
				" Ghostex independently reached “the pane is a projection of a separately-owned durable session” — the same two-identity decomposition kolu calls its proven-right core (reattach-by-id collapsing pane-id and session-id). Independent convergence shows the cut is ",
				createVNode(_components.em, { children: "reachable from first principles" }),
				" — not that it’s provably correct (two teams can converge on the same mistake), but it’s real evidence the seam is natural."
			] })]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "2 · The remote/local convergence is agreement, not a course-correction — keep",
			children: createVNode(_components.p, { children: [
				"Both systems end at the same layer: ",
				createVNode(_components.em, { children: "attach to a durable named session over some transport." }),
				" Ghostex’s unifying primitive is the named mux session; kolu’s is the ",
				createVNode(_components.code, { children: "TerminalEndpoint" }),
				" interface (was ",
				createVNode(_components.code, { children: "TerminalBackend" }),
				") with a stable unix socket beneath it (loopback today, ssh tomorrow). These are the same idea under two names. kolu’s plan claim that local-survival and remote-reach are “different volatility axes” is ",
				createVNode(_components.em, { children: "correct" }),
				" — they change for different reasons (survival = pid/cgroup strategy; remote = transport/auth/reconnect) — but they share ",
				createVNode(_components.strong, { children: "one stable interface" }),
				" (the socket / the endpoint), which is exactly Ghostex’s named-session primitive. No change needed; Ghostex is a second data point that the interface boundary sits at the right layer."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "3 · #1034 is a self-inflicted hazard — but it's a lifecycle bug in a sound seam, not a misplaced seam — reframe",
			children: createVNode(_components.p, { children: [
				"My first draft said: the whole #1034 family (restart-loss, single-instance race, empty-canvas, cgroup-escape) exists ",
				createVNode(_components.em, { children: "only" }),
				" because kolu coupled PTY-ownership to the deployable, and Ghostex’s clean cut proves the seam is misplaced. ",
				createVNode(_components.strong, { children: "Lowy corrected this." }),
				" You can’t infer “wrong seam” from “buggy implementation of the right seam.” #1034 was a ",
				createVNode(_components.em, { children: "lifecycle-handshake" }),
				" bug — the respawn raced the old daemon’s pid-file release — inside a seam (cgroup + ",
				createVNode(_components.code, { children: "O_EXCL" }),
				" pid-gate) that is itself sound and is engineered precisely to decouple PTY lifetime from the restart boundary. Ghostex doesn’t avoid the bug by drawing the seam better; it avoids the ",
				createVNode(_components.em, { children: "entire hazard class" }),
				" by not owning PTY lifetime at all — which is a different product with an external dependency and a user-facing session model. The honest read: the hazard is real and is the price of ownership; kolu’s B-phase recovery mechanism (snapshot-before-kill, ",
				createVNode(_components.code, { children: "waitForPidGone" }),
				", honest degraded state) is what buys it down, and that is the right response — not redrawing the seam."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "danger",
			title: "4 · RETRACTED: 'wrap/fork a proven mux instead of building from scratch' — drop",
			children: [
				createVNode(_components.p, { children: ["My instinct was: Ghostex kept the battle-tested detach/single-instance/reattach core (forked zmx) and only added IPC, so kolu rebuilding that core is wasteful concept-multiplication. ", createVNode(_components.strong, { children: "Both reviewers killed this, and the kill is convincing:" })] }),
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "It’s not the same concept." }),
						" A mux (zmx/tmux) is a user-facing tool: session names, attach/detach CLI, window/pane semantics, its own lifecycle. ",
						createVNode(_components.code, { children: "kaval" }),
						" owns ",
						createVNode(_components.em, { children: "only" }),
						" the PTY — headless, no session model, no user commands. They share exactly one property (PTY outlives the app). “Rebuilding a mux” only sounds wasteful if you smuggle in zmx’s whole session model under the word “mux.” ",
						createVNode(_components.em, { children: "(Hickey)" })
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: [
							"The fork is evidence ",
							createVNode(_components.em, { children: "against" }),
							" reuse, not for it."
						] }),
						" Ghostex couldn’t consume stock zmx — it forked. So the “free detach core” isn’t free; reuse means owning the mux codebase ",
						createVNode(_components.em, { children: "plus" }),
						" a user-session model kolu doesn’t need ",
						createVNode(_components.em, { children: "plus" }),
						" the IPC on top. For kolu’s actual requirements that is ",
						createVNode(_components.em, { children: "more" }),
						" scope, not less. ",
						createVNode(_components.em, { children: "(both)" })
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode(_components.strong, { children: "It would complect the seam it claims to clean." }),
						" kolu’s value is a typed oRPC metadata contract with a build-enforced staleness key. Importing a mux’s wire/IPC format would braid that typed surface into zmx/zellij’s format — trading a lifecycle bug for a worse, permanent coupling. ",
						createVNode(_components.em, { children: "(Lowy)" })
					] }),
					"\n"
				] }),
				createVNode(_components.p, { children: [
					"So: ",
					createVNode(_components.strong, { children: [
						"keep building ",
						createVNode(_components.code, { children: "kaval" }),
						"."
					] }),
					" Ghostex is not a reason to reconsider that."
				] })
			]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "danger",
			title: "5 · RETRACTED: 'persistence-as-pluggable-provider is an architecture seam kolu is missing' — drop",
			children: createVNode(_components.p, { children: [
				"Ghostex’s ",
				createVNode(_components.code, { children: "off|tmux|zmx|zellij" }),
				" dropdown is a genuine product axis ",
				createVNode(_components.em, { children: "for Ghostex" }),
				" (it lets a user keep their existing tmux). But for kolu it’s a ",
				createVNode(_components.strong, { children: "sizing/scope question, not a missing seam" }),
				" — and the mechanism it would make pluggable (tmux/zmx) is precisely what kolu’s daemon exists to ",
				createVNode(_components.em, { children: "replace" }),
				" (",
				createVNode($$Issue, { n: 671 }),
				"). Dressing a product-scope option as an architectural gap is exactly the move to avoid. Worth one product sentence — “do we ever want a ‘use my existing tmux’ escape hatch?” — and almost certainly the answer is no."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "two-reasoning-errors-i-made-so-the-next-pass-doesnt",
			children: "Two reasoning errors I made (so the next pass doesn’t)"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "State-model ⟂ transport-architecture." }),
				" I used Ghostex’s two-field liveness model (a state-decomposition fact) as evidence about how many transports kolu should have (a transport-architecture claim). Non-sequitur — a system can have the exact two-field model with one transport or two. The honest-state borrow (#1) and the transport-convergence note (#2) are ",
				createVNode(_components.em, { children: "independent" }),
				" claims with independent evidence. ",
				createVNode(_components.em, { children: "(Hickey)" })
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "“Convergence validates it” is an easiness claim, not a simplicity one." }),
				" Two teams reaching the same decomposition shows it’s ",
				createVNode(_components.em, { children: "reachable/natural" }),
				", not that it’s ",
				createVNode(_components.em, { children: "correct" }),
				". I’ve reworded #1 accordingly. ",
				createVNode(_components.em, { children: "(Hickey)" })
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: "Net: the influence is one concrete borrow (Ghostex’s honest pane⟂session state vocabulary into kolu’s B-phase), one corroboration (reattach-by-id is a natural cut), and one reframe (#1034 is a lifecycle bug to pay down, not a seam to redraw). The tempting big swing — “lean on a mux instead of building the daemon” — does not survive a volatility/simplicity pass: Ghostex’s own zmx fork is the counter-evidence." }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Ghostex vs. kolu remote-terminals",
	"description": "What Ghostex's PTY-persistence choice does and doesn't teach kolu's in-progress remote-terminals plan — one concrete borrow (honest pane⟂session state), one corroboration, one reframe; the \"lean on a mux\" swing doesn't survive review.",
	"parents": ["comparison", "remote-terminals"],
	"maturity": "budding",
	"updated": "2026-06-19T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-ghostex-is-the-relevant-parts",
			"text": "What Ghostex is (the relevant parts)"
		},
		{
			"depth": 2,
			"slug": "the-architectural-contrast",
			"text": "The architectural contrast"
		},
		{
			"depth": 2,
			"slug": "what-survives-review--the-actual-influence",
			"text": "What survives review — the actual influence"
		},
		{
			"depth": 2,
			"slug": "two-reasoning-errors-i-made-so-the-next-pass-doesnt",
			"text": "Two reasoning errors I made (so the next pass doesn’t)"
		}
	];
}
var url = "src/content/atlas/ghostex-vs-remote-terminals.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/ghostex-vs-remote-terminals.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/ghostex-vs-remote-terminals.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
