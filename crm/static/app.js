"use strict";
const S = {meta: null, user: null, factories: [], events: [], f: null, menu: false, busy: false};
const $ = s => document.querySelector(s);
const h = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const STAGE_SHORT = ["Request", "Consult", "NDA", "Audit", "Baseline", "Proposal", "Agreement", "Ready", "Live", "2 weeks", "Result"];
const BAR = n => n <= 3 ? "#d4d4d4" : n <= 7 ? "#8a8a8a" : n <= 10 ? "#3f3f3f" : "#111";
const CONTINUE = ["Subscription", "More machines", "Audit"];

async function api(method, path, body, raw) {
  const opt = {method, headers: {}, credentials: "same-origin"};
  if (raw) { opt.body = raw; } else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers["Content-Type"] = "application/json"; }
  let r;
  try { r = await fetch(path, opt); } catch (e) { throw {status: 0, error: "No internet connection. Nothing was saved. Please try again."}; }
  let d = {};
  try { d = await r.json(); } catch (e) {}
  if (r.status === 401 && path !== "/api/login") { S.user = null; render(); }
  if (!r.ok) throw {status: r.status, ...d, error: d.error || "Could not save. Please try again."};
  return d;
}
function toast(msg, bad) { const t = $("#toast"); t.textContent = msg; t.className = "show" + (bad ? " bad" : ""); clearTimeout(t._x); t._x = setTimeout(() => t.className = "", bad ? 5000 : 2200); }
const today = () => S.meta ? S.meta.today : new Date().toISOString().slice(0, 10);
const days = (a, b) => Math.round((new Date(a) - new Date(b)) / 864e5);
function fmtDate(d) { if (!d) return ""; const x = new Date(d.length > 10 ? d : d + "T12:00:00"); return x.toLocaleDateString("en-GB", {weekday: d.length > 10 ? undefined : "short", day: "numeric", month: "short"}); }
function dueTxt(d) { if (!d) return {t: "no date", c: ""}; const n = days(d, today()); if (n < 0) return {t: `${-n} day${n === -1 ? "" : "s"} late`, c: "red"}; if (n === 0) return {t: "Today", c: "red"}; return {t: fmtDate(d), c: ""}; }
const stageName = n => `${n}. ${S.meta.stages[n - 1]}`;

// ---------- routing ----------
function route() { const p = (location.hash || "#/").slice(1).split("/").filter(Boolean); return {v: p[0] || "dash", id: p[1], q: p[2]}; }
window.addEventListener("hashchange", () => { S.menu = false; load(); });

async function boot() {
  try { const me = await api("GET", "/api/me"); S.user = me.user; } catch (e) { S.user = null; }
  if (!S.user) return render();
  load();
}
async function load() {
  if (!S.user) return render();
  const r = route();
  try {
    if (!S.meta) S.meta = await api("GET", "/api/meta");
    const [fs, ev] = await Promise.all([api("GET", "/api/factories"), r.v === "dash" ? api("GET", "/api/events") : Promise.resolve({events: S.events})]);
    S.factories = fs.factories; S.events = ev.events;
    if (r.v === "f") S.f = (await api("GET", "/api/factories/" + r.id)).factory;
    if (r.v === "files") S.files = (await api("GET", "/api/files")).files;
    render();
  } catch (e) {
    if (e.status === 401) return;
    $("#root").innerHTML = shell(`<h1>Could not load</h1><div class="wrap"><div class="card"><p class="err">${h(e.error)}</p><button class="btn pri" onclick="load()">Try again</button></div></div>`);
  }
}

