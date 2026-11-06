# Cihan Not Ajanı

Turkish voice work journal and income/expense log for the phone. Static PWA; speech-to-text and text cleanup run on Groq with your own API key. Notes and income/expense entries are also copied one-way to Supabase (see below).

## Run locally
```
python -m http.server 8765
```
Open http://localhost:8765 (the mic works on localhost; on other plain-HTTP addresses browsers block it).

## Put it on the phone
1. Host the folder on any HTTPS static host (GitHub Pages, Netlify, Cloudflare Pages).
2. Open the URL on the phone → browser menu → "Add to Home screen".
3. Gear icon → paste a Groq API key from https://console.groq.com/keys.

Data stays in that browser on that phone. Use Settings → Export backup now and then.

## Cloud copy (Supabase)
- One-time setup: Supabase dashboard → SQL Editor → paste `supabase.sql` → Run. Authentication → "Allow anonymous sign-ins" must be on.
- Each phone signs in anonymously and pushes every change to `items` (notes and income/expense) and its name + phone model to `devices`. It never reads back, so the server can't change the phone's data.
- Deletes on the phone become `deleted = true`; the API can't delete rows.
- See everything in Table Editor → `entries`.
