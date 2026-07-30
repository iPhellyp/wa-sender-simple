import { startWhatsappWatchdog } from './src/lib/baileys/watchdog';

export async function registerNodeInstrumentation() {
  await startWhatsappWatchdog();
}