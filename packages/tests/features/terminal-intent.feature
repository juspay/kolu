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

  # The annotation slot is the renderer's links-OFF inline variant: its own
  # click (open the intent editor) must win, so a markdown link can't survive as
  # a nested anchor. The link label still shows; only the <a> is gone. This is
  # the sole e2e coverage of the links:false path now that the renderer no
  # longer drops anchors itself — the sanitize pass owns the whole link policy.
  Scenario: Markdown link in intent renders inert in the links-off annotation slot
    When I click the active terminal annotation slot
    And I type "[docs](https://example.com)" into the intent editor
    And I save the intent
    Then the active terminal annotation slot should start with "docs"
    And the active terminal annotation slot should render no anchor
    And there should be no page errors

  Scenario: Intent survives a branch change in the terminal
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I run "rm -rf /tmp/kolu-intent-branch && git init /tmp/kolu-intent-branch && cd /tmp/kolu-intent-branch && git commit --allow-empty -m init"
    Then the header should show a branch name
    When I click the active terminal annotation slot
    And I type "🎯 fix the bug" into the intent editor
    And I save the intent
    Then the active terminal annotation slot should start with "🎯"
    When I run "git checkout -b new-branch"
    Then the header branch should contain "new-branch"
    But the active terminal annotation slot should start with "🎯"

  Scenario: Intent survives an external branch change (git watcher path)
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I run "rm -rf /tmp/kolu-intent-ext && git init /tmp/kolu-intent-ext && cd /tmp/kolu-intent-ext && git commit --allow-empty -m init"
    Then the header should show a branch name
    When I click the active terminal annotation slot
    And I type "🚀 ship it" into the intent editor
    And I save the intent
    Then the active terminal annotation slot should start with "🚀"
    When the branch is switched to "ext-test" in "/tmp/kolu-intent-ext"
    Then the header branch should contain "ext-test"
    But the active terminal annotation slot should start with "🚀"

  Scenario: Intent survives cd into a worktree on a new branch
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I run "rm -rf /tmp/kolu-intent-wt-main /tmp/kolu-intent-wt-feature && git init /tmp/kolu-intent-wt-main && cd /tmp/kolu-intent-wt-main && git commit --allow-empty -m init"
    Then the header should show a branch name
    When I click the active terminal annotation slot
    And I type "🔍 investigate" into the intent editor
    And I save the intent
    Then the active terminal annotation slot should start with "🔍"
    When I run "git worktree add -b feature-branch /tmp/kolu-intent-wt-feature"
    And I run "cd /tmp/kolu-intent-wt-feature"
    Then the header branch should contain "feature-branch"
    But the active terminal annotation slot should start with "🔍"

  Scenario: Edit intent via the command palette
    When I open the command palette
    And I select "Edit intent" in the palette
    Then the intent editor should be visible
    And the intent editor textarea should be focused
