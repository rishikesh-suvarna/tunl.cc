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

export class TunnelClient {
  private localPort: number;
  private tunnelServer: string;
  private subdomain: string | null;
  private ws: WebSocket | null;

  constructor(
    localPort: number,
    tunnelServer: string,
    subdomain: string | null = null
  ) {
    this.localPort = localPort;
    this.tunnelServer = tunnelServer;
    this.subdomain = subdomain;
    this.ws = null;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('Starting tunnel client...');
      console.log(`Local server: http://localhost:${this.localPort}`);
      console.log(`Tunnel server: ${this.tunnelServer}`);

      this.ws = new WebSocket(this.tunnelServer);

      this.ws.on('open', () => {
        console.log('Connected to tunnel server');
        this.register();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data, resolve);
      });

      this.ws.on('error', (err: Error) => {
        console.error('WebSocket error:', err.message);
        reject(err);
      });

      this.ws.on('close', () => {
        console.log('\nTunnel closed');
        process.exit(0);
      });
    });
  }

  private register(): void {
    if (!this.ws) return;

    const registerMsg: RegisterMessage = {
      type: MessageType.REGISTER,
      subdomain: this.subdomain || undefined,
    };

    this.ws.send(JSON.stringify(registerMsg));
  }

  private handleMessage(
    data: WebSocket.Data,
    resolveConnection: () => void
  ): void {
    try {
      const msg: Message = JSON.parse(data.toString());

      console.log(msg);

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
      }
    } catch (err) {
      console.error('Error processing message:', (err as Error).message);
    }
  }

  private handleRegistered(
    msg: RegisteredMessage,
    resolveConnection: () => void
  ): void {
    console.log('\n✓ Tunnel established!');
    console.log(`Public URL: ${msg.url}`);
    console.log(`Forwarding to: http://localhost:${this.localPort}`);
    console.log('\nWaiting for connections...\n');
    resolveConnection();
  }

  private handleRequest(msg: RequestMessage): void {
    console.log(
      `${msg.method} ${msg.path} -> localhost:${this.localPort}${msg.path}`
    );

    forwardToLocal(this.localPort, msg, (response) => {
      if (!this.ws) return;

      const responseMsg: ResponseMessage = {
        type: MessageType.RESPONSE,
        requestId: msg.requestId,
        statusCode: response.statusCode,
        headers: response.headers,
        body: response.body,
      };

      console.log(`  Responded with ${response.statusCode}\n`);

      this.ws.send(JSON.stringify(responseMsg));
    });
  }

  private handleError(msg: ErrorMessage): void {
    console.error('Error:', msg.message);
    process.exit(1);
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
    }
  }
}
