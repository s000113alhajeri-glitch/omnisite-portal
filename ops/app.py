"""OmniSite factory operations: site manager (enters information) and owner (view only).

WSGI app (Python standard library only) with SQLite storage. Starts empty.
Run locally:  python3 app.py serve --port 8780
Add an OmniSite team login:  python3 app.py adduser EMAIL admin NAME
Site managers and owners are added per factory on the Factories page.
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
from http.cookies import SimpleCookie

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("OMNI_OPS_DATA", os.path.join(HERE, "data"))
DB = os.path.join(DATA, "ops.db")
STATIC = os.path.join(HERE, "static")
SESSION_DAYS = 30
UAE = dt.timezone(dt.timedelta(hours=4))
ROLES = ("manager", "owner")  # per factory; OmniSite team users have users.is_admin = 1
KINDS = {"mixer": "Mixer", "tank": "Holding tank", "scale": "Scale", "qc": "QC equipment",
         "pump": "Pump", "filler": "Filling machine", "gateway": "Gateway", "other": "Other"}
STOP_REASONS = ["Drive fault", "Waiting for material", "Cleaning", "Planned maintenance", "Power cut", "Other"]
LOSS_TYPES = ["Re-mix top-up", "Tank residue", "Spillage", "Other"]
# key: (label, min, max)
SETTINGS = {
    "target_batches": ("Target batches per day", 1, 100),
    "batch_litres": ("Litres per batch", 1, 100000),
    "price_kg": ("Average material price (AED per kg)", 0.01, 100000),
    "labour_rate": ("Labour cost (AED per staff-hour)", 0.01, 10000),
    "stop_cost_h": ("Cost of 1 hour of mixer stop (AED)", 0.01, 1000000),
}
ACTIVE = ("mixing", "remix", "passed")
SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0, pw TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS factories(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memberships(user_id INTEGER NOT NULL REFERENCES users(id), factory_id INTEGER NOT NULL REFERENCES factories(id),
  role TEXT NOT NULL CHECK(role IN ('manager','owner')), created_at TEXT NOT NULL, PRIMARY KEY(user_id, factory_id));
CREATE TABLE IF NOT EXISTS settings(factory_id INTEGER NOT NULL REFERENCES factories(id), key TEXT NOT NULL, value TEXT NOT NULL,
  user_id INTEGER, updated_at TEXT NOT NULL, PRIMARY KEY(factory_id, key));
CREATE TABLE IF NOT EXISTS equipment(id INTEGER PRIMARY KEY, factory_id INTEGER NOT NULL REFERENCES factories(id), name TEXT NOT NULL,
  kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unknown', status_at TEXT, created_at TEXT NOT NULL, UNIQUE(factory_id, name));
CREATE TABLE IF NOT EXISTS batches(id INTEGER PRIMARY KEY, factory_id INTEGER NOT NULL REFERENCES factories(id), code TEXT NOT NULL,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id), started_at TEXT NOT NULL, status TEXT NOT NULL,
  qc_count INTEGER NOT NULL DEFAULT 0, finished_at TEXT, moved_at TEXT, user_id INTEGER, UNIQUE(factory_id, code));
CREATE TABLE IF NOT EXISTS qc(id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES batches(id), at TEXT NOT NULL,
  ph REAL NOT NULL, visc REAL NOT NULL, result TEXT NOT NULL, cause_what TEXT DEFAULT '', cause_dir TEXT DEFAULT '',
  note TEXT DEFAULT '', user_id INTEGER);
CREATE TABLE IF NOT EXISTS stops(id INTEGER PRIMARY KEY, factory_id INTEGER NOT NULL REFERENCES factories(id),
  equipment_id INTEGER NOT NULL REFERENCES equipment(id), started_at TEXT NOT NULL, ended_at TEXT, reason TEXT DEFAULT '',
  note TEXT DEFAULT '', user_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS losses(id INTEGER PRIMARY KEY, factory_id INTEGER NOT NULL REFERENCES factories(id), at TEXT NOT NULL,
  kg REAL NOT NULL, type TEXT NOT NULL, batch_id INTEGER REFERENCES batches(id), note TEXT DEFAULT '', user_id INTEGER,
  request_id TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS labour(factory_id INTEGER NOT NULL REFERENCES factories(id), day TEXT NOT NULL, hours REAL NOT NULL,
  user_id INTEGER, updated_at TEXT NOT NULL, PRIMARY KEY(factory_id, day));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, factory_id INTEGER, at TEXT NOT NULL, user_id INTEGER,
  kind TEXT NOT NULL, text TEXT NOT NULL);
"""


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def uae_now():
    return dt.datetime.now(UAE)


