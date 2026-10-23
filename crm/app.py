"""OmniSite CRM: consultation → operational audit → baseline → pilot → result.

WSGI app (Python standard library only) with SQLite storage.
Run locally:  python3 app.py serve --port 8770
Add a user:   python3 app.py adduser EMAIL NAME
"""
import datetime as dt
import getpass
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import uuid
from http.cookies import SimpleCookie
from urllib.parse import parse_qs, quote

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("OMNI_CRM_DATA", os.path.join(HERE, "data"))
DB = os.path.join(DATA, "crm.db")
FILES = os.path.join(DATA, "files")
STATIC = os.path.join(HERE, "static")
MAX_UPLOAD = 25 * 1024 * 1024
SESSION_DAYS = 30

STAGES = [
    "Consultation request", "Consultation done", "NDA signed", "Operational audit",
    "Baseline report sent", "Pilot proposal sent", "Pilot agreement signed",
    "Ready to install", "Live", "2-week recording done", "Pilot result",
]
NEXT_STEP = {
    1: "Hold the consultation", 2: "Get the NDA signed", 3: "Book the audit site visit",
    4: "Finish the audit and the baseline", 5: "Send the pilot proposal",
    6: "Get the pilot agreement signed", 7: "Order hardware and book the engineer",
    8: "Install day", 9: "Record for 2 weeks", 10: "Review results with the owner",
    11: "Decide: continue or stop",
}
AUDIT_POINTS = [
    "Where material is lost, wasted, or overused",
    "Where batches are remixed, delayed, rejected, or inconsistent",
    "How operators record quantities, timing, temperature, mixing, and quality checks",
    "Where people wait for approvals, information, materials, or equipment",
    "The actual time for each batch step and each handover",
    "Energy, water, raw-material, labour, rework, and downtime cost",
    "Which equipment already has data, sensors, PLC/SCADA, scales, or manual logs",
    "Who owns each decision: operator, supervisor, quality, maintenance, production manager, finance",
]
# area, business impact, OmniSite opportunity, audit point that feeds the evidence
BASELINE = [
    ("Material use", "Waste and cost leakage", "Digital batch records and variance alerts", 1),
    ("Mixing", "Rework and quality risk", "Timers, operator prompts, process monitoring", 2),
    ("Batch tracking", "Delayed investigations and weak traceability", "Real-time digital logs", 3),
    ("Downtime", "Lost production capacity", "Downtime categorisation and alerts", None),
    ("Energy", "Hidden operational cost", "Sub-metering and energy-per-batch insight", 6),
]
EMIRATES = ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"]
EDITABLE = {
    "name", "emirate", "contact_name", "phone", "email", "introduced_by", "industry", "pain",
    "next_step", "next_due", "audit_fee", "audit_fee_aed", "nda_on_paper", "audit_date",
    "proposal_scope", "start_date", "term", "hw_ordered", "engineer_booked", "owner_ok_stop",
    "install_date", "recording_note", "follow_up", "customer_with",
}
SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  pw TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS factories(id INTEGER PRIMARY KEY, name TEXT NOT NULL, emirate TEXT NOT NULL,
  contact_name TEXT NOT NULL, phone TEXT NOT NULL, phone_key TEXT NOT NULL, email TEXT DEFAULT '',
  introduced_by TEXT DEFAULT '', industry TEXT DEFAULT '', pain TEXT DEFAULT '',
  stage INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'active',
  next_step TEXT DEFAULT '', next_due TEXT DEFAULT '',
  audit_fee TEXT DEFAULT '', audit_fee_aed TEXT DEFAULT '', nda_on_paper INTEGER DEFAULT 0,
  audit_date TEXT DEFAULT '', top_area TEXT DEFAULT '', proposal_scope TEXT DEFAULT '',
  start_date TEXT DEFAULT '', term TEXT DEFAULT '', hw_ordered INTEGER DEFAULT 0,
  engineer_booked INTEGER DEFAULT 0, owner_ok_stop INTEGER DEFAULT 0, install_date TEXT DEFAULT '',
  recording_note TEXT DEFAULT '', lost_reason TEXT DEFAULT '', lost_stage INTEGER, follow_up TEXT DEFAULT '',
  customer_with TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(factory_id INTEGER NOT NULL, point INTEGER NOT NULL, answer TEXT NOT NULL,
  updated_at TEXT NOT NULL, PRIMARY KEY(factory_id, point));
CREATE TABLE IF NOT EXISTS baseline(id INTEGER PRIMARY KEY, factory_id INTEGER NOT NULL, area TEXT NOT NULL,
  evidence TEXT DEFAULT '', impact TEXT DEFAULT '', opportunity TEXT DEFAULT '', audit_point INTEGER,
  sort INTEGER NOT NULL, UNIQUE(factory_id, area));
CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY, factory_id INTEGER NOT NULL, stage INTEGER NOT NULL,
  name TEXT NOT NULL, stored TEXT NOT NULL, size INTEGER NOT NULL, kind TEXT DEFAULT '', user_id INTEGER,
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, factory_id INTEGER NOT NULL, at TEXT NOT NULL,
  user_id INTEGER, kind TEXT NOT NULL, to_stage INTEGER, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ev_f ON events(factory_id);
"""


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def today():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=4))).date().isoformat()  # UAE time


def db():
    os.makedirs(FILES, exist_ok=True)
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA journal_mode=WAL")
    return c


def init():
    with db() as c:
        c.executescript(SCHEMA)


def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200_000).hex()
    return f"{salt}${h}"


def check_pw(pw, stored):
    salt, _ = stored.split("$", 1)
    return hmac.compare_digest(hash_pw(pw, salt), stored)


def phone_key(p):
    d = re.sub(r"\D", "", p or "")
    if d.startswith("00"):
        d = d[2:]
    if d.startswith("0"):
        d = "971" + d[1:]
    return d


class HTTPError(Exception):
    def __init__(self, status, msg, extra=None):
        super().__init__(msg)
        self.status, self.msg, self.extra = status, msg, extra or {}


def need(cond, msg, status=400, **extra):
    if not cond:
        raise HTTPError(status, msg, extra)


def log(c, fid, uid, kind, text, to_stage=None):
    c.execute("INSERT INTO events(factory_id,at,user_id,kind,to_stage,text) VALUES(?,?,?,?,?,?)",
              (fid, now(), uid, kind, to_stage, text))


def get_factory(c, fid):
    f = c.execute("SELECT * FROM factories WHERE id=?", (fid,)).fetchone()
    need(f, "This factory was not found. It may have been removed.", 404)
    return f


def audit_map(c, fid):
    return {r["point"]: r["answer"] for r in c.execute("SELECT point,answer FROM audit WHERE factory_id=?", (fid,))}


def baseline_rows(c, fid, audit=None):
    audit = audit if audit is not None else audit_map(c, fid)
    rows = []
    for r in c.execute("SELECT * FROM baseline WHERE factory_id=? ORDER BY sort,id", (fid,)):
        d = dict(r)
        d["from_audit"] = audit.get(r["audit_point"], "") if r["audit_point"] else ""
        d["evidence_used"] = d["evidence"].strip() or d["from_audit"].strip()
        rows.append(d)
    return rows


def missing_for(c, f, target):
    """What must be filled before a factory can move to stage `target`."""
    fid, miss = f["id"], []
    if target == 2 and not f["pain"].strip():
        miss.append("The pain they describe")
    if target == 3 and not f["nda_on_paper"] and not c.execute(
            "SELECT 1 FROM files WHERE factory_id=? AND kind='nda'", (fid,)).fetchone():
        miss.append("NDA file, or tick “Signed on paper”")
    if target == 4 and not f["audit_date"]:
        miss.append("Audit site visit date")
    if target == 5:
        a = audit_map(c, fid)
        for i, p in enumerate(AUDIT_POINTS, 1):
            if not a.get(i, "").strip():
                miss.append(f"Audit point {i}: {p}")
        if not f["top_area"]:
            miss.append("Top pain point (pick a row in the baseline)")
        else:
            row = next((r for r in baseline_rows(c, fid, a) if r["area"] == f["top_area"]), None)
            if row and not row["evidence_used"]:
                miss.append(f"Evidence for the top pain point ({f['top_area']})")
    if target == 6 and not f["proposal_scope"].strip():
        miss.append("Minimum pilot scope")
    if target == 7:
        if not f["start_date"]:
            miss.append("Pilot start date")
        if not f["term"].strip():
            miss.append("Pilot term")
    if target == 8:
        for k, label in (("hw_ordered", "Hardware ordered"), ("engineer_booked", "Engineer booked"),
                         ("owner_ok_stop", "Owner OK for the short stop")):
            if not f[k]:
                miss.append(label)
    if target == 9 and not f["install_date"]:
        miss.append("Install date")
    if target == 10 and not f["recording_note"].strip():
        miss.append("Result compared with the audit baseline")
    return miss


def factory_full(c, f):
    fid = f["id"]
    a = audit_map(c, fid)
    users = {r["id"]: r["name"] for r in c.execute("SELECT id,name FROM users")}
    d = dict(f)
    d["audit"] = [{"point": i, "question": q, "answer": a.get(i, "")} for i, q in enumerate(AUDIT_POINTS, 1)]
    d["baseline"] = baseline_rows(c, fid, a)
    d["files"] = [dict(r) | {"by": users.get(r["user_id"], "")} for r in
                  c.execute("SELECT id,stage,name,size,kind,user_id,created_at FROM files WHERE factory_id=? ORDER BY id DESC", (fid,))]
    d["events"] = [dict(r) | {"by": users.get(r["user_id"], "")} for r in
                   c.execute("SELECT * FROM events WHERE factory_id=? ORDER BY id DESC", (fid,))]
    d["missing"] = missing_for(c, f, f["stage"] + 1) if f["status"] == "active" and f["stage"] < 11 else []
    return d


def summary(c, f):
    d = {k: f[k] for k in ("id", "name", "emirate", "contact_name", "phone", "stage", "status", "next_step",
                           "next_due", "top_area", "lost_reason", "lost_stage", "follow_up", "updated_at",
                           "customer_with", "audit_date", "start_date", "install_date")}
    d["audit_done"] = c.execute("SELECT COUNT(*) FROM audit WHERE factory_id=? AND trim(answer)<>''",
                                (f["id"],)).fetchone()[0]
    return d


# ---------------- API handlers ----------------

def api(c, method, path, body, user, q):
    uid = user["id"]
    m = re.fullmatch(r"/api/factories/(\d+)(/.*)?", path)
    fid, sub = (int(m.group(1)), m.group(2) or "") if m else (None, None)

    if path == "/api/meta" and method == "GET":
        return {"stages": STAGES, "audit_points": AUDIT_POINTS, "emirates": EMIRATES,
                "baseline_areas": [b[0] for b in BASELINE], "today": today()}

    if path == "/api/factories" and method == "GET":
        return {"factories": [summary(c, f) for f in c.execute("SELECT * FROM factories ORDER BY updated_at DESC")]}

    if path == "/api/factories" and method == "POST":
        req = {"name": "Factory name", "emirate": "Emirate", "contact_name": "Contact name", "phone": "Phone"}
        miss = [label for k, label in req.items() if not str(body.get(k, "")).strip()]
        need(not miss, "Please fill: " + ", ".join(miss), fields=[k for k in req if not str(body.get(k, "")).strip()])
        pk = phone_key(body["phone"])
        need(len(pk) >= 7, "Please check the phone number.", fields=["phone"])
        dup = c.execute("SELECT id,name FROM factories WHERE phone_key=? OR lower(trim(name))=lower(trim(?))",
                        (pk, body["name"])).fetchone()
        need(not dup, f"{dup['name']} is already in the CRM." if dup else "", 409,
             existing_id=dup["id"] if dup else None)
        t = now()
        cur = c.execute(
            "INSERT INTO factories(name,emirate,contact_name,phone,phone_key,email,introduced_by,industry,pain,"
            "next_step,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (body["name"].strip(), body["emirate"].strip(), body["contact_name"].strip(), body["phone"].strip(), pk,
             body.get("email", "").strip(), body.get("introduced_by", "").strip(), body.get("industry", "").strip(),
             body.get("pain", "").strip(), NEXT_STEP[1], t, t))
        new = cur.lastrowid
        for i, (area, impact, opp, ap) in enumerate(BASELINE):
            c.execute("INSERT INTO baseline(factory_id,area,impact,opportunity,audit_point,sort) VALUES(?,?,?,?,?,?)",
                      (new, area, impact, opp, ap, i))
        log(c, new, uid, "create", "Consultation request added", 1)
        return {"factory": factory_full(c, get_factory(c, new))}

    if fid is not None:
        f = get_factory(c, fid)

        if sub == "" and method == "GET":
            return {"factory": factory_full(c, f)}

        if sub == "" and method == "PATCH":
            sets = {k: v for k, v in body.items() if k in EDITABLE}
            need(sets, "Nothing to save.")
            for k in ("name", "emirate", "contact_name", "phone"):
                if k in sets:
                    need(str(sets[k]).strip(), "This field is required.", fields=[k])
            if "phone" in sets:
                pk = phone_key(sets["phone"])
                need(len(pk) >= 7, "Please check the phone number.", fields=["phone"])
                d = c.execute("SELECT name FROM factories WHERE phone_key=? AND id<>?", (pk, fid)).fetchone()
                need(not d, f"This phone is already used by {d['name'] if d else ''}.", 409, fields=["phone"])
                sets["phone_key"] = pk
            for k in ("next_due", "audit_date", "start_date", "install_date", "follow_up"):
                if sets.get(k):
                    need(re.fullmatch(r"\d{4}-\d{2}-\d{2}", sets[k]), "Please pick a date.", fields=[k])
            if "audit_fee_aed" in sets and str(sets["audit_fee_aed"]).strip():
                need(re.fullmatch(r"\d+(\.\d+)?", str(sets["audit_fee_aed"]).strip()), "Write the fee in numbers.",
                     fields=["audit_fee_aed"])
            for k in ("nda_on_paper", "hw_ordered", "engineer_booked", "owner_ok_stop"):
                if k in sets:
                    sets[k] = 1 if sets[k] else 0
            sets = {k: (v.strip() if isinstance(v, str) else v) for k, v in sets.items()}
            sets["updated_at"] = now()
            c.execute(f"UPDATE factories SET {','.join(k + '=?' for k in sets)} WHERE id=?", (*sets.values(), fid))
            if "next_step" in body or "next_due" in body:
                g = get_factory(c, fid)
                log(c, fid, uid, "next", f"Next step: {g['next_step'] or '—'}" + (f" · due {g['next_due']}" if g["next_due"] else ""))
            return {"factory": factory_full(c, get_factory(c, fid))}

        mm = re.fullmatch(r"/audit/(\d)", sub)
        if mm and method == "PUT":
            p = int(mm.group(1))
            need(1 <= p <= 8, "Unknown audit point.")
            ans = str(body.get("answer", "")).strip()
            had = c.execute("SELECT answer FROM audit WHERE factory_id=? AND point=?", (fid, p)).fetchone()
            c.execute("INSERT INTO audit(factory_id,point,answer,updated_at) VALUES(?,?,?,?) "
                      "ON CONFLICT(factory_id,point) DO UPDATE SET answer=excluded.answer,updated_at=excluded.updated_at",
                      (fid, p, ans, now()))
            if ans and not (had and had["answer"].strip()):
                log(c, fid, uid, "audit", f"Audit point {p} filled")
            c.execute("UPDATE factories SET updated_at=? WHERE id=?", (now(), fid))
            return {"factory": factory_full(c, get_factory(c, fid))}

        if sub == "/baseline" and method == "POST":
            area = str(body.get("area", "")).strip()
            need(area, "Write the area name.", fields=["area"])
            need(not c.execute("SELECT 1 FROM baseline WHERE factory_id=? AND lower(area)=lower(?)", (fid, area)).fetchone(),
                 f"“{area}” is already in the baseline.", 409)
            s = c.execute("SELECT COALESCE(MAX(sort),0)+1 FROM baseline WHERE factory_id=?", (fid,)).fetchone()[0]
            c.execute("INSERT INTO baseline(factory_id,area,sort) VALUES(?,?,?)", (fid, area, s))
            log(c, fid, uid, "baseline", f"Baseline area added: {area}")
            return {"factory": factory_full(c, get_factory(c, fid))}

        mm = re.fullmatch(r"/baseline/(\d+)", sub)
        if mm and method == "PATCH":
            bid = int(mm.group(1))
            row = c.execute("SELECT * FROM baseline WHERE id=? AND factory_id=?", (bid, fid)).fetchone()
            need(row, "This baseline row was not found.", 404)
            sets = {k: str(body[k]).strip() for k in ("evidence", "impact", "opportunity") if k in body}
            if sets:
                c.execute(f"UPDATE baseline SET {','.join(k + '=?' for k in sets)} WHERE id=?", (*sets.values(), bid))
            if body.get("top"):
                if f["top_area"] != row["area"]:
                    c.execute("UPDATE factories SET top_area=? WHERE id=?", (row["area"], fid))
                    if not f["proposal_scope"].strip() or f["proposal_scope"].startswith("Minimum pilot for "):
                        opp = sets.get("opportunity", row["opportunity"])
                        c.execute("UPDATE factories SET proposal_scope=? WHERE id=?",
                                  (f"Minimum pilot for {row['area'].lower()}" + (f": {opp}" if opp else ""), fid))
                    log(c, fid, uid, "top", f"Top pain point: {row['area']}")
            c.execute("UPDATE factories SET updated_at=? WHERE id=?", (now(), fid))
            return {"factory": factory_full(c, get_factory(c, fid))}

        if sub == "/move" and method == "POST":
            frm = body.get("from")
            need(f["status"] == "active", "This factory is not active. Re-open it first.", 409)
            need(frm == f["stage"], "This factory was already moved. The page is now up to date.", 409, stale=True)
            need(f["stage"] < 11, "This is the last stage. Choose continue or stop.")
            target = f["stage"] + 1
            miss = missing_for(c, f, target)
            need(not miss, "Fill these first:", missing=miss)
            c.execute("UPDATE factories SET stage=?,next_step=?,next_due='',updated_at=? WHERE id=?",
                      (target, NEXT_STEP[target], now(), fid))
            log(c, fid, uid, "move", f"Moved to {target}. {STAGES[target - 1]}", target)
            return {"factory": factory_full(c, get_factory(c, fid))}

        if sub == "/lost" and method == "POST":
            need(f["status"] == "active", "This factory is already closed.", 409)
            reason = str(body.get("reason", "")).strip()
            need(reason, "Please write the reason.", fields=["reason"])
            fu = str(body.get("follow_up", "")).strip()
            if fu:
                need(re.fullmatch(r"\d{4}-\d{2}-\d{2}", fu), "Please pick a date.", fields=["follow_up"])
            c.execute("UPDATE factories SET status='lost',lost_reason=?,lost_stage=?,follow_up=?,next_step=?,"
                      "next_due=?,updated_at=? WHERE id=?",
                      (reason, f["stage"], fu, "Follow up" if fu else "", fu, now(), fid))
            log(c, fid, uid, "lost", f"Lost at {f['stage']}. {STAGES[f['stage'] - 1]} · reason: {reason}"
                + (f" · follow up {fu}" if fu else ""))
            return {"factory": factory_full(c, get_factory(c, fid))}

        if sub == "/reopen" and method == "POST":
            need(f["status"] == "lost", "Only lost factories can be re-opened.", 409)
            c.execute("UPDATE factories SET status='active',stage=1,next_step=?,next_due='',follow_up='',updated_at=? "
                      "WHERE id=?", (NEXT_STEP[1], now(), fid))
            log(c, fid, uid, "reopen", "Re-opened · back to 1. Consultation request", 1)
            return {"factory": factory_full(c, get_factory(c, fid))}

        if sub == "/customer" and method == "POST":
            need(f["status"] == "active" and f["stage"] == 11, "Only a factory at 11. Pilot result can become a customer.", 409)
            w = str(body.get("customer_with", "")).strip()
            need(w, "Choose what they continue with.", fields=["customer_with"])
            c.execute("UPDATE factories SET status='customer',customer_with=?,next_step='',next_due='',updated_at=? WHERE id=?",
                      (w, now(), fid))
            log(c, fid, uid, "customer", f"Customer · continues with: {w}")
            return {"factory": factory_full(c, get_factory(c, fid))}

        if sub == "/files" and method == "PUT":
            name = os.path.basename(q.get("name", [""])[0]).strip()[:150]
            need(name, "The file has no name.")
            need(body, "The file is empty.")
            kind = q.get("kind", [""])[0][:20]
            stored = uuid.uuid4().hex
            with open(os.path.join(FILES, stored), "wb") as fh:
                fh.write(body)
            c.execute("INSERT INTO files(factory_id,stage,name,stored,size,kind,user_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
                      (fid, f["stage"], name, stored, len(body), kind, uid, now()))
            log(c, fid, uid, "file", f"File added: {name}")
            c.execute("UPDATE factories SET updated_at=? WHERE id=?", (now(), fid))
            return {"factory": factory_full(c, get_factory(c, fid))}

        mm = re.fullmatch(r"/files/(\d+)", sub)
        if mm and method == "DELETE":
            r = c.execute("SELECT * FROM files WHERE id=? AND factory_id=?", (int(mm.group(1)), fid)).fetchone()
            need(r, "This file was not found.", 404)
            c.execute("DELETE FROM files WHERE id=?", (r["id"],))
            try:
                os.remove(os.path.join(FILES, r["stored"]))
            except FileNotFoundError:
                pass
            log(c, fid, uid, "file", f"File removed: {r['name']}")
            return {"factory": factory_full(c, get_factory(c, fid))}

    if path == "/api/files" and method == "GET":
        return {"files": [dict(r) for r in c.execute(
            "SELECT files.id,files.factory_id,files.stage,files.name,files.size,files.created_at,factories.name AS factory "
            "FROM files JOIN factories ON factories.id=files.factory_id ORDER BY files.id DESC")]}

    if path == "/api/events" and method == "GET":
        return {"events": [dict(r) for r in c.execute("SELECT kind,to_stage,at,factory_id FROM events")]}

    if path == "/api/password" and method == "POST":
        u = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        need(check_pw(str(body.get("old", "")), u["pw"]), "The current password is wrong.", fields=["old"])
        new = str(body.get("new", ""))
        need(len(new) >= 10, "The new password needs at least 10 characters.", fields=["new"])
        c.execute("UPDATE users SET pw=? WHERE id=?", (hash_pw(new), uid))
        return {"ok": True}

    raise HTTPError(404, "Not found.")


# ---------------- WSGI plumbing ----------------

def respond(start, status, payload, headers=()):
    data = json.dumps(payload).encode()
    start(status, [("Content-Type", "application/json"), ("Cache-Control", "no-store"),
                   ("Content-Length", str(len(data))), *headers])
    return [data]


STATUS = {200: "200 OK", 400: "400 Bad Request", 401: "401 Unauthorized", 404: "404 Not Found",
          409: "409 Conflict", 413: "413 Payload Too Large", 500: "500 Internal Server Error"}


def current_user(c, environ):
    ck = SimpleCookie(environ.get("HTTP_COOKIE", ""))
    tok = ck.get("omni_crm")
    if not tok:
        return None, None
    r = c.execute("SELECT users.*, sessions.token FROM sessions JOIN users ON users.id=sessions.user_id "
                  "WHERE token=? AND expires>?", (tok.value, now())).fetchone()
    return (r, tok.value) if r else (None, None)


def cookie(environ, value, max_age):
    secure = "; Secure" if environ.get("HTTP_X_FORWARDED_PROTO") == "https" or environ.get("wsgi.url_scheme") == "https" else ""
    return ("Set-Cookie", f"omni_crm={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}")


def static(environ, start, path):
    rel = "index.html" if path in ("", "/") else path.lstrip("/")
    full = os.path.normpath(os.path.join(STATIC, rel))
    if not full.startswith(STATIC) or not os.path.isfile(full):
        full = os.path.join(STATIC, "index.html")
    with open(full, "rb") as fh:
        data = fh.read()
    ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
    start("200 OK", [("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text/") else "")),
                     ("Content-Length", str(len(data))), ("Cache-Control", "no-cache"),
                     ("X-Content-Type-Options", "nosniff")])
    return [data]


def application(environ, start):
    method = environ["REQUEST_METHOD"]
    path = environ.get("PATH_INFO", "/")
    if not path.startswith("/api/"):
        return static(environ, start, path)
    q = parse_qs(environ.get("QUERY_STRING", ""))
    c = db()
    try:
        n = int(environ.get("CONTENT_LENGTH") or 0)
        if n > MAX_UPLOAD:
            raise HTTPError(413, "This file is too big. The limit is 25 MB.")
        raw = environ["wsgi.input"].read(n) if n else b""
        is_upload = path.endswith("/files") and method == "PUT"
        body = raw if is_upload else (json.loads(raw or b"{}") if raw else {})
        if not is_upload and not isinstance(body, dict):
            raise HTTPError(400, "Bad request.")

        if path == "/api/login" and method == "POST":
            u = c.execute("SELECT * FROM users WHERE lower(email)=lower(?)", (str(body.get("email", "")).strip(),)).fetchone()
            if not u or not check_pw(str(body.get("password", "")), u["pw"]):
                raise HTTPError(401, "Email or password is wrong.")
            tok = secrets.token_urlsafe(32)
            exp = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds")
            c.execute("DELETE FROM sessions WHERE expires<?", (now(),))
            c.execute("INSERT INTO sessions VALUES(?,?,?)", (tok, u["id"], exp))
            c.commit()
            return respond(start, STATUS[200], {"user": {"name": u["name"], "email": u["email"]}},
                           [cookie(environ, tok, SESSION_DAYS * 86400)])

        user, tok = current_user(c, environ)
        if not user:
            raise HTTPError(401, "Please log in.")
        if path == "/api/logout" and method == "POST":
            c.execute("DELETE FROM sessions WHERE token=?", (tok,))
            c.commit()
            return respond(start, STATUS[200], {"ok": True}, [cookie(environ, "", 0)])
        if path == "/api/me":
            return respond(start, STATUS[200], {"user": {"name": user["name"], "email": user["email"]}})
        m = re.fullmatch(r"/api/files/(\d+)", path)
        if m and method == "GET":
            r = c.execute("SELECT * FROM files WHERE id=?", (int(m.group(1)),)).fetchone()
            if not r:
                raise HTTPError(404, "This file was not found.")
            with open(os.path.join(FILES, r["stored"]), "rb") as fh:
                data = fh.read()
            ctype = mimetypes.guess_type(r["name"])[0] or "application/octet-stream"
            start("200 OK", [("Content-Type", ctype), ("Content-Length", str(len(data))),
                             ("Content-Disposition", f"inline; filename*=UTF-8''{quote(r['name'])}"),
                             ("X-Content-Type-Options", "nosniff"), ("Cache-Control", "private, no-store")])
            return [data]
        out = api(c, method, path, body, user, q)
        c.commit()
        return respond(start, STATUS[200], out)
    except HTTPError as e:
        c.rollback()
        return respond(start, STATUS.get(e.status, f"{e.status} Error"), {"error": e.msg, **e.extra})
    except json.JSONDecodeError:
        return respond(start, STATUS[400], {"error": "Bad request."})
    except Exception as e:  # noqa: BLE001
        c.rollback()
        print("ERROR", method, path, repr(e), file=sys.stderr)
        return respond(start, STATUS[500], {"error": "The server had a problem saving this. Nothing was changed. Please try again."})
    finally:
        c.close()


init()


def main():
    args = sys.argv[1:]
    if args[:1] == ["adduser"] and len(args) >= 3:
        pw = os.environ.get("OMNI_CRM_NEW_PASSWORD") or getpass.getpass("Password: ")
        if len(pw) < 10:
            sys.exit("Password needs at least 10 characters.")
        with db() as c:
            c.execute("INSERT INTO users(email,name,pw,created_at) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET "
                      "name=excluded.name,pw=excluded.pw", (args[1].lower(), " ".join(args[2:]), hash_pw(pw), now()))
        print("User saved:", args[1])
    elif args[:1] == ["serve"]:
        from socketserver import ThreadingMixIn
        from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

        class Server(ThreadingMixIn, WSGIServer):
            daemon_threads = True

        class Quiet(WSGIRequestHandler):
            def log_request(self, *a):
                pass

        port = int(args[args.index("--port") + 1]) if "--port" in args else 8770
        print(f"OmniSite CRM on http://127.0.0.1:{port}")
        make_server("127.0.0.1", port, application, server_class=Server, handler_class=Quiet).serve_forever()
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
