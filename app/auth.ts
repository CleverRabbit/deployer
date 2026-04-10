import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import db from './db.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';
const ADMIN_EMAIL = 'dutsymbal@gmail.com';

// Mock transporter - in real app, use real SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: Number(process.env.SMTP_PORT) || 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function register(email: string, password: string) {
  const hashedPassword = await bcrypt.hash(password, 10);
  
  try {
    db.prepare('INSERT INTO users (email, password, is_active) VALUES (?, ?, 0)').run(email, hashedPassword);
    return { success: true, message: 'Registration successful. Please wait for admin activation via Telegram.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export function getUnactivatedUsers() {
  return db.prepare('SELECT id, email FROM users WHERE is_active = 0').all() as { id: number, email: string }[];
}

export function activateUserById(id: number) {
  const result = db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(id);
  return result.changes > 0;
}

export async function login(email: string, password: string) {
  const user: any = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return { success: false, message: 'User not found.' };
  if (!user.is_active) return { success: false, message: 'Account not activated.' };
  
  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) return { success: false, message: 'Invalid password.' };
  
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
  return { success: true, token, user: { id: user.id, email: user.email } };
}

export function verifyToken(token: string) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}
