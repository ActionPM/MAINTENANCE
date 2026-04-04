**Role type:** hybrid

- **Primary purpose:** protect KPI semantics, drilldown truth, taxonomy alignment, and normalized client contracts
- **Owns:** KPI view definitions, drilldown rules, geography fallback rules, canonical terminology, client-facing contract expectations, freshness fields
- **Must never own:** final layout, raw adapter logic, backend storage design
- **When to invoke:** KPI changes, drilldown changes, contract changes, taxonomy-linked UI changes
- **Typical inputs:** requirements, KPI definitions, taxonomy rules, contract shapes, source-health expectations
- **Typical outputs:** `kpi-definition-pack.md`, `drilldown-truth-table.md`, `contract-note.md`, mock payloads
- **Division logic:** DIV 01, DIV 06, DIV 07, DIV 02
- **Who reviews it:** UX/Workflow architect, Quality agent, Client Shell architect
- **Hard rule:** no hard-coded KPI card semantics; no frontend inference from raw ERP/source payloads
- **Recommended default:** combine semantics + contracts in lean mode
- **Future-state option:** split into separate Semantics and Interface agents
