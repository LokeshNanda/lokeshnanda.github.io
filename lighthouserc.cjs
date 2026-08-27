/**
 * Lighthouse CI configuration.
 *
 * Deliberately a .cjs file: package.json sets "type": "module", and LHCI loads
 * lighthouserc.js with require(), so a plain .js config fails to parse.
 *
 * The split between what errors and what warns here is the whole design, and
 * it came out of measurement rather than taste. Running the same unchanged
 * dist/ twice on this laptop produced a performance score of 74 in one session
 * and 59 in the next, with speed index moving from 4.9s to 8.1s. The score is
 * as much a property of the machine that measured it as of the site, so gating
 * a deploy on it would block publishing at random.
 *
 * Bytes and request counts came back identical to the byte on all fifteen
 * runs. So those are the hard gate, and everything derived from timing is
 * advisory. That keeps the promise honest: the build fails when the site
 * actually got heavier, not when the runner got busy.
 *
 * Thresholds are calibrated to a measured baseline, not to aspiration.
 *
 * Be careful which baseline. The numbers above came off a Windows laptop and
 * turned out to be unrepresentative in both directions: it scored the site
 * 59-81 on mobile, while the CI runner it actually gates scores 94-98. The
 * runner is a datacenter machine a short hop from Google, and this site's
 * weight is almost entirely Google's, so the third-party fetches that dominate
 * every metric are far cheaper there. The laptop also hid a real CLS defect
 * completely, because the webfont fallbacks are Segoe UI and Georgia, which
 * exist there and not on the Linux runner or on Android.
 *
 * Observed on CI, medians, 2026-08-27, benchmarkIndex 2554:
 *
 *   path                      perf  CLS   LCP   TBT   SI
 *   /                          94   0     2662  176   1411
 *   /blog/                     96   0     2469  137   1409
 *   /blog/<post>/              96   0     2466  142   1410
 *   /search/                   98   0     1548  141   1406
 *   /demos/                    96   0     2458  135   1411
 *
 * The timing ceilings below are therefore much looser than that baseline
 * needs, deliberately: one CI run is one sample, and the history of this file
 * is of confident calibration off too little data. Tighten them once several
 * pushes have shown the real runner spread. The byte and request budgets are
 * already tight and are already doing the real work.
 */

const KIB = 1024;

// Byte and request ceilings. These are the assertions with teeth.
//
// Note these are LHCI's own resource-summary assertions rather than
// Lighthouse's budget.json. That is not a style preference: LHCI forwards only
// a fixed subset of Lighthouse settings, and both `settings.budgets` and
// `settings.budgetsPath` are silently discarded. Lighthouse never receives
// them, never produces the performance-budget audit, and an assertion on that
// audit then passes without checking anything. A green run proved nothing.
const budgets = {
  // The real guard on the site's "small islands only" claim. Every page loads
  // exactly three scripts today: Google's gtag.js, the 5.4 KB chat widget and
  // Astro's 15 KB view-transitions router (added 2026-08-27, the first
  // deliberate spend of the "a third script is unambiguously ours" headroom).
  // Counts are the right unit for this because third-party bytes are 97% of
  // the page and Google can change them without warning, which would fail a
  // build for a regression that is not ours. A fourth script is unambiguously
  // ours.
  'resource-summary:script:count': ['error', { maxNumericValue: 3 }],
  // Loose on purpose, unlike the script count above. These two totals include
  // requests Google initiates (the fonts CSS, three font files, gtag.js and an
  // analytics beacon, six of them today). If GA4 starts firing one more, that
  // is not a regression in this repo and should not fail this build. The
  // script count stays tight because a new script is worth stopping for
  // whoever added it.
  'resource-summary:third-party:count': ['error', { maxNumericValue: 9 }],
  'resource-summary:total:count': ['error', { maxNumericValue: 15 }],

  // document and stylesheet are entirely first-party, so these are tight.
  'resource-summary:document:size': ['error', { maxNumericValue: 20 * KIB }],
  'resource-summary:stylesheet:size': ['error', { maxNumericValue: 12 * KIB }],
  // Catches Pagefind's WASM index turning up on a page that is not /search/.
  'resource-summary:other:size': ['error', { maxNumericValue: 8 * KIB }],

  // 348 KiB of webfonts is still the single largest cost on the site, larger
  // than everything else put together, though since display=optional they no
  // longer block paint. Holding the line until they are self-hosted and
  // subset.
  'resource-summary:font:size': ['error', { maxNumericValue: 360 * KIB }],
  // Measured 176 KiB on / with the view-transitions router included, of which
  // gtag.js is ~130 KiB and can drift on Google's schedule, so the ceiling
  // keeps ~24 KiB of headroom for their side rather than ours.
  'resource-summary:script:size': ['error', { maxNumericValue: 200 * KIB }],
  'resource-summary:third-party:size': ['error', { maxNumericValue: 540 * KIB }],
  'resource-summary:total:size': ['error', { maxNumericValue: 560 * KIB }],
};

