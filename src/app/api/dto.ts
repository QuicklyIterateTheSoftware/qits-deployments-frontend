/**
 * The wire shapes this client reads, hand-written and copied field-for-field from the Java records
 * on the other side (`CdEnvironmentDto`, `CdApplicationDto`, `CdDeploymentDto` in qits-deployments;
 * `ProjectDto` in qits-projects).
 *
 * Hand-written rather than generated, deliberately (the explorer plan's Decision 1). The platform
 * generates OpenAPI *documents*, not clients, and every controller nests its request and response
 * records inside the request type, so a generator names them positionally — qits-projects'
 * committed document already calls the list-projects response `Response19` and one entry `Entry4`.
 * A page written against `Entry4` is worse than one written against the interfaces below, and the
 * whole surface this app reads is three endpoints plus one.
 *
 * The envelopes are genuinely inconsistent across the two services — `{environments: […]}` for cd's
 * environment list, `{environment: …}` for its single read, `{deployments: […]}` for deployments,
 * `{entries: [{project: …}]}` for projects — and the interfaces say so rather than pretending
 * otherwise. Straightening them out is the servers' business, not this client's.
 *
 * These interfaces are duplicated from qits-spa-ci where they overlap (`ProjectDto`, the loadable
 * envelope shapes) rather than shared. Decision 2: that is forty lines against a library publish
 * and a version bump in seven applications every time one of them moves.
 *
 * `Instant` arrives as an ISO-8601 string; every timestamp below is typed as one and parsed only
 * where it is formatted.
 */

/**
 * A deployment's state. `QUEUED`, `STARTING` and `SPEC_UNREADABLE` are the non-terminal ones, and
 * that is the whole rule behind Decision 5's poll — everything else sits still for days.
 *
 * The last three are outcomes the server settles a row into *after* the deployment itself is over,
 * which is why none of them is in flight: `ROLLED_BACK` is an update that failed onto a predecessor
 * that kept serving, `SUPERSEDED` an interrupted attempt a newer deployment overtook, and `GONE` a
 * row that was serving until its container vanished under it.
 *
 * `SPEC_UNREADABLE` is the odd one and the reason `isInFlight` is no longer two words: the git host
 * would not serve the repository's `deployments.yml` at the released tag, so the deployer never
 * learned where this release goes and is reading the file again on its own cadence. Nothing about
 * the repository is being claimed and nothing is running yet — it is a release the server is still
 * working on, which is exactly what this page polls for.
 *
 * `DECLARATION_REFUSED` is settled *before* the deployment rather than after it, and it is the only
 * word here that is: the release's `.config/qits/configuration.yml` was refused by
 * qits-configuration, or the store could not be reached — the row's detail says which. The deployer
 * seeds that file before it schedules anything, so nothing was started, nothing was replaced and
 * whatever was serving before is still serving. It is terminal on purpose and deliberately **not**
 * in flight: a declaration the store rejected is rejected for as long as the file says what it
 * says, and a page that polled it would poll until the tab closed. Re-reading the same broken file
 * is not the wait `SPEC_UNREADABLE` describes — it is a release that needs somebody to fix a file
 * and cut another one.
 */
export type CdDeploymentStatus =
  | 'QUEUED'
  | 'STARTING'
  | 'ACTIVE'
  | 'IMAGE_MISSING'
  | 'SPEC_UNREADABLE'
  | 'DECLARATION_REFUSED'
  | 'ROLLED_BACK'
  | 'FAILED'
  | 'GONE'
  | 'SCALED_TO_ZERO'
  | 'DECOMMISSIONED'
  | 'SUPERSEDED';

/**
 * The statuses an application is stopped in, and there is exactly one.
 *
 * It is the row's word for "somebody scaled this to zero": the deployment is intact — same sha,
 * same service, same history — and the workload is deliberately not running. The table reads it to
 * decide which of the two levers a row offers, because offering *Stop* on something already stopped
 * would be an action with no effect and *Start* on something serving would be worse.
 */
export function isStopped(status: CdDeploymentStatus): boolean {
  return status === 'SCALED_TO_ZERO';
}

