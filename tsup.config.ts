import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'client/index': 'src/client/index.ts',
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
