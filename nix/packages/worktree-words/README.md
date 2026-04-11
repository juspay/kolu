# Worktree Word Lists

POS-tagged word lists for generating random worktree branch names (`ADJ-NOUN`).

Sourced from [WordNet 3.0](https://wordnet.princeton.edu/) (Princeton University),
filtered to common English words:

- **3–6 characters** only (short, readable branch names)
- **tagsense_cnt ≥ 2** (appeared at least twice in WordNet's tagged corpus — filters out obscure/technical terms)

Produces two files:

- `adjectives.txt` — ~430 common adjectives
- `nouns.txt` — ~1260 common nouns

Combined: ~540k possible `ADJ-NOUN` pairs.
