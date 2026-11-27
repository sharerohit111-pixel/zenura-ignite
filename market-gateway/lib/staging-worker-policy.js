"use strict";

const STAGING_DISABLED_FLAGS = Object.freeze([
  "PAPER_LIMIT_WORKER_ENABLED",
  "PAPER_INTRADAY_LIMIT_WORKER_ENABLED",
  "PAPER_FUTURES_LIMIT_ENABLED",
  "PAPER_FUTURES_LIMIT_WORKER_ENABLED",
  "PAPER_OPTIONS_LIMIT_ENABLED",
  "PAPER_OPTIONS_LIMIT_WORKER_ENABLED",
  "PAPER_PROTECTIVE_WORKER_ENABLED"
]);

function assertStagingWorkersDisabled(env = process.env) {
  const enabled = STAGING_DISABLED_FLAGS.filter(name =>
    String(env[name] ?? "").trim().toLowerCase() === "true"
  );
  if (enabled.length) {
    throw new Error("Staging worker and order-submission flags must remain disabled: " + enabled.join(", "));
  }
  return Object.freeze(Object.fromEntries(STAGING_DISABLED_FLAGS.map(name => [name, false])));
}

module.exports = { STAGING_DISABLED_FLAGS, assertStagingWorkersDisabled };
