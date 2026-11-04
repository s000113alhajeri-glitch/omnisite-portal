# 3. Data guardrails

| # | Rule | How |
|---|---|---|
| 1 | One source of truth per fact (see data strategy) | Policy |
| 2 | Each factory sees only its own data | Enforced on the server |
| 3 | OmniSite team never sees factory batches, kg or AED | Enforced on the server |
| 4 | Owners are view only; only OmniSite adds equipment; nobody switches machines from OmniSite | Enforced |
| 5 | Every value shows its source (Manual / Estimate / Sensor) and time; empty = "Not recorded", never 0 | Enforced in the UI |
| 6 | Example / demo data is always labelled as example | Policy + "EXAMPLE data" in the demo factory name |
| 7 | Never stored: plain passwords (hashed only), bank / card numbers, ID copies, faces on purpose | Policy |
| 8 | Site photos: nameplates and equipment only; avoid people | Policy |
| 9 | Uploads ≤ 25 MB, AI photos ≤ 8 MB | Enforced |
| 10 | Retention period | **Decision needed from Salamah** (proposal: end of contract + 2 years, then delete or hand back) |
| 11 | Backups: daily, offsite, restore tested monthly | To do |
| 12 | Personal data list + processors in the PDPL checklist | See [02_legal/03_pdpl.md](../02_legal/03_pdpl.md) |
