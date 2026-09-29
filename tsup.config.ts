import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'client/index': 'src/client/index.ts',
    // Router-free entry for hosts without react-router-dom (e.g. Next.js App Router).
    'client/appHost': 'src/client/appHost.ts',
    'ui/index': 'src/ui/index.ts',
  },
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom', 'react-router-dom', 'lucide-react', 'class-variance-authority', 'clsx', 'tailwind-merge', 'radix-ui'],
});
