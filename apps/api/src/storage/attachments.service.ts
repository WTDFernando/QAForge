import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Prisma } from '@qaforge/db';
import { MAX_UPLOAD_BYTES } from '@qaforge/shared';
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

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

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
    return tx.attachment.create({
      data: {
        id,
        projectId: ctx.projectId,
        storageKey,
        fileName: safeName,
        contentType,
        size: file.size,
        entityType: owner?.entityType,
        entityId: owner?.entityId,
        createdById: ctx.actor.id,
      },
    });
  }

  async open(projectId: string, id: string) {
    const a = await this.prisma.client.attachment.findFirst({ where: { id, projectId } });
    if (!a) throw new NotFoundException('File not found');
    return { attachment: a, stream: await this.storage.get(a.storageKey) };
  }
}
