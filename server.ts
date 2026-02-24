
import express from "express";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import { createProxyMiddleware } from "http-proxy-middleware";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());

  // Proxy for CM360 API to avoid CORS issues
  // This handles all methods, headers, and bodies (including multipart uploads)
  app.use("/api/cm360", createProxyMiddleware({
    target: "https://www.googleapis.com/dfareporting/v4",
    changeOrigin: true,
    pathRewrite: {
      "^/api/cm360": "", // remove /api/cm360 from the path
    },
    onProxyReq: (proxyReq, req, res) => {
      // If it's an upload, we might need to change the target dynamically
      // but for now let's handle the main API.
      // Actually, let's handle the upload domain too.
      if (req.url?.includes("/upload/")) {
        // This is a bit tricky with http-proxy-middleware in a single middleware
        // We'll handle it by having two separate proxies if needed.
      }
    },
    logLevel: "debug",
  }));

  // Separate proxy for uploads if they go to a different domain
  app.use("/api/cm360-upload", createProxyMiddleware({
    target: "https://dfareporting.googleapis.com",
    changeOrigin: true,
    pathRewrite: {
      "^/api/cm360-upload": "",
    },
    logLevel: "debug",
  }));

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
