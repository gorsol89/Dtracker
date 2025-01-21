import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';
import path from 'path';

export default defineConfig({
  root: './dtracker', // Root directory set to 'dtracker' containing index.html
  plugins: [cesium()], // Include Cesium plugin
  build: {
    outDir: '../dist', // Output build files to '../dist' folder at root
    rollupOptions: {
      input: path.resolve(__dirname, 'dtracker/index.html'), // Use absolute path for entry point
    },
    chunkSizeWarningLimit: 1000, // Avoid warnings for Cesium bundle size
    emptyOutDir: true, // Clear dist folder before each build
  },
  publicDir: '../public', // Directory for public/static assets
});
