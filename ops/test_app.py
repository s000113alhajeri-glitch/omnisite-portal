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
            for email, role in (("m@x.ae", "manager"), ("o@x.ae", "owner")):
                c.execute("INSERT INTO users(email,name,role,pw,created_at) VALUES(?,?,?,?,?)", (email, role, role, app.hash_pw("correct horse 1"), app.now()))
        cls.m, cls.o = login("m@x.ae"), login("o@x.ae")

    def post(self, path, body, who=None, code=200):
        s, d, _ = call("POST", path, body, who or self.m)
        self.assertEqual(s, code, d)
        return d

    def state(self, who=None):
        return call("GET", "/api/state", None, who or self.m)[1]

    def test_journey(self):
        self.assertEqual(call("GET", "/api/state")[0], 401)
        self.assertEqual(call("POST", "/api/login", {"email": "m@x.ae", "password": "wrong"})[0], 401)
        st = self.state()
        self.assertEqual((st["equipment"], st["batches"], st["stops"], st["settings"]), ([], [], [], {}))  # starts empty
        self.assertIn("View only", self.post("/api/equipment", {"name": "Mixer 1", "kind": "mixer"}, self.o, 403)["error"])

        self.post("/api/equipment", {"name": "Mixer 1", "kind": "mixer"})
        self.post("/api/equipment", {"name": "mixer 1", "kind": "mixer"}, code=409)
        self.post("/api/equipment", {"name": "Holding tank", "kind": "tank"})
        self.post("/api/settings", {"target_batches": "abc"}, code=400)
        self.post("/api/settings", {"target_batches": "5", "price_kg": "5", "factory_name": "Test factory"})
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
        self.post(f"/api/equipment/{mixer}/status", {"status": "running"}, code=409)  # running needs a batch
        self.post(f"/api/equipment/{mixer}/status", {"status": "idle"})
        stop = self.state()["stops"][0]
        self.assertEqual((stop["reason"], bool(stop["ended_at"])), ("Drive fault", True))
        self.post("/api/stops", {"equipment_id": mixer, "start": "00:00", "end": "00:00", "reason": "Cleaning"}, code=400)
        y = (app.uae_now().date() - app.dt.timedelta(days=1)).isoformat()
        self.post("/api/stops", {"equipment_id": mixer, "day": y, "start": "09:00", "end": "09:40", "reason": "Cleaning"})
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


if __name__ == "__main__":
    unittest.main()
