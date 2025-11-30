import http from 'http';
import WebSocket from 'ws';
import { Logger } from './utils/logger';

const logger = new Logger('Server');

async function gracefulShutdown(
  signal: string,
  wss: WebSocket.Server,
  server: http.Server
) {
  logger.info(`${signal} received, shutting down gracefully`);

  // Step 1: Close all WebSocket connections
  logger.info(`Closing ${wss.clients.size} WebSocket connections...`);

  const closePromises: Promise<void>[] = [];

  wss.clients.forEach((ws: WebSocket) => {
    closePromises.push(
      new Promise<void>((resolve) => {
        // Set a timeout in case close hangs
        const timeout = setTimeout(() => {
          logger.warn('WebSocket close timeout - terminating');
          ws.terminate();
          resolve();
        }, 5000);

        ws.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });

        // Send close frame with reason
        ws.close(1001, 'Server shutting down');
      })
    );
  });

  // Wait for all WebSockets to close (max 5 seconds)
  await Promise.all(closePromises);
  logger.info('All WebSocket connections closed');

  // Step 2: Close the WebSocket server
  await new Promise<void>((resolve) => {
    wss.close(() => {
      logger.info('WebSocket server closed');
      resolve();
    });
  });

  // Step 3: Close the HTTP server
  await new Promise<void>((resolve) => {
    server.close(() => {
      logger.info('HTTP server closed');
      resolve();
    });
  });

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

export { gracefulShutdown };
