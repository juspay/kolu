# memorable-names

Self-contained ADJ-NOUN random name generator. Word lists are derived from WordNet
and ship checked-in as `words.json` — no env var, no runtime file I/O.

## Usage

```ts
import { randomName } from "memorable-names";

const name = randomName(); // e.g. "bright-falcon"
```

## Regenerating word lists

To rebuild `words.json` from WordNet:

```sh
just regenerate-words
```
