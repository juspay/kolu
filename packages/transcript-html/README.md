# kolu-transcript-html

Renders a `Transcript` to one self-contained HTML file you can open or share.
Styles and the one script are inlined, so the export is a single document with
no assets beside it. One entry: `.` (`src/index.tsx`).

## What it exports

- `transcriptToHtml(transcript, { mode })` returns the document as a string.
- `TranscriptHtmlOptions`, and `TranscriptHtmlMode` re-exported from
  `kolu-transcript-core`.

`mode` is `chat` (the visible conversation) or `full` (the same conversation
plus collapsed tool and reasoning detail).

The package reads `src/styles.css` and `src/script.js` from disk beside the
module at render time and inlines them.

## Who uses it

`padi` (its transcript export route) and `packages/server`. It depends on
`kolu-transcript-core`, `@kolu/html-escape` and `marked`.

## What not to break

- Raw HTML in a message is escaped to literal text. A shared export otherwise
  carries whatever markup an agent or a user typed, which is stored
  cross-site scripting for whoever opens the file.
- `chat` mode omits non-conversation payloads rather than hiding them with
  CSS. Hidden content is still file weight.
- The prompt-jump navigation and its script are one feature behind one
  threshold: at least two human messages. Both appear together or neither
  does.
- The document uses no custom elements and ships no syntax highlighting
  payload.

`packages/server/src/exportTranscriptHtml.test.ts` covers the modes and the
escaping.
