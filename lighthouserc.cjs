module.exports = {
  ci: {
    collect: {
      staticDistDir: "./dist",
      isSinglePageApplication: true,
      url: ["http://localhost/", "http://localhost/voltage-drop", "http://localhost/ampacity"],
      numberOfRuns: 3,
      settings: {
        // Accessibility and SEO were never collected: performance-only meant those
        // categories were not even audited, so a regression in either was invisible.
        onlyCategories: ["performance", "accessibility", "seo"],
        chromeFlags: "--no-sandbox",
      },
    },
    assert: {
      assertions: {
        "largest-contentful-paint": ["warn", { maxNumericValue: 2500, aggregationMethod: "median" }],
        "total-blocking-time": ["warn", { maxNumericValue: 200, aggregationMethod: "median" }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1, aggregationMethod: "median" }],
        "resource-summary:script:size": ["error", { maxNumericValue: 200000, aggregationMethod: "median" }],
        // Warning-level on purpose: these are new measurements, so the first runs
        // should surface the real numbers rather than gate a merge on them.
        "categories:accessibility": ["warn", { minScore: 0.95, aggregationMethod: "median" }],
        "categories:seo": ["warn", { minScore: 0.95, aggregationMethod: "median" }],
      },
    },
    upload: { target: "filesystem", outputDir: "./lighthouse-reports" },
  },
};