def uae_day(iso):
    return dt.datetime.fromisoformat(iso).astimezone(UAE).date().isoformat()


def db():
    os.makedirs(DATA, exist_ok=True)
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


class HTTPError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status, self.msg = status, msg


def need(cond, msg, status=400):
    if not cond:
        raise HTTPError(status, msg)


def num(v, label, lo=None, hi=None, required=True):
    if v in (None, ""):
        need(not required, f"Enter {label}.")
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        raise HTTPError(400, f"{label[0].upper() + label[1:]} must be a number.")
    need(n == n and (lo is None or n >= lo) and (hi is None or n <= hi),
         f"{label[0].upper() + label[1:]} must be between {lo:g} and {hi:g}." if lo is not None and hi is not None
         else f"Check {label}.")
    return n


def text(v, limit=500):
    return str(v or "").strip()[:limit]


def at_time(v, label="the time", day=None):
    """Accept 'HH:MM' on a UAE day (default today) and return a UTC ISO time that is not in the future."""
    v = text(v, 10)
    need(re.fullmatch(r"([01]?\d|2[0-3]):[0-5]\d", v), f"Enter {label} as HH:MM, e.g. 09:30.")
    h, m = map(int, v.split(":"))
    base = uae_now()
    if day:
        try:
            d = dt.date.fromisoformat(text(day, 10))
        except ValueError:
            raise HTTPError(400, "Pick a valid day.")
        need(base.date() - dt.timedelta(days=13) <= d <= base.date(), "Pick a day in the last 2 weeks.")
        base = base.replace(year=d.year, month=d.month, day=d.day)
    t = base.replace(hour=h, minute=m, second=0, microsecond=0)
    need(t <= uae_now() + dt.timedelta(minutes=1), f"{label[0].upper() + label[1:]} can't be in the future.")
    return t.astimezone(dt.timezone.utc).isoformat(timespec="seconds")


def log(c, fid, uid, kind, txt):
    c.execute("INSERT INTO events(factory_id,at,user_id,kind,text) VALUES(?,?,?,?,?)", (fid, now(), uid, kind, txt))


def get(c, table, rid, what, fid):
    r = c.execute(f"SELECT * FROM {table} WHERE id=? AND factory_id=?", (rid, fid)).fetchone()
    need(r, f"This {what} was not found. Refresh the page.", 404)
    return r


