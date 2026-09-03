import express, { Request, Response } from 'express';
import { pool } from '../server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-in-production';

// POST agent registration
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, phone, company, password, instagram_username } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO agents (name, email, phone, company, password_hash, instagram_username)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email, phone, company, verified, instagram_username, created_at`,
      [name, email, phone || null, company || null, password_hash, instagram_username || null]
    );

    const agent = result.rows[0];
    const token = jwt.sign({ id: agent.id, email: agent.email }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      agent,
      token,
    });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error('Error registering agent:', error);
    res.status(500).json({ error: 'Failed to register agent' });
  }
});

// POST agent login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query('SELECT * FROM agents WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const agent = result.rows[0];
    const validPassword = await bcrypt.compare(password, agent.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: agent.id, email: agent.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      agent: {
        id: agent.id,
        name: agent.name,
        email: agent.email,
        phone: agent.phone,
        company: agent.company,
        verified: agent.verified,
        instagram_username: agent.instagram_username,
      },
      token,
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// PUT update agent's public Instagram username (used for Business Discovery lookups)
router.put('/instagram', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { instagram_username } = req.body;

    const result = await pool.query(
      `UPDATE agents SET instagram_username = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2
       RETURNING id, name, email, instagram_username`,
      [instagram_username || null, decoded.id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating agent Instagram username:', error);
    res.status(500).json({ error: 'Failed to update Instagram username' });
  }
});

// POST new agent listing (early access / coming soon)
router.post('/listings', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { address, city, price_estimate, bedrooms, bathrooms, sqm, description, images, expected_listing_date } = req.body;

    const result = await pool.query(
      `INSERT INTO agent_listings (
        agent_id, address, city, price_estimate, bedrooms, bathrooms, sqm, description, images, expected_listing_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [decoded.id, address, city, price_estimate, bedrooms, bathrooms, sqm, description, images || [], expected_listing_date || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating listing:', error);
    res.status(500).json({ error: 'Failed to create listing' });
  }
});

// GET agent's listings
router.get('/my-listings', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any;

    const result = await pool.query(
      `SELECT * FROM agent_listings WHERE agent_id = $1 ORDER BY created_at DESC`,
      [decoded.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching listings:', error);
    res.status(500).json({ error: 'Failed to fetch listings' });
  }
});

// GET all coming soon listings (public)
router.get('/coming-soon', async (req: Request, res: Response) => {
  try {
    const { city, limit = 20, offset = 0 } = req.query;

    let query = `SELECT al.*, a.name as agent_name, a.phone, a.email 
                 FROM agent_listings al 
                 JOIN agents a ON al.agent_id = a.id 
                 WHERE al.status = 'coming_soon'`;
    const params: any[] = [];

    if (city) {
      query += ` AND al.city ILIKE $1`;
      params.push(`%${city}%`);
    }

    query += ` ORDER BY al.expected_listing_date ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      total: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching coming soon listings:', error);
    res.status(500).json({ error: 'Failed to fetch listings' });
  }
});

export default router;
