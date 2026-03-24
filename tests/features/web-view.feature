Feature: Web View
  Built-in web view panel for inline URL preview.

  Background:
    Given the terminal is ready

  Scenario: Toggle web view via keyboard shortcut
    When I press the toggle web view shortcut
    Then the web view panel should be visible
    When I press the toggle web view shortcut
    Then the web view panel should not be visible
    And there should be no page errors

  Scenario: Close web view via close button
    When I press the toggle web view shortcut
    Then the web view panel should be visible
    When I click the web view close button
    Then the web view panel should not be visible
    And there should be no page errors

  Scenario: Navigate to URL via URL bar
    When I press the toggle web view shortcut
    And I enter "about:blank" in the web view URL bar
    Then the web view iframe should have src "about:blank"
    And there should be no page errors

  Scenario: Refresh button exists and is clickable
    When I press the toggle web view shortcut
    And I enter "about:blank" in the web view URL bar
    And I click the web view refresh button
    Then the web view iframe should have src "about:blank"
    And there should be no page errors

  Scenario: Web view state persists across page refresh
    When I press the toggle web view shortcut
    And I enter "about:blank" in the web view URL bar
    And I refresh the page
    Then the web view panel should be visible
    And the web view URL bar should contain "about:blank"
    And there should be no page errors

  Scenario: Empty state shown when no URL is set
    When I press the toggle web view shortcut
    Then the web view empty state should be visible
    And there should be no page errors

  Scenario: Terminal re-fits when web view opens and closes
    Given I note the canvas dimensions
    When I press the toggle web view shortcut
    Then the canvas should be narrower than before
    When I press the toggle web view shortcut
    Then the canvas should return to original width
    And there should be no page errors

  Scenario: Terminal re-fits after resize handle drag
    When I press the toggle web view shortcut
    And I note the canvas dimensions
    And I drag the resize handle 100 pixels to the right
    Then the canvas should be wider than before
    And there should be no page errors

  Scenario: Independent per-terminal web view state
    # Create two terminals explicitly so we can switch between them by index
    When I create a terminal
    # Terminal 1 — open web view with URL A
    When I press the toggle web view shortcut
    And I enter "about:blank" in the web view URL bar
    Then the web view panel should be visible
    # Create terminal 2
    When I create a terminal
    Then the web view panel should not be visible
    # Open web view on terminal 2 with a different URL
    When I press the toggle web view shortcut
    And I enter "about:srcdoc" in the web view URL bar
    Then the web view URL bar should contain "about:srcdoc"
    # Switch back to terminal 1 — should show terminal 1's URL
    When I select terminal 1 in the sidebar
    Then the web view panel should be visible
    And the web view URL bar should contain "about:blank"
    And there should be no page errors

  # Ctrl+Click on terminal URLs is handled by xterm's WebLinksAddon with a custom
  # handler. Testing this reliably in headless mode is impractical because link
  # detection requires precise hover coordinates on the WebGL canvas. The handler
  # itself is trivial (calls openUrl), so we verify the openUrl path indirectly
  # via the URL bar navigation test above.
