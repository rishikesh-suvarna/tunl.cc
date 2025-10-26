import Redis from 'ioredis';
import {
  REDIS_DB,
  REDIS_HOST,
  REDIS_PASSWORD,
  REDIS_PORT,
} from '../config/app.config';

// Redis client configuration
const redis = new Redis({
  host: REDIS_HOST || 'localhost',
  port: REDIS_PORT || 6379,
  password: REDIS_PASSWORD,
  db: REDIS_DB || 0,
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

redis.on('error', (err: Error) => {
  console.error('Redis error:', err);
});

// Tunnel interface for Redis storage
export interface RedisTunnel {
  subdomain: string;
  userId: string | null;
  ipAddress: string;
  connectedAt: string;
  lastActivityAt: string;
  requestsCount: number;
  bytesTransferred: number;
}

// Redis keys
const TUNNEL_KEY = (subdomain: string) => `tunnel:${subdomain}`;
const USER_TUNNELS_KEY = (userId: string) => `user:${userId}:tunnels`;
const ACTIVE_TUNNELS_SET = 'tunnels:active';

// Tunnel operations
export const redisTunnel = {
  // Create a new tunnel
  async create(
    subdomain: string,
    userId: string | null,
    ipAddress: string
  ): Promise<void> {
    const tunnel: RedisTunnel = {
      subdomain,
      userId,
      ipAddress,
      connectedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      requestsCount: 0,
      bytesTransferred: 0,
    };

    const pipeline = redis.pipeline();

    // Store tunnel data
    pipeline.hmset(TUNNEL_KEY(subdomain), tunnel as any);

    // Add to active tunnels set
    pipeline.sadd(ACTIVE_TUNNELS_SET, subdomain);

    // Add to user's tunnel set if user exists
    if (userId) {
      pipeline.sadd(USER_TUNNELS_KEY(userId), subdomain);
    }

    // Set expiry (24 hours max)
    pipeline.expire(TUNNEL_KEY(subdomain), 86400);

    await pipeline.exec();
  },

  // Get tunnel by subdomain
  async get(subdomain: string): Promise<RedisTunnel | null> {
    const tunnel = await redis.hgetall(TUNNEL_KEY(subdomain));

    if (!tunnel || !tunnel.subdomain) {
      return null;
    }

    return {
      subdomain: tunnel.subdomain,
      userId: tunnel.userId === 'null' ? null : tunnel.userId!,
      ipAddress: tunnel.ipAddress!,
      connectedAt: tunnel.connectedAt!,
      lastActivityAt: tunnel.lastActivityAt!,
      requestsCount: parseInt(tunnel.requestsCount || '0'),
      bytesTransferred: parseInt(tunnel.bytesTransferred || '0'),
    };
  },

  // Check if tunnel exists
  async exists(subdomain: string): Promise<boolean> {
    return (await redis.exists(TUNNEL_KEY(subdomain))) === 1;
  },

  // Remove tunnel
  async remove(subdomain: string): Promise<void> {
    const tunnel = await this.get(subdomain);

    const pipeline = redis.pipeline();

    // Remove tunnel data
    pipeline.del(TUNNEL_KEY(subdomain));

    // Remove from active set
    pipeline.srem(ACTIVE_TUNNELS_SET, subdomain);

    // Remove from user's tunnel set if user exists
    if (tunnel?.userId) {
      pipeline.srem(USER_TUNNELS_KEY(tunnel.userId), subdomain);
    }

    await pipeline.exec();
  },

  // Update last activity
  async updateActivity(subdomain: string): Promise<void> {
    await redis.hset(
      TUNNEL_KEY(subdomain),
      'lastActivityAt',
      new Date().toISOString()
    );
  },

  // Increment request count and bytes
  async incrementMetrics(
    subdomain: string,
    requestSize: number,
    responseSize: number
  ): Promise<void> {
    const pipeline = redis.pipeline();

    pipeline.hincrby(TUNNEL_KEY(subdomain), 'requestsCount', 1);
    pipeline.hincrby(
      TUNNEL_KEY(subdomain),
      'bytesTransferred',
      requestSize + responseSize
    );
    pipeline.hset(
      TUNNEL_KEY(subdomain),
      'lastActivityAt',
      new Date().toISOString()
    );

    await pipeline.exec();
  },

  // Get all active tunnels count
  async getActiveCount(): Promise<number> {
    return await redis.scard(ACTIVE_TUNNELS_SET);
  },

  // Get user's active tunnel count
  async getUserTunnelCount(userId: string): Promise<number> {
    return await redis.scard(USER_TUNNELS_KEY(userId));
  },

  // Get user's active tunnels
  async getUserTunnels(userId: string): Promise<string[]> {
    return await redis.smembers(USER_TUNNELS_KEY(userId));
  },

  // Cleanup inactive tunnels (older than 1 hour of inactivity)
  async cleanupInactive(): Promise<number> {
    const allTunnels = await redis.smembers(ACTIVE_TUNNELS_SET);
    const oneHourAgo = Date.now() - 3600000;
    let cleaned = 0;

    for (const subdomain of allTunnels) {
      const tunnel = await this.get(subdomain);

      if (tunnel) {
        const lastActivity = new Date(tunnel.lastActivityAt).getTime();

        if (lastActivity < oneHourAgo) {
          await this.remove(subdomain);
          cleaned++;
        }
      } else {
        // Tunnel data missing, remove from set
        await redis.srem(ACTIVE_TUNNELS_SET, subdomain);
        cleaned++;
      }
    }

    return cleaned;
  },

  // Clear all tunnels (used on server startup)
  async clearAll(): Promise<number> {
    const allTunnels = await redis.smembers(ACTIVE_TUNNELS_SET);
    let cleared = 0;

    for (const subdomain of allTunnels) {
      await this.remove(subdomain);
      cleared++;
    }

    return cleared;
  },
};

export { redis };
