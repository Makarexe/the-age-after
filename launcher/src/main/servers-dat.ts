// Minimal NBT (uncompressed, as servers.dat is) so the launcher can add our server to the
// multiplayer list without touching the player's other entries.
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type Tag =
  | { type: 1 | 2 | 3 | 5 | 6; value: number }
  | { type: 4; value: bigint }
  | { type: 7; value: Int8Array }
  | { type: 8; value: string }
  | { type: 9; value: { elementType: number; items: Tag[] } }
  | { type: 10; value: Compound }
  | { type: 11; value: Int32Array }
  | { type: 12; value: BigInt64Array };

/** Entries in file order. */
export type Compound = [string, Tag][];

/** Java's DataInput.readUTF: "modified UTF-8" (CESU-8, NUL as C0 80). */
function decodeModifiedUtf8(buf: Buffer): string {
  let out = '';
  for (let i = 0; i < buf.length; ) {
    const a = buf[i++]!;
    if (a < 0x80) out += String.fromCharCode(a);
    else if ((a & 0xe0) === 0xc0) out += String.fromCharCode(((a & 0x1f) << 6) | (buf[i++]! & 0x3f));
    else out += String.fromCharCode(((a & 0x0f) << 12) | ((buf[i++]! & 0x3f) << 6) | (buf[i++]! & 0x3f));
  }
  return out;
}

function encodeModifiedUtf8(s: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 0 && c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Buffer.from(bytes);
}

class Reader {
  pos = 0;
  constructor(private readonly buf: Buffer) {}

  private take<T>(size: number, read: (offset: number) => T): T {
    const v = read(this.pos);
    this.pos += size;
    return v;
  }

  u8 = () => this.take(1, (o) => this.buf.readUInt8(o));
  i8 = () => this.take(1, (o) => this.buf.readInt8(o));
  i16 = () => this.take(2, (o) => this.buf.readInt16BE(o));
  u16 = () => this.take(2, (o) => this.buf.readUInt16BE(o));
  i32 = () => this.take(4, (o) => this.buf.readInt32BE(o));
  i64 = () => this.take(8, (o) => this.buf.readBigInt64BE(o));
  f32 = () => this.take(4, (o) => this.buf.readFloatBE(o));
  f64 = () => this.take(8, (o) => this.buf.readDoubleBE(o));

  str(): string {
    const n = this.u16();
    return this.take(n, (o) => decodeModifiedUtf8(this.buf.subarray(o, o + n)));
  }

  payload(type: number): Tag {
    switch (type) {
      case 1:
        return { type, value: this.i8() };
      case 2:
        return { type, value: this.i16() };
      case 3:
        return { type, value: this.i32() };
      case 4:
        return { type, value: this.i64() };
      case 5:
        return { type, value: this.f32() };
      case 6:
        return { type, value: this.f64() };
      case 7:
        return { type, value: Int8Array.from({ length: this.i32() }, () => this.i8()) };
      case 8:
        return { type, value: this.str() };
      case 9: {
        const elementType = this.u8();
        const n = this.i32();
        const items = Array.from({ length: Math.max(0, n) }, () => this.payload(elementType));
        return { type, value: { elementType, items } };
      }
      case 10: {
        const entries: Compound = [];
        for (let t = this.u8(); t !== 0; t = this.u8()) entries.push([this.str(), this.payload(t)]);
        return { type, value: entries };
      }
      case 11:
        return { type, value: Int32Array.from({ length: this.i32() }, () => this.i32()) };
      case 12:
        return { type, value: BigInt64Array.from({ length: this.i32() }, () => this.i64()) };
      default:
        throw new Error(`unknown NBT tag ${type}`);
    }
  }
}

export function readNbt(buf: Buffer): { name: string; root: Compound } {
  const r = new Reader(buf);
  if (r.u8() !== 10) throw new Error('NBT root is not a compound');
  const name = r.str();
  return { name, root: (r.payload(10) as { value: Compound }).value };
}

