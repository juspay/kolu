Feature: OSC 52 clipboard writes
  xterm's OSC 52 handler decodes the base64 payload and writes it to the
  system clipboard. Works in secure contexts via navigator.clipboard and
  falls back to document.execCommand when navigator.clipboard is unavailable
  (non-secure HTTP contexts) or rejects.

  Background:
    Given the terminal is ready

  Scenario: OSC 52 writes to the clipboard via navigator.clipboard
    When I run "printf '\x1b]52;c;aGVsbG8tc2VjdXJl\x07'"
    Then the clipboard should contain "hello-secure"
    And there should be no page errors

  Scenario: OSC 52 falls back to execCommand when navigator.clipboard is unavailable
    When I disable navigator.clipboard.writeText
    And I run "printf '\x1b]52;c;aGVsbG8tZmFsbGJhY2s=\x07'"
    Then the clipboard should contain "hello-fallback"
    And there should be no page errors