// ---------- shell ----------
function shell(body, acts = "") {
  const r = route(), act = S.factories.filter(f => f.status === "active");
  const late = [...act.filter(f => f.next_due && f.next_due < today()), ...S.factories.filter(f => f.status === "lost" && f.follow_up && f.follow_up <= today())].length;
  const fu = S.factories.filter(f => f.status === "lost" && f.follow_up).length;
  const a = (v, label, cnt, red) => `<a href="#/${v === "dash" ? "" : v}" class="${r.v === v || (v === "factories" && r.v === "f") ? "on" : ""}"><i class="ico"></i>${label}${cnt ? `<span class="cnt ${red ? "red" : ""}">${cnt}</span>` : ""}</a>`;
  return `${S.menu ? `<div class="scrim" onclick="S.menu=false;render()"></div>` : ""}<div class="app ${acts ? "hasacts" : ""}">
  <aside class="${S.menu ? "open" : ""}"><div class="logo">OmniSite</div><nav>
  ${a("dash", "Dashboard", late, true)}${a("pipeline", "Pipeline", act.length)}${a("factories", "Factories", S.factories.length)}${a("follow", "Follow-ups", fu)}
  <div class="sec">AUDIT</div>${a("audits", "Audits", act.filter(f => f.stage === 4).length)}${a("baselines", "Baselines")}${a("pilots", "Pilots", act.filter(f => f.stage >= 7).length)}
  <div class="sec">TEAM</div>${a("files", "Files")}${a("settings", "Settings")}</nav>
  <div class="me"><div class="av">${h(S.user.name[0] || "?")}</div>${h(S.user.name)}</div></aside>
  <main><div class="top"><button class="menu" aria-label="Menu" onclick="S.menu=true;render()">☰</button><span class="mlogo">OmniSite</span>
  <div class="search"><input id="q" type="search" placeholder="Search factory or phone" autocomplete="off" oninput="searchNow(this.value)" onblur="setTimeout(()=>{const x=$('#res');x&&(x.innerHTML='')},200)"><div id="res"></div></div>
  <div class="sp"></div>${acts ? `<div class="acts">${acts}</div>` : ""}${r.v === "new" || acts ? "" : `<a class="btn pri newbtn" href="#/new">+ New consultation</a>`}</div>
  ${body}</main></div>`;
}
function searchNow(v) {
  const q = v.trim().toLowerCase(), d = q.replace(/\D/g, ""), res = $("#res");
  if (!q) return res.innerHTML = "";
  const m = S.factories.filter(f => f.name.toLowerCase().includes(q) || f.contact_name.toLowerCase().includes(q) || (d.length >= 3 && f.phone.replace(/\D/g, "").includes(d))).slice(0, 8);
  res.innerHTML = `<div class="results">${m.length ? m.map(f => `<a href="#/f/${f.id}"><b>${h(f.name)}</b><div class="small">${h(f.contact_name)} · ${h(f.phone)} · ${statusTxt(f)}</div></a>`).join("") : `<a>No factory found</a>`}</div>`;
}
const statusTxt = f => f.status === "lost" ? "Lost" : f.status === "customer" ? "Customer" : stageName(f.stage);

function render() {
  if (!S.user) return renderLogin();
  const r = route(), V = {dash, pipeline, factories, follow, audits, baselines, pilots, files, settings, new: newForm, f: factoryPage}[r.v] || dash;
  const ae = document.activeElement, keep = ae && ae.id === "q" ? ae.value : null;
  V();
  if (keep !== null) { const q = $("#q"); q.value = keep; q.focus(); }
}

// ---------- login ----------
function renderLogin() {
  $("#root").innerHTML = `<div class="login"><div class="logo">OmniSite CRM</div>
  <form id="lf" onsubmit="doLogin(event)"><div class="fld"><label>1. Email <span class="req">*</span></label><input name="email" type="email" autocomplete="username" required></div>
  <div class="fld"><label>2. Password <span class="req">*</span></label><input name="password" type="password" autocomplete="current-password" required></div>
  <p class="err" id="le"></p><button class="btn pri" style="width:100%">Log in</button></form></div>`;
}
async function doLogin(e) {
  e.preventDefault(); const fd = new FormData(e.target), b = e.target.querySelector("button");
  b.disabled = true; b.textContent = "Logging in…"; $("#le").textContent = "";
  try { const r = await api("POST", "/api/login", {email: fd.get("email"), password: fd.get("password")}); S.user = r.user; location.hash = "#/"; load(); }
  catch (er) { $("#le").textContent = er.error; b.disabled = false; b.textContent = "Log in"; }
}

