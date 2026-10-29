# Troglog: a troglodyte's log of the world

A private map journal. You can tick places as **want** or **been**, rate them, write reviews, attach photos and add places anywhere in the world.

```
site/        ← the web app (published automatically to GitHub Pages)
exports/     ← japan-places.kml / .csv (for Google My Maps); render_overview.py makes a summary image
tools/       ← build_data.py (the master place list) and render_overview.py
```

## Features
- Map of all places with themes, want/been ticks, 1–5★ ratings, visit dates, private reviews, tags (e.g. "with friends") and photos.
- **Photos** fill in the visit date from the photo, and can fix an approximate pin or create a new place from where the photo was taken.
- **📍 Near me** sorts the list by distance from where you are.
- **🗓 Trips**: plan a day out, put the stops in order (or let it find the shortest order) and open the route in Google Maps.
- **Install as an app**: on your phone, Share → *Add to Home Screen*. It works offline, including map areas you've already looked at.
- **☁ Sync** (optional): private login, end-to-end encryption with a passphrase, and automatic sync across all your devices. See [SETUP-SYNC.md](SETUP-SYNC.md).
- Overview stats, a journal view, backup/restore and KML/CSV export.

## Privacy model
- The **place list** (`site/places.js`) and the code are public, because the site is on GitHub Pages.
- Your **ticks, dates, reviews, tags, trips and photos are never put in this repo**. Without sync they stay in the browser on each device.
  With sync they're encrypted on your device with a passphrase and kept in your own Supabase project, which only your login can reach and only your passphrase can read.
- `robots` is set to `noindex`, so search engines are asked not to list the site.
- The map and sync libraries are copied into `site/vendor/`, so no third-party script runs on the page.
- Signing out keeps the local copy; use **Sign out and erase this device** on a shared computer.

## Hosting
Every push to `main` publishes `site/` to the `gh-pages` branch (`.github/workflows/pages.yml`), and GitHub Pages serves it at
`https://cbct-2026.github.io/troglog/`.
To run it locally: `python -m http.server 8765 --directory site`.

## Import into Google Maps
Go to Google **My Maps** (mymaps.google.com) → Create new map → Import → `exports/japan-places.kml`. Each theme becomes its own layer with its own colour. The map then shows up in the Google Maps app under *Saved → Maps*.
Apple Maps can't import files. Use the 🍎 *Apple Maps* button on each place in the app instead.

## Editing the master list
Edit `tools/build_data.py`, then run `python tools/build_data.py` (and `python tools/render_overview.py` for the image).
Places you add inside the app are saved with your journal (synced if sync is on) and included in the backup file.
