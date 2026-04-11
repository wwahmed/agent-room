// Simple per-IP fixed-window counter using the Workers cache API.

const WINDOW_MS = 60_000;
const LIMIT = 20;

export async function checkRate(req: Request): Promise<boolean> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  const bucket = Math.floor(Date.now() / WINDOW_MS);
  const key = `https://rl.local/${ip}/${bucket}`;
  const cache = await caches.open('rl');
  const hit = await cache.match(key);
  const count = hit ? parseInt(await hit.text(), 10) : 0;
  if (count >= LIMIT) return false;
  const next = new Response(String(count + 1), {
    headers: { 'Cache-Control': `max-age=${Math.ceil(WINDOW_MS / 1000)}` },
  });
  await cache.put(key, next);
  return true;
}
