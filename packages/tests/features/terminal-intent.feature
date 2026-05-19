Feature: Terminal intent
  Users can attach a freeform multiline-markdown annotation to each
  terminal. The first line doubles as a glanceable tag chip in the
  title bar, dock cards, dock rail (painted on the swatch), and
  sub-panel tabs; the full markdown body appears in the workspace
  switcher card. The same single editor opens whether the user clicks
  the chip or runs the palette command.

  Background:
    Given the terminal is ready

  Scenario: Default state — chip shows placeholder, no body
    Then the terminal intent chip should show the placeholder

  Scenario: Click chip opens the intent editor
    When I click the terminal intent chip
    Then the intent editor should be visible
    And the intent editor textarea should be focused
    And there should be no page errors

  Scenario: Type intent + Save → chip shows line-1 glyph
    When I click the terminal intent chip
    And I type "🏠 main\n\nRefactoring auth flow" into the intent editor
    And I save the intent
    Then the active tile should show the intent tag "🏠"
    And there should be no page errors

  Scenario: Intent persists across page refresh
    When I click the terminal intent chip
    And I type "🚀 ship" into the intent editor
    And I save the intent
    And I refresh the page
    Then the active tile should show the intent tag "🚀"

  Scenario: Clear via editor's Clear button → chip back to placeholder
    When I click the terminal intent chip
    And I type "⚡ fast" into the intent editor
    And I save the intent
    Then the active tile should show the intent tag "⚡"
    When I click the terminal intent chip
    And I clear the intent
    Then the terminal intent chip should show the placeholder

  Scenario: Quick-row click inserts emoji at cursor
    When I click the terminal intent chip
    And I click the quick-row emoji "🎩"
    Then the intent editor textarea should contain "🎩"

  Scenario: Edit intent via the command palette
    When I open the command palette
    And I select "Edit intent" in the palette
    Then the intent editor should be visible
    And the intent editor textarea should be focused
