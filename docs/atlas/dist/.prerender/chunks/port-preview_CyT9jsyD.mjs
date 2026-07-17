import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Svg } from "./Svg_C3c2BOUY.mjs";
//#region src/diagrams/port-preview-arch.svg?raw
var port_preview_arch_default = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 980 430\" font-family=\"inherit\" role=\"img\" aria-label=\"Port-forward preview: two hops that are both existing pipes — browser to kolu-server over the normal origin, kolu-server to the dev server through padi over the existing surface wire\"><defs><marker id=\"pf\" viewBox=\"0 0 8 8\" refX=\"7\" refY=\"4\" markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\"><path d=\"M 0 0 L 8 4 L 0 8 z\" fill=\"currentColor\" opacity=\"0.75\"/></marker></defs><rect x=\"20\" y=\"60\" width=\"230\" height=\"140\" rx=\"12\" fill=\"none\" stroke=\"currentColor\" stroke-opacity=\"0.25\" stroke-dasharray=\"3 4\"/><text x=\"135\" y=\"52\" text-anchor=\"middle\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.6\">YOUR MACHINE (anywhere)</text><rect x=\"330\" y=\"60\" width=\"280\" height=\"300\" rx=\"12\" fill=\"none\" stroke=\"currentColor\" stroke-opacity=\"0.25\" stroke-dasharray=\"3 4\"/><text x=\"470\" y=\"52\" text-anchor=\"middle\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.6\">HEADLESS BOX (runs kolu-server)</text><rect x=\"690\" y=\"60\" width=\"270\" height=\"300\" rx=\"12\" fill=\"none\" stroke=\"currentColor\" stroke-opacity=\"0.25\" stroke-dasharray=\"3 4\"/><text x=\"825\" y=\"52\" text-anchor=\"middle\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.6\">REMOTE PADI HOST (over ssh)</text><rect x=\"40\" y=\"90\" width=\"190\" height=\"80\" rx=\"9\" fill=\"#3b82f6\" fill-opacity=\"0.11\" stroke=\"#3b82f6\" stroke-width=\"1.5\"/><text x=\"135.0\" y=\"111\" text-anchor=\"middle\" font-size=\"13.5\" font-weight=\"700\" fill=\"currentColor\">Browser</text><text x=\"135.0\" y=\"129\" text-anchor=\"middle\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.82\">kolu tab + the preview</text><text x=\"135.0\" y=\"143\" text-anchor=\"middle\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.82\">iframe — ONE origin</text><rect x=\"360\" y=\"90\" width=\"220\" height=\"80\" rx=\"9\" fill=\"#22a06b\" fill-opacity=\"0.11\" stroke=\"#22a06b\" stroke-width=\"1.5\"/><text x=\"470.0\" y=\"111\" text-anchor=\"middle\" font-size=\"13.5\" font-weight=\"700\" fill=\"currentColor\">kolu-server</text><text x=\"470.0\" y=\"129\" text-anchor=\"middle\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.82\">reverse-proxy route:</text><text x=\"470.0\" y=\"143\" text-anchor=\"middle\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.82\">/preview-port/&lt;host&gt;/&lt;port&gt;/*</text><rect x=\"360\" y=\"240\" width=\"220\" height=\"90\" rx=\"9\" fill=\"#22a06b\" fill-opacity=\"0.11\" stroke=\"#22a06b\" stroke-width=\"1.5\" stroke-dasharray=\"5 3\"/><text x=\"470.0\" y=\"261\" text-anchor=\"middle\" font-size=\"13.5\" font-weight=\"700\" fill=\"currentColor\">padi wire (exists)</text><text x=\"470.0\" y=\"279\" text-anchor=\"middle\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.82\">stdio-over-ssh surface link:</text><text x=\"470.0\" y=\"293\" text-anchor=\"middle\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.82\">cells · procedures · BYTE</text><text x=\"470.0\" y=\"307\" text-anchor=\"middle\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.82\">STREAMS (terminalAttach kin)</text><rect x=\"710\" y=\"90\" width=\"230\" height=\"80\" rx=\"9\" fill=\"#a855f7\" fill-opacity=\"0.11\" stroke=\"#a855f7\" stroke-width=\"1.5\"/><text x=\"825.0\" y=\"111\" text-anchor=\"middle\" font-size=\"13.5\" font-weight=\"700\" fill=\"currentColor\">padi (on the host)</text><text x=\"825.0\" y=\"129\" text-anchor=\"middle\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.82\">port sensor: sees the URL in</text><text x=\"825.0\" y=\"143\" text-anchor=\"middle\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.82\">PTY output · serves ports cell</text><rect x=\"710\" y=\"240\" width=\"230\" height=\"90\" rx=\"9\" fill=\"#c08a2d\" fill-opacity=\"0.11\" stroke=\"#c08a2d\" stroke-width=\"1.5\"/><text x=\"825.0\" y=\"261\" text-anchor=\"middle\" font-size=\"13.5\" font-weight=\"700\" fill=\"currentColor\">dev server</text><text x=\"825.0\" y=\"279\" text-anchor=\"middle\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.82\">localhost:3000 — started by</text><text x=\"825.0\" y=\"293\" text-anchor=\"middle\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.82\">the agent in a kolu terminal</text><text x=\"825.0\" y=\"307\" text-anchor=\"middle\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.82\">(never exposed publicly)</text><path d=\"M 230 130 L 360 130\" stroke=\"currentColor\" stroke-width=\"1.6\" fill=\"none\" opacity=\"0.8\" marker-end=\"url(#pf)\"/><text x=\"295.0\" y=\"122.0\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.9\">HOP A: normal kolu origin (HTTPS/WS) — already open</text><path d=\"M 470 170 L 470 240\" stroke=\"currentColor\" stroke-width=\"1.6\" fill=\"none\" opacity=\"0.8\" marker-end=\"url(#pf)\"/><text x=\"470.0\" y=\"197.0\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.9\">rides</text><path d=\"M 580 285 L 710 285\" stroke=\"currentColor\" stroke-width=\"1.6\" fill=\"none\" opacity=\"0.8\" marker-end=\"url(#pf)\"/><text x=\"645.0\" y=\"277.0\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.9\">HOP B: TCP bytes as a surface</text><text x=\"645\" y=\"300\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.9\">byte-stream member — the pipe already exists</text><path d=\"M 825 240 L 825 170\" stroke=\"currentColor\" stroke-width=\"1.6\" fill=\"none\" opacity=\"0.8\" marker-end=\"url(#pf)\"/><text x=\"825.0\" y=\"197.0\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.9\">padi dials localhost:3000 (loopback, on-host)</text><text x=\"30\" y=\"400\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.85\"><tspan font-weight=\"700\">The trick:</tspan> nothing new listens anywhere. The browser talks to the origin it already trusts; kolu-server pipes bytes down the padi wire it already holds; padi dials loopback on its own host. Two hops = two existing pipes.</text></svg>";
//#endregion
//#region src/content/atlas/port-preview.mdx
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
			" Agents start dev servers constantly and print the URL (",
			createVNode(_components.code, { children: "localhost:3000" }),
			"). Today that URL is dead text if the terminal lives on a remote host. After this: padi notices the port, a chip appears on the terminal, and clicking it opens the running app — served through the same kolu origin you’re already on, no matter which machine the server actually runs on. (Codespaces/VS Code prove the demand — they auto-detect and forward console URLs; the agent era makes it sharper, because ",
			createVNode(_components.em, { children: "agents" }),
			" print URLs far more often than humans type ",
			createVNode(_components.code, { children: "ssh -L" }),
			". See ",
			createVNode(_components.a, {
				href: "remote-terminals-future.html",
				children: "the future-work survey"
			}),
			".)"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-two-hop-question-answered",
			children: "The two-hop question, answered"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The hard-looking case: kolu-server runs on a ",
			createVNode(_components.strong, { children: "headless box" }),
			" you reach remotely, and ",
			createVNode(_components.em, { children: "it" }),
			" binds a padi on a ",
			createVNode(_components.strong, { children: "third machine" }),
			" over ssh. The dev server listens on ",
			createVNode(_components.code, { children: "localhost:3000" }),
			" on that third machine — your browser is two networks away. Doesn’t forwarding take two hops? ",
			createVNode(_components.strong, { children: "Yes — and both hops already exist as open pipes." }),
			" That’s the whole design:"
		] }),
		"\n",
		createVNode($$Svg, {
			svg: port_preview_arch_default,
			wide: true,
			caption: "Nothing new listens anywhere. HOP A is the kolu origin the browser already trusts; HOP B is the padi surface wire kolu-server already holds (the same link that carries terminal bytes today); padi dials loopback on its own host. ssh -L appears nowhere."
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "HOP A (browser → kolu-server)" }),
				" is the normal kolu origin — the HTTPS/WS connection the tab already has. The preview URL is a ",
				createVNode(_components.em, { children: "path on kolu’s own origin" }),
				" (",
				createVNode(_components.code, { children: "/preview-port/<host>/<port>/…" }),
				"), so auth is the origin gate that guards everything else, and there is no mixed-content or third-party-origin problem."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "HOP B (kolu-server → the dev server)" }),
				" rides the ",
				createVNode(_components.strong, { children: "existing padi wire" }),
				": a new byte-stream member on the padi surface (“dial ",
				createVNode(_components.code, { children: "localhost:<port>" }),
				" on your host and pipe bytes”) — the exact machinery class ",
				createVNode(_components.code, { children: "terminalAttach" }),
				" already uses for PTY bytes, and the same read-through-the-bound-session shape the file-preview route shipped in W4. padi is ",
				createVNode(_components.em, { children: "on" }),
				" the target host, so its dial is loopback."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "why-this-shape-beats-the-alternatives",
			children: "Why this shape beats the alternatives"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"A second ssh channel (",
					createVNode(_components.code, { children: "ssh -L" }),
					"-style) — rejected."
				] }),
				" It re-enters ssh config/auth per forward, needs port allocation management on the middle box, silently breaks if the padi transport is ever not-ssh (the local arm already isn’t), and opens a ",
				createVNode(_components.em, { children: "listener" }),
				" on the headless box that the origin gate doesn’t guard."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Public tunnel services (cloudflared/ngrok class) — rejected." }), " An external dependency that publishes your dev server to the internet to show it to yourself. Kolu’s topology already has a private path."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "The chosen shape" }), " needs no new listeners, no new auth surface, no per-forward setup, and works uniformly for the local arm (padi dials loopback directly — the degenerate one-hop case falls out for free)."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-three-pieces",
			children: "The three pieces"
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Detection (padi)." }),
				" A PTY-output sensor for URL/port patterns (padi already runs output sensors for agent state), publishing a per-terminal ",
				createVNode(_components.code, { children: "ports" }),
				" cell — ",
				createVNode(_components.code, { children: "{ port, url, firstSeenAt, terminalId }" }),
				", value-typed per the forwarding policy. Agents print URLs; humans get the same chip when they start servers by hand."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Transport (padi surface + kolu-server)." }),
				" The ",
				createVNode(_components.code, { children: "dialPort" }),
				" byte-stream member (fail-through on link drop, per the byte-stream policy — a dropped preview reconnects end-to-end, never replays stale bytes), and kolu-server’s reverse-proxy route streaming request/response bodies over it. WebSocket upgrades tunnel the same way (the proxy speaks the upgrade; the bytes don’t care)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "UI (client)." }),
				" A port chip on the terminal tile (and the dock row), click = open ",
				createVNode(_components.code, { children: "/preview-port/<host>/<port>/" }),
				" in a tab or the preview panel. The chip carries the host name — the same per-host honesty rules as everything post-switch."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "honest-limits-named-up-front",
			children: "Honest limits, named up front"
		}),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Path-rewriting is out of scope." }), " Apps that emit absolute URLs or hardcode their origin may misbehave under a sub-path proxy — the same limit Codespaces has; the escape hatch is opening the preview in its own tab where relative apps just work. No HTML rewriting middleware (that way lies a proxy engine)."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "This is a dev preview, not ingress." }), " Byte-stream framing over the surface wire costs more than a raw socket; fine for previews, not a production tunnel — and deliberately so (no silent graduation into infrastructure)."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "W4’s per-subresource caveat applies" }),
				" (the preview route’s ",
				createVNode(_components.code, { children: "?host" }),
				" fallback): the proxy path embeds the host in the ",
				createVNode(_components.em, { children: "path" }),
				", not the query, precisely so relative subresources inherit it. This fixes the H4 class rather than inheriting it."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Sequencing: single-host (local arm) works standing alone and is the natural first PR; the remote leg is the same members over the existing wire. Constraint ledger of ",
			createVNode(_components.a, {
				href: "remote-terminals-future.html",
				children: "the future-work note"
			}),
			" applies (notably: the wire stays per-feature-bounded — a preview stream is opened on click, never held warm per host)."
		] }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Port preview — click the URL your agent just printed",
	"description": "Auto-detected dev-server ports on any bound host become clickable previews served through kolu's own origin — TCP bytes riding the existing padi wire, so the two-hop topology needs zero new listeners.",
	"parents": ["padi", "feature"],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-06T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-two-hop-question-answered",
			"text": "The two-hop question, answered"
		},
		{
			"depth": 2,
			"slug": "why-this-shape-beats-the-alternatives",
			"text": "Why this shape beats the alternatives"
		},
		{
			"depth": 2,
			"slug": "the-three-pieces",
			"text": "The three pieces"
		},
		{
			"depth": 2,
			"slug": "honest-limits-named-up-front",
			"text": "Honest limits, named up front"
		}
	];
}
var url = "src/content/atlas/port-preview.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/port-preview.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/port-preview.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
