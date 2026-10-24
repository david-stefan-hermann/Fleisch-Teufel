/**
 * Sets a new password for an account and ends all its sessions (the person forgot the password; there
 * is no e-mail flow on a private server). Runs against the database directly, so it needs DATABASE_URL
 * (in production: inside the container, `docker exec -it fleisch-teufel node dist/reset-password.js`,
 * or through pnpm in a checkout with the production URL).
 *
 *   pnpm --filter @ft/api user:reset-password <email> [new password]
 *
 * Without a password a random one is generated and printed once.
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../src/auth/session.js';
import { createDb } from '../src/db/client.js';
import { sessions, users } from '../src/db/schema.js';
import { loadEnv } from '../src/env.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('usage: user:reset-password <email> [new password]');
  process.exit(2);
}
const password = process.argv[3] ?? randomBytes(9).toString('base64url');
if (password.length < 8) {
  console.error('the password needs at least 8 characters');
  process.exit(2);
}

const env = loadEnv();
const db = createDb(env.DATABASE_URL, { max: 1 });
try {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!user) {
    console.error(`no account with e-mail ${email}`);
    process.exit(1);
  }
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, user.id));
    await tx.delete(sessions).where(eq(sessions.userId, user.id));
  });
  console.log(`password of ${email} set; all devices have to log in again.`);
  if (!process.argv[3]) console.log(`new password: ${password}`);
} finally {
  await db.$client.end({ timeout: 2 });
}
