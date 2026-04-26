import { IncomingHttpHeaders, OutgoingHttpHeaders } from 'http';
import { BodyEncoding } from '../shared/types';

export interface BuiltHttpResponse {
  statusCode: number;
  headers: OutgoingHttpHeaders;
  body: Buffer | string;
}

export function buildHttpResponse(
  statusCode: number,
  headers?: IncomingHttpHeaders,
  body?: string,
  bodyEncoding?: BodyEncoding
): BuiltHttpResponse {
  const responseHeaders: OutgoingHttpHeaders = {};
  if (headers) {
    Object.entries(headers).forEach(([k, v]) => {
      if (v !== undefined) {
        responseHeaders[k.toLowerCase()] = v;
      }
    });
  }

  let bodyToWrite: Buffer | string = '';
  if (body) {
    bodyToWrite =
      bodyEncoding === 'base64' ? Buffer.from(body, 'base64') : body;
  }

  return {
    statusCode: statusCode || 200,
    headers: responseHeaders,
    body: bodyToWrite,
  };
}

export function bodyByteLength(body: Buffer | string): number {
  return body instanceof Buffer ? body.length : Buffer.byteLength(body);
}
