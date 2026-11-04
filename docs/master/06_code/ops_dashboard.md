# Factory dashboard (ops) source code

Live copy (2026-11-04). Vendored: three.min.js, OrbitControls.js, RoomEnvironment.js (Three.js r147, MIT).

## `ops/app.py`

```python
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
import math
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
STOP_REASONS = ["Drive fault", "Waiting for material", "Waiting for QC", "Cleaning", "Planned maintenance", "Power cut", "Other"]
# what a gateway signal measures: (label, unit). Altivar 212 Modbus: speed FD00 (0.01 Hz), current FE03 (0.01 %), input energy FE76 (1 Wh), trip code FC90.
METRICS = {"speed_hz": ("Drive speed", "Hz"), "current_pct": ("Motor current", "% of rated"), "energy_kwh": ("Energy", "kWh"),
           "trip": ("Drive trip code", ""), "temp_c": ("Tank temperature", "°C"), "weigh_kg": ("Weighing on the scale", "kg")}
RUNNING_HZ = 0.5  # drive speed above this counts as running
QUIET_MIN = 10  # minutes without data before "Gateway not sending data"
LOSS_TYPES = ["Re-mix top-up", "Tank residue", "Spillage", "Other"]
# key: (label, min, max)
SETTINGS = {
    "target_batches": ("Target batches per day", 1, 100),
    "batch_litres": ("Litres per batch", 1, 100000),
    "price_kg": ("Average material price (AED per kg)", 0.01, 100000),
    "stop_cost_h": ("Cost of 1 hour of mixer stop (AED)", 0.01, 1000000),
}
MATERIALS = {"liquids": "Liquids", "powders": "Powders"}  # what a scale weighs
ACTIVE = ("mixing", "remix", "passed")
SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0, pw TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_fails(email TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS factories(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memberships(user_id INTEGER NOT NULL REFERENCES users(id), factory_id INTEGER NOT NULL REFERENCES factories(id),
  role TEXT NOT NULL CHECK(role IN ('manager','owner')), created_at TEXT NOT NULL, PRIMARY KEY(user_id, factory_id));
CREATE TABLE IF NOT EXISTS settings(factory_id INTEGER NOT NULL REFERENCES factories(id), key TEXT NOT NULL, value TEXT NOT NULL,
  user_id INTEGER, updated_at TEXT NOT NULL, PRIMARY KEY(factory_id, key));
CREATE TABLE IF NOT EXISTS equipment(id INTEGER PRIMARY KEY, factory_id INTEGER NOT NULL REFERENCES factories(id), name TEXT NOT NULL,
  kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unknown', status_at TEXT, created_at TEXT NOT NULL, UNIQUE(factory_id, name));
CREATE TABLE IF NOT EXISTS batches(id INTEGER PRIMARY KEY, factory_id INTEGER NOT NULL REFERENCES factories(id), code TEXT NOT NULL,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id), started_at TEXT NOT NULL, status TEXT NOT NULL,
  qc_count INTEGER NOT NULL DEFAULT 0, finished_at TEXT, moved_at TEXT, user_id INTEGER, kg_used REAL, kg_at TEXT,
  UNIQUE(factory_id, code));
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
  user_id INTEGER, updated_at TEXT NOT NULL, people INTEGER, hours_each REAL, PRIMARY KEY(factory_id, day));
CREATE TABLE IF NOT EXISTS gateways(id INTEGER PRIMARY KEY, factory_id INTEGER NOT NULL REFERENCES factories(id), name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_seen TEXT, last_payload TEXT, last_unknown TEXT);
CREATE TABLE IF NOT EXISTS signals(id INTEGER PRIMARY KEY, factory_id INTEGER NOT NULL REFERENCES factories(id),
  equipment_id INTEGER NOT NULL REFERENCES equipment(id), metric TEXT NOT NULL, tag TEXT NOT NULL, mult REAL NOT NULL DEFAULT 1,
  plus REAL NOT NULL DEFAULT 0, last_value REAL, last_at TEXT, created_at TEXT NOT NULL, UNIQUE(factory_id, tag), UNIQUE(equipment_id, metric));
CREATE TABLE IF NOT EXISTS readings(id INTEGER PRIMARY KEY, factory_id INTEGER NOT NULL, signal_id INTEGER NOT NULL REFERENCES signals(id),
  at TEXT NOT NULL, value REAL NOT NULL, UNIQUE(signal_id, at));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, factory_id INTEGER, at TEXT NOT NULL, user_id INTEGER,
  kind TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS readings_archive(id INTEGER PRIMARY KEY, factory_id INTEGER NOT NULL, equipment_id INTEGER, metric TEXT NOT NULL,
  tag TEXT NOT NULL, at TEXT NOT NULL, value REAL NOT NULL, signal_removed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outages(id INTEGER PRIMARY KEY, factory_id INTEGER NOT NULL REFERENCES factories(id), kind TEXT NOT NULL,
  ref_id INTEGER NOT NULL, started_at TEXT NOT NULL, ended_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS support(id INTEGER PRIMARY KEY, factory_id INTEGER NOT NULL REFERENCES factories(id), user_id INTEGER,
  at TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', resolved_at TEXT, resolved_by INTEGER);
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


ADDED_COLUMNS = {"batches": {"kg_used": "REAL", "kg_at": "TEXT"}, "labour": {"people": "INTEGER", "hours_each": "REAL"},
                 "stops": {"source": "TEXT DEFAULT 'manual'", "reason_src": "TEXT DEFAULT ''"}, "equipment": {"status_src": "TEXT DEFAULT 'manual'", "feeds_id": "INTEGER", "material": "TEXT DEFAULT ''"}}


def init():
    with db() as c:
        c.executescript(SCHEMA)
        for table, cols in ADDED_COLUMNS.items():  # databases created before these columns existed
            have = {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}
            for col, typ in cols.items():
                if col not in have:
                    c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")


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


LOCK_TRIES, LOCK_MIN = 5, 15


def _utc(mins=0):
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=mins)).isoformat(timespec="seconds")


def login_guard(c, email):
    c.execute("DELETE FROM login_fails WHERE at<?", (_utc(LOCK_MIN),))
    n = c.execute("SELECT COUNT(*) FROM login_fails WHERE email=?", (email,)).fetchone()[0]
    need(n < LOCK_TRIES, f"Too many wrong tries. Wait {LOCK_MIN} minutes, then try again.", 429)


def login_failed(c, email):
    c.execute("INSERT INTO login_fails(email, at) VALUES(?,?)", (email, _utc()))
    c.commit()


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


def set_status(c, e, status, uid, reason="", note="", at=None, src="manual"):
    """Status comes from the site manager, or from the drive via the gateway (src='sensor'). A stop opens a stop record."""
    t = at or now()
    open_stop = c.execute("SELECT id FROM stops WHERE equipment_id=? AND ended_at IS NULL", (e["id"],)).fetchone()
    if status == "stopped" and not open_stop:
        c.execute("INSERT INTO stops(factory_id,equipment_id,started_at,reason,note,user_id,created_at,updated_at,source,reason_src) VALUES(?,?,?,?,?,?,?,?,?,?)",
                  (e["factory_id"], e["id"], t, reason, note, uid, now(), now(), src, src if reason else ""))
    if status != "stopped" and open_stop:
        c.execute("UPDATE stops SET ended_at=max(started_at, ?), updated_at=? WHERE id=?", (t, now(), open_stop["id"]))
    c.execute("UPDATE equipment SET status=?, status_at=?, status_src=? WHERE id=?", (status, t, src, e["id"]))


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
    signals = rows("SELECT id, equipment_id, metric, last_value, last_at FROM signals WHERE factory_id=? ORDER BY id", fid)
    for b in batches:
        b["s"] = batch_sensors(c, b, signals)
    return {
        "signals": signals, "gateways": rows("SELECT id, name, created_at, last_seen FROM gateways WHERE factory_id=? ORDER BY id", fid),
        "now": now(), "today": uae_now().date().isoformat(),
        "factory": dict(c.execute("SELECT id, name FROM factories WHERE id=?", (fid,)).fetchone()),
        "settings": {r["key"]: {"value": r["value"], "at": r["updated_at"]} for r in c.execute("SELECT * FROM settings WHERE factory_id=?", (fid,))},
        "equipment": rows("SELECT * FROM equipment WHERE factory_id=? ORDER BY id", fid),
        "batches": batches, "qc": qcs, "stops": stops, "losses": losses,
        "labour": rows("SELECT * FROM labour WHERE factory_id=? AND day>=? ORDER BY day DESC", fid, (uae_now() - dt.timedelta(days=days)).date().isoformat()),
        "events": rows("SELECT events.*, users.name AS who FROM events LEFT JOIN users ON users.id=events.user_id WHERE factory_id=? ORDER BY events.id DESC LIMIT 40", fid),
    }


def scale_link(c, fid, body):
    mx = c.execute("SELECT id FROM equipment WHERE id=? AND factory_id=? AND kind='mixer'", (int(body.get("feeds_id") or 0), fid)).fetchone()
    need(mx, "Pick the mixer this scale fills.")
    mat = body.get("material")
    need(mat in MATERIALS, "Pick what the scale weighs: liquids or powders.")
    return mx["id"], mat


def batch_sensors(c, b, signals):
    """Sensor values during a batch, from the signals of its mixer. Empty when nothing is connected."""
    out, end = {}, b["finished_at"] or "9999"
    scales = {r["id"]: dict(r) for r in c.execute("SELECT id, name, material FROM equipment WHERE feeds_id=? AND kind='scale'", (b["equipment_id"],))}
    first_remix = c.execute("SELECT MIN(at) FROM qc WHERE batch_id=? AND result='remix'", (b["id"],)).fetchone()[0]
    for sg in signals:
        if sg["equipment_id"] != b["equipment_id"] and not (sg["metric"] == "weigh_kg" and sg["equipment_id"] in scales):
            continue
        r = c.execute("SELECT COUNT(*) n, SUM(value) s, MIN(value) lo, MAX(value) hi, AVG(value) av, MAX(at) last FROM readings "
                      "WHERE signal_id=? AND at>=? AND at<=?", (sg["id"], b["started_at"], end)).fetchone()
        if not r["n"]:
            continue
        m = sg["metric"]
        if m == "weigh_kg":
            top = c.execute("SELECT COALESCE(SUM(value), 0) FROM readings WHERE signal_id=? AND at>? AND at<=?",
                            (sg["id"], first_remix, end)).fetchone()[0] if first_remix else 0
            sc = scales.get(sg["equipment_id"], {"name": "Scale", "material": ""})
            out["kg"], out["weighings"] = out.get("kg", 0) + r["s"], out.get("weighings", 0) + r["n"]
            out["kg_at"], out["kg_top"] = max(out.get("kg_at", ""), r["last"]), out.get("kg_top", 0) + top
            out.setdefault("scales", []).append({"name": sc["name"], "material": sc["material"] or "", "kg": r["s"], "top": top, "n": r["n"]})
        elif m == "temp_c":
            out["temp"] = {"lo": r["lo"], "hi": r["hi"], "at": r["last"],
                           "last": c.execute("SELECT value FROM readings WHERE signal_id=? AND at<=? ORDER BY at DESC LIMIT 1", (sg["id"], end)).fetchone()[0]}
        elif m == "current_pct":
            out["current"] = {"avg": r["av"], "hi": r["hi"], "at": r["last"]}
        elif m == "energy_kwh" and r["n"] > 1:
            out["kwh"], out["kwh_at"] = r["hi"] - r["lo"], r["last"]
    return out


def gateway_key(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def first_number(v):
    if isinstance(v, bool):
        return float(v)
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, list) and v:
        return first_number(v[0])
    if isinstance(v, str):
        m = re.search(r"-?\d+(?:\.\d+)?", v)
        return float(m.group()) if m else None
    return None


def reading_time(v):
    """Unix seconds or ISO time from the gateway; None if missing. Readings more than 5 min ahead or 2 days old are refused."""
    if v in (None, ""):
        return None
    try:
        t = dt.datetime.fromtimestamp(float(v), dt.timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        try:
            t = dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        except ValueError:
            return False
        if t.tzinfo is None:
            t = t.replace(tzinfo=UAE)
    n = dt.datetime.now(dt.timezone.utc)
    if not (n - dt.timedelta(days=2) <= t <= n + dt.timedelta(minutes=5)):
        return False
    return t.astimezone(dt.timezone.utc).isoformat(timespec="seconds")


def collect(body):
    """Accepts {"readings":[{"tag","value","at"}]}, a flat {"tag": value}, or nested lists/objects (e.g. Teltonika segments)
    where an object has a name (tag / name / request_name) and a value (value / data)."""
    out = []

    def walk(o, depth=0):
        if depth > 6:
            return
        if isinstance(o, list):
            for x in o:
                walk(x, depth + 1)
        elif isinstance(o, dict):
            name = next((o[k] for k in ("tag", "name", "request_name", "Request name") if isinstance(o.get(k), str)), None)
            val = next((o[k] for k in ("value", "data", "Register data", "raw") if k in o), None)
            at = next((o[k] for k in ("at", "ts", "timestamp", "time", "date", "Date") if k in o), None)
            if name is not None and val is not None:
                out.append((name.strip(), first_number(val), at))
                return
            for k, v in o.items():
                if isinstance(v, (dict, list)):
                    walk(v, depth + 1)
                elif depth == 0 and k not in ("at", "ts", "timestamp", "time", "date", "Date"):
                    n = first_number(v)
                    if n is not None:
                        out.append((str(k).strip(), n, o.get("at") or o.get("ts")))
    walk(body)
    return out


def ingest(c, environ, body):
    raw = environ.get("HTTP_X_GATEWAY_KEY") or ""
    auth = environ.get("HTTP_AUTHORIZATION") or ""
    if not raw and auth.lower().startswith("bearer "):
        raw = auth[7:].strip()
    g = c.execute("SELECT * FROM gateways WHERE key_hash=?", (gateway_key(raw),)).fetchone() if raw else None
    need(g, "Unknown gateway key.", 401)
    fid = g["factory_id"]
    sigs = {r["tag"]: r for r in c.execute("SELECT * FROM signals WHERE factory_id=?", (fid,))}
    items, unknown, refused, saved = collect(body), set(), 0, 0
    got = []
    for tag, v, at in items:
        if tag not in sigs:
            unknown.add(tag[:60])
            continue
        t = reading_time(at)
        if t is False or v is None or not math.isfinite(v) or abs(v) > 1e12:
            refused += 1
            continue
        sg = sigs[tag]
        got.append((t or now(), sg, v * sg["mult"] + sg["plus"]))
    got.sort(key=lambda x: x[0])
    gap = lambda a, b: a and (dt.datetime.fromisoformat(b) - dt.datetime.fromisoformat(a)).total_seconds() >= QUIET_MIN * 60
    gw_down = gap(g["last_seen"], now())
    if gw_down:
        c.execute("INSERT INTO outages(factory_id,kind,ref_id,started_at,ended_at) VALUES(?,?,?,?,?)", (fid, "gateway", g["id"], g["last_seen"], now()))
    else:
        for sid in {sg["id"] for _, sg, _ in got}:
            first = min(t for t, sg, _ in got if sg["id"] == sid)
            last = next(sg["last_at"] for _, sg, _ in got if sg["id"] == sid)
            if gap(last, first):
                c.execute("INSERT INTO outages(factory_id,kind,ref_id,started_at,ended_at) VALUES(?,?,?,?,?)", (fid, "signal", sid, last, first))
    for t, sg, v in got:
        if c.execute("INSERT OR IGNORE INTO readings(factory_id,signal_id,at,value) VALUES(?,?,?,?)", (fid, sg["id"], t, v)).rowcount:
            saved += 1
            fresh = c.execute("UPDATE signals SET last_value=?, last_at=? WHERE id=? AND (last_at IS NULL OR last_at<=?)", (v, t, sg["id"], t)).rowcount
            if fresh:
                react(c, fid, sg, v, t)
    c.execute("UPDATE gateways SET last_seen=?, last_payload=?, last_unknown=? WHERE id=?",
              (now(), json.dumps(body)[:3000], ", ".join(sorted(unknown))[:500], g["id"]))
    return {"ok": True, "saved": saved, "unknown_tags": sorted(unknown), "refused": refused}


def react(c, fid, sg, v, t):
    """Turn the newest drive values into status and stops. A stop is counted only while a batch is mixing or re-mixing."""
    e = c.execute("SELECT * FROM equipment WHERE id=?", (sg["equipment_id"],)).fetchone()
    if not e:
        return
    if sg["metric"] == "speed_hz":
        busy = c.execute("SELECT 1 FROM batches WHERE equipment_id=? AND status IN ('mixing','remix')", (e["id"],)).fetchone()
        open_stop = c.execute("SELECT * FROM stops WHERE equipment_id=? AND ended_at IS NULL", (e["id"],)).fetchone()
        if v > RUNNING_HZ:
            if e["status"] != "running" or open_stop or e["status_src"] != "sensor":
                set_status(c, e, "running", None, at=t, src="sensor")
        elif busy and not open_stop:
            trip = c.execute("SELECT last_value FROM signals WHERE equipment_id=? AND metric='trip'", (e["id"],)).fetchone()
            code = int(trip["last_value"]) if trip and trip["last_value"] else 0
            set_status(c, e, "stopped", None, "Drive fault" if code else "", f"Trip code {code}" if code else "", at=t, src="sensor")
            log(c, fid, None, "stop", f"{e['name']} stopped during a batch (drive signal)")
        elif not busy and not open_stop and (e["status"] != "idle" or e["status_src"] != "sensor"):
            set_status(c, e, "idle", None, at=t, src="sensor")
    elif sg["metric"] == "trip" and v and v != sg["last_value"]:
        log(c, fid, None, "trip", f"{e['name']} drive trip code {int(v)}")
        c.execute("UPDATE stops SET reason='Drive fault', reason_src='sensor', note=?, updated_at=? WHERE equipment_id=? AND ended_at IS NULL AND reason=''",
                  (f"Trip code {int(v)}", now(), e["id"]))


PRIVATE_METRICS = ("weigh_kg",)  # production figures: the OmniSite team sees that data arrives, not the value


def support_rows(c, where="1=1", *a):
    return [dict(r) for r in c.execute(
        "SELECT s.*, f.name AS factory, u.name AS who FROM support s JOIN factories f ON f.id=s.factory_id "
        f"LEFT JOIN users u ON u.id=s.user_id WHERE {where} ORDER BY s.status='resolved', s.id DESC LIMIT 200", a)]


def health(c, fid):
    """What the OmniSite team sees of a factory: setup and connection health only, never its records or money."""
    rows = lambda q, *a: [dict(r) for r in c.execute(q, a).fetchall()]
    signals = rows("SELECT id, equipment_id, metric, last_value, last_at FROM signals WHERE factory_id=? ORDER BY id", fid)
    for x in signals:
        if x["metric"] in PRIVATE_METRICS:
            x["last_value"] = None
    return {"health_only": True, "now": now(), "today": uae_now().date().isoformat(),
            "factory": dict(c.execute("SELECT id, name FROM factories WHERE id=?", (fid,)).fetchone()),
            "equipment": rows("SELECT id, factory_id, name, kind, status, status_at, status_src, feeds_id, material FROM equipment WHERE factory_id=? ORDER BY id", fid),
            "signals": signals, "gateways": rows("SELECT id, name, created_at, last_seen FROM gateways WHERE factory_id=? ORDER BY id", fid)}


def connections_api(c, method, path, body, fid, uid):
    if method == "GET" and path == "/api/connections":
        rows = lambda q, *a: [{**dict(r), **({"value": None} if "value" in r.keys() and r["metric"] in PRIVATE_METRICS else {}),
                               **({"last_value": None} if "last_value" in r.keys() and r["metric"] in PRIVATE_METRICS else {})}
                              for r in c.execute(q, a).fetchall()]
        return {"gateways": rows("SELECT id, name, created_at, last_seen, last_payload, last_unknown FROM gateways WHERE factory_id=? ORDER BY id", fid),
                "signals": rows("SELECT * FROM signals WHERE factory_id=? ORDER BY id", fid),
                "readings": rows("SELECT r.at, r.value, s.tag, s.metric, s.equipment_id FROM readings r JOIN signals s ON s.id=r.signal_id "
                                 "WHERE r.factory_id=? ORDER BY r.at DESC, r.id DESC LIMIT 100", fid),
                "private_metrics": list(PRIVATE_METRICS),
                "metrics": {k: {"label": v[0], "unit": v[1]} for k, v in METRICS.items()}}
    need(method == "POST", "Not found.", 404)
    if path == "/api/gateways":
        name = text(body.get("name"), 60)
        need(name, "Enter a name, e.g. Gateway near Mixer 1.")
        key = "omg_" + secrets.token_urlsafe(24)
        c.execute("INSERT INTO gateways(factory_id,name,key_hash,created_at) VALUES(?,?,?,?)", (fid, name, gateway_key(key), now()))
        log(c, fid, uid, "gateway", f"Gateway {name} added")
        return {"ok": True, "key": key}
    m = re.fullmatch(r"/api/gateways/(\d+)/remove", path)
    if m:
        g = get(c, "gateways", int(m.group(1)), "gateway", fid)
        c.execute("DELETE FROM gateways WHERE id=?", (g["id"],))
        log(c, fid, uid, "gateway", f"Gateway {g['name']} removed (its key no longer works)")
        return {"ok": True}
    if path == "/api/signals":
        e = get(c, "equipment", int(body.get("equipment_id") or 0), "equipment", fid)
        metric, tag = body.get("metric"), text(body.get("tag"), 60)
        need(metric in METRICS, "Pick what it measures.")
        need(metric != "weigh_kg" or e["kind"] == "mixer" or (e["kind"] == "scale" and e["feeds_id"]), "Link the scale to the mixer it fills first (Equipment → the scale → Link to mixer).")
        need(re.fullmatch(r"[A-Za-z0-9_.\-]{1,60}", tag or ""), "Enter the tag name the gateway sends (letters, numbers, _ . -).")
        need(not c.execute("SELECT 1 FROM signals WHERE factory_id=? AND tag=?", (fid, tag)).fetchone(), f"The tag {tag} is already used.", 409)
        need(not c.execute("SELECT 1 FROM signals WHERE equipment_id=? AND metric=?", (e["id"], metric)).fetchone(),
             f"{e['name']} already has a {METRICS[metric][0].lower()} signal.", 409)
        mult = num(body.get("mult"), "the multiplier", -1e9, 1e9, required=False)
        plus = num(body.get("plus"), "the offset", -1e9, 1e9, required=False)
        c.execute("INSERT INTO signals(factory_id,equipment_id,metric,tag,mult,plus,created_at) VALUES(?,?,?,?,?,?,?)",
                  (fid, e["id"], metric, tag, 1 if mult is None else mult, plus or 0, now()))
        log(c, fid, uid, "gateway", f"Signal {tag} → {e['name']} {METRICS[metric][0].lower()}")
        return {"ok": True}
    m = re.fullmatch(r"/api/signals/(\d+)/remove", path)
    if m:
        sg = get(c, "signals", int(m.group(1)), "signal", fid)
        c.execute("INSERT INTO readings_archive(factory_id,equipment_id,metric,tag,at,value,signal_removed_at) "
                  "SELECT r.factory_id, ?, ?, ?, r.at, r.value, ? FROM readings r WHERE r.signal_id=?",
                  (sg["equipment_id"], sg["metric"], sg["tag"], now(), sg["id"]))  # sensor history is kept for forecasting
        c.execute("DELETE FROM readings WHERE signal_id=?", (sg["id"],))
        c.execute("DELETE FROM signals WHERE id=?", (sg["id"],))
        log(c, fid, uid, "gateway", f"Signal {sg['tag']} removed")
        return {"ok": True}
    raise HTTPError(404, "Not found.")


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
                "team": [dict(r) for r in c.execute("SELECT id, name, email FROM users WHERE is_admin=1 ORDER BY name")],
                "support": support_rows(c),
                "outages": [dict(r) for r in c.execute(
                    "SELECT o.*, f.name AS factory, COALESCE(g.name, e.name) AS name, s.metric FROM outages o JOIN factories f ON f.id=o.factory_id "
                    "LEFT JOIN gateways g ON o.kind='gateway' AND g.id=o.ref_id LEFT JOIN signals s ON o.kind='signal' AND s.id=o.ref_id "
                    "LEFT JOIN equipment e ON e.id=s.equipment_id ORDER BY o.ended_at DESC LIMIT 20")],
                "health": [{**health(c, f["id"]), "faults": [dict(r) for r in c.execute(
                    "SELECT s.equipment_id, e.name AS equipment, s.last_value AS code, s.last_at FROM signals s JOIN equipment e ON e.id=s.equipment_id "
                    "WHERE s.factory_id=? AND s.metric='trip' AND s.last_value IS NOT NULL AND s.last_value<>0", (f["id"],))]}
                    for f in c.execute("SELECT id FROM factories ORDER BY name").fetchall()]}
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
    if path == "/api/admin/support/resolve":
        r = c.execute("SELECT * FROM support WHERE id=?", (int(body.get("id") or 0),)).fetchone()
        need(r, "This request was not found. Refresh the page.", 404)
        if r["status"] != "resolved":
            c.execute("UPDATE support SET status='resolved', resolved_at=?, resolved_by=? WHERE id=?", (now(), user["id"], r["id"]))
        return {"ok": True}
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
        return {"kinds": KINDS, "materials": MATERIALS, "stop_reasons": STOP_REASONS, "loss_types": LOSS_TYPES, "metrics": {k: {"label": v[0], "unit": v[1]} for k, v in METRICS.items()},
                "quiet_min": QUIET_MIN,
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
        return health(c, fid) if role == "admin" else {**state(c, fid), "support": support_rows(c, "s.factory_id=?", fid)}
    if path == "/api/support":
        need(method == "POST", "Not found.", 404)
        need(role in ROLES, "Support requests come from the factory's site manager or owner.", 403)
        msg = text(body.get("text"), 1000)
        need(msg, "Write what went wrong.")
        dup = c.execute("SELECT id FROM support WHERE factory_id=? AND user_id=? AND text=? AND status='open'", (fid, uid, msg)).fetchone()
        if dup:
            return {"ok": True, "id": dup["id"], "existing": True}
        rid = c.execute("INSERT INTO support(factory_id,user_id,at,text) VALUES(?,?,?,?)", (fid, uid, now(), msg)).lastrowid
        return {"ok": True, "id": rid}
    if path in ("/api/connections", "/api/gateways", "/api/signals") or re.fullmatch(r"/api/(gateways|signals)/\d+/remove", path):
        need(role == "admin", "Only the OmniSite team can set up connections.", 403)
        return connections_api(c, method, path, body, fid, uid)
    need(method == "POST", "Not found.", 404)
    need(role != "admin" or path == "/api/equipment" or bool(re.fullmatch(r"/api/equipment/\d+/scale", path)), "The OmniSite team doesn't see or enter the factory's records. The site manager does.", 403)
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
        need(role == "admin", "Pilot equipment is set by the OmniSite team from the approved site survey.", 403)
        name, kind = text(body.get("name"), 60), body.get("kind")
        need(name, "Enter a name, e.g. Mixer 1.")
        need(kind in KINDS, "Pick the type of equipment.")
        need(not c.execute("SELECT 1 FROM equipment WHERE factory_id=? AND lower(name)=lower(?)", (fid, name)).fetchone(),
             f"{name} already exists.", 409)
        feeds, mat = scale_link(c, fid, body) if kind == "scale" else (None, "")
        c.execute("INSERT INTO equipment(factory_id,name,kind,created_at,feeds_id,material) VALUES(?,?,?,?,?,?)", (fid, name, kind, now(), feeds, mat))
        log(c, fid, uid, "equipment", f"Added {name} ({KINDS[kind]})")
        return {"ok": True}
    m = re.fullmatch(r"/api/equipment/(\d+)/scale", path)
    if m:
        need(role == "admin", "Scales are set up by the OmniSite team.", 403)
        e = get(c, "equipment", int(m.group(1)), "equipment", fid)
        need(e["kind"] == "scale", "Only a scale can be linked to a mixer.")
        feeds, mat = scale_link(c, fid, body)
        c.execute("UPDATE equipment SET feeds_id=?, material=? WHERE id=?", (feeds, mat, e["id"]))
        log(c, fid, uid, "equipment", f"{e['name']} fills mixer #{feeds} · {MATERIALS[mat]}")
        return {"ok": True}

    m = re.fullmatch(r"/api/equipment/(\d+)/status", path)
    if m:
        need(role == "admin", "View only. The site manager adds notes and reasons; OmniSite never switches equipment on or off.", 403)
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
        need(role == "manager", "Only the site manager records a batch start. It is a record only; nothing switches the mixer on or off.", 403)
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

    m = re.fullmatch(r"/api/batches/(\d+)/(qc|move|kg)", path)
    if m:
        b = get(c, "batches", int(m.group(1)), "batch", fid)
        e = get(c, "equipment", b["equipment_id"], "mixer", fid)
        if m.group(2) == "kg":
            kg = num(body.get("kg"), "the material used in kg", 0.01, 1_000_000)
            c.execute("UPDATE batches SET kg_used=?, kg_at=? WHERE id=?", (kg, now(), b["id"]))
            log(c, fid, uid, "batch", f"{b['code']} material used: {kg:g} kg")
            return {"ok": True}
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
        c.execute("UPDATE stops SET reason=?, reason_src='manual', note=?, updated_at=? WHERE id=?", (reason, note, now(), s["id"]))
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
        people = each = None
        if body.get("people") not in (None, ""):
            people = num(body.get("people"), "the number of people", 1, 500)
            need(people == int(people), "The number of people must be a whole number.")
            people, each = int(people), num(body.get("hours_each"), "the hours each person worked", 0.25, 24)
            hours = people * each
        else:
            hours = num(body.get("hours"), "the staff-hours", 0.25, 2000)
        c.execute("INSERT INTO labour(factory_id,day,hours,user_id,updated_at,people,hours_each) VALUES(?,?,?,?,?,?,?) "
                  "ON CONFLICT(factory_id,day) DO UPDATE SET hours=excluded.hours, people=excluded.people, hours_each=excluded.hours_each,"
                  "user_id=excluded.user_id,updated_at=excluded.updated_at", (fid, day, hours, uid, now(), people, each))
        log(c, fid, uid, "labour", f"Labour {day}: " + (f"{people} people × {each:g} h = " if people else "") + f"{hours:g} staff-hours")
        return {"ok": True}

    raise HTTPError(404, "Not found.")


# ---------------- WSGI plumbing ----------------
STATUS = {429: "429 Too Many Requests", 200: "200 OK", 400: "400 Bad Request", 401: "401 Unauthorized", 403: "403 Forbidden", 404: "404 Not Found",
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


def demo_login(environ, start, role):
    """Public link to the example factory only: logs in as its demo owner or manager (emails @omnisite.demo)."""
    c = db()
    try:
        u = c.execute("SELECT u.* FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.is_admin=0 AND lower(u.email)=? AND m.role=?",
                      (f"demo.{role}@omnisite.demo", role)).fetchone()
        if not u:
            start(STATUS[404], [("Content-Type", "text/plain; charset=utf-8")])
            return ["The demo factory is not set up.".encode()]
        tok = secrets.token_urlsafe(32)
        exp = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=SESSION_DAYS)).isoformat(timespec="seconds")
        c.execute("DELETE FROM sessions WHERE expires<?", (now(),))
        c.execute("INSERT INTO sessions VALUES(?,?,?)", (tok, u["id"], exp))
        c.commit()
    finally:
        c.close()
    start("302 Found", [("Location", environ.get("SCRIPT_NAME", "") + "/#overview"), ("Cache-Control", "no-store"), cookie(environ, tok, SESSION_DAYS * 86400)])
    return [b""]


def application(environ, start):
    method = environ["REQUEST_METHOD"]
    path = environ.get("PATH_INFO", "/")
    if path.rstrip("/") in ("/demo", "/demo/manager"):
        return demo_login(environ, start, "manager" if path.rstrip("/").endswith("manager") else "owner")
    if not path.startswith("/api/"):
        return static(environ, start, path)
    c = db()
    try:
        n = int(environ.get("CONTENT_LENGTH") or 0)
        need(n <= 64 * 1024, "Request too big.", 413)
        raw = environ["wsgi.input"].read(n) if n else b""
        body = json.loads(raw) if raw else {}
        if path == "/api/ingest" and method == "POST":
            need(isinstance(body, (dict, list)), "Bad request.")
            out = ingest(c, environ, body)
            c.commit()
            return respond(start, STATUS[200], out)
        need(isinstance(body, dict), "Bad request.")
        if path == "/api/login" and method == "POST":
            em = text(body.get("email"), 200).lower()
            login_guard(c, em)
            u = c.execute("SELECT * FROM users WHERE lower(email)=?", (em,)).fetchone()
            if not (u and check_pw(str(body.get("password", "")), u["pw"])):
                login_failed(c, em)
                raise HTTPError(401, "Email or password is wrong.")
            c.execute("DELETE FROM login_fails WHERE email=?", (em,))
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

```

