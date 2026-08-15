import { existsSync, readFileSync } from "node:fs";

const EXAMPLE_ENV_PATH =
  process.env.DOCMOST_ENV_CONTRACT_EXAMPLE_PATH || ".env.example";
const COMPOSE_ENV_PATH =
  process.env.DOCMOST_ENV_CONTRACT_COMPOSE_ENV_PATH || ".env.compose.example";
const LOCAL_ENV_PATH = ".env";
const ENV_VALIDATION_PATH =
  "apps/server/src/integrations/environment/environment.validation.ts";
const VITE_CONFIG_PATH = "apps/client/vite.config.ts";
const STATIC_MODULE_PATH =
  "apps/server/src/integrations/static/static.module.ts";
const COMPOSE_PATH =
  process.env.DOCMOST_ENV_CONTRACT_COMPOSE_PATH || "docker-compose.yml";

const COMPOSE_HOST_ENV_KEYS = new Set([
  "DOCMOST_BIND_ADDRESS",
  "EDGE_NETWORK_EXTERNAL",
  "EDGE_NETWORK_NAME",
]);
const COMPOSE_DATABASE_ENV_KEYS = new Set([
  "POSTGRES_DB",
  "POSTGRES_PASSWORD",
  "POSTGRES_USER",
]);
const FIXED_CONTAINER_ENV_KEYS = new Set(["HOST", "NODE_ENV", "PORT"]);
const COMPOSE_ONLY_ENV_KEYS = new Set([
  ...COMPOSE_HOST_ENV_KEYS,
  ...COMPOSE_DATABASE_ENV_KEYS,
]);
const NON_DOCMOST_RUNTIME_KEYS = new Set([
  ...COMPOSE_ONLY_ENV_KEYS,
  ...FIXED_CONTAINER_ENV_KEYS,
]);
const SYNTHETIC_WINDOW_CONFIG_KEYS = new Set(["ENV"]);
const DOCMOST_ENVIRONMENT_ANCHOR = "x-docmost-environment";
const FIXED_COMPOSE_RUNTIME_VALUES = new Map([
  ["COLLAB_INTERNAL_URL", "http://collab:3001"],
]);

const FILE_SECRET_BINDINGS = new Map([
  [
    "APP_SECRET",
    {
      fileKey: "APP_SECRET_FILE",
      secretName: "docmost_app_secret",
      required: true,
    },
  ],
  [
    "COLLAB_INTERNAL_SECRET",
    {
      fileKey: "COLLAB_INTERNAL_SECRET_FILE",
      secretName: "docmost_collab_internal_secret",
      required: true,
    },
  ],
  [
    "DATABASE_URL",
    {
      fileKey: "DATABASE_URL_FILE",
      secretName: "docmost_database_url",
      required: true,
    },
  ],
  [
    "REDIS_URL",
    {
      fileKey: "REDIS_URL_FILE",
      secretName: "docmost_redis_url",
      required: true,
    },
  ],
  [
    "AWS_S3_SECRET_ACCESS_KEY",
    {
      fileKey: "AWS_S3_SECRET_ACCESS_KEY_FILE",
      secretName: "docmost_aws_s3_secret_access_key",
      required: false,
    },
  ],
  [
    "SMTP_PASSWORD",
    {
      fileKey: "SMTP_PASSWORD_FILE",
      secretName: "docmost_smtp_password",
      required: false,
    },
  ],
  [
    "POSTMARK_TOKEN",
    {
      fileKey: "POSTMARK_TOKEN_FILE",
      secretName: "docmost_postmark_token",
      required: false,
    },
  ],
  [
    "TYPESENSE_API_KEY",
    {
      fileKey: "TYPESENSE_API_KEY_FILE",
      secretName: "docmost_typesense_api_key",
      required: false,
    },
  ],
  [
    "WEB_PUSH_VAPID_PRIVATE_KEY",
    {
      fileKey: "WEB_PUSH_VAPID_PRIVATE_KEY_FILE",
      secretName: "docmost_web_push_vapid_private_key",
      required: false,
    },
  ],
]);

