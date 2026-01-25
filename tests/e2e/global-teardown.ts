import { teardownMerobox } from './setup';

export default async function globalTeardown() {
  console.log('🧹 Global teardown: cleaning up merobox...');
  await teardownMerobox();
}
