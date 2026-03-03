import * as db from '../db';

export async function createMagicLink(email: string): Promise<string> {
  const token = await db.createMagicLink(email.toLowerCase());
  console.log(`[MagicLink] Created magic link for ${email}`);
  return token;
}

export async function verifyMagicLink(token: string): Promise<string | null> {
  const email = await db.verifyMagicLink(token);
  if (!email) {
    console.log('[MagicLink] Invalid or expired token');
    return null;
  }
  console.log(`[MagicLink] Verified magic link for ${email}`);
  return email;
}

export async function cleanupExpiredLinks(): Promise<void> {
  // Handled automatically by the DB via expires_at checks
}
