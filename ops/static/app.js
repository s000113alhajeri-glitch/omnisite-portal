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
 other:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'
};
const stCls = {g: "g", a: "a", r: "r", n: "n"};
function ic(name, st, opt = {}) { return `<span class="ic ${opt.size || ""} ${opt.spin ? "spin" : ""}" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[name] || ICONS.other}</svg>${st ? `<span class="bd ${stCls[st]}"></span>` : ""}</span>`; }

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
const finishedDay = b => b.status === "moved" ? dayOf(b.moved_at) : (b.status === "passed" || b.status === "rejected") && b.finished_at ? dayOf(b.finished_at) : null;
function eqState(e) {
  if (openStop(e.id)) return {st: "r", label: "Stopped", spin: false};
  const b = activeBatch(e.id);
  if (e.kind === "mixer" && b) return b.status === "passed" ? {st: "a", label: "Waiting to move", spin: false} : {st: "g", label: b.status === "remix" ? "Running · re-mixing" : "Running", spin: true};
  if (e.status === "running") return {st: "g", label: "Running", spin: e.kind === "mixer"};
  if (e.status === "idle") return {st: "n", label: "Idle", spin: false};
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
  const timed = S.d.batches.filter(b => b.finished_at && b.status !== "rejected");
  const batchStopMin = stops.filter(s => eq(s.equipment_id).kind === "mixer").reduce((a, s) => a + batchMins(s, ws), 0);
  const avgMin = timed.length ? timed.reduce((a, b) => a + minsBetween(b.started_at, b.finished_at), 0) / timed.length : null;
  return {days, daily, fin, n, stops, stopMin, mixerStopMin, reasons, causes, perDay, losses, lossKg, lab, labH, withKg, kgUsed, avgMin,
    lost: avgMin && timed.length >= 5 ? batchStopMin / avgMin : null, batchStopMin, timedN: timed.length, rec: days.some(hasDay),
    remixes: S.d.qc.filter(q => q.result === "remix" && set.has(dayOf(q.at))).length};
}
function money(w) {
  const p = setn("price_kg"), sc = setn("stop_cost_h"), lr = setn("labour_rate");
  return {mat: p !== null ? w.lossKg * p : null, down: sc !== null ? w.mixerStopMin / 60 * sc : null, lab: lr !== null ? w.labH * lr : null};
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
  S.d.batches.filter(b => finishedDay(b) === S.d.today && kgOf(b) == null).forEach(b => out.push({c: "grey", open: `batch:${b.id}`, icon: ic("scale", "n"), code: h(b.code), tag: stLine("n", "Missing info"), d: "Enter the kg of material used for this batch.", src: "", btn: "Enter kg used", ghost: true}));
  if (S.d.equipment.length && !S.d.labour.find(l => l.day === S.d.today)) out.push({c: "grey", open: "labour", icon: ic("person", "n"), code: "Labour today", tag: stLine("n", "Missing info"), d: "Enter how many people worked today and their hours.", src: "", btn: "Enter labour", ghost: true});
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
    const nOpen = S.admin ? S.admin.support.filter(r => r.status === "open").length : 0;
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
  return pick + gws + sigs + eng + rd;
}
function vSupport() {
  const A = S.admin; if (!A) return `<section class="card c6"><div class="muted">Loading…</div></section>`;
  const fac = A.health.map(f => { const g = f.gateways, q = g.filter(quiet), last = g.map(x => x.last_seen).filter(Boolean).sort().pop();
    const st = !g.length ? stLine("n", "No gateway yet") : q.length ? stLine("a", q.length === g.length ? "Not sending data" : `${q.length} of ${g.length} gateways not sending data`) : stLine("g", "Online");
    const sub = [last ? `last data ${when(last)}` : "", `${f.signals.length} sensor signal${f.signals.length === 1 ? "" : "s"}`, ...f.faults.map(x => `Drive trip on ${h(x.equipment)} · code ${fmt(x.code, 0)}`)].filter(Boolean).join(" · ");
    return [`<b style="font-weight:600">${h(f.factory.name)}</b>`, st, sub, ic("gateway", null, {size: "sm"})]; });
  const req = r => [`<b style="font-weight:600">${h(r.factory)}</b>${r.who ? ` · ${h(r.who)}` : ""}<div style="margin-top:4px;white-space:pre-wrap">${h(r.text)}</div>`, r.status === "open" ? `<button class="btn ghost" type="button" data-act="rs:${r.id}">Mark resolved</button>` : `<span class="muted">Resolved ${when(r.resolved_at)}</span>`, `Sent ${when(r.at)}`, ic("person", null, {size: "sm"})];
  const open = A.support.filter(r => r.status === "open"), done = A.support.filter(r => r.status !== "open").slice(0, 20);
  return `<section class="card c6"><div class="ch"><span class="ct">${ic("person")}Support requests · ${open.length} open</span></div><div class="why">Sent by a factory's site manager or owner with "Request support".</div>${open.length ? rows(open.map(req)) : empty("No open requests.")}${done.length ? `<h4>Resolved</h4>${rows(done.map(req))}` : ""}</section>
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
  return `<section class="card c3 sum" data-go="batches" tabindex="0" role="link"><div class="ch"><span class="ct">${ic("mixer", null, {size: "lg"})}Batches</span>${go}</div>
     <div class="big">${t.done || hasDay(S.d.today) ? t.done : NRs} <small>${t.target !== null ? `of ${t.target} batches today` : "batches finished today"}</small></div>
     <div style="margin-top:10px">${t.target === null ? stLine("n", "Daily target not set") : t.done >= t.target ? stLine("g", "Target reached") : stLine("n", `${t.target - t.done} to go`)}</div>
     <div class="why" style="margin-top:6px">${act.length ? `Now: ${act.map(b => `${h(b.code)} ${{mixing: "mixing", remix: "re-mixing", passed: "waiting to move"}[b.status]}`).join(" · ")}` : "No batch in progress"}${ft !== null ? ` · ${ft}% passed first time this week` : ""}</div>
     <div class="src" style="margin-top:auto;padding-top:12px"><i>✎</i>Manual · ${lastAt(S.d.batches, "moved_at") || "no batch moved yet"}</div></section>
   <section class="card c3 sum" data-go="downtime" tabindex="0" role="link"><div class="ch"><span class="ct">${ic("motor", null, {size: "lg"})}Downtime</span>${go}</div>
     <div class="big">${w.stops.length ? mins(w.stopMin) : w.rec ? "0 min" : NRs} <small>stopped this week</small></div>
     <div style="margin-top:10px">${stopped.length ? stLine("r", `${stopped.map(e => h(e.name)).join(", ")} stopped now`) : stLine("g", "Nothing stopped now")}</div>
     <div class="why" style="margin-top:6px">${top ? `Top reason: ${h(top[0])}` : w.stops.length ? "Reasons not entered yet" : "No stops recorded this week"}${w.lost ? ` · ≈ ${fmt(w.lost, 1)} batches not made (estimate)` : ""}</div>
     <div class="src" style="margin-top:auto;padding-top:12px">${stopsSrc(lastAt(S.d.stops, "updated_at") || "no stops entered")}</div></section>
   <section class="card c3 sum" data-go="costs" tabindex="0" role="link"><div class="ch"><span class="ct">${ic("coins", null, {size: "lg"})}Costs</span>${go}</div>
     <div class="big">${m.mat !== null && w.losses.length ? `AED ${fmt(m.mat)}` : w.losses.length ? `${fmt(w.lossKg, 1)} kg` : NRs} <small>material lost this week</small></div>
     <div style="margin-top:10px">${m.mat === null ? stLine("a", "Material price not set") : stLine("g", "Price set")}</div>
     <div class="why" style="margin-top:6px">Material used: ${w.withKg.length ? `${fmt(w.kgUsed)} kg` : "not recorded"} · Labour: ${w.labH ? `${fmt(w.labH, 1)} staff-hours${m.lab !== null ? ` · AED ${fmt(m.lab)}` : ""}` : "not recorded"}</div>
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
   <div class="timer" data-since="${b.started_at}">${clock(nowMs() - new Date(b.started_at))}</div>
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
    ${recent.length ? `<table class="rec"><thead><tr><th>Batch</th><th>Mixer</th><th>Result</th><th class="hidem">Time to finish</th><th class="hidem">Material used</th><th>Finished</th></tr></thead><tbody>${recent.map(b => `<tr data-open="batch:${b.id}" tabindex="0"><td class="mono">${h(b.code)}</td><td>${h(eq(b.equipment_id).name)}</td><td>${b.status === "rejected" ? stLine("r", "Rejected") : b.qc_count > 1 ? stLine("a", `Re-mixed ×${b.qc_count - 1}`) : stLine("g", "Passed first time")}</td><td class="hidem">${b.finished_at ? mins(minsBetween(b.started_at, b.finished_at)) : "—"}</td><td class="hidem">${b.kg_used != null ? `${fmt(b.kg_used, 1)} kg` : `<span class="nr">Not recorded</span>`}</td><td>${b.moved_at ? when(b.moved_at) : b.finished_at ? when(b.finished_at) : "—"}</td></tr>`).join("")}</tbody></table>` : empty("No finished batches yet.")}
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
  return `<section class="card c3" data-open="loss" tabindex="0" role="button"><div class="ch"><span class="ct">${ic("scale")}Material loss</span><span class="open">Add / open ›</span></div>
    <div class="big">${S.d.losses.some(l => l.day === t) ? fmt(lossToday, 1) : NRs} <small>kg today</small></div><div class="src"><i>✎</i>Manual · ${lastAt(S.d.losses.filter(l => l.day === t), "at") || "nothing entered today"}</div><div class="sep"></div>
    <div class="row"><span class="mid">${p !== null ? `AED ${fmt(lossToday * p)}` : `<span class="nr">Not recorded</span>`}</span><span class="muted" style="font-size:12px">${p !== null ? `AED ${fmt(p, 2)} / kg` : "material price not set"}</span></div>
    ${p !== null ? `<div class="src"><i>≈</i>Estimate · weight × your price</div>` : ""}</section>
   <section class="card c3" data-open="labour" tabindex="0" role="button"><div class="ch"><span class="ct">${ic("person")}Labour · this week</span><span class="open">Add / open ›</span></div>
    <div class="big">${w.labH ? fmt(w.labH, 1) : "—"} <small>staff-hours</small></div><div class="src"><i>✎</i>Manual · ${lastAt(w.lab, "updated_at") || "not entered"}</div><div class="sep"></div>
    <div class="row"><span class="mid">${aed(m.lab, "Labour cost per hour not set")}</span></div><div class="why" style="margin-top:6px">Today: ${peopleLine(S.d.labour.find(l => l.day === S.d.today)) || "not entered"}</div></section>
   <section class="card c6"><div class="ch"><span class="ct">${ic("scale")}Material used · this week</span><span class="muted" style="font-size:12px">${w.fin.length ? `${w.withKg.length} of ${w.fin.length} finished batch${w.fin.length === 1 ? "" : "es"} weighed` : "no finished batches yet"}</span></div>
    ${rows([["Total used", w.withKg.length ? `${fmt(w.kgUsed, 1)} kg` : NR("Enter it in each batch"), w.withKg.length ? (w.withKg.every(b => b.kg_used == null) ? sensor("from the scale") : w.withKg.some(b => b.kg_used == null) ? manual(lastAt(w.withKg.filter(b => b.kg_used != null), "kg_at")) + sensor("and the scale") : manual(lastAt(w.withKg, "kg_at"))) : ""],
      ["Average per batch", w.withKg.length ? `${fmt(w.kgUsed / w.withKg.length, 1)} kg` : NR(""), ""],
      ["Material cost per batch", w.withKg.length && p !== null ? `AED ${fmt(w.kgUsed / w.withKg.length * p)}` : NR(p === null ? "Set the material price" : ""), w.withKg.length && p !== null ? est("average kg × your price") : ""]])}</section>
   <section class="card c6" data-open="settings" tabindex="0" role="button"><div class="ch"><span class="ct">${ic("coins")}Money lost · this week</span><span class="open">Prices ›</span></div>
    ${rows([["Material loss", aed(m.mat, "Set the material price"), (w.losses.length ? `${fmt(w.lossKg, 1)} kg weighed` : "no loss entered") , ic("scale", null, {size: "sm"})],
      ["Equipment stops", aed(m.down, "Set the cost of 1 hour of stop"), (w.stops.length ? `${mins(w.stopMin)} stopped` : "no stops entered"), ic("motor", null, {size: "sm"})],
      ["Re-mixing", NR("Not calculated yet"), (w.fin.length || w.remixes ? `${w.remixes} re-mix${w.remixes === 1 ? "" : "es"} this week` : "no QC entered"), ic("rework", null, {size: "sm"})]])}
    <div class="why" style="margin-top:10px">Totals only include values that are recorded.</div></section>`;
}
function vEquipment() {
  return `<section class="card c6 eq"><div class="ch"><span class="ct">Equipment</span>${role() === "admin" ? `<button class="btn ghost" type="button" data-open="addEq">Add equipment</button>` : `<span class="muted" style="font-size:12px">Set by OmniSite for the pilot</span>`}</div>
    ${S.d.equipment.length ? rows(S.d.equipment.map(e => { const s = eqState(e); return [`<b style="font-weight:600">${h(e.name)}</b> <span class="muted">· ${h(S.meta.kinds[e.kind])}</span>`, stLine(s.st, s.label), e.status_at ? (e.status_src === "sensor" ? sensor : manual)(when(e.status_at)) : `<div class="why">Needs connection</div>`, ic(e.kind, s.st, {spin: s.spin}), `eq:${e.id}`]; }))
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
    return `<div class="mtile">${ic(e.kind, s.st, {size: "lg", spin: s.spin})}<div><b>${h(e.name)}</b>${stLine(s.st, s.label)}<div class="why" style="margin-top:4px">${b ? h(b.code) : openStop(e.id) ? `Stopped for ${mins(minsBetween(openStop(e.id).started_at))}` : ""}</div>${e.status_at ? (e.status_src === "sensor" ? sensor : manual)(when(e.status_at)) : ""}</div></div>`; }).join("");
  const total = [m.mat, m.down].filter(v => v !== null).reduce((a, b) => a + b, 0), parts = [m.mat, m.down].filter(v => v !== null).length;
  const ft = w.fin.length ? Math.round(w.n[0] / w.fin.length * 100) : null;
  return `${pvBar()}<div class="owner"><div class="otop"><div><div class="obrand">OmniSite<small>Factory owner · ${h(fname())}</small></div>${switcher() ? `<div style="margin-top:10px;max-width:260px">${switcher()}</div>` : ""}<h1 style="margin-top:14px">Your factory today</h1><div class="sub">${nowLine()}</div></div>
   <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px"><span class="ro">View only · the site manager enters reasons and readings</span><div class="muted" style="font-size:12px"><button class="lo" type="button" data-open="support" style="background:none;border:0;padding:0;text-decoration:underline;cursor:pointer;font:inherit;color:var(--ink2)">Request support</button> · ${h(S.user.name)} · <button class="lo" type="button" onclick="logout()" style="background:none;border:0;padding:0;text-decoration:underline;cursor:pointer;font:inherit;color:var(--ink2)">Log out</button></div></div></div>
   <section class="card" style="margin-bottom:20px"><div class="hero"><div class="light"><span class="bulb ${light.c}"></span><div><div style="margin-bottom:4px">${stLine(light.c, light.label)}</div><h2>${light.line}</h2>${light.sub ? `<div class="muted" style="margin-top:6px">${light.sub}</div>` : ""}${light.src || ""}</div></div>${tiles}</div></section>
   <div class="grid">
    <section class="card c2 half"><div class="ch"><span class="ct">${ic("mixer")}Output today</span></div><div class="big">${t.done || hasDay(S.d.today) ? t.done : NRs} <small>${t.target !== null ? `of ${t.target} batches` : "batches finished"}</small></div>
      ${t.target !== null ? `<div class="bar"><b style="width:${Math.min(100, t.done / t.target * 100)}%"></b></div>` : `<div class="why" style="margin-top:10px">Daily target not set</div>`}
      <div class="muted">${t.litres !== null ? `${fmt(t.done * t.litres)} L` : ""}</div>
      <div class="why" style="margin-top:8px">Material used today: ${kgToday() !== null ? `${fmt(kgToday(), 1)} kg` : "not recorded"} · People today: ${(S.d.labour.find(l => l.day === S.d.today) || {}).people || "not recorded"}</div><div class="src"><i>✎</i>Manual · ${lastAt(S.d.batches, "moved_at") || "no batch moved yet"}</div></section>
    <section class="card c2 half" data-open="o-quality" tabindex="0" role="button"><div class="ch"><span class="ct">${ic("qc")}Quality · this week</span><span class="open">Open ›</span></div>
      <div class="big">${ft !== null ? `${ft}%` : "—"} <small>${ft !== null ? "passed first time" : "no finished batches yet"}</small></div>
      ${w.fin.length ? `<div class="lg" style="margin-top:14px"><span>${w.n[0]} first time</span><span>${w.n[1]} re-mixed</span><span>${w.n[2]} rejected</span></div>` : ""}<div class="src"><i>✎</i>Manual · QC results</div></section>
    <section class="card c2"><div class="ch"><span class="ct">${ic("coins")}Money lost · this week</span></div>
      <div class="big">${parts ? `AED ${fmt(total)}` : `<span class="nr">Not recorded</span>`}</div><div class="why" style="margin-top:4px">${parts < 2 ? "Incomplete: some prices are not set yet" : "Material loss + equipment stops"}</div>
      ${rows([["Material loss", m.mat !== null ? `AED ${fmt(m.mat)}` : `<span class="nr">Not recorded</span>`, (w.losses.length ? `${fmt(w.lossKg, 1)} kg weighed` : "no loss entered"), ic("scale", null, {size: "sm"})], ["Equipment stops", m.down !== null ? `AED ${fmt(m.down)}` : `<span class="nr">Not recorded</span>`, w.stops.length ? mins(w.stopMin) : "no stops entered", ic("motor", null, {size: "sm"})], ["Re-mixing", `<span class="nr">Not recorded</span>`, (w.fin.length || w.remixes ? `${w.remixes} re-mix${w.remixes === 1 ? "" : "es"}` : "no QC entered"), ic("rework", null, {size: "sm"})]])}</section>
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
    let body = `${stLine(s.st, {mixing: "Mixing", remix: "Re-mixing", passed: "Passed QC · waiting to move", moved: "Moved to holding tank", rejected: "Rejected"}[b.status])}<h4>Timeline</h4>${tl(ev)}
      <h4>Readings</h4>${rows([["Material used", b.kg_used != null ? `${fmt(b.kg_used, 1)} kg` : b.s.kg != null ? `${fmt(b.s.kg, 1)} kg` : NR(""), b.kg_used != null ? manual(when(b.kg_at)) + (b.s.kg != null ? `<div class="why">Scale: ${fmt(b.s.kg, 1)} kg</div>` : "") : b.s.kg != null ? sensor(`${b.s.weighings} weighing${b.s.weighings === 1 ? "" : "s"} · ${when(b.s.kg_at)}`) : ""],
        ["Temperature", b.s.temp ? `${fmt(b.s.temp.last, 1)} °C` : sig(e.id, "temp_c") ? NR("No reading during this batch") : needsConn("Needs a temperature probe"), b.s.temp ? sensor(`${fmt(b.s.temp.lo, 1)}–${fmt(b.s.temp.hi, 1)} °C in this batch · ${when(b.s.temp.at)}`) : ""],
        ["Motor load", b.s.current ? `${fmt(b.s.current.avg, 0)}% avg` : sig(e.id, "current_pct") ? NR("No reading during this batch") : needsConn("Needs the drive or a current sensor"), b.s.current ? sensor(`max ${fmt(b.s.current.hi, 0)}% of rated current · ${when(b.s.current.at)}`) : ""],
        ...(sig(e.id, "energy_kwh") ? [["Energy", b.s.kwh != null ? `${fmt(b.s.kwh, 2)} kWh` : NR("Needs 2 readings in this batch"), b.s.kwh != null ? sensor(when(b.s.kwh_at)) : ""]] : [])])}`;
    let after;
    if (!ro && ["mixing", "remix"].includes(b.status)) {
      body += form("fQc", b.status === "remix" ? "Enter QC again" : "Enter QC readings", h(b.code),
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
    if (!ro) {
      body += form("fKg", b.kg_used != null ? "Correct the material used" : "Enter the material used", b.s.kg != null ? "The scale's total is used unless you enter a corrected value." : "Total kg of raw material put into this batch, from the scale.",
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
  if (kind === "addEq") return {icon: ic("other"), kicker: "Equipment", title: "Add equipment", body: form("fEq", "Add equipment", "Add each machine you want to follow.", fl(1, "Type", 1) + chips("kind", Object.entries(S.meta.kinds)) + fl(2, "Name", 1) + `<input class="inp" name="name" placeholder="e.g. Mixer 1">`, "Add equipment"),
    after: () => bind("fEq", f => { need(val(f, "kind"), "Pick the type."); need(val(f, "name"), "Enter a name, e.g. Mixer 1."); return {kind: val(f, "kind"), name: val(f, "name")}; }, "/api/equipment", "Equipment added", closeD)};
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
  if (kind === "addSig" && team()) { const M = S.meta.metrics;
    return {icon: ic("bolt"), kicker: "Connections", title: "Add signal", body: form("fSig", "Link a tag to equipment", "Use the exact tag name set in the gateway.",
      fl(1, "Equipment", 1) + chips("equipment_id", S.d.equipment.map(e => [String(e.id), e.name])) + fl(2, "What it measures", 1) + chips("metric", Object.entries(M).map(([k, v]) => [k, `${v.label}${v.unit ? ` (${v.unit})` : ""}`])) +
      fl(3, "Tag name", 1) + `<input class="inp" name="tag" placeholder="e.g. mixer1_hz" style="min-height:0" autocapitalize="off">` +
      fl(4, "Multiplier", 0, "(optional · default 1, e.g. 0.01 for Altivar speed)") + `<input class="inp" name="mult" inputmode="decimal" style="min-height:0">` + fl(5, "Offset", 0, "(optional · added after the multiplier)") + `<input class="inp" name="plus" inputmode="decimal" style="min-height:0">` +
      `<div class="why" style="margin-top:8px">The scale is linked to the mixer it fills, so its weighings count into that mixer's running batch.</div>`, "Add signal"),
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
  return {icon: ic("qc"), kicker: "This week", title: "Quality", body: w.fin.length ? rows(w.fin.map(b => [h(b.code), b.status === "rejected" ? "Rejected" : b.qc_count > 1 ? `Re-mixed ×${b.qc_count - 1}` : "Passed first time", manual(when(b.finished_at || b.moved_at))])) : empty("No finished batches this week.")};
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