function writePayload(tag: Tag, out: Buffer[]): void {
  const num = (size: number, write: (b: Buffer) => void) => {
    const b = Buffer.alloc(size);
    write(b);
    out.push(b);
  };
  const str = (s: string) => {
    const b = encodeModifiedUtf8(s);
    num(2, (x) => x.writeUInt16BE(b.length));
    out.push(b);
  };
  switch (tag.type) {
    case 1:
      return num(1, (b) => b.writeInt8(tag.value));
    case 2:
      return num(2, (b) => b.writeInt16BE(tag.value));
    case 3:
      return num(4, (b) => b.writeInt32BE(tag.value));
    case 4:
      return num(8, (b) => b.writeBigInt64BE(tag.value));
    case 5:
      return num(4, (b) => b.writeFloatBE(tag.value));
    case 6:
      return num(8, (b) => b.writeDoubleBE(tag.value));
    case 7:
      num(4, (b) => b.writeInt32BE(tag.value.length));
      out.push(Buffer.from(tag.value.buffer, tag.value.byteOffset, tag.value.length));
      return;
    case 8:
      return str(tag.value);
    case 9:
      num(1, (b) => b.writeUInt8(tag.value.elementType));
      num(4, (b) => b.writeInt32BE(tag.value.items.length));
      for (const item of tag.value.items) writePayload(item, out);
      return;
    case 10:
      for (const [name, child] of tag.value) {
        num(1, (b) => b.writeUInt8(child.type));
        str(name);
        writePayload(child, out);
      }
      num(1, (b) => b.writeUInt8(0));
      return;
    case 11:
      num(4, (b) => b.writeInt32BE(tag.value.length));
      for (const v of tag.value) num(4, (b) => b.writeInt32BE(v));
      return;
    case 12:
      num(4, (b) => b.writeInt32BE(tag.value.length));
      for (const v of tag.value) num(8, (b) => b.writeBigInt64BE(v));
      return;
  }
}

export function writeNbt(root: Compound, name = ''): Buffer {
  const nameBytes = encodeModifiedUtf8(name);
  const header = Buffer.alloc(3);
  header.writeUInt8(10, 0);
  header.writeUInt16BE(nameBytes.length, 1);
  const out: Buffer[] = [header, nameBytes];
  writePayload({ type: 10, value: root }, out);
  return Buffer.concat(out);
}

const getString = (c: Compound, key: string) => {
  const t = c.find(([k]) => k === key)?.[1];
  return t?.type === 8 ? t.value : undefined;
};

/**
 * Puts our server at the top of the multiplayer list unless an entry with the same address is
 * already there. An entry with our name but another address (the server moved) gets the new
 * address instead of a duplicate. Returns true if the file was changed. A servers.dat we can't
 * parse is left alone.
 */
export async function ensureServerListed(gameDir: string, name: string, address: string): Promise<boolean> {
  const file = path.join(gameDir, 'servers.dat');
  let doc: { name: string; root: Compound } = { name: '', root: [] };
  try {
    doc = readNbt(await readFile(file));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return false;
  }
  let list = doc.root.find(([k]) => k === 'servers')?.[1];
  if (!list || list.type !== 9) {
    list = { type: 9, value: { elementType: 10, items: [] } };
    doc.root = [...doc.root.filter(([k]) => k !== 'servers'), ['servers', list]];
  }
  const wanted = address.trim().toLowerCase();
  const listed = list.value.items.some(
    (item) => item.type === 10 && getString(item.value, 'ip')?.trim().toLowerCase() === wanted,
  );
  if (listed) return false;
  list.value.elementType = 10;
  const ours = list.value.items.find((item) => item.type === 10 && getString(item.value, 'name') === name);
  if (ours?.type === 10) {
    ours.value = ours.value.filter(([k]) => k !== 'ip');
    ours.value.push(['ip', { type: 8, value: address.trim() }]);
  } else list.value.items.unshift({
    type: 10,
    value: [
      ['name', { type: 8, value: name }],
      ['ip', { type: 8, value: address.trim() }],
    ],
  });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, writeNbt(doc.root, doc.name));
  await rename(tmp, file);
  return true;
}
