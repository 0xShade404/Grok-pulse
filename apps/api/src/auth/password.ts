/**
 * Password hashing, isolated behind this one file (CLAUDE.md section 24's
 * `users.passwordHash` doc comment: "a salted hash (argon2id)").
 *
 * LIBRARY CHOICE: `argon2` (the `node-argon2` bindings), not `bcryptjs`.
 * `argon2` requires native compilation (node-gyp / prebuilt binary) --
 * this task's instructions call for trying it first and falling back to
 * `bcryptjs` only if it fails to install/build cleanly. It was verified in
 * this sandbox: `pnpm add argon2 --filter @grokpulse/api` resolved a
 * prebuilt binary via `node-gyp-build` with no compilation step, and a
 * smoke-tested hash/verify round-trip succeeded. Argon2id (this library's
 * default mode) is the current OWASP-recommended password-hashing
 * algorithm, with better GPU/ASIC-cracking resistance than bcrypt -- so
 * given it installs cleanly here, it is the better default and there is no
 * reason to fall back.
 *
 * Every other file in this app that needs to check a password imports
 * `hashPassword`/`verifyPassword` from here -- never `argon2` directly --
 * so a future switch to a different library/algorithm (e.g. if a
 * production deployment target can't build native modules) only touches
 * this one file.
 */
import argon2 from "argon2";

/** Hash a plaintext password for storage in `users.passwordHash`. Never log
 * or persist the plaintext `plain` argument anywhere else. */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain);
}

/**
 * Verify a plaintext password against a stored hash. Constant-time
 * comparison is handled internally by `argon2.verify` -- never hand-roll
 * this comparison. Returns `false` (never throws) for a malformed/corrupt
 * stored hash, a wrong password, or any other verification failure -- the
 * caller (login route) must fail closed identically in every case so a
 * corrupt-hash edge case can never be mistaken for "authenticated".
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
