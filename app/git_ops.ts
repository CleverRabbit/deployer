import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

const projectsDir = path.join(process.cwd(), 'data', 'projects');
if (!fs.existsSync(projectsDir)) {
  fs.mkdirSync(projectsDir, { recursive: true });
}

// In-memory storage for passphrases
const passphrases = new Map<number, string>();

export function setPassphrase(projectId: number, passphrase: string) {
  passphrases.set(projectId, passphrase);
}

export function clearPassphrase(projectId: number) {
  passphrases.delete(projectId);
}

export async function cloneProject(projectId: number, gitUrl: string, name: string) {
  const projectPath = path.join(projectsDir, name);
  const passphrase = passphrases.get(projectId);
  
  const git = simpleGit();
  
  // To handle SSH passphrase without storing it on disk:
  // We can use a custom SSH_ASKPASS script
  const askPassPath = path.join(process.cwd(), `askpass_${projectId}.sh`);
  fs.writeFileSync(askPassPath, `#!/bin/bash\necho "${passphrase}"`, { mode: 0o700 });
  
  try {
    await git.env({
      ...process.env,
      DISPLAY: ':0',
      SSH_ASKPASS: askPassPath,
      GIT_ASKPASS: askPassPath,
    }).clone(gitUrl, projectPath, ['--depth', '1']);
    
    // Detect .env keys
    const envExamplePath = path.join(projectPath, '.env.example');
    const envPath = path.join(projectPath, '.env');
    let envKeys: string[] = [];
    
    if (fs.existsSync(envExamplePath)) {
      const content = fs.readFileSync(envExamplePath, 'utf-8');
      envKeys = content.split('\n')
        .map(line => line.split('=')[0].trim())
        .filter(key => key && !key.startsWith('#'));
    }
    
    return { success: true, projectPath, envKeys };
  } catch (error: any) {
    return { success: false, message: error.message };
  } finally {
    if (fs.existsSync(askPassPath)) {
      fs.unlinkSync(askPassPath);
    }
  }
}

export async function pullProject(projectPath: string, projectId: number) {
  const passphrase = passphrases.get(projectId);
  const askPassPath = path.join(process.cwd(), `askpass_${projectId}.sh`);
  fs.writeFileSync(askPassPath, `#!/bin/bash\necho "${passphrase}"`, { mode: 0o700 });

  const git = simpleGit(projectPath);
  try {
    await git.env({
      ...process.env,
      SSH_ASKPASS: askPassPath,
      GIT_ASKPASS: askPassPath,
    }).pull();
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  } finally {
    if (fs.existsSync(askPassPath)) {
      fs.unlinkSync(askPassPath);
    }
  }
}
