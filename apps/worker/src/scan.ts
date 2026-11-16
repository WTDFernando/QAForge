import type { Job } from 'bullmq';
import { createStorage, getPrisma, scanBuffer, type ScanResult } from '@qaforge/db';
import type { ScanJob } from '@qaforge/shared';
import { logger } from './logger';

/**
 * Malware scan of one upload (ClamAV). Files stay unusable (PENDING) until CLEAN.
 * Infected files are deleted from storage; the row stays (INFECTED) so the UI can explain why.
 */
export function createScanProcessor(scan: (data: Buffer) => Promise<ScanResult> = scanBuffer) {
  return async function processScan(job: Job<ScanJob>) {
    const prisma = getPrisma();
    const a = await prisma.attachment.findUnique({ where: { id: job.data.attachmentId } });
    // The API enqueues inside its transaction; retry (with backoff) until the row is committed.
    if (!a) throw new Error('Attachment not committed yet');
    if (a.scanStatus !== 'PENDING') return { skipped: a.scanStatus };
    const storage = createStorage();
    let result: ScanResult;
    try {
      result = await scan(await storage.read(a.storageKey));
    } catch (e) {
      const last = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (last) {
        await prisma.attachment.update({
          where: { id: a.id },
          data: { scanStatus: 'FAILED', scannedAt: new Date() },
        });
      }
      throw e;
    }
    await prisma.$transaction(async (tx) => {
      await tx.attachment.update({
        where: { id: a.id },
        data: { scanStatus: result.status, scannedAt: new Date() },
      });
      if (result.status === 'INFECTED') {
        const project = await tx.project.findUniqueOrThrow({
          where: { id: a.projectId },
          select: { organizationId: true },
        });
        await tx.auditLog.create({
          data: {
            organizationId: project.organizationId,
            projectId: a.projectId,
            actorType: 'SYSTEM',
            entityType: 'attachment',
            entityId: a.id,
            action: 'quarantine',
            metadata: {
              signature: result.signature,
              fileName: a.fileName,
              uploadedBy: a.createdById,
            },
          },
        });
      }
    });
    if (result.status === 'INFECTED') {
      await storage.delete(a.storageKey).catch(() => undefined);
      logger.warn(
        { attachmentId: a.id, signature: result.signature },
        'infected upload quarantined',
      );
    }
    return { status: result.status };
  };
}
