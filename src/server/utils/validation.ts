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

// Brand-impersonation blocklist (substring match, case-insensitive).
// Targets the subdomains most commonly abused for phishing kits. False positives
// are acceptable — users can pick a different name; the legal/abuse cost of an
// uncaught phishing tunnel is much higher than a frustrated legitimate user.
const BRAND_IMPERSONATION_BLOCKLIST: string[] = [
  // Big tech
  'apple',
  'icloud',
  'appleid',
  'itunes',
  'google',
  'gmail',
  'gdrive',
  'gsuite',
  'youtube',
  'microsoft',
  'office365',
  'outlook',
  'hotmail',
  'onedrive',
  'azure',
  'msn',
  'amazon',
  'aws',
  'kindle',
  'meta',
  'facebook',
  'instagram',
  'whatsapp',
  'messenger',
  'threads',
  'twitter',
  'linkedin',
  'tiktok',

  // Media / SaaS
  'netflix',
  'disney',
  'hulu',
  'spotify',
  'twitch',
  'zoom',
  'slack',
  'discord',
  'telegram',
  'github',
  'gitlab',
  'dropbox',
  'salesforce',
  'okta',

  // Payments / fintech
  'paypal',
  'venmo',
  'cashapp',
  'zelle',
  'stripe',
  'wise',
  'revolut',
  'visa',
  'mastercard',
  'amex',
  'americanexpress',

  // Banking
  'chase',
  'wellsfargo',
  'bankofamerica',
  'citibank',
  'hsbc',
  'barclays',
  'lloyds',
  'natwest',
  'santander',
  'capitalone',
  'usbank',
  'schwab',
  'fidelity',
  'vanguard',

  // Crypto
  'coinbase',
  'binance',
  'kraken',
  'metamask',
  'trezor',
  'ledger',
  'phantom',
  'opensea',
  'etherscan',

  // Government / mail / shipping
  'irs',
  'usps',
  'fedex',
  'dhl',
  'royalmail',
  'dmv',
  'hmrc',
  'socialsecurity',

  // E-commerce
  'ebay',
  'walmart',
  'bestbuy',
  'aliexpress',
  'alibaba',
  'etsy',
  'shopify',

  // Gaming
  'steam',
  'roblox',
  'epicgames',
  'playstation',
  'xbox',
  'nintendo',

  // High-signal phishing terms
  'authenticate',
  'verifyaccount',
  'unlockaccount',
  'resetpassword',
];

export function isValidSubdomain(subdomain: string): boolean {
  if (subdomain.length < 3 || subdomain.length > 63) {
    return false;
  }

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(subdomain)) {
    return false;
  }

  const normalized = subdomain.toLowerCase();

  if (RESERVED_SUBDOMAINS.includes(normalized)) {
    return false;
  }

  if (PROFANITY_LIST.some((word) => normalized.includes(word))) {
    return false;
  }

  // Brand-impersonation check (substring match, ignoring hyphens)
  // so `paypal-login` and `pay-pal` both match `paypal`.
  const stripped = normalized.replace(/-/g, '');
  if (BRAND_IMPERSONATION_BLOCKLIST.some((brand) => stripped.includes(brand))) {
    return false;
  }

  return true;
}