## `ops/static/app.js`

```javascript
"use strict";
// ---------- equipment icons ----------
const ICONS={
 mixer:'<circle cx="12" cy="3.4" r="2.4"/><path d="M10.9 4.3V2.6l1.1 1.2 1.1-1.2v1.7" stroke-width=".8"/><path d="M12 5.8V17"/><path d="M6 10Q6 7.6 12 7.6T18 10v9Q18 21.6 12 21.6T6 19z"/><g class="imp"><ellipse cx="10" cy="17" rx="2" ry=".85"/><ellipse cx="14" cy="17" rx="2" ry=".85"/></g>',
 tank:'<path d="M7 6Q7 2.6 12 2.6T17 6v12Q17 21.2 12 21.2T7 18z"/><path d="M12 21.2v1.6"/><path d="M9.5 12h5" opacity=".55"/>',
 scale:'<path d="M4 8.5h16"/><path d="M12 8.5V12"/><rect x="4.5" y="12" width="15" height="8.5" rx="2"/><rect x="8" y="15" width="8" height="3" rx=".8"/>',
 flask:'<path d="M9 3h6"/><path d="M10 3v6.2L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-8.8V3"/><path d="M7.4 15h9.2"/>',
 motor:'<rect x="3" y="8" width="13" height="9" rx="2"/><path d="M16 12.5h5"/><path d="M6.5 8V6h6v2"/><path d="M6.5 11v3M9.5 11v3M12.5 11v3"/><path d="M5 17v2.5M14 17v2.5"/>',
 gateway:'<rect x="4" y="12" width="16" height="8" rx="2"/><path d="M8 12V5.5"/><path d="M14.2 7.2a3 3 0 0 1 4.2 0"/><path d="M12.6 5.2a5.4 5.4 0 0 1 7.4 0"/><path d="M8 16h.01M11 16h.01"/>',
 bolt:'<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8z"/>',
 person:'<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
 rework:'<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.8v4h-4"/>',
 coins:'<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v5.5c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V6"/><path d="M5 11.5V17c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8v-5.5"/>',
 pump:'<circle cx="10" cy="13" r="6"/><circle cx="10" cy="13" r="1.6"/><path d="M10 7h9v3.5"/><path d="M4 21h12"/><path d="M7 19v2M13 19v2"/>',
 filler:'<path d="M3 4h18"/><path d="M6 4v4M10 4v4M14 4v4M18 4v4"/><path d="M5 8h2l-1 2zM9 8h2l-1 2zM13 8h2l-1 2zM17 8h2l-1 2z"/><rect x="4" y="13" width="3.5" height="7" rx="1"/><rect x="10.2" y="13" width="3.5" height="7" rx="1"/><rect x="16.5" y="13" width="3.5" height="7" rx="1"/>',
 qc:'<path d="M9 3h6"/><path d="M10 3v6.2L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-8.8V3"/><path d="M7.4 15h9.2"/>',
 check:'<circle cx="12" cy="12" r="9"/><path d="M7.5 12.3l3 3 6-6.3"/>',
 cross:'<circle cx="12" cy="12" r="9"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/>',
 thermo:'<path d="M10 4a2 2 0 0 1 4 0v10.3a4 4 0 1 1-4 0z"/><path d="M12 9v7.5"/>',
 other:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'
};
const stCls = {g: "g", a: "a", r: "r", n: "n"};
function ic(name, st, opt = {}) { return `<span class="ic ${opt.size || ""} ${opt.spin ? "spin" : ""} ${st ? `t-${stCls[st]}` : ""}" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[name] || ICONS.other}</svg>${st ? `<span class="bd ${stCls[st]}"></span>` : ""}</span>`; }

// ---------- state + api ----------
const S = {user: null, meta: null, d: null, key: null, busy: false, fid: null, admin: null, viewAs: localStorage.getItem("omni_viewas") || "", pvName: localStorage.getItem("omni_viewas_name") || ""};
const fac = () => (S.user.factories || []).find(f => f.id === S.fid);
const pv = () => "";  // person previews removed: the OmniSite team never sees a factory's records
const team = () => S.user.admin && !pv();
const role = () => pv() || (fac() || {}).role;
const canEdit = () => ["admin", "manager"].includes(role());
function pickFactory() {
  const fs = S.user.factories || [], saved = Number(localStorage.getItem("omni_fid"));
  S.fid = fs.some(f => f.id === saved) ? saved : fs.length ? fs[0].id : null;
}
function switchF(id) { S.fid = Number(id); localStorage.setItem("omni_fid", S.fid); closeD(); S.d = null; if (location.hash === "#admin") location.hash = "#overview"; load(); }
const switcher = () => S.user.admin ? "" : (S.user.factories || []).length > 1 ? `<select class="inp fsel" aria-label="Factory" onchange="switchF(this.value)">${S.user.factories.map(f => `<option value="${f.id}" ${f.id === S.fid ? "selected" : ""}>${h(f.name)}</option>`).join("")}</select>` : "";
const PV = {"": "OmniSite team", manager: "Site manager", owner: "Owner"};
function setViewAs(v, name) { S.viewAs = v && PV[v.split(":")[0]] ? v : ""; S.pvName = S.viewAs && name || ""; if (S.viewAs) localStorage.setItem("omni_viewas", S.viewAs); else localStorage.removeItem("omni_viewas"); if (S.pvName) localStorage.setItem("omni_viewas_name", S.pvName); else localStorage.removeItem("omni_viewas_name"); closeD(); if (pv() && ["#admin", "#connections"].includes(location.hash)) location.hash = "#overview"; render(); }
const pvBar = () => pv() ? `<div class="pvbar"><span>Viewing as ${S.pvName ? `${h(S.pvName)} (${PV[pv()]})` : PV[pv()]} · preview, nothing is saved</span><button class="lo" type="button" onclick="setViewAs('');location.hash='#admin'">Back to OmniSite team</button></div>` : "";
const $ = s => document.querySelector(s);
const h = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const BASE = location.pathname.replace(/\/[^/]*$/, "");  // "" at /, "/ops" when mounted under /ops/
const GLOBAL = /^\/api\/(login|logout|me|meta|admin)(\/|$)/;
async function api(method, path, body) {
  if (pv() && method !== "GET" && !/^\/api\/(login|logout)$/.test(path)) throw {status: 0, error: `Preview as ${PV[pv()]}: nothing is saved. Click “Back to OmniSite team” to make changes.`};
  if (!GLOBAL.test(path)) path = `/api/f/${S.fid}` + path.slice(4);
  const opt = {method, headers: {}, credentials: "same-origin"};
  if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers["Content-Type"] = "application/json"; }
  let r;
  try { r = await fetch(BASE + path, opt); } catch (e) { throw {status: 0, error: "No internet connection. Nothing was saved. Please try again."}; }
  let d = {};
  try { d = await r.json(); } catch (e) {}
  if (r.status === 401 && path !== "/api/login") { S.user = null; closeD(); render(); }
  if (!r.ok) throw {status: r.status, error: d.error || "Could not save. Please try again."};
  return d;
}
let toastT;
function toast(msg) { $("#toastMsg").textContent = msg; $("#toast").classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => $("#toast").classList.remove("on"), 3000); }

// ---------- time (UAE) ----------
const TZ = "Asia/Dubai";
const dayOf = iso => new Intl.DateTimeFormat("en-CA", {timeZone: TZ}).format(new Date(iso));
const hm = iso => new Intl.DateTimeFormat("en-GB", {timeZone: TZ, hour: "2-digit", minute: "2-digit"}).format(new Date(iso));
const wd = day => new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", {weekday: "short", timeZone: "UTC"});
const dm = day => new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", {weekday: "short", day: "numeric", month: "short", timeZone: "UTC"});
const nowMs = () => Date.now();
const minsBetween = (a, b) => Math.max(0, Math.round(((b ? new Date(b) : new Date()) - new Date(a)) / 6e4));
function when(iso) {
  if (!iso) return "";
  const m = minsBetween(iso);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const d = dayOf(iso);
  return d === S.d.today ? hm(iso) : `${wd(d)} ${hm(iso)}`;
}
const mins = m => m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return [s / 3600, s / 60 % 60, s % 60].map(x => String(Math.floor(x)).padStart(2, "0")).join(":"); };
const fmt = (n, dp = 0) => Number(n).toLocaleString("en-US", {maximumFractionDigits: dp, minimumFractionDigits: 0});
function lastDays(n) { const out = [], t = new Date(S.d.today + "T12:00:00Z"); for (let i = n - 1; i >= 0; i--) out.push(new Date(t - i * 864e5).toISOString().slice(0, 10)); return out; }

// ---------- small render helpers ----------
const SRC = (i, t) => `<span class="src"><i>${i}</i>${t}</span>`;
const manual = t => SRC("✎", "Manual · " + t), est = t => SRC("≈", "Estimate · " + t);
const sensor = t => SRC("●", "Sensor · " + t);
const srcOf = (x, t) => x && x.source === "sensor" ? sensor(t) : manual(t);
const reasonSrc = (s, t) => s.reason_src === "sensor" ? sensor(t) : manual(t);
const sig = (eid, m) => (S.d.signals || []).find(x => x.equipment_id === eid && x.metric === m);
const scalesOf = mid => S.d.equipment.filter(e => e.kind === "scale" && e.feeds_id === mid);
const hasScale = mid => !!sig(mid, "weigh_kg") || scalesOf(mid).some(x => !!sig(x.id, "weigh_kg"));
const matL = m => (S.meta.materials || {})[m] || "";
const scaleLine = e => e.feeds_id ? `Fills ${h(eq(e.feeds_id).name)} · ${h(matL(e.material))}` : `<span class="nr">Not linked to a mixer</span>`;
const loading = b => b.s && b.s.kg != null && ["mixing", "remix"].includes(b.status) ? `Loading: ${fmt(b.s.kg, 0)} kg so far · ${b.s.weighings} weighing${b.s.weighings === 1 ? "" : "s"}` : "";
const topVal = (w, m, why) => m.top !== null ? `AED ${fmt(m.top)}` : w.scaled.length ? `${fmt(w.topKg, 0)} kg` : why ? NR(why) : `<span class="nr">Not recorded</span>`;
const scaleRows = b => { const sc = (b.s && b.s.scales) || []; return sc.length > 1 || sc.some(x => x.material) ? `<h4>Material weighed</h4>${rows(sc.map(x => [`${h(x.name)}${x.material ? ` · ${h(matL(x.material))}` : ""}`, `${fmt(x.kg, 0)} kg`, `${x.n} weighing${x.n === 1 ? "" : "s"}${x.top ? ` · ${fmt(x.top, 0)} kg added after QC failed` : ""}`]))}${sensor(when(b.s.kg_at))}` : ""; };
const unit = m => S.meta.metrics[m].unit;
const sigVal = x => x.last_value === null ? NR("No data yet") : x.metric === "trip" ? (x.last_value ? `<span class="st"><span class="dot r"></span>Trip ${fmt(x.last_value)}</span>` : "No trip") : `${fmt(x.last_value, 2)} ${unit(x.metric)}`;
const sensorStops = () => S.d.stops.some(s => s.source === "sensor");
const stopsSrc = m => sensorStops() ? `<i>●</i>Sensor · drive stops · <i style="margin-left:6px">✎</i>Manual · reasons` : `<i>✎</i>Manual · ${m}`;
const kgOf = b => b.kg_used != null ? b.kg_used : b.s && b.s.kg != null ? b.s.kg : null;
const quiet = g => { const t = g.last_seen || g.created_at; return minsBetween(t) >= S.meta.quiet_min; };
const needsConn = what => `<span class="nr">Needs connection</span><div class="why">${what}</div>`;
const NR = w => `<span class="nr">Not recorded</span>${w ? `<div class="why">${w}</div>` : ""}`;
const rows = a => a.map(([k, v, s, icn, open]) => `<div class="li" ${open ? `data-open="${open}" tabindex="0" style="cursor:pointer"` : ""}><div class="l">${icn || ""}<div>${k}${s ? `<div>${s}</div>` : ""}</div></div><div class="v">${v}</div></div>`).join("");
const tl = a => `<ul class="tl">${a.map(([tm, c, t]) => `<li><span class="tm">${tm}</span><span class="dot ${c}"></span><span>${t}</span></li>`).join("")}</ul>`;
const stLine = (c, t) => `<span class="st"><span class="dot ${c}"></span>${t}</span>`;
const empty = t => `<div class="empty">${t}</div>`;
function bars(obj, unit) {
  const e = Object.entries(obj).filter(([, v]) => v > 0);
  if (!e.length) return empty("Nothing recorded this week.");
  const max = Math.max(...e.map(x => x[1]));
  return e.sort((a, b) => (a[0].includes("not entered") ? 1 : 0) - (b[0].includes("not entered") ? 1 : 0) || b[1] - a[1]).map(([k, v]) => { const ne = k.includes("not entered");
    return `<div style="margin:8px 0"><div class="row" style="font-size:13px"><span class="${ne ? "muted" : ""}">${h(k)}</span><b style="font-weight:600">${unit(v)}</b></div><div class="bar" style="margin:6px 0 0;height:6px"><b style="width:${v / max * 100}%;${ne ? "background:repeating-linear-gradient(45deg,#ddd 0 3px,#f3f3f3 3px 6px)" : ""}"></b></div></div>`; }).join("");
}
function dailyChart(data) {
  const W = 420, H = 210, pad = 24, bw = 30, step = (W - pad * 2) / data.length;
  const max = Math.max(2, ...data.map(d => d.v[0] + d.v[1] + d.v[2]));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Batches per day"><defs><pattern id="hp" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#fff"/><rect width="2.2" height="5" fill="#c9c9c9"/></pattern></defs>`;
  for (let g = 0; g <= max; g += Math.ceil(max / 3)) { const y = H - pad - (g / max) * (H - pad * 2); s += `<line x1="${pad}" x2="${W - 6}" y1="${y}" y2="${y}" stroke="#eee"/><text x="${pad - 8}" y="${y + 4}" font-size="10" fill="#999" text-anchor="end">${g}</text>`; }
  data.forEach((d, i) => { const x = pad + i * step + (step - bw) / 2; let y = H - pad; const cols = ["#111", "#a6a6a6", "url(#hp)"], tot = d.v[0] + d.v[1] + d.v[2], last = i === data.length - 1;
    d.v.forEach((n, k) => { if (!n) return; const hh = n / max * (H - pad * 2); y -= hh; s += `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(1, hh - 1.5)}" rx="4" fill="${cols[k]}" ${k === 2 ? 'stroke="#c9c9c9"' : ""}/>`; });
    s += `<text x="${x + bw / 2}" y="${y - 6}" font-size="11" fill="${tot ? "#333" : "#bbb"}" text-anchor="middle" font-weight="600">${tot || hasDay(d.day) ? tot : "–"}</text>`;
    s += `<text x="${x + bw / 2}" y="${H - 8}" font-size="11" fill="${last ? "#111" : "#888"}" text-anchor="middle" ${last ? 'font-weight="600"' : ""}>${last ? "Today" : wd(d.day)}</text>`; });
  return s + "</svg>" + (data.some(d => hasDay(d.day)) ? "" : `<div class="why">Not recorded yet. A day shows a number once something is entered that day.</div>`);
}
const LEGEND = `<div class="lg"><span><span class="sw" style="background:#111"></span>Passed first time</span><span><span class="sw" style="background:#a6a6a6"></span>Re-mixed, then passed</span><span><span class="sw" style="background:repeating-linear-gradient(45deg,#fff 0 2px,#c9c9c9 2px 4px);border:1px solid #c9c9c9"></span>Rejected</span></div>`;

