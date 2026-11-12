import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { env } from './config/env';
import { HealthModule } from './health/health.controller';
import { MeModule } from './me/me.controller';
import { OrganizationsModule } from './organizations/organizations.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env().NODE_ENV === 'test' ? 'silent' : env().LOG_LEVEL,
        transport:
          env().NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        redact: ['req.headers.cookie', 'req.headers.authorization'],
        autoLogging: { ignore: (req) => req.url === '/health' },
      },
    }),
    PrismaModule,
    AuthModule,
    AuditModule,
    HealthModule,
    MeModule,
    OrganizationsModule,
    ProjectsModule,
  ],
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
})
export class AppModule {}
