# Hosting: WSGI dispatcher

File /var/www/omnisite_pythonanywhere_com_wsgi.py. Serves the CRM at / and the dashboard at /ops/, and adds security headers.

## `wsgi.py`

```python
"""PythonAnywhere WSGI file: CRM at /, factory operations at /ops/ (one free web app).
Copy to /var/www/<user>_pythonanywhere_com_wsgi.py and set HOME_DIR below."""
import importlib.util
import os

HOME_DIR = os.environ.get("OMNI_HOME", "/home/omnisite")
os.environ.setdefault("OMNI_CRM_DATA", f"{HOME_DIR}/omnisite-crm-data")
os.environ.setdefault("OMNI_OPS_DATA", f"{HOME_DIR}/omnisite-ops-data")
os.makedirs(os.path.join(os.environ["OMNI_CRM_DATA"], "files"), exist_ok=True)


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.application


crm = _load("omni_crm_app", os.environ.get("OMNI_CRM_APP", f"{HOME_DIR}/omnisite-crm/crm/app.py"))
ops = _load("omni_ops_app", os.environ.get("OMNI_OPS_APP", f"{HOME_DIR}/omnisite-ops/ops/app.py"))


SECURITY_HEADERS = [("Strict-Transport-Security", "max-age=31536000"), ("X-Frame-Options", "DENY"),
                    ("Referrer-Policy", "strict-origin-when-cross-origin")]


def application(environ, start_raw):
    def start(status, headers, exc_info=None):
        have = {k.lower() for k, _ in headers}
        return start_raw(status, list(headers) + [h for h in SECURITY_HEADERS if h[0].lower() not in have], exc_info)
    path = environ.get("PATH_INFO", "/")
    if path == "/ops":
        start("301 Moved Permanently", [("Location", "/ops/"), ("Content-Length", "0")])
        return [b""]
    if path.startswith("/ops/"):
        environ["SCRIPT_NAME"] = environ.get("SCRIPT_NAME", "") + "/ops"
        environ["PATH_INFO"] = path[4:]
        return ops(environ, start)
    return crm(environ, start)

```

