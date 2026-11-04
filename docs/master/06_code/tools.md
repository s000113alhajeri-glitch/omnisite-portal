# Tools

## `omnisite_tools/deploy_pa.py`

Guarded deploy (see [07_guardrails/02_build.md](../07_guardrails/02_build.md)). Needs PA_TOKEN in the environment (never in the file).

```python
"""Guarded deploy to PythonAnywhere (CRM + factory dashboard).

Usage: PA_TOKEN=... python3 deploy_pa.py BASE_DIR LOCAL_DIR file1 [file2 ...]
  BASE_DIR  = folder holding the live copies you started from (same relative paths)
  LOCAL_DIR = folder holding your changed files
  files     = paths relative to /home/omnisite, e.g. omnisite-crm/crm/app.py
Refuses to upload if: a database is in the list, the live file changed since BASE_DIR,
or the fresh database backup fails. After upload it reloads and checks / , /ops/ and headers.
"""
import hashlib, json, os, sqlite3, sys, time, urllib.request
U, HOME, SITE = "omnisite", "/home/omnisite", "https://omnisite.pythonanywhere.com"
API = f"https://www.pythonanywhere.com/api/v0/user/{U}"
TOK = os.environ["PA_TOKEN"]
DBS = ["omnisite-crm-data/crm.db", "omnisite-ops-data/ops.db"]


def req(url, data=None, method=None, headers=None):
    r = urllib.request.Request(url, data=data, method=method, headers={"Authorization": f"Token {TOK}", **(headers or {})})
    with urllib.request.urlopen(r, timeout=60) as x:
        return x.status, x.read()


def live(path):
    return req(f"{API}/files/path{path if path.startswith('/') else HOME + '/' + path}")[1]


def upload(path, data):
    b = "----omni" + hashlib.md5(data).hexdigest()
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"content\"; filename=\"f\"\r\n\r\n").encode() + data + f"\r\n--{b}--\r\n".encode()
    return req(f"{API}/files/path{path if path.startswith('/') else HOME + '/' + path}", body, "POST", {"Content-Type": f"multipart/form-data; boundary={b}"})[0]


def main():
    base, local, files = sys.argv[1], sys.argv[2], sys.argv[3:]
    if not files or any(f.endswith(".db") for f in files):
        sys.exit("STOP: give code files only. Databases are never uploaded.")
    for f in files:
        if hashlib.md5(live(f)).hexdigest() != hashlib.md5(open(os.path.join(base, f), "rb").read()).hexdigest():
            sys.exit(f"STOP: {f} changed on the live site since your copy. Download it and merge first.")
    bdir = os.path.expanduser(f"~/omnisite_backups/{time.strftime('%Y%m%d_%H%M%S')}")
    os.makedirs(bdir)
    for d in DBS:
        p = os.path.join(bdir, os.path.basename(d))
        open(p, "wb").write(live(d))
        if sqlite3.connect(p).execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            sys.exit(f"STOP: backup of {d} failed the integrity check.")
    print("Backup ok:", bdir)
    for f in files:
        print("upload", f, upload(f, open(os.path.join(local, f), "rb").read()))
    print("reload", req(f"{API}/webapps/{U}.pythonanywhere.com/reload/", b"", "POST")[0])
    time.sleep(5)
    bad = []
    for u in ("/", "/ops/"):
        with urllib.request.urlopen(SITE + u, timeout=30) as x:
            ok = x.status == 200 and x.headers.get("X-Frame-Options") == "DENY"
            print(u, x.status, "headers ok" if ok else "HEADERS MISSING")
            bad += [] if ok else [u]
    sys.exit(f"CHECK FAILED on {bad}: roll back with the files in {base}" if bad else 0)


if __name__ == "__main__":
    main()

```