// ---------- derived numbers (only from saved records) ----------
const setv = k => S.d.settings[k] ? S.d.settings[k].value : null;
const setn = k => setv(k) === null ? null : Number(setv(k));
const eq = id => S.d.equipment.find(e => e.id === id) || {name: "Removed equipment", kind: "other"};
const mixers = () => S.d.equipment.filter(e => e.kind === "mixer");
const openStop = eid => S.d.stops.find(s => s.equipment_id === eid && !s.ended_at);
const activeBatch = eid => S.d.batches.find(b => b.equipment_id === eid && ["mixing", "remix", "passed"].includes(b.status));
const qcOf = bid => S.d.qc.filter(q => q.batch_id === bid);
const lastQc = b => qcOf(b.id).slice(-1)[0];
const qcCells = b => { const q = lastQc(b); return q ? `<td>${fmt(q.ph, 2)}</td><td>${fmt(q.visc)} cP</td>` : `<td><span class="nr">Not recorded</span></td><td><span class="nr">Not recorded</span></td>`; };
const finishedDay = b => b.status === "moved" ? dayOf(b.moved_at) : (b.status === "passed" || b.status === "rejected") && b.finished_at ? dayOf(b.finished_at) : null;
function eqState(e) {
  if (openStop(e.id)) return {st: "r", label: "Stopped", spin: false};
  const tr = sig(e.id, "trip");
  if (tr && tr.last_value) return {st: "r", label: "Drive fault", spin: false};
  const b = S.d.batches ? activeBatch(e.id) : null;
  if (e.kind === "mixer" && b) return b.status === "passed" ? {st: e.status === "running" ? "g" : "n", label: "Passed QC · waiting to move", spin: false} : {st: "g", label: b.status === "remix" ? "Running · re-mixing" : "Running", spin: true};
  if (e.status === "running") return {st: "g", label: "Running", spin: e.kind === "mixer"};
  if (e.status === "idle") return {st: "n", label: "Idle", spin: false};
  const ws = e.kind === "scale" && sig(e.id, "weigh_kg");
  if (ws) return ws.last_at ? {st: "g", label: `Connected · last weighing ${when(ws.last_at)}`, spin: false} : {st: "n", label: "Connected · no weighing yet", spin: false};
  return {st: "n", label: "Not connected yet", spin: false};
}
function today() {
  const t = S.d.today, done = S.d.batches.filter(b => b.status === "moved" && dayOf(b.moved_at) === t);
  return {done: done.length, target: setn("target_batches"), litres: setn("batch_litres"), started: S.d.batches.filter(b => b.day === t).length};
}
function dayMins(s, day) {  // minutes of stop s that fall on this UAE day
  const ds = new Date(day + "T00:00:00+04:00").getTime(), de = ds + 864e5;
  const st = Math.max(new Date(s.started_at).getTime(), ds), en = Math.min(s.ended_at ? new Date(s.ended_at).getTime() : Date.now(), de);
  return Math.max(0, Math.round((en - st) / 6e4));
}
const hasDay = d => S.d.batches.some(b => b.day === d || finishedDay(b) === d) || S.d.qc.some(q => dayOf(q.at) === d) || S.d.stops.some(s => dayOf(s.started_at) === d) || S.d.losses.some(l => l.day === d) || S.d.labour.some(l => l.day === d);
const NRs = `<span class="nr">Not recorded</span>`;
const inBatch = s => S.d.batches.some(b => b.equipment_id === s.equipment_id && b.started_at <= (s.ended_at || "9999") && (b.finished_at || "9999") >= s.started_at);
const batchMins = (s, from) => {  // minutes of this stop that fall inside a batch on the same mixer
  const t = x => x ? new Date(x).getTime() : Date.now(), a = Math.max(t(s.started_at), from ? t(from) : 0), z = t(s.ended_at);
  return Math.round(S.d.batches.filter(b => b.equipment_id === s.equipment_id).reduce((m, b) => m + Math.max(0, Math.min(z, t(b.finished_at)) - Math.max(a, t(b.started_at))), 0) / 6e4);
};
function week() {
  const days = lastDays(7), set = new Set(days);
  const fin = S.d.batches.filter(b => set.has(finishedDay(b)));
  const cls = b => b.status === "rejected" ? 2 : b.qc_count > 1 ? 1 : 0;
  const daily = days.map(day => { const v = [0, 0, 0]; fin.filter(b => finishedDay(b) === day).forEach(b => v[cls(b)]++); return {day, v}; });
  const ws = new Date(days[0] + "T00:00:00+04:00").toISOString();
  const from = s => s.started_at < ws ? ws : s.started_at, sm = s => minsBetween(from(s), s.ended_at);
  const stops = S.d.stops.filter(s => set.has(dayOf(s.started_at)) || !s.ended_at || s.ended_at >= ws);
  const stopMin = stops.reduce((a, s) => a + sm(s), 0);
  const mixerStopMin = stops.filter(s => eq(s.equipment_id).kind === "mixer").reduce((a, s) => a + sm(s), 0);
  const reasons = {};
  stops.forEach(s => { const k = s.reason || "Reason not entered"; reasons[k] = (reasons[k] || 0) + sm(s); });
  const causes = {};
  S.d.qc.filter(q => q.result === "remix" && set.has(dayOf(q.at))).forEach(q => { const k = `${q.cause_what} ${q.cause_dir.toLowerCase()}`; causes[k] = (causes[k] || 0) + 1; });
  const perDay = days.map(day => ({day, m: stops.reduce((a, s) => a + dayMins(s, day), 0)}));
  const losses = S.d.losses.filter(l => set.has(l.day)), lossKg = losses.reduce((a, l) => a + l.kg, 0);
  const lab = S.d.labour.filter(l => set.has(l.day)), labH = lab.reduce((a, l) => a + l.hours, 0);
  const n = [0, 0, 0]; fin.forEach(b => n[cls(b)]++);
  const withKg = fin.filter(b => kgOf(b) != null), kgUsed = withKg.reduce((a, b) => a + kgOf(b), 0);
  const scaled = fin.filter(b => b.kg_used == null && b.s && b.s.kg != null), topKg = scaled.reduce((a, b) => a + (b.s.kg_top || 0), 0);
  const timed = S.d.batches.filter(b => b.finished_at && b.status !== "rejected");
  const batchStopMin = stops.filter(s => eq(s.equipment_id).kind === "mixer").reduce((a, s) => a + batchMins(s, ws), 0);
  const avgMin = timed.length ? timed.reduce((a, b) => a + minsBetween(b.started_at, b.finished_at), 0) / timed.length : null;
  return {days, daily, fin, scaled, topKg, n, stops, stopMin, mixerStopMin, reasons, causes, perDay, losses, lossKg, lab, labH, withKg, kgUsed, avgMin,
    lost: avgMin && timed.length >= 5 ? batchStopMin / avgMin : null, batchStopMin, timedN: timed.length, rec: days.some(hasDay),
    remixes: S.d.qc.filter(q => q.result === "remix" && set.has(dayOf(q.at))).length};
}
function money(w) {
  const p = setn("price_kg"), sc = setn("stop_cost_h"), lr = setn("labour_rate");
  return {mat: p !== null ? w.lossKg * p : null, down: sc !== null ? w.mixerStopMin / 60 * sc : null, lab: lr !== null ? w.labH * lr : null, top: p !== null && w.scaled.length ? w.topKg * p : null};
}
function lostLine(min, w) {  // effect of mixer stop minutes, without any prices
  if (!min) return "";
  if (!w.avgMin || w.timedN < 5) return `<div class="why">Batches not made: needs at least 5 finished batches to estimate (${w.timedN} so far)</div>`;
  const n = min / w.avgMin;
  return `<div class="row" style="margin-top:6px"><span>≈ <b style="font-weight:600">${fmt(n, 1)}</b> batch${fmt(n, 1) === "1" ? "" : "es"} not made</span></div>${est(`${mins(min)} of mixer stops during batches ÷ average batch time ${mins(Math.round(w.avgMin))}`)}`;
}
const peopleLine = x => x ? `${x.people ? `${x.people} people × ${fmt(x.hours_each, 2)} h = ` : ""}${fmt(x.hours, 2)} staff-hours` : "";
const kgToday = () => { const b = S.d.batches.filter(x => finishedDay(x) === S.d.today && kgOf(x) != null); return b.length ? b.reduce((a, x) => a + kgOf(x), 0) : null; };
function lastAt(list, key) { const t = list.map(x => x[key]).filter(Boolean).sort().pop(); return t ? when(t) : null; }

// ---------- alerts + actions ----------
function alerts() {
  const out = [];
  S.d.equipment.forEach(e => { const s = openStop(e.id); if (!s) return;
    out.push({c: "red", open: `stop:${s.id}`, icon: ic(e.kind, "r"), head: stLine("r", "Stopped"), t: `${h(e.name)} stopped · ${mins(minsBetween(s.started_at))}`,
      head: stLine("r", s.source === "sensor" ? "Stopped mid-batch" : "Stopped"),
      d: s.reason ? `Reason: <b>${h(s.reason)}</b>${s.note ? ` · ${h(s.note)}` : ""}` : "No reason entered yet.", src: srcOf(s, `${s.source === "sensor" ? "drive stopped" : "marked stopped"} ${when(s.started_at)}`), btn: s.reason ? "Open" : "Add reason"}); });
  (S.d.signals || []).filter(x => x.metric === "trip" && x.last_value).forEach(x => { const e = eq(x.equipment_id);
    out.push({c: "red", open: `eq:${e.id}`, icon: ic(e.kind, "r"), head: stLine("r", "Drive trip"), t: `${h(e.name)} drive reported trip code ${fmt(x.last_value)}`, d: "Check the drive display. The code is from the drive, not entered by staff.", src: sensor(when(x.last_at)), btn: "Open"}); });
  (S.d.gateways || []).filter(quiet).forEach(g => out.push({c: "amber", open: `gw:${g.id}`, icon: ic("gateway", "a"), head: stLine("a", "Not sending data"), t: `${h(g.name)} is not sending data`,
    d: g.last_seen ? `Last data ${when(g.last_seen)}. Sensor values below are not live. Check power and 4G at the gateway.` : "No data received yet since it was added.", src: "", btn: "Open"}));
  return out;
}
function actions() {
  const out = [], w = week();
  w.stops.filter(s => s.ended_at && !s.reason).forEach(s => out.push({c: "red", open: `stop:${s.id}`, icon: ic(eq(s.equipment_id).kind, "r"), code: h(eq(s.equipment_id).name), tag: stLine("r", "Reason needed"),
    d: `Stopped ${dm(dayOf(s.started_at))} ${hm(s.started_at)} for ${mins(minsBetween(s.started_at, s.ended_at))}. Add why it stopped.`, src: srcOf(s, s.source === "sensor" ? "drive stopped" : "stop entered"), btn: "Add reason"}));
  S.d.batches.filter(b => ["mixing", "remix", "passed"].includes(b.status)).forEach(b => {
    const e = eq(b.equipment_id);
    if (b.status === "passed") out.push({c: "amber", open: `batch:${b.id}`, icon: ic("tank", "a"), code: h(b.code), tag: stLine("a", "Waiting to move"), d: `Passed QC. Confirm it was moved to the holding tank.`, src: manual(`QC passed ${when(b.finished_at)}`), btn: "Mark as moved", act: `move:${b.id}`});
    else if (b.status === "remix") out.push({c: "amber", open: `batch:${b.id}`, icon: ic("qc", "a"), code: h(b.code), tag: stLine("a", "Re-mixing"), d: `${h(e.name)} · enter QC again when the re-mix is done.`, src: manual(`QC ${when(qcOf(b.id).slice(-1)[0].at)}`), btn: "Enter QC again"});
    else out.push({c: "grey", open: `batch:${b.id}`, icon: ic("qc", "n"), code: h(b.code), tag: stLine("n", "Mixing"), d: `${h(e.name)} · enter the QC readings (pH, viscosity) when checked.`, src: manual(`started ${when(b.started_at)}`), btn: "Enter QC readings", ghost: true});
  });
  S.d.batches.filter(b => finishedDay(b) === S.d.today && kgOf(b) == null).forEach(b => out.push(hasScale(b.equipment_id)
    ? {c: "amber", open: "support", icon: ic("scale", "a"), code: h(b.code), tag: stLine("a", "No weight"), d: "No weight came from the scale for this batch. Check the scale connection.", src: "", btn: "Request support", ghost: true}
    : {c: "grey", open: `batch:${b.id}`, icon: ic("scale", "n"), code: h(b.code), tag: stLine("n", "Missing info"), d: "Enter the kg of material used for this batch.", src: "", btn: "Enter kg used", ghost: true}));
  if (S.d.equipment.length && setn("target_batches") === null) out.push({c: "grey", open: "settings", icon: ic("mixer", "n"), code: "Daily target", tag: stLine("n", "Not set"), d: "Set how many batches are planned per day.", src: "", btn: "Set target", ghost: true});
  return out;
}
const alertCard = a => `<div class="al ${a.c}" data-open="${a.open}" tabindex="0">${a.icon}<div>${a.head || ""}<div class="t">${a.t}</div><div class="d">${a.d}</div>${a.src}<div class="act"><button class="btn" type="button" data-open="${a.open}">${a.btn}</button></div></div></div>`;
const actCard = a => `<div class="al ${a.c}" data-open="${a.open}" tabindex="0">${a.icon}<div><div class="row"><span class="mono">${a.code}</span>${a.tag}</div><div class="d" style="margin-top:4px">${a.d}</div>${a.src}<div class="act"><button class="btn ${a.ghost ? "ghost" : ""}" type="button" ${a.act ? `data-act="${a.act}"` : `data-open="${a.open}"`}>${a.btn}</button></div></div></div>`;

// ---------- manager views ----------
const VIEWS = {overview: "Operations overview", batches: "Batches", downtime: "Downtime", costs: "Costs", equipment: "Equipment"};
const NAV_IC = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  batches: '<path d="M6 3h12M7 3v6l-3 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-3-9V3"/>', downtime: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  costs: '<path d="M4 19h16M7 16V9M12 16V5M17 16v-4"/>', equipment: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'};
const view = () => S.user && S.user.admin ? (location.hash === "#admin" ? "admin" : location.hash === "#connections" && S.fid ? "connections" : "support") : VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : "overview";
const LEG = () => `<div class="legend"><span class="src" style="margin:0"><i>✎</i>Manual: entered by the site manager</span><span class="src" style="margin:0"><i>≈</i>Estimate: calculated from your prices</span><span class="src" style="margin:0"><i>●</i>Sensor: ${S.d && (S.d.signals || []).length ? "read automatically" : "not connected yet"}</span></div>`;
const fname = () => S.d && S.d.factory ? S.d.factory.name : (fac() || {}).name || "";
const nowLine = () => `${new Date().toLocaleDateString("en-GB", {weekday: "long", day: "numeric", month: "short", timeZone: TZ})} · Now ${hm(new Date().toISOString())}`;

