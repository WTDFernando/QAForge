import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { toNodeHandler } from 'better-auth/node';
import express from 'express';
import helmet from 'helmet';
import IORedis from 'ioredis';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { AUTH, type Auth } from './auth/auth';
import { defaultRules, rateLimit } from './common/rate-limit';
import { env } from './config/env';

export async function createApp(opts: { logger?: boolean } = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bodyParser: false, bufferLogs: true });
  if (opts.logger !== false) app.useLogger(app.get(Logger));

  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors({ origin: [env().WEB_URL], credentials: true });
  // The web app (Next) proxies /v1 and /api/auth: trust one hop so req.ip is the browser's address.
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

  const e = env();
  if (e.RATE_LIMIT_ENABLED ?? e.NODE_ENV !== 'test') {
    const redis = new IORedis(e.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    redis.on('error', () => undefined);
    app.use(
      rateLimit(
        redis,
        defaultRules({
          api: e.RATE_LIMIT_API_PER_MIN,
          auth: e.RATE_LIMIT_AUTH_PER_MIN,
          ai: e.RATE_LIMIT_AI_PER_MIN,
        }),
      ),
    );
    app.getHttpServer().on('close', () => redis.disconnect());
  }

  // Better Auth must receive the raw body, so it is mounted before the JSON parser.
  const auth = app.get<Auth>(AUTH);
  app.use('/api/auth', toNodeHandler(auth));
  app.use(express.json({ limit: '5mb' }));
  app.enableShutdownHooks();

  SwaggerModule.setup('docs', app, () => buildOpenApi(app), { jsonDocumentUrl: 'openapi.json' });
  return app;
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('QAForge API')
    .setDescription(
      'Public REST API for QAForge. Authenticate with a session cookie or an API token.',
    )
    .setVersion('0.1.0')
    .addCookieAuth('better-auth.session_token')
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}
