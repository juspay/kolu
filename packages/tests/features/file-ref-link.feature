Feature: File-ref autolinking in terminal
  Terminal output that contains a `path/to/file:line` reference becomes
  clickable; clicking opens that file in the right panel's Code tab at
  the referenced line (#861).

  Background:
    Given the terminal is ready

  Scenario: Clicking a file-ref opens the file in browse mode
    When I run "rm -rf /tmp/kolu-file-ref-861 && git init /tmp/kolu-file-ref-861 && cd /tmp/kolu-file-ref-861"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'line one\nline two\nline three\nline four\n' > notes.txt"
    And I run "echo 'see notes.txt:3 for the line'"
    And I trigger the terminal file-ref link "notes.txt:3"
    Then the right panel should be visible
    And the Code tab should be active
    And the Code tab mode should be "browse"
    And the selected file should show content "line three"

  @mobile
  Scenario: Tapping a file-ref on touch follows the link instead of summoning the keyboard
    # xterm's own link activation is mouse/hover-only and never fires for a
    # touch tap, so the terminal tap handler hit-tests the ref itself: a tap on
    # a path:line reference opens the Code tab (here as the mobile bottom
    # drawer), a tap on plain content focuses to type. Only the latter raises
    # the soft keyboard — tapping the link must NOT pop it.
    When I run "rm -rf /tmp/kolu-file-ref-mobile && git init /tmp/kolu-file-ref-mobile && cd /tmp/kolu-file-ref-mobile"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'alpha\nbeta\ngamma\n' > notes.txt"
    And I run "echo 'open notes.txt:2 for details'"
    And I arm the soft-keyboard focus probe
    And I watch for the right-panel drawer to open
    And I tap the terminal file-ref link "notes.txt:2"
    Then the right-panel drawer should have opened
    And xterm's helper textarea should not have been focused by tapping the link
    And there should be no page errors

  @mobile
  Scenario: A touch tap under an injected CSS transform resolves to the visually-tapped cell (mobile stand-in; the canvas-zoom quadrant is Chromium-unreachable)
    # PR-2 divisor unification — the regression guard for the extracted touch tap
    # UNDER a CSS transform. FIDELITY CAVEAT, stated plainly: the real kolu state
    # this guards is a touch tap on the DESKTOP canvas's zoomed tile — which needs
    # a coarse-PRIMARY pointer that CAN hover. Chromium CANNOT emulate that
    # quadrant: touch emulation welds `(hover:none)` on, and without touch the
    # primary pointer is `fine` — a two-run CI oracle proved BOTH directions
    # (with hasTouch → {coarse:true, hover:false}; without → {coarse:false,
    # hover:true}; CDP `setEmulatedMedia` pointer/hover features had NO effect).
    # So `(pointer:coarse) and (hover:hover)` is unreachable, and this runs in the
    # reachable @mobile touch config with an INJECTED CSS `scale()` as the
    # stand-in for the tile-zoom transform. `cellAtPoint` reads the transform off
    # `getBoundingClientRect`/`offsetWidth` (corrected once by
    # `patchTransformAwareMouseCoords`), so the transform's SOURCE (injected vs
    # canvas zoom) is transparent to the code under test — this exercises the
    # exact tap path (`wireTouchTaps` → `cellAtPoint`) under a real CSS transform.
    # Corroborated by `canvas-selection.feature` (the SAME authority under real
    # canvas zoom, for selection) and the `cellAtPoint` unit delegation pin in
    # `internals.test.ts`. It guards the path; it does NOT disprove the deleted
    # `rect.width/cols` (a centre tap resolves identically under both — sub-pixel).
    When I run "rm -rf /tmp/kolu-file-ref-scale && git init /tmp/kolu-file-ref-scale && cd /tmp/kolu-file-ref-scale"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'alpha\nbeta\ngamma\ndelta\n' > scale.txt"
    # Put the target far enough from both transform axes that an uncorrected
    # resolver lands on a different, non-link cell, but still inside the mobile
    # terminal's clip after magnification. The tap step asserts both conditions.
    And I run "clear && printf '\n\n\n\n\n              open scale.txt:3 to inspect\n'"
    # Inject the ancestor CSS scale (the reachable stand-in for canvas zoom), then
    # tap the glyph's now-magnified visual centre — it must still resolve to the
    # ref (drawer opens; a mis-resolved tap would land on plain content and focus
    # the keyboard instead).
    And I scale the active terminal tile by 1.6
    And I arm the soft-keyboard focus probe
    And I watch for the right-panel drawer to open
    And I tap the terminal file-ref link "scale.txt:3" at its font-metric visual centre
    Then the right-panel drawer should have opened
    And xterm's helper textarea should not have been focused by tapping the link
    And there should be no page errors

  Scenario: Clicking a folder ref reveals and expands the directory in the tree
    # A folder path in terminal output (no filename, no `:line`) used to toast
    # "File reference not found". It now reveals the directory in the Code tab's
    # All-files tree: switch to browse, expand the folder + its ancestors, and
    # scroll it into view — no file is selected.
    When I run "rm -rf /tmp/kolu-file-ref-folder && git init /tmp/kolu-file-ref-folder && cd /tmp/kolu-file-ref-folder"
    And I run "git commit --allow-empty -m init"
    # Build the nested dir inside a subshell so `app/core` only ever appears
    # contiguously in the prose below — a setup line printing `app/core/one.txt`
    # would mask the folder ref (the hit-test would land on that file's link).
    # `app` also holds a sibling file so `app/` and `app/core/` stay distinct
    # rows (not flattened into one), exercising the ancestor-expand path.
    And I run "mkdir -p app && (cd app && mkdir -p core && printf 'alpha\n' > core/one.txt && printf 'beta\n' > core/two.txt && printf 'x\n' > main.txt)"
    And I run "git add . && git commit -m files"
    # Mount the tree BEFORE the folder-ref click. A folder ref reveals via a
    # one-shot resolve: it runs EXACTLY ONCE, the instant `!allPaths.pending()`
    # (the first `fsListAll` snapshot for the repo), and a null match is not
    # retried — `fsListAll` only re-yields on a git/worktree change, and git
    # state is already settled by the time the ref is clicked, so no later
    # snapshot arrives to resolve against. On a FRESH open (tree not yet mounted)
    # the click resolves against whatever snapshot happens to be first, which is
    # not reliably the one that has enumerated the just-committed files; when it
    # isn't, resolveRef returns null, the request is consumed, and nothing is
    # revealed — observed failing on both CI platforms. Resolving against an
    # already-mounted tree sidesteps the one-shot race: enumeration is proven
    # complete before the click. (The fresh-open constructor-reveal path itself
    # is covered by the `resolveRef` unit tests in `ui/lineRef.test.ts`.)
    #
    # So: a prior file-ref click to the sibling `app/main.txt` (NOT under
    # `app/core`, so it can't mask the folder ref's hit-test) opens browse and
    # mounts the tree; waiting for the `app` row proves `fsListAll` has
    # enumerated. Same post-mount reveal path as the next scenario.
    And I run "echo 'open app/main.txt first'"
    And I trigger the terminal file-ref link "app/main.txt"
    And the file browser should show a directory "app"
    And I run "echo 'inspect the app/core module'"
    And I trigger the terminal file-ref link "app/core"
    Then the right panel should be visible
    And the Code tab should be active
    And the Code tab mode should be "browse"
    And the directory "app/core" should be expanded in the file browser
    And the file browser should show a file "app/core/one.txt"

  Scenario: Clicking a folder ref while already browsing expands it in the live tree
    # Both folder-ref reveal scenarios mount the tree before the folder click —
    # the constructor-reveal-of-just-created-files variant is inherently racy on
    # darwin (fsListAll only subscribes when the panel opens, so its first
    # snapshot races the FSEvents walk) and its wiring is covered by resolveRef's
    # unit tests. Here a file-ref click opens browse and mounts the tree first,
    # so the folder click exercises the post-mount reveal (expand + scroll on the
    # already-live tree). The precondition
    # only needs the tree LIVE — confirm it via the top-level `lib/` row, which is
    # present the moment the tree mounts (no file-content render, no
    # selection/expansion to wait on — both slow, flaky axes under darwin CI
    # load that are irrelevant to what this scenario tests).
    When I run "rm -rf /tmp/kolu-file-ref-folder2 && git init /tmp/kolu-file-ref-folder2 && cd /tmp/kolu-file-ref-folder2"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p lib && (cd lib && mkdir -p ui && printf 'a\n' > ui/button.ts && printf 'b\n' > ui/input.ts && printf 'x\n' > index.ts)"
    And I run "git add . && git commit -m files"
    And I run "echo 'open lib/index.ts first'"
    And I trigger the terminal file-ref link "lib/index.ts"
    Then the file browser should show a directory "lib"
    When I run "echo 'now the lib/ui widgets'"
    And I trigger the terminal file-ref link "lib/ui"
    Then the directory "lib/ui" should be expanded in the file browser
    And the file browser should show a file "lib/ui/button.ts"

  # The resolution variants those three terminal-folder scenarios once covered —
  # a single-segment trailing-slash ref (`widgets/`), a `:line`-bearing folder
  # ref failing closed, and the browse-filter clear — are exercised by the
  # `resolveRef`/`parseLineRefs` unit tests in `ui/lineRef.test.ts` (trailing
  # slash, `ls -F` multi-dir, `hasLine` → null). They were dropped from e2e
  # because each is a tree-reveal scenario subject to darwin CI's load-timeout
  # flakiness, and the two scenarios above already prove the click→reveal wiring
  # end-to-end (the at-mount constructor path and the post-mount effect path).

  Scenario: Clicking a bare path (no line number) opens the file with no selection
    When I run "rm -rf /tmp/kolu-file-ref-noline && git init /tmp/kolu-file-ref-noline && cd /tmp/kolu-file-ref-noline"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'alpha\nbeta\ngamma\n' > plain.txt"
    And I run "echo 'see plain.txt for context'"
    And I trigger the terminal file-ref link "plain.txt"
    Then the right panel should be visible
    And the Code tab should be active
    And the Code tab mode should be "browse"
    And the selected file should show content "alpha"
    And no line should be selected in the file content

  Scenario: Clicking a slash-containing path with no line opens the file with no selection
    When I run "rm -rf /tmp/kolu-file-ref-slash-noline && git init /tmp/kolu-file-ref-slash-noline && cd /tmp/kolu-file-ref-slash-noline"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p src && printf 'alpha\nbeta\ngamma\n' > src/notes.txt"
    And I run "echo 'see src/notes.txt for context'"
    And I trigger the terminal file-ref link "src/notes.txt"
    Then the right panel should be visible
    And the Code tab should be active
    And the Code tab mode should be "browse"
    And the selected file should show content "alpha"
    And no line should be selected in the file content

  Scenario: Bare basename without a line number resolves via unique-basename fallback
    When I run "rm -rf /tmp/kolu-file-ref-noline-basename && git init /tmp/kolu-file-ref-noline-basename && cd /tmp/kolu-file-ref-noline-basename"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p src/lib && printf 'alpha\nbeta\ngamma\n' > src/lib/unique.txt"
    And I run "echo 'open unique.txt for details'"
    And I trigger the terminal file-ref link "unique.txt"
    Then the right panel should be visible
    And the Code tab should be active
    And the selected file should show content "alpha"
    And no line should be selected in the file content

  Scenario: Clicking a line-range file-ref selects the whole range
    When I run "rm -rf /tmp/kolu-file-ref-range-sel && git init /tmp/kolu-file-ref-range-sel && cd /tmp/kolu-file-ref-range-sel"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'one\ntwo\nthree\nfour\nfive\nsix\n' > range.txt"
    And I run "echo 'block at range.txt:2-4 needs attention'"
    And I trigger the terminal file-ref link "range.txt:2-4"
    Then the selected file should show content "three"
    And line 2 should be selected in the file content
    And line 3 should be selected in the file content
    And line 4 should be selected in the file content

  Scenario: Clicking a line-range deep in a long file scrolls the selection into view
    When I run "rm -rf /tmp/kolu-file-ref-deep && git init /tmp/kolu-file-ref-deep && cd /tmp/kolu-file-ref-deep"
    And I run "git commit --allow-empty -m init"
    And I run "seq 1 200 > big.txt"
    And I run "echo 'hot spot at big.txt:161-165 here'"
    And I trigger the terminal file-ref link "big.txt:161-165"
    Then line 161 should be selected in the file content
    And line 165 should be selected in the file content

  Scenario: A file-ref opens on the first click when an iframe preview is already showing
    When I run "rm -rf /tmp/kolu-file-ref-preview && git init /tmp/kolu-file-ref-preview && cd /tmp/kolu-file-ref-preview"
    And I run "git commit --allow-empty -m init"
    And I run "printf '<h1>hi</h1>\n' > page.html"
    And I run "printf 'alpha\nbeta\ngamma\ndelta\n' > world.ts"
    And I run "echo 'open page.html first'"
    And I trigger the terminal file-ref link "page.html"
    Then the file preview iframe should be visible
    When I run "echo 'now jump to world.ts:3'"
    And I trigger the terminal file-ref link "world.ts:3"
    Then the file preview iframe should not be visible
    And the selected file should show content "gamma"
    And line 3 should be selected in the file content

  # Guards the c89a85f3 regression: a second click on the same `path:line`
  # after manually collapsing the panel must re-open it. The bug was
  # production-only (passes in dev) — see right-panel/openInCodeTab.ts for
  # the deferred-effect-elision mechanism and the imperative-reveal fix.
  # This scenario is the canary for that fix, so it must run against the
  # bundled build (`just test-quick`), not just dev.
  Scenario: Re-clicking the same file-ref after closing the panel re-selects the line
    When I run "rm -rf /tmp/kolu-file-ref-861-reclick && git init /tmp/kolu-file-ref-861-reclick && cd /tmp/kolu-file-ref-861-reclick"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'one\ntwo\nthree\nfour\nfive\nsix\n' > recheck.txt"
    And I run "echo 'see recheck.txt:3 again'"
    And I trigger the terminal file-ref link "recheck.txt:3"
    Then the selected file should show content "three"
    And line 3 should be selected in the file content
    When I collapse the right panel
    Then the right panel should not be visible
    When I trigger the terminal file-ref link "recheck.txt:3"
    Then the right panel should be visible
    And line 3 should be selected in the file content
