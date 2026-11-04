# 2. Build and deploy guardrails

| # | Rule | How |
|---|---|---|
| 1 | Download the live files first; the live copy can be newer than GitHub | Enforced: deploy script stops if the live file changed since your copy |
| 2 | Fresh backup of crm.db and ops.db before every deploy, integrity-checked | Enforced: deploy script |
| 3 | Databases are never uploaded | Enforced: deploy script refuses .db files |
| 4 | After deploy: / and /ops/ must load with security headers | Enforced: deploy script checks and says how to roll back |
| 5 | Change only what was asked; no unrelated rewrites | Policy |
| 6 | Test locally first (ops: python3 test_app.py) | Policy |
| 7 | One session deploys at a time | Policy |
| 8 | Keys never in code, logs, chat or GitHub | Policy + secret scan (to add in CI) |
| 9 | No AI agent or script may delete live data or databases | Policy |
| 10 | Code repo private; backups only in a private place | To do: make omnisite-portal private |
| 11 | Staging copy for risky changes | To do |
| 12 | Rotate the PythonAnywhere token if it was ever exposed | Policy |

Deploy script: `omnisite_tools/deploy_pa.py` (see [06_code/tools.md](../06_code/tools.md)).
