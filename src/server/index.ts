// src/server/index.ts

import http from 'http';
import WebSocket from 'ws';
import { BASE_DOMAIN, HTTPS, PORT } from '../config/app.config';
import { testConnection } from '../lib/db';
import { ServerConfig } from '../shared/types';
import { gracefulShutdown } from './graceful-shutdown';
import { handleTunnelRequest } from './http';
import { TunnelManager } from './tunnel-manager';
import { Logger } from './utils/logger';
import { setupWebSocketServer } from './websocket';

const logger = new Logger('Server');

const config: ServerConfig = {
  port: PORT || 3000,
  baseDomain: BASE_DOMAIN || 'localhost:3000',
  https: HTTPS,
};

async function startServer() {
  // Test database connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    logger.error('Failed to connect to database. Exiting...');
    process.exit(1);
  }

  const tunnelManager = new TunnelManager();

  const server = http.createServer((req, res) => {
    handleTunnelRequest(req, res, tunnelManager, config);
  });

  const wss = new WebSocket.Server({ server });

  setupWebSocketServer(wss, tunnelManager, config);

  server.listen(config.port, () => {
    logger.info(`Tunnel server running on port ${config.port}`);
    logger.info(`Base domain: ${config.baseDomain}`);
    logger.info(`WebSocket endpoint: ws://${config.baseDomain}`);
    logger.info(`Example: http://myapp.${config.baseDomain}`);
  });

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM', wss, server));
  process.on('SIGINT', () => gracefulShutdown('SIGINT', wss, server));
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection', wss, server);
  });
}

startServer().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