function manager() {
  const v = view();
  if (S.user.admin) {
    const link = (k, label, icon) => `<a href="#${k}" class="${k === v ? "on" : ""}" ${k === v ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24">${icon}</svg><span>${label}</span></a>`;
    const nOpen = S.admin ? S.admin.support.filter(r => r.status === "open").length + sensorAlerts(S.admin).length : 0;
    const nav = link("support", `Support${nOpen ? ` · ${nOpen}` : ""}`, '<path d="M4 5h16v11H9l-5 4z"/>') + (S.fid ? link("connections", "Connections", ICONS.gateway) : "") + link("admin", "Factories", '<path d="M4 21V9l5 3V9l5 3V5h6v16z"/>');
    if (v === "admin") return shell(nav, "Factories", vAdmin(), "");
    if (v === "connections") return shell(nav, "Connections", vConn(), "");
    return shell(nav, "Support", vSupport(), "");
  }
  const nav = Object.keys(VIEWS).map(k => `<a href="#${k}" data-v="${k}" class="${k === v ? "on" : ""}" ${k === v ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24">${NAV_IC[k]}</svg><span>${k === "overview" ? "Overview" : VIEWS[k]}</span></a>`).join("");
  const body = !S.d.equipment.length && v !== "equipment" ? setupCard() : {overview: vOverview, batches: vBatches, downtime: vDowntime, costs: vCosts, equipment: vEquipment}[v]();
  const rail = v === "overview" && S.d.equipment.length ? railHtml() : "";
  return shell(nav, VIEWS[v], body, rail);
}
function shell(nav, title, body, rail) {
  const who = S.user.admin ? "OmniSite team" : "Site manager";
  return `<div class="app"><aside class="side"><div class="brand">OmniSite<small>${[who, fname() && (!S.user.admin || title === "Connections") ? h(fname()) : ""].filter(Boolean).join(" · ")}</small></div>${switcher()}<nav class="nav">${nav}</nav>
   <div class="foot">${S.user.admin ? "" : `<button class="lo" type="button" data-open="support">Request support</button><br>`}${h(S.user.name)}<br><button class="lo" type="button" onclick="logout()">Log out</button></div></aside>
   <main>${pvBar()}<div class="top"><div><h1>${title}</h1><div class="sub">${nowLine()}</div></div><div><div class="mwho">${S.user.admin ? "" : `<button class="lo" type="button" data-open="support">Request support</button> · `}${h(S.user.name)} · <button class="lo" type="button" onclick="logout()">Log out</button></div>${S.user.admin ? "" : LEG()}</div></div>
   <div class="layout ${rail ? "" : "solo"}"><div class="grid">${body}</div>${rail}</div></main></div>`;
}
function vAdmin() {
  const A = S.admin; if (!A) return `<section class="card c6"><div class="muted">Loading…</div></section>`;
  const add = `<section class="card c6"><div class="ch"><span class="ct">${ic("other")}Factories · ${A.factories.length}</span><button class="btn" type="button" data-open="addFactory">Add factory</button></div>
    <div class="why">Each factory has its own equipment, records and logins. Site managers and owners only see the factories they're added to. The OmniSite team sets them up and sees connection health and support requests only, never their records or money.</div></section>`;
  const cards = A.factories.map(f => { const ppl = A.people.filter(p => p.factory_id === f.id);
    return `<section class="card c3"><div class="ch"><span class="ct">${ic("mixer")}<b style="font-weight:600;color:var(--ink)">${h(f.name)}</b></span></div>
      ${ppl.length ? rows(ppl.map(p => [`<b style="font-weight:600">${h(p.name)}</b><div class="why">${p.role === "owner" ? "Owner · view only" : "Site manager"} · ${h(p.email)}</div>`, `<button class="lo" type="button" data-act="rm:${p.user_id}:${f.id}" aria-label="Remove ${h(p.name)}" style="font-weight:400">Remove</button>`, "", ic("person", null, {size: "sm"})])) : empty("No logins yet. Add the site manager and the owner.")}
      <div class="btns"><button class="btn ghost" type="button" data-open="addPerson:${f.id}">Add person</button></div></section>`; }).join("");
  const team = `<section class="card c6"><div class="ch"><span class="ct">${ic("person")}OmniSite team · sees all factories</span></div>${rows(A.team.map(u => [h(u.name), h(u.email), ""]))}<div class="why" style="margin-top:8px">Team logins are added by OmniSite on the server.</div></section>`;
  return add + (cards || `<section class="card c6 setup"><div class="muted">No factories yet. Tap “Add factory” to add the first one.</div></section>`) + team;
}
function vConn() {
  const C = S.conn; if (!C) return `<section class="card c6"><div class="muted">Loading…</div></section>`;
  const M = C.metrics, url = `${location.origin}${BASE}/api/ingest`, tagsOf = C.signals.map(x => x.tag);
  const gws = `<section class="card c6"><div class="ch"><span class="ct">${ic("gateway")}Gateways · ${C.gateways.length}</span><button class="btn" type="button" data-open="addGw">Add gateway</button></div>
    <div class="why">OmniSite team only. Each gateway has its own key; the factory's staff never see this page.</div>
    ${C.gateways.length ? rows(C.gateways.map(g => [`<b style="font-weight:600">${h(g.name)}</b>${g.last_unknown ? `<div class="why">Tags not linked yet: ${h(g.last_unknown)}</div>` : ""}`, g.last_seen ? stLine(quiet(g) ? "a" : "g", quiet(g) ? "Not sending data" : "Online") : stLine("n", "No data yet"),
      `${g.last_seen ? sensor(`last data ${when(g.last_seen)}`) : `added ${when(g.created_at)}`} <button class="lo" type="button" data-act="rmgw:${g.id}" style="margin-left:8px">Remove</button>`, ic("gateway", null, {size: "sm"}), `gw:${g.id}`])) : empty("No gateway yet. Add it on the day the engineer installs it.")}</section>`;
  const sigs = `<section class="card c6"><div class="ch"><span class="ct">${ic("bolt")}Signals · ${C.signals.length}</span><button class="btn ghost" type="button" data-open="addSig">Add signal</button></div>
    <div class="why">Link each tag the gateway sends to a piece of equipment.</div>
    ${C.signals.length ? `<table class="rec"><thead><tr><th>Tag</th><th>Equipment</th><th>Measures</th><th class="hidem">Conversion</th><th>Last value</th><th></th></tr></thead><tbody>${C.signals.map(x => `<tr><td class="mono">${h(x.tag)}</td><td>${h(eq(x.equipment_id).name)}</td><td>${h(M[x.metric].label)}</td><td class="hidem">× ${fmt(x.mult, 6)}${x.plus ? ` + ${fmt(x.plus, 4)}` : ""}</td><td>${x.last_at ? `${x.last_value == null ? "Received" : `${fmt(x.last_value, 2)} ${h(M[x.metric].unit)}`}<div class="why">${when(x.last_at)}</div>` : `<span class="nr">No data yet</span>`}</td><td><button class="lo" type="button" data-act="rmsig:${x.id}">Remove</button></td></tr>`).join("")}</tbody></table>` : empty("No signals yet.")}</section>`;
  const ex = JSON.stringify({readings: (tagsOf.length ? tagsOf.slice(0, 3) : ["mixer1_hz"]).map(t => ({tag: t, value: 0, at: "unix time or ISO"}))}, null, 1);
  const eng = `<section class="card c6"><div class="ch"><span class="ct">${ic("other")}Settings for the engineer</span></div>
    ${rows([["1. Server address (HTTP POST)", `<span class="mono" style="word-break:break-all">${h(url)}</span>`, ""], ["2. HTTP header", `<span class="mono">X-Gateway-Key: (the gateway key)</span>`, ""], ["3. Content type", `<span class="mono">application/json</span>`, ""]])}
    <div class="why" style="margin-top:8px">Body: either this format, or the gateway's own JSON with a name and a value for each reading. Values are converted with each signal's multiplier, e.g. Altivar 212 speed FD00 is in 0.01 Hz → multiplier 0.01; energy FE76 is in Wh → 0.001 for kWh. Confirm the format on site with "Last message received".</div>
    <pre class="mono" style="background:#f7f7f7;border:1px solid var(--line);border-radius:10px;padding:10px;font-size:12px;overflow:auto">${h(ex)}</pre></section>`;
  const rd = `<section class="card c6"><div class="ch"><span class="ct">${ic("scale")}Recent readings · last ${C.readings.length}</span><button class="btn ghost" type="button" data-act="refconn">Refresh</button></div>
    ${C.readings.length ? `<table class="rec"><thead><tr><th>Time</th><th>Tag</th><th>Equipment</th><th>Value</th></tr></thead><tbody>${C.readings.map(r => `<tr><td>${dm(dayOf(r.at))} ${hm(r.at)}:${new Date(r.at).toISOString().slice(17, 19)}</td><td class="mono">${h(r.tag)}</td><td>${h(eq(r.equipment_id).name)}</td><td>${r.value == null ? `<span class="muted">Received</span>` : `${fmt(r.value, 3)} ${h(M[r.metric].unit)}`}</td></tr>`).join("")}</tbody></table>` : empty("No readings received yet.")}</section>`;
  const fs = S.user.factories || [];
  const pick = fs.length > 1 ? `<section class="card c6"><div class="ch"><span class="ct">${ic("gateway")}Factory</span><span>${fs.map(f => `<button class="btn ${f.id === S.fid ? "" : "ghost"}" type="button" data-act="cf:${f.id}" ${f.id === S.fid ? 'aria-pressed="true"' : ""} style="margin-left:6px">${h(f.name)}</button>`).join("")}</span></div><div class="why">Gateways and signals below belong to ${h(fname())} only.</div></section>` : "";
  const eqs = `<section class="card c6"><div class="ch"><span class="ct">${ic("other")}Equipment · ${S.d.equipment.length}</span><button class="btn ghost" type="button" data-open="addEq">Add equipment</button></div>
    <div class="why">Name each machine with the number on its OmniSite label, e.g. Scale 1. Link each scale to the mixer it fills and say what it weighs.</div>
    ${S.d.equipment.length ? rows(S.d.equipment.map(e => [`<b style="font-weight:600">${h(e.name)}</b> <span class="muted">· ${h(S.meta.kinds[e.kind])}</span>`, e.kind === "scale" ? `<button class="lo" type="button" data-open="sclink:${e.id}">${e.feeds_id ? "Change" : "Link to mixer"}</button>` : "", e.kind === "scale" ? scaleLine(e) : "", ic(e.kind, null, {size: "sm"})])) : empty("No equipment yet. Add it from the approved site survey.")}</section>`;
  return pick + gws + eqs + sigs + eng + rd;
}
function sensorAlerts(A) {
  const out = [], lbl = m => (S.meta.metrics[m] || {label: m}).label;
  A.health.forEach(f => f.gateways.forEach(g => {
    if (g.last_seen && quiet(g)) { out.push({factory: f.factory.name, name: `${g.name} (gateway)`, since: g.last_seen, icon: "gateway"}); return; }
    if (!g.last_seen) return;
    f.signals.filter(x => x.last_at && minsBetween(x.last_at) >= S.meta.quiet_min).forEach(x => { const e = f.equipment.find(y => y.id === x.equipment_id) || {name: "", kind: "other"};
      out.push({factory: f.factory.name, name: `${e.name} ${lbl(x.metric).toLowerCase()}`, since: x.last_at, icon: e.kind}); });
  }));
  return out;
}
function vSupport() {
  const A = S.admin; if (!A) return `<section class="card c6"><div class="muted">Loading…</div></section>`;
  const fac = A.health.map(f => { const g = f.gateways, q = g.filter(quiet), last = g.map(x => x.last_seen).filter(Boolean).sort().pop();
    const st = !g.length ? stLine("n", "No gateway yet") : q.length ? stLine("a", q.length === g.length ? "Not sending data" : `${q.length} of ${g.length} gateways not sending data`) : stLine("g", "Online");
    const sub = [last ? `last data ${when(last)}` : "", `${f.signals.length} sensor signal${f.signals.length === 1 ? "" : "s"}`, ...f.faults.map(x => `Drive trip on ${h(x.equipment)} · code ${fmt(x.code, 0)}`)].filter(Boolean).join(" · ");
    return [`<b style="font-weight:600">${h(f.factory.name)}</b>`, st, sub, ic("gateway", null, {size: "sm"})]; });
  const req = r => [`<b style="font-weight:600">${h(r.factory)}</b>${r.who ? ` · ${h(r.who)}` : ""}<div style="margin-top:4px;white-space:pre-wrap">${h(r.text)}</div>`, r.status === "open" ? `<button class="btn ghost" type="button" data-act="rs:${r.id}">Mark resolved</button>` : `<span class="muted">Resolved ${when(r.resolved_at)}</span>`, `Sent ${when(r.at)}`, ic("person", null, {size: "sm"})];
  const open = A.support.filter(r => r.status === "open"), done = A.support.filter(r => r.status !== "open").slice(0, 20);
  const down = sensorAlerts(A), lbl = m => (S.meta.metrics[m] || {label: m}).label;
  const al = down.map(x => [`<b style="font-weight:600">${h(x.factory)}</b> · ${h(x.name)}`, stLine("r", `Disconnected · ${mins(minsBetween(x.since))}`), `Since ${when(x.since)}`, ic(x.icon, "r", {size: "sm"})]);
  const back = (A.outages || []).slice(0, 10).map(o => [`<b style="font-weight:600">${h(o.factory)}</b> · ${h(o.name || "")}${o.metric ? ` ${h(lbl(o.metric).toLowerCase())}` : ""}`, stLine("g", "Reconnected"), `Off ${mins(minsBetween(o.started_at, o.ended_at))} · back ${when(o.ended_at)}`, ic(o.kind === "gateway" ? "gateway" : "other", null, {size: "sm"})]);
  return `<section class="card c6"><div class="ch"><span class="ct">${ic("gateway", down.length ? "r" : "g")}Sensor alerts · ${down.length ? `${down.length} disconnected` : "all live"}</span></div>${down.length ? rows(al) : empty("Every connected gateway and sensor is sending data.")}${back.length ? `<h4>Reconnected</h4>${rows(back)}` : ""}</section>
  <section class="card c6"><div class="ch"><span class="ct">${ic("person")}Support requests · ${open.length} open</span></div><div class="why">Sent by a factory's site manager or owner with "Request support".</div>${open.length ? rows(open.map(req)) : empty("No open requests.")}${done.length ? `<h4>Resolved</h4>${rows(done.map(req))}` : ""}</section>
  <section class="card c6"><div class="ch"><span class="ct">${ic("gateway")}Connection health</span></div><div class="why">Gateways, sensors and drive faults only. Each factory's records and money stay with the factory.</div>${A.health.length ? rows(fac) : empty("No factories yet.")}</section>`;
}
function supportD() {
  const mine = (S.d && S.d.support) || [];
  return {icon: ic("person"), kicker: fname(), title: "Request support", body: form("fSup", "Tell OmniSite what went wrong", "For connection or system problems, e.g. a sensor shows no data or the dashboard doesn't load. OmniSite gets your factory name and the time.", fl(1, "What went wrong?", 1) + `<textarea class="inp" name="text" rows="4" maxlength="1000"></textarea>`, "Send to OmniSite")
    + `<h4>Your factory's requests</h4>` + (mine.length ? rows(mine.map(r => [`<div style="white-space:pre-wrap">${h(r.text)}</div>`, r.status === "open" ? stLine("a", "Open") : stLine("g", "Resolved"), `${r.who ? `${h(r.who)} · ` : ""}${when(r.at)}`, ""])) : empty("No requests yet.")),
    after: () => { const f = $("#fSup"); f.onsubmit = async e => { e.preventDefault(); const box = f.querySelector(".err"), b = f.querySelector("button.btn");
      if (!val(f, "text")) { box.textContent = "Write what went wrong."; box.hidden = false; return; } if (b.disabled) return; b.disabled = true; b.textContent = "Sending…";
      try { await api("POST", "/api/support", {text: val(f, "text")}); await reload(); toast("Sent to OmniSite"); openD("support"); }
      catch (er) { box.textContent = er.error; box.hidden = false; b.disabled = false; b.textContent = "Try again"; } }; }};
}
async function loadConn() { S.conn = await api("GET", "/api/connections"); render(); }
function setupCard() {
  return `<section class="card c6 setup"><div class="ch"><span class="ct">${ic("mixer", null, {size: "lg"})}<span style="font-size:18px;font-weight:600;color:var(--ink)">Set up ${setv("factory_name") ? h(fname()) : "your factory"}</span></span></div>
   <div class="muted">Nothing is recorded yet. Start with these steps:</div>
   <ol><li>${role() === "admin" ? `Add the pilot equipment from the approved site survey <span class="req">*</span>` : "Waiting for OmniSite to set up the pilot equipment"}</li><li>Set the daily target and prices <span class="opt">(needed for targets and AED values)</span></li><li>Record each batch as it runs</li></ol>
   <div class="btns">${role() === "admin" ? `<button class="btn" type="button" data-open="addEq">Add equipment</button>` : ""}<button class="btn ghost" type="button" data-open="settings">Target and prices</button></div></section>`;
}
function railHtml() {
  const al = alerts(), ac = actions();
  return `<aside class="rail"><div><h2>Alerts <span class="count">${al.length}</span></h2>${al.map(alertCard).join("") || empty("No alerts. No equipment is stopped.")}</div>
   <div><h2>Needs action <span class="count">${ac.length}</span></h2>${ac.map(actCard).join("") || empty("Nothing needs action right now.")}</div></aside>`;
}
function vOverview() {
  const t = today(), w = week(), m = money(w), go = '<span class="open">View details ›</span>';
  const act = S.d.batches.filter(b => ["mixing", "remix", "passed"].includes(b.status));
  const top = Object.entries(w.reasons).filter(([k]) => !k.includes("not entered")).sort((a, b) => b[1] - a[1])[0];
  const stopped = S.d.equipment.filter(e => openStop(e.id));
  const ms = mixers(), running = ms.filter(e => eqState(e).st === "g").length;
  const ft = w.fin.length ? Math.round(w.n[0] / w.fin.length * 100) : null;
  return `${twinCard()}<section class="card c3 sum" data-go="batches" tabindex="0" role="link"><div class="ch"><span class="ct">${ic("mixer", null, {size: "lg"})}Batches</span>${go}</div>
     <div class="big">${t.done || hasDay(S.d.today) ? t.done : NRs} <small>${t.target !== null ? `of ${t.target} batches today` : "batches finished today"}</small></div>
     <div style="margin-top:10px">${t.target === null ? stLine("n", "Daily target not set") : t.done >= t.target ? stLine("g", "Target reached") : stLine("n", `${t.target - t.done} to go`)}</div>
     <div class="why" style="margin-top:6px">${act.length ? `Now: ${act.map(b => `${h(b.code)} ${{mixing: "mixing", remix: "re-mixing", passed: "waiting to move"}[b.status]}${loading(b) ? ` (${loading(b)})` : ""}`).join(" · ")}` : "No batch in progress"}${ft !== null ? ` · ${ft}% passed first time this week` : ""}</div>
     <div class="src" style="margin-top:auto;padding-top:12px"><i>✎</i>Manual · ${lastAt(S.d.batches, "moved_at") || "no batch moved yet"}</div></section>
   <section class="card c3 sum" data-go="downtime" tabindex="0" role="link"><div class="ch"><span class="ct">${ic("motor", null, {size: "lg"})}Downtime</span>${go}</div>
     <div class="big">${w.stops.length ? mins(w.stopMin) : w.rec ? "0 min" : NRs} <small>stopped this week</small></div>
     <div style="margin-top:10px">${stopped.length ? stLine("r", `${stopped.map(e => h(e.name)).join(", ")} stopped now`) : stLine("g", "Nothing stopped now")}</div>
     <div class="why" style="margin-top:6px">${top ? `Top reason: ${h(top[0])}` : w.stops.length ? "Reasons not entered yet" : "No stops recorded this week"}${w.lost ? ` · ≈ ${fmt(w.lost, 1)} batches not made (estimate)` : ""}</div>
     <div class="src" style="margin-top:auto;padding-top:12px">${stopsSrc(lastAt(S.d.stops, "updated_at") || "no stops entered")}</div></section>
   <section class="card c3 sum" data-go="costs" tabindex="0" role="link"><div class="ch"><span class="ct">${ic("coins", null, {size: "lg"})}Costs</span>${go}</div>
     <div class="big">${m.mat !== null && w.losses.length ? `AED ${fmt(m.mat)}` : w.losses.length ? `${fmt(w.lossKg, 1)} kg` : NRs} <small>material lost this week</small></div>
     <div style="margin-top:10px">${m.mat === null ? stLine("a", "Material price not set") : stLine("g", "Price set")}</div>
     <div class="why" style="margin-top:6px">Material used: ${w.withKg.length ? `${fmt(w.kgUsed)} kg` : "not recorded"}${w.scaled.length ? ` · Re-mix top-ups: ${fmt(w.topKg)} kg` : ""}</div>
     <div class="src" style="margin-top:auto;padding-top:12px"><i>✎</i>Manual · ${lastAt(S.d.losses, "at") || "no loss entered"}</div></section>
   <section class="card c3 sum" data-go="equipment" tabindex="0" role="link"><div class="ch"><span class="ct">${ic("other", null, {size: "lg"})}Equipment</span>${go}</div>
     <div class="big">${running || mixers().some(e => e.status_at) ? running : NRs} <small>of ${ms.length} mixer${ms.length === 1 ? "" : "s"} running</small></div>
     <div class="eqmini">${S.d.equipment.slice(0, 6).map(e => { const s = eqState(e); return ic(e.kind, s.st, {spin: s.spin}); }).join("")}</div>
     <div class="why" style="margin-top:6px">${S.d.equipment.slice(0, 4).map(e => `${h(e.name)} ${eqState(e).label.toLowerCase()}`).join(" · ")}</div>
     <div class="src" style="margin-top:auto;padding-top:12px">${(S.d.signals || []).some(x => x.metric === "speed_hz") ? `<i>●</i>Sensor · drive signal${S.d.equipment.some(e => e.status_src !== "sensor") ? ` · <i style="margin-left:6px">✎</i>Manual · other equipment` : ""}` : `<i>✎</i>Manual · status entered by the site manager`}</div></section>`;
}
function batchCard(b) {
  const e = eq(b.equipment_id), q = qcOf(b.id), last = q.slice(-1)[0], s = eqState(e);
  const step = b.status === "mixing" ? 2 : b.status === "remix" ? 3 : 4;
  return `<section class="card c3 active" data-open="batch:${b.id}" tabindex="0" role="button"><div class="ch"><span class="ct">${ic("mixer", s.st, {size: "lg", spin: s.spin})}${h(e.name)} · active batch</span><span class="open">Open ›</span></div>
   <div class="mono" style="font-size:14px">${h(b.code)}</div><div style="margin-top:6px">${stLine(s.st, {mixing: "Mixing", remix: "Re-mixing after QC", passed: "Passed QC · waiting to move"}[b.status])}</div>
   <div class="steps">${[1, 2, 3, 4].map(i => `<span class="${i < step ? "done" : i === step ? "now" : ""}"></span>`).join("")}</div>
   <div class="timer" data-since="${b.started_at}">${clock(nowMs() - new Date(b.started_at))}</div>${loading(b) ? `<div class="why">${loading(b)}</div>${sensor(when(b.s.kg_at))}` : ""}
   <div class="kv"><div><b>${last ? `${fmt(last.ph, 2)} pH` : "—"}</b>${last ? manual(when(last.at)) : `<div class="why">pH at QC check</div>`}</div><div><b>${last ? `${fmt(last.visc)} cP` : "—"}</b>${last ? manual(when(last.at)) : `<div class="why">Viscosity at QC check</div>`}</div></div>
   <div class="src"><i>✎</i>Manual · started ${when(b.started_at)}${sig(b.equipment_id, "temp_c") || sig(b.equipment_id, "current_pct") ? "" : " · Temperature and motor load need a sensor"}</div></section>`;
}
function vBatches() {
  const t = today(), w = week(), act = S.d.batches.filter(b => ["mixing", "remix", "passed"].includes(b.status));
  const idle = mixers().filter(e => !activeBatch(e.id));
  const prodCard = `<section class="card c3" data-open="settings" tabindex="0" role="button"><div class="ch"><span class="ct">${ic("mixer")}Production vs today's target</span><span class="open">Open ›</span></div>
    <div class="big">${t.done || hasDay(S.d.today) ? t.done : NRs} <small>${t.target !== null ? `of ${t.target} batches` : "batches finished"}</small></div>
    ${t.target !== null ? `<div class="bar"><b style="width:${Math.min(100, t.done / t.target * 100)}%"></b></div>` : `<div class="why" style="margin-top:10px">Daily target not set. Tap to set it.</div>`}
    <div class="row"><span class="muted">${t.litres !== null ? `${fmt(t.done * t.litres)} L${t.target !== null ? ` of ${fmt(t.target * t.litres)} L` : ""}` : "Litres per batch not set"}</span></div>
    <div class="src"><i>✎</i>Manual · a batch counts when it is marked moved to the holding tank</div></section>`;
  const startCard = `<section class="card c3"><div class="ch"><span class="ct">${ic("mixer", "n")}Mixers now</span></div>
    ${mixers().length ? rows(mixers().map(e => { const s = eqState(e); return [`<b style="font-weight:600">${h(e.name)}</b>`, stLine(s.st, s.label), "", ic(e.kind, s.st, {spin: s.spin, size: "sm"}), `eq:${e.id}`]; }))
      + (role() === "manager" && idle.length ? `<div class="btns">${idle.map(e => `<button class="btn ghost" type="button" data-open="start:${e.id}">Record batch started on ${h(e.name)}</button>`).join("")}</div>` : "")
      : (role() === "admin" ? `<div class="muted">Add a mixer first.</div><div class="btns"><button class="btn" type="button" data-open="addEq">Add equipment</button></div>` : `<div class="muted">Waiting for OmniSite to set up the pilot equipment.</div>`)}</section>`;
  const recent = S.d.batches.filter(b => !["mixing", "remix", "passed"].includes(b.status)).slice(0, 30);
  return prodCard + act.map(batchCard).join("") + startCard +
   `<section class="card c3" tabindex="0"><div class="ch"><span class="ct">${ic("qc")}Batches finished · last 7 days</span></div>${dailyChart(w.daily)}${LEGEND}<div class="src"><i>✎</i>Manual · QC results</div></section>
    <section class="card c3"><div class="ch"><span class="ct">${ic("rework")}Why batches were re-mixed · this week</span></div>${bars(w.causes, v => String(v))}<div class="src"><i>✎</i>Manual · causes entered at QC</div></section>
    <section class="card c6"><div class="ch"><span class="ct">${ic("tank")}Batch records · last 14 days</span></div>
    ${recent.length ? `<table class="rec"><thead><tr><th>Batch</th><th>Mixer</th><th>Result</th><th>pH</th><th>Viscosity</th><th class="hidem">Time to finish</th><th class="hidem">Material used</th><th>Finished</th></tr></thead><tbody>${recent.map(b => `<tr data-open="batch:${b.id}" tabindex="0"><td class="mono">${h(b.code)}</td><td>${h(eq(b.equipment_id).name)}</td><td>${b.status === "rejected" ? stLine("r", "Rejected") : b.qc_count > 1 ? stLine("a", `Re-mixed ×${b.qc_count - 1}`) : stLine("g", "Passed first time")}</td>${qcCells(b)}<td class="hidem">${b.finished_at ? mins(minsBetween(b.started_at, b.finished_at)) : "—"}</td><td class="hidem">${kgOf(b) != null ? `${fmt(kgOf(b), 1)} kg` : `<span class="nr">Not recorded</span>`}</td><td>${b.moved_at ? when(b.moved_at) : b.finished_at ? when(b.finished_at) : "—"}</td></tr>`).join("")}</tbody></table>` : empty("No finished batches yet.")}
    <div class="src"><i>✎</i>Manual · QC entries</div></section>`;
}
function dayList(w) {
  const max = Math.max(1, ...w.perDay.map(d => d.m));
  return w.perDay.map(d => { const miss = S.d.stops.some(s => dayOf(s.started_at) === d.day && !s.reason);
      return `<div class="dayrow" data-open="day:${d.day}" tabindex="0" role="button"><div class="row" style="font-size:13px"><span>${d.day === S.d.today ? "Today" : dm(d.day)}${miss ? ` <span class="st" style="margin-left:6px"><span class="dot r"></span>Reason needed</span>` : ""}</span><b style="font-weight:600">${d.m ? mins(d.m) : hasDay(d.day) ? "0 min" : NRs} <span class="muted" style="font-weight:400">›</span></b></div><div class="bar" style="margin:6px 0 0;height:6px"><b style="width:${d.m / max * 100}%"></b></div></div>`; }).join("")
    + `<div class="why" style="margin-top:8px">Tap a day to see its stops${canEdit() ? " or add one" : ""}.</div>`;
}
function vDowntime() {
  const w = week();
  return `<section class="card c3"><div class="ch"><span class="ct">${ic("motor")}Downtime by day</span><span class="muted" style="font-size:12px">this week</span></div>
    <div class="row" style="margin-bottom:10px"><span class="mid">${w.stops.length || w.rec ? mins(w.stopMin) : NRs}</span></div>${lostLine(w.batchStopMin, w) ? `<div style="margin:-4px 0 12px">${lostLine(w.batchStopMin, w)}</div>` : ""}
    ${dayList(w)}
    <div class="why" style="margin-top:8px">Shift split not shown: shift times are not set.</div><div class="src">${stopsSrc("stops entered by the site manager")}</div></section>
   <section class="card c3"><div class="ch"><span class="ct">${ic("motor")}Why equipment stopped · this week</span></div>${bars(w.reasons, mins)}<div class="src"><i>✎</i>Manual · reasons entered by the site manager</div></section>
   <section class="card c6"><div class="ch"><span class="ct">${ic("motor")}Stops · this week</span><button class="btn ghost" type="button" data-open="addStop">Add a past stop</button></div>
    ${w.stops.length ? rows(w.stops.map(s => [`${h(eq(s.equipment_id).name)} · ${dm(dayOf(s.started_at))} ${hm(s.started_at)}${s.ended_at ? `–${hm(s.ended_at)}` : " · still stopped"}`, s.reason ? h(s.reason) : `<span class="nr">Reason not entered</span>`, srcOf(s, `${mins(minsBetween(s.started_at, s.ended_at))} · ${when(s.updated_at)}`), ic(eq(s.equipment_id).kind, s.ended_at ? null : "r", {size: "sm"}), `stop:${s.id}`])) : empty("No stops recorded this week.")}</section>`;
}
function vCosts() {
  const w = week(), m = money(w), t = S.d.today, lossToday = S.d.losses.filter(l => l.day === t).reduce((a, l) => a + l.kg, 0), p = setn("price_kg");
  const aed = (v, why) => v !== null ? `AED ${fmt(v)}` : NR(why);
  return `<section class="card c6" data-open="loss" tabindex="0" role="button"><div class="ch"><span class="ct">${ic("scale")}Material loss</span><span class="open">Add / open ›</span></div>
    <div class="big">${S.d.losses.some(l => l.day === t) ? fmt(lossToday, 1) : NRs} <small>kg today</small></div><div class="src"><i>✎</i>Manual · ${lastAt(S.d.losses.filter(l => l.day === t), "at") || "nothing entered today"}</div><div class="sep"></div>
    <div class="row"><span class="mid">${p !== null ? `AED ${fmt(lossToday * p)}` : `<span class="nr">Not recorded</span>`}</span><span class="muted" style="font-size:12px">${p !== null ? `AED ${fmt(p, 2)} / kg` : "material price not set"}</span></div>
    ${p !== null ? `<div class="src"><i>≈</i>Estimate · weight × your price</div>` : ""}</section>
   <section class="card c6"><div class="ch"><span class="ct">${ic("scale")}Material used · this week</span><span class="muted" style="font-size:12px">${w.fin.length ? `${w.withKg.length} of ${w.fin.length} finished batch${w.fin.length === 1 ? "" : "es"} weighed` : "no finished batches yet"}</span></div>
    ${rows([["Total used", w.withKg.length ? `${fmt(w.kgUsed, 1)} kg` : NR("Enter it in each batch"), w.withKg.length ? (w.withKg.every(b => b.kg_used == null) ? sensor("from the scale") : w.withKg.some(b => b.kg_used == null) ? manual(lastAt(w.withKg.filter(b => b.kg_used != null), "kg_at")) + sensor("and the scale") : manual(lastAt(w.withKg, "kg_at"))) : ""],
      ["Average per batch", w.withKg.length ? `${fmt(w.kgUsed / w.withKg.length, 1)} kg` : NR(""), ""],
      ["Added after QC failed (re-mix)", w.scaled.length ? `${fmt(w.topKg, 1)} kg` : NR("Needs the scale connected"), w.scaled.length ? sensor("from the scale") : ""],
      ["Material cost per batch", w.withKg.length && p !== null ? `AED ${fmt(w.kgUsed / w.withKg.length * p)}` : NR(p === null ? "Set the material price" : ""), w.withKg.length && p !== null ? est("average kg × your price") : ""]])}</section>
   <section class="card c6" data-open="settings" tabindex="0" role="button"><div class="ch"><span class="ct">${ic("coins")}Money lost · this week</span><span class="open">Prices ›</span></div>
    ${rows([["Material loss", aed(m.mat, "Set the material price"), (w.losses.length ? `${fmt(w.lossKg, 1)} kg weighed` : "no loss entered") , ic("scale", null, {size: "sm"})],
      ["Equipment stops", aed(m.down, "Set the cost of 1 hour of stop"), (w.stops.length ? `${mins(w.stopMin)} stopped` : "no stops entered"), ic("motor", null, {size: "sm"})],
      ["Re-mixing", topVal(w, m, "Needs the scale connected"), (w.fin.length || w.remixes ? `${w.remixes} re-mix${w.remixes === 1 ? "" : "es"} this week${w.scaled.length ? ` · ${fmt(w.topKg, 0)} kg added after QC failed` : ""}` : "no QC entered"), ic("rework", null, {size: "sm"})]])}
    <div class="why" style="margin-top:10px">Totals only include values that are recorded.</div></section>`;
}
function vEquipment() {
  return `<section class="card c6 eq"><div class="ch"><span class="ct">Equipment</span>${role() === "admin" ? `<button class="btn ghost" type="button" data-open="addEq">Add equipment</button>` : `<span class="muted" style="font-size:12px">Set by OmniSite for the pilot</span>`}</div>
    ${S.d.equipment.length ? rows(S.d.equipment.map(e => { const s = eqState(e); return [`<b style="font-weight:600">${h(e.name)}</b> <span class="muted">· ${h(S.meta.kinds[e.kind])}${e.kind === "scale" && e.feeds_id ? ` · fills ${h(eq(e.feeds_id).name)} · ${h(matL(e.material))}` : ""}</span>`, stLine(s.st, s.label), e.status_at ? (e.status_src === "sensor" ? sensor : manual)(when(e.status_at)) : e.kind === "scale" && sig(e.id, "weigh_kg") ? sensor("weighings from the scale") : `<div class="why">Needs connection</div>`, ic(e.kind, s.st, {spin: s.spin}), `eq:${e.id}`]; }))
      : empty(role() === "admin" ? "No equipment yet. Add each mixer and tank from the approved site survey." : "Waiting for OmniSite to set up the pilot equipment.")}
    <div class="why" style="margin-top:12px">${(S.d.signals || []).length ? `Signals: ${S.d.signals.length} · Gateway ${(S.d.gateways || []).some(g => !quiet(g)) ? "online" : "not sending data"}. Equipment without a signal is entered by the site manager.` : "No sensors are connected yet, so status is entered by the site manager."}</div></section>
   <section class="card c6" data-open="settings" tabindex="0" role="button"><div class="ch"><span class="ct">${ic("coins")}Target and prices</span><span class="open">Edit ›</span></div>
    ${rows(Object.entries(S.meta.settings).map(([k, label]) => [label, setv(k) !== null ? h(setv(k)) : `<span class="nr">Not set</span>`, S.d.settings[k] ? manual(when(S.d.settings[k].at)) : ""]))}</section>`;
}

