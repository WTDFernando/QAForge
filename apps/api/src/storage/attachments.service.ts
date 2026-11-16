import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { signFileToken, type Attachment, type Disposition, type Prisma } from '@qaforge/db';
import { MAX_UPLOAD_BYTES, QUEUES, type ScanJob } from '@qaforge/shared';
import { env } from '../config/env';
import type { ProjectCtx } from '../common/project-scope';
import { PrismaService } from '../prisma/prisma.module';
import { StorageService } from './storage.service';

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Some browsers/OSes send generic types for these. */
const EXT_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function detectContentType(file: { originalname: string; mimetype: string }): string {
  const byExt = EXT_TYPES[path.extname(file.originalname).toLowerCase()];
  return !file.mimetype || file.mimetype === 'application/octet-stream'
    ? (byExt ?? file.mimetype)
    : file.mimetype;
}

/** Types a browser may render inline; everything else is forced to download. */
export const INLINE_TYPES = /^(image\/(png|jpeg|webp)|application\/pdf|text\/plain)$/;

/** Blocked scan states: files are unusable until clean (or SKIPPED when no scanner is configured). */
export function assertUsable(a: Pick<Attachment, 'scanStatus'>) {
  if (a.scanStatus === 'INFECTED')
    throw new ConflictException('This file failed the malware scan and is blocked');
  if (a.scanStatus === 'PENDING')
    throw new ConflictException('This file is still being scanned. Try again in a moment.');
  if (a.scanStatus === 'FAILED')
    throw new ConflictException('This file could not be scanned and is blocked');
}

@Injectable()
export class AttachmentsService implements OnModuleDestroy {
  private connection?: IORedis;
  private queue?: Queue<ScanJob>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private scanQueue() {
    if (!this.queue) {
      this.connection = new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null });
      this.connection.on('error', () => undefined);
      this.queue = new Queue<ScanJob>(QUEUES.scan, { connection: this.connection });
    }
    return this.queue;
  }

  async onModuleDestroy() {
    await this.queue?.close().catch(() => undefined);
    this.connection?.disconnect();
  }

  /** Store a file and create its Attachment row inside the caller's transaction. */
  async store(
    tx: Prisma.TransactionClient,
    ctx: ProjectCtx,
    file: UploadedFileLike,
    allowed: Record<string, string> | null,
    owner?: { entityType: string; entityId: string },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (file.size > MAX_UPLOAD_BYTES)
      throw new PayloadTooLargeException('File is larger than 25 MB');
    const contentType = detectContentType(file);
    if (allowed && !allowed[contentType]) {
      throw new BadRequestException(
        `Unsupported file type (${contentType}). Allowed: ${Object.values(allowed).join(', ')}`,
      );
    }
    const id = randomUUID();
    const safeName =
      path
        .basename(file.originalname)
        .replace(/[^\w.\- ()]/g, '_')
        .slice(-120) || 'file';
    const storageKey = `${ctx.organizationId}/${ctx.projectId}/${id}/${safeName}`;
    await this.storage.put(storageKey, file.buffer, contentType);
    const scanning = !!env().CLAMAV_HOST;
    const row = await tx.attachment.create({
      data: {
        id,
        projectId: ctx.projectId,
        storageKey,
        fileName: safeName,
        contentType,
        size: file.size,
        entityType: owner?.entityType,
        entityId: owner?.entityId,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        // Without a scanner the file is usable but shown as "not scanned".
        scanStatus: scanning ? 'PENDING' : 'SKIPPED',
        createdById: ctx.actor.id,
      },
    });
    if (scanning) {
      // Enqueued before the transaction commits: the worker retries until the row exists.
      await this.scanQueue().add(
        'scan',
        { attachmentId: id },
        {
          jobId: `scan-${id}`,
          delay: 500,
          attempts: 8,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
    }
    return row;
  }

  /**
   * An attachment the caller may read: in the project, not someone else's unattached upload,
   * and not blocked by the malware scan.
   */
  async readable(ctx: ProjectCtx, id: string): Promise<Attachment> {
    const a = await this.prisma.client.attachment.findFirst({
      where: { id, projectId: ctx.projectId },
    });
    if (!a || (a.entityType === null && a.createdById !== ctx.actor.id))
      throw new NotFoundException('File not found');
    assertUsable(a);
    return a;
  }

  /** Short-lived URL: S3 presigned when available, else an HMAC-signed API URL. */
  async signedUrl(a: Attachment, disposition?: Disposition) {
    const ttl = env().FILE_URL_TTL_SECONDS;
    const disp: Disposition =
      disposition ?? (INLINE_TYPES.test(a.contentType) ? 'inline' : 'attachment');
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const url = this.storage.presign
      ? await this.storage.presign(a.storageKey, {
          fileName: a.fileName,
          contentType: a.contentType,
          disposition: disp,
          ttlSeconds: ttl,
        })
      : `/v1/files/${a.id}?exp=${exp}&disp=${disp}&sig=${signFileToken(a.id, exp, disp)}`;
    return { url, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** Stream a file whose signed token was already verified. */
  async openVerified(id: string) {
    const a = await this.prisma.client.attachment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('File not found');
    assertUsable(a);
    return { attachment: a, stream: await this.storage.get(a.storageKey) };
  }
}
