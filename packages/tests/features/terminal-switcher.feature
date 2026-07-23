Feature: Terminal switcher (unified palette)
  The dock is the canonical live-terminal navigator; the switcher is the
  same terminal set as a searchable palette. The dock's search-icon opens
  the palette host-scoped (Terminals › local); `Mod+Shift+K` opens Terminals
  with every host already expanded under headers. Terminal rows use
  StatePips, not a separate grid.

  # Cross-host paths (remote fleet headers, switch+activate to another machine)
  # are unit-tested only — this e2e harness is single-host (local).

  Background:
    Given the terminal is ready

  Scenario: Dock appears on the canvas
    Then the workspace switcher should be visible
    And there should be no page errors

  Scenario: Dock shows one row per terminal
    Given I create a terminal
    Then the workspace switcher should have 2 branch pills
    And there should be no page errors

  Scenario: Active terminal's dock row is marked active
    Given I create a terminal
    Then the second workspace switcher branch should be the active pill
    And there should be no page errors

  Scenario: Clicking a dock row switches the active terminal
    Given I run "echo first-pill"
    And I create a terminal
    When I click workspace switcher branch 1
    Then the active terminal should show "first-pill"
    And there should be no page errors

  Scenario: Scoped terminal list filters by dock corpus
    Given I create a terminal
    When I run "cd /tmp"
    And I hover the workspace switcher
    Then the workspace switcher panel should be visible
    When I search the workspace switcher for "/tmp"
    Then the workspace switcher should show 1 card
    And there should be no page errors

  Scenario: Mod+Shift+K opens terminal-scoped palette with search focused
    When I press the workspace switcher shortcut
    Then the workspace switcher panel should be visible
    And the workspace switcher search should be focused
    And there should be no page errors

  Scenario: Dock search-icon button opens the terminal switcher
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
    And there should be no page errors

  Scenario: Escape dismisses the palette
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
    When I press Escape
    Then the workspace switcher panel should not be visible
    And there should be no page errors

  Scenario: Clicking outside dismisses the palette
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
    When I click outside the workspace switcher
    Then the workspace switcher panel should not be visible
    And there should be no page errors

  Scenario: Selecting a terminal row closes the palette
    Given I run "echo dismiss-after-select"
    And I create a terminal
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
    When I click workspace switcher card 1
    Then the workspace switcher panel should not be visible
    And the active terminal should show "dismiss-after-select"
    And there should be no page errors

  Scenario: Filtering by repo name narrows terminal rows
    Given I create a terminal
    When I run "cd /tmp"
    And I hover the workspace switcher
    When I search the workspace switcher for "tmp"
    Then the workspace switcher should show 1 card
    And there should be no page errors

  Scenario: Selecting a terminal row switches the active terminal
    Given I run "echo first-workspace-card"
    And I create a terminal
    When I hover the workspace switcher
    And I click workspace switcher card 1
    Then the active terminal should show "first-workspace-card"
    And there should be no page errors

  Scenario: Arrow keys move the keyboard cursor between terminal rows
    Given I create a terminal
    When I hover the workspace switcher
    Then the workspace switcher panel should be visible
    And the workspace switcher should show 2 cards
    And workspace switcher card 1 should be highlighted
    When I press ArrowDown
    Then workspace switcher card 2 should be highlighted
    And exactly one workspace switcher card should be highlighted
    When I press ArrowUp
    Then workspace switcher card 1 should be highlighted
    And there should be no page errors

  Scenario: Enter on the keyboard-highlighted terminal activates it
    Given I run "echo selected-via-enter"
    And I create a terminal
    When I hover the workspace switcher
    Then the workspace switcher panel should be visible
    And workspace switcher card 1 should be highlighted
    When I press Enter
    Then the workspace switcher panel should not be visible
    And the active terminal should show "selected-via-enter"
    And there should be no page errors

  Scenario: Plain-shell terminals appear in the switcher
    # Non-agent terminals must list — the dock's full set, not agents only.
    Given I create a terminal
    When I hover the workspace switcher
    Then the workspace switcher panel should be visible
    And the workspace switcher should show 2 cards
    And there should be no page errors

  Scenario: Root jump finds a terminal by name with kind tag and activates on Enter
    # (1) ⌘K root: type a distinctive branch, assert term kind tag, Enter
    # activates and closes the palette.
    When I run "rm -rf /tmp/kolu-sw-root-jump && git init /tmp/kolu-sw-root-jump && cd /tmp/kolu-sw-root-jump && git checkout -b root-jump-branch"
    And I open the command palette
    And I type "root-jump-branch" in the palette
    Then palette item "root-jump-branch" should be visible
    And palette item "root-jump-branch" should show section tag "term"
    When I press Enter
    Then the command palette should not be visible
    And the header branch should contain "root-jump-branch"
    And there should be no page errors

  Scenario: Empty-root Recent ranks by visit trail (last active first)
    # Activate A then B via dock; ⌘K Recent should list B before A.
    When I run "rm -rf /tmp/kolu-visit-a && git init /tmp/kolu-visit-a && cd /tmp/kolu-visit-a && git checkout -b visit-a-branch"
    And I create a terminal
    And I run "rm -rf /tmp/kolu-visit-b && git init /tmp/kolu-visit-b && cd /tmp/kolu-visit-b && git checkout -b visit-b-branch"
    # visit-b is active (just created). Click the older dock row to activate visit-a, then back to visit-b.
    When I click workspace switcher branch 1
    And I click workspace switcher branch 2
    And I open the command palette
    Then the first palette terminal row should be "visit-b-branch"
    And palette terminal row "visit-b-branch" should appear before "visit-a-branch"
    And there should be no page errors

  Scenario: Mod+Shift+K shows host header with terminal rows without drilling
    # (2) ⌘⇧K auto-expands: local header + count, terminal rows beneath.
    Given I create a terminal
    When I press the workspace switcher shortcut
    Then the workspace switcher panel should be visible
    And the palette host header "local" should be visible
    And the palette host header "local" should show at least 1 terminal
    And the workspace switcher should show 2 cards
    And the palette breadcrumb should show "Terminals"
    And the palette breadcrumb should not show a host segment after Terminals
    And there should be no page errors

  Scenario: Split siblings are excluded from the switcher while the parent is listed
    # (3) parentId children must not appear as independent rows.
    # Use Ctrl+` (not the palette path) so focus/click flakiness on xterm
    # canvas cannot strand the setup.
    Given I create a terminal
    When I press Control+Backquote
    Then the active tile should show sub-terminal count 1
    When I press the workspace switcher shortcut
    Then the workspace switcher panel should be visible
    # Background terminal + the one we created = 2 top-level; the split is not a third.
    And the workspace switcher should show 2 cards
    And there should be no page errors

  Scenario: Dock search icon opens host-scoped Terminals with breadcrumb
    # (4) dock-search deep-links Terminals › local (active host).
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
    And the palette breadcrumb should show "Terminals"
    And the palette breadcrumb should show "local"
    And there should be no page errors

  @mobile
  Scenario: Dock is not rendered on mobile
    Then the workspace switcher should not be visible
    And there should be no page errors
