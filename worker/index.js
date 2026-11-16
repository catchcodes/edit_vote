/**
 * Vote collector for the static PIE-Bench evaluation page on GitHub Pages.
 *
 * GitHub Pages cannot accept POST requests, so this Worker is the minimal
 * server-side piece. It is free-tier sufficient (100k requests/day) and needs
 * no server to keep running.
 *
 * Storage: Cloudflare KV, one key per vote.
 *
 *   key   votes/<ISO-timestamp>-<random>      (sortable by time)
 *   value the JSON body the page sent
 *
 * Deploy
 *   npm create cloudflare@latest -- pie-votes
 *   # replace src/index.js with this file
 *   npx wrangler kv namespace create VOTES
 *   # put the returned id into wrangler.toml:
 *   #   [[kv_namespaces]]
 *   #   binding = "VOTES"
 *   #   id = "<the id>"
 *   npx wrangler deploy
 *
 * Then rebuild the page with that URL:
 *   python build_public_site.py --endpoint https://pie-votes.<acct>.workers.dev/
 *
 * Read the votes back
 *   npx wrangler kv key list --namespace-id <id> --prefix votes/
 *   curl "https://pie-votes.<acct>.workers.dev/export?token=<EXPORT_TOKEN>"
 *
 * Security notes
 *   - CORS is pinned to ALLOWED_ORIGIN, not "*", so other sites cannot post
 *     into your dataset.
 *   - EXPORT_TOKEN guards the read endpoint. Set both as secrets:
 *       npx wrangler secret put EXPORT_TOKEN
 *   - The endpoint accepts only the fields the page sends; anything else is
 *     dropped, so a malicious client cannot inject arbitrary keys.
 */

const MAX_BODY = 8 * 1024;          // a vote is ~400 bytes; 8 KB is generous
const FIELDS = ["rater", "sid", "sample_id", "slots", "esr",
                "best_slot", "best_model", "ts"];

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors(origin) },
  });
}

export default {
  async fetch(req, env) {
    const origin = env.ALLOWED_ORIGIN || "*";
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    // ---- read back ---------------------------------------------------
    if (req.method === "GET" && url.pathname === "/export") {
      if (!env.EXPORT_TOKEN || url.searchParams.get("token") !== env.EXPORT_TOKEN) {
        return json({ error: "forbidden" }, 403, origin);
      }
      const out = [];
      let cursor;
      do {
        const page = await env.VOTES.list({ prefix: "votes/", cursor });
        for (const k of page.keys) {
          out.push(JSON.parse(await env.VOTES.get(k.name)));
        }
        cursor = page.cursor;
      } while (cursor);
      return new Response(out.map((v) => JSON.stringify(v)).join("\n") + "\n", {
        headers: { "content-type": "application/x-ndjson", ...cors(origin) },
      });
    }

    if (req.method !== "POST") {
      return json({ error: "method not allowed" }, 405, origin);
    }

    // ---- accept a vote -----------------------------------------------
    const len = Number(req.headers.get("content-length") || 0);
    if (len > MAX_BODY) return json({ error: "too large" }, 413, origin);

    let body;
    try {
      const text = await req.text();
      if (text.length > MAX_BODY) return json({ error: "too large" }, 413, origin);
      body = JSON.parse(text);
    } catch {
      return json({ error: "bad json" }, 400, origin);
    }

    // keep only known fields, and require the ones a vote cannot omit
    const rec = {};
    for (const f of FIELDS) if (f in body) rec[f] = body[f];
    if (!rec.rater || !rec.sample_id || typeof rec.esr !== "object") {
      return json({ error: "missing rater/sample_id/esr" }, 400, origin);
    }

    const stamp = new Date().toISOString();
    const key = `votes/${stamp}-${Math.random().toString(36).slice(2, 10)}`;
    // 180 days: long enough for a review cycle, short enough to stay tidy
    await env.VOTES.put(key, JSON.stringify({ ...rec, received: stamp }), {
      expirationTtl: 60 * 60 * 24 * 180,
    });

    return json({ ok: true, key }, 200, origin);
  },
};
