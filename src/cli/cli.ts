import { TUNNEL_SERVER } from '../config/app.config';

export interface CliConfig {
  localPort: number;
  subdomain: string | null;
  tunnelServer: string;
}

export function parseArgs(): CliConfig {
  const args = process.argv.slice(2);

  if (!args[0]) {
    console.log('Usage: tunnel <local-port> [subdomain]');
    console.log('Example: tunnel 8080 myapp');
    console.log('\nOptions:');
    console.log('  local-port    Port of your local server');
    console.log('  subdomain     Optional custom subdomain');
    console.log('\nEnvironment Variables:');
    console.log(
      '  TUNNEL_SERVER  Tunnel server URL (default: ws://localhost:3000)'
    );
    process.exit(1);
  }

  const localPort = parseInt(args[0], 10);

  if (isNaN(localPort) || localPort < 1 || localPort > 65535) {
    console.error('Error: Invalid port number');
    process.exit(1);
  }

  console.log(`Localport: ${localPort}`);
  console.log(`Subdomain: ${args[1] || 'random'}`);
  console.log(`Tunnel Server: ${TUNNEL_SERVER || 'ws://localhost:3000'}`);

  return {
    localPort,
    subdomain: args[1] || null,
    tunnelServer: TUNNEL_SERVER || 'ws://localhost:3000',
  };
}
