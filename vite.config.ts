import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Never inject secrets via `define`: anything defined here is embedded in the public bundle.
export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
