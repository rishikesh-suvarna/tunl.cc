![tunl.cc logo](https://tunl.cc/assets/images/common/logo-icon.png)

# tunl.cc

A simple tunneling service to expose your localhost to the internet.

## Installation

```bash
npm install -g tunl.cc
```

Requires Node.js 18 or newer.

## Usage

Start a tunnel to your local server:

```bash
tunl <port> [subdomain]
```

### Examples

```bash
# Tunnel port 8080 with random subdomain
tunl 8080

# Tunnel port 3000 with custom subdomain
tunl 3000 myapp
```

Your local server will be accessible at `https://<subdomain>.tunl.cc`

## Server Setup

To run your own tunnel server:

```bash
# Install dependencies
npm install

# Build
npm run build

# Start server
BASE_DOMAIN=tunl.cc PORT=80 npm start
```

### Environment Variables

- `PORT` - Server port (default: 3000)
- `BASE_DOMAIN` - Your domain (default: localhost:3000)
- `HTTPS` - Enable HTTPS (default: false)
- `TUNNEL_SERVER` - Tunnel server URL for client (default: wss://tunl.cc)

## Development

```bash
# Install dependencies
npm install

# Run server in development mode
npm run dev:server

# Run client in development mode
npm run dev:client

# Build TypeScript
npm run build

# Run tests
npm test
```

## DNS Configuration

For production deployment, add a wildcard DNS record:

```
*.<your-domain>.cc  →  YOUR_SERVER_IP
```

## License

MIT

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## Support

For issues and questions, please visit [GitHub Issues](https://github.com/rishikesh-suvarna/tunl.cc/issues)
