import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api/v1': {
          target: env.KPI_API_TARGET || 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
  };
});
