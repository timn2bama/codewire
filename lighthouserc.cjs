module.exports = {
  ci: {
    collect: {
      staticDistDir: "./dist",
      isSinglePageApplication: true,
      url: ["http://localhost/", "http://localhost/voltage-drop", "http://localhost/ampacity"],
      numberOfRuns: 3,
      settings: { onlyCategories: ["performance"], chromeFlags: "--no-sandbox" },
    },
    assert: {
      assertions: {
        "largest-contentful-paint": ["warn", { maxNumericValue: 2500, aggregationMethod: "median" }],
        "total-blocking-time": ["warn", { maxNumericValue: 200, aggregationMethod: "median" }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1, aggregationMethod: "median" }],
        "resource-summary:script:size": ["error", { maxNumericValue: 650000, aggregationMethod: "median" }],
      },
    },
    upload: { target: "filesystem", outputDir: "./lighthouse-reports" },
  },
};
