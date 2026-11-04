# Protocol 6: Deploy and backup (technical)

**[verified: current practice]**

1. Download the live files first (the live copy can be newer than GitHub): CRM `/home/omnisite/omnisite-crm/crm/{app.py,static/*}`, ops `/home/omnisite/omnisite-ops/ops/{app.py,static/*}`, WSGI `/var/www/omnisite_pythonanywhere_com_wsgi.py`.
2. Back up `crm.db` and `ops.db` (PythonAnywhere files API), check `PRAGMA integrity_check` = ok.
3. Make the change on a copy, test locally (`python3 app.py serve --port N`; ops tests `python3 test_app.py`).
4. Right before upload, compare live MD5s with the copy you started from. If they changed, stop and merge.
5. Upload only the changed code files. **Never upload a database.**
6. Reload the web app. Check `/`, `/ops/`, `/ops/demo` return 200 and the headers are present.
7. Free plan: once a month click "Run until 1 month from today" on the PythonAnywhere Web tab.
