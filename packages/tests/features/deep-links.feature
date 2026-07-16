Feature: Deep links — every view addressable by a #/… URL
  A hash URL commands the view onto a host, a terminal, a file, or settings —
  through the existing view actions, view-only by law. Four delivery paths feed
  one parser: a cold-boot parse, a live hashchange, (Chromium) the PWA
  launchQueue, and the Code-tab preview bridge. See
  packages/client/src/useDeepLinks.ts + the deep-links Atlas note.

  Background:
    Given the terminal is ready

  Scenario: A live #/t link focuses that terminal without a reload
    # Two more terminals; the FIRST created one is left unfocused, then the link
    # pulls focus back to it — proving the URL moved the view.
    When I create a terminal
    And I run "echo DEEP-LIVE-MARKER"
    And I create a terminal
    And I follow the live deep link "#/t/local/{id1}"
    Then the active terminal should show "DEEP-LIVE-MARKER"
    # The hash is left in place after a handled route (durability).
    And the URL hash should still be "#/t/local/{id1}"

  Scenario: A #/t link opened on a cold boot lands focused on that terminal
    # Set the hash then reload, so the boot parse fires against it and the
    # cold-boot membership race (4b) resolves as the terminals re-attach.
    When I create a terminal
    And I run "echo DEEP-BOOT-MARKER"
    And I create a terminal
    And I open the deep link "#/t/local/{id1}" on a cold boot
    Then the active terminal should show "DEEP-BOOT-MARKER"

  Scenario: A #/t link to a split lands the sub-terminal live, not just its parent (4a)
    # The done-criterion for step 4a: the SUB pane is live, not merely the parent
    # tile focused. Capture the split's id, move focus to another tile, then the
    # link must walk the full chain back to the sub.
    When I create a sub-terminal via command palette
    And I remember the sub-terminal's id
    And I create a terminal
    And I follow the live deep link "#/t/local/{sub}"
    Then the sub pane should be the active pane
    And the sub-terminal should have keyboard focus

  Scenario: A #/t/…/code link opens the Code tab on a file at a line
    When I create a terminal
    And I run "git init /tmp/kolu-deeplink-code && cd /tmp/kolu-deeplink-code"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'alpha\nbeta\ngamma\n' > notes.txt"
    And I run "git add notes.txt && git commit -m notes"
    And I follow the live deep link "#/t/local/{id1}/code?path=notes.txt&line=2"
    Then the right panel should be visible
    And the Code tab should be active
    And the selected file should show content "beta"
    And line 2 should be selected in the file content

  Scenario: A #/t/.../inspector link to a split opens the tile's Inspector and focuses the sub
    # The right panel is per-TILE, so a sub-terminal's /inspector addresses the
    # parent tile's panel — and it must REVEAL (showInspector only selects the
    # tab). Assert the Inspector is showing/active AND the sub pane is live.
    When I create a sub-terminal via command palette
    And I remember the sub-terminal's id
    And I create a terminal
    And I follow the live deep link "#/t/local/{sub}/inspector"
    Then the Inspector tab should be active
    And the sub pane should be the active pane

  Scenario: A #/settings link opens the settings popover
    When I follow the live deep link "#/settings"
    Then the settings popover should be visible

  @mobile
  Scenario: A #/settings link opens settings on a phone, drawer and all
    # On touch the settings popover lives inside the pull-down chrome drawer,
    # which is closed by default — the route must open that drawer first, or the
    # popover has nothing to anchor to.
    When I follow the live deep link "#/settings"
    Then the settings popover should be visible

  Scenario: An unknown link is never silent — it toasts
    When I follow the live deep link "#/bananas"
    Then a toast should appear with text "doesn't point anywhere kolu knows"

  Scenario: Back and forward never replay a consumed deep link — the view stays put (DL3)
    # The deployed-build repro inverted: hashchange fires on history TRAVERSAL
    # too, and routing a browser-restored old hash teleported the view to a
    # previous link's terminal. A handled command is consumed once per history
    # entry (koluRouted stamp): back/forward revert the URL silently; a FRESH
    # hash navigation still routes (the two live links below prove it).
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
    When I go forward in browser history
    Then the URL hash should still be "#/t/local/{id2}"
    And the active terminal should show "DEEP-BACK-TWO"

  Scenario: A deep link clicked inside the Code-tab preview routes the parent app (DL2)
    # The felt proof for the whole bridge→router path: the sandboxed preview
    # can't navigate the parent, so the in-iframe SDK posts the `#/…` hash and
    # the parent routes it — the orchestrator dashboard's lane pills become
    # click-to-jump. The previewed HTML names its authoring terminal via its
    # own $KAVAL_TERMINAL_ID, so the pill targets a real terminal id.
    When I create a terminal
    And I run "git init /tmp/kolu-dl2-pill && cd /tmp/kolu-dl2-pill"
    And I run "git commit --allow-empty -m init"
    And I run "echo DEEP-PILL-MARKER"
    And I run "printf '<a href=\"/#/t/local/%s\">jump to agent</a>\n' \"$KAVAL_TERMINAL_ID\" > pill.html"
    And I run "git add pill.html && git commit -m pill"
    And I create a terminal
    And I run "cd /tmp/kolu-dl2-pill"
    And I run "echo 'open pill.html'"
    And I trigger the terminal file-ref link "pill.html"
    Then the file preview iframe should be visible
    # Routing a deep link must push NO history entries — mouse-back must never
    # replay a stale teleport (srid's dogfood finding; the bug was one push PER
    # routed link, so one routed link pins it). A second pill can't be
    # click-tested here: routing the first activates the authoring terminal and
    # the per-terminal preview is gone afterwards (#/settings has its own scenario).
    When I note the page history length
    And I click the link "jump to agent" in the file preview iframe
    Then the active terminal should show "DEEP-PILL-MARKER"
    And the page history length should be unchanged
    # Repeating the SAME pill must re-route (the consumed-once stamp gates only
    # history TRAVERSAL, never a fresh bridge request): refocus the previewing
    # terminal — its per-terminal panel restores the preview — and click again.
    When I select terminal 2 in the workspace switcher
    And I click the link "jump to agent" in the file preview iframe
    Then the active terminal should show "DEEP-PILL-MARKER"
