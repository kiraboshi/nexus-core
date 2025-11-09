#!/usr/bin/env node
import { jsx as _jsx } from "react/jsx-runtime";
import dotenv from "dotenv";
import { render } from "ink";
import { App } from "./app.js";
dotenv.config();
const DEFAULT_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/core";
const connectionString = process.env.CORE_DATABASE_URL ?? DEFAULT_DATABASE_URL;
const namespace = process.env.CORE_NAMESPACE ?? "demo";
render(_jsx(App, { connectionString: connectionString, namespace: namespace }));
//# sourceMappingURL=cli.js.map