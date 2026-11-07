import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const configPath = path.join(repositoryRoot, ".graphify-local.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const command = process.argv[2] ?? "rebuild";
const forwarded = process.argv.slice(3);
const resumeExtraction = forwarded.includes("--resume");
const tokenBudgetArgument = forwarded.find((value) =>
  value.startsWith("--token-budget="),
);

const requiredKeys = [
  "schemaVersion",
  "graphifyVersion",
  "corpusRoot",
  "outputDir",
  "model",
  "mode",
  "tokenBudget",
  "apiTimeoutSeconds",
  "maxConcurrency",
  "maxWorkers",
  "generateHtml",
  "queryMemoryKey",
];
for (const key of requiredKeys) {
  if (!(key in config)) throw new Error(`Missing ${key} in ${configPath}`);
}
if (config.schemaVersion !== 1 || config.graphifyVersion !== "0.9.33") {
  throw new Error("Unsupported Graphify local profile version");
}

const effectiveTokenBudget = tokenBudgetArgument
  ? Number(tokenBudgetArgument.split("=")[1])
  : config.tokenBudget;
if (
  !Number.isInteger(effectiveTokenBudget) ||
  effectiveTokenBudget < 1000 ||
  effectiveTokenBudget > config.tokenBudget
) {
  throw new Error(
    "The extraction token budget must be between 1000 and the configured maximum",
  );
}

const corpusRoot = path.resolve(repositoryRoot, config.corpusRoot);
const outputDirectory = path.resolve(corpusRoot, config.outputDir);
const stagingDirectory = path.resolve(corpusRoot, `${config.outputDir}.next`);
const previousDirectory = path.resolve(
  corpusRoot, `${config.outputDir}.previous`,
);
const queryMemoryDirectory = path.join(
  os.homedir(),
  ".graphify",
  "query-memory",
  config.queryMemoryKey,
);
const executableName = process.platform === "win32" ? "graphify.exe" : "graphify";
const pinnedGraphify = path.join(os.homedir(), ".local", "bin", executableName);
const graphify = fs.existsSync(pinnedGraphify) ? pinnedGraphify : executableName;
const configuredLms = process.env.LMS_CLI;
const localLms = path.join(
  os.homedir(),
  ".lmstudio",
  "bin",
  process.platform === "win32" ? "lms.exe" : "lms",
);
const lms = configuredLms ?? (fs.existsSync(localLms) ? localLms : "lms");
const localProviderName = "lmstudio";
const localProvidersPath = path.join(
  os.homedir(), ".graphify", "providers.json",
);
const waitSync = (milliseconds) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

const renameWithRetry = (source, destination) => {
  let lastError;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      fs.renameSync(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (
        !["EBUSY", "EPERM"].includes(error.code) || fs.existsSync(destination)
      ) throw error;
      if (attempt < 10) waitSync(500);
    }
  }
  throw lastError;
};

const ensureLocalProvider = (baseUrl) => {
  let providers = {};
  if (fs.existsSync(localProvidersPath)) {
    const parsed = JSON.parse(fs.readFileSync(localProvidersPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) providers = parsed;
  }
  const provider = {
    base_url: baseUrl,
    default_model: config.model,
    env_key: "OPENAI_API_KEY",
    model_env_key: "GRAPHIFY_OPENAI_MODEL",
    pricing: { input: 0, output: 0 },
    temperature: 0,
    reasoning_effort: "none",
    max_tokens: 16384,
    vision: true,
  };
  if (isDeepStrictEqual(providers[localProviderName], provider)) return;
  providers[localProviderName] = provider;
  fs.mkdirSync(path.dirname(localProvidersPath), { recursive: true });
  fs.writeFileSync(
    localProvidersPath, `${JSON.stringify(providers, null, 2)}\n`, "utf8",
  );
};

const normalize = (value) => path.resolve(value).toLowerCase();
const assertInside = (parent, child, label) => {
  const normalizedParent = normalize(parent);
  const normalizedChild = normalize(child);
  const base = `${normalizedParent}${path.sep}`;
  if (
    normalizedChild !== normalizedParent && !normalizedChild.startsWith(base)
  ) {
    throw new Error(`${label} escaped ${parent}: ${child}`);
  }
};
assertInside(repositoryRoot, corpusRoot, "Corpus root");
assertInside(corpusRoot, outputDirectory, "Graphify output");
assertInside(corpusRoot, stagingDirectory, "Graphify staging output");
assertInside(corpusRoot, previousDirectory, "Graphify previous output");

const run = (file, args, options = {}) =>
  execFileSync(file, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: options.encoding,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
    windowsHide: true,
  });