def set_status(c, e, status, uid, reason="", note=""):
    """Equipment status is entered by the site manager (no sensor connected). A stop opens a stop record."""
    t = now()
    open_stop = c.execute("SELECT id FROM stops WHERE equipment_id=? AND ended_at IS NULL", (e["id"],)).fetchone()
    if status == "stopped" and not open_stop:
        c.execute("INSERT INTO stops(factory_id,equipment_id,started_at,reason,note,user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                  (e["factory_id"], e["id"], t, reason, note, uid, t, t))
    if status != "stopped" and open_stop:
        c.execute("UPDATE stops SET ended_at=?, updated_at=? WHERE id=?", (t, t, open_stop["id"]))
    c.execute("UPDATE equipment SET status=?, status_at=? WHERE id=?", (status, t, e["id"]))


def state(c, fid, days=14):
    since = (uae_now() - dt.timedelta(days=days)).replace(hour=0, minute=0, second=0).astimezone(dt.timezone.utc).isoformat(timespec="seconds")
    rows = lambda q, *a: [dict(r) for r in c.execute(q, a).fetchall()]
    batches = rows("SELECT * FROM batches WHERE factory_id=? AND (started_at>=? OR finished_at>=? OR moved_at>=? OR status IN ('mixing','remix','passed')) ORDER BY started_at DESC", fid, since, since, since)
    ids = [b["id"] for b in batches] or [0]
    qcs = rows(f"SELECT * FROM qc WHERE batch_id IN ({','.join('?' * len(ids))}) ORDER BY at", *ids)
    stops = rows("SELECT * FROM stops WHERE factory_id=? AND (started_at>=? OR ended_at IS NULL OR ended_at>=?) ORDER BY started_at DESC", fid, since, since)
    losses = rows("SELECT * FROM losses WHERE factory_id=? AND at>=? ORDER BY at DESC", fid, since)
    for group, key in ((batches, "started_at"), (qcs, "at"), (stops, "started_at"), (losses, "at")):
        for r in group:
            r["day"] = uae_day(r[key])
    return {
        "now": now(), "today": uae_now().date().isoformat(),
        "factory": dict(c.execute("SELECT id, name FROM factories WHERE id=?", (fid,)).fetchone()),
        "settings": {r["key"]: {"value": r["value"], "at": r["updated_at"]} for r in c.execute("SELECT * FROM settings WHERE factory_id=?", (fid,))},
        "equipment": rows("SELECT * FROM equipment WHERE factory_id=? ORDER BY id", fid),
        "batches": batches, "qc": qcs, "stops": stops, "losses": losses,
        "labour": rows("SELECT * FROM labour WHERE factory_id=? AND day>=? ORDER BY day DESC", fid, (uae_now() - dt.timedelta(days=days)).date().isoformat()),
        "events": rows("SELECT events.*, users.name AS who FROM events LEFT JOIN users ON users.id=events.user_id WHERE factory_id=? ORDER BY events.id DESC LIMIT 40", fid),
    }


def access(c, user, fid):
    """'admin' for the OmniSite team (all factories), the membership role otherwise, or None."""
    if not c.execute("SELECT 1 FROM factories WHERE id=?", (fid,)).fetchone():
        return None
    if user["is_admin"]:
        return "admin"
    r = c.execute("SELECT role FROM memberships WHERE user_id=? AND factory_id=?", (user["id"], fid)).fetchone()
    return r["role"] if r else None


def my_factories(c, user):
    if user["is_admin"]:
        q, a = "SELECT id, name, 'admin' AS role FROM factories ORDER BY name", ()
    else:
        q, a = ("SELECT f.id, f.name, m.role FROM memberships m JOIN factories f ON f.id=m.factory_id "
                "WHERE m.user_id=? ORDER BY f.name", (user["id"],))
    return [dict(r) for r in c.execute(q, a)]


def admin_api(c, method, path, body, user):
    need(user["is_admin"], "Only the OmniSite team can do this.", 403)
    if method == "GET" and path == "/api/admin":
        return {"factories": [dict(r) for r in c.execute("SELECT * FROM factories ORDER BY name")],
                "people": [dict(r) for r in c.execute("SELECT m.factory_id, m.role, u.id AS user_id, u.name, u.email FROM memberships m "
                                                         "JOIN users u ON u.id=m.user_id ORDER BY u.name")],
                "team": [dict(r) for r in c.execute("SELECT id, name, email FROM users WHERE is_admin=1 ORDER BY name")]}
    need(method == "POST", "Not found.", 404)
    if path == "/api/admin/factories":
        name = text(body.get("name"), 80)
        need(name, "Enter the factory name.")
        need(not c.execute("SELECT 1 FROM factories WHERE name=?", (name,)).fetchone(), f"{name} already exists.", 409)
        cur = c.execute("INSERT INTO factories(name,created_at) VALUES(?,?)", (name, now()))
        log(c, cur.lastrowid, user["id"], "factory", f"Factory {name} added")
        return {"ok": True, "id": cur.lastrowid}
    if path == "/api/admin/people":
        fid = int(body.get("factory_id") or 0)
        f = c.execute("SELECT * FROM factories WHERE id=?", (fid,)).fetchone()
        need(f, "This factory was not found. Refresh the page.", 404)
        role = body.get("role")
        need(role in ROLES, "Pick site manager or owner.")
        email = text(body.get("email"), 200).lower()
        need(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email), "Enter a valid email.")
        pw = str(body.get("password") or "")
        u = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if u:
            need(not u["is_admin"], "This email is an OmniSite team login. It already sees every factory.", 409)
            if pw:
                need(len(pw) >= 10, "The password needs at least 10 characters.")
                c.execute("UPDATE users SET pw=? WHERE id=?", (hash_pw(pw), u["id"]))
            uid = u["id"]
        else:
            name = text(body.get("name"), 80)
            need(name, "Enter the person's name.")
            need(len(pw) >= 10, "The password needs at least 10 characters.")
            uid = c.execute("INSERT INTO users(email,name,pw,created_at) VALUES(?,?,?,?)", (email, name, hash_pw(pw), now())).lastrowid
        c.execute("INSERT INTO memberships VALUES(?,?,?,?) ON CONFLICT(user_id,factory_id) DO UPDATE SET role=excluded.role",
                  (uid, fid, role, now()))
        log(c, fid, user["id"], "people", f"{email} added as {role}")
        return {"ok": True, "existing": bool(u)}
    if path == "/api/admin/people/remove":
        fid, uid = int(body.get("factory_id") or 0), int(body.get("user_id") or 0)
        r = c.execute("SELECT u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=? AND m.factory_id=?", (uid, fid)).fetchone()
        need(r, "This person is not on this factory any more. Refresh the page.", 404)
        c.execute("DELETE FROM memberships WHERE user_id=? AND factory_id=?", (uid, fid))
        log(c, fid, user["id"], "people", f"{r['email']} removed")
        return {"ok": True}
    raise HTTPError(404, "Not found.")


