Feature: Terminal switcher (unified palette)
  The dock is the canonical live-terminal navigator; the switcher is the
  same terminal set as a searchable palette. The dock's search-icon opens
  the palette host-scoped (Terminals › local); `Mod+Shift+K` opens the
  Terminals host list. Terminal rows use StatePips, not a separate grid.

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

  @mobile
  Scenario: Dock is not rendered on mobile
    Then the workspace switcher should not be visible
    And there should be no page errors
