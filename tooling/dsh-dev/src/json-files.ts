import { readFile } from 'node:fs/promises';
import { DshDevError } from './errors.ts';

/**
 * The JSON value a file holds, or `undefined` when there is no such file.
 * @throws DshDevError when the file cannot be read, or is not JSON.
 */
export async function readJsonFile(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw new DshDevError(`cannot read ${path}: ${messageOf(error)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new DshDevError(`${path} is not JSON: ${messageOf(error)}`);
  }
}

/** A field of a JSON object, or `undefined` when the value is no object or lacks it. */
export function jsonField(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && name in value
    ? (value as Readonly<Record<string, unknown>>)[name]
    : undefined;
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
