import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

test('runtime source contains no merchant persistence credentials', async () => {
  const files = await readdir(new URL('../src/', import.meta.url));
  const source = (await Promise.all(files.map((file) => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')))).join('\n');
  for (const forbidden of ['DATABASE_URL', 'DB_PASSWORD', 'PGPASSWORD', 'GCS_BUCKET', 'FTP_PASSWORD', 'STANDALONE_MCP_BRIDGE_PRIVATE_KEY_B64']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not appear in runtime source`);
  }
});

test('Cloud Run candidate deploy injects the SlimAI assertion trust set', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');

  assert.match(workflow, /STANDALONE_SLIMAI_ASSERTION_ISSUER=https:\/\/slimweb\.tw/);
  assert.match(workflow, /STANDALONE_SLIMAI_ASSERTION_PUBLIC_KEYS_JSON=STANDALONE_SLIMAI_ASSERTION_PUBLIC_KEYS_JSON:latest/);
});
