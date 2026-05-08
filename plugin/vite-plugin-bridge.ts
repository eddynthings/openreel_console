/**
 * OpenReel Console — Vite Plugin (Bridge Server)
 *
 * Starts a combined WebSocket + HTTP server on port 7175 that acts as a relay
 * between terminal clients (Claude Code / openreel-sdk.mjs) and the browser
 * running the OpenReel editor.
 *
 * Flow:
 *   Terminal → WS:7175 → Plugin → browser → dev-bridge.ts → Zustand store → response → Terminal
 *
 * Server-only commands (handled here, never forwarded to browser):
 *   reloadBrowser      Triggers a Vite full-page reload
 *   registerAssetRoot  Maps a key → local directory for HTTP file serving
 *   listAssetRoots     Returns the current key → directory map
 *
 * HTTP asset server:
 *   GET /assets/<key>/<path>  Serves a file from the registered directory for <key>
 *
 * Installation:
 *   1. Copy this file to <openreel-project>/apps/web/vite-plugin-bridge.ts
 *   2. In vite.config.ts add:
 *        import { openreelBridgePlugin } from "./vite-plugin-bridge";
 *        plugins: [react(), openreelBridgePlugin()]
 */

import type { Plugin } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { createReadStream, statSync } from "fs";
import { join, extname } from "path";

const BRIDGE_PORT = 7175;

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
};

// key → absolute directory on disk
// Registered at runtime via the "registerAssetRoot" WS command — no restart needed.
const assetRoots = new Map<string, string>();

export function openreelBridgePlugin(): Plugin {
  const browserClients = new Set<WebSocket>();
  const pendingRequests = new Map<
    string,
    { resolve: (r: unknown) => void; timer: ReturnType<typeof setTimeout> }
  >();
  let wss: WebSocketServer;

  return {
    name: "openreel-bridge",
    apply: "serve",

    configureServer(server) {
      const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = req.url ?? "/";

        // Serve registered asset roots under /assets/<key>/path
        const match = url.match(/^\/assets\/([^/]+)(\/.+)$/);
        if (match) {
          const [, key, rest] = match;
          const root = assetRoots.get(key);
          if (root) {
            const filePath = join(root, rest);
            const ext = extname(filePath).toLowerCase();
            const mime = MIME[ext] ?? "application/octet-stream";
            try {
              const stat = statSync(filePath);
              res.writeHead(200, {
                "Content-Type": mime,
                "Content-Length": stat.size,
                "Access-Control-Allow-Origin": "*",
              });
              createReadStream(filePath).pipe(res);
              return;
            } catch {
              res.writeHead(404);
              res.end("Not found");
              return;
            }
          }
        }

        res.writeHead(404);
        res.end("Not found");
      });

      wss = new WebSocketServer({ server: httpServer });

      wss.on("connection", (ws, req) => {
        const ua = req.headers["user-agent"] ?? "";
        const isBrowser = ua.includes("Mozilla");

        if (isBrowser) {
          // Close stale connections so only the freshest browser tab handles commands.
          for (const stale of browserClients) {
            stale.close();
          }
          browserClients.clear();
          browserClients.add(ws);

          ws.on("close", () => browserClients.delete(ws));

          // Responses coming back from the browser
          ws.on("message", (raw) => {
            try {
              const msg = JSON.parse(raw.toString()) as { id?: string };
              if (msg.id && pendingRequests.has(msg.id)) {
                const pending = pendingRequests.get(msg.id)!;
                pendingRequests.delete(msg.id);
                clearTimeout(pending.timer);
                pending.resolve(msg);
              }
            } catch {
              // ignore malformed responses
            }
          });
        } else {
          // Terminal / SDK client
          ws.on("message", (raw) => {
            const payload = raw.toString();

            let msg: { id?: string; command?: string; args?: Record<string, unknown> } = {};
            try {
              msg = JSON.parse(payload);
            } catch {
              ws.send(JSON.stringify({ ok: false, error: "Invalid JSON" }));
              return;
            }

            // ── Server-only commands ──────────────────────────────────────────
            if (msg.command === "reloadBrowser") {
              server.ws.send({ type: "full-reload" });
              if (msg.id) ws.send(JSON.stringify({ id: msg.id, ok: true }));
              return;
            }

            if (msg.command === "registerAssetRoot") {
              const { key, dir } = (msg.args ?? {}) as { key: string; dir: string };
              if (!key || !dir) {
                if (msg.id)
                  ws.send(
                    JSON.stringify({ id: msg.id, ok: false, error: 'registerAssetRoot requires args: { key, dir }' }),
                  );
                return;
              }
              assetRoots.set(key, dir);
              if (msg.id)
                ws.send(
                  JSON.stringify({
                    id: msg.id,
                    ok: true,
                    url: `http://localhost:${BRIDGE_PORT}/assets/${key}/`,
                  }),
                );
              return;
            }

            if (msg.command === "listAssetRoots") {
              const roots = Object.fromEntries(assetRoots);
              if (msg.id) ws.send(JSON.stringify({ id: msg.id, ok: true, result: roots }));
              return;
            }

            // ── Fan-out to all connected browser clients ───────────────────
            let sent = 0;
            for (const browser of browserClients) {
              if (browser.readyState === WebSocket.OPEN) {
                browser.send(payload);
                sent++;
              }
            }

            if (sent === 0) {
              ws.send(
                JSON.stringify({
                  id: msg.id,
                  ok: false,
                  error: "No browser connected — open OpenReel in your browser first",
                }),
              );
              return;
            }

            // Wait for the browser to respond
            if (msg.id) {
              const timer = setTimeout(() => {
                pendingRequests.delete(msg.id!);
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ id: msg.id, ok: false, error: "Timeout (10s): browser did not respond" }));
                }
              }, 10_000);

              pendingRequests.set(msg.id, {
                resolve: (result) => {
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(result));
                  }
                },
                timer,
              });
            }
          });
        }
      });

      httpServer.listen(BRIDGE_PORT, () => {
        server.config.logger.info(
          `\n  \x1b[36m🌉 OpenReel Bridge\x1b[0m  \x1b[2mws://localhost:${BRIDGE_PORT}\x1b[0m`,
          { timestamp: true },
        );
      });

      // Clean up when Vite shuts down
      server.httpServer?.on("close", () => {
        wss.close();
        httpServer.close();
      });
    },
  };
}
