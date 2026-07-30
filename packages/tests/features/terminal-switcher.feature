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

  Scenario: Mod+Shift+K opens terminal-scoped palette with search focused
    When I press the workspace switcher shortcut
    Then the workspace switcher panel should be visible
    And the workspace switcher search should be focused
    And there should be no page errors

  Scenario: Dock search-icon button opens the terminal switcher
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
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

  Scenario: Empty-root Recent ranks by visit trail and excludes the active tile
    # Activate A then B; ⌘K Recent lists the previous (A) first — not B.
    When I run "rm -rf /tmp/kolu-visit-a && git init /tmp/kolu-visit-a && cd /tmp/kolu-visit-a && git checkout -b visit-a-branch"
    And I create a terminal
    And I run "rm -rf /tmp/kolu-visit-b && git init /tmp/kolu-visit-b && cd /tmp/kolu-visit-b && git checkout -b visit-b-branch"
    # visit-b is active (just created). Click older dock row then back to B.
    When I click workspace switcher branch 1
    And I click workspace switcher branch 2
    And I open the command palette
    # visit-b is active → excluded from Recent; previous visit (A) is first.
    Then the first palette terminal row should be "visit-a-branch"
    And there should be no page errors

  Scenario: ⌘K then Enter toggles the previous terminal
    When I run "rm -rf /tmp/kolu-toggle-a && git init /tmp/kolu-toggle-a && cd /tmp/kolu-toggle-a && git checkout -b toggle-a-branch"
    And I create a terminal
    And I run "rm -rf /tmp/kolu-toggle-b && git init /tmp/kolu-toggle-b && cd /tmp/kolu-toggle-b && git checkout -b toggle-b-branch"
    # B active. ⌘K Enter → A; ⌘K Enter → B.
    When I open the command palette
    Then the first palette terminal row should be "toggle-a-branch"
    When I press Enter
    Then the command palette should not be visible
    And the header branch should contain "toggle-a-branch"
    When I open the command palette
    Then the first palette terminal row should be "toggle-b-branch"
    When I press Enter
    Then the command palette should not be visible
    And the header branch should contain "toggle-b-branch"
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
