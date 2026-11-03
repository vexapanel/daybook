# Cihan Not Ajanı

Turkish voice work journal and income/expense log for the phone. Static PWA, no backend; speech-to-text and text cleanup run on Groq with your own API key.

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
