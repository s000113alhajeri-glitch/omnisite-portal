# 5. Data strategy

**Rule: one source of truth per fact.** Everything else reads it from there; nothing is typed twice. **[proposal, 2026-11-04]**

| Data | Source of truth | Others |
|---|---|---|
| Factory, machines, labels, positions, nameplates | CRM (approved survey) | Dashboard copies machines from it by label |
| Batches, QC, stops, losses, sensor readings | Factory dashboard (ops.db) | CRM never sees them (privacy rule) |
| Prices, targets | Factory dashboard settings, set after the audit | — |
| Code | GitHub (once private) | Live site deployed from it |

**Shared key:** machine label M-001 (unique per factory).

**Current gap:** machines are typed separately. Chemex has 15 machines in the CRM and 7 in the dashboard, with different names (e.g. "Mixing tank motor" vs "Mixer 1"). Proposed fix: copy machines from the approved survey into the dashboard by label.

**What we learn from the data (her goal):** store weights, mixing time, temperature and QC to learn the recipe that avoids re-mixing; forecast; recommend (QC approves). Compare like-for-like products only.

**Privacy:** the OmniSite team never sees a factory's private data (batches, kg, AED). It sees setup, connection health and support only.
