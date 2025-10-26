import WebSocket from 'ws';
import { MESSAGE_TYPES, MessageType } from '../shared/constants';
import {
  ErrorMessage,
  Message,
  RegisterMessage,
  RegisteredMessage,
  RequestMessage,
  ResponseMessage,
} from '../shared/types';
import { forwardToLocal } from './proxy';

interface ReconnectOptions {
  maxDelay: number;
  initialDelay: number;
  factor: number;
}

export class TunnelClient {
  private localPort: number;
  private tunnelServer: string;
  private subdomain: string | null;
  private apiKey: string | null;
  private ws: WebSocket | null;
  private isConnected: boolean;
  private isReconnecting: boolean;
  private reconnectAttempts: number;
  private reconnectDelay: number;
  private reconnectOptions: ReconnectOptions;
  private publicUrl: string | null;
  private shouldReconnect: boolean;
  private pingInterval: NodeJS.Timeout | null;
  private pongTimeout: NodeJS.Timeout | null;
  private hasFatalError: boolean;

  constructor(
    localPort: number,
    tunnelServer: string,
    subdomain: string | null = null,
    apiKey: string | null = null
  ) {
    this.localPort = localPort;
    this.tunnelServer = tunnelServer;
    this.subdomain = subdomain;
    this.apiKey = apiKey;
    this.ws = null;
    this.isConnected = false;
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;
    this.reconnectOptions = {
      initialDelay: 1000,
      maxDelay: 30000,
      factor: 1.5,
    };
    this.publicUrl = null;
    this.shouldReconnect = true;
    this.pingInterval = null;
    this.pongTimeout = null;
    this.hasFatalError = false;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isReconnecting) {
        console.log('Connection attempt already in progress...');
        return;
      }

      console.log('Starting tunnel client...');
      console.log(`Local server: http://localhost:${this.localPort}`);
      console.log(`Tunnel server: ${this.tunnelServer}`);

      if (this.apiKey) {
        console.log('Using API key for authentication');
      }

      this.ws = new WebSocket(this.tunnelServer);

      // Connection timeout
      const connectionTimeout = setTimeout(() => {
        if (!this.isConnected) {
          console.error('Connection timeout');
          this.ws?.close();
          reject(new Error('Connection timeout'));
        }
      }, 10000);

