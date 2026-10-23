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

        self.post("/api/equipment", {"name": "Mixer 1", "kind": "mixer"})
        self.post("/api/equipment", {"name": "mixer 1", "kind": "mixer"}, code=409)
        self.post("/api/equipment", {"name": "Holding tank", "kind": "tank"})
        self.post("/api/settings", {"target_batches": "abc"}, code=400)
        self.post("/api/settings", {"target_batches": "5", "price_kg": "5"})
        mixer = self.state()["equipment"][0]["id"]

        code = self.post("/api/batches", {"equipment_id": mixer})["code"]
        self.assertRegex(code, r"^MX1-\d{8}-01$")
        self.post("/api/batches", {"equipment_id": mixer}, code=409)  # one batch per mixer
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

        self.post(f"/api/equipment/{mixer}/status", {"status": "stopped"})
        stop = self.state()["stops"][0]
        self.assertIsNone(stop["ended_at"])
        self.post(f"/api/stops/{stop['id']}", {"reason": "Other"}, code=400)
        self.post(f"/api/stops/{stop['id']}", {"reason": "Drive fault", "note": "called maintenance"})
        self.post(f"/api/stops/{stop['id']}", {"reason": "Drive fault"}, self.o, 403)
        self.post("/api/batches", {"equipment_id": mixer}, code=409)  # can't start a batch on a stopped mixer
        self.post(f"/api/equipment/{mixer}/status", {"status": "running"}, code=409)  # running needs a batch
        self.post(f"/api/equipment/{mixer}/status", {"status": "idle"})
        stop = self.state()["stops"][0]
        self.assertEqual((stop["reason"], bool(stop["ended_at"])), ("Drive fault", True))
        self.post("/api/stops", {"equipment_id": mixer, "start": "00:00", "end": "00:00", "reason": "Cleaning"}, code=400)
        y = (app.uae_now().date() - app.dt.timedelta(days=1)).isoformat()
        self.post("/api/stops", {"equipment_id": mixer, "day": y, "start": "09:00", "end": "09:40", "reason": "Cleaning"})
        self.post("/api/stops", {"equipment_id": mixer, "day": y, "start": "23:50", "end": "00:20", "reason": "Cleaning"})  # overnight
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
        call("POST", B + "/equipment", {"name": "Mixer 1", "kind": "mixer"}, self.mb)
        self.assertEqual([e["name"] for e in call("GET", B + "/state", None, self.o)[1]["equipment"]], ["Mixer 1"])
        me = call("GET", "/api/me", None, self.o)[1]["user"]
        self.assertEqual(sorted(f["role"] for f in me["factories"]), ["owner", "owner"])  # one owner, two factories
        self.assertEqual(call("GET", "/api/admin", None, self.m)[0], 403)
        self.assertEqual(call("POST", "/api/admin/factories", {"name": "factory a"}, self.a)[0], 409)
        self.assertEqual(call("POST", "/api/admin/people", {"factory_id": self.fa, "email": "new@x.ae", "role": "manager", "name": "N", "password": "short"}, self.a)[0], 400)
        uid = [p for p in call("GET", "/api/admin", None, self.a)[1]["people"] if p["email"] == "mb@x.ae"][0]["user_id"]
        call("POST", "/api/admin/people/remove", {"factory_id": self.fb, "user_id": uid}, self.a)
        self.assertEqual(call("GET", B + "/state", None, self.mb)[0], 404)  # removed person loses access


if __name__ == "__main__":
    unittest.main()
