import { isValidSubdomain } from '../../src/server/utils/validation';

describe('isValidSubdomain', () => {
  describe('format', () => {
    it('accepts simple alphanumeric subdomains', () => {
      expect(isValidSubdomain('myapp')).toBe(true);
      expect(isValidSubdomain('test123')).toBe(true);
      expect(isValidSubdomain('lms-web')).toBe(true);
    });

    it('rejects too-short subdomains', () => {
      expect(isValidSubdomain('ab')).toBe(false);
      expect(isValidSubdomain('')).toBe(false);
    });

    it('rejects too-long subdomains (> 63 chars)', () => {
      expect(isValidSubdomain('a'.repeat(64))).toBe(false);
      expect(isValidSubdomain('a'.repeat(63))).toBe(true);
    });

    it('rejects subdomains with invalid characters', () => {
      expect(isValidSubdomain('my_app')).toBe(false);
      expect(isValidSubdomain('my.app')).toBe(false);
      expect(isValidSubdomain('my app')).toBe(false);
      expect(isValidSubdomain('my!app')).toBe(false);
    });

    it('rejects subdomains starting or ending with hyphens', () => {
      expect(isValidSubdomain('-myapp')).toBe(false);
      expect(isValidSubdomain('myapp-')).toBe(false);
    });
  });

  describe('reserved names', () => {
    it.each([
      'www',
      'api',
      'admin',
      'mail',
      'support',
      'help',
      'secure',
      'vpn',
    ])('rejects reserved name "%s"', (name) => {
      expect(isValidSubdomain(name)).toBe(false);
    });
  });

  describe('brand impersonation', () => {
    it.each([
      'paypal',
      'paypal-login',
      'paypal-secure',
      'mypaypal',
      'pay-pal', // hyphen-stripped match
      'paypa-login', // contains 'paypa' but not 'paypal' — should pass... actually no
    ])('rejects subdomain "%s" containing "paypal"', (name) => {
      // Skip ones that don't actually contain 'paypal' after stripping hyphens
      const stripped = name.replace(/-/g, '');
      if (stripped.includes('paypal')) {
        expect(isValidSubdomain(name)).toBe(false);
      } else {
        expect(isValidSubdomain(name)).toBe(true);
      }
    });

    it.each([
      'microsoft',
      'microsoft-login',
      'microsoft-365-secure',
      'office365',
      'verify-microsoft',
    ])('rejects Microsoft impersonation "%s"', (name) => {
      expect(isValidSubdomain(name)).toBe(false);
    });

    it.each([
      'google',
      'gmail',
      'gmail-login',
      'google-drive',
      'sign-in-google',
    ])('rejects Google impersonation "%s"', (name) => {
      expect(isValidSubdomain(name)).toBe(false);
    });

    it.each([
      'apple-id',
      'icloud-secure',
      'appleid-verify',
      'itunes-billing',
    ])('rejects Apple impersonation "%s"', (name) => {
      expect(isValidSubdomain(name)).toBe(false);
    });

    it.each([
      'chase-bank',
      'wellsfargo-login',
      'bankofamerica',
      'hsbc-secure',
      'capitalone-rewards',
    ])('rejects bank impersonation "%s"', (name) => {
      expect(isValidSubdomain(name)).toBe(false);
    });

    it.each([
      'coinbase-pro',
      'metamask-secure',
      'binance-login',
      'ledger-recover',
      'trezor-wallet',
    ])('rejects crypto impersonation "%s"', (name) => {
      expect(isValidSubdomain(name)).toBe(false);
    });

    it.each([
      'irs-refund',
      'usps-tracking',
      'fedex-delivery',
      'royalmail-update',
    ])('rejects government/mail impersonation "%s"', (name) => {
      expect(isValidSubdomain(name)).toBe(false);
    });

    it('catches hyphen-stripped variants (pay-pal -> paypal)', () => {
      expect(isValidSubdomain('pay-pal')).toBe(false);
      expect(isValidSubdomain('g-mail')).toBe(false);
      expect(isValidSubdomain('coin-base')).toBe(false);
    });

    it('still accepts unrelated names that happen to share a prefix', () => {
      // 'apparent' contains 'appa' not 'apple'
      expect(isValidSubdomain('apparent')).toBe(true);
      // 'amazing' contains 'amaz' but not 'amazon'
      expect(isValidSubdomain('amazing')).toBe(true);
      // 'meta-data' contains 'meta' which IS a brand — expected to be blocked.
      expect(isValidSubdomain('meta-data')).toBe(false);
    });
  });

  describe('legitimate names should still pass', () => {
    it.each([
      'lms-web',
      'my-blog',
      'staging-2024',
      'dev-server',
      'project-x',
      'team-alpha',
      'test123',
      'cool-app-1',
    ])('accepts "%s"', (name) => {
      expect(isValidSubdomain(name)).toBe(true);
    });
  });
});
