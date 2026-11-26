import { extractAuthUser } from './auth';

const PHP_API_BASE = process.env.PHP_API_URL || 'http://php-api';

export async function proxyToPhp(
  req: Request,
  targetScript: string,
  actionOverride?: string,
  extraParams?: Record<string, string>
): Promise<Response> {
  const url = new URL(req.url);
  const user = extractAuthUser(req);

  // KK-15: seluruh endpoint legacy membutuhkan login. Request anonim berhenti di gerbang,
  // tidak diteruskan ke PHP tanpa identitas (dulu PHP lalu menebak peran "customer").
  if (!user) {
    return Response.json(
      { success: false, error: 'Akses ditolak: Harap login terlebih dahulu' },
      { status: 401 }
    );
  }

  // Teruskan query params
  const targetUrl = new URL(`${PHP_API_BASE}/${targetScript}`);
  url.searchParams.forEach((val, key) => {
    targetUrl.searchParams.set(key, val);
  });

  if (actionOverride) {
    targetUrl.searchParams.set('action', actionOverride);
  }

  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      targetUrl.searchParams.set(k, v);
    }
  }

  // Header dibangun baru: header X-User-* kiriman klien tidak pernah ikut diteruskan.
  const headers = new Headers();
  headers.set('Content-Type', req.headers.get('Content-Type') || 'application/json');
  headers.set('X-User-Id', String(user.id));
  headers.set('X-User-Role', user.role);
  headers.set('X-Tenant-Id', String(user.tenant_id));

  const method = req.method;
  let body: any = undefined;

  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    try {
      body = await req.text();
    } catch {
      body = undefined;
    }
  }

  try {
    const phpRes = await fetch(targetUrl.toString(), {
      method,
      headers,
      body,
    });

    const resBody = await phpRes.text();
    const contentType = phpRes.headers.get('Content-Type') || 'application/json';

    return new Response(resBody, {
      status: phpRes.status,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    // KK-16: alamat & galat jaringan internal hanya ke log.
    console.error('[proxy] gagal menghubungi PHP legacy:', error);
    return Response.json({
      success: false,
      error: 'Layanan sedang tidak tersedia',
    }, { status: 502 });
  }
}
