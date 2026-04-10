import express from 'express';
import path from 'path';
import fs from 'fs';
import cookieParser from 'cookie-parser';
import { Telegraf } from 'telegraf';
import { register, login, getUnactivatedUsers, activateUserById, verifyToken } from './app/auth.ts';
import db from './app/db.ts';
import { cloneProject, setPassphrase, clearPassphrase } from './app/git_ops.ts';
import { deployProject, stopProject, getLogs } from './app/docker_ops.ts';
import { runTests } from './app/test_runner.ts';
import { startMonitoring } from './app/monitoring.ts';

const app = express();
const PORT = 3000;

// Telegram Bot Setup
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (BOT_TOKEN) {
  const bot = new Telegraf(BOT_TOKEN);

  bot.command('activate_deployer', (ctx) => {
    const users = getUnactivatedUsers();
    if (users.length === 0) {
      return ctx.reply('No unactivated users found.');
    }
    const list = users.map((u, i) => `${i + 1} - ${u.email}`).join('\n');
    ctx.reply(`Unactivated emails:\n${list}\n\nReply with the number to activate.`);
  });

  bot.on('text', (ctx) => {
    const text = ctx.message.text;
    const index = parseInt(text) - 1;
    if (!isNaN(index)) {
      const users = getUnactivatedUsers();
      if (users[index]) {
        const success = activateUserById(users[index].id);
        if (success) {
          ctx.reply(`User ${users[index].email} activated!`);
        } else {
          ctx.reply('Failed to activate user.');
        }
      }
    }
  });

  bot.launch().catch(err => console.error('Telegram bot failed to start:', err));
}

app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(process.cwd(), 'public')));

// Auth Middleware
const authMiddleware = (req: any, res: any, next: any) => {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login');
  const user = verifyToken(token);
  if (!user) return res.redirect('/login');
  req.user = user;
  next();
};

// Routes
app.get('/', authMiddleware, (req: any, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  res.render('index', { projects, user: req.user });
});

app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const result = await login(email, password);
  if (result.success) {
    res.cookie('token', result.token, { httpOnly: true, secure: true });
    res.redirect('/');
  } else {
    res.render('login', { error: result.message });
  }
});

app.get('/register', (req, res) => res.render('register', { error: null, message: null }));
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  const result = await register(email, password);
  res.render('register', { error: result.success ? null : result.message, message: result.success ? result.message : null });
});

app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

// Project Routes
app.post('/projects/add', authMiddleware, async (req, res) => {
  const { name, git_url, ssh_passphrase } = req.body;
  try {
    const result = db.prepare('INSERT INTO projects (name, git_url) VALUES (?, ?)').run(name, git_url);
    const projectId = result.lastInsertRowid as number;
    
    if (ssh_passphrase) {
      setPassphrase(projectId, ssh_passphrase);
    }
    
    const cloneResult = await cloneProject(projectId, git_url, name);
    if (cloneResult.success) {
      db.prepare("UPDATE projects SET status = 'idle' WHERE id = ?").run(projectId);
      res.json({ success: true, envKeys: cloneResult.envKeys, projectId });
    } else {
      res.status(500).json({ success: false, message: cloneResult.message });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/projects/:id/deploy', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { envVars } = req.body;
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  
  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
  
  const projectPath = path.join(process.cwd(), 'data', 'projects', project.name);
  const result: any = await deployProject(projectPath, envVars);
  
  if (result.success) {
    db.prepare("UPDATE projects SET status = 'running', last_deploy = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    res.json({ success: true, output: result.output });
  } else {
    res.status(500).json({ success: false, message: result.message });
  }
});

app.post('/projects/:id/stop', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  const projectPath = path.join(process.cwd(), 'data', 'projects', project.name);
  
  const result: any = await stopProject(projectPath);
  if (result.success) {
    db.prepare("UPDATE projects SET status = 'stopped' WHERE id = ?").run(id);
    res.json({ success: true, output: result.output });
  } else {
    res.status(500).json({ success: false, message: result.message });
  }
});

app.post('/projects/:id/test', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  const projectPath = path.join(process.cwd(), 'data', 'projects', project.name);
  
  const result = await runTests(projectPath);
  res.json(result);
});

// Logs SSE
app.get('/projects/:id/logs/stream', authMiddleware, (req, res) => {
  const { id } = req.params;
  const project: any = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  const projectPath = path.join(process.cwd(), 'data', 'projects', project.name);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendLogs = async () => {
    const logs = await getLogs(projectPath);
    res.write(`data: ${JSON.stringify({ logs })}\n\n`);
  };

  const interval = setInterval(sendLogs, 3000);
  sendLogs();

  req.on('close', () => clearInterval(interval));
});

// Monitoring API
app.get('/api/monitoring/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const data = db.prepare('SELECT * FROM monitoring WHERE project_id = ? ORDER BY timestamp DESC LIMIT 20').all(id);
  res.json(data.reverse());
});

// System Check API
app.get('/api/system-check', authMiddleware, async (req, res) => {
  const checks = {
    docker: false,
    git: false,
    db: false,
    smtp: false
  };

  try {
    const Docker = (await import('dockerode')).default;
    const docker = new Docker();
    await docker.ping();
    checks.docker = true;
  } catch (e) {}

  try {
    const { execSync } = await import('child_process');
    execSync('git --version');
    checks.git = true;
  } catch (e) {}

  try {
    db.prepare('SELECT 1').get();
    checks.db = true;
  } catch (e) {}

  try {
    const nodemailer = (await import('nodemailer')).default;
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.ethereal.email',
      port: Number(process.env.SMTP_PORT) || 587,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    await transporter.verify();
    checks.smtp = true;
  } catch (e) {}

  const html = `
    <div class="bg-zinc-900 border border-zinc-800 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="flex items-center gap-2">
        <div class="w-2 h-2 rounded-full ${checks.docker ? 'bg-emerald-500' : 'bg-red-500'}"></div>
        <span class="text-xs font-medium">Docker: ${checks.docker ? 'Online' : 'Offline'}</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-2 h-2 rounded-full ${checks.git ? 'bg-emerald-500' : 'bg-red-500'}"></div>
        <span class="text-xs font-medium">Git: ${checks.git ? 'Installed' : 'Missing'}</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-2 h-2 rounded-full ${checks.db ? 'bg-emerald-500' : 'bg-red-500'}"></div>
        <span class="text-xs font-medium">Database: ${checks.db ? 'Healthy' : 'Error'}</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-2 h-2 rounded-full ${checks.smtp ? 'bg-emerald-500' : 'bg-red-500'}"></div>
        <span class="text-xs font-medium">SMTP: ${checks.smtp ? 'Connected' : 'Failed'}</span>
      </div>
    </div>
  `;
  res.send(html);
});

// Start background monitoring
startMonitoring();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
