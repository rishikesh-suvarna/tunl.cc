import crypto from 'crypto';
import fs from 'fs';
import { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import { DEFAULT_TIMEOUT, MessageType } from '../shared/constants';
import { RequestMessage, ServerConfig } from '../shared/types';
import { TunnelManager } from './tunnel-manager';
import { extractSubdomain } from './utils/subdomain';

export function handleTunnelRequest(
  req: IncomingMessage,
  res: ServerResponse,
  tunnelManager: TunnelManager,
  config: ServerConfig
): void {
  const subdomain = extractSubdomain(req.headers.host, config.baseDomain);

  // Root domain - serve landing page
  if (!subdomain) {
    serveLandingPage(req, res, tunnelManager);
    return;
  }

  // Subdomain - handle tunnel
  const tunnel = tunnelManager.getTunnel(subdomain);

  if (!tunnel) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`Tunnel not found: ${subdomain}.${config.baseDomain}`);
    return;
  }

  forwardRequest(req, res, tunnel, tunnelManager, subdomain);
}

function serveLandingPage(
  req: IncomingMessage,
  res: ServerResponse,
  tunnelManager: TunnelManager
): void {
  const url = req.url || '/';

  // Serve static assets
  if (url.startsWith('/assets/')) {
    serveStaticFile(url, res);
    return;
  }

  // API endpoint for stats
  if (url === '/api/stats') {
    handleStatsRequest(res, tunnelManager);
    return;
  }

  // Serve homepage
  if (url === '/' || url === '/index.html') {
    const htmlPath = path.join(__dirname, '../../public/index.html');

    fs.readFile(htmlPath, 'utf8', async (err, html) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }

      // Get active tunnels count from database
      const activeTunnels = await tunnelManager.getActiveTunnelCount();

      // Replace template variables
      const rendered = html
        .replace('{{activeTunnels}}', activeTunnels.toString())
        .replace('{{timestamp}}', new Date().toISOString());

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(rendered);
    });
    return;
  }

  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

async function handleStatsRequest(
  res: ServerResponse,
  tunnelManager: TunnelManager
): Promise<void> {
  const activeTunnels = await tunnelManager.getActiveTunnelCount();

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      activeTunnels: activeTunnels,
      timestamp: new Date().toISOString(),
    })
  );
}

function serveStaticFile(url: string, res: ServerResponse): void {
  const filePath = path.join(__dirname, '../../public', url);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath);
    const contentType =
      {
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
      }[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function forwardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  tunnel: { ws: any; tunnelId: string },
  tunnelManager: TunnelManager,
  subdomain: string
): void {
  const requestId = crypto.randomBytes(16).toString('hex');
  const chunks: Buffer[] = [];
  const startTime = Date.now();

  req.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  req.on('end', async () => {
    const bodyBuffer = Buffer.concat(chunks);
    const body =
      bodyBuffer.length > 0 ? bodyBuffer.toString('base64') : undefined;

    const requestData: RequestMessage = {
      type: MessageType.REQUEST,
      requestId,
      method: req.method || 'GET',
      path: req.url || '/',
      headers: req.headers,
      body: body,
    };

    const timeout = setTimeout(() => {
      res.writeHead(504, { 'Content-Type': 'text/plain' });
      res.end('Gateway Timeout');
      tunnelManager.pendingRequestsMap.delete(requestId);

      // Log timeout
      tunnelManager.logRequest(
        subdomain,
        req.method || 'GET',
        req.url || '/',
        504,
        bodyBuffer.length,
        0,
        Date.now() - startTime,
        req.headers['user-agent'],
        req.socket.remoteAddress || 'unknown'
      );
    }, DEFAULT_TIMEOUT);

    // Store request metadata for later logging
    const requestMetadata = {
      subdomain,
      method: req.method || 'GET',
      path: req.url || '/',
      requestSize: bodyBuffer.length,
      startTime,
      userAgent: req.headers['user-agent'],
      ip: req.socket.remoteAddress || 'unknown',
    };

    tunnelManager.addPendingRequest(
      requestId,
      res as any,
      timeout,
      requestMetadata
    );

    try {
      tunnel.ws.send(JSON.stringify(requestData));
    } catch (err) {
      clearTimeout(timeout);
      tunnelManager.pendingRequestsMap.delete(requestId);
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');

      // Log error
      tunnelManager.logRequest(
        subdomain,
        req.method || 'GET',
        req.url || '/',
        502,
        bodyBuffer.length,
        0,
        Date.now() - startTime,
        req.headers['user-agent'],
        req.socket.remoteAddress || 'unknown'
      );
    }
  });

  req.on('error', (err) => {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
  });
}
