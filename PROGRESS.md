# Progress

## 2026-11-07 — Trim Settings dialog
- **What:** Removed the backup-status line, the Groq API key field + its hint, and the Model field from Settings (`index.html`, handlers in `app.js`). Settings now has only the silence timeout and backup export/import.
- **Why:** User request; the shared Groq proxy makes per-user keys unnecessary.
- **State:** Verified in headless Chrome: dialog opens with only those controls, saving the silence value works, no JS errors. A key/model already stored on a device is still used (no UI to clear it now); the `#key=` setup link still works.

## 2026-11-06 — Shared Groq key via Supabase Edge Function proxy
- **What:** `supabase/functions/groq/index.ts` forwards `/chat/completions` and `/audio/transcriptions` to Groq with a `GROQ_KEY` secret kept in Supabase (never in the repo/browser), with CORS + OPTIONS handling. `app.js`: `groq()` uses the user's own key if set, otherwise calls the proxy with the phone's anonymous Supabase session. Removed the `GROQ_KEY` source constant — GitHub push protection blocked it and Groq auto-revokes public keys.
- **Why:** Users who install the app shouldn't need their own Groq key, but a public static site can't hold a shared key safely.
- **State:** Wiring verified in headless Chrome: with no user key, `groq()` targets `…/functions/v1/groq…` using a valid anon session; URL routing confirmed (404 until deployed). Verified end-to-end after redeploy: an anonymous session -> proxy -> Groq returns 200 with real content, so keyless users work. (Chat/JSON path tested; the audio/transcription path uses the same forwarding.) Existing users with their own key are unaffected.

## 2026-11-06 — Admin panel (date-grouped view)
- **What:** `admin.html`, a standalone page that reads all users' rows and shows them date by date (newest first): per-day income/expense totals, money and notes split out, person/device labels, filter by person, toggle to show deleted rows. Signs in with an admin email+password via the browser-safe publishable key; `admin-policies.sql` adds an RLS SELECT-all policy keyed to the admin email, so only that account sees everything (it can't write/delete). Session is stored and refreshed; no secret key in the browser (the new `sb_secret_*` keys are blocked in browsers anyway).
- **Why:** The Supabase table grid was hard to read; user wanted a clean day-by-day view. First tried the service_role key but Supabase forbids secret keys in the browser.
- **State:** Rendering/grouping/totals/filter/deleted-toggle and the login error path verified in headless Chrome. Publishable key accepted by the password-grant endpoint. CORS is `*`, so it works as a local `file://`. The admin-sees-all path is not yet verified end-to-end: needs the admin user created (dashboard) and `admin-policies.sql` run.

## 2026-11-06 — Remove welcome dialog and enable shared Groq key
- **What:** Removed `<dialog id="welcome">` from `index.html` and its event/modal handlers in `app.js`. Removed the startup status prompt and error message "Önce Ayarlar'dan (dişli simgesi) Groq API anahtarını ekle.". Added fallback to a central `GROQ_KEY` in `app.js` so a single shared API key can serve all users without requiring individual key entry.
- **Why:** User requested removal of the welcome notice and API key prompt, and requested that the app use a central key for all users instead of asking each user for their own key.
- **State:** Verified syntax with Node.js, verified cleanly loaded in Chrome headless.

## 2026-11-06 — One-way cloud copy to Supabase
- **What:** `supabase.sql` (tables `devices`, `items`, readable view `entries`, row level security, no DELETE grant). `app.js` signs each phone in anonymously and pushes every change after `save()` (also on launch and when back online); only changed items are sent, found by comparing hashes stored in `daybook.synced`. Phone deletes become `deleted = true`, never removed. First launch shows a one-time backup notice (no name asked, at the user's request); Settings shows the last backup time. Phone model is read from `navigator.userAgentData` (Android Chrome), falling back to the user-agent.
- **Why:** User wants data never to be lost and to see who uses the app (phone model) and their notes + income/expense, without touching the data on the phone.
- **State:** Verified end-to-end against the real Supabase project in headless Chrome: a note + tx upload to `items`; editing the note updates the server row; deleting the tx sets `deleted = true` and keeps the row; the device model lands in `devices`. Selftest (incl. `changes()` diff) passes; a failed cloud copy changes nothing locally and retries on the next change/launch/online.

## 2026-11-03 — Turkish UI, auto-stop, "Cihan Not Ajanı" theme
- **What:** App renamed to "Cihan Not Ajanı" (repo/URL stay `daybook`; storage keys unchanged so existing data is kept). UI text is Turkish at the user's explicit request (overrides the English-UI default). Black/yellow/white theme in all system themes; new icons. Recording now stops by itself after 3.5 s of silence (adjustable in Settings), or after 10 s with no speech at all (discarded, nothing sent). Voice detection is energy-based with an adaptive noise floor (`toggleMic` in `app.js`).
- **Why:** User wants hands-free notes without tapping stop, but no cut-off during thinking pauses.
- **State:** Verified in headless Chrome with a WAV fed as the microphone: quiet and noisy (~0.03 RMS background) recordings both stop ~3.5 s after speech ends and do not stop on a 2.5 s mid-sentence pause; silence stops at 10 s with "Ses algılanmadı."; a browser-recorded webm went through real Groq Whisper + LLM and was saved. Not yet tested on a real phone mic or with real Turkish speech.

## 2026-11-03 — GitHub Pages + key setup link
- **What:** Published to https://vexapanel.github.io/daybook/ (repo `vexapanel/daybook`, Pages serves `main` branch root; every push redeploys). Added a one-time setup link: `index.html#key=gsk_…` saves the Groq key and wipes it from the address bar. Default model is now `openai/gpt-oss-120b` (`llama-3.3-70b-versatile` is not available on this Groq account). Transcripts drop Whisper's "Altyazı M.K." silence hallucination. Journal cleanup keeps the speaker's person/tense ("yaptık" no longer becomes "yaptım").
- **Why:** The key must not live on the public site or repo (it would be scraped and abused); a QR code with the key in the URL fragment sets up the phone with no typing, and fragments are never sent to the server.
- **State:** Verified against real Groq in headless Chrome: journal cleanup (~1.5 s) and money extraction (~1 s, 3 items from one sentence) are correct; setup link stores the key and cleans the URL; transcription endpoint returns 200. Not yet tested with a real microphone on the phone.

## 2026-11-03 — Initial version
- **What:** Created Daybook, a phone-first PWA (`index.html`, `style.css`, `app.js`, `sw.js`, manifest, icons).
  - Journal tab: tap mic → Groq Whisper (`whisper-large-v3-turbo`, Turkish) → Groq LLM rewrites the rambling speech into clean diary sentences → saved under the selected date with a time stamp. Notes are editable in place.
  - Money tab: voice/typed note → LLM extracts `in`/`out` items with amounts → daily In/Out/Net tiles plus month totals.
  - Data lives in the phone's `localStorage`; JSON export/import backup in Settings. Groq API key is entered in Settings and never stored in code.
  - Failure handling: journal saves the raw transcript if the LLM fails; money keeps the text in the input; failed transcriptions keep the audio for "Retry".
- **Why:** Simplest way to get a voice journal + income/expense log on a phone with no app store, no backend.
- **State:** Verified in headless Chrome (mobile viewport, light/dark): selftest (`#selftest`) passes, journal/money flows work with a stubbed Groq, a real request to Groq from the page passes CORS and returns a readable "Invalid API Key" error. Not yet tested with a real key, a real microphone, or on an actual phone. Not deployed yet; needs HTTPS hosting (e.g. GitHub Pages) for the mic to work on a phone.
