import { Logger } from '@ugursahinkaya/shared-types';

export function createLogger(name: string, levels: string[]): Logger {
  const logLevels = new Set(levels || ['log', 'error', 'debug', 'warn']);

  function log(message: string, params?: unknown[]) {
    const date = new Date().toLocaleString('tr-tr', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    if (!params || params.length === 0) {
      console.log(`[${name}-${date}]: ${message}`);
    } else if (params.length === 1) {
      console.log(`[${name}-${date}]: ${message}`, params[0]);
    } else {
      console.log(`[${name}-${date}]: ${message}`, params);
    }
  }

  return {
    log: (message: string, ...params: unknown[]) => {
      if (logLevels.has('log')) {
        log(message, params);
      }
    },
    warn: (message: string, ...params: unknown[]) => {
      if (logLevels.has('warn')) {
        log(message, params);
      }
    },
    error: (message: string, ...params: unknown[]) => {
      if (logLevels.has('error')) {
        log(message, params);
      }
    },
    debug: (message: string, ...params: unknown[]) => {
      if (logLevels.has('debug')) {
        log(message, params);
      }
    }
  };
}
