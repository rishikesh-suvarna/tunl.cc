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
  const { method, path, headers } = requestMsg;

  const options: http.RequestOptions = {
    hostname: 'localhost',
    port: localPort,
    path: path,
    method: method,
    headers: headers,
  };

  const req = http.request(options, (res) => {
    let body = '';

    res.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });

    res.on('end', () => {
      callback({
        statusCode: res.statusCode || 500,
        headers: res.headers,
        body: body,
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

  if (requestMsg.body) {
    req.write(requestMsg.body);
  }

  req.end();
}
