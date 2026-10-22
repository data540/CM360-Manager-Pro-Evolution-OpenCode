
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import { handleQuantcastGraphql } from "./api/_quantcast";
import {
  getRunState,
  hasSession,
  isRunning,
  loginInteractively,
  screenshotPath,
  startRun,
  stopRun,
} from "./server/quantcastNativeRunner";

// `tsx` runs this file directly, without Vite's own .env loading, so local secrets
// (QUANTCAST_API_KEY, etc.) from .env.local would otherwise never reach process.env.
// Vercel sets its own env vars directly, and .env.local is git-ignored and absent there,
// so this is a no-op in production.
const loadEnvLocal = () => {
  try {
    const content = fs.readFileSync(path.resolve(".env.local"), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].trim();
    }
  } catch {
    // .env.local is optional.
  }
};
if (process.env.NODE_ENV !== "production") loadEnvLocal();

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

const getRequestBodyBuffer = async (req: express.Request): Promise<Buffer | undefined> => {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
};

const proxyRequest = async (
  req: express.Request,
  res: express.Response,
  targetBase: string,
  prefix: string,
) => {
  try {
    const upstreamPath = req.originalUrl.replace(prefix, "") || "/";
    const upstreamUrl = `${targetBase}${upstreamPath}`;

    const headers = new Headers();
    Object.entries(req.headers).forEach(([key, value]) => {
      if (!value || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
      headers.set(key, Array.isArray(value) ? value.join(",") : value);
    });

    const body = await getRequestBodyBuffer(req);

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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.CM360_PORT) || 3000;

  app.use(cors());

  // CM360 proxy endpoints to avoid browser CORS issues.
  app.use("/api/cm360", (req, res) =>
    proxyRequest(req, res, "https://dfareporting.googleapis.com/dfareporting/v5", "/api/cm360"),
  );

  app.use("/api/cm360-upload", (req, res) =>
    proxyRequest(req, res, "https://dfareporting.googleapis.com", "/api/cm360-upload"),
  );

  app.use("/api/google", (req, res) =>
    proxyRequest(req, res, "https://www.googleapis.com", "/api/google"),
  );

  app.use("/api/dv360", (req, res) =>
    proxyRequest(req, res, "https://displayvideo.googleapis.com/v4", "/api/dv360"),
  );

  // Quantcast is NOT a dumb proxy: it holds its own secret and checks the caller first (see api/_quantcast.ts).
  app.use("/api/quantcast/graphql", (req, res) => handleQuantcastGraphql(req, res));

  // Quantcast native runner: drives a real Chrome with the user's Quantcast session, so it only
  // answers this machine (the server listens on 0.0.0.0) and this app's own origin (cors() above
  // would otherwise let any website the user visits call it).
  const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
  const ownOrigins = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
  app.use("/api/qc-native", (req, res, next) => {
    const origin = req.headers.origin;
    if (!LOOPBACK.has(req.socket.remoteAddress || "") || (origin && !ownOrigins.has(origin))) {
      res.status(403).json({ error: { message: "Solo disponible desde la app en este ordenador." } });
      return;
    }
    next();
  });
  let loginInProgress = false;
  app.get("/api/qc-native/status", (_req, res) => {
    res.json({ available: true, session: hasSession(), loginInProgress, run: getRunState() });
  });
  app.post("/api/qc-native/login", express.json(), async (req, res) => {
    if (loginInProgress || isRunning()) {
      res.status(409).json({ error: { message: "Ya hay una ventana de Quantcast abierta." } });
      return;
    }
    loginInProgress = true;
    try {
      await loginInteractively(String(req.body?.accountId || "9964009").replace(/\D/g, ""));
      res.json({ session: true });
    } catch (error: any) {
      res.status(500).json({ error: { message: `No se completó el inicio de sesión: ${error?.message || error}` } });
    } finally {
      loginInProgress = false;
    }
  });
  app.post("/api/qc-native/run", express.json({ limit: "5mb" }), (req, res) => {
    try {
      res.json(startRun(req.body));
    } catch (error: any) {
      res.status(409).json({ error: { message: error?.message || String(error) } });
    }
  });
  app.post("/api/qc-native/stop", async (_req, res) => {
    await stopRun();
    res.json({ stopped: true });
  });
  app.get("/api/qc-native/screenshot", (req, res) => {
    const file = screenshotPath(String(req.query.run || ""), String(req.query.file || ""));
    if (!file) {
      res.status(404).end();
      return;
    }
    res.sendFile(file);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
