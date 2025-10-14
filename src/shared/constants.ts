export const DEFAULT_PORT = 3000;
export const DEFAULT_TIMEOUT = 30000;
export const SUBDOMAIN_LENGTH = 8;

export enum MessageType {
  REGISTER = 'register',
  REGISTERED = 'registered',
  REQUEST = 'request',
  RESPONSE = 'response',
  ERROR = 'error',
}

export const MESSAGE_TYPES = {
  REGISTER: MessageType.REGISTER,
  REGISTERED: MessageType.REGISTERED,
  REQUEST: MessageType.REQUEST,
  RESPONSE: MessageType.RESPONSE,
  ERROR: MessageType.ERROR,
};
