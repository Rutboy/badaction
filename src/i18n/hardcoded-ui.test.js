import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";

const roots = [resolve("src/app"), resolve("src/components")];
const userTextAttributes = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "confirmLabel",
  "description",
  "label",
  "pendingLabel",
  "placeholder",
  "title",
]);
const userTextSetters = new Set([
  "setActionError",
  "setDndStatus",
  "setDisplayNameError",
  "setError",
  "setSyncError",
  "setTitleError",
]);

const sourceFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      if (
        entry.isFile() &&
        (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts"))
      ) {
        return [path];
      }
      return [];
    }),
  );
  return nested.flat();
};

// Numeric counters and punctuation (for example, "/ 1000") are language-neutral.
// The guard is concerned with literal words that belong in the dictionaries.
const hasWords = (value) => /\p{L}/u.test(value.trim());

const literalText = (node) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
};

test("application UI does not introduce hardcoded user-facing text", async () => {
  const files = (await Promise.all(roots.map(sourceFiles))).flat().sort();
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const parsed = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const report = (node, value, kind) => {
      if (!hasWords(value)) return;
      const location = parsed.getLineAndCharacterOfPosition(
        node.getStart(parsed),
      );
      violations.push(
        `${file.slice(process.cwd().length + 1)}:${location.line + 1} ${kind}: ${JSON.stringify(value.trim())}`,
      );
    };

    const visit = (node) => {
      if (ts.isJsxText(node)) {
        report(node, node.text, "JSX text");
      }

      if (ts.isJsxExpression(node) && node.expression) {
        const value = literalText(node.expression);
        if (value !== null) report(node, value, "JSX expression");
      }

      if (ts.isJsxAttribute(node)) {
        const name = node.name.getText(parsed);
        if (userTextAttributes.has(name) && node.initializer) {
          const value = ts.isStringLiteral(node.initializer)
            ? node.initializer.text
            : ts.isJsxExpression(node.initializer) &&
                node.initializer.expression
              ? literalText(node.initializer.expression)
              : null;
          if (value !== null) report(node, value, `${name} attribute`);
        }
      }

      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const firstArgument = literalText(node.arguments[0]);
        if (firstArgument !== null) {
          if (
            ts.isIdentifier(node.expression) &&
            userTextSetters.has(node.expression.text)
          ) {
            report(
              node.arguments[0],
              firstArgument,
              `${node.expression.text} call`,
            );
          }
          if (
            ts.isPropertyAccessExpression(node.expression) &&
            ["error", "info", "message", "success", "warning"].includes(
              node.expression.name.text,
            )
          ) {
            report(
              node.arguments[0],
              firstArgument,
              `${node.expression.name.text} notification`,
            );
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }

  assert.deepEqual(
    violations,
    [],
    `Move user-facing text to src/i18n/messages:\n${violations.join("\n")}`,
  );
});
