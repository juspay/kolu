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
    When I run "rm -rf /tmp/kolu-file-ref-scale && git init /tmp/kolu-file-ref-scale && cd /tmp/kolu-file-ref-scale"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'alpha\nbeta\ngamma\ndelta\n' > scale.txt"
    And I run "clear && printf '\n\n\n\n\n              open scale.txt:3 to inspect\n'"
    And I scale the active terminal tile by 1.6
    And I arm the soft-keyboard focus probe
    And I watch for the right-panel drawer to open
    And I tap the terminal file-ref link "scale.txt:3" at its font-metric visual centre
    Then the right-panel drawer should have opened
    And xterm's helper textarea should not have been focused by tapping the link
    And there should be no page errors

  Scenario: Clicking a folder ref reveals and expands the directory in the tree
    When I run "rm -rf /tmp/kolu-file-ref-folder && git init /tmp/kolu-file-ref-folder && cd /tmp/kolu-file-ref-folder"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p app && (cd app && mkdir -p core && printf 'alpha\n' > core/one.txt && printf 'beta\n' > core/two.txt && printf 'x\n' > main.txt)"
    And I run "git add . && git commit -m files"
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
