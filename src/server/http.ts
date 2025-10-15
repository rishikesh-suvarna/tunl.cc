import crypto from 'crypto';
import { Express, Request, Response } from 'express';
import fs from 'fs';
import { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import { DEFAULT_TIMEOUT, MessageType } from '../shared/constants';
import { RequestMessage, ServerConfig, TunnelInfo } from '../shared/types';
import { TunnelManager } from './tunnel-manager';
import { extractSubdomain } from './utils/subdomain';

export function setupHttpServer(
  app: Express,
  tunnelManager: TunnelManager,
  config: ServerConfig
): void {
  app.use((req: Request, res: Response) => {
    const subdomain = extractSubdomain(req.hostname, config.baseDomain);

    // Root domain
    if (!subdomain) {
      serveLandingPage(req, res, tunnelManager);
      return;
    }

    const tunnel = tunnelManager.getTunnel(subdomain);

    if (!tunnel) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>Tunnel Not Found</title></head>
        <body>
          <h1>Tunnel not found: ${subdomain}.${config.baseDomain}</h1>
          <p>This tunnel is not active.</p>
          <a href="https://${config.baseDomain}">Go to homepage</a>
        </body>
      </html>
    `);
      return;
    }

    forwardRequest(req, res, tunnel, tunnelManager, subdomain);
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

  // Serve homepage
  if (url === '/' || url === '/index.html') {
    const htmlPath = path.join(__dirname, '../../public/index.html');

    fs.readFile(htmlPath, 'utf8', (err, html) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }

      // Replace template variables
      const rendered = html
        .replace(
          '{{activeTunnels}}',
          tunnelManager.getActiveTunnelCount().toString()
        )
        .replace('{{timestamp}}', new Date().toISOString());

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(rendered);
    });
    return;
  }

  if (url === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        activeTunnels: tunnelManager.getActiveTunnelCount(),
        timestamp: new Date().toISOString(),
      })
    );
    return;
  }

  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
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
  req: Request,
  res: Response,
  tunnel: TunnelInfo,
  tunnelManager: TunnelManager,
  subdomain: string
): void {
  const requestId = crypto.randomBytes(16).toString('hex');
  const chunks: Buffer[] = [];

  req.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  req.on('end', () => {
    // Concatenate all chunks
    const bodyBuffer = Buffer.concat(chunks);

    // Convert to base64 for JSON transmission
    const body =
      bodyBuffer.length > 0 ? bodyBuffer.toString('base64') : undefined;

    console.log(
      `[${subdomain}] ${req.method} ${req.url} - Body size: ${bodyBuffer.length} bytes`
    );

    const requestData: RequestMessage = {
      type: MessageType.REQUEST,
      requestId,
      method: req.method,
      path: req.url,
      headers: req.headers,
      body: body,
    };

    const timeout = setTimeout(() => {
      tunnelManager.timeoutRequest(requestId);
    }, DEFAULT_TIMEOUT);

    tunnelManager.addPendingRequest(requestId, res, timeout);

    try {
      const messageStr = JSON.stringify(requestData);
      console.log(
        `[${subdomain}] Sending message size: ${messageStr.length} bytes`
      );
      tunnel.ws.send(messageStr);
    } catch (err) {
      console.error(`[${subdomain}] Error sending:`, err);
      clearTimeout(timeout);
      tunnelManager.pendingRequestsMap.delete(requestId);
      res.status(502).send('Bad Gateway');
    }
  });

  req.on('error', (err) => {
    console.error(`[${subdomain}] Request error:`, err);
    res.status(400).send('Bad Request');
  });
}
