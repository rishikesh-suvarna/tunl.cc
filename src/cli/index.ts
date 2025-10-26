import { parseArgs } from './cli';
import { TunnelClient } from './tunnel-client';

const config = parseArgs();

const client = new TunnelClient(
  config.localPort,
  config.tunnelServer,
  config.subdomain,
  config.apiKey
);

// Track if we're shutting down
let isShuttingDown = false;

client.connect().catch((err: Error) => {
  console.error('\n✗ Failed to establish initial connection:', err.message);
  console.error('Please check your network connection and try again.\n');
  process.exit(1);
});

// Graceful shutdown handler
function gracefulShutdown(signal: string): void {
  if (isShuttingDown) {
    console.log('\nForcing shutdown...');
    process.exit(1);
  }

  isShuttingDown = true;
  console.log(`\n\nReceived ${signal} signal`);

  const status = client.getStatus();
  if (status.connected && status.publicUrl) {
    console.log(`Tunnel ${status.publicUrl} is being closed...`);
  }

  client.close();
}

// Handle various termination signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (err: Error) => {
  console.error('\n✗ Uncaught exception:', err.message);
  console.error(err.stack);

  if (!isShuttingDown) {
    console.log('\nAttempting graceful shutdown...');
    gracefulShutdown('EXCEPTION');
  }
});

process.on('unhandledRejection', (reason: any) => {
  console.error('\n✗ Unhandled rejection:', reason);

  if (!isShuttingDown) {
    console.log('\nAttempting graceful shutdown...');
    gracefulShutdown('REJECTION');
  }
});

// Prevent process from exiting on these signals
process.on('SIGHUP', () => {
  console.log('\nReceived SIGHUP - ignoring (tunnel will continue running)');
});
