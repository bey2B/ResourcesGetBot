import { handleAdminApi } from './api/admin';
import type { Env } from './types';
import { serveAssetOrSpa } from './utils/assets';
import { jsonResponse } from './utils/helpers';

const SERVICE_NAME = 'cua-admin';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (url.pathname === '/health') {
      if (method !== 'GET') {
        return methodNotAllowed(['GET']);
      }
      return Response.json({
        ok: true,
        service: SERVICE_NAME,
        time: new Date().toISOString(),
      });
    }

    if (url.pathname === '/api/admin' || url.pathname.startsWith('/api/admin/')) {
      return handleAdminApi(request, env);
    }

    const asset = await serveAssetOrSpa(request, env);
    if (asset) {
      return asset;
    }

    return jsonResponse({ ok: false, error: 'Not Found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function methodNotAllowed(allow: string[]): Response {
  return jsonResponse(
    { ok: false, error: 'Method Not Allowed' },
    {
      status: 405,
      headers: { Allow: allow.join(', ') },
    },
  );
}
