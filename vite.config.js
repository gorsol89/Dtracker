import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';

// Vite configuration
export default defineConfig({
  plugins: [cesium()], // Include Cesium plugin
  build: {
    outDir: 'dist', // Output directory for the build
    rollupOptions: {
      input: './public/index.html', // Ensure Vite uses the index.html from the public folder
    },
    chunkSizeWarningLimit: 1000, // Optional: Increase chunk size limit for Cesium if needed
  },
  publicDir: 'public', // Ensure the public directory is properly referenced by Vite
});
