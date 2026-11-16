import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  provideQitsNavigationTree,
  provideQitsProjectList,
  provideQitsScope,
} from '@qits/ui-components';
import { routes } from '../app.routes';
import type {
  CdDeploymentDto,
  CdDeploymentRequestDto,
  ProjectsReleaseRequestDto,
} from '../api/dto';
import { CD_REQUEST_POLL_MS } from './poll-interval';

/**
 * One request's page: the three tiles, and what each of them is allowed to claim.
 *
 * The tiles are where every judgement on this screen lives, so they are what this suite asserts.
 * **Running is decided by the tier's newest ACTIVE row and not by this request's own deployment**,
 * because a deployment that says `ACTIVE` may have been decommissioned an hour later and a reader
 * asking "is my version live" would be told yes. **Merged is decided by qits-projects**, which is
 * the one step qits-deployments cannot see — and a read that fails leaves the tile *pending* with a
 * meta line saying so, because not knowing whether something merged is not knowing it did not.
 */
const PROJECTS = [{ id: 'p1', slug: 'qits', name: 'QITS' }];

const POLL_MS = 30;

describe('DeploymentRequestPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const request = (over: Partial<CdDeploymentRequestDto> = {}): CdDeploymentRequestDto => ({
    id: 'r1',
    applicationName: 'qits-ci',
    version: '2026.903.113443',
    environmentId: 'e1',
    packageName: 'qits/qits-ci',
    repoId: 'repo-ci',
    projectId: 'p1',
    qualityGate: 'MET',
    gateDetail: null,
    deploymentId: 'd1',
    createdAt: '2026-07-31T14:09:00Z',
    gateSettledAt: '2026-07-31T14:09:00Z',
    deploymentStatus: 'ACTIVE',
    ...over,
  });

  const deployment = (over: Partial<CdDeploymentDto> = {}): CdDeploymentDto => ({
    id: 'd1',
    applicationId: 'e1:qits-ci',
    applicationName: 'qits-ci',
    version: '2026.903.113443',
    commitSha: '9f2c1ab3d4e5f6',
    status: 'ACTIVE',
    containerName: 'dev-qits-ci',
    detail: null,
    createdAt: '2026-07-31T14:09:04Z',
    finishedAt: '2026-07-31T14:09:45Z',
    runId: null,
    ...over,
  });

  const releaseRequest = (
    over: Partial<ProjectsReleaseRequestDto> = {},
  ): ProjectsReleaseRequestDto => ({
    version: '2026.903.113443',
    mergedToMainAt: '2026-07-31T14:20:00Z',
    state: 'RELEASED',
    ...over,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationTree({ origin: 'https://dev.example.com', slots: {} }),
        provideQitsProjectList(PROJECTS),
        provideQitsScope('project'),
        { provide: CD_REQUEST_POLL_MS, useValue: POLL_MS },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function open(): Promise<void> {
    harness = await RouterTestingHarness.create('/qits/deployment-requests/r1');
    await settle();
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent ?? '';
  }

  /** The three tiles as `[title, state]`, which is the whole of what this page decides. */
  function tiles(): [string, string][] {
    return Array.from(page().querySelectorAll('.stage')).map((stage) => [
      stage.querySelector('.title')?.textContent ?? '',
      stage.className.replace('stage', '').trim(),
    ]);
  }

  function buttons(): HTMLButtonElement[] {
    return Array.from(page().querySelectorAll('button'));
  }

  function approveButton(): HTMLButtonElement | undefined {
    return buttons().find((button) => (button.textContent ?? '').includes('Approve'));
  }

  function declineButton(): HTMLButtonElement | undefined {
    return buttons().find((button) => (button.textContent ?? '').includes('Decline'));
  }

  function declineNoteInput(): HTMLInputElement | null {
    return page().querySelector<HTMLInputElement>('.decline-note');
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await harness.fixture.whenStable();
    }
  }

  async function pastOnePoll(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 4));
    await settle();
  }

  /**
   * The four reads a load costs: the request, then the tier's rows, the environment list and
   * qits-projects' release requests — the last three all taking arguments off the first.
   */
  async function flushLoad(options: {
    request: CdDeploymentRequestDto;
    deployment: CdDeploymentDto | null;
    deployments: readonly CdDeploymentDto[];
    releaseRequests?: readonly ProjectsReleaseRequestDto[] | 'down';
  }): Promise<void> {
    http
      .expectOne('/deployments/api/deployment-requests/r1')
      .flush({ deploymentRequest: options.request, deployment: options.deployment });
    await settle();
    http
      .expectOne('/deployments/api/environments')
      .flush({ environments: [{ id: 'e1', name: 'dev', network: 'qits-net', platform: true }] });
    http
      .expectOne(
        (candidate) =>
          candidate.url === '/deployments/api/deployments' &&
          candidate.params.get('environmentId') === 'e1',
      )
      .flush({ deployments: options.deployments });
    const releases = http.expectOne(
      '/projects/api/repositories/repo-ci/release-requests?state=RELEASED',
    );
    if (options.releaseRequests === 'down') {
      releases.flush(null, { status: 503, statusText: 'Down' });
    } else {
      releases.flush({ requests: options.releaseRequests ?? [] });
    }
    await settle();
  }

  it('draws three reached tiles for a version that is serving and has landed on main', async () => {
    await open();
    await flushLoad({
      request: request(),
      deployment: deployment(),
      deployments: [deployment()],
      releaseRequests: [releaseRequest()],
    });

    expect(tiles()).toEqual([
      ['Released 2026.903.113443', 'reached'],
      ['Running in dev', 'reached'],
      ['Merged to main', 'reached'],
    ]);
    // The facts under the flow are the request's and the deployment's, side by side.
    expect(text()).toContain('Gate met');
    expect(text()).toContain('qits/qits-ci');
    expect(text()).toContain('9f2c1ab');
    expect(text()).toContain('dev-qits-ci');
  });

  it('leaves the tiles pending while the deployment is still in flight', async () => {
    await open();
    await flushLoad({
      request: request({ deploymentStatus: 'STARTING' }),
      deployment: deployment({ status: 'STARTING', finishedAt: null }),
      deployments: [],
      releaseRequests: [releaseRequest({ mergedToMainAt: null })],
    });

    expect(tiles()).toEqual([
      ['Released 2026.903.113443', 'reached'],
      ['Running in dev', 'pending'],
      ['Merged to main', 'pending'],
    ]);
    expect(text()).toContain('deploying');
    expect(text()).toContain('not merged yet');
    expect(text()).toContain('following this release');
  });

  it('stops the tier tile when the gate refused the release outright', async () => {
    // The whole reason this page exists: a refusal queued no deployment at all, so there is no
    // deployment row anywhere that could say what happened.
    await open();
    await flushLoad({
      request: request({
        qualityGate: 'UNMET',
        gateDetail: 'the userflow suite failed against dev',
        deploymentId: null,
        deploymentStatus: null,
      }),
      deployment: null,
      deployments: [],
    });

    expect(tiles()[1]).toEqual(['Running in dev', 'stopped']);
    expect(text()).toContain('the gate refused it');
    expect(text()).toContain('the userflow suite failed against dev');
    expect(text()).toContain('No deployment was queued for this request');
    // Stopped is terminal: nothing here is going to change, so nothing is re-read.
    expect(text()).not.toContain('following this release');
  });

  it('stops the tier tile when qits-configuration refused the release’s declaration', async () => {
    // DECLARATION_REFUSED is settled before the deployment rather than after it, and it is the
    // complement half of `isCompletedRequest` that has to place it: the status is not in the
    // in-flight list, so the row is completed and the tile is stopped. Were it read as still
    // moving, this page would poll a release nobody is going to schedule until the tab closed.
    await open();
    await flushLoad({
      request: request({ deploymentStatus: 'DECLARATION_REFUSED' }),
      deployment: deployment({
        status: 'DECLARATION_REFUSED',
        containerName: null,
        detail:
          'qits-configuration refused the declaration — 422\n' +
          '.config/qits/configuration.yml:7 mapping values are not allowed here',
      }),
      // Nothing was scheduled, so the tier is serving whatever it was serving before — here,
      // nothing at all.
      deployments: [],
      releaseRequests: [releaseRequest({ mergedToMainAt: null })],
    });

    expect(tiles()[1]).toEqual(['Running in dev', 'stopped']);
    expect(text()).toContain('its configuration declaration was refused');
    expect(text()).toContain('nothing is serving dev');
    expect(text()).toContain('Declaration refused');
    expect(text()).not.toContain('DECLARATION_REFUSED');
    // The clob is the only place the two causes are told apart, so it is drawn whole and unparsed.
    // `pre.detail` and not `.detail`: a stopped tile draws its own word in a `.detail` of its own,
    // and the clob is the deployment's.
    expect(page().querySelector('pre.detail')?.textContent).toContain(
      'qits-configuration refused the declaration — 422',
    );
    // Terminal: nothing here is going to change, so nothing is re-read.
    expect(text()).not.toContain('following this release');
  });

  it('stops the tier tile when the orchestrator put the predecessor back', async () => {
    await open();
    await flushLoad({
      request: request({ deploymentStatus: 'ROLLED_BACK' }),
      deployment: deployment({ status: 'ROLLED_BACK', detail: 'rollback_completed' }),
      // The tier is serving the version this release tried to replace, and the tile says which.
      deployments: [deployment({ id: 'd0', version: '2026.903.100000' })],
      releaseRequests: [releaseRequest({ mergedToMainAt: null })],
    });

    expect(tiles()[1]).toEqual(['Running in dev', 'stopped']);
    expect(text()).toContain('rolled back to the predecessor');
    expect(text()).toContain('dev is running 2026.903.100000');
    expect(text()).toContain('rollback_completed');
  });

  it('leaves the merge tile pending and honest when qits-projects does not answer', async () => {
    // Not knowing whether something merged is not knowing it did not — and a version that deployed
    // an hour ago is still a true and useful screen with qits-projects down.
    await open();
    await flushLoad({
      request: request(),
      deployment: deployment(),
      deployments: [deployment()],
      releaseRequests: 'down',
    });

    expect(tiles()).toEqual([
      ['Released 2026.903.113443', 'reached'],
      ['Running in dev', 'reached'],
      ['Merged to main', 'pending'],
    ]);
    expect(text()).toContain('qits-projects did not answer — 503');
  });

  it('stops polling once every stage is reached', async () => {
    await open();
    await flushLoad({
      request: request({ deploymentStatus: 'STARTING' }),
      deployment: deployment({ status: 'STARTING', finishedAt: null }),
      deployments: [],
      releaseRequests: [releaseRequest({ mergedToMainAt: null })],
    });

    await pastOnePoll();
    http
      .expectOne('/deployments/api/deployment-requests/r1')
      .flush({ deploymentRequest: request(), deployment: deployment() });
    await settle();
    http
      .expectOne(
        (candidate) =>
          candidate.url === '/deployments/api/deployments' &&
          candidate.params.get('environmentId') === 'e1',
      )
      .flush({ deployments: [deployment()] });
    http
      .expectOne('/projects/api/repositories/repo-ci/release-requests?state=RELEASED')
      .flush({ requests: [releaseRequest()] });
    await settle();

    expect(tiles().every(([, state]) => state === 'reached')).toBe(true);
    // A poll re-reads the request, the tier and the merge — never the environment list, since what
    // tiers exist does not change while a container starts.
    await pastOnePoll();
    await pastOnePoll();
    http.verify();
  });

  // qits-2268: a request held for manual approval, and the write that settles it.
  describe('a request held for manual approval', () => {
    const held = (over: Partial<CdDeploymentRequestDto> = {}): CdDeploymentRequestDto =>
      request({
        qualityGate: 'UNMET',
        gateSettledAt: null,
        deployHold: true,
        releaseRequestQualifiedId: 'qits/ticket/qits-2268',
        gateDetail: 'held for manual approval on qits/ticket/qits-2268',
        deploymentId: null,
        deploymentStatus: null,
        ...over,
      });

    it('reads "Held for approval", the hold detail and the release request, with an Approve button', async () => {
      await open();
      await flushLoad({ request: held(), deployment: null, deployments: [] });

      expect(text()).toContain('Held for approval');
      expect(text()).toContain('held for manual approval on qits/ticket/qits-2268');
      expect(text()).toContain('qits/ticket/qits-2268');
      expect(approveButton()).toBeTruthy();
    });

    it('sends the approve call, marks the button busy, and redraws from its answer', async () => {
      await open();
      await flushLoad({ request: held(), deployment: null, deployments: [] });

      const button = approveButton();
      button?.click();
      await settle();
      // The write is in flight: the button says so and a second click must not queue a second call.
      expect(button?.getAttribute('aria-busy')).toBe('true');

      http.expectOne('/deployments/api/deployment-requests/r1/approve').flush({
        deploymentRequest: held({
          qualityGate: 'MET',
          gateSettledAt: '2026-07-31T14:10:00Z',
          gateDetail: 'approved by xion03@gmail.com',
          approvedBy: 'xion03@gmail.com',
          approvedAt: '2026-07-31T14:10:00Z',
          deploymentId: 'd1',
          deploymentStatus: 'QUEUED',
        }),
        deployment: deployment({ status: 'QUEUED', finishedAt: null }),
      });
      await settle();
      // The same two context reads a poll makes — never the environment list.
      http
        .expectOne(
          (candidate) =>
            candidate.url === '/deployments/api/deployments' &&
            candidate.params.get('environmentId') === 'e1',
        )
        .flush({ deployments: [deployment({ status: 'QUEUED', finishedAt: null })] });
      http
        .expectOne('/projects/api/repositories/repo-ci/release-requests?state=RELEASED')
        .flush({ requests: [] });
      await settle();

      expect(text()).toContain('Gate met');
      expect(text()).toContain('Approved by xion03@gmail.com');
      expect(text()).toContain('31 Jul 2026 14:10:00Z');
      expect(approveButton()).toBeFalsy();
    });

    it('names a refused approve beside the button, and leaves the hold on screen', async () => {
      await open();
      await flushLoad({ request: held(), deployment: null, deployments: [] });

      approveButton()?.click();
      await settle();
      http
        .expectOne('/deployments/api/deployment-requests/r1/approve')
        .flush(
          { message: 'this request is no longer the newest release for qits-ci' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();

      expect(text()).toContain(
        'Could not approve — 409 this request is no longer the newest release for qits-ci',
      );
      // The refusal is not this page's error: the hold is exactly as it was, and can be retried.
      expect(text()).toContain('Held for approval');
      expect(approveButton()).toBeTruthy();
      expect(approveButton()?.getAttribute('aria-busy')).not.toBe('true');
    });

    // qits-2271: decline, the other answer to a hold, and the one that is final.
    it('offers a Decline button and a note input beside Approve, with the final-and-WITHDRAWN hint', async () => {
      await open();
      await flushLoad({ request: held(), deployment: null, deployments: [] });

      expect(declineButton()).toBeTruthy();
      expect(declineNoteInput()).toBeTruthy();
      expect(text()).toContain('A decline is final');
      expect(text()).toContain('WITHDRAWN');
    });

    it('sends the typed note on decline, marks the button busy, and redraws from its answer', async () => {
      await open();
      await flushLoad({ request: held(), deployment: null, deployments: [] });

      const note = declineNoteInput();
      note!.value = 'the change is wrong';
      note!.dispatchEvent(new Event('input'));
      await settle();

      const button = declineButton();
      button?.click();
      await settle();
      expect(button?.getAttribute('aria-busy')).toBe('true');

      const request = http.expectOne('/deployments/api/deployment-requests/r1/decline');
      expect(request.request.body).toEqual({ note: 'the change is wrong' });
      request.flush({
        deploymentRequest: held({
          gateSettledAt: '2026-07-31T14:10:00Z',
          gateDetail: 'declined by xion03@gmail.com: the change is wrong',
          declinedBy: 'xion03@gmail.com',
          declinedAt: '2026-07-31T14:10:00Z',
        }),
        deployment: null,
      });
      await settle();
      // The same two context reads a poll makes — never the environment list.
      http
        .expectOne(
          (candidate) =>
            candidate.url === '/deployments/api/deployments' &&
            candidate.params.get('environmentId') === 'e1',
        )
        .flush({ deployments: [] });
      http
        .expectOne('/projects/api/repositories/repo-ci/release-requests?state=RELEASED')
        .flush({ requests: [] });
      await settle();

      expect(text()).toContain('Declined by xion03@gmail.com');
      expect(text()).toContain('31 Jul 2026 14:10:00Z');
      expect(declineButton()).toBeFalsy();
      expect(approveButton()).toBeFalsy();
    });

    it('sends an empty decline when no note was typed', async () => {
      await open();
      await flushLoad({ request: held(), deployment: null, deployments: [] });

      declineButton()?.click();
      await settle();
      const request = http.expectOne('/deployments/api/deployment-requests/r1/decline');
      expect(request.request.body).toEqual({});
      request.flush({
        deploymentRequest: held({
          gateSettledAt: '2026-07-31T14:10:00Z',
          gateDetail: 'declined by xion03@gmail.com',
          declinedBy: 'xion03@gmail.com',
          declinedAt: '2026-07-31T14:10:00Z',
        }),
        deployment: null,
      });
      await settle();
      http
        .expectOne(
          (candidate) =>
            candidate.url === '/deployments/api/deployments' &&
            candidate.params.get('environmentId') === 'e1',
        )
        .flush({ deployments: [] });
      http
        .expectOne('/projects/api/repositories/repo-ci/release-requests?state=RELEASED')
        .flush({ requests: [] });
      await settle();

      expect(text()).toContain('Declined by xion03@gmail.com');
    });

    it('names a refused decline beside the button, and leaves the hold on screen', async () => {
      await open();
      await flushLoad({ request: held(), deployment: null, deployments: [] });

      declineButton()?.click();
      await settle();
      http
        .expectOne('/deployments/api/deployment-requests/r1/decline')
        .flush(
          { message: 'a sibling of this release request was already approved' },
          { status: 409, statusText: 'Conflict' },
        );
      await settle();

      expect(text()).toContain(
        'Could not decline — 409 a sibling of this release request was already approved',
      );
      // The refusal is not this page's error: the hold is exactly as it was, and can be retried.
      expect(text()).toContain('Held for approval');
      expect(declineButton()).toBeTruthy();
      expect(declineButton()?.getAttribute('aria-busy')).not.toBe('true');
    });
  });
});
