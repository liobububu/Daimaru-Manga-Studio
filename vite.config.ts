import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    svgr({
      svgrOptions: {
        icon: true,
        exportType: "named",
        namedExport: "ReactComponent",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('react-router')) return 'react-vendor';
          if (id.includes('@radix-ui') || id.includes('lucide-react') || id.includes('sonner')) return 'ui-vendor';
          if (id.includes('@sentry')) return 'sentry';
          if (id.includes('recharts')) return 'charts';
          return 'vendor';
        },
      },
    },
  },
});