def api(c, method, path, body, user):
    if method == "GET" and path == "/api/meta":
        return {"kinds": KINDS, "stop_reasons": STOP_REASONS, "loss_types": LOSS_TYPES,
                "settings": {k: v[0] for k, v in SETTINGS.items()}}
    if path == "/api/admin" or path.startswith("/api/admin/"):
        return admin_api(c, method, path, body, user)
    m = re.fullmatch(r"/api/f/(\d+)(/.+)", path)
    need(m, "Not found.", 404)
    fid = int(m.group(1))
    role = access(c, user, fid)
    need(role, "This factory was not found, or this login doesn't have access to it.", 404)
    return factory_api(c, method, "/api" + m.group(2), body, user, fid, role)


def factory_api(c, method, path, body, user, fid, role):
    uid = user["id"]
    if method == "GET" and path == "/api/state":
        return state(c, fid)
    need(method == "POST", "Not found.", 404)
    need(role in ("admin", "manager"), "View only. The site manager enters this information.", 403)

    if path == "/api/settings":
        saved = []
        for k, v in body.items():
            need(k in SETTINGS, "Unknown setting.")
            label, lo, hi = SETTINGS[k]
            if v in (None, ""):
                c.execute("DELETE FROM settings WHERE factory_id=? AND key=?", (fid, k))
                continue
            val = f"{num(v, label.lower(), lo, hi):g}"
            need(val, f"Enter the {label.lower()}.")
            c.execute("INSERT INTO settings VALUES(?,?,?,?,?) ON CONFLICT(factory_id,key) DO UPDATE SET value=excluded.value,"
                      "user_id=excluded.user_id,updated_at=excluded.updated_at", (fid, k, val, uid, now()))
            saved.append(f"{label}: {val}")
        log(c, fid, uid, "settings", "Settings changed · " + ("; ".join(saved) or "cleared"))
        return {"ok": True}

    if path == "/api/equipment":
        name, kind = text(body.get("name"), 60), body.get("kind")
        need(name, "Enter a name, e.g. Mixer 1.")
        need(kind in KINDS, "Pick the type of equipment.")
        need(not c.execute("SELECT 1 FROM equipment WHERE factory_id=? AND lower(name)=lower(?)", (fid, name)).fetchone(),
             f"{name} already exists.", 409)
        c.execute("INSERT INTO equipment(factory_id,name,kind,created_at) VALUES(?,?,?,?)", (fid, name, kind, now()))
        log(c, fid, uid, "equipment", f"Added {name} ({KINDS[kind]})")
        return {"ok": True}

    m = re.fullmatch(r"/api/equipment/(\d+)/status", path)
    if m:
        e = get(c, "equipment", int(m.group(1)), "equipment", fid)
        st = body.get("status")
        need(st in ("running", "idle", "stopped"), "Pick running, idle or stopped.")
        reason = body.get("reason") or ""
        need(not reason or reason in STOP_REASONS, "Pick a reason from the list.")
        note = text(body.get("note"))
        need(reason != "Other" or note, 'Add a short note for "Other".')
        if st == "running" and e["kind"] == "mixer":
            need(c.execute("SELECT 1 FROM batches WHERE equipment_id=? AND status IN ('mixing','remix')", (e["id"],)).fetchone(),
                 f"Start a batch on {e['name']} to mark it running.", 409)
        set_status(c, e, st, uid, reason, note)
        log(c, fid, uid, "status", f"{e['name']} marked {st}" + (f" · {reason}" if reason else ""))
        return {"ok": True}

    if path == "/api/batches":
        e = get(c, "equipment", int(body.get("equipment_id") or 0), "mixer", fid)
        need(e["kind"] == "mixer", "Batches can only be started on a mixer.")
        busy = c.execute("SELECT code FROM batches WHERE equipment_id=? AND status IN ('mixing','remix','passed')", (e["id"],)).fetchone()
        need(not busy, f"{e['name']} already has batch {busy['code'] if busy else ''}. Finish it first.", 409)
        need(not c.execute("SELECT 1 FROM stops WHERE equipment_id=? AND ended_at IS NULL", (e["id"],)).fetchone(),
             f"{e['name']} is marked stopped. Mark it restarted first, so the stop time stays correct.", 409)
        n = [r["id"] for r in c.execute("SELECT id FROM equipment WHERE factory_id=? AND kind='mixer' ORDER BY id", (fid,))].index(e["id"]) + 1
        day = uae_now().strftime("%Y%m%d")
        prefix = f"MX{n}-{day}-"
        seq = c.execute("SELECT COUNT(*) FROM batches WHERE factory_id=? AND code LIKE ?", (fid, prefix + "%")).fetchone()[0] + 1
        code = f"{prefix}{seq:02d}"
        started = at_time(body["start"], "the start time") if body.get("start") else now()
        c.execute("INSERT INTO batches(factory_id,code,equipment_id,started_at,status,user_id) VALUES(?,?,?,?,?,?)",
                  (fid, code, e["id"], started, "mixing", uid))
        set_status(c, e, "running", uid)
        log(c, fid, uid, "batch", f"Started {code} on {e['name']}")
        return {"ok": True, "code": code}

    m = re.fullmatch(r"/api/batches/(\d+)/(qc|move)", path)
    if m:
        b = get(c, "batches", int(m.group(1)), "batch", fid)
        e = get(c, "equipment", b["equipment_id"], "mixer", fid)
        if m.group(2) == "move":
            need(b["status"] == "passed", f"{b['code']} must pass QC before it is moved." if b["status"] != "moved"
                 else f"{b['code']} is already marked as moved.", 409)
            c.execute("UPDATE batches SET status='moved', moved_at=? WHERE id=?", (now(), b["id"]))
            set_status(c, e, "idle", uid)
            log(c, fid, uid, "batch", f"{b['code']} moved to holding tank")
            return {"ok": True}
        need(b["status"] in ("mixing", "remix"), f"QC for {b['code']} is already done.", 409)
        ph = num(body.get("ph"), "the pH", 0, 14)
        visc = num(body.get("visc"), "the viscosity (cP)", 1, 1_000_000)
        res = body.get("result")
        need(res in ("pass", "remix", "reject"), "Pick the result.")
        what, dirn = body.get("cause_what") or "", body.get("cause_dir") or ""
        if res == "remix":
            need(what in ("pH", "Viscosity"), "Pick what was out of range.")
            need(dirn in ("Too high", "Too low"), "Pick too high or too low.")
        c.execute("INSERT INTO qc(batch_id,at,ph,visc,result,cause_what,cause_dir,note,user_id) VALUES(?,?,?,?,?,?,?,?,?)",
                  (b["id"], now(), ph, visc, res, what if res == "remix" else "", dirn if res == "remix" else "",
                   text(body.get("note")), uid))
        st = {"pass": "passed", "remix": "remix", "reject": "rejected"}[res]
        c.execute("UPDATE batches SET status=?, qc_count=qc_count+1, finished_at=? WHERE id=?",
                  (st, now() if res != "remix" else None, b["id"]))
        if res == "reject":
            set_status(c, e, "idle", uid)
        log(c, fid, uid, "qc", f"{b['code']} QC: pH {ph:g}, {visc:g} cP · " + {"pass": "passed", "remix": f"re-mix ({what} {dirn.lower()})", "reject": "rejected"}[res])
        return {"ok": True}

    if path == "/api/stops":
        e = get(c, "equipment", int(body.get("equipment_id") or 0), "equipment", fid)
        reason, note = body.get("reason"), text(body.get("note"))
        need(reason in STOP_REASONS, "Pick a reason.")
        need(reason != "Other" or note, 'Add a short note for "Other".')
        day = body.get("day")
        start, end = at_time(body.get("start"), "the stop time", day), at_time(body.get("end"), "the restart time", day)
        need(end != start, "The restart time must be different from the stop time.")
        if end < start:  # e.g. 23:50 → 00:20 ends the next day
            end = (dt.datetime.fromisoformat(end) + dt.timedelta(days=1)).isoformat(timespec="seconds")
            need(end <= now(), "The restart time can't be in the future.")
        need(end > start, "The restart time must be after the stop time.")
        c.execute("INSERT INTO stops(factory_id,equipment_id,started_at,ended_at,reason,note,user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                  (fid, e["id"], start, end, reason, note, uid, now(), now()))
        log(c, fid, uid, "stop", f"Stop added for {e['name']} · {reason}")
        return {"ok": True}

    m = re.fullmatch(r"/api/stops/(\d+)", path)
    if m:
        s = get(c, "stops", int(m.group(1)), "stop", fid)
        reason, note = body.get("reason"), text(body.get("note"))
        need(reason in STOP_REASONS, "Pick a reason.")
        need(reason != "Other" or note, 'Add a short note for "Other".')
        c.execute("UPDATE stops SET reason=?, note=?, updated_at=? WHERE id=?", (reason, note, now(), s["id"]))
        e = get(c, "equipment", s["equipment_id"], "equipment", fid)
        log(c, fid, uid, "stop", f"Stop reason for {e['name']}: {reason}")
        return {"ok": True}

    if path == "/api/losses":
        kg = num(body.get("kg"), "the weight in kg", 0.01, 100_000)
        typ = body.get("type")
        need(typ in LOSS_TYPES, "Pick the type.")
        bid = body.get("batch_id") or None
        if bid:
            get(c, "batches", int(bid), "batch", fid)
        rid = text(body.get("request_id"), 64) or None
        if rid and c.execute("SELECT 1 FROM losses WHERE request_id=?", (rid,)).fetchone():
            return {"ok": True, "duplicate": True}
        c.execute("INSERT INTO losses(factory_id,at,kg,type,batch_id,note,user_id,request_id) VALUES(?,?,?,?,?,?,?,?)",
                  (fid, now(), kg, typ, int(bid) if bid else None, text(body.get("note")), uid, rid))
        log(c, fid, uid, "loss", f"Material loss {kg:g} kg · {typ}")
        return {"ok": True}

    if path == "/api/labour":
        day = text(body.get("day"), 10) or uae_now().date().isoformat()
        need(re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) and day <= uae_now().date().isoformat(), "Pick a day that is not in the future.")
        hours = num(body.get("hours"), "the staff-hours", 0.25, 2000)
        c.execute("INSERT INTO labour VALUES(?,?,?,?,?) ON CONFLICT(factory_id,day) DO UPDATE SET hours=excluded.hours,"
                  "user_id=excluded.user_id,updated_at=excluded.updated_at", (fid, day, hours, uid, now()))
        log(c, fid, uid, "labour", f"Labour {day}: {hours:g} staff-hours")
        return {"ok": True}

    raise HTTPError(404, "Not found.")


