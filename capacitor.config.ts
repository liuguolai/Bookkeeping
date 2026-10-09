import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'app.local.pocketledger',
  appName: '口袋账本',
  webDir: 'dist',
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: true,
      iosKeychainPrefix: 'pocketledger',
      iosBiometric: { biometricAuth: false },
      androidIsEncryption: true,
      androidBiometric: { biometricAuth: false },
    },
  },
};
export default config;