// ---------- dashboard ----------
function nextItems() {
  const a = S.factories.filter(f => f.status === "active" && f.next_step).map(f => ({f, step: f.next_step, due: f.next_due}));
  const l = S.factories.filter(f => f.status === "lost" && f.follow_up).map(f => ({f, step: `Follow up (lost at ${STAGE_SHORT[(f.lost_stage || 1) - 1]})`, due: f.follow_up}));
  return [...a, ...l].sort((x, y) => (x.due || "9999") < (y.due || "9999") ? -1 : 1);
}
function dash() {
  const act = S.factories.filter(f => f.status === "active");
  if (!S.factories.length) {
    $("#root").innerHTML = shell(`<h1>Dashboard</h1><div class="wrap"><div class="card welcome"><h3 style="font-weight:500">No factories yet</h3><p class="small">When a factory asks for a consultation, add it here. It starts at 1. Consultation request.</p><a class="btn pri" href="#/new">+ New consultation</a></div></div>`);
    return;
  }
  const month = today().slice(0, 7);
  const audits = S.events.filter(e => e.kind === "move" && e.to_stage === 5 && e.at.slice(0, 7) === month).length;
  const live = act.filter(f => f.stage === 9 || f.stage === 10).length;
  const items = nextItems(), soon = items.filter(i => i.due && days(i.due, today()) <= 7), over = items.filter(i => i.due && i.due < today());
  const cnt = Array.from({length: 11}, (_, i) => act.filter(f => f.stage === i + 1).length), mx = Math.max(1, ...cnt);
  const tops = {}; S.factories.forEach(f => f.top_area && (tops[f.top_area] = (tops[f.top_area] || 0) + 1));
  const topL = Object.entries(tops).sort((a, b) => b[1] - a[1]), tmx = Math.max(1, ...topL.map(t => t[1]));
  const lost = S.factories.filter(f => f.status === "lost");
  $("#root").innerHTML = shell(`<h1>Dashboard</h1><div class="wrap">
  <div class="g4">
   <div class="card"><div class="lbl">Factories in progress</div><div class="big">${act.length}</div><div class="small">from consultation to pilot result</div></div>
   <div class="card"><div class="lbl">Audits done</div><div class="big">${audits}</div><div class="small">this month (baseline reached)</div></div>
   <div class="card"><div class="lbl">Pilots live</div><div class="big">${live}</div><div class="small">at 9. Live or 10. 2 weeks</div></div>
   <div class="card"><div class="lbl">Next steps due</div><div class="big">${soon.length}</div><div class="small">${over.length ? `<span class="chip red">${over.length} overdue</span>` : "in the next 7 days"}</div></div>
  </div>
  <div class="g2">
   <div class="card"><div class="ttl"><h3>Pipeline</h3><span class="small">factories at each stage</span></div>
    <div class="pipe">${cnt.map((n, i) => `<a class="pcol" href="#/pipeline" title="${h(stageName(i + 1))}"><span class="n">${n}</span><div class="bar" style="height:${n ? Math.round(n / mx * 110) + 10 : 2}px;background:${BAR(i + 1)}"></div></a>`).join("")}</div>
    <div class="names">${STAGE_SHORT.map(s => `<span>${s}</span>`).join("")}</div>
    <div class="grp"><span>Sales</span><span>Audit &amp; proposal</span><span>Pilot</span><span>Result</span></div></div>
   <div class="card"><div class="ttl"><h3>Next steps</h3><span class="small">yours</span></div>
    ${items.length ? items.slice(0, 6).map(i => { const d = dueTxt(i.due); return `<a class="row" href="#/f/${i.f.id}"><span class="f">${h(i.f.name)}<div class="small">${h(i.step)}</div></span><span class="due ${d.c}">${d.t}</span></a>`; }).join("") : `<p class="empty">Nothing to do right now.</p>`}
    ${items.length > 6 ? `<a class="link" href="#/pipeline">See all ${items.length}</a>` : ""}</div>
  </div>
  <div class="g2">
   <div class="card"><div class="ttl"><h3>Top pain points found in audits</h3><span class="small">how many factories</span></div>
    ${topL.length ? topL.map(([a, n]) => `<div class="hb"><span>${h(a)}</span><div class="track"><i style="width:${n / tmx * 100}%"></i></div><b>${n}</b></div>`).join("") : `<p class="empty">No top pain point picked yet. It is picked in each factory's baseline.</p>`}
    <div class="note">Comes from the baseline table of each audit. It shows what to offer next.</div></div>
   <div class="card"><div class="ttl"><h3>Lost</h3><span class="small">reason saved</span></div><div class="big">${lost.length}</div>
    ${lost.slice(0, 3).map(f => `<a class="row" href="#/f/${f.id}"><span class="f">${h(f.name)}<div class="small">“${h(f.lost_reason)}”</div></span><span class="due">${f.follow_up ? "follow up " + fmtDate(f.follow_up) : "no follow-up"}</span></a>`).join("")}
    <div class="note">On the follow-up date it shows again in Next steps.</div></div>
  </div></div>`);
}

// ---------- lists ----------
function fRow(f, right) {
  const d = f.status === "active" ? dueTxt(f.next_due) : null;
  return `<a class="row" href="#/f/${f.id}"><span class="f">${h(f.name)} <span class="small">· ${h(f.emirate)}</span><div class="small">${h(statusTxt(f))}${f.status === "active" && f.next_step ? " · " + h(f.next_step) : ""}</div></span>${right ?? (d && f.next_due ? `<span class="due ${d.c}">${d.t}</span>` : "")}</a>`;
}
function listPage(title, intro, rows, emptyMsg, extra = "") {
  $("#root").innerHTML = shell(`<h1>${title}</h1><div class="wrap">${extra}<div class="card list">${intro ? `<p class="small" style="margin-top:0">${intro}</p>` : ""}${rows.length ? rows.join("") : `<p class="empty">${emptyMsg}</p>`}</div></div>`);
}
function pipeline() {
  const act = S.factories.filter(f => f.status === "active");
  $("#root").innerHTML = shell(`<h1>Pipeline</h1><div class="wrap"><div class="board">${S.meta.stages.map((s, i) => {
    const fs = act.filter(f => f.stage === i + 1);
    return `<div class="bcol"><h4><span>${i + 1}. ${h(s)}</span><span class="small">${fs.length}</span></h4>${fs.map(f => { const d = dueTxt(f.next_due); return `<a class="bcard" href="#/f/${f.id}"><b style="font-weight:500">${h(f.name)}</b><div class="small">${h(f.next_step)}</div>${f.next_due ? `<div class="due ${d.c}">${d.t}</div>` : ""}</a>`; }).join("") || `<p class="small empty">None</p>`}</div>`;
  }).join("")}</div></div>`);
}
function factories() {
  const t = route().id || "active", fs = S.factories.filter(f => t === "all" || f.status === t);
  const tab = (k, l) => `<a href="#/factories/${k}" class="${t === k ? "on" : ""}">${l} · ${k === "all" ? S.factories.length : S.factories.filter(f => f.status === k).length}</a>`;
  listPage("Factories", "", fs.map(f => fRow(f)), t === "active" ? "No active factories. Add one with + New consultation." : "None here.",
    `<div class="tabs">${tab("active", "Active")}${tab("customer", "Customers")}${tab("lost", "Lost")}${tab("all", "All")}</div>`);
}
function follow() {
  const l = S.factories.filter(f => f.status === "lost").sort((a, b) => (a.follow_up || "9999") < (b.follow_up || "9999") ? -1 : 1);
  listPage("Follow-ups", "Lost factories, with the reason and when to try again.", l.map(f => { const d = f.follow_up ? dueTxt(f.follow_up) : {t: "no date", c: ""}; return fRow({...f, status: "lost"}, `<span class="due ${d.c}">${f.follow_up ? d.t : "no follow-up date"}</span>`).replace("Lost</div>", `Lost at ${h(STAGE_SHORT[(f.lost_stage || 1) - 1])} · “${h(f.lost_reason)}”</div>`); }), "No lost factories.");
}
function audits() {
  const now = S.factories.filter(f => f.status === "active" && f.stage === 4), done = S.factories.filter(f => f.stage >= 5 || (f.audit_done === 8));
  listPage("Audits", "4. Operational audit: map the 8 points on site, then fill the baseline.",
    [...now.map(f => fRow(f, `<span class="chip">${f.audit_done} of 8 done</span>`)), ...(done.length ? [`<div class="sec small" style="padding:16px 0 4px">AUDIT DONE</div>`, ...done.map(f => fRow(f, `<span class="chip dark">8 of 8</span>`))] : [])],
    "No factory is at the audit stage right now.");
}
function baselines() {
  const b = S.factories.filter(f => f.top_area);
  listPage("Baselines", "The top pain point picked from each audit baseline.", b.map(f => fRow(f, `<span class="chip dark">${h(f.top_area)}</span>`)), "No baseline has a top pain point yet.");
}
function pilots() {
  const p = S.factories.filter(f => (f.status === "active" && f.stage >= 7) || f.status === "customer");
  listPage("Pilots", "From 7. Pilot agreement signed to the result.", p.map(f => fRow(f, f.status === "customer" ? `<span class="chip green">Customer</span>` : `<span class="chip">${STAGE_SHORT[f.stage - 1]}</span>`)), "No pilot yet.");
}
function files() {
  listPage("Files", "All files saved on factories.", (S.files || []).map(x => `<div class="file"><span><a href="/api/files/${x.id}" target="_blank" rel="noopener">${h(x.name)}</a><div class="small"><a href="#/f/${x.factory_id}">${h(x.factory)}</a> · ${STAGE_SHORT[x.stage - 1]} · ${fmtDate(x.created_at)}</div></span><span class="small">${size(x.size)}</span></div>`), "No files yet. Add them on a factory page.");
}
const size = b => b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1e3)) + " KB";
function settings() {
  $("#root").innerHTML = shell(`<h1>Settings</h1><div class="wrap"><div class="g2"><div class="card"><div class="ttl"><h3>Change password</h3></div>
  <form onsubmit="changePw(event)"><div class="fld"><label>1. Current password <span class="req">*</span></label><input name="old" type="password" autocomplete="current-password" required></div>
  <div class="fld"><label>2. New password <span class="req">*</span></label><input name="new" type="password" minlength="10" autocomplete="new-password" required><span class="small">At least 10 characters</span></div>
  <p class="err" id="pe"></p><button class="btn pri">Save new password</button></form></div>
  <div class="card"><div class="ttl"><h3>You</h3></div><div class="kv"><span>Name</span><span>${h(S.user.name)}</span><span>Email</span><span>${h(S.user.email)}</span></div>
  <p class="small">Team members can be added later.</p><button class="btn" onclick="logout()">Log out</button></div></div></div>`);
}
async function changePw(e) { e.preventDefault(); const fd = new FormData(e.target); $("#pe").textContent = ""; try { await api("POST", "/api/password", {old: fd.get("old"), new: fd.get("new")}); e.target.reset(); toast("Password changed"); } catch (er) { $("#pe").textContent = er.error; } }
async function logout() { try { await api("POST", "/api/logout"); } catch (e) {} S.user = null; location.hash = "#/"; render(); }

// ---------- new consultation ----------
function newForm() {
  $("#root").innerHTML = shell(`<h1>New consultation</h1><div class="wrap"><div class="card" style="max-width:640px">
  <p class="small" style="margin-top:0">A factory asked for a consultation. It starts at 1. Consultation request.</p>
  <form id="nf" onsubmit="createF(event)" novalidate>
  ${fld("1", "Factory name", "name", true)}
  <div class="fld" data-k="emirate"><label>2. Emirate <span class="req">*</span></label><select name="emirate"><option value="">Choose</option>${S.meta.emirates.map(e => `<option>${e}</option>`).join("")}</select></div>
  ${fld("3", "Contact name (owner or manager)", "contact_name", true)}${fld("4", "Phone", "phone", true, "tel", "+971 5x xxx xxxx")}
  ${fld("5", "Email", "email", false, "email")}${fld("6", "Introduced by", "introduced_by", false, "text", "e.g. mentor, event, referral")}
  ${fld("7", "What the factory makes", "industry", false, "text", "e.g. detergents, paints")}
  <div class="fld" data-k="pain"><label>8. The pain they describe</label><textarea name="pain" placeholder="Can be added after the consultation"></textarea></div>
  <div id="ne"></div><button class="btn pri" id="nb">Save consultation request</button> <a class="btn ghost" href="#/">Cancel</a></form></div></div>`);
  $("#nf [name=name]").focus();
}
const fld = (n, l, k, req, type = "text", ph = "") => `<div class="fld" data-k="${k}"><label>${n}. ${l}${req ? ' <span class="req">*</span>' : ""}</label><input name="${k}" type="${type}" placeholder="${h(ph)}"></div>`;
async function createF(e) {
  e.preventDefault(); if (S.busy) return; S.busy = true;
  const fd = Object.fromEntries(new FormData(e.target)), b = $("#nb");
  document.querySelectorAll("#nf .fld").forEach(x => x.classList.remove("bad")); $("#ne").innerHTML = "";
  b.disabled = true; b.textContent = "Saving…";
  try { const r = await api("POST", "/api/factories", fd); toast("Saved · " + r.factory.name); location.hash = "#/f/" + r.factory.id; }
  catch (er) {
    (er.fields || []).forEach(k => { const x = $(`#nf [data-k=${k}]`); x && x.classList.add("bad"); });
    $("#ne").innerHTML = `<p class="err">${h(er.error)} ${er.existing_id ? `<a href="#/f/${er.existing_id}">Open it</a>` : ""}</p>`;
    b.disabled = false; b.textContent = "Save consultation request";
  } finally { S.busy = false; }
}

