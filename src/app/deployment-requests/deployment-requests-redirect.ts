import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectLandingRedirect } from '../nav/landing-redirect';

/**
 * Where `deployment-requests` and `:project/deployment-requests` go now that the list lives in the
 * landing app, at `/projects/<slug>/deployments/requests` — the same two sections, read the same way.
 *
 * **The project comes from the route, not from `QITS_SCOPE`.** Every other page in this application
 * reads the address through that token instead, because it waits on the project list to turn a slug
 * into an id this app's own API calls need. This page makes no such call — it is leaving the moment
 * it can — so it reads the `:project` segment straight off the route table, present only under the
 * scoped children in `app.routes.ts`.
 *
 * **Unscoped has no destination of its own.** The old `/deployment-requests` answered outside a
 * project by saying so in a sentence; the landing app's screen has no such unscoped form; a release
 * is always read by project. So the unscoped address lands on the landing app's own project picker,
 * `/projects`, rather than a page that does not exist there.
 *
 * **The waiting, the fallback origin and the full-document navigation are
 * {@link injectLandingRedirect}'s job**, shared with this folder's other two redirects — this
 * component's only business is the one relative path.
 *
 * No query parameters are carried: the old list page read none of its own (qits-2315).
 */
@Component({
  selector: 'app-deployment-requests-redirect',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p>
      The deployment requests moved to the landing app:
      @if (link(); as href) {
        <a [href]="href">{{ href }}</a>
      } @else {
        <span>resolving the landing app's address…</span>
      }
    </p>
  `,
})
export class DeploymentRequestsRedirect {
  private readonly route = inject(ActivatedRoute);

  /** The `:project` segment one level up, or `undefined` at this app's own unscoped route. */
  private readonly project = this.route.snapshot.parent?.paramMap.get('project') ?? undefined;

  /**
   * The landing app's requests screen, once an origin for it is known — `undefined` until then.
   * Scoped, it is the project's own listing; unscoped, there is no such listing over there, so this
   * falls back to the project picker rather than a path the landing app does not serve.
   */
  protected readonly link = injectLandingRedirect(() =>
    this.project
      ? `/projects/${encodeURIComponent(this.project)}/deployments/requests`
      : '/projects',
  );
}
