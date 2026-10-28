/**
 * The port the development DSH serves on unless told otherwise: not `dsh web`'s own default,
 * 3080, where the DSH one uses every day may run, and with which a browser would share its
 * stored data for that origin.
 */
export const DEV_PORT = 3390;

/** The options `dsh web` gets: those given, and the development port when they name none. */
export function webOptions(given: readonly string[]): string[] {
  const namesPort = given.some((option) => option === '--port' || option.startsWith('--port='));
  return namesPort ? [...given] : [...given, '--port', String(DEV_PORT)];
}
