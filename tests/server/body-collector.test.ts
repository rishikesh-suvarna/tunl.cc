import http, { AddressInfo } from 'http';
import { collectRequestBody } from '../../src/server/body-collector';

interface TestResult {
  status: number;
  body: string;
}

async function runWithCollector(
  maxBytes: number,
  postPayload: Buffer
): Promise<{ collected: Buffer | null; clientResult: TestResult }> {
  let collected: Buffer | null | undefined;

  const server = http.createServer(async (req, res) => {
    collected = await collectRequestBody(req, res, maxBytes);
    if (collected !== null && !res.headersSent) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(collected);
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    const clientResult = await new Promise<TestResult>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          method: 'POST',
          path: '/',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': postPayload.length,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode || 0,
              body: Buffer.concat(chunks).toString(),
            })
          );
          res.on('error', reject);
        }
      );
      req.on('error', (err: any) => {
        // Server may close the socket on rejection; accept ECONNRESET as the
        // body was already read and we received the 413 response.
        if (err.code === 'ECONNRESET') return;
        reject(err);
      });
      req.write(postPayload);
      req.end();
    });

    return { collected: collected ?? null, clientResult };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('collectRequestBody', () => {
  it('returns the full body when within the size limit', async () => {
    const payload = Buffer.from('hello world');
    const { collected, clientResult } = await runWithCollector(1024, payload);
    expect(collected).not.toBeNull();
    expect(collected!.equals(payload)).toBe(true);
    expect(clientResult.status).toBe(200);
  });

  it('handles binary bodies byte-perfect', async () => {
    const payload = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) payload[i] = i;
    const { collected } = await runWithCollector(1024, payload);
    expect(collected!.equals(payload)).toBe(true);
  });

  it('replies 413 and resolves null when body exceeds the limit', async () => {
    const payload = Buffer.alloc(2048);
    const { collected, clientResult } = await runWithCollector(512, payload);
    expect(collected).toBeNull();
    expect(clientResult.status).toBe(413);
    expect(clientResult.body).toContain('too large');
    expect(clientResult.body).toContain('512');
  });

  it('accepts an empty body', async () => {
    const payload = Buffer.alloc(0);
    const { collected, clientResult } = await runWithCollector(1024, payload);
    expect(collected).not.toBeNull();
    expect(collected!.length).toBe(0);
    expect(clientResult.status).toBe(200);
  });

  it('accepts a body exactly at the limit', async () => {
    const payload = Buffer.alloc(512, 0x41);
    const { collected, clientResult } = await runWithCollector(512, payload);
    expect(collected).not.toBeNull();
    expect(collected!.length).toBe(512);
    expect(clientResult.status).toBe(200);
  });
});
