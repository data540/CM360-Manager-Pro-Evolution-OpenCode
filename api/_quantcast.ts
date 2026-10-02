// Server-only Quantcast GraphQL proxy.
//
// Unlike the CM360/DV360/Google proxies in this folder, this one does NOT just forward the
// caller's own Google OAuth token: Quantcast is authenticated with this app's own API Key/Secret
// (QUANTCAST_API_KEY / QUANTCAST_API_SECRET), which must never reach the browser. So every
// request here is checked first: the caller must present a valid Google access token (the same
// one the app already uses for CM360 login) belonging to an @kpi360.net account, and the request
// body must be a read-only `query` (the Quantcast API has no mutations today, but this is kept as
// a defensive check in case that ever changes).

const ALLOWED_EMAIL_DOMAIN = 'kpi360.net';
const QUANTCAST_TOKEN_URL = 'https://auth.quantcast.com/oauth2/default/v1/token';
const QUANTCAST_GRAPHQL_URL = 'https://developers.quantcast.com/api/v2/graphql';
// Refresh a bit before the token's real expiry so we never race a 403 mid-request.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

const readRawBody = async (req: any): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};

/** Validates the caller's Google access token (the app's own CM360 login token) and returns their email. */
const verifyCaller = async (req: any): Promise<string> => {
  const header = req.headers?.authorization || req.headers?.Authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Falta la cabecera Authorization con el token de Google.');

  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  const info = await res.json().catch(() => ({}));
  if (!res.ok || !info.email) {
    throw new HttpError(401, 'Token de Google inválido o caducado: vuelve a iniciar sesión.');
  }
  if (info.email_verified === false || info.email_verified === 'false') {
    throw new HttpError(403, 'El email de Google asociado al token no está verificado.');
  }
  const email = String(info.email).toLowerCase();
  if (!email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
    throw new HttpError(403, `La revisión de Quantcast solo está disponible para cuentas @${ALLOWED_EMAIL_DOMAIN}.`);
  }
  return email;
};

const getQuantcastToken = async (): Promise<string> => {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const apiKey = process.env.QUANTCAST_API_KEY;
  const apiSecret = process.env.QUANTCAST_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new HttpError(500, 'QUANTCAST_API_KEY / QUANTCAST_API_SECRET no están configuradas en el servidor.');
  }

  const res = await fetch(QUANTCAST_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'api_access' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new HttpError(502, `No se pudo obtener el token de Quantcast: ${data?.error_description || res.statusText}`);
  }
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(0, (Number(data.expires_in) || 3600) * 1000 - TOKEN_REFRESH_MARGIN_MS),
  };
  return cachedToken.value;
};

export const handleQuantcastGraphql = async (req: any, res: any) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Solo se admite POST.' } });
    return;
  }
  try {
    const callerEmail = await verifyCaller(req);

    const raw = await readRawBody(req);
    const body = raw ? JSON.parse(raw) : {};
    const query = typeof body?.query === 'string' ? body.query : '';
    if (!query.trim()) {
      res.status(400).json({ error: { message: 'Falta el campo "query".' } });
      return;
    }
    // Defense in depth: the Quantcast API has no mutations today, but this route must never
    // forward a write operation even if that changes upstream.
    if (/\bmutation\b/i.test(query)) {
      res.status(403).json({ error: { message: 'Esta ruta solo admite consultas de lectura (query).' } });
      return;
    }

    const qcToken = await getQuantcastToken();
    const upstream = await fetch(QUANTCAST_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${qcToken}` },
      body: JSON.stringify({ query, variables: body.variables || {} }),
    });
    const data = await upstream.json().catch(() => ({}));
    console.log(`Quantcast query by ${callerEmail}: ${upstream.status}`);
    res.status(upstream.status).json(data);
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : 500;
    res.status(status).json({ error: { message: error?.message || 'Error desconocido en el proxy de Quantcast.' } });
  }
};
