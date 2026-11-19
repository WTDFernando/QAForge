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
import { DashboardModule } from './dashboard/dashboard.module';
import { AiModule } from './ai/ai.module';
import { AutomationModule } from './automation/automation.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TestRunsModule } from './test-runs/test-runs.module';
import { BugsModule } from './bugs/bugs.module';
import { CommentsModule } from './comments/comments.module';
import { EnvironmentsModule } from './environments/environments.controller';
import { RequirementsModule } from './requirements/requirements.controller';
import { StorageModule } from './storage/storage.module';
import { SuitesModule } from './suites/suites.module';
import { TestCasesModule } from './test-cases/test-cases.module';
import { ViewsModule } from './views/views.module';

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
    StorageModule,
    EnvironmentsModule,
    RequirementsModule,
    SuitesModule,
    TestCasesModule,
    ViewsModule,
    DashboardModule,
    AiModule,
    AutomationModule,
    NotificationsModule,
    TestRunsModule,
    BugsModule,
    CommentsModule,
  ],
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
})
export class AppModule {}
