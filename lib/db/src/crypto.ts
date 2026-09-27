import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption at rest for credential columns.
 *
 * These columns hold other people's credentials — a client's Lemlist API key,
 * their Slack bot token, the shared secret for their webhook path. A dump of
 * the database, a stray backup file or a restored snapshot would otherwise hand
 * over live access to every client's Slack workspace and Lemlist account.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails to decrypt rather
 * than silently yielding altered plaintext.
 *
 * Stored format: `enc:v1:<base64(iv | authTag | ciphertext)>`
 *
 * The version tag lets a future key rotation or algorithm change coexist with
 * rows written by the current one, and the `enc:` prefix distinguishes an
 * encrypted value from a plaintext one written before this change — those are
 * passed through on read rather than failing, so enabling encryption does not
 * require a migration to be run first.
 */

const PREFIX = "enc:v1:";
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;
const KEY_BYTES = 32; // AES-256

const KEY_ENV = "CREDENTIAL_ENCRYPTION_KEY";

let cachedKey: Buffer | null | undefined;

/**
 * Resolves the key once. `null` means "not configured" — reads of plaintext
 * still work, writes fail loudly rather than quietly persisting a credential in
 * the clear, which would defeat the point while looking like it worked.
 */
function getKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;

  const raw = process.env[KEY_ENV]?.trim();
  if (!raw) {
    cachedKey = null;
    return cachedKey;
  }

  let key: Buffer;
  try {
    key = Buffer.from(raw, "hex");
  } catch {
    throw new Error(`${KEY_ENV} is not valid hex`);
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${KEY_ENV} must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex chars), got ${key.length}`,
    );
  }

  cachedKey = key;
  return cachedKey;
}

/** Test hook — clear the memoised key between cases. */
export function __resetKeyCache(): void {
  cachedKey = undefined;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) {
    throw new Error(
      `${KEY_ENV} is not configured — refusing to store a credential unencrypted. ` +
        `Generate one with: openssl rand -hex 32`,
    );
  }

  // Already encrypted: re-encrypting would double-wrap and the value would come
  // back out with the prefix still attached.
  if (isEncrypted(plaintext)) return plaintext;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSecret(stored: string): string {
  // Written before encryption was enabled. Passing it through keeps existing
  // rows working; they become encrypted the next time they are written.
  if (!isEncrypted(stored)) return stored;

  const key = getKey();
  if (!key) {
    throw new Error(
      `${KEY_ENV} is not configured but the database holds encrypted credentials. ` +
        `Restore the key — without it these values cannot be recovered.`,
    );
  }

  const payload = Buffer.from(stored.slice(PREFIX.length), "base64");
  // Exactly IV + tag is an encrypted empty string, which is a real value: the
  // client form stores "" for a credential left blank. Only shorter than that
  // is actually truncated.
  if (payload.length < IV_BYTES + TAG_BYTES) {
    throw new Error("Encrypted credential is truncated");
  }

  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key, or the ciphertext was altered. Deliberately vague: the caller
    // cannot tell which, and neither can an attacker probing with edited rows.
    throw new Error("Could not decrypt credential — wrong key or corrupted value");
  }
}
