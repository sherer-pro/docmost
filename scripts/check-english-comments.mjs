import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const TARGET_DIRS = ['apps/server/src', 'apps/client/src'];
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const CYRILLIC_RE = /[\u0400-\u04FF]/;

function collectFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }

    if (TARGET_EXTENSIONS.has(extname(fullPath))) {
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
for (const dir of TARGET_DIRS) {
  for (const file of collectFiles(dir)) {
    const fileViolations = findCommentViolations(readFileSync(file, 'utf8'));
    if (fileViolations.length > 0) {
      violations.push({ file, issues: fileViolations });
    }
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

console.log('No Cyrillic comments found in apps/server/src and apps/client/src.');
