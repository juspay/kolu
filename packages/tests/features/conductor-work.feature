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
    # THE TIMELINE GROWS FROM OBSERVATION ALONE. Every event below is one kolu
    # saw for itself: the only things the conversation wrote are the work's
    # name and its members' roles. The guard that this is really so is the
    # `pr-opened` assertion made BEFORE a pull request exists — a card that
    # anticipated its events, or a fixture that wrote them, fails there.
    Given a repo for the work
    When I ask the conductor to open the work "rewrite the parser"
    Then the work column should show the work
    And the conductor status should say 1 piece of work
    And the work's timeline should show a "requested" event
    And the work's timeline should show no "pr-opened" event
    # The setup travelled in the call that opened the work; only what the
    # request did not already say is put to the human, as ONE question.
    When I answer the work's question with "hand-over" in the chat
    Then the work's decisions should include "hand-over" answered from the chat
    # ONE LIST, EACH ROW A LINE: the setup's answers are the first rows of the
    # decisions, labelled by their keys, and nothing is drawn twice.
    And the work's decisions should be one line each
    # A member is made with its role in the same call — the terminal is an
    # agent that comes up with no transcript at all, which kolu reads as ready.
    When I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    And the work's timeline should show a "joined" event
    And the work's timeline should show a "ready" event
    And the work's stage map should be at "build"
    # A file lands in the worktree's `.waterfall/`; kolu lists that directory
    # when the member's state changes, so the plan becomes an event without
    # anybody announcing it.
    When the implementor writes ".waterfall/plan.md" into the work's repo
    And the implementor's agent starts working
    And the implementor's agent stops
    Then the work's timeline should show a "file" event saying ".waterfall/plan.md"
    When the work's pull request opens as #7 "Rewrite the parser"
    Then the work's timeline should show a "pr-opened" event saying "#7"
    And the work card should name the pull request "#7"
    When the work's pull request starts its checks
    Then the work's timeline should show a "checks-running" event
    And the work's stage map should be at "checks"
    # GREEN IS GITHUB'S ANSWER, not the checks alone: while the branch's
    # rules still want a review the checks have passed but nothing is handed
    # over, and the card says why. The answer is its own timeline row. The
    # work is back with its implementor — nobody handed it to a planner —
    # so it is the build again.
    When the work's pull request goes green but GitHub still wants a review
    Then the work's timeline should show a "checks-passed" event
    And the work's timeline should show GitHub's merge answer as "review"
    And the work should not be waiting on you
    And the work's stage map should be at "build"
    And the work's pull request section should give GitHub's merge answer as "review"
    And the work card should link the pull request "#7"
    # The open PR's first answer was "can" (nothing in the way yet), then
    # "cannot"; the review makes it the third.
    When GitHub lets the work's pull request merge
    Then the work's timeline should show 3 "merge-state" events
    And the work should be waiting on you
    And the work's stage map should be at "merge"
    And the work's pull request section should give GitHub's merge answer as "can"
    # THE MAP IS THE INDEX INTO THE TIMELINE: an open card shows one
    # stage's events, and a press on a stage shows another's.
    When I press the "checks" stage on the work's map
    Then the work card should show only its "checks" events
    When I press the "build" stage on the work's map
    Then the work card should show only its "build" events
    # A PUSH IS NEWS; LOOKING AGAIN IS NOT. A check event says which commit
    # it is about, so the new head's run is a second "checks-running" — and
    # the first commit's, read again on every frame by every member, is not.
    When the work's pull request is pushed to a new commit
    Then the work's timeline should show 2 "checks-running" events
    When the work's pull request is merged
    Then the work's timeline should show a "merged" event
    And the work should be finished as "merged"
    And there should be no page errors

  Scenario: A draft pull request's CI is the checks, and a draft is never yours to merge
    # THE DRAFT WORD DECIDES NO STAGE. CI running is the checks whatever the
    # PR's draft word, and once it is over the work is back with whoever
    # holds it — here the implementor, so the build. What a draft still
    # decides is the merge: GitHub answers CLEAN for a draft with green
    # checks — it works the merge out as if the PR were ready — so kolu reads
    # the draft word itself, nothing is handed over and the bell is silent.
    # Marking it ready is what hands it over, and what rings; that last ring
    # is the proof the silence before it was the draft's, not a bell that
    # never could have rung.
    Given a repo for the work
    When I ask the conductor to open the work "draft the parser"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work's stage map should be at "build"
    When I stub the notification sound
    And I simulate the Kolu window losing focus
    And the work's pull request opens as draft #7 "Draft the parser"
    Then the work's timeline should show a "pr-opened" event saying "#7"
    And the work's stage map should be at "build"
    And the work card should say its pull request is a draft
    When the work's pull request starts its checks
    Then the work's timeline should show a "checks-running" event
    And the work's stage map should be at "checks"
    When the work's pull request passes its checks
    Then the work's timeline should show a "checks-passed" event
    And the work's timeline should show no "merge-state" event
    And the work's stage map should be at "build"
    And the work should not be waiting on you
    And the Conductor's bell should have had its frames to decide
    And the notification sound should have played 0 times
    When the work's pull request is marked ready for review
    Then the work's timeline should show a "draft-state" event saying "ready for review"
    And the work's stage map should be at "merge"
    And the work should be waiting on you
    And the notification sound should have played 1 time
    And there should be no page errors

  Scenario: A planner standing on another branch lends the card nothing
    # A WORK'S PR IS ITS OWN BRANCH'S. The planner is started in another
    # repository, on a branch whose pull request has merged; the card read
    # that terminal's PR as the work's once. Its own terminal shows #5 — so
    # there is a PR to lend — its row says it stands elsewhere, and the
    # card's mark is the work's own draft #7.
    Given a repo for the work
    And another repo whose pull request is merged #5 "Someone else's change"
    When I ask the conductor to open the work "lend nothing"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the planner in the other repo
    Then the work's planner row should say it stands elsewhere
    And the planner's own terminal should show its pull request "#5"
    When the work's pull request opens as draft #7 "Lend nothing"
    Then the work's timeline should show a "pr-opened" event saying "#7"
    And the work card's pull request mark should link "#7"
    And the work card should say its pull request is a draft
    And there should be no page errors

  Scenario: A trivial work's map with a draft pull request
    # A trivial work has no review: its agents' time is the build. Its CI is
    # the checks, a draft or not, and a red check sends it back to the
    # implementor that holds it.
    Given a repo for the work
    When I ask the conductor to open the trivial work "tidy the lexer quickly"
    And I ask the conductor to run the implementor in the work's repo
    And the work's pull request opens as draft #8 "Tidy the lexer"
    And the work's pull request starts its checks
    Then the work's timeline should show a "checks-running" event
    And the work's stage map should be at "checks"
    When the work's pull request fails its checks
    Then the work's timeline should show a "checks-failed" event
    And the work's stage map should be at "build"
    And there should be no page errors

  Scenario: A draft's work goes round review twice and into the checks, and the map counts the loops
    # THE STAGE IS WHO HOLDS THE WORK. The Conductor hands it over by speaking
    # to a member — a real `agent_say` — so each hand-off is on the record:
    # to the planner is the review, back to the implementor is the build. The
    # PR stays a draft throughout, which no longer holds the work in the
    # build. The map counts the rounds, and the trail shows every visit.
    Given a repo for the work
    When I ask the conductor to open the work "review the parser twice"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the planner in the work's repo
    Then the work's timeline should show a "ready" event
    When I ask the conductor to run the implementor in the work's repo
    Then the work's timeline should show 2 "ready" events
    And the work's stage map should be at "build"
    When the work's pull request opens as draft #9 "Review the parser"
    And I ask the conductor to tell the planner "review the parser"
    Then the work's timeline should show a "told" event
    And the work's stage map should be at "review"
    When the planner's agent starts working
    And the planner's agent stops
    And I ask the conductor to tell the implementor "answer the review"
    Then the work's timeline should show 2 "told" events
    And the work's stage map should be at "build"
    When the implementor's agent starts working
    And the implementor's agent stops
    And I ask the conductor to tell the planner "look again"
    Then the work's timeline should show 3 "told" events
    And the work's stage map should be at "review"
    When the planner's agent starts working
    And the planner's agent stops
    And I ask the conductor to tell the implementor "answer it again"
    Then the work's timeline should show 4 "told" events
    And the work's stage map should be at "build"
    When the work's pull request starts its checks
    Then the work's stage map should be at "checks"
    And the work's stage map should count 2 review rounds
    And the work's trail should read "plan, build, review, build, review, build, checks"
    And there should be no page errors

  Scenario: The plan is approved from the card while the Conductor sits idle
    # ONE QUESTION, SEVERAL FACES. The card and the chat draw the work's own
    # DECISION, so answering it on the card settles the conversation's copy
    # too — and the decision records where the answer came from, which is the
    # only thing that tells the faces apart afterwards.
    #
    # AND NOTHING IS WAITING ON THE HUMAN. The Conductor was answered the
    # moment the question was put and ended its turn, so it is IDLE while the
    # card is violet — never `asking`, which is the state its tool call used
    # to die in after five minutes. The answer reaches it as a wake, and the
    # member it makes next is the proof it got on with the work.
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
    # The files are the worktree's own `.waterfall/`, read live, and pressing
    # one opens the READER — the Code tab's viewer on the large side of the
    # Conductor's screen, so the plan is read where the work is rather than
    # by leaving for the file browser. Rendered is the claim: a markdown
    # heading arrives as a heading, not as `#`.
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
    # ONE DERIVATION, from membership: everywhere else in the app a terminal
    # that belongs to a work says so — the mark, the role it plays and the
    # work's title — and the dock row is where a person meets it first.
    Given a repo for the work
    When I ask the conductor to open the work "mark the terminal"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And I press Escape
    Then the conductor pane should not be visible
    And the dock row for the member terminal should carry the work's mark as the "implementor"
    And there should be no page errors

  Scenario: Finished work, its decisions and its kept files outlive the server
    # THE WHOLE POINT OF STORING IT. The server process is replaced — not the
    # page reloaded — on a fresh port with the same state directory, so what
    # comes back is what was WRITTEN. The worktree is not consulted: the plan
    # is a copy kolu took when the work ended, which is why it can still be
    # read after the terminals it was written in are gone.
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
    # A planner writes folders too — a mockup of forty pages and its fonts.
    # The card shows the folder as ONE chip with how many files are beneath
    # it, at any depth; pressing it unfolds one level. The timeline says the
    # run of files once. And the whole folder is copied when the work ends,
    # so a file two levels down still opens after its worktree could be gone.
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
    And the timeline's line should run unbroken
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
    # "New session" clears the CONVERSATION. The work it opened — its member
    # terminal and the decisions taken about it — are not the conversation's
    # to throw away: a waterfall in flight is picked up by whoever the next
    # conversation is, which is the whole reason a piece of work is stored
    # somewhere other than the chat.
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
    # THE DEFECT THIS GUARDS (#2376, the human's three cards): a redeploy made
    # every host serve one information-free frame before it had adopted its
    # terminals, kolu read "not in the list yet" as `gone`, and a work whose
    # members had all left was ENDED as abandoned — with both terminals alive
    # under it. Now: nothing kolu merely fails to SEE ends a piece of work,
    # and a roster that has not been established is not an empty roster. The
    # server process is replaced on a fresh port over the same state
    # directory, which is the redeploy, and the work is still in progress with
    # the same terminal in it.
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
    # THE ONLY TWO WAYS A WORK ENDS ON PURPOSE are the forge saying merged or
    # closed and somebody stopping it — and stopping is not deleting. A
    # stopped card says who stopped it, has no terminals, no lock and no
    # question on it (the ended half of the state has nowhere to put them),
    # and offers Reopen; what comes back is the same work, with its decisions
    # and its whole timeline.
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
    # A WORK IS ITS BRANCH. `work_open` for a key that already exists returns
    # that work as it stands — it asks only what has no answer — so a second
    # call cannot make a second card however many times the Conductor is woken
    # into trying. (The human got three cards for one waterfall that way.)
    Given a repo for the work
    When I ask the conductor to open the work "one card only"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to open the work "one card only" again
    Then the conductor should have answered with the same work
    And the work column should hold exactly one card for the work
    And the work should have no open question
    And there should be no page errors

  Scenario: Declining the setup of a work nothing has happened in removes it
    # "I'd rather not say" to the setup of a work with no member and no pull
    # request is a decision not to start: the work goes, rather than becoming
    # a finished card nobody asked for. (The human's second entry was exactly
    # this — an "Abandoned · 1m" card made by declining a question about a
    # work that had never run.)
    Given a repo for the work
    When I ask the conductor to open the work "never mind this one"
    Then the work column should show the work
    When I decline the work's question on the card
    Then the work column should not show the work
    And there should be no page errors

  Scenario: A remembered work this build cannot read is recovered, never hand-edited
    # THE ACCIDENT: a store written by a build whose shape this one does not
    # read — an upgrade that skipped a rung, a roll-back, a half-written key.
    # The Conductor refuses it rather than reading past it, and what it offers
    # is what kolu can DO: the newest backup that reads, or starting with no
    # works and the unreadable ones kept aside. What it must never offer again
    # is the sentence it used to end on — "Fix the `works` key to recover" —
    # which hands kolu's job to a person holding a JSON file.
    Given a repo for the work
    When I ask the conductor to open the work "survive a bad upgrade"
    Then the work column should show the work
    # The first restart's boot snapshot catches the store as it is NOW, with
    # the work in it and readable.
    When the kolu server is restarted
    And I enter conductor mode
    Then the work column should show the work
    # ...and the second one comes up over a `works` key this build cannot
    # read. Its own boot snapshot goes into the ring too, so the NEWEST
    # snapshot carries the corruption: a recovery that took the top of the
    # ring would hand the same unreadable value back.
    When the kolu server is restarted over works this build cannot read
    And I enter conductor mode
    Then the conductor should say it could not read the saved works
    When I restore the newest backup that reads
    Then the work column should show the work
    And there should be no page errors

  @mobile
  Scenario: The work column and its card fit a phone
    # A phone is below the two-column width by definition, so the column is
    # the one the status line's count opens — and every part of it, opened
    # card and all, stays inside the 390px window.
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

  @mobile
  Scenario: A full work's stage map fits a phone
    # A watch has no map; this work does, and every name and time in it is
    # drawn whole in a 390px window.
    Given a repo for the work
    When I ask the conductor to open the work "a phone map"
    And I answer the work's question with "hand-over" in the chat
    And I open the work card
    Then every stage label and time should be whole
    And there should be no page errors

  Scenario: The stage map names every stage and emphasises the one it is in
    Given a repo for the work
    When I ask the conductor to open the work "name the stage"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work's stage map should be at "build"
    And the work's stage map should name every stage and emphasise "Build"
    And there should be no page errors

  Scenario: A work that needs you is answered on its card without opening it
    Given a repo for the work
    When I ask the conductor to open the work "answer it shut"
    Then the work's question should be in the chat, its card shut
    And the shut work card should show the work's question
    When I answer the work's question with "merge" on the shut card
    Then the work should have no open question
    And the work's decisions should include "merge" answered from the card
    And there should be no page errors

  Scenario: A work lists its terminals without being opened, and Look works from there
    Given a repo for the work
    When I ask the conductor to open the work "listed while shut"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    When I shut the work card
    Then the shut work card should list the terminal
    When I look at the member terminal
    Then the peek should be open
    And there should be no page errors

  Scenario: A work's row keeps every part inside it at four widths
    Given a repo for the work
    When I ask the conductor to open the work "fit every width"
    And I answer the work's question with "hand-over" in the chat
    And I leave the conductor for the host tab
    And I create a terminal
    And I ask the conductor to join the terminal I am in to the work as its planner
    And I ask the conductor to run the implementor in the work's repo
    Then the work column should list the terminal as a member
    And the work's terminal rows should keep every part inside the card
    And every stage label and time should be whole
    When I resize the viewport to 2000x1100
    Then the work's terminal rows should keep every part inside the card
    And every stage label and time should be whole
    When I resize the viewport to 1024x768
    Then the work's terminal rows should keep every part inside the card
    And every stage label and time should be whole
    When I resize the viewport to 900x768
    Then the work's terminal rows should keep every part inside the card
    And every stage label and time should be whole
    And nothing on screen should reach past the window's right edge
    And there should be no page errors

  Scenario: A work keeps where it works after its terminal has gone
    # The work holds its worktree on its own record: its folder, its files and
    # the reader all stay when the only terminal in it ends.
    Given a repo for the work
    When I ask the conductor to open the work "outlive the terminal"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes a plan with a table into the work's repo
    Then the work card should list the file ".waterfall/plan.md"
    And the work's worktree part should show the work's folder and its branch
    When the implementor's terminal goes away
    Then the work should have no terminals
    And the work card should list the file ".waterfall/plan.md"
    And the work's worktree part should show the work's folder and its branch
    When I open the work's file ".waterfall/plan.md"
    Then the reader should render "The plan" as a heading
    And there should be no page errors
