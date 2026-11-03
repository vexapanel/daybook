# Progress

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
