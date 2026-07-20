// The board's data. The shell re-loads this script every 30s.
window.BOARD = {
  "project": "kolu",
  "updated": "2026-07-20",
  "coordinator": "RT-fable-main · bfed2bcb",
  "strip": "Live: CODEC1 (#1901 gauntlet) · LINK1 (#1900 implementing R1–R5) — Held: #1896 pending PWA field repro — Audio on pureintent: repaired (nixos-config#122)",
  "tracks": [
    {
      "name": "codec zombie #1859",
      "nodes": [
        {
          "label": "issue #1859",
          "state": "done",
          "href": "https://github.com/juspay/kolu/issues/1859",
          "title": "one corrupt frame: reader reports dead, keeps listening"
        },
        {
          "label": "RED ✓",
          "state": "done",
          "title": "11a8cc188 — two it.fails pins, codec + serve level"
        },
        {
          "label": "gate ✓",
          "state": "done",
          "title": "3-refuter panel: SOUND ×3, shape SUBSTITUTED — destroy(err)+return beats the settle funnel (3 lines, one fact)"
        },
        {
          "label": "CODEC1",
          "state": "run",
          "title": "PR #1901 draft — /be gauntlet running",
          "lane": {
            "name": "CODEC1",
            "sub": "5a6ecc16",
            "href": "#/t/local/5a6ecc16-3fe8-4ad5-9666-35f4eb61441d",
            "nodes": [
              { "label": "implement ✓", "state": "done" },
              {
                "label": "PR #1901",
                "state": "done",
                "href": "https://github.com/juspay/kolu/pull/1901"
              },
              { "label": "gauntlet", "state": "run" },
              { "label": "CI+evidence", "state": "q" },
              { "label": "merge-ready", "state": "q" }
            ]
          }
        }
      ]
    },
    {
      "name": "deep-link gone-verdict #1900",
      "nodes": [
        {
          "label": "issue #1900",
          "state": "done",
          "href": "https://github.com/juspay/kolu/issues/1900",
          "title": "refresh yanks host + lying 'never existed' toast (field-reproduced on #1896)"
        },
        {
          "label": "RED ✓",
          "state": "done",
          "title": "b7cf6ebe5 — boot-stamp + reattach-window pins"
        },
        {
          "label": "gate ✓",
          "state": "done",
          "title": "panel: primary ratified; secondary REFUTED (reattach ordering backwards ×3) → reshaped inline listIsAuthoritative, verdict-time stamping"
        },
        {
          "label": "LINK1",
          "state": "run",
          "title": "implementing R1–R5, then full /be",
          "lane": {
            "name": "LINK1",
            "sub": "23e4fcf5",
            "href": "#/t/local/23e4fcf5-a29f-413c-8bef-038cdf8aff14",
            "nodes": [
              { "label": "harden REDs", "state": "run", "title": "R3: exact-guard pins, boot-arm anchored" },
              { "label": "implement", "state": "q" },
              { "label": "PR+gauntlet", "state": "q" },
              { "label": "merge-ready", "state": "q" }
            ]
          }
        }
      ]
    },
    {
      "name": "boot wedge #1763 (CLOSED)",
      "nodes": [
        {
          "label": "diagnose ✓",
          "state": "done",
          "title": "not reproduced live; escape-valve coupling pinned"
        },
        {
          "label": "gate ×2 ✓",
          "state": "done",
          "title": "V1 mechanism REFUTED (host-blind anchor); V2 delta-passed"
        },
        {
          "label": "#1898 ✓",
          "state": "done",
          "href": "https://github.com/juspay/kolu/pull/1898",
          "title": "MERGED — one boot deadline, every ceiling finite, honest per-leg escape"
        }
      ]
    },
    {
      "name": "chime #1177 (CLOSED)",
      "nodes": [
        {
          "label": "RED ✓",
          "state": "done",
          "title": "waiting → awaiting_user swallowed"
        },
        {
          "label": "gate ✓",
          "state": "done",
          "title": "episode latch proven minimal; 3 defects caught pre-code"
        },
        {
          "label": "#1894 ✓",
          "state": "done",
          "href": "https://github.com/juspay/kolu/pull/1894",
          "title": "MERGED — ≤1 chime per attention episode; honest 'needs your input' copy"
        }
      ]
    }
  ],
  "queue": [
    {
      "label": "#1896 HELD",
      "state": "wait",
      "href": "https://github.com/juspay/kolu/pull/1896",
      "title": "PWA host memory — held pending field repro of the empty-hash relaunch after LINK1's fix lands; merge re-scoped or close on the outcome"
    },
    {
      "label": "#1893 note",
      "state": "wait",
      "href": "https://github.com/juspay/kolu/pull/1893",
      "title": "pre-2.0 status board (docs-only, /be-exempt)"
    }
  ],
  "shipped": [
    {
      "label": "#1898 boot deadline ✓",
      "href": "https://github.com/juspay/kolu/pull/1898"
    },
    {
      "label": "#1894 chime ✓",
      "href": "https://github.com/juspay/kolu/pull/1894"
    },
    { "label": "#1892 presence-only dialogs ✓" },
    { "label": "#1890 detection ✓" },
    { "label": "#1889 philosophy ✓" },
    { "label": "#1887 squatter ✓" },
    { "label": "#1884+#116 PR1.5 ✓" },
    { "label": "#1880 PR1 ✓" },
    { "label": "10 drishti orphan agents reaped ✓" },
    { "label": "nixos-config#122 audio ✓" }
  ]
};
window.dispatchEvent(new Event('board-data'));
