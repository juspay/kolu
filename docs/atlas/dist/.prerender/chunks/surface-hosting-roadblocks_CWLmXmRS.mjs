import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
//#region src/content/atlas/surface-hosting-roadblocks.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		blockquote: "blockquote",
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
	const { Fragment: Fragment$1 } = _components;
	if (!Fragment$1) _missingMdxReference("Fragment", true);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: [
			"The agent inventoried all three consumers and raised four design questions before writing code. All four are now resolved (srid). The headline: ",
			createVNode(_components.strong, { children: [
				"the reserved ",
				createVNode(_components.code, { children: "system.identity" }),
				" member is bundled into this same PR"
			] }),
			" (its value is a null-free ",
			createVNode(_components.code, { children: "SurfaceIdentity" }),
			" sum — see roadblock 5) — so identity lands on the base ",
			createVNode(_components.code, { children: "Session" }),
			" role directly, no two-step. (This is NOT “universal hello” — that name was borrowed from padi’s ",
			createVNode(_components.em, { children: "daemon" }),
			" control-core ",
			createVNode(_components.code, { children: "hello()" }),
			"; the honest name is ",
			createVNode(_components.code, { children: "system.identity" }),
			", the identity twin of the framework’s existing reserved ",
			createVNode(_components.code, { children: "system.live" }),
			".)"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "1-systemidentity-is-in-this-pr--identity-on-the-base-session-role",
			children: [
				"1. ",
				createVNode(_components.code, { children: "system.identity" }),
				" is IN this PR — identity on the base ",
				createVNode(_components.code, { children: "Session" }),
				" role"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The framework already auto-attaches a reserved ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "system" }), " namespace"] }),
			" to every surface (",
			createVNode(_components.code, { children: "packages/surface/src/liveness.ts" }),
			": ",
			createVNode(_components.code, { children: "defineSurface" }),
			" carries ",
			createVNode(_components.code, { children: "surface.system.live" }),
			", which ",
			createVNode(_components.code, { children: "implementSurface" }),
			" auto-answers; ",
			createVNode(_components.code, { children: "define.ts" }),
			" even anticipates a ",
			createVNode(_components.code, { children: "system.version" }),
			"-style member). We add ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "system.identity" }) }),
			" to that same reserved namespace — the identity twin of ",
			createVNode(_components.code, { children: "system.live" }),
			". Originally scoped out as “a behavior-preserving refactor can’t add a contract member.” srid’s ruling: ",
			createVNode(_components.strong, { children: "bundle it." }),
			" This is a coordinated three-repo PR — every server and consumer moves together — so the cross-deploy-drift danger doesn’t apply, and ",
			createVNode(_components.code, { children: "system.live" }),
			" already proves the exact pattern."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"What it means concretely — one more reserved member in the ",
			createVNode(_components.code, { children: "system" }),
			" namespace, framework-served on ",
			createVNode(_components.strong, { children: "every" }),
			" surface:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#D73A49\">function</span><span style=\"color:#6F42C1\"> defineSurface</span><span style=\"color:#24292E\">(</span><span style=\"color:#E36209\">members</span><span style=\"color:#24292E\">) {</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  return</span><span style=\"color:#6F42C1\"> implement</span><span style=\"color:#24292E\">({ </span><span style=\"color:#D73A49\">...</span><span style=\"color:#24292E\">members, system: { live, identity } }); </span><span style=\"color:#6A737D\">// `identity` is the NEW reserved member; `live` already exists in the same `system` namespace</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">}</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// The MEMBER is auto-served on every surface (zero code). The DATA source is supplied by the</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// server that has a reader — see roadblock 5 for the A/B on where the four fields come from.</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"So ",
			createVNode(_components.code, { children: "identity()" }),
			" lives on the base role, and it is ",
			createVNode(_components.strong, { children: "never null-forever" }),
			" — because every server truly answers:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#D73A49\">interface</span><span style=\"color:#6F42C1\"> Session</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">Client</span><span style=\"color:#24292E\">> {</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  pin</span><span style=\"color:#24292E\">()</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> Promise</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">Client</span><span style=\"color:#24292E\">>;</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  currentClient</span><span style=\"color:#24292E\">()</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> Promise</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">Client</span><span style=\"color:#24292E\">> </span><span style=\"color:#D73A49\">|</span><span style=\"color:#005CC5\"> null</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  isDestroyed</span><span style=\"color:#24292E\">()</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> boolean</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  onState</span><span style=\"color:#24292E\">(</span><span style=\"color:#E36209\">cb</span><span style=\"color:#24292E\">)</span><span style=\"color:#D73A49\">:</span><span style=\"color:#24292E\"> () </span><span style=\"color:#D73A49\">=></span><span style=\"color:#005CC5\"> void</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  markConnected</span><span style=\"color:#24292E\">()</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> void</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  destroy</span><span style=\"color:#24292E\">()</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> void</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  reconnect</span><span style=\"color:#24292E\">()</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> void</span><span style=\"color:#24292E\">;                      </span><span style=\"color:#6A737D\">// universal to sessions (roadblock 2)</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  recheck</span><span style=\"color:#24292E\">()</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> void</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  identity</span><span style=\"color:#24292E\">()</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> SurfaceIdentity</span><span style=\"color:#24292E\">;            </span><span style=\"color:#6A737D\">// universal, TOTAL — a null-free sum; \"no link\" is a kind, not null</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">}</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#D73A49\">interface</span><span style=\"color:#6F42C1\"> DaemonSession</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">Client</span><span style=\"color:#24292E\">> </span><span style=\"color:#D73A49\">extends</span><span style=\"color:#6F42C1\"> Session</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#6F42C1\">Client</span><span style=\"color:#24292E\">> {</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  convergence</span><span style=\"color:#24292E\">()</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> DaemonConvergence</span><span style=\"color:#D73A49\"> |</span><span style=\"color:#005CC5\"> null</span><span style=\"color:#24292E\">;   </span><span style=\"color:#6A737D\">// ONLY supervision is daemon-specific</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  readonly</span><span style=\"color:#E36209\"> preservation</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> PreservationStrategy</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  renew</span><span style=\"color:#24292E\">()</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> Promise</span><span style=\"color:#24292E\">&#x3C;</span><span style=\"color:#005CC5\">void</span><span style=\"color:#24292E\">>;</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">}</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"The one real cost of bundling, named honestly — ",
			createVNode(_components.strong, { children: "every surface’s contract test changes" }),
			", and here’s why that test exists:"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "What the contract set-equality test is FOR — and why bundling trips all of them",
			children: [
				createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6F42C1\">test</span><span style=\"color:#24292E\">(</span><span style=\"color:#032F62\">\"laneSurface members\"</span><span style=\"color:#24292E\">, () </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> {</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  expect</span><span style=\"color:#24292E\">(</span><span style=\"color:#6F42C1\">memberNames</span><span style=\"color:#24292E\">(laneSurface)).</span><span style=\"color:#6F42C1\">toEqual</span><span style=\"color:#24292E\">(</span><span style=\"color:#D73A49\">new</span><span style=\"color:#6F42C1\"> Set</span><span style=\"color:#24292E\">([</span><span style=\"color:#032F62\">\"progress\"</span><span style=\"color:#24292E\">, </span><span style=\"color:#032F62\">\"logLine\"</span><span style=\"color:#24292E\">, </span><span style=\"color:#032F62\">\"result\"</span><span style=\"color:#24292E\">]));</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span></code></pre>" }),
				createVNode(_components.p, { children: [
					"A surface is a ",
					createVNode(_components.strong, { children: "contract between two processes" }),
					" (one serves, one consumes, often on different machines). ",
					createVNode(_components.strong, { children: "The set of members IS the contract." }),
					" This test freezes that set so a member can never be added or dropped ",
					createVNode(_components.em, { children: "by accident" }),
					" — any change fails the test and forces a human to ratify it deliberately."
				] }),
				createVNode(_components.p, { children: [
					"Adding ",
					createVNode(_components.code, { children: "system.identity" }),
					" to the reserved ",
					createVNode(_components.code, { children: "system" }),
					" namespace changes every surface’s member set, so ",
					createVNode(_components.strong, { children: "every one of these tests updates to include it." }),
					" That is not a problem to route around — it is the test doing its job: each update is the deliberate, reviewed ratification of the (intended) contract change. Mechanical churn across three repos, all in this PR, all moving together."
				] })
			]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "2-fleet-verbs-go-on-session-srids-call--cleaner",
			children: [
				"2. Fleet verbs go on ",
				createVNode(_components.code, { children: "Session" }),
				" (srid’s call — cleaner)"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"You asked why ",
			createVNode(_components.code, { children: "reconnect()" }),
			"/",
			createVNode(_components.code, { children: "recheck()" }),
			" can’t just be on ",
			createVNode(_components.code, { children: "Session" }),
			". They can, and they should — same reason the role is ",
			createVNode(_components.code, { children: "Session" }),
			" not ",
			createVNode(_components.code, { children: "ReconnectingSession" }),
			": every session reconnects (a one-shot is a ",
			createVNode(_components.em, { children: "dial" }),
			", not a session), so the manual triggers of that universal capability belong on the role. That’s why they’re already in the ",
			createVNode(_components.code, { children: "Session" }),
			" interface above — no ",
			createVNode(_components.code, { children: "Session & { reconnect; recheck }" }),
			" intersection."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Whether a ",
			createVNode(_components.strong, { children: "registry" }),
			" surfaces ",
			createVNode(_components.code, { children: "registry.reconnect(host)" }),
			" is still a per-registry choice (S2) — the session always has the method; the registry exposes a fleet verb only when built with ",
			createVNode(_components.code, { children: "controls" }),
			" (drishti’s fleet does; kolu’s future pool need not):"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6F42C1\">buildHostRegistry</span><span style=\"color:#24292E\">({</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">  buildEntry</span><span style=\"color:#24292E\">: (</span><span style=\"color:#E36209\">host</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> ({ session: </span><span style=\"color:#6F42C1\">makeSession</span><span style=\"color:#24292E\">({ connectOnce: </span><span style=\"color:#6F42C1\">sshConnector</span><span style=\"color:#24292E\">({ host }) }), handler }),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  controls: { </span><span style=\"color:#6F42C1\">reconnect</span><span style=\"color:#24292E\">: (</span><span style=\"color:#E36209\">s</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> s.</span><span style=\"color:#6F42C1\">reconnect</span><span style=\"color:#24292E\">(), </span><span style=\"color:#6F42C1\">recheck</span><span style=\"color:#24292E\">: (</span><span style=\"color:#E36209\">s</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> s.</span><span style=\"color:#6F42C1\">recheck</span><span style=\"color:#24292E\">() }, </span><span style=\"color:#6A737D\">// trivial passthrough now</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// controls supplied ⇒ registry.reconnect(host)/recheckAll() EXIST (typed). Omitted ⇒ they don't.</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"(",
			createVNode(_components.code, { children: "reServeSurface" }),
			" consumes ",
			createVNode(_components.code, { children: "Session" }),
			" and carries ",
			createVNode(_components.code, { children: "reconnect" }),
			"/",
			createVNode(_components.code, { children: "recheck" }),
			" it never calls — harmless, since they’re ",
			createVNode(_components.em, { children: "guaranteed present" }),
			", not optional-maybe-absent. The registry’s own slot stays minimal ",
			createVNode(_components.code, { children: "DestroyableSession { destroy() }" }),
			".)"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "3-the-name-surfaceidentity-srids-call--the-better-one",
			children: [
				"3. The name: ",
				createVNode(_components.code, { children: "SurfaceIdentity" }),
				" (srid’s call — the better one)"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"You proposed ",
			createVNode(_components.code, { children: "SurfaceIdentity" }),
			"; it’s better than ",
			createVNode(_components.code, { children: "ServerIdentity" }),
			", and ",
			createVNode(_components.code, { children: "system.identity" }),
			" is exactly why: identity is literally a ",
			createVNode(_components.strong, { children: "reserved member of every surface" }),
			", so the value is ",
			createVNode(_components.em, { children: "“the identity a surface carries”" }),
			" — named for the framework’s core noun, and dodging the overloaded word “server” (kolu-",
			createVNode(_components.em, { children: "server" }),
			" means something else)."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// @kolu/surface — a SUM, no nulls (final shape; see roadblock 5)</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">type</span><span style=\"color:#6F42C1\"> SurfaceIdentity</span><span style=\"color:#D73A49\"> =</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  |</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">kind</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\"> \"disconnected\"</span><span style=\"color:#24292E\"> }</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  |</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">kind</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\"> \"anonymous\"</span><span style=\"color:#24292E\">;  </span><span style=\"color:#E36209\">startedAt</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> number</span><span style=\"color:#24292E\"> }</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  |</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">kind</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\"> \"identified\"</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">startedAt</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> number</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">baked</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> BakedIdentity</span><span style=\"color:#24292E\"> };</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">interface</span><span style=\"color:#6F42C1\"> BakedIdentity</span><span style=\"color:#24292E\"> {</span></span>\n<span class=\"line\"><span style=\"color:#E36209\">  contractVersion</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> string</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#E36209\">  buildId</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> string</span><span style=\"color:#24292E\">;                                             </span><span style=\"color:#6A737D\">// content hash — convergence CURRENCY (staleKey)</span></span>\n<span class=\"line\"><span style=\"color:#E36209\">  commit</span><span style=\"color:#D73A49\">:</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">kind</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\"> \"commit\"</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">sha</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> string</span><span style=\"color:#24292E\"> } </span><span style=\"color:#D73A49\">|</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">kind</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\"> \"dev\"</span><span style=\"color:#24292E\"> };  </span><span style=\"color:#6A737D\">// navigable vs dev — a SUM, distinct from buildId</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">}</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"Lives in ",
			createVNode(_components.strong, { children: createVNode(_components.code, { children: "@kolu/surface" }) }),
			" (the base package — it’s a universal surface member now). The colliding ",
			createVNode(_components.code, { children: "kolu-common ServerIdentity" }),
			" (the PWA identity) is kolu’s to rename; the framework name is perfect, the app moves."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "4-scope--the-framework-happens-in-full-only-kolus-pool-defers",
			children: [
				"4. Scope — the framework happens in full; only kolu’s ",
				createVNode(_components.em, { children: "pool" }),
				" defers"
			]
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "In THIS three-PR refactor" }),
					"\n",
					createVNode(_components.th, { children: "Out (its own later PR)" }),
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
						createVNode(_components.code, { children: "Session" }),
						" (identity · reconnect · recheck) / ",
						createVNode(_components.code, { children: "DaemonSession" }),
						" (convergence · renew · preservation) roles + all renames"
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: [
						"kolu-server GROWING a ",
						createVNode(_components.code, { children: "buildHostRegistry" }),
						" pool"
					] }), " (the W4 switch)"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: createVNode(_components.code, { children: "system.identity" }) }),
						" — the new reserved member (twin of ",
						createVNode(_components.code, { children: "system.live" }),
						"), framework-stamped on every surface; ",
						createVNode(_components.code, { children: "identity()" }),
						" on the base role; every contract test updated"
					] }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "makeSession" }),
						" + ",
						createVNode(_components.code, { children: "sshConnector" }),
						" + ",
						createVNode(_components.code, { children: "endpointConnector" })
					] }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: [
						"S1/S2: ",
						createVNode(_components.code, { children: "buildHostRegistry" }),
						" → ",
						createVNode(_components.code, { children: "DestroyableSession" }),
						" slot + typed ",
						createVNode(_components.code, { children: "controls" })
					] }) }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"S10: delete ",
						createVNode(_components.code, { children: "getHostSession" }),
						" + the global pool + evict/destroyAll"
					] }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "Migrate the three existing consumers: kolu single-padi arm · drishti fleet · odu lanes (odu owns its own teardown)" }),
					"\n",
					createVNode(_components.td, {}),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "5-systemidentity--where-does-the-data-come-from-needs-your-call",
			children: [
				"5. ",
				createVNode(_components.code, { children: "system.identity" }),
				" — where does the DATA come from? (needs your call)"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "No nulls anywhere" }),
			" (srid — make illegal states unrepresentable; don’t lean on ",
			createVNode(_components.code, { children: "null" }),
			"). Every state of “who is the far end” is a named arm of ONE sum; the reader is forced to branch, and impossible states (identified-but-no-",
			createVNode(_components.code, { children: "startedAt" }),
			" · ",
			createVNode(_components.code, { children: "baked" }),
			"-while-disconnected · a commit that might-be-dev-might-be-error) simply can’t be written:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#D73A49\">type</span><span style=\"color:#6F42C1\"> BuildCommit</span><span style=\"color:#D73A49\"> =</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  |</span><span style=\"color:#24292E\"> { </span><span style=\"color:#D73A49\">readonly</span><span style=\"color:#E36209\"> kind</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\"> \"commit\"</span><span style=\"color:#24292E\">; </span><span style=\"color:#D73A49\">readonly</span><span style=\"color:#E36209\"> sha</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> string</span><span style=\"color:#24292E\"> }   </span><span style=\"color:#6A737D\">// a navigable commit — link to it</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  |</span><span style=\"color:#24292E\"> { </span><span style=\"color:#D73A49\">readonly</span><span style=\"color:#E36209\"> kind</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\"> \"dev\"</span><span style=\"color:#24292E\"> };                           </span><span style=\"color:#6A737D\">// built from an uncommitted tree — no navigable commit</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#D73A49\">interface</span><span style=\"color:#6F42C1\"> BakedIdentity</span><span style=\"color:#24292E\"> {           </span><span style=\"color:#6A737D\">// the server-DECLARED triple — always whole (matches readBakedIdentity)</span></span>\n<span class=\"line\"><span style=\"color:#E36209\">  contractVersion</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> string</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#E36209\">  buildId</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> string</span><span style=\"color:#24292E\">;</span></span>\n<span class=\"line\"><span style=\"color:#E36209\">  commit</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> BuildCommit</span><span style=\"color:#24292E\">;              </span><span style=\"color:#6A737D\">// a SUM, never `string | null` — dev-vs-real is explicit</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">}</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#D73A49\">type</span><span style=\"color:#6F42C1\"> SurfaceIdentity</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6A737D\">              // ONE sum. NO null. every state named.</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  |</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">kind</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\"> \"disconnected\"</span><span style=\"color:#24292E\"> }                                          </span><span style=\"color:#6A737D\">// no live link — nothing to identify</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  |</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">kind</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\"> \"anonymous\"</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">startedAt</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> number</span><span style=\"color:#24292E\"> }                          </span><span style=\"color:#6A737D\">// connected; server declared no build</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  |</span><span style=\"color:#24292E\"> { </span><span style=\"color:#E36209\">kind</span><span style=\"color:#D73A49\">:</span><span style=\"color:#032F62\"> \"identified\"</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">startedAt</span><span style=\"color:#D73A49\">:</span><span style=\"color:#005CC5\"> number</span><span style=\"color:#24292E\">; </span><span style=\"color:#E36209\">baked</span><span style=\"color:#D73A49\">:</span><span style=\"color:#6F42C1\"> BakedIdentity</span><span style=\"color:#24292E\"> };  </span><span style=\"color:#6A737D\">// connected; declared its build</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// on the Session role:</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">identity</span><span style=\"color:#24292E\">(): SurfaceIdentity;        </span><span style=\"color:#6A737D\">// TOTAL — never null; the caller matches on `.kind`</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: "Why this is the honest shape:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"No ",
					createVNode(_components.code, { children: "null" }),
					" doing double duty."
				] }),
				" The hack was ",
				createVNode(_components.code, { children: "identity(): … | null" }),
				" (null = no link) ",
				createVNode(_components.em, { children: "plus" }),
				" ",
				createVNode(_components.code, { children: "baked: … | null" }),
				" (null = no build) — two nulls, two meanings, a reader guessing which. Now each is a named ",
				createVNode(_components.code, { children: "kind" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Impossible states can’t be written." }),
				" ",
				createVNode(_components.code, { children: "startedAt" }),
				" exists only on the connected arms; ",
				createVNode(_components.code, { children: "baked" }),
				" only on ",
				createVNode(_components.code, { children: "identified" }),
				"; ",
				createVNode(_components.code, { children: "commit" }),
				" is never a bare string that might secretly mean “dev”. No contradiction is constructible."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "padi" }),
				" (the sole reader) matches ",
				createVNode(_components.code, { children: "disconnected | identified" }),
				"; ",
				createVNode(_components.code, { children: "anonymous" }),
				" honestly covers drishti/odu"
			] }), " (connected, declared nothing) — no fake, no sentinel."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Load-bearing fact:" }),
			" only kolu-server’s padi arm ever ",
			createVNode(_components.em, { children: "reads" }),
			" ",
			createVNode(_components.code, { children: ".identity()" }),
			". drishti + odu never do. So only ",
			createVNode(_components.strong, { children: "padi" }),
			" declares a ",
			createVNode(_components.code, { children: "baked" }),
			"."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// ── OPTION A (recommended) — implementSurface takes an optional identity; only padi wires it ──</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">implementSurface</span><span style=\"color:#24292E\">(surface, deps, { identity?: SurfaceIdentity });</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// padi — the one server whose identity is read — declares its baked identity:</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">implementSurface</span><span style=\"color:#24292E\">(padiSurface, deps, {</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">  identity: { contractVersion: </span><span style=\"color:#005CC5\">PADI_SURFACE_VERSION</span><span style=\"color:#24292E\">, </span><span style=\"color:#D73A49\">...</span><span style=\"color:#6F42C1\">readBakedIdentity</span><span style=\"color:#24292E\">(</span><span style=\"color:#032F62\">\"PADI\"</span><span style=\"color:#24292E\">) }, </span><span style=\"color:#6A737D\">// → framework serves { kind:\"identified\", startedAt, baked }</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">});</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// drishti-agent / odu-runner — omit it → the framework serves { kind:\"anonymous\", startedAt }. No sentinel; nobody reads it:</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">implementSurface</span><span style=\"color:#24292E\">(laneSurface, deps);</span></span></code></pre>" }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// ── OPTION B — truly zero-code, but a 3-repo-wide ripple for ZERO readers today ──</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">defineSurface</span><span style=\"color:#24292E\">(members, { contractVersion });   </span><span style=\"color:#6A737D\">// every defineSurface call changes</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// + every server's nix wrapper bakes framework-standard SURFACE_BUILD_ID / SURFACE_COMMIT</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// + padi's existing PADI_* must ALSO bake the standard names</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Why A:" }),
			" identity stays a ",
			createVNode(_components.em, { children: "universal capability" }),
			" (member on every surface, ",
			createVNode(_components.code, { children: "identity()" }),
			" on base role) while the ",
			createVNode(_components.em, { children: "source" }),
			" is wired only where read (padi). B builds baked-var machinery for identity on drishti/odu that ",
			createVNode(_components.strong, { children: "has no reader" }),
			" — a receptacle for population zero. A doesn’t foreclose B later."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Two consequences to reconcile:" }),
			" (1) the L3 convergence kit’s ",
			createVNode(_components.code, { children: "buildId === \"\"" }),
			" “off-nix” check becomes ",
			createVNode(_components.code, { children: "baked === null" }),
			" — the same sentinel-removal one layer down. (2) the dialog’s build-commit line branches on the ",
			createVNode(_components.code, { children: "BuildCommit" }),
			" sum — ",
			createVNode(_components.code, { children: "kind:\"commit\"" }),
			" → a navigable link, ",
			createVNode(_components.code, { children: "kind:\"dev\"" }),
			" → a “dev build” badge (no more null-means-maybe-dev-maybe-error)."
		] }),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [createVNode(_components.strong, { children: [
				"A (with the ",
				createVNode(_components.code, { children: "Maybe" }),
				"-typed identity above)?"
			] }), " — needs your call. Agent is building everything else meanwhile."] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "6-the-convergence-kits-buildid----ruled-fix-it-here-srid",
			children: [
				"6. The convergence kit’s ",
				createVNode(_components.code, { children: "buildId === \"\"" }),
				" — RULED: fix it here (srid)"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Surfaced mid-build. There are ",
			createVNode(_components.strong, { children: "two separate “what build is padi?” paths, on two different wires" }),
			" — and only one is in this PR’s scope:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// PATH 1 — the READOUT (this PR fully converts it to the null-free sum):</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">session.</span><span style=\"color:#6F42C1\">identity</span><span style=\"color:#24292E\">()   </span><span style=\"color:#6A737D\">// → { kind:\"identified\", startedAt, baked:{ …, commit: BuildCommit } }</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//   the dialogs read this; commit branches: {kind:\"commit\"} → link · {kind:\"dev\"} → badge.  ✅ done here.</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// PATH 2 — the CONVERGENCE decision (a DIFFERENT wire: control-core hello, not system.identity):</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// packages/surface-daemon-supervisor/.../decide.ts</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">if</span><span style=\"color:#24292E\"> (baked.buildId </span><span style=\"color:#D73A49\">===</span><span style=\"color:#032F62\"> \"\"</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">return</span><span style=\"color:#032F62\"> \"adopt\"</span><span style=\"color:#24292E\">;   </span><span style=\"color:#6A737D\">// \"\" = off-nix, can't judge builds — the OLD sentinel</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//   reads ConvergenceIdentity {contractVersion, buildId} off control.core.hello().</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//   NOT touched by the readout refactor. This is the exact hack L26 targets.</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: "Two options:" }),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "srid RULED (a) — the sentinel dies in THIS PR (2026-07-05)." }),
				" ",
				createVNode(_components.em, { children: "Why it was still there:" }),
				" the null-free ",
				createVNode(_components.code, { children: "SurfaceIdentity" }),
				" sum lives on the ",
				createVNode(_components.code, { children: "system.identity" }),
				" wire (what the dialogs read); the convergence decision reads padi’s build off a DIFFERENT wire (",
				createVNode(_components.code, { children: "control.core.hello" }),
				" → ",
				createVNode(_components.code, { children: "ConvergenceIdentity" }),
				"), which the readout refactor never reached — so the ",
				createVNode(_components.code, { children: "buildId === \"\"" }),
				" sentinel sat untouched. srid’s point: shipping the clean design while the SAME-data sentinel survives one wire over is the exact “two ways to say the same thing” incoherence the refactor exists to kill. ",
				createVNode(_components.strong, { children: "It must not survive the PR that establishes the rule." })
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The fix (a):" }),
			" make the convergence identity null-free too — off-nix becomes a ",
			createVNode(_components.em, { children: "typed" }),
			" absence (a ",
			createVNode(_components.code, { children: "kind" }),
			"/null), never ",
			createVNode(_components.code, { children: "\"\"" }),
			"; ",
			createVNode(_components.code, { children: "decide.ts" }),
			" matches that instead of ",
			createVNode(_components.code, { children: "=== \"\"" }),
			". Behavior-preserving shape swap (the agent confirmed), touching surface-daemon-supervisor + control-core hello + ",
			createVNode(_components.code, { children: "probePadiForConvergence" }),
			"."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "One thing for the agent to report, not decide:" }),
			" the deeper coherence win is convergence consuming the SAME identity representation as the readout (one identity, not two) — but convergence may ",
			createVNode(_components.em, { children: "need" }),
			" its own ",
			createVNode(_components.code, { children: "control.core.hello" }),
			" wire (pre-handshake, version-agnostic — it runs before the surface is established). So: kill the sentinel now (make ",
			createVNode(_components.code, { children: "ConvergenceIdentity" }),
			" null-free on its existing wire); and tell the coordinator whether unifying the two identity paths is safe or whether the control-core wire is load-bearing for pre-handshake convergence. If unification would force a behavior change, STOP — that’s a separate decision."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "L26 no longer owns this instance" }),
			" (this PR does); L26 keeps the ",
			createVNode(_components.em, { children: "other" }),
			", scattered null/sentinel instances + the lint."
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: "(Q1 identity-sourcing and Q2 endpointConnector-is-a-kolu-leaf were pure confirmations of the ratified design — resolved, not open.)" }) }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Unification question RESOLVED (agent report, 2026-07-05): the two identity wires do NOT unify — the control-core wire is load-bearing." }),
			" Convergence must read a running daemon’s identity ",
			createVNode(_components.em, { children: "pre-handshake and across a contract skew" }),
			" (",
			createVNode(_components.code, { children: "controlCore.ts" }),
			": “the version-agnostic side channel — a binder dials the running daemon and reads its identity at ANY skew”); deciding whether to drain a skewed daemon is the whole point. ",
			createVNode(_components.code, { children: "system.identity" }),
			" lives on the ",
			createVNode(_components.em, { children: "surface" }),
			", which needs a compatible handshake — unreachable exactly during a skew. So they’re not the “two ways to say the same thing” smell — they’re a ",
			createVNode(_components.strong, { children: "justified volatility separation" }),
			" (a version-agnostic side channel vs a surface readout). The fix kills the ",
			createVNode(_components.code, { children: "\"\"" }),
			" sentinel on ",
			createVNode(_components.strong, { children: "both" }),
			" wires ",
			createVNode(_components.em, { children: "independently" }),
			": the readout gets ",
			createVNode(_components.code, { children: "SurfaceIdentity" }),
			"; the convergence wire gets its own null-free ",
			createVNode(_components.code, { children: "DaemonBuild = { kind:\"known\"; id } | { kind:\"off-nix\" }" }),
			" (",
			createVNode(_components.code, { children: "decide.ts" }),
			" matches ",
			createVNode(_components.code, { children: ".kind === \"off-nix\"" }),
			", not ",
			createVNode(_components.code, { children: "=== \"\"" }),
			"), right-sized for what convergence needs (it judges builds by id; it doesn’t display commits). ",
			createVNode(_components.strong, { children: "Do not merge the wires" }),
			" — that would break skew-convergence; a future deeper unification would require the control core itself to carry a version-agnostic identity (a bigger, separate cut)."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "7-the-two-arms-dont-share-padiadmit--they-share-the-decision-build-time-ruled-a",
			children: [
				"7. The two arms don’t share ",
				createVNode(_components.code, { children: "padiAdmit" }),
				" — they share the DECISION (build-time; RULED (a))"
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"S9’s prose said “both arms share ",
			createVNode(_components.code, { children: "padiAdmit" }),
			"”. Building it revealed that quietly assumed both transports converge POST-connect — but they don’t, and the difference is real, rooted in the transports:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// REMOTE (ssh): hands you a RAW client → converge AFTER connect. `admit` IS that seam:</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> remotePadi</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> makeSession</span><span style=\"color:#24292E\">({ connectOnce: </span><span style=\"color:#6F42C1\">sshConnector</span><span style=\"color:#24292E\">({ binary: </span><span style=\"color:#032F62\">\"padi\"</span><span style=\"color:#24292E\"> }), admit: padiAdmit });</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// LOCAL (supervisor Endpoint): converges AS it connects, BY DESIGN —</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//   endpoint.adoptOrSpawnOrRefuse() = probe → decide → drain-enact → THEN connect.</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//   There is no \"raw adopt-or-spawn without the check\" method. So NO post-connect admit:</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">const</span><span style=\"color:#005CC5\"> localPadi</span><span style=\"color:#D73A49\"> =</span><span style=\"color:#6F42C1\"> makeSession</span><span style=\"color:#24292E\">({ connectOnce: </span><span style=\"color:#6F42C1\">endpointConnector</span><span style=\"color:#24292E\">(endpoint) });  </span><span style=\"color:#6A737D\">// admit omitted — self-converged</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// The REAL dedup both arms share (this is what S9 was actually after):</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//   • ONE PADI_CONVERGENCE_POLICY / decide()      • drainViaControlCore</span></span>\n<span class=\"line\"><span style=\"color:#6A737D\">//   • the daemon-member spread { ...base, convergence, renew, preservation }</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Ruling: (a)." }),
			" Local convergence stays pre-connect inside ",
			createVNode(_components.code, { children: "endpointConnector" }),
			" (the ",
			createVNode(_components.code, { children: "Endpoint" }),
			" is UNCHANGED — honors Q3’s “don’t touch surface-daemon-supervisor”); the remote arm carries ",
			createVNode(_components.code, { children: "admit: padiAdmit" }),
			". This is not a divergence from S9 — it’s the correct use of S9’s ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "admit?" }), " optional"] }),
			": the local connector already converges, so it has no post-connect hook to pass. It preserves both arms’ exact convergence timing, still deletes ",
			createVNode(_components.code, { children: "BoundPadi" }),
			" + the wrapper classes, and still collapses to closures + spread + one policy + one drain — S9’s whole intent."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Rejected ",
			createVNode(_components.strong, { children: "(b)" }),
			" (rip out the ",
			createVNode(_components.code, { children: "Endpoint" }),
			", force a shared post-connect admit): it deletes a working mechanism to rebuild local adopt-or-spawn from scratch, risks a local-convergence timing change (briefly connecting to an about-to-be-drained padi), and brushes the Q3 boundary — a bigger, riskier change for a ",
			createVNode(_components.em, { children: "literal" }),
			" symmetry the transports don’t support."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "status-of-the-four--all-resolved",
			children: "Status of the four — all resolved"
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "system.identity" }), " BUNDLED"] }),
				" — the new reserved ",
				createVNode(_components.code, { children: "system" }),
				"-namespace member (twin of ",
				createVNode(_components.code, { children: "system.live" }),
				"); ",
				createVNode(_components.code, { children: "identity()" }),
				" on the base ",
				createVNode(_components.code, { children: "Session" }),
				" role; no separate follow-up. ✅ srid’s call. (Name: ",
				createVNode(_components.code, { children: "system.identity" }),
				", NOT “universal hello”.)"
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "reconnect" }),
				"/",
				createVNode(_components.code, { children: "recheck" }),
				" on ",
				createVNode(_components.code, { children: "Session" })
			] }), " — ✅ srid’s call."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "SurfaceIdentity" }),
				" in ",
				createVNode(_components.code, { children: "@kolu/surface" })
			] }), " (rename kolu’s collider) — ✅ srid’s call."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Scope" }),
				": full framework reshape in (incl. ",
				createVNode(_components.code, { children: "system.identity" }),
				" + ",
				createVNode(_components.code, { children: "buildHostRegistry" }),
				" S1/S2); only kolu-server’s ",
				createVNode(_components.em, { children: "pool adoption" }),
				" (W4) out. ✅ confirmed."
			] }),
			"\n"
		] })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
