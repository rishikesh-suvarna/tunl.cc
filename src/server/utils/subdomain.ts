export function extractSubdomain(hostname: string | undefined, baseDomain: string): string | null {
  if (!hostname) return null;

  // Remove port if present
  const host = hostname.split(':')[0];

  // For development
  if (host === 'localhost' || host === '127.0.0.1') {
    return null;
  }

  // Extract subdomain
  const parts = host ? host.split('.') : [];
  const baseParts = baseDomain ? baseDomain?.split(':')[0]?.split('.') : [];

  // If hostname has more parts than base domain, first part is subdomain
  if (parts.length > (baseParts?.length || 0)) {
    if(parts[0]) return parts[0];

  }

  return null;
}
