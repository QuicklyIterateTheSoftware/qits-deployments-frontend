import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { QitsAppLinks } from '@qits/ui-components';
import { firstValueFrom } from 'rxjs';
import type {
  ProjectDto,
  ProjectEntriesResponse,
  ProjectsReleaseRequestDto,
  ProjectsReleaseRequestsResponse,
} from './dto';

/**
 * What this app reads from qits-projects: the project spine of the front page, and one field of a
 * release request.
 *
 * qits-projects answers on its own host, not this one: the edge routes an application's paths on
 * that application's host only. So every call here goes to `applications['qits-projects'].origin`
 * from the edge's `/main-navigation`, carries the session (`withCredentials`), and waits for the
 * navigation to answer rather than firing a relative path at this host first. Where the navigation
 * names no origin the path stays relative, same-origin — what an older edge still routes.
 *
 * Two methods, and still not the whole surface. qits-spa-ci's copy of this service also fetches a
 * project's repositories, because its tree walks down to them; this app never does — the front
 * page's second level is the cd environment a project's slug names, and repositories appear only as
 * a column copied off `CdApplicationDto.repoId`. Carrying a `repositories()` nobody calls would be a
 * shared-code instinct applied to a file that is deliberately not shared.
 *
 * The second method is the exception that proves that rule: `releaseRequests` is here because the
 * lifecycle a deployment request went through ends in a fact only qits-projects holds, and it reads
 * exactly that fact.
 *
 * Duplicated from qits-spa-ci rather than extracted (Decision 2): the alternative is putting a
 * transport dependency into `@qits/ui-components`, which six SPAs consume without making a request,
 * and turning every change here into a library publish plus a version bump in seven applications.
 * The platform's own precedent is the same — qits-ci duplicates qits-events' wire contract as its
 * own DTOs rather than depending on the domain module.
 */
@Injectable({ providedIn: 'root' })
export class ProjectsApi {
  private readonly http = inject(HttpClient);
  private readonly links = inject(QitsAppLinks);

  /** `path` on qits-projects' own origin, once the navigation has said where that is. */
  private url(path: string): Promise<string> {
    return this.links.whenApiUrl('qits-projects', path);
  }

  /** Every project. One request, on page load, and the spine everything else hangs from. */
  async projects(): Promise<readonly ProjectDto[]> {
    const url = await this.url('/projects/api/projects');
    const response = await firstValueFrom(
      this.http.get<ProjectEntriesResponse>(url, { withCredentials: true }),
    );
    return response.entries.map((entry) => entry.project);
  }

  /**
   * One repository's released requests — the second read, and it exists for a single field.
   *
   * The deployment-request detail page draws the lifecycle a version went through, and its last
   * step is **merged to main**. That is the one fact qits-deployments genuinely cannot know: the
   * merge happens in the git host after the release, and nothing announces it back. So the page
   * asks the service that owns the release request, matches by `version`, and reads
   * `mergedToMainAt`.
   *
   * `?state=RELEASED` because an unreleased request has no version to match on, so anything else in
   * the answer is rows to filter out in the browser.
   *
   * A failure here is not the page's failure and the caller treats it as one tile it cannot fill —
   * everything above the merge is qits-deployments' own answer and stands without this.
   */
  async releaseRequests(repoId: string): Promise<readonly ProjectsReleaseRequestDto[]> {
    const url = await this.url(
      `/projects/api/repositories/${encodeURIComponent(repoId)}/release-requests?state=RELEASED`,
    );
    const response = await firstValueFrom(
      this.http.get<ProjectsReleaseRequestsResponse>(url, { withCredentials: true }),
    );
    return response.requests;
  }
}
