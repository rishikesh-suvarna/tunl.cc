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
  private maxReconnectAttempts: number;
  private reconnectDelay: number;
  private reconnectOptions: ReconnectOptions;
  private publicUrl: string | null;
  private shouldReconnect: boolean;
  private heartbeatInterval: NodeJS.Timeout | null;
  private hasFatalError: boolean;
  private lastPongTime: number;

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
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.reconnectOptions = {
      initialDelay: 1000,
      maxDelay: 60000,
      factor: 1.5,
    };
    this.publicUrl = null;
    this.shouldReconnect = true;
    this.heartbeatInterval = null;
    this.hasFatalError = false;
    this.lastPongTime = 0;
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

      // TODO
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

        // Enable TCP keepalive for faster dead connection detection
        const socket = (this.ws as any)?._socket;
        if (socket && socket.setKeepAlive) {
          // Send keepalive probes after 10s of idle
          socket.setKeepAlive(true, 10000);
          console.log('TCP keepalive enabled');
        }

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
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          console.error('Maximum reconnection attempts reached. Exiting.');
          process.exit(1);
        }

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
    // Initialize last pong time to now (we just connected successfully)
    this.lastPongTime = Date.now();

    // Clean up any existing heartbeat before starting new one
    this.stopHeartbeat();

    // ====================================================================
    // PONG HANDLER: Called when server responds to our ping
    // ====================================================================
    const pongHandler = () => {
      this.lastPongTime = Date.now();
    };

    // Remove any existing handlers to prevent duplicates
    this.ws?.removeAllListeners('pong');
    this.ws?.on('pong', pongHandler);

    // ====================================================================
    // HEARTBEAT LOOP: Sends pings and checks for responses
    // ====================================================================
    this.heartbeatInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.log('WebSocket not in OPEN state - stopping heartbeat');
        this.stopHeartbeat();
        return;
      }

      const now = Date.now();
      const timeSincePong = now - this.lastPongTime;

      // ================================================================
      // CRITICAL: Check if we've received a pong recently
      // If more than 90 seconds have passed since last pong, connection is dead
      // ================================================================
      if (timeSincePong > 90000) {
        console.log(
          `\nWARNING: No pong for ${(timeSincePong / 1000).toFixed(1)}s`
        );
        console.log('Server is not responding - terminating connection');

        if (this.ws) {
          this.ws.terminate();
        }
        return;
      }

      // ================================================================
      // Send ping to server
      // Note: The callback only fires for immediate send errors,
      // NOT for lack of response. We detect lack of response above.
      // ================================================================
      try {
        this.ws.ping((err: Error | undefined) => {
          // This callback fires immediately if there's a send error
          if (err) {
            this.ws?.terminate();
          }
        });
      } catch (err) {
        console.log(`  Error sending ping: ${(err as Error).message}`);
        this.ws?.terminate();
      }
    }, 30000); // Check every 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Remove listeners to prevent memory leaks
    this.ws?.removeAllListeners('pong');
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
      console.log('Reconnection successful!');
      this.reconnectAttempts = 0;
      this.reconnectDelay = this.reconnectOptions.initialDelay;
    }

    console.log('\nTunnel established!');
    console.log(`Public URL: ${msg.url}`);
    console.log(`Forwarding to: http://localhost:${this.localPort}`);
    console.log('\nWaiting for connections...\n');

    resolveConnection();
  }

  private handleRequest(msg: RequestMessage): void {
    const startTime = Date.now();

    // Check if connection is still open before processing
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log(`Received request but connection is closed - ignoring`);
      return;
    }

    console.log(
      `${msg.method} ${msg.path} -> localhost:${this.localPort}${msg.path}`
    );

    forwardToLocal(this.localPort, msg, (response) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.log('  Cannot send response - connection closed');
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
      console.log(`  ${response.statusCode} (${duration}ms)\n`);

      try {
        this.ws.send(JSON.stringify(responseMsg));
      } catch (err) {
        console.error('  Error sending response:', (err as Error).message);
      }
    });
  }

  private handleError(msg: ErrorMessage): void {
    console.error('\nError from server:', msg.message);

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
      console.error('Fatal error - cannot continue');
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