function parseEnvKeys(filePath) {
  const content = readFileSync(filePath, "utf8");
  const keys = new Set();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)=/);
    if (match) {
      keys.add(match[1]);
    }
  }

  return keys;
}

function extractServerValidationKeys() {
  const content = readFileSync(ENV_VALIDATION_PATH, "utf8");
  return new Set(
    [...content.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map(
      (match) => match[1],
    ),
  );
}

function extractViteEnvKeys() {
  const content = readFileSync(VITE_CONFIG_PATH, "utf8");
  const match = content.match(/const\s*{([\s\S]*?)}\s*=\s*loadEnv\(/);
  if (!match) {
    return new Set();
  }

  return new Set(
    match[1]
      .split(",")
      .map((rawKey) => rawKey.replace(/\/\/.*$/g, "").trim())
      .filter(Boolean)
      .map((rawKey) => rawKey.split(":")[0].trim()),
  );
}

function extractWindowConfigKeys() {
  const content = readFileSync(STATIC_MODULE_PATH, "utf8");
  const match = content.match(/const\s+configString\s*=\s*{([\s\S]*?)\n\s*};/);
  if (!match) {
    return new Set();
  }

  return new Set(
    [...match[1].matchAll(/^\s*([A-Z][A-Z0-9_]+):/gm)]
      .map((entry) => entry[1])
      .filter((key) => !SYNTHETIC_WINDOW_CONFIG_KEYS.has(key)),
  );
}

function extractTopLevelMap(mapName) {
  const entries = new Map();
  let inMap = false;

  for (const line of readFileSync(COMPOSE_PATH, "utf8").split(/\r?\n/)) {
    if (line.startsWith(`${mapName}:`)) {
      inMap = true;
      continue;
    }
    if (inMap && line && !/^\s/.test(line)) {
      break;
    }
    if (!inMap) {
      continue;
    }

    const match = /^  ([A-Z][A-Z0-9_]+):\s*(.+)$/.exec(line);
    if (match) {
      entries.set(match[1], match[2].trim());
    }
  }

  return entries;
}

function extractComposeServiceBlock(serviceName) {
  const lines = readFileSync(COMPOSE_PATH, "utf8").split(/\r?\n/);
  const block = [];
  let inTargetService = false;

  for (const line of lines) {
    if (line === `  ${serviceName}:`) {
      inTargetService = true;
      block.push(line);
      continue;
    }
    if (inTargetService && /^  \S/.test(line)) {
      break;
    }
    if (inTargetService) {
      block.push(line);
    }
  }

  return block.join("\n");
}

function extractComposeServiceEnv(serviceName) {
  const entries = new Map();
  let inEnvironment = false;

  for (const line of extractComposeServiceBlock(serviceName).split(/\r?\n/)) {
    if (/^    environment:\s*$/.test(line)) {
      inEnvironment = true;
      continue;
    }
    if (inEnvironment && /^    \S/.test(line)) {
      break;
    }
    if (!inEnvironment) {
      continue;
    }

    const match = /^      ([A-Z][A-Z0-9_]+):\s*(.+)$/.exec(line);
    if (match) {
      entries.set(match[1], match[2].trim());
    }
  }

  return entries;
}

function sortedDiff(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

function reportDiff(title, values) {
  if (values.length === 0) {
    return;
  }

  console.error(`${title}:`);
  for (const value of values) {
    console.error(`  - ${value}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSecretEnvironmentBinding(composeSource, secretName, sourceKey) {
  return new RegExp(
    `^  ${escapeRegExp(secretName)}:\\r?\\n    environment: ${escapeRegExp(sourceKey)}$`,
    "m",
  ).test(composeSource);
}

if (!existsSync(EXAMPLE_ENV_PATH)) {
  console.error(`${EXAMPLE_ENV_PATH} is missing`);
  process.exit(1);
}

const exampleKeys = parseEnvKeys(EXAMPLE_ENV_PATH);
const serverValidationKeys = extractServerValidationKeys();
const viteEnvKeys = extractViteEnvKeys();
const windowConfigKeys = extractWindowConfigKeys();

const missingFromExample = sortedDiff(serverValidationKeys, exampleKeys);
const extraInExample = sortedDiff(
  exampleKeys,
  new Set([...serverValidationKeys, ...COMPOSE_ONLY_ENV_KEYS]),
);
const viteMissingFromExample = sortedDiff(viteEnvKeys, exampleKeys);
const windowConfigMissingFromExample = sortedDiff(
  windowConfigKeys,
  exampleKeys,
);
const issues = [
  missingFromExample,
  extraInExample,
  viteMissingFromExample,
  windowConfigMissingFromExample,
];

reportDiff(
  "Server-validated keys missing from .env.example",
  missingFromExample,
);
reportDiff(
  "Keys in .env.example missing from server validation",
  extraInExample,
);
reportDiff(
  "Vite runtime keys missing from .env.example",
  viteMissingFromExample,
);
reportDiff(
  "Backend-served runtime keys missing from .env.example",
  windowConfigMissingFromExample,
);

if (existsSync(COMPOSE_ENV_PATH)) {
  const composeKeys = parseEnvKeys(COMPOSE_ENV_PATH);
  const composeMissing = sortedDiff(
    new Set(
      [...exampleKeys].filter((key) => !FIXED_COMPOSE_RUNTIME_VALUES.has(key)),
    ),
    composeKeys,
  );
  const composeExtra = sortedDiff(composeKeys, exampleKeys);

  issues.push(composeMissing, composeExtra);
  reportDiff(
    "Keys from .env.example missing from .env.compose.example",
    composeMissing,
  );
  reportDiff(
    "Keys in .env.compose.example missing from .env.example",
    composeExtra,
  );
}

if (existsSync(COMPOSE_PATH)) {
  const composeSource = readFileSync(COMPOSE_PATH, "utf8");
  const composeRuntimeEnv = extractTopLevelMap(DOCMOST_ENVIRONMENT_ANCHOR);
  const expectedRuntimeKeys = new Set(
    [...exampleKeys].filter((key) => !NON_DOCMOST_RUNTIME_KEYS.has(key)),
  );
  const allowedComposeKeys = new Set();
  const composeRuntimeMissing = [];
  const composeRuntimeNotForwarded = [];
  const composeSecretBindingErrors = [];

  for (const key of expectedRuntimeKeys) {
    const fileBinding = FILE_SECRET_BINDINGS.get(key);
    if (fileBinding) {
      allowedComposeKeys.add(fileBinding.fileKey);
      const expectedPath = `/run/secrets/${fileBinding.secretName}`;
      if (
        (fileBinding.required || composeRuntimeEnv.has(fileBinding.fileKey)) &&
        composeRuntimeEnv.get(fileBinding.fileKey) !== expectedPath
      ) {
        composeRuntimeMissing.push(`${key} via ${fileBinding.fileKey}`);
      }
      if (composeRuntimeEnv.has(key)) {
        composeRuntimeNotForwarded.push(`${key} must be file-backed`);
      }
      if (
        !hasSecretEnvironmentBinding(composeSource, fileBinding.secretName, key)
      ) {
        composeSecretBindingErrors.push(
          `${fileBinding.secretName} must source ${key}`,
        );
      }
      continue;
    }

    const fixedValue = FIXED_COMPOSE_RUNTIME_VALUES.get(key);
    if (fixedValue) {
      allowedComposeKeys.add(key);
      if (composeRuntimeEnv.get(key) !== fixedValue) {
        composeRuntimeNotForwarded.push(
          `${key} must be fixed to ${fixedValue}`,
        );
      }
      continue;
    }

    allowedComposeKeys.add(key);
    const value = composeRuntimeEnv.get(key) || "";
    if (!value) {
      composeRuntimeMissing.push(key);
    } else if (!value.includes(`\${${key}`)) {
      composeRuntimeNotForwarded.push(key);
    }
  }

  const composeRuntimeExtra = sortedDiff(
    new Set(composeRuntimeEnv.keys()),
    allowedComposeKeys,
  );
  const forbiddenComposeRuntimeKeys = [...NON_DOCMOST_RUNTIME_KEYS]
    .filter((key) => composeRuntimeEnv.has(key))
    .sort();
  const serviceContractErrors = [];

  for (const serviceName of ["docmost", "collab"]) {
    const block = extractComposeServiceBlock(serviceName);
    if (!block) {
      serviceContractErrors.push(`${serviceName} service is missing`);
      continue;
    }
    if (!block.includes("environment: *docmost-environment")) {
      serviceContractErrors.push(
        `${serviceName} must use the docmost environment contract`,
      );
    }
    if (!block.includes("secrets: *docmost-secrets")) {
      serviceContractErrors.push(
        `${serviceName} must mount required Docmost secrets`,
      );
    }
    if (
      serviceName === "docmost" &&
      !block.includes("      collab:\n        condition: service_healthy")
    ) {
      serviceContractErrors.push(
        "docmost must wait for the collaboration service health check",
      );
    }
  }

  const dbEnv = extractComposeServiceEnv("db");
  const postgresSecret = "docmost_postgres_password";
  if (
    dbEnv.get("POSTGRES_PASSWORD_FILE") !== `/run/secrets/${postgresSecret}`
  ) {
    composeSecretBindingErrors.push(
      "db must use POSTGRES_PASSWORD_FILE from a Compose secret",
    );
  }
  if (dbEnv.has("POSTGRES_PASSWORD")) {
    composeSecretBindingErrors.push(
      "db must not expose POSTGRES_PASSWORD in container metadata",
    );
  }
  if (
    !hasSecretEnvironmentBinding(
      composeSource,
      postgresSecret,
      "POSTGRES_PASSWORD",
    )
  ) {
    composeSecretBindingErrors.push(
      `${postgresSecret} must source POSTGRES_PASSWORD`,
    );
  }

  issues.push(
    composeRuntimeMissing,
    composeRuntimeNotForwarded,
    composeRuntimeExtra,
    forbiddenComposeRuntimeKeys,
    composeSecretBindingErrors,
    serviceContractErrors,
  );
  reportDiff(
    "Required runtime keys missing from the Docmost Compose environment",
    composeRuntimeMissing.sort(),
  );
  reportDiff(
    "Required runtime keys not forwarded from the Compose environment",
    composeRuntimeNotForwarded.sort(),
  );
  reportDiff(
    "Unclassified keys in the Docmost Compose environment",
    composeRuntimeExtra,
  );
  reportDiff(
    "Host, fixed-image, or database keys incorrectly forwarded to Docmost",
    forbiddenComposeRuntimeKeys,
  );
  reportDiff("Compose secret binding errors", composeSecretBindingErrors);
  reportDiff("Compose service contract errors", serviceContractErrors);
}

if (existsSync(LOCAL_ENV_PATH)) {
  const localKeys = parseEnvKeys(LOCAL_ENV_PATH);
  const localMissing = sortedDiff(exampleKeys, localKeys);
  const localExtra = sortedDiff(localKeys, exampleKeys);

  issues.push(localMissing, localExtra);
  reportDiff("Keys from .env.example missing from local .env", localMissing);
  reportDiff("Keys in local .env missing from .env.example", localExtra);
}

if (issues.some((values) => values.length > 0)) {
  process.exit(1);
}

console.log("Environment contract is in sync.");