const shared = {
  ...budgets,

  // Deterministic across every run, so safe to fail on.
  'categories:accessibility': ['error', { minScore: 1 }],
  'categories:best-practices': ['error', { minScore: 1 }],
  'categories:seo': ['error', { minScore: 1 }],

  // Advisory, for the reason described at the top. The floor sits below the
  // worst score observed locally so a genuine collapse still shows in the log.
  'categories:performance': ['warn', { minScore: 0.5 }],

  // Timings error, but with ceilings well above the worst locally observed
  // value, because GitHub's shared runners are slower and noisier again. These
  // catch a page becoming seconds slower, not ordinary drift.
  'largest-contentful-paint': ['error', { maxNumericValue: 9000 }],
  'total-blocking-time': ['error', { maxNumericValue: 700 }],
  'speed-index': ['error', { maxNumericValue: 12000 }],
  // Measured exactly 0 on every page in every run. Nothing on the site shifts
  // layout, so any movement at all is a real regression.
  'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }],

  // The Google Fonts stylesheet is still a render-blocking third-party
  // request, so this fires on every page. Warn rather than error: it is a
  // known, unfixed problem, and erroring would block every deploy until the
  // fonts are self-hosted. The font files themselves no longer block paint.
  'render-blocking-resources': 'warn',
};

module.exports = {
  ci: {
    collect: {
      // LHCI serves this directory itself and rewrites the origin in the URLs
      // below to whatever port it picks. Its static server resolves the
      // directory-style /path/index.html layout Astro emits, so no separate
      // `astro preview` process is needed.
      //
      // Must be a full `npm run build`, not `astro build`: the pagefind step
      // runs second and /search/ is inert without it.
      staticDistDir: './dist',
      url: [
        'http://localhost/',
        'http://localhost/blog/',
        // Heaviest post: most Shiki code blocks, largest HTML. Hardcoded slug,
        // so renaming that file breaks this run rather than silently skipping.
        'http://localhost/blog/chatbot-thumbs-feedback-opik/',
        'http://localhost/search/',
        'http://localhost/demos/',
      ],
      // Assertions run against the median of these three. One run is not
      // reproducible enough to gate a deploy on.
      numberOfRuns: 3,
      settings: {
        chromeFlags: '--no-sandbox',
      },
    },

    // Every entry whose pattern matches a URL is applied, so the three
    // patterns below are mutually exclusive by construction. Anchoring on $
    // keeps the generic pattern from swallowing the two specific ones.
    assert: {
      assertMatrix: [
        {
          // Homepage, /blog/ and /demos/.
          matchingUrlPattern: '(localhost:\\d+/|/blog/|/demos/)$',
          assertions: shared,
        },
        {
          // Individual posts. Accessibility cannot reach 1.0 here: Shiki's
          // github-light theme colours keywords #D73A49, which is 4.01:1
          // against the code background and fails WCAG AA. Fixing it means
          // overriding the syntax theme site-wide, which is a separate call.
          matchingUrlPattern: '/blog/[^/]+/$',
          assertions: {
            ...shared,
            'categories:accessibility': ['error', { minScore: 0.95 }],
          },
        },
        {
          // Pagefind's UI bundle and its WASM index load only here and roughly
          // double the page's script weight, so this page gets its own
          // ceilings rather than loosening them everywhere.
          matchingUrlPattern: '/search/$',
          assertions: {
            ...shared,
            'resource-summary:script:count': ['error', { maxNumericValue: 6 }],
            'resource-summary:total:count': ['error', { maxNumericValue: 20 }],
            'resource-summary:script:size': ['error', { maxNumericValue: 250 * KIB }],
            'resource-summary:other:size': ['error', { maxNumericValue: 90 * KIB }],
          },
        },
      ],
    },

    upload: {
      // Prints a public report URL per run into the job log. No token or
      // secret, which is why this needs no entry in docs/setup-checklist.md.
      // Reports are readable by anyone with the link and expire after a few
      // days.
      target: 'temporary-public-storage',
    },
  },
};
