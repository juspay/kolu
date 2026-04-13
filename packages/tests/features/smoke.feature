Feature: Smoke
  Basic checks that the app loads and responds.

  Scenario: Page loads with branding
    When I open the app
    Then the header should contain "kolu"

  Scenario: Health endpoint responds
    When I request "/api/health"
    Then the response should be "kolu"

  Scenario: Connection status shows open after terminal connects
    Given the terminal is ready
    Then the connection status should be "open"
