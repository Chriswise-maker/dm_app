console.log('[IMPORT START] Loading modules...');
import "dotenv/config";
console.log('[IMPORT] dotenv loaded');
import express from "express";
console.log('[IMPORT] express loaded');
import { createServer } from "http";
import net from "net";
console.log('[IMPORT] http/net loaded');
import { createExpressMiddleware } from "@trpc/server/adapters/express";
console.log('[IMPORT] trpc loaded');
import { registerOAuthRoutes } from "./oauth";
console.log('[IMPORT] oauth loaded');
import { appRouter } from "../routers";
console.log('[IMPORT] appRouter loaded');
import { createContext } from "./context";
console.log('[IMPORT] context loaded');
import { serveStatic, setupVite } from "./vite";
console.log('[IMPORT] vite loaded');
console.log('[IMPORT END] All modules loaded!');

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  console.log('[1] Starting server...');
  const app = express();
  console.log('[2] Express created');
  const server = createServer(app);
  console.log('[3] HTTP server created');
  
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  console.log('[4] Body parser configured');
  
  // OAuth callback under /api/oauth/callback
  console.log('[5] Registering OAuth routes...');
  registerOAuthRoutes(app);
  console.log('[6] OAuth routes registered');
  
  // tRPC API
  console.log('[7] Setting up tRPC...');
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  console.log('[8] tRPC configured');
  
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    console.log('[9] Setting up Vite...');
    await setupVite(app, server);
    console.log('[10] Vite setup complete');
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  console.log(`[Server] Found available port: ${port}`);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
