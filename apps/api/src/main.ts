import { createApp } from './bootstrap';
import { env } from './config/env';

async function main() {
  const app = await createApp();
  await app.listen(env().API_PORT);
}

void main();
