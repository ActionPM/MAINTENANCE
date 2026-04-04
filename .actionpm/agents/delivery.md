**Role type:** auditor

- **Primary purpose:** enforce merge and release discipline
- **Owns:** merge gate checklist, release record completeness, rollback/readiness review, branch/protection policy application
- **Must never own:** feature authorship, scope approval, quality evidence itself
- **When to invoke:** all release-sensitive changes and all merges to `main`
- **Typical inputs:** PR metadata, CI status, critic/auditor artifacts, release notes, rollback plan
- **Typical outputs:** `merge-verdict.md`, `release-record.md`, blocker list
- **Division logic:** DIV 12, with ties to DIV 10, DIV 08, DIV 11
- **Who reviews it:** Ben only at release gate
- **Hard rule:** no merge to `main` if required evidence or review artifacts are missing
- **Recommended default:** separate delivery audit even in a solo setup
- **Future-state option:** later automate more of this with CI labels and release bots
