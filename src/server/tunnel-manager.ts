import crypto from 'crypto';
import { IncomingHttpHeaders, ServerResponse } from 'http';
import WebSocket from 'ws';
import { db } from '../lib/db';
import { redisTunnel } from '../lib/redis';
import { SUBDOMAIN_LENGTH } from '../shared/constants';
import { PendingRequest, RegisterResult } from '../shared/types';

export class TunnelManager {
  private activeTunnels: Map<string, { ws: WebSocket }>;
  private pendingRequests: Map<string, PendingRequest>;

  constructor() {
    this.activeTunnels = new Map();
    this.pendingRequests = new Map();
    this.cleanupInactiveTunnels();
  }

  generateSubdomain(): string {
    return crypto.randomBytes(SUBDOMAIN_LENGTH / 2).toString('hex');
  }

  async register(
    subdomain: string,
    ws: WebSocket,
    apiKey: string | null = null,
    ip: string = 'unknown'
  ): Promise<RegisterResult> {
    try {
      // Check if subdomain already active in memory
      if (this.activeTunnels.has(subdomain)) {
        return { success: false, error: 'Subdomain already taken' };
      }

      // Check if subdomain exists in Redis
      const existingTunnel = await redisTunnel.exists(subdomain);
      if (existingTunnel) {
        return { success: false, error: 'Subdomain already taken' };
      }

      let userId: string | null = null;

      // Validate API key and get user
      if (apiKey) {
        const user = await db('users')
          .where({ api_key: apiKey, is_active: true })
          .first();

        if (!user) {
          return { success: false, error: 'Invalid API key' };
        }

        userId = user.id;

        if (!userId) {
          return { success: false, error: 'User ID not found' };
        }

        // Check user's tunnel limit using Redis
        const activeTunnelCount = await redisTunnel.getUserTunnelCount(userId);

        if (activeTunnelCount >= user.tunnel_limit) {
          return { success: false, error: 'Tunnel limit reached' };
        }
      }

      // Create tunnel in Redis
      await redisTunnel.create(subdomain, userId, ip);

      // Store in memory with WebSocket
      this.activeTunnels.set(subdomain, { ws });

      return { success: true, subdomain };
    } catch (err) {
      console.error('Error registering tunnel:', err);
      return { success: false, error: 'Registration failed' };
    }
  }

  async unregister(subdomain: string): Promise<void> {
    const tunnel = this.activeTunnels.get(subdomain);

    if (tunnel) {
      // Remove from Redis
      await redisTunnel.remove(subdomain);

      // Remove from memory
      this.activeTunnels.delete(subdomain);
    }
  }

  getTunnel(subdomain: string): { ws: WebSocket } | undefined {
    return this.activeTunnels.get(subdomain);
  }

  hasTunnel(subdomain: string): boolean {
    return this.activeTunnels.has(subdomain);
  }

  async incrementRequestCount(
    subdomain: string,
    requestSize: number,
    responseSize: number
  ): Promise<void> {
    if (this.activeTunnels.has(subdomain)) {
      await redisTunnel.incrementMetrics(subdomain, requestSize, responseSize);
    }
  }

  addPendingRequest(
    requestId: string,
    res: ServerResponse,
    timeout: NodeJS.Timeout,
    metadata?: any
  ): void {
    this.pendingRequests.set(requestId, { res, timeout, metadata });
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
    const { res, metadata } = pending;

    // Use writeHead and end instead of Express methods
    const responseHeaders: any = { 'Content-Type': 'text/html' };

    if (headers) {
      Object.entries(headers).forEach(([k, v]) => {
        if (v !== undefined) {
          responseHeaders[k] = v;
        }
      });
    }

    res.writeHead(statusCode || 200, responseHeaders);
    res.end(body || '');

    // Update metrics if metadata exists
    if (metadata) {
      const responseSize = body ? Buffer.byteLength(body.toString()) : 0;

      this.incrementRequestCount(
        metadata.subdomain,
        metadata.requestSize,
        responseSize
      );
    }

    this.pendingRequests.delete(requestId);

    return true;
  }

  timeoutRequest(requestId: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      pending.res.writeHead(504, { 'Content-Type': 'text/plain' });
      pending.res.end('Gateway Timeout');
      this.pendingRequests.delete(requestId);
    }
  }

  async getActiveTunnelCount(): Promise<number> {
    try {
      return await redisTunnel.getActiveCount();
    } catch (err) {
      console.error('Error getting active tunnel count:', err);
      return this.activeTunnels.size; // Fallback to memory count
    }
  }

  // Cleanup tunnels that didn't disconnect properly
  private cleanupInactiveTunnels(): void {
    setInterval(async () => {
      try {
        const cleaned = await redisTunnel.cleanupInactive();
        if (cleaned > 0) {
          console.log(`Cleaned up ${cleaned} inactive tunnels`);
        }
      } catch (err) {
        console.error('Error cleaning up inactive tunnels:', err);
      }
    }, 300000); // Run every 5 minutes
  }

  get pendingRequestsMap(): Map<string, PendingRequest> {
    return this.pendingRequests;
  }
}
