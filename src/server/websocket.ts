import crypto from 'crypto';
import { IncomingMessage } from 'http';
import WebSocket from 'ws';
import { MESSAGE_TYPES, MessageType } from '../shared/constants';
import {
  ErrorMessage,
  RegisteredMessage,
  RegisterMessage,
  ResponseMessage,
  ServerConfig,
} from '../shared/types';
import { TunnelManager } from './tunnel-manager';
import { Logger } from './utils/logger';
import { isValidSubdomain } from './utils/validation';

export function setupWebSocketServer(
  wss: WebSocket.Server,
  tunnelManager: TunnelManager,
  config: ServerConfig
): void {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const ip = req.socket.remoteAddress || 'unknown';
    let subdomain: string | null = null;
    const clientId = crypto.randomBytes(8).toString('hex');
    const logger = new Logger(clientId);

    // Track if client is alive
    let isAlive = true;

    // Connection timeout
    const connectionTimeout = setTimeout(() => {
      logger.warn('Connection timeout - no registration');
      ws.terminate(); // Use terminate() instead of close() for immediate disconnect
    }, 10000);

    // Message rate limiting
    let messageCount = 0;
    const messageRateLimitWindow = setInterval(() => {
      messageCount = 0;
    }, 1000);

    // Heartbeat - respond to pings from client
    ws.on('ping', () => {
      isAlive = true;
      ws.pong(); // Respond to client pings
    });

    // Heartbeat check - ensure client is still alive
    const heartbeatInterval = setInterval(() => {
      if (isAlive === false) {
        logger.warn('Client heartbeat failed - terminating connection');
        clearInterval(heartbeatInterval);
        return ws.terminate();
      }

      isAlive = false;
      ws.ping(); // Server also pings client
    }, 15000); // Check every 15 seconds

    logger.info(`Client connected from ${ip}`);

    ws.on('message', (data: WebSocket.Data) => {
      // Rate limit messages
      messageCount++;
      if (messageCount > 100) {
        // Max 100 messages per second
        logger.warn('Message rate limit exceeded');
        ws.close(1008, 'Rate limit exceeded');
        return;
      }

      // Size limit
      if (data.toString().length > 1024 * 1024) {
        // 1MB
        logger.warn('Message too large');
        ws.close(1009, 'Message too large');
        return;
      }

      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case MESSAGE_TYPES.REGISTER:
            clearTimeout(connectionTimeout);
            handleRegister(
              ws,
              msg as RegisterMessage,
              tunnelManager,
              config,
              logger,
              ip,
              (sub: string) => {
                subdomain = sub;
              }
            );
            break;

          case MESSAGE_TYPES.RESPONSE:
            handleResponse(msg, tunnelManager);
            break;

          default:
            logger.warn('Unknown message type:', msg.type);
        }
      } catch (err) {
        logger.error('Error processing message:', (err as Error).message);
      }
    });

    ws.on('pong', () => {
      isAlive = true;
    });

    ws.on('close', (code: number, reason: Buffer) => {
      clearTimeout(connectionTimeout);
      clearInterval(messageRateLimitWindow);
      clearInterval(heartbeatInterval);

      if (subdomain) {
        tunnelManager.unregister(subdomain);
        logger.info(
          `Tunnel closed: ${subdomain} (code: ${code}${
            reason.length ? `, reason: ${reason.toString()}` : ''
          })`
        );
      }
    });

    ws.on('error', (err: Error) => {
      logger.error('WebSocket error:', err.message);
      // Don't try to close here, let the close event handle cleanup
    });
  });

  // Server-level ping interval to detect dead connections
  const serverPingInterval = setInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {
      if (ws.readyState === WebSocket.OPEN) {
        // Check if custom property exists (you might need to extend WebSocket type)
        const extWs = ws as WebSocket & { isAlive?: boolean };
        if (extWs.isAlive === false) {
          return ws.terminate();
        }
        extWs.isAlive = false;
        ws.ping();
      }
    });
  }, 30000); // Server-wide ping every 30 seconds

  // Clean up on server shutdown
  wss.on('close', () => {
    clearInterval(serverPingInterval);
  });
}

async function handleRegister(
  ws: WebSocket,
  msg: RegisterMessage,
  tunnelManager: TunnelManager,
  config: ServerConfig,
  logger: Logger,
  ip: string,
  setSubdomain: (subdomain: string) => void
): Promise<void> {
  const subdomain = msg.subdomain || tunnelManager.generateSubdomain();
  const apiKey = msg.apiKey || null;

  // Validate subdomain
  if (!isValidSubdomain(subdomain)) {
    const errorMsg: ErrorMessage = {
      type: MessageType.ERROR,
      message:
        'Invalid subdomain. Must be 3-63 characters, alphanumeric or hyphens, and not reserved or profane.',
    };
    ws.send(JSON.stringify(errorMsg));
    ws.close(1008, 'Invalid subdomain');
    return;
  }

  const result = await tunnelManager.register(subdomain, ws, apiKey, ip);

  if (!result.success) {
    const errorMsg: ErrorMessage = {
      type: MessageType.ERROR,
      message: result.error || 'Registration failed',
    };
    ws.send(JSON.stringify(errorMsg));
    ws.close(1008, result.error || 'Registration failed');
    return;
  }

  const protocol = config.https ? 'https' : 'http';
  const publicUrl = `${protocol}://${subdomain}.${config.baseDomain}`;

  const registeredMsg: RegisteredMessage = {
    type: MessageType.REGISTERED,
    subdomain,
    url: publicUrl,
  };

  ws.send(JSON.stringify(registeredMsg));

  setSubdomain(subdomain);
  logger.info(`Registered tunnel: ${subdomain} -> ${publicUrl}`);
}

function handleResponse(
  msg: ResponseMessage,
  tunnelManager: TunnelManager
): void {
  tunnelManager.resolvePendingRequest(
    msg.requestId,
    msg.statusCode,
    msg.headers,
    msg.body
  );
}
