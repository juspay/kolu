import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Callout } from "./Callout_va3z_Xoj.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
import { t as $$Cite } from "./Cite_D-1zLbJ9.mjs";
import { t as $$Finding } from "./Finding_CvNn4Bil.mjs";
//#region src/content/atlas/correctness-review.mdx
function _createMdxContent(props) {
	const _components = Object.assign({
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
			"A static correctness audit of the codebase, focused on logic errors, false\nsafety boundaries, lifecycle leaks, silent failure handling, and restore\nfidelity. Date: 2026-06-01 · commit reviewed ",
			createVNode(_components.code, { children: "1a62eeeb" }),
			" · method: repo map,\ntargeted static scans, source verification against line anchors."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "summary",
			children: "Summary"
		}),
		"\n",
		createVNode($$Callout, {
			kind: "accent",
			title: "Verdict",
			children: createVNode(_components.p, { children: [
				"Six correctness issues worth fixing. The high-severity terminal lifecycle leak\nis fixed by ",
				createVNode($$PrLink, { pr: 1105 }),
				", the OpenCode silent-parse issue by\n",
				createVNode($$PrLink, { pr: 1108 }),
				", and the high-severity path-authority symlink escape by\n",
				createVNode($$PrLink, { pr: 1128 }),
				". The remaining open set is three medium-severity issues."
			] })
		}),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Severity" }),
					"\n",
					createVNode(_components.th, { children: "Finding" }),
					"\n",
					createVNode(_components.th, { children: "Primary surface" }),
					"\n",
					createVNode(_components.th, { children: "Status" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "High"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Repo-root guard is lexical only; symlinks can escape the repo for reads, previews, and local diffs." }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "kolu-git" }), ", iframe preview"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "ok",
							children: "fixed"
						}),
						" ",
						createVNode($$PrLink, { pr: 1128 })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "hi",
						children: "High"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Terminal exit subscriptions leak forever for explicitly killed terminals." }),
					"\n",
					createVNode(_components.td, { children: "client terminal lifecycle, server events" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "ok",
							children: "fixed"
						}),
						" ",
						createVNode($$PrLink, { pr: 1105 })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "Medium"
					}) }),
					"\n",
					createVNode(_components.td, { children: "PTY channel aborts leak subscribers when the abort fires between pulls." }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "@kolu/pty-host" }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "warn",
						children: "open"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "Medium"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Session restore drops persisted metadata and active selection for sub-terminals." }),
					"\n",
					createVNode(_components.td, { children: "client session restore" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "warn",
						children: "open"
					}) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "Medium"
					}) }),
					"\n",
					createVNode(_components.td, { children: "OpenCode message JSON parse failure is silently treated as “no messages yet”." }),
					"\n",
					createVNode(_components.td, { children: "OpenCode integration watcher" }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$Pill, {
							variant: "ok",
							children: "fixed"
						}),
						" ",
						createVNode($$PrLink, { pr: 1108 })
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "md",
						children: "Medium"
					}) }),
					"\n",
					createVNode(_components.td, { children: "Terminal kill unregisters local state even when pty-host kill fails; the client removes the UI anyway." }),
					"\n",
					createVNode(_components.td, { children: "server terminal backend, client terminal CRUD" }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "warn",
						children: "open"
					}) }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "scope",
			children: "Scope"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Reviewed the major correctness-bearing paths across ",
			createVNode(_components.code, { children: "packages/common" }),
			",\n",
			createVNode(_components.code, { children: "packages/server" }),
			", ",
			createVNode(_components.code, { children: "packages/client" }),
			", ",
			createVNode(_components.code, { children: "packages/integrations" }),
			",\n",
			createVNode(_components.code, { children: "packages/pty-host" }),
			", ",
			createVNode(_components.code, { children: "packages/shared" }),
			", and ",
			createVNode(_components.code, { children: "packages/surface" }),
			" — emphasizing file\nauthority, streaming and event lifetimes, session persistence, terminal\nlifecycle, integration parsers, SQLite/watchers, and error fallbacks. Not run\nend-to-end; findings are source-derived and should be paired with focused tests\nas each fix lands."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "findings",
			children: "Findings"
		}),
		"\n",
		createVNode($$Finding, {
			sev: "high",
			id: "symlink-escape",
			title: "Repo-root guard can be bypassed by symlinks",
			children: [
				createVNode(_components.p, { children: [
					createVNode(_components.code, { children: "resolveUnder" }),
					" prevents lexical traversal like ",
					createVNode(_components.code, { children: "../../etc/passwd" }),
					", but it does not\nresolve symlinks. A repo path such as ",
					createVNode(_components.code, { children: "leak -> /etc/passwd" }),
					" passes the string\ncheck because the path still appears to live under the repo. The later filesystem\ncalls follow the symlink."
				] }),
				createVNode(_components.p, { children: "Refs:" }),
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode($$Cite, {
							file: "packages/integrations/git/src/safe-path.ts",
							lines: "24-36"
						}),
						" — ",
						createVNode(_components.code, { children: "path.resolve" }),
						" plus ",
						createVNode(_components.code, { children: "path.relative" }),
						", no ",
						createVNode(_components.code, { children: "realpath" })
					] }),
					"\n",
					createVNode(_components.li, { children: [createVNode($$Cite, {
						file: "packages/integrations/git/src/browse.ts",
						lines: "49-68"
					}), " — Code-tab file reads use the resolved absolute path"] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode($$Cite, {
							file: "packages/server/src/iframePreviewRoute.ts",
							lines: "88-125"
						}),
						" — preview resolution then ",
						createVNode(_components.code, { children: "stat" }),
						"/",
						createVNode(_components.code, { children: "readFile" })
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode($$Cite, {
							file: "packages/integrations/git/src/review.ts",
							lines: "219-267"
						}),
						" — local untracked fallback diffs ",
						createVNode(_components.code, { children: "/dev/null" }),
						" against the resolved absolute path"
					] }),
					"\n"
				] }),
				createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Risk:" }), " the Code tab, binary preview route, and local diff fallback can read or render files outside the repository root — both a correctness bug and a security boundary failure for any untrusted workspace."] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Fix:" }),
					" split lexical path normalization from filesystem authority checks. For any operation that reads, stats, or diffs an existing file, compare ",
					createVNode(_components.code, { children: "fs.realpath" }),
					" of the root and target before use; reject targets whose real path is outside the real repo root. Keep the lexical helper only for paths that may not exist yet."
				] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Status — fixed" }),
					" in ",
					createVNode($$PrLink, { pr: 1128 }),
					". A new ",
					createVNode(_components.code, { children: "assertRealpathUnder" }),
					" in ",
					createVNode(_components.code, { children: "safe-path.ts" }),
					" resolves symlinks on ",
					createVNode(_components.em, { children: "both" }),
					" root and target via ",
					createVNode(_components.code, { children: "fs.realpath" }),
					" and rejects any target whose real path escapes (realpath’ing the root keeps a symlinked checkout or ",
					createVNode(_components.code, { children: "/tmp -> /private/tmp" }),
					" valid); any ",
					createVNode(_components.code, { children: "realpath" }),
					" failure passes through, so a missing file stays a 404 instead of masquerading as an escape. ",
					createVNode(_components.code, { children: "resolveExistingUnder" }),
					" composes it for the read/stat/diff case; ",
					createVNode(_components.code, { children: "resolveUnder" }),
					" stays lexical-only for not-yet-existing paths. Wired into ",
					createVNode(_components.code, { children: "browse.ts" }),
					", ",
					createVNode(_components.code, { children: "review.ts" }),
					", and the preview route’s ",
					createVNode(_components.code, { children: "serveResolvedFile" }),
					" (now 403s a symlink escape). Covered by symlink-escape unit tests across ",
					createVNode(_components.code, { children: "safe-path.test.ts" }),
					", ",
					createVNode(_components.code, { children: "browse.test.ts" }),
					", ",
					createVNode(_components.code, { children: "review.test.ts" }),
					", ",
					createVNode(_components.code, { children: "iframePreviewRoute.test.ts" }),
					"."
				] })
			]
		}),
		"\n",
		createVNode($$Finding, {
			sev: "high",
			id: "terminal-exit-subscriptions",
			title: "Explicit terminal kills leak exit subscriptions",
			children: [
				createVNode(_components.p, { children: [
					"Every terminal gets a per-terminal exit subscription rooted with ",
					createVNode(_components.code, { children: "createRoot" }),
					",\nbut the disposer is discarded. The server stream yields once only when\n",
					createVNode(_components.code, { children: "terminalExit" }),
					" is published. Natural exits publish that event; explicit kills\nintentionally do not. The result is a root and event stream that wait forever\nafter every explicit kill."
				] }),
				createVNode(_components.p, { children: "Refs:" }),
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode($$Cite, {
							file: "packages/client/src/terminal/useTerminals.ts",
							lines: "56-79"
						}),
						" — ",
						createVNode(_components.code, { children: "subscribeExit" }),
						" creates a root and drops the disposer"
					] }),
					"\n",
					createVNode(_components.li, { children: [createVNode($$Cite, {
						file: "packages/server/src/surface.ts",
						lines: "249-254"
					}), " — event source yields only after a bus value"] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode($$Cite, {
							file: "packages/server/src/terminalBackend/local.ts",
							lines: "553-573"
						}),
						" — explicit kill unregisters without publishing ",
						createVNode(_components.code, { children: "terminalExit" })
					] }),
					"\n",
					createVNode(_components.li, { children: [createVNode($$Cite, {
						file: "packages/client/src/terminal/useTerminalCrud.ts",
						lines: "163-170"
					}), " — client removes UI after kill and swallows errors"] }),
					"\n"
				] }),
				createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Risk:" }), " terminal churn accumulates client roots and server event subscribers for terminals already gone — memory growth and stale event channels over time."] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Fix:" }),
					" make ",
					createVNode(_components.code, { children: "subscribeExit" }),
					" return a disposer stored by terminal id (dispose on natural exit, explicit kill, and list removal), or derive exit subscriptions from the terminal list with keyed cleanup."
				] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Status — fixed" }),
					" in ",
					createVNode($$PrLink, { pr: 1105 }),
					". Exit subscriptions are now derived from the live terminal list with ",
					createVNode(_components.code, { children: "mapArray" }),
					" in ",
					createVNode(_components.code, { children: "useTerminalExits.ts" }),
					" — the same list-keyed lifecycle ",
					createVNode(_components.code, { children: "useTerminalMetadata" }),
					" uses. Each id owns a reactive owner SolidJS disposes the instant the id leaves the list, so explicit kills, ",
					createVNode(_components.code, { children: "killAll" }),
					", and natural exits all release with no disposer map. Covered by ",
					createVNode(_components.code, { children: "useTerminalExits.test.ts" }),
					"."
				] })
			]
		}),
		"\n",
		createVNode($$Finding, {
			sev: "medium",
			id: "channel-abort",
			title: "PTY channel abort can leak when no pull is pending",
			children: [
				createVNode(_components.p, { children: [
					createVNode(_components.code, { children: "Channel.subscribe" }),
					" cleans up immediately when ",
					createVNode(_components.code, { children: "CLOSE" }),
					" is pushed into a pending\n",
					createVNode(_components.code, { children: "next()" }),
					". But an abort that fires between pulls only queues ",
					createVNode(_components.code, { children: "CLOSE" }),
					". If the\nconsumer never pulls again after cancellation, the subscriber remains in ",
					createVNode(_components.code, { children: "subs" }),
					"\nand the abort listener remains attached."
				] }),
				createVNode(_components.p, { children: "Refs:" }),
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode($$Cite, {
							file: "packages/pty-host/src/channel.ts",
							lines: "88-138"
						}),
						" — abort handler calls ",
						createVNode(_components.code, { children: "sub.push(CLOSE)" })
					] }),
					"\n",
					createVNode(_components.li, { children: [createVNode($$Cite, {
						file: "packages/pty-host/src/channel.ts",
						lines: "95-114"
					}), " — cleanup happens only on the pending-next close path"] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode($$Cite, {
							file: "packages/pty-host/src/channel.test.ts",
							lines: "75-95"
						}),
						" — current abort coverage only tests a pending ",
						createVNode(_components.code, { children: "next()" })
					] }),
					"\n"
				] }),
				createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Risk:" }), " cancelled attach/tap streams can leave dead subscribers behind if cancellation happens while the consumer isn’t actively awaiting."] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Fix:" }),
					" introduce a single ",
					createVNode(_components.code, { children: "finish()" }),
					" path for abort/close that removes the subscriber and listener immediately, resolves any pending ",
					createVNode(_components.code, { children: "next()" }),
					" as done, and prevents future buffered delivery."
				] })
			]
		}),
		"\n",
		createVNode($$Finding, {
			sev: "medium",
			id: "subterminal-restore",
			title: "Sub-terminal restore loses saved metadata and active selection",
			children: [
				createVNode(_components.p, { children: [
					"Top-level terminals are restored with saved metadata and the old id mapped to the\nnew id. Sub-terminals are recreated with only ",
					createVNode(_components.code, { children: "cwd" }),
					" — their saved ",
					createVNode(_components.code, { children: "themeName" }),
					",\n",
					createVNode(_components.code, { children: "canvasLayout" }),
					", panel state, intent, last activity, and agent command are\nignored, and their old id is never mapped. A saved active terminal pointing to a\nsub-terminal therefore cannot be restored."
				] }),
				createVNode(_components.p, { children: "Refs:" }),
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode($$Cite, {
							file: "packages/client/src/terminal/useSessionRestore.ts",
							lines: "247-294"
						}),
						" — top-level pass metadata + populate ",
						createVNode(_components.code, { children: "oldToNew" }),
						"; sub-terminals pass only ",
						createVNode(_components.code, { children: "cwd" })
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode($$Cite, {
							file: "packages/client/src/terminal/useTerminalCrud.ts",
							lines: "151-160"
						}),
						" — ",
						createVNode(_components.code, { children: "handleCreateSubTerminal" }),
						" accepts no initial metadata and returns no id"
					] }),
					"\n",
					createVNode(_components.li, { children: [createVNode($$Cite, {
						file: "packages/common/src/surface.ts",
						lines: "318-327"
					}), " — saved sessions persist metadata for every saved terminal"] }),
					"\n"
				] }),
				createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Risk:" }), " restoring a workspace with sub-terminals silently changes saved UI and agent state; if the active terminal was a sub-terminal, restore falls back instead of reselecting it."] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Fix:" }),
					" change ",
					createVNode(_components.code, { children: "handleCreateSubTerminal" }),
					" to accept ",
					createVNode(_components.code, { children: "InitialTerminalMetadata" }),
					" and return the new id; during restore pass the same persisted fields used for top-level terminals, seed sub/right-panel state, populate ",
					createVNode(_components.code, { children: "oldToNew" }),
					", and reselect the mapped active sub-terminal."
				] })
			]
		}),
		"\n",
		createVNode($$Finding, {
			sev: "medium",
			id: "opencode-parse",
			title: "OpenCode message parse failures are silently treated as empty state",
			children: [
				createVNode(_components.p, { children: [
					"The OpenCode integration reads OpenCode-owned JSON from SQLite. If the latest\n",
					createVNode(_components.code, { children: "message.data" }),
					" is malformed, ",
					createVNode(_components.code, { children: "parseMessageState" }),
					" catches the parse error and\nreturns ",
					createVNode(_components.code, { children: "null" }),
					". The watcher then logs the same debug message used for a\nlegitimate empty session: “no messages yet”."
				] }),
				createVNode(_components.p, { children: "Refs:" }),
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [
						createVNode($$Cite, {
							file: "packages/integrations/opencode/src/core.ts",
							lines: "299-331"
						}),
						" — ",
						createVNode(_components.code, { children: "deriveSessionState" }),
						" returns ",
						createVNode(_components.code, { children: "null" }),
						" when parsing returns ",
						createVNode(_components.code, { children: "null" }),
						"; JSON parse failure swallowed"
					] }),
					"\n",
					createVNode(_components.li, { children: [
						createVNode($$Cite, {
							file: "packages/integrations/opencode/src/session-watcher.ts",
							lines: "59-67"
						}),
						" — ",
						createVNode(_components.code, { children: "null" }),
						" is logged as “no messages yet”"
					] }),
					"\n"
				] }),
				createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Risk:" }), " upstream schema drift or DB corruption hides behind a normal empty-state log; the terminal badge can disappear or stale out without an actionable error."] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Fix:" }),
					" return a discriminated parse result or pass logging context into ",
					createVNode(_components.code, { children: "parseMessageState" }),
					"; treat malformed latest-row JSON as a warn/error distinct from “no row”."
				] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Status — fixed" }),
					" in ",
					createVNode($$PrLink, { pr: 1108 }),
					". ",
					createVNode(_components.code, { children: "parseMessageState" }),
					" logs malformed JSON as ",
					createVNode(_components.code, { children: "error" }),
					" (tagged with the session); the genuine no-row “no messages yet” ",
					createVNode(_components.code, { children: "debug" }),
					" moved into ",
					createVNode(_components.code, { children: "deriveSessionState" }),
					"’s ",
					createVNode(_components.code, { children: "!row" }),
					" branch. ",
					createVNode(_components.code, { children: "session-watcher.ts" }),
					" no longer flattens both into one ambiguous line. Covered by unit tests in ",
					createVNode(_components.code, { children: "index.test.ts" }),
					"."
				] })
			]
		}),
		"\n",
		createVNode($$Finding, {
			sev: "medium",
			id: "kill-confirmation",
			title: "Kill failures are hidden while local terminal state is removed",
			children: [
				createVNode(_components.p, { children: [
					"The server comment says kill awaits daemon confirmation so a failed kill cannot\norphan the PTY. The implementation catches pty-host kill failure, logs it, and\nunregisters anyway. ",
					createVNode(_components.code, { children: "killAll" }),
					" drains every terminal after a failed killAll too.\nThe client then swallows kill errors and removes the local UI regardless."
				] }),
				createVNode(_components.p, { children: "Refs:" }),
				createVNode(_components.ul, { children: [
					"\n",
					createVNode(_components.li, { children: [createVNode($$Cite, {
						file: "packages/server/src/terminals.ts",
						lines: "97-100"
					}), " — documented invariant says a failed kill cannot orphan the PTY"] }),
					"\n",
					createVNode(_components.li, { children: [createVNode($$Cite, {
						file: "packages/server/src/terminalBackend/local.ts",
						lines: "553-588"
					}), " — single kill + killAll unregister/drain after catch"] }),
					"\n",
					createVNode(_components.li, { children: [createVNode($$Cite, {
						file: "packages/client/src/terminal/useTerminalCrud.ts",
						lines: "163-170"
					}), " — client catches and removes terminal anyway"] }),
					"\n"
				] }),
				createVNode(_components.p, { children: [createVNode(_components.strong, { children: "Risk:" }), " if the pty-host kill RPC or transport fails, kolu can forget a still-running PTY and remove the user’s UI handle to it. The in-process host makes this rare, but the backend is written around a daemon/socket confirmation model."] }),
				createVNode(_components.p, { children: [
					createVNode(_components.strong, { children: "Fix:" }),
					" do not unregister on kill RPC failure — propagate the error and leave the terminal visible, mark it kill-failed while retrying, or unregister only after a natural exit/tombstone. For ",
					createVNode(_components.code, { children: "killAll" }),
					", only drain terminals confirmed killed."
				] })
			]
		}),
		"\n",
		createVNode(_components.h2, {
			id: "triage-order",
			children: "Triage order"
		}),
		"\n",
		createVNode(_components.ol, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Path authority is fixed." }),
				" ",
				createVNode($$PrLink, { pr: 1128 }),
				" split lexical normalization from ",
				createVNode(_components.code, { children: "fs.realpath" }),
				" authority and closed the symlink escape — the only issue crossing from correctness into a workspace boundary violation."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Terminal subscription lifecycle is fixed." }),
				" ",
				createVNode($$PrLink, { pr: 1105 }),
				" landed the list-keyed cleanup + regression coverage."
			] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Fix channel abort cleanup before daemon work expands" }), " — a small primitive with a large downstream blast radius."] }),
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "Fix sub-terminal restore and kill-confirmation together" }), " — both terminal lifecycle fidelity issues, covered by restore/CRUD scenarios."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "OpenCode parser errors are hardened." }),
				" ",
				createVNode($$PrLink, { pr: 1108 }),
				" landed the malformed-JSON error path + the empty-vs-malformed log split."
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
	"title": "Whole-codebase correctness review",
	"description": "A static audit of path authority, terminal lifecycle, channel cancellation, session-restore fidelity, parser failures, and kill confirmation. Not a style review.",
	"parents": ["analysis"],
	"maturity": "seedling",
	"updated": "2026-06-01T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "summary",
			"text": "Summary"
		},
		{
			"depth": 2,
			"slug": "scope",
			"text": "Scope"
		},
		{
			"depth": 2,
			"slug": "findings",
			"text": "Findings"
		},
		{
			"depth": 2,
			"slug": "triage-order",
			"text": "Triage order"
		}
	];
}
var url = "src/content/atlas/correctness-review.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/correctness-review.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/correctness-review.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
