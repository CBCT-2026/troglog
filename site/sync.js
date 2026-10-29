/* Troglog private sync — optional. When Supabase is configured (config.js, or pasted into
   the ☁ Sync dialog), the journal is stored in your own private Supabase project and merged
   across devices: newest change wins per place/trip, deletions are remembered, photos are
   uploaded once and downloaded to each device. Without it the app stays device-only.

   Everything is end-to-end encrypted with a passphrase you type once per device: AES-256-GCM
   with a key derived by PBKDF2 (310k rounds, random salt). Supabase only ever stores ciphertext.
   The passphrase is never in this code or on the server, so losing it means losing the journal. */
(() => {
  const T = window.Troglog;
  const $ = (s) => document.querySelector(s);
  const esc = T.esc;
  const LOCAL_CFG = "troglog.sync";
  const LOCAL_KEY = "troglog.e2e"; // { salt, k }: the derived key, kept on this device only
  const LIB = "vendor/supabase.js"; // self-hosted so no third-party script can read your data
  const BUCKET = "photos";
  let localCfg = {};
  try { localCfg = JSON.parse(localStorage.getItem(LOCAL_CFG) || "{}"); } catch {}
  const cfg = { lockWhenSignedOut: true, ...(window.TROGLOG_CONFIG || {}) };
  if (!cfg.supabaseUrl) Object.assign(cfg, localCfg);
  const configured = () => !!(cfg.supabaseUrl && cfg.supabaseAnonKey);

  let sb = null, user = null, timer = null, busy = false, again = false, lastSync = null, lastErr = "", needKey = null;

  // ---------- encryption ----------
  const enc = new TextEncoder(), dec = new TextDecoder();
  const toB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  let key = null, salt = null;
  let keyReady = Promise.resolve();
  try { const k = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); if (k?.k) { salt = k.salt; keyReady = crypto.subtle.importKey("raw", fromB64(k.k), "AES-GCM", true, ["encrypt", "decrypt"]).then((x) => { key = x; }).catch(() => {}); } } catch {}
  async function deriveKey(pass, saltB64) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pass.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: fromB64(saltB64), iterations: 310000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  }
  async function sealBytes(u8) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, u8)); const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out; }
  async function openBytes(u8) { return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u8.slice(0, 12) }, key, u8.slice(12))); }
  const sealJSON = async (o) => toB64(await sealBytes(enc.encode(JSON.stringify(o))));
  const openJSON = async (s) => JSON.parse(dec.decode(await openBytes(fromB64(s))));
  async function rememberKey(k, s) {
    key = k; salt = s;
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ salt: s, k: toB64(new Uint8Array(await crypto.subtle.exportKey("raw", k))) })); } catch {}
  }
  function forgetKey() { key = null; salt = null; try { localStorage.removeItem(LOCAL_KEY); } catch {} }

  function status() {
    const el = $("#syncState"); if (!el) return;
    el.textContent = !configured() ? "" : !user ? "· off" : needKey ? "· 🔒" : busy ? "· syncing…" : lastErr ? "· ⚠" : navigator.onLine ? "· ✓" : "· offline";
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
      await keyReady;
      const { data: row, error } = await sb.from("journal").select("data").eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      const remote = row?.data || null;
      // Need the passphrase before anything can be read or written.
      if (remote?.v === 2 && (!key || salt !== remote.salt)) { needKey = { mode: "unlock", salt: remote.salt, check: remote.check }; busy = false; status(); showPassphrase(); return; }
      if (!remote?.v && !key) { needKey = { mode: "create" }; busy = false; status(); showPassphrase(); return; }
      needKey = null;
      let remoteState = null, remoteMeta = [];
      if (remote?.v === 2) { remoteState = await openJSON(remote.state); remoteMeta = await openJSON(remote.photos); }
      else if (remote) { remoteState = remote.state; remoteMeta = remote.photos || []; } // pre-encryption row: re-saved encrypted below
      const before = JSON.stringify(T.getState());
      let merged = merge(T.getState(), remoteState);
      const meta = await syncPhotos(merged.tomb.photos, remoteMeta, remote?.v !== 2);
      // Fold in anything edited on this device while we were talking to the server.
      merged = merge(T.getState(), merged);
      const data = { v: 2, salt, check: await sealJSON("troglog"), state: await sealJSON(merged), photos: await sealJSON(meta) };
      const { error: e2 } = await sb.from("journal").upsert({ user_id: user.id, data, updated_at: new Date().toISOString() });
      if (e2) throw e2;
      if (JSON.stringify(merged) !== before) T.setState(merged);
      lastSync = new Date();
    } catch (e) { lastErr = "Sync problem: " + (e.message || e); console.warn(e); }
    busy = false; status();
    if (again) { again = false; changed(); }
  }

  async function syncPhotos(deadList, remoteMeta, remotePlain) {
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
    for (const r of local) if (!remotePids.has(r.pid) || remotePlain) {
      const sealed = await sealBytes(new Uint8Array(await r.blob.arrayBuffer()));
      const { error } = await store.upload(path(r.pid), new Blob([sealed], { type: "application/octet-stream" }), { upsert: true, contentType: "application/octet-stream" });
      if (error) throw error;
    }
    for (const m of remoteMeta) if (!dead.has(m.pid) && !localPids.has(m.pid)) {
      const { data, error } = await store.download(path(m.pid));
      if (error) { console.warn("photo download", m.pid, error); continue; }
      let blob;
      try { blob = new Blob([await openBytes(new Uint8Array(await data.arrayBuffer()))], { type: "image/jpeg" }); }
      catch { if (!remotePlain) { console.warn("photo decrypt", m.pid); continue; } blob = data; }
      await T.photos.add({ ...m, blob }); gotNew = true;
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
  function showPassphrase() {
    if ($(".lock")) return;
    const create = needKey.mode === "create";
    const d = document.createElement("div"); d.className = "lock";
    d.innerHTML = `<form id="passForm"><h1>🔒 ${create ? "Choose a passphrase" : "Journal passphrase"}</h1>
      <p class="hint">${create ? "Your journal is encrypted on this device before it's uploaded. The passphrase is never stored anywhere but your devices, so <b>if you forget it, the journal can't be recovered</b>." : "Type the passphrase you chose on your first device. You only need to do this once per device."}</p>
      <input type="password" name="p1" placeholder="Passphrase" autocomplete="${create ? "new-password" : "current-password"}" required autofocus>
      ${create ? `<input type="password" name="p2" placeholder="Passphrase again" autocomplete="new-password" required>` : ""}
      <button class="primary">${create ? "Encrypt and continue" : "Unlock"}</button>
      <div class="hint" data-msg></div></form>`;
    document.body.appendChild(d);
    const form = $("#passForm"), msg = form.querySelector("[data-msg]");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const p = form.p1.value;
      if (create && p !== form.p2.value) { msg.className = "hint err"; msg.textContent = "The two passphrases don't match."; return; }
      if (create && p.length < 6) { msg.className = "hint err"; msg.textContent = "Use at least 6 characters."; return; }
      msg.className = "hint"; msg.textContent = "Checking…";
      try {
        const s = create ? toB64(crypto.getRandomValues(new Uint8Array(16))) : needKey.salt;
        const k = await deriveKey(p, s);
        if (!create) { key = k; try { if ((await openJSON(needKey.check)) !== "troglog") throw 0; } catch { key = null; msg.className = "hint err"; msg.textContent = "Wrong passphrase."; return; } }
        await rememberKey(k, s);
        needKey = null; hideLock(); status(); syncNow();
      } catch (err) { msg.className = "hint err"; msg.textContent = err.message || "Couldn't set the passphrase."; }
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

  async function signOut(silent, wipe) {
    if (!sb || !user) return;
    if (!silent && !confirm(wipe ? "Sign out and erase the journal copy on this device? Your account copy is kept." : "Sign out on this device? Your journal stays in your account and on this device.")) return;
    await sb.auth.signOut(); user = null; status();
    if (wipe) { forgetKey(); await T.wipeLocal(); }
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
    if (user && needKey) { showPassphrase(); return; }
    if (!user) {
      T.openModal(`${head}<p>Sign in to sync this device with your journal.</p>${signInForm("syncForm")}`);
      if (sb) wireSignIn($("#syncForm")); else $("#syncForm [data-msg]").textContent = lastErr || "Sync isn't available right now (offline?).";
      return;
    }
    T.openModal(`${head}
      <p>Signed in as <b>${esc(user.email)}</b>. Changes sync automatically a few seconds after you make them.</p>
      <p class="hint">${key ? "🔒 End-to-end encrypted with your passphrase. Supabase only ever sees scrambled data." : "🔒 Waiting for your passphrase."}</p>
      <p class="hint">${lastErr ? `<span class="err">${esc(lastErr)}</span>` : lastSync ? "Last synced " + lastSync.toLocaleString() : "Not synced yet."}</p>
      <p class="links"><button class="primary" id="sNow">Sync now</button><button id="sOut">Sign out</button><button id="sOutWipe">Sign out and erase this device</button></p>
      <p class="hint">Use "erase this device" on a shared or borrowed computer: signing out alone leaves the local copy in this browser.</p>
      ${localCfg.supabaseUrl ? `<p><button id="sForget" class="danger">Remove sync settings from this device</button></p>` : ""}`);
    $("#sNow").onclick = async () => { $("#sNow").textContent = "Syncing…"; T.closeModal(); await syncNow(); };
    $("#sOut").onclick = async () => { T.closeModal(); await signOut(); };
    $("#sOutWipe").onclick = async () => { T.closeModal(); await signOut(false, true); };
    $("#sForget") && ($("#sForget").onclick = async () => { await signOut(true); forgetKey(); localStorage.removeItem(LOCAL_CFG); location.reload(); });
  };

  addEventListener("online", () => { status(); syncNow(); });
  addEventListener("offline", status);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
  setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 60000);

  window.TroglogSync = { changed, signedIn: () => !!user, signOut, syncNow, get lastError() { return lastErr; } };
  init();
})();