// ---------- factory page ----------
async function call(method, path, body, okMsg) {
  if (S.busy) return; S.busy = true;
  try { const r = await api(method, path, body); S.f = r.factory; const i = S.factories.findIndex(x => x.id === S.f.id); if (i >= 0) Object.assign(S.factories[i], S.f); render(); if (okMsg) toast(okMsg); return true; }
  catch (er) {
    if (er.stale) { toast(er.error); S.busy = false; await load(); return false; }
    if (er.missing) { S.f.missing = er.missing; render(); toast("Some things are still missing", true); }
    else toast(er.error, true);
    return false;
  } finally { S.busy = false; }
}
const save = (k, v) => call("PATCH", `/api/factories/${S.f.id}`, {[k]: v}, "Saved");
function inp(k, label, n, req, type = "text") {
  const v = S.f[k] ?? "";
  if (type === "check") return `<label class="tick"><input type="checkbox" ${v ? "checked" : ""} onchange="save('${k}',this.checked)"> ${label}${req ? ' <span class="req">*</span>' : ""}</label>`;
  const tag = type === "area" ? `<textarea onchange="save('${k}',this.value)">${h(v)}</textarea>` : `<input type="${type}" value="${h(v)}" onchange="save('${k}',this.value)">`;
  return `<div class="fld"><label>${n ? n + ". " : ""}${label}${req ? ' <span class="req">*</span>' : ""}</label>${tag}</div>`;
}
function uploadBtn(kind, label) { return `<label class="btn sm ghost" style="cursor:pointer">${label}<input type="file" hidden onchange="upload(this,'${kind}')"></label>`; }
async function upload(el, kind) {
  const file = el.files[0]; if (!file) return;
  if (file.size > 25e6) return toast("This file is too big. The limit is 25 MB.", true);
  toast("Uploading " + file.name + "…");
  try { const r = await api("PUT", `/api/factories/${S.f.id}/files?name=${encodeURIComponent(file.name)}&kind=${kind}`, undefined, file); S.f = r.factory; render(); toast("File saved"); }
  catch (er) { toast(er.error, true); }
}
function nextCard(f) {
  const t = f.stage + 1, F = {
    2: inp("pain", "The pain they describe", "1", true, "area"),
    3: `<div class="fld"><label>1. NDA <span class="req">*</span></label><div>${uploadBtn("nda", "Upload signed NDA")}</div></div>${inp("nda_on_paper", "Signed on paper (no file)", "", false, "check")}`,
    4: inp("audit_date", "Audit site visit date", "1", true, "date"),
    5: `<p style="margin:10px 0">Fill the 8 audit points below, then pick the top pain point in the baseline. <span class="req">*</span></p><div>${uploadBtn("baseline", "Upload baseline report (optional)")}</div>`,
    6: inp("proposal_scope", "Minimum pilot scope (for the top pain point)", "1", true, "area") + `<div>${uploadBtn("proposal", "Upload proposal (optional)")}</div>`,
    7: inp("start_date", "Pilot start date", "1", true, "date") + inp("term", "Pilot term", "2", true) + `<div>${uploadBtn("agreement", "Upload signed agreement (optional)")}</div>`,
    8: inp("hw_ordered", "Hardware ordered", "", true, "check") + inp("engineer_booked", "Engineer booked", "", true, "check") + inp("owner_ok_stop", "Owner OK for the short stop", "", true, "check"),
    9: inp("install_date", "Install date (data flowing)", "1", true, "date"),
    10: inp("recording_note", "Result compared with the audit baseline (limits agreed with QC)", "1", true, "area"),
    11: `<p class="small">Moves to the result. There you choose continue or stop.</p>`,
  }[t];
  const ok = !f.missing.length;
  return `<div class="card"><div class="ttl"><h3>Next: ${h(stageName(t))}</h3><span class="chip">now at ${h(STAGE_SHORT[f.stage - 1])}</span></div>${F}
  ${ok ? `<p class="ok">Ready to move to ${h(stageName(t))}</p>` : `<div class="miss"><b>Still missing:</b><ul>${f.missing.map(m => `<li>${h(m)}</li>`).join("")}</ul></div>`}</div>`;
}
function resultCard(f) {
  return `<div class="card"><div class="ttl"><h3>11. Pilot result</h3></div><p style="margin-top:0">Did the factory continue after the pilot?</p>
  <p class="small">1. Continue with <span class="req">*</span></p>${CONTINUE.map(c => `<label class="tick"><input type="checkbox" name="cw" value="${c}"> ${c}</label>`).join("")}
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><button class="btn pri" onclick="becomeCustomer()">Continue · becomes a customer</button><button class="btn danger" onclick="lostDialog()">Stop · mark lost</button></div></div>`;
}
function becomeCustomer() {
  const w = [...document.querySelectorAll("[name=cw]:checked")].map(x => x.value).join(", ");
  if (!w) return toast("Choose what they continue with", true);
  call("POST", `/api/factories/${S.f.id}/customer`, {customer_with: w}, "Customer saved");
}
function lostDialog() {
  const m = document.createElement("div"); m.className = "modal";
  m.innerHTML = `<div class="card"><div class="ttl"><h3>Mark ${h(S.f.name)} as lost</h3></div>
  <div class="fld"><label>1. Reason <span class="req">*</span></label><textarea id="lr" placeholder="What they said"></textarea></div>
  <div class="fld"><label>2. Follow-up date</label><input id="lf2" type="date"><span class="small">On this date it shows in Next steps, to try again from 1.</span></div>
  <p class="err" id="lerr"></p><div style="display:flex;gap:10px"><button class="btn danger" id="lb">Mark lost</button><button class="btn ghost" id="lc">Cancel</button></div></div>`;
  document.body.appendChild(m); $("#lr").focus();
  $("#lc").onclick = () => m.remove();
  $("#lb").onclick = async () => {
    if (!$("#lr").value.trim()) { $("#lerr").textContent = "Please write the reason."; return; }
    $("#lb").disabled = true;
    const ok = await call("POST", `/api/factories/${S.f.id}/lost`, {reason: $("#lr").value, follow_up: $("#lf2").value}, "Saved as lost");
    if (ok) m.remove(); else $("#lb").disabled = false;
  };
}
function editAudit(p) {
  const a = S.f.audit[p - 1], el = $(`#au${p}`);
  el.innerHTML = `<div><div class="q">${p}. ${h(a.question)}</div><textarea class="inl" id="aut${p}" placeholder="What you found on site">${h(a.answer)}</textarea>
  <div style="display:flex;gap:8px;margin-top:6px"><button class="btn sm pri" onclick="saveAudit(${p})">Save</button><button class="btn sm ghost" onclick="render()">Cancel</button></div></div>`;
  el.className = ""; $(`#aut${p}`).focus();
}
const saveAudit = p => call("PUT", `/api/factories/${S.f.id}/audit/${p}`, {answer: $(`#aut${p}`).value}, "Saved");
function editCell(id, k) {
  const r = S.f.baseline.find(x => x.id === id), td = $(`#b${id}${k}`);
  td.onclick = null; td.classList.remove("cell");
  td.innerHTML = `<textarea class="inl" id="bt${id}${k}" placeholder="${k === "evidence" && r.from_audit ? h("From audit: " + r.from_audit) : ""}">${h(r[k])}</textarea><div style="display:flex;gap:6px;margin-top:6px"><button class="btn sm pri" onclick="event.stopPropagation();saveCell(${id},'${k}')">Save</button><button class="btn sm ghost" onclick="event.stopPropagation();render()">Cancel</button></div>`;
  $(`#bt${id}${k}`).focus();
}
const saveCell = (id, k) => call("PATCH", `/api/factories/${S.f.id}/baseline/${id}`, {[k]: $(`#bt${id}${k}`).value}, "Saved");
const setTop = id => call("PATCH", `/api/factories/${S.f.id}/baseline/${id}`, {top: true}, "Top pain point saved");
async function addArea() { const a = prompt("New baseline area (e.g. Waiting, Water)"); if (a && a.trim()) call("POST", `/api/factories/${S.f.id}/baseline`, {area: a}, "Area added"); }
function move() { const f = S.f; if (f.missing.length) { toast("Fill the missing items first", true); return; } call("POST", `/api/factories/${f.id}/move`, {from: f.stage}, "Moved to " + stageName(f.stage + 1)); }
const reopen = () => confirm("Re-open and start again from 1. Consultation request?") && call("POST", `/api/factories/${S.f.id}/reopen`, {}, "Re-opened");
async function delFile(id, name) { if (confirm(`Remove ${name}?`)) call("DELETE", `/api/factories/${S.f.id}/files/${id}`, undefined, "File removed"); }

