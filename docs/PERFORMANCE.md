# Performance budgets

Use Node 22.19 or newer and the repository's pinned npm version.
Run `npm ci`, `npm run build`, then `npm run test:performance`.
Chrome must be installed; `CHROME_PATH` can select its executable.

The Lighthouse CI job builds with non-secret Supabase placeholders so the
client includes its authentication SDK. It audits the homepage, voltage drop,
and ampacity with three simulated mobile runs per page and median assertions.

Enforced budgets: cumulative layout shift <= 0.1 and loaded script transfer
size <= 200,000 bytes. Lighthouse records compressed network transfer sizes;
the initial homepage measurement was 157,635 bytes of scripts.
LCP above 2.5 seconds and total blocking time above 200 milliseconds emit
warnings until repeated hosted measurements establish stable timing limits.

Reports are saved locally in `lighthouse-reports/` and retained as GitHub
Actions artifacts, including on assertion failures. No public report upload
or production writes are performed. These are laboratory measurements;
they do not measure field INP or establish real-user Core Web Vitals results.

The Lighthouse override keeps the measurement engine current; tmp and UUID
overrides patch older Lighthouse CI dependencies. Recheck clean installation,
collection, assertions, and dependency audit when updating this tooling.