      this.ws.on('open', () => {
        clearTimeout(connectionTimeout);
        console.log('Connected to tunnel server');
        this.isConnected = true;
        this.register();
        this.startHeartbeat();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data, resolve);
      });

      this.ws.on('error', (err: Error) => {
        clearTimeout(connectionTimeout);
        console.error('WebSocket error:', err.message);

        if (!this.isConnected) {
          reject(err);
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        clearTimeout(connectionTimeout);
        this.isConnected = false;
        this.stopHeartbeat();

        const reasonStr = reason.toString();

        console.log(
          `\nTunnel connection closed (code: ${code}${
            reasonStr ? `, reason: ${reasonStr}` : ''
          })`
        );

        // Don't reconnect if we have a fatal error
        if (this.hasFatalError) {
          console.log('Not reconnecting due to fatal error');
          process.exit(1);
          return;
        }

        // Only skip reconnect if this was a clean client-initiated close
        if (code === 1000 && !this.shouldReconnect) {
          console.log('Tunnel closed normally');
          process.exit(0);
          return;
        }

        // Reconnect for all other cases if shouldReconnect is true
        if (this.shouldReconnect) {
          this.reconnect();
        } else {
          process.exit(0);
        }
      });

      this.ws.on('pong', () => {
        // Clear the timeout when we receive a pong
        if (this.pongTimeout) {
          clearTimeout(this.pongTimeout);
          this.pongTimeout = null;
        }
      });
    });
  }

  private reconnect(): void {
    if (this.isReconnecting) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    console.log(
      `\nReconnecting... (attempt ${this.reconnectAttempts}, delay: ${this.reconnectDelay}ms)`
    );

    setTimeout(() => {
      this.isReconnecting = false;

      this.connect().catch((err) => {
        console.error('Reconnection failed:', err.message);

        // Exponential backoff
        this.reconnectDelay = Math.min(
          this.reconnectDelay * this.reconnectOptions.factor,
          this.reconnectOptions.maxDelay
        );

        this.reconnect();
      });
    }, this.reconnectDelay);
  }

  private startHeartbeat(): void {
    // Send ping every 15 seconds (more frequent than 30s)
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Check if we're still waiting for a previous pong
        if (this.pongTimeout) {
          console.log(
            '⚠ Previous heartbeat not acknowledged - connection may be dead'
          );
          this.ws.terminate(); // Force close the connection
          return;
        }

        this.ws.ping();

        // Set timeout for pong response (3 seconds)
        this.pongTimeout = setTimeout(() => {
          console.log('✗ Heartbeat timeout - no response from server');
          this.pongTimeout = null;
          this.ws?.terminate(); // Force close instead of graceful close
        }, 3000);
      }
    }, 15000); // Check every 15 seconds
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private register(): void {
    if (!this.ws) return;

    const registerMsg: RegisterMessage = {
      type: MessageType.REGISTER,
      subdomain: this.subdomain || undefined,
      apiKey: this.apiKey || undefined,
    };

    this.ws.send(JSON.stringify(registerMsg));
  }

  private handleMessage(
    data: WebSocket.Data,
    resolveConnection: () => void
  ): void {
    try {
      const msg: Message = JSON.parse(data.toString());

      switch (msg.type) {
        case MESSAGE_TYPES.REGISTERED:
          this.handleRegistered(msg as RegisteredMessage, resolveConnection);
          break;

        case MESSAGE_TYPES.REQUEST:
          this.handleRequest(msg as RequestMessage);
          break;

        case MESSAGE_TYPES.ERROR:
          this.handleError(msg as ErrorMessage);
          break;

        default:
          console.warn('Unknown message type:', (msg as any).type);
      }
    } catch (err) {
      console.error('Error processing message:', (err as Error).message);
    }
  }

  private handleRegistered(
    msg: RegisteredMessage,
    resolveConnection: () => void
  ): void {
    this.publicUrl = msg.url;

    const wasReconnecting = this.reconnectAttempts > 0;

    // Reset reconnect attempts after successful connection
    if (wasReconnecting) {
      console.log('✓ Reconnection successful!');
      this.reconnectAttempts = 0;
      this.reconnectDelay = this.reconnectOptions.initialDelay;
    }

    console.log('\n✓ Tunnel established!');
    console.log(`Public URL: ${msg.url}`);
    console.log(`Forwarding to: http://localhost:${this.localPort}`);
    console.log('\nWaiting for connections...\n');

    resolveConnection();
  }

  private handleRequest(msg: RequestMessage): void {
    const startTime = Date.now();

    // Check if connection is still open before processing
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log(`⚠ Received request but connection is closed - ignoring`);
      return;
    }

    console.log(
      `${msg.method} ${msg.path} -> localhost:${this.localPort}${msg.path}`
    );

    forwardToLocal(this.localPort, msg, (response) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.log('  ⚠ Cannot send response - connection closed');
        return;
      }

      const responseMsg: ResponseMessage = {
        type: MessageType.RESPONSE,
        requestId: msg.requestId,
        statusCode: response.statusCode,
        headers: response.headers,
        body: response.body,
      };

      const duration = Date.now() - startTime;
      console.log(`  ← ${response.statusCode} (${duration}ms)\n`);

      try {
        this.ws.send(JSON.stringify(responseMsg));
      } catch (err) {
        console.error('  ✗ Error sending response:', (err as Error).message);
      }
    });
  }

  private handleError(msg: ErrorMessage): void {
    console.error('\n✗ Error from server:', msg.message);

    // Check if this is a fatal error that shouldn't trigger reconnection
    const fatalErrors = [
      'subdomain already taken',
      'invalid subdomain',
      'invalid api key',
      'tunnel limit reached',
      'registration failed',
      'rate limit exceeded',
      'message too large',
    ];

    const isFatal = fatalErrors.some((error) =>
      msg.message.toLowerCase().includes(error)
    );

    if (isFatal) {
      console.error('✗ Fatal error - cannot continue');
      this.hasFatalError = true;
      this.shouldReconnect = false;

      // Close the connection and exit
      if (this.ws) {
        this.ws.close();
      }

      setTimeout(() => {
        process.exit(1);
      }, 100);
    }
  }

  close(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();

    if (this.ws) {
      console.log('\nClosing tunnel...');
      this.ws.close(1000, 'Client closing');
      this.ws = null;
    }

    process.exit(0);
  }

  getStatus(): {
    connected: boolean;
    publicUrl: string | null;
    reconnectAttempts: number;
  } {
    return {
      connected: this.isConnected,
      publicUrl: this.publicUrl,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}
