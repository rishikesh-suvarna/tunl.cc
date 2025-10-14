import crypto from 'crypto';
import { Response } from 'express';
import { IncomingHttpHeaders } from 'http';
import WebSocket from 'ws';
import { SUBDOMAIN_LENGTH } from '../shared/constants';
import { PendingRequest, RegisterResult, TunnelInfo } from '../shared/types';

export class TunnelManager {
  private tunnels: Map<string, TunnelInfo>;
  private pendingRequests: Map<string, PendingRequest>;

  constructor() {
    this.tunnels = new Map();
    this.pendingRequests = new Map();
  }

  generateSubdomain(): string {
    return crypto.randomBytes(SUBDOMAIN_LENGTH / 2).toString('hex');
  }

  register(subdomain: string, ws: WebSocket): RegisterResult {
    if (this.tunnels.has(subdomain)) {
      return { success: false, error: 'Subdomain already taken' };
    }

    this.tunnels.set(subdomain, { ws, requests: new Map() });
    return { success: true, subdomain };
  }

  unregister(subdomain: string): void {
    this.tunnels.delete(subdomain);
  }

  getTunnel(subdomain: string): TunnelInfo | undefined {
    return this.tunnels.get(subdomain);
  }

  hasTunnel(subdomain: string): boolean {
    return this.tunnels.has(subdomain);
  }

  addPendingRequest(
    requestId: string,
    res: Response,
    timeout: NodeJS.Timeout
  ): void {
    this.pendingRequests.set(requestId, { res, timeout });
  }

  resolvePendingRequest(
    requestId: string,
    statusCode: number,
    headers?: IncomingHttpHeaders,
    body?: any
  ): boolean {
    const pending = this.pendingRequests.get(requestId);

    if (!pending) return false;

    clearTimeout(pending.timeout);
    const { res } = pending;

    res.status(statusCode || 200);

    if (headers) {
      Object.entries(headers).forEach(([k, v]) => {
        if (v !== undefined) {
          res.setHeader(k, v);
        }
      });
    }

    res.send(body || '');
    this.pendingRequests.delete(requestId);

    return true;
  }

  timeoutRequest(requestId: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      pending.res.status(504).send('Gateway Timeout');
      this.pendingRequests.delete(requestId);
    }
  }

  getActiveTunnelCount(): number {
    return this.tunnels.size;
  }

  // Expose for cleanup
  get pendingRequestsMap(): Map<string, PendingRequest> {
    return this.pendingRequests;
  }
}
