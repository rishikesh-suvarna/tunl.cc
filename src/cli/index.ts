import { parseArgs } from './cli';
import { TunnelClient } from './tunnel-client';

const config = parseArgs();

const client = new TunnelClient(
  config.localPort,
  config.tunnelServer,
  config.subdomain
);

client.connect().catch((err: Error) => {
  console.error('Failed to connect:', err.message);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  client.close();
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  client.close();
});
