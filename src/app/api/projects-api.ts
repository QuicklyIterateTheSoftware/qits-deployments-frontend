import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { QitsAppLinks } from '@qits/ui-components';
import { firstValueFrom } from 'rxjs';
import type { ProjectDto, ProjectEntriesResponse } from './dto';

/**
 * What this app reads from qits-projects: the project spine of the front page.
 *
 * qits-projects answers on its own host, not this one: the edge routes an application's paths on
 * that application's host only. So every call here goes to `applications['qits-projects'].origin`
 * from the edge's `/main-navigation`, carries the bearer (`qitsBearerInterceptor` signs any
 * platform host, not only this one), and waits for the navigation to answer rather than firing a
 * relative path at this host first. Where the navigation names no origin the path stays relative,
 * same-origin — what an older edge still routes.
 *
 * One method, and still not the whole surface. qits-spa-ci's copy of this service also fetches a
 * project's repositories, because its tree walks down to them; this app never does — the front
 * page's second level is the cd environment a project's slug names, and repositories appear only as
 * a column copied off `CdApplicationDto.repoId`. Carrying a `repositories()` nobody calls would be a
 * shared-code instinct applied to a file that is deliberately not shared.
 *
 * This used to carry a second method, `releaseRequests`, read by the deployment-request detail page
 * for the one fact only qits-projects holds — whether a version merged to main. That page moved to
 * the landing app (qits-2322), and with it the only caller, so the method went too.
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
    const response = await firstValueFrom(this.http.get<ProjectEntriesResponse>(url));
    return response.entries.map((entry) => entry.project);
  }
}
