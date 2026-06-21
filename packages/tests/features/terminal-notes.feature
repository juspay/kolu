Feature: Terminal notes
  Users can attach freeform multiline-markdown notes to each terminal,
  edited in a dedicated right-panel Notes tab (Edit / Preview sub-views,
  autosaved as you type). Line 1 of the notes supplants the branch name in
  the title-bar annotation slot (and the equivalent slot in dock cards,
  workspace switcher cards, and sub-panel tabs); once the notes carry a
  body past line 1, a note icon lights up beside the slot. When no notes are
  set, the slot falls back to the branch name. Clicking the slot always
  reveals the Notes tab — there is no separate glyph chip.

  Background:
    Given the terminal is ready

  Scenario: Default state — annotation slot shows the placeholder (no notes, no git)
    Then the active terminal annotation slot should show the placeholder

  Scenario: Click annotation slot reveals the Notes tab editor
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
    And the active terminal annotation slot should start with "🚀"
    And I refresh the page
    Then the active terminal annotation slot should start with "🚀"

  Scenario: Emptying the notes → annotation slot back to the placeholder
    When I click the active terminal annotation slot
    And I type "⚡ fast" into the notes editor
    And the active terminal annotation slot should start with "⚡"
    And I clear the notes
    Then the active terminal annotation slot should show the placeholder

  Scenario: Quick-row click inserts emoji at cursor
    When I click the active terminal annotation slot
    And I click the quick-row emoji "🎯"
    Then the notes editor textarea should contain "🎯"

  Scenario: Preview sub-view renders the notes markdown
    When I click the active terminal annotation slot
    And I type "# Heading\n\nbody text" into the notes editor
    And I switch the notes view to "preview"
    Then the notes preview should contain "Heading"

  # A body past line 1 lights the note icon beside the slot — line 1 already
  # rides the chip, so the icon signals "there's more than the chip shows".
  Scenario: Note icon appears with a body and reveals the Notes tab
    When I click the active terminal annotation slot
    And I type "🐛 fix\n\nrepro: open two tabs" into the notes editor
    And the active terminal annotation slot should start with "🐛"
    Then the terminal note icon should be visible
    When I switch the notes view to "preview"
    And I click the terminal note icon
    Then the notes editor should be visible

  # The annotation slot is the renderer's links-OFF inline variant: its own
  # click (reveal the Notes tab) must win, so a markdown link can't survive as
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
