import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
//#region src/content/atlas/surface.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		code: "code",
		em: "em",
		h2: "h2",
		li: "li",
		p: "p",
		strong: "strong",
		ul: "ul"
	}, props.components);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Surface is how a kolu-family daemon publishes its live state." }),
			" A daemon declares its data once — cells, collections, streams, events, procedures — as a typed ",
			createVNode(_components.em, { children: "surface" }),
			", and the framework does the rest: serve it over a socket, mirror it across machines, re-serve a mirror to further consumers, and hand every client a typed reader. Three applications consume it today: ",
			createVNode(_components.strong, { children: "kolu" }),
			" (padi + kaval), ",
			createVNode(_components.strong, { children: "drishti" }),
			", and ",
			createVNode(_components.strong, { children: "odu" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: "The packages, one line each:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/surface" }) }), " — the core: declarations, serving, the mirror, the typed client."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/surface-map" }) }), " — a dynamic keyed map of remote surfaces over one socket (hosts come and go; the client keys on membership)."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/surface-remote" }) }), " — the ssh leg: sessions, host fan-out, connection state."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/surface-daemon" }) }),
				" / ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "-supervisor" }) }),
				" — the daemon spine (socket lifecycle, contract handshake, identity) and the side that supervises daemons (convergence, drain/recycle)."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/surface-app" }) }), " — the app shell for browser apps run against your own server (delivery, identity, connection lifecycle)."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/surface-mcp" }) }), " — any surface re-exposed as an MCP server."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-active-plan",
			children: "The active plan"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.a, {
					href: "surface-runtime-boundary.html",
					children: "A Complete Surface Runtime"
				}),
				" — ",
				createVNode(_components.strong, { children: "the plan of record" }),
				" for the surface-framework consolidation: the six kernel moves SR1–SR6 (runtime, procedures, membership, failure, mirror, adoptions), then the bridge spine, each proven by what a consumer deletes."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "surface-reactive-bridge.html",
				children: "The reactive bridge"
			}), " — the ratified backend-reactivity design the plan’s SR7–SR10 implement: state is a signal, derived state is a computed, the wire is a signal boundary."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.a, {
					href: "surface-reactor-engine.html",
					children: "The reactor engine — decided"
				}),
				" — the engine ruling behind the bridge (",
				createVNode(_components.code, { children: "@preact/signals-core" }),
				" now; ",
				createVNode(_components.code, { children: "@solidjs/signals" }),
				" the named swap target)."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "learn-it--the-primers",
			children: "Learn it — the primers"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "surface-live-data.html",
				children: "How a surface ships live data"
			}), " — value-bearing vs pulse-then-requery, and why kolu uses both."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.a, {
					href: "surface-map-101.html",
					children: "The client half, taught"
				}),
				" — what surface-map added: membership, ",
				createVNode(_components.code, { children: "EntryStatus" }),
				", per-entry scopes."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "surface-hosting-101.html",
				children: "The hosting side, taught"
			}), " — how a surface travels between machines: serve, mirror, re-serve, sessions, the host registry."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.a, {
					href: "surface-attention-101.html",
					children: "The attention pieces, taught"
				}),
				" — the cell’s ",
				createVNode(_components.code, { children: "updated()" }),
				" and the notify seam behind cross-host attention."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-package-notes",
			children: "The package notes"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.a, {
					href: "surface-daemon.html",
					children: "surface-daemon"
				}),
				" — one spine for kaval and ",
				createVNode(_components.code, { children: "odu serve" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "surface-app.html",
				children: "surface-app"
			}), " — the app-shell electricity and its lifecycle."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "surface-connection.html",
				children: "surface-connection"
			}), " — the WebSocket assembly (partysocket + oRPC) lifted upstream."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "surface-mcp.html",
				children: "surface-mcp"
			}), " — the MCP adapter and its subscribe/teardown lifecycle."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "remote-surfaces.html",
				children: "remoteSurfaces"
			}), " — the keyed map of re-served remote surfaces the host switch stands on."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-design-records",
			children: "The design records"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.a, {
				href: "surface-hosting-roadblocks.html",
				children: "Surface hosting — the four roadblocks"
			}), " — the build-time design questions the hosting work answered in code."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.a, {
					href: "electricity.html",
					children: "Electricity"
				}),
				" — the volatility doctrine that decides when something graduates into a ",
				createVNode(_components.code, { children: "@kolu/*" }),
				" package at all; every extraction above passed its tests."
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
	"title": "The Surface framework",
	"description": "The hub for @kolu/surface and its satellite packages — what the framework is, every surface note filed in one map: the active consolidation plan, the primers, the package notes, and the design records.",
	"parents": ["reference", "feature"],
	"maturity": "evergreen",
	"updated": "2026-07-13T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-active-plan",
			"text": "The active plan"
		},
		{
			"depth": 2,
			"slug": "learn-it--the-primers",
			"text": "Learn it — the primers"
		},
		{
			"depth": 2,
			"slug": "the-package-notes",
			"text": "The package notes"
		},
		{
			"depth": 2,
			"slug": "the-design-records",
			"text": "The design records"
		}
	];
}
var url = "src/content/atlas/surface.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/surface.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
