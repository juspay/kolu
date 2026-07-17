import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import "./Cite_D-1zLbJ9.mjs";
//#region src/content/atlas/electricity.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		blockquote: "blockquote",
		br: "br",
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
		createVNode($$Callout, {
			kind: "good",
			title: "What counts as electricity",
			children: createVNode(_components.p, { children: [
				"Löwy’s receptacle — hide the volatility behind a socket you plug into. Three tests at once: ① ",
				createVNode(_components.strong, { children: "domain-agnostic" }),
				" — no terminal/canvas/git/xterm leaks into the interface; ② ",
				createVNode(_components.strong, { children: "encapsulates a real volatility" }),
				" — an axis the system actually ",
				createVNode(_components.em, { children: "varies" }),
				" along (transport, reconnect, GPU-context loss, persistence), not a stable 3-line ",
				createVNode(_components.code, { children: "===" }),
				"; ③ ",
				createVNode(_components.strong, { children: "graduates" }),
				" — ships as ",
				createVNode(_components.code, { children: "@kolu/*" }),
				" and a ",
				createVNode(_components.em, { children: "different" }),
				" app plugs in. The proof of ③ is real, not aspirational. ",
				createVNode(_components.a, {
					href: "https://kolu.dev/blog/surface-framework/",
					children: createVNode(_components.code, { children: "@kolu/surface" })
				}),
				" is ",
				createVNode(_components.strong, { children: "kolu’s own" }),
				" client↔server transport first — and it has since picked up a ",
				createVNode(_components.strong, { children: "second consumer" }),
				" in ",
				createVNode(_components.a, {
					href: "https://github.com/srid/drishti",
					children: "srid/drishti"
				}),
				" (a fleet process-monitor; browser ↔ Bun ↔ ssh-agent) that vendors it from this repo and declares its own per-host schema with none of kolu’s domain. The second consumer isn’t the ",
				createVNode(_components.em, { children: "point" }),
				" of the extraction — it’s the ",
				createVNode(_components.em, { children: "proof" }),
				" it was real electricity: surface never noticed the domain changed."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "danger",
			title: "How a session mis-identifies electricity — three traps, learned the hard way",
			children: [createVNode(_components.p, { children: [
				"The live example: asked to add back/forward to the Code-tab preview, a session proposed extracting a ",
				createVNode(_components.strong, { children: "history stack" }),
				". Wrong three ways, each caught only by re-asking the test above — and the ",
				createVNode(_components.a, {
					href: "solid-browser",
					children: "solid-browser"
				}),
				" plan is the corrected end-to-end."
			] }), createVNode(_components.ul, { children: [
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Naming an organ, not the concept." }),
					" A history stack is a ",
					createVNode(_components.em, { children: "transformer" }),
					" — a working part ",
					createVNode(_components.em, { children: "inside" }),
					" a larger thing. The electricity was the ",
					createVNode(_components.strong, { children: "browser" }),
					" (location + history + link-nav + render-host); history is one chamber of it. Test: ",
					createVNode(_components.em, { children: "is the name self-describing standalone?" }),
					" “history” → history ",
					createVNode(_components.strong, { children: "of what?" }),
					"; “browser” → obvious. If you must append “…of X” to explain the name, you’ve named a part, not the receptacle."
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: [
						"A module in ",
						createVNode(_components.code, { children: "client/src/" }),
						" is not electricity."
					] }),
					" Location ",
					createVNode(_components.em, { children: "is" }),
					" structure (Hickey): a generic-looking helper living inside the app is ",
					createVNode(_components.strong, { children: "part of the app" }),
					", however agnostic the code reads. Electricity is its ",
					createVNode(_components.strong, { children: "own package" }),
					", the dependency arrow pointing ",
					createVNode(_components.em, { children: "out" }),
					" — ",
					createVNode(_components.code, { children: "client → @kolu/x" }),
					", never back. (",
					createVNode(_components.code, { children: "createSharedRoot" }),
					" sits in ",
					createVNode(_components.code, { children: "client/src" }),
					" marked “publish?” — a leaf ",
					createVNode(_components.em, { children: "awaiting" }),
					" graduation, ",
					createVNode(_components.strong, { children: "not" }),
					" a precedent for calling in-app modules electricity.)"
				] }),
				"\n",
				createVNode(_components.li, { children: [
					createVNode(_components.strong, { children: "Agnostic ≠ electricity — apply test ② honestly." }),
					" A clean, reusable, agnostic primitive that hides only a ",
					createVNode(_components.em, { children: "bounded algorithm" }),
					" (a stack, a debounce, an ",
					createVNode(_components.code, { children: "===" }),
					") is a ",
					createVNode(_components.strong, { children: "leaf" }),
					" (",
					createVNode(_components.code, { children: "nonempty" }),
					"/",
					createVNode(_components.code, { children: "html-escape" }),
					"-tier), not a receptacle. “I found a tidy generic module” is the feeling that ",
					createVNode(_components.em, { children: "precedes" }),
					" the mistake. Ask what ",
					createVNode(_components.strong, { children: "volatility" }),
					" it actually encapsulates — what axis of ",
					createVNode(_components.em, { children: "change" }),
					" (transport, GPU-context loss, sandboxing, reconnect) — before reaching for ",
					createVNode(_components.code, { children: "@kolu/" }),
					"."
				] }),
				"\n"
			] })]
		}),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "“Decompose based on volatility”" }),
				" — Löwy’s directive: encapsulate each area ",
				createVNode(_components.em, { children: "likely to change" }),
				" behind a stable interface, rather than split a system by what it ",
				createVNode(_components.em, { children: "does" }),
				". “Electricity” is ",
				createVNode(_components.em, { children: "his own" }),
				" example, and the source of our term: ",
				createVNode(_components.em, { children: "“the electricity that powers a house … is highly volatile: power can be AC or DC; 110 volts or 220 volts … produced by solar panels … a generator … or plain grid connectivity … All that volatility is encapsulated behind a receptacle … all the user sees is an opaque receptacle.”" }),
				" The body does the same — blood-pressure, salinity, and pulse volatility ",
				createVNode(_components.em, { children: "“encapsulated behind the service called the heart.”" }),
				" An ",
				createVNode(_components.em, { children: "electricity" }),
				", in kolu, is one such volatility lifted into its own ",
				createVNode(_components.code, { children: "@kolu/*" }),
				" package; a ",
				createVNode(_components.em, { children: "receptacle" }),
				" is the socket a consumer plugs into. — Juval Löwy, ",
				createVNode(_components.a, {
					href: "https://www.informit.com/articles/article.aspx?p=2995357&seqNum=2",
					children: createVNode(_components.em, { children: "Software System Decomposition" })
				}),
				", ch. 2 of ",
				createVNode(_components.em, { children: "Righting Software" }),
				"."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "the-electricities",
			children: "The electricities"
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Electricity" }),
					"\n",
					createVNode(_components.th, { children: "Owns (volatility)" }),
					"\n",
					createVNode(_components.th, { children: "PR" }),
					"\n",
					createVNode(_components.th, { children: "Progress" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "@kolu/surface" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Live client↔server state — ",
						createVNode(_components.code, { children: "Cell" }),
						"/",
						createVNode(_components.code, { children: "Collection" }),
						"/",
						createVNode(_components.code, { children: "Stream" }),
						"/",
						createVNode(_components.code, { children: "Event" }),
						" over oRPC, reconnect, fine-grained reconcile."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 805 }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "done",
							children: "done"
						}),
						" · 2nd consumer: ",
						createVNode(_components.a, {
							href: "https://github.com/srid/drishti",
							children: "drishti"
						})
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: createVNode(_components.a, {
						href: "./surface-app.html",
						children: "@kolu/surface-app"
					}) }) }),
					"\n",
					createVNode(_components.td, { children: [
						"The app shell for surface apps — fresh delivery + server/build identity + the connection/update lifecycle model + desktop-install. Owns the ",
						createVNode(_components.strong, { children: "stale-tab handshake gate" }),
						" (",
						createVNode($$PrLink, { pr: 1231 }),
						") and now the ",
						createVNode(_components.strong, { children: "connection plumbing" }),
						" (",
						createVNode($$PrLink, { pr: 1234 }),
						") — the ",
						createVNode(_components.code, { children: "pid" }),
						"-echo, the partysocket construction, and the upgrade gate, lifted from both consumers into three composable primitives (",
						createVNode(_components.a, {
							href: "./surface-connection.html",
							children: "surface-connection"
						}),
						"). The restart axis already lived here, so each leak plugs into a receptacle the package had."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$PrLink, { pr: 1154 }),
						" · ",
						createVNode($$PrLink, { pr: 1231 }),
						" · ",
						createVNode($$PrLink, { pr: 1234 })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "done",
							children: "done"
						}),
						" · 2nd consumer: ",
						createVNode(_components.a, {
							href: "https://github.com/srid/drishti",
							children: "drishti"
						})
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "@kolu/surface-nix-host" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "HostSession" }),
						" — ",
						createVNode(_components.code, { children: "nix copy" }),
						" a closure to a host, realise, run ",
						createVNode(_components.code, { children: "--stdio" }),
						" over ssh."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 984 }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode($$Pill, {
						variant: "done",
						children: "done"
					}), " · also in drishti"] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "@kolu/artifact-sdk" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Two volatilities under one roof — the agnostic ",
						createVNode(_components.strong, { children: "anchoring core" }),
						" (W3C quote re-find; speaks only ",
						createVNode(_components.code, { children: "Range" }),
						"/",
						createVNode(_components.code, { children: "Document" }),
						"/",
						createVNode(_components.code, { children: "ShadowRoot" }),
						") ",
						createVNode(_components.em, { children: "and" }),
						" the ",
						createVNode(_components.strong, { children: "sandboxed-iframe parent↔frame bridge" }),
						" (opaque-origin postMessage, now carrying comments + in-frame navigation + back/forward input). See the re-eval note below."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 922 }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "done",
							children: "done"
						}),
						" ",
						createVNode($$Pill, {
							variant: "run",
							children: "re-eval"
						})
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "@kolu/transcript-core" }),
						" + ",
						createVNode(_components.strong, { children: "transcript-html" })
					] }),
					"\n",
					createVNode(_components.td, { children: "Transcript model + rendering." }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 744 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "done",
						children: "done"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "@kolu/solid-pierre" }) }),
					"\n",
					createVNode(_components.td, { children: "SolidJS adapters for Pierre tree/diff." }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 823 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "done",
						children: "done"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "persistedPref" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Validated localStorage (validate-on-read; closed the zoom-",
						createVNode(_components.code, { children: "NaN" }),
						" + maximize bugs)."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1089 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "done",
						children: "done"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "@kolu/log" }),
						" · ",
						createVNode(_components.strong, { children: "@kolu/html-escape" })
					] }),
					"\n",
					createVNode(_components.td, { children: "Zero-dep leaf types every package can import without dragging the domain tree." }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1089 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "done",
						children: "done"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "dom/" }),
						" + injectable ",
						createVNode(_components.code, { children: "isMac" })
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "walkShadowRoots" }), " relocated to a neutral wall; keybind core no longer reads the UA singleton."] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1089 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "done",
						children: "done"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "createSharedRoot" }) }),
					"\n",
					createVNode(_components.td, { children: "Lazy app-scoped reactive singleton (7 consumers). 100% agnostic SolidJS." }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 974 }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "done",
							children: "done"
						}),
						" ",
						createVNode($$Pill, {
							variant: "run",
							children: "publish?"
						})
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "@kolu/serve-dir" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Fetch-native file serving from an absolute root — streaming byte-range (",
						createVNode(_components.code, { children: "206" }),
						"/",
						createVNode(_components.code, { children: "416" }),
						"), content-type, lexical traversal guard; a pure ",
						createVNode(_components.code, { children: "(root, relPath, request) → Response" }),
						". Its ",
						createVNode(_components.strong, { children: [
							"own package, zero ",
							createVNode(_components.em, { children: "workspace" }),
							" deps"
						] }),
						" (",
						createVNode(_components.code, { children: "node:fs" }),
						"/",
						createVNode(_components.code, { children: "path" }),
						"/",
						createVNode(_components.code, { children: "stream" }),
						" + the focused ",
						createVNode(_components.code, { children: "mrmime" }),
						" MIME table) — the dependency arrow points ",
						createVNode(_components.em, { children: "out" }),
						" (",
						createVNode(_components.code, { children: "kolu-server → @kolu/serve-dir" }),
						"). Agnostic of terminals/git/kolu; the consumer injects the root and composes the artifact-sdk ",
						createVNode(_components.code, { children: "<script>" }),
						" decorator downstream. A 20-agent prior-art survey found no static-serve library fits the ",
						createVNode(_components.em, { children: "serving" }),
						" shape (all pipe to a Node ",
						createVNode(_components.code, { children: "res" }),
						", breaking the Fetch-",
						createVNode(_components.code, { children: "Response" }),
						" + decorator composition; none takes a per-request absolute root or does a realpath guard), so the serving is owned here — but the ",
						createVNode(_components.strong, { children: ["MIME table leans on ", createVNode(_components.code, { children: "mrmime" })] }),
						" (the separable commodity the survey explicitly didn’t cover). That’s load-bearing for decomposition: a ",
						createVNode(_components.em, { children: "complete" }),
						" table means adding a format to kolu’s ",
						createVNode(_components.code, { children: "*_EXTENSIONS" }),
						" classifier needs ",
						createVNode(_components.strong, { children: "no edit here" }),
						" (mrmime already types it), so the ext↔MIME shared-volatility the lens debated is ",
						createVNode(_components.strong, { children: "dissolved for every mrmime-known format" }),
						". For the ",
						createVNode(_components.strong, { children: "mrmime gap set" }),
						" (",
						createVNode(_components.code, { children: ".m4v" }),
						"/",
						createVNode(_components.code, { children: ".ico" }),
						", and any future classifier entry mrmime doesn’t know) the coupling is instead ",
						createVNode(_components.strong, { children: "contained-by-test" }),
						": a 2-entry ",
						createVNode(_components.code, { children: "OVERRIDES" }),
						" in serve-dir supplies the MIME, and the coverage invariant in ",
						createVNode(_components.code, { children: "iframePreviewRoute.test.ts" }),
						" is ",
						createVNode(_components.strong, { children: "load-bearing, not a thin sanity check" }),
						" — delete an ",
						createVNode(_components.code, { children: "OVERRIDES" }),
						" row and the classifier still routes the file to a ",
						createVNode(_components.code, { children: "<video>" }),
						"/",
						createVNode(_components.code, { children: "<img>" }),
						" appliance while serve-dir answers ",
						createVNode(_components.code, { children: "application/octet-stream" }),
						", so only that test catches the silent download regression. Path safety is two-stage by volatility: the ",
						createVNode(_components.strong, { children: "lexical" }),
						" guard (decode-then-split + ",
						createVNode(_components.code, { children: "path.relative" }),
						" containment) is built in (pure, universal), while the ",
						createVNode(_components.strong, { children: "realpath/symlink" }),
						" guard is an ",
						createVNode(_components.em, { children: "injected" }),
						" ",
						createVNode(_components.code, { children: "realpathGuard" }),
						" the consumer supplies (fs-touching, threat-model-specific) — ",
						createVNode(_components.code, { children: "kolu-server" }),
						" wires kolu-git’s ",
						createVNode(_components.code, { children: "assertRealpathUnder" }),
						", so the package stays agnostic without dropping the security boundary. A ",
						createVNode(_components.strong, { children: "leaf" }),
						" (bounded algorithm, not a transport-grade volatility)."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1225 }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "done",
							children: "done"
						}),
						" ",
						createVNode($$Pill, {
							variant: "run",
							children: "②/③ proof-pending"
						})
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "@kolu/terminal-protocol" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"The VT/device-query ",
						createVNode(_components.strong, { children: "protocol policy" }),
						" both terminal clients and the server must agree on — the query-reply suppression grammars (whole-payload predicate for the browser’s ",
						createVNode(_components.code, { children: "onData" }),
						", streaming boundary-aware stripper for kolu-tui’s raw tty), the headless forward/drop rule, the ",
						createVNode(_components.strong, { children: "answered/silent device-query matrix as data" }),
						" (executed against a real headless by ",
						createVNode(_components.code, { children: "@kolu/pty-host" }),
						"’s contract tests, so policy and implementation can’t drift), the bracketed-paste delimiters, and the snapshot-reciprocal TTY reset. Born when the second terminal client (kolu-tui ",
						createVNode(_components.code, { children: "attach" }),
						", ",
						createVNode($$PrLink, { pr: 1255 }),
						") made the fragmentation visible: the same concept lived in ",
						createVNode(_components.code, { children: "kolu-common" }),
						", ",
						createVNode(_components.code, { children: "pty-host" }),
						", and ",
						createVNode(_components.code, { children: "pty-tui" }),
						", held in lockstep by prose — and the browser may not depend on ",
						createVNode(_components.code, { children: "@kolu/pty-host" }),
						", so a leaf both sides import is the only receptacle that dissolves the cross-references. Hashed into the pty-host ",
						createVNode(_components.strong, { children: "staleKey" }),
						" (a protocol change is observable daemon behaviour; pinned by ",
						createVNode(_components.code, { children: "buildId.closure.test.ts" }),
						"). A ",
						createVNode(_components.strong, { children: "leaf" }),
						" (bounded protocol tables, not a transport-grade volatility) — the ",
						createVNode(_components.code, { children: "serve-dir" }),
						" tier, not the ",
						createVNode(_components.code, { children: "surface" }),
						" tier."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1255 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "done",
						children: "done"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "@kolu/xterm-kit" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"The accumulated high-level xterm.js machinery — pinned ",
						createVNode(_components.code, { children: "_core" }),
						" internals with two failure philosophies, in-place scrollback surgery + seam-token write path, the mirror anchoring lifted from kaval, and the SolidJS lifecycle (WebGL single-owner + context-loss recovery, owner-correct async dispose across ",
						createVNode(_components.code, { children: "await" }),
						") — as a runtime-neutral core + ",
						createVNode(_components.code, { children: "/solid" }),
						" adapter; kaval and the client as two consumers. ",
						createVNode(_components.a, {
							href: "xterm-kit",
							children: "Plan + API record"
						}),
						"."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$PrLink, { pr: 1795 }),
						" (PR 1)",
						createVNode(_components.br, {}),
						createVNode($$PrLink, { pr: 1808 }),
						" (PR 2)"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "done",
							children: "core graduated"
						}),
						" ",
						createVNode($$Pill, {
							variant: "done",
							children: [createVNode(_components.code, { children: "<Xterm>" }), " wrapper"]
						})
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "@kolu/solid-browser" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"The Code tab ",
						createVNode(_components.em, { children: "is" }),
						" a browser — location/address model, back-forward history, cross-content-type link interception, GitHub-relative resolution, sandboxed-iframe lifecycle. git is an injected resolver; the renderer packages plug in. ",
						createVNode(_components.a, {
							href: "solid-browser",
							children: "Plan"
						}),
						"."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1191 }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "done",
							children: "phases 1+2"
						}),
						" primitives + ",
						createVNode(_components.code, { children: "createBrowser" }),
						" history shipped · ",
						createVNode(_components.code, { children: "<Browser>" }),
						"/gitResolver deferred, ③ proof-pending"
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "surface-app's stale-tab gate — what graduates, what stays a socket the consumer plugs in",
			children: [
				createVNode(_components.p, { children: [
					"The restart axis already lived in ",
					createVNode(_components.code, { children: "createServerLifecycle" }),
					" (",
					createVNode(_components.code, { children: "restartCloseCode" }),
					" + the ",
					createVNode(_components.code, { children: "transport:\"open\"\\|\"closed\"" }),
					" discriminant), so ",
					createVNode($$PrLink, { pr: 1231 }),
					" only had to graduate the ",
					createVNode(_components.strong, { children: "shared" }),
					" pieces and leave the ",
					createVNode(_components.strong, { children: "per-socket" }),
					" ones behind. The split is the whole test ① at work — none of the graduated parts knows a terminal from an ssh-agent."
				] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Graduates" }),
					" (the second consumer shares the ",
					createVNode(_components.em, { children: "identical" }),
					" partysocket + oRPC stack, so the volatility is genuinely common): the ",
					createVNode(_components.code, { children: "pid" }),
					"/",
					createVNode(_components.code, { children: "4001" }),
					" constants and a runtime-free ",
					createVNode(_components.code, { children: "rejectStaleProcess(claimedPid, liveId): boolean" }),
					"; ",
					createVNode(_components.code, { children: "serverIdentity()" }),
					" ",
					createVNode(_components.strong, { children: "returning" }),
					" its minted ",
					createVNode(_components.code, { children: "processId" }),
					" so the gate compares against the SAME id ",
					createVNode(_components.code, { children: "identity.info" }),
					" reports (drishti otherwise mints a ",
					createVNode(_components.em, { children: "second" }),
					" ",
					createVNode(_components.code, { children: "randomUUID()" }),
					" and the gate never matches); and — the F1 reversal of the prior “keep it per-consumer” — ",
					createVNode(_components.code, { children: "retireSocket" }),
					", whose two reverse-engineered side-effects (",
					createVNode(_components.code, { children: "close()" }),
					" flips partysocket’s ",
					createVNode(_components.code, { children: "_shouldReconnect" }),
					"; a ",
					createVNode(_components.strong, { children: "throwing" }),
					" ",
					createVNode(_components.code, { children: "send" }),
					" makes oRPC’s ",
					createVNode(_components.code, { children: "ClientPeer" }),
					" ",
					createVNode(_components.em, { children: "reject" }),
					" pending instead of letting ",
					createVNode(_components.code, { children: "maxEnqueuedMessages:Infinity" }),
					" grow) bind to internals drishti has byte-for-byte. It takes a structural ",
					createVNode(_components.code, { children: "{ close; send }" }),
					", not a ",
					createVNode(_components.code, { children: "PartySocket" }),
					", so it never drags the concrete type across the boundary."
				] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Stays the consumer’s socket to plug in:" }),
					" the socket ",
					createVNode(_components.em, { children: "builder" }),
					" (drishti’s ",
					createVNode(_components.code, { children: "makeSocket" }),
					" cold-start deadlines, its ",
					createVNode(_components.code, { children: "wsUrlFor" }),
					" query) and the per-runtime ",
					createVNode(_components.code, { children: "pid" }),
					" read off the request (kolu’s Node ",
					createVNode(_components.code, { children: "IncomingMessage" }),
					", drishti’s Bun Fetch-",
					createVNode(_components.code, { children: "URL" }),
					") — surface-app emits the id, never the URL. The client’s last-known id stays a per-consumer mutable on purpose: the lifecycle’s ",
					createVNode(_components.code, { children: "serverProcessId()" }),
					" deliberately reports ",
					createVNode(_components.code, { children: "undefined" }),
					" on a stale close (the only id on hand is the ",
					createVNode(_components.em, { children: "dead" }),
					" process), but the ",
					createVNode(_components.code, { children: "pid" }),
					" echo must keep re-presenting that dead id to get re-rejected — two different facts, not one projected twice, so the URL thunk owns its own ",
					createVNode(_components.code, { children: "lastServerProcessId" }),
					"."
				] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: [
						"Then it graduated too (",
						createVNode($$PrLink, { pr: 1234 }),
						", ",
						createVNode(_components.a, {
							href: "./surface-connection.html",
							children: "surface-connection"
						}),
						")."
					] }),
					" Reading drishti’s ",
					createVNode(_components.em, { children: "actual" }),
					" post-#1231 source — not assuming it — overturned the “stays the consumer’s socket” line above: both consumers hand-roll the ",
					createVNode(_components.em, { children: "identical" }),
					" partysocket construction and ",
					createVNode(_components.code, { children: "pid" }),
					"-echo threading (drishti’s “Bun Fetch-",
					createVNode(_components.code, { children: "URL" }),
					"” runtime is in fact the same ",
					createVNode(_components.code, { children: "ws" }),
					" stack as kolu). So the socket builder and the echo ",
					createVNode(_components.em, { children: "did" }),
					" graduate, as ",
					createVNode(_components.code, { children: "createSurfaceSocket" }),
					" + ",
					createVNode(_components.code, { children: "createProcessIdEcho" }),
					" in ",
					createVNode(_components.code, { children: "@kolu/surface-app/connect" }),
					". The “two different facts” insight is ",
					createVNode(_components.strong, { children: "preserved inside the echo" }),
					" — ",
					createVNode(_components.code, { children: "createProcessIdEcho" }),
					" still re-presents the dead id, distinct from ",
					createVNode(_components.code, { children: "serverProcessId()" }),
					" — it just isn’t hand-rolled per consumer anymore. What genuinely stays per-consumer narrowed to ",
					createVNode(_components.strong, { children: "lifecycle ownership" }),
					" (kolu’s ",
					createVNode(_components.code, { children: "rpc.ts" }),
					" vs drishti’s ",
					createVNode(_components.code, { children: "<SurfaceAppProvider>" }),
					") and ",
					createVNode(_components.strong, { children: "socket topology" }),
					" (one socket vs per-host + admin sharing one echo). Same lesson as the F1 ",
					createVNode(_components.code, { children: "retireSocket" }),
					" reversal: the boundary is set by what’s ",
					createVNode(_components.em, { children: "actually" }),
					" duplicated, found by reading source, not by what looked per-consumer at first."
				] })
			]
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "liveWhen — predicate-as-data: the fold graduates, the meaning plugs in",
			children: createVNode(_components.p, { children: [
				"The sharpest proof the receptacle stays domain-blind is the verb it ",
				createVNode(_components.em, { children: "refuses to learn" }),
				". ",
				createVNode(_components.code, { children: "client.health().live" }),
				" is the full conjunction — transport-live ∧ every readiness cell’s predicate — yet ",
				createVNode(_components.code, { children: "@kolu/surface" }),
				" core never knows what “connected” ",
				createVNode(_components.em, { children: "means" }),
				". The ",
				createVNode(_components.strong, { children: "fold is the receptacle" }),
				": a generic ",
				createVNode(_components.code, { children: "CellSpec.liveWhen?: (value) => boolean" }),
				" marks a cell a readiness gate, and core AND-reduces that cell’s verdict into ",
				createVNode(_components.code, { children: "live" }),
				" (",
				createVNode(_components.code, { children: "registry.enrollReadiness" }),
				") without ever naming a state literal. The ",
				createVNode(_components.strong, { children: "volatile knowledge rides the cell as data" }),
				" — ",
				createVNode(_components.code, { children: "surface-nix-host" }),
				"’s ",
				createVNode(_components.code, { children: "connectionCell" }),
				" declares ",
				createVNode(_components.code, { children: "liveWhen: (v) => v.state === \"connected\"" }),
				", and the ssh vocabulary (the predicate, the four-state enum) stays ",
				createVNode(_components.em, { children: "there" }),
				", beside the schema. It’s the runtime sibling of ",
				createVNode(_components.code, { children: "CellSpec.equals" }),
				" / ",
				createVNode(_components.code, { children: "resolveCellVerbs" }),
				": core owns the mechanism, the plug owns the meaning — the receptacle is domain-agnostic, the volatility plugs in as data. So every surface mirrored through ",
				createVNode(_components.code, { children: "mirroredSurface" }),
				" carries its mirror-liveness leg ",
				createVNode(_components.em, { children: "by construction" }),
				" — no consumer hand-ANDs ",
				createVNode(_components.code, { children: "connection.state === \"connected\"" }),
				", and no widget can paint a dot green from raw cell state. ",
				createVNode(_components.strong, { children: "Location is structure" }),
				" in the un-obvious direction too: the ",
				createVNode(_components.code, { children: "=== \"connected\"" }),
				" ",
				createVNode(_components.em, { children: "can’t" }),
				" migrate into core without dragging ssh’s domain across the boundary, so the split isn’t a convention you keep — it’s load-bearing."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "Re-evaluating @kolu/artifact-sdk — its electricity framing shifted (open; resolve outside this PR)",
			children: [createVNode(_components.p, { children: [
				"“Anchoring” (the original ",
				createVNode($$PrLink, { pr: 922 }),
				" framing) now under-describes the\npackage. It holds ",
				createVNode(_components.strong, { children: "two" }),
				" volatilities: (1) the ",
				createVNode(_components.strong, { children: "anchoring core" }),
				" (",
				createVNode(_components.code, { children: "core/" }),
				" — W3C\nquote extract/re-find/highlight; pure and agnostic, speaks only\n",
				createVNode(_components.code, { children: "Range" }),
				"/",
				createVNode(_components.code, { children: "Document" }),
				"/",
				createVNode(_components.code, { children: "ShadowRoot" }),
				"), and (2) the ",
				createVNode(_components.strong, { children: "sandboxed-iframe parent↔frame\nbridge" }),
				" (",
				createVNode(_components.code, { children: "client/bridge.ts" }),
				" + ",
				createVNode(_components.code, { children: "iframe/" }),
				" — opaque-origin postMessage with\n",
				createVNode(_components.code, { children: "event.source" }),
				" identity as the only trust boundary). The bridge is the ",
				createVNode(_components.em, { children: "harder" }),
				"\nvolatility, and it has quietly accreted clients: comments (selection →\n",
				createVNode(_components.code, { children: "SelectMsg" }),
				" → highlights), then ",
				createVNode(_components.strong, { children: "in-frame navigation" }),
				" (",
				createVNode(_components.code, { children: "observeIframeNavigation" }),
				"),\nthen ",
				createVNode(_components.strong, { children: "back/forward input" }),
				" (",
				createVNode(_components.code, { children: "observeIframeHistory" }),
				", ",
				createVNode($$PrLink, { pr: 1191 }),
				"). The\nlens-debate in ",
				createVNode($$PrLink, { pr: 1191 }),
				" already reframed the package’s ",
				createVNode(_components.em, { children: "stated" }),
				"\nidentity to “the in-iframe sandbox bridge, with comments as one client” — but\nthat was a docs fix, not a decomposition."
			] }), createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "The open question (work it outside this PR):" }),
				" is “talk to code inside an\nopaque-origin sandboxed frame” one sound receptacle — a transport-grade\nvolatility with comments / navigation / input as interchangeable clients — or a\ntopic-bundle that should split the agnostic ",
				createVNode(_components.strong, { children: "anchoring core" }),
				" from the ",
				createVNode(_components.strong, { children: "bridge\ntransport" }),
				"? Note the smell that prompted this: the back/forward client landed in\nthis package only by ",
				createVNode(_components.em, { children: "physical necessity" }),
				" (the one script inside the sandbox is\nthis one), which is exactly the “easy to put it here” the three traps above warn\nagainst. Flagged, not decided."
			] })]
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Plus external electricity correctly leaned on instead of hand-rolled: ",
			createVNode(_components.strong, { children: "Corvu" }),
			" (dialog/drawer/focus-trap/scroll-lock), ",
			createVNode(_components.strong, { children: "@solid-primitives/*" }),
			" (resize-observer, media). Origin: a 41-agent Hickey/Lowy audit (16 candidates) → its “ship now” tier landed in ",
			createVNode($$PrLink, { pr: 1089 }),
			"; a framework-scale re-test + adversarial skeptic surfaced the missed ",
			createVNode(_components.code, { children: "solid-xterm" }),
			"."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "built-koluxterm-kit",
			children: "Built: @kolu/xterm-kit"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			children: [createVNode(_components.p, { children: [
				"The one electricity still unbuilt at the framework audit — mis-filed at first as\n“terminal domain,” but a runtime-neutral adapter over xterm.js is agnostic (the\n",
				createVNode(_components.code, { children: ".agency/lowy.md" }),
				" §6.5 ",
				createVNode(_components.em, { children: "“what library is this?”" }),
				" test). It owns the declared\nvolatility rows — async-init cleanup (the ",
				createVNode(_components.code, { children: "#598" }),
				"/",
				createVNode(_components.code, { children: "#600" }),
				" ~900 KB leaks), canvas/\nWebGL lifecycle (the ",
				createVNode(_components.code, { children: "#591" }),
				" zombie-context hunt, ",
				createVNode(_components.code, { children: "#575" }),
				"/",
				createVNode(_components.code, { children: "#239" }),
				"/",
				createVNode(_components.code, { children: "#595" }),
				"), the\npinned ",
				createVNode(_components.code, { children: "_core" }),
				" internals with two failure philosophies, and the mirror anchoring\nlifted from kaval."
			] }), createVNode(_components.p, { children: [
				"Graduated into ",
				createVNode(_components.strong, { children: createVNode(_components.a, {
					href: "xterm-kit",
					children: createVNode(_components.code, { children: "@kolu/xterm-kit" })
				}) }),
				" — a runtime-neutral core +\n",
				createVNode(_components.code, { children: "/solid" }),
				" adapter, with kaval and the client as two consumers from day one, so\nthe population-of-one caveat that shadowed the old ",
				createVNode(_components.code, { children: "solid-xterm" }),
				" name is gone.\nThe behavior-neutral core + mirror-anchor lift ship in ",
				createVNode($$PrLink, { pr: 1795 }),
				" (PR\n1); the ",
				createVNode(_components.code, { children: "<Xterm>" }),
				" component wrapper + the touch-divisor unification ship in the\ne2e-gated ",
				createVNode($$PrLink, { pr: 1808 }),
				" (PR 2). Full plan + API design (including the two\nbuild-time corrections that split the work): the note."
			] })]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "considered--not-electricity",
			children: "Considered — not electricity"
		}),
		"\n",
		createVNode(_components.p, { children: "Looked framework-sized (the audit’s biggest braids), but fail the bar — recorded so they don’t get re-proposed." }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Candidate" }),
					"\n",
					createVNode(_components.th, { children: "Verdict" }),
					"\n",
					createVNode(_components.th, { children: "Why" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "defineMutation" }), " (optimisticOverlay)"] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "bad",
						children: "helper"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						"One module, one domain (canvas layouts); the write echo is already owned by ",
						createVNode(_components.code, { children: "surface" }),
						"’s metadata subscription. Pending is a UI cache, not a transport axis."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "@kolu/fs-watch" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "bad",
						children: "helper"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						"Owns a refcount/debounce ",
						createVNode(_components.em, { children: "lifecycle" }),
						", not a streaming transport — no wire contract, Node-bound. A ",
						createVNode(_components.code, { children: "@kolu/shared" }),
						" helper, not a socket."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "@kolu/geometry" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "bad",
						children: "domain-coupled"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "TileLayout" }),
						" binds it to a server-persisted domain type; a ",
						createVNode(_components.code, { children: "Rect" }),
						" package re-adapts at every boundary — moves the braid, doesn’t dissolve it."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.strong, { children: "@kolu/surface-publish" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "bad",
						children: "already-covered"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						"Surface’s ",
						createVNode(_components.code, { children: "cellHandlers" }),
						"/",
						createVNode(_components.code, { children: "collectionHandlers" }),
						"/",
						createVNode(_components.code, { children: "pollOnEvent" }),
						" already own server snapshot+delta. Only ",
						createVNode(_components.code, { children: "terminal.attach" }),
						" is a raw escape hatch."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: "@kolu/commands" }), " (palette)"] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "bad",
						children: "domain-coupled"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						"Palette engine is already agnostic; all coupling is isolated in ",
						createVNode(_components.code, { children: "createCommands" }),
						", which must stay in the app. Extracting deletes ~0 kolu lines."
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "God-procedure split" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "run",
						children: "refactor"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						"Its biggest dissolvable chunk ",
						createVNode(_components.em, { children: "is" }),
						" ",
						createVNode(_components.code, { children: "xterm-kit" }),
						" (above); the rest is kolu orchestration — a refactor, not a receptacle."
					] }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Bar from Juval Löwy, ",
			createVNode(_components.em, { children: "Righting Software" }),
			" (receptacle/volatility) + Rich Hickey, ",
			createVNode(_components.em, { children: "Simple Made Easy" }),
			" (complecting); one-socket-not-a-topic-bundle is ",
			createVNode(_components.code, { children: ".agency/lowy.md" }),
			" §6.5. ",
			createVNode(_components.code, { children: "file:line" }),
			" verified against the codebase; ③ demonstrated by ",
			createVNode(_components.a, {
				href: "https://github.com/srid/drishti",
				children: "drishti"
			}),
			" — a second consumer (kolu is the first) that vendors ",
			createVNode(_components.code, { children: "@kolu/surface" }),
			" via npins."
		] }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "Electricity — identified, and their progress",
	"description": "A tracker for kolu's electricities — infrastructure pulled out from beneath the app into its own thing — and where each stands.",
	"parents": ["analysis"],
	"maturity": "evergreen",
	"updated": "2026-06-21T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "the-electricities",
			"text": "The electricities"
		},
		{
			"depth": 2,
			"slug": "built-koluxterm-kit",
			"text": "Built: @kolu/xterm-kit"
		},
		{
			"depth": 2,
			"slug": "considered--not-electricity",
			"text": "Considered — not electricity"
		}
	];
}
var url = "src/content/atlas/electricity.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/electricity.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/electricity.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
