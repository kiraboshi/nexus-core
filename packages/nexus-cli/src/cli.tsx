#!/usr/bin/env node
import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { render } from "ink";
import { App } from "./app.js";

// Find workspace root (go up from packages/nexus-cli/src to root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = resolve(__dirname, "../../../");

// Load .env from workspace root
dotenv.config({ path: resolve(workspaceRoot, ".env") });

const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/core";

const connectionString = process.env.CORE_DATABASE_URL ?? DEFAULT_DATABASE_URL;
const namespace = process.env.CORE_NAMESPACE ?? "demo";

// Output the database URL being used
console.log(`Database URL: ${connectionString}`);
console.log(`Namespace: ${namespace}\n`);

render(<App connectionString={connectionString} namespace={namespace} />);

