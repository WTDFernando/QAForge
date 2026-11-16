import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Direct, time-limited download URL (S3). Drivers without it are served through signed API URLs. */
  presign?(
    key: string,
    opts: {
      fileName: string;
      contentType: string;
      disposition: 'inline' | 'attachment';
      ttlSeconds: number;
    },
  ): Promise<string>;
}

/** Development: files on local disk. Keys are generated server-side, never user input. */
export class LocalDiskDriver implements StorageDriver {
  constructor(private readonly root: string) {}
  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep))
      throw new Error('Invalid storage key');
    return full;
  }
  async put(key: string, body: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  async get(key: string) {
    const full = this.resolve(key);
    await stat(full);
    return createReadStream(full);
  }
  read(key: string) {
    return readFile(this.resolve(key));
  }
  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

/** Production: any S3-compatible service. */
export class S3Driver implements StorageDriver {
  private readonly client: S3Client;
  constructor(private readonly bucket: string) {
    const e = process.env;
    this.client = new S3Client({
      region: e.S3_REGION ?? 'us-east-1',
      endpoint: e.S3_ENDPOINT || undefined,
      forcePathStyle: !!e.S3_ENDPOINT,
      credentials:
        e.S3_ACCESS_KEY && e.S3_SECRET_KEY
          ? { accessKeyId: e.S3_ACCESS_KEY, secretAccessKey: e.S3_SECRET_KEY }
          : undefined,
    });
  }
  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body as Readable;
  }
  async read(key: string) {
    const stream = await this.get(key);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
    return Buffer.concat(chunks);
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  presign(
    key: string,
    o: {
      fileName: string;
      contentType: string;
      disposition: 'inline' | 'attachment';
      ttlSeconds: number;
    },
  ) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: o.contentType,
        ResponseContentDisposition: `${o.disposition}; filename*=UTF-8''${encodeURIComponent(o.fileName)}`,
      }),
      { expiresIn: o.ttlSeconds },
    );
  }
}

/** Driver from env: STORAGE_DRIVER=local|s3 (+ STORAGE_LOCAL_DIR / S3_*). */
export function createStorage(): StorageDriver {
  return process.env.STORAGE_DRIVER === 's3'
    ? new S3Driver(process.env.S3_BUCKET ?? 'qaforge')
    : new LocalDiskDriver(path.resolve(process.env.STORAGE_LOCAL_DIR ?? '../../.data/uploads'));
}
