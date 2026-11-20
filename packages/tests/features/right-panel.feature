Feature: Right panel (Code + Inspector)
  Collapsible right panel with a Code browser and a metadata Inspector
  tab, toggled via keyboard shortcut or header icon. WHETHER the panel is open
  belongs to the tile; WHAT it shows follows the focused pane (main or any
  split, at any nesting depth) — each pane remembers its own tab, code mode,
  selected file, and back/forward history, while the open/closed posture stays
  per-tile so moving focus between a tile's panes never opens or closes it.
  Browser-created terminals inherit the active terminal's visibility; the first
  terminal uses the new-terminal preference.
  The test fixture starts the first terminal collapsed.

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
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    And there should be no page errors

  Scenario: Inspector shows CWD
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector should show a CWD section
    And there should be no page errors

  Scenario: Inspector shows git branch in a git repo
    When I run "rm -rf /tmp/kolu-inspector-git && git init /tmp/kolu-inspector-git && cd /tmp/kolu-inspector-git"
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

  Scenario: Inspector shows the send command and agent-driving guidance
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector should show the send command and agent-driving guidance
    And there should be no page errors

  Scenario: Compose box inserts a drafted prompt into the terminal
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    When I type "echo compose-draft-landed" in the compose box
    And I click the compose Send button
    Then the terminal should contain the composed draft
    And there should be no page errors

  Scenario: Compose draft persists across a page refresh
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    When I type "draft that survives a reload" in the compose box
    When I refresh the page
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the compose box should contain "draft that survives a reload"
    And there should be no page errors

  Scenario: Inspector covers split terminals and the snapshot command
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
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I close the active terminal via command palette
    Then the empty state tip should be visible
    And the inspector toggle should not be active
    And the inspector toggle should be disabled
    And the chrome bar should reserve no right-panel space
    And there should be no page errors

  Scenario: Active tab is per-terminal (each terminal remembers its own)
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the Inspector tab should be active
    When I create a terminal
    Then the Code tab should be active
    When I press the switch to terminal 1 shortcut
    Then the Inspector tab should be active
    When I press the switch to terminal 2 shortcut
    Then the Code tab should be active
    And there should be no page errors

  Scenario: Inspector Work chips follow the active terminal across repos
    When I run "rm -rf /tmp/kolu-inspector-alpha && git init /tmp/kolu-inspector-alpha && cd /tmp/kolu-inspector-alpha && git checkout -b alpha-feature"
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector branch chip should contain "alpha-feature"
    And the inspector repo chip should contain "kolu-inspector-alpha"
    And the inspector directory should contain "/tmp/kolu-inspector-alpha"
    When I create a terminal
    And I run "rm -rf /tmp/kolu-inspector-beta && git init /tmp/kolu-inspector-beta && cd /tmp/kolu-inspector-beta && git checkout -b beta-feature"
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector branch chip should contain "beta-feature"
    And the inspector repo chip should contain "kolu-inspector-beta"
    And the inspector directory should contain "/tmp/kolu-inspector-beta"
    When I press the switch to terminal 1 shortcut
    Then the inspector branch chip should contain "alpha-feature"
    And the inspector repo chip should contain "kolu-inspector-alpha"
    And the inspector directory should contain "/tmp/kolu-inspector-alpha"
    When I press the switch to terminal 2 shortcut
    Then the inspector branch chip should contain "beta-feature"
    And the inspector repo chip should contain "kolu-inspector-beta"
    And the inspector directory should contain "/tmp/kolu-inspector-beta"
    And there should be no page errors

  @mobile
  Scenario: Inspector Work chips read correctly in the mobile drawer
    When I run "rm -rf /tmp/kolu-inspector-mobile && git init /tmp/kolu-inspector-mobile && cd /tmp/kolu-inspector-mobile && git checkout -b mobile-feature"
    When I tap the mobile pull handle
    And I tap the mobile inspector toggle
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector branch chip should contain "mobile-feature"
    And the inspector repo chip should contain "kolu-inspector-mobile"
    And the inspector directory should contain "/tmp/kolu-inspector-mobile"
    And there should be no page errors

  Scenario: Collapsed state is per-terminal (the panel follows the terminal)
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I create a terminal
    Then the right panel should be visible
    When I press the toggle inspector shortcut
    Then the right panel should not be visible
    When I press the switch to terminal 1 shortcut
    Then the right panel should be visible
    When I press the switch to terminal 2 shortcut
    Then the right panel should not be visible
    And there should be no page errors

  Scenario: New terminals inherit the previous terminal's panel visibility
    Then the right panel should not be visible
    When I create a terminal with keyboard shortcut
    Then there should be 2 canvas tiles
    And I wait for all terminals to settle
    Then the right panel should not be visible
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I create a terminal with keyboard shortcut
    Then there should be 3 canvas tiles
    And I wait for all terminals to settle
    Then the right panel should be visible
    When I refresh the page
    Then the right panel should be visible
    And there should be no page errors

  Scenario: Inspector follows focus into a split in another repo
    When I run "rm -rf /tmp/kolu-follow-main /tmp/kolu-follow-split && git init /tmp/kolu-follow-main && git init /tmp/kolu-follow-split && cd /tmp/kolu-follow-main && git checkout -b main-feature"
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector branch chip should contain "main-feature"
    And the inspector repo chip should contain "kolu-follow-main"
    And the inspector directory should contain "/tmp/kolu-follow-main"
    And the right panel should show no pane label
    When I create a sub-terminal via command palette
    And I run "cd /tmp/kolu-follow-split && git checkout -b split-feature" in the sub-terminal
    Then the inspector branch chip should contain "split-feature"
    And the inspector repo chip should contain "kolu-follow-split"
    And the inspector directory should contain "/tmp/kolu-follow-split"
    And the right panel pane label should be "kolu-follow-split"
    When I click the main terminal
    Then the inspector branch chip should contain "main-feature"
    And the inspector repo chip should contain "kolu-follow-main"
    And the inspector directory should contain "/tmp/kolu-follow-main"
    And the right panel should show no pane label
    And there should be no page errors

  Scenario: Code tree follows focus into a split in another repo
    When I run "rm -rf /tmp/kolu-follow-code-main /tmp/kolu-follow-code-split && git init /tmp/kolu-follow-code-main && git init /tmp/kolu-follow-code-split && cd /tmp/kolu-follow-code-main"
    When I run "printf 'a\n' > only-in-main.txt && git add . && git commit -m init"
    When I create a sub-terminal via command palette
    And I run "cd /tmp/kolu-follow-code-split && printf 'b\n' > only-in-split.txt && git add . && git commit -m init" in the sub-terminal
    When I click the Code tab
    Then the file browser should show a file "only-in-split.txt"
    And the file browser should not show a file "only-in-main.txt"
    And the right panel should show a pane label
    And the right panel directory should contain "/tmp/kolu-follow-code-split"
    When I click the main terminal
    Then the file browser should show a file "only-in-main.txt"
    And the file browser should not show a file "only-in-split.txt"
    And the right panel should show no pane label
    And the right panel directory should contain "/tmp/kolu-follow-code-main"
    And there should be no page errors

  Scenario: Each pane keeps its own selected file
    When I run "rm -rf /tmp/kolu-follow-pick && git init /tmp/kolu-follow-pick && cd /tmp/kolu-follow-pick"
    When I run "printf 'a\n' > main-pick.txt && printf 'b\n' > split-pick.txt && git add . && git commit -m init"
    When I click the Code tab
    And I click the file "main-pick.txt" in the file browser
    Then the file "main-pick.txt" should be selected in the file browser
    When I create a sub-terminal via command palette
    And I click the file "split-pick.txt" in the file browser
    Then the file "split-pick.txt" should be selected in the file browser
    And the file "main-pick.txt" should not be selected in the file browser
    When I click the main terminal
    Then the file "main-pick.txt" should be selected in the file browser
    And the file "split-pick.txt" should not be selected in the file browser
    When I click dock split sub-entry 1
    Then the file "split-pick.txt" should be selected in the file browser
    And there should be no page errors

  Scenario: Moving focus between panes never opens or closes the panel
    When I create a sub-terminal via command palette
    Then the right panel should not be visible
    When I click the main terminal
    Then the right panel should not be visible
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click dock split sub-entry 1
    Then the right panel should be visible
    When I click the main terminal
    Then the right panel should be visible
    And there should be no page errors

  Scenario: A split created outside the browser inherits the panel's tab
    When I create a terminal
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the Inspector tab should be active
    When I split terminal 1
    And I click dock split sub-entry 1
    Then the Inspector tab should be active
    And there should be no page errors

  Scenario: A pane switch inside one repo leaves the Code tree alone
    When I run "rm -rf /tmp/kolu-pane-switch && git init /tmp/kolu-pane-switch && cd /tmp/kolu-pane-switch"
    When I run "mkdir -p src && printf 'a\n' > src/app.ts && printf 'b\n' > src/other.ts && git add . && git commit -m init"
    When I click the Code tab
    And I click the Code tab mode "browse"
    And I click the directory "src" in the file browser
    And I type "app" into the Code tab filter
    Then the Code tab should show file "src/app.ts"
    And the Code tab filter input should contain "app"
    When I create a sub-terminal via command palette
    And the file browser should show a file "src/app.ts"
    And I click the main terminal
    Then the file browser should show a file "src/app.ts"
    When I tag the file tree
    And I click dock split sub-entry 1
    Then the file tree should still be the one I tagged
    And the Code tab filter input should contain "app"
    And the directory "src" should be expanded in the file browser
    When I click the main terminal
    Then the file tree should still be the one I tagged
    And the Code tab filter input should contain "app"
    And the directory "src" should be expanded in the file browser
    And there should be no page errors
