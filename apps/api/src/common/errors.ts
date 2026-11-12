import { ConflictException } from '@nestjs/common';
import { Prisma } from '@qaforge/db';

/** Map unique-constraint violations to a friendly 409. */
export function rethrowUnique(e: unknown, message: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw new ConflictException(message);
  }
  throw e;
}
