import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';

export const AIONUI_ADMIN_USERNAME_ENV = 'AIONUI_ADMIN_USERNAME';
export const AIONUI_ADMIN_PASSWORD_ENV = 'AIONUI_ADMIN_PASSWORD';

export type ConfiguredAdminCredentials = {
  username: string;
  password: string;
};

export type EnforceAdminCredentialsOptions = {
  backendPort: number;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
};

function readClosestDotenvPath(startDir: string, maxDepth: number): string | null {
  let current = path.resolve(startDir);
  for (let depth = 0; depth <= maxDepth; depth++) {
    const candidate = path.join(current, '.env');
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // best-effort
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function loadClosestDotenvFile(startDir: string, maxDepth = 3): string | null {
  const dotenvPath = readClosestDotenvPath(startDir, maxDepth);
  if (!dotenvPath) return null;
  dotenv.config({ path: dotenvPath, quiet: true });
  return dotenvPath;
}

export function resolveConfiguredAdminCredentials(env: NodeJS.ProcessEnv): ConfiguredAdminCredentials | null {
  const password = env[AIONUI_ADMIN_PASSWORD_ENV];
  if (!password) return null;

  const username = env[AIONUI_ADMIN_USERNAME_ENV]?.trim() || 'admin';
  return {
    username,
    password,
  };
}

async function assertOkResponse(res: Response, action: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  throw new Error(`${action} failed (${res.status}): ${body}`);
}

export async function enforceConfiguredAdminCredentials(
  options: EnforceAdminCredentialsOptions
): Promise<ConfiguredAdminCredentials | null> {
  const credentials = resolveConfiguredAdminCredentials(options.env);
  if (!credentials) return null;

  const baseUrl = `http://127.0.0.1:${options.backendPort}`;
  const headers = { 'Content-Type': 'application/json' };

  const usernameRes = await options.fetchImpl(`${baseUrl}/api/webui/change-username`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ new_username: credentials.username }),
  });
  await assertOkResponse(usernameRes, '/api/webui/change-username');

  const passwordRes = await options.fetchImpl(`${baseUrl}/api/webui/change-password`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ new_password: credentials.password }),
  });
  await assertOkResponse(passwordRes, '/api/webui/change-password');

  return credentials;
}
