import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CdApi } from './cd-api';

/**
 * The paths and the envelopes, asserted once here so the page's spec can be about rendering.
 *
 * These are same-origin absolute paths on purpose — the SPA is served at `/deployments/`
 * behind the gateway that also serves `/projects/api/…`, and that is what carries the session
 * cookie to both.
 */
describe('CdApi', () => {
  let api: CdApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(CdApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('unwraps the environment list', async () => {
    const environments = api.environments();
    http.expectOne('/deployments/api/environments').flush({
      environments: [
        {
          id: 'e1',
          name: 'qits',
          network: 'qits-net',
          platform: true,
          createdAt: '2026-07-01T00:00:00Z',
          applications: null,
        },
      ],
    });
    await expect(environments).resolves.toMatchObject([{ id: 'e1', name: 'qits' }]);
  });

  it('reads one environment for its applications, through the singular envelope', async () => {
    const applications = api.applications('e1');
    http.expectOne('/deployments/api/environments/e1').flush({
      environment: {
        id: 'e1',
        name: 'qits',
        network: 'qits-net',
        createdAt: '2026-07-01T00:00:00Z',
        applications: [
          {
            id: 'a1',
            repoId: 'qits-ci',
            name: 'qits-ci',
            healthPath: '/ci/q/health',
            createdAt: '2026-07-01T00:00:00Z',
          },
        ],
      },
    });
    await expect(applications).resolves.toMatchObject([{ id: 'a1', repoId: 'qits-ci' }]);
  });

  it('reads a null applications array as none, not as a crash', async () => {
    // The *list* endpoint answers `applications: null` by design; a single read should not, but a
    // client that assumed so would throw on the one response shape the service already emits.
    const applications = api.applications('e1');
    http.expectOne('/deployments/api/environments/e1').flush({
      environment: { id: 'e1', name: 'qits', network: 'n', applications: null },
    });
    await expect(applications).resolves.toEqual([]);
  });

  it('filters deployments by environment, which the service requires', async () => {
    const deployments = api.deployments('e1');
    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/deployments/api/deployments' &&
        candidate.params.get('environmentId') === 'e1',
    );
    request.flush({ deployments: [] });
    await expect(deployments).resolves.toEqual([]);
  });

  it('posts a restart to the application, with no body to get wrong', async () => {
    const restarted = api.restart('e1:qits-ci');
    const request = http.expectOne('/deployments/api/applications/e1%3Aqits-ci/restart');
    expect(request.request.method).toBe('POST');
    request.flush({});
    await expect(restarted).resolves.toBeUndefined();
  });

  it('posts a replica count to scale, and the count is the whole request', async () => {
    // Zero stops it and one starts it; the service refuses anything above one, because every
    // application on this platform is deployed as a single task.
    const stopped = api.scale('e1:qits-ci', 0);
    const request = http.expectOne('/deployments/api/applications/e1%3Aqits-ci/scale');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ replicas: 0 });
    request.flush({});
    await expect(stopped).resolves.toBeUndefined();
  });

  it('escapes the colon in an application id rather than letting it reach the path raw', async () => {
    // The id is `<environmentId>:<name>` and it is one path segment, so the separator has to be
    // encoded — a raw colon in a segment is legal but is exactly the kind of thing a proxy in front
    // rewrites.
    const started = api.scale('e1:qits-ci', 1);
    http.expectOne('/deployments/api/applications/e1%3Aqits-ci/scale').flush({});
    await expect(started).resolves.toBeUndefined();
  });

  it('unwraps the deployment requests, filtered by the same environment', async () => {
    // A request names the tier it was asked for, so it comes back in that tier's answer and the
    // same required filter decides which one.
    const requests = api.deploymentRequests('e1');
    http
      .expectOne(
        (candidate) =>
          candidate.url === '/deployments/api/deployment-requests' &&
          candidate.params.get('environmentId') === 'e1',
      )
      .flush({
        deploymentRequests: [
          {
            id: 'r1',
            applicationName: 'qits-ci',
            version: '2026.903.113443',
            environmentId: 'e1',
            qualityGate: 'MET',
            gateDetail: null,
            deploymentId: 'd1',
            createdAt: '2026-09-03T11:34:43Z',
            gateSettledAt: '2026-09-03T11:34:43Z',
          },
        ],
      });
    await expect(requests).resolves.toMatchObject([{ id: 'r1', version: '2026.903.113443' }]);
  });

  it('rejects with the HttpErrorResponse, so callers can read the status', async () => {
    const deployments = api.deployments('nope');
    http
      .expectOne((candidate) => candidate.url === '/deployments/api/deployments')
      .flush({ message: 'No such environment' }, { status: 404, statusText: 'Not Found' });
    await expect(deployments).rejects.toBeInstanceOf(HttpErrorResponse);
  });

  it('posts an empty body to approve, and unwraps the same envelope the single read gives', async () => {
    const approved = api.approve('r1');
    const request = http.expectOne('/deployments/api/deployment-requests/r1/approve');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    request.flush({
      deploymentRequest: {
        id: 'r1',
        applicationName: 'qits-ci',
        version: '2026.903.113443',
        environmentId: 'e1',
        packageName: null,
        repoId: 'qits-ci',
        projectId: 'p1',
        qualityGate: 'MET',
        gateDetail: 'approved by xion03@gmail.com',
        deploymentId: 'd1',
        createdAt: '2026-09-03T11:34:43Z',
        gateSettledAt: '2026-09-03T11:40:00Z',
        deploymentStatus: 'QUEUED',
        approvedBy: 'xion03@gmail.com',
        approvedAt: '2026-09-03T11:40:00Z',
      },
      deployment: null,
    });
    await expect(approved).resolves.toMatchObject({
      deploymentRequest: { id: 'r1', approvedBy: 'xion03@gmail.com' },
    });
  });

  it('escapes the id in the approve path, the same as every other path segment here', async () => {
    const approved = api.approve('e1:r1');
    http
      .expectOne('/deployments/api/deployment-requests/e1%3Ar1/approve')
      .flush({ deploymentRequest: null, deployment: null });
    await expect(approved).resolves.toBeDefined();
  });

  it('rejects an approve the server refused, with the status callers key their message on', async () => {
    const approved = api.approve('r1');
    http
      .expectOne('/deployments/api/deployment-requests/r1/approve')
      .flush(
        { message: 'this request is no longer held for approval' },
        { status: 409, statusText: 'Conflict' },
      );
    await expect(approved).rejects.toBeInstanceOf(HttpErrorResponse);
  });

  // qits-2271: decline, the other answer to a hold.
  it('posts an empty body to decline with no note, and unwraps the declined request', async () => {
    const declined = api.decline('r1');
    const request = http.expectOne('/deployments/api/deployment-requests/r1/decline');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    request.flush({
      deploymentRequest: {
        id: 'r1',
        applicationName: 'qits-ci',
        version: '2026.903.113443',
        environmentId: 'e1',
        packageName: null,
        repoId: 'qits-ci',
        projectId: 'p1',
        qualityGate: 'UNMET',
        gateDetail: 'declined by xion03@gmail.com',
        deploymentId: null,
        createdAt: '2026-09-03T11:34:43Z',
        gateSettledAt: '2026-09-03T11:40:00Z',
        deploymentStatus: null,
        declinedBy: 'xion03@gmail.com',
        declinedAt: '2026-09-03T11:40:00Z',
      },
      deployment: null,
    });
    await expect(declined).resolves.toMatchObject({
      deploymentRequest: { id: 'r1', declinedBy: 'xion03@gmail.com' },
      deployment: null,
    });
  });

  it('posts the note when one is given, and omits it entirely when blank', async () => {
    const withNote = api.decline('r1', 'the change is wrong');
    const noted = http.expectOne('/deployments/api/deployment-requests/r1/decline');
    expect(noted.request.body).toEqual({ note: 'the change is wrong' });
    noted.flush({ deploymentRequest: null, deployment: null });
    await expect(withNote).resolves.toBeDefined();

    const blank = api.decline('r1', '   ');
    const unnoted = http.expectOne('/deployments/api/deployment-requests/r1/decline');
    expect(unnoted.request.body).toEqual({});
    unnoted.flush({ deploymentRequest: null, deployment: null });
    await expect(blank).resolves.toBeDefined();
  });

  it('escapes the id in the decline path, the same as every other path segment here', async () => {
    const declined = api.decline('e1:r1');
    http
      .expectOne('/deployments/api/deployment-requests/e1%3Ar1/decline')
      .flush({ deploymentRequest: null, deployment: null });
    await expect(declined).resolves.toBeDefined();
  });

  it('rejects a decline the server refused, with the status callers key their message on', async () => {
    const declined = api.decline('r1');
    http
      .expectOne('/deployments/api/deployment-requests/r1/decline')
      .flush(
        { message: 'a sibling of this release request was already approved' },
        { status: 409, statusText: 'Conflict' },
      );
    await expect(declined).rejects.toBeInstanceOf(HttpErrorResponse);
  });
});
