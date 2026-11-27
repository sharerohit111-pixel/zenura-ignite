import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const deploymentWorkflow = new URL("../../.github/workflows/deploy-supabase-market-gateway.yml", import.meta.url);
const gatewaySource = new URL("../supabase-server.js", import.meta.url);

test("Cloud Run deployment keeps Delivery LIMIT worker disabled", async () => {
  const workflow = await readFile(deploymentWorkflow, "utf8");
  const gateway = await readFile(gatewaySource, "utf8");

  assert.match(workflow, /PAPER_LIMIT_WORKER_ENABLED=false(?:[,\\"])/);
  assert.doesNotMatch(workflow, /PAPER_LIMIT_WORKER_ENABLED=true/);
  assert.match(
    workflow,
    /\\.limitWorker\\.enabled == false[^\\n]*\\.limitWorker\\.lastRunAt == null/
  );
  assert.match(gateway, /if\\(process\\.env\\.PAPER_LIMIT_WORKER_ENABLED===\\"true\\"\\)/);
});
