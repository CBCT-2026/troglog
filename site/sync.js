/* Troglog private sync — optional. When Supabase is configured (config.js, or pasted into
   the ☁ Sync dialog), the journal is stored in your own private Supabase project and merged
   across devices: newest change wins per place/trip, deletions are remembered, photos are
   uploaded once and downloaded to each device. Without it the app stays device-only. */
(() => {
  const T = window.Troglog;
  const $ = (s) => document.querySelector(s);
  const esc = T.esc;
  const LOCAL_CFG = "troglog.sync";
  const LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
  const BUCKET = "photos";
  let localCfg = {};
  try { localCfg = JSON.parse(localStorage.getItem(LOCAL_CFG) || "{}"); } catch {}
  const cfg = { lockWhenSignedOut: true, ...(window.TROGLOG_CONFIG || {}) };
  if (!cfg.supabaseUrl) Object.assign(cfg, localCfg);
  const configured = () => !!(cfg.supabaseUrl && cfg.supabaseAnonKey);

  let sb = null, user = null, timer = null, busy = false, again = false, lastSync = null, lastErr = "";

  function status() {
    const el = $("#syncState"); if (!el) return;
    el.textContent = !configured() ? "" : !user ? "· off" : busy ? "· syncing…" : lastErr ? "· ⚠" : navigator.onLine ? "· ✓" : "· offline";
    el.title = lastErr || (lastSync ? "Last synced " + lastSync.toLocaleTimeString() : "");
  }

  function loadLib() {
    if (window.supabase) return Promise.resolve();
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = LIB; s.onload = res; s.onerror = () => rej(new Error("Couldn't load the sync library (offline?)")); document.head.appendChild(s); });
  }

  async function init() {
    status();
    if (!configured()) return;
    try {
      await loadLib();
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
      const { data } = await sb.auth.getSession();
      user = data.session?.user || null;
      sb.auth.onAuthStateChange((_e, s) => { const was = user; user = s?.user || null; status(); if (user && !was) { hideLock(); syncNow(); } });
    } catch (e) { lastErr = e.message; }
    status();
    if (user) syncNow();
    else if (cfg.lockWhenSignedOut && sb) showLock();
  }

  // ---------- merge ----------
  const uni = (a = [], b = []) => [...new Set([...a, ...b])];
  function newest(xs = [], ys = [], dead = []) {
    const m = new Map();
    [...ys, ...xs].forEach((p) => { const o = m.get(p.id); if (!o || (p.t || 0) >= (o.t || 0)) m.set(p.id, p); });
    const d = new Set(dead); return [...m.values()].filter((p) => !d.has(p.id));
  }
  function merge(a, b) {
    if (!b) return a;
    const tomb = { custom: uni(a.tomb?.custom, b.tomb?.custom), trips: uni(a.tomb?.trips, b.tomb?.trips), photos: uni(a.tomb?.photos, b.tomb?.photos) };
    const user = { ...(b.user || {}) };
    for (const [k, v] of Object.entries(a.user || {})) if (!user[k] || (v.t || 0) >= (user[k].t || 0)) user[k] = v;
    tomb.custom.forEach((id) => delete user[id]);
    const aH = (a.hiddenT || 0) >= (b.hiddenT || 0);
    return { ...b, ...a, user, tomb,
      custom: newest(a.custom, b.custom, tomb.custom),
      trips: newest(a.trips, b.trips, tomb.trips),
      hidden: aH ? a.hidden || [] : b.hidden || [], hiddenT: Math.max(a.hiddenT || 0, b.hiddenT || 0) };
  }

  // ---------- sync ----------
  function changed() {
    if (!user) return;
    clearTimeout(timer); timer = setTimeout(syncNow, 2500);
  }
  async function syncNow() {
    if (!sb || !user) return;
    if (busy) { again = true; return; }
    busy = true; lastErr = ""; status();
    try {
      const { data: row, error } = await sb.from("journal").select("data").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      const remote = row?.data || null;
      const before = JSON.stringify(T.getState());
      let merged = merge(T.getState(), remote?.state);
      const meta = await syncPhotos(merged.tomb.photos, remote?.photos || []);
      // Fold in anything edited on this device while we were talking to the server.
      merged = merge(T.getState(), merged);
      const { error: e2 } = await sb.from("journal").upsert({ user_id: user.id, data: { state: merged, photos: meta }, updated_at: new Date().toISOString() });
      if (e2) throw e2;
      if (JSON.stringify(merged) !== before) T.setState(merged);
      lastSync = new Date();
    } catch (e) { lastErr = "Sync problem: " + (e.message || e); console.warn(e); }
    busy = false; status();
    if (again) { again = false; changed(); }
  }

  async function syncPhotos(deadList, remoteMeta) {
    const dead = new Set(deadList);
    const store = sb.storage.from(BUCKET);
    const path = (pid) => `${user.id}/${pid}.jpg`;
    let local = await T.photos.all();
    for (const r of local) if (!r.pid) { r.pid = Date.now().toString(36) + Math.random().toString(36).slice(2, 9); await T.photos.put(r); }
    let gotNew = false;
    for (const r of local) if (dead.has(r.pid)) { await T.photos.remove(r.id); gotNew = true; }
    local = local.filter((r) => !dead.has(r.pid));
    const remotePids = new Set(remoteMeta.map((m) => m.pid));
    const localPids = new Set(local.map((r) => r.pid));
    for (const r of local) if (!remotePids.has(r.pid)) {
      const { error } = await store.upload(path(r.pid), r.blob, { upsert: true, contentType: "image/jpeg" });
      if (error) throw error;
    }
    for (const m of remoteMeta) if (!dead.has(m.pid) && !localPids.has(m.pid)) {
      const { data, error } = await store.download(path(m.pid));
      if (error) { console.warn("photo download", m.pid, error); continue; }
      await T.photos.add({ ...m, blob: data }); gotNew = true;
    }
    const gone = remoteMeta.filter((m) => dead.has(m.pid)).map((m) => path(m.pid));
    if (gone.length) await store.remove(gone);
    const metaOf = ({ id, blob, ...m }) => m;
    const out = new Map();
    remoteMeta.filter((m) => !dead.has(m.pid)).forEach((m) => out.set(m.pid, m));
    local.forEach((r) => out.set(r.pid, metaOf(r)));
    if (gotNew) T.setState(T.getState());
    return [...out.values()];
  }

  // ---------- sign-in ----------
  function signInForm(id) {
    return `<form id="${id}" class="form-grid">
      <input type="email" name="email" placeholder="Email" autocomplete="username" required>
      <input type="password" name="password" placeholder="Password" autocomplete="current-password" required>
      <button class="primary">Sign in</button>
      <div class="hint" data-msg></div></form>`;
  }
  function wireSignIn(form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const msg = form.querySelector("[data-msg]"); msg.className = "hint"; msg.textContent = "Signing in…";
      const { error } = await sb.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
      if (error) { msg.className = "hint err"; msg.textContent = error.message; return; }
      msg.className = "hint ok"; msg.textContent = "Signed in ✓";
      T.closeModal();
    };
  }
  function showLock() {
    if ($(".lock")) return;
    const d = document.createElement("div"); d.className = "lock";
    d.innerHTML = signInForm("lockForm").replace('<form id="lockForm" class="form-grid">', '<form id="lockForm"><h1>🦇 Troglog</h1><p class="hint">Sign in to open your journal.</p>');
    document.body.appendChild(d);
    wireSignIn($("#lockForm"));
  }
  function hideLock() { $(".lock")?.remove(); }

  async function signOut(silent) {
    if (!sb || !user) return;
    if (!silent && !confirm("Sign out on this device? Your journal stays in your account and on this device.")) return;
    await sb.auth.signOut(); user = null; status();
    if (!silent && cfg.lockWhenSignedOut) showLock();
  }

  // ---------- dialog ----------
  $("#btnSync").onclick = () => {
    const head = `<div class="modal-head"><h2>☁ Private sync</h2><button data-close>✕</button></div>`;
    if (!configured()) {
      T.openModal(`${head}
        <p>Sync keeps your ticks, reviews, dates, tags, trips and photos in <b>your own private Supabase database</b> (free), so every device you sign in on stays up to date. Only your account can read it.</p>
        <p>Set it up once by following <a href="https://github.com/CBCT-2026/troglog/blob/main/SETUP-SYNC.md" target="_blank" rel="noopener">SETUP-SYNC.md</a>, then paste the two values here (or put them in <code>config.js</code> so every device has them).</p>
        <div class="form-grid">
          <div><label class="lbl">Project URL</label><input type="text" id="sUrl" placeholder="https://xxxx.supabase.co"></div>
          <div><label class="lbl">Anon public key</label><input type="text" id="sKey" placeholder="eyJ…"></div>
          <button class="primary" id="sSave">Save and connect</button></div>`);
      $("#sSave").onclick = () => {
        const url = $("#sUrl").value.trim().replace(/\/+$/, ""), key = $("#sKey").value.trim();
        if (!/^https:\/\/.+/.test(url) || key.length < 20) return alert("Check the URL and key.");
        localStorage.setItem(LOCAL_CFG, JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key }));
        location.reload();
      };
      return;
    }
    if (!user) {
      T.openModal(`${head}<p>Sign in to sync this device with your journal.</p>${signInForm("syncForm")}`);
      if (sb) wireSignIn($("#syncForm")); else $("#syncForm [data-msg]").textContent = lastErr || "Sync isn't available right now (offline?).";
      return;
    }
    T.openModal(`${head}
      <p>Signed in as <b>${esc(user.email)}</b>. Changes sync automatically a few seconds after you make them.</p>
      <p class="hint">${lastErr ? `<span class="err">${esc(lastErr)}</span>` : lastSync ? "Last synced " + lastSync.toLocaleString() : "Not synced yet."}</p>
      <p class="links"><button class="primary" id="sNow">Sync now</button><button id="sOut">Sign out</button></p>
      ${localCfg.supabaseUrl ? `<p><button id="sForget" class="danger">Remove sync settings from this device</button></p>` : ""}`);
    $("#sNow").onclick = async () => { $("#sNow").textContent = "Syncing…"; await syncNow(); T.closeModal(); };
    $("#sOut").onclick = async () => { T.closeModal(); await signOut(); };
    $("#sForget") && ($("#sForget").onclick = async () => { await signOut(true); localStorage.removeItem(LOCAL_CFG); location.reload(); });
  };

  addEventListener("online", () => { status(); syncNow(); });
  addEventListener("offline", status);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
  setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 60000);

  window.TroglogSync = { changed, signedIn: () => !!user, signOut, syncNow };
  init();
})();
