# OmniSite portal

## CRM (`crm/`)

Audit-first CRM: consultation → operational audit (8 points) → baseline → pilot → result.
Python 3.10+ standard library only, SQLite storage, WSGI app (`crm/app.py: application`).

```bash
cd crm
OMNI_CRM_DATA=/path/to/data python3 app.py adduser you@example.com "Your Name"   # asks for a password
OMNI_CRM_DATA=/path/to/data python3 app.py serve --port 8770
```

`OMNI_CRM_DATA` holds `crm.db` and uploaded files. Keep it outside the repo and back it up.
Any WSGI host works (e.g. PythonAnywhere: point the WSGI file at `crm/app.py` and import `application`).
