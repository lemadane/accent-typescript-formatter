import * as path from 'path';
import * as fs from 'fs';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
  });
  const testsRoot = __dirname;
  const walk = (dir: string): void => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(
          dir,
          file);
      if (fs.statSync(fullPath).isDirectory()) {
        walk(fullPath);
      } else if (file.endsWith('.test.js')) {
        mocha.addFile(fullPath);
      }
    }
  };
  walk(testsRoot);
  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