/**
 * The statuses a poll is waiting on. Anything else is settled.
 *
 * `SPEC_UNREADABLE` is in here even though no container is starting, because the server has not
 * finished with the row: it re-reads the repository's spec on its observation cadence and deploys
 * the release for real when the file answers. A table that stopped polling on it would show a
 * release as stuck at the moment it was about to move.
 */
const IN_FLIGHT: readonly CdDeploymentStatus[] = ['QUEUED', 'STARTING', 'SPEC_UNREADABLE'];

/** Whether this deployment is still moving — the only reason this page ever polls. */
export function isInFlight(status: CdDeploymentStatus): boolean {
  return IN_FLIGHT.includes(status);
}

/**
 * One tracked application, in the environment it belongs to. Its id is `<environmentId>:<name>`,
 * which is the key its deployment rows are joined on.
 *
 * `repoId` is displayed and never joined on: the applications in qits-deployments are seeded with
 * the git-host directory name, the same string `CiRun.repoId` carries, but this page's only join is
 * environment-to-project by name, so `repoId` is a column and nothing more.
 *
 * `environmentId` and `environmentName` stay **nullable here** because this type describes what the
 * client reads and not what the server promises: nothing on this screen breaks on an entry that
 * carries no link, and narrowing them would be this file asserting an invariant it cannot check.
 * Every row is read out of an environment's own aggregate, so the link is never the thing a reader
 * is missing.
 *
 * There is no `branch`. A release names a tag, so nothing in this catalogue has a deploy ref of its
 * own any more; the server dropped the field.
 */
export interface CdApplicationDto {
  readonly id: string;
  readonly repoId: string;
  readonly name: string;
  readonly environmentId: string | null;
  readonly environmentName: string | null;
  readonly availableOnEnv: boolean;
  readonly healthPath: string | null;
  readonly createdAt: string;
}

/**
 * An environment. `applications` is **null in the list endpoint** and populated only by the single
 * read — which is why expanding a project costs more than one request.
 *
 * There is no `branch`: a tier listened to `environment/<name>` while a green build was the deploy
 * trigger, and a release names a tag instead. V8 dropped the column.
 */
export interface CdEnvironmentDto {
  readonly id: string;
  readonly name: string;
  readonly network: string;
  /**
   * True on exactly one environment: **the tier a release enters the platform at**, and therefore
   * the tier it is deployed into.
   *
   * It is the server's designation and this client only reads it, on one row and in one banner: an
   * install with none designated is one where a release enters nowhere and nothing deploys at all,
   * which is a fact about the whole screen that no table can state.
   */
  readonly platform: boolean;
  readonly createdAt: string;
  readonly applications: readonly CdApplicationDto[] | null;
}

/**
 * One deployment of one application.
 *
 * **`version` is the coordinate and `commitSha` is the commit behind it.** The version is the CalVer
 * stamp the release minted — the git tag, and the tag the image carries — and it is what a reader
 * identifies a deployment by. The sha is what that tag resolved to and is nullable: a repository
 * carrying no deployments.yml answers the spec read with a 404, which says nothing about where the
 * tag points. On rows written before releases became the trigger it is the other way round —
 * `version` is null and the sha was the whole coordinate — so both are drawn per-row and neither
 * absence is an error.
 *
 * `runId` is the ci run that produced the image, and it is the entire reason the commit cell can
 * link out of this application. A `SoftwareRelease` carries none, so only a manual replay supplies
 * one; the link is drawn per-row and its absence is not an error.
 *
 * `detail` is a clob: the reason an `IMAGE_MISSING` or `FAILED` row is what it is. A row expands in
 * place to show it, which is what stands in for a deployment detail route (Decision 4) —
 * qits-deployments has no deployment-by-id endpoint and this screen needs none. It is also the only
 * place a `DECLARATION_REFUSED` row says whether qits-configuration *refused* the declaration or
 * merely could not be *reached*, which the server writes as the clob's first line. That difference
 * decides who acts — the release's author or whoever owns the store — and this screen draws it by
 * drawing the clob, unparsed: a client that split the first line off to make a second badge would
 * be inventing a field the wire does not carry.
 */
export interface CdDeploymentDto {
  readonly id: string;
  readonly applicationId: string;
  readonly applicationName: string;
  readonly version: string | null;
  readonly commitSha: string | null;
  readonly status: CdDeploymentStatus;
  readonly containerName: string | null;
  readonly detail: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly runId: string | null;
}

