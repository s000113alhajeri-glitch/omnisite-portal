# 6. Security status

Checked against Digit88 "Building with AI and Scaling Infrastructure the Right Way" (NEXUS Incubator). **[verified: code review 2026-11-04]**

| Area | Status |
|---|---|
| Login lockout (5 wrong tries → 15 min) | Done, live (CRM + dashboard) |
| Security headers (HSTS, X-Frame-Options, Referrer-Policy, nosniff) | Done, live |
| Passwords ≥ 10 characters | Already in place |
| AI: daily cap, call log, prompt-injection rule, output cleaning | Done, live |
| AI: second provider, test set run on every change | Test set: to do; second provider needs a key |
| Factory data isolation + team privacy | Done (server-side) |
| Keys outside the code | Done (OpenAI key in data folder) |
| Offsite automatic backups + tested restore | To do (needs a private repo) |
| Uptime / error alerts | To do |
| Code in version control matching live | To do (live is newer than GitHub) |
| Automated tests + secret scan on every change | To do |
| Staging before live | To do |
| One token for everything (PythonAnywhere) | Risk: PythonAnywhere gives one token per account; rotate it |
| OpenAI spend limit | Salamah sets it in her OpenAI account |
| UAE PDPL checklist | See [02_legal/03_pdpl.md](../02_legal/03_pdpl.md) |
| RAG security | Not applicable yet (no RAG) |

Rules: never print or commit keys; back up crm.db and ops.db before any change; check / and /ops/ after every deploy.
