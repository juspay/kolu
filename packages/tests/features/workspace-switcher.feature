Feature: Workspace switcher
  The floating workspace switcher is the canonical live-terminal navigator.
  Its collapsed form is a compact repo/branch pill strip; hover opens a
  searchable panel grouped by agent state.

  Background:
    Given the terminal is ready

  Scenario: Workspace switcher appears on the canvas
    Then the workspace switcher should be visible
    And there should be no page errors

  Scenario: Collapsed workspace switcher shows one branch pill per terminal
    Given I create a terminal
    Then the workspace switcher should have 2 branch pills
    And there should be no page errors

  Scenario: Active terminal's collapsed pill is marked active
    Given I create a terminal
    Then the second workspace switcher branch should be the active pill
    And there should be no page errors

  Scenario: Active terminal stays visible past the per-row pill cap
    # The collapsed strip shows up to ITEMS_PER_ROW=3 pills per repo and
    # rolls the rest into a "+N" chip. Switching focus to a terminal that
    # would otherwise sit in overflow must hoist it into the visible slice
    # — otherwise the user can't see what they just clicked. Background
    # creates t0; three more puts us at four same-repo terminals; the
    # expanded panel exposes the would-be-clipped one as card 4.
    Given I create a terminal
    And I create a terminal
    And I create a terminal
    When I hover the workspace switcher
    And I click workspace switcher card 4
    Then the third workspace switcher branch should be the active pill
    And there should be no page errors

  Scenario: Clicking a collapsed branch pill switches the active terminal
    # The Background-created terminal is t0; running echo targets it
    # (it's the active one). Then a second terminal becomes active. Clicking
    # pill 1 returns to t0, whose buffer carries the echo output. (#830:
    # typing in t0 lifts its recency above the just-created t1, so t0
    # leads the sort.)
    Given I run "echo first-pill"
    And I create a terminal
    When I click workspace switcher branch 1
    Then the active terminal should show "first-pill"
    And there should be no page errors

  Scenario: Clicking a collapsed branch pill works while the panel is open
    Given I run "echo hover-pill-click"
    And I create a terminal
    When I hover the workspace switcher
    And I click workspace switcher branch 1
    Then the active terminal should show "hover-pill-click"
    And there should be no page errors

  Scenario: Workspace switcher hover panel searches live terminal metadata
    Given I create a terminal
    When I run "cd /tmp"
    And I hover the workspace switcher
    Then the workspace switcher panel should be visible
    When I search the workspace switcher for "/tmp"
    Then the workspace switcher should show 1 card
    And there should be no page errors

  Scenario: Workspace switcher shortcut opens search
    When I press the workspace switcher shortcut
    Then the workspace switcher panel should be visible
    And the workspace switcher search should be focused
    And there should be no page errors

  Scenario: Toggle button latches the workspace switcher panel open
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
    When I click the workspace switcher toggle
    Then the workspace switcher panel should not be visible
    And there should be no page errors

  Scenario: Close button dismisses the workspace switcher panel
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
    When I click the workspace switcher close button
    Then the workspace switcher panel should not be visible
    And there should be no page errors

  Scenario: Escape dismisses the workspace switcher panel
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
    When I press Escape
    Then the workspace switcher panel should not be visible
    And there should be no page errors

  Scenario: Clicking outside dismisses a latched workspace switcher panel
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
    When I click outside the workspace switcher
    Then the workspace switcher panel should not be visible
    And there should be no page errors

  Scenario: Selecting a workspace switcher card closes the panel
    Given I run "echo dismiss-after-select"
    And I create a terminal
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
    When I click workspace switcher card 1
    Then the workspace switcher panel should not be visible
    And the active terminal should show "dismiss-after-select"
    And there should be no page errors

  Scenario: Clicking a workspace switcher repo facet keeps the panel open
    Given I create a terminal
    When I run "cd /tmp"
    And I hover the workspace switcher
    And I click workspace switcher repo "tmp"
    Then the workspace switcher panel should be visible
    And the workspace switcher should show 1 card
    And the workspace switcher should show only repo "tmp" cards
    And there should be no page errors

  Scenario: Selecting a workspace switcher card switches the active terminal
    Given I run "echo first-workspace-card"
    And I create a terminal
    When I hover the workspace switcher
    And I click workspace switcher card 1
    Then the active terminal should show "first-workspace-card"
    And there should be no page errors

  Scenario: Moving from a branch pill into the panel keeps cards clickable
    Given I run "echo hover-crossing"
    And I create a terminal
    When I move from the workspace switcher pill into the panel
    And I click workspace switcher card 1
    Then the active terminal should show "hover-crossing"
    And there should be no page errors

  Scenario: Expanded panel shows all four agent-state columns
    # The Idle column lives between Working and No agent and surfaces the
    # parked-by-inactivity entries the minimap window picker dims. Even on
    # a fresh workspace (no parked terminals) the column is rendered so the
    # ladder reads as a triage scaffold rather than a feature that appears
    # only when something is wrong.
    When I hover the workspace switcher
    Then the workspace switcher panel should be visible
    And the workspace switcher should show buckets "awaiting, working, idle, none"
    And the workspace switcher idle column should show sub-buckets "4h-12h, 12h-24h, 24h-48h, 48h+"
    And there should be no page errors

  @mobile
  Scenario: Desktop workspace switcher is not rendered on mobile
    Then the workspace switcher should not be visible
    And there should be no page errors
