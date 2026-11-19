import { DOCUMENT } from '@angular/common';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideQitsNavigationTree, type QitsNavigation } from '@qits/ui-components';
import { DeploymentRequestByReleaseRedirect } from './deployment-request-by-release-redirect';

/**
 * Where an old bookmark to this app's own `deployment-requests/by-release/:repoId/:version` and
 * `:project/deployment-requests/by-release/:repoId/:version` lands, now that resolving the pair
 * into a request happens in the landing app too (qits-2323) — the third sibling of
 * `deployment-requests-redirect.spec.ts` and `deployment-request-redirect.spec.ts`, which cover the
 * same two shapes for the list and the detail page.
 *
 * **No router here, on purpose**, and **`DOCUMENT` is a proxy over the real one, not a bare
 * replacement** — both for the reasons given on the list redirect's own suite.
 */
function fakeDocument(replace: (url: string) => void): Document {
  const location = { replace };
  return new Proxy(document, {
    get(target, prop, receiver) {
      if (prop === 'location') return location;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as Document;
}

describe('DeploymentRequestByReleaseRedirect', () => {
  let replace: ReturnType<typeof vi.fn<(url: string) => void>>;

  /** `project` left out is this app's own unscoped route, whose route names no project. */
  function mount(options: {
    readonly repoId?: string;
    readonly version?: string;
    readonly project?: string;
    readonly navigation?: QitsNavigation;
  }): ComponentFixture<DeploymentRequestByReleaseRedirect> {
    replace = vi.fn<(url: string) => void>();
    const route = {
      snapshot: {
        paramMap: convertToParamMap({
          ...(options.repoId === undefined ? {} : { repoId: options.repoId }),
          ...(options.version === undefined ? {} : { version: options.version }),
        }),
        parent:
          options.project === undefined
            ? null
            : { paramMap: convertToParamMap({ project: options.project }) },
      },
    } as unknown as ActivatedRoute;

    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: route },
        { provide: DOCUMENT, useValue: fakeDocument(replace) },
        provideQitsNavigationTree(options.navigation ?? {}),
      ],
    });
    const fixture = TestBed.createComponent(DeploymentRequestByReleaseRedirect);
    fixture.detectChanges();
    return fixture;
  }

  const LANDING_ORIGIN: QitsNavigation = {
    applications: { 'qits-landing': { origin: 'https://qits.example.test' } },
  };

  it('redirects to the landing app’s by-release address for a scoped project', () => {
    mount({
      repoId: 'repo-ci',
      version: '2026.903.1',
      project: 'qits',
      navigation: LANDING_ORIGIN,
    });

    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith(
      'https://qits.example.test/projects/qits/deployments/requests/by-release/repo-ci/2026.903.1',
    );
  });

  it('encodes a project, a repository id and a version that need it', () => {
    mount({ repoId: 'a/b', version: '2026.903.1', project: 'a b', navigation: LANDING_ORIGIN });

    expect(replace).toHaveBeenCalledWith(
      'https://qits.example.test/projects/a%20b/deployments/requests/by-release/a%2Fb/2026.903.1',
    );
  });

  it('sends the unscoped address to the landing app’s project picker, which has no unscoped by-release page', () => {
    mount({ repoId: 'repo-ci', version: '2026.903.1', navigation: LANDING_ORIGIN });

    expect(replace).toHaveBeenCalledWith('https://qits.example.test/projects');
  });

  it('falls back to the environment origin where the landing app has none of its own', () => {
    mount({
      repoId: 'repo-ci',
      version: '2026.903.1',
      project: 'qits',
      navigation: { origin: 'https://dev.qits.example' },
    });

    expect(replace).toHaveBeenCalledWith(
      'https://dev.qits.example/projects/qits/deployments/requests/by-release/repo-ci/2026.903.1',
    );
  });

  it('waits rather than redirecting to a relative URL when neither origin ever resolves', () => {
    const fixture = mount({
      repoId: 'repo-ci',
      version: '2026.903.1',
      project: 'qits',
      navigation: {},
    });

    expect(replace).not.toHaveBeenCalled();
    // The message stays up rather than a blank page — it is the whole point of rendering anything.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'The deployment request moved to the landing app',
    );
  });

  it('shows the destination it is about to leave for, so the line is never just a promise', () => {
    const fixture = mount({
      repoId: 'repo-ci',
      version: '2026.903.1',
      project: 'qits',
      navigation: LANDING_ORIGIN,
    });

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'https://qits.example.test/projects/qits/deployments/requests/by-release/repo-ci/2026.903.1',
    );
  });
});
