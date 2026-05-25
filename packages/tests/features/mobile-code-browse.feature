Feature: Mobile code browse — unified right-panel drawer
  On mobile the right panel hosts itself as a bottom drawer (Corvu
  `Drawer side="bottom"`) instead of the desktop's side-resizable
  split — same `RightPanel` → `CodeTab` subtree inside, same
  `useRightPanel` selection slot, same `BrowseFileDispatcher`
  text/iframe dispatch. The chrome sheet's inspector toggle opens
  the drawer; a `path:line` link in terminal output opens the
  drawer on the requested file via the existing `openInCodeTab`
  front door (same call the desktop file-ref-link.feature
  exercises) — no mobile-specific code path.

  Background:
    Given the terminal is ready

  @mobile
  Scenario: Inspector toggle in the chrome sheet opens the right panel as a drawer
    When I tap the mobile pull handle
    And I tap the mobile inspector toggle
    Then the right panel should be visible
    And there should be no page errors

  @mobile
  Scenario: Clicking a text file in the drawer shows its content
    When I run "rm -rf /tmp/kolu-mobile-text && git init /tmp/kolu-mobile-text && cd /tmp/kolu-mobile-text"
    And I run "echo hello > readme.txt"
    And I run "git add readme.txt && git commit -m init"
    And I tap the mobile pull handle
    And I tap the mobile inspector toggle
    And I click the Code tab mode "browse"
    And I click the changed file "readme.txt" in the Code tab
    Then the file content should contain "hello"
    And there should be no page errors

  @mobile
  Scenario: Clicking an HTML file shows the iframe preview
    When I run "rm -rf /tmp/kolu-mobile-html && git init /tmp/kolu-mobile-html && cd /tmp/kolu-mobile-html"
    And I run "printf '<h1>hi</h1>' > index.html"
    And I run "git add index.html && git commit -m init"
    And I tap the mobile pull handle
    And I tap the mobile inspector toggle
    And I click the Code tab mode "browse"
    And I click the changed file "index.html" in the Code tab
    Then the file preview iframe should be visible
    And there should be no page errors

  @mobile
  Scenario: A terminal file-ref link opens the drawer at that file
    # Same openInCodeTab front door the desktop file-ref-link.feature
    # exercises — there is no mobile-specific producer or isMobile()
    # branch in Terminal.tsx. openInCodeTab flips collapsed=false and
    # seeds pendingOpen; on mobile the drawer's open prop reads
    # !collapsed() and opens, and CodeTab consumes pendingOpen to
    # surface the file.
    When I run "rm -rf /tmp/kolu-mobile-link && git init /tmp/kolu-mobile-link && cd /tmp/kolu-mobile-link"
    And I run "printf 'one\ntwo\nthree\nfour\n' > note.md"
    And I run "git add note.md && git commit -m i"
    And I run "echo see note.md:3"
    And I trigger the terminal file-ref link "note.md:3"
    Then the right panel should be visible
    And the file content should contain "three"
    And there should be no page errors

  @mobile
  Scenario: Tapping the drawer backdrop dismisses it
    When I tap the mobile pull handle
    And I tap the mobile inspector toggle
    Then the right panel should be visible
    When I tap the right panel drawer backdrop
    Then the right panel should not be visible
    And there should be no page errors
