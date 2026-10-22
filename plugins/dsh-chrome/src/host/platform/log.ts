/**
 * The logging the runtime needs. The plugin passes DSH's logger; tests pass a recorder.
 */
export interface Log {
  info(message: string): void;
  warn(message: string): void;
}

export const silentLog: Log = { info: () => {}, warn: () => {} };
