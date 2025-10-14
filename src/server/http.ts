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

  const requestData: RequestMessage = {
    type: MessageType.REQUEST,
    requestId,
    method: req.method,
    path: req.url,
    headers: req.headers,
    body: req.body,
  };

  const timeout = setTimeout(() => {
    tunnelManager.timeoutRequest(requestId);
  }, DEFAULT_TIMEOUT);

  tunnelManager.addPendingRequest(requestId, res, timeout);

  try {
    tunnel.ws.send(JSON.stringify(requestData));
  } catch (err) {
    clearTimeout(timeout);
    tunnelManager.pendingRequestsMap.delete(requestId);
    res.status(502).send('Bad Gateway');
  }
}
