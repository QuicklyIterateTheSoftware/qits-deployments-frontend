import { provideBrowserGlobalErrorListeners, type ApplicationConfig } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import {
  provideQitsBuilds,
  provideQitsNavigation,
  provideQitsProjects,
  provideQitsScope,
} from '@qits/ui-components';

import { routes } from './app.routes';

/**
 * Seven providers, in the order every sibling repeats.
 *
 * - `provideBrowserGlobalErrorListeners` funnels genuinely-global errors and unhandled rejections
 *   into Angular's `ErrorHandler`.
 * - `provideRouter` carries the page's expansion in its query parameters, which is what makes one
 *   project's deployments bookmarkable.
 * - `withFetch` is not a preference. The default XHR backend is invisible to OTLP fetch
 *   instrumentation, so choosing it would quietly forfeit client spans the moment this deployment
 *   grows a telemetry relay. This app's own reads (`/deployments/api/…`) are same-origin paths and
 *   carry no credential; a read of another application's API goes to that application's own origin
 *   from the navigation below, with the session.
 * - `provideQitsNavigation` gives `QitsMainLayout` its left navigation, by asking the edge for
 *   `/main-navigation` once at startup. The list is the edge's answer now — derived from the
 *   deployments it actually serves — not a list compiled into @qits/ui-components; without this
 *   provider the chrome renders no links at all. It needs the `provideHttpClient` above.
 * - `provideQitsProjects` fills the chrome's project picker from one `GET /projects/api/projects` on
 *   qits-projects' own origin, which the library reads from the navigation, and installs the
 *   repositories of whatever project is in scope alongside it.
 * - `provideQitsScope('project')` says how deep this application's own addresses go. This page is
 *   one table of every environment's deployments, which a project expands rather than divides, so
 *   the deepest address it serves is `/<projectSlug>/`. The scope seeds the page's expansion: a
 *   reader who arrives inside a project finds that project already open.
 * - `provideQitsBuilds` puts the pending-builds bolt beside the picker: a popover of what qits-ci is
 *   building right now, from `GET /ci/api/runs/active` on qits-ci's own origin, which the library
 *   reads from the navigation — the edge routes `/ci` on qits-ci's host only — so it needs the
 *   `provideHttpClient` above and this app composes no hostname. Providing it is what puts the bolt
 *   there, exactly as no project source means no picker. Closed, it asks nothing at all; it polls
 *   only while a reader keeps the panel open.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideQitsNavigation(),
    provideQitsProjects(),
    provideQitsScope('project'),
    provideQitsBuilds(),
  ],
};
