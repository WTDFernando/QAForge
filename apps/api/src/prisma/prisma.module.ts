import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { getPrisma, PrismaClient } from '@qaforge/db';

/** Nest-injectable handle to the shared Prisma client. */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient = getPrisma();
  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
