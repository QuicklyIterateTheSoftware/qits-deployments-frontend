import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, type Signal } from '@angular/core';
import { QitsAppLinks } from '@qits/ui-components';

/**
 * The mechanism every "this address moved to the landing app" screen in `deployment-requests/`
 * shares: `deployment-requests-redirect.ts` (qits-2315), `deployment-request-redirect.ts`
 * (qits-2322) and `deployment-request-by-release-redirect.ts` (qits-2323) all call this from their
 * constructor and differ only in the relative `path` they hand it — each reads its own route
 * parameters and nothing else.
 *
 * **The destination's origin is an async answer, waited on rather than guessed.**
 * `QitsAppLinks.origin('qits-landing')` and its `environmentOrigin()` fallback both come from the
 * platform's navigation, fetched after this application started, so the returned signal reads
 * `undefined` until one of them resolves — and stays that way forever on a platform that never
 * answers. A relative address would be wrong on every host but this one, so there is no fallback
 * that guesses it: with neither origin ever landing, a caller keeps saying where the page moved to
 * without acting on it, rather than sending the reader to this host's own `/...`, which the landing
 * app does not serve.
 *
 * **A full-document navigation, not a router one.** The destination is a different application
 * entirely, so `Router.navigate` would compile a route this SPA does not have and go nowhere;
 * `document.location.replace` leaves no entry for the back button to return to the redirect screen.
 *
 * `path` is a function rather than a plain string only so a `computed` reading it costs nothing to
 * be right if a caller's own inputs ever did change — every caller today reads an immutable route
 * snapshot once, so in practice this runs at most twice: once while the origin is unknown, once when
 * it answers.
 */
export function injectLandingRedirect(path: () => string): Signal<string | undefined> {
  const links = inject(QitsAppLinks);
  const document = inject(DOCUMENT);

  const link = computed<string | undefined>(() => {
    const origin = links.origin('qits-landing') ?? links.environmentOrigin();
    return origin ? `${origin.replace(/\/+$/, '')}${path()}` : undefined;
  });

  effect(() => {
    const value = link();
    if (value) {
      document.location.replace(value);
    }
  });

  return link;
}
