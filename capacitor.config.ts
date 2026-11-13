import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'bg.sikamikaniko.patzer',
  appName: 'Patzer',
  webDir: 'web/dist',
  // The app is offline-first; nothing is fetched from a remote origin at
  // runtime except the model downloads (see web/src/engine/models.ts).
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    CapacitorHttp: {
      // Native HTTP for the Chess.com / Lichess imports — no CORS, no proxy.
      enabled: true,
    },
  },
};

export default config;
