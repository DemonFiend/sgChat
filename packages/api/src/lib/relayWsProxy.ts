/**
 * Relay WebSocket Proxy
 *
 * Proxies LiveKit signaling WebSocket connections through the Master's SSL.
 * Clients connect to: wss://master-domain/relay-ws/<relay-id>/rtc?access_token=...
 * Master proxies to:  ws://<relay-ip>:7880/rtc?access_token=...
 *
 * WebRTC media (UDP) still goes direct to the relay — only the signaling
 * WebSocket needs SSL (browsers block ws:// from HTTPS pages).
 */

import { IncomingMessage } from 'http';
import type { Server } from 'http';
import { request as httpRequest } from 'http';
import type { Duplex } from 'stream';
import { db } from './db.js';

const RELAY_WS_PREFIX = '/relay-ws/';
// UUID pattern: 8-4-4-4-12 hex chars
const RELAY_PATH_RE = /^\/relay-ws\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(.*)/i;

/**
 * Set up the WebSocket upgrade proxy on the given HTTP server.
 * Must be called AFTER Socket.IO is initialized (Socket.IO registers its own
 * upgrade handler first; we only handle /relay-ws/* paths it ignores).
 */
export function setupRelayWsProxy(server: Server): void {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Only intercept /relay-ws/<uuid>/... paths
    if (!req.url?.startsWith(RELAY_WS_PREFIX)) return;

    const match = req.url.match(RELAY_PATH_RE);
    if (!match) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const relayId = match[1];
    const remainingPath = match[2]; // e.g. "rtc?access_token=..."

    // Async lookup — handle errors carefully since this is a raw socket handler
    handleRelayUpgrade(relayId, remainingPath, req, socket, head).catch((err) => {
      console.error(`Relay WS proxy error for ${relayId}:`, err);
      try {
        socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        socket.destroy();
      } catch {
        // Socket may already be destroyed
      }
    });
  });

  console.log('🔀 Relay WebSocket proxy registered on /relay-ws/<relay-id>/*');
}

async function handleRelayUpgrade(
  relayId: string,
  remainingPath: string,
  clientReq: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
): Promise<void> {
  const relay = await db.relays.findById(relayId);

  if (!relay || relay.status !== 'trusted' || !relay.livekit_url) {
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  // Parse the relay's LiveKit URL: ws://1.2.3.4:7880
  let targetHost: string;
  let targetPort: number;
  try {
    const parsed = new URL(relay.livekit_url);
    targetHost = parsed.hostname;
    targetPort = parseInt(parsed.port, 10) || 7880;
  } catch {
    console.error(`Invalid livekit_url for relay ${relayId}: ${relay.livekit_url}`);
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  // Forward the upgrade request to the relay's LiveKit server
  const proxyReq = httpRequest({
    hostname: targetHost,
    port: targetPort,
    path: `/${remainingPath}`,
    method: 'GET',
    headers: {
      ...filterHeaders(clientReq.headers),
      host: `${targetHost}:${targetPort}`,
    },
  });

  proxyReq.on('upgrade', (_proxyRes, proxySocket, proxyHead) => {
    // Send the 101 Switching Protocols response back to the client
    clientSocket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${_proxyRes.headers['sec-websocket-accept']}\r\n` +
      (
        _proxyRes.headers['sec-websocket-protocol']
          ? `Sec-WebSocket-Protocol: ${_proxyRes.headers['sec-websocket-protocol']}\r\n`
          : ''
      ) +
      '\r\n',
    );

    // Forward any buffered data
    if (proxyHead.length > 0) clientSocket.write(proxyHead);
    if (head.length > 0) proxySocket.write(head);

    // Pipe bidirectionally
    proxySocket.pipe(clientSocket);
    clientSocket.pipe(proxySocket);

    // Clean up on close
    clientSocket.on('error', () => proxySocket.destroy());
    proxySocket.on('error', () => clientSocket.destroy());
    clientSocket.on('close', () => proxySocket.destroy());
    proxySocket.on('close', () => clientSocket.destroy());
  });

  proxyReq.on('error', (err) => {
    console.error(`Relay WS proxy connection failed for ${relayId}:`, err.message);
    try {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.destroy();
    } catch {
      // Socket may already be gone
    }
  });

  // If the relay responds with a non-upgrade response, forward the error
  proxyReq.on('response', (res) => {
    const statusLine = `HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n`;
    const headers = Object.entries(res.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    clientSocket.write(`${statusLine}${headers}\r\n\r\n`);
    res.pipe(clientSocket);
  });

  proxyReq.end();
}

/**
 * Filter headers for proxying — remove hop-by-hop headers that shouldn't be forwarded,
 * but keep WebSocket upgrade headers intact.
 */
function filterHeaders(headers: IncomingMessage['headers']): Record<string, string | string[] | undefined> {
  const filtered: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    // Skip host (we set our own) and keep everything else
    if (key === 'host') continue;
    filtered[key] = value;
  }
  return filtered;
}
