const RESERVED_SUBDOMAINS: string[] = [
  'www',
  'api',
  'admin',
  'dashboard',
  'app',
  'mail',
  'ftp',
  'localhost',
  'webmail',
  'smtp',
  'pop',
  'ns',
  'dns',
  'support',
  'help',
  'secure',
  'ssl',
  'vpn',
];

const PROFANITY_LIST: string[] = [
  // TODO: Needs to be populated with a comprehensive list of profane words
];

export function isValidSubdomain(subdomain: string): boolean {
  // Length check
  if (subdomain.length < 3 || subdomain.length > 63) {
    return false;
  }

  // Format check (alphanumeric and hyphens only)
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(subdomain)) {
    return false;
  }

  // Reserved check
  if (RESERVED_SUBDOMAINS.includes(subdomain.toLowerCase())) {
    return false;
  }

  // Profanity check
  if (PROFANITY_LIST.some((word) => subdomain.toLowerCase().includes(word))) {
    return false;
  }

  return true;
}
