import { F as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_ZVLTETd9.mjs";
import { t as $$Callout } from "./Callout_9cdgbDOy.mjs";
import { t as $$PrLink } from "./PrLink_D-x9EPGh.mjs";
import { t as $$D2 } from "./D2_CPv-UX0x.mjs";
import { t as $$Pill } from "./Pill_DD4u2LYa.mjs";
//#region src/content/atlas/app-thin-shell.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
		a: "a",
		blockquote: "blockquote",
		code: "code",
		em: "em",
		h2: "h2",
		hr: "hr",
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
		createVNode(_components.p, { children: "The convention is explicit and the code drifted from it:" }),
		"\n",
		createVNode(_components.blockquote, { children: [
			"\n",
			createVNode(_components.p, { children: [
				createVNode(_components.strong, { children: "State per domain" }),
				": Extract shared state into ",
				createVNode(_components.code, { children: "useXxx.ts" }),
				" modules (singleton\npattern)… ",
				createVNode(_components.strong, { children: "Keep App.tsx as a thin layout shell." }),
				" — ",
				createVNode(_components.code, { children: ".claude/rules/solidjs.md" })
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.code, { children: "packages/client/src/App.tsx" }),
			" is supposed to be that shell. At 785 lines it has\nbecome the catch-all every feature lands a little wiring in. This is the\nplan-of-record for ",
			createVNode(_components.a, {
				href: "https://github.com/juspay/kolu/issues/1340",
				children: "#1340"
			}),
			" — a\n",
			createVNode(_components.strong, { children: "behavior-preserving" }),
			" decomposition back to layout-composition-only. The issue\nsuggested one cluster per PR; per the maintainer’s call this lands the ",
			createVNode(_components.strong, { children: "whole" }),
			"\ndecomposition in one branch, sequenced as ordered, individually-bisectable\ncommits."
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Verdict — six seams, one branch, gauntlet-hardened",
			children: createVNode(_components.p, { children: [
				"The naive read of #1340 is five “kitchen-sink” clusters. A dual-lens review\n(Lowy’s volatility decomposition ⇄ Hickey’s ",
				createVNode(_components.em, { children: "Simple Made Easy" }),
				") reshaped it into\n",
				createVNode(_components.strong, { children: "six volatility-aligned seams" }),
				" and killed two traps the line-count framing would\nhave walked into: a ",
				createVNode(_components.code, { children: "useOverlays()" }),
				" god-hook and a setter-leaking ",
				createVNode(_components.code, { children: "useActionContext" }),
				".\nMethod: 9 agents — map ▸ dual-lens critique ▸ reconcile. Target: App.tsx ",
				createVNode(_components.strong, { children: "785 → ~460\nlines" }),
				", every removed line relocated to a named owner, the e2e suite as the guard."
			] })
		}),
		"\n",
		createVNode(_components.h2, {
			id: "-the-drift--apptsx-became-the-catch-all",
			children: "① The drift — App.tsx became the catch-all"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The shell is supposed to ",
			createVNode(_components.em, { children: "mount" }),
			" things. Instead it ",
			createVNode(_components.strong, { children: "owns" }),
			" them. Five kinds of\nnon-layout weight have accreted, each pulling in a different direction:"
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Six overlay/dialog open-state signals" }),
				" — ",
				createVNode(_components.code, { children: "paletteOpen" }),
				", ",
				createVNode(_components.code, { children: "shortcutsHelpOpen" }),
				",\n",
				createVNode(_components.code, { children: "aboutOpen" }),
				", ",
				createVNode(_components.code, { children: "welcomeOpen" }),
				", ",
				createVNode(_components.code, { children: "diagnosticInfoOpen" }),
				", plus ",
				createVNode(_components.code, { children: "searchOpen" }),
				" (which isn’t\neven a modal — it’s per-terminal find visibility, mis-clustered by mere\nco-location)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "The canvas-surface precedence" }),
				" — an outer ",
				createVNode(_components.code, { children: "<Show>" }),
				" gate plus a four-arm\n",
				createVNode(_components.code, { children: "<Switch>" }),
				" whose ",
				createVNode(_components.em, { children: "arm order" }),
				" carries correctness (the #1034 “empty-canvas lie”\nand the F3 warming-window race both edited that order), readable only by\nrendering."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"The full ",
					createVNode(_components.code, { children: "ActionContext" }),
					" assembly"
				] }),
				" (≈40 lines) — a fan-in that references\n",
				createVNode(_components.em, { children: "every" }),
				" other domain’s writer: store, crud, theme, sub-panel, right-panel,\nposture, dock, recorder, overlays."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A prop-drilled server-identity fetch" }),
				" — ",
				createVNode(_components.code, { children: "client.server.info()" }),
				" + an\n",
				createVNode(_components.code, { children: "identity" }),
				" signal + ",
				createVNode(_components.code, { children: "appTitle()" }),
				" threaded into the watermark, the About dialog,\n",
				createVNode(_components.code, { children: "<Title>" }),
				", ",
				createVNode(_components.code, { children: "<Meta>" }),
				", and ",
				createVNode(_components.code, { children: "MobileTileView" }),
				"."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Two imperative escapes" }),
				" — ",
				createVNode(_components.code, { children: "window.__koluSimulateAlert = …" }),
				" (an e2e bridge App\nneither produces nor consumes) and a ",
				createVNode(_components.code, { children: "document.querySelector(\"[data-corvu-dialog-content]…\")" }),
				"\nDOM probe standing in for state App already owns reactively."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"A thin shell is ",
			createVNode(_components.strong, { children: "not an empty file" }),
			". Its legitimate, irreducible job stays:\nthe root container + safe-area + visual-viewport frame, the document title/meta,\nthe dialog ",
			createVNode(_components.em, { children: "mount points" }),
			", the chrome/overlay siblings, the canvas ",
			createVNode(_components.code, { children: "<Switch>" }),
			"’s\nper-surface ",
			createVNode(_components.strong, { children: "layout markup" }),
			", and the desktop ",
			createVNode(_components.code, { children: "<Resizable>" }),
			" split (whose\nload-bearing comments encode the full-viewport-width invariant ChromeBar leans\non). That floor is ~330 lines of genuine layout. The goal is to shed everything\nthat ",
			createVNode(_components.em, { children: "isn’t" }),
			" that."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "-six-seams-six-axes-of-change",
			children: "② Six seams, six axes of change"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Each seam encapsulates ",
			createVNode(_components.strong, { children: "one volatility" }),
			" — one reason-to-change — behind a stable\ninterface, mirroring an established singleton (",
			createVNode(_components.code, { children: "useIntentEditor" }),
			" for reactive\ndialog controllers via ",
			createVNode(_components.code, { children: "createSharedRoot" }),
			"; ",
			createVNode(_components.code, { children: "useSubPanel" }),
			" for per-terminal keyed\nstate). The shell then ",
			createVNode(_components.em, { children: "composes" }),
			" named owners instead of ",
			createVNode(_components.em, { children: "holding" }),
			" their state."
		] }),
		"\n",
		createVNode($$D2, {
			caption: "After the decomposition: App.tsx composes six named owners on the terminal-store/crud foundation. Only the precedence decision, open-state, and wiring leave — the per-surface layout markup stays.",
			code: `
direction: down

shell: "App.tsx — thin layout shell (frame · canvas <Switch> · dialog mounts)" {
style.fill: "#dbeafe"
}

mode: "useCanvasMode — surface precedence" {
style.fill: "#e6f4ea"
order: "connecting ▸ down ▸ warming ▸ empty ▸ workspace"
}

identity: "useServerIdentity — info fetch · appTitle" {
style.fill: "#e6f4ea"
}

dialogs: "Dialog open-state — per-dialog, NOT a god-hook" {
style.fill: "#f1e9fb"
palette: "useCommandPalette — real controller"
disc: "createDisclosure × 4 — trivial toggles"
stack: "useDialogStack — focus arbitration"
}

search: "useTerminalSearch — per-terminal find" {
style.fill: "#e1f0f3"
}

handlers: "Domain handlers go home" {
style.fill: "#e1f0f3"
a: "centerActive ▸ useCanvasArrange"
b: "toggleOrCreate ▸ useSubPanel"
}

actions: "useActionContext — composes verbs · deferred" {
style.fill: "#fbf1dc"
style.stroke-dash: 4
}

modal: "ModalDialog.refocusOnClose" {
style.fill: "#f1e9fb"
}

foundation: "useTerminalStore + useTerminalCrud (singleton)" {
style.fill: "#eef0f2"
}

shell -> mode: reads
shell -> identity: reads
shell -> dialogs: mounts
shell -> search: reads
shell -> handlers: delegates
shell -> actions: "keys + palette"
dialogs.palette -> modal
dialogs.stack -> modal: "open count"
actions -> foundation
handlers -> foundation
search -> foundation
`
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "#" }),
					"\n",
					createVNode(_components.th, { children: "Seam → owner" }),
					"\n",
					createVNode(_components.th, { children: "Axis of change it encapsulates" }),
					"\n",
					createVNode(_components.th, { children: "App.tsx sheds" }),
					"\n",
					createVNode(_components.th, { children: "~lines" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "1" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: createVNode(_components.code, { children: "useCanvasMode" }) }),
						" (new, ",
						createVNode(_components.code, { children: "kaval/" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.em, { children: "Which" }), " canvas surface wins, in what order — a pure 5-way total function, finally unit-testable without a DOM"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "showEmpty" }),
						", the outer ",
						createVNode(_components.code, { children: "<Show>" }),
						", the 4 ",
						createVNode(_components.code, { children: "<Switch>" }),
						" conditions → one ",
						createVNode(_components.code, { children: "switch" }),
						" over ",
						createVNode(_components.code, { children: "canvasMode().kind" })
					] }),
					"\n",
					createVNode(_components.td, { children: "12–20" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "2" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Dialog controllers" }),
						" — ",
						createVNode(_components.code, { children: "useCommandPalette" }),
						" + ",
						createVNode(_components.code, { children: "createDisclosure" }),
						"×4 + ",
						createVNode(_components.code, { children: "useDialogStack" })
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"Five ",
						createVNode(_components.em, { children: "independent" }),
						" dialog visibilities + one shared focus-arbitration concern"
					] }),
					"\n",
					createVNode(_components.td, { children: [
						"5 modal signals, ",
						createVNode(_components.code, { children: "withRefocus" }),
						", ",
						createVNode(_components.code, { children: "handlePaletteOpenChange" }),
						", the DOM probe"
					] }),
					"\n",
					createVNode(_components.td, { children: "55–70" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "3" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: createVNode(_components.code, { children: "useTerminalSearch" }) }),
						" (new, ",
						createVNode(_components.code, { children: "terminal/" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: "Per-active-terminal find-bar visibility (terminal lifecycle, not modal)" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "searchOpen" }),
						" + its ",
						createVNode(_components.code, { children: "on(activeId)" }),
						" reset effect + prop threading"
					] }),
					"\n",
					createVNode(_components.td, { children: "8–12" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "4" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: "Handlers go home" }),
						" — ",
						createVNode(_components.code, { children: "useCanvasArrange.centerActive" }),
						", ",
						createVNode(_components.code, { children: "useSubPanel.toggleOrCreate" }),
						", ",
						createVNode(_components.code, { children: "TerminalContent" }),
						" self-reads"
					] }),
					"\n",
					createVNode(_components.td, { children: "Domain behavior belongs to the domain that owns the state" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "handleToggleSubPanel" }),
						", ",
						createVNode(_components.code, { children: "handleCanvasCenterActive" }),
						", 6 re-threaded tile props"
					] }),
					"\n",
					createVNode(_components.td, { children: "45–60" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "5" }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "useServerIdentity" }) }), " (new)"] }),
					"\n",
					createVNode(_components.td, { children: "How the server name / theme-color / PWA chrome is fetched + exposed" }),
					"\n",
					createVNode(_components.td, { children: [
						"the ",
						createVNode(_components.code, { children: "info()" }),
						" fetch, the ",
						createVNode(_components.code, { children: "identity" }),
						" signal, the ",
						createVNode(_components.code, { children: "appTitle" }),
						" prop-drill"
					] }),
					"\n",
					createVNode(_components.td, { children: "~12" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: "6" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.strong, { children: createVNode(_components.code, { children: "useActionContext" }) }),
						" (new, ",
						createVNode(_components.code, { children: "input/" }),
						") — ",
						createVNode(_components.em, { children: "deferred" })
					] }),
					"\n",
					createVNode(_components.td, { children: "Binding the key-dispatch + palette surfaces to one wiring object" }),
					"\n",
					createVNode(_components.td, { children: [
						"the ~40-line ",
						createVNode(_components.code, { children: "ActionContext" }),
						" literal — ",
						createVNode(_components.em, { children: "only if the residual still reads as non-layout" })
					] }),
					"\n",
					createVNode(_components.td, { children: "0–45" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Two cross-cutting moves enable the table. ",
			createVNode(_components.strong, { children: [
				createVNode(_components.code, { children: "useTerminalCrud" }),
				" is promoted from a\n",
				createVNode(_components.code, { children: "{store}" }),
				"-factory to a ",
				createVNode(_components.code, { children: "createSharedRoot" }),
				" singleton"
			] }),
			" (mirroring the shipped\n",
			createVNode(_components.code, { children: "useIntentEditor" }),
			" de-deps) so ",
			createVNode(_components.code, { children: "TerminalContent" }),
			"/",
			createVNode(_components.code, { children: "TileTitleActions" }),
			" can read it\ndirectly instead of receiving crud-derived closures — this is the load-bearing\nprerequisite for seam 4. And the ",
			createVNode(_components.strong, { children: [createVNode(_components.code, { children: "__koluSimulateAlert" }), " test-hook folds into its\nproducer"] }),
			" (",
			createVNode(_components.code, { children: "useTerminalAlerts" }),
			"), which already owns the ",
			createVNode(_components.code, { children: "window" }),
			"/",
			createVNode(_components.code, { children: "navigator" }),
			" test\nsurface."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "-what-the-review-gauntlet-changed",
			children: "③ What the review gauntlet changed"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The plan you’re reading already survived the structural debate it would otherwise\nface in review. Three corrections matter, because each is a place the\n“fewer-lines-in-one-file” instinct would have made the code ",
			createVNode(_components.em, { children: "worse" }),
			":"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "✅ Refuse the useOverlays() god-hook — the single best call",
			children: createVNode(_components.p, { children: [
				"Bundling five unrelated dialogs behind one growing interface re-complects exactly\nwhat #1340 wants apart: six independent visibility volatilities forced to change\ntogether. Both lenses flagged a ",
				createVNode(_components.code, { children: "useOverlays()" }),
				" as a blocker. Instead: ",
				createVNode(_components.strong, { children: "per-dialog\ncontrollers" }),
				", with the four trivial toggles sharing ",
				createVNode(_components.strong, { children: [
					"one ",
					createVNode(_components.code, { children: "createDisclosure()" }),
					"\nfactory"
				] }),
				" (not four near-empty bespoke hooks — that just multiplies the same\nconcept under four names), and only ",
				createVNode(_components.code, { children: "useCommandPalette" }),
				" earning a real controller\n(it has genuine logic: ",
				createVNode(_components.code, { children: "initialGroup" }),
				" reset + the refocus probe).\n",
				createVNode($$Pill, {
					variant: "new",
					children: "Lowy: six axes"
				}),
				" ",
				createVNode($$Pill, {
					variant: "new",
					children: "Hickey: de-dup the disclosure"
				})
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "good",
			title: "🔌 Give 'is any dialog open?' one small owner — a counter, not a god-hook",
			children: createVNode(_components.p, { children: [
				"The DOM probe (",
				createVNode(_components.code, { children: "querySelector" }),
				" for an open Corvu dialog) is the close-refocus\npolicy reading the rendered DOM as a backchannel. The naive replacement — a\n",
				createVNode(_components.code, { children: "createMemo" }),
				" OR-ing every dialog’s ",
				createVNode(_components.code, { children: "open()" }),
				" — must ",
				createVNode(_components.em, { children: "enumerate every dialog and stay\nin sync forever" }),
				" (miss one, like ",
				createVNode(_components.code, { children: "KavalInfoDialog" }),
				", and refocus steals focus). The\nsimpler owner is a ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "useDialogStack" }), " mount-counter"] }),
				": each dialog self-registers\non open/close through the shared ",
				createVNode(_components.code, { children: "ModalDialog" }),
				" boundary, refocus reads\n",
				createVNode(_components.code, { children: "openCount() === 0" }),
				". Self-healing like the DOM probe, but reactive and with ",
				createVNode(_components.strong, { children: "zero\nenumeration to maintain" }),
				". The refocus-on-close policy itself hoists once into\n",
				createVNode(_components.code, { children: "ModalDialog.refocusOnClose" }),
				", retiring the ",
				createVNode(_components.em, { children: "three" }),
				" hand-duplicated copies (App’s\n",
				createVNode(_components.code, { children: "withRefocus" }),
				", ",
				createVNode(_components.code, { children: "handlePaletteOpenChange" }),
				", and DiagnosticInfo’s inline block)."
			] })
		}),
		"\n",
		createVNode($$Callout, {
			kind: "warn",
			title: "⚡ useActionContext consumes VERBS, not setters — and may not need to exist",
			children: createVNode(_components.p, { children: [
				"The original sketch threaded raw ",
				createVNode(_components.code, { children: "Setter<boolean>" }),
				" fields through a deps arg —\nwhich re-opens the very signal-API leak seam 2 just sealed. Corrected:\n",
				createVNode(_components.code, { children: "useActionContext" }),
				" calls the controllers’ ",
				createVNode(_components.strong, { children: "stable verbs" }),
				"\n(",
				createVNode(_components.code, { children: "commandPalette.toggle()" }),
				", ",
				createVNode(_components.code, { children: "terminalSearch.toggleActive()" }),
				") and sources the\nsingletons itself, so it takes ",
				createVNode(_components.strong, { children: "zero deps" }),
				". Hickey went further: this cluster\nmostly ",
				createVNode(_components.em, { children: "relocates" }),
				" the file’s most-entangled fan-in. The real reduction comes from\nthe ",
				createVNode(_components.strong, { children: "other" }),
				" seams removing their own fields at the source — after which the\nresidual literal is legitimate shell coordination that may not warrant its own\nmodule. Hence ",
				createVNode($$Pill, {
					variant: "md",
					children: "deferred"
				}),
				": extract last, and only if it\nstill reads as non-layout."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			"The fourth change is an ",
			createVNode(_components.em, { children: "addition" }),
			": Lowy caught that the ",
			createVNode(_components.strong, { children: "server-identity fetch" }),
			"\n(seam 5) was a real volatility the five-cluster framing missed entirely — the one\nstray fetch never migrated to the ",
			createVNode(_components.code, { children: "useXxx" }),
			" pattern, prop-drilled through the shell.\nA small bonus rides seam 1: delete the dead ",
			createVNode(_components.code, { children: "daemonDown()" }),
			" export (zero live\nimporters) while rewriting that region."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "-order-guardrails-and-the-behavior-bar",
			children: "④ Order, guardrails, and the behavior bar"
		}),
		"\n",
		createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Sequence (commit order within the one branch)." }), " The seams aren’t peers in the\ndependency graph; this order keeps every commit behavior-preserving and bisectable:"] }),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "useTerminalCrud" }), " → singleton"] }),
				" — the enabling prerequisite; unblocks seam 4. ",
				createVNode($$Pill, {
					variant: "hi",
					children: "highest risk"
				}),
				" (instantiation/disposal change — verify owner semantics the way ",
				createVNode(_components.code, { children: "useTerminalStore" }),
				" was)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "In parallel, all leaves:" }),
				" ",
				createVNode(_components.code, { children: "useCanvasMode" }),
				" ∥ ",
				createVNode(_components.code, { children: "useServerIdentity" }),
				" ∥ ",
				createVNode(_components.code, { children: "ModalDialog.refocusOnClose" }),
				" + ",
				createVNode(_components.code, { children: "useDialogStack" }),
				" ∥ the ",
				createVNode(_components.code, { children: "__koluSimulateAlert" }),
				" fold-in."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Dialog controllers" }),
				" (",
				createVNode(_components.code, { children: "useCommandPalette" }),
				" + ",
				createVNode(_components.code, { children: "createDisclosure" }),
				"×4, DOM-probe → ",
				createVNode(_components.code, { children: "useDialogStack" }),
				") ∥ ",
				createVNode(_components.strong, { children: createVNode(_components.code, { children: "useTerminalSearch" }) }),
				" (its own commit — highest behavior risk in seam 2, crosses the ",
				createVNode(_components.code, { children: "terminal/" }),
				" boundary)."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Handlers go home" }),
				" (",
				createVNode(_components.code, { children: "centerActive" }),
				", ",
				createVNode(_components.code, { children: "toggleOrCreate" }),
				", ",
				createVNode(_components.code, { children: "TerminalContent" }),
				" prop-shedding)."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: createVNode(_components.code, { children: "useActionContext" }) }), " — last, consuming verbs, if it earns its module."] }),
			"\n"
		] }),
		"\n",
		createVNode($$Callout, {
			kind: "danger",
			title: "Do NOT extract — the over-extraction traps",
			children: createVNode(_components.p, { children: [
				"The thin shell keeps real work. ",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "closeTerminal" }), " stays"] }),
				" (dialog-orchestration glue\nthat pops the root-mounted ",
				createVNode(_components.code, { children: "<CloseConfirm>" }),
				"; keep ",
				createVNode(_components.code, { children: "onCloseTerminal" }),
				" as the one\ndrilled prop). ",
				createVNode(_components.strong, { children: "The export/screenshot closures stay" }),
				" (single-caller active-id\nresolvers — wrapping them violates ",
				createVNode(_components.em, { children: "no-thin-wrapper-functions" }),
				"). ",
				createVNode(_components.strong, { children: [
					createVNode(_components.code, { children: "dockPalette" }),
					" and\nthe ",
					createVNode(_components.code, { children: "createCommands" }),
					" palette-deps spread stay"
				] }),
				" (binding two surfaces to one wiring\nobject ",
				createVNode(_components.em, { children: "is" }),
				" the shell’s coordination role). ",
				createVNode(_components.strong, { children: [
					"The canvas-arm JSX and the\n",
					createVNode(_components.code, { children: "<Resizable>" }),
					" split stay"
				] }),
				" — only the ",
				createVNode(_components.em, { children: "precedence decision" }),
				" leaves, never the\nlayout markup with its load-bearing invariants. And ",
				createVNode(_components.strong, { children: ["don’t eagerly hoist\n", createVNode(_components.code, { children: "useRecorder()" })] }),
				" — preserve the lazy ",
				createVNode(_components.code, { children: "() => useRecorder().togglePause()" }),
				" shape."
			] })
		}),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "The behavior bar." }),
			" This is a refactor with ",
			createVNode(_components.strong, { children: "no UI change" }),
			", so the e2e suite is\nthe guard — every removed line’s effect is already exercised: ",
			createVNode(_components.code, { children: "kaval-daemon.feature" }),
			"\n(the down-beats-empty / warming-beats-empty precedence, seam 1), ",
			createVNode(_components.code, { children: "command-palette" })
		] }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.code, { children: "keyboard-shortcuts" }),
				" + ",
				createVNode(_components.code, { children: "welcome" }),
				" (dialog open/close + refocus, seam 2),\n",
				createVNode(_components.code, { children: "terminal.feature" }),
				" find-in-terminal (seam 3), ",
				createVNode(_components.code, { children: "terminal" }),
				"/",
				createVNode(_components.code, { children: "sub-terminal" }),
				"/",
				createVNode(_components.code, { children: "kill" }),
				"\n(seam 4), ",
				createVNode(_components.code, { children: "activity-alerts" }),
				" (the test-hook fold-in). The one genuinely ",
				createVNode(_components.em, { children: "new" }),
				" test is\n",
				createVNode(_components.code, { children: "canvasModeResolver.test.ts" }),
				" — asserting the tier precedence\n(connecting ▸ down ▸ warming ▸ empty ▸ workspace) and the down/warming payloads\nwithout rendering. That precedence is pulled into a dependency-free\n",
				createVNode(_components.code, { children: "resolveCanvasMode(facts)" }),
				" (the ",
				createVNode(_components.code, { children: "useCanvasMode" }),
				" accessor just gathers the live\ndaemon/session facts and delegates), so the decision is exercised as a pure\nfunction — no daemon-status subscription to mount — which is the whole point of\nlifting it out of the JSX."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"Implemented in ",
			createVNode($$PrLink, { pr: 1347 }),
			" — App.tsx landed at ",
			createVNode(_components.strong, { children: "~530 lines / 3 reactive\nprimitives" }),
			", and the ",
			createVNode(_components.code, { children: "app-shell-stays-thin" }),
			" code-police rule + ",
			createVNode(_components.code, { children: "App.shell.test.ts" }),
			"\nbudget now keep it there."
		] }),
		"\n",
		createVNode(_components.hr, {}),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Method · 9 subagents over a 2-phase workflow: 5 cluster mappers + an idiom/sequencing\npass → independent Lowy + Hickey structural lenses → reconciled synthesis. Source:\n",
			createVNode(_components.code, { children: "packages/client/src" }),
			", branch ",
			createVNode(_components.code, { children: "refactor/app-thin-shell" }),
			", 2026-06-13."
		] }) })
	] });
}
function MDXContent(props = {}) {
	const { wrapper: MDXLayout } = props.components || {};
	return MDXLayout ? createVNode(MDXLayout, Object.assign({}, props, { children: createVNode(_createMdxContent, props) })) : _createMdxContent(props);
}
var frontmatter = {
	"title": "App.tsx: Restore the Thin Layout Shell",
	"description": "A plan to decompose the 785-line App.tsx kitchen-sink into six volatility-aligned seams — pressure-tested by the lowy + hickey lenses before a line of code.",
	"parents": ["analysis"],
	"status": "implemented",
	"maturity": "budding"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "-the-drift--apptsx-became-the-catch-all",
			"text": "① The drift — App.tsx became the catch-all"
		},
		{
			"depth": 2,
			"slug": "-six-seams-six-axes-of-change",
			"text": "② Six seams, six axes of change"
		},
		{
			"depth": 2,
			"slug": "-what-the-review-gauntlet-changed",
			"text": "③ What the review gauntlet changed"
		},
		{
			"depth": 2,
			"slug": "-order-guardrails-and-the-behavior-bar",
			"text": "④ Order, guardrails, and the behavior bar"
		}
	];
}
var url = "src/content/atlas/app-thin-shell.mdx";
var file = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/app-thin-shell.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/chat-1/docs/atlas/src/content/atlas/app-thin-shell.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
