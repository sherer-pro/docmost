import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { POSTGRES_IMAGE } from "./production-db.mjs";

const POSTGRES_REFERENCE = /postgres:18(?:-alpine)?@sha256:[0-9a-f]{64}/gu;

function imageReferences(source) {
  return source.match(POSTGRES_REFERENCE) ?? [];
}

function requireText(errors, source, expected, label) {
  if (!source.includes(expected))
    errors.push(`${label} must include ${expected}`);
}

function serviceBlock(source, service) {
  const lines = source.split(/\r?\n/u);
  const servicesIndex = lines.findIndex((line) => line === "services:");
  const start = lines.findIndex(
    (line, index) => index > servicesIndex && line === `  ${service}:`,
  );
  if (start < 0) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

export function validateProductionDatabaseContract({
  localCompose,
  productionCompose,
  ciSource,
  operatorImage = POSTGRES_IMAGE,
}) {
  const errors = [];
  const sources = {
    "docker-compose.yml": localCompose,
    "compose.production.yml": productionCompose,
    ".github/workflows/ci.yml": ciSource,
  };

  if (operatorImage !== POSTGRES_IMAGE) {
    errors.push(
      "production database operator must use the canonical PostgreSQL image",
    );
  }
  for (const [name, source] of Object.entries(sources)) {
    if (source.includes("postgres:18-alpine")) {
      errors.push(`${name} must not use the Alpine PostgreSQL runtime`);
    }
    const references = imageReferences(source);
    if (references.length === 0) {
      errors.push(`${name} must pin PostgreSQL 18 by digest`);
    }
    for (const reference of references) {
      if (reference !== POSTGRES_IMAGE) {
        errors.push(`${name} PostgreSQL image must match ${POSTGRES_IMAGE}`);
      }
    }
  }

  requireText(
    errors,
    productionCompose,
    'image: "${DOCMOST_IMAGE:?Set DOCMOST_IMAGE to image@sha256:digest}"',
    "production Compose",
  );
  requireText(
    errors,
    productionCompose,
    "DATABASE_MIGRATION_MODE: external",
    "production Compose",
  );
  requireText(
    errors,
    productionCompose,
    "- db_data:/var/lib/postgresql",
    "production Compose PostgreSQL 18 mount",
  );
  for (const declaration of [
    "POSTGRES_VOLUME_NAME:?Set POSTGRES_VOLUME_NAME",
    "DOCMOST_STORAGE_VOLUME_NAME:?Set DOCMOST_STORAGE_VOLUME_NAME",
    "external: true",
  ]) {
    requireText(
      errors,
      productionCompose,
      declaration,
      "production Compose volumes",
    );
  }
  for (const dependency of [
    "image-preflight:",
    "db-preflight:",
    "db-migrate:",
    "condition: service_completed_successfully",
    "condition: service_healthy",
  ]) {
    requireText(
      errors,
      productionCompose,
      dependency,
      "production startup chain",
    );
  }
  if (
    !/depends_on:[\s\S]*?image-preflight:[\s\S]*?condition: service_completed_successfully/u.test(
      serviceBlock(productionCompose, "db-preflight"),
    )
  ) {
    errors.push("database preflight must reject a mutable application image");
  }
  const migrationBlock = serviceBlock(productionCompose, "db-migrate");
  for (const secretContract of [
    "APP_SECRET_FILE: /run/secrets/docmost_app_secret",
    "- docmost_app_secret",
  ]) {
    if (!migrationBlock.includes(secretContract)) {
      errors.push(`one-shot migration must include ${secretContract}`);
    }
  }
  if (
    !/depends_on:[\s\S]*?db:[\s\S]*?condition: service_healthy/u.test(
      serviceBlock(productionCompose, "db-preflight"),
    )
  ) {
    errors.push("db-preflight must wait for a healthy PostgreSQL service");
  }
  if (
    !/depends_on:[\s\S]*?db-preflight:[\s\S]*?condition: service_completed_successfully/u.test(
      serviceBlock(productionCompose, "db-migrate"),
    )
  ) {
    errors.push("db-migrate must wait for a successful database preflight");
  }
  if (
    !/depends_on:[\s\S]*?db-migrate:[\s\S]*?condition: service_completed_successfully/u.test(
      serviceBlock(productionCompose, "collab"),
    )
  ) {
    errors.push("collaboration must wait for the one-shot database migration");
  }
  if (
    !/depends_on:[\s\S]*?collab:[\s\S]*?condition: service_healthy/u.test(
      serviceBlock(productionCompose, "docmost"),
    )
  ) {
    errors.push("API must wait for a healthy collaboration service");
  }

  return [...new Set(errors)];
}

async function main() {
  const [localCompose, productionCompose, ciSource] = await Promise.all([
    readFile("docker-compose.yml", "utf8"),
    readFile("compose.production.yml", "utf8"),
    readFile(".github/workflows/ci.yml", "utf8"),
  ]);
  const errors = validateProductionDatabaseContract({
    localCompose,
    productionCompose,
    ciSource,
  });
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`Production database contract violation: ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Production database contract uses ${POSTGRES_IMAGE}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