// ---------- owner view (read only) ----------
function owner() {
  const t = today(), w = week(), m = money(w), stopped = S.d.equipment.filter(e => openStop(e.id));
  const waiting = S.d.batches.filter(b => b.status === "passed"), remix = S.d.batches.filter(b => b.status === "remix");
  let light;
  if (!S.d.equipment.length) light = {c: "n", label: "Not set up", line: "The site manager hasn't added equipment yet."};
  else if (stopped.length) { const s = openStop(stopped[0].id); light = {c: "r", label: "Needs attention", line: `${h(stopped.map(e => e.name).join(", "))} stopped.`, sub: s.reason ? `Reason: <b style="color:var(--ink)">${h(s.reason)}</b>` : "Reason not entered yet", src: s.reason ? reasonSrc(s, when(s.updated_at)) : srcOf(s, when(s.started_at))}; }
  else if (waiting.length || remix.length) light = {c: "a", label: "Waiting", line: waiting.length ? `${h(waiting[0].code)} passed QC and is waiting to move.` : `${h(remix[0].code)} is being re-mixed.`};
  else if (mixers().some(e => eqState(e).st === "g")) light = {c: "g", label: "OK", line: "Running normally."};
  else light = {c: "n", label: "No batch running", line: "No batch is in progress right now."};
  const tiles = S.d.equipment.filter(e => ["mixer", "tank", "pump", "filler"].includes(e.kind)).slice(0, 4).map(e => { const s = eqState(e), b = activeBatch(e.id);
    return `<div class="mtile">${ic(e.kind, s.st, {size: "lg", spin: s.spin})}<div><b>${h(e.name)}</b>${stLine(s.st, s.label)}<div class="why" style="margin-top:4px">${b ? h(b.code) + (loading(b) ? ` · ${loading(b)}` : "") : openStop(e.id) ? `Stopped for ${mins(minsBetween(openStop(e.id).started_at))}` : ""}</div>${e.status_at ? (e.status_src === "sensor" ? sensor : manual)(when(e.status_at)) : ""}</div></div>`; }).join("");
  const total = [m.mat, m.down, m.top].filter(v => v !== null).reduce((a, b) => a + b, 0), parts = [m.mat, m.down, m.top].filter(v => v !== null).length, need3 = mixers().some(e => hasScale(e.id));
  const ft = w.fin.length ? Math.round(w.n[0] / w.fin.length * 100) : null;
  return `${pvBar()}<div class="owner"><div class="otop"><div><div class="obrand">OmniSite<small>Factory owner · ${h(fname())}</small></div>${switcher() ? `<div style="margin-top:10px;max-width:260px">${switcher()}</div>` : ""}<h1 style="margin-top:14px">Your factory today</h1><div class="sub">${nowLine()}</div></div>
   <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px"><span class="ro">View only · the site manager enters reasons and readings</span><div class="muted" style="font-size:12px"><button class="lo" type="button" data-open="support" style="background:none;border:0;padding:0;text-decoration:underline;cursor:pointer;font:inherit;color:var(--ink2)">Request support</button> · ${h(S.user.name)} · <button class="lo" type="button" onclick="logout()" style="background:none;border:0;padding:0;text-decoration:underline;cursor:pointer;font:inherit;color:var(--ink2)">Log out</button></div></div></div>
   <section class="card" style="margin-bottom:20px"><div class="hero"><div class="light"><span class="bulb ${light.c}"></span><div><div style="margin-bottom:4px">${stLine(light.c, light.label)}</div><h2>${light.line}</h2>${light.sub ? `<div class="muted" style="margin-top:6px">${light.sub}</div>` : ""}${light.src || ""}</div></div>${tiles}</div></section>
   <div class="grid">${S.d.equipment.length ? twinCard() : ""}
    <section class="card c2 half"><div class="ch"><span class="ct">${ic("mixer")}Output today</span></div><div class="big">${t.done || hasDay(S.d.today) ? t.done : NRs} <small>${t.target !== null ? `of ${t.target} batches` : "batches finished"}</small></div>
      ${t.target !== null ? `<div class="bar"><b style="width:${Math.min(100, t.done / t.target * 100)}%"></b></div>` : `<div class="why" style="margin-top:10px">Daily target not set</div>`}
      <div class="muted">${t.litres !== null ? `${fmt(t.done * t.litres)} L` : ""}</div>
      <div class="why" style="margin-top:8px">Material used today: ${kgToday() !== null ? `${fmt(kgToday(), 1)} kg` : "not recorded"}</div><div class="src"><i>✎</i>Manual · ${lastAt(S.d.batches, "moved_at") || "no batch moved yet"}</div></section>
    <section class="card c2 half" data-open="o-quality" tabindex="0" role="button"><div class="ch"><span class="ct">${ic("qc")}Quality · this week</span><span class="open">Open ›</span></div>
      <div class="big">${ft !== null ? `${ft}%` : "—"} <small>${ft !== null ? "passed first time" : "no finished batches yet"}</small></div>
      ${w.fin.length ? `<div class="lg" style="margin-top:14px"><span>${w.n[0]} first time</span><span>${w.n[1]} re-mixed</span><span>${w.n[2]} rejected</span></div>` : ""}<div class="src"><i>✎</i>Manual · QC results</div></section>
    <section class="card c2"><div class="ch"><span class="ct">${ic("coins")}Money lost · this week</span></div>
      <div class="big">${parts ? `AED ${fmt(total)}` : `<span class="nr">Not recorded</span>`}</div><div class="why" style="margin-top:4px">${parts < (need3 ? 3 : 2) ? "Incomplete: some prices are not set yet" : need3 ? "Material loss + equipment stops + re-mix top-ups" : "Material loss + equipment stops"}</div>
      ${rows([["Material loss", m.mat !== null ? `AED ${fmt(m.mat)}` : `<span class="nr">Not recorded</span>`, (w.losses.length ? `${fmt(w.lossKg, 1)} kg weighed` : "no loss entered"), ic("scale", null, {size: "sm"})], ["Equipment stops", m.down !== null ? `AED ${fmt(m.down)}` : `<span class="nr">Not recorded</span>`, w.stops.length ? mins(w.stopMin) : "no stops entered", ic("motor", null, {size: "sm"})], ["Re-mixing", topVal(w, m), (w.fin.length || w.remixes ? `${w.remixes} re-mix${w.remixes === 1 ? "" : "es"}${w.scaled.length ? ` · ${fmt(w.topKg, 0)} kg added` : ""}` : "no QC entered"), ic("rework", null, {size: "sm"})]])}</section>
    <section class="card c3"><div class="ch"><span class="ct">${ic("motor")}Why equipment stopped · this week</span></div><div class="row"><span class="mid">${w.stops.length || w.rec ? mins(w.stopMin) : NRs}</span><span class="muted" style="font-size:12px">total stopped</span></div>${lostLine(w.batchStopMin, w)}${bars(w.reasons, mins)}<div class="src"><i>✎</i>Manual · reasons from the site manager</div></section>
    <section class="card c3"><div class="ch"><span class="ct">${ic("rework")}Why batches were re-mixed · this week</span></div><div class="row"><span class="mid">${w.remixes || w.rec ? w.remixes : NRs}</span><span class="muted" style="font-size:12px">re-mixes</span></div>${bars(w.causes, v => String(v))}<div class="src"><i>✎</i>Manual · QC causes from the site manager</div></section>
    <section class="card c3"><div class="ch"><span class="ct">${ic("tank")}Batches finished · last 7 days</span></div>${dailyChart(w.daily)}${LEGEND}<div class="src"><i>✎</i>Manual · QC results</div></section>
    <section class="card c3"><div class="ch"><span class="ct">${ic("motor")}Downtime by day</span><span class="muted" style="font-size:12px">this week</span></div>${dayList(w)}<div class="src">${stopsSrc("stops entered by the site manager")}</div></section>
   </div></div>`;
}

