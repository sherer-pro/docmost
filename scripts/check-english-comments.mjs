import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const CODE_TARGET_DIRS = [
  'apps/server/src',
  'apps/server/test',
  'apps/client/src',
  'apps/client/public',
  'packages/editor-ext/src',
  'packages/api-contract/src',
];
const DOC_TARGET_DIRS = ['docs', 'apps/server/docs'];
const ROOT_TEXT_FILES = ['Dockerfile', 'README.md', 'AGENTS.md', 'CONTRIBUTING.md'];

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.txt']);
const CYRILLIC_RE = /[\u0400-\u04FF]/;

function collectFiles(dir, extensions) {
  const entries = readdirSync(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath, extensions));
      continue;
    }

    if (extensions.has(extname(fullPath))) {
      files.push(fullPath);
    }
  }

  return files;
}

function findCommentViolations(content) {
  const violations = [];
  const lines = content.split('\n');
  let inBlockComment = false;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    let i = 0;
    let inString = null;
    let escaped = false;

    while (i < line.length) {
      const char = line[i];
      const next = line[i + 1];

      if (inString) {
        if (!escaped && char === inString) {
          inString = null;
        }
        escaped = !escaped && char === '\\';
        i += 1;
        continue;
      }

      if (inBlockComment) {
        if (CYRILLIC_RE.test(line.slice(i))) {
          violations.push({ lineNumber, line: line.trim() });
          break;
        }

        if (char === '*' && next === '/') {
          inBlockComment = false;
          i += 2;
          continue;
        }

        i += 1;
        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        inString = char;
        i += 1;
        continue;
      }

      if (char === '/' && next === '*') {
        inBlockComment = true;
        const commentText = line.slice(i + 2);
        if (CYRILLIC_RE.test(commentText)) {
          violations.push({ lineNumber, line: line.trim() });
          break;
        }
        i += 2;
        continue;
      }

      if (char === '/' && next === '/') {
        const commentText = line.slice(i + 2);
        if (CYRILLIC_RE.test(commentText)) {
          violations.push({ lineNumber, line: line.trim() });
        }
        break;
      }

      i += 1;
    }
  });

  return violations;
}

const violations = [];
for (const dir of CODE_TARGET_DIRS) {
  for (const file of collectFiles(dir, CODE_EXTENSIONS)) {
    const fileViolations = findCommentViolations(readFileSync(file, 'utf8'));
    if (fileViolations.length > 0) {
      violations.push({ file, issues: fileViolations });
    }
  }
}

for (const dir of DOC_TARGET_DIRS) {
  for (const file of collectFiles(dir, DOC_EXTENSIONS)) {
    const content = readFileSync(file, 'utf8');
    if (CYRILLIC_RE.test(content)) {
      violations.push({
        file,
        issues: [{ lineNumber: 1, line: 'contains Cyrillic characters' }],
      });
    }
  }
}

for (const file of ROOT_TEXT_FILES) {
  const content = readFileSync(file, 'utf8');
  if (CYRILLIC_RE.test(content)) {
    violations.push({
      file,
      issues: [{ lineNumber: 1, line: 'contains Cyrillic characters' }],
    });
  }
}

if (violations.length > 0) {
  console.error('Found non-English (Cyrillic) comments:');
  for (const { file, issues } of violations) {
    for (const issue of issues) {
      console.error(`- ${file}:${issue.lineNumber} ${issue.line}`);
    }
  }
  process.exit(1);
}

console.log(
  'No Cyrillic comments/docs found in monitored source and documentation files.',
);