const runText = (file, args, options = {}) =>
  String(
    run(file, args, { ...options, encoding: "utf8", stdio: "pipe" }),
  ).trim();
const runJson = (file, args) => JSON.parse(runText(file, args));

const graphifyVersion = runText(graphify, ["--version"]);
if (graphifyVersion !== `graphify ${config.graphifyVersion}`) {
  throw new Error(
    `Expected graphify ${config.graphifyVersion}, got ${graphifyVersion}`,
  );
}

const graphEnvironment = (outputName) => ({
  ...process.env,
  GRAPHIFY_OUT: path.resolve(corpusRoot, outputName),
  PYTHONUNBUFFERED: "1",
});

const integrity = (commandName, directory) =>
  JSON.parse(
    runText("python", [
      "-B",
      path.join(scriptDirectory, "graphify-integrity.py"),
      commandName,
      "--root",
      corpusRoot,
      ...(directory ? ["--directory", directory] : []),
    ]),
  );

const localBackend = async () => {
  const server = runJson(lms, ["server", "status", "--json"]);
  if (server.running !== true || !Number.isInteger(server.port)) {
    throw new Error("LM Studio server is not running");
  }
  const loaded = runJson(lms, ["ps", "--json"]);
  if (
    !Array.isArray(loaded) || !loaded.some((entry) => entry.identifier === config.model)
  ) {
    throw new Error(`LM Studio model is not loaded: ${config.model}`);
  }
  const baseUrl = `http://127.0.0.1:${server.port}/v1`;
  const url = new URL(baseUrl);
  if (url.hostname !== "127.0.0.1") throw new Error(`Non-loopback LM Studio URL: ${baseUrl}`);
  const response = await fetch(`${baseUrl}/models`);
  if (!response.ok) throw new Error(`LM Studio /v1/models returned HTTP ${response.status}`);
  ensureLocalProvider(baseUrl);
  return baseUrl;
};

const safeRemoveOwnedDirectory = (target, suffix) => {
  assertInside(corpusRoot, target, "Removal target");
  if (!path.basename(target).endsWith(suffix)) {
    throw new Error(`Refusing to remove unexpected directory: ${target}`);
  }
  if (!fs.existsSync(target)) return;
  if (fs.lstatSync(target).isSymbolicLink())
    throw new Error(`Refusing a linked removal target: ${target}`);
  assertInside(
    fs.realpathSync(corpusRoot),
    fs.realpathSync(target),
    "Resolved removal target",
  );
  const inspect = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (fs.lstatSync(child).isSymbolicLink())
        throw new Error(`Refusing a linked child: ${child}`);
      if (entry.isDirectory()) inspect(child);
    }
  };
  inspect(target);
  fs.rmSync(target, { force: true, recursive: true });
};

const linkArray = (graph) =>
  Array.isArray(graph.links) ? graph.links : graph.edges;
