import crypto from 'crypto';
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
  wss.on('connection', (ws: WebSocket) => {
    let subdomain: string | null = null;
    const clientId = crypto.randomBytes(8).toString('hex');
    const logger = new Logger(clientId);

    logger.info('Client connected');

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case MESSAGE_TYPES.REGISTER:
            handleRegister(
              ws,
              msg as RegisterMessage,
              tunnelManager,
              config,
              logger,
              (sub: string) => {
                subdomain = sub;
              }
            );
            break;

          case MESSAGE_TYPES.RESPONSE:
            handleResponse(msg as ResponseMessage, tunnelManager);
            break;

          default:
            logger.warn('Unknown message type:', msg.type);
        }
      } catch (err) {
        logger.error('Error processing message:', (err as Error).message);
      }
    });

    ws.on('close', () => {
      if (subdomain) {
        tunnelManager.unregister(subdomain);
        logger.info(`Tunnel closed: ${subdomain}`);
      }
    });

    ws.on('error', (err: Error) => {
      logger.error('WebSocket error:', err.message);
    });
  });
}

function handleRegister(
  ws: WebSocket,
  msg: RegisterMessage,
  tunnelManager: TunnelManager,
  config: ServerConfig,
  logger: Logger,
  setSubdomain: (subdomain: string) => void
): void {
  const subdomain = msg.subdomain || tunnelManager.generateSubdomain();

  // Validate subdomain
  if (!isValidSubdomain(subdomain)) {
    const errorMsg: ErrorMessage = {
      type: MessageType.ERROR,
      message:
        'Invalid subdomain. Must be 3-63 characters, alphanumeric or hyphens, and not reserved or profane.',
    };
    ws.send(JSON.stringify(errorMsg));
    return;
  }

  const result = tunnelManager.register(subdomain, ws);

  if (!result.success) {
    const errorMsg: ErrorMessage = {
      type: MessageType.ERROR,
      message: result.error || 'Registration failed',
    };
    ws.send(JSON.stringify(errorMsg));
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
