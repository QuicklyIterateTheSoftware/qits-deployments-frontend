import { InjectionToken } from '@angular/core';

/**
 * The origin this app's own reads are built on, and it is empty on purpose.
 *
 * The SPA is served at `/deployments/` by qits-deployments itself, so a same-origin relative path
 * is not a shortcut for `/deployments/api/…` — it is the whole reason the browser's session cookie
 * reaches that service with no machine token and no CORS pre-flight. A configured base URL would
 * move these calls cross-origin and lose exactly that. A call to another application's API is a
 * different matter: the edge routes an application's paths on that application's own host only, so
 * those go through `QitsAppLinks.whenApiUrl` instead, to whatever origin the navigation names.
 *
 * It is a token rather than a constant for one reason: a spec needs a seam to assert the path
 * against, and `ng serve` (no gateway in front) may want the dev proxy's prefix. That is the same
 * shape spa-home's `LEAVE_APP` uses — the platform's one DI-token precedent — and it adds no
 * behaviour, only a handle.
 *
 * Duplicated from qits-spa-ci rather than shared, per the explorer plan's Decision 2: the
 * alternative is a transport dependency inside a *components* library that six other SPAs consume
 * without making a single request.
 */
export const QITS_API_BASE = new InjectionToken<string>('qits.api-base', {
  providedIn: 'root',
  factory: () => '',
});
