/**
 * Bounded ring buffer for raw PTY output.
 *
 * Stores string chunks up to a byte-size budget. When appending would
 * exceed capacity, the oldest chunks are dropped. Used to replay raw
 * PTY output on reconnect instead of going through xterm's SerializeAddon
 * (which re-encodes sequences and loses fidelity when rendered by ghostty).
 */

export class RingBuffer {
  private chunks: string[] = [];
  private totalBytes = 0;

  constructor(private readonly capacity: number) {}

  /** Append a chunk, dropping oldest chunks if over capacity. */
  append(chunk: string): void {
    const size = Buffer.byteLength(chunk);
    this.chunks.push(chunk);
    this.totalBytes += size;
    while (this.totalBytes > this.capacity && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!;
      this.totalBytes -= Buffer.byteLength(dropped);
    }
  }

  /** Return all buffered chunks concatenated. */
  drain(): string {
    return this.chunks.join("");
  }
}
