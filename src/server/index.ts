// src/server/index.ts

import http from 'http';
import WebSocket from 'ws';
import { testConnection } from '../lib/connection';
import { ServerConfig } from '../shared/types';
import { handleTunnelRequest } from './http';
import { TunnelManager } from './tunnel-manager';
import { Logger } from './utils/logger';
import { setupWebSocketServer } from './websocket';

const logger = new Logger('Server');

const config: ServerConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  baseDomain: process.env.BASE_DOMAIN || 'localhost:3000',
  https: process.env.HTTPS === 'true',
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

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully');
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  });
}

startServer().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});

export {};
