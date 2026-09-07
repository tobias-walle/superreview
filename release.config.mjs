export default {
  branches: ["main"],
  tagFormat: "v${version}",
  plugins: [
    ["@semantic-release/commit-analyzer", { preset: "conventionalcommits" }],
    ["@semantic-release/release-notes-generator", { preset: "conventionalcommits" }],
    [
      "@semantic-release/exec",
      { prepareCmd: "SUPERREVIEW_VERSION=${nextRelease.version} pnpm build" },
    ],
    ["@semantic-release/npm", { pkgRoot: "dist-cli" }],
    [
      "@semantic-release/github",
      {
        successComment: false,
        failComment: false,
        labels: false,
        releasedLabels: false,
      },
    ],
  ],
};
