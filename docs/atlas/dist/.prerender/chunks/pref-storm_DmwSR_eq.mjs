import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import { t as $$Cite } from "./Cite_D-1zLbJ9.mjs";
//#region src/content/atlas/pref-storm.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		code: "code",
		em: "em",
		h2: "h2",
		h3: "h3",
		p: "p",
		strong: "strong",
		table: "table",
		tbody: "tbody",
		td: "td",
		th: "th",
		thead: "thead",
		tr: "tr"
	}, props.components);
	const { Fragment: Fragment$1 } = _components;
	if (!Fragment$1) _missingMdxReference("Fragment", true);
	return createVNode(Fragment, { children: [
		createVNode(_components.p, { children: createVNode(_components.em, { children: "Issue #1041 · part of #951 · pre-existing, surfaced by the #1034 daemon-restart postmortem." }) }),
		"\n",
		createVNode(_components.h2, {
			id: "what-was-happening",
			children: "What was happening"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The right-panel splitter and the Code-tab tree splitter are both ",
			createVNode(_components.code, { children: "@corvu/resizable" }),
			" ",
			createVNode(_components.strong, { children: "fully controlled" }),
			" by a ",
			createVNode(_components.code, { children: "sizes" }),
			" prop fed from the local-authority ",
			createVNode(_components.code, { children: "preferences" }),
			" store. Two facts about Corvu turn that into a write storm:"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "The two Corvu facts",
			children: [
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: [
						"1. Corvu re-emits on every reactive change to ",
						createVNode(_components.code, { children: "sizes" }),
						"."
					] }),
					" Its root component runs ",
					createVNode(_components.code, { children: "createEffect(() => onSizesChange(sizes()))" }),
					", and ",
					createVNode(_components.code, { children: "sizes()" }),
					" is a controllable signal whose value ",
					createVNode(_components.em, { children: "is" }),
					" the prop. So any reactive invalidation of the ",
					createVNode(_components.code, { children: "sizes" }),
					" prop re-fires ",
					createVNode(_components.code, { children: "onSizesChange" }),
					" with the same array."
				] }),
				createVNode(_components.p, { children: createVNode(_components.em, { children: [
					createVNode(_components.code, { children: "@corvu/resizable/dist/index.js" }),
					" (createEffect on sizes) · ",
					createVNode(_components.code, { children: "@corvu/utils" }),
					" controllableSignal.js:8-23 (controlled ⇒ no internal state)."
				] }) }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: [
						"2. Corvu emits a minSize-",
						createVNode(_components.em, { children: "corrected" }),
						" array on panel re-registration."
					] }),
					" ",
					createVNode(_components.code, { children: "registerPanel" }),
					" calls ",
					createVNode(_components.code, { children: "setSizes(redistribute)" }),
					" enforcing each panel’s ",
					createVNode(_components.code, { children: "minSize" }),
					" — a value that differs from what the app passed. Every mount/unmount of the panel subtree re-registers and re-emits."
				] }),
				createVNode(_components.p, { children: createVNode(_components.em, { children: [createVNode(_components.code, { children: "@corvu/resizable/dist/index.js" }), " registerPanel/unregisterPanel · createSize uses a ResizeObserver (size.js:4-30)."] }) })
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The handler persisted it on every emission, with ",
			createVNode(_components.strong, { children: "no" }),
			" equality gate and ",
			createVNode(_components.strong, { children: "no" }),
			" coalescing:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// App.tsx:604-614  (and CodeTab.tsx:482-483, vertical split)</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">onSizesChange</span><span style=\"color:#D73A49\">=</span><span style=\"color:#24292E\">{(sizes) => {</span></span>\n<span class=\"line\"><span style=\"color:#D73A49\">  if</span><span style=\"color:#24292E\"> (sizes[</span><span style=\"color:#005CC5\">1</span><span style=\"color:#24292E\">] </span><span style=\"color:#D73A49\">!==</span><span style=\"color:#005CC5\"> undefined</span><span style=\"color:#24292E\">) rightPanel.</span><span style=\"color:#6F42C1\">setPanelSize</span><span style=\"color:#24292E\">(sizes[</span><span style=\"color:#005CC5\">1</span><span style=\"color:#24292E\">]);</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">}}</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// useRightPanel.ts:118-128</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">setPanelSize</span><span style=\"color:#24292E\">: (</span><span style=\"color:#E36209\">size</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> { </span><span style=\"color:#D73A49\">if</span><span style=\"color:#24292E\"> (size </span><span style=\"color:#D73A49\">></span><span style=\"color:#005CC5\"> MIN_PANEL_SIZE</span><span style=\"color:#24292E\">) </span><span style=\"color:#6F42C1\">updatePreferences</span><span style=\"color:#24292E\">({ rightPanel: { size } }); },</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">setCodeTabTreeSize</span><span style=\"color:#24292E\">: (</span><span style=\"color:#E36209\">size</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> { </span><span style=\"color:#D73A49\">if</span><span style=\"color:#24292E\"> (size </span><span style=\"color:#D73A49\">>=</span><span style=\"color:#005CC5\"> MIN_TREE_SIZE</span><span style=\"color:#D73A49\"> &#x26;&#x26;</span><span style=\"color:#24292E\"> size </span><span style=\"color:#D73A49\">&#x3C;=</span><span style=\"color:#005CC5\"> MAX_TREE_SIZE</span><span style=\"color:#24292E\">) </span><span style=\"color:#6F42C1\">updatePreferences</span><span style=\"color:#24292E\">({ rightPanel: { codeTabTreeSize: size } }); },</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#6A737D\">// wire.ts:72-78 → useCell.ts:189-192 (local authority)</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">patch</span><span style=\"color:#24292E\">: </span><span style=\"color:#D73A49\">async</span><span style=\"color:#24292E\"> (</span><span style=\"color:#E36209\">p</span><span style=\"color:#24292E\">) </span><span style=\"color:#D73A49\">=></span><span style=\"color:#24292E\"> { </span><span style=\"color:#6F42C1\">applyLocal</span><span style=\"color:#24292E\">(p); </span><span style=\"color:#D73A49\">await</span><span style=\"color:#24292E\"> options.</span><span style=\"color:#6F42C1\">mutate</span><span style=\"color:#24292E\">(p); }   </span><span style=\"color:#6A737D\">// sync store write + server RPC, every call</span></span></code></pre>" }),
		"\n",
		createVNode("div", {
			style: {
				border: "1px solid var(--rule)",
				borderRadius: "10px",
				padding: "0.9rem 1.1rem",
				margin: "0.9rem 0",
				display: "flex",
				flexDirection: "column",
				gap: "0.35rem",
				fontFamily: "var(--mono)",
				fontSize: "0.78rem",
				background: "var(--surface)"
			},
			children: [
				createVNode("div", {
					style: {
						background: "var(--code-bg)",
						border: "1px solid var(--rule)",
						borderRadius: "6px",
						padding: "0.4rem 0.6rem"
					},
					children: "panel re-registers / collapsed toggles during restart churn"
				}),
				createVNode("div", {
					style: {
						color: "var(--ink-muted)",
						paddingLeft: "0.6rem"
					},
					children: [
						"↓ reactive invalidation of the ",
						createVNode(_components.code, { children: "sizes" }),
						" prop"
					]
				}),
				createVNode("div", {
					style: {
						background: "var(--code-bg)",
						border: "1px solid var(--rule)",
						borderRadius: "6px",
						padding: "0.4rem 0.6rem"
					},
					children: [
						"Corvu ",
						createVNode(_components.code, { children: "createEffect" }),
						" fires ",
						createVNode(_components.code, { children: "onSizesChange([…])" })
					]
				}),
				createVNode("div", {
					style: {
						color: "var(--ink-muted)",
						paddingLeft: "0.6rem"
					},
					children: "↓"
				}),
				createVNode("div", {
					style: {
						background: "var(--code-bg)",
						border: "1px solid var(--rule)",
						borderRadius: "6px",
						padding: "0.4rem 0.6rem"
					},
					children: [
						createVNode(_components.code, { children: "setPanelSize" }),
						" → ",
						createVNode(_components.code, { children: "updatePreferences({rightPanel:{size}})" })
					]
				}),
				createVNode("div", {
					style: {
						color: "var(--ink-muted)",
						paddingLeft: "0.6rem"
					},
					children: "↓"
				}),
				createVNode("div", {
					style: {
						background: "var(--code-bg)",
						border: "1px solid var(--rule)",
						borderRadius: "6px",
						padding: "0.4rem 0.6rem"
					},
					children: [
						createVNode(_components.code, { children: "useCell.patch" }),
						": ",
						createVNode(_components.code, { children: "applyLocal" }),
						" (sync store) + ",
						createVNode(_components.code, { children: "mutate" }),
						" → ",
						createVNode(_components.strong, { children: "server RPC" })
					]
				}),
				createVNode("div", {
					style: {
						color: "var(--ink-muted)",
						paddingLeft: "0.6rem"
					},
					children: [
						"↓ server writes ",
						createVNode(_components.code, { children: "state.json" }),
						" on every patch (no ",
						createVNode(_components.code, { children: "equals" }),
						" on the prefs cell)"
					]
				}),
				createVNode("div", {
					style: {
						background: "#eff6f0",
						border: "1px solid #bce3c8",
						borderRadius: "6px",
						padding: "0.4rem 0.6rem"
					},
					children: "~200 patches/min · contends with the session autosave on the shared Conf store"
				})
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The shared sink is real: ",
			createVNode(_components.code, { children: "preferences" }),
			" and the session autosave are two keys in ",
			createVNode(_components.em, { children: "one" }),
			" ",
			createVNode(_components.code, { children: "Conf" }),
			" store writing ",
			createVNode(_components.em, { children: "one" }),
			" ",
			createVNode(_components.code, { children: "state.json" }),
			"; the autosave is a 500\xA0ms throttle, preferences is one-disk-write-per-patch."
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			createVNode(_components.code, { children: "state.ts:88-127" }),
			" (single Conf, prefs+session keys) · ",
			createVNode(_components.code, { children: "session.ts:114-133" }),
			" (500ms autosave) · ",
			createVNode(_components.code, { children: "server.ts:134-143" }),
			" (",
			createVNode(_components.code, { children: "applyAndPublish" }),
			" equals gate) · ",
			createVNode(_components.code, { children: "surface.ts:99-114" }),
			" prefs cell has ",
			createVNode(_components.em, { children: "no" }),
			" equals; ",
			createVNode(_components.code, { children: ":128" }),
			" session cell does."
		] }) }),
		"\n",
		createVNode(_components.h2, {
			id: "the-pivotal-constraint-this-is-what-picks-the-design",
			children: "The pivotal constraint (this is what picks the design)"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Could we just stop controlling Corvu (pass ",
			createVNode(_components.code, { children: "initialSizes" }),
			", let Corvu own live size, debounce the whole write)? ",
			createVNode(_components.strong, { children: "No." }),
			" ",
			createVNode(_components.code, { children: "ChromeBar" }),
			" reads the panel size ",
			createVNode(_components.em, { children: "reactively, mid-drag" }),
			", to keep the floating chrome’s right edge pinned to the panel’s left edge:"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"ts\"><code><span class=\"line\"><span style=\"color:#6A737D\">// ChromeBar.tsx:112-114</span></span>\n<span class=\"line\"><span style=\"color:#6F42C1\">right</span><span style=\"color:#24292E\">: rightPanel.</span><span style=\"color:#6F42C1\">collapsed</span><span style=\"color:#24292E\">() </span><span style=\"color:#D73A49\">?</span><span style=\"color:#005CC5\"> 0</span><span style=\"color:#D73A49\"> :</span><span style=\"color:#032F62\"> `${</span><span style=\"color:#24292E\">rightPanel</span><span style=\"color:#032F62\">.</span><span style=\"color:#6F42C1\">panelSize</span><span style=\"color:#032F62\">() </span><span style=\"color:#D73A49\">*</span><span style=\"color:#005CC5\"> 100</span><span style=\"color:#032F62\">}vw`</span><span style=\"color:#24292E\">,</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			"If the store lagged the drag, the chrome controls would visibly trail the splitter. So the ",
			createVNode(_components.strong, { children: "local store write must stay synchronous every frame" }),
			"; only the ",
			createVNode(_components.strong, { children: "server RPC" }),
			" may be deferred. That rules out the uncontrolled-Corvu refactor and forces a split: apply-local-now, flush-to-server-later."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-fix",
			children: "The fix"
		}),
		"\n",
		createVNode(_components.h3, {
			id: "1-drop-corvus-idempotent-re-emits--",
			children: [
				createVNode($$Pill, {
					variant: "ok",
					children: "1"
				}),
				" Drop Corvu’s idempotent re-emits — ",
				createVNode($$Cite, {
					file: "packages/client/src/right-panel/useRightPanel.ts",
					label: "useRightPanel.ts"
				})
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The size mutators are the adapter for Corvu’s re-emit quirk — so they filter it. Skip the write when the value matches the stored value within Corvu’s precision (it rounds to 6 decimals). This alone kills the ",
			createVNode(_components.em, { children: "steady-state" }),
			" storm: every unchanged re-emit becomes a true no-op (before the fix, it fired an RPC on every re-emit before ",
			createVNode(_components.code, { children: "reconcile" }),
			" dedup’d the store)."
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"diff\"><code><span class=\"line\"><span style=\"color:#24292E\"> const EPSILON = 1e-6; // Corvu fixToPrecision rounds to PRECISION=6</span></span>\n<span class=\"line\"><span style=\"color:#24292E\"> setPanelSize: (size) => {</span></span>\n<span class=\"line\"><span style=\"color:#22863A\"><span style=\"user-select: none;\">+</span>  if (size > MIN_PANEL_SIZE &#x26;&#x26; Math.abs(size - rp().size) > EPSILON)</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">     updatePreferences({ rightPanel: { size } });</span></span>\n<span class=\"line\"><span style=\"color:#24292E\"> },</span></span>\n<span class=\"line\"><span style=\"color:#24292E\"> // same Math.abs(size - rp().codeTabTreeSize) > EPSILON guard on setCodeTabTreeSize</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: "Framed as “filter Corvu’s idempotent re-emits,” not “reduce server load” — that’s why it lives at the adapter and not in the transport layer (per Lowy)." }) }),
		"\n",
		createVNode(_components.h3, {
			id: "2-coalesce-the-server-flush-at-the-localserver-seam--",
			children: [
				createVNode($$Pill, {
					variant: "ok",
					children: "2"
				}),
				" Coalesce the server flush at the local/server seam — ",
				createVNode($$Cite, {
					file: "packages/surface/src/solid/useCell.ts",
					label: "useCell.ts (useCellLocal)"
				})
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A real drag emits dozens of ",
			createVNode(_components.em, { children: "distinct" }),
			" values/sec, each passing guard\xA01. Those are the legitimate burst to collapse. The split lives where the local/server boundary already lives — inside ",
			createVNode(_components.code, { children: "useCellLocal" }),
			", the one place that owns “apply locally, then tell the server.” Add an opt-in ",
			createVNode(_components.code, { children: "coalesceMs" }),
			"; the cell ",
			createVNode(_components.em, { children: "owner" }),
			" declares its flush cadence in ",
			createVNode(_components.code, { children: "wire.ts" }),
			":"
		] }),
		"\n",
		createVNode(Fragment$1, { "set:html": "<pre class=\"astro-code github-light\" style=\"background-color:#fff;color:#24292e; overflow-x: auto;\" tabindex=\"0\" data-language=\"diff\"><code><span class=\"line\"><span style=\"color:#24292E\"> // useCellLocal: apply locally every call (sync — ChromeBar tracks live),</span></span>\n<span class=\"line\"><span style=\"color:#24292E\"> // trailing-debounce only the server mutate.</span></span>\n<span class=\"line\"><span style=\"color:#24292E\"> patch: async (p) => {</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">   applyLocal(p);                         // sync store write, unchanged</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">   if (coalesce) coalesce.push(p);        // trailing debounce → mutate(merged)</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">   else await options.mutate(p);</span></span>\n<span class=\"line\"><span style=\"color:#24292E\"> },</span></span>\n<span class=\"line\"></span>\n<span class=\"line\"><span style=\"color:#24292E\"> // wire.ts — opt in for preferences only:</span></span>\n<span class=\"line\"><span style=\"color:#24292E\"> app.cells.preferences.use({ authority: \"local\", initial: DEFAULT_PREFERENCES,</span></span>\n<span class=\"line\"><span style=\"color:#22863A\"><span style=\"user-select: none;\">+</span>  coalesceMs: 150,</span></span>\n<span class=\"line\"><span style=\"color:#24292E\">   onError });</span></span></code></pre>" }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Merge in patch-space, don’t snapshot." }),
			" The coalescer accumulates pending patches by folding them through the cell’s existing patch-merge into one ",
			createVNode(_components.code, { children: "PreferencesPatch" }),
			", then flushes that. This keeps the wire payload in ",
			createVNode(_components.code, { children: "P" }),
			" (patch) space — so an interleaved ",
			createVNode(_components.code, { children: "{collapsed}" }),
			" write inside the 150\xA0ms window is ",
			createVNode(_components.em, { children: "merged in" }),
			", not clobbered, and we never push a full ",
			createVNode(_components.code, { children: "Preferences" }),
			" (",
			createVNode(_components.code, { children: "T" }),
			") through a ",
			createVNode(_components.code, { children: "patch" }),
			"-typed ",
			createVNode(_components.code, { children: "mutate" }),
			". ",
			createVNode(_components.em, { children: "(This is the post-review shape — see below.)" })
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "3-defense-in-depth-equals-on-the-server-prefs-cell--",
			children: [
				createVNode($$Pill, {
					variant: "ok",
					children: "3"
				}),
				" Defense-in-depth: ",
				createVNode(_components.code, { children: "equals" }),
				" on the server prefs cell — ",
				createVNode($$Cite, {
					file: "packages/server/src/surface.ts",
					label: "server surface.ts"
				})
			]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Mirror the ",
			createVNode(_components.code, { children: "session" }),
			" cell’s ",
			createVNode(_components.code, { children: "equals" }),
			" so any no-op patch that still reaches the server skips the disk write + republish. Honest billing: once the client drops no-ops (1) and coalesces (2), this is belt-and-suspenders — it only catches the rare unchanged-final-value case. One line, established precedent, fine to land; not load-bearing."
		] }),
		"\n",
		createVNode(_components.h3, {
			id: "test-regression-guard",
			children: [createVNode($$Pill, {
				variant: "ok",
				children: "test"
			}), " Regression guard"]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Unit tests assert bounded patch rate during a resize interaction: a tight loop of ",
			createVNode(_components.em, { children: "unchanged" }),
			" values emits zero RPCs (guard 1); a rapid sequence of ",
			createVNode(_components.em, { children: "changing" }),
			" values emits ≤1 trailing RPC per window (coalesce 2) — ",
			createVNode(_components.code, { children: "useCellCoalesce.test.ts" }),
			" plus coalesce assertions in ",
			createVNode(_components.code, { children: "useRightPanel.test.ts" }),
			"."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "reviewer-pass--what-changed",
			children: "Reviewer pass — what changed"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Hickey + Lowy converged · ADOPTED",
			children: createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "The original sketch flushed “the latest full store snapshot.”" }),
				" Both reviewers flagged this complects two decisions under one flag: ",
				createVNode(_components.em, { children: "timing" }),
				" (debounce) and ",
				createVNode(_components.em, { children: "payload shape" }),
				" (patch → full replacement). It also pushes a full ",
				createVNode(_components.code, { children: "Preferences" }),
				" (",
				createVNode(_components.code, { children: "T" }),
				") through a ",
				createVNode(_components.code, { children: "mutate" }),
				" bound to ",
				createVNode(_components.code, { children: "ns.patch" }),
				" (",
				createVNode(_components.code, { children: "P" }),
				") — works by accident for prefs only, breaks for any future cell where ",
				createVNode(_components.code, { children: "P≠T" }),
				" or ",
				createVNode(_components.code, { children: "patch" }),
				" is non-idempotent. ",
				createVNode(_components.strong, { children: "Revised:" }),
				" coalesce by ",
				createVNode(_components.em, { children: "merging patches in P-space" }),
				" (fold through the cell’s own patch-merge). ",
				createVNode(_components.code, { children: "coalesceMs" }),
				" now governs timing only."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Lowy · ADOPTED (deciding fact)",
			children: createVNode(_components.p, { children: [
				"Pinned the controlled-vs-uncontrolled fork to a single fact — “does anything read the size mid-drag?” — and it does (",
				createVNode(_components.code, { children: "ChromeBar.tsx:114" }),
				"). Uncontrolled Corvu is the cleaner boundary ",
				createVNode(_components.em, { children: "only if" }),
				" nothing reads the store live; since ChromeBar does, controlled + coalesce is forced. Recorded as the pivotal constraint above."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Lowy · ADOPTED (reframe)",
			children: createVNode(_components.p, { children: [
				"No-op drop (1) is ",
				createVNode(_components.em, { children: "not" }),
				" patch-rate control duplicating the coalesce — it’s Corvu-re-emit/idempotency filtering at the adapter. Keeping it in ",
				createVNode(_components.code, { children: "useRightPanel" }),
				" is right ",
				createVNode(_components.em, { children: "under that framing" }),
				"; the comment names it accordingly. The 1-in-useRightPanel / 2-in-useCell split is a correct layer split (domain quirk vs. generic transport), confirmed by both — not fragmentation."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "Hickey · ADOPTED (DX · contract)",
			children: createVNode(_components.p, { children: [
				"Debouncing changes what ",
				createVNode(_components.code, { children: "useCellLocal.patch" }),
				"’s returned promise ",
				createVNode(_components.em, { children: "means" }),
				": “parked in the queue,” not “server has it.” Document on the ",
				createVNode(_components.code, { children: "coalesceMs" }),
				" option. The only consumer today (",
				createVNode(_components.code, { children: "updatePreferences" }),
				") is fire-and-forget, so no caller breaks — but any future awaiting caller (e2e step gating on server state) must gate on the server echo, not the ",
				createVNode(_components.code, { children: "patch" }),
				" return."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Lowy · REJECTED",
			children: createVNode(_components.p, { children: [
				"Lowy’s resolution for the snapshot problem was “make preferences ",
				createVNode(_components.em, { children: "always" }),
				" flush full snapshots.” Rejected: the prefs contract has no ",
				createVNode(_components.code, { children: "set" }),
				"/full-replacement verb — its ",
				createVNode(_components.code, { children: "mutate" }),
				" is patch-typed — so “always snapshot” reintroduces exactly the ",
				createVNode(_components.code, { children: "T" }),
				"-through-",
				createVNode(_components.code, { children: "P" }),
				" type confusion. Hickey’s patch-space merge achieves the same “no key lost” guarantee without a new verb."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "note",
			title: "Both · CONFIRMED no duplication",
			children: createVNode(_components.p, { children: [
				"The client trailing coalesce does ",
				createVNode(_components.em, { children: "not" }),
				" reinvent the server 500ms autosave (different side of the wire; leading vs. trailing is semantically required), ",
				createVNode(_components.code, { children: "debouncedFit" }),
				" (local-only, no server), or the ",
				createVNode(_components.code, { children: "equals" }),
				" gate (which part 3 ",
				createVNode(_components.em, { children: "extends" }),
				"). Reaching for ",
				createVNode(_components.code, { children: "@solid-primitives/scheduled" }),
				" matches the repo’s “prefer community primitives” convention."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "surface--sequencing",
			children: "Surface & sequencing"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "File" }),
					"\n",
					createVNode(_components.th, { children: "Change" }),
					"\n",
					createVNode(_components.th, { children: "Part" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "useRightPanel.ts" }) }),
					"\n",
					createVNode(_components.td, { children: "EPSILON no-op guard in the two size mutators" }),
					"\n",
					createVNode(_components.td, { children: "1" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "useCell.ts" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "coalesceMs" }), " opt-in: sync local apply + trailing patch-merge flush; doc the await-contract change"] }),
					"\n",
					createVNode(_components.td, { children: "2" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "wire.ts" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "coalesceMs: 150" }),
						" on the preferences cell; add ",
						createVNode(_components.code, { children: "@solid-primitives/scheduled" }),
						" dep"
					] }),
					"\n",
					createVNode(_components.td, { children: "2" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "server/src/surface.ts" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "equals" }), " on the prefs cell (mirror session)"] }),
					"\n",
					createVNode(_components.td, { children: "3 · optional" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "*.test.ts" }) }),
					"\n",
					createVNode(_components.td, { children: "bounded-patch-rate regression near useRightPanel tests" }),
					"\n",
					createVNode(_components.td, { children: "test" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Bug fix, not user-visible feature work — shipped as a single PR, ",
			createVNode($$PrLink, { pr: 1050 }),
			", merged 2026-05-30; issue #1041 closed."
		] }) })
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
	"title": "Preferences storm",
	"description": "Debouncing the rightPanel resize feedback loop (#1041) — Corvu's idempotent re-emits + a no-equals prefs cell cause ~200 writes/min; the fix splits apply-local-now from a coalesced, patch-space server flush.",
	"parents": ["analysis"],
	"maturity": "budding",
	"status": "accepted",
	"updated": "2026-06-10T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "what-was-happening",
			"text": "What was happening"
		},
		{
			"depth": 2,
			"slug": "the-pivotal-constraint-this-is-what-picks-the-design",
			"text": "The pivotal constraint (this is what picks the design)"
		},
		{
			"depth": 2,
			"slug": "the-fix",
			"text": "The fix"
		},
		{
			"depth": 3,
			"slug": "1-drop-corvus-idempotent-re-emits--",
			"text": "1 Drop Corvu’s idempotent re-emits — "
		},
		{
			"depth": 3,
			"slug": "2-coalesce-the-server-flush-at-the-localserver-seam--",
			"text": "2 Coalesce the server flush at the local/server seam — "
		},
		{
			"depth": 3,
			"slug": "3-defense-in-depth-equals-on-the-server-prefs-cell--",
			"text": "3 Defense-in-depth: equals on the server prefs cell — "
		},
		{
			"depth": 3,
			"slug": "test-regression-guard",
			"text": "test Regression guard"
		},
		{
			"depth": 2,
			"slug": "reviewer-pass--what-changed",
			"text": "Reviewer pass — what changed"
		},
		{
			"depth": 2,
			"slug": "surface--sequencing",
			"text": "Surface & sequencing"
		}
	];
}
var url = "src/content/atlas/pref-storm.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/pref-storm.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/pref-storm.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
