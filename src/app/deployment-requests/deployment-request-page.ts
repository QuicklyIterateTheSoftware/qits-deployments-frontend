import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, convertToParamMap } from '@angular/router';
import { QitsBadge, QitsButton, type QitsBadgeTone } from '@qits/ui-components';
import { CdApi } from '../api/cd-api';
import {
  isCompletedRequest,
  isDeclined,
  isHeldForApproval,
  isPendingGate,
  isRefused,
  type CdDeploymentDto,
  type CdDeploymentRequestDetailResponse,
  type CdDeploymentRequestDto,
  type CdEnvironmentDto,
  type ProjectsReleaseRequestDto,
} from '../api/dto';
import { ProjectsApi } from '../api/projects-api';
import { injectScopedProject } from '../nav/scoped-project';
import { Async } from '../ui/async';
import { NONE, formatInstant, shortSha } from '../ui/format';
import { LOADING, describeError, failed, ready, type Loadable } from '../ui/loadable';
import { StatusBadge } from '../ui/status-badge';
import { LifecycleFlow, type LifecycleStage } from './lifecycle-flow';
import { CD_REQUEST_POLL_MS } from './poll-interval';

/** The word a status is drawn with on a stopped tile, where the badge has no room. */
const STOPPED_WORDS: Readonly<Record<string, string>> = {
  IMAGE_MISSING: 'no image was published',
  DECLARATION_REFUSED: 'its configuration declaration was refused',
  FAILED: 'the deployment failed',
  ROLLED_BACK: 'rolled back to the predecessor',
  GONE: 'the container went away',
  SCALED_TO_ZERO: 'stopped on purpose',
  SUPERSEDED: 'a newer deployment took its place',
  DECOMMISSIONED: 'replaced by a newer deployment',
};

/**
 * One deployment request, end to end: what was asked for, what the gate said, what ran, and whether
 * the change it carried ever landed on main.
 *
 * **The route parameter is read here, and it is the only one this application reads.** Every other
 * page asks `QITS_SCOPE` instead, because a project slug in the address is a scope rather than an
 * argument. A request id is neither — it is the resource this page is about, so it comes off the
 * route like the resource id it is.
 *
 * **The flow is built here and drawn by {@link LifecycleFlow}.** That split is the point of the
 * other component existing: whether a version is *running* is a question about the newest ACTIVE
 * deployment of an (application, tier) pair, which needs the tier's deployment listing; whether it
 * *landed* is a question only qits-projects can answer. A presentational component that decided
 * either would need this page's whole state handed down to re-derive it.
 *
 * **Four reads, and only one of them can fail the page.** The request itself is the page. The
 * tier's deployments decide the middle tile, the environment list names the tier, and
 * qits-projects' release requests decide the last one — and each of those three degrades to a tile
 * that says what it does not know, because a version that deployed an hour ago is still a true and
 * useful screen when qits-projects is down.
 *
 * The poll is the requests page's: a `setTimeout` armed after each answer, at {@link
 * CD_REQUEST_POLL_MS}, while a stage is still pending and nothing has stopped — a release that
 * landed, and one that failed, are both finished, and neither is worth re-reading forever.
 */
@Component({
  selector: 'app-deployment-request-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, LifecycleFlow, QitsBadge, QitsButton, RouterLink, StatusBadge],
  templateUrl: './deployment-request-page.html',
  styleUrl: './deployment-request-page.css',
})
export class DeploymentRequestPage {
  protected readonly scoped = injectScopedProject();

