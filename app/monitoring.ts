import cron from 'node-cron';
import db from './db.ts';
import { getStats } from './docker_ops.ts';
import nodemailer from 'nodemailer';

const ADMIN_EMAIL = 'dutsymbal@gmail.com';
const CPU_THRESHOLD = 80; // 80%
const RAM_THRESHOLD = 1500; // 1.5 GB

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: Number(process.env.SMTP_PORT) || 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export function startMonitoring() {
  // Every 30 seconds
  cron.schedule('*/30 * * * * *', async () => {
    const projects = db.prepare("SELECT * FROM projects WHERE status = 'running'").all() as any[];
    
    for (const project of projects) {
      // Assuming container name is project name or derived from it
      // In docker-compose, it's usually {project_dir_name}-{service_name}-1
      // For simplicity, we'll try to find containers associated with the project
      // This is a bit simplified
      const stats = await getStats(`${project.name}-app-1`); // Placeholder logic
      
      if (stats) {
        db.prepare('INSERT INTO monitoring (project_id, cpu_usage, ram_usage) VALUES (?, ?, ?)')
          .run(project.id, stats.cpuPercent, stats.ramUsage);
        
        // Check thresholds
        if (stats.cpuPercent > CPU_THRESHOLD || stats.ramUsage > RAM_THRESHOLD) {
          sendAlert(project.name, stats.cpuPercent, stats.ramUsage);
        }
      }
    }
    
    // Cleanup old monitoring data (keep last 24h)
    db.prepare("DELETE FROM monitoring WHERE timestamp < datetime('now', '-1 day')").run();
  });
}

async function sendAlert(projectName: string, cpu: number, ram: number) {
  try {
    await transporter.sendMail({
      from: '"Deployer Monitor" <monitor@deployer.local>',
      to: ADMIN_EMAIL,
      subject: `ALERT: Resource usage high for ${projectName}`,
      text: `Project ${projectName} is using ${cpu.toFixed(2)}% CPU and ${ram.toFixed(2)}MB RAM.`,
      html: `<p>Project <b>${projectName}</b> is using <b>${cpu.toFixed(2)}%</b> CPU and <b>${ram.toFixed(2)}MB</b> RAM.</p>`,
    });
  } catch (error) {
    console.error('Failed to send alert email:', error);
  }
}
