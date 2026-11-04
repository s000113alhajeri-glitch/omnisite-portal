# UAE PDPL checklist (first pass)

Federal Decree-Law 45/2021 (PDPL). **[assumption: first pass, lawyer to confirm applicability and current regulations]**

| # | Question | OmniSite today |
|---|---|---|
| 1 | What personal data do we keep? | CRM: factory contacts (names, phones, emails), engineer and user accounts, photos from sites. Dashboard: user names / emails, who entered each record |
| 2 | Legal basis / consent | Contract with the factory; add a consent line to the consultation form for contacts |
| 3 | Purpose limit | Only for the survey, pilot and support |
| 4 | Who can see it | Roles enforced on the server; OmniSite team can't see factory records |
| 5 | Where it is stored | PythonAnywhere (outside the UAE): check cross-border transfer rules |
| 6 | How long it is kept | Not defined yet: set a retention period (e.g. end of contract + N years) |
| 7 | Security | Hashed passwords, lockout, HTTPS + HSTS, backups (offsite to do) |
| 8 | Breach response | Write who to notify and how fast |
| 9 | Access / delete requests | Write how a person asks and who answers |
| 10 | Processors | PythonAnywhere (hosting), OpenAI (photos for nameplate reading), GitHub (code) |
| 11 | Photos | Avoid faces in site photos; nameplates only |