// ---------- drawer ----------
function openD(k) {
  S.key = k; const d = drawer(k); if (!d) return closeD();
  $("#dIcon").innerHTML = d.icon || ""; $("#dKicker").textContent = d.kicker || ""; $("#dTitle").textContent = d.title; $("#dBody").innerHTML = d.body;
  $("#dw").classList.add("show"); if (d.after) d.after();
}
function closeD() { $("#dw").classList.remove("show"); S.key = null; }
const chips = (name, opts, sel) => `<div class="chips" role="radiogroup">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${h(v)}" ${v === sel ? "checked" : ""}><span>${h(l)}</span></label>`).join("")}</div>`;
const pairs = a => a.map(x => [x, x]);
const form = (id, title, why, fields, btn) => `<form class="form" id="${id}" novalidate><h5>${title}</h5>${why ? `<div class="why">${why}</div>` : ""}${fields}<div class="err" hidden></div>${pv() ? `<div class="why">Preview as ${PV[pv()]}: nothing is saved.</div>` : ""}<div style="margin-top:14px"><button class="btn full" ${pv() ? "disabled" : ""}>${btn}</button></div></form>`;
const fl = (n, label, req, extra = "") => `<div class="fl">${n}. ${label} ${req ? '<span class="req">*</span>' : `<span class="opt">${extra || "(optional)"}</span>`}</div>`;
const val = (f, n) => { const el = f.querySelector(`[name="${n}"]:checked`) || f.querySelector(`[name="${n}"]:not([type=radio])`); return el ? el.value.trim() : ""; };
const hhmm = () => hm(new Date().toISOString());
function bind(id, build, path, msg, then) {
  const f = document.getElementById(id); if (!f) return;
  f.onsubmit = async e => {
    e.preventDefault(); const box = f.querySelector(".err"), b = f.querySelector("button.btn");
    let body; try { body = build(f); } catch (m) { box.textContent = m; box.hidden = false; return; }
    if (b.disabled) return; b.disabled = true; b.textContent = "Saving…"; box.hidden = true;
    try { await api("POST", typeof path === "function" ? path(f) : path, body); await reload(); toast(msg); then ? then() : openD(S.key); }
    catch (er) { box.textContent = er.error; box.hidden = false; b.disabled = false; b.textContent = "Try again"; }
  };
}
const need = (c, m) => { if (!c) throw m; };
function drawer(k) {
  if (k === "support" && !S.user.admin) return supportD();
  if (k.startsWith("o-")) return oDrawer(k);
  const [kind, id] = k.split(":"), n = Number(id), ro = !canEdit();
  if (kind === "addFactory" && team()) return {icon: ic("mixer"), kicker: "OmniSite team", title: "Add factory", body: form("fFac", "Add a factory", "It starts empty. Next, add its site manager and owner.", fl(1, "Factory name", 1) + `<input class="inp" name="name" placeholder="e.g. Chemex" style="min-height:0">`, "Add factory"),
    after: () => bindAdmin("fFac", f => { need(val(f, "name"), "Enter the factory name."); return {name: val(f, "name")}; }, "/api/admin/factories", "Factory added")};
  if (kind === "addPerson" && team()) { const f = S.admin.factories.find(x => x.id === n); if (!f) return null;
    return {icon: ic("person"), kicker: f.name, title: "Add person", body: form("fPer", `Add a login for ${h(f.name)}`, "Give the person their email and password yourself. Nothing is sent automatically.",
      fl(1, "Role", 1) + chips("role", [["manager", "Site manager (enters information)"], ["owner", "Owner (view only)"]]) + fl(2, "Name", 1) + `<input class="inp" name="name" style="min-height:0">` +
      fl(3, "Email", 1) + `<input class="inp" name="email" type="email" autocomplete="off" style="min-height:0">` + fl(4, "Password", 0, "(at least 10 characters · leave empty if this email already has a login)") + `<input class="inp" name="password" type="text" autocomplete="off" style="min-height:0">`, "Add person"),
      after: () => bindAdmin("fPer", x => { need(val(x, "role"), "Pick the role."); need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val(x, "email")), "Enter a valid email."); const pw = val(x, "password"); need(!pw || pw.length >= 10, "The password needs at least 10 characters.");
        return {factory_id: f.id, role: val(x, "role"), name: val(x, "name"), email: val(x, "email"), password: pw}; }, "/api/admin/people", "Person added")}; }
  if (kind === "batch") {
    const b = S.d.batches.find(x => x.id === n); if (!b) return null; const e = eq(b.equipment_id), q = qcOf(b.id), s = eqState(e);
    const ev = [[hm(b.started_at), "g", `Started on ${h(e.name)}`], ...q.map(x => [hm(x.at), x.result === "pass" ? "g" : x.result === "remix" ? "a" : "r", `QC: pH ${fmt(x.ph, 2)}, ${fmt(x.visc)} cP · ${x.result === "pass" ? "passed" : x.result === "remix" ? `re-mix (${h(x.cause_what)} ${h(x.cause_dir.toLowerCase())})` : "rejected"}${x.note ? ` · ${h(x.note)}` : ""}`]), ...(b.moved_at ? [[hm(b.moved_at), "g", "Moved to holding tank"]] : [])];
    const [sc, sl] = {mixing: ["g", "Mixing"], remix: ["g", "Re-mixing"], passed: ["g", "Passed QC"], moved: ["n", "In holding tank"], rejected: ["r", "Rejected"]}[b.status];
    const last = q[q.length - 1], nRe = q.filter(x => x.result === "remix").length, end = b.moved_at || b.finished_at;
    const step = (icn, label, tm, st, extra = "") => `<div class="step ${st}">${ic(icn, {now: "g", ok: "g", bad: "r"}[st], {size: "sm", spin: st === "now" && icn === "mixer"})}<b>${label}</b><small>${tm || "&nbsp;"}</small>${extra}</div>`;
    const steps = [step("mixer", b.status === "remix" ? "Re-mix" : "Mix", hm(b.started_at), ["mixing", "remix"].includes(b.status) ? "now" : "done", nRe ? `<em>×${nRe + 1}</em>` : ""),
      step("flask", "QC", last ? hm(last.at) : "", !last ? "todo" : last.result === "reject" ? "bad" : "done", last ? `<small>pH ${fmt(last.ph, 1)} · ${fmt(last.visc)} cP</small>` : ""),
      b.status === "rejected" ? step("cross", "Rejected", last ? hm(last.at) : "", "bad") : step("check", "Passed", ["passed", "moved"].includes(b.status) && last ? hm(last.at) : "", ["passed", "moved"].includes(b.status) ? "ok" : "todo"),
      ...(b.status === "rejected" ? [] : [step("tank", "Tank", b.moved_at ? hm(b.moved_at) : "", b.moved_at ? "done" : b.status === "passed" ? "now" : "todo")])].join("");
    const tile = (icn, val, label, off) => `<div class="tile ${off ? "off" : ""}">${ic(icn, null, {size: "sm"})}<b>${val}</b><small>${label}</small></div>`;
    const kg = b.kg_used != null ? b.kg_used : b.s.kg;
    const tiles = [tile("scale", kg != null ? `${fmt(kg, 0)} kg` : "—", kg == null ? (hasScale(b.equipment_id) ? "No weight yet" : "Not recorded") : b.kg_used != null ? "Manual" : loading(b) ? "Scale · loading so far" : "Scale", kg == null),
      ...(b.kg_used == null && b.s.kg_top ? [tile("rework", `${fmt(b.s.kg_top, 0)} kg`, "Added after QC failed")] : []),
      tile("thermo", b.s.temp ? `${fmt(b.s.temp.last, 1)} °C` : "—", b.s.temp ? "Sensor" : sig(e.id, "temp_c") ? "No reading" : "Needs connection", !b.s.temp),
      tile("motor", b.s.current ? `${fmt(b.s.current.avg, 0)}%` : "—", b.s.current ? "Motor load" : sig(e.id, "current_pct") ? "No reading" : "Needs connection", !b.s.current),
      ...(sig(e.id, "energy_kwh") ? [tile("bolt", b.s.kwh != null ? `${fmt(b.s.kwh, 1)} kWh` : "—", "Energy", b.s.kwh == null)] : [])].join("");
    let body = `<div class="bst c-${sc}">${sl}</div><div class="bsub">${h(e.name)} · ${mins(minsBetween(b.started_at, end))}</div>
      <div class="bsteps">${steps}</div><div class="tiles">${tiles}</div>${scaleRows(b)}
      <details class="hist"><summary>History</summary>${tl(ev)}</details>`;
    let after;
    if (!ro && ["mixing", "remix"].includes(b.status)) {
      body += form("fQc", b.status === "remix" ? "Enter QC again" : "Enter QC readings", "",
        fl(1, "pH", 1) + `<input class="inp" name="ph" inputmode="decimal" placeholder="0–14">` + fl(2, "Viscosity (cP)", 1) + `<input class="inp" name="visc" inputmode="numeric" placeholder="cP from the viscometer">` +
        fl(3, "Result", 1) + chips("result", [["pass", "Passed"], ["remix", "Needs re-mix"], ["reject", "Rejected"]]) +
        `<div id="cause" hidden>${fl(4, "What was out of range", 1)}${chips("cause_what", pairs(["pH", "Viscosity"]))}${fl(5, "Too high or too low", 1)}${chips("cause_dir", pairs(["Too high", "Too low"]))}</div>` +
        `<div class="fl">Note <span class="opt">(optional)</span></div>` + `<textarea class="inp" name="note"></textarea>`, "Save QC readings");
      after = () => { const f = $("#fQc"); f.onchange = () => { $("#cause").hidden = val(f, "result") !== "remix"; };
        bind("fQc", f => { const ph = parseFloat(val(f, "ph")), v = parseFloat(val(f, "visc")), r = val(f, "result");
          need(val(f, "ph") !== "" && ph >= 0 && ph <= 14, "Enter a pH between 0 and 14."); need(v > 0, "Enter the viscosity in cP."); need(r, "Pick the result.");
          if (r === "remix") { need(val(f, "cause_what"), "Pick what was out of range."); need(val(f, "cause_dir"), "Pick too high or too low."); }
          return {ph, visc: v, result: r, cause_what: val(f, "cause_what"), cause_dir: val(f, "cause_dir"), note: val(f, "note")}; }, `/api/batches/${b.id}/qc`, "QC readings saved"); };
    }
    if (!ro && b.status === "passed") body += `<div style="margin-top:14px"><button class="btn full" type="button" data-act="move:${b.id}">Mark as moved to holding tank</button></div>`;
    if (!ro && !hasScale(b.equipment_id)) {
      body += form("fKg", b.kg_used != null ? "Correct the material used" : "Enter the material used", "",
        fl(1, "Material used (kg)", 1) + `<input class="inp" name="kg" inputmode="decimal" placeholder="kg from the scale" value="${b.kg_used != null ? b.kg_used : ""}">`, "Save material used");
      const qcAfter = after;
      after = () => { if (qcAfter) qcAfter(); bind("fKg", f => { const kg = parseFloat(val(f, "kg")); need(kg > 0, "Enter the material used in kg."); return {kg}; }, `/api/batches/${b.id}/kg`, "Material used saved"); };
    }
    return {icon: ic("mixer", s.st, {spin: s.spin}), kicker: `Batch · ${e.name}`, title: b.code, body, after};
  }
  if (kind === "stop") {
    const s = S.d.stops.find(x => x.id === n); if (!s) return null; const e = eq(s.equipment_id);
    let body = `${s.ended_at ? stLine("n", `Restarted · stopped for ${mins(minsBetween(s.started_at, s.ended_at))}`) : stLine("r", `Stopped · ${mins(minsBetween(s.started_at))}`)}
      ${tl([[hm(s.started_at), "r", `${h(e.name)} stopped`], ...(s.ended_at ? [[hm(s.ended_at), "g", "Restarted"]] : [])])}
      <h4>Reason</h4>${rows([["Reason", s.reason ? h(s.reason) : `<span class="nr">Not entered</span>`, s.reason ? reasonSrc(s, when(s.updated_at)) : ""], ...(s.note ? [["Note", h(s.note), ""]] : [])])}
      ${e.kind === "mixer" ? `<h4>Effect</h4>${!inBatch(s) ? `<div class="why">No batch was running on this mixer, so no batch was lost.</div>` : lostLine(batchMins(s), week()) || `<div class="why">Less than 1 minute</div>`}` : ""}`;
    let after;
    if (!ro) {
      body += form("fStop", s.reason ? "Change the reason" : "Add the stop reason", "Shown to the owner in “Why equipment stopped”.",
        fl(1, "Reason", 1) + chips("reason", pairs(S.meta.stop_reasons), s.reason) + fl(2, "Note", 0, '(required if "Other")') + `<textarea class="inp" name="note" placeholder="e.g. maintenance called at 11:25">${h(s.note)}</textarea>`, "Save reason");
      if (!s.ended_at && role() === "admin") body += `<div class="btns"><button class="btn ghost" type="button" data-act="restart:${e.id}">${e.kind === "mixer" && activeBatch(e.id) ? "Mark running again" : "Mark restarted (idle)"}</button></div>`;
      after = () => bind("fStop", f => { need(val(f, "reason"), "Pick a reason."); need(val(f, "reason") !== "Other" || val(f, "note"), 'Add a short note for "Other".'); return {reason: val(f, "reason"), note: val(f, "note")}; }, `/api/stops/${s.id}`, "Stop reason saved");
    }
    return {icon: ic(e.kind, s.ended_at ? "n" : "r"), kicker: `Stop · ${e.name}`, title: s.ended_at ? `${e.name} stop` : `${e.name} stopped`, body, after};
  }
  if (kind === "eq") {
    const e = S.d.equipment.find(x => x.id === n); if (!e) return null; const s = eqState(e), b = activeBatch(e.id);
    const es = (S.d.signals || []).filter(x => x.equipment_id === e.id);
    let body = `${stLine(s.st, s.label)}${e.status_at ? `<div>${e.status_src === "sensor" ? sensor(when(e.status_at)) : manual(when(e.status_at))}</div>` : ""}<h4>Sensor readings</h4>${es.length ? rows(es.map(x => [h(S.meta.metrics[x.metric].label), sigVal(x), x.last_at ? sensor(when(x.last_at)) : ""])) : rows([["Run / stop signal", needsConn("Status is entered by hand until a sensor is connected"), ""]])}`;
    if (b) body += `<h4>Batch</h4>${rows([[h(b.code), "Open ›", "", "", `batch:${b.id}`]])}`;
    if (!ro && role() === "admin") {
      const btn = (st, l, ghost) => `<button class="btn ${ghost ? "ghost" : ""}" type="button" data-act="status:${e.id}:${st}">${l}</button>`;
      body += `<h4>Change status</h4><div class="btns">${openStop(e.id) ? btn(b && b.status !== "passed" ? "running" : "idle", b && b.status !== "passed" ? "Running again" : "Restarted (idle)") : btn("stopped", "Mark stopped")}${!openStop(e.id) && e.kind !== "mixer" ? btn("running", "Running", 1) + btn("idle", "Idle", 1) : ""}</div>`;
      if (e.kind === "mixer" && !b) body += `<div class="btns"><button class="btn ghost" type="button" data-open="start:${e.id}">Start a batch on ${h(e.name)}</button></div>`;
    }
    return {icon: ic(e.kind, s.st, {spin: s.spin}), kicker: S.meta.kinds[e.kind], title: e.name, body};
  }
  if (kind === "day") {
    const day = id, list = S.d.stops.filter(s => dayOf(s.started_at) === day || dayMins(s, day) > 0), tot = list.reduce((a, s) => a + dayMins(s, day), 0);
    let body = `<div class="big">${list.length || hasDay(day) ? mins(tot) : NRs} <small>stopped</small></div>` + (list.length ? `<h4>Stops</h4>` + rows(list.map(s => [`${h(eq(s.equipment_id).name)} · ${hm(s.started_at)}${s.ended_at ? `–${hm(s.ended_at)}` : " · still stopped"}`, s.reason ? h(s.reason) : `<span class="st"><span class="dot r"></span>Reason needed</span>`, manual(dayMins(s, day) === minsBetween(s.started_at, s.ended_at) ? mins(dayMins(s, day)) : `${mins(dayMins(s, day))} on this day · ${mins(minsBetween(s.started_at, s.ended_at))} in total`), ic(eq(s.equipment_id).kind, s.ended_at ? null : "r", {size: "sm"}), `stop:${s.id}`])) : empty("No stops recorded on this day."));
    let after;
    if (!ro && S.d.equipment.length) { body += stopForm("fPast", `Add a stop on ${day === S.d.today ? "today" : dm(day)}`); after = () => bindStop("fPast", day); }
    return {icon: ic("motor"), kicker: "Downtime", title: day === S.d.today ? "Today" : dm(day), body, after};
  }
  if (ro) return null;
  if (kind === "start") {
    const e = S.d.equipment.find(x => x.id === n); if (!e) return null;
    return {icon: ic("mixer"), kicker: "New batch", title: `Start a batch on ${e.name}`, body: form("fStart", "Start the batch", "The batch number is made automatically, e.g. MX1-20261023-01.", fl(1, "Start time", 0, "(leave empty for now)") + `<input class="inp" name="start" placeholder="${hhmm()}" inputmode="numeric">`, "Start batch"),
      after: () => bind("fStart", f => ({equipment_id: e.id, start: val(f, "start")}), "/api/batches", "Batch started", () => { const b = activeBatch(e.id); b ? openD(`batch:${b.id}`) : closeD(); })};
  }
  if (kind === "addEq") return {icon: ic("other"), kicker: "Equipment", title: "Add equipment", body: form("fEq", "Add equipment", "Add each machine you want to follow.", fl(1, "Type", 1) + chips("kind", Object.entries(S.meta.kinds)) + fl(2, "Name", 1) + `<input class="inp" name="name" placeholder="e.g. Mixer 1, Scale 1">` +
      `<div id="eqsc" hidden>${fl(3, "Mixer it fills", 1)}${chips("feeds_id", mixers().map(e => [String(e.id), e.name]))}${fl(4, "What it weighs", 1)}${chips("material", Object.entries(S.meta.materials || {}))}</div>`, "Add equipment"),
    after: () => { const f = document.getElementById("fEq"); f.querySelectorAll('[name="kind"]').forEach(r => r.onchange = () => { f.querySelector("#eqsc").hidden = val(f, "kind") !== "scale"; });
      bind("fEq", f => { need(val(f, "kind"), "Pick the type."); need(val(f, "name"), "Enter a name, e.g. Mixer 1."); const sc = val(f, "kind") === "scale";
        if (sc) { need(val(f, "feeds_id"), "Pick the mixer this scale fills."); need(val(f, "material"), "Pick what it weighs."); }
        return {kind: val(f, "kind"), name: val(f, "name"), ...(sc ? {feeds_id: Number(val(f, "feeds_id")), material: val(f, "material")} : {})}; }, "/api/equipment", "Equipment added", async () => { closeD(); if (view() === "connections") await loadConn(); }); }};
  if (kind === "settings") return {icon: ic("coins"), kicker: "Setup", title: "Target and prices", body: form("fSet", "Target and prices", "Leave a field empty if you don't know it yet. Values that need it will show “Not recorded”.",
      Object.entries(S.meta.settings).map(([k, l], i) => fl(i + 1, l, 0) + `<input class="inp" name="${k}" ${k === "factory_name" ? "" : 'inputmode="decimal"'} value="${h(setv(k) || "")}">`).join(""), "Save"),
    after: () => bind("fSet", f => Object.fromEntries(Object.keys(S.meta.settings).map(k => [k, val(f, k)])), "/api/settings", "Saved", closeD)};
  if (kind === "loss") {
    const t = S.d.losses.filter(l => l.day === S.d.today);
    return {icon: ic("scale"), kicker: "Today", title: "Material loss", body: (t.length ? rows(t.map(l => [`${h(l.type)}${l.batch_id ? ` · ${h((S.d.batches.find(b => b.id === l.batch_id) || {}).code || "")}` : ""}`, `${fmt(l.kg, 2)} kg`, manual(when(l.at))])) : empty("Nothing entered today.")) +
      form("fLoss", "Add material loss", "", fl(1, "Weight (kg)", 1) + `<input class="inp" name="kg" inputmode="decimal" placeholder="from the scale">` + fl(2, "Type", 1) + chips("type", pairs(S.meta.loss_types)) +
        fl(3, "Batch", 0) + `<select class="inp" name="batch_id" style="min-height:0"><option value="">Not linked to a batch</option>${S.d.batches.slice(0, 20).map(b => `<option value="${b.id}">${h(b.code)}</option>`).join("")}</select>`, "Save loss"),
      after: () => { const rid = Math.random().toString(36).slice(2) + Date.now(); bind("fLoss", f => { const kg = parseFloat(val(f, "kg")); need(kg > 0, "Enter the weight in kg."); need(val(f, "type"), "Pick the type."); return {kg, type: val(f, "type"), batch_id: val(f, "batch_id"), request_id: rid}; }, "/api/losses", "Material loss saved"); }};
  }
  if (kind === "labour") {
    const l = S.d.labour.find(x => x.day === S.d.today);
    return {icon: ic("person"), kicker: "Labour", title: "People and hours", body: rows(lastDays(7).reverse().map(d => { const x = S.d.labour.find(y => y.day === d); return [d === S.d.today ? "Today" : dm(d), x ? peopleLine(x) : `<span class="nr">Not entered</span>`, x ? manual(when(x.updated_at)) : ""]; })) +
      form("fLab", "Enter today's labour", "The app works out the staff-hours." + (setn("labour_rate") === null ? " Set the labour cost per hour in Target and prices to see AED." : ""),
        fl(1, "Number of people who worked today", 1) + `<input class="inp" name="people" inputmode="numeric" placeholder="e.g. 3" value="${l && l.people ? l.people : ""}">` +
        fl(2, "Hours each person worked", 1) + `<input class="inp" name="hours_each" inputmode="decimal" placeholder="e.g. 8" value="${l && l.hours_each ? l.hours_each : ""}">`, "Save labour"),
      after: () => bind("fLab", f => { const p = Number(val(f, "people")), e = parseFloat(val(f, "hours_each")); need(Number.isInteger(p) && p > 0, "Enter the number of people (a whole number)."); need(e > 0 && e <= 24, "Enter the hours each person worked (up to 24)."); return {people: p, hours_each: e, day: S.d.today}; }, "/api/labour", "Labour saved")};
  }
  if (kind === "gw") {
    const g = (S.d.gateways || []).find(x => x.id === n); if (!g) return null; const full = S.conn && S.conn.gateways.find(x => x.id === n);
    return {icon: ic("gateway", g.last_seen && !quiet(g) ? "g" : "a"), kicker: "Gateway", title: g.name, body: `${g.last_seen ? stLine(quiet(g) ? "a" : "g", quiet(g) ? "Not sending data" : "Online") : stLine("n", "No data received yet")}
      ${rows([["Last data", g.last_seen ? when(g.last_seen) : NR(""), g.last_seen ? sensor("received by the server") : ""], ["Signals", String((S.d.signals || []).length), ""], ...(full && full.last_unknown ? [["Tags not linked yet", h(full.last_unknown), "add a signal for each in Connections"]] : [])])}
      ${full && full.last_payload ? `<h4>Last message received</h4><pre class="mono" style="white-space:pre-wrap;word-break:break-all;background:#f7f7f7;border:1px solid var(--line);border-radius:10px;padding:10px;font-size:12px">${h(full.last_payload)}</pre>` : ""}
      <div class="why" style="margin-top:10px">If it stays "Not sending data", check the gateway's power, its 4G signal and the server address.</div>`};
  }
  if (kind === "addGw" && team()) return {icon: ic("gateway"), kicker: "Connections", title: "Add gateway", body: `<div id="gwKey"></div>` + form("fGw", "Add a gateway", "A secret key is created. It is shown only once: put it in the gateway's HTTP header.", fl(1, "Name", 1) + `<input class="inp" name="name" placeholder="e.g. Gateway near Mixer 1" style="min-height:0">`, "Create key"),
    after: () => { const f = $("#fGw"); f.onsubmit = async e => { e.preventDefault(); const box = f.querySelector(".err"), b = f.querySelector("button.btn");
      if (!val(f, "name")) { box.textContent = "Enter a name."; box.hidden = false; return; } if (b.disabled) return; b.disabled = true; b.textContent = "Saving…";
      try { const r = await api("POST", "/api/gateways", {name: val(f, "name")}); f.remove(); $("#gwKey").innerHTML = `<div class="form"><h5>Gateway key</h5><div class="why">Copy it now. It can't be shown again; if it's lost, remove the gateway and add a new one.</div><pre class="mono" style="white-space:pre-wrap;word-break:break-all;background:#f7f7f7;border:1px solid var(--line);border-radius:10px;padding:10px">${h(r.key)}</pre></div>`; await reload(); toast("Gateway added"); }
      catch (er) { box.textContent = er.error; box.hidden = false; b.disabled = false; b.textContent = "Try again"; } }; }};
  if (kind === "sclink" && team()) { const e = eq(n);
    return {icon: ic("scale"), kicker: "Scale", title: e.name, body: form("fScl", "Link to the mixer it fills", "Its weighings then count into that mixer's batch.",
      fl(1, "Mixer it fills", 1) + chips("feeds_id", mixers().map(x => [String(x.id), x.name]), e.feeds_id ? String(e.feeds_id) : "") + fl(2, "What it weighs", 1) + chips("material", Object.entries(S.meta.materials || {}), e.material || ""), "Save"),
      after: () => bind("fScl", f => { need(val(f, "feeds_id"), "Pick the mixer this scale fills."); need(val(f, "material"), "Pick what it weighs."); return {feeds_id: Number(val(f, "feeds_id")), material: val(f, "material")}; }, `/api/equipment/${e.id}/scale`, "Scale linked", async () => { closeD(); await loadConn(); })}; }
  if (kind === "addSig" && team()) { const M = S.meta.metrics;
    return {icon: ic("bolt"), kicker: "Connections", title: "Add signal", body: form("fSig", "Link a tag to equipment", "Use the exact tag name set in the gateway.",
      fl(1, "Equipment", 1) + chips("equipment_id", S.d.equipment.map(e => [String(e.id), e.name])) + fl(2, "What it measures", 1) + chips("metric", Object.entries(M).map(([k, v]) => [k, `${v.label}${v.unit ? ` (${v.unit})` : ""}`])) +
      fl(3, "Tag name", 1) + `<input class="inp" name="tag" placeholder="e.g. mixer1_hz" style="min-height:0" autocapitalize="off">` +
      fl(4, "Multiplier", 0, "(optional · default 1, e.g. 0.01 for Altivar speed)") + `<input class="inp" name="mult" inputmode="decimal" style="min-height:0">` + fl(5, "Offset", 0, "(optional · added after the multiplier)") + `<input class="inp" name="plus" inputmode="decimal" style="min-height:0">` +
      `<div class="why" style="margin-top:8px">Link a scale's weight tag to the scale itself. Its weighings count into the batch of the mixer it fills (set under Equipment above).</div>`, "Add signal"),
      after: () => bind("fSig", f => { need(val(f, "equipment_id"), "Pick the equipment."); need(val(f, "metric"), "Pick what it measures."); need(/^[A-Za-z0-9_.-]{1,60}$/.test(val(f, "tag")), "Enter the tag name (letters, numbers, _ . -).");
        return {equipment_id: Number(val(f, "equipment_id")), metric: val(f, "metric"), tag: val(f, "tag"), mult: val(f, "mult"), plus: val(f, "plus")}; }, "/api/signals", "Signal added", async () => { closeD(); await loadConn(); })}; }
  if (kind === "addStop") return {icon: ic("motor"), kicker: "Downtime", title: "Add a past stop", body: stopForm("fPast", "Add a stop from earlier today"), after: () => bindStop("fPast", S.d.today, closeD)};
  return null;
}
const stopForm = (id, title) => form(id, title, "Add the stop and restart times and the reason, for clarification.",
  fl(1, "Equipment", 1) + chips("equipment_id", S.d.equipment.map(e => [String(e.id), e.name])) + fl(2, "Stopped at (HH:MM)", 1) + `<input class="inp" name="start" placeholder="e.g. 09:30" inputmode="numeric">` + fl(3, "Restarted at (HH:MM)", 1) + `<input class="inp" name="end" placeholder="e.g. 09:50" inputmode="numeric">` +
  fl(4, "Reason", 1) + chips("reason", pairs(S.meta.stop_reasons)) + fl(5, "Note", 0, '(required if "Other")') + `<textarea class="inp" name="note"></textarea>`, "Save stop");
const bindStop = (id, day, then) => bind(id, f => { need(val(f, "equipment_id"), "Pick the equipment."); need(/^\d{1,2}:\d{2}$/.test(val(f, "start")), "Enter the stop time as HH:MM."); need(/^\d{1,2}:\d{2}$/.test(val(f, "end")), "Enter the restart time as HH:MM."); need(val(f, "reason"), "Pick a reason."); need(val(f, "reason") !== "Other" || val(f, "note"), 'Add a short note for "Other".');
  return {equipment_id: Number(val(f, "equipment_id")), day, start: val(f, "start"), end: val(f, "end"), reason: val(f, "reason"), note: val(f, "note")}; }, "/api/stops", "Stop saved", then);
function oDrawer(k) {
  if (k !== "o-quality") return null; const w = week();
  return {icon: ic("qc"), kicker: "This week", title: "Quality", body: w.fin.length ? rows(w.fin.map(b => { const q = lastQc(b); return [h(b.code), b.status === "rejected" ? "Rejected" : b.qc_count > 1 ? `Re-mixed ×${b.qc_count - 1}` : "Passed first time", (q ? `pH ${fmt(q.ph, 2)} · Viscosity ${fmt(q.visc)} cP` : `<span class="nr">pH and viscosity not recorded</span>`) + manual(`last QC ${when(q ? q.at : b.finished_at || b.moved_at)}`)]; })) : empty("No finished batches this week.")};
}

function bindAdmin(id, build, path, msg) {
  const f = document.getElementById(id); if (!f) return;
  f.onsubmit = async e => { e.preventDefault(); const box = f.querySelector(".err"), b = f.querySelector("button.btn");
    let body; try { body = build(f); } catch (m) { box.textContent = m; box.hidden = false; return; }
    if (b.disabled) return; b.disabled = true; b.textContent = "Saving…"; box.hidden = true;
    try { await api("POST", path, body); await refreshMe(); await loadAdmin(); toast(msg); closeD(); }
    catch (er) { box.textContent = er.error; box.hidden = false; b.disabled = false; b.textContent = "Try again"; } };
}
async function refreshMe() { S.user = (await api("GET", "/api/me")).user; if (!S.fid) pickFactory(); }
async function loadAdmin() { S.admin = await api("GET", "/api/admin"); render(); }

// ---------- actions without a form ----------
async function act(a) {
  const [k, id, st] = a.split(":");
  if (k === "open") return switchF(id);
  if (k === "cf") { S.conn = null; return switchF(id); }
  if (k === "rs") { if (S.busy) return; S.busy = true;
    try { await api("POST", "/api/admin/support/resolve", {id: Number(id)}); await loadAdmin(); toast("Marked resolved"); } catch (e) { toast(e.error); } finally { S.busy = false; } return; }
  if (k === "refconn") return loadConn().catch(e => toast(e.error));
  if (k === "rmgw" || k === "rmsig") { if (S.busy || !confirm(k === "rmgw" ? "Remove this gateway? Its key stops working straight away." : "Remove this signal and its readings?")) return; S.busy = true;
    try { await api("POST", `/api/${k === "rmgw" ? "gateways" : "signals"}/${id}/remove`, {}); await reload(); await loadConn(); toast("Removed"); } catch (e) { toast(e.error); } finally { S.busy = false; } return; }
  if (k === "rm") { if (S.busy || !confirm("Remove this person from the factory? Their login will no longer open it.")) return; S.busy = true;
    try { await api("POST", "/api/admin/people/remove", {user_id: Number(id), factory_id: Number(st)}); await loadAdmin(); toast("Removed"); } catch (e) { toast(e.error); } finally { S.busy = false; } return; }
  const path = k === "move" ? `/api/batches/${id}/move` : `/api/equipment/${id}/status`;
  const body = k === "move" ? {} : {status: k === "restart" ? (activeBatch(Number(id)) && activeBatch(Number(id)).status !== "passed" ? "running" : "idle") : st};
  if (S.busy) return; S.busy = true;
  try { await api("POST", path, body); await reload(); toast(k === "move" ? "Marked as moved to holding tank" : "Status saved"); if (S.key) openD(S.key); }
  catch (e) { toast(e.error); } finally { S.busy = false; }
}

