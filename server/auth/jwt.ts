import jwt from 'jsonwebtoken';
import { ENV } from '../_core/env';

export interface JWTPayload {
  userId: number;
  email: string;
}

export function createToken(payload: JWTPayload): string {
  return jwt.sign(payload, ENV.jwtSecret, { expiresIn: '30d' });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, ENV.jwtSecret) as JWTPayload;
  } catch {
    return null;
  }
}