# ---------------- WSGI plumbing ----------------
STATUS = {200: "200 OK", 400: "400 Bad Request", 401: "401 Unauthorized", 403: "403 Forbidden", 404: "404 Not Found",
          409: "409 Conflict", 413: "413 Payload Too Large", 500: "500 Internal Server Error"}


def respond(start, status, payload, headers=()):
    data = json.dumps(payload).encode()
    start(status, [("Content-Type", "application/json"), ("Cache-Control", "no-store"),
                   ("Content-Length", str(len(data))), *headers])
    return [data]


def current_user(c, environ):
    tok = SimpleCookie(environ.get("HTTP_COOKIE", "")).get("omni_ops")
    if not tok:
        return None, None
    r = c.execute("SELECT users.*, sessions.token FROM sessions JOIN users ON users.id=sessions.user_id "
                  "WHERE token=? AND expires>?", (tok.value, now())).fetchone()
    return (r, tok.value) if r else (None, None)


def cookie(environ, value, max_age):
    secure = "; Secure" if environ.get("HTTP_X_FORWARDED_PROTO") == "https" or environ.get("wsgi.url_scheme") == "https" else ""
    return ("Set-Cookie", f"omni_ops={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}")


def static(environ, start, path):
    rel = "index.html" if path in ("", "/") else path.lstrip("/")
    full = os.path.normpath(os.path.join(STATIC, rel))
    if not full.startswith(STATIC + os.sep) or not os.path.isfile(full):
        full = os.path.join(STATIC, "index.html")
    with open(full, "rb") as fh:
        data = fh.read()
    ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
    start("200 OK", [("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text/") else "")),
                     ("Content-Length", str(len(data))), ("Cache-Control", "no-cache"),
                     ("X-Content-Type-Options", "nosniff")])
    return [data]