// ---------- login, load, render ----------
function loginView() {
  $("#root").innerHTML = `<div class="login"><div class="obrand">OmniSite</div><h1 style="margin-top:18px">Factory operations</h1><div class="sub">Log in to follow your factory.</div>
   <form class="form" id="fLogin" novalidate><div class="fl">1. Email <span class="req">*</span></div><input class="inp" name="email" type="email" autocomplete="username" style="min-height:0">
   <div class="fl">2. Password <span class="req">*</span></div><input class="inp" name="password" type="password" autocomplete="current-password" style="min-height:0">
   <div class="err" hidden></div><div style="margin-top:14px"><button class="btn full">Log in</button></div></form></div>`;
  const f = $("#fLogin");
  f.onsubmit = async e => { e.preventDefault(); const box = f.querySelector(".err"), b = f.querySelector("button");
    if (!val(f, "email") || !val(f, "password")) { box.textContent = "Enter your email and password."; box.hidden = false; return; }
    b.disabled = true; try { const r = await api("POST", "/api/login", {email: val(f, "email"), password: f.password.value}); S.user = r.user; pickFactory(); await load(); } catch (er) { box.textContent = er.error; box.hidden = false; b.disabled = false; } };
}
async function logout() { try { await api("POST", "/api/logout"); } catch (e) {} S.user = null; S.viewAs = ""; S.pvName = ""; localStorage.removeItem("omni_viewas"); localStorage.removeItem("omni_viewas_name"); closeD(); render(); }
async function reload() { if (S.fid) S.d = await api("GET", "/api/state"); if (["admin", "support"].includes(view())) S.admin = await api("GET", "/api/admin"); if (view() === "connections") S.conn = await api("GET", "/api/connections"); render(); }
async function load() {
  try { if (!S.meta) S.meta = await api("GET", "/api/meta"); await reload(); }
  catch (e) { if (e.status === 401) return; $("#root").innerHTML = `<div class="login"><h1>Could not load</h1><p class="err">${h(e.error)}</p><button class="btn" onclick="load()">Try again</button></div>`; }
}
function render() {
  if (!S.user) return loginView();
  if (!S.d && S.fid && !["admin", "support"].includes(view())) return;
  if (!S.fid && !S.user.admin) { $("#root").innerHTML = `<div class="login"><div class="obrand">OmniSite</div><h1 style="margin-top:18px">No factory yet</h1><div class="sub">This login isn't linked to a factory yet. Ask OmniSite to add you.</div><div class="btns"><button class="btn ghost" type="button" onclick="logout()">Log out</button></div></div>`; return; }
  if (!S.fid && !S.user.admin) return;
  $("#root").innerHTML = S.user.admin || canEdit() ? manager() : owner();
  twMount();
  document.title = `OmniSite · ${view() === "support" ? "Support" : view() === "admin" ? "Factories" : view() === "connections" ? "Connections" : canEdit() ? VIEWS[view()] : "Owner"}`;
}
document.addEventListener("click", e => {
  if (e.target.closest(".toast")) return;
  const a = e.target.closest("[data-act]"); if (a) { e.preventDefault(); return act(a.dataset.act); }
  const o = e.target.closest("[data-open]"); if (o) { e.preventDefault(); return openD(o.dataset.open); }
  const g = e.target.closest("[data-go]"); if (g) location.hash = g.dataset.go;
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") return closeD();
  if (e.key !== "Enter" && e.key !== " ") return;
  const t = e.target; if (!t.closest || t.closest("form") || t.tagName === "BUTTON") return;
  const o = t.closest("[data-open]"), g = t.closest("[data-go]");
  if (o) { e.preventDefault(); openD(o.dataset.open); } else if (g) { e.preventDefault(); location.hash = g.dataset.go; }
});
$("#scrim").onclick = closeD; $("#dClose").onclick = closeD;
window.addEventListener("hashchange", () => { closeD(); if (["admin", "support"].includes(view())) loadAdmin().catch(e => toast(e.error)); else if (view() === "connections") loadConn().catch(e => toast(e.error)); else render(); window.scrollTo(0, 0); });
setInterval(() => document.querySelectorAll("[data-since]").forEach(el => el.textContent = clock(nowMs() - new Date(el.dataset.since))), 1000);
setInterval(() => { if (S.user && S.d && !S.key && !document.hidden) reload().catch(() => {}); }, 30000);
(async () => { try { S.user = (await api("GET", "/api/me")).user; pickFactory(); } catch (e) { S.user = null; } S.user ? load() : render(); })();

```

## `ops/static/twin3d.js`

```javascript
"use strict";
// Realistic 3D digital twin for the factory dashboard (kept alive across re-renders)
const TW = {el: null, key: "", st: null, loading: null};
function twLoad() {
  if (window.THREE && THREE.OrbitControls && THREE.RoomEnvironment) return Promise.resolve();
  if (TW.loading) return TW.loading;
  const one = s => new Promise((ok, no) => { const e = document.createElement("script"); e.src = s; e.onload = ok; e.onerror = () => no(s); document.head.appendChild(e); });
  return TW.loading = one("three.min.js").then(() => one("OrbitControls.js")).then(() => one("RoomEnvironment.js"));
}
function twMount() {
  const slot = document.getElementById("twinSlot"); if (!slot || !S.d) return;
  if (!TW.el) { TW.el = document.createElement("div"); TW.el.className = "tw3";
    TW.el.innerHTML = `<div class="tw-v"><div class="tw-lbl"></div><div class="tw-ctl"><button type="button" data-t="spin">360°</button><button type="button" data-t="top">Top view</button><button type="button" data-t="home">Reset</button></div><div class="tw-info" hidden></div><div class="tw-msg">Loading 3D…</div></div>`; }
  slot.appendChild(TW.el);
  twLoad().then(() => { TW.el.querySelector(".tw-msg").hidden = true; twSync(); }).catch(() => { TW.el.querySelector(".tw-msg").textContent = "3D view could not load. Check the connection and refresh."; });
}
const TW_COL = {g: 0x16a34a, a: 0xf59e0b, r: 0xdc2626, n: 0x9ca3af};
function twSync() {
  const eqs = S.d.equipment.filter(e => e.kind !== "gateway"), key = S.fid + ":" + eqs.map(e => e.id + e.kind + e.feeds_id).join(",");
  if (!TW.st || TW.key !== key) { if (TW.st) TW.st.dispose(); TW.st = twBuild(eqs); TW.key = key; }
  TW.st.items.forEach(it => { const e = eq(it.id), s = eqState(e), c = TW_COL[s.st] || TW_COL.n;
    it.ring.material.color.setHex(c); it.ring.material.emissive.setHex(c); it.spin = !!s.spin; it.state = s; it.el.style.background = "#" + c.toString(16).padStart(6, "0"); });
  if (TW.st.sel != null) TW.st.info(TW.st.sel);
}
function twBuild(eqs) {
  const T = THREE, V = TW.el.querySelector(".tw-v"), lbl = TW.el.querySelector(".tw-lbl"), infoEl = TW.el.querySelector(".tw-info");
  lbl.innerHTML = "";
  const R = new T.WebGLRenderer({antialias: true}); R.setPixelRatio(Math.min(devicePixelRatio, 2)); R.shadowMap.enabled = true; R.shadowMap.type = T.PCFSoftShadowMap;
  R.toneMapping = T.ACESFilmicToneMapping; R.toneMappingExposure = 0.82; R.outputEncoding = T.sRGBEncoding; V.prepend(R.domElement);
  const Sc = new T.Scene(), pm = new T.PMREMGenerator(R); Sc.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture; Sc.background = new T.Color(0x9aa3ab);
  const C = new T.PerspectiveCamera(42, 1, 0.1, 200), O = new T.OrbitControls(C, R.domElement); O.enableDamping = true; O.maxPolarAngle = Math.PI * 0.495; O.minDistance = 2; O.maxDistance = 60;
  // layout: tanks + mixers back row, scales next to their mixer, fillers on a line, qc on a bench
  const back = eqs.filter(e => ["mixer", "tank"].includes(e.kind)), pumps = eqs.filter(e => e.kind === "pump"), fill = eqs.filter(e => e.kind === "filler"),
    qc = eqs.filter(e => e.kind === "qc"), scales = eqs.filter(e => e.kind === "scale"), other = eqs.filter(e => e.kind === "other");
  const HL = Math.max(14, back.length * 3 + 4, fill.length * 4 + 6, (pumps.length + other.length) * 2.2 + 6), HD = 12, HH = 6.5, pos = {};
  back.forEach((e, i) => pos[e.id] = [2.5 + i * 3, 2.6]);
  const free = scales.filter(s => !pos[s.feeds_id]); scales.filter(s => pos[s.feeds_id]).forEach((s, i, a) => { const p = pos[s.feeds_id], k = a.filter(x => x.feeds_id === s.feeds_id).indexOf(s); pos[s.id] = [p[0] - 0.7 + k * 1.4, p[1] + 2.0]; });
  free.forEach((s, i) => pos[s.id] = [HL - 2 - i * 1.6, 4.8]);
  pumps.concat(other).forEach((e, i) => pos[e.id] = [2.5 + i * 2.2, 5.2]);
  fill.forEach((e, i) => pos[e.id] = [3 + i * 4, 7.8]);
  qc.forEach((e, i) => pos[e.id] = [1.6 + i * 1.4, HD - 1.0]);
  const M = (c, m = 0, r = 0.6, o = {}) => new T.MeshStandardMaterial(Object.assign({color: c, metalness: m, roughness: r}, o));
  const steel = M(0xb8bfc6, 1, 0.18, {envMapIntensity: 0.9}), brushed = M(0xa9b0b6, 1, 0.34, {envMapIntensity: 0.8}), dark = M(0x3a3f44, 0.4, 0.5), teal = M(0x2f7f86, 0.3, 0.45),
    grey = M(0x8f9599, 0.5, 0.45), red = M(0x8b2f1c, 0.4, 0.55), white = M(0xf2f2ee, 0, 0.35), pink = M(0xd9468f, 0, 0.5), blue = M(0x1f5fbf, 0.1, 0.45), black = M(0x1b1d20, 0.2, 0.6),
    glass = new T.MeshPhysicalMaterial({color: 0xddeeff, roughness: 0.05, transparent: true, opacity: 0.22, side: T.DoubleSide}), screen = M(0x1e88e5, 0, 0.2, {emissive: 0x0d47a1, emissiveIntensity: 0.6});
  function tex(w, h, f, rx, ry) { const c = document.createElement("canvas"); c.width = w; c.height = h; f(c.getContext("2d"), w, h); const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx, ry); t.encoding = T.sRGBEncoding; t.anisotropy = 8; return t; }
  function noise(g, w, h, base, n, a) { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = Math.random() * 60 - 30 | 0, c = v > 0 ? 255 : 0; g.fillStyle = `rgba(${c},${c},${c},${Math.abs(v) / 255 * a})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3); } }
  function mesh(g, m, x = 0, y = 0, z = 0, p = Sc) { const o = new T.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; p.add(o); return o; }
  const box = (w, h, d, m, x, y, z, p) => mesh(new T.BoxGeometry(w, h, d), m, x, y + h / 2, z, p);
  const cyl = (r1, r2, h, m, x, y, z, p, s = 40) => mesh(new T.CylinderGeometry(r1, r2, h, s), m, x, y + h / 2, z, p);
  const pipe = (pts, r, m, p = Sc) => mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(a => new T.Vector3(...a)), false, "catmullrom", 0.08), 48, r, 10), m, 0, 0, 0, p);
  const grp = (x, z, p = Sc) => { const g = new T.Group(); g.position.set(x, 0, z); p.add(g); return g; };
  Sc.add(new T.HemisphereLight(0xffffff, 0x6b5d48, 0.35));
  const sun = new T.DirectionalLight(0xfff3e0, 1.5); sun.position.set(HL * 0.8, 22, 10); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {left: -HL, right: HL, top: 14, bottom: -14, near: 1, far: 80}); sun.shadow.bias = -0.0004; sun.target.position.set(HL / 2, 0, HD / 2); Sc.add(sun, sun.target);
  // hall
  const fl = mesh(new T.PlaneGeometry(HL, HD), M(0xffffff, 0, 0.85, {map: tex(512, 512, (g, w, h) => { noise(g, w, h, "#7f786b", 12000, 1.6); for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(70,55,35,${Math.random() * 0.12})`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 80, 10 + Math.random() * 40, Math.random() * 3, 0, 7); g.fill(); } }, HL / 4, HD / 4)}), HL / 2, 0, HD / 2); fl.rotation.x = -Math.PI / 2; fl.castShadow = false;
  const wallT = tex(256, 256, (g, w, h) => noise(g, w, h, "#c9a24e", 6000, 1.6), HL / 2.4, 1.2), corrT = tex(256, 64, (g, w, h) => { for (let x = 0; x < w; x++) { const v = 200 + 40 * Math.sin(x / w * Math.PI * 16); g.fillStyle = `rgb(${v - 8},${v - 4},${v})`; g.fillRect(x, 0, 1, h); } }, HL / 1.7, 1);
  [[HL, 0, 0, 0], [HD, 0, HD, Math.PI / 2], [HD, HL, 0, -Math.PI / 2]].forEach(([len, x, z, ry]) => { const g = grp(x, z); g.rotation.y = ry;
    mesh(new T.PlaneGeometry(len, 2.6), M(0xffffff, 0, 0.95, {map: wallT}), len / 2, 1.3, 0, g).castShadow = false; mesh(new T.PlaneGeometry(len, HH - 2.6), M(0xffffff, 0.3, 0.6, {map: corrT}), len / 2, 2.6 + (HH - 2.6) / 2, 0, g).castShadow = false;
    box(len, 0.08, 0.35, grey, len / 2, 3.2, 0.2, g); for (let i = 0; i < 3; i++) pipe([[0, 3.32, 0.12 + i * 0.07], [len, 3.32, 0.12 + i * 0.07]], 0.018, black, g); });
  for (let x = 0; x <= HL + 0.01; x += HL / Math.round(HL / 6)) { box(0.3, HH, 0.3, red, x, 0, 0.15); box(0.3, HH, 0.3, red, x, 0, HD - 0.15); box(0.14, 0.22, HD, red, x, HH - 0.25, HD / 2).castShadow = false; }
  cyl(0.08, 0.08, 0.02, M(0xe53935, 0, 0.4, {emissive: 0xe53935, emissiveIntensity: 0.6}), 0.35, 0.001, 0.35);
  // builders
  function motor(p, x, y, z, s = 1, col = teal) { const m = new T.Group(); m.position.set(x, y, z); m.scale.setScalar(s); p.add(m);
    cyl(0.16, 0.16, 0.3, grey, 0, 0, 0, m); cyl(0.2, 0.2, 0.04, grey, 0, 0.3, 0, m); cyl(0.17, 0.17, 0.42, col, 0, 0.34, 0, m);
    for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; box(0.02, 0.38, 0.05, col, Math.cos(a) * 0.18, 0.36, Math.sin(a) * 0.18, m).rotation.y = -a; }
    const cap = new T.Group(); cap.position.y = 0.76; m.add(cap); cyl(0.19, 0.19, 0.1, col, 0, 0, 0, cap); box(0.3, 0.02, 0.04, dark, 0, 0.1, 0, cap); box(0.12, 0.1, 0.1, col, 0.2, 0.55, 0, m); return cap; }
  function tank(g, r, h, withMotor) { cyl(r, r, h, steel, 0, 0, 0, g, 64); const top = mesh(new T.SphereGeometry(r, 64, 16, 0, Math.PI * 2, 0, Math.PI / 2), steel, 0, h, 0, g); top.scale.y = 0.12;
    mesh(new T.TorusGeometry(r * 0.36, 0.025, 10, 48), pink, r * 0.38, h + 0.1, 0.1, g).rotation.x = Math.PI / 2; mesh(new T.SphereGeometry(r * 0.36, 40, 10, 0, Math.PI * 2, 0, Math.PI / 2), brushed, r * 0.38, h + 0.1, 0.1, g).scale.y = 0.25;
    box(r * 0.75, 0.03, 0.04, grey, r * 0.38, h + 0.18, 0.1, g); pipe([[r * 0.8, 0.25, 0], [r + 0.25, 0.25, 0], [r + 0.35, 0.12, 0.6]], 0.04, steel, g);
    if (!withMotor) return null;
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; box(0.02, 0.35, 0.3, brushed, Math.cos(a) * 0.12, h + 0.08, Math.sin(a) * 0.12, g).rotation.y = -a; }
    cyl(0.1, 0.1, 0.35, brushed, 0, h + 0.08, 0, g); cyl(0.2, 0.2, 0.05, pink, 0, h + 0.42, 0, g); box(0.28, 0.3, 0.28, grey, 0, h + 0.47, 0, g);
    pipe([[-0.55 * r, h + 0.1, -0.4 * r], [-0.6 * r, h + 0.6, -0.45 * r], [-0.2 * r, h + 0.75, -0.55 * r], [0.25 * r, h + 0.6, -0.55 * r], [0.3 * r, h + 0.1, -0.5 * r]], 0.035, steel, g);
    const pn = grp(r + 0.3, r * 0.9, g); box(0.06, 1.3, 0.06, grey, 0, 0, 0, pn); box(0.45, 0.55, 0.22, M(0xd4d7d9, 0.3, 0.4), 0, 1.3, 0, pn);
    return motor(g, 0, h + 0.77, 0, 1); }
  function filler(g, w) { box(w, 0.75, 1.1, brushed, 0, 0, 0, g); for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.06, 1.3, 0.06, steel, sx * (w / 2 - 0.03), 0.78, sz * 0.52, g); box(w, 0.08, 1.1, steel, 0, 2.08, 0, g);
    for (const sz of [-1, 1]) mesh(new T.PlaneGeometry(w - 0.1, 1.25), glass, 0, 1.43, sz * 0.53, g);
    const n = 8, sp = (w - 0.5) / (n - 1); for (let i = 0; i < n; i++) { const xx = -w / 2 + 0.25 + i * sp; cyl(0.025, 0.012, 0.35, steel, xx, 1.15, 0, g, 16); cyl(0.04, 0.04, 0.12, dark, xx, 1.5, 0, g, 16); }
    cyl(0.35, 0.3, 0.55, steel, 0, 2.16, 0, g); box(0.35, 0.5, 0.12, grey, w / 2 + 0.2, 1.1, 0.4, g); box(0.3, 0.22, 0.02, screen, w / 2 + 0.2, 1.3, 0.47, g);
    const L = 3.6; box(L, 0.06, 0.32, brushed, 0, 0.85, -0.75, g); for (let x = -L / 2 + 0.15; x < L / 2; x += 0.32) { cyl(0.06, 0.065, 0.24, white, x, 0.91, -0.75, g, 20); cyl(0.025, 0.025, 0.04, blue, x, 1.15, -0.75, g, 12); }
    for (let x = -L / 2 + 0.2; x < L / 2; x += 1.1) box(0.04, 0.85, 0.3, brushed, x, 0, -0.75, g); }
  function pump(g) { box(0.9, 0.12, 0.45, grey, 0, 0, 0, g); const c = motor(g, 0, 0, 0, 0.8, M(0x5b6670, 0.4, 0.45)); c.parent.rotation.z = Math.PI / 2; c.parent.position.set(0.25, 0.3, 0); cyl(0.16, 0.16, 0.18, brushed, 0.38, 0.12, 0, g); return c; }
  function scale(g) { box(1.2, 0.08, 1.2, M(0x546e7a, 0.6, 0.4), 0, 0, 0, g); box(0.05, 1.1, 0.05, grey, 0.7, 0, 0.55, g); box(0.3, 0.2, 0.08, M(0xeceff1, 0, 0.4), 0.7, 1.1, 0.55, g); box(0.2, 0.06, 0.01, M(0x00e676, 0, 0.2, {emissive: 0x00c853, emissiveIntensity: 1}), 0.7, 1.17, 0.6, g); }
  function qcTool(g, first) { if (first) { box(Math.max(1.6, qc.length * 1.4 + 0.4), 0.04, 0.7, M(0xeceff1, 0, 0.3), (qc.length - 1) * 0.7, 0.88, 0, g); for (const sx of [-0.5, (qc.length - 1) * 1.4 + 0.5]) for (const sz of [-0.3, 0.3]) box(0.04, 0.88, 0.04, grey, sx, 0, sz, g); }
    box(0.25, 0.03, 0.2, dark, 0, 0.92, 0, g); cyl(0.015, 0.015, 0.4, steel, 0, 0.92, -0.06, g, 10); box(0.22, 0.16, 0.18, M(0xfafafa, 0, 0.3), 0, 1.2, 0, g); }
  const items = [];
  eqs.forEach((e, i) => { const [x, z] = pos[e.id] || [2 + i, 6], g = grp(x, z); let spinner = null, r = 0.8;
    if (e.kind === "mixer") { spinner = tank(g, 1.0, 1.7, true); r = 1.25; }
    else if (e.kind === "tank") { tank(g, 1.0, 1.9, false); r = 1.25; }
    else if (e.kind === "filler") { filler(g, 2.4); r = 1.7; }
    else if (e.kind === "pump") { spinner = pump(g); r = 0.7; }
    else if (e.kind === "scale") { scale(g); r = 0.95; }
    else if (e.kind === "qc") { qcTool(g, qc.indexOf(e) === 0); r = 0.35; }
    else { box(0.9, 1.0, 0.7, M(0x78909c, 0.3, 0.5), 0, 0, 0, g); r = 0.7; }
    const ring = mesh(new T.RingGeometry(r, r + 0.09, 64), M(0x9ca3af, 0, 0.4, {emissive: 0x9ca3af, emissiveIntensity: 0.9, side: T.DoubleSide}), 0, e.kind === "qc" ? 0.925 : 0.012, 0, g); ring.rotation.x = -Math.PI / 2; ring.castShadow = false;
    g.traverse(o => o.userData.tw = items.length);
    const bb = new T.Box3().setFromObject(g), c = bb.getCenter(new T.Vector3());
    const el = document.createElement("button"); el.type = "button"; el.className = "tw-tag"; el.textContent = e.name; lbl.appendChild(el);
    const it = {id: e.id, g, ring, spinner, spin: false, bb, c, top: new T.Vector3(c.x, bb.max.y + 0.3, c.z), el}; el.onclick = () => pick(items.indexOf(it)); items.push(it); });
  let sel = null, helper = null, fly = null, raf = 0, dead = false;
  const flyTo = (p, t) => fly = {p0: C.position.clone(), t0: O.target.clone(), p1: p, t1: t, s: performance.now()};
  const home = () => flyTo(new T.Vector3(-3, HL * 0.55 + 3, HD + HL * 0.45 + 2), new T.Vector3(HL / 2, 0.5, HD / 2 - 0.5));
  function info(i) { const it = items[i], e = eq(it.id), b = activeBatch(e.id), s = it.state || eqState(e);
    infoEl.innerHTML = `<div class="k">${h(S.meta.kinds[e.kind] || e.kind)}</div><b>${h(e.name)}</b><div style="margin-top:4px">${stLine(s.st, s.label)}</div>${b ? `<div class="why">Batch ${h(b.code)}</div>` : ""}${e.status_at ? `<div class="why">Updated ${when(e.status_at)} · ${e.status_src === "sensor" ? "Sensor" : "Manual"}</div>` : ""}`; infoEl.hidden = false; }
  function pick(i) { sel = i; const it = items[i]; if (helper) Sc.remove(helper); helper = new T.Box3Helper(it.bb.clone().expandByScalar(0.08), 0x111111); Sc.add(helper);
    items.forEach((x, j) => x.el.classList.toggle("on", j === i)); const d = Math.max(3, it.bb.getSize(new T.Vector3()).length() * 1.8);
    flyTo(it.c.clone().add(new T.Vector3(1.2, 0.9, 1.6).normalize().multiplyScalar(d)), it.c.clone()); O.autoRotate = false; info(i); st.sel = i; }
  TW.el.querySelector(".tw-ctl").onclick = ev => { const t = ev.target.dataset.t; if (!t) return;
    if (t === "spin") { O.autoRotate = !O.autoRotate; O.autoRotateSpeed = 1.6; }
    if (t === "top") { flyTo(new T.Vector3(HL / 2, HL * 1.1 + 6, HD / 2 + 0.01), new T.Vector3(HL / 2, 0, HD / 2)); O.autoRotate = false; }
    if (t === "home") { home(); infoEl.hidden = true; sel = st.sel = null; if (helper) Sc.remove(helper); items.forEach(x => x.el.classList.remove("on")); } };
  const rc = new T.Raycaster(), mv = new T.Vector2(); let down = null;
  R.domElement.addEventListener("pointerdown", e => down = [e.clientX, e.clientY]);
  R.domElement.addEventListener("pointerup", e => { if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return; const r = R.domElement.getBoundingClientRect();
    mv.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); rc.setFromCamera(mv, C); const hit = rc.intersectObjects(Sc.children, true).find(x => x.object.userData.tw !== undefined); if (hit) pick(hit.object.userData.tw); });
  C.position.set(-3, HL * 0.55 + 3, HD + HL * 0.45 + 2); O.target.set(HL / 2, 0.5, HD / 2 - 0.5);
  const v = new T.Vector3(); let W = 0, H = 0;
  function loop(t) { if (dead) return; raf = requestAnimationFrame(loop); if (!TW.el.isConnected || document.hidden) return;
    if (V.clientWidth !== W || V.clientHeight !== H) { W = V.clientWidth; H = V.clientHeight; R.setSize(W, H); C.aspect = W / H; C.updateProjectionMatrix(); }
    if (fly) { const k = Math.min(1, (t - fly.s) / 900), q = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; C.position.lerpVectors(fly.p0, fly.p1, q); O.target.lerpVectors(fly.t0, fly.t1, q); if (k >= 1) fly = null; }
    items.forEach(it => { if (it.spin && it.spinner) it.spinner.rotation.y += 0.12; });
    O.update(); R.render(Sc, C);
    items.forEach(it => { v.copy(it.top).project(C); const ok = v.z < 1 && Math.abs(v.x) < 1.02 && Math.abs(v.y) < 1.02; it.el.style.display = ok ? "block" : "none"; if (ok) it.el.style.transform = `translate(${(v.x + 1) / 2 * W}px,${(1 - v.y) / 2 * H}px) translate(-50%,-100%)`; }); }
  raf = requestAnimationFrame(loop);
  const st = {items, info, sel: null, dispose() { dead = true; cancelAnimationFrame(raf); R.dispose(); R.domElement.remove(); pm.dispose(); }};
  return st;
}
function twinCard() {
  return `<section class="card c6 twin" style="cursor:default"><div class="ch"><span class="ct">${ic("mixer")}Digital twin · 3D</span><span class="muted" style="font-size:12px">Example layout until the site survey positions are added</span></div>
   <div id="twinSlot"></div><div class="lg" style="margin-top:10px"><span><span class="sw" style="background:#16a34a"></span>Running</span><span><span class="sw" style="background:#9ca3af"></span>Idle / not connected</span><span><span class="sw" style="background:#dc2626"></span>Stopped / fault</span><span class="muted">Drag to turn · pinch to zoom · tap a machine</span></div></section>`;
}