function _missingMdxReference(id, component) {
	throw new Error("Expected " + (component ? "component" : "object") + " `" + id + "` to be defined: you likely forgot to import, pass, or provide it.");
}
var frontmatter = {
	"title": "Surface hosting — the four build-time roadblocks, in code",
	"description": "The implementing agent inventoried all three consumers (kolu · drishti · odu) and hit four design questions before writing code. Each answered here in code, refined with srid; the ratified answers fold into the plan.",
	"parents": [
		"reference",
		"padi",
		"surface"
	],
	"status": "proposed",
	"maturity": "seedling",
	"updated": "2026-07-05T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "1-systemidentity-is-in-this-pr--identity-on-the-base-session-role",
			"text": "1. system.identity is IN this PR — identity on the base Session role"
		},
		{
			"depth": 2,
			"slug": "2-fleet-verbs-go-on-session-srids-call--cleaner",
			"text": "2. Fleet verbs go on Session (srid’s call — cleaner)"
		},
		{
			"depth": 2,
			"slug": "3-the-name-surfaceidentity-srids-call--the-better-one",
			"text": "3. The name: SurfaceIdentity (srid’s call — the better one)"
		},
		{
			"depth": 2,
			"slug": "4-scope--the-framework-happens-in-full-only-kolus-pool-defers",
			"text": "4. Scope — the framework happens in full; only kolu’s pool defers"
		},
		{
			"depth": 2,
			"slug": "5-systemidentity--where-does-the-data-come-from-needs-your-call",
			"text": "5. system.identity — where does the DATA come from? (needs your call)"
		},
		{
			"depth": 2,
			"slug": "6-the-convergence-kits-buildid----ruled-fix-it-here-srid",
			"text": "6. The convergence kit’s buildId === \"\" — RULED: fix it here (srid)"
		},
		{
			"depth": 2,
			"slug": "7-the-two-arms-dont-share-padiadmit--they-share-the-decision-build-time-ruled-a",
			"text": "7. The two arms don’t share padiAdmit — they share the DECISION (build-time; RULED (a))"
		},
		{
			"depth": 2,
			"slug": "status-of-the-four--all-resolved",
			"text": "Status of the four — all resolved"
		}
	];
}
var url = "src/content/atlas/surface-hosting-roadblocks.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/surface-hosting-roadblocks.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/surface-hosting-roadblocks.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
