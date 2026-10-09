import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { motdText, parseAddress, pingServer, readVarint } from '../src/main/ping';

function varint(v: number): Buffer {
  const out: number[] = [];
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

let server: net.Server;
let port: number;
let handshakes: Buffer[] = [];

beforeAll(async () => {
  server = net.createServer((socket) => {
    socket.once('data', (data) => {
      handshakes.push(data);
      const json = Buffer.from(
        JSON.stringify({
          version: { name: 'NeoForge 1.21.1', protocol: 767 },
          players: { online: 3, max: 20 },
          description: { text: '§6Эпоха', extra: [{ text: ' после' }] },
        }),
      );
      const body = Buffer.concat([varint(0), varint(json.length), json]);
      const packet = Buffer.concat([varint(body.length), body]);
      // split in two chunks to exercise buffering
      socket.write(packet.subarray(0, 5));
      setTimeout(() => socket.write(packet.subarray(5)), 20);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as net.AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('pingServer', () => {
  it('reads players, version and motd', async () => {
    const status = await pingServer(`127.0.0.1:${port}`);
    expect(status).toMatchObject({ online: true, players: { online: 3, max: 20 }, version: 'NeoForge 1.21.1', motd: 'Эпоха после' });
    expect(handshakes[0]![1]).toBe(0x00); // handshake packet id
  });

  it('reports offline for a closed port', async () => {
    const closed = net.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const freePort = (closed.address() as net.AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    expect(await pingServer(`127.0.0.1:${freePort}`, 1000)).toEqual({ online: false });
    expect(await pingServer('')).toEqual({ online: false });
  });

  it('helpers', () => {
    expect(parseAddress('play.example.ru')).toEqual({ host: 'play.example.ru', port: 25565, explicitPort: false });
    expect(parseAddress('play.example.ru:25570')).toEqual({ host: 'play.example.ru', port: 25570, explicitPort: true });
    expect(readVarint(Buffer.from([0xdd, 0xc7, 0x01]), 0)).toEqual({ value: 25565, size: 3 });
    expect(readVarint(Buffer.from([0xdd]), 0)).toBeNull();
    expect(motdText('§aHello')).toBe('Hello');
  });
});