  private readonly route = inject(ActivatedRoute);
  private readonly cdApi = inject(CdApi);
  private readonly projectsApi = inject(ProjectsApi);
  private readonly document = inject(DOCUMENT);
  private readonly pollMs = inject(CD_REQUEST_POLL_MS);

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: convertToParamMap({}),
  });

  /** The request and the deployment it produced — the one read this page cannot be drawn without. */
  protected readonly detail = signal<Loadable<CdDeploymentRequestDetailResponse>>(LOADING);

  /** The tier's deployments, which is how "is this version running there" is answered. */
  private readonly deployments = signal<readonly CdDeploymentDto[]>([]);

  /** Every tier, for one thing: the name of the one this request names by id. */
  private readonly environments = signal<readonly CdEnvironmentDto[]>([]);

  /** The repository's released requests, for one field: whether this version reached main. */
  private readonly releaseRequests = signal<readonly ProjectsReleaseRequestDto[] | null>(null);

  /** Why the merge tile cannot say anything, or `''`. It is a tile's meta line, never a banner. */
  private readonly mergeProblem = signal('');

  /** A poll that failed, said beside the page rather than instead of it. */
  protected readonly pollProblem = signal('');

  /** Whether an approve call is in flight — one of the two writes this page makes. */
  protected readonly approving = signal(false);

  /** Why an approve call was refused, said beside the button rather than instead of the page. */
  protected readonly approveProblem = signal('');

  /** Whether a decline call is in flight — the other write this page makes. */
  protected readonly declining = signal(false);

  /** Why a decline call was refused, said beside the button rather than instead of the page. */
  protected readonly declineProblem = signal('');

  /** The optional note typed beside the Decline button, read by {@link decline} and nothing else. */
  protected readonly declineNote = signal('');

  protected readonly formatInstant = formatInstant;
  protected readonly shortSha = shortSha;
  protected readonly none = NONE;

  private pollHandle: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private loadedId: string | null = null;

  protected readonly requestId = computed(() => this.params().get('requestId') ?? '');

  protected readonly request = computed<CdDeploymentRequestDto | null>(() => {
    const state = this.detail();
    return state.kind === 'ready' ? state.value.deploymentRequest : null;
  });

  protected readonly deployment = computed<CdDeploymentDto | null>(() => {
    const state = this.detail();
    return state.kind === 'ready' ? state.value.deployment : null;
  });

  /** `2026.903.113443 · qits-ci`, or `''` while nothing has answered. */
  protected readonly subtitle = computed(() => {
    const request = this.request();
    return request ? `${request.version} · ${request.applicationName}` : '';
  });

  /**
   * The tiles, in order: released → running in each tier → merged to main.
   *
   * **There is one tier tile today and the shape is a list anyway**, because that is what the model
   * says: a release enters at the designated tier and a promotion ladder is the follow-up this
   * schema was written for. Drawing it as one hard-coded middle step would be a screen that has to
   * be rebuilt rather than extended the day a second tier appears.
   */
  protected readonly stages = computed<readonly LifecycleStage[]>(() => {
    const request = this.request();
    if (!request) {
      return [];
    }
    return [this.releasedStage(request), this.tierStage(request), this.mergedStage(request)];
  });

  /** Whether anything is still expected to happen — the only reason this page ever polls. */
  private readonly moving = computed(() => {
    const stages = this.stages();
    return (
      stages.some((stage) => stage.state === 'pending') &&
      !stages.some((stage) => stage.state === 'stopped')
    );
  });

  protected readonly following = computed(() => (this.moving() ? 'following this release' : ''));

  constructor() {
    effect(() => {
      const id = this.requestId();
      if (!id || this.loadedId === id) {
        return;
      }
      this.loadedId = id;
      void this.load(id);
    });

    effect(() => {
      this.moving();
      this.syncPolling();
    });

    const onVisibilityChange = () => this.onVisibilityChange();
    this.document.addEventListener('visibilitychange', onVisibilityChange);
    inject(DestroyRef).onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisibilityChange);
      this.stopPolling();
    });
  }

  protected async reload(): Promise<void> {
    await this.load(this.requestId());
  }

  /**
   * Settle the hold by hand: the one write this page makes.
   *
   * The answer is the same `{deploymentRequest, deployment}` envelope the single read gives, so the
   * page's state is set straight from it rather than issuing a second read to see what the approve
   * just did — and the context reads (the tier's deployments, the merge) follow it exactly as they
   * follow a poll's answer, because the deployment this unblocks is new information for both.
   *
   * A refusal here is not this page's error: 409 is a request no longer held (not held at all,
   * already settled, or no longer the newest release for its application), 404 an id nothing
   * matches, 502 a declaration qits-configuration could not read. Each is named beside the button
   * rather than replacing the page.
   */
  protected async approve(): Promise<void> {
    const id = this.requestId();
    if (!id || this.approving()) {
      return;
    }
    this.approving.set(true);
    this.approveProblem.set('');
    try {
      const answer = await this.cdApi.approve(id);
      this.detail.set(ready(answer));
      await this.loadContext(answer.deploymentRequest);
    } catch (error) {
      this.approveProblem.set(describeError(error));
    } finally {
      this.approving.set(false);
    }
  }

  /**
   * The other answer to a hold (qits-2271), and the one that is final: nothing un-declines it, and
   * the way to ship the work again is a new branch off the release's tag and a new release request.
   *
   * Otherwise the twin of {@link approve} in every way that matters here — the same envelope sets
   * this page's state straight from the answer, the same context reads follow it, and a refusal is
   * named beside the button rather than replacing the page. The one difference is the optional note,
   * read off {@link declineNote} and cleared on success so a stale note cannot be re-sent against a
   * different request.
   */
  protected async decline(): Promise<void> {
    const id = this.requestId();
    if (!id || this.declining()) {
      return;
    }
    this.declining.set(true);
    this.declineProblem.set('');
    try {
      const answer = await this.cdApi.decline(id, this.declineNote());
      this.detail.set(ready(answer));
      this.declineNote.set('');
      await this.loadContext(answer.deploymentRequest);
    } catch (error) {
      this.declineProblem.set(describeError(error));
    } finally {
      this.declining.set(false);
    }
  }

  /** The note input's `(input)` handler — plain DOM event, no reactive forms for one field. */
  protected onDeclineNoteInput(event: Event): void {
    this.declineNote.set((event.target as HTMLInputElement).value);
  }

  /**
   * The request first, then everything the request tells us to ask for.
   *
   * In that order and not in parallel, because three of the four reads take arguments off the
   * first: the tier is `environmentId`, the merge is `repoId`, and neither is knowable before the
   * request answers.
   */
  private async load(id: string): Promise<void> {
    this.detail.set(LOADING);
    this.pollProblem.set('');
    let answer: CdDeploymentRequestDetailResponse;
    try {
      answer = await this.cdApi.deploymentRequest(id);
    } catch (error) {
      this.detail.set(failed(error));
      return;
    }
    this.detail.set(ready(answer));
    await Promise.all([this.loadEnvironments(), this.loadContext(answer.deploymentRequest)]);
  }

  /**
   * The two reads a tile depends on, side by side and neither able to fail the page.
   *
   * A tier's deployments and a repository's release requests each decide one tile, so losing either
   * costs that tile its verdict and nothing else — which is what the honest meta lines below are
   * for.
   */
  private async loadContext(request: CdDeploymentRequestDto): Promise<void> {
    await Promise.all([this.loadDeployments(request), this.loadReleaseRequests(request)]);
  }

  private async loadDeployments(request: CdDeploymentRequestDto): Promise<void> {
    if (!request.environmentId) {
      this.deployments.set([]);
      return;
    }
    try {
      this.deployments.set(await this.cdApi.deployments(request.environmentId));
    } catch {
      // The tile says "could not be read" rather than the page saying nothing at all.
      this.deployments.set([]);
    }
  }

  private async loadEnvironments(): Promise<void> {
    try {
      this.environments.set(await this.cdApi.environments());
    } catch {
      // The tier keeps its id as its name, which is worse to read and still true.
      this.environments.set([]);
    }
  }

  private async loadReleaseRequests(request: CdDeploymentRequestDto): Promise<void> {
    if (!request.repoId) {
      this.releaseRequests.set(null);
      this.mergeProblem.set('this release named no repository');
      return;
    }
    try {
      this.releaseRequests.set(await this.projectsApi.releaseRequests(request.repoId));
      this.mergeProblem.set('');
    } catch (error) {
      this.releaseRequests.set(null);
      this.mergeProblem.set(`qits-projects did not answer — ${describeError(error)}`);
    }
  }

  /**
   * One poll: the request, the tier's rows and the merge. Not the environment list — what tiers
   * exist does not change while a container starts.
   */
  private async poll(): Promise<void> {
    const id = this.requestId();
    if (this.polling || !id) {
      return;
    }
    this.polling = true;
    try {
      const answer = await this.cdApi.deploymentRequest(id);
      this.detail.set(ready(answer));
      await this.loadContext(answer.deploymentRequest);
      this.pollProblem.set('');
    } catch (error) {
      this.pollProblem.set(describeError(error));
    } finally {
      this.polling = false;
      this.syncPolling();
    }
  }

  private shouldPoll(): boolean {
    return this.moving() && !this.document.hidden;
  }

  private syncPolling(): void {
    if (!this.shouldPoll()) {
      this.stopPolling();
      return;
    }
    this.pollHandle ??= setTimeout(() => {
      this.pollHandle = null;
      void this.poll();
    }, this.pollMs);
  }

  private stopPolling(): void {
    if (this.pollHandle !== null) {
      clearTimeout(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private onVisibilityChange(): void {
    if (this.shouldPoll()) {
      void this.poll();
    }
    this.syncPolling();
  }

  /** Back to the listing, in whatever project scope the reader arrived in. */
  protected listLink(): readonly string[] {
    return [...this.scoped.commands(), 'deployment-requests'];
  }

  // --- the three stages -------------------------------------------------------------------------

  /**
   * Always reached, and that is not a placeholder.
   *
   * A deployment request exists because a release was cut: qits-ci minted the version, pushed the
   * tag and published the image before anything here was written. The tile states the coordinate
   * everything after it is about.
   */
  private releasedStage(request: CdDeploymentRequestDto): LifecycleStage {
    return {
      id: 'released',
      title: `Released ${request.version}`,
      meta: formatInstant(request.createdAt),
      state: 'reached',
    };
  }

  /**
   * Whether this version is what the tier is actually running.
   *
   * **The verdict is the tier's newest ACTIVE row and not this request's own deployment**, and the
   * difference is the whole value of the tile: a request whose deployment says `ACTIVE` may have
   * been decommissioned by a newer one an hour later, and a reader asking "is my version live"
   * would be told yes. So the question is asked of the place.
   */
  private tierStage(request: CdDeploymentRequestDto): LifecycleStage {
    const tier = this.environments().find(
      (environment) => environment.id === request.environmentId,
    );
    const name = tier?.name ?? request.environmentId ?? '';
    const id = 'tier';
    if (!request.environmentId) {
      // A row that recorded no environment, and a real answer rather than a gap: nothing says
      // where this was asked for, so nothing can say whether it is running.
      return { id, title: 'Running', meta: 'no environment recorded', state: 'pending' };
    }
    const title = `Running in ${name}`;
    const serving = this.newestActive(request.applicationName);
    if (serving && serving.version === request.version) {
      return { id, title, meta: `since ${formatInstant(serving.createdAt)}`, state: 'reached' };
    }
    if (isCompletedRequest(request)) {
      return {
        id,
        title,
        meta: serving?.version
          ? `${name} is running ${serving.version}`
          : `nothing is serving ${name}`,
        state: 'stopped',
        detail: this.stoppedWord(request),
      };
    }
    return { id, title, meta: this.movingWord(request), state: 'pending' };
  }

  /**
   * Whether the change this version carried ever reached main.
   *
   * It is the one step in the flow qits-deployments cannot see at all — a merge happens in the git
   * host after the release and nothing announces it here — so the tile is filled from
   * qits-projects, matched by version. **A read that failed, and a request that named no
   * repository, are both `pending` with a meta line saying so**, never a missing tile and never a
   * crash: not knowing whether something merged is not the same as knowing it did not.
   */
  private mergedStage(request: CdDeploymentRequestDto): LifecycleStage {
    const id = 'merged';
    const title = 'Merged to main';
    const problem = this.mergeProblem();
    if (problem) {
      return { id, title, meta: problem, state: 'pending' };
    }
    const requests = this.releaseRequests();
    if (requests === null) {
      return { id, title, meta: 'reading qits-projects…', state: 'pending' };
    }
    const matched = requests.find((candidate) => candidate.version === request.version);
    if (matched?.mergedToMainAt) {
      return { id, title, meta: formatInstant(matched.mergedToMainAt), state: 'reached' };
    }
    return {
      id,
      title,
      meta: matched ? 'not merged yet' : 'no release request carries this version',
      state: 'pending',
    };
  }

  /** The newest ACTIVE deployment of this application in the tier that was read. */
  private newestActive(applicationName: string): CdDeploymentDto | null {
    const active = this.deployments().filter(
      (deployment) =>
        deployment.applicationName === applicationName && deployment.status === 'ACTIVE',
    );
    // Newest by its own timestamp, the fold the deployments table performs for the same reason: the
    // list arrives sorted, and an ordering a screen inherits is one nobody can check.
    return (
      [...active].sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      )[0] ?? null
    );
  }

  /** Why a finished request never got its version serving, in the server's own vocabulary. */
  private stoppedWord(request: CdDeploymentRequestDto): string {
    if (isRefused(request)) {
      return 'the gate refused it';
    }
    const status = request.deploymentStatus;
    return status ? (STOPPED_WORDS[status] ?? status) : 'no deployment was recorded';
  }

  /** What a still-moving request is waiting on. */
  private movingWord(request: CdDeploymentRequestDto): string {
    if (isHeldForApproval(request)) {
      return 'held for manual approval';
    }
    return isPendingGate(request) ? 'waiting on the quality gate' : 'deploying';
  }

  // --- the facts under the flow -----------------------------------------------------------------

  protected readonly isHeldForApproval = isHeldForApproval;
  protected readonly isDeclined = isDeclined;

  protected gateLabel(request: CdDeploymentRequestDto): string {
    if (isHeldForApproval(request)) {
      return 'Held for approval';
    }
    if (isPendingGate(request)) {
      return 'In the gate';
    }
    return request.qualityGate === 'MET' ? 'Gate met' : 'Gate unmet';
  }

  protected gateTone(request: CdDeploymentRequestDto): QitsBadgeTone {
    if (isHeldForApproval(request)) {
      return 'warning';
    }
    if (isPendingGate(request)) {
      return 'info';
    }
    return request.qualityGate === 'MET' ? 'success' : 'warning';
  }
}
