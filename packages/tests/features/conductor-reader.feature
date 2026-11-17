Feature: A plan is read, not glimpsed
  The one thing a person must read before they approve it is the plan, and for
  a while it was drawn inside the work card: a box in the right-hand column,
  with a table in it coming out one word a line. A table's columns can never
  be narrower than their longest word, so that box was not a styling mistake —
  it was the wrong place for a document.

  So a file row on a card opens the READER, which takes the large side of the
  Conductor's screen: about two thirds reader, one third conversation. The
  work column gives way to it without leaving (the cards come back exactly as
  they were), the question about that work is pinned above the document with
  its buttons, and there are two ways to give it more room — filling the
  screen, and a window of its own that a person can move to a second monitor.
  On a phone it takes the whole screen, with back.

  Background:
    Given the terminal is ready
    And the conductor is on a fresh conversation

  Scenario: The plan opens from the question that is waiting on it
    # THE PLAN DOES NOT OPEN BY ITSELF. The Conductor asking for approval is
    # not a reason to take over the screen; the question carries the way in,
    # and pressing it is the person deciding to read. What they land on is the
    # document on the large side of the screen, with the conversation beside
    # it and the cards given way to — still there, taking no room.
    Given a repo for the work
    When I ask the conductor to open the work "rewrite the docs"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes a plan with a table into the work's repo
    And I ask the conductor to put the plan up for approval
    Then the work's question should offer to read the plan
    When I press the question's Read button
    Then the reader should be open on ".waterfall/plan.md"
    And the reader should render "The plan" as a heading
    And the conversation should be beside the reader
    And the work column should have given way to the reader
    And there should be no page errors

  Scenario: The document is set for reading, and its table is not squeezed
    # THE MEASUREMENT, not a look. The column a paragraph is set in is at
    # least the width a person reads prose in and no wider than the measure
    # the stylesheet declares; and no word in any table cell is broken across
    # lines, which is the exact failure the card's box produced.
    Given a repo for the work
    When I ask the conductor to open the work "measure the plan"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes a plan with a table into the work's repo
    And I open the work's file ".waterfall/plan.md"
    Then the reader should be open on ".waterfall/plan.md"
    And the document should be set for reading
    And there should be no page errors

  Scenario: Approving from the question pinned over the plan
    # ONE QUESTION, THREE FACES. The ask pinned above the document is the same
    # record the card and the chat draw, and answering it where the plan is
    # settles it — recorded as having been answered from the reader.
    Given a repo for the work
    When I ask the conductor to open the work "approve from the reader"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes a plan with a table into the work's repo
    And I ask the conductor to put the plan up for approval
    And I press the question's Read button
    Then the reader should be open on ".waterfall/plan.md"
    When I approve the plan in the reader
    # ANSWERING IS NOT LEAVING. The plan stays open — a person who has just
    # approved it may well still be reading it — so the cards are reached the
    # one way they are ever reached from here: "← Work".
    And I leave the reader
    Then the work's decisions should include "approve" answered from the reader
    And there should be no page errors

  Scenario: Filling the screen with the plan, and taking the conversation back
    # THE FIRST OF THE TWO WAYS TO GIVE IT MORE ROOM. The conversation is one
    # press away the whole time — it is never unmounted, only given no width —
    # so taking it back is a width changing and not a chat being rebuilt.
    Given a repo for the work
    When I ask the conductor to open the work "fill the screen"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes a plan with a table into the work's repo
    And I open the work's file ".waterfall/plan.md"
    Then the conversation should be beside the reader
    When I fill the screen with the reader
    Then the conversation should be out of the way
    And the document should be set for reading
    When I take the conversation back
    Then the conversation should be beside the reader
    When I leave the reader
    Then the reader should be closed
    And the work column should be back as it was
    And there should be no page errors

  Scenario: The plan moves to a window of its own, and is answered there
    # THE SECOND WAY, and the one a second monitor is for. It is the same
    # component on its own route — a window that is the reader and nothing
    # else — and it is LIVE: the file is read from the member's worktree over
    # this window's own connection, and the question is answered on the one
    # record, from the pop-out. Closing it loses nothing.
    Given a repo for the work
    When I ask the conductor to open the work "pop the plan out"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes a plan with a table into the work's repo
    And I ask the conductor to put the plan up for approval
    And I press the question's Read button
    And I pop the reader out
    Then the popped-out window should be reading ".waterfall/plan.md"
    And the popped-out window should render "The plan" as a heading
    When I approve the plan in the popped-out window
    Then the work's decisions should include "approve" answered from the popout
    When I close the popped-out window
    Then the work column should be back as it was
    And there should be no page errors

  @mobile
  Scenario: On a phone the plan takes the whole screen, with a way back
    # A phone has no room for two columns, so the reader is the screen and
    # "← Work" is how a person leaves it — the same component, the same back.
    Given a repo for the work
    When I ask the conductor to open the work "read it on the phone"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes a plan with a table into the work's repo
    And I open the work's file ".waterfall/plan.md"
    Then the reader should be open on ".waterfall/plan.md"
    And the reader should have the whole screen
    And the conversation should be out of the way
    And the reader should render "The plan" as a heading
    When I leave the reader
    Then the reader should be closed
    And the work column should be back as it was
    And there should be no page errors

  Scenario: A file the Conductor names in the chat opens in the reader
    # NO COOPERATION FROM THE MODEL. The Conductor just writes the path in
    # backticks; kolu knows the files of the works it holds, and a path one of
    # them holds is a link — on the copy of the work the reply is about, so it
    # opens whatever earlier scenarios left on the same server.
    Given a repo for the work
    When I ask the conductor to open the work "name the plan"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes a plan with a table into the work's repo
    And the implementor's agent starts working
    And the implementor's agent stops
    Then the work's timeline should show a "file" event saying ".waterfall/plan.md"
    When the conductor looks at the implementor and says where its plan is
    And I press the file the conductor named, ".waterfall/plan.md"
    Then the reader should be open on ".waterfall/plan.md"
    And the file the conductor named, ".waterfall/plan.md", should read as open
    # THE CARD'S TIMELINE ROW opens it too: the `file` event names the work
    # and the path, so there is nothing to match.
    When I leave the reader
    Then the reader should be closed
    When I press the work's timeline row for ".waterfall/plan.md"
    Then the reader should be open on ".waterfall/plan.md"
    And there should be no page errors

  Scenario: A file inside a folder, named in the chat, opens in the reader
    # A path two segments under `.waterfall/` is as much one of the work's
    # files as the plan is: the listing reads every depth, so the chat's link
    # and the reader take it the same way.
    Given a repo for the work
    When I ask the conductor to open the work "name the mockup"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes ".waterfall/mockup/index.md" into the work's repo
    And the implementor's agent starts working
    And the implementor's agent stops
    Then the work's timeline should show a "file" event saying ".waterfall/mockup/index.md"
    When the conductor looks at the implementor and names ".waterfall/mockup/index.md"
    And I press the file the conductor named, ".waterfall/mockup/index.md"
    Then the reader should be open on ".waterfall/mockup/index.md"
    And the reader should render "The plan" as a heading
    And there should be no page errors

  Scenario: The reader's strip shows the tab of the file being read
    # A folder of many files is a strip far wider than the reader. Opening
    # the last of them must not leave its tab past the strip's right edge:
    # the strip scrolls sideways to it, so you can see where you are.
    Given a repo for the work
    When I ask the conductor to open the work "a wide mockup"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes 30 files into ".waterfall/mockup/" in the work's repo
    And the implementor's agent starts working
    And the implementor's agent stops
    Then the work card should show the folder ".waterfall/mockup/" holding 30 files
    When I unfold the work's folder ".waterfall/mockup/"
    And I open the work's file ".waterfall/mockup/page-of-the-mockup-30.md"
    Then the reader should be open on ".waterfall/mockup/page-of-the-mockup-30.md"
    And the reader's tab for the open file should be in view
    And there should be no page errors

  Scenario: A file named in a reply about one work opens that work's copy, with no menu
    # EVERY WORK HAS A PLAN, so the path alone names none of them: two works
    # here each hold `.waterfall/plan.md`. The reply looks at the second work's
    # implementor before it names the file — that is what the turn is about —
    # so the press opens the second work's plan at once and offers no choice.
    Given a repo for the work
    When I ask the conductor to open the work "the first plan"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes a plan with a table into the work's repo
    And the implementor's agent starts working
    And the implementor's agent stops
    Then the work's timeline should show a "file" event saying ".waterfall/plan.md"
    Given a repo for the work
    When I ask the conductor to open the work "the second plan"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes a plan with a table into the work's repo
    And the implementor's agent starts working
    And the implementor's agent stops
    Then the work's timeline should show a "file" event saying ".waterfall/plan.md"
    When the conductor looks at the implementor and says where its plan is
    And I press the file the conductor named, ".waterfall/plan.md"
    Then the reader should be open on the work's ".waterfall/plan.md"
    And no menu of works should have opened
    And there should be no page errors

  Scenario: A file named in a reply about a work that has no copy says so, and opens nothing
    # THE PATH IS A LINK because another work holds it — but the reply looks
    # at the second work's implementor, which has written no plan. The press
    # says so where the link is, and never opens the first work's plan as if
    # it were this one's.
    Given a repo for the work
    When I ask the conductor to open the work "the planned work"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    And the implementor writes a plan with a table into the work's repo
    And the implementor's agent starts working
    And the implementor's agent stops
    Then the work's timeline should show a "file" event saying ".waterfall/plan.md"
    Given a repo for the work
    When I ask the conductor to open the work "the unplanned work"
    And I answer the work's question with "hand-over" in the chat
    And I ask the conductor to run the implementor in the work's repo
    When the conductor looks at the implementor and says where its plan is
    And I press the file the conductor named, ".waterfall/plan.md"
    Then the conductor should say the work has no ".waterfall/plan.md" yet
    And the reader should be closed
    And no menu of works should have opened
    And there should be no page errors