const validateGraph = (directory, requireProvenance = true) => {
  const graphPath = path.join(directory, "graph.json");
  const manifestPath = path.join(directory, "manifest.json");
  const reportPath = path.join(directory, "GRAPH_REPORT.md");
  for (const required of [graphPath, manifestPath, reportPath]) {
    if (!fs.existsSync(required)) throw new Error(`Missing Graphify artifact: ${required}`);
  }
  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const links = linkArray(graph);
  if (
    !Array.isArray(graph.nodes) || graph.nodes.length === 0 || !Array.isArray(links) || links.length === 0
  ) {
    throw new Error("Graphify graph must contain non-empty nodes and links");
  }
  const ids = new Set(graph.nodes.map((node) => String(node.id)));
  const manifestSet = new Set(
    Object.keys(manifest).map((value) => value.replaceAll("\\", "/")),
  );
  for (const bucket of [graph.nodes, links, graph.hyperedges ?? []]) {
    for (const item of bucket) {
      if (
        !item || typeof item.source_file !== "string" || item.source_file.length === 0
      ) continue;
      const source = item.source_file
        .replaceAll("\\", "/")
        .replace(/^\.\//u, "");
      if (!manifestSet.has(source)) throw new Error(`Graph source is absent from manifest: ${source}`);
    }
  }
  for (const link of links) {
    const source = String(link.source);
    const target = String(link.target);
    if (!ids.has(source) || !ids.has(target)) throw new Error(`Dangling edge: ${source} -> ${target}`);
    if (source === target) throw new Error(`Self-loop: ${source}`);
  }
  const manifestPaths = Object.keys(manifest);
  if (manifestPaths.length === 0) throw new Error("Graphify manifest is empty");
  for (const relative of manifestPaths) {
    const normalized = relative.replaceAll("\\", "/");
    if (normalized.includes("graphify-out/memory/")) {
      throw new Error(`Query memory leaked into the corpus: ${relative}`);
    }
    if (!fs.existsSync(path.resolve(corpusRoot, relative))) {
      throw new Error(`Manifest source does not exist: ${relative}`);
    }
  }
  if (requireProvenance) {
    const provenance = JSON.parse(
      fs.readFileSync(
        path.join(directory, "local-llm-provenance.json"), "utf8",
      ),
    );
    if (
      provenance.graphifyVersion !== config.graphifyVersion ||
      provenance.model !== config.model ||
      provenance.backend !== "openai-compatible-local"
    ) {
      throw new Error(
        "Graphify local LLM provenance does not match the pinned profile",
      );
    }
  }
  return { edges: links.length, files: manifestPaths.length, nodes: graph.nodes.length,
  };
};

const repositoryState = () => ({
  commit: runText("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]),
  dirty: runText("git", ["-C", repositoryRoot, "status", "--porcelain"]).length > 0,
});

const writeProvenance = (directory, baseUrl, state) => {
  const receiptPath = path.join(directory, "local-extraction-receipt.json");
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  if (
    !receipt.complete ||
    receipt.model !== config.model ||
    receipt.graphifyVersion !== config.graphifyVersion ||
    receipt.backend !== "openai-compatible-local"
  ) {
    throw new Error(
      "A verified completed local extraction receipt is required; projection changes cannot establish model provenance",
    );
  }
  const stats = validateGraph(directory, false);
  const graphBytes = fs.readFileSync(path.join(directory, "graph.json"));
  const payload = {
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    backend: "openai-compatible-local",
    model: config.model,
    graphifyVersion: config.graphifyVersion,
    corpusRoot: config.corpusRoot,
    outputDir: config.outputDir,
    endpoint: baseUrl,
    repository: state,
    settings: {
      mode: config.mode,
      tokenBudget: receipt.tokenBudget,
      apiTimeoutSeconds: config.apiTimeoutSeconds,
      maxConcurrency: config.maxConcurrency,
      maxWorkers: config.maxWorkers,
      generateHtml: config.generateHtml,
    },
    graph: {
      ...stats,
      sha256: createHash("sha256").update(graphBytes).digest("hex"),
    },
    extraction: receipt,
  };
  fs.writeFileSync(
    path.join(directory, "local-llm-provenance.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
  fs.rmSync(path.join(directory, "needs-semantic-rebuild"), { force: true });
  return stats;
};

const promoteStaging = () => {
  if (fs.existsSync(outputDirectory)) renameWithRetry(outputDirectory, previousDirectory);
  try {
    renameWithRetry(stagingDirectory, outputDirectory);
  } catch (error) {
    if (fs.existsSync(previousDirectory) && !fs.existsSync(outputDirectory)) {
      renameWithRetry(previousDirectory, outputDirectory);
    }
    throw error;
  }
  if (fs.existsSync(previousDirectory)) safeRemoveOwnedDirectory(previousDirectory, ".previous");
};

const rebuild = async () => {
  const state = repositoryState();
  const baseUrl = await localBackend();
  let priorAttempts = [];
  if (resumeExtraction) {
    const receipt = JSON.parse(
      fs.readFileSync(
        path.join(stagingDirectory, "local-extraction-receipt.json"),
        "utf8",
      ),
    );
    if (
      receipt.model !== config.model ||
      receipt.graphifyVersion !== config.graphifyVersion ||
      receipt.mode !== config.mode ||
      receipt.backend !== "openai-compatible-local"
    ) {
      throw new Error(
        "Staging cache provenance is incompatible with this extraction profile",
      );
    }
    const { priorAttempts: earlierAttempts = [], ...previousAttempt } = receipt;
    priorAttempts = [...earlierAttempts, previousAttempt];
    fs.copyFileSync(
      path.join(stagingDirectory, "input-snapshot.json"),
      path.join(
        stagingDirectory,
        `input-snapshot.before-resume-${Date.now()}.json`,
      ),
    );
  } else if (fs.existsSync(stagingDirectory)) {
    throw new Error(
      "Graphify staging already exists; inspect it and use a compatible --resume instead of discarding it",
    );
  }
  fs.mkdirSync(stagingDirectory, { recursive: true });
  const inputSnapshot = integrity("corpus");
  fs.writeFileSync(
    path.join(stagingDirectory, "input-snapshot.json"),
    JSON.stringify(inputSnapshot),
  );
  const receiptPath = path.join(
    stagingDirectory,
    "local-extraction-receipt.json",
  );
  const receipt = {
    backend: "openai-compatible-local",
    model: config.model,
    graphifyVersion: config.graphifyVersion,
    mode: config.mode,
    tokenBudget: effectiveTokenBudget,
    maxOutputTokens: Number(process.env.GRAPHIFY_MAX_OUTPUT_TOKENS || 16384),
    endpoint: baseUrl,
    sourceSha256: inputSnapshot.sourceSha256,
    startedAt: new Date().toISOString(),
    resumed: resumeExtraction,
    priorAttempts,
    complete: false,
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  const environment = {
    ...graphEnvironment(`${config.outputDir}.next`),
    OPENAI_BASE_URL: baseUrl,
    OPENAI_API_KEY: "lm-studio",
    OPENAI_MODEL: config.model,
    GRAPHIFY_OPENAI_MODEL: config.model,
    GRAPHIFY_MAX_RETRIES: "0",
  };
  const args = [
    "extract",
    ".",
    "--backend",
    localProviderName,
    "--model",
    config.model,
    "--mode",
    config.mode,
    "--max-concurrency",
    String(config.maxConcurrency),
    "--max-workers",
    String(config.maxWorkers),
    "--token-budget",
    String(effectiveTokenBudget),
    "--api-timeout",
    String(config.apiTimeoutSeconds),
    ...(resumeExtraction ? [] : ["--force"]),
    ...(config.generateHtml ? [] : ["--no-viz"]),
  ];
  console.log(
    `Graphify rebuild: ${config.queryMemoryKey}, ${config.model}, ${baseUrl}`,
  );
  try {
    run(graphify, args, { cwd: corpusRoot, env: environment });
    const coverage = integrity("check", stagingDirectory);
    state.sourceSha256 = coverage.sourceSha256;
    receipt.complete = true;
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
    fs.rmSync(path.join(stagingDirectory, ".graphify_labels.json"), {
      force: true,
    });
    fs.rmSync(path.join(stagingDirectory, ".graphify_labels.json.sig"), {
      force: true,
    });
    run(
      graphify,
      [
        "cluster-only",
        ".",
        "--graph",
        path.join(stagingDirectory, "graph.json"),
        "--no-label",
        ...(config.generateHtml ? [] : ["--no-viz"]),
      ],
      { cwd: corpusRoot, env: environment },
    );
    if (!config.generateHtml)
      fs.rmSync(path.join(stagingDirectory, "graph.html"), { force: true });
    integrity("check", stagingDirectory);
    const stats = writeProvenance(stagingDirectory, baseUrl, state);
    validateGraph(stagingDirectory);
    run(graphify, [
      "diagnose",
      "multigraph",
      "--graph",
      path.join(stagingDirectory, "graph.json"),
      "--json",
    ]);
    promoteStaging();
    console.log(
      `Graphify promoted: ${stats.nodes} nodes, ${stats.edges} edges, ${stats.files} files`,
    );
  } catch (error) {
    throw error;
  }
};

const relabel = async () => {
  if (fs.existsSync(stagingDirectory) || fs.existsSync(previousDirectory))
    throw new Error("Preserved staging or previous artifacts must be inspected before relabeling");
  const accepted = JSON.parse(fs.readFileSync(path.join(outputDirectory, "local-extraction-receipt.json"), "utf8"));
  if (!accepted.complete) throw new Error("Relabeling requires a completed local extraction; use rebuild");
  integrity("check", outputDirectory);
  if (!fs.existsSync(outputDirectory)) throw new Error(`Missing Graphify output: ${outputDirectory}`);
  const state = repositoryState();
  const baseUrl = await localBackend();
  if (fs.existsSync(stagingDirectory)) safeRemoveOwnedDirectory(stagingDirectory, ".next");
  if (fs.existsSync(previousDirectory)) safeRemoveOwnedDirectory(previousDirectory, ".previous");
  fs.cpSync(outputDirectory, stagingDirectory, { recursive: true });
  const stagedMemory = path.join(stagingDirectory, "memory");
  assertInside(stagingDirectory, stagedMemory, "Staged query memory");
  fs.rmSync(stagedMemory, { force: true, recursive: true });
  const environment = {
    ...graphEnvironment(`${config.outputDir}.next`),
    OPENAI_BASE_URL: baseUrl,
    OPENAI_API_KEY: "lm-studio",
    OPENAI_MODEL: config.model,
    GRAPHIFY_OPENAI_MODEL: config.model,
    GRAPHIFY_MAX_RETRIES: "0",
  };
  try {
    run(
      graphify,
      [
        "cluster-only",
        ".",
        "--graph",
        path.join(stagingDirectory, "graph.json"),
        "--backend",
        localProviderName,
        "--model",
        config.model,
        "--max-concurrency",
        String(config.maxConcurrency),
        ...(config.generateHtml ? [] : ["--no-viz"]),
      ],
      { cwd: corpusRoot, env: environment },
    );
    if (!config.generateHtml) fs.rmSync(path.join(stagingDirectory, "graph.html"), { force: true });
    const stats = writeProvenance(stagingDirectory, baseUrl, state);
    validateGraph(stagingDirectory);
    run(graphify, [
      "diagnose", "multigraph", "--graph", path.join(stagingDirectory, "graph.json"), "--json",
    ]);
    promoteStaging();
    console.log(
      `Graphify relabeled and promoted: ${stats.nodes} nodes, ${stats.edges} edges, ${stats.files} files`,
    );
  } catch (error) {
    if (fs.existsSync(stagingDirectory)) safeRemoveOwnedDirectory(stagingDirectory, ".next");
    throw error;
  }
};

const resumeStaging = async () => {
  const accepted = JSON.parse(fs.readFileSync(path.join(stagingDirectory, "local-extraction-receipt.json"), "utf8"));
  if (!accepted.complete) throw new Error("Partial extraction must resume with rebuild --resume");
  integrity("check", stagingDirectory);
  if (!fs.existsSync(stagingDirectory)) throw new Error(`Missing Graphify staging output: ${stagingDirectory}`);
  const state = repositoryState();
  const baseUrl = await localBackend();
  fs.rmSync(path.join(stagingDirectory, ".graphify_labels.json"), { force: true,
  });
  fs.rmSync(path.join(stagingDirectory, ".graphify_labels.json.sig"), { force: true,
  });
  const environment = {
    ...graphEnvironment(`${config.outputDir}.next`),
    OPENAI_BASE_URL: baseUrl,
    OPENAI_API_KEY: "lm-studio",
    OPENAI_MODEL: config.model,
    GRAPHIFY_OPENAI_MODEL: config.model,
    GRAPHIFY_MAX_RETRIES: "0",
  };
  run(
    graphify,
    [
      "cluster-only",
      ".",
      "--graph",
      path.join(stagingDirectory, "graph.json"),
      "--backend",
      localProviderName,
      "--model",
      config.model,
      "--max-concurrency",
      String(config.maxConcurrency),
      ...(config.generateHtml ? [] : ["--no-viz"]),
    ],
    { cwd: corpusRoot, env: environment },
  );
  if (!config.generateHtml) fs.rmSync(path.join(stagingDirectory, "graph.html"), { force: true });
  const stats = writeProvenance(stagingDirectory, baseUrl, state);
  validateGraph(stagingDirectory);
  run(graphify, [
    "diagnose", "multigraph", "--graph", path.join(stagingDirectory, "graph.json"), "--json",
  ]);
  promoteStaging();
  console.log(
    `Graphify staging resumed and promoted: ${stats.nodes} nodes, ${stats.edges} edges, ${stats.files} files`,
  );
};

const sanitizeExisting = async () => {
  throw new Error("Source pruning cannot repair extraction provenance; use a staged semantic rebuild");
};

const refresh = () => {
  if (fs.existsSync(stagingDirectory))
    throw new Error(
      "Retained Graphify staging must be inspected before an AST refresh",
    );
  const previous = JSON.parse(
    fs.readFileSync(
      path.join(outputDirectory, "local-llm-provenance.json"),
      "utf8",
    ),
  );
  const before = JSON.parse(
    fs.readFileSync(path.join(outputDirectory, "input-snapshot.json"), "utf8"),
  );
  const oldGraph = JSON.parse(
    fs.readFileSync(path.join(outputDirectory, "graph.json"), "utf8"),
  );
  const graphHash = createHash("sha256")
    .update(fs.readFileSync(path.join(outputDirectory, "graph.json")))
    .digest("hex");
  if (previous.graph.sha256 !== graphHash || !previous.extraction?.complete)
    throw new Error(
      "AST refresh requires a previously accepted extraction and matching graph bytes",
    );
  const current = integrity("corpus");
  const oldFiles = new Map(before.files.map((row) => [row.path, row]));
  const newFiles = new Map(current.files.map((row) => [row.path, row]));
  const changed = [...new Set([...oldFiles.keys(), ...newFiles.keys()])].filter(
    (name) => oldFiles.get(name)?.sha256 !== newFiles.get(name)?.sha256,
  );
  const semanticChanges = changed.filter((name) =>
    [oldFiles.get(name), newFiles.get(name)].some(
      (row) => row && row.kind !== "code",
    ),
  );
  if (semanticChanges.length)
    throw new Error(
      `Semantic sources changed; run a local semantic rebuild: ${semanticChanges.join(", ")}`,
    );
  fs.cpSync(outputDirectory, stagingDirectory, { recursive: true });
  fs.copyFileSync(
    path.join(stagingDirectory, "input-snapshot.json"),
    path.join(stagingDirectory, "input-snapshot.before-refresh.json"),
  );
  fs.writeFileSync(
    path.join(stagingDirectory, "input-snapshot.json"),
    JSON.stringify(current),
  );
  const environment = graphEnvironment(`${config.outputDir}.next`);
  run(graphify, ["update", ".", "--force"], {
    cwd: corpusRoot,
    env: environment,
  });
  const updated = JSON.parse(
    fs.readFileSync(path.join(stagingDirectory, "graph.json"), "utf8"),
  );
  const ids = new Set(updated.nodes.map((node) => String(node.id)));
  const lostSemantic = oldGraph.nodes.filter((node) => {
    const source = node.source_file?.replaceAll("\\", "/");
    return oldFiles.get(source)?.kind !== "code" && !ids.has(String(node.id));
  });
  if (lostSemantic.length)
    throw new Error(
      "AST update dropped retained semantic nodes; staging was preserved",
    );
  run(
    graphify,
    [
      "cluster-only",
      ".", "--graph", path.join(stagingDirectory, "graph.json"),
      "--no-label",
      ...(config.generateHtml ? [] : ["--no-viz"]),
    ],
    { cwd: corpusRoot, env: environment },
  );
  const coverage = integrity("check", stagingDirectory);
  const state = { ...repositoryState(), sourceSha256: coverage.sourceSha256 };
  const receipt = JSON.parse(
    fs.readFileSync(
      path.join(stagingDirectory, "local-extraction-receipt.json"),
      "utf8",
    ),
  );
  receipt.astUpdates = [
    ...(receipt.astUpdates ?? []),
    {
      at: new Date().toISOString(),
      previousSourceSha256: previous.repository.sourceSha256,
      sourceSha256: coverage.sourceSha256,
      changedFiles: changed,
    },
  ];
  fs.writeFileSync(
    path.join(stagingDirectory, "local-extraction-receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  writeProvenance(stagingDirectory, previous.endpoint, state);
  validateGraph(stagingDirectory);
  promoteStaging();
  console.log(
    `Graphify AST refresh accepted: ${coverage.nodes} nodes, ${coverage.edges} edges; semantic extraction provenance retained`,
  );
};

const check = () => {
  const stats = validateGraph(outputDirectory);
  const coverage = integrity("check", outputDirectory);
  const provenance = JSON.parse(
    fs.readFileSync(
      path.join(outputDirectory, "local-llm-provenance.json"),
      "utf8",
    ),
  );
  const actualHash = createHash("sha256")
    .update(fs.readFileSync(path.join(outputDirectory, "graph.json")))
    .digest("hex");
  if (
    provenance.graph.sha256 !== actualHash ||
    provenance.repository.sourceSha256 !== coverage.sourceSha256
  ) {
    throw new Error(
      "Graphify provenance does not match graph bytes or current source corpus",
    );
  }
  run(graphify, [
    "diagnose", "multigraph", "--graph", path.join(outputDirectory, "graph.json"), "--json",
  ]);
  console.log(
    `Graphify check passed: ${stats.nodes} nodes, ${stats.edges} edges, ${stats.files} files`,
  );
};

fs.mkdirSync(queryMemoryDirectory, { recursive: true });
switch (command) {
  case "rebuild":
    await rebuild();
    break;
  case "refresh":
    refresh();
    break;
  case "relabel":
    await relabel();
    break;
  case "resume-staging":
    await resumeStaging();
    break;
  case "sanitize-existing":
    await sanitizeExisting();
    break;
  case "check":
    check();
    break;
  case "memory-save":
    run(
      graphify, ["save-result", ...forwarded, "--memory-dir", queryMemoryDirectory], {
      cwd: corpusRoot,
      env: graphEnvironment(config.outputDir),
    },
    );
    break;
  case "memory-reflect":
    run(
      graphify,
      [
        "reflect",
        ...forwarded,
        "--memory-dir",
        queryMemoryDirectory,
        "--out",
        path.join(outputDirectory, "reflections", "LESSONS.md"),
      ],
      { cwd: corpusRoot, env: graphEnvironment(config.outputDir) },
    );
    break;
  case "hook-check":
    run(graphify, ["hook-check"], {
      cwd: corpusRoot,
      env: graphEnvironment(config.outputDir),
    });
    break;
  default:
    throw new Error(`Unknown Graphify local command: ${command}`);
}
