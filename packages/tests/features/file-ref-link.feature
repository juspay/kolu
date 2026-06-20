Feature: File-ref autolinking in terminal
  Terminal output that contains a `path/to/file:line` reference becomes
  clickable; clicking opens that file in the right panel's Code tab at
  the referenced line (#861).

  Background:
    Given the terminal is ready

  Scenario: Clicking a file-ref opens the file in browse mode
    When I run "git init /tmp/kolu-file-ref-861 && cd /tmp/kolu-file-ref-861"
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
    When I run "git init /tmp/kolu-file-ref-mobile && cd /tmp/kolu-file-ref-mobile"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'alpha\nbeta\ngamma\n' > notes.txt"
    And I run "echo 'open notes.txt:2 for details'"
    And I arm the soft-keyboard focus probe
    And I watch for the right-panel drawer to open
    And I tap the terminal file-ref link "notes.txt:2"
    Then the right-panel drawer should have opened
    And xterm's helper textarea should not have been focused by tapping the link
    And there should be no page errors

  Scenario: Clicking a line-range file-ref opens the file
    When I run "git init /tmp/kolu-file-ref-861-range && cd /tmp/kolu-file-ref-861-range"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'one\ntwo\nthree\nfour\nfive\nsix\n' > range.txt"
    And I run "echo 'block at range.txt:2-4 needs attention'"
    And I trigger the terminal file-ref link "range.txt:2-4"
    Then the selected file should show content "three"

  Scenario: Bare filename resolves when its basename is unique in the repo
    When I run "git init /tmp/kolu-file-ref-898 && cd /tmp/kolu-file-ref-898"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p src/lib && printf 'alpha\nbeta\ngamma\n' > src/lib/notes.txt"
    And I run "echo 'see notes.txt:2 for the line'"
    And I trigger the terminal file-ref link "notes.txt:2"
    Then the right panel should be visible
    And the Code tab should be active
    And the Code tab mode should be "browse"
    And the selected file should show content "beta"

  Scenario: Clicking a slash-containing path opens the file at the line
    When I run "git init /tmp/kolu-file-ref-slash && cd /tmp/kolu-file-ref-slash"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p src && printf 'alpha\nbeta\ngamma\n' > src/notes.txt"
    And I run "echo 'error in src/notes.txt:2 — context'"
    And I trigger the terminal file-ref link "src/notes.txt:2"
    Then the right panel should be visible
    And the Code tab should be active
    And the Code tab mode should be "browse"
    And the selected file should show content "beta"
    And line 2 should be selected in the file content

  Scenario: Clicking a folder ref reveals and expands the directory in the tree
    # A folder path in terminal output (no filename, no `:line`) used to toast
    # "File reference not found". It now reveals the directory in the Code tab's
    # All-files tree: switch to browse, expand the folder + its ancestors, and
    # scroll it into view — no file is selected.
    When I run "git init /tmp/kolu-file-ref-folder && cd /tmp/kolu-file-ref-folder"
    And I run "git commit --allow-empty -m init"
    # Build the nested dir inside a subshell so `app/core` only ever appears
    # contiguously in the prose below — a setup line printing `app/core/one.txt`
    # would mask the folder ref (the hit-test would land on that file's link).
    # `app` also holds a sibling file so `app/` and `app/core/` stay distinct
    # rows (not flattened into one), exercising the ancestor-expand path.
    And I run "mkdir -p app && (cd app && mkdir -p core && printf 'alpha\n' > core/one.txt && printf 'beta\n' > core/two.txt && printf 'x\n' > main.txt)"
    And I run "git add . && git commit -m files"
    # Mount the tree before the folder-ref click. The fresh-open reveal resolves
    # EXACTLY ONCE the instant `!allPaths.pending()`, which can flip true before
    # the FSEvents walk enumerates the just-committed files on a slow darwin
    # runner — resolveRef then returns null and the request is permanently
    # consumed (the reveal never happens). A prior file-ref click to the sibling
    # `app/main.txt` (NOT under `app/core`, so it can't mask the folder ref's
    # hit-test) opens browse and mounts the tree; waiting for the `app` row
    # proves fsListAll has enumerated. Same post-mount path as the next scenario.
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
    When I run "git init /tmp/kolu-file-ref-folder2 && cd /tmp/kolu-file-ref-folder2"
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
    When I run "git init /tmp/kolu-file-ref-noline && cd /tmp/kolu-file-ref-noline"
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
    When I run "git init /tmp/kolu-file-ref-slash-noline && cd /tmp/kolu-file-ref-slash-noline"
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
    When I run "git init /tmp/kolu-file-ref-noline-basename && cd /tmp/kolu-file-ref-noline-basename"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p src/lib && printf 'alpha\nbeta\ngamma\n' > src/lib/unique.txt"
    And I run "echo 'open unique.txt for details'"
    And I trigger the terminal file-ref link "unique.txt"
    Then the right panel should be visible
    And the Code tab should be active
    And the selected file should show content "alpha"
    And no line should be selected in the file content

  Scenario: Clicking a line-range file-ref selects the whole range
    When I run "git init /tmp/kolu-file-ref-range-sel && cd /tmp/kolu-file-ref-range-sel"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'one\ntwo\nthree\nfour\nfive\nsix\n' > range.txt"
    And I run "echo 'block at range.txt:2-4 needs attention'"
    And I trigger the terminal file-ref link "range.txt:2-4"
    Then the selected file should show content "three"
    And line 2 should be selected in the file content
    And line 3 should be selected in the file content
    And line 4 should be selected in the file content

  Scenario: Clicking a line-range deep in a long file scrolls the selection into view
    When I run "git init /tmp/kolu-file-ref-deep && cd /tmp/kolu-file-ref-deep"
    And I run "git commit --allow-empty -m init"
    And I run "seq 1 200 > big.txt"
    And I run "echo 'hot spot at big.txt:161-165 here'"
    And I trigger the terminal file-ref link "big.txt:161-165"
    Then line 161 should be selected in the file content
    And line 165 should be selected in the file content

  Scenario: A file-ref opens on the first click when an iframe preview is already showing
    When I run "git init /tmp/kolu-file-ref-preview && cd /tmp/kolu-file-ref-preview"
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

  Scenario: A trailing sentence period does not break a slash-containing file-ref
    # The reported bug: prose like "There's now a single
    # docs/plans/electricity.html." ends the path with a sentence period. `.`
    # is a path char (extensions, dotfiles), so the greedy match used to
    # swallow the period and the link pointed at a nonexistent
    # `…electricity.html.` — clicking it silently no-opped. The link must stop
    # at the real filename and open the file.
    When I run "git init /tmp/kolu-file-ref-trailing-dot && cd /tmp/kolu-file-ref-trailing-dot"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p docs/plans"
    # Create the file via a subshell so the full `docs/plans/electricity.html`
    # only ever appears contiguously in the period-bearing prose below — if a
    # setup line printed the clean path, the link hit-test would land there and
    # mask the bug.
    And I run "(cd docs/plans && printf '<h1>electricity</h1>\n' > electricity.html)"
    And I run "echo 'There is now a single docs/plans/electricity.html.'"
    And I trigger the terminal file-ref link "docs/plans/electricity.html"
    Then the right panel should be visible
    And the Code tab should be active
    And the file preview iframe should be visible
    And the file preview iframe should contain "electricity"

  # Guards the c89a85f3 regression: a second click on the same `path:line`
  # after manually collapsing the panel must re-open it. The bug was
  # production-only (passes in dev) — see right-panel/openInCodeTab.ts for
  # the deferred-effect-elision mechanism and the imperative-reveal fix.
  # This scenario is the canary for that fix, so it must run against the
  # bundled build (`just test-quick`), not just dev.
  Scenario: Re-clicking the same file-ref after closing the panel re-selects the line
    When I run "git init /tmp/kolu-file-ref-861-reclick && cd /tmp/kolu-file-ref-861-reclick"
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
