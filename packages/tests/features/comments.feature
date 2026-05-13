Feature: Comment mode (annotate files, copy to clipboard)
  The Code tab's comment-mode toggle reveals a comments tray. Selecting
  lines in any file viewer lets the user attach a free-text note, which
  accumulates across files. "Copy to clipboard" serializes the queue to a
  versioned text block and automatically clears the tray, so the next
  review session starts empty. The queue is persisted per-worktree via
  localStorage so an accidental reload doesn't lose in-progress notes.

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

  # ── End-to-end: select, compose, add, copy, auto-discard ──
  #
  # The file viewer is mounted before enabling comment mode so Pierre's
  # VirtualizedFile measures its viewport at full height. Toggling the
  # tray after a file is rendered shrinks the viewport but Pierre keeps
  # already-rendered rows in the DOM — the line-2 gutter selector
  # resolves regardless.

  Scenario: add a code comment, copy to clipboard, tray clears
    Given a Code tab in "browse" mode showing file "a.ts" with content "alpha\nbeta\ngamma\n"
    When I open file "a.ts" in the Code tab
    And I enable comment mode
    And I click the line number 1 in the file content
    And I type "tighten this" into the comment composer
    And I click the Add-comment button
    Then the comments tray should list 1 comment
    When I click the Copy-to-clipboard button
    Then the clipboard text should match the kolu-comments-v1 envelope
    And the clipboard text should contain "`a.ts:L1`"
    And the clipboard text should contain "tighten this"
    And the comments tray should list 0 comments

  # ── Persistence across reload (phase 4) ──
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
    And I type "persisted note" into the comment composer
    And I click the Add-comment button
    Then the comments tray should list 1 comment
    When I reload the page and wait for ready
    Then the comments tray should be visible
    And the comments tray should list 1 comment
