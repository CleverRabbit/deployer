import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { addToQueue } from './docker_ops.ts';

const execAsync = promisify(exec);

export async function runTests(projectPath: string) {
  let command = '';
  
  if (fs.existsSync(path.join(projectPath, 'pytest.ini')) || fs.existsSync(path.join(projectPath, 'tests'))) {
    command = 'pytest';
  } else if (fs.existsSync(path.join(projectPath, 'package.json'))) {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8'));
    if (pkg.scripts && pkg.scripts.test) {
      command = 'npm test';
    }
  } else if (fs.existsSync(path.join(projectPath, 'Makefile'))) {
    command = 'make test';
  }
  
  if (!command) {
    return { success: false, message: 'No test configuration detected (pytest.ini, package.json, Makefile).' };
  }
  
  return addToQueue(async () => {
    try {
      const { stdout, stderr } = await execAsync(command, { cwd: projectPath });
      return { success: true, output: stdout + stderr };
    } catch (error: any) {
      return { success: false, output: error.stdout + error.stderr, message: error.message };
    }
  });
}
