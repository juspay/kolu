Feature: Command Palette
  Searchable command palette accessible via Cmd/Ctrl+K.

  Background:
    Given the terminal is ready

  Scenario: Open and close with keyboard
    When I open the command palette
    Then the command palette should be visible
    When I press Escape
    Then the command palette should not be visible
    And there should be no page errors

  Scenario: Toggle with Cmd/Ctrl+K
    When I open the command palette
    Then the command palette should be visible
    When I open the command palette
    Then the command palette should not be visible
    And there should be no page errors

  Scenario: Close by clicking outside
    When I open the command palette
    Then the command palette should be visible
    When I click outside the command palette
    Then the command palette should not be visible
    And there should be no page errors

  Scenario: Filter commands by typing
    When I open the app
    And I create a terminal
    And I create a terminal
    And I open the command palette
    And I select "Switch workspace" in the palette
    And I type "Workspace 1" in the palette
    Then the command palette should show 1 result
    And there should be no page errors

  Scenario: Switch workspace via command palette
    When I open the app
    And I create a terminal
    And I run "echo palette-first"
    And I create a terminal
    And I run "echo palette-second"
    And I open the command palette
    And I select "Switch workspace" in the palette
    # Workspace 1 is the Background terminal; Workspace 2 is the first explicitly created one
    And I type "Workspace 2" in the palette
    And I press Enter
    Then the command palette should not be visible
    And the active terminal should show "palette-first"
    And there should be no page errors

  Scenario: Arrow key navigation
    When I open the app
    And I create a terminal
    And I create a terminal
    And I open the command palette
    Then palette item 1 should be selected
    When I press ArrowDown
    Then palette item 2 should be selected
    When I press ArrowUp
    Then palette item 1 should be selected
    And there should be no page errors

  Scenario: Ctrl+N/P navigation
    When I open the app
    And I create a terminal
    And I create a terminal
    And I open the command palette
    Then palette item 1 should be selected
    When I press Control+n
    Then palette item 2 should be selected
    When I press Control+p
    Then palette item 1 should be selected
    And there should be no page errors

  Scenario: Create terminal via command palette
    Given I note the sidebar entry count
    When I open the command palette
    And I type "New workspace" in the palette
    Then the command palette should show 1 result
    When I press Enter
    Then the command palette should not be visible
    And the sidebar should have 1 more terminal entry
    And the terminal canvas should be visible
    And there should be no page errors

  Scenario: Tab cycles through results
    When I open the app
    And I create a terminal
    And I create a terminal
    And I open the command palette
    Then palette item 1 should be selected
    When I press Tab
    Then palette item 2 should be selected
    When I press Tab
    Then palette item 3 should be selected
    And there should be no page errors

  Scenario: Shift+Tab cycles backwards and wraps
    When I open the app
    And I create a terminal
    And I create a terminal
    And I open the command palette
    Then palette item 1 should be selected
    # Wrap to last
    When I press Shift+Tab
    Then the last palette item should be selected
    And there should be no page errors

  Scenario: Backspace drills out of nested group
    When I open the app
    And I create a terminal
    And I open the command palette
    And I select "Switch workspace" in the palette
    Then the palette breadcrumb should show "Switch workspace"
    When I press Backspace
    Then the palette breadcrumb should not be visible
    And there should be no page errors

  Scenario: Breadcrumb click navigates back to root
    When I open the app
    And I create a terminal
    And I open the command palette
    And I select "Switch workspace" in the palette
    Then the palette breadcrumb should show "Switch workspace"
    When I click breadcrumb "Commands" in the palette
    Then the palette breadcrumb should not be visible
    And there should be no page errors

  Scenario: Group commands show chevron indicator
    When I open the command palette
    Then palette item "Theme" should have a chevron
    And there should be no page errors

  Scenario: Keyboard shortcut hints shown on commands
    When I open the command palette
    Then palette item "New workspace" should show shortcut "T"
    And there should be no page errors

  Scenario: Shortcut hints shown in nested group
    When I open the app
    And I create a terminal
    And I open the command palette
    And I select "Switch workspace" in the palette
    Then palette item "Switch to workspace 1" should show shortcut "1"
    And there should be no page errors

  Scenario: Terminal retains focus after palette command
    When I open the app
    And I create a terminal
    And I open the command palette
    And I select "Theme" in the palette
    And I select "Dracula" in the palette
    Then the command palette should not be visible
    And the terminal should have keyboard focus
    And there should be no page errors

  Scenario: Open keyboard shortcuts via command palette
    When I open the command palette
    And I type "Keyboard" in the palette
    And I press Enter
    Then the shortcuts help should be visible
    And there should be no page errors

  Scenario: Cmd/Ctrl+K does not leak to terminal
    Given I intercept oRPC sendInput calls
    When I open the command palette
    And I press Escape
    Then no sendInput call should contain "k"
    And there should be no page errors
