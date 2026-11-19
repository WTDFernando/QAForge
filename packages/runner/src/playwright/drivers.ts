import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

export interface ExecOptions {
  /** Workspace directory (contains playwright.config.ts) */
  dir: string;
  /** Environment for the tests: BASE_URL, environment variables and secrets. Never written to disk. */
  env: Record<string, string>;
  /** Hard limit for the whole run */
  timeoutMs: number;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
}

export interface ExecResult {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

export interface SandboxDriver {
  readonly name: 'docker' | 'process';
  run(opts: ExecOptions): Promise<ExecResult>;
}

const MAX_OUTPUT = 400_000;

function runProcess(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  opts: ExecOptions,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    const onData = (b: Buffer) => {
      const s = b.toString();
      if (output.length < MAX_OUTPUT) output += s;
      opts.onOutput?.(s);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const kill = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);
    opts.signal?.addEventListener('abort', kill, { once: true });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, timedOut, output });
    });
  });
}

/**
 * Development and CI only: runs Playwright as a child process on this machine. Tests can reach
 * whatever this machine can, so it refuses to run in production unless explicitly allowed.
 */
export class ProcessDriver implements SandboxDriver {
  readonly name = 'process' as const;
  constructor(private readonly allowInProduction = false) {}
  run(opts: ExecOptions) {
    if (process.env.NODE_ENV === 'production' && !this.allowInProduction)
      return Promise.reject(
        new Error('The process sandbox is disabled in production. Set RUNNER_SANDBOX=docker.'),
      );
    const cli = path.join(
      path.dirname(createRequire(__filename).resolve('@playwright/test/package.json')),
      'cli.js',
    );
    // A minimal environment: nothing from the worker leaks into tests (no DATABASE_URL, no keys).
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: opts.dir,
      CI: '1',
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
      ...opts.env,
    };
    return runProcess(process.execPath, [cli, 'test'], opts.dir, env, opts);
  }
}

/** Production: each run in a throwaway container with CPU/memory/process limits and no host secrets. */
export class DockerDriver implements SandboxDriver {
  readonly name = 'docker' as const;
  constructor(
    private readonly cfg: {
      image: string;
      network?: string;
      memory?: string;
      cpus?: string;
      dockerBin?: string;
    } = {
      image: 'qaforge-runner:latest',
    },
  ) {}

  args(opts: ExecOptions): string[] {
    const envArgs = Object.keys(opts.env).flatMap((k) => ['--env', k]);
    return [
      'run',
      '--rm',
      '--init',
      `--network=${this.cfg.network ?? 'bridge'}`,
      `--memory=${this.cfg.memory ?? '2g'}`,
      `--cpus=${this.cfg.cpus ?? '2'}`,
      '--pids-limit=512',
      '--security-opt=no-new-privileges',
      '--cap-drop=ALL',
      '--read-only',
      '--tmpfs=/tmp:rw,size=512m',
      '--shm-size=1g',
      '--user=pwuser',
      `--volume=${opts.dir}:/work`,
      '--workdir=/work',
      // Values come from the environment of the docker CLI process, so they never appear in `ps`.
      ...envArgs,
      this.cfg.image,
      'npx',
      'playwright',
      'test',
    ];
  }

  run(opts: ExecOptions) {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DOCKER_HOST: process.env.DOCKER_HOST,
      ...opts.env,
    };
    return runProcess(this.cfg.dockerBin ?? 'docker', this.args(opts), opts.dir, env, opts);
  }
}

export function createDriver(): SandboxDriver {
  const kind =
    process.env.RUNNER_SANDBOX ?? (process.env.NODE_ENV === 'production' ? 'docker' : 'process');
  if (kind === 'docker')
    return new DockerDriver({
      image: process.env.RUNNER_IMAGE ?? 'qaforge-runner:latest',
      network: process.env.RUNNER_NETWORK,
      memory: process.env.RUNNER_MEMORY,
      cpus: process.env.RUNNER_CPUS,
    });
  return new ProcessDriver(process.env.RUNNER_ALLOW_PROCESS_IN_PRODUCTION === 'true');
}
