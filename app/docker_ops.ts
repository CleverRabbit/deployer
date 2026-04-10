import Docker from 'dockerode';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);
const docker = new Docker();

// Simple task queue to ensure one operation at a time
let isProcessing = false;
const queue: (() => Promise<any>)[] = [];

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;
  const task = queue.shift();
  if (task) {
    try {
      await task();
    } catch (error) {
      console.error('Queue task failed:', error);
    }
  }
  isProcessing = false;
  processQueue();
}

export function addToQueue(task: () => Promise<any>) {
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        const result = await task();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
    processQueue();
  });
}

export async function deployProject(projectPath: string, envVars: Record<string, string>) {
  // Write .env file
  const envContent = Object.entries(envVars)
    .map(([key, val]) => `${key}=${val}`)
    .join('\n');
  fs.writeFileSync(path.join(projectPath, '.env'), envContent);

  return addToQueue(async () => {
    try {
      // Use docker-compose v2 (docker compose)
      const { stdout, stderr } = await execAsync('docker compose up -d --build', { cwd: projectPath });
      return { success: true, output: stdout + stderr };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  });
}

export async function stopProject(projectPath: string) {
  return addToQueue(async () => {
    try {
      const { stdout, stderr } = await execAsync('docker compose down', { cwd: projectPath });
      return { success: true, output: stdout + stderr };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  });
}

export async function getStats(containerName: string) {
  try {
    const container = docker.getContainer(containerName);
    const stats = await container.stats({ stream: false });
    
    // Calculate CPU percentage
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const cpuPercent = (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100.0;
    
    // RAM usage in MB
    const ramUsage = stats.memory_stats.usage / (1024 * 1024);
    
    return { cpuPercent, ramUsage };
  } catch (error) {
    return null;
  }
}

export async function getLogs(projectPath: string, lines = 1000) {
  try {
    const { stdout } = await execAsync(`docker compose logs --tail=${lines}`, { cwd: projectPath });
    return stdout;
  } catch (error: any) {
    return `Error fetching logs: ${error.message}`;
  }
}
