/**
 * Origin-relative prefix for the JSON API.
 *
 * The dashboard is served under `/app`, so `import.meta.env.BASE_URL` is
 * `/app/`. The API is not under it — it sits at `/api` on the same origin.
 * Building a URL as `${BASE_URL}/api/...` therefore asks for `/app/api/...`,
 * which the SPA fallback answers with `index.html` and a 200. A `fetch` there
 * looks entirely successful: `res.ok` is true, and only parsing the body
 * reveals it was a web page. Requests that only sent data — inviting a client
 * user, saving a setting — reported success and changed nothing.
 *
 * Everything that talks to the API should build URLs from this.
 */
export const API_BASE = import.meta.env.BASE_URL.replace(/\/app\/?$/, "").replace(/\/$/, "");

/** Joins a path onto the API base: `api("/clients/1")` → `/api/clients/1`. */
export function api(path: string): string {
  return `${API_BASE}/api${path.startsWith("/") ? path : `/${path}`}`;
}
