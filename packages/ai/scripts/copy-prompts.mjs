// Prompts are versioned files, shipped next to the compiled code.
import { cpSync } from 'node:fs';
cpSync('prompts', 'dist/prompts', { recursive: true });
