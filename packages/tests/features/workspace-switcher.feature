Feature: Workspace switcher (activity dock as canonical navigator)
  The activity dock is now the canonical live-terminal navigator (#903).
  Each dock row stands in for a terminal entry; the dock's mega mode
  hosts the search + repo facets + agent-state columns that used to
  live in the chrome-bar workspace switcher.

  Background:
    Given the terminal is ready

  Scenario: Workspace switcher (activity dock) appears on the canvas
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
    # The Background-created terminal is t0; running echo targets it
    # (it's the active one). Then a second terminal becomes active.
    # Clicking row 1 returns to t0, whose buffer carries the echo
    # output. (#830: typing in t0 lifts its recency above the just-
    # created t1, so t0 leads the recency-sorted dock order.)
    Given I run "echo first-pill"
    And I create a terminal
    When I click workspace switcher branch 1
    Then the active terminal should show "first-pill"
    And there should be no page errors

  Scenario: Mega level search filters live terminal metadata
    Given I create a terminal
    When I run "cd /tmp"
    And I hover the workspace switcher
    Then the workspace switcher panel should be visible
    When I search the workspace switcher for "/tmp"
    Then the workspace switcher should show 1 card
    And there should be no page errors

  Scenario: Mod+Shift+K opens mega level with search focused
    When I press the workspace switcher shortcut
    Then the workspace switcher panel should be visible
    And the workspace switcher search should be focused
    And there should be no page errors

  Scenario: Mega-toggle button latches mega open
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
    And there should be no page errors

  Scenario: Close button dismisses mega
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
    When I click the workspace switcher close button
    Then the workspace switcher panel should not be visible
    And there should be no page errors

  Scenario: Escape dismisses mega
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
    When I press Escape
    Then the workspace switcher panel should not be visible
    And there should be no page errors

  Scenario: Clicking outside dismisses mega
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
    When I click outside the workspace switcher
    Then the workspace switcher panel should not be visible
    And there should be no page errors

  Scenario: Selecting a mega card closes the panel
    Given I run "echo dismiss-after-select"
    And I create a terminal
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
    When I click workspace switcher card 1
    Then the workspace switcher panel should not be visible
    And the active terminal should show "dismiss-after-select"
    And there should be no page errors

  Scenario: Repo facet keeps mega open
    Given I create a terminal
    When I run "cd /tmp"
    And I hover the workspace switcher
    And I click workspace switcher repo "tmp"
    Then the workspace switcher panel should be visible
    And the workspace switcher should show 1 card
    And the workspace switcher should show only repo "tmp" cards
    And there should be no page errors

  Scenario: Selecting a mega card switches the active terminal
    Given I run "echo first-workspace-card"
    And I create a terminal
    When I hover the workspace switcher
    And I click workspace switcher card 1
    Then the active terminal should show "first-workspace-card"
    And there should be no page errors

  Scenario: Mega columns enumerate every agent state bucket
    # The Idle column lives between Working and No agent and surfaces the
    # parked-by-inactivity entries the minimap window picker dims. Even on
    # a fresh workspace (no parked terminals) the column is rendered so the
    # ladder reads as a triage scaffold rather than a feature that appears
    # only when something is wrong.
    When I hover the workspace switcher
    Then the workspace switcher panel should be visible
    And the workspace switcher should show buckets "idle, awaiting, working, none"
    And the workspace switcher idle column should show sub-buckets "4h-12h, 12h-24h, 24h-48h, 48h+"
    And there should be no page errors

  @mobile
  Scenario: Activity dock is not rendered on mobile
    Then the workspace switcher should not be visible
    And there should be no page errors
