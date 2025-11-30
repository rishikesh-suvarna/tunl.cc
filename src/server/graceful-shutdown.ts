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

  // Track open sockets
  const openSockets = new Set<WebSocket>();
  wss.clients.forEach((ws: WebSocket) => {
    openSockets.add(ws);
    closePromises.push(
      new Promise<void>((resolve) => {
        ws.on('close', () => {
          openSockets.delete(ws);
          resolve();
        });
        // Send close frame with reason
        ws.close(1001, 'Server shutting down');
      })
    );
  });
  // Wait for all WebSockets to close, or force terminate after 5 seconds
  const timeoutMs = 5000;
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      if (openSockets.size > 0) {
        logger.warn(
          `WebSocket close timeout - terminating ${openSockets.size} sockets`
        );
        openSockets.forEach((ws) => ws.terminate());
      }
      resolve();
    }, timeoutMs);
  });
  await Promise.race([Promise.all(closePromises), timeoutPromise]);
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
