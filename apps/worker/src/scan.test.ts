import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import type { Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStorage, getPrisma, scanBuffer, signFileToken, verifyFileToken } from '@qaforge/db';
import type { ScanJob } from '@qaforge/shared';
import { readScanned, ScanPendingError, JobError } from './ai/context';
import { createScanProcessor } from './scan';

const prisma = getPrisma();
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** Minimal clamd INSTREAM server: reassembles chunks and flags the EICAR test string. */
function fakeClamd(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const cmd = 'zINSTREAM\0';
        if (buf.length < cmd.length) return;
        let off = cmd.length;
        const parts: Buffer[] = [];
        while (off + 4 <= buf.length) {
          const len = buf.readUInt32BE(off);
          if (len === 0) {
            const body = Buffer.concat(parts).toString('latin1');
            sock.end(
              body.includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0',
            );
            return;
          }
          if (off + 4 + len > buf.length) return;
          parts.push(buf.subarray(off + 4, off + 4 + len));
          off += 4 + len;
        }
      });
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as { port: number }).port }),
    );
  });
}

let clamd: { server: Server; port: number };
let projectId: string;
let orgId: string;
let userId: string;

async function upload(content: Buffer, name = 'f.png') {
  const key = `${orgId}/${projectId}/${randomUUID()}/${name}`;
  await createStorage().put(key, content, 'image/png');
  return prisma.attachment.create({
    data: {
      projectId,
      storageKey: key,
      fileName: name,
      contentType: 'image/png',
      size: content.length,
      createdById: userId,
    },
  });
}
const job = (attachmentId: string, attemptsMade = 0) =>
  ({ data: { attachmentId }, attemptsMade, opts: { attempts: 3 } }) as unknown as Job<ScanJob>;

beforeAll(async () => {
  clamd = await fakeClamd();
  userId = (await prisma.user.create({ data: { name: 'S', email: `s${Date.now()}@t.dev` } })).id;
  orgId = (await prisma.organization.create({ data: { name: 'S', slug: `s-${Date.now()}` } })).id;
  projectId = (
    await prisma.project.create({
      data: { organizationId: orgId, name: 'S', key: 'SCAN', createdById: userId },
    })
  ).id;
});
afterAll(async () => {
  clamd.server.close();
  await prisma.$disconnect();
});

describe('ClamAV client', () => {
  it('reports clean and infected streams, across chunk boundaries', async () => {
    const opts = { host: '127.0.0.1', port: clamd.port };
    expect(await scanBuffer(Buffer.alloc(200_000, 1), opts)).toEqual({ status: 'CLEAN' });
    expect(await scanBuffer(Buffer.from(EICAR), opts)).toEqual({
      status: 'INFECTED',
      signature: 'Eicar-Test-Signature',
    });
  });

  it('fails when clamd is unreachable', async () => {
    await expect(scanBuffer(Buffer.from('x'), { host: '127.0.0.1', port: 1 })).rejects.toThrow();
  });
});

describe('scan processor', () => {
  const process_ = createScanProcessor((d) =>
    scanBuffer(d, { host: '127.0.0.1', port: clamd.port }),
  );

  it('marks clean files usable', async () => {
    const a = await upload(Buffer.from('fine'));
    await expect(readScanned(a)).rejects.toBeInstanceOf(ScanPendingError);
    expect(await process_(job(a.id))).toEqual({ status: 'CLEAN' });
    const after = await prisma.attachment.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.scanStatus).toBe('CLEAN');
    expect(after.scannedAt).not.toBeNull();
    expect((await readScanned(after)).toString()).toBe('fine');
    // Re-delivery is a no-op.
    expect(await process_(job(a.id))).toEqual({ skipped: 'CLEAN' });
  });

  it('quarantines infected files: deleted from storage, blocked and audited', async () => {
    const a = await upload(Buffer.from(EICAR), 'eicar.png');
    expect(await process_(job(a.id))).toEqual({ status: 'INFECTED' });
    const after = await prisma.attachment.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.scanStatus).toBe('INFECTED');
    await expect(createStorage().read(a.storageKey)).rejects.toThrow();
    await expect(readScanned(after)).rejects.toBeInstanceOf(JobError);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: a.id, action: 'quarantine' },
    });
    expect(audit).toMatchObject({ actorType: 'SYSTEM' });
    expect(audit.metadata).toMatchObject({ signature: 'Eicar-Test-Signature' });
  });

  it('retries until the row is committed and marks FAILED after the last attempt', async () => {
    await expect(process_(job(randomUUID()))).rejects.toThrow('not committed');
    const a = await upload(Buffer.from('x'));
    const broken = createScanProcessor(() => Promise.reject(new Error('clamd down')));
    await expect(broken(job(a.id, 0))).rejects.toThrow('clamd down');
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: a.id } })).scanStatus).toBe(
      'PENDING',
    );
    await expect(broken(job(a.id, 2))).rejects.toThrow('clamd down');
    const failed = await prisma.attachment.findUniqueOrThrow({ where: { id: a.id } });
    expect(failed.scanStatus).toBe('FAILED');
    await expect(readScanned(failed)).rejects.toBeInstanceOf(JobError);
  });
});

describe('signed file URLs', () => {
  it('verify only the exact id, expiry and disposition, until expiry', () => {
    const id = randomUUID();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = signFileToken(id, exp, 'inline');
    expect(verifyFileToken(id, exp, 'inline', sig)).toBe(true);
    expect(verifyFileToken(randomUUID(), exp, 'inline', sig)).toBe(false);
    expect(verifyFileToken(id, exp + 1, 'inline', sig)).toBe(false);
    expect(verifyFileToken(id, exp, 'attachment', sig)).toBe(false);
    expect(verifyFileToken(id, exp, 'inline', `${sig}x`)).toBe(false);
    expect(verifyFileToken(id, exp, 'inline', sig, (exp + 1) * 1000)).toBe(false);
    expect(verifyFileToken(id, Number.NaN, 'inline', sig)).toBe(false);
  });
});
