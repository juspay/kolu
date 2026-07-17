import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
//#region src/content/atlas/remote-terminals-future.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		del: "del",
		em: "em",
		h2: "h2",
		li: "li",
		p: "p",
		strong: "strong",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "What this note is." }),
			" ",
			createVNode(_components.a, {
				href: "padi.html",
				children: "The switch (W4)"
			}),
			" makes kolu multi-host. This note is the researched answer to “what next?” — built from two ground-up passes, not memory: an inventory of every shipped primitive (the ",
			createVNode(_components.a, {
				href: "surface-hosting-101.html",
				children: "hosting-side final API"
			}),
			") and already-named future item in this repo, and a source-grounded survey of what tmux/mosh/Eternal Terminal/Zellij/VS Code Remote/Coder/Gitpod/Tailscale/Warp/tmate/Blink/Wave actually prove users want. Each candidate below names its demand proof, the shipped mechanism it rides, and its gates. Nothing here is committed work — this is the menu for the next planning pass."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-unfair-advantage--why-kolu-can-do-what-none-of-them-can",
			children: "The unfair advantage — why kolu can do what none of them can"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Every surveyed product solves one slice: tmux owns persistence, mosh owns roaming, tmate owns sharing, Coder owns fleet cost, Omnara/Warp-Remote own agent notification. Kolu’s three primitives — ",
			createVNode(_components.strong, { children: "a daemon on every host that owns the PTYs" }),
			", ",
			createVNode(_components.strong, { children: "a warm multi-host pool" }),
			", and ",
			createVNode(_components.strong, { children: "typed per-terminal agent urgency" }),
			" — cover all the slices at once, and enable one thing structurally impossible elsewhere: ",
			createVNode(_components.em, { children: "products that know what an agent is waiting for" }),
			". No surveyed tool can rank a fleet by “which agent needs a human,” because none of them know what an agent is. That is the axis to build along; everything below is ordered by how directly it exploits it. ",
			createVNode(_components.em, { children: "(Tools surveyed, for the record: tmux + tmux-resurrect/continuum · mosh · Eternal Terminal · Zellij (incl. its web client) · VS Code Remote-SSH + Tunnels · GitHub Codespaces · Coder · Gitpod · DevPod · Tailscale (SSH, session recording, Taildrop) · Warp (Remote Control, session sharing) · Termius · Blink Shell · Upterm · tmate · Wave Terminal — plus the agent-attention products: Omnara, Happy Coder, Claude Code’s own agent view.)" })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "tier-1--the-attention-products-build-on-w5s-wire-exploit-the-advantage-directly",
			children: "Tier 1 — the attention products (build on W5’s wire, exploit the advantage directly)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "F1 · W5 cross-host attention" }),
			" ",
			createVNode(_components.em, { children: "(already planned — the ecosystem research now validates it hard)." }),
			" PWA badge summed across bindings, per-host switcher-chip counts, OS notification whose click = switch + focus. Whole products exist doing ",
			createVNode(_components.em, { children: "only" }),
			" this for single machines (Omnara, Happy Coder, Warp Remote Control, Claude Code’s own agent view) — proof the pain is real and monetizable; kolu gets the cross-",
			createVNode(_components.em, { children: "host" }),
			" version from one urgency subscription per warm binding. Deliberately urgency-count-only on the wire (bounded cost, and immune to the clock-skew gap). ",
			createVNode(_components.em, { children: "Gate: W4 merged. Size: small — the wire member and the fold exist." })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "F2 · The cross-host dock (B-lite)" }),
			" ",
			createVNode(_components.em, { children: "(already named as the first escalation; the research renames its category: a fleet dashboard ranked by what matters)." }),
			" Foreign hosts’ agents listed in your dock, urgency-ranked, click = switch + focus. Coder’s workspace dashboard and Termius host groups prove fleet-view demand; none can rank by agent attention. The terminals contract has reserved the host axis since W1. ",
			createVNode(_components.em, { children: "Gate: demand — “if switching proves insufficient” (the plan’s own bar). Size: medium, pure aggregation layer, zero daemon changes." })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "F3 · Agent-aware idle suspension" }),
			" ",
			createVNode(_components.em, { children: "(new — the sharpest differentiated idea the research surfaced)." }),
			" ",
			createVNode(_components.strong, { children: "Not sleeping terminals, one level up" }),
			": kolu already has per-terminal sleep (records persist, wake resumes the agent) — but sleeping is ",
			createVNode(_components.em, { children: "manual" }),
			" today, and F3 is about the ",
			createVNode(_components.strong, { children: "machine" }),
			" (stop paying for an idle cloud host). Two layers, same signal: an ",
			createVNode(_components.em, { children: "auto-sleep" }),
			" policy for terminals (sleep a terminal when its agent completes and nothing awaits) is the natural precursor and could ship first; Coder/Gitpod/DevPod all auto-stop idle environments to save money, and their users file the same gap: the tools can’t tell “human stepped away” from “agent mid-task” (a cited Coder discussion asks for exactly this). Kolu ",
			createVNode(_components.em, { children: "knows" }),
			" — padi distinguishes an awaiting agent from a working one per terminal. Feature: for suspendable hosts (cloud boxes, pu-style), suspend when no agent is mid-task AND nothing is awaiting input, wake on demand through the warm pool. ",
			createVNode(_components.em, { children: "Gates: W4; a host-lifecycle verb kolu deliberately doesn’t have today (the registry has no controls — this feature is the first honest consumer for one, per prove-then-extract); real demand from someone running cloud hosts. Size: medium-large." })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "tier-2--the-daemon-ownership-dividends-persistence-beyond-what-tmux-can-express",
			children: "Tier 2 — the daemon-ownership dividends (persistence beyond what tmux can express)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "F4 · Agent-aware resurrection — CORRECTED: mostly shipped already." }),
			" The survey pitched this as the tmux-resurrect killer (“restore the ",
			createVNode(_components.em, { children: "agent" }),
			", not just the terminal”) — but a ground check shows padi already has it: wake reads the frozen agent identity back and re-launches via ",
			createVNode(_components.code, { children: "resumeCommand" }),
			" (",
			createVNode(_components.code, { children: "endpoint.ts" }),
			"), with ",
			createVNode(_components.code, { children: "resumeIds" }),
			" as the per-terminal resume opt-in on ",
			createVNode(_components.code, { children: "session.restore" }),
			" (",
			createVNode(_components.code, { children: "surface.ts" }),
			"). The honest residual is only ",
			createVNode(_components.strong, { children: "framing and automation" }),
			": making “your fleet rebooted; your agents came back mid-conversation” a ",
			createVNode(_components.em, { children: "demonstrated, documented" }),
			" cross-host story (and deciding whether post-reboot restore should offer resume by default). ",
			createVNode(_components.em, { children: "Size: small — polish on shipped machinery, not a feature." })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "F5 · Auto port-forward with preview URLs" }),
			" — ",
			createVNode(_components.em, { children: [
				"promoted to its own note: ",
				createVNode(_components.a, {
					href: "port-preview.html",
					children: "port-preview"
				}),
				", incl. the two-hop architecture (headless kolu + remote padi) with the visual explanation."
			] }),
			" Codespaces/VS Code prove the demand (detect localhost URLs in terminal output → clickable forwarded links); the agent-era version is sharper: ",
			createVNode(_components.em, { children: "agents start dev servers constantly and print the URL" }),
			". padi watches PTY output (it already has activity sensors), announces detected ports on its surface, kolu-server proxies through the existing bound connection (the preview route already reads through the bound session — same shape, one more route). Click the chip → the remote dev server in a tab. ",
			createVNode(_components.em, { children: "Gate: W4 for the multi-host version (single-host works today). Size: medium. This is likely the highest delight-per-effort item on the list." })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "F6 · Session recording & replay (agent audit trails)." }),
			" Tailscale ships SSH session recording for compliance; kolu’s angle is stronger: ",
			createVNode(_components.code, { children: "transcript.exportHtml" }),
			" already exists for agent transcripts, and the daemon sees all PTY bytes — recording an agent’s terminal doubles as an ",
			createVNode(_components.strong, { children: "agent-governance audit trail" }),
			", a need the ecosystem is just waking to. ",
			createVNode(_components.em, { children: "Gate: demand-driven. Size: medium." })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "tier-3--already-named-unblocked-mechanics-ship-when-convenient",
			children: "Tier 3 — already-named, unblocked mechanics (ship when convenient)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "F7 · Honest clocks (the deferred W4 piece 5)" }),
			" — the named fast-follow. The offset half now ships: ",
			createVNode(_components.code, { children: "makeSession" }),
			" measures the RTT-compensated offset off the framework-reserved ",
			createVNode(_components.code, { children: "system.clockNow" }),
			" per bind and carries it on the session’s ",
			createVNode(_components.code, { children: "connected" }),
			" state, folded into ",
			createVNode(_components.code, { children: "EntryStatus.connected" }),
			" (PR3 — the MEASUREMENT graduated to the framework-reserved ",
			createVNode(_components.code, { children: "system.clockNow" }),
			"; the padi-specific ",
			createVNode(_components.code, { children: "control.core.clockNow" }),
			" is ",
			createVNode(_components.strong, { children: "kept forever" }),
			" as a frozen-core member, living beside the new path for old binders, never removed). What remains is translating host-stamped times through that offset in the client’s formatters. ",
			createVNode(_components.em, { children: "Prerequisite hygiene for any cross-host feature that displays time; W5 was shaped to not need it. Size: small." })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "F8 · padi-tui –host (ledger L24)" }),
			" — the CLI’s remote leg, ready since W3.1. ",
			createVNode(_components.strong, { children: [
				"One correction from the ground-truth pass: L24’s text cites ",
				createVNode(_components.code, { children: "getHostSession" }),
				", which S10 deleted"
			] }),
			" — the implementation composes ",
			createVNode(_components.code, { children: "makeSession({ connectOnce: sshConnector({ binary: \"padi\", … }) })" }),
			". A tui is a dial; it never converges (#1313). ",
			createVNode(_components.em, { children: "Size: small." })
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "F9 · kolu-tui" }),
			" — the graduation proof already in Future work: consume padiSurface over socket/ssh ",
			createVNode(_components.em, { children: "without kolu-server" }),
			"; done only when that named path renders a live canvas. Unblocks L2. ",
			createVNode(_components.em, { children: "Gate: demand." })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "parked-with-reasons-the-research-argued-against-for-now",
			children: "Parked with reasons (the research argued against, for now)"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Latency masking (mosh-style prediction)" }),
				" — kolu controls both ends so it’s ",
				createVNode(_components.em, { children: "possible" }),
				", but the measured typing bench (p99 14.4ms over a real hop) says the pain isn’t there; mosh’s scrollback complaint doesn’t even apply here. Revisit only on real high-latency usage reports."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.del, { children: "Session sharing / multiplayer" }),
				" — ",
				createVNode(_components.strong, { children: ["PROMOTED (srid, 2026-07-06) to its own note: ", createVNode(_components.a, {
					href: "shared-canvas.html",
					children: "shared-canvas"
				})] }),
				" — read-only viewers first with exactly one writer, capability links extending the origin gate, anchored comments as phase 2."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Cross-host file transfer (Taildrop class)" }), " — real demand, cleanly buildable over the pool, but no kolu-specific advantage; park until asked."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Hybrid canvas (model B)" }), " — stays exactly where the plan put it: only if one-window side-by-side proves recurring demand; an aggregation layer, nothing below changes."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-constraint-ledger-what-any-of-this-must-respect",
			children: "The constraint ledger (what any of this must respect)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The ",
			createVNode(_components.strong, { children: "parity tail" }),
			" (",
			createVNode(_components.a, {
				href: "remote-bind-parity.html",
				children: "remote-bind-parity"
			}),
			") gates “kolu fully works over a remote bind” — #1701’s watcher fix, the one load-source dig, R3’s kill-fault primitive, and the R5 reconcile-poll series are the debts; the watcher genus especially bites anything that adds more remote watchers. The ",
			createVNode(_components.strong, { children: "N-bindings standing cost" }),
			" stays bounded only if multi-host wires stay urgency-count-sized (the W5 rule — F2 must honor it too). The ",
			createVNode(_components.strong, { children: "ssh-user caveat" }),
			" is the trust model until a sharing story exists. The ",
			createVNode(_components.strong, { children: "drishti gate" }),
			" binds every ",
			createVNode(_components.code, { children: "@kolu/surface*" }),
			" touch. And the clock gap (F7) silently corrupts any cross-host timestamp display until paid."
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Remote terminals — the future work",
	"description": "What to build on top of the multi-host switch — candidate features crossed from ecosystem research (17 source-grounded capabilities) with kolu's shipped primitives, each with its mechanism, demand proof, and honest gates.",
	"parents": ["padi", "analysis"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-06T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-unfair-advantage--why-kolu-can-do-what-none-of-them-can",
			"text": "The unfair advantage — why kolu can do what none of them can"
		},
		{
			"depth": 2,
			"slug": "tier-1--the-attention-products-build-on-w5s-wire-exploit-the-advantage-directly",
			"text": "Tier 1 — the attention products (build on W5’s wire, exploit the advantage directly)"
		},
		{
			"depth": 2,
			"slug": "tier-2--the-daemon-ownership-dividends-persistence-beyond-what-tmux-can-express",
			"text": "Tier 2 — the daemon-ownership dividends (persistence beyond what tmux can express)"
		},
		{
			"depth": 2,
			"slug": "tier-3--already-named-unblocked-mechanics-ship-when-convenient",
			"text": "Tier 3 — already-named, unblocked mechanics (ship when convenient)"
		},
		{
			"depth": 2,
			"slug": "parked-with-reasons-the-research-argued-against-for-now",
			"text": "Parked with reasons (the research argued against, for now)"
		},
		{
			"depth": 2,
			"slug": "the-constraint-ledger-what-any-of-this-must-respect",
			"text": "The constraint ledger (what any of this must respect)"
		}
	];
}
var url = "src/content/atlas/remote-terminals-future.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/remote-terminals-future.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/remote-terminals-future.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
