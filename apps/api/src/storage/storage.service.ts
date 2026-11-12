import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from '../config/env';

export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
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
  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

/** Production: any S3-compatible service. */
export class S3Driver implements StorageDriver {
  private readonly client: S3Client;
  constructor(private readonly bucket: string) {
    const e = env();
    this.client = new S3Client({
      region: e.S3_REGION,
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
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

@Injectable()
export class StorageService implements StorageDriver {
  private readonly driver: StorageDriver =
    env().STORAGE_DRIVER === 's3'
      ? new S3Driver(env().S3_BUCKET)
      : new LocalDiskDriver(path.resolve(env().STORAGE_LOCAL_DIR));
  put(key: string, body: Buffer, contentType: string) {
    return this.driver.put(key, body, contentType);
  }
  get(key: string) {
    return this.driver.get(key);
  }
  delete(key: string) {
    return this.driver.delete(key);
  }
}
