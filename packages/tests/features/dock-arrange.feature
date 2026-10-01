Feature: Dock rearrange by drag-and-drop
  Repo sections and branch clusters can be re-ordered by drag; the arrangement
  is per-host sticky and every not-dragged unit keeps its structural position
  (new repos/branches still append at the bottom).

  Background:
    Given the terminal is ready

  Scenario: Dragging a repo section pins it first across a reload
    When I run "rm -rf /tmp/kolu-arr-a /tmp/kolu-arr-b && git init /tmp/kolu-arr-a && git init /tmp/kolu-arr-b && cd /tmp/kolu-arr-a"
    Then the dock should show the "kolu-arr-a" repo section
    When I create a terminal
    And I run "cd /tmp/kolu-arr-b"
    Then the dock should show the "kolu-arr-b" repo section
    And the dock should show "kolu-arr-a" before "kolu-arr-b"
    When I drag the dock section "kolu-arr-b" above the dock section "kolu-arr-a"
    Then the dock should show "kolu-arr-b" before "kolu-arr-a"
    When I reload the page and wait for ready
    Then the dock should still show "kolu-arr-b" before "kolu-arr-a"

  Scenario: Dragging a branch cluster moves it; rows inside stay in creation order
    When I run "rm -rf /tmp/kolu-arr-main /tmp/kolu-arr-feat && git init -b master /tmp/kolu-arr-main && cd /tmp/kolu-arr-main && git commit --allow-empty -m init"
    Then the dock should show the "kolu-arr-main" repo section
    When I run "git worktree add -b arr-feat /tmp/kolu-arr-feat"
    And I create a terminal
    And I run "cd /tmp/kolu-arr-feat"
    Then the dock should show the "arr-feat" cluster
    When I select terminal 1 in the workspace switcher
    And I create a terminal
    And I snapshot the "master" cluster's rows
    And I snapshot the "arr-feat" cluster's rows
    When I drag the dock cluster "arr-feat" above the dock cluster "master"
    Then the dock should show the "arr-feat" cluster before "master"
    And the "master" cluster rows should match the snapshot
    And the "arr-feat" cluster rows should match the snapshot
    When I select terminal 1 in the workspace switcher
    And I create a terminal
    Then the new terminal should be the last row of its repo section

  Scenario: Dragging a row onto another row nests it as a split
    When I run "rm -rf /tmp/kolu-rehome && git init -b master /tmp/kolu-rehome && cd /tmp/kolu-rehome && git commit --allow-empty -m init"
    Then the dock should show the "kolu-rehome" repo section
    When I create a terminal
    And I create a terminal
    And I remember the canvas tile count
    When I drag the dock row of terminal 2 onto the dock row of terminal 1
    Then terminal 2 should be a split of terminal 1 in the dock
    And the canvas tile count should drop by 1

  Scenario: Dragging a split's row onto its repo header gives it its own tile
    When I run "rm -rf /tmp/kolu-rehome-b && git init -b master /tmp/kolu-rehome-b && cd /tmp/kolu-rehome-b && git commit --allow-empty -m init"
    Then the dock should show the "kolu-rehome-b" repo section
    When I create a terminal
    And I split terminal 1
    And I remember the sub-terminal's id
    And I remember the canvas tile count
    When I drag the split's dock row onto the "kolu-rehome-b" repo header
    Then the split should have its own dock row
    And the canvas tile count should rise by 1
