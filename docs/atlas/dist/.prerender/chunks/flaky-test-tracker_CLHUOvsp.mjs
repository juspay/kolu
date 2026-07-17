import { N as createVNode, l as Fragment, t as __astro_tag_component__ } from "./server_B0R_ZhRD.mjs";
import { t as $$Pill } from "./Pill_B5BzzkuA.mjs";
import { t as $$PrLink } from "./PrLink_DpwCuibs.mjs";
//#region src/content/atlas/flaky-test-tracker.mdx
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
			"A fix-queue for tests that go red on one CI run and green on the next with no\ncode change. See a flake → ",
			createVNode(_components.strong, { children: "add a row" }),
			". An agent works the backlog over time."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "flake-vs-break",
			children: "Flake vs. break"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"A ",
			createVNode(_components.strong, { children: "flake" }),
			" fails nondeterministically — timing, ordering, or environment — and\nwould pass on a same-SHA rerun; a ",
			createVNode(_components.strong, { children: "break" }),
			" fails the same way every run and is a\nreal defect, so file a ",
			createVNode(_components.a, {
				href: "./bug.html",
				children: "bug"
			}),
			" instead. A one-off rerun via the ",
			createVNode(_components.strong, { children: "odu\nMCP" }),
			" is fine to ",
			createVNode(_components.em, { children: "triage" }),
			" which it is — but a rerun is never how a flake gets\n",
			createVNode(_components.em, { children: "fixed" }),
			" (see the routine below)."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "backlog",
			children: "Backlog"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"Status: ",
			createVNode($$Pill, {
				variant: "new",
				children: "open"
			}),
			" → ",
			createVNode($$Pill, {
				variant: "run",
				children: "fixing"
			}),
			" → ",
			createVNode($$Pill, {
				variant: "ok",
				children: "fixed"
			}),
			" (then strike the row)."
		] }),
		"\n",
		createVNode(_components.p, { children: createVNode(_components.em, { children: [
			"Queue clear — the eight below were fixed in ",
			createVNode($$PrLink, { pr: 1440 }),
			" (struck = done; the reusable patterns live in ",
			createVNode(_components.a, {
				href: "#common-flake-classes",
				children: "Common flake classes"
			}),
			")."
		] }) }),
		"\n",
		createVNode(_components.table, { children: [
			"\n",
			createVNode(_components.thead, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.th, { children: "Test" }),
					"\n",
					createVNode(_components.th, { children: "Lane" }),
					"\n",
					createVNode(_components.th, { children: "Symptom" }),
					"\n",
					createVNode(_components.th, { children: "Repro’d in" }),
					"\n",
					createVNode(_components.th, { children: "Status" }),
					"\n",
					createVNode(_components.th, { children: "Fix" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n",
			createVNode(_components.tbody, { children: [
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.del, { children: [
						"Code tab history survives switching between terminals in different repos (",
						createVNode(_components.code, { children: "code-tab.feature:714" }),
						")"
					] }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "e2e@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "back" }),
						" button never enabled — ",
						createVNode(_components.code, { children: "waitFor" }),
						" 20s timeout"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1440 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "fixed"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1440 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.del, { children: [
						"Clicking a folder ref reveals and expands the directory (",
						createVNode(_components.code, { children: "file-ref-link.feature:69" }),
						")"
					] }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "e2e@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "app/core" }),
						" never expands — a fresh-open (cold panel) reveal races ",
						createVNode(_components.code, { children: "fsListAll" }),
						"’s first snapshot via a one-shot resolve with no re-yield, so a commit-marker barrier can’t fix it. Mount the tree first; the fresh-open resolve is covered by ",
						createVNode(_components.code, { children: "lineRef.test.ts" })
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1440 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "fixed"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1440 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.del, { children: [
						"Selected file survives switching to another terminal and back [branch] (",
						createVNode(_components.code, { children: "code-tab.feature:148" }),
						")"
					] }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "e2e@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: ["tree never hydrated — branch-mode gitStatus stuck on ", createVNode(_components.code, { children: "BASE_BRANCH_NOT_FOUND" })] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1440 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "fixed"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1440 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.del, { children: [
						"Regaining window focus repaints a render-stalled terminal (",
						createVNode(_components.code, { children: "render_recovery.feature:16" }),
						")"
					] }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "e2e@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "AssertionError" }), " — screen not repainted on focus regain"] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1440 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "fixed"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1440 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.del, { children: [
						"Close sub-terminal via tab close button (",
						createVNode(_components.code, { children: "sub-terminal.feature:107" }),
						")"
					] }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "e2e@x86_64-linux" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "sub-terminal should have keyboard focus" }),
						" — ",
						createVNode(_components.code, { children: "waitForFunction" }),
						" timeout (focus not restored after close)"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1440 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "fixed"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1440 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.del, { children: [
						"Scroll on terminal does not pan the canvas (",
						createVNode(_components.code, { children: "canvas.feature:161" }),
						")"
					] }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "e2e@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: ["tile-centering pan raced the recorded baseline → ", createVNode(_components.code, { children: "canvas transform changed unexpectedly" })] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1440 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "fixed"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1440 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.del, { children: [
						"Tile chrome shows task progress when Claude has tasks (",
						createVNode(_components.code, { children: "claude-code.feature:77" }),
						")"
					] }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "e2e@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"appended-transcript fs event dropped → task progress ",
						createVNode(_components.code, { children: "3/5" }),
						" never showed"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1440 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "fixed"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1440 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.del, { children: [
						"pulam daemon — dials a kaval, serves awareness (",
						createVNode(_components.code, { children: "daemon.test.ts" }),
						")"
					] }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "unit@x86_64-linux" }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "waitFor" }), " didn’t catch a transient oRPC stream error from the live awareness collection → test threw (vitest, no retry)"] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1440 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "fixed"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1440 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"createPtyHost — routes write() to the child and lists live PTYs (",
						createVNode(_components.code, { children: "kaval/src/ptyHost.test.ts:373" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "unit@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "Test timed out in 5000ms" }),
						" — a real-PTY spawn-then-write test stalled past the 5s default on the darwin box; the linux lane passed the same SHA, and the PR touches no ",
						createVNode(_components.code, { children: "packages/kaval" }),
						" file (single-node rerun green)"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1497 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "open"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"a throwing reconcile listener is caught, not propagated (",
						createVNode(_components.code, { children: "integrations/io/src/refcounted-dir-watcher.test.ts" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "unit@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "Test timed out in 5000ms" }),
						" — the watcher test stalled on the loaded darwin box; the linux lane passed the same SHA, and the PR touches no ",
						createVNode(_components.code, { children: "packages/integrations/io" }),
						" file. Green on a same-SHA node rerun (6/6 tests in 2.9s)."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1807 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "open"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Sub-terminal keeps keyboard focus after close (",
						createVNode(_components.code, { children: "sub-terminal.feature" }),
						", ",
						createVNode(_components.code, { children: "sub_terminal_steps.ts:132" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "e2e@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "the sub-terminal should have keyboard focus" }),
						" — ",
						createVNode(_components.code, { children: "waitForFunction" }),
						" timeout (focus not restored after close); the same flake fixed for the linux lane in ",
						createVNode($$PrLink, { pr: 1440 }),
						" recurring on the loaded darwin box (472/473 scenarios passed), unrelated to the PR’s surface/pulam changes"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1497 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "open"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Clicking a folder ref while already browsing expands it in the live tree (",
						createVNode(_components.code, { children: "file-ref-link.feature:112" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "e2e@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "lib/ui" }),
						" never reaches ",
						createVNode(_components.code, { children: "aria-expanded=true" }),
						" — ",
						createVNode(_components.code, { children: "locator.waitFor" }),
						" 60s timeout across all 3 retries on both runs. A live change into an ",
						createVNode(_components.strong, { children: "already-mounted" }),
						" Pierre tree updates the model but never repaints — the unfixed ",
						createVNode(_components.a, {
							href: "https://github.com/juspay/kolu/issues/1534",
							children: "#1534"
						}),
						" swallow-emit class (sibling of the fresh-open ",
						createVNode(_components.code, { children: ":69" }),
						" case fixed in ",
						createVNode($$PrLink, { pr: 1440 }),
						", whose “mount first” fix doesn’t cover the mounted-tree live update). The linux lane passed the same SHA (482/483), and the PR touches ",
						createVNode(_components.strong, { children: "no" }),
						" Code-tab/Pierre/file-ref code (all changes are pulam-web + surface), so unrelated to it. Carried by R-pulamweb-4’s vendored ",
						createVNode(_components.code, { children: "@pierre/trees" }),
						" patch."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1568 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "open"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"worktreeCreate — ",
						createVNode(_components.code, { children: "WORKTREE_NAME_COLLISION" }),
						" / ",
						createVNode(_components.code, { children: "uses latest remote HEAD…" }),
						" (",
						createVNode(_components.code, { children: "packages/integrations/git" }),
						", varying subtest)"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "unit@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "Test timed out in 15000ms" }),
						" — flaked TWICE in one night (different subtest each time) on PR #1714’s CI, whose diff touches no ",
						createVNode(_components.code, { children: "packages/integrations/git" }),
						" file; the file takes ~50s wall on a loaded darwin box, so the 15s per-test budget is too tight under load. Green on both same-SHA reruns; linux lane green throughout. Recurred on ",
						createVNode($$PrLink, { pr: 1755 }),
						" (subtest ",
						createVNode(_components.code, { children: "uses latest remote HEAD after remote changes its default branch" }),
						", ~53s file wall) — same class, green on a same-SHA node rerun; that PR touches ",
						createVNode(_components.code, { children: "browse.ts" }),
						"/",
						createVNode(_components.code, { children: "errors.ts" }),
						"/",
						createVNode(_components.code, { children: "index.ts" }),
						" but not ",
						createVNode(_components.code, { children: "worktree.ts" }),
						" or the timed-out test."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$PrLink, { pr: 1714 }),
						", ",
						createVNode($$PrLink, { pr: 1755 })
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "open"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Touch-swiping down inside the terminal scrolls the scrollback up (",
						createVNode(_components.code, { children: "mobile-terminal-scroll.feature:14" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "e2e@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "viewportY" }),
						" never decreased — stayed at 122 after a 20s poll. Flipped ",
						createVNode(_components.strong, { children: "green" }),
						" on a same-SHA rerun (a different scenario flaked instead), so a mobile touch-scroll timing race, unrelated to the PR’s padi-process changes."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1664 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "open"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.del, { children: [
						"File-drop / clipboard path reaches the PTY (",
						createVNode(_components.code, { children: "file-drop.feature:10" }),
						"+",
						createVNode(_components.code, { children: ":14" }),
						", ",
						createVNode(_components.code, { children: "clipboard.feature:9" }),
						")"
					] }) }),
					"\n",
					createVNode(_components.td, { children: [createVNode(_components.code, { children: "e2e" }), " (both)"] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "the screen state should contain \"<file>\"" }),
						" → 20s ",
						createVNode(_components.code, { children: "waitForFunction" }),
						" timeout. Root cause is the ",
						createVNode(_components.strong, { children: "screen-state reader" }),
						", not delivery: the DIAG dump shows both ",
						createVNode(_components.code, { children: "scratch/write" }),
						" + ",
						createVNode(_components.code, { children: "sendInput" }),
						" sent, no toast, and the filename fully on screen — but the long W2.2 scratch path (",
						createVNode(_components.code, { children: "$XDG_RUNTIME_DIR/kolu-<pid>/scratch/<uuid>/<name>" }),
						", ~81 chars) hard-wraps at the 80-col grid before xterm’s ",
						createVNode(_components.code, { children: "fit()" }),
						" widens it under load, so the filename straddles the wrap (",
						createVNode(_components.code, { children: "…no" }),
						"+",
						createVNode(_components.code, { children: "tes.md" }),
						"). ",
						createVNode(_components.code, { children: "__readXtermBuffer" }),
						" joined rows with ",
						createVNode(_components.code, { children: "\\n" }),
						", splitting the match. The W2.2 padi-state-root cutover lengthened the path past the old short-",
						createVNode(_components.code, { children: "runtimeDir" }),
						" mitigation; the bash “garbles the cells” note in ",
						createVNode(_components.code, { children: "hooks.ts" }),
						" was a mis-diagnosis (cells are clean). Fix: ",
						createVNode(_components.code, { children: "__readXtermBuffer" }),
						" rejoins ",
						createVNode(_components.code, { children: "isWrapped" }),
						" continuation rows into one logical line, so a straddling filename matches regardless of width/path-length. Verified 10/10 under CPU oversubscription that gave ~100% failure pre-fix (leased ",
						createVNode(_components.code, { children: "kolu-ci-1" }),
						")."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1664 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "fixed"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1664 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: createVNode(_components.del, { children: [
						"Shell hook tests depend on host shell/hostname state (",
						createVNode(_components.code, { children: "packages/integrations/pty/src/shell.test.ts" }),
						")"
					] }) }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "unit@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"Same-SHA reruns timed out in different OSC hook tests (",
						createVNode(_components.code, { children: "OSC7_FN" }),
						", then ",
						createVNode(_components.code, { children: "OSC2_PREEXEC_BASH_GUARD" }),
						") and finally the zsh wrapper regression. The helpers said “clean” but inherited the CI process env, spawned the host ",
						createVNode(_components.code, { children: "hostname" }),
						" command, and paid one bash/zsh startup per assertion under the parallel unit lane; tests now run with a tiny explicit ",
						createVNode(_components.code, { children: "HOME" }),
						" / ",
						createVNode(_components.code, { children: "PATH" }),
						" / ",
						createVNode(_components.code, { children: "TERM" }),
						" / ",
						createVNode(_components.code, { children: "TMPDIR" }),
						" env, stub ",
						createVNode(_components.code, { children: "hostname" }),
						" in the OSC7 scripts, and execute shell snippets through long-lived clean shells with per-snippet subshell isolation."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1736 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "fixed"
					}) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1736 }) }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"omits PADI_SOCKET when padi’s serving socket is unknown (autodiscovery covers it) (",
						createVNode(_components.code, { children: "padi/src/ptyHost/spawnInput.test.ts" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "unit@x86_64-linux" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"1/9 tests failed on a shared warm pool box; a single-node rerun came back green same-SHA. The PR is client-only (the canvas restore-card gate) and touches no ",
						createVNode(_components.code, { children: "packages/padi" }),
						" code, so unrelated to it."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1712 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "open"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"discoverKavalCandidates — finds a /tmp daemon even with ",
						createVNode(_components.code, { children: "$XDG_RUNTIME_DIR" }),
						" set (",
						createVNode(_components.code, { children: "kaval/src/socketPath.test.ts:287" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "unit@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "Test timed out in 5000ms" }),
						" — the socket-discovery test (unions the XDG root + the /tmp fallback) stalled past the 5s default on the loaded darwin box; the linux lane passed the same SHA and the PR touches no ",
						createVNode(_components.code, { children: "packages/kaval" }),
						" file. Green on rerun (a ",
						createVNode(_components.em, { children: "different" }),
						" darwin test flaked next — the surface one below — then both cleared)."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1726 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "open"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"mirrorRemoteSurface — fires onRemove when a key leaves the collection’s keys snapshot (",
						createVNode(_components.code, { children: "surface/src/mirrorRemoteSurface.test.ts" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "unit@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "AssertionError: expected [] to deeply equal [ 'b' ]" }),
						" — a reactive collection-key-removal assertion raced on the loaded darwin box; the linux lane passed the same SHA and the PR touches no ",
						createVNode(_components.code, { children: "packages/surface" }),
						" ",
						createVNode(_components.em, { children: "code" }),
						" (only its README). Green on rerun."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1726 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "open"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"reconnects when padi dies, and the re-served surface round-trips again (",
						createVNode(_components.code, { children: "server/src/padi/padiBinding.test.ts" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "unit@x86_64-linux" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "AbortError: [AsyncIdQueue] Queue was closed or aborted while waiting for pulling" }),
						" — the stdio link’s ",
						createVNode(_components.code, { children: "handleTransportClosed" }),
						" → ",
						createVNode(_components.code, { children: "peer.close()" }),
						" raced the async-iterator queue teardown during the reconnect-when-padi-dies test. Single-node rerun green same-SHA; the PR is client-only and touches no ",
						createVNode(_components.code, { children: "packages/server" }),
						" code, so unrelated to it. Recurred on ",
						createVNode($$PrLink, { pr: 1764 }),
						" (same ",
						createVNode(_components.code, { children: "unit@x86_64-linux" }),
						" lane, same ",
						createVNode(_components.code, { children: "AbortError" }),
						"; that PR’s ",
						createVNode(_components.code, { children: "packages/client" }),
						" suite was 686/686 green, so again unrelated). Recurred again on ",
						createVNode($$PrLink, { pr: 1783 }),
						" (scrollback-backfill), reproducing across TWO consecutive ",
						createVNode(_components.code, { children: "unit@x86_64-linux" }),
						" reruns on the ",
						createVNode(_components.code, { children: "srid@naiveintent" }),
						" box (pu-pool down, #1204): the same ",
						createVNode(_components.code, { children: "handleTransportClosed" }),
						" → ",
						createVNode(_components.code, { children: "peer.close()" }),
						" ",
						createVNode(_components.code, { children: "AbortError" }),
						", in the transport-teardown code the PR never touches — its only ",
						createVNode(_components.code, { children: "packages/server" }),
						" edit was updating this test’s frame-shape assertion (",
						createVNode(_components.code, { children: "typeof \"string\"" }),
						" → the ",
						createVNode(_components.code, { children: "{kind}" }),
						" discriminated union), and the full ",
						createVNode(_components.code, { children: "padiBinding.test.ts" }),
						" passed 27/27 locally. Load on the shared naiveintent box makes the death/reconnect race fire more readily than a clean pool box. ",
						createVNode(_components.strong, { children: ["Root-caused + fixed in ", createVNode($$PrLink, { pr: 1792 })] }),
						" (#1719): the float is ",
						createVNode(_components.code, { children: "mirrorCollection" }),
						"’s per-key value pump — a detached IIFE never joined into the mirror’s settle graph, whose parked ",
						createVNode(_components.code, { children: ".next()" }),
						" was abandoned when the peer closed. The fix OWNS the pumps (tracked + ",
						createVNode(_components.code, { children: "allSettled" }),
						" in the collection’s ",
						createVNode(_components.code, { children: "finally" }),
						", ctls aborted first) and passes a TYPED reason to the stdio ",
						createVNode(_components.code, { children: "peer.close()" }),
						" so the only rejection crossing the seam is the greppable ",
						createVNode(_components.code, { children: "deadTransportError" }),
						"; padi also gains a loud-not-fatal ",
						createVNode(_components.code, { children: "unhandledRejection" }),
						" backstop. Two deterministic pins (RED pre-fix): the typed-close pin + the pump-ownership pin. Fixed in ",
						createVNode($$PrLink, { pr: 1792 }),
						" — two-platform ",
						createVNode(_components.code, { children: "ci::default" }),
						" green on the final SHA ",
						createVNode(_components.code, { children: "652a0e2d0" }),
						" (linux on pu ",
						createVNode(_components.code, { children: "kolu-ci-1" }),
						", incl. the ",
						createVNode(_components.code, { children: "unit@x86_64-linux" }),
						" lane that carried this flake; darwin on rasam), so the death/reconnect race was believed closed. ",
						createVNode(_components.strong, { children: "REOPENED 2026-07-13:" }),
						" recurred on ",
						createVNode($$PrLink, { pr: 1795 }),
						"’s ",
						createVNode(_components.code, { children: "unit@x86_64-linux" }),
						" lane (pu ",
						createVNode(_components.code, { children: "kolu-ci-4" }),
						") with #1792’s fix IN the branch (master merge ",
						createVNode(_components.code, { children: "3f7105722" }),
						") — same ",
						createVNode(_components.code, { children: "handleTransportClosed" }),
						"/",
						createVNode(_components.code, { children: "AbortError" }),
						" class, node-rerun green same-SHA, and #1795 touches zero server/padi code. #1792 closed the pump-abandonment path it named, but a residual of the class survives; needs a fresh root-cause pass with #1792’s pins as the starting map. Recurred AGAIN on ",
						createVNode($$PrLink, { pr: 1807 }),
						" (security PR, zero server code) — now surfacing as the TYPED ",
						createVNode(_components.code, { children: "ORPCError: stdio transport closed" }),
						" from ",
						createVNode(_components.code, { children: "handleTransportClosed" }),
						" instead of the anonymous ",
						createVNode(_components.code, { children: "AbortError" }),
						": #1792’s rejection hygiene holds, but the underlying close-vs-reconnect race persists; green on a same-SHA node rerun (27/27). Sixth sighting on ",
						createVNode($$PrLink, { pr: 1811 }),
						" (SR3 membership, zero stdio-teardown code): first-red on ",
						createVNode(_components.code, { children: "unit@x86_64-linux" }),
						" (kolu-ci-4), 27/27 locally, node rerun green, full posting run all-green. Seventh sighting on ",
						createVNode($$PrLink, { pr: 1819 }),
						" (client-only terminal split-adoption, zero server/surface code): again the TYPED ",
						createVNode(_components.code, { children: "ORPCError: stdio transport closed" }),
						" from ",
						createVNode(_components.code, { children: "handleTransportClosed" }),
						", first-red on ",
						createVNode(_components.code, { children: "unit@x86_64-linux" }),
						" (kolu-ci-4) on TWO consecutive fresh runs (SHAs ",
						createVNode(_components.code, { children: "35af02d" }),
						" then ",
						createVNode(_components.code, { children: "1ef2307" }),
						"), each 23/23 in the touched ",
						createVNode(_components.code, { children: "packages/client" }),
						" suite locally, each cleared by a same-SHA node rerun — the death/reconnect race fires readily under box load but never on rerun. Eighth sighting on ",
						createVNode($$PrLink, { pr: 1823 }),
						" (SR7 reactive-bridge ",
						createVNode(_components.code, { children: "$" }),
						" read face, zero stdio/server-teardown code): first-red on ",
						createVNode(_components.code, { children: "unit@x86_64-linux" }),
						" (pu ",
						createVNode(_components.code, { children: "kolu-ci-2" }),
						") as the TYPED ",
						createVNode(_components.code, { children: "Error: stdio transport closed" }),
						" from ",
						createVNode(_components.code, { children: "handleTransportClosed" }),
						" → ",
						createVNode(_components.code, { children: "deadTransportError" }),
						"; the touched surface suites (354 surface + 316 padi + 46 surface-map) were green locally, ",
						createVNode(_components.code, { children: "padiBinding.test.ts" }),
						" passes 27/27, and the change is disjoint from the transport teardown — cleared by a same-SHA node rerun. ",
						createVNode(_components.strong, { children: [
							"ROOT-CAUSED + FIXED (retry-only) 2026-07-15 (",
							createVNode($$PrLink, { pr: 1827 }),
							"):"
						] }),
						" reproduce-first overturned an earlier over-elaborate theory. The PRE-SR5 sightings were the raw abandoned-pull float — an oRPC read-ahead pull discarded at ",
						createVNode(_components.code, { children: "terminalAttach" }),
						" teardown, rejecting with the typed ",
						createVNode(_components.code, { children: "SURFACE_STDIO_TRANSPORT_CLOSED" }),
						" and floating (no awaiter). But SR5’s ",
						createVNode($$PrLink, { pr: 1822 }),
						" reworked the re-serve relay to CATCH a mid-stream transport loss and re-throw it as the RETRYABLE ",
						createVNode(_components.code, { children: "RelayTransportLostError" }),
						" (",
						createVNode(_components.code, { children: "SURFACE_RELAY_TRANSPORT_LOST" }),
						") — an AWAITED throw, not a float. So POST-SR5 the residual is purely a TEST-SIDE gap: the reconnect test dials the re-served router with a raw ",
						createVNode(_components.code, { children: "createRouterClient" }),
						" (no ",
						createVNode(_components.code, { children: "STREAM_RETRY" }),
						" plugin), so a ",
						createVNode(_components.code, { children: "terminalAttach" }),
						" racing the reconnect throws un-retried and flakes — while production’s plugin-equipped consumer re-subscribes transparently. Verified by TWO 400-iter isolation runs on the real reconnect (WITH and WITHOUT an ownership wrapper — BOTH 0 fails, 0 process floats: the pre-SR5 float class is gone). Fix: ",
						createVNode(_components.code, { children: "roundTripTerminal" }),
						" retries the attach on a survivable transport float — the ",
						createVNode(_components.code, { children: "STREAM_RETRY" }),
						" mimic (~15 lines, test-only). 691 + 371 + 400 iters green at HEAD. An earlier iteration of this PR added a surface ",
						createVNode(_components.code, { children: "ownReadAheadPull" }),
						" + a kolu-server narrow-loud survival boundary + a planned upstream oRPC issue; ALL were RIPPED OUT (srid ruling, option-1 retry-only): they addressed a float that no longer occurs — the minimal oRPC-only repro PASSES, confirming no oRPC bug, and the boundary’s handler was proven to never fire. Fail-fast: if the pre-SR5 float class ever returns, the daemon crashing loudly is the correct, diagnosable behavior — not silently survived."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$PrLink, { pr: 1712 }),
						", ",
						createVNode($$PrLink, { pr: 1764 }),
						", ",
						createVNode($$PrLink, { pr: 1783 }),
						", ",
						createVNode($$PrLink, { pr: 1795 }),
						", ",
						createVNode($$PrLink, { pr: 1807 }),
						", ",
						createVNode($$PrLink, { pr: 1811 }),
						", ",
						createVNode($$PrLink, { pr: 1819 }),
						", ",
						createVNode($$PrLink, { pr: 1823 })
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "fixed (retry-only)"
					}) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$PrLink, { pr: 1792 }),
						" (partial); ",
						createVNode($$PrLink, { pr: 1827 }),
						" (retry-only — SR5 ",
						createVNode($$PrLink, { pr: 1822 }),
						" closed the float class; the residual was a test-side un-retried retryable throw)"
					] }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"discoverPtyHostSockets — finds per-port server namespaces and a bare standalone one / ignores a namespace dir with no socket yet (",
						createVNode(_components.code, { children: "kaval/src/socketPath.test.ts:158,177" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "unit@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "Test timed out in 5000ms" }),
						" (two sibling tests) on the loaded darwin box during a big two-platform run; a sibling in the same file passed at 3144ms, right at the 5s threshold. Linux lane green same-SHA; the PR touches no ",
						createVNode(_components.code, { children: "packages/kaval" }),
						" file. Green on a same-SHA node rerun (same class as the ",
						createVNode(_components.code, { children: "socketPath.test.ts:287" }),
						" row above)."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1730 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "open"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"resolveRunningKavalSocket — discovers a single running kaval → one / falls back to the bare default → none (",
						createVNode(_components.code, { children: "kaval/src/socketPath.test.ts:466,476" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "unit@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "Test timed out in 5000ms" }),
						" (two sibling tests, ~10s each) on the loaded darwin box during a two-platform run; these seed a real kaval daemon and scan the runtime roots. Linux lane green same-SHA (139/139 kaval tests in ~7s); the PR (#1753, right-panel per-terminal collapse) touches no ",
						createVNode(_components.code, { children: "packages/kaval" }),
						" file. Same class as the ",
						createVNode(_components.code, { children: "socketPath.test.ts:287" }),
						" and ",
						createVNode(_components.code, { children: ":158,177" }),
						" rows above. Green on a same-SHA node rerun."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1753 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "open"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"smoke — the ",
						createVNode(_components.code, { children: ".#default" }),
						" KOLU_STATE_DIR sub-test’s teardown (",
						createVNode(_components.code, { children: "ci/smoke.sh" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "smoke@x86_64-linux" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "rm: cannot remove '…/.local/state/padi': Directory not empty" }),
						" — the local padi (a grandchild of the sub-test’s kolu) briefly outlived its parent after SIGTERM and re-wrote state as ",
						createVNode(_components.code, { children: "rm -rf" }),
						" walked the temp ",
						createVNode(_components.code, { children: "$HOME" }),
						", so the recursive delete hit ENOTEMPTY. A teardown race in ",
						createVNode(_components.code, { children: "ci/smoke.sh" }),
						", unrelated to the PR’s surface-remote/client diff. Green on a same-SHA node rerun."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1730 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "open"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"padi dialed over a stdio byte relay — the subprocess-spawning variants (",
						createVNode(_components.code, { children: "padi/src/dial.test.ts" }),
						", varying subtest)"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "unit@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "padi socket never came up" }),
						" / ",
						createVNode(_components.code, { children: "Test timed out in 60000ms" }),
						" — the byte-relay tests spawn a real padi child and wait for its unix socket; on a contended darwin box (import alone 35–51s) the spawn+bind overran the wait window. Flaked TWICE across consecutive runs with a ",
						createVNode(_components.strong, { children: "different" }),
						" subtest each time (",
						createVNode(_components.code, { children: "round-trips … over the byte relay" }),
						", then ",
						createVNode(_components.code, { children: "the durable daemon SURVIVES the front dropping" }),
						"), while the socket-based (non-subprocess) variants of the same tests passed at ~3.5s. Linux lane green same-SHA; the PR touches ",
						createVNode(_components.strong, { children: "no" }),
						" ",
						createVNode(_components.code, { children: "packages/padi" }),
						" file (all changes are surface-remote/server/client). Green on a same-SHA node rerun."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1730 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "open"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"kaval PTY/socket discovery — ",
						createVNode(_components.code, { children: "ptyHost.test.ts" }),
						" (spawn-and-mirror) + ",
						createVNode(_components.code, { children: "socketPath.test.ts:158,287" }),
						" (per-port + /tmp discovery)"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "unit@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "waitFor timed out" }),
						" / ",
						createVNode(_components.code, { children: "Test timed out in 5000ms" }),
						" on the loaded darwin box during a ",
						createVNode(_components.strong, { children: "darwin-only" }),
						" run (the linux lane was gated on the Incus outage ",
						createVNode(_components.a, {
							href: "https://github.com/juspay/kolu/issues/1204",
							children: "#1204"
						}),
						"); the failing subset varied across reruns (3 → 1 → 0 fails), all in ",
						createVNode(_components.code, { children: "packages/kaval" }),
						", which this ",
						createVNode(_components.strong, { children: "client-only" }),
						" PR (padi W9 instant host switch-back) does not touch. Same well-known class as the ",
						createVNode(_components.code, { children: "socketPath.test.ts:287" }),
						", ",
						createVNode(_components.code, { children: ":158,177" }),
						", ",
						createVNode(_components.code, { children: ":466,476" }),
						" and ",
						createVNode(_components.code, { children: "ptyHost.test.ts" }),
						" rows above. Green on a same-SHA node rerun (full darwin pipeline then passed, incl. e2e). Recurred on a later two-platform run (linux via ",
						createVNode(_components.code, { children: "naiveintent" }),
						", darwin via ",
						createVNode(_components.code, { children: "rasam" }),
						") alongside the ",
						createVNode(_components.code, { children: "padiBinding.test.ts" }),
						" (linux unit) and the ",
						createVNode(_components.code, { children: "smoke" }),
						" boot-timeout (darwin) flakes below — three concurrent change-independent flakes under box load, all cleared by same-SHA node reruns."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1764 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "open"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"smoke — kolu boot exceeded the 10s “kolu listening” wait (",
						createVNode(_components.code, { children: "ci/smoke.sh" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "smoke@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode(_components.code, { children: "kolu did not log 'kolu listening' within 10s" }),
						", alongside a nix ",
						createVNode(_components.code, { children: "SQLite database '…/eval-cache-v5/….sqlite' is busy" }),
						" eval-cache-contention warning, on the loaded ",
						createVNode(_components.code, { children: "rasam" }),
						" darwin box during a two-platform run: the koluBin build plus concurrent nix evals pushed boot past the smoke test’s 10s wait. Linux smoke green same-SHA; this ",
						createVNode(_components.strong, { children: "client-only" }),
						" PR (padi W9) touches no boot/startup path. Distinct from the ",
						createVNode(_components.code, { children: "smoke@x86_64-linux" }),
						" teardown-ENOTEMPTY row above (a boot-timeout under load, not a teardown race). Cleared on a same-SHA node rerun."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1764 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "open"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"agent-state + file-watch live-update waitFors — ",
						createVNode(_components.code, { children: "grok.feature:39" }),
						" (both runs) · ",
						createVNode(_components.code, { children: "code-tab.feature:1532/1545/1557/1678" }),
						" (run 1) · transients ",
						createVNode(_components.code, { children: "codex.feature:15" }),
						", ",
						createVNode(_components.code, { children: "code-tab.feature:1697" })
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "e2e@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"All ~20s ",
						createVNode(_components.code, { children: "waitFor" }),
						" timeouts on agent-state-detection (",
						createVNode(_components.code, { children: "Expected Grok indicator state \"thinking\", got state=\"null\" after 20017ms" }),
						", grok_steps.ts:222) or file-watch live-update signals (",
						createVNode(_components.code, { children: "iframe preview never refreshed … last body text: \"second page ALPHA\"" }),
						"), on a ",
						createVNode(_components.strong, { children: "loaded" }),
						" ",
						createVNode(_components.code, { children: "rasam" }),
						" — and this time the load source is NAMED: a second darwin e2e lane (DL1’s CI) ran concurrently on the same box, a coordinator double-booking now banned by the orchestrator skill’s single-tenant rule. The failing set SHIFTED (code-tab cluster → grok) and SHRANK (4 → 1) across two same-SHA runs — the load signature, not a deterministic failure. The PR (",
						createVNode($$PrLink, { pr: 1842 }),
						", the 2.0 changelog rewrite) touches zero app code — website changelog + a leaf Astro component + docs — so it cannot cause agent-state or file-watch failures; ",
						createVNode(_components.code, { children: "e2e@x86_64-linux" }),
						" green both runs. Disposition: the idle-box run (sincereintent, same SHA) SPLIT the cause — the agent-state flakes (grok:39, codex:15) CLEARED on the idle box, confirming the double-booking as their load source; ONE scenario persisted even idle: ",
						createVNode(_components.code, { children: "code-tab.feature:1678" }),
						" (file-watch → iframe preview live-refresh never fired) — darwin-specific and PR-independent (zero app code; linux 509/509 green), with the caveat that sincereintent is marked retired in do.md (possibly stale FSEvents env). Sharpened: ",
						createVNode(_components.code, { children: "code-tab.feature:1678" }),
						" is the regression test ",
						createVNode($$PrLink, { pr: 1755 }),
						" ADDED, guarding the exact bug its own header documents — an in-iframe link click does not re-arm the fsReadFile watch on the navigated-to file, so a later edit fires events nobody hears and the preview freezes on the navigated content — and the idle-box symptom is precisely that freeze (stuck on “second page ALPHA”, never took “BETA”). So #1755’s fix holds on linux but not on this darwin box: either a genuine darwin fs-watch re-arm gap in the fix, or the stale box env. RESOLVED by disambiguation, no investigation needed: ",
						createVNode(_components.code, { children: "1678" }),
						" PASSED on QUIET rasam (",
						createVNode($$PrLink, { pr: 1840 }),
						"’s retry, 517/517 — a diff not touching the file-watch path) after failing on the idle-but-RETIRED sincereintent — so the two failures had two box causes (rasam: the double-booking load; sincereintent: the stale-FSEvents env its do.md ‘retired’ mark warned about) and NO real #1755 darwin fs-watch gap exists. Lessons already encoded: darwin single-tenancy (the orchestrator rule) + never run CI on a retired box."
					] }),
					"\n",
					createVNode(_components.td, { children: [
						createVNode($$PrLink, { pr: 1842 }),
						", ",
						createVNode($$PrLink, { pr: 1840 })
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "ok",
						children: "resolved (box causes)"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n",
				createVNode(_components.tr, { children: [
					"\n",
					createVNode(_components.td, { children: [
						"Recycling kaval with a split does not spuriously re-parent it and keeps it visible (",
						createVNode(_components.code, { children: "kaval-daemon.feature:94" }),
						")"
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode(_components.code, { children: "e2e@aarch64-darwin" }) }),
					"\n",
					createVNode(_components.td, { children: [
						"The ",
						createVNode(_components.code, { children: "the warming canvas is shown while kaval restarts" }),
						" step (",
						createVNode(_components.code, { children: "kaval_daemon_steps.ts:246" }),
						") failed during a server-reboot + kaval respawn, alongside a nix ",
						createVNode(_components.code, { children: "SQLite '…/eval-cache-v5/….sqlite' is busy" }),
						" eval-cache-contention warning on the loaded ",
						createVNode(_components.code, { children: "rasam" }),
						" box — a restart-timing race under box load. 1/508 scenarios; the ",
						createVNode(_components.strong, { children: "identical" }),
						" scenario passed on the ",
						createVNode(_components.code, { children: "e2e@x86_64-linux" }),
						" lane same-SHA. This PR (#1795) is a behaviour-neutral ",
						createVNode(_components.code, { children: "@kolu/xterm-kit" }),
						" graduation whose only kaval touch adds the import-free ",
						createVNode(_components.code, { children: "mirrorAnchor" }),
						" module to the daemon (negligible startup cost), so the flake is change-independent. Cleared on a same-SHA full two-platform rerun (both lanes green)."
					] }),
					"\n",
					createVNode(_components.td, { children: createVNode($$PrLink, { pr: 1795 }) }),
					"\n",
					createVNode(_components.td, { children: createVNode($$Pill, {
						variant: "new",
						children: "open"
					}) }),
					"\n",
					createVNode(_components.td, { children: "—" }),
					"\n"
				] }),
				"\n"
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"| Code-tab / git-context scenarios ",
			createVNode(_components.code, { children: "Before" }),
			"-hook reset (",
			createVNode(_components.code, { children: "padi/lifecycle/killAll" }),
			" + ",
			createVNode(_components.code, { children: "activityFeed/test__set" }),
			") | ",
			createVNode(_components.code, { children: "e2e@aarch64-darwin" }),
			" | ",
			createVNode(_components.code, { children: "POST …/killAll -> HTTP 500" }),
			" “no live upstream link” (",
			createVNode(_components.code, { children: "reServeSurface.ts:364" }),
			") in the per-scenario ",
			createVNode(_components.code, { children: "Before" }),
			" hook, cascading into a worker ",
			createVNode(_components.strong, { children: "queue-drain" }),
			" (hundreds of scenarios fail in setup). Root: the LOCAL padi link’s ",
			createVNode(_components.strong, { children: "liveness probe timed out" }),
			" mid-run under darwin load — ",
			createVNode(_components.code, { children: "\"remote wedged, force-cycling the link\"" }),
			" — force-cycling an ",
			createVNode(_components.strong, { children: "alive-but-slow" }),
			" padi (",
			createVNode(_components.code, { children: "\"endpoint link down (no process exit)\"" }),
			"); the reconnect works and ",
			createVNode(_components.strong, { children: "heals" }),
			" (pid re-dialed after a ~16s down-window, ran ~6 min up) but re-wedges under sustained load, and ",
			createVNode(_components.code, { children: "killAll" }),
			" hits the down-windows. Diagnosed in ",
			createVNode(_components.a, {
				href: "https://github.com/juspay/kolu/issues/1776",
				children: "#1776"
			}),
			". Verified NOT the PR’s code: linux e2e green same-SHA, and the retire-verb split is behaviour-neutral with its changed paths unreachable by the single-host suite. Distinct from the startup readiness gate (verified correct: ",
			createVNode(_components.code, { children: "waitForPadiLive" }),
			" already gates every server start) and from teardown race #1719. | ",
			createVNode($$PrLink, { pr: 1775 }),
			", ",
			createVNode($$PrLink, { pr: 1805 }),
			" | ",
			createVNode($$Pill, {
				variant: "new",
				children: "open"
			}),
			" | ",
			createVNode($$PrLink, { pr: 1781 }),
			" was a PARTIAL fix — the local arm now consults its process-aliveness oracle on heartbeat silence (slow ≠ dead; minute-scale dead-man ceiling for truly-hung), which cleared the mid-run ",
			createVNode(_components.code, { children: "killAll" }),
			" re-wedge; acceptance was that exact lane green under its own load (11m24s, 0 killAll-500s), 2026-07-12. ",
			createVNode(_components.strong, { children: ["REOPENED on ", createVNode($$PrLink, { pr: 1805 })] }),
			" (SurfaceRuntime): the same padi-not-live-under-load class re-manifested at BOOT (not mid-run) as the e2e ",
			createVNode(_components.code, { children: "BeforeAll" }),
			" “local padi never became live within 120s” on BOTH ",
			createVNode(_components.code, { children: "e2e@x86_64-linux" }),
			" and ",
			createVNode(_components.code, { children: "e2e@aarch64-darwin" }),
			", plus ",
			createVNode(_components.code, { children: "home-manager@x86_64-linux" }),
			"’s “no live upstream link after 30s” — while ",
			createVNode(_components.code, { children: "home-manager@aarch64-darwin" }),
			" PASSED same-SHA, isolating the failure to box load, not code (the eviction/reServe logic is platform-independent, so a real regression would fail both, and every in-process pin — padiBinding + seal 34, server 217, surface-remote 152 — is green). Aggravated on linux by a superseded seq-1 e2e whose worker kolu-servers lingered and double-loaded the box (a since-noted “never supersede a live e2e” mistake). Cleared on a fresh-uncontended-box two-platform rerun (both lanes green — see the PR’s final CI). Issue ",
			createVNode(_components.a, {
				href: "https://github.com/juspay/kolu/issues/1776",
				children: "#1776"
			}),
			" reopened. |\n| docs/atlas typecheck — typescript-go internal panic (",
			createVNode(_components.code, { children: "ci::atlas-sync" }),
			") | ",
			createVNode(_components.code, { children: "atlas-sync@aarch64-darwin" }),
			" | ",
			createVNode(_components.code, { children: "panic: ScriptKind must be specified when parsing source file: <pnpm-store content-hash file>" }),
			" — tsgo’s parallel parser crashed while typechecking docs/atlas on rasam (first run of ",
			createVNode($$PrLink, { pr: 1804 }),
			"’s darwin lane). Pure tooling: the identical Atlas content + dist passed ",
			createVNode(_components.code, { children: "atlas-sync@x86_64-linux" }),
			" same-SHA, the PR touched no Atlas tsconfig/deps/tsgo pin, and the node passed clean on a single-node rerun. Suspect: tsgo racing the shared pnpm store under rasam load. | ",
			createVNode($$PrLink, { pr: 1804 }),
			" | ",
			createVNode($$Pill, {
				variant: "new",
				children: "open"
			}),
			" | — |\n| docs/atlas dist non-determinism — ",
			createVNode(_components.code, { children: "release-workflow.html" }),
			" byte-shrinks under load (",
			createVNode(_components.code, { children: "ci::atlas-sync" }),
			") | ",
			createVNode(_components.code, { children: "atlas-sync@aarch64-darwin" }),
			", ",
			createVNode(_components.code, { children: "atlas-sync@x86_64-linux" }),
			" | ",
			createVNode(_components.code, { children: "docs/atlas/dist is out of sync … release-workflow.html 24757 → 24721 bytes" }),
			" on rasam during the FLAKE-5X certification (run 4 of 5 on ",
			createVNode($$PrLink, { pr: 1851 }),
			", SHA ",
			createVNode(_components.code, { children: "1f776bfcb" }),
			") — all 27 other nodes green incl. ",
			createVNode(_components.code, { children: "atlas-sync@x86_64-linux" }),
			" same-SHA, and certs 1–3 passed the identical lane at the identical SHA. NOT reproducible in isolation: two clean rebuilds on the same box = 24757B, byte-identical to committed — so the 36B shrink is load/race-dependent build non-determinism, not stale dist. The PR touches zero ",
			createVNode(_components.code, { children: "docs/atlas/" }),
			" content. Sibling of the tsgo-panic ",
			createVNode(_components.code, { children: "atlas-sync" }),
			" row above (same lane, same shared-store-under-load suspicion). ",
			createVNode(_components.strong, { children: "Racing component NAMED same night, zero repro needed" }),
			" — cert-4’s run dir (",
			createVNode(_components.code, { children: "T/odu/kolu/1f776bf-95952-57ad79fc/" }),
			") still held the 24721B artifact; the diff is entirely inside one shiki-highlighted ",
			createVNode(_components.code, { children: "mdx" }),
			" code block in ",
			createVNode(_components.code, { children: "release-workflow.html" }),
			": on the ",
			createVNode(_components.code, { children: "version: Unreleased" }),
			" line, the per-token color ",
			createVNode(_components.code, { children: "<span style=\"color:#…\">" }),
			" wrappers are DROPPED (text survives, highlighting doesn’t) — under CPU contention shiki’s tokenizer silently emitted un-highlighted output instead of crashing, a ",
			createVNode(_components.code, { children: "caught-error-must-not-collapse-to-empty" }),
			" violation in the astro/shiki build path. ",
			createVNode(_components.strong, { children: "ROOT-CAUSED + FIXED (this PR):" }),
			" the mechanism is shiki’s per-line tokenization budget — ",
			createVNode(_components.code, { children: "tokenizeTimeLimit" }),
			" defaults to 500ms (",
			createVNode(_components.code, { children: "@shikijs/primitive" }),
			"), and vscode-textmate’s over-budget bail returns PARTIAL tokens with a ",
			createVNode(_components.code, { children: "stoppedEarly" }),
			" flag shiki never checks, so a line that crosses the budget on a contended box silently loses its spans. Deterministic red-before/green-after pin (script, not CI): a 4000-token line at ",
			createVNode(_components.code, { children: "tokenizeTimeLimit: 1" }),
			" degrades 8001 spans → 361 silently; a transformer setting ",
			createVNode(_components.code, { children: "tokenizeTimeLimit: 0" }),
			" (budget disabled) restores 8001 under the same hostile limit. Fix: the ",
			createVNode(_components.code, { children: "kolu:shiki-no-tokenize-bail" }),
			" transformer in BOTH ",
			createVNode(_components.code, { children: "docs/atlas/astro.config.mjs" }),
			" and ",
			createVNode(_components.code, { children: "website/astro.config.mjs" }),
			" (same class, and the website’s un-gated degradation would ship to kolu.dev unnoticed) — output is now correct or the build visibly hangs, never silently degraded. ",
			createVNode(_components.strong, { children: "RECURRED POST-FIX (2026-07-16):" }),
			" the identical ",
			createVNode(_components.code, { children: "24757 → 24721" }),
			" shrink hit ",
			createVNode(_components.code, { children: "atlas-sync@x86_64-linux" }),
			" (kolu-ci-5, lane-startup contention) at kolu#1852’s ",
			createVNode(_components.code, { children: "7a81984d3" }),
			" — the FIRST linux-lane occurrence, and the built tree CONTAINED the ",
			createVNode(_components.code, { children: "kolu:shiki-no-tokenize-bail" }),
			" transformer (verified at ",
			createVNode(_components.code, { children: "docs/atlas/astro.config.mjs:48" }),
			"). Local rebuilds under ",
			createVNode(_components.code, { children: "TZ=UTC" }),
			" and ",
			createVNode(_components.code, { children: "LC_ALL=C" }),
			" reproduce the committed 24757 B byte-identically, so the shrink is still load-dependent, and ",
			createVNode(_components.code, { children: "tokenizeTimeLimit: 0" }),
			" did NOT prevent the bail in the real astro build — either the ",
			createVNode(_components.code, { children: "preprocess" }),
			"-hook option doesn’t reach the MDX code-fence path, or a second degradation path shares the signature. Re-opened for FLAKE-5X to re-root-cause. ",
			createVNode(_components.strong, { children: "MECHANISM NAILED (2026-07-16, kolu#1870 darwin first run, rasam):" }),
			" the divergent bytes were pulled off the box before the worktree reap — and the flip is a ",
			createVNode(_components.strong, { children: "grammar flip, not span loss" }),
			": the committed dist tokenizes the MDX frontmatter sample as embedded YAML (key ",
			createVNode(_components.code, { children: "#22863A" }),
			", string ",
			createVNode(_components.code, { children: "#032F62" }),
			"); the flaked rebuild renders the ",
			createVNode(_components.code, { children: "---" }),
			" fences as bold thematic breaks (",
			createVNode(_components.code, { children: "#005CC5;font-weight:bold" }),
			") and the body as PLAIN text — the mdx grammar’s ",
			createVNode(_components.em, { children: "embedded yaml grammar never engaged" }),
			" for that block. So the real mechanism is ",
			createVNode(_components.strong, { children: "async grammar-load nondeterminism" }),
			" (a load-order race on the embedded-grammar set), which is why ",
			createVNode(_components.code, { children: "tokenizeTimeLimit: 0" }),
			" didn’t hold: it removes the time-budget bail, a ",
			createVNode(_components.em, { children: "different" }),
			" mechanism. It also explains the per-box/per-run variance under a nix-pinned closure, the whole-block (not tail-truncated) divergence, and the immediate green rerun. Real fix: construct the highlighter with all ",
			createVNode(_components.code, { children: "langs" }),
			" (incl. embedded) eagerly awaited before tokenization — owned by the coordinator as a follow-up. ",
			createVNode(_components.strong, { children: [
				"FIXED (",
				createVNode($$PrLink, { pr: 1874 }),
				"):"
			] }),
			" mechanism CONFIRMED as the ",
			createVNode(_components.code, { children: "embeddedLangsLazy" }),
			" load-order race (opus-verified against ",
			createVNode(_components.code, { children: "@shikijs/primitive" }),
			" 4.1.0 + a deterministic red/green repro: grammar presence is the sole variable, order-independent). Fix = ",
			createVNode(_components.strong, { children: "content-derived langs preload" }),
			" (",
			createVNode(_components.code, { children: "scripts/fence-langs.mjs" }),
			" scans the content for fence langs — single source of truth, no hand list to go stale — via a ",
			createVNode(_components.code, { children: "shikiFencePreload" }),
			" factory) + a ",
			createVNode(_components.code, { children: "kolu:shiki-eager-langs-only" }),
			" ",
			createVNode(_components.strong, { children: "fail-fast guard" }),
			" (an un-enumerated fence lang now crashes the build loudly instead of silently reopening the race), wired in BOTH ",
			createVNode(_components.code, { children: "docs/atlas/astro.config.mjs" }),
			" and ",
			createVNode(_components.code, { children: "website/astro.config.mjs" }),
			"; ",
			createVNode(_components.code, { children: "kolu:shiki-no-tokenize-bail" }),
			" RETAINED (distinct mechanism, verified non-interacting). Certification the #1853 fix never had: ",
			createVNode(_components.strong, { children: "soak 22/22 per platform on the flaking CI class" }),
			" (kolu-ci-3 linux + rasam darwin), each run including a TZ/locale-scrambled idempotency rebuild — 88 builds, one dist hash per platform, zero divergence. | ",
			createVNode($$PrLink, { pr: 1851 }),
			" | ",
			createVNode($$Pill, {
				variant: "done",
				children: "fixed"
			}),
			" | ",
			createVNode($$PrLink, { pr: 1853 }),
			" ",
			createVNode($$PrLink, { pr: 1874 }),
			" |\n| @kaval-restart warming-canvas (",
			createVNode(_components.code, { children: "kaval-daemon.feature:32" }),
			") — recurrence | ",
			createVNode(_components.code, { children: "e2e@aarch64-darwin" }),
			" | Documented on ",
			createVNode($$PrLink, { pr: 1795 }),
			"; recurred on ",
			createVNode($$PrLink, { pr: 1808 }),
			"’s darwin lane and cleared on a same-SHA rerun (change-independent — the PR touches no kaval restart path). Same rasam-load sensitivity class as its first sighting. | ",
			createVNode($$PrLink, { pr: 1795 }),
			", ",
			createVNode($$PrLink, { pr: 1808 }),
			" | ",
			createVNode($$Pill, {
				variant: "new",
				children: "open"
			}),
			" | — |\n| spawn → list → attach (snapshot-first) → … → kill → exit (",
			createVNode(_components.code, { children: "kaval/src/inProcessPtyHost.test.ts" }),
			", contract corpus) | ",
			createVNode(_components.code, { children: "unit@x86_64-linux" }),
			" | ",
			createVNode(_components.code, { children: "Error: stream timed out" }),
			" — ",
			createVNode(_components.code, { children: "contractCorpus.testlib.ts:138" }),
			"’s 8s stream budget expired in the full spawn-to-exit round-trip on the leased pool box (",
			createVNode(_components.code, { children: "kolu-ci-5" }),
			"); the other 154 kaval tests passed, the PR (",
			createVNode($$PrLink, { pr: 1860 }),
			") touches only agent-skill JS/md + ",
			createVNode(_components.code, { children: "agents/tests" }),
			" (zero ",
			createVNode(_components.code, { children: "packages/" }),
			" runtime code), and a same-SHA node rerun was green — a real-PTY timing race under shared-box load, same class as the darwin ",
			createVNode(_components.code, { children: "ptyHost.test.ts" }),
			" row above. | ",
			createVNode($$PrLink, { pr: 1860 }),
			" | ",
			createVNode($$Pill, {
				variant: "new",
				children: "open"
			}),
			" | — |\n| Binary placeholder flips off when the file becomes text (",
			createVNode(_components.code, { children: "code-tab.feature:1532" }),
			") | ",
			createVNode(_components.code, { children: "e2e@x86_64-linux" }),
			" | ",
			createVNode(_components.code, { children: "[data-testid=\"diff-binary\"]" }),
			" never visible — ",
			createVNode(_components.code, { children: "locator.waitFor" }),
			" 20s timeout on both attempts (the retry then also missed the post-flip ",
			createVNode(_components.code, { children: "now text" }),
			" diff assert); 509/510 scenarios passed on the leased pool box (",
			createVNode(_components.code, { children: "kolu-ci-5" }),
			"), and the PR (",
			createVNode($$PrLink, { pr: 1860 }),
			") touches only agent-skill JS/md + ",
			createVNode(_components.code, { children: "agents/tests" }),
			" + docs (zero Code-tab/diff/client code), so unrelated to it. | ",
			createVNode($$PrLink, { pr: 1860 }),
			" | ",
			createVNode($$Pill, {
				variant: "new",
				children: "open"
			}),
			" | — |\n| e2e — file-preview iframe never refreshes after edit (",
			createVNode(_components.code, { children: "ci::e2e" }),
			", fs-watch class) | ",
			createVNode(_components.code, { children: "e2e@aarch64-darwin" }),
			" (rasam) | “An identical-content rewrite preserves the HTML preview scroll position” (features/code-tab.feature:1606) — ",
			createVNode(_components.code, { children: "iframe preview never refreshed to \"scroll anchor two\" after editing …; last body text: \"scroll anchor one\"" }),
			": a file-watch (FSEvents) waitFor that never fired; cucumber retried twice and BOTH attempts wedged identically — the persistent-fseventsd fingerprint, not a transient. Change-independent by SHA pair: red on ",
			createVNode(_components.code, { children: "619d06590" }),
			", which differs from the FULLY-GREEN ",
			createVNode(_components.code, { children: "77b3d77ce" }),
			" (both platforms, incl. darwin e2e) by a docs-only delta; linux e2e green on the same ",
			createVNode(_components.code, { children: "619d06590" }),
			". ",
			createVNode(_components.strong, { children: "Box datapoint: first confirmation on rasam" }),
			" — the fs-watch flake class was previously attributed to sincereintent’s stale fseventsd (104-day uptime); it is now a TWO-BOX darwin pattern, which weakens the one-neglected-box theory and suggests either a darwin-fleet hygiene pass or hardening the e2e file-watch waitFor (retry doesn’t touch the wedged layer). | ",
			createVNode($$PrLink, { pr: 1876 }),
			" | ",
			createVNode($$Pill, {
				variant: "new",
				children: "open"
			}),
			" | — |"
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "logging-a-flake",
			children: "Logging a flake"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"When a lane goes red and a single-node rerun comes back green, ",
			createVNode(_components.strong, { children: "add a row" }),
			": test\nname, ",
			createVNode(_components.code, { children: "recipe@platform" }),
			" lane, the assertion/timeout, the PR it reproduced in\n(",
			createVNode(_components.code, { children: "<PrLink pr={…} />" }),
			"), ",
			createVNode($$Pill, {
				variant: "new",
				children: "open"
			}),
			". No investigation needed to log it."
		] }),
		"\n",
		createVNode(_components.p, { children: [
			createVNode(_components.strong, { children: "Keep the tracker in lock-step with your PR." }),
			" Log a flake your CI surfaced in the\n",
			createVNode(_components.em, { children: "same" }),
			" PR that hit it — don’t defer to a later cleanup; and a PR that ",
			createVNode(_components.em, { children: "fixes" }),
			" a\nflake flips its row to ",
			createVNode($$Pill, {
				variant: "ok",
				children: "fixed"
			}),
			" (and strikes it) in that\nsame PR, regenerating ",
			createVNode(_components.code, { children: "docs/atlas/dist/" }),
			". The queue only stays trustworthy if every\nPR that touches a flake updates this note alongside its own diff."
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "fixing-routine",
			children: "Fixing routine"
		}),
		"\n",
		createVNode(_components.p, { children: [
			"An agent clears the backlog by driving CI to ",
			createVNode(_components.strong, { children: "N consecutive green runs" }),
			" (N = 5\nby default, or as given) through the ",
			createVNode(_components.strong, { children: "odu MCP" }),
			" (",
			createVNode(_components.code, { children: "run" }),
			" the test lanes →\n",
			createVNode(_components.code, { children: "wait_for_settle" }),
			", repeated). The green streak ",
			createVNode(_components.strong, { children: "verifies" }),
			" that a fix is real —\nit is never a way to wash a flake out."
		] }),
		"\n",
		createVNode(_components.p, { children: "Non-negotiable rules:" }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [createVNode(_components.strong, { children: "A single failure is a fix, not a re-run." }), " One red lane → stop and fix the\nroot cause. Re-running to hope for green is forbidden, and any failure resets\nthe streak to 0."] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Fix the test, not the app." }),
				" A flake is a defect in the ",
				createVNode(_components.em, { children: "test" }),
				"; change only\n",
				createVNode(_components.code, { children: "packages/tests" }),
				", never application code — unless a fix is provably impossible\nwithout it."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Kill the timing dependence, don’t pad it." }),
				" A “timing issue” is fixed by\nwaiting on a deterministic signal (a real DOM/aria state, an app event, an\nawaited promise, correct setup ordering) — ",
				createVNode(_components.em, { children: "never" }),
				" by bumping a timeout or\nadding a sleep."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Reuse past de-flake PRs." }),
				" Read how this suite was de-flaked before — start\nfrom ",
				createVNode(_components.a, {
					href: "#common-flake-classes",
					children: "Common flake classes"
				}),
				" below — and apply the\nestablished pattern instead of inventing one."
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"Code changes pass ",
					createVNode(_components.code, { children: "/codex-debate" }),
					" before the streak counts."
				] }),
				" Batch the fixes,\nthen drive them through ",
				createVNode(_components.code, { children: "/codex-debate" }),
				" to consensus — a CI pass is only trusted\non codex-debate-passed commits (docs are exempt, and the debate is expensive, so\ndebate the batch, not each edit). The debate is read-only code review, so its\nconsensus still needs ",
				createVNode(_components.strong, { children: "CI verification" }),
				": defend an empirically-grounded fix\nrather than concede a plausible-but-unverified simplification — a consensus that\ncontradicts an observed CI failure is wrong until CI proves otherwise."
			] }),
			"\n"
		] }),
		"\n",
		createVNode(_components.p, { children: [
			"The loop: ",
			createVNode(_components.strong, { children: "fail" }),
			" → streak resets to 0, root-cause and fix the test\n(",
			createVNode($$Pill, {
				variant: "run",
				children: "fixing"
			}),
			" → ",
			createVNode($$Pill, {
				variant: "ok",
				children: "fixed"
			}),
			", link the PR\nwith ",
			createVNode(_components.code, { children: "<PrLink pr={…} />" }),
			"); while there, drop any ",
			createVNode($$Pill, {
				variant: "new",
				children: "open"
			}),
			"\nrow that no longer reproduces. ",
			createVNode(_components.strong, { children: "Pass" }),
			" → streak +1. ",
			createVNode(_components.strong, { children: "Done = N green runs\nback-to-back with the backlog cleared." })
		] }),
		"\n",
		createVNode(_components.h2, {
			id: "common-flake-classes",
			children: "Common flake classes"
		}),
		"\n",
		createVNode(_components.p, { children: "The shapes this suite keeps throwing, and the fix that held — reach for these\nbefore inventing one (full detail in each linked PR / the fix’s code comment)." }),
		"\n",
		createVNode(_components.ul, { children: [
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: [
					"darwin drops a ",
					createVNode(_components.em, { children: "second" }),
					" fs event."
				] }),
				" An ",
				createVNode(_components.em, { children: "append" }),
				" or a 2nd create (a transcript\nappend, a ",
				createVNode(_components.code, { children: "<pid>.json" }),
				" after its dir) is the event FSEvents/inotify drops under\nparallel-worker load, so the watcher never re-fires. Fix: write\n",
				createVNode(_components.strong, { children: "data-then-trigger" }),
				" (the reliable first event carries the payload), or\n",
				createVNode(_components.strong, { children: [createVNode(_components.code, { children: "nudgeFiles" }), " the path every poll tick"] }),
				" (",
				createVNode(_components.code, { children: "tests/support/nudge.ts" }),
				") to re-fire\nthe watch. (",
				createVNode(_components.code, { children: "claude-code.feature:77" }),
				")"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A one-shot resolve against a stream’s first snapshot can’t recover." }),
				" If a\nconsumer resolves once on the first ",
				createVNode(_components.code, { children: "!pending()" }),
				" frame and the stream won’t\nre-yield (state already settled), a stale first snapshot is permanent — no marker\nbarrier saves it. Fix: ",
				createVNode(_components.strong, { children: "warm / mount the source first" }),
				" so it has enumerated\nbefore the action. (",
				createVNode(_components.code, { children: "file-ref-link.feature:69" }),
				")"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A baseline recorded mid-settle drifts." }),
				" Recording a transform/value while an\nanimation or a sensor re-resolve is in flight captures a moving target. Fix:\n",
				createVNode(_components.strong, { children: "settle-before-baseline" }),
				" — wait on the steady-state signal (tile centered, git\nsettled to the repo, tree row enumerated) before recording or asserting.\n(",
				createVNode(_components.code, { children: "canvas.feature:161" }),
				", ",
				createVNode(_components.code, { children: "code-tab.feature:714" }),
				")"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A passive reader observes a half-built git state." }),
				" A gitStatus first read can\ntear the stream down for good on ",
				createVNode(_components.code, { children: "BASE_BRANCH_NOT_FOUND" }),
				" if it lands between\nrepo-init and base-ref creation. Fix: ",
				createVNode(_components.strong, { children: "make the base ref exist atomically" }),
				"\n(seed a bare origin, then ",
				createVNode(_components.code, { children: "git clone" }),
				") and ",
				createVNode(_components.strong, { children: "do setup in a subshell" }),
				" so the\nterminal’s cwd never enters the in-between repo. (",
				createVNode(_components.code, { children: "code-tab.feature:148" }),
				")"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Faking occlusion by swallowing render output leaks." }),
				" Suppressing ",
				createVNode(_components.code, { children: "refreshRows" }),
				"\nstill lets an incidental sync paint through. Fix: ",
				createVNode(_components.strong, { children: ["model the real freeze — park\n", createVNode(_components.code, { children: "requestAnimationFrame" })] }),
				" so only a forced sync repaint counts.\n(",
				createVNode(_components.code, { children: "render_recovery.feature:16" }),
				")"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "An edge-triggered effect can’t re-assert after a non-change" }),
				" ",
				createVNode(_components.em, { children: "(app fix)" }),
				". Focus\nstolen by a transient element when the reactive ",
				createVNode(_components.code, { children: "focused" }),
				" state didn’t change\nleaves the edge effect unfired. Fix: ",
				createVNode(_components.strong, { children: "bump a level nonce" }),
				" the handler increments\nso the effect re-asserts. (",
				createVNode(_components.code, { children: "sub-terminal.feature:107" }),
				")"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "Polling a live, reconciling collection throws transients" }),
				" ",
				createVNode(_components.em, { children: "(esp. vitest — no\nretry)" }),
				". A poll hits transient stream errors as the collection settles or a key\nreconciles out mid-read. Fix: ",
				createVNode(_components.strong, { children: "catch-and-retry in the poll" }),
				", and ",
				createVNode(_components.strong, { children: "skip a key\nthat vanishes" }),
				" between ",
				createVNode(_components.code, { children: "keys()" }),
				" and ",
				createVNode(_components.code, { children: "get()" }),
				" — the snapshot helper owns the narrow\nsuppression, the poller stays a pure condition-checker. (",
				createVNode(_components.code, { children: "daemon.test.ts" }),
				")"
			] }),
			"\n",
			createVNode(_components.li, { children: [
				createVNode(_components.strong, { children: "A screen-state match string that hard-wraps at the grid edge is split by the\nreader." }),
				" xterm wraps a logical line longer than ",
				createVNode(_components.code, { children: "cols" }),
				" across rows; a reader that\njoins rows with ",
				createVNode(_components.code, { children: "\\n" }),
				" inserts a newline INSIDE the wrapped token, so a substring\ncheck (",
				createVNode(_components.code, { children: "includes(\"notes.md\")" }),
				") misses it even though the text is fully on screen.\nFlakes because the wrap column depends on content length and on ",
				createVNode(_components.code, { children: "fit()" }),
				" having\nwidened the grid past the 80-col default — which lags under load. Fix: ",
				createVNode(_components.strong, { children: [
					"rejoin\n",
					createVNode(_components.code, { children: "isWrapped" }),
					" continuation rows"
				] }),
				" into one logical line in the buffer reader\n(",
				createVNode(_components.code, { children: "__readXtermBuffer" }),
				"), trimming right only at the logical-line end. Width- and\npath-length-independent — never a timeout bump. (",
				createVNode(_components.code, { children: "file-drop.feature" }),
				", ",
				createVNode(_components.code, { children: "clipboard.feature" }),
				")"
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
	"title": "Flaky Test Tracker",
	"description": "A backlog of flaky tests — e2e (Cucumber + Playwright) and unit (vitest). Drop a row when you hit one; an agent clears the queue from time to time.",
	"parents": ["reference"],
	"maturity": "seedling",
	"updated": "2026-07-13T00:00:00.000Z"
};
function getHeadings() {
	return [
		{
			"depth": 2,
			"slug": "flake-vs-break",
			"text": "Flake vs. break"
		},
		{
			"depth": 2,
			"slug": "backlog",
			"text": "Backlog"
		},
		{
			"depth": 2,
			"slug": "logging-a-flake",
			"text": "Logging a flake"
		},
		{
			"depth": 2,
			"slug": "fixing-routine",
			"text": "Fixing routine"
		},
		{
			"depth": 2,
			"slug": "common-flake-classes",
			"text": "Common flake classes"
		}
	];
}
var url = "src/content/atlas/flaky-test-tracker.mdx";
var file = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/flaky-test-tracker.mdx";
var Content = (props = {}) => MDXContent({
	...props,
	components: {
		Fragment,
		...props.components
	}
});
Content[Symbol.for("mdx-component")] = true;
Content[Symbol.for("astro.needsHeadRendering")] = !Boolean(frontmatter.layout);
Content.moduleId = "/home/srid/code/kolu/.worktrees/RT-fable/docs/atlas/src/content/atlas/flaky-test-tracker.mdx";
__astro_tag_component__(Content, "astro:jsx");
//#endregion
export { Content, Content as default, file, frontmatter, getHeadings, url };