/**
 * What the quality gate said about a deployment request.
 *
 * `MET` is the only word written today — the gate is a placeholder that says yes to every released
 * version, because qits-ci's pipeline has already had its say. `UNMET` is modelled anyway, and this
 * screen renders it, because the day a real gate refuses something the refusal has to be visible
 * somewhere: there is no deployment row for a release that never happened.
 */
export type CdQualityGate = 'UNMET' | 'MET';

/**
 * One deployment request: **this version of this application was asked for here**.
 *
 * It is what a `SoftwareRelease` produces, and the deployment is what it produces in turn — request
 * → gate → deployment. `deploymentId` is the edge to the third step and is null when there is no
 * third step, which is the whole record of a release that shipped nothing; `gateDetail` says why.
 *
 * **The join key is `applicationName`, not an id.** A deployment carries a derived `applicationId`
 * — `<environmentId>:<name>`, which it has an environment to derive from; a request is written
 * before anything is scheduled and the server declines to guess one for it. A name is unique per
 * tier, which is all this page needs.
 *
 * `gateSettledAt` is null while nothing has answered — a state today's placeholder skips, since it
 * answers in the transaction that writes the row.
 *
 * `deploymentStatus` is the one field here that is not the request's own row: it is the status of
 * the deployment `deploymentId` names, joined by the server so that a client deciding whether this
 * release is still moving needs no second request. It is null when there is nothing to have a
 * status — a refusal queued no deployment, and an environment teardown forgets the rows a request
 * outlives.
 *
 * `priority` is what the release said about itself — `LOWEST`, `LOW`, `MEDIUM`, `HIGH`, `HIGHER` or
 * `BLOCKING`, carried down from the participating branches of the release request that minted the
 * version. It is **inert**: nothing here or in qits-deployments orders anything by it, the deploy
 * queue is still first in, first out, and this screen shows it because a value nobody can read is a
 * value nobody can act on. It is optional and nullable for the same one reason — the event field is
 * additive and the server writes no backfill, so every row released before the feature carries no
 * priority at all, and "the release stated none" is a real answer rather than a gap. Typed as a
 * string and not a union because this client never decides anything with it: a word a build has not
 * been taught renders as itself instead of being dropped.
 *
 * `deployHold`, `releaseRequestQualifiedId`, `approvedBy` and `approvedAt` are qits-2268's four: a
 * request can now be held for a person or an agent to approve rather than deploying the instant the
 * gate would otherwise have let it through. Held, it reads `qualityGate: 'UNMET'`,
 * `gateSettledAt: null`, `deployHold: true` and a `gateDetail` of
 * `held for manual approval on <release request qualified id>` — the same two gate fields a refusal
 * writes, which is exactly why `deployHold` exists: without it, a held request and a request still
 * waiting on a real gate are the same two fields and cannot be told apart. `releaseRequestQualifiedId`
 * is the request that held it, for the link this screen draws; it is null off that request, and on
 * every row that was never held. Once approved, `qualityGate` becomes `MET`, `gateSettledAt` is set,
 * `gateDetail` reads `approved by <actor>`, and `approvedBy`/`approvedAt` carry who and when — a
 * person or an agent, either may approve. All four are optional here even though the server writes
 * them on every row from this release on, because `isHeldForApproval` below is written to answer
 * correctly from `gateDetail` alone when a row — a fixture, a cached response, a build that has not
 * picked up the new field yet — carries none of them.
 *
 * `declinedBy` and `declinedAt` are qits-2271's answer the other way: the other write `POST
 * …/decline` performs on a held request. Declined, `qualityGate` stays `UNMET`, `gateSettledAt` is
 * set, `gateDetail` reads `declined by <who>[: <note>]`, and these two carry who and when — never
 * both this pair and `approvedBy`/`approvedAt` on the same row, since a request settles one way or
 * the other and never both. Optional and nullable for the same reason as the approve pair: a row
 * from before this release carries neither.
 */
