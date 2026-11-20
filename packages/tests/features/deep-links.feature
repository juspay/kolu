Feature: Deep links — every view addressable by a #/… URL
  A hash URL commands the view onto a host, a terminal, a file, or settings —
  through the existing view actions, view-only by law. Four delivery paths feed
  one parser: a cold-boot parse, a live hashchange, (Chromium) the PWA
  launchQueue, and the Code-tab preview bridge. See
  packages/client/src/useDeepLinks.ts + the deep-links Atlas note.

  Background:
    Given the terminal is ready

  Scenario: A live #/t link focuses that terminal without a reload
    When I create a terminal
    And I run "echo DEEP-LIVE-MARKER"
    And I create a terminal
    And I follow the live deep link "#/t/local/{id1}"
    Then the active terminal should show "DEEP-LIVE-MARKER"
    And the URL hash should still be "#/t/local/{id1}"

  Scenario: A #/t link opened on a cold boot lands focused on that terminal
    When I create a terminal
    And I run "echo DEEP-BOOT-MARKER"
    And I create a terminal
    And I open the deep link "#/t/local/{id1}" on a cold boot
    Then the active terminal should show "DEEP-BOOT-MARKER"

  Scenario: A #/t link to a split lands the sub-terminal live, not just its parent (4a)
    When I create a sub-terminal via command palette
    And I remember the sub-terminal's id
    And I create a terminal
    And I follow the live deep link "#/t/local/{sub}"
    Then the sub pane should be the active pane
    And the sub-terminal should have keyboard focus

  Scenario: A #/t/…/code link opens the Code tab on a file at a line
    When I create a terminal
    And I run "rm -rf /tmp/kolu-deeplink-code && git init /tmp/kolu-deeplink-code && cd /tmp/kolu-deeplink-code"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'alpha\nbeta\ngamma\n' > notes.txt"
    And I run "git add notes.txt && git commit -m notes"
    And I follow the live deep link "#/t/local/{id1}/code?path=notes.txt&line=2"
    Then the right panel should be visible
    And the Code tab should be active
    And the selected file should show content "beta"
    And line 2 should be selected in the file content

  Scenario: A #/t/.../inspector link to a split opens that split's own Inspector
    When I create a sub-terminal via command palette
    And I remember the sub-terminal's id
    And I create a terminal
    And I follow the live deep link "#/t/local/{sub}/inspector"
    Then the Inspector tab should be active
    And the right panel should show a pane label
    And the sub pane should be the active pane

  Scenario: A #/t/…/code link to a split resolves against the split's own repo
    When I create a sub-terminal via command palette
    And I remember the sub-terminal's id
    And I run "rm -rf /tmp/kolu-deeplink-split && git init /tmp/kolu-deeplink-split && cd /tmp/kolu-deeplink-split && printf 'split-alpha\nsplit-beta\n' > split-notes.txt && git add split-notes.txt && git commit -m init" in the sub-terminal
    And I click the Code tab
    And the file browser should show a file "split-notes.txt"
    And I create a terminal
    And I follow the live deep link "#/t/local/{sub}/code?path=split-notes.txt&line=2"
    Then the right panel should be visible
    And the Code tab should be active
    And the selected file should show content "split-beta"
    And the right panel should show a pane label

  Scenario: A #/settings link opens the settings popover
    When I follow the live deep link "#/settings"
    Then the settings popover should be visible

  @mobile
  Scenario: A #/settings link opens settings on a phone, drawer and all
    When I follow the live deep link "#/settings"
    Then the settings popover should be visible

  Scenario: An unknown link is never silent — it toasts
    When I follow the live deep link "#/bananas"
    Then a toast should appear with text "doesn't point anywhere kolu knows"

  Scenario: Back and forward never replay a consumed deep link — the view stays put (DL3)
    When I create a terminal
    And I run "echo DEEP-BACK-ONE"
    And I create a terminal
    And I run "echo DEEP-BACK-TWO"
    And I follow the live deep link "#/t/local/{id1}"
    Then the active terminal should show "DEEP-BACK-ONE"
    When I follow the live deep link "#/t/local/{id2}"
    Then the active terminal should show "DEEP-BACK-TWO"
    When I go back in browser history
    Then the URL hash should still be "#/t/local/{id1}"
    And the active terminal should show "DEEP-BACK-TWO"
    When I go back in browser history
    Then the active terminal should show "DEEP-BACK-TWO"
    When I go forward in browser history
    Then the URL hash should still be "#/t/local/{id1}"
    And the active terminal should show "DEEP-BACK-TWO"
    When I go forward in browser history
    Then the URL hash should still be "#/t/local/{id2}"
    And the active terminal should show "DEEP-BACK-TWO"

  Scenario: A deep link clicked inside the Code-tab preview routes the parent app (DL2)
    When I create a terminal
    And I run "rm -rf /tmp/kolu-dl2-pill && git init /tmp/kolu-dl2-pill && cd /tmp/kolu-dl2-pill"
    And I run "git commit --allow-empty -m init"
    And I run "echo DEEP-PILL-MARKER"
    And I run "printf '<a href=\"/#/t/local/%s\">jump to agent</a>\n' \"$KAVAL_TERMINAL_ID\" > pill.html"
    And I run "git add pill.html && git commit -m pill"
    And I create a terminal
    And I run "cd /tmp/kolu-dl2-pill"
    And I run "echo 'open pill.html'"
    And I trigger the terminal file-ref link "pill.html"
    Then the file preview iframe should be visible
    When I note the page history length
    And I click the link "jump to agent" in the file preview iframe
    Then the active terminal should show "DEEP-PILL-MARKER"
    And the page history length should be unchanged
    When I select terminal 2 in the workspace switcher
    And I click the link "jump to agent" in the file preview iframe
    Then the active terminal should show "DEEP-PILL-MARKER"
