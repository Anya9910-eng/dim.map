import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret, isEncrypted, __resetKeyCache } from "@workspace/db/crypto";

const KEY = "a".repeat(64); // 32 bytes hex
const OTHER_KEY = "b".repeat(64);

function withKey(key: string | undefined): void {
  if (key === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  else process.env.CREDENTIAL_ENCRYPTION_KEY = key;
  __resetKeyCache();
}

describe("credential encryption", () => {
  const original = process.env.CREDENTIAL_ENCRYPTION_KEY;

  beforeEach(() => withKey(KEY));
  afterEach(() => withKey(original));

  it("round-trips a value", () => {
    const secret = "xoxb-1234567890-abcdefghijklmnop";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("produces different ciphertext for the same input", () => {
    // A fresh IV each time; identical keys across clients must not be
    // detectable by comparing stored rows.
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("does not leave the plaintext visible in the stored form", () => {
    const stored = encryptSecret("xoxb-super-secret-token");
    expect(stored).not.toContain("xoxb");
    expect(stored).not.toContain("super-secret");
    expect(isEncrypted(stored)).toBe(true);
  });

  it("passes through plaintext written before encryption was enabled", () => {
    // Rows that predate this change must keep working rather than throwing.
    expect(decryptSecret("xoxb-legacy-plaintext")).toBe("xoxb-legacy-plaintext");
  });

  it("does not double-encrypt an already encrypted value", () => {
    const once = encryptSecret("value");
    expect(encryptSecret(once)).toBe(once);
    expect(decryptSecret(encryptSecret(once))).toBe("value");
  });

  it("rejects a value encrypted under a different key", () => {
    const stored = encryptSecret("value");
    withKey(OTHER_KEY);
    expect(() => decryptSecret(stored)).toThrow(/wrong key or corrupted/i);
  });

  it("rejects a tampered ciphertext rather than returning altered plaintext", () => {
    const stored = encryptSecret("original-value");
    const raw = Buffer.from(stored.slice("enc:v1:".length), "base64");
    raw[raw.length - 1] ^= 0xff; // flip bits in the ciphertext
    const tampered = "enc:v1:" + raw.toString("base64");
    expect(() => decryptSecret(tampered)).toThrow(/wrong key or corrupted/i);
  });

  it("round-trips an empty value", () => {
    // The client form saves "" for a credential left blank. That encrypts to
    // exactly IV + tag with no ciphertext, which must not read as truncated —
    // treating it as corrupt made every client with a blank field unreadable.
    const stored = encryptSecret("");
    expect(isEncrypted(stored)).toBe(true);
    expect(decryptSecret(stored)).toBe("");
  });

  it("rejects a truncated payload", () => {
    expect(() => decryptSecret("enc:v1:" + Buffer.from("short").toString("base64"))).toThrow(
      /truncated/i,
    );
  });

  it("refuses to encrypt when no key is configured", () => {
    // Storing the credential in the clear would look like success while
    // defeating the entire point.
    withKey(undefined);
    expect(() => encryptSecret("value")).toThrow(/not configured/i);
  });

  it("explains the loss when encrypted data is read without a key", () => {
    const stored = encryptSecret("value");
    withKey(undefined);
    expect(() => decryptSecret(stored)).toThrow(/Restore the key/i);
  });

  it("rejects a key of the wrong length", () => {
    withKey("abcd");
    expect(() => encryptSecret("value")).toThrow(/must be 32 bytes/i);
  });

  it("handles unicode and long values", () => {
    const secret = "ключ-🔑-" + "x".repeat(5000);
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });
});