export interface CdDeploymentRequestDto {
  readonly id: string;
  readonly applicationName: string;
  readonly version: string;
  readonly environmentId: string | null;
  readonly packageName: string | null;
  readonly repoId: string | null;
  readonly projectId: string | null;
  readonly qualityGate: CdQualityGate;
  readonly gateDetail: string | null;
  readonly deploymentId: string | null;
  readonly createdAt: string;
  readonly gateSettledAt: string | null;
  readonly deploymentStatus: CdDeploymentStatus | null;
  readonly priority?: string | null;
  readonly deployHold?: boolean;
  readonly releaseRequestQualifiedId?: string | null;
  readonly approvedBy?: string | null;
  readonly approvedAt?: string | null;
  readonly declinedBy?: string | null;
  readonly declinedAt?: string | null;
}

/**
 * Whether this request is still waiting on its gate — asked, and nothing has answered.
 *
 * Unreachable today and deliberately implemented anyway: it is the second non-terminal state of the
 * lifecycle this page follows, beside `QUEUED` and `STARTING`, and it is what the poll will have to
 * watch the moment a gate takes longer than a transaction. A settled gate that said no is *not* in
 * flight — it is an outcome, and polling it would never end.
 */
export function isPendingGate(request: CdDeploymentRequestDto): boolean {
  return request.qualityGate === 'UNMET' && request.gateSettledAt === null;
}

/** Whether the gate refused this request outright: it answered, and it queued nothing. */
export function isRefused(request: CdDeploymentRequestDto): boolean {
  return request.qualityGate === 'UNMET' && request.gateSettledAt !== null;
}

/**
 * Whether this request is sitting in `deployHold`, waiting for a person or an agent to approve it
 * rather than for a gate to answer.
 *
 * It is a **subset of `isPendingGate`**, not a separate state: a held request writes the identical
 * `qualityGate: 'UNMET'` / `gateSettledAt: null` pair a request still waiting on a real gate would,
 * because that is what lets `POST …/approve` reuse the same settlement the gate itself performs.
 * `deployHold` is the one field that tells the two apart, which is the whole reason the server
 * started writing it.
 *
 * **`deployHold` missing is tolerated, deliberately**, by falling back to `gateDetail`: a row this
 * client read before it was taught the field, a fixture in a spec, or a build of this app one
 * release behind the server's would otherwise show "In the gate" for a request a person is waiting
 * on `qits` to surface — silence rather than a wrong badge, but still the wrong badge. The fallback
 * reads the sentence qits-deployments writes beside the hold rather than reparsing anything from
 * it, so it breaks the moment that sentence's wording changes rather than hiding a drift quietly.
 */
export function isHeldForApproval(request: CdDeploymentRequestDto): boolean {
  if (request.qualityGate !== 'UNMET' || request.gateSettledAt !== null) {
    return false;
  }
  if (request.deployHold !== undefined) {
    return request.deployHold === true;
  }
  return (request.gateDetail ?? '').startsWith('held for manual approval');
}

/** cd's environment list envelope. Every environment, which is what makes orphans computable. */
export interface CdEnvironmentsResponse {
  readonly environments: readonly CdEnvironmentDto[];
}

/** cd's single-environment envelope — the one that carries `applications`. */
export interface CdEnvironmentResponse {
  readonly environment: CdEnvironmentDto;
}

/** cd's deployment list envelope. Sorted newest-first by the server. */
export interface CdDeploymentsResponse {
  readonly deployments: readonly CdDeploymentDto[];
}

/**
 * cd's deployment-request envelope. Newest-first, and scoped to one environment like the deployment
 * listing — a request names the tier it was asked for, and that is the listing it comes back in.
 */
export interface CdDeploymentRequestsResponse {
  readonly deploymentRequests: readonly CdDeploymentRequestDto[];
}

/** A project's dns record, or the whole object is null when it registers no domain. */
export interface ProjectDnsRecordDto {
  readonly domain: string;
  readonly type: string;
  readonly value: string;
}

/**
 * A project.
 *
 * `slug` is the load-bearing field here and `name` is only a label: the project-to-environment edge
 * is `CdEnvironment.name === Project.slug`, by convention and by no column at all.
 */
export interface ProjectDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly dns: ProjectDnsRecordDto | null;
}

/** projects' list envelope: entries, each wrapping the thing it lists. */
export interface ProjectEntriesResponse {
  readonly entries: readonly { readonly project: ProjectDto }[];
}
