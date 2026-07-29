Feature: Sub-terminals
  Per-terminal sub-panels toggled via command palette or Ctrl+`.

  Background:
    Given the terminal is ready

  Scenario: Create sub-terminal via command palette
    When I open the command palette
    And I type "Toggle terminal split" in the palette
    And I press Enter
    Then the sub-panel should be visible
    And the sub-terminal should have keyboard focus
    And the active tile should show sub-terminal count 1
    And there should be no page errors

  Scenario: Toggle sub-panel collapses and refocuses main terminal
    When I create a sub-terminal via command palette
    Then the sub-terminal should have keyboard focus
    When I toggle the sub-panel via command palette
    Then the sub-panel should not be visible
    And the main terminal should have keyboard focus
    And there should be no page errors

  Scenario: Re-expanding sub-panel focuses sub-terminal
    When I create a sub-terminal via command palette
    And I toggle the sub-panel via command palette
    Then the main terminal should have keyboard focus
    When I toggle the sub-panel via command palette
    Then the sub-terminal should have keyboard focus
    And there should be no page errors

  Scenario: Sub-terminal persists across collapse/expand
    When I create a sub-terminal via command palette
    And I run "echo sub-marker" in the sub-terminal
    And I toggle the sub-panel via command palette
    And I toggle the sub-panel via command palette
    Then the sub-terminal screen should contain "sub-marker"
    And there should be no page errors

  Scenario: Multiple sub-terminals with tab switching
    When I create a sub-terminal via command palette
    And I create another sub-terminal via command palette
    Then the sub-panel tab bar should have 2 tabs
    And the active tile should show sub-terminal count 2
    When I click sub-panel tab 1
    Then sub-panel tab 1 should be active
    And there should be no page errors

  # Same focus-path issue as the worktree+sub-terminal scenarios — workspace-switcher
   # selection followed by palette-driven sub-terminal create stalls. The
   # plain "create sub-terminal in the active terminal" scenarios above all
   # pass; only the "switch first, then split" sequence times out.
  @skip
  Scenario: Kill parent with splits shows confirmation and closes all
    When I open the app
    And I create a terminal
    And I select terminal 1 in the workspace switcher
    And I create a sub-terminal via command palette
    And I run "echo orphan-marker" in the sub-terminal
    And I click the tile close button for terminal 1
    Then the close confirmation should be visible
    When I confirm close all in the close confirmation
    Then the workspace switcher should have 1 terminal entry
    And the terminal canvas should be visible
    And there should be no page errors

  Scenario: Sub-terminal exit removes tab
    When I create a sub-terminal via command palette
    And I run "exit" in the sub-terminal
    Then the sub-panel should eventually collapse
    And the active tile should not show a sub-terminal count
    And there should be no page errors

  Scenario: Sub-terminals restore after page refresh
    When I create a sub-terminal via command palette
    And I run "echo refresh-test" in the sub-terminal
    When I refresh the page
    Then the sub-panel should be visible
    And the active tile should show sub-terminal count 1
    And there should be no page errors

  Scenario: Collapsed sub-panel re-expands via toggle
    When I create a sub-terminal via command palette
    And I toggle the sub-panel via command palette
    Then the sub-panel should not be visible
    When I toggle the sub-panel via command palette
    Then the sub-panel should be visible
    And there should be no page errors

  Scenario: Switching away and back remembers main terminal focus
    When I create a sub-terminal via command palette
    And I click the main terminal
    Then the main terminal should have keyboard focus
    When I create a terminal
    And I select workspace switcher entry 1
    Then the main terminal should have keyboard focus
    And there should be no page errors

  Scenario: Switching away and back remembers sub-terminal focus
    When I create a sub-terminal via command palette
    Then the sub-terminal should have keyboard focus
    When I create a terminal
    And I select workspace switcher entry 1
    Then the sub-terminal should have keyboard focus
    And there should be no page errors

  Scenario: Close sub-terminal via tab close button
    When I create a sub-terminal via command palette
    And I create another sub-terminal via command palette
    Then the sub-panel tab bar should have 2 tabs
    When I close sub-terminal tab 1
    Then the sub-panel tab bar should have 1 tab
    And the sub-terminal should have keyboard focus
    And the active tile should show sub-terminal count 1
    And there should be no page errors

  Scenario: Close last sub-terminal collapses panel
    When I create a sub-terminal via command palette
    When I close sub-terminal tab 1
    Then the sub-panel should eventually collapse
    And the active tile should not show a sub-terminal count
    And there should be no page errors

  Scenario: Resize handle visible when expanded
    When I create a sub-terminal via command palette
    Then the resize handle should be visible
    And there should be no page errors

  Scenario: Active pane is distinguished in a split
    When I create a sub-terminal via command palette
    Then the sub pane should be the active pane
    And the main pane should be receded
    # Fill both panes so the recede is visible on real output, then move focus
    # back and forth — the inactive pane (with content) recedes each way.
    When I run "ls -la /" in the sub-terminal
    And I run "ls -la /usr"
    Then the main pane should be the active pane
    And the sub pane should be receded
    When I run "echo back-in-sub" in the sub-terminal
    Then the sub pane should be the active pane
    And the main pane should be receded
    And there should be no page errors

  Scenario: Dock shows every split as a direct sub-entry and retires the count chip
    When I create a sub-terminal via command palette
    Then the dock should show 1 split sub-entry
    And every dock split sub-entry should be a direct child of its section
    And the dock split sub-entry should have no agent attention chrome
    And the dock should show no split count chip
    When I create another sub-terminal via command palette
    Then the dock should show 2 split sub-entries
    And every dock split sub-entry should be a direct child of its section
    And the dock should show no split count chip
    When I run "exit" in the sub-terminal
    Then the dock should show 1 split sub-entry
    And there should be no page errors

  Scenario: Typing into a dock split keeps its parent and sub-entry active
    When I create a sub-terminal via command palette
    And I click the main terminal
    And I click dock split sub-entry 1
    And I run "echo dock-split-focus" in the sub-terminal
    Then the parent dock row and focused split sub-entry should both be active
    And the sub-terminal screen should contain "dock-split-focus"
    And there should be no page errors

  Scenario: Dock section attention count agrees with the host tab for a split agent
    When I create a sub-terminal via command palette
    And a Claude Code session is mocked with state "thinking"
    Then the dock section active count should equal the active host tab
    And there should be no page errors
