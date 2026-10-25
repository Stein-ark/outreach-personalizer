import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { APP_NAME } from '@op/shared';
import { findLoopbackPermissions, scanDirForSecrets } from './build-checks';

/** API origin from WXT_API_BASE_URL (.env.development or .env.production). WXT loads those files before this runs. */
function apiOrigin(): string {
  const raw = process.env.WXT_API_BASE_URL;
  if (!raw) throw new Error('WXT_API_BASE_URL is not set. Copy extension/.env.example to .env.production (or use .env.development).');
  return new URL(raw).origin;
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: { conditions: ['source'] },
    build: { sourcemap: false },
    // Shown in Settings, so it is obvious which build the browser is running.
    define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  }),
  manifest: ({ mode }) => {
    const origin = apiOrigin();
    const key = process.env.WXT_EXTENSION_KEY;
    return {
      name: APP_NAME,
      description: 'Collects email addresses from the pages you visit into spreadsheets of 200, and drafts a message for them if you want.',
      minimum_chrome_version: '116',
      // downloads: saves finished sheets to the Downloads folder. alarms: checks once a minute whether a sheet is ready.
      permissions: ['storage', 'activeTab', 'scripting', 'sidePanel', 'contextMenus', 'downloads', 'alarms'],
      host_permissions: [`${origin}/*`],
      // Requested only when the user turns on automatic collection in Settings, and removed when they turn it off.
      optional_host_permissions: ['https://*/*', 'http://*/*'],
      // An action with no popup, so clicking the icon fires action.onClicked (a user gesture that grants activeTab).
      action: { default_title: `Collect emails on this page` },
      commands: {
        _execute_action: { suggested_key: { default: 'Alt+Shift+O' }, description: 'Collect emails on this page' },
      },
      ...(key ? { key } : {}),
      ...(mode === 'production'
        ? {
            content_security_policy: {
              extension_pages: `script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; connect-src ${origin}; img-src 'self' data:; style-src 'self'; default-src 'self'`,
            },
          }
        : {}),
    };
  },
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      if (wxt.config.mode !== 'production') return;
      const bad = findLoopbackPermissions(manifest as Parameters<typeof findLoopbackPermissions>[0]);
      if (bad.length) throw new Error(`Production manifest must not reference localhost: ${bad.join(', ')}`);
      if (!process.env.WXT_EXTENSION_KEY) wxt.logger.warn('WXT_EXTENSION_KEY is not set, so the extension id will not be stable. See DOCS.md.');
    },
    'build:done': (wxt) => {
      const findings = scanDirForSecrets(wxt.config.outDir);
      if (findings.length) throw new Error(`Possible secrets in the built extension:\n${findings.join('\n')}`);
      wxt.logger.success('Secret scan passed');
    },
  },
});
