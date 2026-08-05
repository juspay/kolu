Feature: Drag-and-drop file upload
  When the user drops a file onto a terminal, the server saves the
  file under the terminal's clipboard directory and bracketed-pastes
  the path into the PTY. Agents that accept paste-as-file-path
  (codex, Claude Code) can then read the file.

  Background:
    Given the terminal is ready

  Scenario: dropped file path is delivered to the PTY
    When I drop a file named "notes.md" with content "hello drop" onto the terminal
    Then the screen state should contain "notes.md"

  Scenario: a dropped video file is accepted and its path reaches the PTY
    When I drop a file named "screen-recording.mov" with content "fake video bytes" onto the terminal
    Then the screen state should contain "screen-recording.mov"

  Scenario: a bug-repro video larger than the old limit reaches the PTY
    When I drop an 11 MiB file named "large-bug-repro.webm" onto the terminal
    Then the screen state should contain "large-bug-repro.webm"

  # juspay/kolu#2101 G9c(i). 20 MiB of bytes is ~26.7 MiB of base64, so before
  # chunking this was ONE RPC frame well over the ndjson decoder's 16 MiB cap.
  # The decoder does not fail the call — it closes the socket with 1009 — so the
  # pre-fix failure is not "the upload failed", it is the incident: the toast
  #
  #   Failed to upload "huge-bug-repro.webm": SocketCloseError: 1009: MaxBufferSizeExceeded: RPC serialization buffer exceeded the maximum size of 16777216
  #
  # plus every subscription on the tab's multiplexed wire dying with it, which
  # is what blanked the pane in production. The sentinel drops on either side
  # are the collateral check: they are carried by the SAME socket, so if the big
  # drop kills it, the sentinel before it vanishes from the pane and the one
  # after it never arrives. Note the 11 MiB scenario above passes either way —
  # 11 MiB base64-expands to 14.7 MiB, just under the cap — which is precisely
  # why a survey of "largest real frames" missed this path.
  Scenario: a file larger than one wire frame rides chunks, and the socket survives
    When I drop a file named "sentinel-before.md" with content "before the big drop" onto the terminal
    Then the screen state should contain "sentinel-before.md"
    When I drop a 20 MiB file named "huge-bug-repro.webm" onto the terminal
    Then the screen state should contain "huge-bug-repro.webm"
    And the screen state should contain "sentinel-before.md"
    When I drop a file named "sentinel-after.md" with content "after the big drop" onto the terminal
    Then the screen state should contain "sentinel-after.md"
