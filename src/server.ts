import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';

// Import routes
import propertiesRouter from './api/properties';
import usersRouter from './api/users';
import agentsRouter from './api/agents';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Middleware
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://sarah-a13.github.io,http://localhost:3000,http://localhost:5500,http://127.0.0.1:5500')
  .split(',')
  .map(o => o.trim());
app.use(cors({
  origin: (origin, callback) => {
    // Allow no-origin requests (e.g. curl, server-to-server) and file:// (origin 'null') for local prototype testing
    if (!origin || origin === 'null' || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
}));
app.use(express.json({ limit: '1mb' }));

// Database connection pool
export const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'homeradar',
  // 🔧 Connection options for Supabase
  ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,  // 10 second timeout
  idleTimeoutMillis: 30000,         // 30 second idle timeout
  max: 10,                          // Max 10 connections in pool
  application_name: 'homeradar-backend',
});

// Test connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    console.log('⚠️  Running in degraded mode (mock data only)');
  } else {
    console.log('✅ Database connected successfully at:', res.rows[0].now);
  }
});

pool.on('error', (err) => {
  console.error('⚠️ Unexpected error on idle client:', err.message);
  // Don't exit - allow graceful degradation
});

// Routes
app.use('/api/properties', propertiesRouter);
app.use('/api/users', usersRouter);
app.use('/api/agents', agentsRouter);

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 HomeRadar backend running on port ${port}`);
  console.log(`📊 Database: ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'homeradar'}`);
});
