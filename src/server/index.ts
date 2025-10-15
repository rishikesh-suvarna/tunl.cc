import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import { BASE_DOMAIN, HTTPS, PORT } from '../config/app.config';
import { ServerConfig } from '../shared/types';
import { setupHttpServer } from './http';
import { TunnelManager } from './tunnel-manager';
import { Logger } from './utils/logger';
import { setupWebSocketServer } from './websocket';

const logger = new Logger('Server');

// Configuration
const config: ServerConfig = {
  port: PORT,
  baseDomain: BASE_DOMAIN || 'localhost:9000',
  https: HTTPS,
};

// Initialize
const app = express();

// Create HTTP and WebSocket servers
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const tunnelManager = new TunnelManager();

// Setup routes
setupWebSocketServer(wss, tunnelManager, config);
setupHttpServer(app, tunnelManager, config);

// Start server
server.listen(config.port, () => {
  logger.info(`Tunnel server running on port ${config.port}`);
  logger.info(`Base domain: ${config.baseDomain}`);
  logger.info(`WebSocket endpoint: ws://${config.baseDomain}`);
  logger.info(`Example: http://myapp.${config.baseDomain}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

export { app, server };
