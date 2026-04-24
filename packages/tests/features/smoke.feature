Feature: Smoke
  Basic checks that the app loads and responds.

  Scenario: Root route redirects to the workspace
    When I open the app
    Then the current URL path should be "/workspace"
    And the canvas watermark should contain "kolu"

  Scenario: Board route shows the placeholder page
    When I open "/board"
    Then the page should contain "Board coming soon"
    And the page should have a link to "/workspace"

  Scenario: Health endpoint responds
    When I request "/api/health"
    Then the response should be "kolu"

  Scenario: Connection status shows open after terminal connects
    Given the terminal is ready
    Then the connection status should be "open"
