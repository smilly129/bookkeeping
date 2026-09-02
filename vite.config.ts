import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/bookkeeping/',
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
  },
  build: {
    outDir: 'docs',
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/antd/') || id.includes('@ant-design/icons')) return 'antd';
          if (id.includes('node_modules/antd-mobile')) return 'antd-mobile';
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router')) return 'vendor';
          if (id.includes('node_modules/@supabase')) return 'supabase';
          if (id.includes('node_modules/dayjs')) return 'dayjs';
        },
      },
    },
  },
});
