Feature: A piece of work is a stored thing
  kolu REMEMBERS the work, and the Conductor states its intent once. The
  conversation names a piece of work when it opens it — title, repo, branch and
  the setup questions it needs answered — and names a role in the same call
  that makes each terminal. Everything else on the card is kolu's own reading
  of what it observed: a member joining, its agent coming up and stopping, a
  file appearing in the worktree's `.waterfall/`, the pull request opening,
  its checks, the merge. Nothing in these scenarios writes to the record; they
  state facts WHERE KOLU READS THEM — a file in the repo, a session file on
  disk, a pull request the repo's own `gh` answers with (the harness points
  `KOLU_GH_BIN` at a stand-in that answers from a file the scenario writes, see
  `support/fake-gh.ts`) — and then read the card. The pull request is read for
  the WORK, from the branch its key names in the repository its key names, so
  the scenarios that have a forge open their work IN the repo they wrote the
  PR into and no terminal has to be alive for a merge to end the work.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: A waterfall's card, from the request to the merge
    Given a repo for the work
    When I ask the conductor to open the work "rewrite the parser"
    Then the work column should show the work
    And the conductor status should say 1 piece of work
    And the work's timeline should show a "requested" event
    And the work's timeline should show no "pr-opened" event
    When I answer the work's question with "hand-over" in the chat
    Then the work's decisions should include "hand-over" answered from the chat
    And the work's decisions should be one line each
    When I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    And the work's timeline should show a "joined" event
    And the work's timeline should show a "ready" event
    And the work's stage strip should be at "build"
    When the implementor writes ".waterfall/plan.md" into the work's repo
    And the implementor's agent starts working
    And the implementor's agent stops
    Then the work's timeline should show a "file" event saying ".waterfall/plan.md"
    When the work's pull request opens as #7 "Rewrite the parser"
    Then the work's timeline should show a "pr-opened" event saying "#7"
    And the work card should name the pull request "#7"
    When the work's pull request starts its checks
    Then the work's timeline should show a "checks-running" event
    And the work's stage strip should be at "checks"
    When the work's pull request goes green but GitHub still wants a review
    Then the work's timeline should show a "checks-passed" event
    And the work's timeline should show GitHub's merge answer as "review"
    And the work should not be waiting on you
    And the work's stage strip should be at "review"
    And the work's pull request section should give GitHub's merge answer as "review"
    And the work card should link the pull request "#7"
    When GitHub lets the work's pull request merge
    Then the work's timeline should show 3 "merge-state" events
    And the work should be waiting on you
    And the work's stage strip should be at "merge"
    And the work's pull request section should give GitHub's merge answer as "can"
    When I press the "checks" stage on the work's strip
    Then the work card should show only its "checks" events
    When I press the "build" stage on the work's strip
    Then the work card should show only its "build" events
    When the work's pull request is pushed to a new commit
    Then the work's timeline should show 2 "checks-running" events
    When the work's pull request is merged
    Then the work's timeline should show a "merged" event
    And the work should be finished as "merged"
    And there should be no page errors

  Scenario: A draft pull request is still the build
    Given a repo for the work
    When I ask the conductor to open the work "draft the parser"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work's stage strip should be at "build"
    When I stub the notification sound
    And I simulate the Kolu window losing focus
    And the work's pull request opens as draft #7 "Draft the parser"
    Then the work's timeline should show a "pr-opened" event saying "#7"
    And the work's stage strip should be at "build"
    And the work card should say its pull request is a draft
    When the work's pull request starts its checks
    Then the work's timeline should show a "checks-running" event
    And the work's stage strip should be at "build"
    When the work's pull request passes its checks
    Then the work's timeline should show a "checks-passed" event
    And the work's timeline should show no "merge-state" event
    And the work should not be waiting on you
    And the Conductor's bell should have had its frames to decide
    And the notification sound should have played 0 times
    When the work's pull request is marked ready for review
    Then the work's timeline should show a "draft-state" event saying "ready for review"
    And the work's stage strip should be at "merge"
    And the work should be waiting on you
    And the notification sound should have played 1 time
    And there should be no page errors

  Scenario: A trivial work's strip with a draft pull request
    Given a repo for the work
    When I ask the conductor to open the trivial work "tidy the lexer quickly"
    And I ask the conductor to run the implementor in the work's repo
    And the work's pull request opens as draft #8 "Tidy the lexer"
    And the work's pull request starts its checks
    Then the work's timeline should show a "checks-running" event
    And the work's stage strip should be at "build"
    When the work's pull request is marked ready for review
    Then the work's timeline should show a "draft-state" event saying "ready for review"
    And the work's stage strip should be at "checks"
    And there should be no page errors

  Scenario: The plan is approved from the card while the Conductor sits idle
    Given a repo for the work
    When I ask the conductor to open the work "tidy the lexer"
    Then the conductor should not be asking
    And the conductor status should say 1 waiting on you
    When I answer the work's question with "merge" on the card
    Then the work should have no open question
    And the conductor status should say nothing is waiting on you
    And the work's decisions should include "merge" answered from the card
    When I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    And there should be no page errors

  Scenario: A file on the card opens in the reader, rendered
    Given a repo for the work
    When I ask the conductor to open the work "read the lexer"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes ".waterfall/plan.md" into the work's repo
    Then the work card should list the file ".waterfall/plan.md"
    When I open the work's file ".waterfall/plan.md"
    Then the reader should render "The plan" as a heading
    And the conductor pane should be visible
    And there should be no page errors

  Scenario: A member terminal carries the Conductor's mark on its dock row
    Given a repo for the work
    When I ask the conductor to open the work "mark the terminal"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And I press Escape
    Then the conductor pane should not be visible
    And the dock row for the member terminal should carry the work's mark as the "implementor"
    And there should be no page errors

  Scenario: Finished work, its decisions and its kept files outlive the server
    Given a repo for the work
    When I ask the conductor to open the work "survive the night"
    And I answer the work's question with "merge" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes ".waterfall/plan.md" into the work's repo
    And the implementor's agent starts working
    And the implementor's agent stops
    Then the work's timeline should show a "file" event saying ".waterfall/plan.md"
    When the work's pull request opens as #4 "Survive the night"
    And the work's pull request is merged
    Then the work should be finished as "merged"
    When the kolu server is restarted
    And I enter conductor mode
    Then the work should be finished as "merged"
    When I open the work card
    Then the work's decisions should include "merge" answered from the chat
    And the work card should keep the file ".waterfall/plan.md"
    When I open the work's file ".waterfall/plan.md"
    Then the reader should render "The plan" as a heading
    And there should be no page errors

  Scenario: A folder the work wrote is one chip, one timeline row, and is kept
    Given a repo for the work
    When I ask the conductor to open the work "draw the mockup"
    And I answer the work's question with "merge" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes ".waterfall/plan.md" into the work's repo
    And the implementor writes ".waterfall/mockup/a.md" into the work's repo
    And the implementor writes ".waterfall/mockup/b.md" into the work's repo
    And the implementor writes ".waterfall/mockup/fonts/c.md" into the work's repo
    And the implementor's agent starts working
    And the implementor's agent stops
    Then the work card should show the folder ".waterfall/mockup/" holding 3 files
    When I unfold the work's folder ".waterfall/mockup/"
    Then the work card should show the folder ".waterfall/mockup/fonts/" holding 1 files
    When I unfold the work's folder ".waterfall/mockup/fonts/"
    And I open the work's file ".waterfall/mockup/fonts/c.md"
    Then the reader should render "The plan" as a heading
    When I leave the reader
    Then the work's timeline should show one row for the folder ".waterfall/mockup/" with 3 files
    When I unfold the work's timeline row for the folder ".waterfall/mockup/"
    Then the folder row ".waterfall/mockup/" should list 3 file rows
    When I press the work's timeline row for ".waterfall/mockup/fonts/c.md"
    Then the reader should be open on ".waterfall/mockup/fonts/c.md"
    When I leave the reader
    When I stop the work from the card
    Then the work should be finished as "stopped"
    When I unfold the work's folder ".waterfall/mockup/"
    And I unfold the work's folder ".waterfall/mockup/fonts/"
    Then the work card should keep the file ".waterfall/mockup/fonts/c.md"
    When I open the work's file ".waterfall/mockup/fonts/c.md"
    Then the reader should render "The plan" as a heading
    And there should be no page errors

  Scenario: A new conversation keeps the work in flight
    Given a repo for the work
    When I ask the conductor to open the work "outlive the chat"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    When I start a new conductor session
    Then the conductor transcript should be empty
    And the work column should show the work
    When I open the work card
    Then the work's decisions should include "hand-over" answered from the chat
    And the work column should list the terminal as a member
    And there should be no page errors

  Scenario: A kolu-server restart leaves the work open, with its terminals
    Given a repo for the work
    When I ask the conductor to open the work "survive the redeploy"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    When the kolu server is restarted
    And I enter conductor mode
    Then the work should be in progress
    And the work column should list the terminal as a member
    And the work's timeline should show no "left" event
    And the work's timeline should show no "ended" event
    And there should be no page errors

  Scenario: Stopped from the card, and opened again, with everything it decided
    Given a repo for the work
    When I ask the conductor to open the work "stop and think again"
    And I answer the work's question with "merge" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    When I stop the work from the card
    Then the work should be finished as "stopped"
    And the work card should say it was stopped by you
    And the work card should show no terminals
    And the work's timeline should show an "ended" event
    When I reopen the work from the card
    Then the work should be in progress
    And the work's timeline should show a "reopened" event
    And the work's decisions should include "merge" answered from the chat
    And there should be no page errors

  Scenario: Opening the same branch twice is one piece of work
    Given a repo for the work
    When I ask the conductor to open the work "one card only"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to open the work "one card only" again
    Then the conductor should have answered with the same work
    And the work column should hold exactly one card for the work
    And the work should have no open question
    And there should be no page errors

  Scenario: Declining the setup of a work nothing has happened in removes it
    Given a repo for the work
    When I ask the conductor to open the work "never mind this one"
    Then the work column should show the work
    When I decline the work's question on the card
    Then the work column should not show the work
    And there should be no page errors

  Scenario: A remembered work this build cannot read is recovered, never hand-edited
    Given a repo for the work
    When I ask the conductor to open the work "survive a bad upgrade"
    Then the work column should show the work
    When the kolu server is restarted
    And I enter conductor mode
    Then the work column should show the work
    When the kolu server is restarted over works this build cannot read
    And I enter conductor mode
    Then the conductor should say it could not read the saved works
    When I restore the newest backup that reads
    Then the work column should show the work
    And there should be no page errors

  @mobile
  Scenario: The work column and its card fit a phone
    When I ask the conductor to watch the first terminal
    Then the conductor status should say 1 piece of work
    And the conductor should have no side column
    And the work column should be behind the status line's control
    When I open the work column
    Then the work column should show the work
    And nothing on screen should reach past the window's right edge
    When I open the work card
    Then the work column should list the terminal as a member
    And nothing on screen should reach past the window's right edge
    And there should be no page errors
