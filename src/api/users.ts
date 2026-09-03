import express, { Request, Response } from 'express';
import { pool } from '../server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { triggerSocialMediaScraping } from '../scrapers/trigger';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-in-production';

// Verifies the Bearer token on a request and returns the decoded payload, or null if missing/invalid.
function getAuthUser(req: Request): { id: string; email: string } | null {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    return null;
  }
}

// POST register new user
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, first_name, last_name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4) RETURNING id, email, first_name, last_name, created_at`,
      [email, password_hash, first_name || null, last_name || null]
    );

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      user,
      token,
    });
  } catch (error: any) {
    // If database is unavailable, allow testing with mock auth
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.message.includes('Connection')) {
      console.warn('⚠️  Database unavailable, using mock authentication');
      const { email, first_name } = req.body;
      
      // Generate mock user ID based on email
      const mockId = Math.abs(email.split('').reduce((a: number, b: string) => a + b.charCodeAt(0), 0));
      const token = jwt.sign({ id: mockId, email }, JWT_SECRET, { expiresIn: '7d' });
      
      return res.status(201).json({
        user: {
          id: mockId,
          email,
          first_name: first_name || 'User',
          created_at: new Date(),
        },
        token,
        message: '✅ Registered (mock mode - database unavailable)',
      });
    }
    
    if (error.code === '23505') {
      // Unique constraint violation
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// POST login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
      },
      token,
    });
  } catch (error: any) {
    // If database is unavailable, allow testing with mock auth
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.message.includes('Connection')) {
      console.warn('⚠️  Database unavailable, using mock authentication');
      const { email } = req.body;
      
      // Generate mock user ID based on email
      const mockId = Math.abs(email.split('').reduce((a: number, b: string) => a + b.charCodeAt(0), 0));
      const token = jwt.sign({ id: mockId, email }, JWT_SECRET, { expiresIn: '7d' });
      
      return res.json({
        user: {
          id: mockId,
          email,
          first_name: 'Mock',
          last_name: 'User',
        },
        token,
        message: '✅ Logged in (mock mode - database unavailable)',
      });
    }
    
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// GET user profile (requires token)
router.get('/profile', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const result = await pool.query('SELECT id, email, first_name, last_name, preferences FROM users WHERE id = $1', [
      decoded.id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PUT update user preferences
router.put('/preferences', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { preferences } = req.body;

    const result = await pool.query('UPDATE users SET preferences = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *', [
      JSON.stringify(preferences),
      decoded.id,
    ]);

    // 🔥 TRIGGER: Start social media scraping in background
    // User submitted preferences → search Facebook/Instagram for matches
    if (preferences.city) {
      console.log(`🔥 Preferences saved for user ${decoded.id} - Triggering scraper`);
      
      triggerSocialMediaScraping(decoded.id, {
        city: preferences.city,
        budget: preferences.budget,
        bedrooms: preferences.bedrooms,
        features: preferences.features,
      }).catch(err => {
        console.error('Background scraper error:', err);
      });
    }

    res.json({
      ...result.rows[0],
      message: '✅ Preferences saved. Searching for matching properties on social media...',
    });
  } catch (error: any) {
    // If database is unavailable, allow testing with mock response
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.message.includes('Connection')) {
      console.warn('⚠️  Database unavailable, accepting preferences in mock mode');
      const token = req.headers.authorization?.split(' ')[1];
      
      if (!token) {
        return res.status(401).json({ error: 'Token required' });
      }
      
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const { preferences } = req.body;
      
      // Start scraper anyway (will use mock data)
      if (preferences.city) {
        console.log(`🔥 Mock: Preferences saved for user ${decoded.id} - Triggering scraper`);
        
        triggerSocialMediaScraping(decoded.id, {
          city: preferences.city,
          budget: preferences.budget,
          bedrooms: preferences.bedrooms,
          features: preferences.features,
        }).catch(err => {
          console.error('Background scraper error:', err);
        });
      }
      
      return res.json({
        id: decoded.id,
        preferences: preferences,
        message: '✅ Preferences saved (mock mode). Searching for matching properties...',
      });
    }
    
    console.error('Error updating preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// POST forgot password - issues a reset token
// NOTE: no email service is configured for this project, so the reset link is returned directly
// in the response for the frontend to display (clearly marked as demo-only). In production this
// token must be emailed to the user instead of being exposed via the API response.
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No account found with that email' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      'UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3',
      [tokenHash, expires, result.rows[0].id]
    );

    res.json({
      message: 'Demo mode: no email service is configured, so your reset token is returned here directly.',
      resetToken: rawToken,
      expiresAt: expires,
    });
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.message.includes('Connection')) {
      return res.status(503).json({ error: 'Database unavailable, try again shortly' });
    }
    console.error('Error requesting password reset:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// POST reset password using the token issued by /forgot-password
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await pool.query(
      'SELECT id FROM users WHERE password_reset_token = $1 AND password_reset_expires > NOW()',
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const password_hash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [password_hash, result.rows[0].id]
    );

    res.json({ message: '✅ Password reset successfully. You can now sign in.' });
  } catch (error: any) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// PUT update profile (name/email, optionally password with current-password verification)
router.put('/profile', async (req: Request, res: Response) => {
  try {
    const decoded = getAuthUser(req);
    if (!decoded) {
      return res.status(401).json({ error: 'Token required' });
    }

    const { first_name, last_name, email, current_password, new_password } = req.body;

    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userResult.rows[0];

    let password_hash = user.password_hash;
    if (new_password) {
      if (!current_password) {
        return res.status(400).json({ error: 'Current password required to set a new password' });
      }
      const validPassword = await bcrypt.compare(current_password, user.password_hash);
      if (!validPassword) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      if (new_password.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      }
      password_hash = await bcrypt.hash(new_password, 10);
    }

    const result = await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2, email = $3, password_hash = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING id, email, first_name, last_name, preferences`,
      [
        first_name ?? user.first_name,
        last_name ?? user.last_name,
        email ?? user.email,
        password_hash,
        decoded.id,
      ]
    );

    res.json({ user: result.rows[0], message: '✅ Profile updated' });
  } catch (error: any) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already in use' });
    }
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
