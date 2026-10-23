"""Run: python3 test_app.py  (uses a temporary data folder, never the real one)."""
import io
import json
import os
import tempfile
import unittest

os.environ["OMNI_OPS_DATA"] = tempfile.mkdtemp()
import app  # noqa: E402


def call(method, path, body=None, cookie=""):
    raw = json.dumps(body).encode() if body is not None else b""
    env = {"REQUEST_METHOD": method, "PATH_INFO": path, "CONTENT_LENGTH": str(len(raw)), "wsgi.input": io.BytesIO(raw),
           "HTTP_COOKIE": cookie, "wsgi.url_scheme": "http"}
    out = {}
    def start(status, headers):
        out["status"], out["headers"] = int(status.split()[0]), dict(headers)
    data = json.loads(b"".join(app.application(env, start)))
    return out["status"], data, out["headers"]


def login(email):
    s, d, hd = call("POST", "/api/login", {"email": email, "password": "correct horse 1"})
    assert s == 200, d
    return hd["Set-Cookie"].split(";")[0]


class Journey(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with app.db() as c:
            c.execute("INSERT INTO users(email,name,is_admin,pw,created_at) VALUES(?,?,1,?,?)", ("a@omni.ae", "Admin", app.hash_pw("correct horse 1"), app.now()))
        cls.a = login("a@omni.ae")
        mk = lambda n: call("POST", "/api/admin/factories", {"name": n}, cls.a)[1]["id"]
        cls.fa, cls.fb = mk("Factory A"), mk("Factory B")
        add = lambda fid, email, role, name="X", pw="correct horse 1": call("POST", "/api/admin/people", {"factory_id": fid, "email": email, "role": role, "name": name, "password": pw}, cls.a)
        add(cls.fa, "m@x.ae", "manager"); add(cls.fa, "m2@x.ae", "manager"); add(cls.fa, "o@x.ae", "owner")
        assert add(cls.fb, "o@x.ae", "owner", pw="")[1]["existing"]  # same owner, 2nd factory, keeps password
        add(cls.fb, "mb@x.ae", "manager")
        cls.m, cls.o, cls.mb = login("m@x.ae"), login("o@x.ae"), login("mb@x.ae")
        cls.F = f"/api/f/{cls.fa}"

    def post(self, path, body, who=None, code=200):
        s, d, _ = call("POST", self.F + path[4:], body, who or self.m)
        self.assertEqual(s, code, d)
        return d

    def state(self, who=None):
        return call("GET", self.F + "/state", None, who or self.m)[1]

    def test_journey(self):
        self.assertEqual(call("GET", self.F + "/state")[0], 401)
        self.assertEqual(call("POST", "/api/login", {"email": "m@x.ae", "password": "wrong"})[0], 401)
        st = self.state()
        self.assertEqual((st["equipment"], st["batches"], st["stops"], st["settings"]), ([], [], [], {}))  # starts empty
        self.assertIn("View only", self.post("/api/equipment", {"name": "Mixer 1", "kind": "mixer"}, self.o, 403)["error"])
        self.assertIn("OmniSite", self.post("/api/equipment", {"name": "Mixer 1", "kind": "mixer"}, self.m, 403)["error"])  # pilot equipment is set by OmniSite

        self.post("/api/equipment", {"name": "Mixer 1", "kind": "mixer"}, self.a)
        self.post("/api/equipment", {"name": "mixer 1", "kind": "mixer"}, self.a, code=409)
        self.post("/api/equipment", {"name": "Holding tank", "kind": "tank"}, self.a)
        self.post("/api/settings", {"target_batches": "abc"}, code=400)
        self.post("/api/settings", {"target_batches": "5", "price_kg": "5"})
        mixer = self.state()["equipment"][0]["id"]

        code = self.post("/api/batches", {"equipment_id": mixer}, self.a)["code"]
        self.assertRegex(code, r"^MX1-\d{8}-01$")
        self.post("/api/batches", {"equipment_id": mixer}, self.a, code=409)  # one batch per mixer
        b = self.state()["batches"][0]["id"]
        self.post(f"/api/batches/{b}/move", {}, code=409)  # can't move before QC
        self.post(f"/api/batches/{b}/qc", {"ph": 15, "visc": 2400, "result": "pass"}, code=400)
        self.post(f"/api/batches/{b}/qc", {"ph": 7, "visc": 2400, "result": "remix"}, code=400)  # cause needed
        self.post(f"/api/batches/{b}/qc", {"ph": 7, "visc": 3100, "result": "remix", "cause_what": "Viscosity", "cause_dir": "Too high"})
        self.post(f"/api/batches/{b}/qc", {"ph": 7.1, "visc": 2450, "result": "pass"})
        self.post(f"/api/batches/{b}/qc", {"ph": 7.1, "visc": 2450, "result": "pass"}, code=409)
        self.post(f"/api/batches/{b}/move", {})
        self.post(f"/api/batches/{b}/move", {}, code=409)  # no double move
        bb = self.state()["batches"][0]
        self.assertEqual((bb["status"], bb["qc_count"]), ("moved", 2))

        self.post(f"/api/equipment/{mixer}/status", {"status": "stopped"}, self.a)
        stop = self.state()["stops"][0]
        self.assertIsNone(stop["ended_at"])
        self.post(f"/api/stops/{stop['id']}", {"reason": "Other"}, code=400)
        self.post(f"/api/stops/{stop['id']}", {"reason": "Drive fault", "note": "called maintenance"})
        self.post(f"/api/stops/{stop['id']}", {"reason": "Drive fault"}, self.o, 403)
        self.post("/api/batches", {"equipment_id": mixer}, self.a, code=409)  # can't start a batch on a stopped mixer
        self.post(f"/api/equipment/{mixer}/status", {"status": "running"}, self.a, code=409)  # running needs a batch
        self.post(f"/api/equipment/{mixer}/status", {"status": "idle"}, self.a)
        stop = self.state()["stops"][0]
        self.assertEqual((stop["reason"], bool(stop["ended_at"])), ("Drive fault", True))
        self.post("/api/stops", {"equipment_id": mixer, "start": "00:00", "end": "00:00", "reason": "Cleaning"}, code=400)
        y = (app.uae_now().date() - app.dt.timedelta(days=1)).isoformat()
        self.post("/api/stops", {"equipment_id": mixer, "day": y, "start": "09:00", "end": "09:40", "reason": "Cleaning"})
        self.post("/api/stops", {"equipment_id": mixer, "day": y, "start": "23:50", "end": "00:20", "reason": "Cleaning"})  # overnight
        self.post("/api/stops", {"equipment_id": mixer, "day": y, "start": "10:00", "end": "10:00", "reason": "Cleaning"}, code=400)
        night = [s for s in self.state()["stops"] if s["day"] == y and s["reason"] == "Cleaning" and s["started_at"] > s["ended_at"][:10]]
        self.assertTrue(any(app.dt.datetime.fromisoformat(s["ended_at"]) - app.dt.datetime.fromisoformat(s["started_at"]) == app.dt.timedelta(minutes=30) for s in night))
        self.post("/api/stops", {"equipment_id": mixer, "day": "2020-01-01", "start": "09:00", "end": "09:40", "reason": "Cleaning"}, code=400)
        self.assertIn(y, [s["day"] for s in self.state()["stops"]])

        self.post("/api/losses", {"kg": 0, "type": "Spillage"}, code=400)
        self.post("/api/losses", {"kg": 4, "type": "Spillage", "request_id": "r1"})
        self.post("/api/losses", {"kg": 4, "type": "Spillage", "request_id": "r1"})  # retry: no duplicate
        self.assertEqual(len(self.state()["losses"]), 1)
        self.post("/api/labour", {"hours": 24})
        self.post("/api/labour", {"hours": 30})
        self.assertEqual([l["hours"] for l in self.state()["labour"]], [30])
        self.post("/api/labour", {"people": 3, "hours_each": 8})
        self.assertEqual([(l["people"], l["hours_each"], l["hours"]) for l in self.state()["labour"]], [(3, 8, 24)])
        self.post("/api/labour", {"people": 2.5, "hours_each": 8}, code=400)
        self.post("/api/labour", {"people": 3}, code=400)
        self.post("/api/labour", {"people": 3, "hours_each": 8}, self.o, 403)
        bid = self.state()["batches"][0]["id"]
        self.post(f"/api/batches/{bid}/kg", {"kg": 0}, code=400)
        self.post(f"/api/batches/{bid}/kg", {"kg": 950})
        self.post(f"/api/batches/{bid}/kg", {"kg": 980})  # corrected, not duplicated
        self.assertEqual(self.state()["batches"][0]["kg_used"], 980)
        self.post(f"/api/batches/{bid}/kg", {"kg": 900}, self.o, 403)
        self.assertEqual(self.state(self.o)["batches"][0]["code"], code)  # owner sees the same records
        self.assertEqual(self.state(self.a)["batches"][0]["code"], code)  # OmniSite team sees every factory
        with app.db() as c:  # a batch started 20 days ago but finished today still counts
            old = (app.dt.datetime.now(app.dt.timezone.utc) - app.dt.timedelta(days=20)).isoformat(timespec="seconds")
            c.execute("INSERT INTO batches(factory_id,code,equipment_id,started_at,status,qc_count,finished_at,moved_at) VALUES(?,?,?,?,?,?,?,?)",
                      (self.fa, "MX1-OLD-01", mixer, old, "moved", 1, app.now(), app.now()))
        self.assertIn("MX1-OLD-01", [b["code"] for b in self.state()["batches"]])
        self.post("/api/labour", {"hours": 8}, self.a)  # and can enter for support

    def test_isolation_and_admin(self):
        B = f"/api/f/{self.fb}"
        self.assertEqual(call("GET", B + "/state", None, self.m)[0], 404)  # manager A can't see factory B
        self.assertEqual(call("POST", B + "/equipment", {"name": "M", "kind": "mixer"}, self.m)[0], 404)
        self.assertEqual(call("POST", B + "/equipment", {"name": "Mixer 1", "kind": "mixer"}, self.mb)[0], 403)
        call("POST", B + "/equipment", {"name": "Mixer 1", "kind": "mixer"}, self.a)
        self.assertEqual([e["name"] for e in call("GET", B + "/state", None, self.o)[1]["equipment"]], ["Mixer 1"])
        me = call("GET", "/api/me", None, self.o)[1]["user"]
        self.assertEqual(sorted(f["role"] for f in me["factories"]), ["owner", "owner"])  # one owner, two factories
        self.assertEqual(call("GET", "/api/admin", None, self.m)[0], 403)
        self.assertEqual(call("POST", "/api/admin/factories", {"name": "factory a"}, self.a)[0], 409)
        self.assertEqual(call("POST", "/api/admin/people", {"factory_id": self.fa, "email": "new@x.ae", "role": "manager", "name": "N", "password": "short"}, self.a)[0], 400)
        uid = [p for p in call("GET", "/api/admin", None, self.a)[1]["people"] if p["email"] == "mb@x.ae"][0]["user_id"]
        call("POST", "/api/admin/people/remove", {"factory_id": self.fb, "user_id": uid}, self.a)
        self.assertEqual(call("GET", B + "/state", None, self.mb)[0], 404)  # removed person loses access


def ingest(key, body):
    raw = json.dumps(body).encode()
    env = {"REQUEST_METHOD": "POST", "PATH_INFO": "/api/ingest", "CONTENT_LENGTH": str(len(raw)), "wsgi.input": io.BytesIO(raw),
           "HTTP_X_GATEWAY_KEY": key, "wsgi.url_scheme": "http"}
    out = {}
    def start(status, headers):
        out["status"] = int(status.split()[0])
    data = json.loads(b"".join(app.application(env, start)))
    return out["status"], data


class Gateway(unittest.TestCase):
    def test_bad_input_and_isolation(self):
        with app.db() as c:
            c.execute("INSERT OR IGNORE INTO users(email,name,is_admin,pw,created_at) VALUES(?,?,1,?,?)", ("g2@omni.ae", "Admin G2", app.hash_pw("correct horse 1"), app.now()))
        a = login("g2@omni.ae")
        keys, eids = [], []
        for name in ("Iso A", "Iso B"):
            fid = call("POST", "/api/admin/factories", {"name": name}, a)[1]["id"]
            call("POST", f"/api/f/{fid}/equipment", {"name": "Mixer 1", "kind": "mixer"}, a)
            eid = call("GET", f"/api/f/{fid}/state", None, a)[1]["equipment"][0]["id"]
            keys.append(call("POST", f"/api/f/{fid}/gateways", {"name": "GW"}, a)[1]["key"])
            call("POST", f"/api/f/{fid}/signals", {"equipment_id": eid, "metric": "temp_c", "tag": "t_" + name[-1].lower()}, a)
            eids.append((fid, eid))
        # factory A's key cannot write factory B's tag
        self.assertEqual(ingest(keys[0], {"t_b": 30})[1]["unknown_tags"], ["t_b"])
        self.assertEqual(call("GET", f"/api/f/{eids[1][0]}/state", None, a)[1]["signals"][0]["last_value"], None)
        # signal on another factory's equipment is refused
        self.assertNotEqual(call("POST", f"/api/f/{eids[0][0]}/signals", {"equipment_id": eids[1][1], "metric": "temp_c", "tag": "x"}, a)[0], 200)
        # bad values and malformed bodies
        d = ingest(keys[0], {"readings": [{"tag": "t_a", "value": "n/a"}, {"tag": "t_a", "value": 1e300 * 10}, {"tag": "t_a", "value": 1e20}, {"tag": "t_a", "at": "not a date", "value": 5}]})[1]
        self.assertEqual((d["saved"], d["refused"]), (0, 4))
        raw = b"{not json"
        env = {"REQUEST_METHOD": "POST", "PATH_INFO": "/api/ingest", "CONTENT_LENGTH": str(len(raw)), "wsgi.input": io.BytesIO(raw), "HTTP_X_GATEWAY_KEY": keys[0], "wsgi.url_scheme": "http"}
        out = {}
        app.application(env, lambda st, h: out.setdefault("s", int(st.split()[0])))
        self.assertEqual(out["s"], 400)
        self.assertEqual(ingest(keys[0], "text")[0], 400)

    def test_gateway_journey(self):
        with app.db() as c:
            c.execute("INSERT OR IGNORE INTO users(email,name,is_admin,pw,created_at) VALUES(?,?,1,?,?)", ("g@omni.ae", "Admin G", app.hash_pw("correct horse 1"), app.now()))
        a = login("g@omni.ae")
        fid = call("POST", "/api/admin/factories", {"name": "Sensor F"}, a)[1]["id"]
        call("POST", "/api/admin/people", {"factory_id": fid, "email": "sm@x.ae", "role": "manager", "name": "S", "password": "correct horse 1"}, a)
        m = login("sm@x.ae")
        F = f"/api/f/{fid}"
        P = lambda path, body, who=a, code=200: self.assertEqual(call("POST", F + path, body, who)[0], code) or call("GET", F + "/state", None, who)[1]
        P("/equipment", {"name": "Mixer 1", "kind": "mixer"}, m, 403)
        P("/equipment", {"name": "Mixer 1", "kind": "mixer"})
        eid = call("GET", F + "/state", None, m)[1]["equipment"][0]["id"]
        self.assertEqual(call("GET", F + "/connections", None, m)[0], 403)  # OmniSite team only
        self.assertEqual(call("POST", F + "/gateways", {"name": "GW"}, m)[0], 403)
        key = call("POST", F + "/gateways", {"name": "GW"}, a)[1]["key"]
        for metric, tag, mult in (("speed_hz", "m1_hz", 0.01), ("trip", "m1_trip", 1), ("weigh_kg", "scale_kg", 1), ("temp_c", "m1_temp", 1), ("energy_kwh", "m1_wh", 0.001)):
            P("/signals", {"equipment_id": eid, "metric": metric, "tag": tag, "mult": mult})
        P("/signals", {"equipment_id": eid, "metric": "trip", "tag": "other"}, code=409)
        sig = lambda: {s["metric"]: s for s in call("GET", F + "/state", None, m)[1]["signals"]}
        self.assertEqual(ingest("wrong", {"m1_hz": 5000})[0], 401)
        # no batch: drive stopped is idle, not a stop
        s, d = ingest(key, {"m1_hz": 0, "nope": 1})
        self.assertEqual((s, d["saved"], d["unknown_tags"]), (200, 1, ["nope"]))
        st = call("GET", F + "/state", None, m)[1]
        self.assertEqual((st["stops"], st["equipment"][0]["status"], st["equipment"][0]["status_src"]), ([], "idle", "sensor"))
        P("/batches", {"equipment_id": eid}, m, 403)
        P(f"/equipment/{eid}/status", {"status": "stopped"}, m, 403)
        P("/batches", {"equipment_id": eid})
        t0 = int(app.dt.datetime.now(app.dt.timezone.utc).timestamp()) + 1
        s, d = ingest(key, {"readings": [{"tag": "m1_hz", "value": 5000, "at": t0}, {"tag": "scale_kg", "value": 400, "at": t0 + 1},
                                         {"tag": "m1_temp", "value": 41.5, "at": t0 + 2}, {"tag": "m1_wh", "value": 1000, "at": t0 + 3}]})
        self.assertEqual(d["saved"], 4)
        self.assertEqual(ingest(key, {"readings": [{"tag": "scale_kg", "value": 400, "at": t0 + 1}]})[1]["saved"], 0)  # retry = no duplicate
        self.assertEqual(sig()["speed_hz"]["last_value"], 50)
        # Teltonika-style nested segment
        ingest(key, {"input1": [{"name": "scale_kg", "data": "[150]", "date": t0 + 5}, {"name": "m1_wh", "data": [3500], "date": t0 + 6}]})
        ingest(key, {"readings": [{"tag": "m1_trip", "value": 1, "at": t0 + 7}, {"tag": "m1_hz", "value": 0, "at": t0 + 8}]})
        st = call("GET", F + "/state", None, m)[1]
        stop = st["stops"][0]
        self.assertEqual((stop["source"], stop["reason"], stop["note"], stop["ended_at"]), ("sensor", "Drive fault", "Trip code 1", None))
        self.assertEqual(stop["reason_src"], "sensor")  # automatic reason is labelled Sensor
        st2 = P(f"/stops/{stop['id']}", {"reason": "Drive fault", "note": "belt slipped"}, m)
        self.assertEqual([x["reason_src"] for x in st2["stops"] if x["id"] == stop["id"]], ["manual"])  # until the manager edits it
        b = st["batches"][0]["s"]
        self.assertEqual((b["kg"], b["weighings"], round(b["kwh"], 3), b["temp"]["last"]), (550, 2, 2.5, 41.5))
        ingest(key, {"readings": [{"tag": "m1_hz", "value": 4800, "at": t0 + 200}]})
        st = call("GET", F + "/state", None, m)[1]
        self.assertTrue(st["stops"][0]["ended_at"]); self.assertEqual(st["equipment"][0]["status"], "running")
        self.assertEqual(ingest(key, {"readings": [{"tag": "m1_hz", "value": 1, "at": t0 + 99999}]})[1]["refused"], 1)  # future time
        self.assertTrue(st["gateways"][0]["last_seen"])
        cn = call("GET", F + "/connections", None, a)[1]
        self.assertNotIn("key_hash", cn["gateways"][0]); self.assertTrue(cn["readings"])
        gid = cn["gateways"][0]["id"]
        P(f"/gateways/{gid}/remove", {})
        self.assertEqual(ingest(key, {"m1_hz": 1})[0], 401)  # removed key stops working


if __name__ == "__main__":
    unittest.main()
