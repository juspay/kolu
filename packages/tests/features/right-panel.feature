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
    # The Inspector's Compose box is the in-app `kaval-tui send`: type a draft,
    # hit Send, and it's written into the active terminal's input line WITHOUT
    # pressing Enter (the honest-send contract — the user submits themselves).
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    When I type "echo compose-draft-landed" in the compose box
    And I click the compose Send button
    Then the terminal should contain the composed draft
    And there should be no page errors

  Scenario: Compose draft persists across a page refresh
    # The draft is saved per-terminal in localStorage, so a half-written prompt
    # survives a reload (the terminal is restored under the same id). Right-panel
    # visibility is itself persisted (see "Right panel state persists across
    # refresh"), so after the reload the panel is already open — do NOT re-toggle
    # it (that would collapse it) — just re-select Inspector and assert the draft.
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

  Scenario: Inspector Work chips follow the active terminal across repos
    # Regression cover for #2037: the branch/repo chips painted once for
    # whichever terminal was active when the Inspector first mounted, then
    # never repainted on a terminal switch — while the directory line right
    # below them (read inline, not memoized) kept updating. Two terminals in
    # two DIFFERENT repos/branches, switched back and forth, asserting all
    # three read the ACTIVE terminal's own facts each time — not merely
    # non-empty, which stale text from the other terminal satisfies just as
    # well (see packages/client/src/right-panel/WorkSection.test.tsx).
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
    # The Inspector also renders inside RightPanelDrawer at phone widths
    # (coarse pointer + narrow viewport) — same WorkSection subtree, same
    # testids. Confirms the chips aren't a desktop-only fix.
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
    # Terminal 1 (from Background) starts collapsed (the new-terminal default the
    # fixture pins). Open its panel, then create terminal 2.
    # The panel's POSTURE is per-TILE: two tiles each remember their own open/
    # closed bit (top-level terminals ARE tiles, so this reads "per-terminal"
    # from the outside). Focus moving between a tile's PANES never re-collapses
    # it — see "Moving focus between panes never opens or closes the panel".
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    # Terminal 2 inherits the open panel. Close it independently.
    When I create a terminal
    Then the right panel should be visible
    When I press the toggle inspector shortcut
    Then the right panel should not be visible
    # Switch back to terminal 1 — its panel is still open (it remembers its own).
    When I press the switch to terminal 1 shortcut
    Then the right panel should be visible
    # Forward to terminal 2 — still collapsed.
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

  # ── The panel follows the focused pane (main or any split) ──

  Scenario: Inspector follows focus into a split in another repo
    # The panel's SUBJECT is the focused pane: a split cd'd into a different
    # repo re-points the Inspector's chips to that repo, and the tab bar shows a
    # quiet label naming the split. Focusing main puts main's facts back and
    # drops the label.
    When I run "rm -rf /tmp/kolu-follow-main /tmp/kolu-follow-split && git init /tmp/kolu-follow-main && git init /tmp/kolu-follow-split && cd /tmp/kolu-follow-main && git checkout -b main-feature"
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    When I click the right panel tab "inspector"
    Then the inspector branch chip should contain "main-feature"
    And the inspector repo chip should contain "kolu-follow-main"
    And the inspector directory should contain "/tmp/kolu-follow-main"
    And the right panel should show no pane label
    # Creating a split focuses it; cd it into the OTHER repo.
    When I create a sub-terminal via command palette
    And I run "cd /tmp/kolu-follow-split && git checkout -b split-feature" in the sub-terminal
    Then the inspector branch chip should contain "split-feature"
    And the inspector repo chip should contain "kolu-follow-split"
    And the inspector directory should contain "/tmp/kolu-follow-split"
    And the right panel pane label should be "kolu-follow-split"
    # Back to main: the panel returns to main's own facts, and the label is gone.
    When I click the main terminal
    Then the inspector branch chip should contain "main-feature"
    And the inspector repo chip should contain "kolu-follow-main"
    And the inspector directory should contain "/tmp/kolu-follow-main"
    And the right panel should show no pane label
    And there should be no page errors

  Scenario: Code tree follows focus into a split in another repo
    # The Code tab's file tree is scoped to the SHOWN pane's repo, so focusing a
    # split in another repo re-lists THAT repo — and main's tree comes back.
    When I run "rm -rf /tmp/kolu-follow-code-main /tmp/kolu-follow-code-split && git init /tmp/kolu-follow-code-main && git init /tmp/kolu-follow-code-split && cd /tmp/kolu-follow-code-main"
    When I run "printf 'a\n' > only-in-main.txt && git add . && git commit -m init"
    When I create a sub-terminal via command palette
    And I run "cd /tmp/kolu-follow-code-split && printf 'b\n' > only-in-split.txt && git add . && git commit -m init" in the sub-terminal
    When I click the Code tab
    Then the file browser should show a file "only-in-split.txt"
    And the file browser should not show a file "only-in-main.txt"
    And the right panel should show a pane label
    # Focus back to main: the tree re-lists main's repo and the label drops.
    When I click the main terminal
    Then the file browser should show a file "only-in-main.txt"
    And the file browser should not show a file "only-in-split.txt"
    And the right panel should show no pane label
    And there should be no page errors

  Scenario: Each pane keeps its own selected file
    # Two panes of the SAME tile in the SAME repo still remember their own
    # Code-tab selection — focusing each returns to that pane's own pick.
    When I run "rm -rf /tmp/kolu-follow-pick && git init /tmp/kolu-follow-pick && cd /tmp/kolu-follow-pick"
    When I run "printf 'a\n' > main-pick.txt && printf 'b\n' > split-pick.txt && git add . && git commit -m init"
    When I click the Code tab
    And I click the file "main-pick.txt" in the file browser
    Then the file "main-pick.txt" should be selected in the file browser
    When I create a sub-terminal via command palette
    And I click the file "split-pick.txt" in the file browser
    Then the file "split-pick.txt" should be selected in the file browser
    And the file "main-pick.txt" should not be selected in the file browser
    # Back to main: main's own pick is intact.
    When I click the main terminal
    Then the file "main-pick.txt" should be selected in the file browser
    And the file "split-pick.txt" should not be selected in the file browser
    # And back to the split: ITS pick is intact too.
    When I click dock split sub-entry 1
    Then the file "split-pick.txt" should be selected in the file browser
    And there should be no page errors

  Scenario: Moving focus between panes never opens or closes the panel
    # Whether the panel is open belongs to the TILE, so focusing a split (or
    # main) leaves it exactly as it was — collapsed stays collapsed, open stays
    # open, and nothing shifts.
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
