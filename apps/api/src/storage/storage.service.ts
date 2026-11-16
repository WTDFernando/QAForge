import { Injectable } from '@nestjs/common';
import { createStorage, type StorageDriver } from '@qaforge/db';
import { env } from '../config/env';

/** Nest wrapper around the shared storage driver (local disk in dev, S3 in prod). */
@Injectable()
export class StorageService implements StorageDriver {
  private readonly driver: StorageDriver = (env(), createStorage());
  put(key: string, body: Buffer, contentType: string) {
    return this.driver.put(key, body, contentType);
  }
  get(key: string) {
    return this.driver.get(key);
  }
  read(key: string) {
    return this.driver.read(key);
  }
  delete(key: string) {
    return this.driver.delete(key);
  }
  /** S3 presigned URLs; undefined for local disk (served through signed API URLs). */
  get presign(): StorageDriver['presign'] {
    return this.driver.presign?.bind(this.driver);
  }
}
