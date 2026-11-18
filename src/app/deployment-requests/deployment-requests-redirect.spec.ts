import { DOCUMENT } from '@angular/common';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { provideQitsNavigationTree, type QitsNavigation } from '@qits/ui-components';
import { DeploymentRequestsRedirect } from './deployment-requests-redirect';

/**
 * Where an old bookmark to this app's own `deployment-requests` and `:project/deployment-requests`
 * lands, now that the list itself lives in the landing app (qits-2315).
 *
 * **No router here, on purpose.** The component reads its one route parameter off
 * `ActivatedRoute.snapshot.parent`, which is a plain object this suite can shape directly — mounting
 * the whole route table through a harness would additionally have to stand up `QitsMainLayout` just
 * to reach a page that is leaving before it would ever be drawn.
 *
 * **`DOCUMENT` is a proxy over the real one, not a bare replacement.** jsdom's own
 * `location.replace` cannot be spied on at all, but the real `DOCUMENT` is also what Angular's own
 * test renderer uses to attach and tear down the fixture's root element — a fake carrying nothing
 * but a `location` breaks `TestBed.createComponent` itself before this page gets a chance to run.
 * The proxy forwards every other read straight to `document`, methods bound to it so their native
 * internals still see the object they expect, and answers only `location` itself.
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

describe('DeploymentRequestsRedirect', () => {
  let replace: ReturnType<typeof vi.fn<(url: string) => void>>;

  /** `project` left out is this app's own unscoped route, whose route names no project. */
  function mount(options: {
    readonly project?: string;
    readonly navigation?: QitsNavigation;
  }): ComponentFixture<DeploymentRequestsRedirect> {
    replace = vi.fn<(url: string) => void>();
    const route = {
      snapshot: {
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
    const fixture = TestBed.createComponent(DeploymentRequestsRedirect);
    fixture.detectChanges();
    return fixture;
  }

  const LANDING_ORIGIN: QitsNavigation = {
    applications: { 'qits-landing': { origin: 'https://qits.example.test' } },
  };

  it('redirects to the landing app’s requests screen for a scoped project', () => {
    mount({ project: 'qits', navigation: LANDING_ORIGIN });

    expect(replace).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith(
      'https://qits.example.test/projects/qits/deployments/requests',
    );
  });

  it('encodes a project slug that needs it', () => {
    mount({ project: 'a b', navigation: LANDING_ORIGIN });

    expect(replace).toHaveBeenCalledWith(
      'https://qits.example.test/projects/a%20b/deployments/requests',
    );
  });

  it('sends the unscoped address to the landing app’s project picker, which has no unscoped listing', () => {
    mount({ navigation: LANDING_ORIGIN });

    expect(replace).toHaveBeenCalledWith('https://qits.example.test/projects');
  });

  it('falls back to the environment origin where the landing app has none of its own', () => {
    mount({ project: 'qits', navigation: { origin: 'https://dev.qits.example' } });

    expect(replace).toHaveBeenCalledWith(
      'https://dev.qits.example/projects/qits/deployments/requests',
    );
  });

  it('waits rather than redirecting to a relative URL when neither origin ever resolves', () => {
    const fixture = mount({ project: 'qits', navigation: {} });

    expect(replace).not.toHaveBeenCalled();
    // The message stays up rather than a blank page — it is the whole point of rendering anything.
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'The deployment requests moved to the landing app',
    );
  });

  it('shows the destination it is about to leave for, so the line is never just a promise', () => {
    const fixture = mount({ project: 'qits', navigation: LANDING_ORIGIN });

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'https://qits.example.test/projects/qits/deployments/requests',
    );
  });
});
