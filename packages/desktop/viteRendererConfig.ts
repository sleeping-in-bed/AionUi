import { resolve } from 'node:path';
import type { PluginOption, UserConfig } from 'vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import UnoCSS from 'unocss/vite';
import unoConfig from '../../uno.config.ts';

export const rendererRoot = resolve(__dirname, 'src/renderer');

type RendererConfigOptions = {
  mode: string;
  appVersion: string;
  enableSentrySourceMaps: boolean;
  sentryPluginOptions: {
    org?: string;
    project?: string;
    authToken?: string;
    sourcemaps: {
      filesToDeleteAfterUpload: string[];
      rewriteSources: (source: string) => string;
    };
  };
};

function iconParkPlugin(): PluginOption {
  return {
    name: 'vite-plugin-icon-park',
    enforce: 'pre',
    transform(source: string, id: string) {
      if (!id.endsWith('.tsx') || id.includes('node_modules')) return null;
      if (!source.includes('@icon-park/react')) return null;
      const transformedSource = source.replace(
        /import\s+\{\s+([a-zA-Z, ]*)\s+\}\s+from\s+['"]@icon-park\/react['"](;?)/g,
        function (str, match) {
          if (!match) return str;
          const components = match.split(',');
          const importComponent = str.replace(
            match,
            components.map((key: string) => `${key} as _${key.trim()}`).join(', ')
          );
          const hoc = `import IconParkHOC from '@renderer/components/IconParkHOC';
          ${components.map((key: string) => `const ${key.trim()} = IconParkHOC(_${key.trim()})`).join(';\n')}`;
          return importComponent + ';' + hoc;
        }
      );
      if (transformedSource !== source) return { code: transformedSource, map: null };
      return null;
    },
  };
}

export function createRendererViteConfig(options: RendererConfigOptions): UserConfig {
  const { mode, appVersion, enableSentrySourceMaps, sentryPluginOptions } = options;
  const isDevelopment = mode === 'development';

  return {
    root: rendererRoot,
    base: './',
    publicDir: resolve(__dirname, '../../public'),
    appType: 'mpa',
    server: {
      // Default to 5173; when occupied (e.g. another AionUi clone is running),
      // Vite auto-increments to the next available port.
      port: 5173,
      // Explicit HMR host so Vite client connects directly to the Vite dev server,
      // not to the WebUI proxy server (which would reject the WebSocket and cause infinite reload).
      // Port is omitted so it automatically matches the server port.
      hmr: {
        host: 'localhost',
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@common': resolve(__dirname, 'src/common'),
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@process': resolve(__dirname, 'src/process'),
        '@worker': resolve(__dirname, 'src/process/worker'),
        // Force ESM version of streamdown
        streamdown: resolve(__dirname, '../../node_modules/streamdown/dist/index.js'),
      },
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.css'],
      // CodeMirror relies on module-level singletons (highlighterFacet, tag
      // sets). If Vite pre-bundles two copies of @codemirror/language (one for
      // our direct import, one nested under @uiw/react-codemirror), our custom
      // markdown HighlightStyle registers on a facet the editor never reads,
      // so the source view silently falls back to near-monochrome. Dedupe the
      // singleton packages to a single physical copy. Only packages hoisted to
      // the top-level node_modules may be deduped here — @lezer/common is not
      // hoisted under bun's isolated layout, so listing it breaks the Rollup
      // production build (cannot resolve from nested @codemirror/lang-* dirs).
      dedupe: [
        'react',
        'react-dom',
        'react-router-dom',
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/language',
        '@lezer/highlight',
      ],
    },
    plugins: [
      UnoCSS(unoConfig),
      iconParkPlugin(),
      ...(enableSentrySourceMaps ? [sentryVitePlugin(sentryPluginOptions)] : []),
    ],
    build: {
      target: 'es2022',
      sourcemap: enableSentrySourceMaps ? 'hidden' : isDevelopment,
      minify: !isDevelopment,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 1500,
      cssCodeSplit: true,
      rollupOptions: {
        input: {
          index: resolve(rendererRoot, 'index.html'),
          pet: resolve(rendererRoot, 'pet/pet.html'),
          'pet-hit': resolve(rendererRoot, 'pet/pet-hit.html'),
          'pet-confirm': resolve(rendererRoot, 'pet/pet-confirm.html'),
        },
        external: ['node:crypto', 'crypto'],
        onwarn(warning, warn) {
          if (warning.code === 'EVAL') return;
          warn(warning);
        },
        output: {
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/react-dom/') || id.includes('/react/')) return 'vendor-react';
            if (id.includes('/@arco-design/')) return 'vendor-arco';
            if (
              id.includes('/react-markdown/') ||
              id.includes('/remark-') ||
              id.includes('/rehype-') ||
              id.includes('/unified/') ||
              id.includes('/mdast-') ||
              id.includes('/hast-') ||
              id.includes('/micromark')
            )
              return 'vendor-markdown';
            if (
              id.includes('/react-syntax-highlighter/') ||
              id.includes('/refractor/') ||
              id.includes('/highlight.js/')
            )
              return 'vendor-highlight';
            if (
              id.includes('/monaco-editor/') ||
              id.includes('/@monaco-editor/') ||
              id.includes('/codemirror/') ||
              id.includes('/@codemirror/')
            )
              return 'vendor-editor';
            if (id.includes('/katex/')) return 'vendor-katex';
            if (id.includes('/@icon-park/')) return 'vendor-icons';
            if (id.includes('/diff2html/')) return 'vendor-diff';
            return undefined;
          },
        },
      },
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      'process.env.env': JSON.stringify(process.env.env),
      'process.env.AIONUI_MULTI_INSTANCE': JSON.stringify(process.env.AIONUI_MULTI_INSTANCE ?? ''),
      'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN ?? ''),
      // Inject the real AionUi version (root package.json) so renderer code
      // can show it without importing packages/desktop/package.json, which is
      // a workspace-internal placeholder frozen at "0.0.0".
      __APP_VERSION__: JSON.stringify(appVersion),
      global: 'globalThis',
    },
    optimizeDeps: {
      exclude: ['electron'],
      include: [
        'react',
        'react-dom',
        'react-router-dom',
        'react-i18next',
        'i18next',
        '@arco-design/web-react',
        '@icon-park/react',
        'react-markdown',
        'react-syntax-highlighter',
        'react-virtuoso',
        'classnames',
        'swr',
        'eventemitter3',
        'katex',
        'diff2html',
        'remark-gfm',
        'remark-math',
        'remark-breaks',
        'rehype-raw',
        'rehype-katex',
        // Pre-bundle the CodeMirror entry points together so they share a
        // single @codemirror/language copy (see dedupe note above); otherwise
        // the markdown source view loses its custom syntax highlighting.
        '@uiw/react-codemirror',
        '@codemirror/lang-markdown',
        '@codemirror/language',
      ],
    },
  };
}
