import { parseCliArgs, requireStringArg, runCli } from './cli.util';
import { convertDocmostArchivePath } from './docmost-archive-v5-converter';

const USAGE = `Usage:
  pnpm --filter ./apps/server archive:convert-v5 -- \\
    --input=<legacy-json-or-extracted-directory> \\
    --output=<new-json-or-directory>

The command is offline: it reads only the supplied archive files and never
connects to PostgreSQL, Redis, storage, or a running Docmost instance.`;

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help === true) {
    console.log(USAGE);
    return;
  }

  const input = requireStringArg(args, 'input');
  const output = requireStringArg(args, 'output');
  const report = await convertDocmostArchivePath(input, output);
  console.log(
    `Converted archive to schema V5. Materialized page embeds: ${report.materializedPageEmbeds}; unavailable placeholders: ${report.unavailablePageEmbeds}.`,
  );
}

void runCli(main);
