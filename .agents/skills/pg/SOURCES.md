# Sources & method

The `pg` skill was built by scraping a diverse sample of Paul Graham's essays from <https://paulgraham.com/articles.html> (via `curl`), analyzing each one for *how* it is written (openings, sentence rhythm, diction, rhetorical moves, endings), and synthesizing a cross-essay voice model plus an anti-AI ruleset. This file records what was sampled so the model is auditable and refreshable.

## Essays sampled (18)

- [How to Start a Startup](https://paulgraham.com/start.html)
- [Do Things that Don't Scale](https://paulgraham.com/ds.html)
- [The Age of the Essay](https://paulgraham.com/essay.html)
- [Write Like You Talk](https://paulgraham.com/talk.html)
- [Writing, Briefly](https://paulgraham.com/writing44.html)
- [Life is Short](https://paulgraham.com/vb.html)
- [How to Do Philosophy](https://paulgraham.com/philosophy.html)
- [How to Do What You Love](https://paulgraham.com/love.html)
- [Hackers and Painters](https://paulgraham.com/hp.html)
- [Beating the Averages](https://paulgraham.com/avg.html)
- [The Hundred-Year Language](https://paulgraham.com/hundred.html)
- [What You Can't Say](https://paulgraham.com/say.html)
- [How to Disagree](https://paulgraham.com/disagree.html)
- [Keep Your Identity Small](https://paulgraham.com/identity.html)
- [Why Nerds are Unpopular](https://paulgraham.com/nerds.html)
- [What You'll Wish You'd Known](https://paulgraham.com/hs.html)
- [How to Do Great Work](https://paulgraham.com/greatwork.html)
- [Maker's Schedule, Manager's Schedule](https://paulgraham.com/makersschedule.html)

## Voice model (distilled)

He sounds like a smart friend explaining something at a bar, not a writer performing. The trick is that he reasons out loud in front of you: he starts from one plain observation, hits a snag, corrects himself, and lands on a claim that feels like a discovery you made together rather than a thesis he came in with. The prose is mostly short, flat, Anglo-Saxon sentences, and the few vivid or crude words (suck, bullshit, fossilized inspiration) land harder because everything around them is so plain. He's constantly conceding the obvious objection, then turning it over — "Maybe, but probably not" — which makes the bold claims feel earned instead of arrogant. He talks straight to "you," hedges with "I think" and "my guess is" exactly where a lesser writer would bluff, and grounds every abstraction in something physical: a leaking roof, 52 weekends, a hand-crank engine. And he keeps reducing big mysterious things to a single mundane sentence — that's the whole move.

## Refreshing the model

Re-run the `pg-style-model` workflow (it curls the index, picks a diverse set, analyzes each essay in parallel, and re-synthesizes the voice model + anti-AI tells). Then regenerate the runtime skill dirs with `just ai::apm`.
