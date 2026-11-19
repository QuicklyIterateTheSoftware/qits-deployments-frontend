import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectLandingRedirect } from '../nav/landing-redirect';

/**
 * Where `deployment-requests/by-release/:repoId/:version` and its scoped form go now that the
 * address a link from a release lands on is resolved by the landing app too, at
 * `/projects/<slug>/deployments/requests/by-release/<repoId>/<version>` — the third screen in this
 * folder to move there, modelled on {@link DeploymentRequestsRedirect} (qits-2315) and
 * {@link DeploymentRequestRedirect} (qits-2322), and reading its parameters the same two ways
 * (qits-2323).
 *
 * **This used to be `DeploymentRequestResolver`**, which made a query of its own: the id a
 * `deployment-requests/:requestId` page needs is minted on this service after the release, so
 * turning `(repoId, version)` into one took a request nobody else could make. That resolving — and
 * the "a library or an SPA releases nothing" sentence it answered with when nothing matched — now
 * happens on the far side of this redirect, in the landing app's own screen. So this component is a
 * plain address translation like its two siblings, with no query of its own and nothing to wait on
 * but the landing app's origin.
 *
 * **Both segments come off this screen's own route — they name the release, not a scope — and
 * `:project` off the route one level up**, the same split {@link DeploymentRequestRedirect} makes
 * for `:requestId`.
 *
 * **Unscoped has no destination of its own**, for the identical reason the other two have none: a
 * release is always read by project, so there is nothing to send an unscoped reader to beyond the
 * landing app's own project picker, `/projects`.
 *
 * **The waiting, the fallback origin and the full-document navigation are
 * {@link injectLandingRedirect}'s job**, shared with this folder's other two redirects — this
 * component's only business is the one relative path.
 */
@Component({
  selector: 'app-deployment-request-by-release-redirect',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p>
      The deployment request moved to the landing app:
      @if (link(); as href) {
        <a [href]="href">{{ href }}</a>
      } @else {
        <span>resolving the landing app's address…</span>
      }
    </p>
  `,
})
export class DeploymentRequestByReleaseRedirect {
  private readonly route = inject(ActivatedRoute);

  /** This screen's own route parameters — the release, not a scope. */
  private readonly repoId = this.route.snapshot.paramMap.get('repoId') ?? '';
  private readonly version = this.route.snapshot.paramMap.get('version') ?? '';

  /** The `:project` segment one level up, or `undefined` at this app's own unscoped route. */
  private readonly project = this.route.snapshot.parent?.paramMap.get('project') ?? undefined;

  /**
   * The landing app's by-release address, once an origin for it is known — `undefined` until then.
   * Scoped, it is the same `(repoId, version)` pair the old resolver read, now resolved over there;
   * unscoped, there is no such page, so this falls back to the project picker rather than a path
   * the landing app does not serve.
   */
  protected readonly link = injectLandingRedirect(() =>
    this.project && this.repoId && this.version
      ? `/projects/${encodeURIComponent(this.project)}/deployments/requests/by-release/${encodeURIComponent(this.repoId)}/${encodeURIComponent(this.version)}`
      : '/projects',
  );
}
