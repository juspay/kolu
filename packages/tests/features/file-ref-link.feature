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
    And I run "mkdir -p src && printf 'module Main\nimport Data\nmain = pure ()\n' > src/Main.hs"
    And I run "echo 'error in src/Main.hs:2 — bad import'"
    And I trigger the terminal file-ref link "src/Main.hs:2"
    Then the right panel should be visible
    And the Code tab should be active
    And the Code tab mode should be "browse"
    And the selected file should show content "import Data"
    And line 2 should be selected in the file content

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
    And I run "mkdir -p src && printf 'module Main\nimport Data\nmain = pure ()\n' > src/Main.hs"
    And I run "echo 'see src/Main.hs for the entrypoint'"
    And I trigger the terminal file-ref link "src/Main.hs"
    Then the right panel should be visible
    And the Code tab should be active
    And the Code tab mode should be "browse"
    And the selected file should show content "module Main"
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
