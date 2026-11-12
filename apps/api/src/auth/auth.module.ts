import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AUTH, createAuth } from './auth';
import { AuthGuard } from './auth.guard';
import { PermissionGuard } from './permission.guard';
import { AuthProvidersController } from './providers.controller';

@Global()
@Module({
  controllers: [AuthProvidersController],
  providers: [
    { provide: AUTH, useFactory: createAuth },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AUTH],
})
export class AuthModule {}