```

## `ops/static/app.css`

```css
:root{--ink:#111;--ink2:#3a3a3a;--mute:#767676;--line:#e7e7e7;--soft:#f6f6f6;--bg:#fff;
--green:#1f9d55;--amber:#c98200;--red:#d64545;--r:14px}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:14px;-webkit-font-smoothing:antialiased}
button,input,textarea,select{font:inherit;color:inherit}
.preview{background:var(--soft);border-bottom:1px solid var(--line);text-align:center;font-size:12px;color:var(--mute);padding:6px 12px}
.preview a{color:var(--ink2)}
.app{display:grid;grid-template-columns:220px 1fr;min-height:100vh}
.side{border-right:1px solid var(--line);padding:24px 16px;display:flex;flex-direction:column;gap:4px;position:sticky;top:0;height:100vh}
.brand{font-weight:700;font-size:18px;letter-spacing:-.2px;padding:0 10px 22px}
.brand small{display:block;font-weight:400;font-size:12px;color:var(--mute);margin-top:2px}
.nav a{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;color:var(--ink2);text-decoration:none}
.nav a.on{background:var(--soft);color:var(--ink);font-weight:600}
.nav a:hover{background:var(--soft)}
.nav svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.6}
.side .foot{margin-top:auto;font-size:12px;color:var(--mute);padding:0 10px;line-height:1.5}
main{padding:28px 32px 48px;min-width:0}
.top{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:22px}
h1{font-size:24px;font-weight:600;margin:0;letter-spacing:-.3px}
.sub{color:var(--mute);margin-top:4px}
.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:var(--mute)}
.layout{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:20px;align-items:start}
.grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:20px}
.c2{grid-column:span 2}.c3{grid-column:span 3}.c4{grid-column:span 4}.c6{grid-column:span 6}
.card{border:1px solid var(--line);border-radius:var(--r);padding:18px 18px 16px;background:#fff;cursor:pointer;transition:border-color .15s,box-shadow .15s;position:relative;min-width:0}
.card:hover{border-color:#cfcfcf;box-shadow:0 2px 10px rgba(0,0,0,.04)}
.card:focus-visible,.al:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.ch{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px}
.ct{font-size:14px;font-weight:500;color:var(--ink2);display:flex;align-items:center;gap:12px;min-width:0}
.open{font-size:12px;color:var(--mute);white-space:nowrap}
.card:hover .open{color:var(--ink)}
.big{font-size:30px;font-weight:600;letter-spacing:-.6px;line-height:1.1}
.big small{font-size:14px;font-weight:500;color:var(--mute);letter-spacing:0}
.mid{font-size:18px;font-weight:600}
.muted{color:var(--mute)}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.src{display:inline-flex;align-items:flex-start;gap:5px;font-size:11.5px;color:var(--mute);margin-top:8px}
.li .src,.kv .src{display:flex}
.src i{flex:none;margin-top:1px;font-style:normal;font-size:11px;width:14px;height:14px;border-radius:50%;display:inline-grid;place-items:center;border:1px solid #cfcfcf;color:var(--ink2);line-height:1}
.nr{color:var(--mute);font-weight:500}
.nr::before{content:"— "}
.why{font-size:12px;color:var(--mute)}
.bar{height:8px;background:var(--soft);border-radius:99px;overflow:hidden;margin:14px 0 8px;position:relative}
.bar b{display:block;height:100%;background:var(--ink);border-radius:99px}
.bar .tick{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--amber)}
.st{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}
.g{background:var(--green)}.a{background:var(--amber)}.r{background:var(--red)}.n{background:#bdbdbd}
.sep{height:1px;background:var(--line);margin:12px 0}
/* equipment icons */
.ic{position:relative;flex:none;width:52px;height:52px;border-radius:13px;border:1px solid var(--line);background:var(--soft);display:inline-grid;place-items:center;color:var(--ink)}
.ic svg{width:34px;height:34px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.ic.lg{width:76px;height:76px;border-radius:16px}.ic.lg svg{width:52px;height:52px}
.ic.sm{width:38px;height:38px;border-radius:10px}.ic.sm svg{width:25px;height:25px}
.ic .bd{position:absolute;top:-4px;right:-4px;width:14px;height:14px;border-radius:50%;border:2px solid #fff}
.ic.sm .bd{width:11px;height:11px;top:-3px;right:-3px}
.ic .imp{transform-box:fill-box;transform-origin:center}
.ic.spin .imp{animation:spin 1.1s linear infinite}
@keyframes spin{0%{transform:scaleX(1)}50%{transform:scaleX(-1)}100%{transform:scaleX(1)}}
@media (prefers-reduced-motion:reduce){.ic.spin .imp{animation:none}}
.active .ic{background:#222;border-color:#3a3a3a;color:#fff}.active .ic .bd{border-color:#111}
/* active */
.active{background:#111;color:#fff;border-color:#111}
.active:hover{border-color:#111;box-shadow:0 4px 16px rgba(0,0,0,.18)}
.active .ct,.active .open{color:#bdbdbd}.active:hover .open{color:#fff}
.active .src{color:#a8a8a8}.active .src i{border-color:#555;color:#ddd}
.active .muted,.active .why,.active .nr{color:#a8a8a8}
.timer{font-family:"IBM Plex Mono",monospace;font-size:30px;font-weight:500;letter-spacing:-.5px}
.steps{display:flex;gap:4px;margin:14px 0 6px}
.steps span{flex:1;height:4px;border-radius:9px;background:#3a3a3a}
.steps span.done{background:#fff}.steps span.now{background:linear-gradient(90deg,#fff 55%,#3a3a3a 55%)}
.kv{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;margin-top:12px}
.kv div{min-width:0}
.kv b{display:block;font-size:15px;font-weight:600}
.kv .src{margin-top:3px}
svg text{font-family:"IBM Plex Sans",sans-serif}
.lg{display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:var(--ink2);margin-top:6px}
.sw{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:6px;vertical-align:-1px}
.heat{display:grid;grid-template-columns:56px repeat(7,minmax(0,1fr));gap:5px;font-size:11.5px;color:var(--mute);align-items:center}
.heat .cell{height:34px;border-radius:7px;display:grid;place-items:center;font-size:11px;color:var(--ink2)}
.heat .cell.l0{background:var(--soft)}.heat .cell.l1{background:#d9d9d9}.heat .cell.l2{background:#9a9a9a;color:#fff}.heat .cell.l3{background:#2b2b2b;color:#fff}
.heat .cell.nrc{background:repeating-linear-gradient(45deg,#fff 0 4px,#ececec 4px 8px);border:1px dashed #cfcfcf;color:var(--mute)}
.heat .cell.up{border:1px dashed var(--line);color:#bbb}
.heat .hd{text-align:center}
.split{display:flex;height:10px;border-radius:99px;overflow:hidden;gap:2px;margin:12px 0 12px}
.split span{display:block;height:100%}
.li{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:9px 0;border-top:1px solid var(--line)}
.li:first-child,.li.first{border-top:0}
.li .l{display:flex;gap:10px;align-items:flex-start;min-width:0}
.li .src{margin-top:2px}
.li .v{text-align:right;font-weight:600;white-space:nowrap}
table{width:100%;border-collapse:collapse;font-size:13px}
th{font-weight:500;color:var(--mute);text-align:left;font-size:12px;padding:0 8px 8px 0}
td{padding:10px 8px 10px 0;border-top:1px solid var(--line);vertical-align:middle}
tr.rowlink{cursor:pointer}tr.rowlink:hover td{background:#fafafa}
.mono{font-family:"IBM Plex Mono",monospace;font-size:12px}
.mx{display:inline-flex;align-items:center;gap:8px}
.rail{display:flex;flex-direction:column;gap:20px;position:sticky;top:20px}
.rail h2{font-size:13px;font-weight:600;margin:0 0 4px;display:flex;justify-content:space-between;align-items:center}
.count{font-size:11.5px;font-weight:600;border:1px solid var(--line);border-radius:99px;padding:1px 8px;color:var(--ink2)}
.al{border:1px solid var(--line);border-radius:12px;padding:12px 12px 10px 14px;margin-top:10px;cursor:pointer;position:relative;background:#fff;display:grid;grid-template-columns:52px 1fr;gap:14px}
.al:hover{border-color:#cfcfcf}
.al::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:3px;border-radius:0 3px 3px 0}
.al.red::before{background:var(--red)}.al.amber::before{background:var(--amber)}.al.grey::before{background:#cfcfcf}.al.green::before{background:var(--green)}
.al .t{font-weight:600;font-size:13.5px;margin:4px 0 2px}
.al .d{font-size:12.5px;color:var(--ink2);line-height:1.45}
.al .act{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.empty{border:1px dashed var(--line);border-radius:12px;padding:14px;margin-top:10px;color:var(--mute);font-size:12.5px}
.btn{border:1px solid var(--ink);background:var(--ink);color:#fff;border-radius:9px;padding:8px 13px;font-size:13px;font-weight:500;cursor:pointer}
.btn.ghost{background:#fff;color:var(--ink);border-color:var(--line)}
.btn.full{width:100%;padding:12px;font-size:14px}
.scrim{position:fixed;inset:0;background:rgba(17,17,17,.25);opacity:0;pointer-events:none;transition:opacity .2s;z-index:20}
.drawer{position:fixed;top:0;right:0;height:100%;width:min(440px,100%);background:#fff;border-left:1px solid var(--line);transform:translateX(100%);transition:transform .25s ease;z-index:21;display:flex;flex-direction:column}
.show .scrim{opacity:1;pointer-events:auto}.show .drawer{transform:none}
.dh{display:flex;justify-content:space-between;align-items:flex-start;padding:20px 22px 14px;border-bottom:1px solid var(--line);gap:12px}
.dh .l{display:flex;gap:12px;align-items:center;min-width:0}
.dh h3{margin:0;font-size:18px;font-weight:600}
.x{border:1px solid var(--line);background:#fff;border-radius:9px;width:34px;height:34px;cursor:pointer;font-size:18px;line-height:1;flex:none}
.db{padding:16px 22px 32px;overflow:auto}
.db h4{font-size:12px;font-weight:600;color:var(--mute);text-transform:uppercase;letter-spacing:.6px;margin:22px 0 6px}
.tl{list-style:none;margin:0;padding:0}
.tl li{display:grid;grid-template-columns:54px 14px 1fr;gap:8px;padding:6px 0;font-size:13px}
.tl .tm{color:var(--mute);font-family:"IBM Plex Mono",monospace;font-size:12px;padding-top:1px}
.tl .dot{margin-top:5px}
.link{display:inline-block;margin-top:18px;font-weight:500;color:var(--ink);text-decoration:underline;text-underline-offset:3px}
/* forms */
.form{border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:14px;background:#fff}
.form h5{margin:0 0 4px;font-size:14px;font-weight:600}
.fl{font-size:13px;font-weight:500;margin:14px 0 8px}
.req{color:var(--red);font-weight:600}
.opt{color:var(--mute);font-weight:400;font-size:12px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips label{position:relative}
.chips input{position:absolute;opacity:0;inset:0;cursor:pointer}
.chips span{display:inline-block;border:1px solid var(--line);border-radius:99px;padding:8px 13px;font-size:13px;cursor:pointer;background:#fff}
.chips input:checked+span{background:var(--ink);color:#fff;border-color:var(--ink)}
.chips input:focus-visible+span{outline:2px solid var(--ink);outline-offset:2px}
.inp{width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:15px;background:#fff}
.inp:focus{outline:none;border-color:var(--ink)}
textarea.inp{min-height:64px;resize:vertical;font-size:14px}
.err{color:var(--red);font-size:12.5px;margin-top:10px}
.saved{display:flex;gap:8px;align-items:flex-start;background:var(--soft);border-radius:10px;padding:10px 12px;margin-top:12px;font-size:13px}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);background:#111;color:#fff;border-radius:12px;padding:10px 12px 10px 16px;font-size:13.5px;display:flex;gap:14px;align-items:center;opacity:0;pointer-events:none;transition:.2s;z-index:30}
.toast.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}
.toast button{background:none;border:1px solid #444;color:#fff;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:12.5px}
@media (max-width:1240px){.layout{grid-template-columns:1fr}.rail{position:static;order:-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}}
@media (max-width:980px){.app{grid-template-columns:1fr}.side{position:sticky;top:0;height:auto;flex-direction:row;align-items:center;padding:10px 14px;z-index:5;background:#fff;border-right:0;border-bottom:1px solid var(--line);overflow-x:auto}
.brand{padding:0 10px 0 0}.brand small,.side .foot{display:none}.nav{display:flex;gap:2px}.nav a{padding:7px 10px;white-space:nowrap}.nav a span{font-size:13px}
.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.c2,.c3,.c4,.c6{grid-column:span 2}main{padding:20px 16px 40px}}
@media (min-width:640px) and (max-width:980px){.c2.half{grid-column:span 1}}
@media (max-width:520px){.nav a svg{display:none}.big{font-size:27px}.drawer{width:100%;border-left:0}.hidem{display:none}}

.hide{display:none!important}
.layout.solo{grid-template-columns:minmax(0,1fr)}
.sum{cursor:pointer;min-height:230px;display:flex;flex-direction:column}
.sum .ct{font-size:16px;font-weight:600;color:var(--ink)}
.sum .src{margin-top:auto;padding-top:12px}
.eqmini{display:flex;gap:10px;margin-top:12px}
.eq .ic{width:60px;height:60px}.eq .ic svg{width:40px;height:40px}
@media (max-width:980px){.nav{overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}.nav::-webkit-scrollbar{display:none}.sum{min-height:0}}
.hide{display:none!important}
.layout.solo{grid-template-columns:minmax(0,1fr)}
.sum{cursor:pointer;min-height:230px;display:flex;flex-direction:column}
.sum .ct{font-size:16px;font-weight:600;color:var(--ink)}
.sum .src{margin-top:auto;padding-top:12px}
.eqmini{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}
.eq .ic{width:60px;height:60px}.eq .ic svg{width:40px;height:40px}
.boot{padding:40px;color:var(--mute)}
.login{max-width:380px;margin:12vh auto;padding:0 20px}
.login h1{margin:0 0 4px}.login .form{margin-top:22px}
.foot .lo,.mwho .lo{background:none;border:0;padding:0;color:var(--ink2);text-decoration:underline;cursor:pointer;font:inherit}
.mwho{display:none;font-size:12px;color:var(--mute);text-align:right}
.setup{border:1px dashed #cfcfcf;border-radius:14px;padding:22px;background:#fff}
.setup ol{margin:10px 0 16px 18px;padding:0;line-height:1.8}
.btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.btn[disabled]{opacity:.5;cursor:wait}
.owner{max-width:1180px;margin:0 auto;padding:28px 32px 48px}
.otop{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:22px;flex-wrap:wrap}
.obrand{font-weight:700;font-size:18px}.obrand small{font-weight:400;font-size:12px;color:var(--mute);margin-left:8px}
.hero{display:grid;grid-template-columns:minmax(0,1.1fr) repeat(auto-fit,minmax(220px,1fr));gap:16px;align-items:stretch}
.light{display:flex;gap:14px;align-items:flex-start}
.light .bulb{width:18px;height:18px;border-radius:50%;flex:none;margin-top:6px;box-shadow:0 0 0 6px rgba(0,0,0,.04)}
.light h2{margin:0;font-size:22px;font-weight:600;letter-spacing:-.3px;line-height:1.25}
.mtile{border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;gap:12px;align-items:flex-start;background:#fff}
.mtile b{display:block;font-size:15px;font-weight:600}
.ro{font-size:12px;color:var(--mute);border:1px solid var(--line);border-radius:99px;padding:3px 10px}
table.rec{width:100%;border-collapse:collapse;font-size:13px}table.rec th{text-align:left;font-weight:500;color:var(--mute);font-size:12px;padding:8px 6px;border-bottom:1px solid var(--line)}
table.rec td{padding:10px 6px;border-bottom:1px solid var(--line);vertical-align:middle}table.rec tr[data-open]{cursor:pointer}table.rec tr[data-open]:hover td{background:var(--soft)}
@media (max-width:980px){.nav{overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}.nav::-webkit-scrollbar{display:none}.sum{min-height:0}.mwho{display:block}.owner{padding:20px 16px 40px}.hero{grid-template-columns:1fr}}
.dayrow{margin:4px -8px;padding:6px 8px;border-radius:9px;cursor:pointer}.dayrow:hover{background:var(--soft)}.dayrow:focus-visible{outline:2px solid var(--ink)}
@media (max-width:640px){.top .legend{display:none}}
.fsel{min-height:0;margin:0 0 14px;padding:8px 10px;font-size:13px}
@media (max-width:980px){.side .fsel{width:auto;margin:0 8px 0 0;flex:none;max-width:140px}}
.li .lo{background:none;border:0;padding:0;text-decoration:underline;color:var(--mute);cursor:pointer;font:inherit;font-size:12px}
.pvbar{display:flex;justify-content:center;align-items:center;gap:12px;flex-wrap:wrap;background:#111;color:#fff;font-size:13px;padding:8px 14px;position:sticky;top:0;z-index:20}.pvbar .lo{background:none;border:0;padding:0;color:#fff;text-decoration:underline;cursor:pointer;font:inherit}
.btn:disabled{opacity:.45;cursor:not-allowed}
@media (max-width:980px){.side:has(select.fsel){flex-wrap:wrap;row-gap:8px}.side:has(select.fsel) .nav{flex-basis:100%}.side select.fsel{max-width:none;flex:1 1 auto;margin-right:0}}
.lo.pview{text-decoration:none;color:var(--ink);font-size:12px;font-weight:600;margin-top:4px;display:inline-block;white-space:nowrap}.lo.pname{text-decoration:none;color:var(--ink);font-size:inherit;font-weight:600;text-align:left}.lo.pname:hover{text-decoration:underline}

/* status tiles: running green, off grey, fault red */
.ic.t-g{background:#e9f7ef;border-color:#bfe6cf;color:#157a45}
.ic.t-r{background:#fdeeee;border-color:#f2c4c4;color:#b52a2a}
.ic.t-a{background:#fff6e5;border-color:#f0dcae;color:#8a5a00}
.active .ic.t-g,.active .ic.t-r,.active .ic.t-a{color:#fff}
.bst{font-size:22px;font-weight:600}.bst.c-g{color:#157a45}.bst.c-r{color:#b52a2a}
.bsub{color:var(--mute);font-size:13px;margin-top:2px}
.bsteps{display:flex;align-items:flex-start;margin:22px 0 16px}
.bsteps .step{flex:1;text-align:center;position:relative;font-size:12px;min-width:0}
.bsteps .step:not(:last-child)::after{content:"";position:absolute;top:19px;left:calc(50% + 24px);right:calc(-50% + 24px);height:2px;background:var(--line)}
.bsteps .step.done:not(:last-child)::after,.bsteps .step.ok:not(:last-child)::after{background:var(--ink)}
.bsteps .step .ic{margin:0 auto 6px}
.bsteps .step.todo .ic{opacity:.4}.bsteps .step.todo b{color:var(--mute);font-weight:500}
.bsteps .step b{display:block;font-weight:600;font-size:12.5px}
.bsteps .step small{display:block;color:var(--mute);font-family:"IBM Plex Mono",monospace;font-size:11px;margin-top:2px}
.bsteps .step em{position:absolute;top:-6px;left:calc(50% + 10px);font-style:normal;font-size:10.5px;font-weight:600;background:var(--ink);color:#fff;border-radius:99px;padding:1px 6px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}
.tile{border:1px solid var(--line);border-radius:12px;padding:12px 8px;text-align:center}
.tile .ic{margin:0 auto 6px}
.tile b{display:block;font-size:17px;font-weight:600}
.tile small{display:block;color:var(--mute);font-size:11px;margin-top:2px}
.tile.off b{color:#bdbdbd}
details.hist{margin-top:18px}
details.hist summary{cursor:pointer;font-size:12px;font-weight:600;color:var(--mute);text-transform:uppercase;letter-spacing:.6px}
/* 3D digital twin */
.tw3 .tw-v{position:relative;height:440px;border-radius:12px;overflow:hidden;background:#9aa3ab;margin-top:12px}
.tw3 canvas{display:block;touch-action:none}
.tw-lbl{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.tw-tag{position:absolute;left:0;top:0;pointer-events:auto;border:2px solid #fff;color:#fff;background:#9ca3af;border-radius:99px;padding:2px 9px;font:600 11.5px "IBM Plex Sans",sans-serif;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:pointer}
.tw-tag.on{outline:2px solid #111}
.tw-ctl{position:absolute;left:10px;top:10px;display:flex;gap:6px}
.tw-ctl button{border:1px solid var(--line);background:#fff;border-radius:9px;padding:6px 10px;font:500 12.5px "IBM Plex Sans",sans-serif;cursor:pointer;color:var(--ink)}
.tw-info{position:absolute;left:10px;bottom:10px;background:rgba(255,255,255,.96);border:1px solid var(--line);border-radius:12px;padding:10px 12px;max-width:300px;font-size:13px}
.tw-info .k{font-size:11.5px;color:var(--mute)}
.tw-msg{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-weight:500}
.tw-msg[hidden]{display:none}
@media (max-width:640px){.tw3 .tw-v{height:360px}}

```

## `ops/static/index.html`

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light"><meta name="robots" content="noindex">
<title>OmniSite · Operations</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="app.css">
</head>
<body>
<div id="root"><div class="boot">Loading…</div></div>
<div id="dw">
  <div class="scrim" id="scrim"></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="dTitle">
    <div class="dh">
      <div class="l"><span id="dIcon"></span><div><div class="muted" id="dKicker" style="font-size:12px"></div><h3 id="dTitle"></h3></div></div>
      <button class="x" id="dClose" aria-label="Close">×</button>
    </div>
    <div class="db" id="dBody"></div>
  </aside>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"><span id="toastMsg"></span></div>
<script src="twin3d.js"></script>
<script src="app.js"></script>
</body>
</html>

```

