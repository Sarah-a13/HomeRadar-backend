import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { getAuthUser } from '../auth';

const SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-in-production';

const reqWith = (authorization?: string): Request =>
  ({ headers: authorization ? { authorization } : {} } as Request);

describe('getAuthUser', () => {
  it('returns the decoded payload for a valid Bearer token', () => {
    const token = jwt.sign({ id: 'u1', email: 'a@b.dk' }, SECRET);
    const user = getAuthUser(reqWith(`Bearer ${token}`));
    expect(user).toMatchObject({ id: 'u1', email: 'a@b.dk' });
  });

  it('returns null when no Authorization header is present', () => {
    expect(getAuthUser(reqWith())).toBeNull();
  });

  it('returns null when the token is invalid', () => {
    expect(getAuthUser(reqWith('Bearer not-a-real-token'))).toBeNull();
  });

  it('returns null when the token is signed with the wrong secret', () => {
    const token = jwt.sign({ id: 'u1', email: 'a@b.dk' }, 'some-other-secret');
    expect(getAuthUser(reqWith(`Bearer ${token}`))).toBeNull();
  });
});
