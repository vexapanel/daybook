// Groq proxy: holds the shared GROQ_KEY as a Supabase secret so the app can transcribe
// and clean up text without every user (or the public repo) carrying the key.
// The app calls it with its anonymous Supabase session, so only app users reach it.
//
// Deploy:
//   1. Settings -> Edge Functions -> add secret  GROQ_KEY = gsk_...
//   2. supabase functions deploy groq         (or paste this in the dashboard)

const GROQ = 'https://api.groq.com/openai/v1';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Everything after .../functions/v1/groq is the Groq path, e.g. /chat/completions.
  const path = new URL(req.url).pathname.replace(/^\/functions\/v1\/groq/, '') || '/chat/completions';
  const ct = req.headers.get('content-type') || '';

  const res = await fetch(GROQ + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + Deno.env.get('GROQ_KEY'), ...(ct && { 'content-type': ct }) },
    body: await req.arrayBuffer(), // small (JSON or a few seconds of audio); buffering keeps multipart boundaries intact
  });

  return new Response(await res.arrayBuffer(), {
    status: res.status,
    headers: { ...cors, 'content-type': res.headers.get('content-type') || 'application/json' },
  });
});