def me(c, u):
    return {"name": u["name"], "email": u["email"], "admin": bool(u["is_admin"]), "factories": my_factories(c, u)}


def application(environ, start):
    method = environ["REQUEST_METHOD"]
    path = environ.get("PATH_INFO", "/")
    if not path.startswith("/api/"):
        return static(environ, start, path)
    c = db()
    try:
        n = int(environ.get("CONTENT_LENGTH") or 0)
        need(n <= 64 * 1024, "Request too big.", 413)
        raw = environ["wsgi.input"].read(n) if n else b""
        body = json.loads(raw) if raw else {}
        need(isinstance(body, dict), "Bad request.")
        if path == "/api/login" and method == "POST":
            u = c.execute("SELECT * FROM users WHERE lower(email)=lower(?)", (text(body.get("email"), 200),)).fetchone()
            need(u and check_pw(str(body.get("password", "")), u["pw"]), "Email or password is wrong.", 401)
            tok = secrets.token_urlsafe(32)
            exp = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds")
            c.execute("DELETE FROM sessions WHERE expires<?", (now(),))
            c.execute("INSERT INTO sessions VALUES(?,?,?)", (tok, u["id"], exp))
            c.commit()
            return respond(start, STATUS[200], {"user": me(c, u)}, [cookie(environ, tok, SESSION_DAYS * 86400)])
        user, tok = current_user(c, environ)
        need(user, "Please log in.", 401)
        if path == "/api/logout" and method == "POST":
            c.execute("DELETE FROM sessions WHERE token=?", (tok,))
            c.commit()
            return respond(start, STATUS[200], {"ok": True}, [cookie(environ, "", 0)])
        if path == "/api/me":
            return respond(start, STATUS[200], {"user": me(c, user)})
        out = api(c, method, path, body, user)
        c.commit()
        return respond(start, STATUS[200], out)
    except HTTPError as e:
        c.rollback()
        return respond(start, STATUS.get(e.status, f"{e.status} Error"), {"error": e.msg})
    except (json.JSONDecodeError, ValueError, KeyError):
        c.rollback()
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
    if args[:1] == ["adduser"] and len(args) >= 4 and args[2] == "admin":
        pw = os.environ.get("OMNI_OPS_NEW_PASSWORD") or getpass.getpass("Password: ")
        if len(pw) < 10:
            sys.exit("Password needs at least 10 characters.")
        with db() as c:
            c.execute("INSERT INTO users(email,name,is_admin,pw,created_at) VALUES(?,?,1,?,?) ON CONFLICT(email) DO UPDATE SET "
                      "name=excluded.name,is_admin=1,pw=excluded.pw", (args[1].lower(), " ".join(args[3:]), hash_pw(pw), now()))
        print("OmniSite team login saved:", args[1], "(factory logins are added on the Factories page)")
    elif args[:1] == ["serve"]:
        from socketserver import ThreadingMixIn
        from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

        class Server(ThreadingMixIn, WSGIServer):
            daemon_threads = True

        class Quiet(WSGIRequestHandler):
            def log_request(self, *a):
                pass

        port = int(args[args.index("--port") + 1]) if "--port" in args else 8780
        print(f"OmniSite operations on http://127.0.0.1:{port}")
        make_server("127.0.0.1", port, application, server_class=Server, handler_class=Quiet).serve_forever()
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
