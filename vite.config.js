import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';

// Vite configuration
export default defineConfig({
  plugins: [cesium()],
  build: {
    chunkSizeWarningLimit: 1000, // Optional: Increase chunk size limit for Cesium
  },
});
