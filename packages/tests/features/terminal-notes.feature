Feature: Terminal notes
  Users can attach a freeform multiline-markdown notes scratchpad to each
  terminal. The first line supplants the branch name in the title-bar
  annotation slot (and the equivalent slot in dock cards, workspace
  switcher cards, and sub-panel tabs); the full markdown body appears
  in the workspace switcher card. When no notes are set, the slot
  falls back to the branch name. Clicking the slot opens the Notes tab
  in the right panel — there is no separate glyph chip for line 1
  (a body-gated note icon appears only when there's prose past line 1).

  Background:
    Given the terminal is ready

  Scenario: Default state — annotation slot shows the placeholder (no notes, no git)
    Then the active terminal annotation slot should show the placeholder

  Scenario: Click annotation slot opens the Notes tab
    When I click the active terminal annotation slot
    Then the notes editor should be visible
    And the notes editor textarea should be focused
    And there should be no page errors

  Scenario: Type notes → annotation slot shows notes line-1 (autosaved)
    When I click the active terminal annotation slot
    And I type "🏠 main\n\nRefactoring auth flow" into the notes editor
    Then the active terminal annotation slot should start with "🏠"
    And there should be no page errors

  Scenario: Notes persist across page refresh
    When I click the active terminal annotation slot
    And I type "🚀 ship" into the notes editor
    Then the active terminal annotation slot should start with "🚀"
    When I refresh the page
    Then the active terminal annotation slot should start with "🚀"

  Scenario: Clear via editor's Clear button → annotation slot back to empty
    When I click the active terminal annotation slot
    And I type "⚡ fast" into the notes editor
    Then the active terminal annotation slot should start with "⚡"
    When I click the active terminal annotation slot
    And I clear the notes
    Then the active terminal annotation slot should show the placeholder

  Scenario: Quick-row click inserts emoji at cursor
    When I click the active terminal annotation slot
    And I click the quick-row emoji "🎯"
    Then the notes editor textarea should contain "🎯"

  # The annotation slot is the renderer's links-OFF inline variant: its own
  # click (open the Notes tab) must win, so a markdown link can't survive as
  # a nested anchor. The link label still shows; only the <a> is gone. This is
  # the sole e2e coverage of the links:false path now that the renderer no
  # longer drops anchors itself — the sanitize pass owns the whole link policy.
  Scenario: Markdown link in notes renders inert in the links-off annotation slot
    When I click the active terminal annotation slot
    And I type "[docs](https://example.com)" into the notes editor
    Then the active terminal annotation slot should start with "docs"
    And the active terminal annotation slot should render no anchor
    And there should be no page errors

  Scenario: Edit notes via the command palette
    When I open the command palette
    And I select "Edit notes" in the palette
    Then the notes editor should be visible
    And the notes editor textarea should be focused
