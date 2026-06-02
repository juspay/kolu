Feature: Workspace switcher (unified palette navigator)
  The dock is the canonical live-terminal navigator (#903); the
  workspace-search surface unified with the command palette in #912 —
  `Mod+Shift+K` and the dock's search-icon button both open the
  palette pre-drilled into "Search workspaces", whose body renders
  the same facet sidebar + agent-state column grid the standalone
  mega level used to host.

  Background:
    Given the terminal is ready

  Scenario: Workspace switcher (dock) appears on the canvas
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

  Scenario: Palette body search filters live terminal metadata
    Given I create a terminal
    When I run "cd /tmp"
    And I hover the workspace switcher
    Then the workspace switcher panel should be visible
    When I search the workspace switcher for "/tmp"
    Then the workspace switcher should show 1 card
    And there should be no page errors

  Scenario: Mod+Shift+K opens palette on workspaces with search focused
    When I press the workspace switcher shortcut
    Then the workspace switcher panel should be visible
    And the workspace switcher search should be focused
    And there should be no page errors

  Scenario: Dock search-icon button opens the palette on workspaces
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

  Scenario: Selecting a workspace card closes the palette
    Given I run "echo dismiss-after-select"
    And I create a terminal
    When I click the workspace switcher toggle
    Then the workspace switcher panel should be visible
    When I click workspace switcher card 1
    Then the workspace switcher panel should not be visible
    And the active terminal should show "dismiss-after-select"
    And there should be no page errors

  Scenario: Repo facet narrows visible cards
    Given I create a terminal
    When I run "cd /tmp"
    And I hover the workspace switcher
    And I click workspace switcher repo "tmp"
    Then the workspace switcher panel should be visible
    And the workspace switcher should show 1 card
    And the workspace switcher should show only repo "tmp" cards
    And there should be no page errors

  Scenario: Selecting a workspace card switches the active terminal
    Given I run "echo first-workspace-card"
    And I create a terminal
    When I hover the workspace switcher
    And I click workspace switcher card 1
    Then the active terminal should show "first-workspace-card"
    And there should be no page errors

  Scenario: Arrow keys move the keyboard cursor between workspace cards
    # Two plain-shell terminals stack in the "No agent" column; the
    # cursor lands on card 1 by default and ArrowDown steps to card 2.
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

  Scenario: Enter on the keyboard-highlighted workspace activates it
    # The cursor lands on card 1 by default; Enter without prior arrow
    # navigation activates that card. Mirrors the click-card-1 path of
    # "Selecting a workspace card switches the active terminal" but
    # via Enter so we exercise the body's Enter handler explicitly.
    Given I run "echo selected-via-enter"
    And I create a terminal
    When I hover the workspace switcher
    Then the workspace switcher panel should be visible
    And workspace switcher card 1 should be highlighted
    When I press Enter
    Then the workspace switcher panel should not be visible
    And the active terminal should show "selected-via-enter"
    And there should be no page errors

  Scenario: Workspace columns enumerate every agent state bucket
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

  Scenario: Workspace switcher column titles carry the agent-state pip
    # The same shape-distinct StatePip the dock row and tile title lead
    # with now labels each agent-state column header (reused verbatim),
    # so the Working column title carries the spinning ring and the
    # Awaiting column a quiet dot — one agent-state vocabulary across
    # every surface. The No-agent column omits the pip.
    When I hover the workspace switcher
    Then the workspace switcher panel should be visible
    And the workspace switcher "working" column title should show a "working" state pip
    And the workspace switcher "awaiting" column title should show a "awaiting" state pip
    And there should be no page errors

  @mobile
  Scenario: Dock is not rendered on mobile
    Then the workspace switcher should not be visible
    And there should be no page errors
