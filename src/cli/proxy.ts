import http, { IncomingHttpHeaders } from 'http';
import { RequestMessage } from '../shared/types';

export interface ProxyResponse {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: string;
}

export function forwardToLocal(
  localPort: number,
  requestMsg: RequestMessage,
  callback: (response: ProxyResponse) => void
): void {
  const { method, path, headers, body } = requestMsg;

  // Clean headers
  const cleanHeaders = { ...headers };
  delete cleanHeaders.host;
  delete cleanHeaders.connection;
  delete cleanHeaders['transfer-encoding'];

  // Decode base64 body if present
  let requestBody: Buffer | undefined;
  if (body) {
    requestBody = Buffer.from(body, 'base64');
    cleanHeaders['content-length'] = requestBody.length.toString();
  }

  const options: http.RequestOptions = {
    hostname: 'localhost',
    port: localPort,
    path: path,
    method: method,
    headers: cleanHeaders,
  };

  const req = http.request(options, (res) => {
    const responseChunks: Buffer[] = [];

    res.on('data', (chunk: Buffer) => {
      responseChunks.push(chunk);
    });

    res.on('end', () => {
      const responseBody = Buffer.concat(responseChunks).toString('utf-8');

      callback({
        statusCode: res.statusCode || 500,
        headers: res.headers,
        body: responseBody,
      });
    });
  });

  req.on('error', (err: Error) => {
    console.error(`  Error forwarding request: ${err.message}`);

    callback({
      statusCode: 502,
      headers: {},
      body: `Error connecting to local server: ${err.message}`,
    });
  });

  // Write raw body if present
  if (requestBody) {
    req.write(requestBody);
  }

  req.end();
}
