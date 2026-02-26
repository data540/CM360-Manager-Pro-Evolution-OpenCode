const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "accept-encoding",
  "content-encoding",
]);

const readRawBody = async (req: any): Promise<Buffer | undefined> => {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
};

const buildUpstreamUrl = (req: any, targetBase: string) => {
  const pathParts = req.query?.path;
  const path = Array.isArray(pathParts) ? pathParts.join("/") : String(pathParts || "");

  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(req.query || {})) {
    if (key === "path" || rawValue == null) continue;
    if (Array.isArray(rawValue)) {
      rawValue.forEach((v) => params.append(key, String(v)));
    } else {
      params.append(key, String(rawValue));
    }
  }

  const base = targetBase.endsWith("/") ? targetBase.slice(0, -1) : targetBase;
  const withPath = path ? `${base}/${path}` : base;
  const queryString = params.toString();
  return queryString ? `${withPath}?${queryString}` : withPath;
};

export const proxyRequest = async (req: any, res: any, targetBase: string) => {
  try {
    const upstreamUrl = buildUpstreamUrl(req, targetBase);

    const headers = new Headers();
    Object.entries(req.headers || {}).forEach(([key, value]) => {
      if (!value || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
      headers.set(key, Array.isArray(value) ? value.join(",") : String(value));
    });

    const body = await readRawBody(req);

    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
    });

    res.status(upstreamRes.status);
    upstreamRes.headers.forEach((value, key) => {
      if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
      res.setHeader(key, value);
    });

    const responseBuffer = Buffer.from(await upstreamRes.arrayBuffer());
    res.send(responseBuffer);
  } catch (error: any) {
    res.status(502).json({
      error: {
        message: error?.message || "Proxy request failed",
      },
    });
  }
};
