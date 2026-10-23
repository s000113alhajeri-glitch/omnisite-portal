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

One app for many factories. Each factory has its own equipment, records and logins:
- **OmniSite team** (`admin`): sees and supports every factory, and adds factories and people on the Factories page.
- **Site manager** (per factory, several allowed): enters stop reasons, QC readings, moves, material loss, labour.
- **Owner** (per factory, view only): one owner can belong to several factories and switch between them.

Python 3.10+ standard library only, SQLite storage, WSGI app (`ops/app.py: application`). Every factory starts empty.
No sensors are connected yet, so every value is marked Manual; AED values appear only after prices are set.

```bash
cd ops
OMNI_OPS_DATA=/path/to/data python3 app.py adduser you@omnisite.ae admin "Your Name"   # OmniSite team login, asks for a password
OMNI_OPS_DATA=/path/to/data python3 app.py serve --port 8780
python3 test_app.py   # API journey + factory isolation tests (temporary data folder)
```

`OMNI_OPS_DATA` holds `ops.db`. Keep it outside the repo and back it up.
