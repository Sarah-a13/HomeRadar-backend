import rateLimit from 'express-rate-limit';

// Generic brute-force guard for auth endpoints (login, register, password reset).
// Keyed by IP; limits are intentionally generous enough not to block normal retries
// after a typo, but block automated credential-stuffing / enumeration attempts.
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});
