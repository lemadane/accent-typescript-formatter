import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    delete process.env.ELECTRON_RUN_AS_NODE;
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [path.resolve(__dirname, '../../')],
    });
  } catch (err) {
    console.error('Test execution failed:', err);
    process.exit(1);
  }
}

main();
