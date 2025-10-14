import { DEBUG } from '../config/app.config';

export class Logger {
  private context: string;

  constructor(context: string = '') {
    this.context = context;
  }

  info(message: string, ...args: any[]): void {
    console.log(`[${this.context}] ${message}`, ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(`[${this.context}] ERROR: ${message}`, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`[${this.context}] WARN: ${message}`, ...args);
  }

  debug(message: string, ...args: any[]): void {
    if (DEBUG) {
      console.log(`[${this.context}] DEBUG: ${message}`, ...args);
    }
  }
}
