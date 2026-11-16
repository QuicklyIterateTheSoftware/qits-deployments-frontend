import { isDeclined, type CdDeploymentRequestDto } from './dto';

/**
 * `isDeclined`, asserted directly (qits-2271) — the small pure function the page's template and
 * the gate badge read, rather than only through a rendered fixture three components away.
 *
 * Unlike `isHeldForApproval`'s `gateDetail`-prefix fallback, there is nothing to fall back to here:
 * `declinedAt` is the one field a decline writes that nothing else does, so its absence is simply
 * "not declined" — a row from before this release, a refusal, a hold, an approval.
 */
describe('isDeclined', () => {
  const request = (over: Partial<CdDeploymentRequestDto> = {}): CdDeploymentRequestDto => ({
    id: 'r1',
    applicationName: 'qits-ci',
    version: '2026.903.113443',
    environmentId: 'e1',
    packageName: null,
    repoId: 'repo-ci',
    projectId: 'p1',
    qualityGate: 'UNMET',
    gateDetail: null,
    deploymentId: null,
    createdAt: '2026-07-31T14:09:00Z',
    gateSettledAt: '2026-07-31T14:09:00Z',
    deploymentStatus: null,
    ...over,
  });

  it('is true once declinedAt is set', () => {
    expect(
      isDeclined(
        request({
          declinedBy: 'an-operator',
          declinedAt: '2026-07-31T14:10:00Z',
          gateDetail: 'declined by an-operator',
        }),
      ),
    ).toBe(true);
  });

  it('is false on a row that carries no declinedAt at all', () => {
    expect(isDeclined(request())).toBe(false);
  });

  it('is false on a row that explicitly carries declinedAt: null — a hold or an approval', () => {
    expect(
      isDeclined(
        request({
          qualityGate: 'MET',
          approvedBy: 'xion03@gmail.com',
          approvedAt: '2026-07-31T14:10:00Z',
          declinedBy: null,
          declinedAt: null,
        }),
      ),
    ).toBe(false);
  });
});
