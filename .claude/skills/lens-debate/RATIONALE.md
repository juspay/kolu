# Why the lens stage has this shape

Background for anyone *editing* `SKILL.md`. A run doesn't need this file —
the protocol in `SKILL.md` is self-contained.

The value comes from the **fan-out**, not from resolution machinery. On the
gauntlet run over kolu #1975 every finding worth having — a relay self-bind fd
explosion, an Ink screen-ownership fix, a selection-clamp race — came out of a
review stage. None came out of debate resolution. Meanwhile the debate protocol
was explicitly unbounded ("no round cap, no deadlock exit") and spent minutes per
round across three agents on a modest diff: a latency hazard bought nothing.

And the genuinely contested structural calls in that feature were not settled by
lens consensus at all. They were settled by **measurement** (SIGKILL a mux client
and watch whether its forward survives; time `netstat` against `lsof`) or by a
**human** making a scope call in a couple of minutes. So this skill spends its
budget on independent reading, and routes the rest to evidence or to the person
who owns the decision.

Three things from the older engine are load-bearing and survive intact:

- **Independent review.** Neither lens sees the other's findings before forming
  its own, and neither is handed a curated list to react to. A first cut fed
  hickey a pre-curated "lowy finding" to rebut and it concluded *drop*; running
  the reviews independently made hickey raise the same issue on its own and flip
  to *fix* (#1109). Curation biases the outcome.
- **Both lenses run on Opus**, overriding their `model: sonnet` frontmatter —
  every lens *judgment* is an Opus judgment.
- **The lowy lens runs Löwy's electricity probe** (#1111) — not a second voice,
  the same volatility vote with a sharper question.
