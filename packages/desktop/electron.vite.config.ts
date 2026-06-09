import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { createRendererViteConfig, rendererRoot } from './viteRendererConfig.js';

// Read the real AionUi version from the repo-root package.json.
// `packages/desktop/package.json` is a workspace-internal placeholder pinned
// at "0.0.0" — never use it for user-visible version strings.
const rootPackageJson = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as {
  version: string;
};

// Build builtin MCP servers after main process bundle so they survive out/main/ cleanup.
function buildMcpServersPlugin() {
  return {
    name: 'vite-plugin-build-mcp-servers',
    closeBundle() {
      execSync(`node "${resolve('scripts/build-mcp-servers.js')}"`, { stdio: 'inherit' });
    },
  };
}

// Common path aliases for main process and workers
const desktopSrcRoot = resolve('packages/desktop/src');

const mainAliases = {
  '@': desktopSrcRoot,
  '@common': resolve('packages/desktop/src/common'),
  '@renderer': rendererRoot,
  '@process': resolve('packages/desktop/src/process'),
  '@worker': resolve('packages/desktop/src/process/worker'),
  '@xterm/headless': resolve('packages/desktop/src/common/utils/shims/xterm-headless.ts'),
};

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === 'development';
  const enableSentrySourceMaps = !isDevelopment && !!process.env.SENTRY_AUTH_TOKEN;

  const sentryPluginOptions = {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    sourcemaps: {
      filesToDeleteAfterUpload: ['./out/**/*.map'],
      rewriteSources: (source: string) => {
        // Normalize Windows backslashes and strip leading relative prefixes
        // so Sentry paths match the GitHub repo structure (e.g.
        // packages/desktop/src/process/...)
        return source.replace(/\\/g, '/').replace(/^(\.\.\/)+(packages\/desktop\/src\/)/, '$2');
      },
    },
  };

  return {
    main: {
      plugins: [
        // externalizeDepsPlugin replaces our custom getExternalDeps() + pluginExternalizeDynamicImports.
        // 'fix-path' excluded so it gets bundled inline (only 3KB).
        // '@aionui/web-host' excluded so its TS sources (which use ESM ".js" import specifiers)
        // are bundled by esbuild rather than left as `require('@aionui/web-host')`, which Node
        // cannot resolve because the package ships no compiled .js files (workspace-only).
        externalizeDepsPlugin({ exclude: ['fix-path', '@aionui/web-host'] }),
        ...(isDevelopment
          ? [
              {
                name: 'dev-build-mcp-servers',
                closeBundle() {
                  execSync(`node "${resolve(__dirname, '../../scripts/build-mcp-servers.js')}"`, {
                    stdio: 'inherit',
                  });
                },
              },
            ]
          : []),
        ...(!isDevelopment
          ? [
              viteStaticCopy({
                structured: false,
                // electron-vite builds main process as SSR; viteStaticCopy defaults
                // to environment: "client" and silently skips non-client environments.
                environment: 'ssr',
                targets: [
                  // Use single * glob to copy top-level items (directories) with their contents intact.
                  // Using ** would flatten all nested files into the dest root.
                  { src: 'packages/desktop/src/renderer/assets/logos/*', dest: 'static/images' },
                ],
              }),
            ]
          : []),
        ...(enableSentrySourceMaps ? [sentryVitePlugin(sentryPluginOptions)] : []),
        ...(isDevelopment ? [buildMcpServersPlugin()] : []),
      ],
      resolve: { alias: mainAliases, extensions: ['.ts', '.tsx', '.js', '.json'] },
      build: {
        sourcemap: enableSentrySourceMaps ? 'hidden' : isDevelopment,
        reportCompressedSize: false,
        rollupOptions: {
          input: {
            index: resolve('packages/desktop/src/index.ts'),
            // Built-in MCP server entry points (compiled by scripts/build-mcp-servers.js via esbuild,
            // not vite — esbuild bundles all deps for self-contained execution by external node processes)
          },
          onwarn(warning, warn) {
            if (warning.code === 'EVAL') return;
            warn(warning);
          },
        },
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify(mode),
        'process.env.env': JSON.stringify(process.env.env),
        'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN ?? ''),
      },
    },

    preload: {
      // Bundle @sentry/electron/preload so its hookupIpc() runs in the preload
      // context. Externalized dependencies leave a runtime require('...') in
      // the output, which Electron's sandbox-mode preload cannot resolve from
      // node_modules (→ "module not found"). Bundling inlines the few hundred
      // bytes of IPC wiring we actually need.
      plugins: [externalizeDepsPlugin({ exclude: ['@sentry/electron'] })],
      resolve: {
        alias: {
          '@': resolve('packages/desktop/src'),
          '@common': resolve('packages/desktop/src/common'),
        },
        extensions: ['.ts', '.tsx', '.js', '.json'],
      },
      build: {
        sourcemap: false,
        reportCompressedSize: false,
        rollupOptions: {
          input: {
            index: resolve('packages/desktop/src/preload/main.ts'),
            petPreload: resolve('packages/desktop/src/preload/petPreload.ts'),
            petHitPreload: resolve('packages/desktop/src/preload/petHitPreload.ts'),
            petConfirmPreload: resolve('packages/desktop/src/preload/petConfirmPreload.ts'),
          },
        },
      },
    },
    renderer: createRendererViteConfig({
      mode,
      appVersion: rootPackageJson.version,
      enableSentrySourceMaps,
      sentryPluginOptions,
    }),
  };
});
