import { IncomingHttpHeaders, ServerResponse } from 'http';
import WebSocket from 'ws';
import { MessageType } from './constants';

export interface ServerConfig {
  port: number;
  baseDomain: string;
  https: boolean;
}

export interface TunnelInfo {
  ws: WebSocket;
  requests: Map<string, any>;
}

export interface PendingRequest {
  res: ServerResponse;
  timeout: NodeJS.Timeout;
  metadata?: {
    subdomain: string;
    method: string;
    path: string;
    requestSize: number;
    startTime: number;
    userAgent?: string;
    ip: string;
  };
}

export interface RegisterMessage {
  type: MessageType.REGISTER;
  subdomain?: string;
  apiKey?: string;
}

export interface RegisteredMessage {
  type: MessageType.REGISTERED;
  subdomain: string;
  url: string;
}

export interface RequestMessage {
  type: MessageType.REQUEST;
  requestId: string;
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body?: any;
}

export interface ResponseMessage {
  type: MessageType.RESPONSE;
  requestId: string;
  statusCode: number;
  headers?: IncomingHttpHeaders;
  body?: any;
}

export interface ErrorMessage {
  type: MessageType.ERROR;
  message: string;
}

export type Message =
  | RegisterMessage
  | RegisteredMessage
  | RequestMessage
  | ResponseMessage
  | ErrorMessage;

export interface RegisterResult {
  success: boolean;
  subdomain?: string;
  error?: string;
}
