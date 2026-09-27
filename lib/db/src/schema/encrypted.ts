import { customType } from "drizzle-orm/pg-core";
import { decryptSecret, encryptSecret } from "../crypto";

/**
 * A `text` column whose value is encrypted on the way to the database and
 * decrypted on the way back.
 *
 * Doing this in the column type rather than at each call site is deliberate:
 * client credentials are read in eighteen places across eight files, and a
 * single missed one would either leak a secret or hand an API an unusable
 * ciphertext. Here, every read and write goes through the same pair by
 * construction, and callers keep seeing an ordinary `string | null`.
 *
 * `fromDriver` failures deliberately propagate. A row that cannot be decrypted
 * means the key is wrong or the value was tampered with — continuing with a
 * silently dropped credential would turn that into a confusing downstream error
 * far from the cause.
 */
export const encryptedText = customType<{ data: string; driverData: string }>({
  dataType() {
    return "text";
  },
  toDriver(value: string): string {
    return encryptSecret(value);
  },
  fromDriver(value: string): string {
    return decryptSecret(value);
  },
});
