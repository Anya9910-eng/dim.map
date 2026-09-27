/**
 * Environment every test file can assume.
 *
 * `src/app.ts` throws at import time without SESSION_SECRET, so any test that
 * imports the real app — the apiGate and route wiring suites — died on load
 * rather than running. Setting it here fixes that centrally instead of in each
 * file, and the value is also what `loginCodes` keys its HMAC with.
 */
process.env["SESSION_SECRET"] ??= "test-session-secret-not-used-in-production";
