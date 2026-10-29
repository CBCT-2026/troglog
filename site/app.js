/* Troglog — everything personal (ticks, reviews, photos) is kept in this browser.
   Text state lives in localStorage; photos live in IndexedDB. Use Backup to move devices,
   or sign in to private sync (sync.js) to keep every device up to date automatically. */
(() => {
  const CATS = window.CATEGORIES;
  const OTHER = { label: "Other", color: "#64748b", icon: "📍" };
  const cat = (k) => CATS[k] || OTHER;
  const STORE_KEY = "travel-journal.v1";
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- state ----------
  // user[id] = { want, visited, rating, date, review, tags, lat, lng, t }   custom = [place]   hidden = [seed ids]
  // trips = [{ id, name, date, ids, t }]   tomb = ids deleted on this device, so sync doesn't bring them back
  // t / hiddenT = last-change timestamps, used to merge devices (newest wins per place)
  const blank = () => ({ user: {}, custom: [], hidden: [], hiddenT: 0, trips: [], tomb: { custom: [], trips: [], photos: [] } });
  let state = load();
  function load() {
    try { return normalize(JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); }
    catch { return blank(); }
  }
  function normalize(s) { const b = blank(); return { ...b, ...s, tomb: { ...b.tomb, ...(s.tomb || {}) } }; }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); flashSaved(); }
    catch (e) { alert("Couldn't save — browser storage may be full or blocked.\n" + e.message); }
    window.TroglogSync?.changed();
  }
  // Every write goes through u(), so it stamps the entry for sync merging.
  const u = (id) => { const x = (state.user[id] ||= {}); x.t = Date.now(); return x; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  // Seed places marked want:true start ticked; t:0 so any real edit (on any device) wins.
  function seedDefaults() {
    window.SEED_PLACES.forEach((p) => { if (p.want && !state.user[p.id]) state.user[p.id] = { want: true, t: 0 }; });
  }
  seedDefaults();

  function allPlaces() {
    const hidden = new Set(state.hidden);
    return [...window.SEED_PLACES.filter((p) => !hidden.has(p.id)), ...state.custom].map((p) => {
      const x = state.user[p.id] || {};
      return { ...p, lat: x.lat ?? p.lat, lng: x.lng ?? p.lng, moved: x.lat != null };
    });
  }
  const byId = (id) => allPlaces().find((p) => p.id === id);

  // ---------- photos (IndexedDB) ----------
  const dbp = new Promise((res, rej) => {
    const r = indexedDB.open("travel-journal", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath: "id", autoIncrement: true }).createIndex("placeId", "placeId");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  async function tx(mode, fn) {
    const db = await dbp;
    return new Promise((res, rej) => {
      const t = db.transaction("photos", mode);
      const out = fn(t.objectStore("photos"));
      t.oncomplete = () => res(out?.result ?? out);
      t.onerror = () => rej(t.error);
    });
  }
  const photosFor = (placeId) => tx("readonly", (s) => s.index("placeId").getAll(placeId));
  const allPhotos = () => tx("readonly", (s) => s.getAll());
  const addPhoto = (rec) => tx("readwrite", (s) => s.add({ pid: uid(), ...rec }));
  const putPhoto = (rec) => tx("readwrite", (s) => s.put(rec));
  const delPhoto = async (id) => {
    const r = await tx("readonly", (s) => s.get(id));
    if (r?.pid) { state.tomb.photos.push(r.pid); save(); }
    return tx("readwrite", (s) => s.delete(id));
  };
  const clearPhotos = () => tx("readwrite", (s) => s.clear());

  // Shrink big phone photos so storage and backups stay manageable.
  function compress(file, max = 1800, q = 0.82) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", q);
      };
      img.onerror = () => rej(new Error("Can't read " + file.name + " (HEIC? export as JPEG)"));
      img.src = URL.createObjectURL(file);
    });
  }
  const blobToDataURL = (b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
  const dataURLToBlob = (d) => fetch(d).then((r) => r.blob());

  // ---------- filters ----------
  const filt = { q: "", status: "all", country: "", city: "", tag: "", sort: "name", cats: new Set(Object.keys(CATS).concat("other")) };
  let here = null; // { lat, lng } once "Near me" has a location
  function matches(p) {
    const x = state.user[p.id] || {};
    if (filt.status === "want" && !x.want) return false;
    if (filt.status === "visited" && !x.visited) return false;
    if (filt.status === "todo" && x.visited) return false;
    if (filt.country && p.country !== filt.country) return false;
    if (filt.city && cityKey(p) !== filt.city) return false;
    if (filt.tag && !(x.tags || []).includes(filt.tag)) return false;
    if (!filt.cats.has(CATS[p.category] ? p.category : "other")) return false;
    if (filt.q) {
      const hay = [p.name, p.city, p.prefecture, p.country, p.note, x.review, ...(x.tags || [])].join(" ").toLowerCase();
      if (!hay.includes(filt.q)) return false;
    }
    return true;
  }
  const cityKey = (p) => (p.city || "").split(/[,(]/)[0].trim() || p.prefecture || "—";
  const allTags = () => [...new Set(Object.values(state.user).flatMap((x) => x.tags || []))].sort();
  const TAG_IDEAS = ["with friends", "solo", "date", "rainy day", "go back", "must see", "kid-friendly", "day trip"];

  // Great-circle distance in km
  function km(a, b) {
    const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }
  const fmtKm = (d) => (d < 1 ? `${Math.round(d * 1000)} m` : d < 20 ? `${d.toFixed(1)} km` : `${Math.round(d)} km`);

  function buildFilterUI() {
    const places = allPlaces();
    const countries = [...new Set(places.map((p) => p.country))].sort();
    $("#countryFilter").innerHTML = `<option value="">All countries</option>` + countries.map((c) => `<option ${c === filt.country ? "selected" : ""}>${esc(c)}</option>`).join("");
    const cities = [...new Set(places.filter((p) => !filt.country || p.country === filt.country).map(cityKey))].sort();
    if (!cities.includes(filt.city)) filt.city = "";
    $("#cityFilter").innerHTML = `<option value="">All cities / areas</option>` + cities.map((c) => `<option ${c === filt.city ? "selected" : ""}>${esc(c)}</option>`).join("");
    const tags = allTags();
    if (!tags.includes(filt.tag)) filt.tag = "";
    $("#tagFilter").hidden = !tags.length;
    $("#tagFilter").innerHTML = `<option value="">All tags</option>` + tags.map((t) => `<option ${t === filt.tag ? "selected" : ""}>${esc(t)}</option>`).join("");
    const counts = {};
    places.forEach((p) => { const k = CATS[p.category] ? p.category : "other"; counts[k] = (counts[k] || 0) + 1; });
    $("#catFilter").innerHTML = Object.entries({ ...CATS, other: OTHER }).filter(([k]) => counts[k])
      .map(([k, c]) => `<button class="chip ${filt.cats.has(k) ? "" : "off"}" data-k="${k}" title="Click to toggle, double-click to show only this"><i style="background:${c.color}"></i>${esc(c.label)} <small>${counts[k]}</small></button>`).join("");
  }

  // ---------- map ----------
  const map = L.map("map", { zoomControl: true, worldCopyJump: true }).setView([36.2, 137.5], 5);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  const cluster = L.markerClusterGroup({ maxClusterRadius: 28, showCoverageOnHover: false, spiderfyOnMaxZoom: true });
  map.addLayer(cluster);
  const markers = new Map();

  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => {
    const d = L.DomUtil.create("details", "legend");
    d.open = innerWidth > 820;
    d.innerHTML = `<summary>Legend</summary>` + Object.values(CATS).map((c) => `<div><i style="background:${c.color}"></i>${esc(c.label)}</div>`).join("") +
      `<div style="margin-top:4px">✓ visited &nbsp; <span style="color:var(--want)">★</span> want</div>`;
    L.DomEvent.disableClickPropagation(d);
    return d;
  };
  legend.addTo(map);

  function pinIcon(p) {
    const x = state.user[p.id] || {};
    const cls = ["pin", x.visited ? "visited" : "", x.want ? "want" : "", !x.visited && !x.want ? "dim" : ""].join(" ");
    return L.divIcon({ className: "", html: `<div class="${cls}" style="background:${cat(p.category).color}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] });
  }

  // Rebuilding the cluster mid zoom-animation crashes markercluster, so only rebuild
  // when the visible set changes; otherwise just refresh icons/positions in place.
  let shownKey = "";
  function renderMap(list) {
    const key = list.map((p) => `${p.id}@${p.lat},${p.lng}`).join("|");
    if (key === shownKey) { list.forEach((p) => markers.get(p.id)?.setIcon(pinIcon(p))); return; }
    shownKey = key;
    cluster.clearLayers(); markers.clear();
    list.forEach((p) => {
      const m = L.marker([p.lat, p.lng], { icon: pinIcon(p), title: p.name });
      m.on("click", () => openDetail(p.id));
      markers.set(p.id, m);
      cluster.addLayer(m);
    });
  }

  // ---------- list ----------
  let selected = null;
  function render() {
    const places = allPlaces();
    const list = places.filter(matches);
    if (filt.sort === "near" && here) list.forEach((p) => (p.dist = km(here, p)));
    list.sort(filt.sort === "near" && here ? (a, b) => a.dist - b.dist : (a, b) => a.name.localeCompare(b.name));
    $("#count").textContent = `${list.length} of ${places.length} places${filt.sort === "near" && here ? " · nearest first" : ""}`;
    $("#list").innerHTML = list.map((p) => {
      const x = state.user[p.id] || {};
      return `<li data-id="${p.id}" class="${p.id === selected ? "sel" : ""}">
        <span class="dot" style="background:${cat(p.category).color}" title="${esc(cat(p.category).label)}"></span>
        <div><div class="name">${esc(p.name)}</div><div class="sub">${p.dist != null ? `<b>${fmtKm(p.dist)}</b> · ` : ""}${esc(p.city)}${p.country !== "Japan" ? ", " + esc(p.country) : ""}${x.rating ? " · " + "★".repeat(x.rating) : ""}${(x.tags || []).map((t) => ` <span class="tag">${esc(t)}</span>`).join("")}</div></div>
        <div class="checks">
          <label title="Want to go"><input type="checkbox" class="want" data-f="want" ${x.want ? "checked" : ""}>want</label>
          <label title="Visited"><input type="checkbox" data-f="visited" ${x.visited ? "checked" : ""}>been</label>
        </div></li>`;
    }).join("");
    renderMap(list);
    renderProgress(places);
  }

  function renderProgress(places) {
    const v = places.filter((p) => state.user[p.id]?.visited).length;
    const w = places.filter((p) => state.user[p.id]?.want && !state.user[p.id]?.visited).length;
    $("#progress").innerHTML = `${v} visited · ${w} on wishlist · ${places.length} total<div class="bar"><i style="width:${places.length ? (100 * v) / places.length : 0}%"></i></div>`;
  }

  function setFlag(id, f, val) {
    const x = u(id);
    x[f] = val;
    if (f === "visited" && val && !x.date) x.date = new Date().toISOString().slice(0, 10);
    save();
    const m = markers.get(id); const p = byId(id);
    if (m && p) m.setIcon(pinIcon(p));
    renderProgress(allPlaces());
  }

  // ---------- detail panel ----------
  const det = $("#detail");
  let saveTimer;
  async function openDetail(id) {
    const p = byId(id); if (!p) return;
    selected = id;
    document.querySelectorAll("#list li").forEach((li) => li.classList.toggle("sel", li.dataset.id === id));
    const x = state.user[id] || {};
    const c = cat(p.category);
    const q = encodeURIComponent(`${p.name} ${p.city || ""}`);
    const isCustom = id.startsWith("u-");
    det.innerHTML = `
      <button class="close" data-act="close">✕</button>
      <h2>${esc(p.name)}</h2>
      <div class="meta"><span class="chip"><i style="background:${c.color}"></i>${esc(c.label)}</span> ${esc([p.city, p.prefecture, p.country].filter(Boolean).join(", "))}</div>
      ${p.note ? `<div class="note">${esc(p.note)}</div>` : ""}
      ${p.approx && !p.moved ? `<p class="warn">📌 Pin is approximate — drag it on the map to the exact spot.</p>` : ""}
      <section class="status-btns">
        <button data-act="want" class="want ${x.want ? "on" : ""}">⭐ Want to go</button>
        <button data-act="visited" class="visited ${x.visited ? "on" : ""}">✅ Visited</button>
      </section>
      <section><label class="lbl">My rating</label>
        <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<span data-star="${n}" class="${(x.rating || 0) >= n ? "on" : ""}">★</span>`).join("")}</div></section>
      <section><label class="lbl">Date visited</label><input type="date" id="fDate" value="${esc(x.date || "")}"></section>
      <section><label class="lbl">Journal / review (private)</label>
        <textarea id="fReview" placeholder="What was it like? What would you tell future you?">${esc(x.review || "")}</textarea>
        <div class="saved" id="savedMsg"></div></section>
      <section><label class="lbl">Tags</label>
        <div class="tags">${(x.tags || []).map((t) => `<span class="tag">${esc(t)}<button data-untag="${esc(t)}" title="Remove tag">✕</button></span>`).join("")}
          <input type="text" id="fTag" list="tagIdeas" placeholder="＋ tag, e.g. with friends" enterkeyhint="done">
          <datalist id="tagIdeas">${[...new Set([...allTags(), ...TAG_IDEAS])].filter((t) => !(x.tags || []).includes(t)).map((t) => `<option value="${esc(t)}">`).join("")}</datalist></div></section>
      <section><label class="lbl">Photos</label><div class="photos" id="photoGrid"></div>
        <div class="hint">Photo dates and locations are read automatically when the photo has them.</div></section>
      <section><label class="lbl">Day trips</label>
        <div class="links">${state.trips.filter((t) => t.ids.includes(id)).map((t) => `<button data-opentrip="${t.id}">🗓 ${esc(t.name)}</button>`).join("")}
          <select id="fTrip"><option value="">＋ Add to a trip…</option>${state.trips.filter((t) => !t.ids.includes(id)).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}<option value="new">New trip…</option></select></div></section>
      <section class="links">
        <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${q}">Google Maps ↗</a>
        <a target="_blank" rel="noopener" href="https://maps.apple.com/?q=${encodeURIComponent(p.name)}&ll=${p.lat},${p.lng}">Apple Maps ↗</a>
        <a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}">Directions ↗</a>
        <a target="_blank" rel="noopener" href="https://www.google.com/search?q=${q}+opening+hours">Hours ↗</a>
      </section>
      <section class="links">
        <button data-act="move">📌 Move pin</button>
        ${p.moved ? `<button data-act="resetpos">↺ Reset pin</button>` : ""}
        <button data-act="remove" class="danger">${isCustom ? "Delete place" : "Hide from list"}</button>
      </section>`;
    det.hidden = false;
    $("#sidebar").classList.remove("open");
    $("#mobileToggle").textContent = "☰ List";
    renderPhotos(id);
    const m = markers.get(id);
    if (m) cluster.zoomToShowLayer(m, () => map.panTo(m.getLatLng()));
    else map.setView([p.lat, p.lng], Math.max(map.getZoom(), 12));
  }

  async function renderPhotos(id) {
    const grid = $("#photoGrid"); if (!grid) return;
    const recs = await photosFor(id);
    grid.querySelectorAll("img").forEach((i) => URL.revokeObjectURL(i.src));
    grid.innerHTML = recs.map((r) => `<figure><img src="${URL.createObjectURL(r.blob)}" alt="${esc(r.caption || "")}" data-full="${r.id}"><button class="del" data-del="${r.id}" title="Remove photo">✕</button></figure>`).join("") +
      `<button class="addph" data-act="addphoto">＋ Add photos</button>`;
  }

  function flashSaved() {
    const el = $("#savedMsg"); if (!el) return;
    el.textContent = "Saved ✓"; clearTimeout(flashSaved.t); flashSaved.t = setTimeout(() => (el.textContent = ""), 1200);
  }

  det.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-act],[data-star],[data-del],[data-full],[data-untag],[data-opentrip]"); if (!t || !selected) return;
    const id = selected;
    if (t.dataset.untag) { const x = u(id); x.tags = (x.tags || []).filter((g) => g !== t.dataset.untag); save(); buildFilterUI(); openDetail(id); render(); return; }
    if (t.dataset.opentrip) { openTrip(t.dataset.opentrip); return; }
    if (t.dataset.star) { const n = +t.dataset.star; u(id).rating = u(id).rating === n ? 0 : n; save(); openDetail(id); render(); return; }
    if (t.dataset.del) { if (confirm("Remove this photo?")) { await delPhoto(+t.dataset.del); renderPhotos(id); } return; }
    if (t.dataset.full) { lightbox(t.src); return; }
    switch (t.dataset.act) {
      case "close": det.hidden = true; selected = null; render(); break;
      case "want": case "visited": setFlag(id, t.dataset.act, !u(id)[t.dataset.act]); openDetail(id); render(); break;
      case "addphoto": $("#photoInput").click(); break;
      case "move": startMove(id); break;
      case "resetpos": delete u(id).lat; delete u(id).lng; save(); render(); openDetail(id); break;
      case "remove":
        if (id.startsWith("u-")) {
          if (!confirm("Delete this place, its review and photos?")) return;
          state.custom = state.custom.filter((p) => p.id !== id); delete state.user[id]; state.tomb.custom.push(id);
          for (const r of await photosFor(id)) await delPhoto(r.id);
        } else {
          if (!confirm("Hide this place? (You can restore hidden places from Backup.)")) return;
          state.hidden.push(id); state.hiddenT = Date.now();
        }
        save(); det.hidden = true; selected = null; buildFilterUI(); render(); break;
    }
  });
  det.addEventListener("input", (e) => {
    if (!selected) return;
    if (e.target.id === "fReview") { clearTimeout(saveTimer); saveTimer = setTimeout(() => { u(selected).review = e.target.value; save(); }, 400); }
    if (e.target.id === "fDate") { u(selected).date = e.target.value; save(); }
  });
  det.addEventListener("change", (e) => {
    if (!selected) return;
    const id = selected;
    if (e.target.id === "fTag") addTag(id, e.target.value);
    if (e.target.id === "fTrip" && e.target.value) {
      let trip = state.trips.find((t) => t.id === e.target.value);
      if (e.target.value === "new") {
        const name = prompt("Name this day trip:", `${byId(id)?.city || "Day"} trip`); if (!name) { e.target.value = ""; return; }
        trip = { id: "t-" + uid(), name, date: "", ids: [], t: 0 }; state.trips.push(trip);
      }
      trip.ids.push(id); trip.t = Date.now(); save(); openDetail(id); drawTrip(trip);
    }
  });
  det.addEventListener("keydown", (e) => { if (e.target.id === "fTag" && e.key === "Enter") { e.preventDefault(); addTag(selected, e.target.value); } });
  function addTag(id, raw) {
    const tag = raw.trim().toLowerCase(); if (!tag) return;
    const x = u(id); x.tags = [...new Set([...(x.tags || []), tag])]; save(); buildFilterUI(); render(); openDetail(id);
    setTimeout(() => $("#fTag")?.focus(), 0);
  }

  $("#photoInput").addEventListener("change", async (e) => {
    const id = selected; const files = [...e.target.files]; e.target.value = "";
    if (pendingPhotoFor) { const cb = pendingPhotoFor; pendingPhotoFor = null; return cb(files); }
    let first = null;
    for (const f of files) {
      try {
        const ex = await readExif(f);
        await addPhoto({ placeId: id, blob: await compress(f), caption: f.name, added: Date.now(), takenAt: ex.date || null, lat: ex.lat ?? null, lng: ex.lng ?? null });
        first ||= ex;
      } catch (err) { alert(err.message); }
    }
    await applyPhotoInfo(id, first || {});
    renderPhotos(id);
  });

  // Use a photo's EXIF to fill in the visit date, and to fix an approximate pin.
  async function applyPhotoInfo(id, ex) {
    const p = byId(id); const x = state.user[id] || {};
    let changed = false;
    if (ex.date && !x.date) { u(id).date = ex.date; changed = true; }
    else if (ex.date && x.date !== ex.date && confirm(`This photo was taken on ${ex.date}. Use that as the visit date (currently ${x.date})?`)) { u(id).date = ex.date; changed = true; }
    if (ex.lat != null && p) {
      const d = km(p, ex);
      if (d > 0.3 && d < 50 && (p.approx || p.source === "custom") && confirm(`This photo was taken ${fmtKm(d)} from the pin. Move the pin to where the photo was taken?`)) {
        const y = u(id); y.lat = +ex.lat.toFixed(6); y.lng = +ex.lng.toFixed(6); changed = true;
      }
    }
    if (changed) { save(); render(); openDetail(id); }
  }

  // Minimal EXIF reader for JPEGs: DateTimeOriginal and GPS. Returns {} when absent (HEIC, stripped, PNG…).
  async function readExif(file) {
    try {
      const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
      if (v.getUint16(0) !== 0xffd8) return {};
      let o = 2;
      while (o + 4 < v.byteLength) {
        const mk = v.getUint16(o), len = v.getUint16(o + 2);
        if (mk === 0xffe1 && v.getUint32(o + 4) === 0x45786966) return parseTiff(v, o + 10);
        if ((mk & 0xff00) !== 0xff00) break;
        o += 2 + len;
      }
    } catch {}
    return {};
  }
  function parseTiff(v, t) {
    const le = v.getUint16(t) === 0x4949;
    const g16 = (o) => v.getUint16(o, le), g32 = (o) => v.getUint32(o, le);
    const ifd = (o) => { const n = g16(t + o), m = {}; for (let i = 0; i < n; i++) { const e = t + o + 2 + i * 12; m[g16(e)] = e; } return m; };
    const str = (e) => { const n = g32(e + 4), o = n > 4 ? t + g32(e + 8) : e + 8; let s = ""; for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(o + i)); return s; };
    const rats = (e) => { const o = t + g32(e + 8); return [0, 1, 2].map((i) => g32(o + i * 8) / g32(o + i * 8 + 4)); };
    const out = {};
    const ifd0 = ifd(g32(t + 4));
    if (ifd0[0x8769]) {
      const ex = ifd(g32(ifd0[0x8769] + 8));
      const dt = ex[0x9003] ? str(ex[0x9003]) : ifd0[0x0132] ? str(ifd0[0x0132]) : "";
      const m = dt.match(/^(\d{4}):(\d\d):(\d\d)/); if (m && m[1] !== "0000") out.date = `${m[1]}-${m[2]}-${m[3]}`;
    }
    if (ifd0[0x8825]) {
      const gp = ifd(g32(ifd0[0x8825] + 8));
      if (gp[2] && gp[4]) {
        const dms = (a) => a[0] + a[1] / 60 + a[2] / 3600;
        let lat = dms(rats(gp[2])), lng = dms(rats(gp[4]));
        if (gp[1] && str(gp[1]) === "S") lat = -lat;
        if (gp[3] && str(gp[3]) === "W") lng = -lng;
        if (isFinite(lat) && isFinite(lng) && (lat || lng)) { out.lat = lat; out.lng = lng; }
      }
    }
    return out;
  }
  let pendingPhotoFor = null; // set when the Add-place form asks for a photo

  function lightbox(src) {
    const d = document.createElement("div"); d.className = "lightbox"; d.innerHTML = `<img src="${src}">`;
    d.onclick = () => d.remove(); document.body.appendChild(d);
  }

  // Drag a pin to correct its position
  function startMove(id) {
    const p = byId(id); const m = markers.get(id);
    if (!m) return alert("Clear filters so the pin is visible, then try again.");
    cluster.removeLayer(m); shownKey = "";
    const dm =L.marker([p.lat, p.lng], { draggable: true, icon: pinIcon(p), zIndexOffset: 1000 }).addTo(map)
      .bindPopup("Drag me, then click <b>Done</b> <button id='doneMove'>Done</button>").openPopup();
    map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15));
    const finish = () => { const ll = dm.getLatLng(); u(id).lat = +ll.lat.toFixed(6); u(id).lng = +ll.lng.toFixed(6); save(); map.removeLayer(dm); render(); openDetail(id); };
    dm.on("popupopen", () => $("#doneMove")?.addEventListener("click", finish));
    $("#doneMove")?.addEventListener("click", finish);
    dm.on("dragend", () => dm.openPopup());
  }

  // ---------- add place ----------
  let adding = false;
  $("#btnAdd").onclick = () => showAddForm();
  $("#cancelAdd").onclick = () => { adding = false; $("#addHint").hidden = true; };
  map.on("click", (e) => { if (!adding) return; adding = false; $("#addHint").hidden = true; showAddForm({ lat: e.latlng.lat, lng: e.latlng.lng }); });

  function showAddForm(pre = {}) {
    const opts = Object.entries({ other: OTHER, ...CATS }).map(([k, c]) => `<option value="${k}" ${pre.category === k ? "selected" : ""}>${c.icon} ${esc(c.label)}</option>`).join("");
    openModal(`
      <div class="modal-head"><h2>Add a place</h2><button data-close>✕</button></div>
      <div class="form-grid">
        <div><label class="lbl">Find on map (worldwide search)</label>
          <div class="row" style="grid-template-columns:1fr auto"><input type="text" id="geoQ" placeholder="e.g. Louvre Paris, Bondi Beach…"><button id="geoGo">Search</button></div>
          <ul class="geo-results" id="geoRes"></ul>
          <button id="pickMap">…or click on the map instead</button> <button id="fromPhoto">📷 …or use a photo's location</button>
          <div class="hint" id="photoHint"></div></div>
        <div><label class="lbl">Name</label><input type="text" id="aName" value="${esc(pre.name || "")}"></div>
        <div class="row"><div><label class="lbl">City / area</label><input type="text" id="aCity" value="${esc(pre.city || "")}"></div>
          <div><label class="lbl">Country</label><input type="text" id="aCountry" value="${esc(pre.country || "")}"></div></div>
        <div><label class="lbl">Category</label><select id="aCat">${opts}</select></div>
        <div><label class="lbl">Note</label><input type="text" id="aNote" placeholder="Why go?"></div>
        <div class="row"><div><label class="lbl">Latitude</label><input type="text" id="aLat" value="${pre.lat?.toFixed?.(6) ?? ""}"></div>
          <div><label class="lbl">Longitude</label><input type="text" id="aLng" value="${pre.lng?.toFixed?.(6) ?? ""}"></div></div>
        <div class="status-btns"><label><input type="checkbox" id="aWant" checked> ⭐ Want to go</label><label><input type="checkbox" id="aVisited"> ✅ Already visited</label></div>
        <button class="primary" id="aSave">Save place</button>
      </div>`);
    const fill = (r) => {
      const a = r.address || {};
      $("#aName").value ||= r.name || r.display_name.split(",")[0];
      $("#aCity").value = a.city || a.town || a.village || a.suburb || a.county || a.state || "";
      $("#aCountry").value = a.country || "";
      $("#aLat").value = (+r.lat).toFixed(6); $("#aLng").value = (+r.lon).toFixed(6);
    };
    const search = async () => {
      const q = $("#geoQ").value.trim(); if (!q) return;
      $("#geoRes").innerHTML = "<li>Searching…</li>";
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&accept-language=en&limit=6&q=${encodeURIComponent(q)}`).then((r) => r.json());
        $("#geoRes").innerHTML = r.length ? r.map((x, i) => `<li data-i="${i}">${esc(x.display_name)}</li>`).join("") : "<li>No results — try a simpler name, or click on the map.</li>";
        $("#geoRes").onclick = (e) => { const li = e.target.closest("[data-i]"); if (li) { fill(r[+li.dataset.i]); $("#geoRes").innerHTML = ""; } };
      } catch { $("#geoRes").innerHTML = "<li>Search unavailable offline — click on the map instead.</li>"; }
    };
    $("#geoGo").onclick = search;
    $("#geoQ").onkeydown = (e) => { if (e.key === "Enter") search(); };
    $("#pickMap").onclick = () => { closeModal(); adding = true; $("#addHint").hidden = false; };
    let carried = [];
    $("#fromPhoto").onclick = () => {
      pendingPhotoFor = async (files) => {
        const ex = await readExif(files[0]);
        if (ex.lat == null) { $("#photoHint").textContent = "That photo has no location saved in it — search or click the map instead."; return; }
        carried = files;
        $("#aLat").value = ex.lat.toFixed(6); $("#aLng").value = ex.lng.toFixed(6);
        $("#photoHint").textContent = `📍 Location found${ex.date ? `, taken ${ex.date}` : ""}. The photo will be attached when you save.`;
        if (ex.date) { $("#aVisited").checked = true; $("#aWant").checked = false; }
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=en&lat=${ex.lat}&lon=${ex.lng}`).then((r) => r.json());
          fill({ ...r, lat: ex.lat, lon: ex.lng });
        } catch {}
      };
      $("#photoInput").click();
    };
    $("#aSave").onclick = () => {
      const lat = parseFloat($("#aLat").value), lng = parseFloat($("#aLng").value), name = $("#aName").value.trim();
      if (!name || isNaN(lat) || isNaN(lng)) return alert("Need a name and a location (search or click the map).");
      const id = "u-" + Date.now().toString(36);
      state.custom.push({ id, name, city: $("#aCity").value.trim(), prefecture: "", country: $("#aCountry").value.trim() || "Unknown",
        lat, lng, category: $("#aCat").value, note: $("#aNote").value.trim(), source: "custom", approx: false, t: Date.now() });
      const x = u(id); x.want = $("#aWant").checked; x.visited = $("#aVisited").checked;
      if (x.visited) x.date = new Date().toISOString().slice(0, 10);
      save(); closeModal(); buildFilterUI(); render(); openDetail(id);
      (async () => {
        let first = null;
        for (const f of carried) {
          const ex = await readExif(f);
          await addPhoto({ placeId: id, blob: await compress(f), caption: f.name, added: Date.now(), takenAt: ex.date || null, lat: ex.lat ?? null, lng: ex.lng ?? null });
          first ||= ex;
        }
        if (first?.date) { u(id).date = first.date; save(); openDetail(id); } else if (carried.length) renderPhotos(id);
      })();
    };
  }

  // ---------- modals ----------
  const modal = $("#modal");
  function openModal(html) { $("#modalBody").innerHTML = html; modal.showModal(); }
  function closeModal() { modal.close(); }
  modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest("[data-close]")) closeModal(); });

  // Overview: the summary graphic + stats
  $("#btnStats").onclick = () => {
    const places = allPlaces();
    const vis = places.filter((p) => state.user[p.id]?.visited);
    const want = places.filter((p) => state.user[p.id]?.want && !state.user[p.id]?.visited);
    const group = (keyFn, labelFn, colorFn) => {
      const g = {};
      places.forEach((p) => { const k = keyFn(p); (g[k] ||= { n: 0, v: 0, p }).n++; if (state.user[p.id]?.visited) g[k].v++; });
      const max = Math.max(...Object.values(g).map((x) => x.n));
      return Object.entries(g).sort((a, b) => b[1].n - a[1].n).map(([k, x]) => `<div class="b"><span>${labelFn(k, x.p)}</span>
        <div class="track"><i style="width:${(100 * x.n) / max}%;background:${colorFn(k)}"></i><i class="v" style="width:${(100 * x.v) / max}%;background:${colorFn(k)}"></i></div>
        <span class="n">${x.v}/${x.n}</span></div>`).join("");
    };
    const region = (p) => (p.country === "Japan" ? p.region || p.prefecture : p.country);
    const avg = vis.filter((p) => state.user[p.id].rating).map((p) => state.user[p.id].rating);
    openModal(`
      <div class="modal-head"><h2>Overview</h2><button data-close>✕</button></div>
      <div class="kpis">
        <div class="kpi"><b>${places.length}</b><span>places saved</span></div>
        <div class="kpi"><b>${vis.length}</b><span>visited</span></div>
        <div class="kpi"><b>${want.length}</b><span>on wishlist</span></div>
        <div class="kpi"><b>${new Set(vis.map(cityKey)).size}</b><span>cities explored</span></div>
        <div class="kpi"><b>${avg.length ? (avg.reduce((a, b) => a + b, 0) / avg.length).toFixed(1) + "★" : "–"}</b><span>avg rating</span></div>
      </div>
      <h3>By theme <small style="color:var(--muted);font-weight:400">(solid = visited)</small></h3>
      <div class="bars">${group((p) => (CATS[p.category] ? p.category : "other"), (k) => `${cat(k).icon} ${esc(cat(k).label)}`, (k) => cat(k).color)}</div>
      <h3>By region</h3>
      <div class="bars">${group(region, (k) => esc(k), () => "#64748b")}</div>
      <p style="margin-top:16px"><button id="ovJapan">🗾 Show all of Japan on the map</button> <button id="ovAll">🌏 Fit all my places</button></p>`);
    $("#ovJapan").onclick = () => { closeModal(); map.fitBounds([[24, 123], [45.6, 146]]); };
    $("#ovAll").onclick = () => { closeModal(); const b = L.latLngBounds(places.map((p) => [p.lat, p.lng])); map.fitBounds(b.pad(0.1)); };
  };

  // ---------- day trips ----------
  const tripLayer = L.layerGroup().addTo(map);
  const tripCtl = L.control({ position: "topleft" });
  tripCtl.onAdd = () => { const b = L.DomUtil.create("button", "trip-ctl"); b.hidden = true; b.onclick = () => clearTrip(); L.DomEvent.disableClickPropagation(b); return b; };
  tripCtl.addTo(map);
  const tripPlaces = (t) => t.ids.map(byId).filter(Boolean);
  const tripKm = (ps) => ps.slice(1).reduce((d, p, i) => d + km(ps[i], p), 0);
  function clearTrip() { tripLayer.clearLayers(); tripCtl.getContainer().hidden = true; }
  function drawTrip(t) {
    tripLayer.clearLayers();
    const ps = tripPlaces(t); if (!ps.length) return clearTrip();
    L.polyline(ps.map((p) => [p.lat, p.lng]), { color: "#dc2626", weight: 4, opacity: 0.8, dashArray: "8 6" }).addTo(tripLayer);
    ps.forEach((p, i) => L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "", html: `<div class="stop"><span>${i + 1}</span></div>`, iconSize: [24, 24], iconAnchor: [12, 30] }), zIndexOffset: 2000 })
      .on("click", () => openDetail(p.id)).addTo(tripLayer));
    const c = tripCtl.getContainer(); c.hidden = false; c.textContent = `🗓 ${t.name} · ${fmtKm(tripKm(ps))} ✕`;
    map.fitBounds(L.latLngBounds(ps.map((p) => [p.lat, p.lng])).pad(0.25), { maxZoom: 14 });
  }
  function gmapsRoute(ps) {
    const ll = (p) => `${p.lat},${p.lng}`;
    const mid = ps.slice(1, -1).slice(0, 9).map(ll).join("|");
    return `https://www.google.com/maps/dir/?api=1&origin=${ll(ps[0])}&destination=${ll(ps[ps.length - 1])}${mid ? "&waypoints=" + encodeURIComponent(mid) : ""}`;
  }
  // Nearest-neighbour from the first stop: good enough for a handful of places.
  function optimise(t) {
    const ps = tripPlaces(t); if (ps.length < 3) return;
    const out = [ps.shift()];
    while (ps.length) { const last = out[out.length - 1]; ps.sort((a, b) => km(last, a) - km(last, b)); out.push(ps.shift()); }
    t.ids = out.map((p) => p.id);
  }
  $("#btnTrips").onclick = () => openTrips();
  function openTrips() {
    const trips = [...state.trips].sort((a, b) => (a.date || "9").localeCompare(b.date || "9"));
    openModal(`<div class="modal-head"><h2>🗓 Day trips</h2><button data-close>✕</button></div>
      <p>Plan a day out: add places from a place's panel (<b>Add to a trip</b>), then put them in order and open the route in Google Maps.</p>
      <p><button class="primary" id="tripNew">＋ New trip</button></p>
      ${trips.map((t) => { const ps = tripPlaces(t); return `<div class="entry"><h3 data-trip="${t.id}">${esc(t.name)}</h3>
        <div class="meta">${esc(t.date || "no date")} · ${ps.length} stop${ps.length === 1 ? "" : "s"} · ${fmtKm(tripKm(ps))} as the crow flies</div></div>`; }).join("") || "<p>No trips yet.</p>"}`);
    $("#tripNew").onclick = () => {
      const name = prompt("Name this day trip:", "Day trip"); if (!name) return;
      const t = { id: "t-" + uid(), name, date: "", ids: [], t: Date.now() }; state.trips.push(t); save(); openTrip(t.id);
    };
    $("#modalBody").onclick = (e) => { const h = e.target.closest("[data-trip]"); if (h) openTrip(h.dataset.trip); };
  }
  function openTrip(tid) {
    const t = state.trips.find((x) => x.id === tid); if (!t) return openTrips();
    const ps = tripPlaces(t);
    openModal(`<div class="modal-head"><h2>🗓 <input type="text" id="tripName" value="${esc(t.name)}" class="inline"></h2><button data-close>✕</button></div>
      <p><label class="lbl">Date</label><input type="date" id="tripDate" value="${esc(t.date || "")}"></p>
      <ol class="stops">${ps.map((p, i) => `<li><span><b>${esc(p.name)}</b><small>${esc(p.city || "")}${i ? ` · ${fmtKm(km(ps[i - 1], p))} from previous` : ""}</small></span>
        <span class="links"><button data-mv="${i}" data-d="-1" ${i ? "" : "disabled"}>↑</button><button data-mv="${i}" data-d="1" ${i < ps.length - 1 ? "" : "disabled"}>↓</button><button data-rm="${i}">✕</button></span></li>`).join("") || "<p>No stops yet. Open a place and use <b>Add to a trip</b>.</p>"}</ol>
      <p class="meta">${ps.length} stops · ${fmtKm(tripKm(ps))} as the crow flies${ps.length > 10 ? " · Google Maps shows the first 10 stops" : ""}</p>
      <p class="links">
        <button id="tripShow" ${ps.length ? "" : "disabled"}>🗺 Show on map</button>
        <button id="tripOpt" ${ps.length > 2 ? "" : "disabled"}>✨ Shortest order</button>
        ${ps.length > 1 ? `<a target="_blank" rel="noopener" href="${gmapsRoute(ps)}">Route in Google Maps ↗</a>` : ""}
        <button id="tripBack">← All trips</button>
        <button id="tripDel" class="danger">Delete trip</button></p>`);
    const touch = () => { t.t = Date.now(); save(); };
    $("#tripName").onchange = (e) => { t.name = e.target.value.trim() || t.name; touch(); };
    $("#tripDate").onchange = (e) => { t.date = e.target.value; touch(); };
    $("#tripShow").onclick = () => { closeModal(); det.hidden = true; selected = null; drawTrip(t); };
    $("#tripOpt").onclick = () => { optimise(t); touch(); openTrip(t.id); };
    $("#tripBack").onclick = () => openTrips();
    $("#tripDel").onclick = () => { if (!confirm(`Delete "${t.name}"?`)) return; state.trips = state.trips.filter((x) => x !== t); state.tomb.trips.push(t.id); save(); clearTrip(); openTrips(); };
    $("#modalBody").onclick = (e) => {
      const b = e.target.closest("[data-mv],[data-rm]"); if (!b) return;
      if (b.dataset.rm) t.ids.splice(+b.dataset.rm, 1);
      else { const i = +b.dataset.mv, j = i + +b.dataset.d; [t.ids[i], t.ids[j]] = [t.ids[j], t.ids[i]]; }
      touch(); openTrip(t.id);
    };
  }

  // Journal: visited places with reviews, newest first
  $("#btnJournal").onclick = async () => {
    const vis = allPlaces().filter((p) => state.user[p.id]?.visited || state.user[p.id]?.review)
      .sort((a, b) => (state.user[b.id].date || "").localeCompare(state.user[a.id].date || ""));
    const photos = await allPhotos();
    const byPlace = {}; photos.forEach((r) => (byPlace[r.placeId] ||= []).push(r));
    openModal(`<div class="modal-head"><h2>📔 My journal</h2><button data-close>✕</button></div>
      ${vis.length ? "" : "<p>Nothing here yet. Tick <b>Visited</b> on a place and write a few lines — it'll show up here.</p>"}
      ${vis.map((p) => { const x = state.user[p.id]; return `<div class="entry">
        <h3 data-open="${p.id}">${esc(p.name)} ${x.rating ? `<span style="color:var(--want)">${"★".repeat(x.rating)}</span>` : ""}</h3>
        <div class="meta">${esc(x.date || "no date")} · ${esc([p.city, p.country].filter(Boolean).join(", "))} · ${esc(cat(p.category).label)}${(x.tags || []).map((t) => ` <span class="tag">${esc(t)}</span>`).join("")}</div>
        ${x.review ? `<p>${esc(x.review)}</p>` : ""}
        <div class="thumbs">${(byPlace[p.id] || []).map((r) => `<img src="${URL.createObjectURL(r.blob)}" data-lb>`).join("")}</div></div>`; }).join("")}`);
    $("#modalBody").onclick = (e) => {
      if (e.target.dataset.open) { closeModal(); openDetail(e.target.dataset.open); }
      if (e.target.matches("img[data-lb]")) lightbox(e.target.src);
    };
  };

  // Backup / restore / exports
  $("#btnBackup").onclick = async () => {
    const n = (await allPhotos()).length;
    openModal(`<div class="modal-head"><h2>💾 Backup & export</h2><button data-close>✕</button></div>
      <p>${window.TroglogSync?.signedIn() ? "Your journal is synced privately to your account, and a copy is kept on this device." : "Your ticks, reviews and photos are stored <b>only in this browser on this device</b> — nobody visiting the site can see them. Turn on <b>☁ Sync</b> to keep all your devices up to date, or move them with a backup."}
      A backup file is still a good extra safety net.</p>
      <p><button class="primary" id="bkExport">⬇ Download full backup (.json, ${n} photo${n === 1 ? "" : "s"})</button></p>
      <p><button id="bkImport">⬆ Restore from backup…</button></p>
      <h3>Export for other apps</h3>
      <p><button id="exKml">Google My Maps (.kml) — current filter</button> <button id="exCsv">Spreadsheet (.csv) — current filter</button></p>
      <h3>Other</h3>
      <p><button id="bkUnhide" ${state.hidden.length ? "" : "disabled"}>Restore ${state.hidden.length} hidden place(s)</button>
      <button id="bkTheme">Toggle light/dark</button></p>
      <p><button id="bkWipe" class="danger">Erase everything on this device</button></p>`);
    $("#bkExport").onclick = exportBackup;
    $("#bkImport").onclick = () => $("#importInput").click();
    $("#exKml").onclick = () => download("my-places.kml", toKML(allPlaces().filter(matches)), "application/vnd.google-earth.kml+xml");
    $("#exCsv").onclick = () => download("my-places.csv", toCSV(allPlaces().filter(matches)), "text/csv");
    $("#bkUnhide").onclick = () => { state.hidden = []; state.hiddenT = Date.now(); save(); closeModal(); buildFilterUI(); render(); };
    $("#bkTheme").onclick = () => {
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      const cur = document.documentElement.dataset.theme || (dark ? "dark" : "light");
      document.documentElement.dataset.theme = cur === "dark" ? "light" : "dark";
      try { localStorage.setItem("travel-journal.theme", document.documentElement.dataset.theme); } catch {}
    };
    $("#bkWipe").onclick = async () => {
      if (!confirm("Erase all ticks, reviews and photos on this device? (Your synced account copy is kept.) Download a backup first!")) return;
      if (prompt('Type ERASE to confirm') !== "ERASE") return;
      window.TroglogSync?.signOut(true);
      state = blank(); seedDefaults(); save(); await clearPhotos(); closeModal(); buildFilterUI(); render();
    };
  };

  async function exportBackup() {
    const photos = await allPhotos();
    const out = { app: "travel-journal", version: 1, exportedAt: new Date().toISOString(), state,
      photos: await Promise.all(photos.map(async ({ id, blob, ...r }) => ({ ...r, data: await blobToDataURL(blob) }))) };
    download(`troglog-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out), "application/json");
  }

  $("#importInput").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== "travel-journal") throw new Error("Not a Travel Journal backup file.");
      if (!confirm(`Restore backup from ${data.exportedAt?.slice(0, 10)}? This REPLACES what's on this device.`)) return;
      state = normalize(data.state); seedDefaults(); save();
      await clearPhotos();
      for (const { data: d, ...p } of data.photos || []) await addPhoto({ ...p, blob: await dataURLToBlob(d) });
      closeModal(); buildFilterUI(); render(); alert("Restored ✓");
    } catch (err) { alert("Restore failed: " + err.message); }
  });

  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function toKML(list) {
    const x = (s) => esc(s);
    const folder = (title, items) => items.length ? `<Folder><name>${x(title)}</name>${items.map((p) => {
      const s = state.user[p.id] || {};
      const desc = [cat(p.category).label, p.note, s.rating ? "★".repeat(s.rating) : "", s.date ? "Visited " + s.date : ""].filter(Boolean).join("\n");
      return `<Placemark><name>${x(p.name)}</name><description>${x(desc)}</description><Point><coordinates>${p.lng},${p.lat},0</coordinates></Point></Placemark>`;
    }).join("")}</Folder>` : "";
    const v = list.filter((p) => state.user[p.id]?.visited), w = list.filter((p) => !state.user[p.id]?.visited && state.user[p.id]?.want), o = list.filter((p) => !state.user[p.id]?.visited && !state.user[p.id]?.want);
    return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>My places</name>${folder("Visited", v)}${folder("Want to go", w)}${folder("Other saved", o)}</Document></kml>`;
  }
  function toCSV(list) {
    const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    return "Name,Category,City,Country,Latitude,Longitude,Want,Visited,Date,Rating,Tags,Review\n" + list.map((p) => {
      const s = state.user[p.id] || {};
      return [p.name, cat(p.category).label, p.city, p.country, p.lat, p.lng, s.want ? "yes" : "", s.visited ? "yes" : "", s.date, s.rating, (s.tags || []).join("; "), s.review].map(q).join(",");
    }).join("\n");
  }

  // ---------- wire up sidebar ----------
  $("#search").addEventListener("input", (e) => { filt.q = e.target.value.trim().toLowerCase(); render(); });
  $("#statusFilter").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    filt.status = b.dataset.v; document.querySelectorAll("#statusFilter button").forEach((x) => x.classList.toggle("on", x === b)); render();
  });
  $("#countryFilter").onchange = (e) => { filt.country = e.target.value; buildFilterUI(); render(); };
  $("#cityFilter").onchange = (e) => { filt.city = e.target.value; render(); fitVisible(); };
  $("#tagFilter").onchange = (e) => { filt.tag = e.target.value; render(); };
  let hereMarker = null;
  $("#btnNear").onclick = () => {
    const b = $("#btnNear");
    if (filt.sort === "near") { filt.sort = "name"; b.classList.remove("on"); render(); return; }
    if (!navigator.geolocation) return alert("This browser can't share your location.");
    b.textContent = "📍 Locating…";
    navigator.geolocation.getCurrentPosition((pos) => {
      here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      filt.sort = "near"; b.classList.add("on"); b.textContent = "📍 Near me";
      hereMarker?.remove();
      hereMarker = L.circleMarker([here.lat, here.lng], { radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }).addTo(map).bindTooltip("You are here");
      render();
      const near = allPlaces().filter(matches).map((p) => [p.lat, p.lng, km(here, p)]).sort((a, c) => a[2] - c[2]).slice(0, 5);
      map.fitBounds(L.latLngBounds([[here.lat, here.lng], ...near.map((x) => [x[0], x[1]])]).pad(0.2), { maxZoom: 14 });
      $("#list").scrollTop = 0;
    }, (err) => { b.textContent = "📍 Near me"; alert("Couldn't get your location: " + err.message); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  };
  $("#catFilter").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    const k = b.dataset.k; filt.cats.has(k) ? filt.cats.delete(k) : filt.cats.add(k); buildFilterUI(); render();
  });
  $("#catFilter").addEventListener("dblclick", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    const k = b.dataset.k; const solo = filt.cats.size === 1 && filt.cats.has(k);
    filt.cats = solo ? new Set(Object.keys(CATS).concat("other")) : new Set([k]); buildFilterUI(); render();
  });
  $("#list").addEventListener("click", (e) => {
    const li = e.target.closest("li"); if (!li) return;
    const cb = e.target.closest("input[type=checkbox]");
    if (cb) { setFlag(li.dataset.id, cb.dataset.f, cb.checked); if (selected === li.dataset.id) openDetail(selected); return; }
    if (e.target.closest("label")) return;
    openDetail(li.dataset.id);
  });
  $("#mobileToggle").onclick = () => {
    const open = $("#sidebar").classList.toggle("open");
    $("#mobileToggle").textContent = open ? "🗺 Map" : "☰ List";
  };
  function fitVisible() {
    const pts = allPlaces().filter(matches).map((p) => [p.lat, p.lng]);
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 14 });
  }

  // Hooks for sync.js
  window.Troglog = {
    getState: () => state,
    setState: (s) => { state = normalize(s); seedDefaults(); try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} buildFilterUI(); render(); if (selected && !det.contains(document.activeElement)) openDetail(selected); },
    photos: { all: allPhotos, put: putPhoto, add: (r) => tx("readwrite", (s) => s.add(r)), remove: (id) => tx("readwrite", (s) => s.delete(id)) },
    openModal, closeModal, esc,
    wipeLocal: async () => { state = blank(); seedDefaults(); try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} await clearPhotos(); det.hidden = true; selected = null; buildFilterUI(); render(); },
  };

  try { const t = localStorage.getItem("travel-journal.theme"); if (t) document.documentElement.dataset.theme = t; } catch {}
  buildFilterUI();
  render();
  map.fitBounds([[26, 127], [44, 145]]);
})();
