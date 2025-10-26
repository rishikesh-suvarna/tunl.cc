import http, { IncomingHttpHeaders } from 'http';
import { RequestMessage } from '../shared/types';

export interface ProxyResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: string;
}

const DEFAULT_PROXY_TIMEOUT = 30000; // 30 seconds

export function forwardToLocal(
  localPort: number,
  requestMsg: RequestMessage,
  callback: (response: ProxyResponse) => void
): void {
  const { method, path, headers, body } = requestMsg;

  // Clean headers - remove hop-by-hop headers
  const cleanHeaders = { ...headers };
  delete cleanHeaders.host;
  delete cleanHeaders.connection;
  delete cleanHeaders['transfer-encoding'];
  delete cleanHeaders['keep-alive'];
  delete cleanHeaders['proxy-connection'];
  delete cleanHeaders['proxy-authenticate'];
  delete cleanHeaders['proxy-authorization'];
  delete cleanHeaders.te;
  delete cleanHeaders.trailer;
  delete cleanHeaders.upgrade;

  // Decode base64 body if present
  let requestBody: Buffer | undefined;
  if (body) {
    try {
      requestBody = Buffer.from(body, 'base64');
      cleanHeaders['content-length'] = requestBody.length.toString();
    } catch (err) {
      console.error('  ✗ Error decoding request body:', (err as Error).message);
      callback({
        statusCode: 400,
        headers: {},
        body: 'Bad Request: Invalid body encoding',
      });
      return;
    }
  } else {
    // Ensure content-length is 0 if no body
    delete cleanHeaders['content-length'];
  }

  const options: http.RequestOptions = {
    hostname: 'localhost',
    port: localPort,
    path: path,
    method: method,
    headers: cleanHeaders,
    timeout: DEFAULT_PROXY_TIMEOUT,
  };

  const req = http.request(options, (res) => {
    const responseChunks: Buffer[] = [];
    let totalBytes = 0;

    res.on('data', (chunk: Buffer) => {
      responseChunks.push(chunk);
      totalBytes += chunk.length;

      // Prevent memory issues with very large responses (max 100MB)
      if (totalBytes > 100 * 1024 * 1024) {
        req.destroy();
        callback({
          statusCode: 413,
          headers: {},
          body: 'Response too large',
        });
      }
    });

    res.on('end', () => {
      try {
        const responseBody = Buffer.concat(responseChunks).toString('utf-8');

        // Clean response headers
        const responseHeaders = { ...res.headers };
        delete responseHeaders.connection;
        delete responseHeaders['keep-alive'];

        callback({
          statusCode: res.statusCode || 500,
          headers: responseHeaders,
          body: responseBody,
        });
      } catch (err) {
        console.error('  ✗ Error processing response:', (err as Error).message);
        callback({
          statusCode: 500,
          headers: {},
          body: 'Internal Server Error',
        });
      }
    });

    res.on('error', (err: Error) => {
      console.error('  ✗ Response error:', err.message);
      callback({
        statusCode: 502,
        headers: {},
        body: `Error reading response: ${err.message}`,
      });
    });
  });

  req.on('error', (err: Error) => {
    console.error(
      `  ✗ Error connecting to localhost:${localPort} - ${err.message}`
    );

    // Provide helpful error messages
    let errorMessage = `Error connecting to local server: ${err.message}`;
    let statusCode = 502;

    if ((err as any).code === 'ECONNREFUSED') {
      errorMessage = `Connection refused. Is your local server running on port ${localPort}?`;
      statusCode = 503;
    } else if ((err as any).code === 'ETIMEDOUT') {
      errorMessage = `Connection timeout. Local server on port ${localPort} is not responding.`;
      statusCode = 504;
    } else if ((err as any).code === 'ENOTFOUND') {
      errorMessage = 'Hostname not found';
      statusCode = 502;
    }

    callback({
      statusCode,
      headers: { 'content-type': 'text/plain' },
      body: errorMessage,
    });
  });

  req.on('timeout', () => {
    console.error(`  ✗ Request timeout after ${DEFAULT_PROXY_TIMEOUT}ms`);
    req.destroy();
    callback({
      statusCode: 504,
      headers: {},
      body: 'Gateway Timeout: Local server took too long to respond',
    });
  });

  // Write request body if present
  if (requestBody) {
    try {
      req.write(requestBody);
    } catch (err) {
      console.error('  ✗ Error writing request body:', (err as Error).message);
      callback({
        statusCode: 500,
        headers: {},
        body: 'Internal Server Error',
      });
      return;
    }
  }

  req.end();
}
