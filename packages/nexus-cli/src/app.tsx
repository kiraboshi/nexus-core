import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { MainMenu } from "./components/MainMenu.js";
import { DatabaseViewer } from "./components/DatabaseViewer.js";
import { QueryRunner } from "./components/QueryRunner.js";
import { MetricsViewer } from "./components/MetricsViewer.js";
import { CoreSystem } from "@nexus-core/core";

type View = "main" | "database" | "query" | "metrics";

interface AppProps {
  connectionString: string;
  namespace: string;
}

export function App({ connectionString, namespace }: AppProps) {
  const [view, setView] = useState<View>("main");
  const [system, setSystem] = useState<CoreSystem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Connect lazily when a view that needs the database is selected
  const ensureConnected = useCallback(async () => {
    if (system || connecting) return;
    
    setConnecting(true);
    try {
      const sys = await CoreSystem.connect({ connectionString, namespace });
      setSystem(sys);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }, [connectionString, namespace, system, connecting]);

  // Connect when switching to a view that needs database
  useEffect(() => {
    if (view !== "main" && !system && !connecting && !error) {
      void ensureConnected();
    }
  }, [view, system, connecting, error, ensureConnected]);

  useInput((input, key) => {
    if (key.escape && view !== "main") {
      setView("main");
    }
  });

  if (error && view !== "main") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Error connecting to database: {error}</Text>
        <Text color="gray">Press ESC to go back to main menu</Text>
      </Box>
    );
  }

  if ((connecting || (!system && view !== "main")) && !error) {
    return (
      <Box padding={1}>
        <Text color="cyan">Connecting to database...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      {view === "main" && <MainMenu onSelect={setView} />}
      {view === "database" && system && <DatabaseViewer system={system} />}
      {view === "query" && system && <QueryRunner system={system} />}
      {view === "metrics" && system && <MetricsViewer system={system} />}
    </Box>
  );
}

