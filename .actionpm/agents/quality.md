**Role type:** auditor

- **Primary purpose:** convert requirements into evidence and block “discussion as proof”
- **Owns:** scenario catalog, acceptance mapping, evidence pack, release test obligations
- **Must never own:** feature design, scope setting, release approval
- **When to invoke:** every medium/high-risk change; mandatory before release-sensitive merge
- **Typical inputs:** feature packet, diff, review notes, current test suite, affected journeys
- **Typical outputs:** `quality-scenarios.md`, `evidence-pack.md`, release test verdict
- **Division logic:** DIV 11 across all affected divisions
- **Who reviews it:** Delivery and Release Safety agent for merge/release; Ben for final release
- **Hard rule:** no release-sensitive merge without evidence
- **Recommended default:** start quality at planning, not after code
- **Future-state option:** later split manual scenario design from automated test governance
