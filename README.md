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

## Factory operations (`ops/`)

Site manager dashboard (enters stop reasons, QC readings, moves, material loss, labour) and a view-only owner dashboard.
Python 3.10+ standard library only, SQLite storage, WSGI app (`ops/app.py: application`). Starts empty: the manager adds equipment and the target first.
No sensors are connected yet, so every value is marked Manual; AED values appear only after prices are set.

```bash
cd ops
OMNI_OPS_DATA=/path/to/data python3 app.py adduser manager@example.com manager "Site manager"   # asks for a password
OMNI_OPS_DATA=/path/to/data python3 app.py adduser owner@example.com owner "Factory owner"
OMNI_OPS_DATA=/path/to/data python3 app.py serve --port 8780
python3 test_app.py   # API journey tests (temporary data folder)
```

`OMNI_OPS_DATA` holds `ops.db`. Keep it outside the repo and back it up.
