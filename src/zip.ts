/**
 * Reads entries out of a zip file in the browser, for previews: Word, Excel and PowerPoint
 * files, Pages, Numbers and Keynote files, and OpenDocument files are all zips inside.
 * Handles stored and deflated entries (not zip64 or encrypted ones).
 */

export interface ZipEntry { name: string; method: number; size: number; packed: number; offset: number }

export interface Zip {
  entries: ZipEntry[];
  /** An entry's bytes, or null when it's missing, too large, or packed in a way not handled. */
  read(name: string, limit?: number): Promise<Uint8Array | null>;
  text(name: string, limit?: number): Promise<string | null>;
}

const END_SIGNATURE = 0x06054b50;
const ENTRY_SIGNATURE = 0x02014b50;

export async function openZip(blob: Blob): Promise<Zip | null> {
  // The directory's end record sits in the last 22 bytes, plus a comment of up to 64 KB.
  const tailStart = Math.max(0, blob.size - 22 - 65535);
  const tail = new DataView(await blob.slice(tailStart).arrayBuffer());
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === END_SIGNATURE) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = tail.getUint16(end + 10, true);
  const dirSize = tail.getUint32(end + 12, true);
  const dirOffset = tail.getUint32(end + 16, true);
  if (dirOffset + dirSize > blob.size) return null;
  const dir = new DataView(await blob.slice(dirOffset, dirOffset + dirSize).arrayBuffer());
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let p = 0, i = 0; i < count && p + 46 <= dir.byteLength; i++) {
    if (dir.getUint32(p, true) !== ENTRY_SIGNATURE) break;
    const nameLength = dir.getUint16(p + 28, true);
    const extra = dir.getUint16(p + 30, true);
    const comment = dir.getUint16(p + 32, true);
    entries.push({
      method: dir.getUint16(p + 10, true),
      packed: dir.getUint32(p + 20, true),
      size: dir.getUint32(p + 24, true),
      offset: dir.getUint32(p + 42, true),
      name: decoder.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLength)),
    });
    p += 46 + nameLength + extra + comment;
  }

  const read = async (name: string, limit = 8 * 1024 * 1024) => {
    const entry = entries.find((e) => e.name === name);
    if (!entry || entry.size > limit || (entry.method !== 0 && entry.method !== 8)) return null;
    const header = new DataView(await blob.slice(entry.offset, entry.offset + 30).arrayBuffer());
    const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    const packed = blob.slice(start, start + entry.packed);
    if (entry.method === 0) return new Uint8Array(await packed.arrayBuffer());
    // Unpacked a piece at a time, stopping at the limit: the sizes a zip claims can be lies.
    const reader = packed.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const out = new Uint8Array(entry.size);
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.length > out.length) {
        reader.cancel().catch(() => {});
        return null;
      }
      out.set(value, length);
      length += value.length;
    }
    return out.subarray(0, length);
  };
  return {
    entries,
    read: (name, limit) => read(name, limit).catch(() => null),
    text: async (name, limit) => {
      const bytes = await read(name, limit).catch(() => null);
      return bytes && new TextDecoder().decode(bytes);
    },
  };
}
