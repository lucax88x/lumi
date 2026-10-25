import { test as base, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const stack = Object.fromEntries(readFileSync(new URL('../../.env.stack.local', import.meta.url), 'utf8').split('\n').filter(line => line && !line.startsWith('#')).map(line => {
  const index = line.indexOf('=');
  return [line.slice(0, index), line.slice(index + 1)];
}));
export const origin = process.env.LUMI_AUTH_TEST_ORIGIN || stack.NATIVE_ORIGIN || 'http://localhost:15173';
if (!/^http:\/\/localhost:\d+$/.test(origin)) throw new Error('Authentication tests only run against isolated local stacks.');

export const test = base.extend<{}, { nativeLumi: { restart: () => Promise<void> } }>({
  nativeLumi: [async ({ playwright }, use) => {
    let backend: ChildProcess | undefined;
    const http = await playwright.request.newContext();
    const stop = async () => {
      if (backend && backend.exitCode === null && backend.signalCode === null) {
        const exited = once(backend, 'exit');
        backend.kill('SIGTERM');
        await exited;
      }
    };
    const start = async () => {
      const existing = await http.get(`${origin}/healthz`).catch(() => undefined);
      if (existing) throw new Error(`Port already in use. Stop just dev before running just test-auth (${origin}).`);
      // Own this backend so restart checks never stop a developer's Go process.
      backend = spawn(fileURLToPath(new URL('../../dist/lumi', import.meta.url)), [], {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: {
          ...process.env,
          LISTEN_ADDR: `127.0.0.1:${new URL(origin).port}`,
          PUBLIC_ORIGIN: origin,
          DATA_DIR: 'data/auth-tests',
          WEB_DIR: 'web/dist',
          OIDC_ISSUER_URL: `${stack.PUBLIC_ORIGIN}/keycloak/realms/lumi`,
          OIDC_INTERNAL_URL: 'http://localhost:19090/keycloak/realms/lumi',
          OIDC_CLIENT_ID: 'lumi',
          OIDC_CLIENT_SECRET: stack.OIDC_CLIENT_SECRET,
          OPENAI_API_KEY: '',
        },
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      let startupError: Error | undefined;
      backend.on('error', error => { startupError = error; });
      await expect.poll(async () => {
        if (startupError) throw startupError;
        if (backend?.exitCode !== null || backend?.signalCode !== null) throw new Error(`Native Lumi exited during startup. Stop just dev before running just test-auth (${origin}).`);
        return (await http.get(`${origin}/healthz`).catch(() => undefined))?.status();
      }, { timeout: 30_000 }).toBe(200);
    };
    try {
      await start();
      await use({ restart: async () => { await stop(); await start(); } });
    } finally {
      await stop();
      await http.dispose();
    }
  }, { scope: 'worker', auto: true }],
});
