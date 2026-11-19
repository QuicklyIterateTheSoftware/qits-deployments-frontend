import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { injectLandingRedirect } from '../nav/landing-redirect';

/**
 * Where `deployment-requests/:requestId` and `:project/deployment-requests/:requestId` go now that
 * the detail page lives in the landing app, at `/projects/<slug>/deployments/requests/<id>` —
 * modelled exactly on {@link DeploymentRequestsRedirect}, the list's own redirect (qits-2315), and
 * reading its two route parameters the same two ways.
 *
 * **`:requestId` comes off this screen's own route — it is the resource, not a scope — and
 * `:project` off the route one level up, the same way the list redirect reads it.** Every other
 * page in this application reads the project through `QITS_SCOPE` instead, because that token
 * waits on the project list this page makes no call toward; it is leaving the moment it can.
 *
 * **Unscoped has no destination of its own**, for the identical reason the list has none: the old
 * `/deployment-requests/:requestId` answered outside a project because the request's own row named
 * one; the landing app's screen is reached by project and id together, so there is nothing to send
 * an unscoped reader to beyond the landing app's own project picker, `/projects`.
 *
 * **The waiting, the fallback origin and the full-document navigation are
 * {@link injectLandingRedirect}'s job**, shared with this folder's other two redirects — this
 * component's only business is the one relative path.
 *
 * No query parameters are carried: the old detail page read none of its own.
 */
@Component({
  selector: 'app-deployment-request-redirect',
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
export class DeploymentRequestRedirect {
  private readonly route = inject(ActivatedRoute);

  /** This screen's own route parameter — the resource, not a scope. */
  private readonly requestId = this.route.snapshot.paramMap.get('requestId') ?? '';

  /** The `:project` segment one level up, or `undefined` at this app's own unscoped route. */
  private readonly project = this.route.snapshot.parent?.paramMap.get('project') ?? undefined;

  /**
   * The landing app's request screen, once an origin for it is known — `undefined` until then.
   * Scoped, it is this request's own detail page over there; unscoped, there is no such page, so
   * this falls back to the project picker rather than a path the landing app does not serve.
   */
  protected readonly link = injectLandingRedirect(() =>
    this.project && this.requestId
      ? `/projects/${encodeURIComponent(this.project)}/deployments/requests/${encodeURIComponent(this.requestId)}`
      : '/projects',
  );
}
