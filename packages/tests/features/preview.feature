Feature: Preview tab (PRT3)
  The forwarded page opens inside kolu — a third right-panel tab. Plain chip
  click goes through the door into the iframe; modifier-click keeps a browser
  tab. Frame content is asserted through the iframe handle, not the URL bar.

  Background:
    Given the terminal is ready

  Scenario: Preview tab is available in the right panel
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "preview"
    Then the preview empty state should be visible
    And there should be no page errors

  Scenario: Preview iframe shows the listener through the door
    When I start a listener on port 8130 bound to loopback only
    And I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector should show port 8130 as needing a forward
    When I click to preview port 8130
    Then the preview iframe should load the listener's page
    And there should be no page errors