function factoryPage() {
  const f = S.f, act = f.status === "active";
  const done = f.audit.filter(a => a.answer.trim()).length;
  let acts = "";
  if (act && f.stage < 11) acts = `<button class="btn" onclick="lostDialog()">Mark lost</button><button class="btn pri" onclick="move()" ${f.missing.length ? 'aria-disabled="true" style="opacity:.55"' : ""}>Move to ${h(stageName(f.stage + 1))} →</button>`;
  const steps = S.meta.stages.map((s, i) => { const n = i + 1, c = f.status === "customer" || n < f.stage ? "done" : n === f.stage ? "now" : ""; return `<div class="st ${c}" title="${h(s)}"><b>${c === "done" ? "✓" : n}</b>${STAGE_SHORT[i]}</div>`; }).join("");
  const banner = f.status === "lost" ? `<div class="banner lost"><span style="flex:1"><b>Lost</b> at ${h(stageName(f.lost_stage || 1))} · “${h(f.lost_reason)}”<div class="small">${f.follow_up ? "Follow up " + fmtDate(f.follow_up) : "No follow-up date"}</div></span>${inp("follow_up", "Follow-up date", "", false, "date").replace('class="fld"', 'class="fld" style="margin:0"')}<button class="btn pri" onclick="reopen()">Try again from 1</button></div>`
    : f.status === "customer" ? `<div class="banner cust"><span><b>Customer</b> · continues with: ${h(f.customer_with)}</span></div>` : "";
  const audit = f.stage >= 4 || done ? `<div class="card"><div class="ttl"><h3>4. Operational audit · 8 points</h3><span class="chip ${done === 8 ? "dark" : ""}">${done} of 8 done</span></div>
   ${f.audit_date ? `<p class="small" style="margin:0 0 4px">Site visit ${fmtDate(f.audit_date)}</p>` : ""}
   ${f.audit.map(a => `<div class="chk" id="au${a.point}"><span class="box ${a.answer.trim() ? "on" : ""}">${a.answer.trim() ? "✓" : ""}</span><div><div class="q">${a.point}. ${h(a.question)}</div><div class="a ${a.answer.trim() ? "" : "empty"}">${a.answer.trim() ? h(a.answer) : "Not filled yet"}</div></div><button class="link" onclick="editAudit(${a.point})">${a.answer.trim() ? "edit" : "add"}</button></div>`).join("")}</div>` : "";
  const bl = f.stage >= 4 ? `<div class="card bl"><div class="ttl"><h3>5. Baseline</h3><span class="small">tap a cell to edit · pick the top pain point</span></div>
   <table><thead><tr><th style="width:15%">Area</th><th>Current evidence</th><th style="width:22%">Business impact</th><th style="width:25%">OmniSite opportunity</th><th style="width:96px"></th></tr></thead><tbody>
   ${f.baseline.map(r => { const top = f.top_area === r.area; const ev = r.evidence.trim() ? h(r.evidence) : r.from_audit.trim() ? `<span class="empty">From audit point ${r.audit_point}: ${h(r.from_audit)}</span>` : `<span class="empty">Not filled yet</span>`;
     return `<tr class="${top ? "toprow" : ""}"><td data-h="Area"><b style="font-weight:${top ? 600 : 400}">${h(r.area)}</b> ${top ? '<span class="chip">Top pain</span>' : ""}</td>
     <td data-h="Current evidence" class="cell" id="b${r.id}evidence" onclick="editCell(${r.id},'evidence')">${ev}</td>
     <td data-h="Business impact" class="cell" id="b${r.id}impact" onclick="editCell(${r.id},'impact')">${h(r.impact) || '<span class="empty">add</span>'}</td>
     <td data-h="OmniSite opportunity" class="cell" id="b${r.id}opportunity" onclick="editCell(${r.id},'opportunity')">${h(r.opportunity) || '<span class="empty">add</span>'}</td>
     <td>${top ? "" : `<button class="btn sm ghost" onclick="setTop(${r.id})">Set as top</button>`}</td></tr>`; }).join("")}</tbody></table>
   <button class="link" onclick="addArea()">+ Add area</button>
   <div class="note">The evidence comes from the audit answers, so nothing is typed twice. The top pain point goes into 6. Pilot proposal.</div></div>` : "";
  const ns = act ? `<div class="card"><div class="ttl"><h3>Next step</h3>${f.next_due ? `<span class="due ${dueTxt(f.next_due).c}">${dueTxt(f.next_due).t}</span>` : ""}</div>${inp("next_step", "What", "", false)}${inp("next_due", "Due date", "", false, "date")}</div>` : "";
  const fee = `<span>Audit fee</span><span><select class="inl" onchange="save('audit_fee',this.value)">${[["", "Not decided"], ["free", "Free"], ["paid", "Paid"]].map(([v, l]) => `<option value="${v}" ${f.audit_fee === v ? "selected" : ""}>${l}</option>`).join("")}</select>${f.audit_fee === "paid" ? `<input class="inl" style="margin-top:6px" inputmode="decimal" placeholder="AED" value="${h(f.audit_fee_aed)}" onchange="save('audit_fee_aed',this.value)">` : ""}</span>`;
  const ce = (k, l, type = "text") => `<span>${l}</span><input class="inl" type="${type}" value="${h(f[k])}" onchange="save('${k}',this.value)">`;
  const contact = `<div class="card"><div class="ttl"><h3>Contact</h3></div><div class="kv">${ce("name", "Factory")}${ce("contact_name", "Owner")}${ce("phone", "Phone", "tel")}${ce("email", "Email", "email")}
   <span>Emirate</span><select class="inl" onchange="save('emirate',this.value)">${S.meta.emirates.map(e => `<option ${f.emirate === e ? "selected" : ""}>${e}</option>`).join("")}</select>${ce("introduced_by", "Introduced by")}${ce("industry", "Makes")}${fee}</div></div>`;
  const filesC = `<div class="card"><div class="ttl"><h3>Files</h3>${uploadBtn("", "+ Add file")}</div>${f.files.length ? f.files.map(x => `<div class="file"><span><a href="/api/files/${x.id}" target="_blank" rel="noopener">${h(x.name)}</a><div class="small">${STAGE_SHORT[x.stage - 1]} · ${size(x.size)}</div></span><button class="link" onclick="delFile(${x.id},'${h(x.name).replace(/'/g, "")}')">remove</button></div>`).join("") : `<p class="empty">No files yet</p>`}</div>`;
  const hist = `<div class="card hist"><div class="ttl"><h3>History</h3></div>${f.events.slice(0, 30).map(e => `<div><b>${fmtDate(e.at)}</b> · ${h(e.text)}${e.by ? ` <span class="small">· ${h(e.by)}</span>` : ""}</div>`).join("")}</div>`;
  const past = [f.stage >= 2 && inp("pain", "The pain they describe", "", false, "area"), f.stage >= 4 && inp("audit_date", "Audit site visit date", "", false, "date"),
    f.stage >= 6 && inp("proposal_scope", "Minimum pilot scope", "", false, "area"), f.stage >= 7 && inp("start_date", "Pilot start date", "", false, "date"), f.stage >= 7 && inp("term", "Pilot term", "", false),
    f.stage >= 9 && inp("install_date", "Install date", "", false, "date"), f.stage >= 10 && inp("recording_note", "Result compared with the baseline", "", false, "area")].filter(Boolean).join("");
  const main = [banner, act && f.stage < 11 ? nextCard(f) : "", act && f.stage === 11 ? resultCard(f) : "", audit].join("");
  $("#root").innerHTML = shell(`<h1>${h(f.name)} <span class="small">· ${h(f.emirate)}${f.industry ? " · " + h(f.industry) : ""}</span></h1><div class="wrap">
   <div class="card"><div class="steps">${steps}</div></div>
   <div class="g2"><div class="col2">${main}${past ? `<div class="card"><div class="ttl"><h3>Saved details</h3><span class="small">from earlier stages</span></div>${past}</div>` : ""}</div>
   <div class="col2">${ns}${contact}${filesC}${hist}</div></div>${bl}</div>`, acts);
}
boot();
