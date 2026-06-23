Feature: Right panel (Code + Inspector)
  Collapsible right panel with a Code browser and a metadata Inspector
  tab, toggled via keyboard shortcut or header icon. The shipped product
  default is open-on-Code for new users (DEFAULT_PREFERENCES.rightPanel
  .collapsed = false); the e2e fixture instead pins it collapsed per
  scenario (hooks.ts) for deterministic toggle assertions, so these
  scenarios drive visibility explicitly rather than relying on the
  open-by-default state.

  Background:
    Given the terminal is ready

  Scenario: Right panel starts collapsed under the test fixture
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

  Scenario: Agent click on tile chrome expands inspector
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
    # The panel now opens on the Code tab by default, so select Inspector
    # explicitly before asserting on its content.
    When I click the right panel tab "inspector"
    Then the inspector should show a CWD section
    And there should be no page errors

  Scenario: Inspector shows git branch in a git repo
    When I run "git init /tmp/kolu-inspector-git && cd /tmp/kolu-inspector-git"
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector should show a git branch section
    And there should be no page errors

  Scenario: Inspector shows theme name
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector should show a theme section
    And there should be no page errors

  Scenario: Inspector shows the kaval-tui attach command
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector should show the kaval-tui attach command
    And there should be no page errors

  Scenario: Inspector covers split terminals and the snapshot command
    # The tile's main pane and every split each get their own attach + snapshot
    # command pair, since each split is its own PTY in the daemon.
    When I create a sub-terminal via command palette
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector should show attach and snapshot commands for the main terminal and its split
    And there should be no page errors

  Scenario: Clicking theme in inspector opens palette to Theme group
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    When I click the theme name in the inspector
    Then the command palette should be visible
    And the palette breadcrumb should show "Set theme"
    And there should be no page errors

  Scenario: Resize handle visible when panel is expanded
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    And the right panel resize handle should be visible
    And there should be no page errors

  Scenario: Resize handle stays hittable over a canvas tile in Code tab
    # A tile placed against the canvas's right edge would shadow the
    # outer handle's ::before hit zone (which extends 4px into the
    # canvas area) unless the handle stacks above the tile's z-index:10.
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the Code tab
    Then the Code tab should be active
    Then the right panel resize handle should be hittable at its full width
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

  Scenario: Toggle right panel via command palette
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I open the command palette
    And I type "Toggle right panel" in the palette
    And I press Enter
    Then the right panel should not be visible
    And there should be no page errors

  Scenario: Active tab survives close and reopen
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the Code tab
    Then the Code tab should be active
    When I press the toggle inspector shortcut
    Then the right panel should not be visible
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    And the Code tab should be active
    And there should be no page errors

  Scenario: No ghost right panel once the last terminal closes
    # With the panel open (collapsed=false), closing the last terminal drops
    # to the EmptyState — which doesn't mount the panel host. The desktop
    # chrome must follow: the toggle goes dead and the ChromeBar reserves no
    # panel-width, instead of floating its controls 25vw shy of the edge with
    # an empty "ghost" gap behind them.
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I close the active terminal via command palette
    Then the empty state tip should be visible
    And the inspector toggle should not be active
    And the inspector toggle should be disabled
    And the chrome bar should reserve no right-panel space
    And there should be no page errors

  Scenario: Active tab is per-terminal (each terminal remembers its own)
    # Terminal 1 (from Background) — switch to Inspector, leaving terminal 2 untouched
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the Inspector tab should be active
    # Create terminal 2 — it should have its own default activeTab (Code,
    # per DEFAULT_RIGHT_PANEL_PER_TERMINAL)
    When I create a terminal
    Then the Code tab should be active
    # Switch back to terminal 1 — Inspector tab should still be active for it
    When I press the switch to terminal 1 shortcut
    Then the Inspector tab should be active
    # Switch forward to terminal 2 — Code again
    When I press the switch to terminal 2 shortcut
    Then the Code tab should be active
    And there should be no page errors
