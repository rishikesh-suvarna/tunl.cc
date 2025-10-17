import crypto from 'crypto';
import { Response } from 'express';
import { IncomingHttpHeaders } from 'http';
import WebSocket from 'ws';
import { db } from '../lib/connection';
import { SUBDOMAIN_LENGTH } from '../shared/constants';
import { PendingRequest, RegisterResult } from '../shared/types';

export class TunnelManager {
  private activeTunnels: Map<string, { ws: WebSocket; tunnelId: string }>;
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
      // Check if subdomain already active
      if (this.activeTunnels.has(subdomain)) {
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

        // Check user's tunnel limit
        const activeTunnelCount = await db('tunnels')
          .where({ user_id: userId, is_active: true })
          .whereNull('disconnected_at')
          .count('* as count')
          .first();

        if (
          activeTunnelCount &&
          parseInt(activeTunnelCount.count as string) >= user.tunnel_limit
        ) {
          return { success: false, error: 'Tunnel limit reached' };
        }
      }

      // Create tunnel record in database
      const [tunnel] = await db('tunnels')
        .insert({
          subdomain,
          user_id: userId,
          ip_address: ip,
          is_active: true,
          connected_at: new Date(),
          last_activity_at: new Date(),
        })
        .returning('*');

      // Store in memory with WebSocket
      this.activeTunnels.set(subdomain, {
        ws,
        tunnelId: tunnel.id,
      });

      return { success: true, subdomain };
    } catch (err) {
      console.error('Error registering tunnel:', err);
      return { success: false, error: 'Registration failed' };
    }
  }

  async unregister(subdomain: string): Promise<void> {
    const tunnel = this.activeTunnels.get(subdomain);

    if (tunnel) {
      // Update database
      await db('tunnels').where({ id: tunnel.tunnelId }).update({
        is_active: false,
        disconnected_at: new Date(),
      });

      // Remove from memory
      this.activeTunnels.delete(subdomain);
    }
  }

  getTunnel(subdomain: string): { ws: WebSocket } | undefined {
    const tunnel = this.activeTunnels.get(subdomain);
    return tunnel ? { ws: tunnel.ws } : undefined;
  }

  hasTunnel(subdomain: string): boolean {
    return this.activeTunnels.has(subdomain);
  }

  async incrementRequestCount(
    subdomain: string,
    requestSize: number,
    responseSize: number
  ): Promise<void> {
    const tunnel = this.activeTunnels.get(subdomain);

    if (tunnel) {
      await db('tunnels')
        .where({ id: tunnel.tunnelId })
        .increment('requests_count', 1)
        .increment('bytes_transferred', requestSize + responseSize)
        .update({ last_activity_at: new Date() });
    }
  }

  async logRequest(
    subdomain: string,
    method: string,
    path: string,
    statusCode: number,
    requestSize: number,
    responseSize: number,
    duration: number,
    userAgent: string | undefined,
    ip: string
  ): Promise<void> {
    const tunnel = this.activeTunnels.get(subdomain);

    if (tunnel) {
      await db('requests').insert({
        tunnel_id: tunnel.tunnelId,
        method,
        path,
        status_code: statusCode,
        request_size: requestSize,
        response_size: responseSize,
        duration_ms: duration,
        user_agent: userAgent?.substring(0, 500),
        ip_address: ip,
      });
    }
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

  async getActiveTunnelCount(): Promise<number> {
    const result = await db('tunnels')
      .where({ is_active: true })
      .whereNull('disconnected_at')
      .count('* as count')
      .first();

    return result ? parseInt(result.count as string) : 0;
  }

  // Cleanup tunnels that didn't disconnect properly
  private async cleanupInactiveTunnels(): Promise<void> {
    setInterval(async () => {
      const oneHourAgo = new Date(Date.now() - 3600000);

      await db('tunnels')
        .where({ is_active: true })
        .where('last_activity_at', '<', oneHourAgo)
        .update({
          is_active: false,
          disconnected_at: new Date(),
        });
    }, 300000); // Run every 5 minutes
  }

  get pendingRequestsMap(): Map<string, PendingRequest> {
    return this.pendingRequests;
  }
}
