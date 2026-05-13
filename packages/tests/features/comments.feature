Feature: Comment mode (inline composer + tray roll-up)
  The Code tab's comment-mode toggle reveals a read-only comments tray;
  authoring happens in a line-anchored inline popover that opens when
  the user clicks a line. The tray accumulates comments across files,
  highlights itself when non-empty, and lets the user jump to / edit /
  delete each entry. Copy-to-clipboard serializes the queue to Markdown
  and clears the tray.

  Background:
    Given the terminal is ready
    When I press the toggle inspector shortcut
    Then the right panel should be visible

  # ── Toggle + tray visibility ──

  Scenario: comments tray is hidden by default and revealed by the toggle
    Given a Code tab in "browse" mode showing file "a.ts" with content "alpha\nbeta\ngamma\n"
    Then the comments tray should be hidden
    When I enable comment mode
    Then the comments tray should be visible

  # ── End-to-end: select line, type in inline popover, copy, auto-discard ──
  #
  # The file viewer is mounted before enabling comment mode so Pierre's
  # VirtualizedFile measures its viewport at full height. The popover
  # anchors to the selected line's `[data-selected-line]` element — so
  # the click on line 1 must happen AFTER comment mode is on, otherwise
  # the resulting selection commit doesn't trigger popover open.

  Scenario: add a code comment via the bubble + inline popover, copy, tray clears
    Given a Code tab in "browse" mode showing file "a.ts" with content "alpha\nbeta\ngamma\n"
    When I open file "a.ts" in the Code tab
    And I enable comment mode
    And I click the line number 1 in the file content
    Then the inline add-comment bubble should be visible
    When I click the inline add-comment bubble
    Then the inline comment popover should be visible
    When I type "tighten this" into the inline comment composer
    And I press Enter to submit the inline comment
    Then the comments tray should list 1 comment
    When I click the Copy-to-clipboard button
    Then the clipboard text should contain "`a.ts:1`"
    And the clipboard text should contain "tighten this"
    And the comments tray should list 0 comments

  # ── Edit an existing comment via tray pencil ──

  Scenario: edit a queued comment from the tray pencil
    Given a Code tab in "browse" mode showing file "a.ts" with content "alpha\nbeta\ngamma\n"
    When I open file "a.ts" in the Code tab
    And I enable comment mode
    And I click the line number 1 in the file content
    Then the inline add-comment bubble should be visible
    When I click the inline add-comment bubble
    Then the inline comment popover should be visible
    When I type "first pass" into the inline comment composer
    And I press Enter to submit the inline comment
    Then the comments tray should list 1 comment
    When I click the edit pencil on comment 1
    Then the inline comment popover should be visible
    When I type "revised" into the inline comment composer
    And I press Enter to submit the inline comment
    Then the comments tray should list 1 comment
    When I click the Copy-to-clipboard button
    Then the clipboard text should contain "revised"

  # ── Persistence across reload ──
  #
  # The right panel and comment-mode toggle are persisted, so after
  # reload the panel restores itself and the toggle stays on. No second
  # "toggle inspector shortcut" — that would close the just-restored
  # panel.

  Scenario: queued comments survive a page reload
    Given a Code tab in "browse" mode showing file "a.ts" with content "alpha\nbeta\ngamma\n"
    When I open file "a.ts" in the Code tab
    And I enable comment mode
    And I click the line number 1 in the file content
    Then the inline add-comment bubble should be visible
    When I click the inline add-comment bubble
    Then the inline comment popover should be visible
    When I type "persisted note" into the inline comment composer
    And I press Enter to submit the inline comment
    Then the comments tray should list 1 comment
    When I reload the page and wait for ready
    Then the comments tray should be visible
    And the comments tray should list 1 comment

  # ── + bubble flips to 💬 once the line has a queued comment ──
  #
  # The "+" affordance and the "💬" indicator are mutually exclusive
  # at the same line: after submit, the line carries a comment, so
  # the For-loop renders "💬" and the "+" key check sees the existing
  # comment and returns null. Verifies the user's "after I add a
  # comment, still shows + instead of 💬" feedback.

  Scenario: + bubble becomes 💬 once the line carries a queued comment
    Given a Code tab in "browse" mode showing file "a.ts" with content "alpha\nbeta\ngamma\n"
    When I open file "a.ts" in the Code tab
    And I enable comment mode
    And I click the line number 1 in the file content
    Then the inline add-comment bubble should be visible
    When I click the inline add-comment bubble
    And I type "first note" into the inline comment composer
    And I press Enter to submit the inline comment
    Then the comments tray should list 1 comment
    And the inline add-comment bubble should not be visible
    And the inline existing-comment bubble should be visible

  # ── 💬 visible regardless of comment mode (discovery surface) ──

  Scenario: existing-comment bubble stays visible after disabling comment mode
    Given a Code tab in "browse" mode showing file "a.ts" with content "alpha\nbeta\ngamma\n"
    When I open file "a.ts" in the Code tab
    And I enable comment mode
    And I click the line number 1 in the file content
    Then the inline add-comment bubble should be visible
    When I click the inline add-comment bubble
    And I type "discoverable" into the inline comment composer
    And I press Enter to submit the inline comment
    Then the inline existing-comment bubble should be visible
    When I disable comment mode
    Then the inline existing-comment bubble should be visible
    And the inline add-comment bubble should not be visible

  # ── 💬 click opens edit popover, prefilled ──

  Scenario: clicking 💬 bubble opens the composer in edit mode
    Given a Code tab in "browse" mode showing file "a.ts" with content "alpha\nbeta\ngamma\n"
    When I open file "a.ts" in the Code tab
    And I enable comment mode
    And I click the line number 1 in the file content
    When I click the inline add-comment bubble
    And I type "to be revised" into the inline comment composer
    And I press Enter to submit the inline comment
    Then the inline existing-comment bubble should be visible
    When I click the inline existing-comment bubble
    Then the inline comment popover should be visible
    When I type "revised content" into the inline comment composer
    And I press Enter to submit the inline comment
    When I click the Copy-to-clipboard button
    Then the clipboard text should contain "revised content"

  # ── Bubbles disappear on right-panel tab switch (orphan guard) ──

  Scenario: bubbles disappear when switching to the inspector tab
    Given a Code tab in "browse" mode showing file "a.ts" with content "alpha\nbeta\ngamma\n"
    When I open file "a.ts" in the Code tab
    And I enable comment mode
    And I click the line number 1 in the file content
    Then the inline add-comment bubble should be visible
    When I click the right panel tab "inspector"
    Then the inline add-comment bubble should not be visible
    When I click the right panel tab "code"
    Then the inline add-comment bubble should be visible

  # ── Bubbles in diff modes (local + branch) ─────────────────────
  #
  # Browse, local, and branch share the same wiring: CodeMenuFrame
  # receives `initialSelectedLines={selectedRange()}`, Pierre's FileView
  # AND FileDiff both honor `selectedLines` (via `setSelectedLines`),
  # so the popover anchor (`[data-selected-line]`) and the bubble
  # anchor (`[data-line="N"]`) work uniformly. These outlines lock that
  # in — adding "browse" to the Examples row would duplicate earlier
  # coverage so it's omitted.

  Scenario Outline: + bubble flow works in diff mode [<mode>]
    Given a Code tab in "<mode>" mode showing files:
      | path     | content |
      | a.ts     | a       |
      | b.ts     | b       |
    When I click the changed file "a.ts" in the Code tab
    Then the Code tab should render a diff view
    When I enable comment mode
    And I click the line number 1 in the diff view
    Then the inline add-comment bubble should be visible
    When I click the inline add-comment bubble
    Then the inline comment popover should be visible
    When I type "diff-mode note" into the inline comment composer
    And I press Enter to submit the inline comment
    Then the comments tray should list 1 comment
    And the inline add-comment bubble should not be visible
    And the inline existing-comment bubble should be visible

    Examples:
      | mode   |
      | local  |
      | branch |

  Scenario Outline: 💬 bubble click opens edit popover in diff mode [<mode>]
    Given a Code tab in "<mode>" mode showing files:
      | path     | content |
      | a.ts     | a       |
      | b.ts     | b       |
    When I click the changed file "a.ts" in the Code tab
    Then the Code tab should render a diff view
    When I enable comment mode
    And I click the line number 1 in the diff view
    And I click the inline add-comment bubble
    And I type "first" into the inline comment composer
    And I press Enter to submit the inline comment
    Then the inline existing-comment bubble should be visible
    When I click the inline existing-comment bubble
    Then the inline comment popover should be visible
    When I type "edited" into the inline comment composer
    And I press Enter to submit the inline comment
    When I click the Copy-to-clipboard button
    Then the clipboard text should contain "edited"

    Examples:
      | mode   |
      | local  |
      | branch |

  # ── Tray edit stays in current mode (no force-to-browse) ──
  #
  # Previously, clicking the tray pencil while in a diff view forced a
  # flip to "browse". That was a bandaid for the older FileDiff wrapper
  # that didn't expose `setSelectedLines`. With the wrapper fixed, the
  # pencil should stay in whatever mode the user picked.

  Scenario: tray pencil edit preserves the current diff mode
    Given a Code tab in "local" mode showing files:
      | path | content |
      | a.ts | a       |
    When I click the changed file "a.ts" in the Code tab
    Then the Code tab should render a diff view
    When I enable comment mode
    And I click the line number 1 in the diff view
    And I click the inline add-comment bubble
    And I type "first" into the inline comment composer
    And I press Enter to submit the inline comment
    When I click the edit pencil on comment 1
    Then the inline comment popover should be visible
    And the Code tab should render a diff view
