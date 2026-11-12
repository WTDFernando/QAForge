/** Writes openapi.json for client generation / docs publishing. */
import { writeFileSync } from 'node:fs';
import { buildOpenApi, createApp } from './bootstrap';

async function main() {
  const app = await createApp({ logger: false });
  await app.init();
  writeFileSync('openapi.json', JSON.stringify(buildOpenApi(app), null, 2));
  await app.close();
  console.log('Wrote openapi.json');
}
void main();
