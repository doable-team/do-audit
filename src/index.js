// Programmatic entry point — for agents and scripts that would rather call
// the pipeline than parse CLI output.
//
//   import { loadConfig, runAudit, buildSummary } from "do-audit";
//   const { d, warnings } = await runAudit(loadConfig(), "example.com");
//   const summary = buildSummary(d, warnings, { version: "0.10.0" });
export { runAudit, saveReportFiles, serpCompetitorCandidates } from "./audit.js";
export { buildSummary, issueCounts } from "./summary.js";
export { loadConfig, CONFIG_PATH } from "./config.js";
export { configuredProviders, PROVIDERS } from "./ai.js";
export { renderReport } from "./report.js";
export { setLogSink } from "./ui.js";
