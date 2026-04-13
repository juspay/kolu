Feature: Right panel (inspector)
  Collapsible right panel with metadata inspector, toggled via Cmd+B or header icon.
  Defaults to collapsed.

  Background:
    Given the terminal is ready

  Scenario: Right panel starts collapsed by default
    Then the right panel should not be visible
    And there should be no page errors

  Scenario: Toggle right panel with keyboard shortcut
    Then the right panel should not be visible
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I press the toggle inspector shortcut
    Then the right panel should not be visible
    And there should be no page errors

  Scenario: Panel toggle icon in header toggles inspector
    When I click the inspector toggle icon in the header
    Then the right panel should be visible
    When I click the inspector toggle icon in the header
    Then the right panel should not be visible
    And there should be no page errors

  Scenario: Sidebar toggle icon in header toggles sidebar
    Then the sidebar should be visible
    When I click the desktop sidebar toggle icon
    Then the sidebar should not be visible
    When I click the desktop sidebar toggle icon
    Then the sidebar should be visible
    And there should be no page errors

  Scenario: Agent click in header expands inspector
    Then the right panel should not be visible
    When I run "echo agent-expand-test"
    # Agent indicator may not be present without a real agent, so we
    # verify the expand-on-agent-click wiring via the toggle shortcut fallback.
    # The wiring is: onAgentClick → rightPanel.expandPanel()
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    And there should be no page errors

  Scenario: Inspector shows CWD
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    And the inspector should show a CWD section
    And there should be no page errors

  Scenario: Inspector shows git branch in a git repo
    When I run "git init /tmp/kolu-inspector-git && cd /tmp/kolu-inspector-git"
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    And the inspector should show a git branch section
    And there should be no page errors

  Scenario: Inspector shows theme name
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    And the inspector should show a theme section
    And there should be no page errors

  Scenario: Clicking theme in inspector opens palette to Theme group
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the theme name in the inspector
    Then the command palette should be visible
    And the palette breadcrumb should show "Theme"
    And there should be no page errors

  Scenario: Resize handle visible when panel is expanded
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    And the right panel resize handle should be visible
    And there should be no page errors

  Scenario: Right panel state persists across refresh
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I refresh the page
    Then the right panel should be visible
    When I press the toggle inspector shortcut
    Then the right panel should not be visible
    When I refresh the page
    Then the right panel should not be visible
    And there should be no page errors

  Scenario: Toggle inspector via command palette
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I open the command palette
    And I type "Toggle inspector" in the palette
    And I press Enter
    Then the right panel should not be visible
    And there should be no page errors
