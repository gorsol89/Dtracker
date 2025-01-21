import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';

export default defineConfig({
  root: './dtracker', // Set the root directory to 'dtracker' where index.html is located
  plugins: [cesium()], // Include Cesium plugin
  build: {
    outDir: '../dist', // Output folder for the build files
    rollupOptions: {
      input: './dtracker/index.html', // Entry point for the app
    },
    chunkSizeWarningLimit: 1000, // Avoid warnings for Cesium bundle size
    emptyOutDir: true, // Clears the dist directory before each build
  },
  publicDir: '../public', // Set the public directory for static assets
});
