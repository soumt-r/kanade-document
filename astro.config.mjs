// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site:  'https://kanade.soumt.moe',
  redirects: {
    '/docs/tutorial/12-files': '/docs/hana/files',
    '/docs/tutorial/13-paths': '/docs/tutorial/12-paths',
    '/docs/tutorial/14-sockets': '/docs/hana/sockets',
    '/docs/tutorial/15-http': '/docs/hana/http',
    '/docs/tutorial/16-timezone': '/docs/hana/timezone',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});