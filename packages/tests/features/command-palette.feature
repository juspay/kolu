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
    # "Set theme" is a flat-list drill-in group under Active Terminal —
    # typing in the palette narrows its children via the engine's
    # AND-token filter. Use a unique theme name to assert a single match.
    When I open the app
    And I create a terminal
    And I open the command palette
    And I select "Set theme" in the palette
    And I type "0x96f" in the palette
    Then the command palette should show 1 result
    And there should be no page errors

  Scenario: Switch terminal via command palette
    # Search workspaces renders the column-grid body (#912); selecting
    # a workspace card activates the terminal and closes the palette.
    # Workspace-switcher scenarios cover the recency-based card
    # ordering — here we just exercise the drill → click → close path.
    Given I run "echo palette-only-terminal"
    When I open the command palette
    And I select "Search workspaces" in the palette
    Then the workspace switcher panel should be visible
    When I click workspace switcher card 1
    Then the command palette should not be visible
    And the active terminal should show "palette-only-terminal"
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
    Given I note the workspace switcher entry count
    When I open the command palette
    And I select "New terminal" in the palette
    And I select "In current directory" in the palette
    Then the command palette should not be visible
    And the workspace switcher should have 1 more terminal entry
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
    And I select "Set theme" in the palette
    Then the palette breadcrumb should show "Set theme"
    When I press Backspace
    Then the palette breadcrumb should not be visible
    And there should be no page errors

  Scenario: Breadcrumb click navigates back to root
    When I open the app
    And I create a terminal
    And I open the command palette
    And I select "Set theme" in the palette
    Then the palette breadcrumb should show "Set theme"
    When I click breadcrumb "Commands" in the palette
    Then the palette breadcrumb should not be visible
    And there should be no page errors

  Scenario: Group commands show chevron indicator
    # "New terminal" is always at root regardless of focus state — it
    # makes a stable target for the chevron assertion.
    When I open the command palette
    Then palette item "New terminal" should have a chevron
    And there should be no page errors

  Scenario: Keyboard shortcut hints shown on commands
    When I open the command palette
    Then palette item "Keyboard shortcuts" should show shortcut "/"
    And there should be no page errors

  Scenario: Drilling into Search workspaces keeps focus on palette input
    # Selecting a body-group via Enter must leave focus in the palette
    # input so the user can immediately start typing to narrow the
    # workspace cards. Previously the open-effect's focus call only
    # ran on `open` changing — in-palette drill-in skipped it.
    Given I run "echo focus-after-drill"
    When I open the command palette
    And I select "Search workspaces" in the palette
    Then the workspace switcher panel should be visible
    And the palette search input should be focused
    And there should be no page errors

  Scenario: Drilling into Set theme keeps focus on palette input
    # Same focus contract as body-group drill-ins: the group-kind sub-mode
    # must leave focus in the palette input.
    When I open the app
    And I create a terminal
    And I open the command palette
    And I select "Set theme" in the palette
    Then the palette breadcrumb should show "Set theme"
    And the palette search input should be focused
    And there should be no page errors

  Scenario: Terminal retains focus after palette command
    When I open the app
    And I create a terminal
    And I open the command palette
    And I select "Set theme" in the palette
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

  Scenario: Ambient tip shown in palette footer on desktop
    When I open the command palette
    Then the palette tip should be visible
    And there should be no page errors

  @mobile
  Scenario: Tips suppressed on mobile
    When I open the command palette
    Then the command palette should be visible
    And no palette tip should be visible
    And there should be no page errors

  Scenario: Cmd/Ctrl+K does not leak to terminal
    Given I intercept oRPC sendInput calls
    When I open the command palette
    And I press Escape
    Then no sendInput call should contain "k"
    And there should be no page errors

  Scenario: Section headers group root commands
    # With a focused terminal, root items split into multiple sections —
    # Active Terminal, UI, Help — each rendered with a sticky uppercase
    # header. Drilling in or typing collapses headers. Debug lives as a
    # drill-in group inside Help, not as its own section header.
    When I open the app
    And I create a terminal
    And I open the command palette
    Then palette section header "Active Terminal" should be visible
    And palette section header "UI" should be visible
    And palette section header "Help" should be visible
    When I type "Set theme" in the palette
    Then no palette section header should be visible
    And there should be no page errors

  Scenario: Filtering shows section tags on matched rows
    # When the user types, sections collapse and each row carries a
    # small tag indicating which section it belongs to. "Set theme" only
    # appears with an active terminal, so create one first.
    When I open the app
    And I create a terminal
    And I open the command palette
    And I type "Set theme" in the palette
    Then palette item "Set theme" should show section tag "Active Terminal"
    And there should be no page errors
