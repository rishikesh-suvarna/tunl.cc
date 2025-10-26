import pkg from '../../package.json';
import { TUNNEL_SERVER } from '../config/app.config';

export interface CliConfig {
  localPort: number;
  subdomain: string | null;
  tunnelServer: string;
  apiKey: string | null;
}

export function parseArgs(): CliConfig {
  const args = process.argv.slice(2);

  // Parse flags
  let apiKey: string | null = null;
  const filteredArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--api-key' || arg === '-k') {
      if (i + 1 < args.length) {
        apiKey = args[i + 1] || null;
        i++; // Skip next arg
      } else {
        console.error('Error: --api-key requires a value');
        process.exit(1);
      }
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--version' || arg === '-v') {
      console.log(`Tunl version ${pkg.version}`);
      process.exit(0);
    } else {
      if (!arg) {
        continue;
      }
      filteredArgs.push(arg);
    }
  }

  // Check for API key in environment
  if (!apiKey && process.env.TUNL_API_KEY) {
    apiKey = process.env.TUNL_API_KEY;
  }

  if (filteredArgs.length === 0) {
    showHelp();
    process.exit(1);
  }

  if (Number(filteredArgs[0]) > 65535 || Number(filteredArgs[0]) < 1024) {
    console.error('Error: Invalid port number. Must be between 1024 and 65535');
    process.exit(1);
  }

  const localPort = parseInt(filteredArgs[0]!, 10);

  if (isNaN(localPort) || localPort < 1024 || localPort > 65535) {
    console.error('Error: Invalid port number. Must be between 1024 and 65535');
    process.exit(1);
  }

  const subdomain = filteredArgs[1] || null;

  // Validate subdomain format if provided
  if (subdomain && !isValidSubdomainFormat(subdomain)) {
    console.error(
      'Error: Invalid subdomain format. Must be 3-63 characters, alphanumeric or hyphens only'
    );
    process.exit(1);
  }

  const tunnelServer =
    process.env.TUNNEL_SERVER || TUNNEL_SERVER || 'wss://tunl.cc';

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║          Tunnel Configuration          ║');
  console.log('╠════════════════════════════════════════╣');
  console.log(`║ Local Port:     ${localPort.toString().padEnd(22)} ║`);
  console.log(`║ Subdomain:      ${(subdomain || 'random').padEnd(22)} ║`);
  console.log(
    `║ API Key:        ${(apiKey ? '***' + apiKey.slice(-4) : 'none').padEnd(
      22
    )} ║`
  );
  console.log(
    `║ Server:         ${tunnelServer
      .replace('wss://', '')
      .replace('ws://', '')
      .padEnd(22)} ║`
  );
  console.log('╚════════════════════════════════════════╝\n');

  return {
    localPort,
    subdomain,
    tunnelServer,
    apiKey,
  };
}

function showHelp(): void {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                    Tunl - Tunnel CLI                       ║
╚════════════════════════════════════════════════════════════╝

USAGE:
  tunl <local-port> [subdomain] [options]

EXAMPLES:
  tunl 8080                        # Random subdomain
  tunl 8080 myapp                  # Custom subdomain
  tunl 3000 myapp --api-key <key>  # With API key
  tunl 8080 --api-key <key>        # API key, random subdomain

ARGUMENTS:
  <local-port>    Port of your local server (1-65535)
  [subdomain]     Optional custom subdomain (3-63 chars)

OPTIONS:
  -k, --api-key <key>    API key for authentication
  -h, --help             Show this help message
  -v, --version          Show version information

ENVIRONMENT VARIABLES:
  TUNNEL_SERVER          Tunnel server URL (default: wss://tunl.cc)
  TUNL_API_KEY          API key (alternative to --api-key flag)

FEATURES:
  • Automatic reconnection with exponential backoff
  • Heartbeat monitoring to detect dead connections
  • Support for custom subdomains
  • API key authentication for user accounts
  • Request/response logging with timing

NOTES:
  • Subdomains must be 3-63 characters
  • Allowed characters: a-z, 0-9, hyphens
  • Cannot start or end with a hyphen
  • Press Ctrl+C to gracefully shutdown
  `);
}

function isValidSubdomainFormat(subdomain: string): boolean {
  // Basic format validation (full validation done on server)
  const subdomainRegex = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;
  return subdomainRegex.test(subdomain);
}
