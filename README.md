# Troglog: a troglodyte's log of the world

A private map journal. You can tick places as **want** or **been**, rate them, write reviews, attach photos and add places anywhere in the world.

```
site/        ← the web app (upload this folder to GitHub Pages / Netlify / Cloudflare Pages)
exports/     ← japan-places.kml / .csv (for Google My Maps), japan-overview.png (summary graphic)
tools/       ← build_data.py (the master place list) and render_overview.py
```

## Privacy model
- The **place list** (`site/places.js`) is public if the site is public.
- Your **ticks, reviews and photos are never uploaded**. They live in the browser on each device: localStorage for text, IndexedDB for photos. Someone else who opens the site sees a blank journal.
- Because the data stays on the device, use **💾 Backup → Download full backup** regularly, and use it to move between phone and laptop.

## Deploy to GitHub Pages (about 5 minutes)
1. Create a new GitHub repo, `troglog`.
2. Upload the *contents* of `site/` (index.html, app.js, styles.css, places.js) to the repo root.
3. Repo → Settings → Pages → Source: *Deploy from branch* → `main` / root → Save.
4. Open `https://<username>.github.io/troglog/` on your phone, then use Share → **Add to Home Screen**.

Want even the place list to be private? Use **Cloudflare Pages + Cloudflare Access** (free, email-code login). You can also open `site/index.html` from a local web server.

## Import into Google Maps
Go to Google **My Maps** (mymaps.google.com) → Create new map → Import → `exports/japan-places.kml`. Each theme becomes its own layer with its own colour. The map then shows up in the Google Maps app under *Saved → Maps*.
Apple Maps can't import files. Use the 🍎 *Apple Maps* button on each place in the app instead.

## Editing the master list
Edit `tools/build_data.py`, then run `python tools/build_data.py` (and `python tools/render_overview.py` for the image).
Places you add inside the app are saved on that device only, and they're included in the backup file.
