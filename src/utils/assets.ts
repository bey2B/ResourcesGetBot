import type { Env } from '../types';

/** Serve the admin SPA from Workers Static Assets, with history-mode fallback. */
export async function serveAssetOrSpa(request: Request, env: Env): Promise<Response | null> {
  if (!env.ASSETS) {
    return null;
  }
  const assetResponse = await env.ASSETS.fetch(request);
  if (assetResponse.status !== 404) {
    return assetResponse;
  }
  const url = new URL(request.url);
  const accept = request.headers.get('Accept') ?? '';
  if (request.method === 'GET' && (url.pathname === '/' || accept.includes('text/html'))) {
    return env.ASSETS.fetch(new Request(new URL('/', request.url), request));
  }
  return null;
}
