import crypto from 'crypto';
import fs from 'fs';
import { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import {
  DEFAULT_TIMEOUT,
  MAX_BODY_SIZE,
  MessageType,
} from '../shared/constants';
import { RequestMessage, ServerConfig } from '../shared/types';
import { collectRequestBody } from './body-collector';
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

  forwardRequest(req, res, tunnel, tunnelManager, subdomain).catch((err) => {
    console.error('Unexpected error forwarding request:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });
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

      // Get active tunnels count from Redis
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

  // Abuse reporting page
  if (url === '/abuse' || url === '/abuse.html') {
    const htmlPath = path.join(__dirname, '../../public/abuse.html');
    fs.readFile(htmlPath, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
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

async function forwardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  tunnel: { ws: any },
  tunnelManager: TunnelManager,
  subdomain: string
): Promise<void> {
  const requestId = crypto.randomBytes(16).toString('hex');
  const startTime = Date.now();

  const bodyBuffer = await collectRequestBody(req, res, MAX_BODY_SIZE);
  if (bodyBuffer === null) return;

  const body =
    bodyBuffer.length > 0 ? bodyBuffer.toString('base64') : undefined;

  const requestData: RequestMessage = {
    type: MessageType.REQUEST,
    requestId,
    method: req.method || 'GET',
    path: req.url || '/',
    headers: req.headers,
    body,
    bodyEncoding: body ? 'base64' : undefined,
  };

  const timeout = setTimeout(() => {
    tunnelManager.timeoutRequest(requestId);
  }, DEFAULT_TIMEOUT);

  const requestMetadata = {
    subdomain,
    method: req.method || 'GET',
    path: req.url || '/',
    requestSize: bodyBuffer.length,
    startTime,
    userAgent: req.headers['user-agent'],
    ip: req.socket.remoteAddress || 'unknown',
  };

  tunnelManager.addPendingRequest(requestId, res, timeout, requestMetadata);

  try {
    tunnel.ws.send(JSON.stringify(requestData));
  } catch (err) {
    console.error('Error forwarding request:', err);
    clearTimeout(timeout);
    tunnelManager.pendingRequestsMap.delete(requestId);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');
    }
  }
}
