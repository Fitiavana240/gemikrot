import { ILogger } from '../../src/logging/logger.interface';

/** Logger qui n'écrit rien, pour garder la sortie des tests lisible. */
export function createSilentLogger(): ILogger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}
