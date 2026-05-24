Feature: Mobile code browser
  On mobile the right panel is hidden — there's no room for a side
  column. The "Files" button in the chrome sheet (`MobileChromeSheet`)
  opens a bottom drawer with the active terminal's repo file tree
  (`MobileCodeSheet`). Tapping a file shows it in a detail view:
  text files render via Pierre's `CodeView`; HTML files render in
  the sandboxed iframe preview the desktop Code tab uses. A back
  arrow returns from the detail view to the tree; an explicit close
  button dismisses the drawer.

  Background:
    Given the terminal is ready

  @mobile
  Scenario: Files button opens the mobile code sheet
    When I run "git init /tmp/kolu-mobile-files && cd /tmp/kolu-mobile-files"
    And I run "echo hello > a.txt"
    And I run "git add a.txt && git commit -m init"
    And I tap the mobile pull handle
    And I tap the mobile files button
    Then the mobile code sheet should be visible
    And the mobile file tree should contain "a.txt"
    And there should be no page errors

  @mobile
  Scenario: Tapping a text file shows its content
    When I run "git init /tmp/kolu-mobile-text && cd /tmp/kolu-mobile-text"
    And I run "echo hello > readme.txt"
    And I run "git add readme.txt && git commit -m init"
    And I tap the mobile pull handle
    And I tap the mobile files button
    And I tap mobile file "readme.txt"
    Then the mobile file view should be visible
    And there should be no page errors

  @mobile
  Scenario: Tapping an HTML file shows the iframe preview
    When I run "git init /tmp/kolu-mobile-html && cd /tmp/kolu-mobile-html"
    And I run "printf '<h1>hi</h1>' > index.html"
    And I run "git add index.html && git commit -m init"
    And I tap the mobile pull handle
    And I tap the mobile files button
    And I tap mobile file "index.html"
    Then the mobile html preview should be visible
    And there should be no page errors

  @mobile
  Scenario: Back arrow dismisses the detail view
    When I run "git init /tmp/kolu-mobile-back && cd /tmp/kolu-mobile-back"
    And I run "echo hi > foo.md"
    And I run "git add foo.md && git commit -m init"
    And I tap the mobile pull handle
    And I tap the mobile files button
    And I tap mobile file "foo.md"
    Then the mobile file view should be visible
    When I tap the mobile code back button
    Then the mobile file view should not be visible
    And there should be no page errors

  @mobile
  Scenario: Close button dismisses the drawer
    When I run "git init /tmp/kolu-mobile-close && cd /tmp/kolu-mobile-close"
    And I run "echo hi > x.txt"
    And I run "git add x.txt && git commit -m init"
    And I tap the mobile pull handle
    And I tap the mobile files button
    Then the mobile code sheet should be visible
    When I tap the mobile code close button
    Then the mobile code sheet should not be visible
    And there should be no page errors
