---
name: feedback_hickey_essential
description: Never assume complexity is "essential" in Hickey evaluations — reason from first principles first
type: feedback
---

Never dismiss Hickey findings as "essential complexity" without first designing what the simplified version would look like. Assume existing code patterns came from incompetent programmers. Reason from first principles: write out what the Hickey-simplified result would be, THEN evaluate whether the current approach is justified.

**Why:** User corrected a lazy Hickey evaluation that hand-waved findings as "acceptable" and "essential" without actually exploring alternatives.

**How to apply:** For every Hickey finding, no matter how minor it seems, sketch the concrete simplified alternative before assessing severity. "This is fine" is not an evaluation — "here's what simpler would look like, and here's why we'd choose it or not" is.
