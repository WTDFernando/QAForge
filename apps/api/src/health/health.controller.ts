import {
  Controller,
  Get,
  Module,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import Redis from 'ioredis';
import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.module';
import { env } from '../config/env';

@ApiTags('health')
@Controller('health')
export class HealthController implements OnModuleDestroy {
  private readonly redis = new Redis(env().REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  constructor(private readonly prisma: PrismaService) {
    // Reported via /health; avoid unhandled-error log spam when Redis is down.
    this.redis.on('error', () => undefined);
  }

  @Public()
  @Get()
  async check() {
    const checks = await Promise.allSettled([
      this.prisma.client.$queryRaw`SELECT 1`,
      this.redis.status === 'ready'
        ? this.redis.ping()
        : this.redis.connect().then(() => this.redis.ping()),
    ]);
    const result = {
      status: checks.every((c) => c.status === 'fulfilled') ? 'ok' : 'degraded',
      db: checks[0]!.status === 'fulfilled' ? 'up' : 'down',
      redis: checks[1]!.status === 'fulfilled' ? 'up' : 'down',
    };
    if (result.db === 'down') throw new ServiceUnavailableException(result);
    return result;
  }

  async onModuleDestroy() {
    this.redis.disconnect();
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
