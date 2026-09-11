import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.openher.chat',
  appName: 'OpenHer Chat',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
