import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
//#region src/content/atlas/shared-canvas.mdx
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
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The feature, in plain words." }),
			" Send someone a link; they see your live canvas — terminals streaming, agent states, urgency — but can’t type. Exactly one person holds the pen (you, until you hand it over). Later: comments pinned to tiles, so a reviewer can say “this agent went off the rails” ",
			createVNode(_components.em, { children: "on" }),
			" the terminal it happened in. (tmate, Upterm, Warp session sharing and Zellij multiplayer prove the demand for terminal sharing; kolu’s differentiated form is sharing ",
			createVNode(_components.em, { children: "a workspace of agents with their attention state visible" }),
			" — see ",
			createVNode(_components.a, {
				href: "remote-terminals-future.html",
				children: "the future-work survey"
			}),
			".)"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "what-already-exists-the-reason-this-is-smaller-than-it-looks",
			children: "What already exists (the reason this is smaller than it looks)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"kolu-server ",
			createVNode(_components.strong, { children: "already brokers N clients onto one binding" }),
			" — two browser tabs on the same host are the shipped, e2e-pinned case (the switch’s “two tabs stay independent” test), and padi already ",
			createVNode(_components.strong, { children: "serializes concurrent writes" }),
			" (last-write-wins on chrome/layout — the multi-client risk the plan has always carried). So multiplayer viewing is not new transport; the genuinely new work is three things:"
		] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A capability link (the auth story — the real work)." }),
				" kolu’s trust model today is the origin gate + the ssh user; there are no per-person identities. The honest MVP that doesn’t invent an account system: a ",
				createVNode(_components.strong, { children: "share link carrying an unguessable capability token" }),
				", minted per share (scope: this host’s canvas, read-only, revocable, optional expiry), checked at the ws-upgrade beside the origin gate. Revoking kills the socket. This extends the existing gate rather than replacing the trust model — and it must be loud in the UI (a standing “shared with 2 viewers” chip; nothing silent)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Read-only enforcement server-side." }),
				" A viewer connection gets the surface’s cells and byte streams but its ",
				createVNode(_components.em, { children: "writes are rejected at the router" }),
				" — a capability-scoped router variant (the per-host router machinery from the switch makes this a filter, not a fork). Never client-side-only enforcement."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "One writer, made explicit." }),
				" Today “one writer” is social. Formalize it as a ",
				createVNode(_components.strong, { children: "writer lease" }),
				" on the binding (the sharer holds it by default; handoff is explicit, surrendered on disconnect) — turning padi’s last-write-wins from a collision policy into a non-event, and giving the UI an honest pen indicator."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "comments-on-the-canvas-phase-2",
			children: "Comments on the canvas (phase 2)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Anchored annotations: a comment attaches to a ",
			createVNode(_components.strong, { children: "terminal id" }),
			" (and optionally a scrollback position), rendered as a pin on the tile; a thread panel per tile. Storage: a per-host ",
			createVNode(_components.code, { children: "comments" }),
			" cell on the kolu surface (server-side Conf, like recents — comments are about the ",
			createVNode(_components.em, { children: "workspace" }),
			", not the daemon, so they live in kolu-server, not padi). Viewers with the capability can comment even while read-only — that’s the point of review. Deliberately out of scope until asked: mentions, resolution workflows, cross-host comment feeds."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "phasing",
			children: "Phasing"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "P1 — read-only share" }), ": capability link + router filter + viewer-presence chip + revoke. Ships alone; the writer lease is implicit (sharer = writer)."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "P2 — writer handoff" }), ": the explicit lease + pen indicator."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "P3 — comments" }), ": the anchored-annotation cell + tile pins."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Constraints from ",
			createVNode(_components.a, {
				href: "remote-terminals-future.html",
				children: "the future-work note"
			}),
			" apply: the ssh-user caveat means a share link shares YOUR authority over that host’s canvas — the note must say so plainly in the share dialog; and viewer connections count against the per-binding wire budget (viewers subscribe the same re-served surface — bounded, but not free)."
		] }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Shared canvas — read-only multiplayer, one writer, comments",
	"description": "Share a live kolu canvas with someone else — read-only viewers first with exactly one writer, then anchored comments; the broker machinery already exists, the new work is capability links and honest presence.",
	"parents": ["padi", "feature"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-06T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-already-exists-the-reason-this-is-smaller-than-it-looks",
			"text": "What already exists (the reason this is smaller than it looks)"
		},
		{
			"depth": 2,
			"slug": "comments-on-the-canvas-phase-2",
			"text": "Comments on the canvas (phase 2)"
		},
		{
			"depth": 2,
			"slug": "phasing",
			"text": "Phasing"
		}
	];
}
var url = "src/content/atlas/shared-canvas.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/shared-canvas.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/shared-canvas.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
