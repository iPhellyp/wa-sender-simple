import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { transform } from "esbuild";
import ts from "typescript";

const workerPath = resolve(process.cwd(), "src/worker/sender-worker.ts");

test("sender-worker transforma para CJS Node 22 sem top-level await", async () => {
  const source = await readFile(workerPath, "utf8");
  const transformed = await transform(source, {
    format: "cjs",
    loader: "ts",
    sourcefile: workerPath,
    target: "node22"
  });

  assert.ok(transformed.code.length > 0);
  assert.match(source, /async function main\(\)/);
  assert.match(source, /void main\(\)\.catch\(/);
  assert.doesNotMatch(source, /^await\b/gm);

  const sourceFile = ts.createSourceFile(
    workerPath,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS
  );
  let hasTopLevelAwait = false;

  const visitOutsideFunctions = (node: ts.Node) => {
    if (ts.isFunctionLike(node)) {
      return;
    }
    if (ts.isAwaitExpression(node)) {
      hasTopLevelAwait = true;
      return;
    }
    ts.forEachChild(node, visitOutsideFunctions);
  };
  ts.forEachChild(sourceFile, visitOutsideFunctions);

  assert.equal(hasTopLevelAwait, false);
});
