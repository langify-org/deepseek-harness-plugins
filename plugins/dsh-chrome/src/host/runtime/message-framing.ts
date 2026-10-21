/**
 * Chrome's native messaging framing: a 32-bit little-endian byte length, then that many
 * bytes of UTF-8 JSON. The connector socket carries the same frames, because the relay
 * passes Chrome's bytes through unchanged.
 */
export const FRAME_HEADER_BYTES = 4;

export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.allocUnsafe(FRAME_HEADER_BYTES);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** The byte length of a frame's JSON body, to check it against a size limit before sending. */
export function frameBodyBytes(frame: Buffer): number {
  return frame.length - FRAME_HEADER_BYTES;
}

export class FrameTooLargeError extends Error {
  constructor(length: number, limit: number) {
    super(`a frame of ${length} bytes exceeds the ${limit}-byte limit`);
    this.name = 'FrameTooLargeError';
  }
}

/** Reassembles frames from a byte stream. */
export class FrameDecoder {
  readonly #maxBodyBytes: number;
  #buffered: Buffer = Buffer.alloc(0);

  constructor(maxBodyBytes: number) {
    this.#maxBodyBytes = maxBodyBytes;
  }

  /**
   * Appends received bytes and returns the messages they complete, in order.
   * @throws FrameTooLargeError when a frame announces more than the limit.
   * @throws SyntaxError when a frame body is not JSON.
   */
  push(chunk: Buffer): unknown[] {
    this.#buffered = this.#buffered.length === 0 ? chunk : Buffer.concat([this.#buffered, chunk]);
    const messages: unknown[] = [];
    while (this.#buffered.length >= FRAME_HEADER_BYTES) {
      const length = this.#buffered.readUInt32LE(0);
      if (length > this.#maxBodyBytes) throw new FrameTooLargeError(length, this.#maxBodyBytes);
      const end = FRAME_HEADER_BYTES + length;
      if (this.#buffered.length < end) break;
      messages.push(JSON.parse(this.#buffered.subarray(FRAME_HEADER_BYTES, end).toString('utf8')));
      this.#buffered = this.#buffered.subarray(end);
    }
    return messages;
  }
}
