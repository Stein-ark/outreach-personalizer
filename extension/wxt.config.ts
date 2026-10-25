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
  }),
  manifest: ({ mode }) => {
    const origin = apiOrigin();
    const key = process.env.WXT_EXTENSION_KEY;
    return {
      name: APP_NAME,
      description: 'Drafts a personalized fundraising outreach email from the page you are viewing, when you ask it to.',
      minimum_chrome_version: '116',
      permissions: ['storage', 'activeTab', 'scripting', 'sidePanel', 'contextMenus'],
      host_permissions: [`${origin}/*`],
      // An action with no popup, so clicking the icon fires action.onClicked (a user gesture that grants activeTab).
      action: { default_title: `Open ${APP_NAME} for this page` },
      commands: {
        _execute_action: { suggested_key: { default: 'Alt+Shift+O' }, description: 'Draft outreach for this page' },
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
