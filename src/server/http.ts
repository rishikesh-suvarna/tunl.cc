import crypto from 'crypto';
import { Express, Request, Response } from 'express';
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

    // Root domain - show service info
    if (!subdomain) {
      return res.json({
        service: 'Tunnel Service',
        activeTunnels: tunnelManager.getActiveTunnelCount(),
        baseUrl: config.baseDomain,
        usage: `Connect with WebSocket to ws://${config.baseDomain}`,
        example: `http://myapp.${config.baseDomain}`,
      });
    }

    const tunnel = tunnelManager.getTunnel(subdomain);

    if (!tunnel) {
      return res
        .status(404)
        .send(`Tunnel not found: ${subdomain}.${config.baseDomain}`);
    }

    forwardRequest(req, res, tunnel, tunnelManager, subdomain);
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
