# 4. Systems (what is built and live)

One PythonAnywhere web app (account `omnisite`, free plan) serves both systems through one WSGI dispatcher. **[verified]**

| | CRM | Factory dashboard (ops) |
|---|---|---|
| URL | https://omnisite.pythonanywhere.com/ | https://omnisite.pythonanywhere.com/ops/ |
| Users | Salamah + OmniSite engineers | Factory owners, site managers; OmniSite team (support only) |
| Code (live) | /home/omnisite/omnisite-crm/crm/ | /home/omnisite/omnisite-ops/ops/ |
| Data | /home/omnisite/omnisite-crm-data/crm.db + files | /home/omnisite/omnisite-ops-data/ops.db |
| Tech | Python standard library WSGI + SQLite + vanilla JS | same |

## CRM features **[verified: code]**
- 12 pipeline stages: Consultation request → Consultation done → Operational audit → Baseline report sent → NDA signed → Scope of work & responsibilities → Pilot proposal sent → Pilot agreement signed → Ready to install → Live → 2-week recording done → Pilot result.
- Consultation captures the pain, production manager, P&ID, maintenance focal point, electrical engineer; site info (site manager, access, Google Maps).
- Follow-ups feed Google Calendar via a private .ics link.
- Engineer jobs (one role per engineer): Site survey, Delivery, Installation, Maintenance. Each job is Send for review → Salamah approves or sends back.
- Site survey: production lines with steps + photos, equipment with machine labels (M-/T-/F-/P-/A-), nameplate photo, AI nameplate reading, halls in cm from corner A1, positions / sizes / heights in cm, 3D twin, nearest power + cable estimate, 6 engineering files (E-01..E-04, install plan, schematic) due 3 working days after the visit.
- Readiness gates: survey approved + scope meeting + down payment + install crew before delivery / install jobs can be sent.
- Assets: QR labels (normal and small), statuses In stock / Delivered / Installed / Faulty / Returned, "Goes on machine".
- Delivery: scan before dispatch and after delivery; the install engineer gets a red "Go to the site now" banner.
- Installation: 6 locked stages with Pass / Fail checks and evidence; scan machine label then each asset.
- Purchases (OmniSite → supplier), Approvals inbox, Support (engineers), Try as engineer (Practice factory).

## Factory dashboard features **[verified: code]**
- Owner view: one light (OK / Waiting / Needs attention), machine tiles, the 3D twin, output, quality, money lost, why equipment stopped. View only.
- Manager view: Overview (3D twin, batches, downtime, alerts, needs action), Batches, Downtime, Costs, Equipment.
- Records: batches (MX1-YYYYMMDD-##), QC (pH + viscosity), stops with reasons, material loss, scales per mixer.
- Values always show their source (Manual / Estimate / Sensor) and time; empty = "Not recorded", never 0.
- Gateway-ready: POST /ops/api/ingest with a per-factory gateway key; Connections page maps tags (Altivar FD00 ×0.01 Hz, FE76 Wh ×0.001).
- OmniSite team sees only Support, Connections, Factories: never batches or money (enforced on the server).
- Equipment kinds: Mixer, Holding tank, Scale, QC equipment, Pump, Filling machine, Gateway, Other. Stop reasons: Drive fault, Waiting for material, Waiting for QC, Cleaning, Planned maintenance, Power cut, Other.

## 3D digital twin **[verified: live 2026-11-04]**
- In the CRM survey: blue hologram twin from survey positions (360°, top view, compass, markers, cable estimate).
- In the factory dashboard: realistic 3D (Three.js r147, steel tanks with motors, fillers, scales, QC bench). Each machine's ring and tag show live status: green running, grey idle / not connected, red stopped / fault. Tap = status + batch. Layout is an example until survey positions feed it.

## AI **[verified]**
- Nameplate reader: photo → OpenAI gpt-4o → kind, name, model, rating, ports. Leaves unreadable fields empty. Engineer confirms or edits.
- Guards: 100 photos / day limit, every call logged (time, user, job, tokens, ms), prompt-injection rule, output cleaned.
- No RAG yet.
