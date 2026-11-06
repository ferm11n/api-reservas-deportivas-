import { defineConfig } from 'vitest/config';

// Suite independiente para las rutas y el proveedor push; no requiere acceso a Expo real.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/notifications/**/*.notifications-spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
