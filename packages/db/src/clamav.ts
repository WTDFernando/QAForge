import { Socket } from 'node:net';

/** ClamAV (clamd) over TCP. Optional: enabled when CLAMAV_HOST is set (compose profile "scan"). */
export function scanningEnabled(): boolean {
  return !!process.env.CLAMAV_HOST;
}

export type ScanResult = { status: 'CLEAN' } | { status: 'INFECTED'; signature: string };

/**
 * clamd INSTREAM: "zINSTREAM\0", then chunks of <uint32 big-endian length><bytes>, then a zero
 * length. The reply is "stream: OK" or "stream: <signature> FOUND".
 */
export function scanBuffer(
  data: Buffer,
  opts: { host?: string; port?: number; timeoutMs?: number } = {},
): Promise<ScanResult> {
  const host = opts.host ?? process.env.CLAMAV_HOST ?? 'localhost';
  const port = opts.port ?? Number(process.env.CLAMAV_PORT ?? 3310);
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let reply = '';
    socket.setTimeout(opts.timeoutMs ?? 60_000, () =>
      socket.destroy(new Error('ClamAV scan timed out')),
    );
    socket.on('error', reject);
    socket.on('data', (d) => (reply += d.toString('utf8')));
    socket.on('close', () => {
      const line = reply.replace(/\0/g, '').trim();
      if (/:\s*OK$/.test(line)) return resolve({ status: 'CLEAN' });
      const found = /:\s*(.+) FOUND$/.exec(line);
      if (found) return resolve({ status: 'INFECTED', signature: found[1]! });
      reject(new Error(`Unexpected ClamAV reply: ${line || '(empty)'}`));
    });
    socket.connect(port, host, () => {
      socket.write('zINSTREAM\0');
      const CHUNK = 64 * 1024;
      for (let i = 0; i < data.length; i += CHUNK) {
        const part = data.subarray(i, i + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        socket.write(len);
        socket.write(part);
      }
      socket.end(Buffer.alloc(4));
    });
  });
}
