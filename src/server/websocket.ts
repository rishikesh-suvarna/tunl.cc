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

// Extend WebSocket type to include isAlive property
interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  subdomain?: string;
}

export function setupWebSocketServer(
  wss: WebSocket.Server,
  tunnelManager: TunnelManager,
  config: ServerConfig
): void {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const extWs = ws as ExtendedWebSocket;
    const ip = req.socket.remoteAddress || 'unknown';
    let subdomain: string | null = null;
    const clientId = crypto.randomBytes(8).toString('hex');
    const logger = new Logger(clientId);

    // Initialize isAlive flag
    extWs.isAlive = true;

    // Connection timeout
    const connectionTimeout = setTimeout(() => {
      logger.warn('Connection timeout - no registration');
      ws.terminate();
    }, 10000);

    // Message rate limiting
    let messageCount = 0;
    const messageRateLimitWindow = setInterval(() => {
      messageCount = 0;
    }, 1000);

    // Handle pong responses from client (when server sends ping)
    ws.on('pong', () => {
      extWs.isAlive = true;
    });

    // Handle ping from client (client actively checking connection)
    // ws library automatically sends pong back, but we can log it
    ws.on('ping', () => {
      // Client is checking if we're alive - this is good!
      // ws library will automatically respond with pong
      extWs.isAlive = true; // Mark as alive since client is actively pinging
    });

    logger.info(`Client connected from ${ip}`);

    ws.on('message', (data: WebSocket.Data) => {
      // Rate limit messages
      messageCount++;
      if (messageCount > 100) {
        logger.warn('Message rate limit exceeded');
        ws.close(1008, 'Rate limit exceeded');
        return;
      }

      // Size limit
      if (data.toString().length > 1024 * 1024) {
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
                extWs.subdomain = sub;
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

    ws.on('close', (code: number, reason: Buffer) => {
      clearTimeout(connectionTimeout);
      clearInterval(messageRateLimitWindow);

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
    });
  });

  // SINGLE server-wide heartbeat interval
  // Server sends pings to all clients every 30 seconds
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {
      const extWs = ws as ExtendedWebSocket;

      if (ws.readyState === WebSocket.OPEN) {
        // If client didn't respond to previous ping, terminate
        if (extWs.isAlive === false) {
          console.log(
            `Terminating dead connection for ${extWs.subdomain || 'unknown'}`
          );
          return ws.terminate();
        }

        // Mark as not alive and send ping
        extWs.isAlive = false;
        ws.ping();
      }
    });
  }, 30000); // Ping every 30 seconds

  // Clean up on server shutdown
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
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
