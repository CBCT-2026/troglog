# Turn on private sync (about 10 minutes, once)

Sync stores your ticks, visit dates, reviews, tags, trips and photos in **your own free Supabase project**.
Only your account can read or write it. Every device you sign in on stays up to date, and the app still works offline.

1. **Create the project.** Go to [supabase.com](https://supabase.com) → *Start your project* → sign in with GitHub →
   *New project*. Name it `troglog`, pick a strong database password (you won't need it again), choose the region
   closest to you (e.g. *Northeast Asia (Tokyo)* or *Southeast Asia (Sydney)*), then *Create*.
2. **Create the tables.** Left menu → *SQL Editor* → *New query*. Paste everything from
   [`supabase/setup.sql`](supabase/setup.sql) and press *Run*. It should say "Success. No rows returned".
3. **Create your login.** Left menu → *Authentication* → *Users* → *Add user* → *Create new user*.
   Enter your email and a password and tick *Auto Confirm User*.
4. **Lock it to just you.** *Authentication* → *Sign In / Providers* (or *Settings*) → turn **off** *Allow new users to sign up* → *Save*.
5. **Connect the app.** *Project Settings* → *API* (or *Data API*). Copy the **Project URL** and the **anon public** key.
   Either send them to Claude to put in `site/config.js` (they're safe to publish, the security comes from your login),
   or open Troglog → **☁ Sync** and paste them there (you'd do that once per device).
6. Open Troglog and **sign in**. On your first device you'll be asked to **choose a passphrase**; on every other device you type that same passphrase once. Anything already on that device is merged into your account.

## End-to-end encryption
Everything is encrypted on your device with your passphrase before it's uploaded (AES-256-GCM, key derived with PBKDF2).
Supabase, and anyone who gets into your Supabase dashboard, only ever sees scrambled data.
The passphrase is never put in the code or on the server. **If you forget it, nobody can recover the journal**, so keep a
backup file (💾 Backup) somewhere safe: backup files are plain, readable copies.

## Good to know
- With sync on, the site shows a sign-in screen until you sign in (`lockWhenSignedOut` in `config.js`), then asks for the passphrase once per device.
  The 84-place list itself is still in the public code; your journal is not.
- Free Supabase projects pause after a week with no activity. Opening the app wakes it, or press *Restore* in the dashboard.
- Free storage is 1 GB; photos are shrunk to about 300 KB each, so that's roughly 3,000 photos.
- Backups (💾) still work and include everything.
