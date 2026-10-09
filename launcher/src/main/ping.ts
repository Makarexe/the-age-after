import { resolveSrv } from 'node:dns/promises';
import net from 'node:net';
import type { ServerStatus } from '../shared/types';

function varint(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    bytes.push(b);
  } while (v !== 0);
  return Buffer.from(bytes);
}

function packet(id: number, payload: Buffer): Buffer {
  const body = Buffer.concat([varint(id), payload]);
  return Buffer.concat([varint(body.length), body]);
}

function mcString(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varint(b.length), b]);
}

/** Reads a VarInt at `offset`; null if the buffer ends first. */
export function readVarint(buf: Buffer, offset: number): { value: number; size: number } | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= buf.length) return null;
    const b = buf[offset + i]!;
    value |= (b & 0x7f) << (7 * i);
    if ((b & 0x80) === 0) return { value, size: i + 1 };
  }
  throw new Error('VarInt too long');
}

/** "host", "host:port" → host/port (25565 by default). */
export function parseAddress(address: string): { host: string; port: number; explicitPort: boolean } {
  const m = address.trim().match(/^\[?([^\]]+?)\]?(?::(\d+))?$/);
  if (!m) throw new Error('bad address');
  return { host: m[1]!, port: m[2] ? Number(m[2]) : 25565, explicitPort: !!m[2] };
}

export function motdText(description: unknown): string {
  if (typeof description === 'string') return description.replace(/§./g, '');
  if (!description || typeof description !== 'object') return '';
  const d = description as { text?: string; extra?: unknown[] };
  return ((d.text ?? '') + (d.extra ?? []).map(motdText).join('')).replace(/§./g, '');
}

/** Minecraft Server List Ping (1.7+ protocol). Never throws: offline → { online: false }. */
export async function pingServer(address: string, timeoutMs = 5000): Promise<ServerStatus> {
  if (!address) return { online: false };
  let { host, port, explicitPort } = parseAddress(address);
  if (!explicitPort && !net.isIP(host)) {
    try {
      const [srv] = await resolveSrv(`_minecraft._tcp.${host}`);
      if (srv) ({ name: host, port } = srv);
    } catch {
      // no SRV record
    }
  }
  return new Promise<ServerStatus>((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port });
    let buf = Buffer.alloc(0);
    const done = (status: ServerStatus) => {
      socket.destroy();
      resolve(status);
    };
    socket.setTimeout(timeoutMs, () => done({ online: false }));
    socket.on('error', () => done({ online: false }));
    socket.on('connect', () => {
      const handshake = Buffer.concat([varint(767), mcString(host), Buffer.from([port >> 8, port & 0xff]), varint(1)]);
      socket.write(packet(0x00, handshake));
      socket.write(packet(0x00, Buffer.alloc(0)));
    });
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len.size + len.value) return;
        const id = readVarint(buf, len.size)!;
        const strLen = readVarint(buf, len.size + id.size)!;
        const start = len.size + id.size + strLen.size;
        const json = JSON.parse(buf.toString('utf8', start, start + strLen.value));
        done({
          online: true,
          latencyMs: Date.now() - started,
          players: json.players ? { online: json.players.online ?? 0, max: json.players.max ?? 0 } : undefined,
          version: json.version?.name,
          motd: motdText(json.description),
        });
      } catch {
        done({ online: false });
      }
    });
  });
}
