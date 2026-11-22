Feature: A picked work's Code view
  A picked work in progress offers three views: Terminals, Code and Details.
  Code is the Right panel's Code tab about the work's own worktree — its
  tree, its Local and Branch diffs and its files — read on the work's host.
  Its place (the mode and the file open in each mode) is the WORK's, kept by
  kolu-server, so it comes back after a reload; and it is its own, so the
  Right panel's Code tab is neither moved nor read by it. The worktree is the
  work's, not a terminal's: with every terminal gone the view still lists it.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: The Code view lists the worktree, its local changes and a file, and keeps its place across a reload
    # One view is mounted at a time: with Code in front the work draws no
    # live pane at all, and back on Terminals it draws no Code view.
    Given a repo for the work
    When I ask the conductor to open the work "read its code"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes "plan.md" into the work's repo
    And I open the work card
    And I show the work's code
    Then the picked work should be showing its code
    And the picked work should draw no live pane
    And the work's Code view should list "README.md" in its tree
    When I open "plan.md" in the work's Code view
    Then the work's Code view should show the markdown "Read the parser"
    When I press the work's Code view mode "local"
    Then the work's Code view should list "plan.md" in its tree
    When I open "plan.md" in the work's Code view
    And I show the work's terminals
    Then the picked work should draw its live pane and no Code view
    When I reload the page
    And I enter conductor mode
    And I open the work card
    And I show the work's code
    Then the work's Code view mode should be "local"
    And the work's Code view should have "plan.md" open
    When I press the work's Code view mode "browse"
    Then the work's Code view should show the markdown "Read the parser"
    And there should be no page errors

  Scenario: The work's Code view leaves the Right panel's Code tab where it was
    # The Right panel stays mounted behind the Conductor; a mode pressed and a
    # file opened in the work's view are the work's alone.
    Given a repo for the work
    When I ask the conductor to open the work "a place of its own"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes "plan.md" into the work's repo
    And I leave the conductor for the host tab
    And I click the Code tab
    And I click the Code tab mode "local"
    And I enter conductor mode
    And I open the work card
    And I show the work's code
    And I press the work's Code view mode "browse"
    And I open "plan.md" in the work's Code view
    Then the work's Code view should show the markdown "Read the parser"
    When I leave the conductor for the host tab
    Then the Right panel's Code tab mode should be "local"
    And the Right panel's Code tab should not have "plan.md" open
    And there should be no page errors

  Scenario: A work whose terminals have all gone still shows its tree and its local changes
    Given a repo for the work
    When I ask the conductor to open the work "outlive the terminal in code"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes "plan.md" into the work's repo
    And the implementor's terminal goes away
    Then the work should have no terminals
    When I open the work card
    And I show the work's code
    Then the work's Code view should list "README.md" in its tree
    When I press the work's Code view mode "local"
    Then the work's Code view should list "plan.md" in its tree
    And there should be no page errors
