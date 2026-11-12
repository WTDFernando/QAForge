import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { env } from '../config/env';
import { Public } from './decorators';

@ApiTags('auth')
@Controller('v1/auth')
export class AuthProvidersController {
  /** Which SSO buttons the login page should show. */
  @Public()
  @Get('providers')
  providers() {
    const e = env();
    const social: string[] = [];
    if (e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET) social.push('google');
    if (e.MICROSOFT_CLIENT_ID && e.MICROSOFT_CLIENT_SECRET) social.push('microsoft');
    return { emailPassword: true, social };
  }
}
