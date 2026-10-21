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
  /** Received bytes not yet part of a returned message, as received. */
  #chunks: Buffer[] = [];
  #size = 0;
  /** The bytes the frame being received needs in all, once its header has arrived. */
  #frameEnd: number | undefined;

  constructor(maxBodyBytes: number) {
    this.#maxBodyBytes = maxBodyBytes;
  }

  /**
   * Appends received bytes and returns the messages they complete, in order.
   * @throws FrameTooLargeError when a frame announces more than the limit.
   * @throws SyntaxError when a frame body is not JSON.
   */
  push(chunk: Buffer): unknown[] {
    this.#chunks.push(chunk);
    this.#size += chunk.length;
    const messages: unknown[] = [];
    // A large frame arrives in many chunks; they are joined once it is complete, not on
    // every chunk.
    while (this.#size >= (this.#frameEnd ?? FRAME_HEADER_BYTES)) {
      const buffered =
        this.#chunks.length === 1 ? (this.#chunks[0] as Buffer) : Buffer.concat(this.#chunks);
      this.#chunks = [buffered];
      const length = buffered.readUInt32LE(0);
      if (length > this.#maxBodyBytes) throw new FrameTooLargeError(length, this.#maxBodyBytes);
      const end = FRAME_HEADER_BYTES + length;
      if (buffered.length < end) {
        this.#frameEnd = end;
        break;
      }
      this.#frameEnd = undefined;
      const rest = buffered.subarray(end);
      this.#chunks = rest.length === 0 ? [] : [rest];
      this.#size = rest.length;
      messages.push(JSON.parse(buffered.subarray(FRAME_HEADER_BYTES, end).toString('utf8')));
    }
    return messages;
  }
}
