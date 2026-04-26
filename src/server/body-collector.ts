import { IncomingMessage, ServerResponse } from 'http';

export function collectRequestBody(
  req: IncomingMessage,
  res: ServerResponse,
  maxBytes: number
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytesReceived = 0;
    let settled = false;

    const finish = (value: Buffer | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      bytesReceived += chunk.length;
      if (bytesReceived > maxBytes) {
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'text/plain' });
          res.end(`Request body too large (max ${maxBytes} bytes)`);
        }
        req.destroy();
        finish(null);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => finish(Buffer.concat(chunks)));
    req.on('error', () => finish(null));
    req.on('close', () => finish(null));
  });
}
