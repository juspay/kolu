Feature: Terminal intent
  Users can attach a freeform multiline-markdown annotation to each
  terminal. The annotation supplants the branch name in the title-bar
  annotation slot (and the equivalent slot in dock cards, workspace
  switcher cards, and sub-panel tabs); the full markdown body appears
  in the workspace switcher card. When no intent is set, the slot
  falls back to the branch name. Clicking the slot always opens the
  intent editor — there is no separate glyph chip.

  Background:
    Given the terminal is ready

  Scenario: Default state — annotation slot shows the placeholder (no intent, no git)
    Then the active terminal annotation slot should show the placeholder

  Scenario: Click annotation slot opens the intent editor
    When I click the active terminal annotation slot
    Then the intent editor should be visible
    And the intent editor textarea should be focused
    And there should be no page errors

  Scenario: Type intent + Save → annotation slot shows intent line-1
    When I click the active terminal annotation slot
    And I type "🏠 main\n\nRefactoring auth flow" into the intent editor
    And I save the intent
    Then the active terminal annotation slot should start with "🏠"
    And there should be no page errors

  Scenario: Intent persists across page refresh
    When I click the active terminal annotation slot
    And I type "🚀 ship" into the intent editor
    And I save the intent
    And I refresh the page
    Then the active terminal annotation slot should start with "🚀"

  Scenario: Clear via editor's Clear button → annotation slot back to empty
    When I click the active terminal annotation slot
    And I type "⚡ fast" into the intent editor
    And I save the intent
    Then the active terminal annotation slot should start with "⚡"
    When I click the active terminal annotation slot
    And I clear the intent
    Then the active terminal annotation slot should show the placeholder

  Scenario: Quick-row click inserts emoji at cursor
    When I click the active terminal annotation slot
    And I click the quick-row emoji "🎯"
    Then the intent editor textarea should contain "🎯"

  Scenario: Edit intent via the command palette
    When I open the command palette
    And I select "Edit intent" in the palette
    Then the intent editor should be visible
    And the intent editor textarea should be focused
